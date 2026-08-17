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

export function buildModelConfigurationSchema(
  modelId: string,
  defaultEffort?: ReasoningEffort,
  defaultWebSearch = false,
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
        type: "boolean",
        title: "Web Search",
        description: "Allow Grok to use xAI-hosted web search for this request.",
        default: defaultWebSearch,
        group: "navigation",
      },
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
