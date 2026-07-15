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

This extension is a native VS Code `LanguageModelChatProvider`. It authenticates with xAI, discovers available models, and streams responses from `api.x.ai` into Copilot Chat without a local proxy.

## Highlights

- Browser/PKCE and device-code xAI sign-in with token refresh
- Live Grok model discovery
- Streaming text and reasoning
- Agent mode tool calls and image inputs
- Usage and cost metadata when returned by xAI
- Live remaining query, request, and token limits in the VS Code status bar

## Quick start

1. Install [Grok for GitHub Copilot Chat](https://marketplace.visualstudio.com/items?itemName=grikomsn.grok-copilot-chat). You need VS Code 1.125 or newer, GitHub Copilot Chat, and an xAI account with API access or an eligible subscription.
2. Run **Grok: Sign In to xAI** from the Command Palette and complete authorization in your browser. Use **Grok: Sign In to xAI with Device Code** if the browser callback is unavailable.
3. Open Copilot Chat, select **Manage Models**, enable **xAI Grok**, then choose a Grok model.

Use **Grok: Show Usage Limits** or click the Grok status-bar item to refresh the remaining query/API limits. The details view links to Grok's account Usage page for the weekly allowance and Extra Usage Credits.

Use **Grok: Manage xAI Connection** to inspect usage, test the connection, refresh models, inspect logs, or sign out.

## Documentation

- [Setup, settings, and troubleshooting](https://github.com/grikomsn/grok-copilot-chat/blob/main/docs/setup.md)
- [OAuth and security](https://github.com/grikomsn/grok-copilot-chat/blob/main/docs/security.md)
- [Development and releases](https://github.com/grikomsn/grok-copilot-chat/blob/main/docs/development.md)

Unofficial project; not affiliated with xAI, GitHub, or Microsoft. xAI account limits and charges still apply. Licensed under [MIT](LICENSE).
