export const XAI_OAUTH_API_BASE = "https://cli-chat-proxy.grok.com/v1";
export const XAI_OAUTH_TOKEN_AUTH = "xai-grok-cli";
export const XAI_GROK_CLIENT_IDENTIFIER = "grok-shell";
export const XAI_GROK_CLIENT_VERSION = "1.0.3";
export const XAI_GROK_CLIENT_MODE = "interactive";
export const XAI_AUTHENTICATE_RESPONSE = "authenticate-response";

export interface XaiOAuthHeaderOptions {
  accessToken: string;
  userId?: string;
  email?: string;
  accept?: string;
  contentType?: string;
  userAgent?: string;
}

/**
 * Build the headers required by xAI's OAuth-backed Grok client proxy.
 * These requests follow the interactive Grok client proxy contract; optional
 * identity claims remain omitted for older persisted OAuth sessions.
 */
export function buildXaiOAuthHeaders(options: XaiOAuthHeaderOptions): Record<string, string> {
  return {
    Authorization: `Bearer ${options.accessToken}`,
    "X-XAI-Token-Auth": XAI_OAUTH_TOKEN_AUTH,
    "x-authenticateresponse": XAI_AUTHENTICATE_RESPONSE,
    "x-grok-client-identifier": XAI_GROK_CLIENT_IDENTIFIER,
    "x-grok-client-mode": XAI_GROK_CLIENT_MODE,
    "x-grok-client-version": XAI_GROK_CLIENT_VERSION,
    "User-Agent": options.userAgent ?? `${XAI_GROK_CLIENT_IDENTIFIER}/${XAI_GROK_CLIENT_VERSION}`,
    ...(options.userId ? { "x-userid": options.userId } : {}),
    ...(options.email ? { "x-email": options.email } : {}),
    ...(options.accept ? { Accept: options.accept } : {}),
    ...(options.contentType ? { "Content-Type": options.contentType } : {}),
  };
}
