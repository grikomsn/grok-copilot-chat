import * as vscode from "vscode";
import { messageOf } from "../errors";
import { DEFAULT_XAI_PROFILE, normalizeProfileId, XaiOAuth } from "../auth/oauth";
import { GrokProvider } from "../provider";
import { formatUsageRows } from "../usage/domain";
import { toUsageQuickPickItem, type UsageQuickPickItem } from "../usage/presentation";
import { PROFILE_SETTING } from "../workspace-binding";
import { signInSelection } from "../auth/selection";

export function registerCommands(
  oauth: XaiOAuth,
  provider: GrokProvider,
  output: vscode.OutputChannel,
  usageStatus: vscode.StatusBarItem,
): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand("grokCopilot.signIn", () => signIn(oauth, provider, output, provider.getActiveProfile(), { explicit: true })),
    vscode.commands.registerCommand("grokCopilot.addAccount", () => addAccount(oauth, provider, output)),
    vscode.commands.registerCommand("grokCopilot.configureEntry", () => configureEntry(oauth, provider, output)),
    provider.onSignInRequested((request) => {
      void autoSignInForProfile(oauth, provider, output, request.profile, request.explicit);
    }),
    vscode.commands.registerCommand("grokCopilot.selectProfile", () => selectProfile(oauth, provider)),
    vscode.commands.registerCommand("grokCopilot.bindAccountToWorkspace", () => bindAccountToWorkspace(oauth, provider)),
    vscode.commands.registerCommand("grokCopilot.refreshModels", () => refreshModels(provider)),
    vscode.commands.registerCommand("grokCopilot.testConnection", () => testConnection(provider, output)),
    vscode.commands.registerCommand("grokCopilot.showUsage", () => showUsage(provider, output)),
    vscode.commands.registerCommand("grokCopilot.openUsage", () => openXaiUsage()),
    vscode.commands.registerCommand("grokCopilot.openSubscriptionUsage", () => openGrokUsage()),
    vscode.commands.registerCommand("grokCopilot.diagnostics", () => diagnostics(oauth, output)),
    vscode.commands.registerCommand("grokCopilot.manage", () => manage(oauth, provider, output, usageStatus)),
  ];
}

/**
 * Offers sign-in when a natively added entry names a profile with no session.
 * Suppressed while the extension's own provisioning command resolves the fresh
 * group, and debounced by the provider gate on repeated host re-resolves.
 */
async function autoSignInForProfile(
  oauth: XaiOAuth,
  provider: GrokProvider,
  output: vscode.OutputChannel,
  profile: string,
  explicit: boolean,
): Promise<void> {
  if (await oauth.hasSession(profile)) return;
  const action = await vscode.window.showInformationMessage(
    `xAI Grok entry “${profile}” is not signed in yet. Sign in now?`,
    "Sign in",
    "Later",
  );
  // An entry the user created is selected by signing in to it. A profile a
  // workspace binding selected was not the user's choice, so it is not.
  if (action === "Sign in") await signIn(oauth, provider, output, profile, { explicit });
}

async function manage(
  oauth: XaiOAuth,
  provider: GrokProvider,
  output: vscode.OutputChannel,
  usageStatus: vscode.StatusBarItem,
): Promise<void> {
  const profile = provider.getActiveProfile();
  const effective = provider.getEffectiveProfile();
  const bound = effective !== profile;
  // Usage and management use the account the user selected. A binding only
  // routes chat requests, so it does not take over these commands.
  const signedIn = await oauth.hasSession(profile);
  const bindChoice = { label: "$(folder) Bind account to this workspace", action: "bind" };
  const choices = signedIn
    ? [
        { label: "$(account) Select profile for usage and management", action: "switch" },
        bindChoice,
        { label: "$(add) Add xAI account", action: "add" },
        { label: "$(list-tree) Reconcile accounts and observed entries", action: "reconcile" },
        { label: "$(graph) Show API activity and spend", action: "usage" },
        { label: "$(credit-card) Open Grok subscription usage", action: "openSubscriptionUsage" },
        { label: "$(link-external) Open xAI Console usage", action: "openUsage" },
        { label: "$(check) Test xAI connection", action: "test" },
        { label: "$(refresh) Refresh Grok models", action: "refresh" },
        { label: "$(output) Show Grok logs", action: "logs" },
        { label: "$(sign-out) Sign out of xAI", action: "signout" },
      ]
    : [
        { label: "$(globe) Sign in to xAI", action: "signin" },
        { label: "$(account) Select profile for usage and management", action: "switch" },
        bindChoice,
        { label: "$(add) Add xAI account", action: "add" },
        { label: "$(list-tree) Reconcile accounts and observed entries", action: "reconcile" },
        { label: "$(output) Show Grok logs", action: "logs" },
      ];
  const picked = await vscode.window.showQuickPick(choices, {
    title: bound
      ? `xAI Grok [${profile}] — ${signedIn ? "signed in" : "not signed in"} — requests use ${effective}`
      : `xAI Grok [${profile}] — ${signedIn ? "signed in" : "not signed in"}`,
  });
  if (!picked) return;
  if (picked.action === "reconcile") {
    const result = await provider.reconcileAccounts();
    const detail = [
      `Observed profiles without sessions: ${result.entriesWithoutSessions.join(", ") || "none"}`,
      `Signed-in profiles not observed by discovery: ${result.accountsWithoutObservedEntries.join(", ") || "none"}`,
    ].join("\n");
    const action = await vscode.window.showInformationMessage(detail, "Manage Language Models");
    if (action === "Manage Language Models") await vscode.commands.executeCommand("workbench.action.chat.manageLanguageModels");
  } else if (picked.action === "signin") await signIn(oauth, provider, output, profile, { explicit: true });
  else if (picked.action === "switch") await selectProfile(oauth, provider);
  else if (picked.action === "bind") await bindAccountToWorkspace(oauth, provider);
  else if (picked.action === "add") await addAccount(oauth, provider, output);
  else if (picked.action === "refresh") await refreshModels(provider);
  else if (picked.action === "usage") await showUsage(provider, output);
  else if (picked.action === "openSubscriptionUsage") await openGrokUsage();
  else if (picked.action === "openUsage") await openXaiUsage();
  else if (picked.action === "logs") output.show(true);
  else if (picked.action === "test") await testConnection(provider, output);
  else if (picked.action === "signout") {
    // Sign out of the account the menu named, which is the account the user
    // selected for usage and management.
    await oauth.signOut(profile);
    provider.clearUsage(profile);
    usageStatus.hide();
    provider.fireDidChange();
    vscode.window.showInformationMessage(`Signed out of xAI profile “${profile}”.`);
  }
}

/**
 * Applies the account selection that follows a sign-in.
 *
 * The decision uses the origin captured when the sign-in was requested, not
 * the binding as it stands now. The binding may have changed while the
 * authorization was in progress, and a named-entry mapping is a binding that
 * the default-entry check does not see.
 */
export function applySignInSelection(
  provider: GrokProvider,
  profile: string,
  explicit: boolean,
): void {
  if (signInSelection(explicit) === "select") provider.setActiveProfile(profile);
}

/**
 * Device-authorization (RFC 8628) sign-in: opens the verification URL with the
 * user code pre-filled and polls until the session is stored. Works without a
 * loopback callback port, so it also covers remote workspaces.
 */
export async function signIn(
  oauth: XaiOAuth,
  provider: GrokProvider,
  output: vscode.OutputChannel,
  profile = DEFAULT_XAI_PROFILE,
  options: { readonly explicit?: boolean } = {},
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
    provider.clearUsage(profile);
    applySignInSelection(provider, profile, options.explicit === true);
    const models = await provider.refreshModels(profile);
    void provider.refreshUsage(profile).catch((error) => output.appendLine(`[activity] post-sign-in refresh failed: ${messageOf(error)}`));
    vscode.window.showInformationMessage(`Signed in to xAI profile “${profile}”. Found ${models.length} Grok models.`);
    await provisionEntryAfterSignIn(provider, profile);
  } catch (error) {
    const message = messageOf(error);
    output.appendLine(`[oauth] ${message}`);
    vscode.window.showErrorMessage(`xAI sign-in failed: ${message}`);
  }
}

async function addAccount(oauth: XaiOAuth, provider: GrokProvider, output: vscode.OutputChannel): Promise<void> {
  const value = await vscode.window.showInputBox({
    title: "Add xAI account",
    prompt: "Choose the profile ID for this account; it is also used as the entry name in Manage Language Models.",
    placeHolder: "personal or work",
    ignoreFocusOut: true,
    validateInput: (input) => {
      try { normalizeProfileId(input); return undefined; } catch (error) { return messageOf(error); }
    },
  });
  if (!value) return;
  const profile = normalizeProfileId(value);
  if (!await addAccountForProfile(oauth, provider, output, profile)) return;
  await provisionEntryAfterSignIn(provider, profile);
}

/**
 * Provisions the native entry for a freshly signed-in profile when the user
 * has not added one yet. The discovery journal skips profiles that already
 * have an entry, and the suppression latch keeps the provisioning resolve
 * from re-triggering auto sign-in.
 */
async function provisionEntryAfterSignIn(provider: GrokProvider, profile: string): Promise<void> {
  if (provider.hasObservedProfile(profile)) return;
  provider.suppressNextAutoSignIn(profile);
  try {
    // The host command destructures {vendor, name, ...configuration}; the rest
    // becomes the entry's stored configuration verbatim.
    await vscode.commands.executeCommand("lm.migrateLanguageModelsProviderGroup", {
      vendor: "xai-grok",
      name: profile,
      profile,
    });
  } catch {
    await vscode.commands.executeCommand("workbench.action.chat.manageLanguageModels");
    vscode.window.showInformationMessage(`Sign-in complete. Add xAI Grok in Manage Language Models and enter profile “${profile}”.`);
  }
}

/**
 * Native management-command configure flow: provisions the entry group first
 * (so it appears in Manage Language Models even before signing in), then runs
 * sign-in only when that profile has no session yet. The first provisioning
 * resolve is suppressed so it is not mistaken for a native add.
 */
async function configureEntry(oauth: XaiOAuth, provider: GrokProvider, output: vscode.OutputChannel): Promise<void> {
  const value = await vscode.window.showInputBox({
    title: "Add xAI Grok entry",
    prompt: "Choose a profile ID for this entry.",
    placeHolder: "personal or work",
    ignoreFocusOut: true,
    validateInput: (input) => {
      try { normalizeProfileId(input); return undefined; } catch (error) { return messageOf(error); }
    },
  });
  if (!value) return;
  const profile = normalizeProfileId(value);
  provider.suppressNextAutoSignIn(profile);
  try {
    // The host command destructures {vendor, name, ...configuration}; the rest
    // becomes the entry's stored configuration verbatim.
    await vscode.commands.executeCommand("lm.migrateLanguageModelsProviderGroup", {
      vendor: "xai-grok",
      name: profile,
      profile,
    });
  } catch {
    // Host version without the provisioning command: fall back to the editor.
    await vscode.commands.executeCommand("workbench.action.chat.manageLanguageModels");
  }
  if (await oauth.hasSession(profile)) {
    provider.setActiveProfile(profile);
    vscode.window.showInformationMessage(`xAI Grok entry “${profile}” is ready in Manage Language Models.`);
    return;
  }
  await addAccountForProfile(oauth, provider, output, profile);
}

async function addAccountForProfile(oauth: XaiOAuth, provider: GrokProvider, output: vscode.OutputChannel, profile: string): Promise<boolean> {
  if (await oauth.hasSession(profile)) {
    // Adding an account the user named selects it. A workspace that is bound
    // to another account keeps ownership of its own requests, but the user's
    // choice for usage and management still follows what they just added.
    provider.setActiveProfile(profile);
    vscode.window.showInformationMessage(`xAI profile “${profile}” is already signed in.`);
    return true;
  }
  await signIn(oauth, provider, output, profile, { explicit: true });
  return oauth.hasSession(profile);
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
    { title: "Select the xAI Grok profile for usage and management" },
  );
  if (!picked) return;
  provider.setActiveProfile(picked.profile);
  const bound = provider.getEffectiveProfile() !== picked.profile;
  const message = bound
    ? `xAI Grok profile “${picked.profile}” is now active for usage and management. This workspace stays bound to “${provider.getEffectiveProfile()}”, so its requests keep using that account.`
    : `xAI Grok profile “${picked.profile}” is now active for usage and management. Chat requests keep using the account attached to the selected model entry.`;
  const choose = await vscode.window.showInformationMessage(message, "Choose Chat Model");
  if (choose === "Choose Chat Model") await vscode.commands.executeCommand("workbench.action.chat.openModelPicker");
}

/**
 * Binds the current workspace to a signed-in xAI account.
 *
 * The binding is written to the workspace settings so the repository keeps
 * using that account. It is only written to the user settings when no folder
 * is open, because a folder-scoped value is what a repository can share.
 */
async function bindAccountToWorkspace(oauth: XaiOAuth, provider: GrokProvider): Promise<void> {
  const profiles = await oauth.listProfiles();
  if (!profiles.length) {
    vscode.window.showInformationMessage("No xAI Grok profiles are signed in yet. Run Grok: Add xAI Account first.");
    return;
  }
  const folder = vscode.workspace.workspaceFolders?.[0];
  const picked = await vscode.window.showQuickPick(
    await Promise.all(profiles.map(async (profile) => {
      const session = await oauth.readSession(profile);
      return { label: profile, description: session?.email ?? "Signed in", profile };
    })),
    {
      title: folder
        ? `Bind this workspace to an xAI Grok account (${folder.name})`
        : "Bind this workspace to an xAI Grok account",
      placeHolder: "The account used by Grok models in this workspace",
    },
  );
  if (!picked) return;
  const target = folder
    ? vscode.ConfigurationTarget.WorkspaceFolder
    : vscode.ConfigurationTarget.Global;
  try {
    await vscode.workspace
      .getConfiguration("grokCopilot", folder?.uri)
      .update(PROFILE_SETTING, picked.profile, target);
  } catch (error) {
    vscode.window.showErrorMessage(`Could not bind this workspace: ${messageOf(error)}`);
    return;
  }
  provider.clearModelCache();
  provider.fireDidChange();
  vscode.window.showInformationMessage(
    folder
      ? `This workspace now uses the xAI Grok profile “${picked.profile}”.`
      : `xAI Grok now uses the profile “${picked.profile}” in this window.`,
  );
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
    output.appendLine(`[test] model=${result.model} completed`);
    vscode.window.showInformationMessage(`xAI verified with ${result.model}: ${result.text}`);
  } catch (error) {
    output.appendLine(`[test] ${messageOf(error)}`);
    vscode.window.showErrorMessage(`xAI connection test failed: ${messageOf(error)}`);
  }
}

async function showUsage(provider: GrokProvider, output: vscode.OutputChannel): Promise<void> {
  // The usage popup reports the account the user selected for usage and
  // management. A workspace binding only routes chat requests.
  const profile = provider.getActiveProfile();
  let snapshot = provider.getUsageSnapshot(profile);
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
