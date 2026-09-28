---
"grok-copilot-chat": patch
---

Add Grok 4.7 to the bundled fallback catalog with frontier reasoning controls (low/medium/high/xhigh) and official picker pricing ($2 in / $0.50 cached / $6 out per 1M tokens). Also extend the official pricing fallback to the dated `grok-4.20-0309-*` model ids so offline pricing stays correct for aliases that models.dev does not list.