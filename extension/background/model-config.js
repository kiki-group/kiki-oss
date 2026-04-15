// ---------------------------------------------------------------------------
// Model Configuration — default provider + model per route
// ---------------------------------------------------------------------------
//
// Each route maps to a { provider, model } pair.
// Users can override these via the extension options page.
// Overrides are stored in chrome.storage.local under key "modelConfig".
//
// ┌─────────────┬────────────────────────────────────────────────────────────┐
// │  Provider   │  Available model aliases                                  │
// ├─────────────┼────────────────────────────────────────────────────────────┤
// │  gemini     │  gemini-2.5-flash-lite, gemini-2.5-flash, gemini-2.5-pro │
// │             │  gemini-3.1-flash-lite, gemini-3-flash, gemini-3.1-pro   │
// ├─────────────┼────────────────────────────────────────────────────────────┤
// │  anthropic  │  claude-haiku-4-5, claude-sonnet-4-6, claude-opus-4-6    │
// ├─────────────┼────────────────────────────────────────────────────────────┤
// │  openai     │  gpt-5.4-nano, gpt-5.4-mini, gpt-5.4,                   │
// │             │  gpt-5-nano, gpt-5-mini, gpt-5                           │
// └─────────────┴────────────────────────────────────────────────────────────┘
//
// Required API keys per provider (stored in chrome.storage.local):
//   gemini    → geminiApiKey
//   anthropic → anthropicApiKey
//   openai    → openaiApiKey
//
// Deepgram STT always requires deepgramApiKey.
// ---------------------------------------------------------------------------

const MODEL_CONFIG = {

  // Tier 1 — fast single-action classification
  classify: {
    provider: 'gemini',
    model: 'gemini-3.1-flash-lite',
  },

  // Tier 2 — multi-step action planning
  plan: {
    provider: 'gemini',
    model: 'gemini-3-flash',
  },

  // Continue — re-plan after page navigation during escalated tasks
  continue: {
    provider: 'gemini',
    model: 'gemini-3-flash',
  },

  // Chat — conversational responses in chat mode
  chat: {
    provider: 'gemini',
    model: 'gemini-3.1-flash-lite',
  },

};

export default MODEL_CONFIG;
