import assert from "node:assert/strict";
import test from "node:test";
import {
  XAI_AUTHENTICATE_RESPONSE,
  XAI_GROK_CLIENT_IDENTIFIER,
  XAI_GROK_CLIENT_MODE,
  XAI_GROK_CLIENT_VERSION,
  XAI_AUTO_TOPUP_PATH,
  XAI_OAUTH_API_BASE,
  XAI_SUBSCRIPTION_BILLING_PATH,
  buildXaiOAuthHeaders,
} from "./protocol";

test("uses the official OAuth inference proxy and client headers", () => {
  assert.equal(XAI_OAUTH_API_BASE, "https://cli-chat-proxy.grok.com/v1");
  assert.equal(XAI_SUBSCRIPTION_BILLING_PATH, "/billing?format=credits");
  assert.equal(XAI_AUTO_TOPUP_PATH, "/auto-topup-rule");
  assert.deepEqual(buildXaiOAuthHeaders({
    accessToken: "secret",
    userId: "user-1",
    email: "user@example.com",
    accept: "text/event-stream",
    contentType: "application/json",
  }), {
    Authorization: "Bearer secret",
    "X-XAI-Token-Auth": "xai-grok-cli",
    "x-authenticateresponse": XAI_AUTHENTICATE_RESPONSE,
    "x-grok-client-identifier": XAI_GROK_CLIENT_IDENTIFIER,
    "x-grok-client-mode": XAI_GROK_CLIENT_MODE,
    "x-grok-client-version": XAI_GROK_CLIENT_VERSION,
    "User-Agent": `${XAI_GROK_CLIENT_IDENTIFIER}/${XAI_GROK_CLIENT_VERSION}`,
    "x-userid": "user-1",
    "x-email": "user@example.com",
    Accept: "text/event-stream",
    "Content-Type": "application/json",
  });
});

test("does not create empty identity headers for older OAuth sessions", () => {
  const headers = buildXaiOAuthHeaders({ accessToken: "secret" });
  assert.equal(headers["x-userid"], undefined);
  assert.equal(headers["x-email"], undefined);
  assert.equal(headers.Authorization, "Bearer secret");
});
