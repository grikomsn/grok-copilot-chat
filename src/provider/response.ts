import type * as vscode from "vscode";
import type { ChatStreamEvent } from "../transport/chat-completions";
import { toProviderUsagePayload } from "../usage/domain";

export type ResponsePartConstructors = Pick<typeof vscode,
  "LanguageModelTextPart" | "LanguageModelToolCallPart" | "LanguageModelDataPart"
> & { LanguageModelThinkingPart?: typeof vscode.LanguageModelThinkingPart };

/** A request owns its reasoning boundaries, held-back usage, and generated tool IDs. */
export class StreamResponseReporter {
  private thinkingOpen = false;
  private toolIndex = 0;
  /** Usage events held back while a thinking segment is open, flushed on close. */
  private pendingUsage: Record<string, unknown>[] = [];
  /** Stable segment id: renderer-side re-id/timing stamping only hits falsy ids. */
  private readonly segmentId: string;

  constructor(
    private readonly progress: vscode.Progress<vscode.LanguageModelResponsePart2>,
    private readonly parts: ResponsePartConstructors,
    private readonly requestId: string,
  ) {
    this.segmentId = `grok-thinking-${requestId}`;
  }

  report(event: ChatStreamEvent): void {
    if (event.reasoning && this.parts.LanguageModelThinkingPart) {
      this.progress.report(new this.parts.LanguageModelThinkingPart(event.reasoning, this.segmentId));
      this.thinkingOpen = true;
    }
    if (event.text || event.toolCalls?.length || event.finishReason || event.done) this.flushThinking();
    if (event.text) this.progress.report(new this.parts.LanguageModelTextPart(event.text));
    for (const tool of event.toolCalls ?? []) {
      this.progress.report(new this.parts.LanguageModelToolCallPart(
        tool.id || `grok-tool-${this.requestId}-${this.toolIndex++}`,
        tool.name,
        parseArguments(tool.arguments),
      ));
    }
    if (event.usage) {
      // Copilot Chat only merges reasoning deltas while the previous reported
      // part is also thinking; hold usage data parts until the segment closes.
      if (this.thinkingOpen) this.pendingUsage.push(event.usage);
      else this.reportUsage(event.usage);
    }
  }

  /** Close a segment at EOF, cancellation, or failure, even without a terminal delta. */
  finish(): void {
    this.flushThinking();
  }

  private flushThinking(): void {
    if (!this.thinkingOpen) return;
    this.thinkingOpen = false;
    const ThinkingPart = this.parts.LanguageModelThinkingPart;
    if (ThinkingPart) this.progress.report(new ThinkingPart("", this.segmentId, { vscode_reasoning_done: true }));
    for (const usage of this.pendingUsage.splice(0)) this.reportUsage(usage);
  }

  private reportUsage(usage: Record<string, unknown>): void {
    const data = new TextEncoder().encode(JSON.stringify(toProviderUsagePayload(usage)));
    this.progress.report(new this.parts.LanguageModelDataPart(data, "usage"));
  }
}

function parseArguments(value: string): object {
  try {
    const parsed = JSON.parse(value || "{}");
    return typeof parsed === "object" && parsed !== null ? parsed : { value: parsed };
  } catch {
    return { value };
  }
}
