import * as vscode from "vscode";
import { messageOf } from "./errors";
import { XaiOAuth } from "./auth/oauth";
import { GrokProvider } from "./provider";
import { registerCommands } from "./commands";
import type { GrokUsageSnapshot } from "./usage/domain";
import { renderUsageStatus } from "./usage/presentation";

const USAGE_STATE_KEY = "grokCopilot.usageSnapshot.v2";

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("Grok");
  const oauth = new XaiOAuth(context.secrets, {
    userAgent: `grok-copilot-chat/${context.extension.packageJSON.version} VSCode/${vscode.version}`,
  });
  const provider = new GrokProvider(
    oauth,
    output,
    context.globalState.get<GrokUsageSnapshot>(USAGE_STATE_KEY) ?? {},
  );
  const usageStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
  usageStatus.name = "Grok usage and API activity";
  usageStatus.command = "grokCopilot.showUsage";
  renderUsageStatus(usageStatus, provider.getUsageSnapshot());

  context.subscriptions.push(
    output,
    usageStatus,
    provider.onDidChangeUsage((usage) => {
      renderUsageStatus(usageStatus, usage);
      usageStatus.show();
      void context.globalState.update(USAGE_STATE_KEY, usage);
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (
        event.affectsConfiguration("grokCopilot.reasoningEffort")
        || event.affectsConfiguration("grokCopilot.maxOutputTokens")
      ) {
        provider.fireDidChange();
      }
    }),
    vscode.lm.registerLanguageModelChatProvider("xai-grok", provider),
    ...registerCommands(oauth, provider, output, usageStatus),
  );
  output.appendLine(`[activate] Grok for Copilot Chat ${context.extension.packageJSON.version} on VS Code ${vscode.version}`);
  void oauth.hasSession().then((signedIn) => {
    if (!signedIn) return;
    usageStatus.show();
    void provider.refreshUsage().catch((error) => output.appendLine(`[activity] initial refresh failed: ${messageOf(error)}`));
  });
}
