---
"grok-copilot-chat": patch
---

Use each model's xAI `context_length` for VS Code context-window accounting, reserving configured output headroom so Grok 4.5 and other large-context models no longer all appear as 256K.
