import assert from "node:assert/strict";
import test from "node:test";
import { classifyProfileMap, resolveProfileBinding } from "./workspace-profile";

test("keeps the entry profile when no binding is configured", () => {
  const resolution = resolveProfileBinding("work", [{}], { trusted: true });
  assert.equal(resolution.profile, "work");
  assert.equal(resolution.source, "entry");
  assert.equal(resolution.bound, false);
});

test("binds the default entry to a folder-scoped profile", () => {
  const resolution = resolveProfileBinding("default", [{ folder: "work" }], { trusted: true });
  assert.equal(resolution.profile, "work");
  assert.equal(resolution.source, "folder");
  assert.equal(resolution.bound, true);
});

test("binds the default entry to a workspace-scoped profile", () => {
  const resolution = resolveProfileBinding("default", [{ workspace: "personal" }], { trusted: true });
  assert.equal(resolution.profile, "personal");
  assert.equal(resolution.source, "workspace");
});

test("binds the default entry to a user-scoped profile", () => {
  const resolution = resolveProfileBinding("default", [{ user: "personal" }], { trusted: true });
  assert.equal(resolution.profile, "personal");
  assert.equal(resolution.source, "user");
});

test("prefers a folder binding over a workspace binding", () => {
  const resolution = resolveProfileBinding("default", [{ folder: "work", workspace: "personal" }], { trusted: true });
  assert.equal(resolution.profile, "work");
  assert.equal(resolution.source, "folder");
});

test("prefers a workspace binding over a user binding", () => {
  const resolution = resolveProfileBinding("default", [{ workspace: "team", user: "personal" }], { trusted: true });
  assert.equal(resolution.profile, "team");
  assert.equal(resolution.source, "workspace");
});

test("does not repoint an explicitly named entry with the shorthand binding", () => {
  const resolution = resolveProfileBinding("work", [{ folder: "personal" }], { trusted: true });
  assert.equal(resolution.profile, "work");
  assert.equal(resolution.source, "entry");
  assert.equal(resolution.bound, false);
});

test("repoints an explicitly named entry with a per-entry mapping", () => {
  const resolution = resolveProfileBinding("work", [{ folderMap: { work: "personal" } }], { trusted: true });
  assert.equal(resolution.profile, "personal");
  assert.equal(resolution.source, "folder");
  assert.equal(resolution.bound, true);
});

test("prefers a per-entry mapping over the shorthand binding", () => {
  const resolution = resolveProfileBinding(
    "work",
    [{ folderMap: { work: "personal" }, folder: "team" }],
    { trusted: true },
  );
  assert.equal(resolution.profile, "personal");
  assert.equal(resolution.source, "folder");
});

test("leaves an entry alone when the mapping names a different entry", () => {
  const resolution = resolveProfileBinding("work", [{ folderMap: { other: "personal" } }], { trusted: true });
  assert.equal(resolution.profile, "work");
  assert.equal(resolution.source, "entry");
});

test("ignores workspace and folder bindings in an untrusted workspace", () => {
  const resolution = resolveProfileBinding(
    "default",
    [{ folder: "work", workspace: "team", folderMap: { default: "personal" } }],
    { trusted: false },
  );
  assert.equal(resolution.profile, "default");
  assert.equal(resolution.source, "entry");
});

test("still honours a user binding in an untrusted workspace", () => {
  const resolution = resolveProfileBinding("default", [{ user: "personal" }], { trusted: false });
  assert.equal(resolution.profile, "personal");
  assert.equal(resolution.source, "user");
});

test("reports an invalid binding and falls back to the entry profile", () => {
  const resolution = resolveProfileBinding("default", [{ folder: "has space" }], { trusted: true });
  assert.equal(resolution.profile, "default");
  assert.deepEqual(resolution.invalid, ["folder"]);
});

test("skips an invalid binding and uses the next valid scope", () => {
  const resolution = resolveProfileBinding("default", [{ folder: "-bad", workspace: "team" }], { trusted: true });
  assert.equal(resolution.profile, "team");
  assert.equal(resolution.source, "workspace");
  assert.deepEqual(resolution.invalid, ["folder"]);
});

test("treats a blank binding as unset", () => {
  const resolution = resolveProfileBinding("default", [{ folder: "   " }], { trusted: true });
  assert.equal(resolution.profile, "default");
  assert.equal(resolution.source, "entry");
});

test("normalizes a bound profile", () => {
  const resolution = resolveProfileBinding("default", [{ folder: "  Work-Personal  " }], { trusted: true });
  assert.equal(resolution.profile, "work-personal");
});

test("falls back to the default profile for a malformed entry profile", () => {
  const resolution = resolveProfileBinding("has space", [{}], { trusted: true });
  assert.equal(resolution.profile, "default");
});

test("uses the first folder that defines a binding", () => {
  const resolution = resolveProfileBinding(
    "default",
    [{ folder: undefined }, { folder: "second" }],
    { trusted: true },
  );
  assert.equal(resolution.profile, "second");
  assert.equal(resolution.source, "folder");
});

test("validates per-entry mapping keys and values", () => {
  const { overrides, invalid } = classifyProfileMap({ Work: "personal", "bad key": "x", "other": "has space" });
  assert.deepEqual(overrides, { work: "personal" });
  assert.equal(invalid, true);
});

test("ignores a malformed per-entry mapping", () => {
  const { overrides, invalid } = classifyProfileMap("not a map");
  assert.deepEqual(overrides, {});
  assert.equal(invalid, false);
});

test("keeps the workspace binding stable when a named entry resolves too", () => {
  // The workspace binding is derived from the default entry, so resolving a
  // named entry afterwards must not change it.
  const scopes = [{ folder: "work", folderMap: { personal: "default" } }];
  const workspace = resolveProfileBinding("default", scopes, { trusted: true });
  assert.equal(workspace.profile, "work");
  const named = resolveProfileBinding("personal", scopes, { trusted: true });
  assert.equal(named.profile, "default");
  assert.equal(named.source, "folder");
  // The default entry still resolves to the same workspace binding.
  assert.equal(resolveProfileBinding("default", scopes, { trusted: true }).profile, "work");
});
