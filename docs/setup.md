# Setup and usage

## Requirements

- Visual Studio Code 1.125 or newer
- GitHub Copilot Chat installed and signed in
- An xAI account with Grok API access or an eligible subscription

A paid Copilot plan is not required for a bring-your-own-key language model provider.

## Install and connect

1. Install the extension from the [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=grikomsn.grok-copilot-chat).
2. Open **Manage Language Models**, choose **Add Models**, select **xAI Grok**, and follow the prompts (group name and profile ID). The entry lists no models until the profile is signed in, and Grok then offers to sign in right away. Conversely, **Grok: Add xAI Account** (or **Grok: Sign In to xAI**) provisions the matching entry automatically when none exists yet. On hosts without the provisioning command, finish by re-adding the entry with the same profile ID.
3. Repeat those steps with a different profile ID to add another xAI account. Sign-ins are sequential per profile; the device-code authorization opens xAI's verification page with the user code pre-filled.
4. Enable the models you want and select one in Copilot Chat. Usage, refresh state, and the live model catalog follow the selected profile. The profile field defaults to `default`. Every model ID is qualified by its profile, including `default`. After upgrading from 0.x, reselect your Grok model in a new chat; unqualified model IDs and old singleton usage snapshots are no longer supported.

## Bind an account to a workspace

A repository can be pinned to a specific xAI account. Run **Grok: Bind Account to This Workspace** and pick a signed-in profile; the binding is written to the workspace settings, so every window that opens that repository uses that account.

To do it by hand, set `grokCopilot.profile` in `.vscode/settings.json`:

```json
{
  "grokCopilot.profile": "work"
}
```

The setting is resource scoped, so it also accepts a folder setting or a `.code-workspace` value. It repoints the entry named `default`. To repoint an entry that names another profile, use `grokCopilot.profileMap`:

```json
{
  "grokCopilot.profileMap": {
    "work": "personal"
  }
}
```

| Scope | Honoured in an untrusted workspace | Notes |
| --- | --- | --- |
| Folder (`.vscode/settings.json`) | No | Controlled by the repository, so it is only read in a workspace VS Code trusts |
| Workspace (`.code-workspace`) | No | Same rule as the folder scope |
| User (`settings.json`) | Yes | Controlled by the user |

`grokCopilot.workspaceBinding` controls this. `trusted` (the default) only honours folder and workspace bindings in a trusted workspace, `on` always honours them, and `off` ignores them entirely.

The mode itself is only read from the user settings. A repository cannot set `grokCopilot.workspaceBinding` to relax the trust gate for itself, and it cannot undo a user who set it to `off`.

A binding changes which account the Grok models use in the current repository. It does not change the account of a chat that is already running, and it does not move tokens: every profile keeps its own stored session, usage, and model catalog.

Reasoning-capable models expose a native **Reasoning Effort** control in the Copilot Chat model picker and default to High. Models also expose a **Web Search** toggle; it is off by default, routes enabled requests through xAI's Responses API, and overrides the `grokCopilot.webSearch` workspace default for that request. The available reasoning choices follow the selected model: Grok 4.6 offers Low, Medium, High, and Extra High; Grok 4.5 offers Low, Medium, and High; Grok 4.3 offers None, Low, Medium, and High; Grok multi-agent models can additionally expose Extra High. Retired fast-model aliases do not expose a reasoning picker because their legacy contracts do not accept the current reasoning parameter.

## Commands

| Command | Purpose |
| --- | --- |
| **Grok: Manage xAI Connection** | Test the connection, refresh models, reconcile accounts and observed entries, show logs, or sign out |
| **Grok: Add Provider Entry** | Provision a Manage Language Models entry for a profile ID, then sign in only if needed |
| **Grok: Add xAI Account** | Create or replace a named OAuth profile |
| **Grok: Select Profile for Usage and Management** | Choose the profile used by usage and management commands; this choice is restored after restart and does not change model-entry routing |
| **Grok: Bind Account to This Workspace** | Pin the current workspace to a signed-in xAI account |
| **Grok: Sign In to xAI** | Authorize with an RFC 8628 device code (opens xAI's verification page with the code pre-filled) |
| **Grok: Refresh Models** | Fetch the current model list from xAI |
| **Grok: Test Connection** | Send a small live inference request |
| **Grok: Show API Activity and Spend** | Show locally tracked billed spend, request tokens, and API rate capacity |
| **Grok: Open Subscription Usage** | Open Grok weekly usage, reset date, Extra Usage Credits, and auto top-up |
| **Grok: Open xAI Console Usage** | Open account-wide xAI API usage and prepaid credits |
| **Grok: Show Diagnostics** | Show the VS Code version, session state, and registered models |

Account lists come directly from valid OAuth sessions in VS Code SecretStorage. In **Grok: Manage xAI Connection**, choose **Reconcile accounts and observed entries** to see signed-in profiles that discovery has not observed and previously observed profiles whose sessions are gone. Observations contain profile IDs, model counts, and timestamps; they are discovery history rather than the current inventory of native VS Code entries. Add or remove entries in **Manage Language Models**.

After sign-in, the extension refreshes the read-only Grok subscription snapshot when the account exposes it. The status bar and popup can show the current weekly usage percentage, the scheduled reset date, Extra Usage Credits, and auto top-up status. After an API call, the same popup also shows exact billed spend accumulated by this extension on this device. Last-known totals and account snapshots persist across VS Code reloads and are cleared on sign-out or a new sign-in so replacing an account cannot inherit the previous account's usage.

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
| `grokCopilot.profile` | `""` | xAI profile to use in this workspace or folder; empty means the entry keeps its own profile |
| `grokCopilot.profileMap` | `{}` | Maps Manage Language Models entry names to xAI profiles |
| `grokCopilot.workspaceBinding` | `trusted` | Whether folder and workspace profile bindings are honoured |

The authenticated xAI `/models` response remains authoritative. Fields it omits are enriched from the canonical `xai` provider in a six-hour models.dev snapshot stored in VS Code `globalState`. Stale metadata is returned immediately while refresh runs and remains available during models.dev outages.

Prompts and OAuth tokens are not written to the output channel.

Streaming keeps each parallel function call pending until its arguments are complete, accepts indexed or ID-only fragments, and closes reasoning before visible answers or tool calls. Cancellation and timeout control stay active through response-body consumption; unfinished streams report an error.

## Troubleshooting

- **No Grok models in the picker:** sign in with **Grok: Add xAI Account** — it creates the matching entry automatically; then pick a Grok model in the model picker.
- **Sign-in cannot complete:** cancel it and start again; each attempt opens a fresh device code.
- **Authentication or API errors:** open **Grok: Manage xAI Connection**, test the connection, and inspect the Grok output channel.
- **HTTP 426 asking you to update Grok CLI:** update this extension and reload VS Code. The extension sends its own proxy compatibility header; installing or updating a separate Grok CLI does not change it. Model discovery can still work while inference is rejected.
- **HTTP 400 mentioning a lone surrogate:** update this extension and retry the conversation. Text-part boundaries preserve split emoji, and unrecoverable UTF-16 surrogates are replaced with `�` before requests are encoded.
- **Context window stays at 0%:** start a new chat after updating the extension. Completed Grok responses report exact input/output usage to VS Code; old sessions do not gain usage retroactively.
- **Need a diagnostic snapshot:** run **Grok: Show Diagnostics** and include the generated report when filing an issue. Remove any information you do not want to share.
