import { applyResponsesReasoningEffort, type ReasoningEffort } from "../models/options";
import { createPromptCacheKey } from "../provider/prompt-cache";
import type { ChatStreamEvent, PendingToolCall } from "./chat-completions";

export interface ResponsesFunctionTool {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ResponsesWebSearchTool {
  type: "web_search";
}

export type ResponsesTool = ResponsesFunctionTool | ResponsesWebSearchTool;

export interface ResponsesInputTextPart {
  type: "input_text";
  text: string;
}

export interface ResponsesInputImagePart {
  type: "input_image";
  image_url: string;
}

export type ResponsesInputContentPart = ResponsesInputTextPart | ResponsesInputImagePart;

export interface ResponsesMessageInput {
  type: "message";
  role: "user" | "assistant";
  content: string | readonly ResponsesInputContentPart[];
}

export interface ResponsesFunctionCallInput {
  type: "function_call";
  call_id: string;
  name: string;
  arguments: string;
}

export interface ResponsesFunctionCallOutputInput {
  type: "function_call_output";
  call_id: string;
  output: string;
}

export type ResponsesInputItem =
  | ResponsesMessageInput
  | ResponsesFunctionCallInput
  | ResponsesFunctionCallOutputInput;

export function buildResponsesFunctionTool(
  tool: { name: string; description: string; inputSchema?: unknown },
): ResponsesFunctionTool {
  return {
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: sanitizeSchema(tool.inputSchema),
  };
}

export function buildResponsesRequest(
  model: string,
  input: readonly ResponsesInputItem[],
  tools: readonly ResponsesTool[],
  reasoningEffort: ReasoningEffort | undefined,
  maxOutputTokens: number,
  toolChoice: "auto" | "required" = "auto",
): Record<string, unknown> {
  const promptCacheKey = createPromptCacheKey({ model, input, tools });
  return applyResponsesReasoningEffort({
    model,
    input,
    prompt_cache_key: promptCacheKey,
    stream: true,
    store: false,
    max_output_tokens: maxOutputTokens,
    ...(tools.length ? { tools, tool_choice: toolChoice, parallel_tool_calls: true } : {}),
  }, reasoningEffort);
}

export class ResponsesStreamParser {
  private buffer = "";
  private readonly pendingTools = new Map<string, PendingToolCall>();
  private readonly completedToolIds = new Set<string>();
  private lastFinishReason: string | undefined;

  get finishReason(): string | undefined {
    return this.lastFinishReason;
  }

  push(chunk: string): ChatStreamEvent[] {
    this.buffer += chunk.replace(/\r\n/g, "\n");
    const events: ChatStreamEvent[] = [];
    let boundary: number;
    while ((boundary = this.buffer.indexOf("\n\n")) >= 0) {
      const block = this.buffer.slice(0, boundary);
      this.buffer = this.buffer.slice(boundary + 2);
      const event = this.parseBlock(block);
      if (event) events.push(event);
    }
    return events;
  }

  finish(): ChatStreamEvent[] {
    const events: ChatStreamEvent[] = [];
    const trailing = this.parseBlock(this.buffer);
    this.buffer = "";
    if (trailing) events.push(trailing);
    const tools = this.flushTools();
    if (tools.length) events.push({ toolCalls: tools });
    return events;
  }

  private parseBlock(block: string): ChatStreamEvent | undefined {
    const lines = block.split("\n");
    const eventName = lines.find((line) => line.startsWith("event:"))?.slice(6).trim();
    const data = lines
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n")
      .trim();
    if (!data) return undefined;
    if (data === "[DONE]") {
      this.lastFinishReason = "stop";
      const toolCalls = this.flushTools();
      return { done: true, finishReason: "stop", ...(toolCalls.length ? { toolCalls } : {}) };
    }

    const json = parseJsonRecord(data);
    const type = eventName || (typeof json?.type === "string" ? json.type : undefined);
    if (!json || !type) return undefined;
    if (type === "error" || type === "response.failed") {
      throw new Error(responseError(json));
    }

    switch (type) {
      case "response.output_text.delta":
      case "response.text.delta":
        return typeof json.delta === "string" ? { text: json.delta } : undefined;
      case "response.reasoning_text.delta":
      case "response.reasoning_summary_text.delta":
        return typeof json.delta === "string" ? { reasoning: json.delta } : undefined;
      case "response.output_item.added":
        this.collectOutputItem(json.item);
        return undefined;
      case "response.function_call_arguments.delta":
        this.collectFunctionArguments(json);
        return undefined;
      case "response.function_call_arguments.done": {
        const tool = this.completeFunctionCall(json);
        return tool ? { toolCalls: [tool] } : undefined;
      }
      case "response.output_item.done": {
        const tool = this.completeOutputItem(json.item);
        return tool ? { toolCalls: [tool] } : undefined;
      }
      case "response.completed":
      case "response.done": {
        const response = isRecord(json.response) ? json.response : undefined;
        const status = response && typeof response.status === "string" ? response.status : "completed";
        if (status === "failed") throw new Error(responseError(json));
        const finishReason = status === "incomplete" ? "length" : "stop";
        this.lastFinishReason = finishReason;
        const toolCalls = this.flushTools();
        const usage = response && isRecord(response.usage)
          ? response.usage
          : isRecord(json.usage) ? json.usage : undefined;
        return {
          ...(toolCalls.length ? { toolCalls } : {}),
          ...(usage ? { usage } : {}),
          finishReason,
          done: true,
        };
      }
      default:
        return undefined;
    }
  }

  private collectOutputItem(value: unknown): void {
    if (!isRecord(value) || value.type !== "function_call") return;
    const tool = this.findOrCreateTool(value);
    if (typeof value.name === "string") tool.name = value.name;
    if (typeof value.arguments === "string") tool.arguments = value.arguments;
  }

  private collectFunctionArguments(value: Record<string, unknown>): void {
    const tool = this.findOrCreateTool(value);
    if (typeof value.name === "string") tool.name = value.name;
    if (typeof value.delta === "string") tool.arguments += value.delta;
  }

  private completeFunctionCall(value: Record<string, unknown>): PendingToolCall | undefined {
    const tool = this.findOrCreateTool(value);
    if (typeof value.name === "string") tool.name = value.name;
    if (typeof value.arguments === "string") tool.arguments = value.arguments;
    return this.removeTool(tool);
  }

  private completeOutputItem(value: unknown): PendingToolCall | undefined {
    if (!isRecord(value) || value.type !== "function_call") return undefined;
    if (toolIdentifiers(value).some((identifier) => this.completedToolIds.has(identifier))) return undefined;
    const tool = this.findOrCreateTool(value);
    if (typeof value.name === "string") tool.name = value.name;
    if (typeof value.arguments === "string") tool.arguments = value.arguments;
    return this.removeTool(tool);
  }

  private findOrCreateTool(value: Record<string, unknown>): PendingToolCall {
    const identifiers = toolIdentifiers(value);
    const existing = identifiers.map((identifier) => this.pendingTools.get(identifier)).find(Boolean);
    const tool = existing ?? { id: identifiers[0] ?? `grok-tool-${Date.now()}`, name: "", arguments: "" };
    if (typeof value.call_id === "string" && value.call_id) tool.id = value.call_id;
    for (const identifier of identifiers) this.pendingTools.set(identifier, tool);
    return tool;
  }

  private removeTool(tool: PendingToolCall): PendingToolCall | undefined {
    const identifiers: string[] = [];
    for (const [key, value] of this.pendingTools) {
      if (value === tool) {
        identifiers.push(key);
        this.pendingTools.delete(key);
      }
    }
    for (const identifier of identifiers) this.completedToolIds.add(identifier);
    this.completedToolIds.add(tool.id);
    return tool.name ? tool : undefined;
  }

  private flushTools(): PendingToolCall[] {
    const tools = [...new Set(this.pendingTools.values())].filter((tool) => tool.name);
    this.pendingTools.clear();
    return tools;
  }
}

function parseJsonRecord(data: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(data);
    return isRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function responseError(value: Record<string, unknown>): string {
  const error = isRecord(value.error) ? value.error : undefined;
  const message = typeof error?.message === "string" ? error.message : undefined;
  return message ?? "xAI Responses API returned an error";
}

function sanitizeSchema(schema: unknown): Record<string, unknown> {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return { type: "object", properties: {} };
  return schema as Record<string, unknown>;
}

function toolIdentifiers(value: Record<string, unknown>): string[] {
  return [value.call_id, value.item_id, value.id]
    .filter((identifier): identifier is string => typeof identifier === "string" && identifier.length > 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
