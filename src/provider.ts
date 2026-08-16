import * as vscode from "vscode";
import { messageOf } from "./errors";
import {
  applyReasoningEffort,
  buildModelConfigurationSchema,
  resolveReasoningEffort,
  resolveWebSearch,
  type ReasoningEffort,
} from "./models/options";
import {
  DEFAULT_MAX_OUTPUT_TOKENS,
  FALLBACK_MODELS,
  cloneDiscoveredModel,
  formatDiscoveredModels,
  parseDiscoveredModels,
  pickTestModel,
  resolveModelTokenLimits,
  type DiscoveredModel,
} from "./models/catalog";
import { XaiOAuth, type OAuthSession } from "./auth/oauth";
import {
  XAI_AUTO_TOPUP_PATH,
  XAI_OAUTH_API_BASE,
  XAI_SUBSCRIPTION_BILLING_PATH,
  buildXaiOAuthHeaders,
} from "./transport/protocol";
import { ChatCompletionStreamParser, validateStreamCompletion } from "./transport/chat-completions";
import {
  buildResponsesFunctionTool,
  buildResponsesRequest,
  ResponsesStreamParser,
} from "./transport/responses";
import {
  convertChatMessage,
  convertResponsesMessage,
  messageToText,
  normalizeChatMessages,
  normalizeResponsesInput,
} from "./provider/messages";
import { reportStreamEvent } from "./provider/response";
import { createChatPromptCacheHeaders } from "./provider/prompt-cache";
import { buildChatFunctionTool, toolMode } from "./tools/client-tools";
import { XAI_WEB_SEARCH_TOOL } from "./tools/hosted-tools";
import {
  mergeUsageSnapshot,
  parseAutoTopUpPayload,
  parseApiRateLimitHeaders,
  parseSubscriptionUsagePayload,
  recordApiRequestUsage,
  toProviderUsagePayload,
  type GrokUsageSnapshot,
} from "./usage/domain";

export interface GrokModel extends vscode.LanguageModelChatInformation {
  rawModelId: string;
  contextLength: number;
}

interface PendingResponse {
  response: Response;
  cleanup(): void;
}

export class GrokProvider implements vscode.LanguageModelChatProvider<GrokModel> {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  private readonly usageEmitter = new vscode.EventEmitter<GrokUsageSnapshot>();
  readonly onDidChangeLanguageModelChatInformation = this.changeEmitter.event;
  readonly onDidChangeUsage = this.usageEmitter.event;
  private models: DiscoveredModel[] = FALLBACK_MODELS.map(cloneDiscoveredModel);
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
    return models.map((model) => model.id);
  }

  private async discoverModels(): Promise<DiscoveredModel[]> {
    const session = await this.oauth.getSession();
    const response = await fetch(`${XAI_OAUTH_API_BASE}/models`, {
      headers: buildXaiOAuthHeaders({
        accessToken: session.accessToken,
        userId: session.userId,
        email: session.email,
        accept: "application/json",
      }),
    });
    this.captureApiLimits(response.headers, "models");
    if (!response.ok) throw await apiError("Unable to list xAI models", response);
    const discovered = parseDiscoveredModels(await response.json());
    if (discovered.length) this.models = discovered;
    this.lastModelRefreshAt = Date.now();
    this.output.appendLine(`[models] ${formatDiscoveredModels(this.models)}`);
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
    const configuredMaxOutput = this.configuration.get("maxOutputTokens", DEFAULT_MAX_OUTPUT_TOKENS);
    return this.models.map((model) => {
      const limits = resolveModelTokenLimits(model.contextLength, configuredMaxOutput);
      const defaultEffort = resolveReasoningEffort(
        model.id,
        undefined,
        this.configuration.get("reasoningEffort", "high"),
      );
      return {
        id: model.id,
        rawModelId: model.id,
        name: formatModelName(model.id),
        family: `xai-${model.id}`,
        version: "1.0.0",
        detail: "xAI OAuth",
        tooltip: `${model.id} · ${limits.contextLength.toLocaleString()} context · xAI API`,
        maxInputTokens: limits.maxInputTokens,
        maxOutputTokens: limits.maxOutputTokens,
        contextLength: limits.contextLength,
        isUserSelectable: true,
        configurationSchema: buildModelConfigurationSchema(model.id, defaultEffort),
        capabilities: {
          ...(model.imageInput === undefined ? {} : { imageInput: model.imageInput }),
          ...(model.toolCalling === undefined ? {} : { toolCalling: model.toolCalling }),
        },
        requiresAuthorization: { label: "Sign in to xAI" },
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
    const webSearch = resolveWebSearch(
      options.modelConfiguration,
      this.configuration.get("webSearch", false),
    );
    const maxOutputTokens = resolveModelTokenLimits(
      model.contextLength,
      this.configuration.get("maxOutputTokens", DEFAULT_MAX_OUTPUT_TOKENS),
    ).maxOutputTokens;
    const requestBody = webSearch
      ? buildResponsesRequest(
        model.rawModelId,
        normalizeResponsesInput(messages.flatMap(convertResponsesMessage)),
        [
          XAI_WEB_SEARCH_TOOL,
          ...(options.tools ?? []).map(buildResponsesFunctionTool),
        ],
        reasoningEffort,
        maxOutputTokens,
        toolMode(options.toolMode),
      )
      : buildRequest(model.rawModelId, messages, options, reasoningEffort, maxOutputTokens);
    let session = await this.oauth.getSession();
    let pending = await this.sendRequest(session, requestBody, token, webSearch ? "responses" : "chat/completions");
    if (pending.response.status === 401) {
      pending.cleanup();
      session = await this.oauth.getSession(true);
      pending = await this.sendRequest(session, requestBody, token, webSearch ? "responses" : "chat/completions");
    }
    const response = pending.response;
    this.captureApiLimits(response.headers, `${webSearch ? "responses" : "chat"}:${model.rawModelId}`);
    try {
      if (!response.ok) throw await apiError(`xAI request failed for ${model.rawModelId}`, response);
      if (!response.body) throw new Error("xAI returned an empty response stream");

      if (this.debugLogging) {
        this.output.appendLine(`[request] model=${model.rawModelId} effort=${reasoningEffort ?? "model-default"} webSearch=${webSearch} initiator=${options.requestInitiator ?? "unknown"}`);
      }

      const parser = webSearch ? new ResponsesStreamParser() : new ChatCompletionStreamParser();
      let finalUsage: Record<string, unknown> | undefined;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      try {
        while (true) {
          if (token.isCancellationRequested) {
            await reader.cancel();
            return;
          }
          const result = await reader.read();
          if (result.done) break;
          for (const event of parser.push(decoder.decode(result.value, { stream: true }))) {
            reportStreamEvent(event, progress);
            if (event.usage) finalUsage = event.usage;
          }
        }
        for (const event of parser.push(decoder.decode())) {
          reportStreamEvent(event, progress);
          if (event.usage) finalUsage = event.usage;
        }
        for (const event of parser.finish()) {
          reportStreamEvent(event, progress);
          if (event.usage) finalUsage = event.usage;
        }
        validateStreamCompletion(parser.finishReason);
      } catch (error) {
        if (token.isCancellationRequested) return;
        if (isAbortError(error)) throw new Error("xAI response stream timed out before completing");
        throw error;
      } finally {
        reader.releaseLock();
      }
      if (finalUsage) this.captureRequestUsage(finalUsage, model.rawModelId);
    } finally {
      pending.cleanup();
    }
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
    const session = await this.oauth.getSession();
    const model = pickTestModel(this.models);
    const response = await fetch(`${XAI_OAUTH_API_BASE}/chat/completions`, {
      method: "POST",
      headers: buildXaiOAuthHeaders({
        accessToken: session.accessToken,
        userId: session.userId,
        email: session.email,
        accept: "application/json",
        contentType: "application/json",
      }),
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
    await this.refreshSubscriptionUsage();
    this.mergeAndEmitUsage({ updatedAt: Date.now() });
    return this.usage;
  }

  private async refreshSubscriptionUsage(): Promise<void> {
    try {
      const session = await this.oauth.getSession();
      const billing = await this.fetchAccountPayload(session, XAI_SUBSCRIPTION_BILLING_PATH);
      const subscription = parseSubscriptionUsagePayload(billing);
      if (!subscription) throw new Error("xAI returned no subscription usage details");

      let autoTopUp;
      try {
        const payload = await this.fetchAccountPayload(session, XAI_AUTO_TOPUP_PATH);
        autoTopUp = parseAutoTopUpPayload(payload);
      } catch (error) {
        this.output.appendLine(`[activity] auto top-up refresh unavailable: ${messageOf(error)}`);
      }
      this.setSubscriptionState(subscription, autoTopUp);
    } catch (error) {
      const message = messageOf(error);
      this.setSubscriptionState(undefined, undefined, message);
      this.output.appendLine(`[activity] Grok subscription usage refresh unavailable: ${message}`);
    }
  }

  private async fetchAccountPayload(session: OAuthSession, path: string): Promise<unknown> {
    let response = await fetch(`${XAI_OAUTH_API_BASE}${path}`, {
      headers: buildXaiOAuthHeaders({
        accessToken: session.accessToken,
        userId: session.userId,
        email: session.email,
        accept: "application/json",
      }),
    });
    if (response.status === 401) {
      const refreshed = await this.oauth.getSession(true);
      response = await fetch(`${XAI_OAUTH_API_BASE}${path}`, {
        headers: buildXaiOAuthHeaders({
          accessToken: refreshed.accessToken,
          userId: refreshed.userId,
          email: refreshed.email,
          accept: "application/json",
        }),
      });
    }
    if (!response.ok) throw await apiError(`Unable to read xAI account usage at ${path}`, response);
    return response.json();
  }

  private setSubscriptionState(
    subscription: GrokUsageSnapshot["subscription"],
    autoTopUp: GrokUsageSnapshot["autoTopUp"],
    error?: string,
  ): void {
    const next = { ...this.usage };
    delete next.subscription;
    delete next.autoTopUp;
    delete next.subscriptionError;
    if (subscription) next.subscription = subscription;
    if (autoTopUp) next.autoTopUp = autoTopUp;
    if (error) next.subscriptionError = error;
    next.updatedAt = Date.now();
    this.setAndEmitUsage(next);
  }

  private async sendRequest(
    session: OAuthSession,
    requestBody: Record<string, unknown>,
    cancellation: vscode.CancellationToken,
    endpoint: "chat/completions" | "responses" = "chat/completions",
  ): Promise<PendingResponse> {
    const controller = new AbortController();
    const timeoutSeconds = Math.max(
      10,
      this.configuration.get("requestTimeoutSeconds", 600),
    );
    const timeout = setTimeout(() => controller.abort(), timeoutSeconds * 1000);
    const listener = cancellation.onCancellationRequested(() => controller.abort());
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      clearTimeout(timeout);
      listener.dispose();
    };
    try {
      const response = await fetch(`${XAI_OAUTH_API_BASE}/${endpoint}`, {
        method: "POST",
        headers: {
          ...buildXaiOAuthHeaders({
            accessToken: session.accessToken,
            userId: session.userId,
            email: session.email,
            contentType: "application/json",
            accept: "text/event-stream",
          }),
          ...(endpoint === "chat/completions" ? createChatPromptCacheHeaders(requestBody) : {}),
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
      return { response, cleanup };
    } catch (error) {
      cleanup();
      throw error;
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
  maxOutputTokens?: number,
): Record<string, unknown> {
  const configuredMaxOutput = grokConfiguration().get("maxOutputTokens", DEFAULT_MAX_OUTPUT_TOKENS);
  const maxTokens = typeof maxOutputTokens === "number" && Number.isFinite(maxOutputTokens) && maxOutputTokens > 0
    ? Math.floor(maxOutputTokens)
    : configuredMaxOutput;
  const tools = (options.tools ?? []).map(buildChatFunctionTool);
  return applyReasoningEffort({
    model,
    messages: normalizeChatMessages(messages.flatMap(convertChatMessage)),
    stream: true,
    stream_options: { include_usage: true },
    max_tokens: maxTokens,
    ...(tools.length ? { tools, tool_choice: toolMode(options.toolMode), parallel_tool_calls: true } : {}),
  }, reasoningEffort);
}

function grokConfiguration(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration("grokCopilot");
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

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
