import * as vscode from "vscode";
import { messageOf } from "./errors";
import {
  applyReasoningEffort,
  buildModelConfigurationSchema,
  resolveReasoningEffort,
  type ReasoningEffort,
} from "./model-options";
import { XaiOAuth } from "./oauth";
import { ChatCompletionStreamParser, type ChatStreamEvent } from "./sse";
import {
  mergeUsageSnapshot,
  parseApiRateLimitHeaders,
  recordApiRequestUsage,
  toProviderUsagePayload,
  type GrokUsageSnapshot,
} from "./usage";

const API_BASE = "https://api.x.ai/v1";
const FALLBACK_MODELS = [
  "grok-4.5",
  "grok-code-fast-1",
  "grok-4-1-fast-reasoning",
  "grok-4-1-fast-non-reasoning",
];
const MAX_INPUT_TOKENS = 245_760;
const MAX_OUTPUT_TOKENS = 16_384;

export interface GrokModel extends vscode.LanguageModelChatInformation {
  rawModelId: string;
}

interface ApiMessage {
  role: "user" | "assistant" | "tool";
  content: string | null | ApiContentPart[];
  tool_calls?: ApiToolCall[];
  tool_call_id?: string;
}

interface ApiContentPart {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string };
}

interface ApiToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export class GrokProvider implements vscode.LanguageModelChatProvider<GrokModel> {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  private readonly usageEmitter = new vscode.EventEmitter<GrokUsageSnapshot>();
  readonly onDidChangeLanguageModelChatInformation = this.changeEmitter.event;
  readonly onDidChangeUsage = this.usageEmitter.event;
  private models = [...FALLBACK_MODELS];
  private lastModelRefreshAt = 0;
  private usage: GrokUsageSnapshot;

  private get configuration(): vscode.WorkspaceConfiguration {
    return grokConfiguration();
  }

  private get debugLogging(): boolean {
    return this.configuration.get("debugLogging", false);
  }

  constructor(
    private readonly oauth: XaiOAuth,
    private readonly output: vscode.OutputChannel,
    private readonly userAgent: string,
    initialUsage: GrokUsageSnapshot = {},
  ) {
    this.usage = initialUsage;
  }

  fireDidChange(): void {
    this.changeEmitter.fire();
  }

  getUsageSnapshot(): GrokUsageSnapshot {
    return this.usage;
  }

  clearUsage(): void {
    this.setAndEmitUsage({});
  }

  async refreshModels(): Promise<string[]> {
    const models = await this.discoverModels();
    this.changeEmitter.fire();
    return models;
  }

  private async discoverModels(): Promise<string[]> {
    const token = await this.oauth.getAccessToken();
    const response = await fetch(`${API_BASE}/models`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    this.captureApiLimits(response.headers, "models");
    if (!response.ok) throw await apiError("Unable to list xAI models", response);
    const body = (await response.json()) as { data?: Array<{ id?: string }> };
    const discovered = (body.data ?? [])
      .map((model) => model.id)
      .filter((id): id is string => Boolean(id && isChatModel(id)))
      .sort();
    if (discovered.length) this.models = discovered;
    this.lastModelRefreshAt = Date.now();
    this.output.appendLine(`[models] ${this.models.join(", ")}`);
    return this.models;
  }

  async provideLanguageModelChatInformation(
    _options: vscode.PrepareLanguageModelChatModelOptions,
    token: vscode.CancellationToken,
  ): Promise<GrokModel[]> {
    if (token.isCancellationRequested) return [];
    if (await this.oauth.hasSession() && Date.now() - this.lastModelRefreshAt > 5 * 60_000) {
      try {
        await this.discoverModels();
      } catch (error) {
        this.output.appendLine(`[models] discovery failed; using cached/fallback list: ${messageOf(error)}`);
      }
    }
    return this.models.map((id) => {
      const defaultEffort = resolveReasoningEffort(
        id,
        undefined,
        this.configuration.get("reasoningEffort", "high"),
      );
      return {
        id,
        rawModelId: id,
        name: formatModelName(id),
        family: `xai-${id}`,
        version: "1.0.0",
        detail: "xAI OAuth",
        tooltip: `${id} via the xAI API`,
        maxInputTokens: MAX_INPUT_TOKENS,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        isUserSelectable: true,
        configurationSchema: buildModelConfigurationSchema(id, defaultEffort),
        capabilities: {
          imageInput: true,
          toolCalling: true,
        },
      };
    });
  }

  async provideLanguageModelChatResponse(
    model: GrokModel,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart2>,
    token: vscode.CancellationToken,
  ): Promise<void> {
    const reasoningEffort = resolveReasoningEffort(
      model.rawModelId,
      options.modelConfiguration,
      this.configuration.get("reasoningEffort", "high"),
    );
    const requestBody = buildRequest(model.rawModelId, messages, options, reasoningEffort);
    let accessToken = await this.oauth.getAccessToken();
    let response = await this.sendRequest(accessToken, requestBody, token);
    if (response.status === 401) {
      accessToken = await this.oauth.getAccessToken(true);
      response = await this.sendRequest(accessToken, requestBody, token);
    }
    this.captureApiLimits(response.headers, `chat:${model.rawModelId}`);
    if (!response.ok) throw await apiError(`xAI request failed for ${model.rawModelId}`, response);
    if (!response.body) throw new Error("xAI returned an empty response stream");

    if (this.debugLogging) {
      this.output.appendLine(`[request] model=${model.rawModelId} effort=${reasoningEffort ?? "model-default"} initiator=${options.requestInitiator ?? "unknown"}`);
    }

    const parser = new ChatCompletionStreamParser();
    let finalUsage: Record<string, unknown> | undefined;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      if (token.isCancellationRequested) {
        await reader.cancel();
        return;
      }
      const result = await reader.read();
      if (result.done) break;
      for (const event of parser.push(decoder.decode(result.value, { stream: true }))) {
        reportEvent(event, progress);
        if (event.usage) finalUsage = event.usage;
      }
    }
    for (const event of parser.finish()) {
      reportEvent(event, progress);
      if (event.usage) finalUsage = event.usage;
    }
    if (finalUsage) this.captureRequestUsage(finalUsage, model.rawModelId);
  }

  async provideTokenCount(
    _model: GrokModel,
    value: string | vscode.LanguageModelChatRequestMessage,
    _token: vscode.CancellationToken,
  ): Promise<number> {
    const text = typeof value === "string" ? value : messageToText(value);
    return Math.max(1, Math.ceil(text.length / 4));
  }

  async testConnection(): Promise<{ model: string; text: string }> {
    const accessToken = await this.oauth.getAccessToken();
    const model = FALLBACK_MODELS.find((candidate) => this.models.includes(candidate))
      ?? this.models[0]
      ?? FALLBACK_MODELS[0];
    const response = await fetch(`${API_BASE}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "Reply with exactly: Grok connection verified" }],
        max_tokens: 32,
        stream: false,
      }),
    });
    this.captureApiLimits(response.headers, `test:${model}`);
    if (!response.ok) throw await apiError("xAI connection test failed", response);
    const body = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: Record<string, unknown>;
    };
    if (body.usage) this.captureRequestUsage(body.usage, model);
    return { model, text: body.choices?.[0]?.message?.content?.trim() ?? "(empty response)" };
  }

  async refreshUsage(): Promise<GrokUsageSnapshot> {
    try {
      await this.discoverModels();
      this.mergeAndEmitUsage({ apiError: undefined, updatedAt: Date.now() });
    } catch (error) {
      const message = messageOf(error);
      this.mergeAndEmitUsage({ apiError: message, updatedAt: Date.now() });
      this.output.appendLine(`[activity] xAI API capacity refresh unavailable: ${message}`);
    }
    return this.usage;
  }

  private async sendRequest(
    accessToken: string,
    requestBody: Record<string, unknown>,
    cancellation: vscode.CancellationToken,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeoutSeconds = Math.max(
      10,
      this.configuration.get("requestTimeoutSeconds", 600),
    );
    const timeout = setTimeout(() => controller.abort(), timeoutSeconds * 1000);
    const listener = cancellation.onCancellationRequested(() => controller.abort());
    try {
      return await fetch(`${API_BASE}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          "User-Agent": this.userAgent,
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
      listener.dispose();
    }
  }

  private captureApiLimits(headers: Headers, source: string): void {
    const limits = parseApiRateLimitHeaders(headers);
    if (this.debugLogging) {
      const values = [...headers.entries()]
        .filter(([name]) => name.toLowerCase().startsWith("x-ratelimit-"))
        .map(([name, value]) => `${name}=${value}`)
        .join(" ");
      this.output.appendLine(`[rate-limit] source=${source}${values ? ` ${values}` : " none"}`);
    }
    if (limits.requests || limits.tokens) {
      this.mergeAndEmitUsage({ ...limits, updatedAt: Date.now() });
    }
  }

  private captureRequestUsage(raw: Record<string, unknown>, modelId: string): void {
    const next = recordApiRequestUsage(this.usage, raw, modelId);
    if (this.debugLogging) {
      const payload = toProviderUsagePayload(raw);
      this.output.appendLine(`[request-usage] model=${modelId} ${JSON.stringify(payload)}`);
    }
    this.setAndEmitUsage(next);
  }

  private mergeAndEmitUsage(update: GrokUsageSnapshot): void {
    this.setAndEmitUsage(mergeUsageSnapshot(this.usage, update));
  }

  private setAndEmitUsage(usage: GrokUsageSnapshot): void {
    this.usage = usage;
    this.usageEmitter.fire(this.usage);
  }
}

function buildRequest(
  model: string,
  messages: readonly vscode.LanguageModelChatRequestMessage[],
  options: vscode.ProvideLanguageModelChatResponseOptions,
  reasoningEffort?: ReasoningEffort,
): Record<string, unknown> {
  const maxTokens = grokConfiguration().get("maxOutputTokens", MAX_OUTPUT_TOKENS);
  const tools = (options.tools ?? []).map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: sanitizeSchema(tool.inputSchema),
    },
  }));
  return applyReasoningEffort({
    model,
    messages: normalizeMessages(messages.flatMap(convertMessage)),
    stream: true,
    stream_options: { include_usage: true },
    max_tokens: maxTokens,
    ...(tools.length ? { tools, tool_choice: toolMode(options.toolMode), parallel_tool_calls: true } : {}),
  }, reasoningEffort);
}

function grokConfiguration(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration("grokCopilot");
}

function convertMessage(message: vscode.LanguageModelChatRequestMessage): ApiMessage[] {
  const role = message.role === vscode.LanguageModelChatMessageRole.Assistant ? "assistant" : "user";
  const text: string[] = [];
  const images: ApiContentPart[] = [];
  const toolCalls: ApiToolCall[] = [];
  const results: ApiMessage[] = [];

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
  const content: string | ApiContentPart[] = images.length
    ? [...(textValue ? [{ type: "text" as const, text: textValue }] : []), ...images]
    : textValue;
  if (role === "assistant" && toolCalls.length) {
    return [{ role, content: content || null, tool_calls: toolCalls }];
  }
  if (results.length) return content ? [{ role, content }, ...results] : results;
  return [{ role, content }];
}

function normalizeMessages(messages: ApiMessage[]): ApiMessage[] {
  const filtered = messages.filter((message) =>
    Boolean(message.tool_calls?.length || message.tool_call_id || (typeof message.content === "string" ? message.content : message.content?.length)),
  );
  if (filtered[0]?.role === "assistant") {
    filtered.unshift({ role: "user", content: "Continue from the previous assistant response." });
  }
  return filtered.length ? filtered : [{ role: "user", content: "" }];
}

function inputPartText(part: vscode.LanguageModelInputPart | unknown): string {
  if (part instanceof vscode.LanguageModelTextPart) return part.value;
  if (part instanceof vscode.LanguageModelToolCallPart) return JSON.stringify(part.input ?? {});
  if (part instanceof vscode.LanguageModelToolResultPart) return part.content.map(inputPartText).join("\n");
  if (typeof part === "string") return part;
  return "";
}

function messageToText(message: vscode.LanguageModelChatRequestMessage): string {
  return message.content.map(inputPartText).join("\n");
}

function sanitizeSchema(schema: unknown): Record<string, unknown> {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return { type: "object", properties: {} };
  return schema as Record<string, unknown>;
}

function toolMode(mode: vscode.LanguageModelChatToolMode | undefined): "auto" | "required" {
  return mode === vscode.LanguageModelChatToolMode.Required ? "required" : "auto";
}

function reportEvent(
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

function isChatModel(id: string): boolean {
  const value = id.toLowerCase();
  return value.startsWith("grok-") && !/(imagine|image|video|voice|embedding)/.test(value);
}

function formatModelName(id: string): string {
  return id.split("-").map((part) => part === "grok" ? "Grok" : part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

async function apiError(prefix: string, response: Response): Promise<Error> {
  const text = (await response.text().catch(() => "")).trim();
  let detail = text;
  try {
    const json = JSON.parse(text) as { error?: { message?: string } | string };
    detail = typeof json.error === "string" ? json.error : json.error?.message ?? text;
  } catch {
    // Use the response text as-is.
  }
  return new Error(`${prefix} (HTTP ${response.status})${detail ? `: ${detail.slice(0, 1000)}` : ""}`);
}
