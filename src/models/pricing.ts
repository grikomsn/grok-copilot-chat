export interface ModelCost {
  readonly input: number;
  readonly output: number;
  readonly cacheRead?: number;
}

export interface ModelPricingFields {
  readonly pricing: string;
  readonly inputCost: number;
  readonly outputCost: number;
  readonly cacheCost?: number;
  readonly priceCategory: "low" | "medium" | "high" | "very_high";
}

const OFFICIAL_MODEL_COSTS: Readonly<Record<string, ModelCost>> = {
  "grok-4.6": { input: 2, cacheRead: 0.5, output: 6 },
  "grok-4.5": { input: 2, cacheRead: 0.3, output: 6 },
  "grok-4.3": { input: 1.25, cacheRead: 0.2, output: 2.5 },
  "grok-build-0.1": { input: 1, cacheRead: 0.2, output: 2 },
  "grok-4.20": { input: 1.25, cacheRead: 0.2, output: 2.5 },
  "grok-4.20-non-reasoning": { input: 1.25, cacheRead: 0.2, output: 2.5 },
  "grok-4.20-multi-agent": { input: 1.25, cacheRead: 0.2, output: 2.5 },
};

export function grokModelCost(id: string, discovered?: ModelCost): ModelCost | undefined {
  return discovered ?? OFFICIAL_MODEL_COSTS[id];
}

export function modelPricingFields(cost: ModelCost | undefined): ModelPricingFields | undefined {
  if (!cost) return undefined;
  if (cost.input === 0 && cost.output === 0) {
    return {
      pricing: "Free",
      inputCost: 0,
      outputCost: 0,
      ...(cost.cacheRead === undefined ? {} : { cacheCost: 0 }),
      priceCategory: "low",
    };
  }
  return {
    pricing: `In: $${formatPrice(cost.input)} · Out: $${formatPrice(cost.output)} /1M tokens`,
    inputCost: Math.round(cost.input * 100),
    outputCost: Math.round(cost.output * 100),
    ...(cost.cacheRead === undefined ? {} : { cacheCost: Math.round(cost.cacheRead * 100) }),
    priceCategory: costCategory(cost),
  };
}

export function costCategory(cost: Pick<ModelCost, "input" | "output">): ModelPricingFields["priceCategory"] {
  const weighted = cost.input * 3 + cost.output;
  if (weighted <= 2) return "low";
  if (weighted <= 25) return "medium";
  if (weighted <= 50) return "high";
  return "very_high";
}

function formatPrice(value: number): string {
  return value.toFixed(6).replace(/\.?0+$/, "");
}
