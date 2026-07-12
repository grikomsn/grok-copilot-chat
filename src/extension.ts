import * as vscode from "vscode";
import { XaiOAuth } from "./oauth";
import { GrokProvider } from "./provider";

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("Grok");
  const oauth = new XaiOAuth(context.secrets, {
    userAgent: `grok-copilot-chat/${context.extension.packageJSON.version} VSCode/${vscode.version}`,
  });
  const provider = new GrokProvider(oauth, output);

  context.subscriptions.push(
    output,
    provider.onDidChangeLanguageModelChatInformation(() => undefined),
    vscode.lm.registerLanguageModelChatProvider("xai-grok", provider),
    vscode.commands.registerCommand("grokCopilot.signIn", () => signInWithBrowser(oauth, provider, output)),
    vscode.commands.registerCommand("grokCopilot.signInDevice", () => signInWithDevice(oauth, provider, output)),
    vscode.commands.registerCommand("grokCopilot.refreshModels", () => refreshModels(provider)),
    vscode.commands.registerCommand("grokCopilot.diagnostics", () => diagnostics(oauth, provider, output)),
    vscode.commands.registerCommand("grokCopilot.manage", () => manage(oauth, provider, output)),
  );
  output.appendLine(`[activate] Grok for Copilot Chat ${context.extension.packageJSON.version} on VS Code ${vscode.version}`);
}

export function deactivate(): void {}

async function manage(oauth: XaiOAuth, provider: GrokProvider, output: vscode.OutputChannel): Promise<void> {
  const signedIn = await oauth.hasSession();
  const choices = signedIn
    ? [
        { label: "$(check) Test xAI connection", action: "test" },
        { label: "$(refresh) Refresh Grok models", action: "refresh" },
        { label: "$(output) Show Grok logs", action: "logs" },
        { label: "$(sign-out) Sign out of xAI", action: "signout" },
      ]
    : [
        { label: "$(globe) Sign in to xAI in browser", action: "signin" },
        { label: "$(key) Sign in with a device code", action: "device" },
        { label: "$(output) Show Grok logs", action: "logs" },
      ];
  const picked = await vscode.window.showQuickPick(choices, {
    title: `xAI Grok — ${signedIn ? "signed in" : "not signed in"}`,
  });
  if (!picked) return;
  if (picked.action === "signin") await signInWithBrowser(oauth, provider, output);
  else if (picked.action === "device") await signInWithDevice(oauth, provider, output);
  else if (picked.action === "refresh") await refreshModels(provider);
  else if (picked.action === "logs") output.show(true);
  else if (picked.action === "test") await testConnection(provider, output);
  else if (picked.action === "signout") {
    await oauth.signOut();
    provider.fireDidChange();
    vscode.window.showInformationMessage("Signed out of xAI.");
  }
}

async function signInWithBrowser(
  oauth: XaiOAuth,
  provider: GrokProvider,
  output: vscode.OutputChannel,
): Promise<void> {
  let attempt: Awaited<ReturnType<XaiOAuth["startBrowserSignIn"]>> | undefined;
  try {
    attempt = await oauth.startBrowserSignIn();
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
    const models = await provider.refreshModels();
    vscode.window.showInformationMessage(`Signed in to xAI. Found ${models.length} Grok models.`);
  } catch (error) {
    attempt?.cancel();
    const message = messageOf(error);
    output.appendLine(`[oauth] ${message}`);
    vscode.window.showErrorMessage(`xAI sign-in failed: ${message}`);
  }
}

async function signInWithDevice(oauth: XaiOAuth, provider: GrokProvider, output: vscode.OutputChannel): Promise<void> {
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
          await oauth.completeDeviceSignIn(device, controller.signal);
        } finally {
          listener.dispose();
        }
      },
    );
    const models = await provider.refreshModels();
    vscode.window.showInformationMessage(`Signed in to xAI. Found ${models.length} Grok models.`);
  } catch (error) {
    const message = messageOf(error);
    output.appendLine(`[oauth] ${message}`);
    vscode.window.showErrorMessage(`xAI sign-in failed: ${message}`);
  }
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

async function diagnostics(
  oauth: XaiOAuth,
  _provider: GrokProvider,
  output: vscode.OutputChannel,
): Promise<void> {
  const models = await vscode.lm.selectChatModels({ vendor: "xai-grok" });
  const lines = [
    "# Grok for Copilot Chat diagnostics",
    "",
    `- VS Code: ${vscode.version}`,
    `- xAI OAuth session: ${(await oauth.hasSession()) ? "present" : "missing"}`,
    `- Registered models: ${models.length}`,
    "",
    ...models.map((model) => `- ${model.id} (${model.maxInputTokens} input tokens)`),
  ];
  output.appendLine(`[diagnostics] models=${models.length}`);
  const doc = await vscode.workspace.openTextDocument({ content: lines.join("\n"), language: "markdown" });
  await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
