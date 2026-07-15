# Changelog

## 0.2.1

### Patch Changes

- 5540bfd: Fix VS Code context-window accounting, track exact xAI-billed spend and request tokens locally, and relabel response-header values as transient API rate capacity rather than account usage. Remove the inaccessible Grok-web limit probe and consolidate shared provider helpers.

## 0.2.0

### Minor Changes

- b6cfd2c: Show live remaining Grok query, request, and token limits in the VS Code status bar and a detailed usage view.

## 0.1.1

- Add the branded Marketplace icon and repository cover.
- Replace the long README with focused setup, security, and development documentation.
- Keep source, tests, project documentation, and build-only files out of the published VSIX.
- Report the installed extension version in xAI request metadata.

## 0.1.0

- Initial xAI OAuth and Grok language-model provider for GitHub Copilot Chat.
