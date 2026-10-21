const assert = require("node:assert/strict");
const vscode = require("vscode");
const { GrokProvider } = require("../../out/provider");
const { XaiOAuth, XAI_SESSION_SECRET } = require("../../out/auth/oauth");
const { applySignInSelection } = require("../../out/commands/commands");

/**
 * Validates the account separation a workspace binding creates.
 *
 * A binding routes chat requests to the account the repository names. Usage
 * and management keep using the account the user selected, so a repository
 * cannot reach another account's usage or spend.
 *
 * The probe drives the real provider and the real sign-in request event, so a
 * regression that drops the origin of a profile fails here.
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

    // Requests use the bound account.
    assert.equal(provider.getEffectiveProfile(), "work");

    // Usage and management keep using the account the user selected. The
    // bound account has usage of its own, and the two must not be confused.
    assert.equal(provider.getActiveProfile(), "default", "a binding must not change the user's active account");
    provider.clearUsage("work");
    provider.clearUsage("default");
    assert.notEqual(provider.getUsageSnapshot("work"), provider.getUsageSnapshot(), "the bound account's usage must not be the active account's usage");
    assert.deepEqual(provider.getUsageSnapshots(), { work: {}, default: {} }, "each account keeps its own usage");

    // The sign-in request carries the origin of the profile. A profile a
    // binding selected was not the user's choice, so it is not explicit.
    const requests = [];
    provider.onSignInRequested((request) => requests.push(request));
    await configuration.update("profile", "unsigned", vscode.ConfigurationTarget.WorkspaceFolder);
    await provider.provideLanguageModelChatInformation({ silent: true, configuration: { profile: "default" } }, {});
    const bound = requests.find((request) => request.profile === "unsigned");
    assert.ok(bound, "the provider must ask for a sign-in for the unsigned bound profile");
    assert.equal(bound.explicit, false, "a binding-selected profile must not be explicit");

    // A profile the user named is explicit. It uses a different name so the
    // discovery journal treats it as a first sighting.
    requests.length = 0;
    await configuration.update("profile", undefined, vscode.ConfigurationTarget.WorkspaceFolder);
    await provider.provideLanguageModelChatInformation({ silent: true, configuration: { profile: "personal" } }, {});
    const named = requests.find((request) => request.profile === "personal");
    assert.ok(named, "the provider must ask for a sign-in for the unsigned named profile");
    assert.equal(named.explicit, true, "a user-named profile must be explicit");

    // The selection rule follows the captured origin. A sign-in the workspace
    // triggered must not change the user's account, even though the bound
    // account is the one that was signed in to. This is checked while the
    // binding is still in effect, so the signed-in account is also the
    // effective account.
    await configuration.update("profile", "work", vscode.ConfigurationTarget.WorkspaceFolder);
    assert.equal(provider.getEffectiveProfile(), "work");
    applySignInSelection(provider, "work", false);
    assert.equal(provider.getActiveProfile(), "default", "a workspace-triggered sign-in must not change the active account");

    // Changing the binding back restores the user's account.
    await configuration.update("profile", undefined, vscode.ConfigurationTarget.WorkspaceFolder);
    assert.equal(provider.getEffectiveProfile(), "default");
    assert.equal(provider.getActiveProfile(), "default");

    // A sign-in the user asked for by name selects the account.
    applySignInSelection(provider, "personal", true);
    assert.equal(provider.getActiveProfile(), "personal", "a sign-in the user asked for must select the account");
  } finally {
    await configuration.update("profile", undefined, vscode.ConfigurationTarget.WorkspaceFolder);
    globalThis.fetch = previousFetch;
  }
  console.log(JSON.stringify({ provider: "grok", accountChecks: "a binding routes requests while usage and management keep the user's account, and the sign-in request carries the profile origin", passed: true }));
}
module.exports = { run };
