// Kiki Content Script — Entry Point
// Injected into every page. Creates the status overlay (Shadow DOM),
// listens for messages from the service worker, and dispatches actions.

(function () {
  'use strict';

  if (window.__kikiInitialized) return;
  window.__kikiInitialized = true;

  var host = null;
  var container = null;
  var tooltip = null;
  var tooltipTimer = null;
  var _currentState = 'IDLE';
  var _activeSource = null;

  init();

  function init() {
    createOverlay();
    setupMessageListener();
    setupHotkeyListener();
    requestCurrentState();
  }

  // ---------------------------------------------------------------------------
  // Overlay (Shadow DOM)
  // ---------------------------------------------------------------------------

  function createOverlay() {
    if (document.getElementById('kiki-host')) return;

    host = document.createElement('div');
    host.id = 'kiki-host';

    var shadow = host.attachShadow({ mode: 'closed' });

    var style = document.createElement('style');
    style.textContent = getOverlayStyles();
    shadow.appendChild(style);

    container = document.createElement('div');
    container.className = 'kiki-dot-container kiki-state-idle';

    for (var i = 0; i < 3; i++) {
      var ripple = document.createElement('div');
      ripple.className = 'kiki-ripple';
      container.appendChild(ripple);
    }

    var spinner = document.createElement('div');
    spinner.className = 'kiki-spinner';
    container.appendChild(spinner);

    var gem = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    gem.setAttribute('class', 'kiki-gem');
    gem.setAttribute('viewBox', '0 0 36 36');
    gem.innerHTML =
      '<rect class="kiki-body" x="8" y="8" width="20" height="20" rx="5" transform="rotate(45 18 18)"/>' +
      '<circle class="kiki-core" cx="18" cy="18" r="3.5"/>';
    container.appendChild(gem);

    tooltip = document.createElement('div');
    tooltip.className = 'kiki-tooltip';
    container.appendChild(tooltip);

    shadow.appendChild(container);

    container.addEventListener('click', function () {
      if (window.__kiki && window.__kiki.chat) {
        window.__kiki.chat.toggleChat();
      }
    });

    document.body.appendChild(host);
  }

  function setOverlayState(state) {
    if (!container) return;
    container.className = 'kiki-dot-container kiki-state-' + state.toLowerCase();
  }

  function showTooltip(text, duration) {
    if (!tooltip) return;
    tooltip.textContent = text;
    tooltip.classList.add('visible');
    if (tooltipTimer) clearTimeout(tooltipTimer);
    tooltipTimer = setTimeout(function () {
      tooltip.classList.remove('visible');
      tooltipTimer = null;
    }, duration || 2500);
  }

  function flashError(message) {
    if (!container) return;
    container.classList.add('kiki-error-flash');
    showTooltip(message, 3000);
    setTimeout(function () {
      container.classList.remove('kiki-error-flash');
    }, 600);
  }

  function flashBlocked() {
    if (!container) return;
    container.classList.add('kiki-blocked-flash');
    setTimeout(function () {
      container.classList.remove('kiki-blocked-flash');
    }, 400);
  }

  function getOverlayStyles() {
    return '\
      :host {\
        all: initial;\
        position: fixed;\
        bottom: 14px;\
        right: 14px;\
        z-index: 2147483647;\
        pointer-events: none;\
      }\
      .kiki-dot-container {\
        position: relative;\
        width: 84px;\
        height: 84px;\
        pointer-events: auto;\
        cursor: pointer;\
      }\
      .kiki-gem {\
        position: absolute;\
        top: 50%;\
        left: 50%;\
        width: 51px;\
        height: 51px;\
        transform: translate(-50%, -50%);\
        transition: filter 0.4s ease, transform 0.4s ease;\
        overflow: visible;\
      }\
      .kiki-body {\
        fill: #8B7EC8;\
        transition: fill 0.4s ease;\
      }\
      .kiki-core {\
        fill: #ffffff;\
      }\
      .kiki-ripple {\
        position: absolute;\
        top: 50%;\
        left: 50%;\
        width: 42px;\
        height: 42px;\
        border-radius: 50%;\
        transform: translate(-50%, -50%);\
        border: 2px solid transparent;\
        opacity: 0;\
        pointer-events: none;\
      }\
      .kiki-spinner {\
        position: absolute;\
        top: 50%;\
        left: 50%;\
        width: 66px;\
        height: 66px;\
        transform: translate(-50%, -50%);\
        border: 2.5px solid transparent;\
        border-radius: 50%;\
        opacity: 0;\
        pointer-events: none;\
      }\
      /* IDLE — lavender gem with gentle breathing glow + drift rotation */\
      .kiki-state-idle .kiki-gem {\
        filter: drop-shadow(0 0 6px rgba(139, 126, 200, 0.5));\
        animation: gem-breathe 3s ease-in-out infinite;\
      }\
      .kiki-state-idle .kiki-body { fill: #8B7EC8; }\
      @keyframes gem-breathe {\
        0%, 100% {\
          filter: drop-shadow(0 0 5px rgba(139, 126, 200, 0.4));\
          transform: translate(-50%, -50%) scale(1) rotate(0deg);\
        }\
        50% {\
          filter: drop-shadow(0 0 14px rgba(139, 126, 200, 0.7));\
          transform: translate(-50%, -50%) scale(1.06) rotate(4deg);\
        }\
      }\
      /* LISTENING — coral gem with rippling rings */\
      .kiki-state-listening .kiki-gem {\
        filter: drop-shadow(0 0 10px rgba(232, 115, 90, 0.7));\
        animation: gem-listen 1.2s ease-in-out infinite;\
      }\
      .kiki-state-listening .kiki-body { fill: #E8735A; }\
      .kiki-state-listening .kiki-ripple {\
        border-color: rgba(232, 115, 90, 0.5);\
        animation: ripple-expand 1.6s ease-out infinite;\
      }\
      .kiki-state-listening .kiki-ripple:nth-child(2) { animation-delay: 0.5s; }\
      .kiki-state-listening .kiki-ripple:nth-child(3) { animation-delay: 1.0s; }\
      @keyframes gem-listen {\
        0%, 100% { transform: translate(-50%, -50%) scale(1); }\
        50% { transform: translate(-50%, -50%) scale(1.12); }\
      }\
      @keyframes ripple-expand {\
        0% { width: 42px; height: 42px; opacity: 0.6; }\
        100% { width: 96px; height: 96px; opacity: 0; }\
      }\
      /* PROCESSING — amber gem spinning */\
      .kiki-state-processing .kiki-gem {\
        filter: drop-shadow(0 0 10px rgba(232, 168, 56, 0.7));\
        animation: gem-spin 1.2s linear infinite;\
      }\
      .kiki-state-processing .kiki-body { fill: #E8A838; }\
      .kiki-state-processing .kiki-spinner {\
        opacity: 0;\
      }\
      @keyframes gem-spin {\
        to { transform: translate(-50%, -50%) rotate(360deg); }\
      }\
      @keyframes ring-spin {\
        to { transform: translate(-50%, -50%) rotate(360deg); }\
      }\
      /* EXECUTING — amber gem with gentle breathing glow (no spin) */\
      .kiki-state-executing .kiki-gem {\
        filter: drop-shadow(0 0 10px rgba(232, 168, 56, 0.7));\
        animation: gem-execute 2.5s ease-in-out infinite;\
      }\
      .kiki-state-executing .kiki-body { fill: #E8A838; }\
      @keyframes gem-execute {\
        0%, 100% {\
          filter: drop-shadow(0 0 6px rgba(232, 168, 56, 0.4));\
          transform: translate(-50%, -50%) scale(1);\
        }\
        50% {\
          filter: drop-shadow(0 0 14px rgba(232, 168, 56, 0.7));\
          transform: translate(-50%, -50%) scale(1.05);\
        }\
      }\
      /* PAUSED — red cancel flash */\
      .kiki-state-paused .kiki-gem {\
        filter: drop-shadow(0 0 14px rgba(199, 75, 80, 0.8));\
        animation: gem-cancel 0.5s ease-out;\
      }\
      .kiki-state-paused .kiki-body { fill: #C74B50; }\
      @keyframes gem-cancel {\
        0% {\
          filter: drop-shadow(0 0 30px rgba(199, 75, 80, 1));\
          transform: translate(-50%, -50%) scale(1.3);\
        }\
        100% {\
          filter: drop-shadow(0 0 8px rgba(199, 75, 80, 0.4));\
          transform: translate(-50%, -50%) scale(1);\
        }\
      }\
      /* SAFETY — coral/red alternating glow with breathing ring */\
      .kiki-state-safety .kiki-gem {\
        animation: gem-safety 1s ease-in-out infinite;\
      }\
      .kiki-state-safety .kiki-body { fill: #E8735A; }\
      .kiki-state-safety .kiki-ripple {\
        border-color: rgba(199, 75, 80, 0.6);\
        animation: safety-ring 1.2s ease-in-out infinite;\
      }\
      @keyframes gem-safety {\
        0%, 100% { filter: drop-shadow(0 0 8px rgba(232, 115, 90, 0.5)); }\
        50% { filter: drop-shadow(0 0 22px rgba(199, 75, 80, 0.9)); }\
      }\
      @keyframes safety-ring {\
        0%, 100% { width: 51px; height: 51px; opacity: 0.6; }\
        50% { width: 78px; height: 78px; opacity: 0.3; }\
      }\
      /* TOOLTIP */\
      .kiki-tooltip {\
        position: absolute;\
        bottom: 100%;\
        right: 0;\
        margin-bottom: 8px;\
        padding: 6px 10px;\
        background: rgba(30, 30, 30, 0.92);\
        color: #f0f0f0;\
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;\
        font-size: 12px;\
        line-height: 1.3;\
        border-radius: 8px;\
        white-space: nowrap;\
        max-width: 260px;\
        overflow: hidden;\
        text-overflow: ellipsis;\
        pointer-events: none;\
        opacity: 0;\
        transform: translateY(4px);\
        transition: opacity 0.2s ease, transform 0.2s ease;\
      }\
      .kiki-tooltip.visible {\
        opacity: 1;\
        transform: translateY(0);\
      }\
      /* ERROR FLASH */\
      .kiki-error-flash .kiki-body {\
        fill: #E54545 !important;\
      }\
      .kiki-error-flash .kiki-gem {\
        filter: drop-shadow(0 0 18px rgba(229, 69, 69, 0.9)) !important;\
        animation: error-shake 0.4s ease !important;\
      }\
      @keyframes error-shake {\
        0%, 100% { transform: translate(-50%, -50%); }\
        25% { transform: translate(calc(-50% - 3px), -50%); }\
        75% { transform: translate(calc(-50% + 3px), -50%); }\
      }\
      /* BLOCKED FLASH — soft coral pulse when voice is blocked by chat */\
      .kiki-blocked-flash .kiki-body {\
        fill: #E8735A !important;\
      }\
      .kiki-blocked-flash .kiki-gem {\
        filter: drop-shadow(0 0 22px rgba(232, 115, 90, 0.9)) !important;\
        animation: blocked-pulse 0.4s ease !important;\
      }\
      @keyframes blocked-pulse {\
        0%, 100% { transform: translate(-50%, -50%) scale(1); }\
        50% { transform: translate(-50%, -50%) scale(1.15); }\
      }\
    ';
  }

  // ---------------------------------------------------------------------------
  // Hotkey listener
  // ---------------------------------------------------------------------------

  var _hotkeyConfig = null;
  var _hotkeyFired = false;

  function setupHotkeyListener() {
    chrome.storage.local.get(['hotkey'], function (data) {
      _hotkeyConfig = data.hotkey || null;
    });

    chrome.storage.onChanged.addListener(function (changes) {
      if (changes.hotkey) {
        _hotkeyConfig = changes.hotkey.newValue || null;
      }
    });

    document.addEventListener('keydown', function (e) {
      if (!_hotkeyConfig) return;
      if (_hotkeyFired) return;
      if (!hotkeyMatches(e)) return;

      // The chat input's stopImmediatePropagation prevents keydown events
      // from reaching here when typing in the chat box.

      var hasModifier = e.ctrlKey || e.altKey || e.metaKey;
      if (!hasModifier) {
        var tag = (document.activeElement && document.activeElement.tagName) || '';
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' ||
            (document.activeElement && document.activeElement.isContentEditable)) {
          return;
        }
      }

      e.preventDefault();
      e.stopPropagation();
      _hotkeyFired = true;

      chrome.runtime.sendMessage({ type: 'WAKE_WORD_DETECTED' }).catch(function () {});
    }, true);

    document.addEventListener('keyup', function (e) {
      if (_hotkeyFired && _hotkeyConfig && e.code === _hotkeyConfig.code) {
        _hotkeyFired = false;
      }
    }, true);
  }

  function hotkeyMatches(e) {
    return e.code === _hotkeyConfig.code &&
      e.ctrlKey === !!_hotkeyConfig.ctrlKey &&
      e.altKey === !!_hotkeyConfig.altKey &&
      e.shiftKey === !!_hotkeyConfig.shiftKey &&
      e.metaKey === !!_hotkeyConfig.metaKey;
  }

  // ---------------------------------------------------------------------------
  // Message handling
  // ---------------------------------------------------------------------------

  function setupMessageListener() {
    chrome.runtime.onMessage.addListener(function (msg, _sender, sendResponse) {
      switch (msg.type) {

        case 'STATE_CHANGE':
          _currentState = msg.state;
          _activeSource = msg.source || null;
          if (window.__kiki && window.__kiki.chat && window.__kiki.chat.setState) {
            window.__kiki.chat.setState(msg.state);
          }
          if (window.__kiki && window.__kiki.chat && window.__kiki.chat.setActiveSource) {
            window.__kiki.chat.setActiveSource(_activeSource);
          }
          if (msg.state === 'IDLE' && window.__kiki && window.__kiki.chat && window.__kiki.chat.clearChatAction) {
            window.__kiki.chat.clearChatAction();
          }
          if (_activeSource !== 'chat' || msg.state !== 'LISTENING') {
            setOverlayState(msg.state);
          }
          return false;

        case 'EXECUTE_ACTION':
          window.__kiki.dispatcher.dispatchAction(msg.action, { quick: !!msg.quick }).then(function (result) {
            sendResponse(result);
          }).catch(function (err) {
            sendResponse({ ok: false, error: err.message || 'Action failed' });
          });
          return true;

        case 'REQUEST_DOM': {
          var settle = msg.settle && window.__kiki.waitForDOMSettled;
          if (settle) {
            // After navigation: wait for DOM to stop mutating before snapshotting
            settle(2000, 150).then(function () {
              sendResponse(window.__kiki.tree.extractSnapshot({ mode: msg.mode }));
            });
            return true; // async response
          }
          sendResponse(window.__kiki.tree.extractSnapshot({ mode: msg.mode }));
          return false;
        }

        case 'SHOW_LABELS':
          window.__kiki.tree.extractSnapshot();
          window.__kiki.labels.showLabels();
          return false;

        case 'HIDE_LABELS':
          window.__kiki.labels.hideLabels();
          return false;

        case 'CANCEL_ACTIONS':
          window.__kiki.dispatcher.cancelAll();
          window.__kiki.labels.hideLabels();
          return false;

        case 'VOICE_BLOCKED':
          flashBlocked();
          return false;

        case 'KIKI_ERROR':
          console.warn('[Kiki]', msg.message);
          if (_activeSource !== 'chat') {
            flashError(msg.message || 'Something went wrong');
          }
          return false;

        case 'KIKI_TRANSCRIPT':
          if (msg.transcript && _activeSource !== 'chat') showTooltip('"' + msg.transcript + '"', 2000);
          return false;

        case 'SAFETY_PROMPT':
          setOverlayState('safety');
          return false;

        case 'ASK_USER_PROMPT':
          if (window.__kiki && window.__kiki.chat) {
            window.__kiki.chat.showClarification(msg.question, msg.options || []);
          }
          return false;

        case 'WAKE_WORD_STATUS':
          if (msg.status === 'error') {
            showTooltip(msg.message, 5000);
          } else if (msg.status === 'ready') {
            showTooltip(msg.message, 3000);
          }
          return false;

        case 'CHAT_RESPONSE':
          if (window.__kiki && window.__kiki.chat) {
            window.__kiki.chat.hideTyping();
            window.__kiki.chat.addMessage('assistant', msg.text);
          }
          return false;

        case 'CHAT_TYPING':
          if (window.__kiki && window.__kiki.chat) {
            if (msg.show) {
              window.__kiki.chat.showTyping();
            } else {
              window.__kiki.chat.hideTyping();
            }
          }
          return false;

        case 'CHAT_STATUS':
          if (window.__kiki && window.__kiki.chat) {
            if (msg.text) {
              window.__kiki.chat.showStatus(msg.text);
            } else {
              window.__kiki.chat.hideStatus();
            }
          }
          return false;

        default:
          return false;
      }
    });
  }

  function requestCurrentState() {
    chrome.runtime.sendMessage({ type: 'REQUEST_STATE' }, function (response) {
      if (response?.state) {
        _currentState = response.state;
        _activeSource = response.source || null;
        setOverlayState(response.state);
        if (window.__kiki && window.__kiki.chat && window.__kiki.chat.setState) {
          window.__kiki.chat.setState(response.state);
        }
        if (window.__kiki && window.__kiki.chat && window.__kiki.chat.setActiveSource) {
          window.__kiki.chat.setActiveSource(_activeSource);
        }
      }
    });
  }
})();
