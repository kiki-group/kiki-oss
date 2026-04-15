// Provider router — routes LLM calls to the correct provider

import * as anthropic from './anthropic.js';
import * as openai from './openai.js';
import * as gemini from './gemini.js';

const providers = { anthropic, openai, gemini };

export function getProvider(name) {
  const provider = providers[name];
  if (!provider) {
    throw new Error(`Unknown provider "${name}". Available: ${Object.keys(providers).join(', ')}`);
  }
  return provider;
}

export function listModels() {
  const result = {};
  for (const [name, provider] of Object.entries(providers)) {
    result[name] = Object.keys(provider.MODELS);
  }
  return result;
}

/**
 * Unified chat interface — routes to the correct provider.
 *
 * @param {string} apiKey       - API key for the provider
 * @param {object} routeConfig  - { provider: string, model: string }
 * @param {object} params       - { systemPrompt, userMessage, maxTokens, temperature, timeoutMs, jsonMode? }
 * @returns {{ text: string, finishReason: string, truncated: boolean }}
 */
export async function chat(apiKey, routeConfig, params) {
  const provider = getProvider(routeConfig.provider);
  return provider.chat(apiKey, {
    model: provider.MODELS[routeConfig.model] || routeConfig.model,
    ...params,
  });
}
