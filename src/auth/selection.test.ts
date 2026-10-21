import assert from "node:assert/strict";
import test from "node:test";
import { signInSelection } from "./selection";

test("selects the account after a sign-in the user asked for by name", () => {
  assert.equal(signInSelection(false, true), "select");
  assert.equal(signInSelection(true, true), "select");
});

test("keeps the active account when a bound workspace triggers the sign-in", () => {
  // The account came from the repository, so the user's own choice stands.
  assert.equal(signInSelection(true, false), "keep");
});

test("selects the account after a sign-in in an unbound workspace", () => {
  assert.equal(signInSelection(false, false), "select");
});
