export interface LimitBucket {
  limit?: number;
  remaining?: number;
  resetsAt?: number;
}

export interface QueryWindow extends LimitBucket {
  windowSizeSeconds?: number;
}

export interface GrokUsageSnapshot {
  modelName?: string;
  query?: QueryWindow;
  lowEffort?: QueryWindow;
  highEffort?: QueryWindow;
  requests?: LimitBucket;
  tokens?: LimitBucket;
  apiError?: string;
  queryError?: string;
  updatedAt?: number;
}

export interface HeaderReader {
  get(name: string): string | null;
}

export interface UsageDisplayRow {
  kind: "query" | "requests" | "tokens" | "warning" | "empty";
  label: string;
  description: string;
  detail?: string;
}

interface GrokRateLimitsBody {
  windowSizeSeconds?: unknown;
  remainingQueries?: unknown;
  totalQueries?: unknown;
  lowEffortRateLimits?: unknown;
  highEffortRateLimits?: unknown;
}

export function parseGrokRateLimits(value: unknown): Pick<GrokUsageSnapshot, "query" | "lowEffort" | "highEffort"> {
  if (!isRecord(value)) return {};
  const body = value as GrokRateLimitsBody;
  return compactObject({
    query: parseQueryWindow(body),
    lowEffort: parseQueryWindow(body.lowEffortRateLimits),
    highEffort: parseQueryWindow(body.highEffortRateLimits),
  });
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
    query: mergeBucket(current.query, update.query),
    lowEffort: mergeBucket(current.lowEffort, update.lowEffort),
    highEffort: mergeBucket(current.highEffort, update.highEffort),
    requests: mergeBucket(current.requests, update.requests),
    tokens: mergeBucket(current.tokens, update.tokens),
  });
}

export function hasUsageLimits(snapshot: GrokUsageSnapshot): boolean {
  return [snapshot.query, snapshot.lowEffort, snapshot.highEffort, snapshot.requests, snapshot.tokens]
    .some((bucket) => bucket && (bucket.limit !== undefined || bucket.remaining !== undefined));
}

export function formatUsageStatusBar(snapshot: GrokUsageSnapshot): string {
  const bucket = snapshot.query ?? snapshot.requests ?? snapshot.tokens;
  if (!bucket || (bucket.remaining === undefined && bucket.limit === undefined)) {
    if (snapshot.apiError) return "$(warning) Grok API unavailable";
    return "$(pulse) Grok usage";
  }
  const suffix = bucket === snapshot.requests ? " req" : bucket === snapshot.tokens ? " tok" : "";
  return `$(pulse) Grok ${compactCount(bucket.remaining)}/${compactCount(bucket.limit)}${suffix}`;
}

export function formatUsageTooltip(snapshot: GrokUsageSnapshot, now = Date.now()): string {
  const lines = ["Grok usage limits"];
  if (snapshot.query) lines.push(formatBucketLine("Query window", snapshot.query, now));
  if (snapshot.requests) lines.push(formatBucketLine("API requests", snapshot.requests, now));
  if (snapshot.tokens) lines.push(formatBucketLine("API tokens", snapshot.tokens, now));
  if (!hasUsageLimits(snapshot)) lines.push("No live limits observed yet");
  if (snapshot.apiError) lines.push("xAI API limits unavailable");
  if (snapshot.queryError) lines.push("Grok web query limit unavailable to OAuth");
  if (snapshot.updatedAt) lines.push(`Updated ${new Date(snapshot.updatedAt).toLocaleString()}`);
  lines.push("Click for details");
  return lines.join("\n");
}

export function formatUsageRows(snapshot: GrokUsageSnapshot, now = Date.now()): UsageDisplayRow[] {
  const rows: UsageDisplayRow[] = [];
  if (snapshot.requests) rows.push(bucketRow("requests", "API requests", snapshot.requests, now));
  if (snapshot.tokens) rows.push(bucketRow("tokens", "API tokens", snapshot.tokens, now));
  if (snapshot.query) {
    const details = [
      snapshot.query.windowSizeSeconds ? `Window: ${formatWindowDuration(snapshot.query.windowSizeSeconds * 1000)}` : undefined,
      snapshot.modelName ? `Model group: ${snapshot.modelName}` : undefined,
      snapshot.lowEffort ? `Low effort: ${bucketSummary(snapshot.lowEffort, now)}` : undefined,
      snapshot.highEffort ? `High effort: ${bucketSummary(snapshot.highEffort, now)}` : undefined,
    ].filter((value): value is string => Boolean(value));
    rows.push({
      kind: "query",
      label: "Grok query window",
      description: bucketSummary(snapshot.query, now),
      ...(details.length ? { detail: details.join(" · ") } : {}),
    });
  } else if (snapshot.queryError) {
    rows.push({
      kind: "warning",
      label: "Grok web query window",
      description: "Browser session required",
      detail: snapshot.queryError,
    });
  }
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

function parseQueryWindow(value: unknown): QueryWindow | undefined {
  if (!isRecord(value)) return undefined;
  const window = compactObject({
    limit: finiteNumber(value.totalQueries),
    remaining: finiteNumber(value.remainingQueries),
    windowSizeSeconds: finiteNumber(value.windowSizeSeconds),
  });
  return Object.keys(window).length ? window : undefined;
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
    detail: "Live limit from api.x.ai response headers",
  };
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

function formatWindowDuration(milliseconds: number): string {
  const minutes = Math.max(1, Math.round(milliseconds / 60_000));
  if (minutes < 60) return `${minutes} minutes`;
  const hours = minutes / 60;
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} hours`;
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
