export interface LimitBucket {
  limit?: number;
  remaining?: number;
  resetsAt?: number;
}

export interface ApiRequestUsage {
  modelId: string;
  recordedAt: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cachedTokens?: number;
  reasoningTokens?: number;
  costUsdTicks?: number;
}

export interface TrackedApiUsage {
  requests: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedTokens: number;
  reasoningTokens: number;
  costUsdTicks: number;
}

export interface GrokSubscriptionUsage {
  usagePercent?: number;
  periodType?: string;
  periodStart?: string;
  periodEnd?: string;
  prepaidBalanceCents?: number;
  onDemandCapCents?: number;
  onDemandUsedCents?: number;
  onDemandEnabled?: boolean;
  isUnifiedBillingUser?: boolean;
  subscriptionTier?: string;
}

export interface GrokAutoTopUpStatus {
  enabled: boolean;
  minBeforeHittingSlCents?: number;
  topupAmountCents?: number;
  maxAmountPerMonthCents?: number;
}

export interface GrokUsageSnapshot {
  requests?: LimitBucket;
  tokens?: LimitBucket;
  lastRequest?: ApiRequestUsage;
  tracked?: TrackedApiUsage;
  subscription?: GrokSubscriptionUsage;
  autoTopUp?: GrokAutoTopUpStatus;
  apiError?: string;
  subscriptionError?: string;
  updatedAt?: number;
}

export interface HeaderReader {
  get(name: string): string | null;
}

export interface UsageDisplayRow {
  kind: "spend" | "request" | "requests" | "tokens" | "subscription" | "credits" | "autotopup" | "warning" | "empty";
  label: string;
  description: string;
  detail?: string;
}

export interface ProviderUsagePayload {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_tokens_details?: { cached_tokens: number };
  completion_tokens_details?: { reasoning_tokens: number };
  copilotCredits?: number;
}

export function parseApiRateLimitHeaders(
  headers: HeaderReader,
  now = Date.now(),
): Pick<GrokUsageSnapshot, "requests" | "tokens"> {
  const requests = parseHeaderBucket(headers, "requests", now)
    ?? parseHeaderBucket(headers, undefined, now);
  const tokens = parseHeaderBucket(headers, "tokens", now);
  return compactObject({ requests, tokens });
}

export function parseSubscriptionUsagePayload(raw: unknown): GrokSubscriptionUsage | undefined {
  const root = isRecord(raw) ? raw : undefined;
  if (!root) return undefined;
  const rawConfig = valueOf(root, "config", "billingConfig");
  const config = isRecord(rawConfig) ? rawConfig : root;
  const periodValue = valueOf(config, "currentPeriod", "current_period");
  const period = isRecord(periodValue) ? periodValue : {};
  const rawUsagePercent = valueOf(config, "creditUsagePercent", "credit_usage_percent");
  const usagePercentIsPresent = hasOwn(config, "creditUsagePercent", "credit_usage_percent");
  const monthlyLimit = readCents(valueOf(config, "monthlyLimit", "monthly_limit"));
  const used = readCents(valueOf(config, "used"));
  const usagePercent = usagePercentIsPresent
    ? readPercent(rawUsagePercent)
    : isRecord(periodValue)
      ? 0
      : (monthlyLimit && monthlyLimit > 0 && used !== undefined
        ? Math.min(100, Math.max(0, (used / monthlyLimit) * 100))
        : undefined);
  const result = compactObject({
    usagePercent,
    periodType: readText(valueOf(period, "type", "periodType", "period_type")),
    periodStart: readText(valueOf(period, "start") ?? valueOf(config, "billingPeriodStart", "billing_period_start")),
    periodEnd: readText(valueOf(period, "end") ?? valueOf(config, "billingPeriodEnd", "billing_period_end")),
    prepaidBalanceCents: readCents(valueOf(config, "prepaidBalance", "prepaid_balance")),
    onDemandCapCents: readCents(valueOf(config, "onDemandCap", "on_demand_cap")),
    onDemandUsedCents: readCents(valueOf(config, "onDemandUsed", "on_demand_used")),
    onDemandEnabled: readBoolean(valueOf(root, "onDemandEnabled", "on_demand_enabled")),
    isUnifiedBillingUser: readBoolean(valueOf(config, "isUnifiedBillingUser", "is_unified_billing_user")),
    subscriptionTier: readText(valueOf(root, "subscriptionTier", "subscription_tier")),
  });
  return Object.keys(result).length ? result : undefined;
}

export function parseAutoTopUpPayload(raw: unknown): GrokAutoTopUpStatus | undefined {
  const root = isRecord(raw) ? raw : undefined;
  if (!root) return undefined;
  const rawRule = valueOf(root, "rule");
  const rule = isRecord(rawRule) ? rawRule : root;
  const hasRule = rawRule !== undefined
    || ["enabled", "minBeforeHittingSl", "min_before_hitting_sl", "topupAmount", "topup_amount", "maxAmountPerMonth", "max_amount_per_month"]
      .some((key) => Object.prototype.hasOwnProperty.call(rule, key));
  if (!hasRule) return undefined;
  return compactObject({
    enabled: readBoolean(valueOf(rule, "enabled")) ?? false,
    minBeforeHittingSlCents: readCents(valueOf(rule, "minBeforeHittingSl", "min_before_hitting_sl")),
    topupAmountCents: readCents(valueOf(rule, "topupAmount", "topup_amount")),
    maxAmountPerMonthCents: readCents(valueOf(rule, "maxAmountPerMonth", "max_amount_per_month")),
  });
}

export function mergeUsageSnapshot(
  current: GrokUsageSnapshot,
  update: GrokUsageSnapshot,
): GrokUsageSnapshot {
  return compactObject({
    ...current,
    ...update,
    requests: mergeBucket(current.requests, update.requests),
    tokens: mergeBucket(current.tokens, update.tokens),
    subscription: mergeObject(current.subscription, update.subscription),
    autoTopUp: mergeObject(current.autoTopUp, update.autoTopUp),
  });
}

export function recordApiRequestUsage(
  current: GrokUsageSnapshot,
  raw: Record<string, unknown>,
  modelId: string,
  recordedAt = Date.now(),
): GrokUsageSnapshot {
  const usage = normalizeApiUsage(raw);
  const lastRequest: ApiRequestUsage = { modelId, recordedAt, ...usage };
  const previous = current.tracked;
  const tracked: TrackedApiUsage = {
    requests: (previous?.requests ?? 0) + 1,
    promptTokens: (previous?.promptTokens ?? 0) + (usage.promptTokens ?? 0),
    completionTokens: (previous?.completionTokens ?? 0) + (usage.completionTokens ?? 0),
    totalTokens: (previous?.totalTokens ?? 0) + (usage.totalTokens ?? 0),
    cachedTokens: (previous?.cachedTokens ?? 0) + (usage.cachedTokens ?? 0),
    reasoningTokens: (previous?.reasoningTokens ?? 0) + (usage.reasoningTokens ?? 0),
    costUsdTicks: (previous?.costUsdTicks ?? 0) + (usage.costUsdTicks ?? 0),
  };
  return mergeUsageSnapshot(current, { lastRequest, tracked, updatedAt: recordedAt });
}

export function toProviderUsagePayload(raw: Record<string, unknown>): ProviderUsagePayload {
  const usage = normalizeApiUsage(raw);
  return {
    ...(usage.promptTokens === undefined ? {} : { prompt_tokens: usage.promptTokens }),
    ...(usage.completionTokens === undefined ? {} : { completion_tokens: usage.completionTokens }),
    ...(usage.totalTokens === undefined ? {} : { total_tokens: usage.totalTokens }),
    ...(usage.cachedTokens === undefined ? {} : { prompt_tokens_details: { cached_tokens: usage.cachedTokens } }),
    ...(usage.reasoningTokens === undefined ? {} : { completion_tokens_details: { reasoning_tokens: usage.reasoningTokens } }),
    ...(usage.costUsdTicks === undefined ? {} : { copilotCredits: usage.costUsdTicks / 100_000_000 }),
  };
}

export function hasUsageLimits(snapshot: GrokUsageSnapshot): boolean {
  return [snapshot.requests, snapshot.tokens]
    .some((bucket) => bucket && (bucket.limit !== undefined || bucket.remaining !== undefined));
}

export function formatUsageStatusBar(snapshot: GrokUsageSnapshot): string {
  if (snapshot.tracked?.requests) {
    return `$(graph) Grok ${formatUsdTicks(snapshot.tracked.costUsdTicks)}`;
  }
  if (snapshot.subscription?.usagePercent !== undefined) {
    return `$(pulse) Grok ${formatPercent(snapshot.subscription.usagePercent)} weekly`;
  }
  const bucket = snapshot.requests ?? snapshot.tokens;
  if (!bucket || (bucket.remaining === undefined && bucket.limit === undefined)) {
    if (snapshot.apiError) return "$(warning) Grok API unavailable";
    return "$(pulse) Grok API";
  }
  const suffix = bucket === snapshot.requests ? " req" : bucket === snapshot.tokens ? " tok" : "";
  return `$(pulse) Grok ${compactCount(bucket.remaining)}/${compactCount(bucket.limit)}${suffix}`;
}

export function formatUsageTooltip(snapshot: GrokUsageSnapshot, now = Date.now()): string {
  const lines = ["Grok usage and API activity"];
  if (snapshot.tracked) lines.push(`Tracked billed spend: ${formatUsdTicks(snapshot.tracked.costUsdTicks)} across ${snapshot.tracked.requests.toLocaleString()} requests`);
  if (snapshot.lastRequest) lines.push(`Last request: ${formatRequestUsage(snapshot.lastRequest)}`);
  if (snapshot.requests) lines.push(formatBucketLine("Request rate capacity", snapshot.requests, now));
  if (snapshot.tokens) lines.push(formatBucketLine("Token rate capacity", snapshot.tokens, now));
  if (snapshot.subscription) lines.push(formatSubscriptionLine(snapshot.subscription));
  if (snapshot.autoTopUp) lines.push(`Auto top-up: ${snapshot.autoTopUp.enabled ? "enabled" : "disabled"}`);
  if (!hasUsageLimits(snapshot) && !snapshot.subscription) lines.push("No live limits observed yet");
  if (snapshot.apiError) lines.push("xAI API limits unavailable");
  if (snapshot.subscriptionError) lines.push("Grok subscription usage unavailable");
  if (snapshot.updatedAt) lines.push(`Updated ${new Date(snapshot.updatedAt).toLocaleString()}`);
  lines.push("Click for details");
  return lines.join("\n");
}

export function formatUsageRows(snapshot: GrokUsageSnapshot, now = Date.now()): UsageDisplayRow[] {
  const rows: UsageDisplayRow[] = [];
  if (snapshot.tracked) {
    rows.push({
      kind: "spend",
      label: "Tracked billed spend",
      description: `${formatUsdTicks(snapshot.tracked.costUsdTicks)} across ${snapshot.tracked.requests.toLocaleString()} requests`,
      detail: `${snapshot.tracked.promptTokens.toLocaleString()} input · ${snapshot.tracked.completionTokens.toLocaleString()} output · exact xAI per-request costs accumulated on this device`,
    });
  }
  if (snapshot.lastRequest) {
    rows.push({
      kind: "request",
      label: "Last API request",
      description: formatRequestUsage(snapshot.lastRequest),
      detail: `${snapshot.lastRequest.modelId} · ${new Date(snapshot.lastRequest.recordedAt).toLocaleString()}`,
    });
  }
  if (snapshot.requests) rows.push(bucketRow("requests", "Request rate capacity", snapshot.requests, now));
  if (snapshot.tokens) rows.push(bucketRow("tokens", "Token rate capacity (TPM)", snapshot.tokens, now));
  if (snapshot.subscription) rows.push(subscriptionRow(snapshot.subscription));
  if (snapshot.subscription?.prepaidBalanceCents !== undefined) rows.push(creditsRow(snapshot.subscription));
  if (snapshot.autoTopUp) rows.push(autoTopUpRow(snapshot.autoTopUp));
  if (snapshot.apiError) {
    rows.push({
      kind: "warning",
      label: "xAI API limits unavailable",
      description: "Check API credits or subscription",
      detail: snapshot.apiError,
    });
  }
  if (snapshot.subscriptionError) {
    rows.push({
      kind: "warning",
      label: "Grok subscription usage unavailable",
      description: "Open Grok Usage in a browser",
      detail: snapshot.subscriptionError,
    });
  }
  if (!rows.length) {
    rows.push({
      kind: "empty",
      label: "No live limits observed yet",
      description: "Send a Grok request, then refresh",
    });
  }
  return rows;
}

function parseHeaderBucket(headers: HeaderReader, kind: "requests" | "tokens" | undefined, now: number): LimitBucket | undefined {
  const suffix = kind ? `-${kind}` : "";
  const bucket = compactObject({
    limit: headerNumber(headers, `x-ratelimit-limit${suffix}`),
    remaining: headerNumber(headers, `x-ratelimit-remaining${suffix}`),
    resetsAt: parseReset(headers.get(`x-ratelimit-reset${suffix}`), now),
  });
  return Object.keys(bucket).length ? bucket : undefined;
}

function parseReset(value: string | null, now: number): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
    const numeric = Number(trimmed);
    if (!Number.isFinite(numeric)) return undefined;
    if (numeric > 10_000_000_000) return numeric;
    if (numeric > 1_000_000_000) return numeric * 1000;
    return now + numeric * 1000;
  }
  const duration = parseDuration(trimmed);
  if (duration !== undefined) return now + duration;
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseDuration(value: string): number | undefined {
  const pattern = /(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)/gi;
  let total = 0;
  let consumed = "";
  for (const match of value.matchAll(pattern)) {
    const amount = Number(match[1]);
    const unit = match[2].toLowerCase();
    total += amount * ({ ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit] ?? 0);
    consumed += match[0];
  }
  return consumed.replace(/\s/g, "") === value.replace(/\s/g, "") && total > 0 ? total : undefined;
}

function headerNumber(headers: HeaderReader, name: string): number | undefined {
  return finiteNumber(headers.get(name));
}

function finiteNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function readCents(value: unknown): number | undefined {
  const record = isRecord(value) ? value : undefined;
  const parsed = finiteNumber(record ? valueOf(record, "val", "value", "cents") : value);
  return parsed === undefined ? undefined : Math.abs(parsed);
}

function readPercent(value: unknown): number | undefined {
  const parsed = finiteNumber(value);
  return parsed === undefined ? undefined : Math.min(100, parsed);
}

function readText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function mergeBucket<T extends LimitBucket>(current: T | undefined, update: T | undefined): T | undefined {
  if (!current) return update;
  if (!update) return current;
  return { ...current, ...update };
}

function mergeObject<T extends object>(current: T | undefined, update: T | undefined): T | undefined {
  if (!current) return update;
  if (!update) return current;
  return { ...current, ...update } as T;
}

function formatBucketLine(label: string, bucket: LimitBucket, now: number): string {
  return `${label}: ${bucketSummary(bucket, now)}`;
}

function bucketRow(
  kind: "requests" | "tokens",
  label: string,
  bucket: LimitBucket,
  now: number,
): UsageDisplayRow {
  return {
    kind,
    label,
    description: bucketSummary(bucket, now),
    detail: kind === "requests"
      ? "Transient API throughput capacity from xAI response headers; not account credits or cumulative usage"
      : "Transient tokens-per-minute capacity from xAI response headers; not account credits or cumulative usage",
  };
}

function subscriptionRow(subscription: GrokSubscriptionUsage): UsageDisplayRow {
  const period = periodLabel(subscription.periodType);
  return {
    kind: "subscription",
    label: `${period} Grok usage`,
    description: subscription.usagePercent === undefined
      ? "Usage data available"
      : `${formatPercent(subscription.usagePercent)} used`,
    detail: subscription.periodEnd
      ? `Resets ${formatDate(subscription.periodEnd)}${subscription.subscriptionTier ? ` · ${subscription.subscriptionTier}` : ""}`
      : subscription.subscriptionTier,
  };
}

function creditsRow(subscription: GrokSubscriptionUsage): UsageDisplayRow {
  return {
    kind: "credits",
    label: "Extra Usage Credits",
    description: formatUsdCents(subscription.prepaidBalanceCents!),
    detail: "Used after the included Grok usage pool is exhausted; manage credits in Grok Usage",
  };
}

function autoTopUpRow(autoTopUp: GrokAutoTopUpStatus): UsageDisplayRow {
  const amounts = [
    autoTopUp.topupAmountCents === undefined ? undefined : `buys ${formatUsdCents(autoTopUp.topupAmountCents)}`,
    autoTopUp.maxAmountPerMonthCents === undefined ? undefined : `monthly cap ${formatUsdCents(autoTopUp.maxAmountPerMonthCents)}`,
  ].filter((value): value is string => Boolean(value));
  return {
    kind: "autotopup",
    label: "Auto top-up",
    description: autoTopUp.enabled ? "Enabled" : "Disabled",
    detail: amounts.join(" · ") || "Manage auto top-up in Grok Usage",
  };
}

function formatSubscriptionLine(subscription: GrokSubscriptionUsage): string {
  const usage = subscription.usagePercent === undefined ? "usage available" : `${formatPercent(subscription.usagePercent)} used`;
  const reset = subscription.periodEnd ? `; resets ${formatDate(subscription.periodEnd)}` : "";
  return `${periodLabel(subscription.periodType)} Grok usage: ${usage}${reset}`;
}

function periodLabel(value: string | undefined): string {
  const normalized = value?.toLowerCase() ?? "";
  if (normalized.includes("monthly")) return "Monthly";
  if (normalized.includes("weekly")) return "Weekly";
  return "Subscription";
}

function formatPercent(value: number): string {
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;
}

function formatUsdCents(cents: number): string {
  return `$${(Math.abs(cents) / 100).toFixed(2)}`;
}

function formatDate(value: string): string {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleString() : value;
}

function normalizeApiUsage(raw: Record<string, unknown>): Omit<ApiRequestUsage, "modelId" | "recordedAt"> {
  const promptDetails = isRecord(raw.prompt_tokens_details) ? raw.prompt_tokens_details : {};
  const completionDetails = isRecord(raw.completion_tokens_details) ? raw.completion_tokens_details : {};
  const promptTokens = finiteNumber(raw.prompt_tokens ?? raw.input_tokens);
  const completionTokens = finiteNumber(raw.completion_tokens ?? raw.output_tokens);
  return compactObject({
    promptTokens,
    completionTokens,
    totalTokens: finiteNumber(raw.total_tokens) ?? (
      promptTokens !== undefined && completionTokens !== undefined ? promptTokens + completionTokens : undefined
    ),
    cachedTokens: finiteNumber(promptDetails.cached_tokens),
    reasoningTokens: finiteNumber(completionDetails.reasoning_tokens),
    costUsdTicks: finiteNumber(raw.cost_in_usd_ticks),
  });
}

function formatRequestUsage(usage: ApiRequestUsage): string {
  const tokens = `${exactCount(usage.promptTokens)} in + ${exactCount(usage.completionTokens)} out`;
  return usage.costUsdTicks === undefined ? tokens : `${formatUsdTicks(usage.costUsdTicks)} · ${tokens}`;
}

function formatUsdTicks(ticks: number): string {
  const usd = ticks / 10_000_000_000;
  if (usd > 0 && usd < 0.000001) return "<$0.000001";
  return `$${usd.toFixed(6)}`;
}

function bucketSummary(bucket: LimitBucket, now: number): string {
  const remaining = exactCount(bucket.remaining);
  const limit = exactCount(bucket.limit);
  return `${remaining} of ${limit} remaining${bucket.resetsAt ? `; resets ${formatResetTime(bucket.resetsAt, now)}` : ""}`;
}

function exactCount(value: number | undefined): string {
  return value === undefined ? "?" : value.toLocaleString();
}

function formatResetTime(resetsAt: number, now: number): string {
  if (resetsAt <= now) return "now";
  return `${new Date(resetsAt).toLocaleString()} (${formatDuration(resetsAt - now)})`;
}

function formatDuration(milliseconds: number): string {
  const minutes = Math.max(1, Math.ceil(milliseconds / 60_000));
  if (minutes < 60) return `in ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `in ${hours}h${remainder ? ` ${remainder}m` : ""}`;
}

function compactCount(value: number | undefined): string {
  if (value === undefined) return "?";
  if (value >= 1_000_000) return `${trimDecimal(value / 1_000_000)}m`;
  if (value >= 10_000) return `${Math.round(value / 1000)}k`;
  if (value >= 1000) return `${trimDecimal(value / 1000)}k`;
  return String(value);
}

function trimDecimal(value: number): string {
  return value.toFixed(1).replace(/\.0$/, "");
}

function compactObject<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

function valueOf(record: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) return record[key];
  }
  return undefined;
}

function hasOwn(record: Record<string, unknown>, ...keys: string[]): boolean {
  return keys.some((key) => Object.prototype.hasOwnProperty.call(record, key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
