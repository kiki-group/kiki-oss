// OpenAI provider — direct REST API via fetch()

const API_URL = 'https://api.openai.com/v1/chat/completions';

export async function chat(apiKey, { model, systemPrompt, userMessage, maxTokens, temperature, timeoutMs, jsonMode }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const params = {
      model,
      max_tokens: maxTokens,
      temperature,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
    };
    if (jsonMode !== false) {
      params.response_format = { type: 'json_object' };
    }

    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(params),
      signal: controller.signal,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const msg = err.error?.message || `OpenAI API error (${res.status})`;
      const e = new Error(msg);
      e.status = res.status;
      throw e;
    }

    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || '';
    const finishReason = data.choices?.[0]?.finish_reason;
    return { text, finishReason, truncated: finishReason === 'length' };
  } catch (err) {
    if (err.name === 'AbortError') {
      const e = new Error('OpenAI request timed out');
      e.name = 'AbortError';
      throw e;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export const MODELS = {
  'gpt-5.4-nano': 'gpt-5.4-nano',
  'gpt-5.4-mini': 'gpt-5.4-mini',
  'gpt-5.4':      'gpt-5.4',
  'gpt-5-nano':   'gpt-5-nano',
  'gpt-5-mini':   'gpt-5-mini',
  'gpt-5':        'gpt-5',
};
