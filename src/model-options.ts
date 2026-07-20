export type ReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh";

export interface ModelEffortSpec {
  efforts: readonly ReasoningEffort[];
  defaultEffort: ReasoningEffort;
}

const STANDARD_REASONING: ModelEffortSpec = {
  efforts: ["low", "medium", "high"],
  defaultEffort: "high",
};

const OPTIONAL_REASONING: ModelEffortSpec = {
  efforts: ["none", "low", "medium", "high"],
  defaultEffort: "low",
};

export function modelEffortSpec(modelId: string): ModelEffortSpec | undefined {
  const id = modelId.toLowerCase();
  if (id.includes("non-reasoning")) return undefined;
  if (id.includes("grok-4.20-multi-agent")) {
    return { efforts: ["low", "medium", "high", "xhigh"], defaultEffort: "high" };
  }
  if (id.includes("grok-4.5")) return STANDARD_REASONING;
  if (id.includes("grok-4.3")) return OPTIONAL_REASONING;
  if (id.includes("grok-3-mini") || id.includes("fast-reasoning")) {
    return { efforts: ["low", "high"], defaultEffort: "high" };
  }
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

export function buildModelConfigurationSchema(
  modelId: string,
  defaultEffort?: ReasoningEffort,
): {
  type: "object";
  properties: Record<string, Record<string, unknown>>;
} | undefined {
  const spec = modelEffortSpec(modelId);
  if (!spec) return undefined;
  const selectedDefault = defaultEffort && spec.efforts.includes(defaultEffort)
    ? defaultEffort
    : spec.defaultEffort;
  return {
    type: "object",
    properties: {
      reasoningEffort: {
        type: "string",
        title: idIsMultiAgent(modelId) ? "Agent Effort" : "Reasoning Effort",
        enum: [...spec.efforts],
        enumItemLabels: spec.efforts.map(formatEffortLabel),
        enumDescriptions: spec.efforts.map((effort) => effortDescription(effort, idIsMultiAgent(modelId))),
        default: selectedDefault,
        group: "navigation",
      },
    },
  };
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
