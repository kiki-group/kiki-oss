# AGENTS.md

## Project Overview

Kiki is a voice-first web accessibility Chrome extension (Manifest V3). Users say "Kiki" to activate, speak a command, and the extension executes it on the current web page. There are three input surfaces: **wake word** (say "Kiki"), **hotkey** (configurable key combo), and **chat panel** (text input). The primary UI is a small animated status dot in the bottom-right corner; the chat panel slides out on demand.

Everything runs locally in the Chrome extension — no server middleware required. API keys are stored in `chrome.storage.local` and configured through the options page.

## Architecture

Single deployable unit: **Chrome Extension** (`extension/`). Pure vanilla JavaScript, ES modules, no build step.

- **LLM calls** go directly from the service worker to provider REST APIs (Gemini, Anthropic, or OpenAI) via `fetch()`.
- **Speech-to-text** connects directly from the offscreen document to Deepgram via WebSocket (using `Sec-WebSocket-Protocol` for auth).
- **Wake word detection** runs entirely in-browser via ONNX Runtime Web (WebAssembly).

## Key Architectural Decisions

- **Two-tier AI with re-planning**: Simple commands → fast/cheap model via `classify()`. Complex multi-step → more capable model via `plan()`. Escalated tasks re-plan after page changes via `continueTask()`. Models are user-configurable via the options page.
- **Re-plan loop (escalated tasks only)**: When a planned action causes a page change, the service worker grabs a fresh DOM snapshot and calls `continueTask()` to get remaining actions. The model returns `{"action": "done"}` when the original request is fulfilled. Hard cap of **25 LLM calls** per request as a cost safety net.
- **Multi-provider**: Gemini (default), Anthropic, and OpenAI are all supported. Provider + model are configured per route (classify, plan, continue, chat) via `chrome.storage.local`.
- **Direct API calls**: All provider calls use raw `fetch()` — no npm SDKs, no build step. Chrome extensions with `host_permissions: <all_urls>` bypass CORS.
- **Deepgram browser auth**: WebSocket connections to Deepgram use `Sec-WebSocket-Protocol: token, <key>` (Deepgram's documented browser auth method).
- **API keys in chrome.storage.local**: Users configure keys through the options page. Keys are stored locally and sent only to the AI providers the user configures — never to any Kiki-operated backend.
- **Three input surfaces**: Wake word (voice), hotkey (voice), and chat (text). All three converge on the same action pipeline in the service worker.
- **Stateless commands**: Each voice/hotkey command is independent with no cross-command memory. Chat history persists only for the browser session.

## Key Files

### Extension — Background
- `extension/manifest.json` — Extension manifest (MV3)
- `extension/background/service-worker.js` — State machine, message router, orchestration
- `extension/background/state-machine.js` — FSM implementation (IDLE → LISTENING → PROCESSING → EXECUTING → PAUSED)
- `extension/background/api-client.js` — Calls LLM providers directly, assembles prompts, parses JSON
- `extension/background/prompts.js` — All LLM prompt strings and message-building helpers
- `extension/background/model-config.js` — Default provider/model per route
- `extension/background/providers/index.js` — Provider router
- `extension/background/providers/gemini.js` — Direct Gemini REST API via fetch()
- `extension/background/providers/anthropic.js` — Direct Anthropic REST API via fetch()
- `extension/background/providers/openai.js` — Direct OpenAI REST API via fetch()
- `extension/background/skills/index.js` — Skill data (inlined)
- `extension/background/skills/loader.js` — Skill prompt formatting
- `extension/background/telemetry.js` — No-op stubs (telemetry disabled)
- `extension/background/run-logger.js` — Persists structured run traces to chrome.storage.local

### Extension — Content Scripts (injected into all pages)
- `extension/content/content-script.js` — Entry point, overlay, hotkey listener, chrome.runtime message handler
- `extension/content/accessibility-tree.js` — DOM → structured snapshot for LLM
- `extension/content/action-executors.js` — Individual DOM actions (click, type, scroll, navigate, etc.)
- `extension/content/action-dispatcher.js` — Sequential action runner with retries and DOM settle
- `extension/content/safety-gate.js` — Vocal confirmation for destructive actions
- `extension/content/label-overlay.js` — Numbered badges on interactive elements
- `extension/content/chat-window.js` — Shadow DOM chat panel UI

### Extension — Offscreen Document
- `extension/offscreen/offscreen.html` — Loads ONNX Runtime Web + offscreen.js
- `extension/offscreen/offscreen.js` — Coordinates wake word + Deepgram STT
- `extension/offscreen/wake-word.js` — Local ONNX inference pipeline (AudioWorklet → melspectrogram → embedding → kiki)
- `extension/offscreen/audio-processor.js` — AudioWorklet for PCM chunking
- `extension/offscreen/deepgram-stt.js` — Direct WebSocket to Deepgram for streaming STT
- `extension/offscreen/models/` — ONNX model files (melspectrogram.onnx, embedding_model.onnx, kiki.onnx)
- `extension/offscreen/ort/` — Vendored ONNX Runtime Web (ort.wasm.min.js + WASM backend)

### Extension — Options
- `extension/options/options.html` — Onboarding UI: API keys, mic permission, demos, settings (hotkey, theme, model config)
- `extension/options/options.js` — Onboarding flow logic, API key management, model configuration

## Running the Extension (Development)

1. Clone the repo
2. Load the extension in Chrome: `chrome://extensions` → Developer mode → Load unpacked → select `extension/`
3. Click the Kiki extension icon → enter your API keys (Gemini + Deepgram at minimum)
4. Grant microphone permission when prompted
5. Navigate to any website — the Kiki status dot should appear bottom-right
6. Say "Kiki" to activate, then speak your command (or use hotkey, or open chat)

## Important Notes

- All LLM calls go directly from the extension to providers. No server needed.
- The safety gate (`safety-gate.js`) requires vocal confirmation for destructive actions. Do not bypass it.
- Anti-loop constraints in the CONTINUE prompt are load-bearing cost controls. Do not weaken them.
- `MAX_LLM_CALLS = 25` in the service worker is a cost safety net. Don't raise it.
