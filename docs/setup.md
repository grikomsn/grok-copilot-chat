# Setup and usage

## Requirements

- Visual Studio Code 1.125 or newer
- GitHub Copilot Chat installed and signed in
- An xAI account with Grok API access or an eligible subscription

A paid Copilot plan is not required for a bring-your-own-key language model provider.

## Install and connect

1. Install the extension from the [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=grikomsn.grok-copilot-chat).
2. Run **Grok: Add xAI Account**, choose a profile ID such as `personal`, and authorize the extension in the browser.
3. Open **Manage Language Models**, choose **Add Models**, select **xAI Grok**, and enter that profile ID.
4. Repeat those steps with a different profile ID to add another xAI account. Browser sign-ins are sequential because the temporary loopback callback uses one local port.
5. Enable the models you want and select one in Copilot Chat. Usage, refresh state, and the live model catalog follow the selected profile. Leaving the profile field empty preserves the legacy `default` account.

If the local callback cannot be reached, select the intended profile with **Grok: Select Active Profile** and run **Grok: Sign In to xAI with Device Code**.

Reasoning-capable models expose a native **Reasoning Effort** control in the Copilot Chat model picker and default to High. Models also expose a **Web Search** toggle; it is off by default, routes enabled requests through xAI's Responses API, and overrides the `grokCopilot.webSearch` workspace default for that request. The available reasoning choices follow the selected model: Grok 4.6 offers Low, Medium, High, and Extra High; Grok 4.5 offers Low, Medium, and High; Grok 4.3 offers None, Low, Medium, and High; Grok multi-agent models can additionally expose Extra High. Retired fast-model aliases do not expose a reasoning picker because their legacy contracts do not accept the current reasoning parameter.

## Commands

| Command | Purpose |
| --- | --- |
| **Grok: Manage xAI Connection** | Test the connection, refresh models, show logs, or sign out |
| **Grok: Add xAI Account** | Create or replace a named OAuth profile |
| **Grok: Select Active Profile** | Choose the profile used by usage and management commands; this choice is restored after restart and does not change model-entry routing |
| **Grok: Sign In to xAI** | Start browser/PKCE authorization |
| **Grok: Sign In to xAI with Device Code** | Authorize without a loopback browser callback |
| **Grok: Refresh Models** | Fetch the current model list from xAI |
| **Grok: Test Connection** | Send a small live inference request |
| **Grok: Show API Activity and Spend** | Show locally tracked billed spend, request tokens, and API rate capacity |
| **Grok: Open Subscription Usage** | Open Grok weekly usage, reset date, Extra Usage Credits, and auto top-up |
| **Grok: Open xAI Console Usage** | Open account-wide xAI API usage and prepaid credits |
| **Grok: Show Diagnostics** | Show the VS Code version, session state, and registered models |

After sign-in, the extension refreshes the read-only Grok subscription snapshot when the account exposes it. The status bar and popup can show the current weekly usage percentage, the scheduled reset date, Extra Usage Credits, and auto top-up status. After an API call, the same popup also shows exact billed spend accumulated by this extension on this device. Last-known totals and account snapshots persist across VS Code reloads and are cleared on sign-out.

The request and token values returned in xAI response headers are transient throughput capacity (requests per second and tokens per minute). They can return to their full value quickly and are not subscription usage or prepaid balance. Subscription usage is read-only; use **Grok: Open Subscription Usage** to change billing or purchase credits. Account-wide API usage and prepaid API credits remain available in the xAI Console.

## Settings

| Setting | Default | Purpose |
| --- | ---: | --- |
| `grokCopilot.reasoningEffort` | `high` | Default effort for reasoning-capable models; the model-picker selection overrides it |
| `grokCopilot.webSearch` | `false` | Allow xAI's native web search and route requests through the Responses API |
| `grokCopilot.maxOutputTokens` | `16384` | Maximum output tokens requested from Grok |
| `grokCopilot.requestTimeoutSeconds` | `600` | Request timeout in seconds |
| `grokCopilot.catalogCacheMinutes` | `5` | Model metadata refresh interval |
| `grokCopilot.debugLogging` | `false` | Log request, usage, stream, and rate-limit metadata to the Grok output channel |
| `grokCopilot.showUsageStatusBar` | `true` | Show API activity and subscription usage in the status bar |

The authenticated xAI `/models` response remains authoritative. Fields it omits are enriched from the canonical `xai` provider in a six-hour models.dev snapshot stored in VS Code `globalState`. Stale metadata is returned immediately while refresh runs and remains available during models.dev outages.

Prompts and OAuth tokens are not written to the output channel.

## Troubleshooting

- **No Grok models in the picker:** sign in with **Grok: Add xAI Account**, then add an xAI Grok entry with the same profile ID in **Manage Language Models**.
- **Browser sign-in cannot complete:** cancel it and use the device-code command.
- **Authentication or API errors:** open **Grok: Manage xAI Connection**, test the connection, and inspect the Grok output channel.
- **Context window stays at 0%:** start a new chat after updating the extension. Completed Grok responses report exact input/output usage to VS Code; old sessions do not gain usage retroactively.
- **Need a diagnostic snapshot:** run **Grok: Show Diagnostics** and include the generated report when filing an issue. Remove any information you do not want to share.
