import type { ModelsDevModelMetadata } from "./metadata";

export const DEFAULT_CONTEXT_LENGTH = 256_000;
export const DEFAULT_MAX_OUTPUT_TOKENS = 16_384;

export interface DiscoveredModel {
  id: string;
  /** Full model context window from xAI `context_length`, when known. */
  contextLength?: number;
  /** Explicit capability metadata from xAI or a verified fallback profile. */
  imageInput?: boolean;
  toolCalling?: boolean;
}

export interface ModelTokenLimits {
  contextLength: number;
  maxInputTokens: number;
  maxOutputTokens: number;
}

export const FALLBACK_MODELS: readonly DiscoveredModel[] = [
  { id: "grok-4.6", contextLength: 500_000, imageInput: true, toolCalling: true },
  { id: "grok-4.5", contextLength: 500_000, imageInput: true, toolCalling: true },
  { id: "grok-4.3", contextLength: 1_000_000, toolCalling: true },
  { id: "grok-build-0.1", contextLength: DEFAULT_CONTEXT_LENGTH, imageInput: true, toolCalling: true },
  { id: "grok-4.20", contextLength: 1_000_000, toolCalling: true },
  { id: "grok-4.20-non-reasoning", contextLength: 1_000_000, toolCalling: true },
  { id: "grok-4.20-multi-agent", contextLength: 1_000_000, toolCalling: true },
];

/** Parse chat models and context windows from an xAI `/v1/models` response body. */
export function parseDiscoveredModels(body: unknown): DiscoveredModel[] {
  const entries = readModelEntries(body);
  if (!entries) return [];

  return entries
    .map(toDiscoveredModel)
    .filter((model): model is DiscoveredModel => model !== undefined)
    .sort((left, right) => left.id.localeCompare(right.id));
}

/** Read the `data` array from an xAI models list payload, if present. */
function readModelEntries(body: unknown): unknown[] | undefined {
  if (!body || typeof body !== "object") return undefined;
  const data = (body as { data?: unknown }).data;
  return Array.isArray(data) ? data : undefined;
}

/**
 * Convert one API model object into a chat model entry.
 * Returns undefined for non-objects, non-chat models, and missing/empty ids.
 */
function toDiscoveredModel(entry: unknown): DiscoveredModel | undefined {
  if (!entry || typeof entry !== "object") return undefined;

  const record = entry as Record<string, unknown>;
  const id = record.id;
  if (typeof id !== "string" || !id || !isChatModel(id)) return undefined;

  const fallback = FALLBACK_MODELS.find((model) => model.id === id);
  const capabilities = isRecord(record.capabilities) ? record.capabilities : undefined;
  const imageInput = readOptionalBoolean(
    [record, capabilities],
    ["image_input", "imageInput", "vision", "supports_vision", "supportsVision"],
  ) ?? fallback?.imageInput;
  const toolCalling = readOptionalBoolean(
    [record, capabilities],
    ["tool_calling", "toolCalling", "supports_tools", "supportsTools", "supports_tool_calling"],
  ) ?? fallback?.toolCalling;
  const contextLength = readPositiveInt(record.context_length)
    ?? fallback?.contextLength;
  return {
    id,
    ...(contextLength === undefined ? {} : { contextLength }),
    ...(imageInput === undefined ? {} : { imageInput }),
    ...(toolCalling === undefined ? {} : { toolCalling }),
  };
}

/**
 * Map a full xAI context window to VS Code input/output budgets.
 * Reserves configured output headroom so the UI does not treat the entire window as input.
 */
export function resolveModelTokenLimits(
  contextLength: number | undefined,
  configuredMaxOutput: number,
): ModelTokenLimits {
  const window = readPositiveInt(contextLength) ?? DEFAULT_CONTEXT_LENGTH;
  const requestedOutput = readPositiveInt(configuredMaxOutput) ?? DEFAULT_MAX_OUTPUT_TOKENS;
  const maxOutputTokens = Math.max(1, Math.min(requestedOutput, window - 1));
  const maxInputTokens = Math.max(1, window - maxOutputTokens);
  return { contextLength: window, maxInputTokens, maxOutputTokens };
}

export function cloneDiscoveredModel(model: DiscoveredModel): DiscoveredModel {
  return {
    id: model.id,
    ...(model.contextLength === undefined ? {} : { contextLength: model.contextLength }),
    ...(model.imageInput === undefined ? {} : { imageInput: model.imageInput }),
    ...(model.toolCalling === undefined ? {} : { toolCalling: model.toolCalling }),
  };
}

export function enrichDiscoveredModel(model: DiscoveredModel, metadata: ModelsDevModelMetadata | undefined): DiscoveredModel {
  if (!metadata) return model;
  return {
    ...model,
    contextLength: model.contextLength ?? metadata.contextLength,
    imageInput: model.imageInput ?? metadata.imageInput,
    toolCalling: model.toolCalling ?? (metadata.toolCalling === true ? true : undefined),
  };
}

export function formatDiscoveredModels(models: readonly DiscoveredModel[]): string {
  return models
    .map((model) => model.contextLength === undefined ? model.id : `${model.id}(${model.contextLength})`)
    .join(", ");
}

export function pickTestModel(models: readonly DiscoveredModel[]): string {
  const preferred = FALLBACK_MODELS.find((candidate) => models.some((model) => model.id === candidate.id));
  return preferred?.id ?? models[0]?.id ?? FALLBACK_MODELS[0].id;
}

function readPositiveInt(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const normalized = Math.floor(value);
  return normalized > 0 ? normalized : undefined;
}

function readOptionalBoolean(
  sources: readonly (Record<string, unknown> | undefined)[],
  keys: readonly string[],
): boolean | undefined {
  for (const source of sources) {
    for (const key of keys) {
      if (typeof source?.[key] === "boolean") return source[key] as boolean;
    }
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isChatModel(id: string): boolean {
  const value = id.toLowerCase();
  return value.startsWith("grok-") && !/(imagine|image|video|voice|embedding)/.test(value);
}
