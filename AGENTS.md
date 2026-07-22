# Repository guide

## Project shape

This is a small, strict-TypeScript VS Code extension that exposes xAI Grok as a native Copilot Chat language-model provider. It targets Node.js 22+ and VS Code 1.125+.

- `src/extension.ts`: activation, commands, status/UI, and persisted usage state
- `src/provider.ts`: model discovery, request conversion, streaming, tools, and API usage capture
- `src/oauth.ts`: browser/PKCE and device-code OAuth; credentials live in VS Code `SecretStorage`
- `src/sse.ts`: stateful chat-completion stream parser
- `src/model-options.ts`: model-specific reasoning configuration
- `src/usage.ts`: rate-limit, token, cost, and display helpers
- `src/*.test.ts`: colocated tests using `node:test` and `node:assert/strict`
- `package.json`: extension manifest, public commands/settings, and scripts

## Working conventions

- Match the existing style: 2-space indentation, double quotes, semicolons, trailing commas, and explicit types at module/API boundaries.
- Keep changes focused. Prefer pure helpers for parsing, conversion, and formatting so behavior is easy to test without a VS Code host.
- Add or update colocated tests whenever behavior changes. Cover fragmented streams, malformed external data, cancellation, retries, and fallback paths where relevant.
- Keep `package.json`, README/setup documentation, and command/configuration handling synchronized when public commands, settings, requirements, or workflows change.
- Treat OAuth and provider changes as security-sensitive: never log prompts or tokens, never persist credentials outside `SecretStorage`, preserve PKCE/state/nonce and callback validation, and escape external content shown in callback pages or errors.
- Preserve cancellation and streaming behavior. Do not buffer a response that can be handled incrementally, and retain the single forced token refresh/retry on HTTP 401.
- Do not commit generated `out/`, source maps, `node_modules/`, or `.vsix` files.

## Validation

Use the repository scripts rather than ad hoc build commands:

```bash
npm ci          # clean dependency install
npm test        # clean compile, then all node:test suites
npm run package # full validation plus VSIX packaging
```

Run `npm test` for code changes. Also run `npm run package` when changing the manifest, packaging rules, dependencies, or release-facing content. The CI matrix uses Node 22, 24, and 26.

## Release hygiene

- Add a Changeset with `npm run changeset` for user-visible behavior changes.
- Documentation-only, test-only, and repository-maintenance changes do not need a Changeset.
- Do not manually bump the version or edit release output unless explicitly performing the release workflow.
