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
  done?: boolean;
}

export class ChatCompletionStreamParser {
  private buffer = "";
  private readonly pendingTools = new Map<number, PendingToolCall>();

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
    const data = block
      .split("\n")
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
      json = JSON.parse(data) as Record<string, unknown>;
    } catch {
      return undefined;
    }
    const choices = Array.isArray(json.choices) ? json.choices : [];
    const choice = isRecord(choices[0]) ? choices[0] : undefined;
    const delta = isRecord(choice?.delta) ? choice.delta : {};
    this.collectTools(delta.tool_calls);

    const finishReason = typeof choice?.finish_reason === "string" ? choice.finish_reason : undefined;
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
    };
  }

  private collectTools(value: unknown): void {
    if (!Array.isArray(value)) return;
    for (const raw of value) {
      if (!isRecord(raw)) continue;
      const index = typeof raw.index === "number" ? raw.index : this.pendingTools.size;
      const current = this.pendingTools.get(index) ?? { id: "", name: "", arguments: "" };
      if (typeof raw.id === "string") current.id = raw.id;
      const fn = isRecord(raw.function) ? raw.function : undefined;
      if (typeof fn?.name === "string") current.name += fn.name;
      if (typeof fn?.arguments === "string") current.arguments += fn.arguments;
      this.pendingTools.set(index, current);
    }
  }

  private flushTools(): PendingToolCall[] {
    const tools = [...this.pendingTools.values()].filter((tool) => tool.name);
    this.pendingTools.clear();
    return tools;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
