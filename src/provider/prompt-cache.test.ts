import assert from "node:assert/strict";
import test from "node:test";
import { createChatPromptCacheHeaders, createPromptCacheKey, createPromptCacheKeyFromRequest } from "./prompt-cache";

test("keeps the cache identity stable as conversation history grows", () => {
  const first = createPromptCacheKey({
    model: "grok-4.6",
    tools: [],
    input: [{ role: "user", content: "Explain this code" }],
  });
  const next = createPromptCacheKey({
    model: "grok-4.6",
    tools: [],
    input: [
      { role: "user", content: "Explain this code" },
      { role: "assistant", content: "Here is the explanation." },
      { role: "user", content: "Now simplify it." },
    ],
  });

  assert.equal(next, first);
});

test("does not expose prompt content and partitions model or tool changes", () => {
  const base = createPromptCacheKeyFromRequest({
    model: "grok-4.6",
    messages: [{ role: "user", content: "private prompt contents" }],
  });

  assert.match(base ?? "", /^[a-f0-9]{64}$/);
  assert.doesNotMatch(base ?? "", /private|prompt|contents/);
  assert.notEqual(base, createPromptCacheKeyFromRequest({
    model: "grok-4.5",
    messages: [{ role: "user", content: "private prompt contents" }],
  }));
  assert.notEqual(base, createPromptCacheKeyFromRequest({
    model: "grok-4.6",
    messages: [{ role: "user", content: "private prompt contents" }],
    tools: [{ type: "function", name: "search" }],
  }));
  assert.deepEqual(createChatPromptCacheHeaders({
    model: "grok-4.6",
    messages: [{ role: "user", content: "private prompt contents" }],
  }), { "x-grok-conv-id": base });
});
