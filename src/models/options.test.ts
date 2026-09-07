import assert from "node:assert/strict";
import test from "node:test";
import {
  applyReasoningEffort,
  applyResponsesReasoningEffort,
  buildModelConfigurationSchema,
  contextSizeOptions,
  modelEffortSpec,
  resolveContextCap,
  resolveContextSize,
  resolveReasoningEffort,
  resolveWebSearch,
} from "./options";

test("exposes model-specific Grok reasoning levels", () => {
  assert.deepEqual(modelEffortSpec("grok-4.6"), {
    efforts: ["low", "medium", "high", "xhigh"],
    defaultEffort: "high",
  });
  assert.deepEqual(modelEffortSpec("grok-4.5"), {
    efforts: ["low", "medium", "high"],
    defaultEffort: "high",
  });
  assert.deepEqual(modelEffortSpec("grok-4.3"), {
    efforts: ["none", "low", "medium", "high"],
    defaultEffort: "high",
  });
  assert.deepEqual(modelEffortSpec("grok-4.20-multi-agent"), {
    efforts: ["low", "medium", "high", "xhigh"],
    defaultEffort: "high",
  });
});

test("does not add a reasoning switcher to non-reasoning and unknown models", () => {
  assert.equal(modelEffortSpec("grok-4-1-fast-non-reasoning"), undefined);
  assert.equal(modelEffortSpec("grok-4-1-fast-reasoning"), undefined);
  assert.equal(buildModelConfigurationSchema("grok-imagine-image"), undefined);
  assert.equal(buildModelConfigurationSchema("grok-4-1-fast-non-reasoning")?.properties.reasoningEffort, undefined);
  assert.equal(buildModelConfigurationSchema("grok-4-1-fast-non-reasoning")?.properties.webSearch.title, "Web Search");
});

test("request selection overrides the workspace default", () => {
  assert.equal(resolveReasoningEffort("grok-4.5", { reasoningEffort: "low" }, "medium"), "low");
  assert.equal(resolveWebSearch({ webSearch: true }), true);
  assert.equal(resolveWebSearch({ webSearch: "on" }), true);
  assert.equal(resolveWebSearch({ webSearch: false }), false);
  assert.equal(resolveWebSearch({ webSearch: false }, true), false);
  assert.equal(resolveWebSearch(undefined, true), true);
  assert.equal(resolveWebSearch(undefined, false), false);
  assert.equal(resolveWebSearch(undefined), false);
  assert.deepEqual(applyReasoningEffort({ model: "grok-4.5" }, "low"), {
    model: "grok-4.5",
    reasoning_effort: "low",
  });
  assert.deepEqual(applyResponsesReasoningEffort({ model: "grok-4.5" }, "high"), {
    model: "grok-4.5",
    reasoning: { effort: "high" },
  });
  assert.deepEqual(applyResponsesReasoningEffort({ model: "grok-4.5" }, "none"), {
    model: "grok-4.5",
  });
  assert.deepEqual(applyReasoningEffort({ model: "grok-imagine-image" }, undefined), {
    model: "grok-imagine-image",
  });
});

test("unsupported levels fall back to the model default", () => {
  assert.equal(resolveReasoningEffort("grok-4.5", { reasoningEffort: "xhigh" }, "none"), "high");
  assert.equal(resolveReasoningEffort("grok-4.20-multi-agent", undefined, "xhigh"), "xhigh");
});

test("configuration schema exposes a native picker with the workspace default", () => {
  assert.equal(buildModelConfigurationSchema("grok-4.3")?.properties.reasoningEffort.default, "high");
  const schema = buildModelConfigurationSchema("grok-4.3", "medium");
  assert.deepEqual(schema?.properties.reasoningEffort.enum, ["none", "low", "medium", "high"]);
  assert.equal(schema?.properties.reasoningEffort.default, "medium");
  assert.deepEqual(schema?.properties.webSearch.enum, ["off", "on"]);
  assert.equal(schema?.properties.webSearch.default, "off");

  const multiAgent = buildModelConfigurationSchema("grok-4.20-multi-agent", "xhigh");
  assert.equal(multiAgent?.properties.reasoningEffort.title, "Agent Effort");
  assert.equal(multiAgent?.properties.reasoningEffort.default, "xhigh");

  const frontier = buildModelConfigurationSchema("grok-4.6", "xhigh", true);
  assert.deepEqual(frontier?.properties.reasoningEffort.enum, ["low", "medium", "high", "xhigh"]);
  assert.equal(frontier?.properties.webSearch.default, "on");
});

test("offers context tiers below the registered input limit", () => {
  assert.deepEqual(contextSizeOptions(1_000_000)?.map((option) => option.value), ["auto", 65_536, 131_072, 200_000, 1_000_000]);
  assert.deepEqual(contextSizeOptions(1_000_000)?.map((option) => option.label), ["Auto", "64K", "128K", "200K", "Maximum"]);
  assert.equal(contextSizeOptions(65_536), undefined);
  assert.equal(contextSizeOptions(32_000), undefined);
});

test("resolves the effective context cap from the selected tier", () => {
  assert.equal(resolveContextCap(131_072, 1_000_000), 131_072);
  assert.equal(resolveContextCap(1_500_000, 1_000_000), undefined);
  assert.equal(resolveContextCap(0, 1_000_000), undefined);
  assert.equal(resolveContextCap(-5, 1_000_000), undefined);
  assert.equal(resolveContextCap(65_536, 65_536), undefined);
});

test("reads the context size from request configuration", () => {
  assert.equal(resolveContextSize({ contextSize: 131_072 }), 131_072);
  assert.equal(resolveContextSize({ contextSize: 0 }), 0);
  assert.equal(resolveContextSize({ contextSize: "131072" }), 0);
  assert.equal(resolveContextSize(undefined), 0);
});

test("exposes the Context Window control alongside reasoning controls", () => {
  const schema = buildModelConfigurationSchema("grok-4.6", "high", false, contextSizeOptions(491_520));
  assert.deepEqual(schema?.properties.contextSize.enum, ["auto", 65_536, 131_072, 200_000, 491_520]);
  assert.equal(schema?.properties.contextSize.default, "auto");
  assert.equal(schema?.properties.contextSize.group, "tokens");
  assert.equal(Object.entries(schema!.properties!).find(([, property]) => property.group === "tokens")?.[0], "contextSize");
  const plain = buildModelConfigurationSchema("grok-4.6", "high", false);
  assert.equal("contextSize" in (plain?.properties ?? {}), false);
});

// Mirrors VS Code's context indicator contract: numeric selections replace input,
// while a nonnumeric Auto selection falls back to the registered input limit.
test("Auto preserves the full context window in the VS Code indicator", () => {
  for (const input of [78_000, 244_800, 983_040]) {
    const options = contextSizeOptions(input)!;
    const auto = options.find((option) => option.label === "Auto")!;
    const output = 16_384;
    const displayedInput = typeof auto.value === "number" ? auto.value : input;
    assert.equal(displayedInput + output, input + output);
    assert.ok(options.every((option) => typeof option.value !== "number" || option.value > 0));
  }
});
