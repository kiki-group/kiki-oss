# Kiki – Voice Web Control

Control any website with your voice. Say "Kiki" to activate, speak what you want to do, and it happens.

## Quick Start

```
git clone https://github.com/kiki-group/kiki-oss.git
```

1. Open `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select the `extension/` folder
2. Click the Kiki icon → enter your [Gemini API key](https://aistudio.google.com/apikey) and [Deepgram API key](https://console.deepgram.com/)
3. Grant microphone permission
4. Go to any website and say **"Kiki, ..."**

No server. No npm install. No build step. Just clone, load, add two free API keys, and go.

---

## What is Kiki?

Kiki is a Chrome extension that turns your voice into actions on any web page. It understands natural language commands and executes them — clicking buttons, filling forms, navigating between pages, even completing multi-step workflows like booking a flight or composing an email.

There are three ways to use it:

- **Voice** — Say "Kiki" (wake word detected locally in your browser), then speak your command
- **Hotkey** — Press a keyboard shortcut (configurable, default Ctrl+/), then speak
- **Chat** — Type commands in a slide-out chat panel

Everything runs in the Chrome extension — there is no Kiki server. Your API keys are stored locally and sent only to the AI providers you configure (Gemini, Anthropic, OpenAI, Deepgram) — never to any Kiki-operated backend.

---

## Example Use Cases

### Navigation

| Say | What happens |
|---|---|
| "Kiki, scroll down" | Scrolls the page down |
| "Kiki, go to the top" | Scrolls to top of page |
| "Kiki, go to wikipedia.org" | Navigates to Wikipedia |
| "Kiki, go back" | Browser back button |
| "Kiki, switch to my Gmail tab" | Switches to that tab |
| "Kiki, open a new tab" | Opens a blank new tab |

### Interaction

| Say | What happens |
|---|---|
| "Kiki, click the sign in button" | Clicks it |
| "Kiki, click number 5" | Clicks element #5 from the overlay |
| "Kiki, type hello world" | Types into the focused input |
| "Kiki, search for blue running shoes" | Types into search box and presses Enter |
| "Kiki, select economy from the dropdown" | Selects a dropdown option |
| "Kiki, press Escape" | Sends a keypress |

### Information

| Say | What happens |
|---|---|
| "Kiki, what's on this page?" | Reads and summarizes the page |
| "Kiki, what are the top stories?" | Extracts headlines from the page |
| "Kiki, how much does this cost?" | Finds and reads the price |
| "Kiki, extract the full specs" | Gathers all specifications from the page |

### Multi-Step Tasks

| Say | What happens |
|---|---|
| "Kiki, log into my account with test@email.com" | Fills email, password, clicks submit |
| "Kiki, search for flights from NYC to Dallas" | Navigates to Google Flights, fills the form |
| "Kiki, compose a new email to alice@example.com" | Opens compose, fills recipients, etc. |
| "Kiki, add this item to my cart" | Finds the add-to-cart button, clicks it |
| "Kiki, fill out this shipping form with my info" | Fills multiple form fields sequentially |

---

## Architecture

Everything runs inside the Chrome extension — no server, no proxy, no backend.

### Data Flow

```
  "Kiki, search for flights to Paris"
    │
    ▼
┌──────────────────────────────────────────────┐
│  Offscreen Document                          │
│  wake-word.js: mic → ONNX inference          │
│  (runs locally, no network)                  │
│  → Wake word detected!                       │
│                                              │
│  deepgram-stt.js: mic → MediaRecorder        │
│  → WebSocket to Deepgram (Nova-3)            │
│  → "search for flights to Paris"             │
└──────────────────┬───────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────┐
│  Service Worker                              │
│  1. Get DOM snapshot from content script     │
│  2. classify() → fast model decides:         │
│     simple action or multi-step?             │
│  3. If multi-step: plan() → action sequence  │
│  4. Execute actions on the page              │
│  5. If page changed: continueTask()          │
│     → re-plan with fresh DOM                 │
└──────────────────┬───────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────┐
│  Content Script                              │
│  action-dispatcher → action-executors        │
│  click / type / scroll / navigate / etc.     │
└──────────────────────────────────────────────┘
```

### Two-Tier AI

Simple one-step commands (scroll, click, navigate) are handled by a fast, cheap model. Complex multi-step commands automatically escalate to a more capable model that plans action sequences.

```
            ┌───────────┐
            │ Classify   │  ← fast model (e.g. Gemini Flash Lite)
            └─────┬─────┘
                  │
           ┌──────┴──────┐
           │              │
      single action    escalate
           │              │
           ▼              ▼
       execute        ┌──────┐
                      │ Plan │  ← capable model (e.g. Gemini Flash)
                      └──┬───┘
                         │
                         ▼
                 execute batch
                         │
                  page changed?
                    │       │
                   no      yes
                    │       │
                    ▼       ▼
                  done   ┌──────────┐
                         │ Continue │  ← re-plan with fresh DOM
                         └──────────┘
```

When a multi-step task causes a page navigation, Kiki automatically grabs a fresh snapshot of the new page and re-plans the remaining steps. This loop continues until the task is complete (or a safety cap of 25 LLM calls is hit).

### Key Design Decisions

- **Direct API calls** — `fetch()` to Gemini/Anthropic/OpenAI REST APIs directly from the service worker. No SDKs, no build step.
- **Deepgram browser auth** — WebSocket with `Sec-WebSocket-Protocol: token, <key>` (Deepgram's documented browser method).
- **Local wake word** — ONNX Runtime Web (WebAssembly) in an offscreen document. Zero network calls for detection.
- **No build step** — Pure vanilla JavaScript with ES modules. No bundler, no transpiler.
- **Stateless commands** — Each voice/hotkey command is independent with no cross-command memory. Chat history persists only for the browser session.

---

## Model Configuration

By default, Kiki uses Gemini models (free tier available). You can switch to Anthropic or OpenAI in **Settings > Model Configuration** on the options page.

| Provider | Models | Get API Key |
|---|---|---|
| **Gemini** (default) | gemini-2.5-flash-lite, gemini-2.5-flash, gemini-2.5-pro, gemini-3.1-flash-lite, gemini-3-flash, gemini-3.1-pro | [Google AI Studio](https://aistudio.google.com/apikey) |
| **Anthropic** | claude-haiku-4-5, claude-sonnet-4-6, claude-opus-4-6 | [Anthropic Console](https://console.anthropic.com/) |
| **OpenAI** | gpt-5.4-nano, gpt-5.4-mini, gpt-5.4, gpt-5-nano, gpt-5-mini, gpt-5 | [OpenAI Platform](https://platform.openai.com/api-keys) |
| **Deepgram** (STT) | nova-3 | [Deepgram Console](https://console.deepgram.com/) |

You can configure different models per task type:
- **Classify** — fast model for simple commands (default: gemini-3.1-flash-lite)
- **Plan** — capable model for multi-step tasks (default: gemini-3-flash)
- **Continue** — re-planning after page changes (default: gemini-3-flash)
- **Chat** — conversational responses (default: gemini-3.1-flash-lite)

---

## Safety

Destructive actions (purchase, send, delete, submit payment) trigger a safety gate. Kiki pauses and asks for vocal confirmation — say "yes" or "confirm" to proceed, or "cancel" to abort.

---

## Contributing

Contributions are welcome! The codebase is pure vanilla JavaScript with no build step.

For AI coding agents (Cursor, Claude, Copilot, etc.), see `AGENTS.md` for architecture details and `CLAUDE.md` for the file impact map and coding rules.

---

## License

MIT — see [LICENSE](LICENSE).
