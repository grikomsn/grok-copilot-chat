const assert = require("node:assert/strict");
const vscode = require("vscode");
const { GrokProvider } = require("../../out/provider");
const { XaiOAuth, XAI_SESSION_SECRET } = require("../../out/auth/oauth");
const { signInSelection } = require("../../out/auth/selection");

/**
 * Validates that a workspace binding routes requests to the bound account
 * without changing the account the user selected for usage and management.
 *
 * The sign-in rule is checked here as well, because a binding that repoints
 * the requests must not repoint the user's account, while a sign-in the user
 * asked for by name still selects it.
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
    assert.equal(provider.isWorkspaceBound(), false);

    // The repository binds this workspace to "work".
    await configuration.update("profile", "work", vscode.ConfigurationTarget.WorkspaceFolder);
    const models = await provider.provideLanguageModelChatInformation({ silent: true, configuration: { profile: "default" } }, {});
    assert.equal(models[0].id, "work::grok-4.6", "the binding must route requests to the work account");

    // The bound account is used for requests, but the user's own choice for
    // usage and management is untouched.
    assert.equal(provider.getEffectiveProfile(), "work");
    assert.equal(provider.getActiveProfile(), "default", "a binding must not change the user's active account");
    assert.equal(provider.isWorkspaceBound(), true);

    // A sign-in for the bound account keeps the user's own account.
    assert.equal(signInSelection(provider.isWorkspaceBound(), false), "keep");
    // A sign-in the user asked for by name selects it, bound or not.
    assert.equal(signInSelection(provider.isWorkspaceBound(), true), "select");
    assert.equal(signInSelection(false, true), "select");
    // A sign-in in an unbound workspace selects the account it signed in to.
    assert.equal(signInSelection(false, false), "select");

    // Changing the binding back restores the user's account.
    await configuration.update("profile", undefined, vscode.ConfigurationTarget.WorkspaceFolder);
    assert.equal(provider.getEffectiveProfile(), "default");
    assert.equal(provider.getActiveProfile(), "default");
    assert.equal(provider.isWorkspaceBound(), false);
  } finally {
    await configuration.update("profile", undefined, vscode.ConfigurationTarget.WorkspaceFolder);
    globalThis.fetch = previousFetch;
  }
  console.log(JSON.stringify({ provider: "grok", accountChecks: "a binding routes requests without changing the user's active account, and the sign-in rule keeps an explicit selection", passed: true }));
}
module.exports = { run };
