# OAuth and security

## Credential storage

Access and refresh tokens are stored in VS Code `SecretStorage`. They are not written to workspace settings, files, or extension logs. Expired access tokens are refreshed automatically, including refresh-token rotation when xAI returns a replacement.

The extension supports two OAuth paths:

- Browser authorization with PKCE and a temporary loopback callback
- RFC 8628 device authorization when a loopback callback is unavailable

Both flows use xAI's public Grok CLI OAuth client configuration. No client secret is embedded in the extension.

## Network destinations

The extension sends requests directly to:

- `https://auth.x.ai` for authorization and token operations
- `https://api.x.ai` for model discovery and chat completions

There is no local proxy or project-operated relay. Prompts, images, tool definitions, and tool results selected by Copilot Chat are sent to xAI as part of chat completion requests.

## Logging

Debug logging is disabled by default. When enabled, the Grok output channel records request and stream metadata, model discovery, and errors; it does not intentionally log prompts or OAuth tokens.

Report security issues privately to the repository owner rather than opening a public issue containing credentials or sensitive prompts.
