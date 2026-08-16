# Repository guide

## Project shape

This is a small, strict-TypeScript VS Code extension that exposes xAI Grok as a native Copilot Chat language-model provider. It targets Node.js 22+ and VS Code 1.125+.

- `src/extension.ts`: activation, dependency wiring, and persisted usage state
- `src/commands/`: sign-in, management, diagnostics, connection, model, and usage commands
- `src/provider.ts`: language-model provider facade, model discovery, request lifecycle, and usage capture
- `src/provider/`: message conversion and VS Code response projection
- `src/auth/`: browser/PKCE and device-code OAuth; credentials live in VS Code `SecretStorage`
- `src/models/`: model catalog, token limits, and model-specific reasoning configuration
- `src/transport/`: proxy protocol identity plus Chat Completions and Responses stream dialects
- `src/tools/`: caller-executed VS Code functions and xAI-hosted tool declarations
- `src/usage/`: rate-limit, token, cost, subscription, and display helpers
- `src/vscode/`: proposed VS Code API type augmentations
- Tests are colocated as `src/**/*.test.ts` using `node:test` and `node:assert/strict`
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
