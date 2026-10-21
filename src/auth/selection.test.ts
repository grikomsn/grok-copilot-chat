import assert from "node:assert/strict";
import test from "node:test";
import { signInSelection } from "./selection";

test("selects the account after a sign-in the user asked for by name", () => {
  assert.equal(signInSelection(true), "select");
});

test("keeps the active account after a sign-in the workspace selected", () => {
  // The account came from the repository, so the user's own choice stands.
  assert.equal(signInSelection(false), "keep");
});
