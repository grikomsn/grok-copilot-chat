import assert from "node:assert/strict";
import test from "node:test";
import { withContextOverflowHint } from "./context-error";

test("adds recovery instructions for context rejection variants", () => {
  for (const message of [
    "invalid params, context window exceeds limit",
    "context_length_exceeded",
    "maximum context length is 128000 tokens",
    "prompt is too long: 150000 tokens",
    "too many input tokens",
    "input exceeds the context window",
  ]) {
    const original = new Error(message);
    const error = withContextOverflowHint(original) as Error;
    assert.match(error.message, /\/compact/);
    assert.equal(error.cause, original);
    assert.equal(withContextOverflowHint(error), error);
  }
});

test("preserves authentication, quota, output-length, network, and unknown errors", () => {
  for (const error of [new Error("HTTP 401"), new Error("quota exceeded"), new Error("max_tokens exceeds output limit"), new Error("fetch failed"), "context_length_exceeded"]) {
    assert.equal(withContextOverflowHint(error), error);
  }
});
