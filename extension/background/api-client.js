// API Client — calls LLM providers directly from the extension (no server)

import MODEL_CONFIG from './model-config.js';
import { chat } from './providers/index.js';
import {
  TIER1_SYSTEM, TIER2_SYSTEM, CONTINUE_SYSTEM, CHAT_SYSTEM, ASK_USER_SCHEMA,
  buildTier1Message, buildTier2Message, buildContinueMessage, buildChatMessage,
  userNamePrefix, chatAndParse,
} from './prompts.js';
import { formatSkillsForClassify, formatSkillForPrompt } from './skills/loader.js';

const CLASSIFY_TIMEOUT = 15_000;
const PLAN_TIMEOUT = 60_000;
const CONTINUE_TIMEOUT = 60_000;
const CHAT_TIMEOUT = 30_000;

const API_KEY_NAMES = {
  gemini: 'geminiApiKey',
  anthropic: 'anthropicApiKey',
  openai: 'openaiApiKey',
};

async function getActiveConfig() {
  try {
    const data = await chrome.storage.local.get('modelConfig');
    if (data.modelConfig) {
      return { ...MODEL_CONFIG, ...data.modelConfig };
    }
  } catch {}
  return { ...MODEL_CONFIG };
}

async function getApiKey(provider) {
  const keyName = API_KEY_NAMES[provider];
  if (!keyName) throw new Error(`Unknown provider: ${provider}`);
  try {
    const data = await chrome.storage.local.get(keyName);
    return data[keyName] || '';
  } catch {
    return '';
  }
}

async function getUserName() {
  try {
    const data = await chrome.storage.local.get('userName');
    return data.userName || '';
  } catch {
    return '';
  }
}

async function getSkillsEnabled() {
  try {
    const data = await chrome.storage.local.get('skillsEnabled');
    return !!data.skillsEnabled;
  } catch {
    return false;
  }
}

function handleProviderError(err) {
  if (err.name === 'AbortError') return { error: 'AI request timed out' };
  const status = err.status || err.code;
  if (status === 401) return { error: 'Invalid API key — check your settings in the Kiki options page' };
  if (status === 404) return { error: 'Model not found — check model name in Kiki settings' };
  if (status === 429) return { error: 'Rate limited by LLM provider — wait a moment and try again' };
  if (status === 529 || status === 503) return { error: 'LLM provider is overloaded — try again shortly' };
  return { error: `AI service error: ${err.message || 'unexpected failure'}` };
}

/**
 * Fast classification — returns a single action object or { escalate: true }.
 */
export async function classify(transcript, pageContext) {
  try {
    const config = await getActiveConfig();
    const apiKey = await getApiKey(config.classify.provider);
    if (!apiKey) return { error: 'No API key configured — open Kiki settings to add one' };

    const skillsEnabled = await getSkillsEnabled();
    const systemPrompt = TIER1_SYSTEM + (skillsEnabled ? formatSkillsForClassify() : '');
    const userMessage = buildTier1Message(transcript, pageContext);

    const parsed = await chatAndParse(apiKey, config.classify, {
      systemPrompt,
      userMessage,
      maxTokens: 4096,
      temperature: 0.1,
      timeoutMs: CLASSIFY_TIMEOUT,
    });

    if (!parsed) return { error: 'Invalid response from AI' };
    return parsed;
  } catch (err) {
    return handleProviderError(err);
  }
}

/**
 * Complex action planning — returns { actions: [...] }.
 */
export async function plan(transcript, accessibilityTree, skillId) {
  try {
    const config = await getActiveConfig();
    const apiKey = await getApiKey(config.plan.provider);
    if (!apiKey) return { error: 'No API key configured — open Kiki settings to add one' };

    const userName = await getUserName();
    let userMessage = buildTier2Message(transcript, accessibilityTree);
    const skillsEnabled = await getSkillsEnabled();
    const useSkill = skillsEnabled && skillId;
    if (useSkill) userMessage += formatSkillForPrompt(skillId);
    const nameCtx = userNamePrefix(userName);

    const parsed = await chatAndParse(apiKey, config.plan, {
      systemPrompt: nameCtx + (useSkill ? TIER2_SYSTEM + ASK_USER_SCHEMA : TIER2_SYSTEM),
      userMessage,
      maxTokens: 4096,
      temperature: 0.1,
      timeoutMs: PLAN_TIMEOUT,
    });

    if (!parsed) return { error: 'Invalid response from AI' };
    const actions = Array.isArray(parsed) ? parsed : [parsed];
    return { actions };
  } catch (err) {
    return handleProviderError(err);
  }
}

/**
 * Continue: re-plan after a page change during an escalated task.
 * Returns { actions: [...] } where actions may include { action: "done" }.
 */
export async function continueTask(transcript, completedActions, pageContext, stepBudget, skillId, userAnswer) {
  try {
    const config = await getActiveConfig();
    const apiKey = await getApiKey(config.continue.provider);
    if (!apiKey) return { error: 'No API key configured — open Kiki settings to add one' };

    const userName = await getUserName();
    let userMessage = buildContinueMessage(transcript, completedActions, pageContext, stepBudget);
    const skillsEnabled = await getSkillsEnabled();
    const useSkill = skillsEnabled && skillId;
    if (useSkill) userMessage += formatSkillForPrompt(skillId);
    if (userAnswer) userMessage += `\n\nUSER RESPONSE TO QUESTION: "${userAnswer}"`;
    const nameCtx = userNamePrefix(userName);

    const parsed = await chatAndParse(apiKey, config.continue, {
      systemPrompt: nameCtx + (useSkill ? CONTINUE_SYSTEM + ASK_USER_SCHEMA : CONTINUE_SYSTEM),
      userMessage,
      maxTokens: 4096,
      temperature: 0.1,
      timeoutMs: CONTINUE_TIMEOUT,
    });

    if (!parsed) return { error: 'Invalid response from AI' };
    const actions = Array.isArray(parsed) ? parsed : [parsed];
    return { actions };
  } catch (err) {
    return handleProviderError(err);
  }
}

/**
 * Chat: conversational response layer for chat mode.
 * Returns { reply: "..." } or { error: "..." }.
 */
export async function chatMessage(messages, pageContext, actionUpdate) {
  try {
    const config = await getActiveConfig();
    const apiKey = await getApiKey(config.chat.provider);
    if (!apiKey) return { error: 'No API key configured — open Kiki settings to add one' };

    const userName = await getUserName();
    const userMessage = buildChatMessage(messages, pageContext, actionUpdate);

    const result = await chat(apiKey, config.chat, {
      systemPrompt: userNamePrefix(userName) + CHAT_SYSTEM,
      userMessage,
      maxTokens: 2048,
      temperature: 0.4,
      timeoutMs: CHAT_TIMEOUT,
      jsonMode: false,
    });

    return { reply: result.text.trim() };
  } catch (err) {
    return handleProviderError(err);
  }
}

/**
 * Validate an API key by making a lightweight test call.
 * Returns { valid: true } or { valid: false, error: "..." }.
 */
export async function validateApiKey(provider, apiKey) {
  try {
    const providerModule = await import(`./providers/${provider}.js`);
    const models = Object.values(providerModule.MODELS);
    const testModel = models[0];

    await providerModule.chat(apiKey, {
      model: testModel,
      systemPrompt: 'Reply with: ok',
      userMessage: 'test',
      maxTokens: 10,
      temperature: 0,
      timeoutMs: 10_000,
      jsonMode: false,
    });

    return { valid: true };
  } catch (err) {
    const status = err.status || err.code;
    if (status === 401) return { valid: false, error: 'Invalid API key' };
    if (err.name === 'AbortError') return { valid: false, error: 'Request timed out' };
    return { valid: false, error: err.message || 'Unknown error' };
  }
}
