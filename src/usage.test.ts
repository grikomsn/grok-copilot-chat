import assert from "node:assert/strict";
import test from "node:test";
import {
  formatUsageRows,
  formatUsageStatusBar,
  mergeUsageSnapshot,
  parseApiRateLimitHeaders,
  recordApiRequestUsage,
  toProviderUsagePayload,
} from "./usage";

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

test("merges request and token capacity and formats the status", () => {
  const snapshot = mergeUsageSnapshot(
    { requests: { limit: 240, remaining: 239 }, updatedAt: 1 },
    { tokens: { limit: 2_000_000, remaining: 1_999_000 }, updatedAt: 2 },
  );
  assert.deepEqual(snapshot, {
    requests: { limit: 240, remaining: 239 },
    tokens: { limit: 2_000_000, remaining: 1_999_000 },
    updatedAt: 2,
  });
  assert.equal(formatUsageStatusBar(snapshot), "$(pulse) Grok 239/240 req");
});

test("usage popup rows explain transient API rate capacity", () => {
  const rows = formatUsageRows({
    requests: { limit: 240, remaining: 238 },
    updatedAt: Date.UTC(2026, 6, 15, 12),
  }, Date.UTC(2026, 6, 15, 12));
  assert.deepEqual(rows, [
    {
      kind: "requests",
      label: "Request rate capacity",
      description: "238 of 240 remaining",
      detail: "Transient API throughput capacity from xAI response headers; not account credits or cumulative usage",
    },
  ]);
});

test("reports VS Code usage in OpenAI shape and accumulates exact xAI cost", () => {
  const raw = {
    prompt_tokens: 120,
    completion_tokens: 30,
    prompt_tokens_details: { cached_tokens: 20 },
    completion_tokens_details: { reasoning_tokens: 12 },
    cost_in_usd_ticks: 37_756_000,
  };
  assert.deepEqual(toProviderUsagePayload(raw), {
    prompt_tokens: 120,
    completion_tokens: 30,
    total_tokens: 150,
    prompt_tokens_details: { cached_tokens: 20 },
    completion_tokens_details: { reasoning_tokens: 12 },
    copilotCredits: 0.37756,
  });
  const first = recordApiRequestUsage({}, raw, "grok-4.5", 1000);
  const second = recordApiRequestUsage(first, raw, "grok-4.5", 2000);
  assert.deepEqual(second.tracked, {
    requests: 2,
    promptTokens: 240,
    completionTokens: 60,
    totalTokens: 300,
    cachedTokens: 40,
    reasoningTokens: 24,
    costUsdTicks: 75_512_000,
  });
  assert.equal(formatUsageStatusBar(second), "$(graph) Grok $0.007551");
  assert.match(formatUsageRows(second, 2000)[0].description, /\$0\.007551 across 2 requests/);
});

test("usage UI explains an account without API quota", () => {
  const snapshot = {
    apiError: "You have run out of API credits.",
    updatedAt: Date.UTC(2026, 6, 15, 12),
  };
  assert.equal(formatUsageStatusBar(snapshot), "$(warning) Grok API unavailable");
  const rows = formatUsageRows(snapshot, snapshot.updatedAt);
  assert.equal(rows.length, 1);
  assert.match(rows[0].detail ?? "", /run out of API credits/);
});
