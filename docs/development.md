# Development and releases

## Local workflow

```bash
npm install
npm test
npm run package
```

Tests are colocated with the modules they cover. `npm test` performs a clean compile and runs the OAuth, streaming-parser, and usage tests. `npm run package` validates the project and creates an installable VSIX.

Install the local build with:

```bash
code --install-extension grok-copilot-chat-<version>.vsix --force
```

## Release workflow

User-visible pull requests normally include a Changeset:

```bash
npm run changeset
```

Changesets maintains a version pull request on `main`. Merging that pull request publishes the VSIX to the Visual Studio Marketplace and attaches the same artifact to a GitHub release. The release workflow skips an existing version tag, preventing duplicate publication.

The packaged extension contains compiled runtime files, Marketplace metadata, the changelog, license, README, and icon. Source, tests, maps, repository automation, project documentation, and local build artifacts are excluded by `.vscodeignore`.

## References

The provider structure was informed by [`ltmoerdani/opencode-copilot-chat`](https://github.com/ltmoerdani/opencode-copilot-chat). The xAI OAuth implementation follows [OpenCode's xAI provider](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/plugin/xai.ts).
