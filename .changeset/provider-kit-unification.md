---
"grok-copilot-chat": minor
---

Fix tool-result ordering, add idle timeout and retries

- Tool results now directly follow the assistant tool calls they answer, ahead of any user text sent in the same turn; strict Chat Completions handling could reject the old order.
- Repeated full tool names in streamed deltas are no longer concatenated, and empty or tool-less completions are reported as errors instead of silent empty replies.
- New `grokCopilot.streamIdleTimeoutSeconds` setting (default 120) aborts a stalled stream; transient 429/502/503/504 and connection failures before streaming are retried with bounded backoff.
- Vision models receive tool-result images, and the picker shows cached-input prices.

Shared provider plumbing now comes from the copilot-chat-kit submodule, so fixes land in every Copilot Chat provider extension at once.
