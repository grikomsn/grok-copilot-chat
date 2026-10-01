import assert from "node:assert/strict";
import Module from "node:module";
import test from "node:test";
import type * as vscode from "vscode";
import { stringifyWellFormedJson } from "../transport/unicode";

class TextPart { constructor(readonly value: string) {} }
class ToolCallPart { constructor(readonly callId: string, readonly name: string, readonly input: object) {} }
class ToolResultPart { constructor(readonly callId: string, readonly content: unknown[]) {} }
class DataPart { constructor(readonly data: Uint8Array, readonly mimeType: string) {} }

// VS Code supplies these constructors in the extension host; isolate conversion in Node.
const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown };
const originalLoad = loader._load;
loader._load = function (id, ...args) {
  if (id === "vscode") return {
    LanguageModelTextPart: TextPart,
    LanguageModelToolCallPart: ToolCallPart,
    LanguageModelToolResultPart: ToolResultPart,
    LanguageModelDataPart: DataPart,
    LanguageModelChatMessageRole: { User: 1, Assistant: 2 },
  };
  return originalLoad.call(this, id, ...args);
};
let messages: typeof import("./messages");
try { messages = require("./messages"); } finally { loader._load = originalLoad; }

function message(content: unknown[], role = 1): vscode.LanguageModelChatRequestMessage {
  return { role, content, name: undefined } as unknown as vscode.LanguageModelChatRequestMessage;
}

for (const [name, convert] of [
  ["Chat Completions", messages.convertChatMessage],
  ["Responses", messages.convertResponsesMessage],
] as const) {
  test(`${name} preserves split emoji in text and nested tool results`, () => {
    const input = message([
      new TextPart("status \uD83D"), new TextPart("\uDFE2"),
      new ToolResultPart("call-1", [new TextPart("file \uD83D"), new TextPart("\uDE80"), new ToolResultPart("nested", [new TextPart("\uD83D"), new TextPart("\uDCCB")])]),
      new DataPart(new Uint8Array([0, 1, 2]), "image/png"),
    ]);
    const encoded = stringifyWellFormedJson(convert(input));
    assert.match(encoded, /status 🟢/);
    assert.match(encoded, /file 🚀\\n📋/);
    assert.match(encoded, /data:image\/png;base64,AAEC/);
    assert.doesNotMatch(encoded, /\\u[dD][89a-fA-F][0-9a-fA-F]{2}/);
    assert.match(messages.messageToText(input), /status 🟢\nfile 🚀\n📋/);
  });

  test(`${name} replaces lone surrogates inside embedded tool-call arguments`, () => {
    const converted = convert(message([new ToolCallPart("call-1", "read", { text: "\uD800", nested: ["🟢", "\uDC00"] })], 2));
    const encoded = stringifyWellFormedJson(converted);
    assert.doesNotMatch(encoded, /\\u[dD][89a-fA-F][0-9a-fA-F]{2}/);
    const item = converted[0];
    const argumentsJson = "tool_calls" in item ? item.tool_calls![0].function.arguments : "arguments" in item ? item.arguments : "";
    assert.deepEqual(JSON.parse(argumentsJson), { text: "�", nested: ["🟢", "�"] });
  });
}
