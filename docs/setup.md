# Setup and usage

## Requirements

- Visual Studio Code 1.125 or newer
- GitHub Copilot Chat installed and signed in
- An xAI account with Grok API access or an eligible subscription

A paid Copilot plan is not required for a bring-your-own-key language model provider.

## Install and connect

1. Install the extension from the [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=grikomsn.grok-copilot-chat).
2. Run **Grok: Sign In to xAI** from the Command Palette.
3. Authorize the extension in the browser. If the local callback cannot be reached, run **Grok: Sign In to xAI with Device Code** instead.
4. In Copilot Chat, open the model picker, select **Manage Models**, and enable **xAI Grok**.
5. Select an available Grok model.

## Commands

| Command | Purpose |
| --- | --- |
| **Grok: Manage xAI Connection** | Test the connection, refresh models, show logs, or sign out |
| **Grok: Sign In to xAI** | Start browser/PKCE authorization |
| **Grok: Sign In to xAI with Device Code** | Authorize without a loopback browser callback |
| **Grok: Refresh Models** | Fetch the current model list from xAI |
| **Grok: Show API Activity and Spend** | Show locally tracked billed spend, request tokens, and API rate capacity |
| **Grok: Open xAI Console Usage** | Open account-wide xAI API usage and prepaid credits |
| **Grok: Show Diagnostics** | Show the VS Code version, session state, and registered models |

After the first API call, the status bar shows the exact billed spend accumulated by this extension on this device. Hover it for a summary or click it for a native popup with the tracked total, latest request, token counts, refresh, and account actions. Last-known totals persist across VS Code reloads and are cleared on sign-out.

The request and token values returned in xAI response headers are transient throughput capacity (requests per second and tokens per minute). They can return to their full value quickly and are not cumulative usage or prepaid balance. Account-wide usage and prepaid credits are available in the xAI Console. Reading them programmatically requires a separate Management API key; the extension's normal xAI OAuth session does not have that permission.

## Settings

| Setting | Default | Purpose |
| --- | ---: | --- |
| `grokCopilot.maxOutputTokens` | `16384` | Maximum output tokens requested from Grok |
| `grokCopilot.requestTimeoutSeconds` | `600` | Request timeout in seconds |
| `grokCopilot.debugLogging` | `false` | Log request, usage, stream, and rate-limit metadata to the Grok output channel |

Prompts and OAuth tokens are not written to the output channel.

## Troubleshooting

- **No Grok models in the picker:** enable **xAI Grok** under **Manage Models**, then run **Grok: Refresh Models**.
- **Browser sign-in cannot complete:** cancel it and use the device-code command.
- **Authentication or API errors:** open **Grok: Manage xAI Connection**, test the connection, and inspect the Grok output channel.
- **Context window stays at 0%:** start a new chat after updating the extension. Completed Grok responses report exact input/output usage to VS Code; old sessions do not gain usage retroactively.
- **Need a diagnostic snapshot:** run **Grok: Show Diagnostics** and include the generated report when filing an issue. Remove any information you do not want to share.
