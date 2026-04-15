// Run Logger -- records structured traces of every agent task run.
// Logs persist in chrome.storage.local so they survive browser restarts.
// View logs: open DevTools on the service worker → console → paste:
//   chrome.storage.local.get('kiki_runs', r => console.table(r.kiki_runs))
// Or: chrome.storage.local.get('kiki_runs', r => copy(JSON.stringify(r.kiki_runs, null, 2)))

const STORAGE_KEY = 'kiki_runs';
const MAX_RUNS = 50;

let activeRuns = new Map(); // runId → run object

export function logTaskStart(runId, taskDescription, startUrl) {
  const run = {
    runId,
    task: taskDescription,
    startUrl,
    startedAt: new Date().toISOString(),
    steps: [],
    outcome: null,
    endedAt: null,
    totalSteps: 0,
  };
  activeRuns.set(runId, run);
}

export function logStep(runId, { action, actionDescription, result }) {
  const run = activeRuns.get(runId);
  if (!run) return;

  run.steps.push({
    step: run.steps.length + 1,
    ts: new Date().toISOString(),
    action: action || null,
    description: actionDescription || null,
    success: result?.success ?? null,
    error: result?.error || null,
  });
}

export function logAgentAction(runId, agentAction) {
  const run = activeRuns.get(runId);
  if (!run) return;

  run.steps.push({
    step: run.steps.length + 1,
    ts: new Date().toISOString(),
    agentAction: {
      action: agentAction.action,
      thought: agentAction.thought || null,
      ref: agentAction.ref || null,
      text: agentAction.text || null,
      url: agentAction.url || null,
      message: agentAction.message || null,
      question: agentAction.question || null,
    },
  });
}

export async function logTaskEnd(runId, outcome, message) {
  const run = activeRuns.get(runId);
  if (!run) return;

  run.outcome = outcome; // 'done' | 'error' | 'stopped' | 'ask'
  run.endedAt = new Date().toISOString();
  run.totalSteps = run.steps.length;
  run.finalMessage = message || '';

  // Persist to chrome.storage.local
  try {
    const data = await chrome.storage.local.get(STORAGE_KEY);
    const runs = data[STORAGE_KEY] || [];
    runs.push(run);
    // Keep only the last MAX_RUNS
    const trimmed = runs.slice(-MAX_RUNS);
    await chrome.storage.local.set({ [STORAGE_KEY]: trimmed });
  } catch (err) {
    console.error('[run-logger] Failed to persist run:', err);
  }

  activeRuns.delete(runId);
}
