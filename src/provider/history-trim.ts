/** Token estimation and oldest-turn trimming for opted-in context caps. */

import type { ResponsesInputItem } from "../transport/responses";
import type { ChatMessage } from "./messages";

/** Result of trimming a request message list against a context cap. */
export interface HistoryTrimResult<T> {
  readonly items: readonly T[];
  readonly removedItems: number;
  readonly estimatedTokens: number;
}

/** Fixed estimate for an image part, whose base64 payload is not token-shaped. */
const IMAGE_TOKEN_ESTIMATE = 1024;
/** Matches the extension's chars-per-token counting heuristic. */
const CHARS_PER_TOKEN = 4;

interface ItemUnit {
  readonly start: number;
  readonly end: number;
  readonly tokens: number;
}

/** Estimates the token weight of one converted chat message. */
export function estimateChatMessageTokens(message: ChatMessage): number {
  const content = message.content;
  let tokens = typeof content === "string"
    ? textTokens(content)
    : Array.isArray(content)
      ? content.reduce((sum, part) => sum + (part.type === "image_url" ? IMAGE_TOKEN_ESTIMATE : textTokens(part.text ?? "")), 0)
      : 0;
  for (const call of message.tool_calls ?? []) {
    tokens += Math.max(1, textTokens(`${call.function.name}${call.function.arguments}`));
  }
  return Math.max(1, tokens);
}

/** Estimates the token weight of one converted Responses input item. */
export function estimateResponsesItemTokens(item: ResponsesInputItem): number {
  if (item.type === "function_call") {
    return Math.max(1, textTokens(`${item.name}${item.arguments}`));
  }
  if (item.type === "function_call_output") {
    return Math.max(1, textTokens(item.output));
  }
  const content = item.content;
  if (typeof content === "string") return Math.max(1, textTokens(content));
  return Math.max(1, content.reduce((sum, part) => sum + (part.type === "input_image" ? IMAGE_TOKEN_ESTIMATE : textTokens(part.text)), 0));
}

/**
 * Drops the oldest conversation turns from converted chat messages so the
 * estimated payload fits an opted-in context cap. Units are bounded by user
 * messages with no outstanding tool calls, so tool calls and results are never
 * split, and the first and current messages always survive.
 *
 * @example
 * ```ts
 * const result = trimChatHistoryToFit(converted, contextCapTokens);
 * ```
 */
export function trimChatHistoryToFit(messages: readonly ChatMessage[], budgetTokens: number): HistoryTrimResult<ChatMessage> {
  const itemTokens = messages.map((message) => estimateChatMessageTokens(message));
  return dropOldestUnits(messages, itemTokens, chatUnitStarts(messages), budgetTokens);
}

/**
 * Drops the oldest turn items from converted Responses input so the estimated
 * payload fits an opted-in context cap.
 */
export function trimResponsesInputToFit(items: readonly ResponsesInputItem[], budgetTokens: number): HistoryTrimResult<ResponsesInputItem> {
  const itemTokens = items.map((item) => estimateResponsesItemTokens(item));
  return dropOldestUnits(items, itemTokens, responsesUnitStarts(items), budgetTokens);
}

/** Groups messages into turn units bounded by user messages with settled tool calls. */
function chatUnitStarts(messages: readonly ChatMessage[]): number[] {
  const starts: number[] = [0];
  const pendingCalls = new Set<string>();
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];
    const boundary = index > 0 && pendingCalls.size === 0 && message.role === "user";
    if (boundary) starts.push(index);
    for (const call of message.tool_calls ?? []) pendingCalls.add(call.id);
    if (message.role === "tool" && typeof message.tool_call_id === "string") pendingCalls.delete(message.tool_call_id);
  }
  return starts;
}

/** Groups Responses items into turn units bounded by user messages with settled tool calls. */
function responsesUnitStarts(items: readonly ResponsesInputItem[]): number[] {
  const starts: number[] = [0];
  const pendingCalls = new Set<string>();
  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    const boundary = index > 0 && pendingCalls.size === 0 && item.type === "message" && item.role === "user";
    if (boundary) starts.push(index);
    if (item.type === "function_call" && typeof item.call_id === "string") pendingCalls.add(item.call_id);
    if (item.type === "function_call_output" && typeof item.call_id === "string") pendingCalls.delete(item.call_id);
  }
  return starts;
}

/** Drops the smallest prefix of middle units that fits, keeping the newest history. */
function dropOldestUnits<T>(
  items: readonly T[],
  itemTokens: readonly number[],
  unitStarts: readonly number[],
  budgetTokens: number,
): HistoryTrimResult<T> {
  const units: ItemUnit[] = unitStarts.map((start, index) => {
    const end = (index + 1 < unitStarts.length ? unitStarts[index + 1] : items.length) - 1;
    return { start, end, tokens: itemTokens.slice(start, end + 1).reduce((sum, tokens) => sum + tokens, 0) };
  });
  const total = units.reduce((sum, unit) => sum + unit.tokens, 0);
  if (budgetTokens <= 0 || units.length < 3 || total <= budgetTokens) {
    return { items, removedItems: 0, estimatedTokens: total };
  }
  let droppedTokens = 0;
  let dropUpToUnit = 1;
  for (let unit = 1; unit <= units.length - 2; unit++) {
    droppedTokens += units[unit].tokens;
    dropUpToUnit = unit;
    if (total - droppedTokens <= budgetTokens) break;
  }
  const dropStart = units[1].start;
  const dropEnd = units[dropUpToUnit].end;
  return {
    items: [...items.slice(0, dropStart), ...items.slice(dropEnd + 1)],
    removedItems: dropEnd - dropStart + 1,
    estimatedTokens: total - droppedTokens,
  };
}

function textTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}
