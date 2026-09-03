# Changelog

## 0.8.6

### Patch Changes

- 33b5a83: Mark image input support on the Grok 4.3, Grok 4.20, Grok 4.20 non-reasoning, and Grok 4.20 multi-agent fallback models per the current xAI model docs.

## 0.8.5

### Patch Changes

- f70f0d0: Register model-specific xAI token pricing and relative cost tiers with VS Code.

## 0.8.4

### Patch Changes

- 7722cb4: Recover final Responses API text and reject incomplete streamed tool arguments before they reach Copilot Chat.

## 0.8.3

### Patch Changes

- 6cc3efb: Recognize image input support for Grok Build 0.1 when live model discovery omits capability metadata.

## 0.8.2

### Patch Changes

- f383a0d: Clarify that profile selection controls usage and management, and offer the VS Code chat model picker to switch the account used for inference.

## 0.8.1

### Patch Changes

- 02a3f27: Restore the selected profile for usage and management after restart, clarify that native model entries retain their own account routing, and keep legacy default entries valid.

## 0.8.0

### Minor Changes

- b8f4f6e: Support multiple native xAI Grok provider entries backed by isolated named OAuth profiles, catalogs, refresh locks, and usage snapshots.

## 0.7.0

### Minor Changes

- 482b1c9: Add a per-model Web Search toggle with request-level override semantics and expose the live connection test as a command.

### Patch Changes

- 482b1c9: Enrich authoritative xAI model discovery with a persisted, stale-while-revalidate models.dev metadata snapshot.
- 482b1c9: Default all selectable Grok reasoning-effort controls to High.

## 0.6.0

### Minor Changes

- 529cbe1: Add configurable Grok model-catalog caching and a setting to control the usage status bar.

## 0.5.1

### Patch Changes

- 8d3c4e3: Preserve xAI Responses cache and reasoning token usage in Copilot Chat and improve prompt-cache affinity across turns.

## 0.5.0

### Minor Changes

- d60158c: Add an opt-in `grokCopilot.webSearch` setting for native xAI Web Search in Copilot Chat.

## 0.4.0

### Minor Changes

- bf34617: Show read-only Grok subscription usage, weekly reset timing, Extra Usage Credits, and auto top-up status for OAuth accounts.

## 0.3.3

### Patch Changes

- 9d8f1fb: Route OAuth inference through xAI's current Grok client service with its required proxy headers, expose verified model reasoning and capability metadata, and fail incomplete response streams instead of silently accepting truncated output.

## 0.3.2

### Patch Changes

- 6711d10: Refresh the fallback Grok model metadata to include current xAI models and remove retired model slugs.

## 0.3.1

### Patch Changes

- 5e8b4c2: Use each model's xAI `context_length` for VS Code context-window accounting, reserving configured output headroom so Grok 4.5 and other large-context models no longer all appear as 256K.

## 0.3.0

### Minor Changes

- Add a model-specific reasoning-effort switcher to the Copilot Chat model picker and send the selected effort to supported Grok models.

## 0.2.2

### Patch Changes

- 5f03e89: Harden the browser OAuth callback against forged requests and reflected markup with state-first validation, strict loopback request checks, non-reflective error pages, output encoding, and restrictive browser response headers.

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
