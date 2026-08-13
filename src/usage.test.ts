import assert from "node:assert/strict";
import test from "node:test";
import {
  formatUsageRows,
  formatUsageStatusBar,
  formatUsageTooltip,
  mergeUsageSnapshot,
  parseAutoTopUpPayload,
  parseApiRateLimitHeaders,
  parseSubscriptionUsagePayload,
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

test("parses unified weekly subscription usage and prepaid credits", () => {
  assert.deepEqual(parseSubscriptionUsagePayload({
    config: {
      creditUsagePercent: 42.5,
      currentPeriod: {
        type: "USAGE_PERIOD_TYPE_WEEKLY",
        start: "2026-08-13T00:00:00Z",
        end: "2026-08-20T00:00:00Z",
      },
      prepaidBalance: { val: 1250 },
      onDemandCap: { val: 5000 },
      onDemandUsed: { val: 300 },
      isUnifiedBillingUser: true,
    },
    onDemandEnabled: true,
    subscriptionTier: "SuperGrok",
  }), {
    usagePercent: 42.5,
    periodType: "USAGE_PERIOD_TYPE_WEEKLY",
    periodStart: "2026-08-13T00:00:00Z",
    periodEnd: "2026-08-20T00:00:00Z",
    prepaidBalanceCents: 1250,
    onDemandCapCents: 5000,
    onDemandUsedCents: 300,
    onDemandEnabled: true,
    isUnifiedBillingUser: true,
    subscriptionTier: "SuperGrok",
  });
});

test("falls back to legacy billing fields and rejects malformed subscription data", () => {
  assert.deepEqual(parseSubscriptionUsagePayload({
    config: {
      monthlyLimit: { val: 2000 },
      used: { val: 500 },
      billingPeriodEnd: "2026-09-01T00:00:00Z",
    },
  }), {
    usagePercent: 25,
    periodEnd: "2026-09-01T00:00:00Z",
  });
  assert.equal(parseSubscriptionUsagePayload({ config: {} }), undefined);
  assert.equal(parseSubscriptionUsagePayload("not an object"), undefined);
});

test("parses auto top-up status and renders subscription usage rows", () => {
  assert.deepEqual(parseAutoTopUpPayload({
    rule: {
      enabled: true,
      minBeforeHittingSl: { val: 250 },
      topupAmount: { val: 1000 },
      maxAmountPerMonth: { val: 5000 },
    },
  }), {
    enabled: true,
    minBeforeHittingSlCents: 250,
    topupAmountCents: 1000,
    maxAmountPerMonthCents: 5000,
  });
  assert.equal(parseAutoTopUpPayload({}), undefined);

  const snapshot = mergeUsageSnapshot({}, {
    subscription: {
      usagePercent: 42.5,
      periodType: "USAGE_PERIOD_TYPE_WEEKLY",
      periodEnd: "2026-08-20T00:00:00Z",
      prepaidBalanceCents: 1250,
      subscriptionTier: "SuperGrok",
    },
    autoTopUp: { enabled: true, topupAmountCents: 1000 },
  });
  const rows = formatUsageRows(snapshot, Date.parse("2026-08-13T00:00:00Z"));
  assert.deepEqual(rows.map((row) => row.kind), ["subscription", "credits", "autotopup"]);
  assert.equal(formatUsageStatusBar(snapshot), "$(pulse) Grok 42.5% weekly");
  assert.match(formatUsageTooltip(snapshot), /Weekly Grok usage: 42\.5% used/);
  assert.match(rows[1].description, /\$12\.50/);
  assert.match(rows[2].detail ?? "", /buys \$10\.00/);
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
