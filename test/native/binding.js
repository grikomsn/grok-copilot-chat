const assert = require("node:assert/strict");
const vscode = require("vscode");
const { GrokProvider } = require("../../out/provider");
const { XaiOAuth, XAI_SESSION_SECRET } = require("../../out/auth/oauth");

/**
 * Validates that a committed `.vscode/settings.json` pins the workspace to an
 * xAI account, which is how a repository shares its account binding.
 */
async function run() {
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, "binding probe needs a workspace folder");
  const settingsUri = vscode.Uri.joinPath(folder.uri, ".vscode", "settings.json");
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
    // The workspace ships a .vscode/settings.json that pins the account.
    const raw = new TextDecoder().decode(await vscode.workspace.fs.readFile(settingsUri));
    assert.match(raw, /"grokCopilot\.profile"\s*:\s*"work"/);

    // The folder-scoped value is what the binding reads.
    const inspected = vscode.workspace.getConfiguration("grokCopilot", folder.uri).inspect("profile");
    assert.equal(inspected.workspaceFolderValue, "work");

    // The default entry now resolves to the work account.
    const models = await provider.provideLanguageModelChatInformation({ silent: true, configuration: { profile: "default" } }, {});
    assert.equal(models[0].id, "work::grok-4.6");
    assert.equal(models[0].detail, "xAI OAuth · work");
    assert.equal(provider.getEffectiveProfile(), "work");

    // The per-entry map in the same file repoints a named entry.
    const mapInspected = vscode.workspace.getConfiguration("grokCopilot", folder.uri).inspect("profileMap");
    assert.deepEqual(mapInspected.workspaceFolderValue, { personal: "default" });
    const mapped = await provider.provideLanguageModelChatInformation({ silent: true, configuration: { profile: "personal" } }, {});
    assert.equal(mapped[0].id, "default::grok-4.6");

    console.log(JSON.stringify({ provider: "grok", bindingChecks: "committed .vscode/settings.json pins the account, per-entry map repoints a named entry", passed: true }));
  } finally { globalThis.fetch = previousFetch; }
}
module.exports = { run };
