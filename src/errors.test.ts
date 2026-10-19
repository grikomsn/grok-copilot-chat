import assert from "node:assert/strict";
import test from "node:test";
import { messageOf } from "./errors";

test("messageOf prefers Error.message", () => {
  assert.equal(messageOf(new Error("boom")), "boom");
});

test("messageOf renders non-Error values", () => {
  assert.equal(messageOf("plain"), "plain");
  assert.equal(messageOf(42), "42");
});

test("messageOf maps AbortError to a friendly message", () => {
  const abort = new DOMException("The operation was aborted.", "AbortError");
  assert.equal(messageOf(abort), "Request cancelled or timed out");
});
