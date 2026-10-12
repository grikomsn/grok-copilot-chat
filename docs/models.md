# Models and pricing

## Live metadata

The extension discovers the catalog available to each signed-in xAI profile
from `https://cli-chat-proxy.grok.com/v1/models`. Live responses provide the
context window and image-input and tool-calling capabilities used by Copilot
Chat. A bundled fallback list keeps model selection useful during transient
catalog failures or before a profile's first successful discovery.

Live `/v1/models` metadata remains authoritative. Fields those responses omit
are enriched from the canonical `xai` provider in a six-hour models.dev
snapshot (fetched from `https://models.dev/api.json`) stored in VS Code
`globalState`. Stale metadata is returned immediately while a refresh runs and
remains available during models.dev outages.

The bundled fallback list:

| Model | Context | Images | Tools |
| --- | ---: | :---: | :---: |
| grok-4.7 | 500K | Yes | Yes |
| grok-4.6 | 500K | Yes | Yes |
| grok-4.5 | 500K | Yes | Yes |
| grok-4.3 | 1M | Yes | Yes |
| grok-build-0.1 | 256K | Yes | Yes |
| grok-4.20 | 1M | Yes | Yes |
| grok-4.20-non-reasoning | 1M | Yes | Yes |
| grok-4.20-multi-agent | 1M | Yes | Yes |

Live catalog results remain authoritative when they differ from this list.
Fallback entries also act as verified capability profiles, so a known model
keeps its image-input and tool-calling support when the live response omits
capability fields.

## Pricing

The model picker displays each model's input, cached-input, and output pricing.
Pricing discovered through the models.dev enrichment is preferred; when it is
missing, the extension falls back to the official rates captured in
`src/models/pricing.ts`.

## Context window size

Each model entry exposes a Context Window control in the Copilot Chat model
picker (`src/models/options.ts`). The options are Auto (the default), fixed
64K, 128K, and 200K tiers that fit below the model's registered input limit
(context minus the configured maximum output), and Maximum. Auto and Maximum
keep the default behavior.

A specific tier acts as a local upper limit: the selection is stored per model
by VS Code, never exceeds the model's registered input limit, and when the
converted request exceeds the selected tier the oldest conversation turns are
trimmed before the request is built (`src/provider/history-trim.ts`), in both
the Chat Completions and Responses dialects. The first turn, the current turn,
and tool-call adjacency are always preserved, and models without a fitting
tier keep their picker unchanged.

### Context indicator compatibility

Auto uses the model's registered input budget. The context indicator shows that
input budget plus the response reserve; a numeric context tier replaces only
the input budget. Auto is stored as `"auto"`, because VS Code interprets numeric
zero as a zero-token input window. If an existing chat still shows only the
output limit after upgrading, select Auto again in its Context Window control
to replace a saved zero selection.

Context Window uses the dedicated tokens group so it remains visible beside
reasoning controls. VS Code renders only one enum property per group.

## Copilot SDK sessions

The **Copilot** session runtime uses a separate model-discovery path from
ordinary **Local** chat. Its BYOK bridge discovers effort options specifically
from `configurationSchema.properties.reasoningEffort`. Keep that property
separate from Context Window and other controls, with the model's supported
values and a default from that list.

In VS Code 1.141, the SDK picker further restricts efforts to `none`, `minimal`,
`low`, `medium`, `high`, `xhigh`, `max`, and `ultra`. Each model exposes only the
intersection with its own supported list. The extension continues translating
selected efforts to the provider's native request fields.

The SDK picker exposes reasoning effort, including the supported Agent Effort
levels for multi-agent models. Use Local chat for the extension's separate
Web Search and Context Window controls; the SDK picker does not expose them.

After installing an extension update, restart VS Code or reload every open
window so the shared BYOK bridge receives fresh model metadata.

References: [VS Code BYOK discovery](https://github.com/microsoft/vscode/blob/2a59476c9bfcb90b3ddc372c36762471b7dfad1c/src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/agentHostByokLmHandler.ts),
[SDK Thinking Level filtering](https://github.com/microsoft/vscode/blob/2a59476c9bfcb90b3ddc372c36762471b7dfad1c/src/vs/platform/agentHost/node/copilot/copilotAgent.ts#L2757),
and [accepted agent-host effort tiers](https://github.com/microsoft/vscode/blob/2a59476c9bfcb90b3ddc372c36762471b7dfad1c/src/vs/platform/agentHost/common/reasoningEffort.ts).
