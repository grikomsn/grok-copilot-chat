export interface PendingToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface ChatStreamEvent {
  text?: string;
  reasoning?: string;
  toolCalls?: PendingToolCall[];
  usage?: Record<string, unknown>;
  finishReason?: string;
  done?: boolean;
}

export class ChatCompletionStreamParser {
  private buffer = "";
  private readonly pendingTools = new Set<PendingToolCall>();
  private readonly toolAliases = new Map<string, PendingToolCall>();
  private lastFinishReason: string | undefined;

  get finishReason(): string | undefined {
    return this.lastFinishReason;
  }

  push(chunk: string): ChatStreamEvent[] {
    this.buffer += chunk;
    const events: ChatStreamEvent[] = [];
    let boundary = /\r?\n\r?\n/.exec(this.buffer);
    while (boundary) {
      const block = this.buffer.slice(0, boundary.index);
      this.buffer = this.buffer.slice(boundary.index + boundary[0].length);
      const event = this.parseBlock(block);
      if (event) events.push(event);
      boundary = /\r?\n\r?\n/.exec(this.buffer);
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
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n")
      .trim();
    if (!data) return undefined;
    if (data === "[DONE]") {
      const toolCalls = this.flushTools();
      return { done: true, ...(toolCalls.length ? { toolCalls } : {}) };
    }

    let json: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(data);
      if (!isRecord(parsed)) return undefined;
      json = parsed;
    } catch {
      return undefined;
    }
    const choices = Array.isArray(json.choices) ? json.choices : [];
    const choice = isRecord(choices[0]) ? choices[0] : undefined;
    const delta = isRecord(choice?.delta) ? choice.delta : {};
    this.collectTools(delta.tool_calls);

    const finishReason = typeof choice?.finish_reason === "string" ? choice.finish_reason : undefined;
    if (finishReason) this.lastFinishReason = finishReason;
    const shouldFlush = finishReason === "tool_calls" || finishReason === "stop";
    const toolCalls = shouldFlush ? this.flushTools() : [];
    const text = typeof delta.content === "string" ? delta.content : undefined;
    const reasoning = [delta.reasoning_content, delta.reasoning]
      .find((value): value is string => typeof value === "string" && value.length > 0);
    const usage = isRecord(json.usage) ? json.usage : undefined;

    if (!text && !reasoning && !toolCalls.length && !usage && !finishReason) return undefined;
    return {
      ...(text ? { text } : {}),
      ...(reasoning ? { reasoning } : {}),
      ...(toolCalls.length ? { toolCalls } : {}),
      ...(usage ? { usage } : {}),
      ...(finishReason ? { finishReason } : {}),
    };
  }

  private collectTools(value: unknown): void {
    if (!Array.isArray(value)) return;
    for (const raw of value) {
      if (!isRecord(raw)) continue;
      const aliases = [
        typeof raw.index === "number" ? `index:${raw.index}` : undefined,
        typeof raw.id === "string" && raw.id ? `id:${raw.id}` : undefined,
      ].filter((value): value is string => value !== undefined);
      const current = aliases.map((alias) => this.toolAliases.get(alias)).find(Boolean)
        ?? { id: "", name: "", arguments: "" };
      for (const alias of aliases) this.toolAliases.set(alias, current);
      if (typeof raw.id === "string") current.id = raw.id;
      const fn = isRecord(raw.function) ? raw.function : undefined;
      if (typeof fn?.name === "string") current.name += fn.name;
      if (typeof fn?.arguments === "string") current.arguments += fn.arguments;
      this.pendingTools.add(current);
    }
  }

  private flushTools(): PendingToolCall[] {
    const tools = [...this.pendingTools].filter((tool) => tool.name).map(completeToolCall);
    this.pendingTools.clear();
    this.toolAliases.clear();
    return tools;
  }
}

export function completeToolCall(tool: PendingToolCall): PendingToolCall {
  const args = tool.arguments.trim() || "{}";
  try {
    JSON.parse(args);
  } catch {
    throw new Error(`xAI response stream ended with incomplete arguments for tool ${tool.name}`);
  }
  return { ...tool, arguments: args };
}

export function validateStreamCompletion(finishReason: string | undefined): void {
  if (finishReason === "stop" || finishReason === "tool_calls" || finishReason === "function_call") return;
  if (!finishReason) {
    throw new Error("xAI response stream ended before a completion reason was received");
  }
  if (finishReason === "length") {
    throw new Error("xAI response reached the configured output token limit before completing");
  }
  if (finishReason === "content_filter") {
    throw new Error("xAI stopped the response because of its content filter");
  }
  throw new Error(`xAI response ended with finish reason: ${finishReason}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
