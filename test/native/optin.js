const assert = require("node:assert/strict");
const vscode = require("vscode");
const { GrokProvider } = require("../../out/provider");
const { XaiOAuth, XAI_SESSION_SECRET } = require("../../out/auth/oauth");

/**
 * Validates that a workspace with no binding configured behaves exactly as
 * before the binding feature existed.
 *
 * The workspace here has no `.vscode/settings.json` at all, which is what an
 * existing user's repository looks like.
 */
async function run() {
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, "opt-in probe needs a workspace folder");

  // Confirm the workspace really has no binding configured.
  const configuration = vscode.workspace.getConfiguration("grokCopilot", folder.uri);
  const inspected = configuration.inspect("profile");
  assert.equal(inspected.workspaceFolderValue, undefined, "the workspace must not configure a binding");
  assert.equal(inspected.workspaceValue, undefined, "the workspace must not configure a binding");
  assert.equal(inspected.globalValue, undefined, "the user must not configure a binding");

  const values = new Map();
  const store = { keys: async () => [...values.keys()], get: async (key) => values.get(key),
    store: async (key, value) => { values.set(key, value); }, delete: async (key) => { values.delete(key); } };
  for (const profile of ["default", "work"]) await store.store(profile === "default" ? XAI_SESSION_SECRET : `${XAI_SESSION_SECRET}.${profile}`,
    JSON.stringify({ accessToken: `synthetic-${profile}`, refreshToken: "synthetic-refresh", expiresAt: Date.now() + 3600000 }));
  const oauth = new XaiOAuth(store, { fetch: async () => Response.json({ access_token: "synthetic-refreshed", refresh_token: "synthetic-refresh", expires_in: 3600 }) });
  const stateValues = new Map();
  const state = { get: (key) => stateValues.get(key), update: async (key, value) => { stateValues.set(key, value); } };
  const provider = new GrokProvider(oauth, { appendLine() {} }, {}, state, "default");
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes("models.dev")) return Response.json({});
    if (String(url).endsWith("/models")) return Response.json({ data: [{ id: "grok-4.6", context_length: 500000 }] });
    return new Response("data: [DONE]\r\n\r\n");
  };
  try {
    // Every entry keeps its own account, exactly as before the feature.
    const defaultEntry = await provider.provideLanguageModelChatInformation({ silent: true, configuration: { profile: "default" } }, {});
    assert.equal(defaultEntry[0].id, "default::grok-4.6");
    assert.equal(defaultEntry[0].profile, "default");
    const workEntry = await provider.provideLanguageModelChatInformation({ silent: true, configuration: { profile: "work" } }, {});
    assert.equal(workEntry[0].id, "work::grok-4.6");
    assert.equal(workEntry[0].profile, "work");

    // The account used for usage and management is the selected one.
    assert.equal(provider.getActiveProfile(), "default");
    assert.equal(provider.getEffectiveProfile(), "default");
    assert.equal(provider.getUsageSnapshot().updatedAt, undefined);

    // Each account keeps its own usage slot, so the two are not merged.
    provider.clearUsage("work");
    assert.deepEqual(provider.getUsageSnapshots(), { work: {} });

    // No binding is in effect, so the default entry is not repointed.
    assert.equal(provider.getEffectiveProfile(), "default");
  } finally {
    globalThis.fetch = previousFetch;
  }
  console.log(JSON.stringify({ provider: "grok", optInChecks: "a workspace with no binding keeps every entry on its own account and the selected account for usage", passed: true }));
}
module.exports = { run };
