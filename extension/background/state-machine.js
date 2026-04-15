// Kiki State Machine
// 5 states: IDLE → LISTENING → PROCESSING → EXECUTING → IDLE
//           EXECUTING → PAUSED → IDLE (wake word cancels)

export const State = Object.freeze({
  IDLE: 'IDLE',
  LISTENING: 'LISTENING',
  PROCESSING: 'PROCESSING',
  EXECUTING: 'EXECUTING',
  PAUSED: 'PAUSED',
});

const VALID_TRANSITIONS = {
  [State.IDLE]:       [State.LISTENING],
  [State.LISTENING]:  [State.PROCESSING, State.IDLE],
  [State.PROCESSING]: [State.EXECUTING, State.IDLE],
  [State.EXECUTING]:  [State.IDLE, State.PAUSED],
  [State.PAUSED]:     [State.IDLE],
};

const PAUSE_AUTO_IDLE_MS = 500;

let _state = State.IDLE;
let _pauseTimer = null;
let _listeners = [];

export function getState() {
  return _state;
}

export function transition(nextState) {
  if (_state === nextState) return false;

  const allowed = VALID_TRANSITIONS[_state];
  if (!allowed || !allowed.includes(nextState)) {
    console.warn(`[Kiki FSM] Invalid transition: ${_state} → ${nextState}`);
    return false;
  }

  const prev = _state;
  _state = nextState;

  if (_pauseTimer) {
    clearTimeout(_pauseTimer);
    _pauseTimer = null;
  }

  if (nextState === State.PAUSED) {
    _pauseTimer = setTimeout(() => {
      _pauseTimer = null;
      transition(State.IDLE);
    }, PAUSE_AUTO_IDLE_MS);
  }

  broadcast(nextState, prev);
  return true;
}

/**
 * Force-cancel: from any active state back to IDLE.
 * Used when the wake word fires during execution.
 */
export function cancelToIdle() {
  if (_state === State.IDLE) return;
  const prev = _state;
  _state = State.PAUSED;
  broadcast(State.PAUSED, prev);

  if (_pauseTimer) clearTimeout(_pauseTimer);
  _pauseTimer = setTimeout(() => {
    _pauseTimer = null;
    _state = State.IDLE;
    broadcast(State.IDLE, State.PAUSED);
  }, PAUSE_AUTO_IDLE_MS);
}

export function onStateChange(fn) {
  _listeners.push(fn);
  return () => { _listeners = _listeners.filter(l => l !== fn); };
}

function broadcast(newState, prevState) {
  for (const fn of _listeners) {
    try { fn(newState, prevState); } catch (e) { console.error('[Kiki FSM] Listener error:', e); }
  }
}
