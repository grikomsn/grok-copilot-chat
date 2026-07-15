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
| **Grok: Show Usage Limits** | Refresh and show remaining Grok query/API limits |
| **Grok: Open Account Usage** | Open Grok's weekly allowance and credits page |
| **Grok: Show Diagnostics** | Show the VS Code version, session state, and registered models |

The status bar shows the last query window returned by Grok, or the latest request/token limits returned in xAI API headers. Hover it for a summary or click it for a native popup with exact values, refresh, and account actions. Last-known counts persist across VS Code reloads. Weekly allowance, reset date, and Extra Usage Credits remain on Grok's account Usage page.

## Settings

| Setting | Default | Purpose |
| --- | ---: | --- |
| `grokCopilot.maxOutputTokens` | `16384` | Maximum output tokens requested from Grok |
| `grokCopilot.requestTimeoutSeconds` | `600` | Request timeout in seconds |
| `grokCopilot.debugLogging` | `false` | Log request and stream metadata to the Grok output channel |

Prompts and OAuth tokens are not written to the output channel.

## Troubleshooting

- **No Grok models in the picker:** enable **xAI Grok** under **Manage Models**, then run **Grok: Refresh Models**.
- **Browser sign-in cannot complete:** cancel it and use the device-code command.
- **Authentication or API errors:** open **Grok: Manage xAI Connection**, test the connection, and inspect the Grok output channel.
- **Need a diagnostic snapshot:** run **Grok: Show Diagnostics** and include the generated report when filing an issue. Remove any information you do not want to share.
