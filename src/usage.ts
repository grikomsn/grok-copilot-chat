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

export interface GrokUsageSnapshot {
  requests?: LimitBucket;
  tokens?: LimitBucket;
  lastRequest?: ApiRequestUsage;
  tracked?: TrackedApiUsage;
  apiError?: string;
  updatedAt?: number;
}

export interface HeaderReader {
  get(name: string): string | null;
}

export interface UsageDisplayRow {
  kind: "spend" | "request" | "requests" | "tokens" | "warning" | "empty";
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

export function mergeUsageSnapshot(
  current: GrokUsageSnapshot,
  update: GrokUsageSnapshot,
): GrokUsageSnapshot {
  return compactObject({
    ...current,
    ...update,
    requests: mergeBucket(current.requests, update.requests),
    tokens: mergeBucket(current.tokens, update.tokens),
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
  const bucket = snapshot.requests ?? snapshot.tokens;
  if (!bucket || (bucket.remaining === undefined && bucket.limit === undefined)) {
    if (snapshot.apiError) return "$(warning) Grok API unavailable";
    return "$(pulse) Grok API";
  }
  const suffix = bucket === snapshot.requests ? " req" : bucket === snapshot.tokens ? " tok" : "";
  return `$(pulse) Grok ${compactCount(bucket.remaining)}/${compactCount(bucket.limit)}${suffix}`;
}

export function formatUsageTooltip(snapshot: GrokUsageSnapshot, now = Date.now()): string {
  const lines = ["Grok API activity"];
  if (snapshot.tracked) lines.push(`Tracked billed spend: ${formatUsdTicks(snapshot.tracked.costUsdTicks)} across ${snapshot.tracked.requests.toLocaleString()} requests`);
  if (snapshot.lastRequest) lines.push(`Last request: ${formatRequestUsage(snapshot.lastRequest)}`);
  if (snapshot.requests) lines.push(formatBucketLine("Request rate capacity", snapshot.requests, now));
  if (snapshot.tokens) lines.push(formatBucketLine("Token rate capacity", snapshot.tokens, now));
  if (!hasUsageLimits(snapshot)) lines.push("No live limits observed yet");
  if (snapshot.apiError) lines.push("xAI API limits unavailable");
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
  if (snapshot.apiError) {
    rows.push({
      kind: "warning",
      label: "xAI API limits unavailable",
      description: "Check API credits or subscription",
      detail: snapshot.apiError,
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

function mergeBucket<T extends LimitBucket>(current: T | undefined, update: T | undefined): T | undefined {
  if (!current) return update;
  if (!update) return current;
  return { ...current, ...update };
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
