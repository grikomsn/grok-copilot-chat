import assert from "node:assert/strict";
import { request } from "node:http";
import test from "node:test";
import { buildAuthorizeUrl, normalizeProfileId, XaiOAuth, XAI_SESSION_SECRET, type SessionStore } from "./oauth";

class MemoryStore implements SessionStore {
  readonly values = new Map<string, string>();
  async get(key: string): Promise<string | undefined> { return this.values.get(key); }
  async store(key: string, value: string): Promise<void> { this.values.set(key, value); }
  async delete(key: string): Promise<void> { this.values.delete(key); }
}

test("browser OAuth URL uses PKCE and the registered loopback redirect", () => {
  const url = new URL(buildAuthorizeUrl("https://auth.x.ai/oauth2/authorize", "challenge", "state", "nonce"));
  assert.equal(url.searchParams.get("client_id"), "b1a00492-073a-47ea-816f-4c329264a828");
  assert.equal(url.searchParams.get("redirect_uri"), "http://127.0.0.1:56121/callback");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.match(url.searchParams.get("scope") ?? "", /api:access/);
});

test("normalizes safe profile IDs", () => {
  assert.equal(normalizeProfileId(" Work.Profile "), "work.profile");
  assert.throws(() => normalizeProfileId("work profile"), /Profile IDs/);
});

test("browser OAuth callback rejects forged requests and does not reflect provider errors", async (t) => {
  const signIn = await new XaiOAuth(new MemoryStore()).startBrowserSignIn();
  t.after(() => signIn.cancel());
  const state = new URL(signIn.url).searchParams.get("state");
  assert.ok(state);

  const maliciousDetail = `<script>alert("xss")</script>`;
  const callback = `/callback?${new URLSearchParams({
    error: "access_denied",
    error_description: maliciousDetail,
    state,
  })}`;

  const wrongHost = await callbackRequest(callback, { Host: "attacker.example" });
  assert.equal(wrongHost.status, 400);
  assert.equal(wrongHost.body, "Invalid OAuth callback host.");

  const wrongMethod = await callbackRequest(callback, {}, "POST");
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.allow, "GET");

  const wrongState = await callbackRequest(`/callback?${new URLSearchParams({
    error: "access_denied",
    error_description: maliciousDetail,
    state: "wrong-state",
  })}`);
  assert.equal(wrongState.status, 400);
  assert.match(wrongState.body, /Invalid xAI OAuth callback state/);
  assert.doesNotMatch(wrongState.body, /script/);

  const completion = assert.rejects(signIn.completion, { message: maliciousDetail });
  const providerError = await callbackRequest(callback);
  assert.equal(providerError.status, 400);
  assert.doesNotMatch(providerError.body, /script|alert|xss/);
  assert.match(providerError.body, /authorization request was denied/);
  assert.equal(providerError.headers["cache-control"], "no-store");
  assert.match(String(providerError.headers["content-security-policy"] ?? ""), /default-src 'none'/);
  assert.equal(providerError.headers["referrer-policy"], "no-referrer");
  assert.equal(providerError.headers["x-content-type-options"], "nosniff");
  await completion;
});

test("device OAuth polls pending responses and stores the session", async () => {
  const store = new MemoryStore();
  let tokenCalls = 0;
  const client = new XaiOAuth(store, {
    now: () => 1_000,
    sleep: async () => {},
    fetch: async (input) => {
      if (String(input).includes("device/code")) {
        return Response.json({
          device_code: "device",
          user_code: "ABCD-EFGH",
          verification_uri: "https://x.ai/device",
          expires_in: 600,
          interval: 1,
        });
      }
      tokenCalls++;
      if (tokenCalls === 1) return Response.json({ error: "authorization_pending" }, { status: 400 });
      const payload = Buffer.from(JSON.stringify({ sub: "user-1", email: "user@example.com" })).toString("base64url");
      return Response.json({
        access_token: "access",
        refresh_token: "refresh",
        expires_in: 3600,
        id_token: `header.${payload}.signature`,
      });
    },
  });

  const device = await client.requestDeviceCode();
  const session = await client.completeDeviceSignIn(device);
  assert.equal(session.accessToken, "access");
  assert.equal(session.userId, "user-1");
  assert.equal(session.email, "user@example.com");
  assert.equal(tokenCalls, 2);
  assert.ok(store.values.has(XAI_SESSION_SECRET));
});

test("expired sessions refresh once for concurrent callers", async () => {
  const store = new MemoryStore();
  await store.store(XAI_SESSION_SECRET, JSON.stringify({ accessToken: "old", refreshToken: "refresh", expiresAt: 0 }));
  let refreshes = 0;
  const client = new XaiOAuth(store, {
    now: () => 1_000,
    fetch: async () => {
      refreshes++;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return Response.json({ access_token: "new", refresh_token: "rotated", expires_in: 3600 });
    },
  });
  assert.deepEqual(await Promise.all([client.getAccessToken(), client.getAccessToken()]), ["new", "new"]);
  assert.equal(refreshes, 1);
});

test("keeps profile sessions and refresh locks isolated", async () => {
  const store = new MemoryStore();
  const expired = JSON.stringify({ accessToken: "old", refreshToken: "refresh", expiresAt: 0 });
  await store.store(XAI_SESSION_SECRET, expired);
  await store.store(`${XAI_SESSION_SECRET}.work`, expired);
  let refreshes = 0;
  const client = new XaiOAuth(store, {
    now: () => 1_000,
    fetch: async () => {
      refreshes++;
      return Response.json({ access_token: `new-${refreshes}`, refresh_token: "rotated", expires_in: 3600 });
    },
  });

  const [personal, work] = await Promise.all([
    client.getAccessToken(false, "default"),
    client.getAccessToken(false, "work"),
  ]);
  assert.notEqual(personal, work);
  assert.equal(refreshes, 2);
  assert.deepEqual(await client.listProfiles(), ["default", "work"]);
});

test("serializes concurrent profile-index updates", async () => {
  const store = new MemoryStore();
  const originalStore = store.store.bind(store);
  store.store = async (key, value) => {
    if (key.includes("OAuthProfiles")) await new Promise((resolve) => setTimeout(resolve, 5));
    await originalStore(key, value);
  };
  let token = 0;
  const client = new XaiOAuth(store, {
    now: () => 1_000,
    sleep: async () => {},
    fetch: async () => Response.json({ access_token: `access-${++token}`, refresh_token: "refresh", expires_in: 3600 }),
  });
  const device = { device_code: "device", user_code: "code", verification_uri: "https://x.ai/device" };
  await Promise.all([
    client.completeDeviceSignIn(device, undefined, "personal"),
    client.completeDeviceSignIn(device, undefined, "work"),
  ]);
  assert.deepEqual(await client.listProfiles(), ["personal", "work"]);
});

test("does not persist a refresh that finishes after sign-out", async () => {
  const store = new MemoryStore();
  await store.store(`${XAI_SESSION_SECRET}.work`, JSON.stringify({ accessToken: "old", refreshToken: "refresh", expiresAt: 0 }));
  let release!: () => void;
  const wait = new Promise<void>((resolve) => { release = resolve; });
  const client = new XaiOAuth(store, {
    now: () => 1_000,
    fetch: async () => {
      await wait;
      return Response.json({ access_token: "new", refresh_token: "rotated", expires_in: 3600 });
    },
  });
  const refreshing = client.getAccessToken(false, "work");
  await client.signOut("work");
  release();
  await refreshing;
  assert.equal(await client.hasSession("work"), false);
});

interface CallbackResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

async function callbackRequest(
  path: string,
  headers: Record<string, string> = {},
  method = "GET",
): Promise<CallbackResponse> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      return await new Promise<CallbackResponse>((resolve, reject) => {
        const req = request({ hostname: "127.0.0.1", port: 56121, path, method, headers }, (response) => {
          const chunks: Buffer[] = [];
          response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
          response.on("end", () => resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          }));
        });
        req.once("error", reject);
        req.end();
      });
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
  throw lastError;
}
