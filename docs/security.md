# OAuth and security

## Credential storage

Access and refresh tokens are stored per named profile in VS Code `SecretStorage`. The profile ID in **Manage Language Models** selects the matching secret; tokens are not written to workspace settings, files, model metadata, or extension logs. Account enumeration uses valid stored sessions directly; an account index cannot hide a session or keep a signed-out account visible. Discovery observations persist profile aliases, model counts, and timestamps only, never emails or account claims.

Expired access tokens are refreshed automatically with a separate refresh lock per profile, including refresh-token rotation when xAI returns a replacement.

A workspace binding selects which stored profile a repository uses. It only names a profile ID, so no token is ever written to workspace settings, and each profile keeps its own secret. Because a repository controls its own settings, folder and workspace bindings are only honoured in a workspace VS Code trusts; an untrusted workspace cannot move requests to a different account. The `grokCopilot.workspaceBinding` mode is read from the user settings only, so a repository cannot relax the trust gate for itself or undo a user who turned bindings off. The user scope is always honoured because the user controls it.

A binding is not persisted as the active account. The account the user selects with **Grok: Select Profile for Usage and Management** stays their own choice, so opening a repository that carries a binding cannot change the account used in an unrelated workspace. A binding routes chat requests only; usage and management commands keep using the account the user selected, so a repository cannot read or spend the usage of another account.

The extension signs in with RFC 8628 device authorization using xAI's public Grok CLI OAuth client configuration. No client secret is embedded in the extension, and no local callback server is opened.

## Network destinations

The extension sends requests directly to:

- `https://auth.x.ai` for authorization and token operations
- `https://cli-chat-proxy.grok.com` for OAuth model discovery, chat completions, optional Responses API web search, and read-only subscription usage
- `https://grok.com` only when the user chooses to open the subscription usage page

There is no local proxy or project-operated relay. Prompts, images, tool definitions, and tool results selected by Copilot Chat are sent to xAI as part of inference requests. When `grokCopilot.webSearch` is enabled, the selected request also permits xAI's server-side web search and is sent through the Responses API. The extension does not use the API-key-only `api.x.ai` route for its OAuth session.

The subscription usage refresh reads the OAuth-backed Grok client billing surface for weekly usage, reset timing, Extra Usage Credits, and auto top-up status. It never purchases credits, changes auto top-up, or redeems a reset. That account surface is private to the Grok client service and may change independently of the public xAI API.

## Logging

Debug logging is disabled by default. When enabled, the Grok output channel records request and stream metadata, model discovery, and errors; it does not intentionally log prompts or OAuth tokens.

Report vulnerabilities according to the [security policy](https://github.com/grikomsn/grok-copilot-chat/security/policy) or email [security@nibras.co](mailto:security@nibras.co). Do not disclose credentials, sensitive prompts, or vulnerability details in a public issue.
