---
"grok-copilot-chat": minor
---

Simplify xAI auth setup and fix group-less discovery

The native **Add Models → xAI Grok** flow now fully works out of the box: it prompts for a group name and profile ID (prefilled) and creates the entry.

- **Grok: Add Provider Entry** (`grokCopilot.configureEntry`) provisions the entry group immediately with the typed profile, then runs sign-in only when that profile has no session — the entry appears in Manage Language Models even before signing in, and lists no models until then.
- **Grok: Add xAI Account** now also provisions the matching entry after sign-in instead of ending with manual instructions, and signing into an already-signed-in profile just activates it instead of prompting to replace.
- **Adding an entry natively (Add Models → xAI Grok) now offers to sign in** when the profile has no session yet, and every sign-in command provisions the matching entry automatically when none exists yet — no more pairing the two commands manually.
- **Single sign-in flow:** the browser/PKCE loopback sign-in is removed; **Grok: Sign In to xAI** now uses RFC 8628 device authorization (xAI's verification page opens with the user code pre-filled). The separate device-code command is gone.
- Repeated offers are debounced, and deliberately removed entries are never resurrected by sign-ins they were removed for.
- Model discovery returns nothing for the host's group-less probe call instead of listing the default profile's models, preventing duplicate listings alongside configured entries.
