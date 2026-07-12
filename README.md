# Grok for GitHub Copilot Chat

Use xAI Grok models directly in Visual Studio Code's GitHub Copilot Chat model picker. The extension is a native `LanguageModelChatProvider`: it authenticates with xAI, calls `api.x.ai`, and streams Grok responses into Copilot Chat without running a local proxy.

## What works

- xAI OAuth browser/PKCE and device-code sign-in (including refresh-token rotation)
- Live model discovery from `GET https://api.x.ai/v1/models`
- Streaming text and reasoning in Copilot Chat
- Agent mode tool/function calls
- Image inputs
- Usage and cost metadata when returned by xAI

## Requirements

- Visual Studio Code 1.125 or newer
- GitHub Copilot Chat installed and signed in (a paid Copilot plan is not required for BYOK providers)
- An xAI account with Grok API access or an eligible SuperGrok subscription

## Install locally

```bash
npm install
npm run package
code --install-extension grok-copilot-chat-0.1.0.vsix --force
```

Reload VS Code, run **Grok: Sign In to xAI**, and complete the browser authorization. If loopback callbacks are unavailable, use **Grok: Sign In to xAI with Device Code** instead. Then open Copilot Chat, choose **Manage Models**, enable **xAI Grok**, and pick a Grok model.

Use **Grok: Manage xAI Connection** to test the connection, refresh models, view logs, or sign out.

## Development

```bash
npm install
npm test
npm run package
```

The implementation follows the provider pattern used by [`ltmoerdani/opencode-copilot-chat`](https://github.com/ltmoerdani/opencode-copilot-chat) and the xAI OAuth flow implemented by [OpenCode](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/plugin/xai.ts).

## OAuth and security

OAuth access and refresh tokens are stored only in VS Code SecretStorage. They are never written to settings or logs. The extension uses xAI's public Grok CLI OAuth client ID and RFC 8628 device authorization endpoints, matching OpenCode's implementation. API requests go directly to `https://api.x.ai` and authentication requests go directly to `https://auth.x.ai`.

Your xAI subscription, API limits, and charges are governed by xAI. This project is unofficial and is not affiliated with xAI, GitHub, or Microsoft.

## License

MIT
