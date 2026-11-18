import type { ModelCost } from "./pricing";

import { MODELS_DEV_API_URL, MODELS_DEV_CACHE_TTL_MS, RemoteSnapshot, type SnapshotStore } from "../kit/remote-snapshot";

export { MODELS_DEV_API_URL, MODELS_DEV_CACHE_TTL_MS };
export const MODELS_DEV_CACHE_KEY = "grokCopilot.modelsDevMetadata.v1";

export interface ModelsDevModelMetadata {
  readonly id: string;
  readonly name?: string;
  readonly family?: string;
  readonly contextLength?: number;
  readonly maxOutputTokens?: number;
  readonly imageInput?: boolean;
  readonly toolCalling?: boolean;
  readonly reasoning?: boolean;
  readonly releaseDate?: string;
  readonly lastUpdated?: string;
  readonly cost?: ModelCost;
}

export interface ModelsDevSnapshot {
  readonly fetchedAt: number;
  readonly models: Readonly<Record<string, ModelsDevModelMetadata>>;
}

export type MetadataCache = SnapshotStore;

export function normalizeModelsDevSnapshot(payload: unknown, fetchedAt: number): ModelsDevSnapshot {
  const provider = asRecord(asRecord(payload)?.xai);
  const rawModels = asRecord(provider?.models);
  if (!rawModels) throw new Error("Models.dev returned no xAI model catalog");
  const models = Object.fromEntries(Object.entries(rawModels).flatMap(([key, value]) => {
    const model = normalizeModel(key, value);
    return model ? [[model.id, model]] : [];
  }));
  if (!Object.keys(models).length) throw new Error("Models.dev returned no usable xAI models");
  return { fetchedAt, models };
}

export function parseCachedModelsDevSnapshot(value: unknown): ModelsDevSnapshot | undefined {
  const snapshot = asRecord(value);
  const rawModels = asRecord(snapshot?.models);
  if (!snapshot || !validTimestamp(snapshot.fetchedAt) || !rawModels) return undefined;
  const models: Record<string, ModelsDevModelMetadata> = {};
  for (const [key, raw] of Object.entries(rawModels)) {
    const model = parseCachedModel(key, raw);
    if (!model) return undefined;
    models[model.id] = model;
  }
  return { fetchedAt: snapshot.fetchedAt, models };
}

/** models.dev enrichment with the kit's persisted stale-while-revalidate lifecycle. */
export class ModelsDevMetadata extends RemoteSnapshot<ModelsDevSnapshot> {
  constructor(cache: MetadataCache, fetchImpl: typeof fetch = fetch, now: () => number = () => Date.now()) {
    super({
      cacheKey: MODELS_DEV_CACHE_KEY,
      store: cache,
      fetch: fetchImpl,
      now,
      normalize: normalizeModelsDevSnapshot,
      parseCached: parseCachedModelsDevSnapshot,
      empty: () => ({ fetchedAt: 0, models: {} }),
    });
  }

  getModel(id: string): ModelsDevModelMetadata | undefined {
    return this.current?.models[id];
  }
}

function normalizeModel(key: string, value: unknown): ModelsDevModelMetadata | undefined {
  const raw = asRecord(value);
  if (!raw) return undefined;
  const id = stringValue(raw.id) ?? key.trim();
  if (!id) return undefined;
  const modalities = asRecord(raw.modalities);
  const inputModalities = modalities?.input;
  const limit = asRecord(raw.limit);
  const cost = normalizeCost(asRecord(raw.cost));
  return {
    id,
    name: optionalString(raw.name),
    family: optionalString(raw.family),
    contextLength: optionalTokenCount(limit?.context),
    maxOutputTokens: optionalTokenCount(limit?.output),
    imageInput: Array.isArray(inputModalities)
      ? stringArray(inputModalities).includes("image")
      : undefined,
    toolCalling: optionalBoolean(raw.tool_call),
    reasoning: optionalBoolean(raw.reasoning),
    releaseDate: optionalString(raw.release_date),
    lastUpdated: optionalString(raw.last_updated),
    ...(cost ? { cost } : {}),
  };
}

function parseCachedModel(key: string, value: unknown): ModelsDevModelMetadata | undefined {
  const raw = asRecord(value);
  if (!raw) return undefined;
  const id = stringValue(raw.id) ?? key.trim();
  if (!id || !validOptionalNumber(raw.contextLength) || !validOptionalNumber(raw.maxOutputTokens)) return undefined;
  if (!validOptionalBoolean(raw.imageInput) || !validOptionalBoolean(raw.toolCalling) || !validOptionalBoolean(raw.reasoning)) return undefined;
  const cost = parseCost(raw.cost);
  return {
    id,
    name: optionalString(raw.name),
    family: optionalString(raw.family),
    contextLength: optionalTokenCount(raw.contextLength),
    maxOutputTokens: optionalTokenCount(raw.maxOutputTokens),
    imageInput: optionalBoolean(raw.imageInput),
    toolCalling: optionalBoolean(raw.toolCalling),
    reasoning: optionalBoolean(raw.reasoning),
    releaseDate: optionalString(raw.releaseDate),
    lastUpdated: optionalString(raw.lastUpdated),
    ...(cost ? { cost } : {}),
  };
}

function normalizeCost(raw: Record<string, unknown> | undefined): ModelCost | undefined {
  const input = nonNegativeNumber(raw?.input);
  const output = nonNegativeNumber(raw?.output);
  if (input === undefined || output === undefined) return undefined;
  const cacheRead = nonNegativeNumber(raw?.cache_read);
  return { input, output, ...(cacheRead === undefined ? {} : { cacheRead }) };
}

function parseCost(value: unknown): ModelCost | undefined {
  const raw = asRecord(value);
  if (!raw) return undefined;
  const input = nonNegativeNumber(raw.input);
  const output = nonNegativeNumber(raw.output);
  if (input === undefined || output === undefined) return undefined;
  const cacheRead = nonNegativeNumber(raw.cacheRead);
  return { input, output, ...(cacheRead === undefined ? {} : { cacheRead }) };
}

function asRecord(value: unknown): Record<string, unknown> | undefined { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
function stringValue(value: unknown): string | undefined { return typeof value === "string" && value.trim() ? value.trim() : undefined; }
function optionalString(value: unknown): string | undefined { return value === undefined ? undefined : stringValue(value); }
function optionalBoolean(value: unknown): boolean | undefined { return typeof value === "boolean" ? value : undefined; }
function optionalTokenCount(value: unknown): number | undefined { return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined; }
function nonNegativeNumber(value: unknown): number | undefined { return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined; }
function stringArray(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []; }
function validTimestamp(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value) && value >= 0; }
function validOptionalNumber(value: unknown): boolean { return value === undefined || optionalTokenCount(value) !== undefined; }
function validOptionalBoolean(value: unknown): boolean { return value === undefined || typeof value === "boolean"; }
