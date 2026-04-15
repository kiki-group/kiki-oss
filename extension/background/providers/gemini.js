// Gemini provider — direct REST API via fetch()

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

export async function chat(apiKey, { model, systemPrompt, userMessage, maxTokens, temperature, timeoutMs, jsonMode }) {
  const url = `${API_BASE}/${model}:generateContent`;
  const generationConfig = { maxOutputTokens: maxTokens, temperature };
  if (jsonMode !== false) {
    generationConfig.responseMimeType = 'application/json';
  }

  const body = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [{ parts: [{ text: userMessage }] }],
    generationConfig,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const msg = err.error?.message || `Gemini API error (${res.status})`;
      const e = new Error(msg);
      e.status = res.status;
      throw e;
    }

    const data = await res.json();
    const candidate = data.candidates?.[0];
    const text = candidate?.content?.parts?.[0]?.text || '';
    const finishReason = candidate?.finishReason || 'UNKNOWN';
    return { text, finishReason, truncated: finishReason === 'MAX_TOKENS' };
  } catch (err) {
    if (err.name === 'AbortError') {
      const e = new Error('Gemini request timed out');
      e.name = 'AbortError';
      throw e;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export const MODELS = {
  'gemini-2.5-flash-lite': 'gemini-2.5-flash-lite',
  'gemini-2.5-flash':      'gemini-2.5-flash',
  'gemini-2.5-pro':        'gemini-2.5-pro',
  'gemini-3.1-flash-lite': 'gemini-3.1-flash-lite-preview',
  'gemini-3-flash':        'gemini-3-flash-preview',
  'gemini-3.1-pro':        'gemini-3.1-pro-preview',
};
