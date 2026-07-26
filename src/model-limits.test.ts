import assert from "node:assert/strict";
import test from "node:test";
import {
  parseDiscoveredModels,
  resolveModelTokenLimits,
} from "./model-limits";

test("parses chat models and context_length from xAI /v1/models payloads", () => {
  const models = parseDiscoveredModels({
    object: "list",
    data: [
      {
        id: "grok-4.5",
        context_length: 500_000,
        long_context_threshold: 200_000,
      },
      {
        id: "grok-code-fast-1",
        context_length: 256_000,
      },
      {
        id: "grok-imagine-image",
        context_length: 1024,
      },
      {
        id: "not-a-grok-model",
        context_length: 128_000,
      },
    ],
  });

  assert.deepEqual(models, [
    { id: "grok-4.5", contextLength: 500_000 },
    { id: "grok-code-fast-1", contextLength: 256_000 },
  ]);
});

test("ignores invalid context_length and non-chat entries", () => {
  const models = parseDiscoveredModels({
    data: [
      { id: "grok-4.5", context_length: 0 },
      { id: "grok-4.5-latest", context_length: -1 },
      { id: "grok-4.3", context_length: "1000000" },
      { id: "grok-voice", context_length: 32_000 },
      { id: "", context_length: 128_000 },
      { context_length: 128_000 },
      null,
      "skip",
      { id: "grok-build-0.1", context_length: 256_000.9 },
    ],
  });

  assert.deepEqual(models, [
    { id: "grok-4.3" },
    { id: "grok-4.5", contextLength: 500_000 },
    { id: "grok-4.5-latest" },
    { id: "grok-build-0.1", contextLength: 256_000 },
  ]);
});

test("uses per-model fallback context lengths for partial discovery metadata", () => {
  const models = parseDiscoveredModels({
    data: [
      { id: "grok-4.5" },
      { id: "grok-code-fast-1", context_length: "invalid" },
      { id: "grok-future" },
    ],
  });

  assert.deepEqual(models, [
    { id: "grok-4.5", contextLength: 500_000 },
    { id: "grok-code-fast-1", contextLength: 256_000 },
    { id: "grok-future" },
  ]);
});

test("returns an empty list for malformed model payloads", () => {
  assert.deepEqual(parseDiscoveredModels(undefined), []);
  assert.deepEqual(parseDiscoveredModels(null), []);
  assert.deepEqual(parseDiscoveredModels({}), []);
  assert.deepEqual(parseDiscoveredModels({ data: {} }), []);
});

test("does not treat long_context_threshold as the context window", () => {
  const models = parseDiscoveredModels({
    data: [
      {
        id: "grok-4.5",
        long_context_threshold: 200_000,
      },
    ],
  });
  assert.deepEqual(models, [{ id: "grok-4.5", contextLength: 500_000 }]);
  assert.equal(resolveModelTokenLimits(models[0]?.contextLength, 16_384).contextLength, 500_000);
});

test("reserves configured output headroom from the full context window", () => {
  assert.deepEqual(resolveModelTokenLimits(500_000, 16_384), {
    contextLength: 500_000,
    maxInputTokens: 483_616,
    maxOutputTokens: 16_384,
  });
  assert.deepEqual(resolveModelTokenLimits(256_000, 16_384), {
    contextLength: 256_000,
    maxInputTokens: 239_616,
    maxOutputTokens: 16_384,
  });
});

test("falls back and clamps unsafe token budgets", () => {
  assert.deepEqual(resolveModelTokenLimits(undefined, 16_384), {
    contextLength: 256_000,
    maxInputTokens: 239_616,
    maxOutputTokens: 16_384,
  });
  assert.deepEqual(resolveModelTokenLimits(8_192, 100_000), {
    contextLength: 8_192,
    maxInputTokens: 1,
    maxOutputTokens: 8_191,
  });
  assert.deepEqual(resolveModelTokenLimits(2, 0), {
    contextLength: 2,
    maxInputTokens: 1,
    maxOutputTokens: 1,
  });
  assert.deepEqual(resolveModelTokenLimits(1, 16_384), {
    contextLength: 1,
    maxInputTokens: 1,
    maxOutputTokens: 1,
  });
});
