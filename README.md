<p align="center">
  <img src="https://raw.githubusercontent.com/grikomsn/grok-copilot-chat/main/assets/cover.jpg" alt="Grok and GitHub Copilot" width="960">
</p>

<h1 align="center">Grok for GitHub Copilot Chat</h1>

<p align="center">Use xAI Grok models directly from the GitHub Copilot Chat model picker in Visual Studio Code.</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=grikomsn.grok-copilot-chat"><img src="https://img.shields.io/visual-studio-marketplace/v/grikomsn.grok-copilot-chat?style=flat-square&logo=visualstudiocode&label=Marketplace" alt="Visual Studio Marketplace version"></a>
  <a href="https://marketplace.visualstudio.com/items?itemName=grikomsn.grok-copilot-chat"><img src="https://img.shields.io/visual-studio-marketplace/i/grikomsn.grok-copilot-chat?style=flat-square&label=Installs" alt="Visual Studio Marketplace installs"></a>
  <a href="https://github.com/grikomsn/grok-copilot-chat/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/grikomsn/grok-copilot-chat/ci.yml?branch=main&style=flat-square&label=CI" alt="CI status"></a>
  <a href="https://github.com/grikomsn/grok-copilot-chat/blob/main/LICENSE"><img src="https://img.shields.io/github/license/grikomsn/grok-copilot-chat?style=flat-square" alt="MIT license"></a>
</p>

This native VS Code `LanguageModelChatProvider` authenticates with xAI, discovers available models, and streams responses through xAI's Grok inference service into Copilot Chat without a local proxy.

## Highlights

- Browser/PKCE and device-code xAI sign-in with automatic refresh
- Live Grok model discovery with six-hour persisted models.dev enrichment
- Streaming text, reasoning, image inputs, and agent-mode tool calls
- Model-specific reasoning-effort and opt-in Web Search controls
- Native context-window accounting from xAI token usage
- Exact locally accumulated billed spend and rate-capacity display
- Read-only SuperGrok weekly usage, reset, credits, and auto top-up status
- Connection management and secret-safe diagnostics

## Quick start

1. Install [Grok for GitHub Copilot Chat](https://marketplace.visualstudio.com/items?itemName=grikomsn.grok-copilot-chat). You need VS Code 1.125 or newer, GitHub Copilot Chat, and an xAI account with API access or an eligible subscription.
2. Run **Grok: Sign In to xAI** and complete authorization. Use the device-code command if the browser callback is unavailable.
3. Open Copilot Chat, select **Manage Models**, enable **xAI Grok**, and choose a Grok model.

Composer controls override workspace defaults; reasoning defaults to High when supported and Web Search remains off until enabled. Click the Grok status-bar item to inspect locally tracked spend and tokens, transient API capacity, and any subscription snapshot exposed by the account.

## Documentation

- [Setup, commands, settings, and troubleshooting](https://github.com/grikomsn/grok-copilot-chat/blob/main/docs/setup.md)
- [OAuth and security](https://github.com/grikomsn/grok-copilot-chat/blob/main/docs/security.md)
- [Development and releases](https://github.com/grikomsn/grok-copilot-chat/blob/main/docs/development.md)

## Related projects

- [Codex Bridge for Copilot Chat](https://github.com/grikomsn/openai-oauth-copilot-chat)
- [Ollama Cloud for GitHub Copilot Chat](https://github.com/grikomsn/ollama-cloud-copilot-chat)
- [OpenCode for Copilot Chat](https://github.com/grikomsn/opencode-copilot-chat)
- [Poolside for GitHub Copilot Chat](https://github.com/grikomsn/poolside-copilot-chat)

Unofficial project; not affiliated with xAI, GitHub, or Microsoft. xAI account limits and charges still apply. Licensed under [MIT](LICENSE).
