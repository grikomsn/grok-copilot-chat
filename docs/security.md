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
- `https://cli-chat-proxy.grok.com` for OAuth model discovery and chat completions

There is no local proxy or project-operated relay. Prompts, images, tool definitions, and tool results selected by Copilot Chat are sent to xAI as part of chat completion requests. The extension does not use the API-key-only `api.x.ai` route for its OAuth session.

## Logging

Debug logging is disabled by default. When enabled, the Grok output channel records request and stream metadata, model discovery, and errors; it does not intentionally log prompts or OAuth tokens.

Report vulnerabilities according to the [security policy](https://github.com/grikomsn/grok-copilot-chat/security/policy) or email [security@nibras.co](mailto:security@nibras.co). Do not disclose credentials, sensitive prompts, or vulnerability details in a public issue.
