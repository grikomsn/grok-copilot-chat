const assert = require("node:assert/strict");
const vscode = require("vscode");
const { GrokProvider } = require("../../out/provider");
const { XaiOAuth, XAI_SESSION_SECRET } = require("../../out/auth/oauth");
const { bindingModeFromConfiguration } = require("../../out/workspace-binding");

/**
 * Validates the trust boundary for workspace account bindings.
 *
 * A repository controls its own settings, so it must not be able to relax the
 * trust gate for itself. The `grokCopilot.workspaceBinding` mode is therefore
 * read from the user scope only.
 *
 * This probe runs with workspace trust ENABLED and without
 * `--disable-workspace-trust`, so the workspace is untrusted.
 */
async function run() {
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, "trust probe needs a workspace folder");

  // The workspace is untrusted, which is the case this probe exists for.
  const trusted = vscode.workspace.isTrusted;
  const configuration = vscode.workspace.getConfiguration("grokCopilot", folder.uri);
  const mode = bindingModeFromConfiguration(configuration);
  assert.equal(mode, "trusted", "the default mode is trusted");

  const values = new Map();
  const store = { keys: async () => [...values.keys()], get: async (key) => values.get(key),
    store: async (key, value) => { values.set(key, value); }, delete: async (key) => { values.delete(key); } };
  for (const profile of ["default", "work"]) await store.store(profile === "default" ? XAI_SESSION_SECRET : `${XAI_SESSION_SECRET}.${profile}`,
    JSON.stringify({ accessToken: `synthetic-${profile}`, refreshToken: "synthetic-refresh", expiresAt: Date.now() + 3600000 }));
  const oauth = new XaiOAuth(store, { fetch: async () => Response.json({ access_token: "synthetic-refreshed", refresh_token: "synthetic-refresh", expires_in: 3600 }) });
  const stateValues = new Map();
  const state = { get: (key) => stateValues.get(key), update: async (key, value) => { stateValues.set(key, value); } };
  const provider = new GrokProvider(oauth, { appendLine() {} }, {}, state);
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes("models.dev")) return Response.json({});
    if (String(url).endsWith("/models")) return Response.json({ data: [{ id: "grok-4.6", context_length: 500000 }] });
    return new Response("data: [DONE]\r\n\r\n");
  };
  try {
    // A repository cannot relax the trust gate for itself. The mode is read
    // from the user scope, so a folder value is ignored.
    await configuration.update("profile", "work", vscode.ConfigurationTarget.WorkspaceFolder);
    await configuration.update("workspaceBinding", "on", vscode.ConfigurationTarget.WorkspaceFolder);
    const inspected = configuration.inspect("workspaceBinding");
    assert.equal(inspected.workspaceFolderValue, "on", "the repository did set the folder value");
    assert.equal(bindingModeFromConfiguration(configuration), "trusted", "the folder value must not relax the trust gate");

    // Because the workspace is untrusted, the folder binding is ignored.
    if (!trusted) {
      const models = await provider.provideLanguageModelChatInformation({ silent: true, configuration: { profile: "default" } }, {});
      assert.equal(models[0].id, "default::grok-4.6", "an untrusted workspace must not repoint the account");
      assert.equal(provider.getEffectiveProfile(), "default");
    }

    // A user-scoped "off" cannot be overridden by a repository either.
    await configuration.update("workspaceBinding", "off", vscode.ConfigurationTarget.Global);
    assert.equal(bindingModeFromConfiguration(configuration), "off", "a user value must win over a folder value");
    await configuration.update("workspaceBinding", undefined, vscode.ConfigurationTarget.Global);
  } finally {
    await configuration.update("profile", undefined, vscode.ConfigurationTarget.WorkspaceFolder);
    await configuration.update("workspaceBinding", undefined, vscode.ConfigurationTarget.WorkspaceFolder);
    await configuration.update("workspaceBinding", undefined, vscode.ConfigurationTarget.Global);
    globalThis.fetch = previousFetch;
  }
  console.log(JSON.stringify({ provider: "grok", trustChecks: "repository settings cannot relax the trust gate, user scope wins", trusted, passed: true }));
}
module.exports = { run };
