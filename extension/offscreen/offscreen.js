// Offscreen Document Coordinator
// Manages the wake word engine and speech recognition, and relays messages
// to/from the service worker. This document stays alive for the extension lifetime.

import { initWakeWord, destroyWakeWord } from './wake-word.js';
import { startListening, stopListening, startConfirmListening } from './deepgram-stt.js';

// ---------------------------------------------------------------------------
// Keepalive — ping service worker every 25s to prevent suspension
// ---------------------------------------------------------------------------

setInterval(() => {
  chrome.runtime.sendMessage({ type: 'KEEPALIVE' }).catch(() => {});
}, 25_000);

// ---------------------------------------------------------------------------
// Initialization (guarded against concurrent calls)
// ---------------------------------------------------------------------------

let _initializing = false;

async function init() {
  if (_initializing) return;
  _initializing = true;
  try {
    await initWakeWord(onWakeWordDetected);
    chrome.runtime.sendMessage({
      type: 'WAKE_WORD_STATUS',
      status: 'ready',
      message: 'Wake word active — say "Kiki" or click the dot',
    }).catch(() => {});
  } catch (err) {
    console.error('[Kiki Offscreen] Init error:', err);
    const isMicDenied = /microphone|not-allowed|permission/i.test(err.message || '');
    if (isMicDenied) {
      chrome.runtime.sendMessage({ type: 'MIC_PERMISSION_NEEDED' }).catch(() => {});
    }
    chrome.runtime.sendMessage({
      type: 'WAKE_WORD_STATUS',
      status: 'error',
      message: isMicDenied
        ? 'Mic access denied — click extension icon, allow microphone, and reload'
        : 'Wake word init failed: ' + (err.message || err),
    }).catch(() => {});
  } finally {
    _initializing = false;
  }
}

function onWakeWordDetected() {
  chrome.runtime.sendMessage({ type: 'WAKE_WORD_DETECTED' }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Messages from service worker
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  switch (msg.type) {

    case 'REINIT_WAKE_WORD':
      destroyWakeWord().then(() => init()).catch(err => console.error('[Kiki Offscreen] Reinit failed:', err));
      sendResponse({ ok: true });
      return false;

    case 'START_LISTENING':
      startListening({
        onFinalTranscript(transcript) {
          chrome.runtime.sendMessage({ type: 'TRANSCRIPT_FINAL', transcript }).catch(() => {});
        },
        onTimeout() {
          chrome.runtime.sendMessage({ type: 'TRANSCRIPT_TIMEOUT' }).catch(() => {});
        },
      });
      sendResponse({ ok: true });
      return false;

    case 'STOP_LISTENING':
      stopListening();
      sendResponse({ ok: true });
      return false;

    case 'START_LISTENING_CONFIRM':
      startConfirmListening({
        onResult(transcript) {
          chrome.runtime.sendMessage({ type: 'SAFETY_TRANSCRIPT', transcript }).catch(() => {});
        },
        onTimeout() {
          chrome.runtime.sendMessage({ type: 'SAFETY_CONFIRMED', confirmed: false }).catch(() => {});
        },
      });
      sendResponse({ ok: true });
      return false;

    default:
      return false;
  }
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

init();
