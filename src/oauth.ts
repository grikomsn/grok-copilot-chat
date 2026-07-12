import { createServer, type Server } from "node:http";

const CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828";
const AUTHORIZE_URL = "https://auth.x.ai/oauth2/authorize";
const DEVICE_AUTHORIZATION_URL = "https://auth.x.ai/oauth2/device/code";
const TOKEN_URL = "https://auth.x.ai/oauth2/token";
const DEVICE_CODE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";
const SCOPE = "openid profile email offline_access grok-cli:access api:access";
const REFRESH_SKEW_MS = 120_000;
const OAUTH_HOST = "127.0.0.1";
const OAUTH_PORT = 56121;
const OAUTH_CALLBACK_PATH = "/callback";
const REDIRECT_URI = `http://${OAUTH_HOST}:${OAUTH_PORT}${OAUTH_CALLBACK_PATH}`;
export const XAI_SESSION_SECRET = "grokCopilot.xaiOAuthSession";

export interface OAuthSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export interface DeviceCode {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in?: number;
  interval?: number;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}

interface TokenError {
  error?: string;
  error_description?: string;
}

export interface SessionStore {
  get(key: string): Thenable<string | undefined>;
  store(key: string, value: string): Thenable<void>;
  delete(key: string): Thenable<void>;
}

export interface OAuthOptions {
  fetch?: typeof globalThis.fetch;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  now?: () => number;
  userAgent?: string;
  deviceAuthorizationUrl?: string;
  tokenUrl?: string;
  authorizeUrl?: string;
}

export interface BrowserSignIn {
  url: string;
  completion: Promise<OAuthSession>;
  cancel(): void;
}

function formHeaders(userAgent: string): Record<string, string> {
  return {
    Accept: "application/json",
    "Content-Type": "application/x-www-form-urlencoded",
    "User-Agent": userAgent,
  };
}

function positiveSeconds(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function defaultSleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    throw new Error("xAI sign-in cancelled");
  }
  await new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>;
    const cleanup = () => signal?.removeEventListener("abort", onAbort);
    const onAbort = () => {
      clearTimeout(timer);
      cleanup();
      reject(new Error("xAI sign-in cancelled"));
    };
    timer = setTimeout(() => {
      cleanup();
      resolve();
    }, milliseconds);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export class XaiOAuth {
  private readonly fetcher: typeof globalThis.fetch;
  private readonly sleep: NonNullable<OAuthOptions["sleep"]>;
  private readonly now: () => number;
  private readonly userAgent: string;
  private readonly deviceAuthorizationUrl: string;
  private readonly tokenUrl: string;
  private readonly authorizeUrl: string;
  private refreshPromise: Promise<OAuthSession> | undefined;

  constructor(
    private readonly store: SessionStore,
    options: OAuthOptions = {},
  ) {
    this.fetcher = options.fetch ?? globalThis.fetch;
    this.sleep = options.sleep ?? defaultSleep;
    this.now = options.now ?? Date.now;
    this.userAgent = options.userAgent ?? "grok-copilot-chat VSCode";
    this.deviceAuthorizationUrl = options.deviceAuthorizationUrl ?? DEVICE_AUTHORIZATION_URL;
    this.tokenUrl = options.tokenUrl ?? TOKEN_URL;
    this.authorizeUrl = options.authorizeUrl ?? AUTHORIZE_URL;
  }

  async hasSession(): Promise<boolean> {
    return Boolean(await this.readSession());
  }

  async readSession(): Promise<OAuthSession | undefined> {
    const raw = await this.store.get(XAI_SESSION_SECRET);
    if (!raw) return undefined;
    try {
      const session = JSON.parse(raw) as Partial<OAuthSession>;
      if (
        typeof session.accessToken === "string" &&
        typeof session.refreshToken === "string" &&
        typeof session.expiresAt === "number"
      ) {
        return session as OAuthSession;
      }
    } catch {
      // Corrupt secret data is treated as signed out.
    }
    return undefined;
  }

  async requestDeviceCode(): Promise<DeviceCode> {
    const response = await this.fetcher(this.deviceAuthorizationUrl, {
      method: "POST",
      headers: formHeaders(this.userAgent),
      body: new URLSearchParams({ client_id: CLIENT_ID, scope: SCOPE }),
    });
    if (!response.ok) {
      throw await responseError("xAI device authorization failed", response);
    }
    const device = (await response.json()) as DeviceCode;
    if (!device.device_code || !device.user_code || !device.verification_uri) {
      throw new Error("xAI returned an incomplete device authorization response");
    }
    return device;
  }

  async startBrowserSignIn(): Promise<BrowserSignIn> {
    const pkce = await generatePkce();
    const state = randomUrlSafe(32);
    const nonce = randomUrlSafe(32);
    const url = buildAuthorizeUrl(this.authorizeUrl, pkce.challenge, state, nonce);
    let server: Server | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    let rejectCompletion: (error: Error) => void = () => undefined;

    const close = () => {
      if (timeout) clearTimeout(timeout);
      server?.close();
      server = undefined;
    };

    const completion = new Promise<OAuthSession>((resolve, reject) => {
      rejectCompletion = reject;
      server = createServer(async (request, response) => {
        const callback = new URL(request.url ?? "/", REDIRECT_URI);
        if (callback.pathname !== OAUTH_CALLBACK_PATH) {
          response.writeHead(404).end("Not found");
          return;
        }
        if (settled) {
          response.writeHead(409).end("This sign-in attempt is already complete.");
          return;
        }
        const oauthError = callback.searchParams.get("error");
        const code = callback.searchParams.get("code");
        if (oauthError) {
          settled = true;
          const error = new Error(callback.searchParams.get("error_description") ?? oauthError);
          response.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          response.end(callbackPage("xAI sign-in failed", error.message));
          close();
          reject(error);
          return;
        }
        if (!code || callback.searchParams.get("state") !== state) {
          settled = true;
          const error = new Error("Invalid xAI OAuth callback state");
          response.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          response.end(callbackPage("xAI sign-in failed", error.message));
          close();
          reject(error);
          return;
        }
        try {
          const session = await this.exchangeAuthorizationCode(code, pkce.verifier);
          settled = true;
          response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          response.end(callbackPage("Signed in to xAI", "You can close this tab and return to Visual Studio Code."));
          close();
          resolve(session);
        } catch (error) {
          settled = true;
          const message = error instanceof Error ? error.message : String(error);
          response.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
          response.end(callbackPage("xAI sign-in failed", message));
          close();
          reject(error);
        }
      });
      server.once("error", (error) => {
        settled = true;
        close();
        reject(new Error(`Unable to start xAI OAuth callback on ${REDIRECT_URI}: ${error.message}`));
      });
      server.listen(OAUTH_PORT, OAUTH_HOST);
      timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        close();
        reject(new Error("xAI browser sign-in timed out"));
      }, 5 * 60_000);
    });

    return {
      url,
      completion,
      cancel: () => {
        if (settled) return;
        settled = true;
        close();
        rejectCompletion(new Error("xAI sign-in cancelled"));
      },
    };
  }

  async completeDeviceSignIn(device: DeviceCode, signal?: AbortSignal): Promise<OAuthSession> {
    const deadline = this.now() + positiveSeconds(device.expires_in, 300) * 1000;
    let interval = Math.max(positiveSeconds(device.interval, 5) * 1000, 1000);

    while (this.now() < deadline) {
      if (signal?.aborted) throw new Error("xAI sign-in cancelled");
      const response = await this.fetcher(this.tokenUrl, {
        method: "POST",
        headers: formHeaders(this.userAgent),
        body: new URLSearchParams({
          grant_type: DEVICE_CODE_GRANT,
          client_id: CLIENT_ID,
          device_code: device.device_code,
        }),
        signal,
      });

      if (response.ok) {
        const session = toSession((await response.json()) as TokenResponse, undefined, this.now());
        await this.writeSession(session);
        return session;
      }

      const body = (await response.json().catch(() => ({}))) as TokenError;
      if (body.error === "authorization_pending") {
        await this.sleep(Math.min(interval + 3000, Math.max(0, deadline - this.now())), signal);
        continue;
      }
      if (body.error === "slow_down") {
        interval += 5000;
        await this.sleep(Math.min(interval + 3000, Math.max(0, deadline - this.now())), signal);
        continue;
      }
      if (body.error === "access_denied" || body.error === "authorization_denied") {
        throw new Error("xAI sign-in was denied");
      }
      if (body.error === "expired_token") {
        throw new Error("The xAI sign-in code expired; start sign-in again");
      }
      throw new Error(
        `xAI sign-in failed (${response.status})${body.error_description ? `: ${body.error_description}` : ""}`,
      );
    }
    throw new Error("The xAI sign-in code expired; start sign-in again");
  }

  async getAccessToken(forceRefresh = false): Promise<string> {
    const session = await this.readSession();
    if (!session) throw new Error("Sign in to xAI before using a Grok model");
    if (!forceRefresh && session.expiresAt - this.now() > REFRESH_SKEW_MS) {
      return session.accessToken;
    }
    if (!this.refreshPromise) {
      this.refreshPromise = this.refresh(session).finally(() => {
        this.refreshPromise = undefined;
      });
    }
    return (await this.refreshPromise).accessToken;
  }

  async signOut(): Promise<void> {
    await this.store.delete(XAI_SESSION_SECRET);
  }

  private async refresh(session: OAuthSession): Promise<OAuthSession> {
    const response = await this.fetcher(this.tokenUrl, {
      method: "POST",
      headers: formHeaders(this.userAgent),
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: session.refreshToken,
        client_id: CLIENT_ID,
      }),
    });
    if (!response.ok) {
      throw await responseError("xAI token refresh failed; sign in again", response);
    }
    const refreshed = toSession((await response.json()) as TokenResponse, session.refreshToken, this.now());
    await this.writeSession(refreshed);
    return refreshed;
  }

  private async exchangeAuthorizationCode(code: string, verifier: string): Promise<OAuthSession> {
    const response = await this.fetcher(this.tokenUrl, {
      method: "POST",
      headers: formHeaders(this.userAgent),
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
        client_id: CLIENT_ID,
        code_verifier: verifier,
      }),
    });
    if (!response.ok) throw await responseError("xAI authorization-code exchange failed", response);
    const session = toSession((await response.json()) as TokenResponse, undefined, this.now());
    await this.writeSession(session);
    return session;
  }

  private async writeSession(session: OAuthSession): Promise<void> {
    await this.store.store(XAI_SESSION_SECRET, JSON.stringify(session));
  }
}

export function buildAuthorizeUrl(authorizeUrl: string, challenge: string, state: string, nonce: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: SCOPE,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    nonce,
    plan: "generic",
    referrer: "grok-copilot-chat",
  });
  return `${authorizeUrl}?${params}`;
}

async function generatePkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = randomUrlSafe(64);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: Buffer.from(digest).toString("base64url") };
}

function randomUrlSafe(bytes: number): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString("base64url");
}

function callbackPage(title: string, detail: string): string {
  const escape = (value: string) => value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
  return `<!doctype html><meta charset="utf-8"><title>${escape(title)}</title><style>body{font:16px system-ui;max-width:42rem;margin:10vh auto;padding:2rem;color:#eee;background:#111}h1{color:#fff}</style><h1>${escape(title)}</h1><p>${escape(detail)}</p>`;
}

function toSession(tokens: TokenResponse, fallbackRefreshToken: string | undefined, now: number): OAuthSession {
  if (!tokens.access_token || !(tokens.refresh_token || fallbackRefreshToken)) {
    throw new Error("xAI returned an incomplete OAuth token response");
  }
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? fallbackRefreshToken!,
    expiresAt: now + positiveSeconds(tokens.expires_in, 3600) * 1000,
  };
}

async function responseError(prefix: string, response: Response): Promise<Error> {
  const detail = (await response.text().catch(() => "")).trim();
  return new Error(`${prefix} (${response.status})${detail ? `: ${detail.slice(0, 500)}` : ""}`);
}
