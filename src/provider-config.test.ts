import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { activeProfileFromState, profileFromConfiguration, profileQualifiedModelId } from "./provider-profile";

test("declares optional native profile configuration without a management-command override", () => {
  const manifest = JSON.parse(readFileSync("package.json", "utf8")) as {
    contributes: {
      commands: Array<{ command: string; title: string }>;
      languageModelChatProviders: Array<Record<string, unknown>>;
    };
  };
  const provider = manifest.contributes.languageModelChatProviders.find((item) => item.vendor === "xai-grok");
  assert.ok(provider);
  // A managementCommand replaces the native Add Models prompt with a no-op
  // resolve; the schema-driven profile prompt is the supported add flow.
  assert.equal(provider.managementCommand, undefined);
  assert.ok(manifest.contributes.commands.some((item) => item.command === "grokCopilot.configureEntry"));
  assert.equal((provider.configuration as { required?: string[] }).required, undefined);
  assert.match(
    manifest.contributes.commands.find((item) => item.command === "grokCopilot.selectProfile")?.title ?? "",
    /Usage and Management/,
  );
});

test("qualifies model IDs by profile and reports invalid saved profiles", () => {
  assert.equal(profileQualifiedModelId("Work", "grok-4"), "work::grok-4");
  assert.equal(profileQualifiedModelId("default", "grok-4"), "default::grok-4");
  assert.equal(profileFromConfiguration(undefined), "default");
  assert.throws(
    () => profileFromConfiguration({ profile: "work profile" }),
    /Update this provider entry in Manage Language Models/,
  );
});

test("restores only a valid persisted management profile", () => {
  assert.equal(activeProfileFromState("Work"), "work");
  assert.equal(activeProfileFromState("work profile"), "default");
  assert.equal(activeProfileFromState(undefined), "default");
});
