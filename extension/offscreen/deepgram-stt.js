// Deepgram Nova-3 streaming STT — direct WebSocket connection (no server proxy)

const MAX_LISTEN_MS = 15_000;
const CONFIRM_LISTEN_MS = 8_000;

let _ws = null;
let _mediaRecorder = null;
let _stream = null;
let _callbacks = null;
let _listenTimer = null;
let _mode = null; // 'command' | 'confirm'
let _finalTranscript = '';
let _finalized = false;

const DEEPGRAM_LANG_MAP = {
  'es-ES': 'es',
  'fr-FR': 'fr',
  'de-DE': 'de',
  'ja-JP': 'ja',
  'ko-KR': 'ko',
  'zh-CN': 'zh',
  'zh-TW': 'zh-TW',
  'pt-PT': 'pt',
};

function toDeepgramLang(code) {
  if (!code) return 'en';
  if (DEEPGRAM_LANG_MAP[code]) return DEEPGRAM_LANG_MAP[code];
  return code;
}

/**
 * Start listening for a voice command.
 * @param {{ onFinalTranscript: Function, onTimeout: Function }} callbacks
 */
export function startListening(callbacks) {
  cleanup();
  _mode = 'command';
  _callbacks = callbacks;
  _finalTranscript = '';
  _finalized = false;
  begin();
}

/**
 * Start listening for safety confirmation (yes/no).
 * Shorter timeout, single result.
 * @param {{ onResult: Function, onTimeout: Function }} callbacks
 */
export function startConfirmListening(callbacks) {
  cleanup();
  _mode = 'confirm';
  _callbacks = callbacks;
  _finalTranscript = '';
  _finalized = false;
  begin();
}

export function stopListening() {
  finalize('stopped');
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

async function begin() {
  let deepgramApiKey = '';
  let lang = 'en-US';
  try {
    const config = await chrome.runtime.sendMessage({ type: 'GET_CONFIG' });
    if (config?.deepgramApiKey) deepgramApiKey = config.deepgramApiKey;
    if (config?.language) lang = config.language;
  } catch {}

  if (!deepgramApiKey) {
    console.error('[Kiki Deepgram] No Deepgram API key configured — open Kiki settings');
    _callbacks?.onTimeout?.();
    cleanup();
    return;
  }

  const dgUrl = new URL('wss://api.deepgram.com/v1/listen');
  dgUrl.searchParams.set('model', 'nova-3');
  dgUrl.searchParams.set('smart_format', 'true');
  dgUrl.searchParams.set('interim_results', 'true');
  dgUrl.searchParams.set('endpointing', '300');
  dgUrl.searchParams.set('language', toDeepgramLang(lang));

  try {
    _stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    console.error('[Kiki Deepgram] getUserMedia failed:', err.message);
    chrome.runtime.sendMessage({ type: 'MIC_PERMISSION_NEEDED' }).catch(() => {});
    _callbacks?.onTimeout?.();
    cleanup();
    return;
  }

  try {
    _ws = new WebSocket(dgUrl.toString(), ['token', deepgramApiKey]);
    _ws.binaryType = 'arraybuffer';
  } catch (err) {
    console.error('[Kiki Deepgram] WebSocket open failed:', err.message);
    finalize('error');
    return;
  }

  _ws.onopen = () => {
    startRecording();
  };

  _ws.onmessage = (event) => {
    handleDeepgramMessage(event.data);
  };

  _ws.onerror = (event) => {
    console.error('[Kiki Deepgram] WebSocket error:', event.type);
    finalize('error');
  };

  _ws.onclose = (event) => {
    if (!_finalized) {
      if (event.code === 4001) {
        console.error('[Kiki Deepgram] Deepgram API key not configured or invalid — open Kiki settings');
      }
      finalize('ws_closed');
    }
  };

  const timeout = _mode === 'confirm' ? CONFIRM_LISTEN_MS : MAX_LISTEN_MS;
  _listenTimer = setTimeout(() => finalize('timeout'), timeout);
}

function startRecording() {
  if (!_stream || !_ws || _ws.readyState !== WebSocket.OPEN) return;

  const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus'
    : 'audio/webm';

  _mediaRecorder = new MediaRecorder(_stream, { mimeType });

  _mediaRecorder.ondataavailable = (event) => {
    if (event.data.size > 0 && _ws && _ws.readyState === WebSocket.OPEN) {
      _ws.send(event.data);
    }
  };

  _mediaRecorder.onerror = () => finalize('recorder_error');
  _mediaRecorder.start(250);
}

function handleDeepgramMessage(raw) {
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch {
    return;
  }

  if (msg.type !== 'Results') return;

  const alt = msg.channel?.alternatives?.[0];
  if (!alt) return;

  const text = alt.transcript || '';

  if (msg.is_final && text) {
    if (_finalTranscript && !_finalTranscript.endsWith(' ') && !text.startsWith(' ')) {
      _finalTranscript += ' ';
    }
    _finalTranscript += text;
  }

  if (msg.speech_final) {
    finalize('speech_final');
  }
}

function finalize(reason) {
  if (_finalized) return;
  _finalized = true;

  const transcript = _finalTranscript.trim();
  const callbacks = _callbacks;
  const mode = _mode;

  cleanup();

  if (!callbacks) return;

  if (!transcript) {
    callbacks.onTimeout?.();
    return;
  }

  if (mode === 'confirm') {
    callbacks.onResult?.(transcript);
  } else {
    callbacks.onFinalTranscript?.(transcript);
  }
}

function cleanup() {
  if (_listenTimer) { clearTimeout(_listenTimer); _listenTimer = null; }

  if (_mediaRecorder) {
    try { _mediaRecorder.stop(); } catch {}
    _mediaRecorder = null;
  }

  if (_stream) {
    _stream.getTracks().forEach((t) => t.stop());
    _stream = null;
  }

  if (_ws) {
    try { _ws.close(); } catch {}
    _ws = null;
  }

  _callbacks = null;
  _mode = null;
  _finalTranscript = '';
}
