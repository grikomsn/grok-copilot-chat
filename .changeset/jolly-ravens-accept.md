---
"grok-copilot-chat": patch
---

Fix xAI HTTP 426 failures by updating the Grok proxy compatibility version. Preserve emoji split across message and tool-result text parts, and replace unrecoverable UTF-16 surrogates before encoding requests to prevent HTTP 400 failures.
