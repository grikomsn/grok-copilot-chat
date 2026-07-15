import assert from "node:assert/strict";
import test from "node:test";
import {
  formatUsageMarkdown,
  formatUsageStatusBar,
  mergeUsageSnapshot,
  parseApiRateLimitHeaders,
  parseGrokRateLimits,
} from "../usage";

test("parses Grok query windows", () => {
  assert.deepEqual(parseGrokRateLimits({
    windowSizeSeconds: 7200,
    remainingQueries: 70,
    totalQueries: 70,
    lowEffortRateLimits: { remainingQueries: 12, totalQueries: 20, windowSizeSeconds: 3600 },
    highEffortRateLimits: null,
  }), {
    query: { limit: 70, remaining: 70, windowSizeSeconds: 7200 },
    lowEffort: { limit: 20, remaining: 12, windowSizeSeconds: 3600 },
  });
});

test("parses xAI request and token rate-limit headers", () => {
  const values = new Map([
    ["x-ratelimit-limit-requests", "240"],
    ["x-ratelimit-remaining-requests", "239"],
    ["x-ratelimit-reset-requests", "1m30s"],
    ["x-ratelimit-limit-tokens", "2000000"],
    ["x-ratelimit-remaining-tokens", "1999000"],
    ["x-ratelimit-reset-tokens", "1735689600"],
  ]);
  const now = Date.UTC(2024, 11, 31, 23, 58, 0);
  assert.deepEqual(parseApiRateLimitHeaders({ get: (name) => values.get(name) ?? null }, now), {
    requests: { limit: 240, remaining: 239, resetsAt: now + 90_000 },
    tokens: { limit: 2_000_000, remaining: 1_999_000, resetsAt: 1_735_689_600_000 },
  });
});

test("supports generic rate-limit headers", () => {
  const values = new Map([
    ["x-ratelimit-limit", "60"],
    ["x-ratelimit-remaining", "45"],
    ["x-ratelimit-reset", "30"],
  ]);
  assert.deepEqual(parseApiRateLimitHeaders({ get: (name) => values.get(name) ?? null }, 1000), {
    requests: { limit: 60, remaining: 45, resetsAt: 31_000 },
  });
});

test("merges independent live sources and formats the status", () => {
  const snapshot = mergeUsageSnapshot(
    { requests: { limit: 240, remaining: 239 }, updatedAt: 1 },
    { query: { limit: 70, remaining: 69, windowSizeSeconds: 7200 }, modelName: "fast", updatedAt: 2 },
  );
  assert.deepEqual(snapshot, {
    requests: { limit: 240, remaining: 239 },
    query: { limit: 70, remaining: 69, windowSizeSeconds: 7200 },
    modelName: "fast",
    updatedAt: 2,
  });
  assert.equal(formatUsageStatusBar(snapshot), "$(pulse) Grok 69/70");
});

test("usage Markdown distinguishes live limits from account billing", () => {
  const markdown = formatUsageMarkdown({
    modelName: "fast",
    query: { limit: 70, remaining: 68, windowSizeSeconds: 7200 },
    requests: { limit: 240, remaining: 238 },
    updatedAt: Date.UTC(2026, 6, 15, 12),
  }, Date.UTC(2026, 6, 15, 12));
  assert.match(markdown, /68 of 70/);
  assert.match(markdown, /Requests: 238 of 240 remaining/);
  assert.match(markdown, /Open Grok Usage/);
  assert.match(markdown, /Extra Usage Credits/);
});

test("usage UI explains an account without API quota", () => {
  const snapshot = {
    apiError: "You have run out of credits or need a Grok subscription.",
    queryError: "The web query window requires a signed-in browser session.",
    updatedAt: Date.UTC(2026, 6, 15, 12),
  };
  assert.equal(formatUsageStatusBar(snapshot), "$(warning) Grok API unavailable");
  const markdown = formatUsageMarkdown(snapshot, snapshot.updatedAt);
  assert.match(markdown, /run out of credits/);
  assert.match(markdown, /signed-in browser session/);
  assert.match(markdown, /No numeric OAuth\/API limits/);
});
