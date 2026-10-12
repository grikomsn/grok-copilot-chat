import assert from "node:assert/strict";
import test from "node:test";
import { applyReasoningEffort, applyResponsesReasoningEffort, buildModelConfigurationSchema, contextSizeOptions, resolveReasoningEffort } from "./options";

// Mirrors the BYOK schema key and the Copilot launcher's accepted tiers in VS Code 1.141.
const SDK_EFFORTS = new Set(["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"]);

test("Copilot SDK BYOK discovers Grok efforts independently of other controls", () => {
  const cases = [
    ["grok-4.3", ["none", "low", "medium", "high"]],
    ["grok-4.7", ["low", "medium", "high", "xhigh"]],
    ["grok-4.20-multi-agent", ["low", "medium", "high", "xhigh"]],
  ] as const;
  for (const [id, expected] of cases) {
    for (const context of [undefined, contextSizeOptions(491_520)]) {
      const schema = buildModelConfigurationSchema(id, "medium", true, context);
      const effortSchema = schema?.properties.reasoningEffort;
      assert.ok(effortSchema, `${id}: BYOK requires reasoningEffort`);
      const bridged = (effortSchema.enum as unknown[]).filter((value): value is string => typeof value === "string");
      assert.deepEqual(bridged.filter((effort) => SDK_EFFORTS.has(effort)), expected, id);
      assert.equal(effortSchema.default, "medium");
    }
  }
  assert.equal(buildModelConfigurationSchema("grok-4-1-fast-non-reasoning", undefined, true, contextSizeOptions(491_520))?.properties.reasoningEffort, undefined);
});

test("Copilot SDK effort selections override defaults on both Grok transports", () => {
  const schema = buildModelConfigurationSchema("grok-4.7", "medium", false, contextSizeOptions(491_520));
  const bridged = (schema?.properties.reasoningEffort.enum as unknown[]).filter((value): value is string => typeof value === "string");
  for (const selected of bridged.filter((effort) => SDK_EFFORTS.has(effort))) {
    const effort = resolveReasoningEffort("grok-4.7", { reasoningEffort: selected }, "medium");
    assert.equal(effort, selected);
    assert.deepEqual(applyReasoningEffort({ model: "grok-4.7" }, effort), { model: "grok-4.7", reasoning_effort: selected });
    assert.deepEqual(applyResponsesReasoningEffort({ model: "grok-4.7" }, effort), { model: "grok-4.7", reasoning: { effort: selected } });
  }
  const disabled = resolveReasoningEffort("grok-4.3", { reasoningEffort: "none" }, "high");
  assert.equal(disabled, "none");
  assert.deepEqual(applyReasoningEffort({}, disabled), { reasoning_effort: "none" });
  assert.deepEqual(applyResponsesReasoningEffort({}, disabled), {});
});
