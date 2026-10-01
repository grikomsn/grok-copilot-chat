import assert from "node:assert/strict";
import test from "node:test";
import { joinTextParts, stringifyWellFormedJson } from "./unicode";

test("repairs astral characters only at text-part boundaries", () => {
  assert.equal(joinTextParts(["**Status:** \uD83D", "\uDFE2 done"]), "**Status:** 🟢 done");
  assert.equal(joinTextParts(["\uD83D", "\uDE80\uD83D", "\uDCCB"]), "🚀📋");
  assert.equal(joinTextParts(["🟢", "→ ⬜", "", "📋"]), "🟢\n→ ⬜\n\n📋");
  assert.equal(joinTextParts(["\uD83D\n\uDFE2"]), "�\n�");
  assert.equal(joinTextParts(["leading \uD83D", "ordinary", "\uDFE2 trailing"]), "leading �\nordinary\n� trailing");
});

test("normalizes nested JSON strings and keys without mutating the request", () => {
  const body = {
    messages: [{ content: [{ type: "text", text: "a\uD800b\uDC00 🟢" }, { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } }] }],
    tools: [{ function: { parameters: { properties: { ["key\uD800"]: { description: "\uDC00" } } } } }],
    store: false,
    max_tokens: 64,
    extra: null,
  };
  const encoded = stringifyWellFormedJson(body);
  assert.doesNotMatch(encoded, /\\u[dD][89a-fA-F][0-9a-fA-F]{2}/);
  const parsed = JSON.parse(encoded);
  assert.equal(parsed.messages[0].content[0].text, "a�b� 🟢");
  assert.equal(parsed.tools[0].function.parameters.properties["key�"].description, "�");
  assert.equal(parsed.messages[0].content[1].image_url.url, "data:image/png;base64,AAAA");
  assert.equal(parsed.store, false);
  assert.equal(parsed.max_tokens, 64);
  assert.equal(parsed.extra, null);
  assert.equal(body.messages[0].content[0].text, "a\uD800b\uDC00 🟢");
});

test("sanitizes tool input before it becomes an embedded JSON argument string", () => {
  const argumentsJson = stringifyWellFormedJson({ text: "\uD800 🟢", nested: ["\uDC00"] });
  const encoded = stringifyWellFormedJson({ input: [{ type: "function_call", arguments: argumentsJson }] });
  assert.deepEqual(JSON.parse(JSON.parse(encoded).input[0].arguments), { text: "� 🟢", nested: ["�"] });
});

test("preserves JSON serialization semantics for well-formed tool inputs", () => {
  const value = { when: new Date("2026-10-02T00:00:00Z"), omitted: undefined, values: [undefined, null, 1] };
  assert.equal(stringifyWellFormedJson(value), JSON.stringify(value));
  assert.equal(stringifyWellFormedJson({ toJSON: () => ({ text: "\uD800" }) }), '{"text":"�"}');
});
