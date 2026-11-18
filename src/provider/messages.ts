import * as vscode from "vscode";
import { joinTextParts, stringifyWellFormedJson } from "../kit/unicode";
import type { ResponsesInputContentPart, ResponsesInputItem } from "../transport/responses";

export function convertResponsesMessage(message: vscode.LanguageModelChatRequestMessage): ResponsesInputItem[] {
  const role = message.role === vscode.LanguageModelChatMessageRole.Assistant ? "assistant" : "user";
  const text: string[] = [];
  const images: ResponsesInputContentPart[] = [];
  const toolCalls: ResponsesInputItem[] = [];
  const results: ResponsesInputItem[] = [];

  for (const part of message.content) {
    if (part instanceof vscode.LanguageModelTextPart) text.push(part.value);
    else if (part instanceof vscode.LanguageModelToolCallPart) {
      toolCalls.push({
        type: "function_call",
        call_id: part.callId,
        name: part.name,
        arguments: stringifyWellFormedJson(part.input ?? {}),
      });
    } else if (part instanceof vscode.LanguageModelToolResultPart) {
      results.push({
        type: "function_call_output",
        call_id: part.callId,
        output: joinTextParts(part.content.map(inputPartText)),
      });
    } else if (part instanceof vscode.LanguageModelDataPart && part.mimeType.startsWith("image/")) {
      images.push({
        type: "input_image",
        image_url: `data:${part.mimeType};base64,${Buffer.from(part.data).toString("base64")}`,
      });
    }
  }

  const textValue = joinTextParts(text);
  const content: string | readonly ResponsesInputContentPart[] = images.length
    ? [...(textValue ? [{ type: "input_text" as const, text: textValue }] : []), ...images]
    : textValue;
  const items: ResponsesInputItem[] = [];
  if (content || (!toolCalls.length && !results.length)) items.push({ type: "message", role, content });
  if (role === "assistant") items.push(...toolCalls);
  else items.push(...results);
  return items;
}

export function normalizeResponsesInput(input: ResponsesInputItem[]): ResponsesInputItem[] {
  return input.length ? input : [{ type: "message", role: "user", content: "" }];
}

function inputPartText(part: vscode.LanguageModelInputPart | unknown): string {
  if (part instanceof vscode.LanguageModelTextPart) return part.value;
  if (part instanceof vscode.LanguageModelToolCallPart) return stringifyWellFormedJson(part.input ?? {});
  if (part instanceof vscode.LanguageModelToolResultPart) return joinTextParts(part.content.map(inputPartText));
  if (typeof part === "string") return part;
  return "";
}
