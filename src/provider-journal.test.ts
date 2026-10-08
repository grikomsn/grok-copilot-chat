import assert from "node:assert/strict";
import test from "node:test";
import { observeProfile, readProfileJournal, reconcileProfiles } from "./provider-journal";
import type { MetadataCache } from "./models/metadata";

test("serializes observations without storing account details or credentials", async () => {
  const values = new Map<string, unknown>();
  const state: MetadataCache = { get: <T>(key: string) => values.get(key) as T | undefined,
    async update(key, value) { await new Promise((resolve) => setImmediate(resolve)); values.set(key, value); } };
  await Promise.all([observeProfile(state, "work", 2), observeProfile(state, "personal", 3)]);
  const journal = readProfileJournal(state);
  assert.deepEqual(Object.keys(journal).sort(), ["personal", "work"]);
  assert.deepEqual(Object.keys(journal.work).sort(), ["modelCount", "updatedAt"]);
  assert.deepEqual(reconcileProfiles(journal, ["work", "new"]), {
    entriesWithoutSessions: ["personal"], accountsWithoutObservedEntries: ["new"],
  });
});

test("recovers observation writes after a failure and filters corrupt stored fields", async () => {
  const values = new Map<string, unknown>();
  let fail = true;
  const state: MetadataCache = { get: <T>(key: string) => values.get(key) as T | undefined,
    async update(key, value) { if (fail) { fail = false; throw new Error("synthetic storage failure"); } values.set(key, value); } };
  await assert.rejects(observeProfile(state, "work", 2), /storage failure/);
  await observeProfile(state, "personal", 3);
  assert.deepEqual(Object.keys(readProfileJournal(state)), ["personal"]);
  const key = [...values.keys()][0];
  values.set(key, { work: { modelCount: 2, updatedAt: 100, email: "synthetic@example.invalid" }, broken: { modelCount: -1, updatedAt: 100 }, "invalid profile": { modelCount: 1, updatedAt: 100 } });
  assert.deepEqual(readProfileJournal(state), { work: { modelCount: 2, updatedAt: 100 } });
  await observeProfile(state, "personal", 3);
  assert.equal(JSON.stringify(values.get(key)).includes("email"), false);
});
