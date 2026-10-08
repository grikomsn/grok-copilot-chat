import assert from "node:assert/strict";
import test from "node:test";
import type * as vscode from "vscode";
import { StreamResponseReporter, type ResponsePartConstructors } from "./response";

class TextPart { constructor(readonly value: string) {} }
class ThinkingPart { constructor(readonly value: string, readonly id?: string, readonly metadata?: Record<string, unknown>) {} }
class ToolPart { constructor(readonly callId: string, readonly name: string, readonly input: object) {} }
class DataPart { constructor(readonly data: Uint8Array, readonly mimeType: string) {} }
function harness(thinking = true, requestId = "request") {
  const output: unknown[] = [];
  const parts = { LanguageModelTextPart: TextPart, LanguageModelToolCallPart: ToolPart, LanguageModelDataPart: DataPart,
    ...(thinking ? { LanguageModelThinkingPart: ThinkingPart } : {}) } as unknown as ResponsePartConstructors;
  return { output, reporter: new StreamResponseReporter({ report: (part) => output.push(part) }, parts, requestId) };
}

test("reports reasoning before a mixed text delta and closes each segment once", () => {
  const { output, reporter } = harness();
  reporter.report({ reasoning: "plan", text: "answer" });
  reporter.finish();
  assert.deepEqual(output, [new ThinkingPart("plan"), new ThinkingPart("", "", { vscode_reasoning_done: true }), new TextPart("answer")]);
});

test("closes reasoning before tools, completion, cancellation, or errors", () => {
  for (const terminal of [{ toolCalls: [{ id: "call", name: "read", arguments: "{}" }] }, { done: true }, { finishReason: "stop" }, {}]) {
    const { output, reporter } = harness();
    reporter.report({ reasoning: "plan" });
    reporter.report(terminal);
    reporter.finish();
    reporter.finish();
    assert.equal(output.filter((part) => part instanceof ThinkingPart && part.metadata?.vscode_reasoning_done).length, 1);
    assert.ok(output[1] instanceof ThinkingPart);
  }
});

test("assigns unique missing IDs per request and preserves upstream IDs", () => {
  const { output, reporter } = harness();
  reporter.report({ toolCalls: [{ id: "", name: "a", arguments: "{}" }, { id: "", name: "b", arguments: "{}" }] });
  reporter.report({ toolCalls: [{ id: "upstream", name: "c", arguments: "{}" }] });
  assert.deepEqual(output.map((part) => (part as ToolPart).callId), ["grok-tool-request-0", "grok-tool-request-1", "upstream"]);
  const other = harness(true, "other");
  other.reporter.report({ toolCalls: [{ id: "", name: "a", arguments: "{}" }] });
  assert.notEqual((output[0] as ToolPart).callId, (other.output[0] as ToolPart).callId);
});

test("starts a new reasoning segment after visible output", () => {
  const { output, reporter } = harness();
  reporter.report({ reasoning: "first", text: "answer" });
  reporter.report({ reasoning: "second" });
  reporter.finish();
  assert.equal(output.filter((part) => part instanceof ThinkingPart && part.metadata?.vscode_reasoning_done).length, 2);
});

test("supports hosts without thinking parts and retains native token usage", () => {
  const { output, reporter } = harness(false);
  reporter.report({ reasoning: "plan", text: "answer", usage: { prompt_tokens: 2, completion_tokens: 3 } });
  reporter.finish();
  assert.ok(output[0] instanceof TextPart);
  const usage = output[1] as vscode.LanguageModelDataPart;
  assert.equal(usage.mimeType, "usage");
  assert.equal(JSON.parse(new TextDecoder().decode(usage.data)).prompt_tokens, 2);
});
