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
