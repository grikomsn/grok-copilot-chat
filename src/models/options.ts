export type ReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh";

export interface ModelEffortSpec {
  efforts: readonly ReasoningEffort[];
  defaultEffort: ReasoningEffort;
}

const STANDARD_REASONING: ModelEffortSpec = {
  efforts: ["low", "medium", "high"],
  defaultEffort: "high",
};

const FRONTIER_REASONING: ModelEffortSpec = {
  efforts: ["low", "medium", "high", "xhigh"],
  defaultEffort: "high",
};

const OPTIONAL_REASONING: ModelEffortSpec = {
  efforts: ["none", "low", "medium", "high"],
  defaultEffort: "high",
};

export function modelEffortSpec(modelId: string): ModelEffortSpec | undefined {
  const id = modelId.toLowerCase();
  if (id.includes("non-reasoning")) return undefined;
  if (id.includes("grok-4.20-multi-agent")) {
    return { efforts: ["low", "medium", "high", "xhigh"], defaultEffort: "high" };
  }
  if (id.includes("grok-4.6")) return FRONTIER_REASONING;
  if (id.includes("grok-4.5")) return STANDARD_REASONING;
  if (id.includes("grok-4.3")) return OPTIONAL_REASONING;
  return undefined;
}

export function resolveReasoningEffort(
  modelId: string,
  requestConfiguration: Readonly<Record<string, unknown>> | undefined,
  workspaceDefault: unknown,
): ReasoningEffort | undefined {
  const spec = modelEffortSpec(modelId);
  if (!spec) return undefined;
  const requested = stringOption(requestConfiguration, "reasoningEffort")
    ?? (typeof workspaceDefault === "string" ? workspaceDefault : undefined);
  return spec.efforts.includes(requested as ReasoningEffort)
    ? requested as ReasoningEffort
    : spec.defaultEffort;
}

export function resolveWebSearch(
  requestConfiguration: Readonly<Record<string, unknown>> | undefined,
  workspaceDefault?: unknown,
): boolean {
  if (requestConfiguration?.webSearch === true || requestConfiguration?.webSearch === "on") return true;
  if (requestConfiguration?.webSearch === false || requestConfiguration?.webSearch === "off") return false;
  return workspaceDefault === true;
}

/** A selectable context window tier shown on a model's picker configuration. */
export interface ContextSizeOption {
  /** Context cap in input tokens; 0 selects the model's default handling. */
  readonly value: number;
  /** Short picker label, e.g. "Auto", "128K", or "Maximum". */
  readonly label: string;
  /** Picker description for the tier. */
  readonly description: string;
}

/** Fixed context tiers offered below a model's registered input limit. */
const CONTEXT_SIZE_TIERS: readonly { value: number; label: string }[] = [
  { value: 65_536, label: "64K" },
  { value: 131_072, label: "128K" },
  { value: 200_000, label: "200K" },
];

/** Builds the context window tiers offered for a model's input limit; undefined when no tier fits. */
export function contextSizeOptions(maxInputTokens: number): ContextSizeOption[] | undefined {
  if (!Number.isFinite(maxInputTokens) || maxInputTokens <= CONTEXT_SIZE_TIERS[0].value) return undefined;
  const tiers = CONTEXT_SIZE_TIERS.filter((tier) => tier.value < maxInputTokens);
  if (!tiers.length) return undefined;
  return [
    { value: 0, label: "Auto", description: "Default context handling for this model." },
    ...tiers.map((tier) => ({
      value: tier.value,
      label: tier.label,
      description: `Keep the conversation under ${tier.label} input tokens.`,
    })),
    {
      value: maxInputTokens,
      label: "Maximum",
      description: "Use the model's full available input limit.",
    },
  ];
}

/** Resolves the effective context cap for a request; Auto and Maximum return undefined. */
export function resolveContextCap(contextSize: number, maxInputTokens: number): number | undefined {
  if (!Number.isFinite(contextSize) || contextSize <= 0) return undefined;
  if (!Number.isFinite(maxInputTokens) || maxInputTokens <= 0) return undefined;
  const cap = Math.min(Math.floor(contextSize), maxInputTokens);
  return cap < maxInputTokens ? cap : undefined;
}

/** Reads the opted-in context size from picker configuration; 0 keeps the model's default handling. */
export function resolveContextSize(requestConfiguration: Readonly<Record<string, unknown>> | undefined): number {
  const value = requestConfiguration?.contextSize;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

export function buildModelConfigurationSchema(
  modelId: string,
  defaultEffort?: ReasoningEffort,
  defaultWebSearch = false,
  contextOptions?: readonly ContextSizeOption[],
): {
  type: "object";
  properties: Record<string, Record<string, unknown>>;
} | undefined {
  const spec = modelEffortSpec(modelId);
  if (!spec && modelId.toLowerCase().includes("imagine")) return undefined;
  const selectedDefault = spec && defaultEffort && spec.efforts.includes(defaultEffort)
    ? defaultEffort
    : spec?.defaultEffort;
  return {
    type: "object",
    properties: {
      ...(spec && selectedDefault ? { reasoningEffort: {
        type: "string",
        title: idIsMultiAgent(modelId) ? "Agent Effort" : "Reasoning Effort",
        enum: [...spec.efforts],
        enumItemLabels: spec.efforts.map(formatEffortLabel),
        enumDescriptions: spec.efforts.map((effort) => effortDescription(effort, idIsMultiAgent(modelId))),
        default: selectedDefault,
        group: "navigation",
      } } : {}),
      webSearch: {
        type: "string",
        title: "Web Search",
        enum: ["off", "on"],
        enumItemLabels: ["Off", "On"],
        enumDescriptions: [
          "Do not use xAI-hosted web search",
          "Allow Grok to use xAI-hosted web search for this request",
        ],
        default: defaultWebSearch ? "on" : "off",
        group: "navigation",
      },
      ...(contextOptions?.length ? {
        contextSize: {
          type: "number",
          title: "Context Window",
          enum: contextOptions.map((option) => option.value),
          enumItemLabels: contextOptions.map((option) => option.label),
          enumDescriptions: contextOptions.map((option) => option.description),
          default: 0,
          group: "navigation",
        },
      } : {}),
    },
  };
}

export function applyResponsesReasoningEffort(
  body: Readonly<Record<string, unknown>>,
  effort: ReasoningEffort | undefined,
): Record<string, unknown> {
  return effort && effort !== "none"
    ? { ...body, reasoning: { effort } }
    : { ...body };
}

export function applyReasoningEffort(
  body: Readonly<Record<string, unknown>>,
  effort: ReasoningEffort | undefined,
): Record<string, unknown> {
  return effort ? { ...body, reasoning_effort: effort } : { ...body };
}

function stringOption(value: Readonly<Record<string, unknown>> | undefined, key: string): string | undefined {
  return typeof value?.[key] === "string" ? value[key] as string : undefined;
}

function idIsMultiAgent(modelId: string): boolean {
  return modelId.toLowerCase().includes("multi-agent");
}

function formatEffortLabel(value: ReasoningEffort): string {
  if (value === "xhigh") return "Extra High";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function effortDescription(value: ReasoningEffort, multiAgent: boolean): string {
  if (multiAgent) {
    if (value === "xhigh") return "Use the largest available multi-agent team";
    return `${formatEffortLabel(value)} multi-agent collaboration effort`;
  }
  switch (value) {
    case "none": return "Disable additional reasoning";
    case "low": return "Faster responses with lighter reasoning";
    case "medium": return "Balanced speed and reasoning depth";
    case "high": return "Greater reasoning depth for complex problems";
    case "xhigh": return "Extra-high reasoning effort";
  }
}
