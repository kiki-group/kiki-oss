// Kiki Chat Window — Shadow DOM chat UI for chat mode
// Positioned bottom-right, above the Kiki dot. Opens/closes with slide animation.
// Communicates with service worker via chrome.runtime messages.

(function () {
  'use strict';

  var chatHost = null;
  var chatRoot = null;
  var panel = null;
  var messageList = null;
  var inputField = null;
  var sendBtn = null;
  var typingIndicator = null;
  var statusBadge = null;
  var isOpen = false;
  var isSending = false;
  var _isLight = false;
  var _chatActionInProgress = false;
  var _activeSource = null;
  var _currentState = 'IDLE';
  var _isStopMode = false;

  var SEND_ICON = '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" fill="currentColor"/></svg>';
  var STOP_ICON = '<svg viewBox="0 0 24 24" width="18" height="18"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/></svg>';
  var RELOAD_ICON = '<svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M16.5 10a6.5 6.5 0 1 1-1.3-3.9"/><polyline points="16.5 2.5 16.5 6.5 12.5 6.5"/></svg>';
  var CLOSE_ICON = '<svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><line x1="5" y1="5" x2="15" y2="15"/><line x1="15" y1="5" x2="5" y2="15"/></svg>';

  function createChatWindow() {
    if (document.getElementById('kiki-chat-host')) return;

    chatHost = document.createElement('div');
    chatHost.id = 'kiki-chat-host';

    chatRoot = chatHost.attachShadow({ mode: 'closed' });

    var style = document.createElement('style');
    style.textContent = getChatStyles();
    chatRoot.appendChild(style);

    panel = document.createElement('div');
    panel.className = 'kiki-chat-panel';

    // Header
    var header = document.createElement('div');
    header.className = 'kiki-chat-header';

    var headerLeft = document.createElement('div');
    headerLeft.className = 'kiki-chat-header-left';

    var gemSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    gemSvg.setAttribute('class', 'kiki-chat-gem');
    gemSvg.setAttribute('viewBox', '0 0 36 36');
    gemSvg.innerHTML =
      '<rect x="8" y="8" width="20" height="20" rx="5" fill="#8B7EC8" transform="rotate(45 18 18)"/>' +
      '<circle cx="18" cy="18" r="3.5" fill="#fff"/>';
    headerLeft.appendChild(gemSvg);

    var title = document.createElement('span');
    title.className = 'kiki-chat-title';
    title.textContent = 'Kiki';
    headerLeft.appendChild(title);

    header.appendChild(headerLeft);

    var headerRight = document.createElement('div');
    headerRight.className = 'kiki-chat-header-right';

    var feedbackBtn = document.createElement('button');
    feedbackBtn.className = 'kiki-chat-feedback-btn';
    feedbackBtn.title = 'Report a problem';
    feedbackBtn.innerHTML = '<svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8.57 3.22 1.8 15.08a1.67 1.67 0 0 0 1.43 2.5h13.54a1.67 1.67 0 0 0 1.43-2.5L11.43 3.22a1.67 1.67 0 0 0-2.86 0z"/><line x1="10" y1="8" x2="10" y2="11.5"/><circle cx="10" cy="14" r="0.5" fill="currentColor" stroke="none"/></svg>';
    feedbackBtn.addEventListener('click', function () {
      openFeedbackModal();
    });
    headerRight.appendChild(feedbackBtn);

    var reloadBtn = document.createElement('button');
    reloadBtn.className = 'kiki-chat-reload';
    reloadBtn.title = 'Reset chat';
    reloadBtn.innerHTML = RELOAD_ICON;
    reloadBtn.addEventListener('click', function () {
      resetChat();
    });
    headerRight.appendChild(reloadBtn);

    var closeBtn = document.createElement('button');
    closeBtn.className = 'kiki-chat-close';
    closeBtn.title = 'Close chat';
    closeBtn.innerHTML = CLOSE_ICON;
    closeBtn.addEventListener('click', function () {
      closeChat();
    });
    headerRight.appendChild(closeBtn);

    header.appendChild(headerRight);

    panel.appendChild(header);

    // Messages container
    messageList = document.createElement('div');
    messageList.className = 'kiki-chat-messages';

    typingIndicator = document.createElement('div');
    typingIndicator.className = 'kiki-chat-typing';
    typingIndicator.innerHTML =
      '<span class="kiki-typing-dot"></span>' +
      '<span class="kiki-typing-dot"></span>' +
      '<span class="kiki-typing-dot"></span>';

    statusBadge = document.createElement('div');
    statusBadge.className = 'kiki-chat-status';

    panel.appendChild(messageList);

    // Input area
    var inputArea = document.createElement('div');
    inputArea.className = 'kiki-chat-input-area';

    inputField = document.createElement('input');
    inputField.type = 'text';
    inputField.className = 'kiki-chat-input';
    inputField.placeholder = 'Ask Kiki anything\u2026';
    inputField.addEventListener('keydown', function (e) {
      e.stopImmediatePropagation();
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (_isStopMode) {
          handleStop();
        } else {
          handleSend();
        }
      }
    });
    inputField.addEventListener('keyup', function (e) {
      e.stopImmediatePropagation();
    });
    inputField.addEventListener('keypress', function (e) {
      e.stopImmediatePropagation();
    });

    sendBtn = document.createElement('button');
    sendBtn.className = 'kiki-chat-send';
    sendBtn.innerHTML = SEND_ICON;
    sendBtn.addEventListener('click', handleSend);

    inputArea.appendChild(inputField);
    inputArea.appendChild(sendBtn);
    panel.appendChild(inputArea);

    chatRoot.appendChild(panel);
    document.body.appendChild(chatHost);

    // Sync chat history when switching back to this tab
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && isOpen) {
        chrome.storage.session.get(['chatHistory'], function (data) {
          if (data.chatHistory && data.chatHistory.length > 0) {
            restoreMessages(data.chatHistory);
          }
        });
      }
    });
  }

  var _pendingClarification = false;

  function handleSend() {
    if (isSending) return;
    var text = inputField.value.trim();
    if (!text) return;

    if (_activeSource === 'voice') return;

    inputField.value = '';
    addMessage('user', text);

    if (_pendingClarification) {
      _pendingClarification = false;
      removeClarificationButtons();
      chrome.runtime.sendMessage({ type: 'ASK_USER_RESPONSE', answer: text }).catch(function () {});
      return;
    }

    _chatActionInProgress = true;
    chrome.runtime.sendMessage({ type: 'CHAT_MESSAGE', text: text }).catch(function () {});
  }

  function handleStop() {
    chrome.runtime.sendMessage({ type: 'STOP_EXECUTION' }).catch(function () {});
  }

  function updateSendButton() {
    if (!sendBtn) return;
    var shouldStop = _currentState === 'EXECUTING' || _currentState === 'PROCESSING';
    if (shouldStop && !_isStopMode) {
      _isStopMode = true;
      sendBtn.innerHTML = STOP_ICON;
      sendBtn.classList.add('stop-mode');
      sendBtn.classList.remove('disabled');
      sendBtn.removeEventListener('click', handleSend);
      sendBtn.addEventListener('click', handleStop);
    } else if (!shouldStop && _isStopMode) {
      _isStopMode = false;
      sendBtn.innerHTML = SEND_ICON;
      sendBtn.classList.remove('stop-mode');
      sendBtn.removeEventListener('click', handleStop);
      sendBtn.addEventListener('click', handleSend);
      if (_activeSource === 'voice') {
        sendBtn.classList.add('disabled');
      }
    }
  }

  function addMessage(role, content) {
    var bubble = document.createElement('div');
    bubble.className = 'kiki-chat-bubble kiki-chat-' + role;

    var textEl = document.createElement('div');
    textEl.className = 'kiki-chat-text';
    textEl.textContent = content;
    bubble.appendChild(textEl);

    // Insert before typing indicator if it's in the list
    if (typingIndicator.parentNode === messageList) {
      messageList.insertBefore(bubble, typingIndicator);
    } else {
      messageList.appendChild(bubble);
    }

    requestAnimationFrame(function () {
      bubble.classList.add('kiki-chat-visible');
      scrollToBottom();
    });
  }

  function showTyping() {
    if (typingIndicator.parentNode !== messageList) {
      messageList.appendChild(typingIndicator);
    }
    typingIndicator.classList.add('visible');
    isSending = true;
    sendBtn.classList.add('disabled');
    scrollToBottom();
  }

  function hideTyping() {
    typingIndicator.classList.remove('visible');
    if (typingIndicator.parentNode === messageList) {
      messageList.removeChild(typingIndicator);
    }
    isSending = false;
    sendBtn.classList.remove('disabled');
  }

  function showStatus(text) {
    statusBadge.textContent = text;
    if (statusBadge.parentNode !== messageList) {
      if (typingIndicator.parentNode === messageList) {
        messageList.insertBefore(statusBadge, typingIndicator);
      } else {
        messageList.appendChild(statusBadge);
      }
    }
    statusBadge.classList.add('visible');
    scrollToBottom();
  }

  function hideStatus() {
    statusBadge.classList.remove('visible');
    if (statusBadge.parentNode === messageList) {
      messageList.removeChild(statusBadge);
    }
  }

  function scrollToBottom() {
    if (messageList) {
      messageList.scrollTop = messageList.scrollHeight;
    }
  }

  function openChat() {
    if (!panel) createChatWindow();
    if (isOpen) return;
    isOpen = true;

    setTimeout(function () {
      panel.classList.add('open');
      chatHost.classList.add('open');
    }, 40);

    chrome.storage.session.set({ chatOpen: true }).catch(function () {});

    chrome.storage.session.get(['chatHistory'], function (data) {
      if (data.chatHistory && data.chatHistory.length > 0) {
        restoreMessages(data.chatHistory);
      }
    });

    setTimeout(function () {
      if (inputField) inputField.focus();
    }, 400);
  }

  function closeChat() {
    if (!isOpen) return;
    isOpen = false;
    panel.classList.remove('open');
    chatHost.classList.remove('open');
    chrome.storage.session.set({ chatOpen: false }).catch(function () {});
  }

  function toggleChat() {
    if (isOpen) {
      closeChat();
    } else {
      openChat();
    }
  }

  function clearMessages() {
    if (!messageList) return;
    while (messageList.firstChild) {
      messageList.removeChild(messageList.firstChild);
    }
  }

  function restoreMessages(history) {
    clearMessages();
    for (var i = 0; i < history.length; i++) {
      var msg = history[i];
      addMessage(msg.role, msg.content);
    }
  }

  function isVisible() {
    return isOpen;
  }

  function applyTheme() {
    if (!panel) return;
    if (_isLight) {
      panel.classList.add('light');
    } else {
      panel.classList.remove('light');
    }
  }

  function resetChat() {
    clearMessages();
    hideTyping();
    hideStatus();
    _pendingClarification = false;
    removeClarificationButtons();
    chrome.storage.session.remove('chatHistory').catch(function () {});
    chrome.runtime.sendMessage({ type: 'CHAT_CLEAR' }).catch(function () {});
  }

  function getChatStyles() {
    var interLatin = chrome.runtime.getURL('fonts/inter-latin.woff2');
    var interLatinExt = chrome.runtime.getURL('fonts/inter-latin-ext.woff2');
    return '\
      @font-face { font-family: "Inter"; font-style: normal; font-weight: 400; font-display: swap; src: url("' + interLatin + '") format("woff2"); unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD; }\
      @font-face { font-family: "Inter"; font-style: normal; font-weight: 500; font-display: swap; src: url("' + interLatin + '") format("woff2"); unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD; }\
      @font-face { font-family: "Inter"; font-style: normal; font-weight: 600; font-display: swap; src: url("' + interLatin + '") format("woff2"); unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD; }\
      @font-face { font-family: "Inter"; font-style: normal; font-weight: 400; font-display: swap; src: url("' + interLatinExt + '") format("woff2"); unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF; }\
      @font-face { font-family: "Inter"; font-style: normal; font-weight: 500; font-display: swap; src: url("' + interLatinExt + '") format("woff2"); unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF; }\
      @font-face { font-family: "Inter"; font-style: normal; font-weight: 600; font-display: swap; src: url("' + interLatinExt + '") format("woff2"); unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF; }\
      :host {\
        all: initial;\
        position: fixed;\
        bottom: 14px;\
        right: 14px;\
        z-index: 2147483646;\
        pointer-events: none;\
        font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;\
      }\
      :host(.open) {\
        pointer-events: auto;\
      }\
      .kiki-chat-panel {\
        --panel-bg: #161220;\
        --panel-border: rgba(139, 126, 200, 0.2);\
        --panel-shadow: 0 8px 32px rgba(0,0,0,0.35), 0 0 0 1px rgba(139,126,200,0.08);\
        --header-grad-from: rgba(139, 126, 200, 0.15);\
        --header-grad-to: rgba(139, 126, 200, 0.05);\
        --header-border: rgba(139, 126, 200, 0.12);\
        --text-primary: #e8e4f0;\
        --text-secondary: #ddd8e8;\
        --btn-muted: rgba(232, 228, 240, 0.5);\
        --btn-muted-hover: #e8e4f0;\
        --btn-muted-hover-bg: rgba(139, 126, 200, 0.15);\
        --scrollbar-thumb: rgba(139, 126, 200, 0.25);\
        --user-bg: rgba(139, 126, 200, 0.25);\
        --user-color: #e8e4f0;\
        --assistant-bg: rgba(60, 52, 80, 0.7);\
        --assistant-color: #ddd8e8;\
        --option-bg: rgba(139, 126, 200, 0.2);\
        --option-color: #c8bfe8;\
        --option-border: rgba(139, 126, 200, 0.4);\
        --option-hover-bg: rgba(139, 126, 200, 0.35);\
        --option-hover-border: rgba(139, 126, 200, 0.6);\
        --typing-bg: rgba(60, 52, 80, 0.7);\
        --typing-dot: rgba(139, 126, 200, 0.6);\
        --status-bg: rgba(232, 168, 56, 0.15);\
        --status-color: #E8A838;\
        --input-area-bg: #100c18;\
        --input-area-border: rgba(139, 126, 200, 0.1);\
        --input-bg: rgba(60, 52, 80, 0.4);\
        --input-border: rgba(139, 126, 200, 0.15);\
        --input-color: #e8e4f0;\
        --input-placeholder: rgba(232, 228, 240, 0.35);\
        --input-focus-border: rgba(139, 126, 200, 0.4);\
        --input-focus-shadow: 0 0 0 2px rgba(139, 126, 200, 0.1);\
        position: absolute;\
        bottom: 88px;\
        right: 0;\
        width: 320px;\
        max-height: 580px;\
        display: flex;\
        flex-direction: column;\
        background: var(--panel-bg);\
        border-radius: 16px 16px 4px 16px;\
        border: 1px solid var(--panel-border);\
        box-shadow: var(--panel-shadow);\
        overflow: hidden;\
        opacity: 0;\
        transform: translateY(16px) scale(0.98);\
        transform-origin: bottom right;\
        transition: opacity 0.35s cubic-bezier(0.25, 0.1, 0.25, 1), transform 0.35s cubic-bezier(0.25, 0.1, 0.25, 1);\
        pointer-events: none;\
      }\
      .kiki-chat-panel.light {\
        --panel-bg: #ffffff;\
        --panel-border: rgba(139, 126, 200, 0.18);\
        --panel-shadow: 0 8px 32px rgba(0,0,0,0.1), 0 0 0 1px rgba(139,126,200,0.1);\
        --header-grad-from: rgba(139, 126, 200, 0.1);\
        --header-grad-to: rgba(139, 126, 200, 0.03);\
        --header-border: rgba(139, 126, 200, 0.1);\
        --text-primary: #2a2438;\
        --text-secondary: #3d3550;\
        --btn-muted: rgba(42, 36, 56, 0.4);\
        --btn-muted-hover: #2a2438;\
        --btn-muted-hover-bg: rgba(139, 126, 200, 0.1);\
        --scrollbar-thumb: rgba(139, 126, 200, 0.2);\
        --user-bg: rgba(139, 126, 200, 0.18);\
        --user-color: #2a2438;\
        --assistant-bg: rgba(240, 237, 248, 0.9);\
        --assistant-color: #3d3550;\
        --option-bg: rgba(139, 126, 200, 0.12);\
        --option-color: #5a4e78;\
        --option-border: rgba(139, 126, 200, 0.3);\
        --option-hover-bg: rgba(139, 126, 200, 0.22);\
        --option-hover-border: rgba(139, 126, 200, 0.5);\
        --typing-bg: rgba(240, 237, 248, 0.9);\
        --typing-dot: rgba(139, 126, 200, 0.5);\
        --status-bg: rgba(232, 168, 56, 0.1);\
        --status-color: #c08a20;\
        --input-area-bg: #f5f3fa;\
        --input-area-border: rgba(139, 126, 200, 0.08);\
        --input-bg: rgba(255, 255, 255, 0.9);\
        --input-border: rgba(139, 126, 200, 0.18);\
        --input-color: #2a2438;\
        --input-placeholder: rgba(42, 36, 56, 0.35);\
        --input-focus-border: rgba(139, 126, 200, 0.45);\
        --input-focus-shadow: 0 0 0 2px rgba(139, 126, 200, 0.08);\
      }\
      .kiki-chat-panel.open {\
        opacity: 1;\
        transform: translateY(0) scale(1);\
        pointer-events: auto;\
      }\
      /* Header */\
      .kiki-chat-header {\
        display: flex;\
        align-items: center;\
        justify-content: space-between;\
        padding: 14px 16px;\
        background: linear-gradient(135deg, var(--header-grad-from), var(--header-grad-to));\
        border-bottom: 1px solid var(--header-border);\
        flex-shrink: 0;\
      }\
      .kiki-chat-header-left {\
        display: flex;\
        align-items: center;\
        gap: 10px;\
      }\
      .kiki-chat-header-right {\
        display: flex;\
        align-items: center;\
        gap: 4px;\
      }\
      .kiki-chat-gem {\
        width: 24px;\
        height: 24px;\
        filter: drop-shadow(0 0 4px rgba(139, 126, 200, 0.5));\
      }\
      .kiki-chat-title {\
        font-size: 15px;\
        font-weight: 600;\
        color: var(--text-primary);\
        letter-spacing: 0.3px;\
      }\
      .kiki-chat-feedback-btn,\
      .kiki-chat-reload,\
      .kiki-chat-close {\
        background: none;\
        border: none;\
        color: var(--btn-muted);\
        cursor: pointer;\
        padding: 4px 6px;\
        border-radius: 6px;\
        transition: color 0.3s, background 0.3s;\
        line-height: 1;\
        display: flex;\
        align-items: center;\
        justify-content: center;\
      }\
      .kiki-chat-feedback-btn:hover,\
      .kiki-chat-reload:hover,\
      .kiki-chat-close:hover {\
        color: var(--btn-muted-hover);\
        background: var(--btn-muted-hover-bg);\
      }\
      /* Messages */\
      .kiki-chat-messages {\
        flex: 1;\
        overflow-y: auto;\
        padding: 16px;\
        display: flex;\
        flex-direction: column;\
        gap: 10px;\
        min-height: 200px;\
        max-height: 440px;\
        scrollbar-width: thin;\
        scrollbar-color: var(--scrollbar-thumb) transparent;\
      }\
      .kiki-chat-messages::-webkit-scrollbar {\
        width: 5px;\
      }\
      .kiki-chat-messages::-webkit-scrollbar-track {\
        background: transparent;\
      }\
      .kiki-chat-messages::-webkit-scrollbar-thumb {\
        background: var(--scrollbar-thumb);\
        border-radius: 5px;\
      }\
      /* Bubbles */\
      .kiki-chat-bubble {\
        max-width: 85%;\
        padding: 10px 14px;\
        border-radius: 14px;\
        font-size: 13.5px;\
        line-height: 1.5;\
        opacity: 0;\
        transform: translateY(8px);\
        transition: opacity 0.35s ease, transform 0.35s ease;\
      }\
      .kiki-chat-bubble.kiki-chat-visible {\
        opacity: 1;\
        transform: translateY(0);\
      }\
      .kiki-chat-user {\
        align-self: flex-end;\
        background: var(--user-bg);\
        color: var(--user-color);\
        border-bottom-right-radius: 4px;\
      }\
      .kiki-chat-assistant {\
        align-self: flex-start;\
        background: var(--assistant-bg);\
        color: var(--assistant-color);\
        border-bottom-left-radius: 4px;\
      }\
      .kiki-chat-text {\
        word-wrap: break-word;\
        white-space: pre-wrap;\
      }\
      /* Clarification options */\
      .kiki-chat-options {\
        align-self: flex-start;\
        display: flex;\
        flex-wrap: wrap;\
        gap: 6px;\
        padding: 4px 0;\
        opacity: 0;\
        transform: translateY(8px);\
        transition: opacity 0.35s ease, transform 0.35s ease;\
      }\
      .kiki-chat-options.kiki-chat-visible {\
        opacity: 1;\
        transform: translateY(0);\
      }\
      .kiki-chat-option-btn {\
        background: var(--option-bg);\
        color: var(--option-color);\
        border: 1px solid var(--option-border);\
        border-radius: 16px;\
        padding: 6px 14px;\
        font-size: 12.5px;\
        cursor: pointer;\
        transition: background 0.3s ease, border-color 0.3s ease;\
      }\
      .kiki-chat-option-btn:hover {\
        background: var(--option-hover-bg);\
        border-color: var(--option-hover-border);\
      }\
      /* Typing indicator */\
      .kiki-chat-typing {\
        display: none;\
        align-self: flex-start;\
        padding: 10px 16px;\
        background: var(--typing-bg);\
        border-radius: 14px;\
        border-bottom-left-radius: 4px;\
        gap: 5px;\
      }\
      .kiki-chat-typing.visible {\
        display: flex;\
      }\
      .kiki-typing-dot {\
        width: 7px;\
        height: 7px;\
        border-radius: 50%;\
        background: var(--typing-dot);\
        animation: kiki-typing-bounce 1.4s ease-in-out infinite;\
      }\
      .kiki-typing-dot:nth-child(2) { animation-delay: 0.15s; }\
      .kiki-typing-dot:nth-child(3) { animation-delay: 0.3s; }\
      @keyframes kiki-typing-bounce {\
        0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }\
        30% { transform: translateY(-5px); opacity: 1; }\
      }\
      /* Status badge */\
      .kiki-chat-status {\
        display: none;\
        align-self: center;\
        padding: 4px 12px;\
        border-radius: 10px;\
        background: var(--status-bg);\
        color: var(--status-color);\
        font-size: 11px;\
        font-weight: 500;\
        letter-spacing: 0.1em;\
        text-transform: uppercase;\
      }\
      .kiki-chat-status.visible {\
        display: block;\
      }\
      /* Input area */\
      .kiki-chat-input-area {\
        display: flex;\
        align-items: center;\
        gap: 8px;\
        padding: 12px 14px;\
        border-top: 1px solid var(--input-area-border);\
        background: var(--input-area-bg);\
        flex-shrink: 0;\
      }\
      .kiki-chat-input {\
        flex: 1;\
        background: var(--input-bg);\
        border: 1px solid var(--input-border);\
        border-radius: 10px;\
        padding: 10px 14px;\
        font-size: 13.5px;\
        font-family: inherit;\
        color: var(--input-color);\
        outline: none;\
        transition: border-color 0.3s, box-shadow 0.3s;\
      }\
      .kiki-chat-input::placeholder {\
        color: var(--input-placeholder);\
      }\
      .kiki-chat-input:focus {\
        border-color: var(--input-focus-border);\
        box-shadow: var(--input-focus-shadow);\
      }\
      .kiki-chat-send {\
        display: flex;\
        align-items: center;\
        justify-content: center;\
        width: 36px;\
        height: 36px;\
        border-radius: 10px;\
        border: none;\
        background: #8B7EC8;\
        color: #fff;\
        cursor: pointer;\
        flex-shrink: 0;\
        transition: background 0.3s, transform 0.1s, opacity 0.3s;\
      }\
      .kiki-chat-send:hover {\
        background: #7a6db7;\
      }\
      .kiki-chat-send:active {\
        transform: scale(0.92);\
      }\
      .kiki-chat-send.disabled {\
        opacity: 0.4;\
        pointer-events: none;\
      }\
      .kiki-chat-send.stop-mode {\
        opacity: 1;\
        pointer-events: auto;\
      }\
      /* Feedback modal */\
      .kiki-feedback-overlay {\
        position: absolute;\
        inset: 0;\
        background: rgba(0,0,0,0.5);\
        backdrop-filter: blur(4px);\
        display: flex;\
        align-items: center;\
        justify-content: center;\
        padding: 16px;\
        z-index: 100;\
        opacity: 0;\
        transition: opacity 0.3s;\
        border-radius: 16px;\
        overflow: hidden;\
      }\
      .kiki-feedback-visible {\
        opacity: 1;\
      }\
      .kiki-feedback-modal {\
        width: 100%;\
        max-width: 280px;\
        display: flex;\
        flex-direction: column;\
        box-sizing: border-box;\
        background: var(--panel-bg);\
        border: 1px solid var(--panel-border);\
        border-radius: 14px;\
        padding: 20px 24px;\
        box-shadow: 0 8px 24px rgba(0,0,0,0.3);\
      }\
      .kiki-feedback-modal * {\
        box-sizing: border-box;\
      }\
      .kiki-feedback-title {\
        font-size: 15px;\
        font-weight: 600;\
        color: var(--text-primary);\
        margin-bottom: 14px;\
      }\
      .kiki-feedback-check-row {\
        display: flex;\
        align-items: center;\
        gap: 10px;\
        padding: 8px 0;\
        margin-bottom: 12px;\
        cursor: pointer;\
        flex-shrink: 0;\
      }\
      .kiki-feedback-cb {\
        width: 16px;\
        height: 16px;\
        flex-shrink: 0;\
        accent-color: #8B7EC8;\
        cursor: pointer;\
      }\
      .kiki-feedback-check-label {\
        font-size: 13px;\
        color: var(--text-secondary);\
      }\
      .kiki-feedback-note {\
        width: 100%;\
        box-sizing: border-box;\
        background: var(--input-bg);\
        border: 1px solid var(--input-border);\
        border-radius: 8px;\
        padding: 10px 12px;\
        font-size: 12.5px;\
        font-family: inherit;\
        color: var(--input-color);\
        resize: none;\
        outline: none;\
        margin-bottom: 12px;\
        flex-shrink: 0;\
        transition: border-color 0.3s;\
      }\
      .kiki-feedback-note::placeholder { color: var(--input-placeholder); }\
      .kiki-feedback-note:focus { border-color: var(--input-focus-border); }\
      .kiki-feedback-actions {\
        display: flex;\
        gap: 6px;\
        flex-shrink: 0;\
      }\
      .kiki-feedback-send {\
        flex: 1;\
        padding: 8px 0;\
        border: none;\
        border-radius: 8px;\
        background: #8B7EC8;\
        color: #fff;\
        font-size: 12.5px;\
        font-weight: 600;\
        font-family: inherit;\
        cursor: pointer;\
        transition: background 0.3s, opacity 0.3s;\
      }\
      .kiki-feedback-send:hover { background: #7a6db7; }\
      .kiki-feedback-send:disabled { opacity: 0.5; cursor: default; }\
      .kiki-feedback-cancel {\
        padding: 8px 10px;\
        border: none;\
        border-radius: 8px;\
        background: transparent;\
        color: var(--text-secondary);\
        font-size: 12px;\
        font-family: inherit;\
        cursor: pointer;\
        opacity: 0.7;\
        transition: opacity 0.3s;\
      }\
      .kiki-feedback-cancel:hover { opacity: 1; }\
      .kiki-feedback-thanks {\
        text-align: center;\
        padding: 24px 0 16px;\
        color: var(--text-primary);\
      }\
    ';
  }

  // Initialize on load
  createChatWindow();

  chrome.storage.local.get(['chatTheme'], function (data) {
    _isLight = data.chatTheme === 'light';
    applyTheme();
  });

  chrome.storage.session.get(['chatOpen'], function (data) {
    if (data.chatOpen) {
      openChat();
    }
  });

  // ---------------------------------------------------------------------------
  // ask_user clarification UI
  // ---------------------------------------------------------------------------

  function showClarification(question, options) {
    hideTyping();
    _pendingClarification = true;

    // Show question as assistant message
    addMessage('assistant', question);

    // Open chat if not already open
    if (!isOpen) openChat();

    // If there are options, render as clickable pills
    if (options && options.length > 0) {
      var optionsContainer = document.createElement('div');
      optionsContainer.className = 'kiki-chat-options';
      optionsContainer.setAttribute('data-kiki-clarification', 'true');

      for (var i = 0; i < options.length; i++) {
        (function (optionText) {
          var btn = document.createElement('button');
          btn.className = 'kiki-chat-option-btn';
          btn.textContent = optionText;
          btn.addEventListener('click', function () {
            _pendingClarification = false;
            addMessage('user', optionText);
            removeClarificationButtons();
            chrome.runtime.sendMessage({ type: 'ASK_USER_RESPONSE', answer: optionText }).catch(function () {});
          });
          optionsContainer.appendChild(btn);
        })(options[i]);
      }

      if (typingIndicator.parentNode === messageList) {
        messageList.insertBefore(optionsContainer, typingIndicator);
      } else {
        messageList.appendChild(optionsContainer);
      }

      requestAnimationFrame(function () {
        optionsContainer.classList.add('kiki-chat-visible');
        scrollToBottom();
      });
    }
  }

  function removeClarificationButtons() {
    var containers = chatRoot.querySelectorAll('[data-kiki-clarification]');
    for (var i = 0; i < containers.length; i++) {
      containers[i].remove();
    }
  }

  // ---------------------------------------------------------------------------
  // Feedback modal
  // ---------------------------------------------------------------------------

  var feedbackModal = null;

  function openFeedbackModal() {
    if (feedbackModal) { feedbackModal.remove(); feedbackModal = null; }

    feedbackModal = document.createElement('div');
    feedbackModal.className = 'kiki-feedback-overlay';

    var modal = document.createElement('div');
    modal.className = 'kiki-feedback-modal';

    var title = document.createElement('h3');
    title.className = 'kiki-feedback-title';
    title.textContent = 'Submit Feedback';
    modal.appendChild(title);

    var checkRow = document.createElement('label');
    checkRow.className = 'kiki-feedback-check-row';
    var includeCb = document.createElement('input');
    includeCb.type = 'checkbox';
    includeCb.checked = true;
    includeCb.className = 'kiki-feedback-cb';
    var checkLabel = document.createElement('span');
    checkLabel.className = 'kiki-feedback-check-label';
    checkLabel.textContent = 'Include current conversation';
    checkRow.appendChild(includeCb);
    checkRow.appendChild(checkLabel);
    modal.appendChild(checkRow);

    var noteArea = document.createElement('textarea');
    noteArea.className = 'kiki-feedback-note';
    noteArea.placeholder = 'What went wrong?';
    noteArea.rows = 3;
    modal.appendChild(noteArea);

    var actions = document.createElement('div');
    actions.className = 'kiki-feedback-actions';

    var sendBtnEl = document.createElement('button');
    sendBtnEl.className = 'kiki-feedback-send';
    sendBtnEl.textContent = 'Send Report';

    var cancelBtnEl = document.createElement('button');
    cancelBtnEl.className = 'kiki-feedback-cancel';
    cancelBtnEl.textContent = 'Cancel';
    cancelBtnEl.addEventListener('click', function () { closeFeedbackModal(); });

    actions.appendChild(sendBtnEl);
    actions.appendChild(cancelBtnEl);
    modal.appendChild(actions);

    sendBtnEl.addEventListener('click', function () {
      sendBtnEl.disabled = true;
      sendBtnEl.textContent = 'Sending\u2026';

      var payload = { userNote: noteArea.value.trim() };

      function doSend() {
        showFeedbackThanks();
      }

      if (includeCb.checked) {
        chrome.storage.session.get(['chatHistory'], function (data) {
          payload.conversation = data.chatHistory || [];
          doSend();
        });
      } else {
        doSend();
      }
    });

    function showFeedbackThanks() {
      modal.innerHTML = '';
      var thanks = document.createElement('div');
      thanks.className = 'kiki-feedback-thanks';
      thanks.innerHTML = '<p style="font-size:15px;font-weight:600;margin-bottom:6px;">Thanks!</p>' +
        '<p style="font-size:13px;color:var(--text-secondary);">This helps us fix things faster.</p>';
      modal.appendChild(thanks);
      var doneBtn = document.createElement('button');
      doneBtn.className = 'kiki-feedback-send';
      doneBtn.textContent = 'Close';
      doneBtn.addEventListener('click', function () { closeFeedbackModal(); });
      modal.appendChild(doneBtn);
    }

    feedbackModal.appendChild(modal);
    panel.appendChild(feedbackModal);

    requestAnimationFrame(function () {
      feedbackModal.classList.add('kiki-feedback-visible');
    });
  }

  function closeFeedbackModal() {
    if (feedbackModal) {
      feedbackModal.classList.remove('kiki-feedback-visible');
      setTimeout(function () {
        if (feedbackModal) { feedbackModal.remove(); feedbackModal = null; }
      }, 200);
    }
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area === 'local' && changes.chatTheme) {
      _isLight = changes.chatTheme.newValue === 'light';
      applyTheme();
    }
  });

  window.__kiki = window.__kiki || {};
  window.__kiki.chat = {
    openChat: openChat,
    closeChat: closeChat,
    toggleChat: toggleChat,
    addMessage: addMessage,
    showTyping: showTyping,
    hideTyping: hideTyping,
    showStatus: showStatus,
    hideStatus: hideStatus,
    isVisible: isVisible,
    clearMessages: clearMessages,
    restoreMessages: restoreMessages,
    showClarification: showClarification,
    resetChat: resetChat,
    isChatAction: function () { return _chatActionInProgress; },
    clearChatAction: function () { _chatActionInProgress = false; },
    setActiveSource: function (source) {
      _activeSource = source;
      if (sendBtn && !_isStopMode) {
        if (source === 'voice') {
          sendBtn.classList.add('disabled');
        } else {
          sendBtn.classList.remove('disabled');
        }
      }
    },
    setState: function (state) {
      _currentState = state;
      updateSendButton();
    },
  };
})();
