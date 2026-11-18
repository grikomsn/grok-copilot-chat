import type { ModelCost } from "../kit/pricing";

export type { ModelCost } from "../kit/pricing";

const OFFICIAL_MODEL_COSTS: Readonly<Record<string, ModelCost>> = {
  "grok-4.7": { input: 2, cacheRead: 0.5, output: 6 },
  "grok-4.6": { input: 2, cacheRead: 0.5, output: 6 },
  "grok-4.5": { input: 2, cacheRead: 0.3, output: 6 },
  "grok-4.3": { input: 1.25, cacheRead: 0.2, output: 2.5 },
  "grok-build-0.1": { input: 1, cacheRead: 0.2, output: 2 },
  "grok-4.20": { input: 1.25, cacheRead: 0.2, output: 2.5 },
  "grok-4.20-0309-reasoning": { input: 1.25, cacheRead: 0.2, output: 2.5 },
  "grok-4.20-non-reasoning": { input: 1.25, cacheRead: 0.2, output: 2.5 },
  "grok-4.20-0309-non-reasoning": { input: 1.25, cacheRead: 0.2, output: 2.5 },
  "grok-4.20-multi-agent": { input: 1.25, cacheRead: 0.2, output: 2.5 },
  "grok-4.20-multi-agent-0309": { input: 1.25, cacheRead: 0.2, output: 2.5 },
};

export function grokModelCost(id: string, discovered?: ModelCost): ModelCost | undefined {
  return discovered ?? OFFICIAL_MODEL_COSTS[id];
}

