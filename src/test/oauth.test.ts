import assert from "node:assert/strict";
import test from "node:test";
import { buildAuthorizeUrl, XaiOAuth, XAI_SESSION_SECRET, type SessionStore } from "../oauth";

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
      return Response.json({ access_token: "access", refresh_token: "refresh", expires_in: 3600 });
    },
  });

  const device = await client.requestDeviceCode();
  const session = await client.completeDeviceSignIn(device);
  assert.equal(session.accessToken, "access");
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
