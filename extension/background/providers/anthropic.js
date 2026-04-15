// Anthropic provider — direct REST API via fetch()

const API_URL = 'https://api.anthropic.com/v1/messages';

export async function chat(apiKey, { model, systemPrompt, userMessage, maxTokens, temperature, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        temperature,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const msg = err.error?.message || `Anthropic API error (${res.status})`;
      const e = new Error(msg);
      e.status = res.status;
      throw e;
    }

    const data = await res.json();
    const text = data.content?.[0]?.text || '';
    return { text, finishReason: data.stop_reason, truncated: data.stop_reason === 'max_tokens' };
  } catch (err) {
    if (err.name === 'AbortError') {
      const e = new Error('Anthropic request timed out');
      e.name = 'AbortError';
      throw e;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export const MODELS = {
  'claude-haiku-4-5':  'claude-haiku-4-5-20251001',
  'claude-sonnet-4-6': 'claude-sonnet-4-6',
  'claude-opus-4-6':   'claude-opus-4-6',
};
