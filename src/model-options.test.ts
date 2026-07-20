import assert from "node:assert/strict";
import test from "node:test";
import {
  applyReasoningEffort,
  buildModelConfigurationSchema,
  modelEffortSpec,
  resolveReasoningEffort,
} from "./model-options";

test("exposes model-specific Grok reasoning levels", () => {
  assert.deepEqual(modelEffortSpec("grok-4.5"), {
    efforts: ["low", "medium", "high"],
    defaultEffort: "high",
  });
  assert.deepEqual(modelEffortSpec("grok-4.3"), {
    efforts: ["none", "low", "medium", "high"],
    defaultEffort: "low",
  });
  assert.deepEqual(modelEffortSpec("grok-4.20-multi-agent"), {
    efforts: ["low", "medium", "high", "xhigh"],
    defaultEffort: "high",
  });
});

test("does not add a reasoning switcher to non-reasoning and unknown models", () => {
  assert.equal(modelEffortSpec("grok-4-1-fast-non-reasoning"), undefined);
  assert.equal(buildModelConfigurationSchema("grok-imagine-image"), undefined);
});

test("request selection overrides the workspace default", () => {
  assert.equal(resolveReasoningEffort("grok-4.5", { reasoningEffort: "low" }, "medium"), "low");
  assert.deepEqual(applyReasoningEffort({ model: "grok-4.5" }, "low"), {
    model: "grok-4.5",
    reasoning_effort: "low",
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
  const schema = buildModelConfigurationSchema("grok-4.3", "medium");
  assert.deepEqual(schema?.properties.reasoningEffort.enum, ["none", "low", "medium", "high"]);
  assert.equal(schema?.properties.reasoningEffort.default, "medium");

  const multiAgent = buildModelConfigurationSchema("grok-4.20-multi-agent", "xhigh");
  assert.equal(multiAgent?.properties.reasoningEffort.title, "Agent Effort");
  assert.equal(multiAgent?.properties.reasoningEffort.default, "xhigh");
});
