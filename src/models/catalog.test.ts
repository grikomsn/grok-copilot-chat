import assert from "node:assert/strict";
import test from "node:test";
import {
  enrichDiscoveredModel,
  FALLBACK_MODELS,
  parseDiscoveredModels,
  resolveModelTokenLimits,
} from "./catalog";

test("keeps live xAI metadata authoritative and fills absent models.dev fields", () => {
  assert.deepEqual(enrichDiscoveredModel(
    { id: "grok-future", contextLength: 123_000, imageInput: false },
    { id: "grok-future", contextLength: 999_000, imageInput: true, toolCalling: true },
  ), { id: "grok-future", contextLength: 123_000, imageInput: false, toolCalling: true });
});

test("does not treat an unverified models.dev tool negative as authoritative", () => {
  const model = enrichDiscoveredModel(
    { id: "grok-4.20-multi-agent-0309" },
    { id: "grok-4.20-multi-agent-0309", toolCalling: false },
  );
  assert.equal(model.toolCalling, undefined);
});

test("keeps fallback models aligned with the current xAI catalog", () => {
  assert.deepEqual(FALLBACK_MODELS, [
    { id: "grok-4.6", contextLength: 500_000, imageInput: true, toolCalling: true },
    { id: "grok-4.5", contextLength: 500_000, imageInput: true, toolCalling: true },
    { id: "grok-4.3", contextLength: 1_000_000, toolCalling: true },
    { id: "grok-build-0.1", contextLength: 256_000, toolCalling: true },
    { id: "grok-4.20", contextLength: 1_000_000, toolCalling: true },
    { id: "grok-4.20-non-reasoning", contextLength: 1_000_000, toolCalling: true },
    { id: "grok-4.20-multi-agent", contextLength: 1_000_000, toolCalling: true },
  ]);
});

test("parses chat models and context_length from xAI /v1/models payloads", () => {
  const models = parseDiscoveredModels({
    object: "list",
    data: [
      {
        id: "grok-4.5",
        context_length: 500_000,
        long_context_threshold: 200_000,
        capabilities: { image_input: true, tool_calling: true },
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
    { id: "grok-4.5", contextLength: 500_000, imageInput: true, toolCalling: true },
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
    { id: "grok-4.3", contextLength: 1_000_000, toolCalling: true },
    { id: "grok-4.5", contextLength: 500_000, imageInput: true, toolCalling: true },
    { id: "grok-4.5-latest" },
    { id: "grok-build-0.1", contextLength: 256_000, toolCalling: true },
  ]);
});

test("uses per-model fallback context lengths for partial discovery metadata", () => {
  const models = parseDiscoveredModels({
    data: [
      { id: "grok-4.5" },
      { id: "grok-4.3" },
      { id: "grok-build-0.1", context_length: "invalid" },
      { id: "grok-4.20-multi-agent" },
      { id: "grok-future" },
    ],
  });

  assert.deepEqual(models, [
    { id: "grok-4.20-multi-agent", contextLength: 1_000_000, toolCalling: true },
    { id: "grok-4.3", contextLength: 1_000_000, toolCalling: true },
    { id: "grok-4.5", contextLength: 500_000, imageInput: true, toolCalling: true },
    { id: "grok-build-0.1", contextLength: 256_000, toolCalling: true },
    { id: "grok-future" },
  ]);
});

test("does not retain retired model metadata as fallback defaults", () => {
  const models = parseDiscoveredModels({
    data: [
      { id: "grok-code-fast-1" },
      { id: "grok-4-1-fast-reasoning" },
    ],
  });

  assert.deepEqual(models, [
    { id: "grok-4-1-fast-reasoning" },
    { id: "grok-code-fast-1" },
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
  assert.deepEqual(models, [{ id: "grok-4.5", contextLength: 500_000, imageInput: true, toolCalling: true }]);
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
