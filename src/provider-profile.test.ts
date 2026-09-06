import assert from "node:assert/strict";
import test from "node:test";
import { activeProfileFromState, profileFromConfiguration, profileQualifiedModelId } from "./provider-profile";

test("normalizes native provider-entry profiles", () => {
  assert.equal(profileFromConfiguration({ profile: "  Work-Personal  " }), "work-personal");
  assert.equal(profileFromConfiguration({ profile: 42 }), "default");
  assert.equal(profileFromConfiguration({}), "default");
  assert.equal(profileFromConfiguration(undefined), "default");
});

test("wraps malformed provider-entry profiles with guidance", () => {
  assert.throws(
    () => profileFromConfiguration({ profile: "has space" }),
    /Invalid xAI Grok profile\. Update this provider entry in Manage Language Models\./,
  );
  assert.throws(() => profileFromConfiguration({ profile: "-leading" }), /Invalid xAI Grok profile/);
});

test("keeps default and named-profile model IDs distinct", () => {
  assert.equal(profileQualifiedModelId("default", "grok-4.6"), "grok-4.6");
  assert.equal(profileQualifiedModelId("  Personal  ", "grok-4.6"), "personal::grok-4.6");
  assert.equal(profileQualifiedModelId("team", "grok-4.6"), "team::grok-4.6");
});

test("restores the active profile defensively from persisted state", () => {
  assert.equal(activeProfileFromState("  Work  "), "work");
  assert.equal(activeProfileFromState("not a valid profile"), "default");
  assert.equal(activeProfileFromState(42), "default");
  assert.equal(activeProfileFromState(undefined), "default");
});
