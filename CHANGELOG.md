# Changelog

## 1.2.0

### Minor Changes

- e12917d: Bind an xAI account to a workspace. `Grok: Bind Account to This Workspace` pins the current repository to a signed-in profile, and the resource scoped `grokCopilot.profile` and `grokCopilot.profileMap` settings do the same by hand. Folder and workspace bindings are only honoured in a trusted workspace, and `grokCopilot.workspaceBinding` controls that.

## 1.1.3

### Patch Changes

- a97e2a3: Count tool results, tool arguments, thinking, and image inputs when budgeting Copilot Chat context, and explain how to recover from context-window errors.

## 1.1.2

### Patch Changes

- 39f76de: Map aborted requests to a friendly "Request cancelled or timed out" message in
  shared error formatting instead of surfacing the raw AbortError text.

## 1.1.1

### Patch Changes

- 5b92e51: Document Copilot SDK reasoning controls and their supported effort tiers, and add regression coverage for discovery and native request translation. Existing provider request behavior is preserved.

## 1.1.0

### Minor Changes

- c549e3e: Simplify xAI auth setup and fix group-less discovery

  The native **Add Models → xAI Grok** flow now fully works out of the box: it prompts for a group name and profile ID (prefilled) and creates the entry.

  - **Grok: Add Provider Entry** (`grokCopilot.configureEntry`) provisions the entry group immediately with the typed profile, then runs sign-in only when that profile has no session — the entry appears in Manage Language Models even before signing in, and lists no models until then.
  - **Grok: Add xAI Account** now also provisions the matching entry after sign-in instead of ending with manual instructions, and signing into an already-signed-in profile just activates it instead of prompting to replace.
  - **Adding an entry natively (Add Models → xAI Grok) now offers to sign in** when the profile has no session yet, and every sign-in command provisions the matching entry automatically when none exists yet — no more pairing the two commands manually.
  - **Single sign-in flow:** the browser/PKCE loopback sign-in is removed; **Grok: Sign In to xAI** now uses RFC 8628 device authorization (xAI's verification page opens with the user code pre-filled). The separate device-code command is gone.
  - Repeated offers are debounced, and deliberately removed entries are never resurrected by sign-ins they were removed for.
  - Model discovery returns nothing for the host's group-less probe call instead of listing the default profile's models, preventing duplicate listings alongside configured entries.

## 1.0.0

### Major Changes

- cbfa102: Isolate parallel streamed calls and reasoning segments, discover OAuth accounts from stored sessions, and reconcile observed entries. Model IDs now always include the profile; reselect default-profile models after upgrading. Remove singleton usage migration.

## 0.9.2

### Patch Changes

- a1ba12b: Fix xAI HTTP 426 failures by updating the Grok proxy compatibility version. Preserve emoji split across message and tool-result text parts, and replace unrecoverable UTF-16 surrogates before encoding requests to prevent HTTP 400 failures.

## 0.9.1

### Patch Changes

- dfd6d44: Add Grok 4.7 to the bundled fallback catalog with frontier reasoning controls (low/medium/high/xhigh) and official picker pricing ($2 in / $0.50 cached / $6 out per 1M tokens). Also extend the official pricing fallback to the dated `grok-4.20-0309-*` model ids so offline pricing stays correct for aliases that models.dev does not list.

## 0.9.0

### Minor Changes

- 46421c6: Adds a Context Window picker control (Auto, 64K, 128K, 200K, Maximum) that caps how much conversation history each request sends, clamped to the model's registered input limit.

### Patch Changes

- 46421c6: Fix Auto context size being interpreted as zero input tokens by VS Code, collapsing the context indicator to the output reserve and triggering premature compaction.

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
