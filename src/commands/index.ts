import * as vscode from "vscode";
import { messageOf } from "../errors";
import { DEFAULT_XAI_PROFILE, normalizeProfileId, XaiOAuth } from "../auth/oauth";
import { GrokProvider } from "../provider";
import { formatUsageRows } from "../usage/domain";
import { toUsageQuickPickItem, type UsageQuickPickItem } from "../usage/presentation";

export function registerCommands(
  oauth: XaiOAuth,
  provider: GrokProvider,
  output: vscode.OutputChannel,
  usageStatus: vscode.StatusBarItem,
): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand("grokCopilot.signIn", () => signInWithBrowser(oauth, provider, output, provider.getActiveProfile())),
    vscode.commands.registerCommand("grokCopilot.signInDevice", () => signInWithDevice(oauth, provider, output, provider.getActiveProfile())),
    vscode.commands.registerCommand("grokCopilot.addAccount", () => addAccount(oauth, provider, output)),
    vscode.commands.registerCommand("grokCopilot.selectProfile", () => selectProfile(oauth, provider)),
    vscode.commands.registerCommand("grokCopilot.refreshModels", () => refreshModels(provider)),
    vscode.commands.registerCommand("grokCopilot.testConnection", () => testConnection(provider, output)),
    vscode.commands.registerCommand("grokCopilot.showUsage", () => showUsage(provider, output)),
    vscode.commands.registerCommand("grokCopilot.openUsage", () => openXaiUsage()),
    vscode.commands.registerCommand("grokCopilot.openSubscriptionUsage", () => openGrokUsage()),
    vscode.commands.registerCommand("grokCopilot.diagnostics", () => diagnostics(oauth, output)),
    vscode.commands.registerCommand("grokCopilot.manage", () => manage(oauth, provider, output, usageStatus)),
  ];
}

async function manage(
  oauth: XaiOAuth,
  provider: GrokProvider,
  output: vscode.OutputChannel,
  usageStatus: vscode.StatusBarItem,
): Promise<void> {
  const profile = provider.getActiveProfile();
  const signedIn = await oauth.hasSession(profile);
  const choices = signedIn
    ? [
    { label: "$(account) Select profile for usage and management", action: "switch" },
        { label: "$(add) Add xAI account", action: "add" },
        { label: "$(graph) Show API activity and spend", action: "usage" },
        { label: "$(credit-card) Open Grok subscription usage", action: "openSubscriptionUsage" },
        { label: "$(link-external) Open xAI Console usage", action: "openUsage" },
        { label: "$(check) Test xAI connection", action: "test" },
        { label: "$(refresh) Refresh Grok models", action: "refresh" },
        { label: "$(output) Show Grok logs", action: "logs" },
        { label: "$(sign-out) Sign out of xAI", action: "signout" },
      ]
    : [
        { label: "$(globe) Sign in to xAI in browser", action: "signin" },
        { label: "$(key) Sign in with a device code", action: "device" },
    { label: "$(account) Select profile for usage and management", action: "switch" },
        { label: "$(add) Add xAI account", action: "add" },
        { label: "$(output) Show Grok logs", action: "logs" },
      ];
  const picked = await vscode.window.showQuickPick(choices, {
    title: `xAI Grok [${profile}] — ${signedIn ? "signed in" : "not signed in"}`,
  });
  if (!picked) return;
  if (picked.action === "signin") await signInWithBrowser(oauth, provider, output, profile);
  else if (picked.action === "device") await signInWithDevice(oauth, provider, output, profile);
  else if (picked.action === "switch") await selectProfile(oauth, provider);
  else if (picked.action === "add") await addAccount(oauth, provider, output);
  else if (picked.action === "refresh") await refreshModels(provider);
  else if (picked.action === "usage") await showUsage(provider, output);
  else if (picked.action === "openSubscriptionUsage") await openGrokUsage();
  else if (picked.action === "openUsage") await openXaiUsage();
  else if (picked.action === "logs") output.show(true);
  else if (picked.action === "test") await testConnection(provider, output);
  else if (picked.action === "signout") {
    await oauth.signOut(profile);
    provider.clearUsage(profile);
    usageStatus.hide();
    provider.fireDidChange();
    vscode.window.showInformationMessage(`Signed out of xAI profile “${profile}”.`);
  }
}

async function signInWithBrowser(
  oauth: XaiOAuth,
  provider: GrokProvider,
  output: vscode.OutputChannel,
  profile = DEFAULT_XAI_PROFILE,
): Promise<void> {
  let attempt: Awaited<ReturnType<XaiOAuth["startBrowserSignIn"]>> | undefined;
  try {
    attempt = await oauth.startBrowserSignIn(profile);
    const opened = await vscode.env.openExternal(vscode.Uri.parse(attempt.url));
    if (!opened) throw new Error("VS Code could not open the xAI authorization page");
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "Waiting for xAI browser sign-in…", cancellable: true },
      async (_progress, cancellation) => {
        const listener = cancellation.onCancellationRequested(() => attempt?.cancel());
        try {
          await attempt?.completion;
        } finally {
          listener.dispose();
        }
      },
    );
    provider.setActiveProfile(profile);
    const models = await provider.refreshModels(profile);
    void provider.refreshUsage(profile).catch((error) => output.appendLine(`[activity] post-sign-in refresh failed: ${messageOf(error)}`));
    vscode.window.showInformationMessage(`Signed in to xAI profile “${profile}”. Found ${models.length} Grok models.`);
  } catch (error) {
    attempt?.cancel();
    const message = messageOf(error);
    output.appendLine(`[oauth] ${message}`);
    vscode.window.showErrorMessage(`xAI sign-in failed: ${message}`);
  }
}

async function signInWithDevice(
  oauth: XaiOAuth,
  provider: GrokProvider,
  output: vscode.OutputChannel,
  profile = DEFAULT_XAI_PROFILE,
): Promise<void> {
  try {
    const device = await oauth.requestDeviceCode();
    const url = device.verification_uri_complete ?? device.verification_uri;
    await vscode.env.clipboard.writeText(device.user_code);
    const opened = await vscode.env.openExternal(vscode.Uri.parse(url));
    if (!opened) throw new Error(`Open ${device.verification_uri} and enter code ${device.user_code}`);
    vscode.window.showInformationMessage(`xAI sign-in code ${device.user_code} copied to the clipboard.`);
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "Waiting for xAI sign-in…", cancellable: true },
      async (_progress, cancellation) => {
        const controller = new AbortController();
        const listener = cancellation.onCancellationRequested(() => controller.abort());
        try {
          await oauth.completeDeviceSignIn(device, controller.signal, profile);
        } finally {
          listener.dispose();
        }
      },
    );
    provider.setActiveProfile(profile);
    const models = await provider.refreshModels(profile);
    void provider.refreshUsage(profile).catch((error) => output.appendLine(`[activity] post-sign-in refresh failed: ${messageOf(error)}`));
    vscode.window.showInformationMessage(`Signed in to xAI profile “${profile}”. Found ${models.length} Grok models.`);
  } catch (error) {
    const message = messageOf(error);
    output.appendLine(`[oauth] ${message}`);
    vscode.window.showErrorMessage(`xAI sign-in failed: ${message}`);
  }
}

async function addAccount(oauth: XaiOAuth, provider: GrokProvider, output: vscode.OutputChannel): Promise<void> {
  const value = await vscode.window.showInputBox({
    title: "Add xAI account",
    prompt: "Choose the profile ID you will enter when adding xAI Grok in Manage Language Models.",
    placeHolder: "personal or work",
    ignoreFocusOut: true,
    validateInput: (input) => {
      try { normalizeProfileId(input); return undefined; } catch (error) { return messageOf(error); }
    },
  });
  if (!value) return;
  const profile = normalizeProfileId(value);
  if (await oauth.hasSession(profile)) {
    const replace = await vscode.window.showWarningMessage(
      `Replace the xAI session stored for profile “${profile}”?`,
      { modal: true },
      "Replace",
    );
    if (replace !== "Replace") return;
  }
  const method = await vscode.window.showQuickPick([
    { label: "$(globe) Sign in in browser", method: "browser" as const },
    { label: "$(key) Sign in with a device code", method: "device" as const },
  ], { title: `Sign in to xAI profile “${profile}”` });
  if (!method) return;
  if (method.method === "browser") await signInWithBrowser(oauth, provider, output, profile);
  else await signInWithDevice(oauth, provider, output, profile);
  if (await oauth.hasSession(profile)) {
    vscode.window.showInformationMessage(`Add xAI Grok in Manage Language Models and enter profile “${profile}”.`);
  }
}

async function selectProfile(oauth: XaiOAuth, provider: GrokProvider): Promise<void> {
  const profiles = await oauth.listProfiles();
  if (!profiles.length) {
    vscode.window.showInformationMessage("No xAI Grok profiles are signed in yet.");
    return;
  }
  const picked = await vscode.window.showQuickPick(
    await Promise.all(profiles.map(async (profile) => {
      const session = await oauth.readSession(profile);
      return { label: profile, description: session?.email ?? "Signed in", profile };
    })),
    { title: "Select the active xAI Grok profile" },
  );
  if (!picked) return;
  provider.setActiveProfile(picked.profile);
  vscode.window.showInformationMessage(`xAI Grok profile “${picked.profile}” is now active for usage and management commands.`);
}

async function refreshModels(provider: GrokProvider): Promise<void> {
  try {
    const models = await provider.refreshModels();
    vscode.window.showInformationMessage(`Refreshed ${models.length} Grok models.`);
  } catch (error) {
    vscode.window.showErrorMessage(messageOf(error));
  }
}

async function testConnection(provider: GrokProvider, output: vscode.OutputChannel): Promise<void> {
  try {
    const result = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "Testing xAI Grok…" },
      () => provider.testConnection(),
    );
    output.appendLine(`[test] model=${result.model} response=${result.text}`);
    vscode.window.showInformationMessage(`xAI verified with ${result.model}: ${result.text}`);
  } catch (error) {
    output.appendLine(`[test] ${messageOf(error)}`);
    vscode.window.showErrorMessage(`xAI connection test failed: ${messageOf(error)}`);
  }
}

async function showUsage(provider: GrokProvider, output: vscode.OutputChannel): Promise<void> {
  const profile = provider.getActiveProfile();
  let snapshot = provider.getUsageSnapshot();
  try {
    snapshot = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window, title: "Refreshing Grok usage…" },
      () => provider.refreshUsage(),
    );
  } catch (error) {
    output.appendLine(`[activity] refresh failed: ${messageOf(error)}`);
    if (!snapshot.updatedAt) vscode.window.showWarningMessage(`Unable to refresh Grok API activity: ${messageOf(error)}`);
  }
  const picked = await vscode.window.showQuickPick<UsageQuickPickItem>([
    ...formatUsageRows(snapshot).map(toUsageQuickPickItem),
    { label: "Account", kind: vscode.QuickPickItemKind.Separator },
    { label: "$(credit-card) Open Grok subscription usage", description: "Weekly usage, Extra Usage Credits, and auto top-up", action: "openSubscriptionUsage", alwaysShow: true },
    { label: "$(link-external) Open xAI Console usage", description: "Account-wide API usage and prepaid credits", action: "openUsage", alwaysShow: true },
    { label: "$(refresh) Refresh rate capacity", description: "Check the xAI API again", action: "refresh", alwaysShow: true },
  ], {
    title: snapshot.updatedAt
      ? `Grok usage [${profile}] — updated ${new Date(snapshot.updatedAt).toLocaleTimeString()}`
      : `Grok usage [${profile}]`,
    placeHolder: "Subscription usage, exact billed spend, and transient API rate capacity",
    matchOnDescription: true,
    matchOnDetail: true,
  });
  if (picked?.action === "openSubscriptionUsage") await openGrokUsage();
  else if (picked?.action === "openUsage") await openXaiUsage();
  else if (picked?.action === "refresh") await showUsage(provider, output);
}

async function openGrokUsage(): Promise<void> {
  const opened = await vscode.env.openExternal(vscode.Uri.parse("https://grok.com?_s=usage"));
  if (!opened) vscode.window.showWarningMessage("VS Code could not open Grok subscription usage.");
}

async function openXaiUsage(): Promise<void> {
  const opened = await vscode.env.openExternal(vscode.Uri.parse("https://console.x.ai/team/default/usage"));
  if (!opened) vscode.window.showWarningMessage("VS Code could not open the xAI Console usage page.");
}

async function diagnostics(oauth: XaiOAuth, output: vscode.OutputChannel): Promise<void> {
  const models = await vscode.lm.selectChatModels({ vendor: "xai-grok" });
  const profiles = await oauth.listProfiles();
  const lines = [
    "# Grok for Copilot Chat diagnostics", "", `- VS Code: ${vscode.version}`,
    `- xAI OAuth profiles: ${profiles.length ? profiles.join(", ") : "none"}`,
    `- Registered models: ${models.length}`, "",
    ...models.map((model) => `- ${model.id} (${model.maxInputTokens} input tokens)`),
  ];
  output.appendLine(`[diagnostics] models=${models.length}`);
  const doc = await vscode.workspace.openTextDocument({ content: lines.join("\n"), language: "markdown" });
  await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
}
