# Development and releases

## Local workflow

```bash
npm ci
npm test
npm run package
```

Tests are colocated with the modules they cover. `npm test` performs a clean compile and runs the OAuth, streaming-parser, and usage tests. `npm run package` validates the project and creates an installable VSIX.

Install the local build with:

```bash
code --install-extension grok-copilot-chat-<version>.vsix --force
```

The native fixture in `test/native/index.js` exports `run` for VS Code's extension test host. After compilation, run it with an isolated user-data directory:

```bash
code --new-window --user-data-dir /tmp/grok-native-probe \
  --extensions-dir /tmp/grok-native-probe/extensions \
  --extensionDevelopmentPath "$PWD" \
  --extensionTestsPath "$PWD/test/native/index.js" \
  --disable-extensions --disable-workspace-trust
```

It uses real VS Code response constructors with synthetic OAuth sessions and injected HTTP responses. It verifies both stream dialects, parallel calls, a follow-up turn, reasoning closure, cancellation, incomplete EOF, one 401 refresh, profile isolation, and account reconciliation. It performs no live authentication or paid inference and prints counts and pass status only.

## Shared kit

`src/kit/` is the [copilot-chat-kit](https://github.com/grikomsn/copilot-chat-kit)
git submodule shared by every Copilot Chat provider extension. It compiles and
tests with this repository (`npm test` runs its colocated tests too), so a fresh
clone needs `git clone --recurse-submodules` or `git submodule update --init`.

- Change shared behavior in the kit repository, push it, then run
  `git submodule update --remote src/kit` here and commit the bump.
- Keep provider quirks (auth, dialect extensions, cost tables, usage domains)
  in this repository; configure kit modules through their options instead of
  editing them in place.
- Dependabot proposes kit bumps weekly; CI checks out submodules.

## Release workflow

User-visible pull requests normally include a Changeset:

```bash
npm run changeset
```

Changesets maintains a version pull request on `main`. Merging that pull request publishes the VSIX to the Visual Studio Marketplace and attaches the same artifact to a GitHub release. The release workflow skips an existing version tag, preventing duplicate publication.

The packaged extension contains compiled runtime files, Marketplace metadata, the changelog, license, README, and icon. Source, tests, maps, repository automation, project documentation, and local build artifacts are excluded by `.vscodeignore`.

## References

The provider structure was informed by [`ltmoerdani/opencode-copilot-chat`](https://github.com/ltmoerdani/opencode-copilot-chat). The xAI OAuth implementation follows [OpenCode's xAI provider](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/plugin/xai.ts).
