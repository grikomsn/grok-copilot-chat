import assert from "node:assert/strict";
import test from "node:test";
import {
  XAI_GROK_CLIENT_IDENTIFIER,
  XAI_GROK_CLIENT_VERSION,
  XAI_OAUTH_API_BASE,
  buildXaiOAuthHeaders,
} from "./provider-transport";

test("uses the official OAuth inference proxy and client headers", () => {
  assert.equal(XAI_OAUTH_API_BASE, "https://cli-chat-proxy.grok.com/v1");
  assert.deepEqual(buildXaiOAuthHeaders({
    accessToken: "secret",
    userId: "user-1",
    email: "user@example.com",
    accept: "text/event-stream",
    contentType: "application/json",
  }), {
    Authorization: "Bearer secret",
    "X-XAI-Token-Auth": "xai-grok-cli",
    "x-grok-client-identifier": XAI_GROK_CLIENT_IDENTIFIER,
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
