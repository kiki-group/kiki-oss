import { State, getState, transition, cancelToIdle, onStateChange } from './state-machine.js';
import { classify, plan, continueTask, chatMessage } from './api-client.js';
import { logTaskStart, logStep, logAgentAction, logTaskEnd } from './run-logger.js';
import { initTelemetry, trackEvent } from './telemetry.js';

// ---------------------------------------------------------------------------
// Chat history state
// ---------------------------------------------------------------------------

let _chatHistory = [];
const MAX_CHAT_HISTORY = 50;

let _activeSource = null; // 'chat' | 'voice' | null — which mode owns the FSM

let _initPromise = null;

async function ensureInitialized() {
  if (!_initPromise) {
    _initPromise = Promise.all([loadChatHistory(), initTelemetry()])
      .catch(() => { _initPromise = null; });
  }
  return _initPromise;
}

async function loadChatHistory() {
  try {
    const data = await chrome.storage.session.get('chatHistory');
    _chatHistory = data.chatHistory || [];
  } catch { _chatHistory = []; }
}

function saveChatHistory() {
  const trimmed = _chatHistory.slice(-MAX_CHAT_HISTORY);
  _chatHistory = trimmed;
  chrome.storage.session.set({ chatHistory: trimmed }).catch(() => {});
}

function pushChatHistory(role, content) {
  _chatHistory.push({ role, content });
  saveChatHistory();
}

// ---------------------------------------------------------------------------
// Offscreen document lifecycle
// ---------------------------------------------------------------------------

async function ensureOffscreenDocument() {
  try {
    const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
    if (contexts.length > 0) return;
    await chrome.offscreen.createDocument({
      url: 'offscreen/offscreen.html',
      reasons: ['USER_MEDIA'],
      justification: 'Wake word detection and speech recognition require microphone access',
    });
  } catch (err) {
    console.error('[Kiki] ensureOffscreenDocument failed:', err);
  }
}

chrome.runtime.onInstalled.addListener(async (details) => {
  // On first install or if no API keys configured, open options for setup
  const keys = await chrome.storage.local.get(['geminiApiKey', 'anthropicApiKey', 'openaiApiKey']);
  if (details.reason === 'install' || (!keys.geminiApiKey && !keys.anthropicApiKey && !keys.openaiApiKey)) {
    chrome.tabs.create({ url: 'options/options.html' });
  }
  await chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' });
  await loadChatHistory();
  await initTelemetry();
  ensureOffscreenDocument();
});

chrome.runtime.onStartup.addListener(async () => {
  await chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' });
  await loadChatHistory();
  await initTelemetry();
  ensureOffscreenDocument();
});

// ---------------------------------------------------------------------------
// Toolbar icon click → open options page
// ---------------------------------------------------------------------------

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: 'options/options.html' });
});

// ---------------------------------------------------------------------------
// State change → broadcast to all tabs + offscreen
// ---------------------------------------------------------------------------

onStateChange((newState, prevState) => {
  if (newState === State.IDLE) _activeSource = null;
  const msg = { type: 'STATE_CHANGE', state: newState, prevState, source: _activeSource };

  chrome.runtime.sendMessage(msg).catch(() => {});

  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      if (tab.id) chrome.tabs.sendMessage(tab.id, msg).catch(() => {});
    }
  });
});

// ---------------------------------------------------------------------------
// Message router
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {

    case 'KEEPALIVE':
      sendResponse({ ok: true });
      return false;

    case 'WAKE_WORD_DETECTED':
      handleWakeWord();
      return false;

    case 'WAKE_WORD_STATUS':
      broadcastToActiveTab({ type: 'WAKE_WORD_STATUS', status: msg.status, message: msg.message });
      return false;

    case 'TRANSCRIPT_FINAL':
      handleTranscript(msg.transcript);
      return false;

    case 'TRANSCRIPT_TIMEOUT':
      if (getState() === State.LISTENING) transition(State.IDLE);
      return false;

    case 'SAFETY_TRANSCRIPT':
      handleSafetyTranscript(msg.transcript);
      return false;

    case 'SAFETY_CONFIRMED':
      handleSafetyConfirmed(msg.confirmed);
      return false;

    case 'GET_CONFIG':
      chrome.storage.local.get(
        ['language', 'deepgramApiKey'],
        (data) => {
          sendResponse({
            language: data.language || 'en-US',
            deepgramApiKey: data.deepgramApiKey || '',
          });
        }
      );
      return true;

    case 'MIC_PERMISSION_NEEDED':
      broadcastToActiveTab({
        type: 'KIKI_ERROR',
        message: 'Microphone access needed — open Kiki options to grant permission',
      });
      return false;

    case 'REINIT_WAKE_WORD':
      ensureOffscreenDocument();
      sendResponse({ ok: true });
      return false;

    case 'REQUEST_STATE':
      sendResponse({ state: getState(), source: _activeSource });
      return false;

    case 'STOP_EXECUTION':
      if (getState() === State.EXECUTING || getState() === State.PROCESSING) {
        cancelExecution();
        cancelToIdle();
      }
      return false;

    case 'CHAT_MESSAGE':
      handleChatMessage(msg.text);
      return false;

    case 'CHAT_CLEAR':
      _chatHistory = [];
      saveChatHistory();
      return false;

    case 'ASK_USER_RESPONSE':
      handleAskUserResponse(msg.answer);
      return false;

    default:
      return false;
  }
});

// ---------------------------------------------------------------------------
// Wake word handler
// ---------------------------------------------------------------------------

function handleWakeWord() {
  const state = getState();

  if (state === State.EXECUTING || state === State.PROCESSING) {
    cancelExecution();
    cancelToIdle();
    return;
  }

  if (_activeSource === 'chat') {
    broadcastToActiveTab({ type: 'VOICE_BLOCKED' });
    return;
  }

  if (state === State.LISTENING) {
    chrome.runtime.sendMessage({ type: 'STOP_LISTENING' }).catch(() => {});
    transition(State.IDLE);
    return;
  }

  if (state === State.IDLE) {
    _activeSource = 'voice';
    transition(State.LISTENING);
    chrome.runtime.sendMessage({ type: 'START_LISTENING' }).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Transcript → classify → execute (with re-planning for escalated tasks)
// ---------------------------------------------------------------------------

const MAX_LLM_CALLS = 25;

let _aborted = false;
let _pendingSafetyResolve = null;
let _pendingAskUserResolve = null;
let _originalTranscript = '';
let _completedActions = [];
let _isEscalated = false;
let _llmCallCount = 0;
let _lastKnownUrl = '';
let _runId = null;
let _snapshotMode = 'interactive';
let _activeSkillId = null;
let _lastUserAnswer = null;
let _isChatAction = false;

function inferSnapshotMode(transcript) {
  const READING = /\b(extract|read|translate|summarize|summarise|what does|what is|what are|find.*(info|data|detail|number|finding|result|stat)|tell me|content|text|article|paper|paragraph|describe|explain|list the|show me the)\b/i;
  return READING.test(transcript) ? 'reading' : 'interactive';
}

async function handleTranscript(transcript) {
  await ensureInitialized();
  if (!transcript?.trim()) {
    transition(State.IDLE);
    return;
  }

  if (!transition(State.PROCESSING)) return;
  _aborted = false;
  _originalTranscript = transcript;
  _completedActions = [];
  _isEscalated = false;
  _activeSkillId = null;
  _lastUserAnswer = null;
  _llmCallCount = 0;
  _lastKnownUrl = '';
  _snapshotMode = inferSnapshotMode(transcript);
  _runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  broadcastToActiveTab({ type: 'KIKI_TRANSCRIPT', transcript });

  try {
    const activeTab = await getActiveTab();
    if (activeTab?.url && /^(chrome|edge|brave|about|chrome-extension):/.test(activeTab.url)) {
      broadcastToActiveTab({ type: 'KIKI_ERROR', message: "Can't control this page" });
      if (_runId) { logTaskEnd(_runId, 'error', "Can't control this page"); _runId = null; }
      transition(State.IDLE);
      return;
    }

    _lastKnownUrl = activeTab?.url || '';
    logTaskStart(_runId, transcript, _lastKnownUrl);
    trackEvent('session_start');
    trackEvent('command_issued', { actionType: 'pending' });

    const snapshot = await requestDOMSnapshot();

    const allTabs = await chrome.tabs.query({ currentWindow: true });
    const tabSummary = allTabs.map((t, i) => {
      const title = t.title || '(loading)';
      const url = t.url ? ` — ${t.url}` : '';
      return `[${i}]${t.active ? '*' : ''} ${title}${url}`;
    }).join('\n');
    const contextWithTabs = (tabSummary ? 'OPEN TABS:\n' + tabSummary + '\n\n' : '') +
      (snapshot?.compact || '');

    const result = await classify(transcript, contextWithTabs);
    _llmCallCount++;

    if (_aborted) return;

    if (result.error) {
      broadcastToActiveTab({ type: 'KIKI_ERROR', message: result.error });
      if (_runId) { logTaskEnd(_runId, 'error', `Classify: ${result.error}`); _runId = null; }
      transition(State.IDLE);
      return;
    }

    if (result.escalate) {
      _isEscalated = true;
      _activeSkillId = result.skill || null;
      const planResult = await plan(transcript, snapshot?.compact, _activeSkillId);
      _llmCallCount++;

      if (_aborted) return;

      if (planResult.error) {
        broadcastToActiveTab({ type: 'KIKI_ERROR', message: planResult.error });
        if (_runId) { logTaskEnd(_runId, 'error', `Plan: ${planResult.error}`); _runId = null; }
        transition(State.IDLE);
        return;
      }

      await executeActions(planResult.actions || [planResult]);
    } else {
      // Context-changing actions always enable the replan loop. After the
      // new page/tab loads, CONTINUE checks the original transcript against
      // the fresh context and decides if more work is needed.
      // Simple cases: CONTINUE returns done (one extra LLM call).
      // Compound cases ("switch to X and do Y"): CONTINUE plans remaining actions.
      const CONTEXT_CHANGING = new Set(['navigate', 'tab_switch', 'tab_new']);
      const typeNeedsFollowup = result.action === 'type' && !result.params?.submit;
      _isEscalated = CONTEXT_CHANGING.has(result.action) || typeNeedsFollowup;
      await executeActions([result]);
    }
  } catch (err) {
    console.error('[Kiki] Processing error:', err);
    broadcastToActiveTab({ type: 'KIKI_ERROR', message: 'Something went wrong — try again' });
    if (_runId) { logTaskEnd(_runId, 'error', err.message || 'Processing error'); _runId = null; }
    if (getState() !== State.IDLE) transition(State.IDLE);
  }
}

// ---------------------------------------------------------------------------
// Action execution (with re-plan loop for escalated tasks)
// ---------------------------------------------------------------------------

const MAX_SAME_PAGE_SCROLLS = 3;

function expandSubmitActions(actions) {
  const out = [];
  for (const a of actions) {
    if (a.action === 'type' && a.params?.submit) {
      const { submit, ...rest } = a.params;
      if (a.target != null) {
        out.push({ action: 'click', target: a.target });
      }
      out.push({ ...a, params: rest });
      out.push({ action: 'press_key', params: { key: 'Enter' } });
    } else {
      out.push(a);
    }
  }
  return out;
}

async function executeActions(initialActions) {
  if (getState() !== State.EXECUTING && !transition(State.EXECUTING)) return;

  let batch = initialActions;
  let consecutiveReplanCount = 0;
  let consecutiveSamePageScrolls = 0;
  let consecutiveNoProgressBatches = 0;

  while (batch && batch.length > 0) {
    batch = expandSubmitActions(batch);
    console.log('[Kiki] Batch after expansion:', batch.map(a => a.action).join(', '));
    let replanned = false;
    let batchHadProgress = false;

    for (let i = 0; i < batch.length; i++) {
      if (_aborted) return;

      const action = batch[i];

      if (action.action === 'done') {
        if (_runId) { logTaskEnd(_runId, 'done', action.message); _runId = null; }
        trackEvent('session_end', { commandCount: _completedActions.length });
        batch = null;
        break;
      }

      if (action.action === 'error') {
        broadcastToActiveTab({ type: 'KIKI_ERROR', message: action.message });
        if (_runId) { logTaskEnd(_runId, 'error', action.message); _runId = null; }
        trackEvent('session_end', { commandCount: _completedActions.length });
        batch = null;
        break;
      }

      if (action.action === 'show_labels') {
        broadcastToActiveTab({ type: 'SHOW_LABELS' });
        continue;
      }
      if (action.action === 'hide_labels') {
        broadcastToActiveTab({ type: 'HIDE_LABELS' });
        continue;
      }

      let pageChanged = false;

      // Tab-level actions handled by service worker
      if (action.action === 'tab_new') {
        await handleTabNew(action.params?.url);
        // Record with a note that we're now on this tab (so the model doesn't try to tab_switch)
        const tabNewAction = { ...action };
        if (action.params?.url) {
          tabNewAction._note = 'New tab opened and ACTIVATED — you are now on this tab.';
        }
        recordCompletedAction(tabNewAction, true);
        pageChanged = !!action.params?.url;
        if (pageChanged && _isEscalated) {
          batch = await replanAfterPageChange();
          replanned = true;
          break;
        }
        continue;
      }
      if (action.action === 'tab_close') {
        await handleTabClose();
        recordCompletedAction(action, true);
        continue;
      }
      if (action.action === 'tab_switch') {
        const result = await handleTabSwitch(action.params?.title);
        if (!result.switched) {
          recordCompletedAction(action, false, result.reason + ' — check OPEN TABS list and use URL keywords.');
          // Don't replan on failed tab_switch — continue with next action in batch.
          continue;
        }
        if (result.alreadyActive) {
          // Already on this tab — record success but DON'T replan (page didn't change)
          recordCompletedAction(action, true, null, 'Already on this tab — no switch needed.');
          continue;
        }
        recordCompletedAction(action, true);
        if (_isEscalated) {
          batch = await replanAfterPageChange();
          replanned = true;
          break;
        }
        continue;
      }

      // Safety gate
      if (action.confirm) {
        broadcastToActiveTab({ type: 'SAFETY_PROMPT', action });
        chrome.runtime.sendMessage({ type: 'START_LISTENING_CONFIRM' }).catch(() => {});
        const confirmed = await waitForSafetyConfirmation();
        if (!confirmed || _aborted) {
          broadcastToActiveTab({ type: 'SAFETY_CANCELLED' });
          batch = null;
          break;
        }
      }

      // ask_user — pause for user clarification
      if (action.action === 'ask_user') {
        const question = action.params?.question || 'What would you like to do?';
        const options = action.params?.options || [];
        recordCompletedAction(action, true);

        // Show in chat window and broadcast to content script
        broadcastToActiveTab({
          type: 'ASK_USER_PROMPT',
          question,
          options,
        });
        broadcastToActiveTab({
          type: 'CHAT_RESPONSE',
          text: question + (options.length > 0 ? '\n' + options.map((o, i) => `${i + 1}. ${o}`).join('\n') : ''),
        });

        const answer = await waitForUserAnswer();

        if (answer === null || _aborted) {
          // Cancelled
          batch = null;
          break;
        }

        // Store answer and replan with it
        _lastUserAnswer = answer;
        recordCompletedAction({ action: 'user_responded', params: { answer } }, true);

        if (_isEscalated) {
          batch = await replanAfterPageChange();
          replanned = true;
          break;
        }
        batch = null;
        break;
      }

      // Determine if this action can skip DOM settlement + snapshot.
      // Mid-batch actions that don't affect page structure run in quick mode.
      const QUICK_ACTIONS = new Set(['type', 'type_keys', 'press_key', 'focus', 'select', 'hover']);
      const isLastInBatch = i === batch.length - 1;
      const useQuick = !isLastInBatch && QUICK_ACTIONS.has(action.action);

      // Send action to content script for DOM execution
      console.log(`[Kiki] Executing [${i}/${batch.length}]: ${action.action}`, action.target || '', useQuick ? '(quick)' : '');
      let result = await sendToActiveTab({ type: 'EXECUTE_ACTION', action, quick: useQuick });

      if (_aborted) return;

      if (!result && _isEscalated) {
        await sleep(500);
        result = await sendToActiveTab({ type: 'EXECUTE_ACTION', action, quick: useQuick });
      }

      if (!result) {
        console.log(`[Kiki] No result for ${action.action} — can't reach page`);
        recordCompletedAction(action, false, "Can't reach page");
        broadcastToActiveTab({ type: 'KIKI_ERROR', message: "Can't reach this page" });
        batch = null;
        break;
      }

      if (!result.ok) {
        console.log(`[Kiki] Action failed: ${action.action}`, result.error);
        recordCompletedAction(action, false, result.error);

        if (_isEscalated) {
          batch = await replanAfterPageChange();
          replanned = true;
          break;
        } else {
          broadcastToActiveTab({ type: 'KIKI_ERROR', message: result.error || 'Action failed' });
          batch = null;
          break;
        }
      } else {
        console.log(`[Kiki] Action OK: ${action.action}`, result.navigating ? '(navigating)' : '');
        recordCompletedAction(action, true);
        batchHadProgress = true;
        consecutiveReplanCount = 0;

        // Track consecutive same-page scrolls to prevent infinite scroll loops
        const isScroll = action.action === 'scroll' || action.action === 'scroll_to';
        if (isScroll) {
          consecutiveSamePageScrolls++;
        } else {
          consecutiveSamePageScrolls = 0;
        }
      }

      pageChanged = result.navigating ||
        action.action === 'navigate' ||
        action.action === 'back' ||
        action.action === 'forward';

      // Only check for URL changes on actions that can plausibly cause navigation
      const CAN_CHANGE_URL = new Set(['click', 'press_key', 'select']);
      if (!pageChanged && CAN_CHANGE_URL.has(action.action)) {
        pageChanged = await detectURLChange();
      }

      if (pageChanged) {
        consecutiveSamePageScrolls = 0;
        await waitForNavigation();

        if (_isEscalated) {
          batch = await replanAfterPageChange();
          replanned = true;
          break;
        }
      } else if (batch.length > 1 && i < batch.length - 1) {
        await sleep(30);
      }
    }

    if (!replanned && _isEscalated && batch !== null) {
      // Force-stop scroll loops: if we've scrolled N times on the same page
      // without any navigation or non-scroll action, return done with what we have
      if (consecutiveSamePageScrolls >= MAX_SAME_PAGE_SCROLLS) {
        console.warn(`[Kiki] ${consecutiveSamePageScrolls} consecutive same-page scrolls — forcing done`);
        if (_runId) { logTaskEnd(_runId, 'done', 'Forced done after scroll limit'); _runId = null; }
        break;
      }

      // Tab ping-pong detection: if 4+ of the last 6 completed actions are tab_switch/tab_new, force done
      const recentSix = _completedActions.slice(-6);
      const tabActionCount = recentSix.filter(a => a.action === 'tab_switch' || a.action === 'tab_new').length;
      if (tabActionCount >= 4) {
        console.warn('[Kiki] Tab ping-pong detected (' + tabActionCount + ' tab actions in last ' + recentSix.length + ') — forcing done');
        if (_runId) { logTaskEnd(_runId, 'done', 'Tab ping-pong detected'); _runId = null; }
        break;
      }

      // Track consecutive batches with no real progress (all no-ops or failures).
      // After 2 such batches, stop — the model is stuck in a loop.
      if (!batchHadProgress) {
        consecutiveNoProgressBatches++;
        if (consecutiveNoProgressBatches >= 2) {
          console.warn('[Kiki] No progress in ' + consecutiveNoProgressBatches + ' consecutive batches — stopping');
          if (_runId) { logTaskEnd(_runId, 'done', 'No progress — stuck in loop'); _runId = null; }
          break;
        }
      } else {
        consecutiveNoProgressBatches = 0;
      }

      consecutiveReplanCount++;
      if (consecutiveReplanCount > 10) {
        console.warn('[Kiki] Too many consecutive replans without progress');
        if (_runId) { logTaskEnd(_runId, 'error', 'Too many consecutive replans without progress'); _runId = null; }
        break;
      }
      batch = await replanAfterPageChange();
      if (batch && batch.length > 0) continue;
    }

    if (replanned) {
      consecutiveReplanCount++;
      if (consecutiveReplanCount > 10) {
        console.warn('[Kiki] Too many consecutive replans');
        if (_runId) { logTaskEnd(_runId, 'error', 'Too many consecutive replans'); _runId = null; }
        break;
      }
      continue;
    }

    break;
  }

  if (!_aborted && getState() === State.EXECUTING) {
    // End run if not already ended by a done/error action
    if (_runId) {
      logTaskEnd(_runId, 'done', 'Task execution completed');
      _runId = null;
    }
    transition(State.IDLE);
  }
}

function recordCompletedAction(action, success, error, note) {
  const record = {
    action: action.action,
    success,
  };
  if (action.target !== undefined) record.target = action.target;
  if (action.params) record.params = action.params;
  if (error) record.error = error;
  if (note || action._note) record._note = note || action._note;
  if (_lastKnownUrl) record.url = _lastKnownUrl;

  _completedActions.push(record);

  // Log to persistent run logger
  if (_runId) {
    logAgentAction(_runId, {
      action: action.action,
      ref: action.target,
      text: action.params?.text,
      url: action.params?.url,
      message: action.message,
    });
    logStep(_runId, {
      action: action.action,
      actionDescription: `${action.action}${action.target ? ` → ${action.target}` : ''}${action.params?.text ? ` "${action.params.text}"` : ''}`,
      result: { success, error: error || null },
    });
  }

  // Telemetry — action type + success/failure only, no content
  if (success) {
    trackEvent('command_succeeded', { actionType: action.action });
  } else {
    trackEvent('command_failed', { actionType: action.action, errorCategory: error || 'unknown' });
  }
}

async function detectURLChange() {
  try {
    const tab = await getActiveTab();
    const currentUrl = tab?.url || '';
    if (currentUrl && _lastKnownUrl && currentUrl !== _lastKnownUrl) {
      _lastKnownUrl = currentUrl;
      return true;
    }
    _lastKnownUrl = currentUrl;
  } catch { /* ignore */ }
  return false;
}

/**
 * After a page change or batch completion in an escalated task:
 * grab fresh DOM, ask the model what to do next or if we're done.
 */
async function replanAfterPageChange() {
  if (_aborted) return null;

  if (_llmCallCount >= MAX_LLM_CALLS) {
    console.warn('[Kiki] LLM call budget exhausted (' + MAX_LLM_CALLS + ')');
    broadcastToActiveTab({
      type: 'KIKI_ERROR',
      message: 'Task stopped — too many steps. Try breaking it into smaller commands.',
    });
    if (_runId) { logTaskEnd(_runId, 'error', 'LLM call budget exhausted'); _runId = null; }
    return null;
  }

  // Removed fixed sleep(400) — DOM settlement is now handled adaptively
  // by the content script's waitForDOMSettled (via settle:true).

  const [snapshot, activeTab, allTabs] = await Promise.all([
    requestDOMSnapshot({ settle: true }),
    getActiveTab(),
    chrome.tabs.query({ currentWindow: true }),
  ]);
  if (_aborted) return null;

  const currentUrl = activeTab?.url || '';
  _lastKnownUrl = currentUrl;

  const tabSummary = allTabs.map((t, i) => {
    const title = t.title || '(loading)';
    const url = t.url ? ` — ${t.url}` : '';
    return `[${i}]${t.active ? '*' : ''} ${title}${url}`;
  }).join('\n');

  const pageContext = (tabSummary ? 'OPEN TABS:\n' + tabSummary + '\n\n' : '') +
    (snapshot?.compact || '');

  const result = await continueTask(
    _originalTranscript,
    _completedActions,
    pageContext,
    MAX_LLM_CALLS,
    _activeSkillId,
    _lastUserAnswer
  );
  _lastUserAnswer = null; // consumed
  _llmCallCount++;

  if (_aborted) return null;

  if (result.error) {
    broadcastToActiveTab({ type: 'KIKI_ERROR', message: result.error });
    return null;
  }

  const newActions = result.actions || [];

  if (newActions.length === 0 || (newActions.length === 1 && newActions[0].action === 'done')) {
    return null;
  }

  return newActions;
}

function cancelExecution() {
  _aborted = true;
  if (_runId) { logTaskEnd(_runId, 'stopped', 'User cancelled'); _runId = null; }
  _completedActions = [];
  _isEscalated = false;
  _isChatAction = false;
  _llmCallCount = 0;
  if (_pendingSafetyResolve) {
    _pendingSafetyResolve(false);
    _pendingSafetyResolve = null;
  }
  if (_pendingAskUserResolve) {
    _pendingAskUserResolve(null); // null = cancelled
    _pendingAskUserResolve = null;
  }
  _activeSkillId = null;
  _lastUserAnswer = null;
  broadcastToActiveTab({ type: 'CANCEL_ACTIONS' });
  broadcastToActiveTab({ type: 'CHAT_TYPING', show: false });
  broadcastToActiveTab({ type: 'CHAT_STATUS', text: '' });
}

const SAFETY_TIMEOUT_MS = 30_000;

function waitForSafetyConfirmation() {
  return new Promise(resolve => {
    _pendingSafetyResolve = resolve;
    setTimeout(() => {
      if (_pendingSafetyResolve === resolve) {
        _pendingSafetyResolve = null;
        resolve(false);
      }
    }, SAFETY_TIMEOUT_MS);
  });
}

function handleSafetyConfirmed(confirmed) {
  if (_pendingSafetyResolve) {
    _pendingSafetyResolve(confirmed);
    _pendingSafetyResolve = null;
  }
}

// ---------------------------------------------------------------------------
// ask_user — pause execution for user clarification (no timeout)
// ---------------------------------------------------------------------------

function waitForUserAnswer() {
  return new Promise(resolve => {
    _pendingAskUserResolve = resolve;
    // No timeout — user takes as long as they need.
    // Cancellation is handled via _aborted / cancelExecution().
  });
}

function handleAskUserResponse(answer) {
  if (_pendingAskUserResolve) {
    _pendingAskUserResolve(answer);
    _pendingAskUserResolve = null;
  }
}

const CONFIRM_WORDS = ['yes', 'yeah', 'yep', 'yup', 'confirm', 'do it', 'go ahead', 'proceed', 'ok', 'okay', 'sure', 'affirmative', 'approve'];
const CANCEL_WORDS = ['no', 'nope', 'cancel', 'stop', 'abort', 'never mind', 'negative', 'wait', 'hold on', "don't", 'do not'];

function matchesWord(phrase, word) {
  if (phrase === word) return true;
  const re = new RegExp('\\b' + word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b');
  return re.test(phrase);
}

function handleSafetyTranscript(transcript) {
  if (!transcript) {
    handleSafetyConfirmed(false);
    return;
  }

  const lower = transcript.toLowerCase().trim();
  if (CANCEL_WORDS.some(w => matchesWord(lower, w))) {
    handleSafetyConfirmed(false);
    return;
  }
  const isConfirm = CONFIRM_WORDS.some(w => matchesWord(lower, w));
  handleSafetyConfirmed(isConfirm);
}

// ---------------------------------------------------------------------------
// Chat mode handler
// ---------------------------------------------------------------------------

async function handleChatMessage(text) {
  await ensureInitialized();
  if (!text?.trim()) return;

  if (_activeSource === 'voice') {
    broadcastChatResponse("I\u2019m currently handling a voice command. Once it\u2019s done, send your message again.");
    return;
  }

  pushChatHistory('user', text);
  broadcastToActiveTab({ type: 'CHAT_TYPING', show: true });

  try {
    const snapshot = await requestDOMSnapshot();
    const pageCtx = snapshot?.compact || '';

    const canAct = getState() === State.IDLE;

    if (canAct) {
      _activeSource = 'chat';
      transition(State.LISTENING);
    }

    if (canAct) {
      _isChatAction = true;
      const actionPromise = handleTranscript(text);
      await actionPromise;
      _isChatAction = false;

      const TRIVIAL_ACTIONS = new Set(['scroll', 'scroll_to', 'navigate', 'tab_switch', 'tab_new', 'tab_close', 'press_key']);
      const isTrivial = _completedActions.length <= 1 &&
        _completedActions.every(a => TRIVIAL_ACTIONS.has(a.action) && a.success);
      const actionSummary = isTrivial ? null : buildActionSummary();

      const freshSnapshot = await requestDOMSnapshot();
      const freshCtx = freshSnapshot?.compact || '';
      const chatResult = await chatMessage(
        _chatHistory,
        freshCtx,
        actionSummary
      );
      const reply = chatResult.reply || chatResult.error || 'Sorry, something went wrong.';

      broadcastToActiveTab({ type: 'CHAT_TYPING', show: false });
      pushChatHistory('assistant', reply);
      broadcastChatResponse(reply);
    } else {
      const chatResult = await chatMessage(_chatHistory, pageCtx);
      const reply = chatResult.reply || chatResult.error || 'Sorry, something went wrong.';

      broadcastToActiveTab({ type: 'CHAT_TYPING', show: false });
      pushChatHistory('assistant', reply);
      broadcastChatResponse(reply);
    }
  } catch (err) {
    console.error('[Kiki] Chat error:', err);
    broadcastToActiveTab({ type: 'CHAT_TYPING', show: false });
    const errMsg = 'Something went wrong \u2014 try again.';
    pushChatHistory('assistant', errMsg);
    broadcastChatResponse(errMsg);
  }
}

function buildActionSummary() {
  if (_completedActions.length === 0) return null;
  const parts = _completedActions.map((a, i) => {
    let desc = `${i + 1}. ${a.action}`;
    if (a.params?.text) desc += ` "${a.params.text}"`;
    if (a.params?.url) desc += ` → ${a.params.url}`;
    desc += a.success ? ' (done)' : ` (failed: ${a.error || 'unknown'})`;
    return desc;
  });
  return parts.join('; ');
}

function broadcastChatResponse(text) {
  broadcastToActiveTab({ type: 'CHAT_RESPONSE', text });
}

// ---------------------------------------------------------------------------
// Tab actions
// ---------------------------------------------------------------------------

async function handleTabNew(url) {
  const tab = await chrome.tabs.create({ url: url || 'chrome://newtab' });
  if (url) await waitForTabLoad(tab.id);
}

async function handleTabClose() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) await chrome.tabs.remove(tab.id);
}

async function handleTabSwitch(titleQuery) {
  if (!titleQuery) return { switched: false, reason: 'No title provided' };
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const lower = titleQuery.toLowerCase();
  // Skip "undefined", "(loading)", and empty queries
  if (lower === 'undefined' || lower === '(loading)' || lower === 'null') {
    return { switched: false, reason: 'Invalid tab title' };
  }
  const match = tabs.find(t => t.title?.toLowerCase().includes(lower)) ||
                tabs.find(t => t.url?.toLowerCase().includes(lower));
  if (!match) return { switched: false, reason: 'No matching tab found' };
  // Already on this tab — no-op
  if (match.active) return { switched: true, alreadyActive: true };
  await chrome.tabs.update(match.id, { active: true });
  await sleep(300);
  return { switched: true, alreadyActive: false };
}

function waitForTabLoad(tabId, timeoutMs = 12000) {
  return new Promise(resolve => {
    const timeout = setTimeout(() => { cleanup(); resolve(); }, timeoutMs);
    function onUpdated(id, info) {
      if (id === tabId && info.status === 'complete') { cleanup(); resolve(); }
    }
    function cleanup() {
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    }
    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

async function waitForNavigation(timeoutMs = 10000) {
  const tabId = await getActiveTabId();

  const navComplete = new Promise(resolve => {
    const timeout = setTimeout(() => { cleanup(); resolve(); }, timeoutMs);
    function onCompleted(details) {
      if (details.frameId === 0 && (!tabId || details.tabId === tabId)) {
        cleanup();
        resolve();
      }
    }
    function cleanup() {
      clearTimeout(timeout);
      chrome.webNavigation?.onCompleted.removeListener(onCompleted);
    }
    chrome.webNavigation?.onCompleted.addListener(onCompleted);
  });

  await navComplete;
  // Removed fixed sleep(500) — DOM settlement is now handled adaptively
  // by the content script's waitForDOMSettled (via settle:true in requestDOMSnapshot).
  // Content script injection is handled by retry logic in requestDOMSnapshot.
}

// ---------------------------------------------------------------------------
// Communication helpers
// ---------------------------------------------------------------------------

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function getActiveTabId() {
  const tab = await getActiveTab();
  return tab?.id;
}

async function sendToActiveTab(msg) {
  const tabId = await getActiveTabId();
  if (!tabId) return null;
  try {
    return await chrome.tabs.sendMessage(tabId, msg);
  } catch {
    return null;
  }
}

async function broadcastToActiveTab(msg) {
  const tabId = await getActiveTabId();
  if (!tabId) return;
  chrome.tabs.sendMessage(tabId, msg).catch(() => {});
}

async function requestDOMSnapshot(options) {
  const mode = (options && typeof options === 'object') ? (options.mode || _snapshotMode) : (options || _snapshotMode);
  const settle = (options && typeof options === 'object') ? !!options.settle : false;
  const tabId = await getActiveTabId();
  if (!tabId) return null;

  // Retry up to 3 times — content script may not be injected yet after navigation
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await chrome.tabs.sendMessage(tabId, { type: 'REQUEST_DOM', mode, settle });
    } catch {
      if (attempt < 2) await sleep(150);
    }
  }
  return null;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
