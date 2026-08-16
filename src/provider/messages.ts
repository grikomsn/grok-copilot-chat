import * as vscode from "vscode";
import type { ResponsesInputContentPart, ResponsesInputItem } from "../transport/responses";

export interface ChatMessage {
  role: "user" | "assistant" | "tool";
  content: string | null | ChatContentPart[];
  tool_calls?: ChatToolCall[];
  tool_call_id?: string;
}

interface ChatContentPart {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string };
}

interface ChatToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export function convertChatMessage(message: vscode.LanguageModelChatRequestMessage): ChatMessage[] {
  const role = message.role === vscode.LanguageModelChatMessageRole.Assistant ? "assistant" : "user";
  const text: string[] = [];
  const images: ChatContentPart[] = [];
  const toolCalls: ChatToolCall[] = [];
  const results: ChatMessage[] = [];

  for (const part of message.content) {
    if (part instanceof vscode.LanguageModelTextPart) text.push(part.value);
    else if (part instanceof vscode.LanguageModelToolCallPart) {
      toolCalls.push({
        id: part.callId,
        type: "function",
        function: { name: part.name, arguments: JSON.stringify(part.input ?? {}) },
      });
    } else if (part instanceof vscode.LanguageModelToolResultPart) {
      results.push({ role: "tool", tool_call_id: part.callId, content: part.content.map(inputPartText).join("\n") });
    } else if (part instanceof vscode.LanguageModelDataPart && part.mimeType.startsWith("image/")) {
      images.push({
        type: "image_url",
        image_url: { url: `data:${part.mimeType};base64,${Buffer.from(part.data).toString("base64")}` },
      });
    }
  }

  const textValue = text.join("\n");
  const content: string | ChatContentPart[] = images.length
    ? [...(textValue ? [{ type: "text" as const, text: textValue }] : []), ...images]
    : textValue;
  if (role === "assistant" && toolCalls.length) {
    return [{ role, content: content || null, tool_calls: toolCalls }];
  }
  if (results.length) return content ? [{ role, content }, ...results] : results;
  return [{ role, content }];
}

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
        arguments: JSON.stringify(part.input ?? {}),
      });
    } else if (part instanceof vscode.LanguageModelToolResultPart) {
      results.push({
        type: "function_call_output",
        call_id: part.callId,
        output: part.content.map(inputPartText).join("\n"),
      });
    } else if (part instanceof vscode.LanguageModelDataPart && part.mimeType.startsWith("image/")) {
      images.push({
        type: "input_image",
        image_url: `data:${part.mimeType};base64,${Buffer.from(part.data).toString("base64")}`,
      });
    }
  }

  const textValue = text.join("\n");
  const content: string | readonly ResponsesInputContentPart[] = images.length
    ? [...(textValue ? [{ type: "input_text" as const, text: textValue }] : []), ...images]
    : textValue;
  const items: ResponsesInputItem[] = [];
  if (content || (!toolCalls.length && !results.length)) items.push({ type: "message", role, content });
  if (role === "assistant") items.push(...toolCalls);
  else items.push(...results);
  return items;
}

export function normalizeChatMessages(messages: ChatMessage[]): ChatMessage[] {
  const filtered = messages.filter((message) =>
    Boolean(message.tool_calls?.length || message.tool_call_id || (typeof message.content === "string" ? message.content : message.content?.length)),
  );
  if (filtered[0]?.role === "assistant") {
    filtered.unshift({ role: "user", content: "Continue from the previous assistant response." });
  }
  return filtered.length ? filtered : [{ role: "user", content: "" }];
}

export function normalizeResponsesInput(input: ResponsesInputItem[]): ResponsesInputItem[] {
  return input.length ? input : [{ type: "message", role: "user", content: "" }];
}

export function messageToText(message: vscode.LanguageModelChatRequestMessage): string {
  return message.content.map(inputPartText).join("\n");
}

function inputPartText(part: vscode.LanguageModelInputPart | unknown): string {
  if (part instanceof vscode.LanguageModelTextPart) return part.value;
  if (part instanceof vscode.LanguageModelToolCallPart) return JSON.stringify(part.input ?? {});
  if (part instanceof vscode.LanguageModelToolResultPart) return part.content.map(inputPartText).join("\n");
  if (typeof part === "string") return part;
  return "";
}
