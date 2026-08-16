import * as vscode from "vscode";
import type { ChatStreamEvent } from "../transport/chat-completions";
import { toProviderUsagePayload } from "../usage/domain";

export function reportStreamEvent(
  event: ChatStreamEvent,
  progress: vscode.Progress<vscode.LanguageModelResponsePart2>,
): void {
  if (event.text) progress.report(new vscode.LanguageModelTextPart(event.text));
  if (event.reasoning) {
    const ThinkingPart = (vscode as unknown as { LanguageModelThinkingPart?: typeof vscode.LanguageModelThinkingPart })
      .LanguageModelThinkingPart;
    if (ThinkingPart) progress.report(new ThinkingPart(event.reasoning));
  }
  for (const tool of event.toolCalls ?? []) {
    progress.report(new vscode.LanguageModelToolCallPart(
      tool.id || `grok-tool-${Date.now()}`,
      tool.name,
      parseArguments(tool.arguments),
    ));
  }
  if (event.usage) {
    const data = new TextEncoder().encode(JSON.stringify(toProviderUsagePayload(event.usage)));
    progress.report(new vscode.LanguageModelDataPart(data, "usage"));
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
