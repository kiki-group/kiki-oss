# CLAUDE.md — Kiki

> Prescriptive rules for coding agents. Read AGENTS.md for architecture description.

## Product Surfaces

Kiki has **3 user entry points**. Every change must consider which surfaces it affects.

| Surface | Entry point | Files |
|---------|------------|-------|
| **Wake word** | Say "Kiki" → voice command | `offscreen/wake-word.js` (local ONNX inference), `offscreen/deepgram-stt.js`, `offscreen/offscreen.js` |
| **Hotkey** | Ctrl+/ → voice command | `content/content-script.js` (setupHotkeyListener) |
| **Chat** | Text input panel | `content/chat-window.js` |

All three surfaces feed into the same action pipeline: service-worker → api-client → providers → LLM → action-dispatcher → action-executors.

## File → Impact Map

Use this to determine what to test after a change.

| File changed | Surfaces affected | Testing required |
|---|---|---|
| `extension/background/prompts.js` | ALL | Manual Chrome test |
| `extension/background/model-config.js` | ALL | Manual Chrome test |
| `extension/background/providers/*` | ALL | Manual Chrome test |
| `extension/background/api-client.js` | ALL | Manual Chrome test |
| `extension/content/accessibility-tree.js` | ALL | Manual Chrome test |
| `extension/content/action-executors.js` | ALL | Manual Chrome test |
| `extension/content/action-dispatcher.js` | ALL | Manual Chrome test |
| `extension/content/safety-gate.js` | ALL | Manual Chrome test |
| `extension/background/service-worker.js` | ALL | Manual Chrome test |
| `extension/background/state-machine.js` | ALL | Manual Chrome test |
| `extension/content/label-overlay.js` | ALL | Manual Chrome test |
| `extension/content/content-script.js` | Hotkey + overlay | Manual Chrome test |
| `extension/content/chat-window.js` | Chat only | Manual Chrome test |
| `extension/offscreen/wake-word.js` | Wakeword only | Manual Chrome test |
| `extension/offscreen/deepgram-stt.js` | ALL (STT) | Manual Chrome test |
| `extension/offscreen/models/*`, `extension/offscreen/ort/*` | Wakeword only | Manual Chrome test |
| `extension/background/skills/*` | ALL | Manual Chrome test |

## Danger Zones

- **NEVER modify prompts** in `extension/background/prompts.js` without testing before AND after
- **Anti-loop constraints are load-bearing** — the CONTINUE prompt's rules (scroll count >= 2 forces done, 4+ non-productive actions forces done, 4+ tab switches in 6 actions forces done) prevent cost blowups. Do not weaken them.
- **MAX_LLM_CALLS = 25** in service-worker.js is a cost safety net. Don't raise it.
- **Safety gate** (`safety-gate.js`) requires vocal confirmation for destructive actions. Don't bypass it.

## Architecture Quick Reference

- **3-tier prompts**: CLASSIFY (fast single-action), PLAN (multi-step), CONTINUE (replan), CHAT (conversational) — all in `extension/background/prompts.js`
- **Classify → Plan → Execute loop**: See `extension/background/service-worker.js` for the canonical flow
- **Model config**: `extension/background/model-config.js` — user-overridable via options page, stored in `chrome.storage.local`
- **Multi-provider**: Gemini, Anthropic, OpenAI — see `extension/background/providers/`
- **Direct API calls**: All provider calls use raw `fetch()` from the service worker. No server middleware.

## Maintenance

When you add/rename key files or modify prompt structure:
1. Update this file's impact map
2. Update AGENTS.md to match
