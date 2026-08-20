import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { profileFromConfiguration, profileQualifiedModelId } from "./provider-profile";

test("declares native named profile configuration without a management-command override", () => {
  const manifest = JSON.parse(readFileSync("package.json", "utf8")) as {
    contributes: { languageModelChatProviders: Array<Record<string, unknown>> };
  };
  const provider = manifest.contributes.languageModelChatProviders.find((item) => item.vendor === "xai-grok");
  assert.ok(provider);
  assert.equal(provider.managementCommand, undefined);
  assert.deepEqual((provider.configuration as { required?: string[] }).required, ["profile"]);
});

test("qualifies model IDs by profile and reports invalid saved profiles", () => {
  assert.equal(profileQualifiedModelId("Work", "grok-4"), "work::grok-4");
  assert.equal(profileQualifiedModelId("default", "grok-4"), "grok-4");
  assert.throws(
    () => profileFromConfiguration({ profile: "work profile" }),
    /Update this provider entry in Manage Language Models/,
  );
});
