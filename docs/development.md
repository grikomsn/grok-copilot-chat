# Development

## Prerequisites

- Node.js 22 or newer
- npm
- VS Code 1.125 or newer

## Validate

```bash
npm ci
npm test
npm run package
npx vsce ls
```

The tests compile strict TypeScript and use Node's built-in test runner. Network
paths use injected fetch fakes; the normal test suite never calls xAI.
`npm run package` validates the project and creates an installable VSIX.

## Extension Development Host

1. Open this repository in VS Code.
2. Press F5 and choose **Run Extension**.
3. In the new window, sign in with **Grok: Sign in** (browser or device code).
4. Open Copilot Chat and confirm the Grok model group appears.
5. Send a short prompt to confirm text streaming and usage reporting.
6. Check a thinking model exposes the expected effort submenu and renders a
   thinking part separately.
7. Use agent mode to verify a model emits and completes a tool call.
8. Inspect diagnostics and logs for accidental sensitive output.

## Release

Add a Changeset for user-visible work:

```bash
npm run changeset
```

Merging to `main` updates or creates a version pull request. After the version
pull request merges, release automation validates the project, publishes the
VSIX to the Marketplace, and creates a GitHub release.

The packaged extension contains compiled runtime files, Marketplace metadata,
the changelog, license, README, and icon. Source, tests, maps, repository
automation, project documentation, and local build artifacts are excluded by
`.vscodeignore`.

## References

The provider structure was informed by [`ltmoerdani/opencode-copilot-chat`](https://github.com/ltmoerdani/opencode-copilot-chat). The xAI OAuth implementation follows [OpenCode's xAI provider](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/plugin/xai.ts).
