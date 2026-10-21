const assert = require("node:assert/strict");
const vscode = require("vscode");
const { GrokProvider } = require("../../out/provider");
const { XaiOAuth, XAI_SESSION_SECRET } = require("../../out/auth/oauth");

/**
 * Validates that a workspace binding does not change the account the user
 * selected globally.
 *
 * A repository pins the account for its own requests, but it must not become
 * the account that the user picks for usage and management in an unrelated
 * workspace.
 */
async function run() {
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, "account probe needs a workspace folder");
  const configuration = vscode.workspace.getConfiguration("grokCopilot", folder.uri);

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
    // The user selected "default" for usage and management.
    assert.equal(provider.getActiveProfile(), "default");
    assert.equal(provider.getEffectiveProfile(), "default");

    // The repository binds this workspace to "work".
    await configuration.update("profile", "work", vscode.ConfigurationTarget.WorkspaceFolder);
    const models = await provider.provideLanguageModelChatInformation({ silent: true, configuration: { profile: "default" } }, {});
    assert.equal(models[0].id, "work::grok-4.6", "the binding must route requests to the work account");

    // The bound account is used for requests, but the user's own choice for
    // usage and management is untouched.
    assert.equal(provider.getEffectiveProfile(), "work");
    assert.equal(provider.getActiveProfile(), "default", "a binding must not change the user's active account");

    // Changing the binding back restores the user's account.
    await configuration.update("profile", undefined, vscode.ConfigurationTarget.WorkspaceFolder);
    assert.equal(provider.getEffectiveProfile(), "default");
    assert.equal(provider.getActiveProfile(), "default");
  } finally {
    await configuration.update("profile", undefined, vscode.ConfigurationTarget.WorkspaceFolder);
    globalThis.fetch = previousFetch;
  }
  console.log(JSON.stringify({ provider: "grok", accountChecks: "a binding routes requests without changing the user's active account", passed: true }));
}
module.exports = { run };
