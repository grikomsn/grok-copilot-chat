import { createHash } from "node:crypto";

/** Stable, privacy-safe identity inputs for xAI prompt-cache routing. */
export interface PromptCacheContext {
  model: string;
  instructions?: string;
  tools: readonly unknown[];
  input: readonly unknown[];
}

/**
 * Derive a stable cache identity from the model, tools, instructions, and the
 * opening prompt prefix without exposing prompt text in the identifier.
 */
export function createPromptCacheKey(context: PromptCacheContext): string {
  const input = context.input.filter(isRecord);
  const firstUserMessage = input.findIndex((item) => item.role === "user");
  const rootLength = firstUserMessage >= 0 ? firstUserMessage + 1 : Math.min(1, input.length);
  const conversationRoot = input.slice(0, rootLength);
  return createHash("sha256").update(JSON.stringify({
    version: 1,
    model: context.model,
    instructions: context.instructions,
    tools: context.tools.filter(isRecord),
    input: conversationRoot,
  })).digest("hex");
}

/** Derive the cache identity from a normalized Chat Completions or Responses body. */
export function createPromptCacheKeyFromRequest(body: Record<string, unknown>): string | undefined {
  if (typeof body.model !== "string" || !body.model) return undefined;
  const input = Array.isArray(body.input)
    ? body.input
    : Array.isArray(body.messages)
      ? body.messages
      : [];
  const tools = Array.isArray(body.tools) ? body.tools : [];
  return createPromptCacheKey({
    model: body.model,
    instructions: typeof body.instructions === "string" ? body.instructions : undefined,
    tools,
    input,
  });
}

/** Build the xAI Chat Completions cache-affinity header for a normalized request. */
export function createChatPromptCacheHeaders(body: Record<string, unknown>): Record<string, string> {
  const cacheKey = createPromptCacheKeyFromRequest(body);
  return cacheKey ? { "x-grok-conv-id": cacheKey } : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
