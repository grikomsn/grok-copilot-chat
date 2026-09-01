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
  enrichDiscoveredModel,
  formatDiscoveredModels,
  parseDiscoveredModels,
  pickTestModel,
  resolveModelTokenLimits,
  type DiscoveredModel,
} from "./models/catalog";
import { ModelsDevMetadata, type MetadataCache } from "./models/metadata";
import { grokModelCost, modelPricingFields } from "./models/pricing";
import { DEFAULT_XAI_PROFILE, normalizeProfileId, XaiOAuth, type OAuthSession } from "./auth/oauth";
import { activeProfileFromState, profileFromConfiguration, profileQualifiedModelId } from "./provider-profile";
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
  profile: string;
}

interface PendingResponse {
  response: Response;
  cleanup(): void;
}

export class GrokProvider implements vscode.LanguageModelChatProvider<GrokModel> {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  private readonly usageEmitter = new vscode.EventEmitter<{ profile: string; usage: GrokUsageSnapshot }>();
  private readonly activeProfileEmitter = new vscode.EventEmitter<string>();
  readonly onDidChangeLanguageModelChatInformation = this.changeEmitter.event;
  readonly onDidChangeUsage = this.usageEmitter.event;
  readonly onDidChangeActiveProfile = this.activeProfileEmitter.event;
  private readonly modelsByProfile = new Map<string, DiscoveredModel[]>();
  private readonly lastModelRefreshAt = new Map<string, number>();
  private readonly usageByProfile = new Map<string, GrokUsageSnapshot>();
  private activeProfile: string;
  private readonly metadata: ModelsDevMetadata;

  private get configuration(): vscode.WorkspaceConfiguration {
    return grokConfiguration();
  }

  private get debugLogging(): boolean {
    return this.configuration.get("debugLogging", false);
  }

  constructor(
    private readonly oauth: XaiOAuth,
    private readonly output: vscode.OutputChannel,
    initialUsage: Readonly<Record<string, GrokUsageSnapshot>> = {},
    metadataCache: MetadataCache = memoryMetadataCache(),
    initialActiveProfile: unknown = DEFAULT_XAI_PROFILE,
  ) {
    for (const [profile, usage] of Object.entries(initialUsage)) this.usageByProfile.set(profile, usage);
    this.activeProfile = activeProfileFromState(initialActiveProfile);
    this.metadata = new ModelsDevMetadata(metadataCache);
  }

  fireDidChange(): void {
    this.changeEmitter.fire();
  }

  getActiveProfile(): string {
    return this.activeProfile;
  }

  setActiveProfile(profile: string): void {
    this.activeProfile = normalizeProfileId(profile);
    this.activeProfileEmitter.fire(this.activeProfile);
    this.usageEmitter.fire({ profile: this.activeProfile, usage: this.getUsageSnapshot() });
  }

  getUsageSnapshot(profile = this.activeProfile): GrokUsageSnapshot {
    return this.usageByProfile.get(profile) ?? {};
  }

  getUsageSnapshots(): Readonly<Record<string, GrokUsageSnapshot>> {
    return Object.fromEntries(this.usageByProfile);
  }

  clearUsage(profile = this.activeProfile): void {
    this.setAndEmitUsage(profile, {});
  }

  async refreshModels(profile = this.activeProfile): Promise<string[]> {
    const models = await this.discoverModels(profile);
    this.changeEmitter.fire();
    return models.map((model) => model.id);
  }

  private async discoverModels(profile: string): Promise<DiscoveredModel[]> {
    const session = await this.oauth.getSession(false, profile);
    const response = await fetch(`${XAI_OAUTH_API_BASE}/models`, {
      headers: buildXaiOAuthHeaders({
        accessToken: session.accessToken,
        userId: session.userId,
        email: session.email,
        accept: "application/json",
      }),
    });
    this.captureApiLimits(response.headers, "models", profile);
    if (!response.ok) throw await apiError("Unable to list xAI models", response);
    const discovered = parseDiscoveredModels(await response.json());
    const metadata = await this.metadata.getOrRefresh();
    const enriched = discovered.map((model) => enrichDiscoveredModel(model, metadata.models[model.id]));
    if (enriched.length) this.modelsByProfile.set(profile, enriched);
    const models = this.modelsFor(profile);
    this.lastModelRefreshAt.set(profile, Date.now());
    this.output.appendLine(`[models] profile=${profile} ${formatDiscoveredModels(models)}`);
    return models;
  }

  async provideLanguageModelChatInformation(
    options: vscode.PrepareLanguageModelChatModelOptions,
    token: vscode.CancellationToken,
  ): Promise<GrokModel[]> {
    if (token.isCancellationRequested) return [];
    let profile: string;
    try {
      profile = profileFromConfiguration(options.configuration);
    } catch (error) {
      const message = messageOf(error);
      this.output.appendLine(`[models] ${message}`);
      if (!options.silent) void vscode.window.showErrorMessage(message);
      return [];
    }
    if (!await this.oauth.hasSession(profile)) return [];
    const maxAge = Math.max(1, this.configuration.get("catalogCacheMinutes", 5)) * 60_000;
    if (Date.now() - (this.lastModelRefreshAt.get(profile) ?? 0) > maxAge) {
      try {
        await this.discoverModels(profile);
      } catch (error) {
        this.output.appendLine(`[models] discovery failed; using cached/fallback list: ${messageOf(error)}`);
      }
    }
    const configuredMaxOutput = this.configuration.get("maxOutputTokens", DEFAULT_MAX_OUTPUT_TOKENS);
    return this.modelsFor(profile).map((model) => {
      const limits = resolveModelTokenLimits(model.contextLength, configuredMaxOutput);
      const defaultEffort = resolveReasoningEffort(
        model.id,
        undefined,
        this.configuration.get("reasoningEffort", "high"),
      );
      return {
        id: profileQualifiedModelId(profile, model.id),
        rawModelId: model.id,
        profile,
        name: formatModelName(model.id),
        family: `xai-${model.id}`,
        version: "1.0.0",
        detail: `xAI OAuth · ${profile}`,
        tooltip: `${model.id} · ${limits.contextLength.toLocaleString()} context · xAI API`,
        maxInputTokens: limits.maxInputTokens,
        maxOutputTokens: limits.maxOutputTokens,
        contextLength: limits.contextLength,
        isUserSelectable: true,
        ...(modelPricingFields(grokModelCost(model.id, model.cost)) ?? {}),
        isBYOK: true,
        requiresAuthorization: { label: `xAI Grok (${profile})` },
        configurationSchema: buildModelConfigurationSchema(
          model.id,
          defaultEffort,
          this.configuration.get("webSearch", false),
        ),
        capabilities: {
          ...(model.imageInput === undefined ? {} : { imageInput: model.imageInput }),
          ...(model.toolCalling === undefined ? {} : { toolCalling: model.toolCalling }),
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
    let session = await this.oauth.getSession(false, model.profile);
    let pending = await this.sendRequest(session, requestBody, token, webSearch ? "responses" : "chat/completions");
    if (pending.response.status === 401) {
      pending.cleanup();
      session = await this.oauth.getSession(true, model.profile);
      pending = await this.sendRequest(session, requestBody, token, webSearch ? "responses" : "chat/completions");
    }
    const response = pending.response;
    this.captureApiLimits(response.headers, `${webSearch ? "responses" : "chat"}:${model.rawModelId}`, model.profile);
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
      if (finalUsage) this.captureRequestUsage(finalUsage, model.rawModelId, model.profile);
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

  async testConnection(profile = this.activeProfile): Promise<{ model: string; text: string }> {
    const session = await this.oauth.getSession(false, profile);
    const model = pickTestModel(this.modelsFor(profile));
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
    this.captureApiLimits(response.headers, `test:${model}`, profile);
    if (!response.ok) throw await apiError("xAI connection test failed", response);
    const body = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: Record<string, unknown>;
    };
    if (body.usage) this.captureRequestUsage(body.usage, model, profile);
    return { model, text: body.choices?.[0]?.message?.content?.trim() ?? "(empty response)" };
  }

  async refreshUsage(profile = this.activeProfile): Promise<GrokUsageSnapshot> {
    try {
      await this.discoverModels(profile);
      this.mergeAndEmitUsage(profile, { apiError: undefined, updatedAt: Date.now() });
    } catch (error) {
      const message = messageOf(error);
      this.mergeAndEmitUsage(profile, { apiError: message, updatedAt: Date.now() });
      this.output.appendLine(`[activity] xAI API capacity refresh unavailable: ${message}`);
    }
    await this.refreshSubscriptionUsage(profile);
    this.mergeAndEmitUsage(profile, { updatedAt: Date.now() });
    return this.getUsageSnapshot(profile);
  }

  private async refreshSubscriptionUsage(profile: string): Promise<void> {
    try {
      const session = await this.oauth.getSession(false, profile);
      const billing = await this.fetchAccountPayload(session, XAI_SUBSCRIPTION_BILLING_PATH, profile);
      const subscription = parseSubscriptionUsagePayload(billing);
      if (!subscription) throw new Error("xAI returned no subscription usage details");

      let autoTopUp;
      try {
        const payload = await this.fetchAccountPayload(session, XAI_AUTO_TOPUP_PATH, profile);
        autoTopUp = parseAutoTopUpPayload(payload);
      } catch (error) {
        this.output.appendLine(`[activity] auto top-up refresh unavailable: ${messageOf(error)}`);
      }
      this.setSubscriptionState(profile, subscription, autoTopUp);
    } catch (error) {
      const message = messageOf(error);
      this.setSubscriptionState(profile, undefined, undefined, message);
      this.output.appendLine(`[activity] Grok subscription usage refresh unavailable: ${message}`);
    }
  }

  private async fetchAccountPayload(session: OAuthSession, path: string, profile: string): Promise<unknown> {
    let response = await fetch(`${XAI_OAUTH_API_BASE}${path}`, {
      headers: buildXaiOAuthHeaders({
        accessToken: session.accessToken,
        userId: session.userId,
        email: session.email,
        accept: "application/json",
      }),
    });
    if (response.status === 401) {
      const refreshed = await this.oauth.getSession(true, profile);
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
    profile: string,
    subscription: GrokUsageSnapshot["subscription"],
    autoTopUp: GrokUsageSnapshot["autoTopUp"],
    error?: string,
  ): void {
    const next = { ...this.getUsageSnapshot(profile) };
    delete next.subscription;
    delete next.autoTopUp;
    delete next.subscriptionError;
    if (subscription) next.subscription = subscription;
    if (autoTopUp) next.autoTopUp = autoTopUp;
    if (error) next.subscriptionError = error;
    next.updatedAt = Date.now();
    this.setAndEmitUsage(profile, next);
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

  private captureApiLimits(headers: Headers, source: string, profile: string): void {
    const limits = parseApiRateLimitHeaders(headers);
    if (this.debugLogging) {
      const values = [...headers.entries()]
        .filter(([name]) => name.toLowerCase().startsWith("x-ratelimit-"))
        .map(([name, value]) => `${name}=${value}`)
        .join(" ");
      this.output.appendLine(`[rate-limit] source=${source}${values ? ` ${values}` : " none"}`);
    }
    if (limits.requests || limits.tokens) {
      this.mergeAndEmitUsage(profile, { ...limits, updatedAt: Date.now() });
    }
  }

  private captureRequestUsage(raw: Record<string, unknown>, modelId: string, profile: string): void {
    const next = recordApiRequestUsage(this.getUsageSnapshot(profile), raw, modelId);
    if (this.debugLogging) {
      const payload = toProviderUsagePayload(raw);
      this.output.appendLine(`[request-usage] model=${modelId} ${JSON.stringify(payload)}`);
    }
    this.setAndEmitUsage(profile, next);
  }

  private mergeAndEmitUsage(profile: string, update: GrokUsageSnapshot): void {
    this.setAndEmitUsage(profile, mergeUsageSnapshot(this.getUsageSnapshot(profile), update));
  }

  private setAndEmitUsage(profile: string, usage: GrokUsageSnapshot): void {
    this.usageByProfile.set(profile, usage);
    this.usageEmitter.fire({ profile, usage });
  }

  private modelsFor(profile: string): DiscoveredModel[] {
    return this.modelsByProfile.get(profile) ?? FALLBACK_MODELS.map(cloneDiscoveredModel);
  }
}

function memoryMetadataCache(): MetadataCache {
  const values = new Map<string, unknown>();
  return {
    get<T>(key: string): T | undefined { return values.get(key) as T | undefined; },
    async update(key: string, value: unknown): Promise<void> { values.set(key, value); },
  };
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
