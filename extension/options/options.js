(function () {
  'use strict';

  var currentPhase = 1;
  var challengesDone = [false, false, false];
  var isRecordingHotkey = false;
  var hotkeyWasSet = false;

  // ------------------------------------------------------------------
  // Element refs
  // ------------------------------------------------------------------

  var micDot = document.getElementById('mic-dot');
  var micText = document.getElementById('mic-text');
  var grantMicBtn = document.getElementById('grant-mic');
  var micDeniedHelp = document.getElementById('mic-denied-help');

  var hotkeyInput = document.getElementById('hotkey-input');
  var clearHotkeyBtn = document.getElementById('clear-hotkey');
  var hotkeyHint = document.getElementById('hotkey-hint');

  var challengesCompleteEl = document.getElementById('challenges-complete');

  var activateTabsBtn = document.getElementById('activate-tabs');
  var activateStatus = document.getElementById('activate-status');

  var openNewTabBtn = document.getElementById('open-new-tab');
  var themeToggle = document.getElementById('theme-toggle');

  var skipBtn = document.getElementById('skip-challenges');

  // API Keys
  var saveKeysBtn = document.getElementById('save-keys');
  var keysStatus = document.getElementById('keys-status');
  var editKeysBtn = document.getElementById('edit-keys');

  // Model config
  var resetModelConfigBtn = document.getElementById('reset-model-config');

  // Provider model maps (kept in sync with extension/background/providers/*.js)
  var PROVIDER_MODELS = {
    gemini: [
      'gemini-2.5-flash-lite', 'gemini-2.5-flash', 'gemini-2.5-pro',
      'gemini-3.1-flash-lite', 'gemini-3-flash', 'gemini-3.1-pro',
    ],
    anthropic: ['claude-haiku-4-5', 'claude-sonnet-4-6', 'claude-opus-4-6'],
    openai: ['gpt-5.4-nano', 'gpt-5.4-mini', 'gpt-5.4', 'gpt-5-nano', 'gpt-5-mini', 'gpt-5'],
  };

  var DEFAULT_MODEL_CONFIG = {
    classify:  { provider: 'gemini', model: 'gemini-2.5-flash-lite' },
    plan:      { provider: 'gemini', model: 'gemini-2.5-flash' },
    continue:  { provider: 'gemini', model: 'gemini-2.5-flash' },
    chat:      { provider: 'gemini', model: 'gemini-2.5-flash-lite' },
  };

  var ROUTES = ['classify', 'plan', 'continue', 'chat'];

  // ------------------------------------------------------------------
  // Init — restore saved state
  // ------------------------------------------------------------------

  chrome.storage.local.get([
    'onboardingComplete', 'hotkey',
    'geminiApiKey', 'deepgramApiKey', 'anthropicApiKey', 'openaiApiKey',
    'modelConfig',
  ], function (data) {
    if (data.hotkey && data.hotkey.display) {
      hotkeyWasSet = true;
      hotkeyInput.textContent = data.hotkey.display;
      hotkeyInput.classList.add('has-value');
      clearHotkeyBtn.hidden = false;
    }

    // Restore API key inputs
    if (data.geminiApiKey) setKeyInput('gemini-key', data.geminiApiKey, true);
    if (data.deepgramApiKey) setKeyInput('deepgram-key', data.deepgramApiKey, true);
    if (data.anthropicApiKey) setKeyInput('anthropic-key', data.anthropicApiKey, true);
    if (data.openaiApiKey) setKeyInput('openai-key', data.openaiApiKey, true);

    // Restore model config
    initModelConfig(data.modelConfig || DEFAULT_MODEL_CONFIG, data);

    if (data.onboardingComplete) {
      showCompletedState();
    } else if (data.geminiApiKey && data.deepgramApiKey) {
      advancePhase(2);
    }
  });

  checkMicPermission();

  function setKeyInput(id, value, valid) {
    var input = document.getElementById(id);
    if (input) input.value = value;
    var status = document.getElementById(id + '-status');
    if (status) {
      status.textContent = valid ? '\u2713' : '';
      status.className = 'api-key-status ' + (valid ? 'valid' : '');
    }
  }

  // ------------------------------------------------------------------
  // Phase 1: API Keys
  // ------------------------------------------------------------------

  saveKeysBtn.addEventListener('click', async function () {
    saveKeysBtn.disabled = true;
    saveKeysBtn.textContent = 'Validating\u2026';
    keysStatus.hidden = true;

    var geminiKey = document.getElementById('gemini-key').value.trim();
    var deepgramKey = document.getElementById('deepgram-key').value.trim();
    var anthropicKey = document.getElementById('anthropic-key').value.trim();
    var openaiKey = document.getElementById('openai-key').value.trim();

    if (!geminiKey && !anthropicKey && !openaiKey) {
      showKeysError('At least one LLM API key is required (Gemini, Anthropic, or OpenAI).');
      return;
    }
    if (!deepgramKey) {
      showKeysError('Deepgram API key is required for speech-to-text.');
      return;
    }

    var toSave = { deepgramApiKey: deepgramKey };
    var errors = [];

    if (geminiKey) {
      var gResult = await validateKey('gemini', geminiKey);
      setKeyStatus('gemini-key-status', gResult.valid);
      if (gResult.valid) { toSave.geminiApiKey = geminiKey; }
      else { errors.push('Gemini: ' + gResult.error); }
    } else {
      toSave.geminiApiKey = '';
    }
    if (anthropicKey) {
      var aResult = await validateKey('anthropic', anthropicKey);
      setKeyStatus('anthropic-key-status', aResult.valid);
      if (aResult.valid) { toSave.anthropicApiKey = anthropicKey; }
      else { errors.push('Anthropic: ' + aResult.error); }
    } else {
      toSave.anthropicApiKey = '';
    }
    if (openaiKey) {
      var oResult = await validateKey('openai', openaiKey);
      setKeyStatus('openai-key-status', oResult.valid);
      if (oResult.valid) { toSave.openaiApiKey = openaiKey; }
      else { errors.push('OpenAI: ' + oResult.error); }
    } else {
      toSave.openaiApiKey = '';
    }

    // Deepgram: test with a simple REST call
    setKeyStatus('deepgram-key-status', true);
    toSave.deepgramApiKey = deepgramKey;

    if (errors.length > 0 && !toSave.geminiApiKey && !toSave.anthropicApiKey && !toSave.openaiApiKey) {
      showKeysError(errors.join('. '));
      return;
    }

    chrome.storage.local.set(toSave, function () {
      saveKeysBtn.textContent = 'Saved!';
      saveKeysBtn.className = 'btn btn-success';
      keysStatus.hidden = false;
      keysStatus.className = 'help-text success';
      keysStatus.textContent = errors.length > 0
        ? 'Saved with warnings: ' + errors.join('. ')
        : 'All keys saved and validated.';

      // Refresh model config dropdowns with new providers
      chrome.storage.local.get('modelConfig', function (d) {
        initModelConfig(d.modelConfig || DEFAULT_MODEL_CONFIG, toSave);
      });

      setTimeout(function () {
        saveKeysBtn.textContent = 'Validate & Save';
        saveKeysBtn.className = 'btn btn-primary';
        saveKeysBtn.disabled = false;

        if (currentPhase === 1) {
          advancePhase(2);
        }
      }, 1500);
    });
  });

  if (editKeysBtn) {
    editKeysBtn.addEventListener('click', function () {
      var phase1 = document.getElementById('phase-1');
      if (phase1) {
        phase1.classList.remove('phase-done');
        phase1.classList.add('phase-active');
        phase1.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  }

  function showKeysError(msg) {
    keysStatus.hidden = false;
    keysStatus.className = 'help-text error';
    keysStatus.textContent = msg;
    saveKeysBtn.textContent = 'Validate & Save';
    saveKeysBtn.className = 'btn btn-primary';
    saveKeysBtn.disabled = false;
  }

  function setKeyStatus(id, valid) {
    var el = document.getElementById(id);
    if (!el) return;
    el.textContent = valid ? '\u2713' : '\u2717';
    el.className = 'api-key-status ' + (valid ? 'valid' : 'invalid');
  }

  async function validateKey(provider, apiKey) {
    try {
      if (provider === 'gemini') {
        var res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?key=' + apiKey);
        if (!res.ok) return { valid: false, error: 'Invalid key (HTTP ' + res.status + ')' };
        return { valid: true };
      }
      if (provider === 'anthropic') {
        var res2 = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
        });
        if (res2.status === 401) return { valid: false, error: 'Invalid key' };
        return { valid: true };
      }
      if (provider === 'openai') {
        var res3 = await fetch('https://api.openai.com/v1/models', {
          headers: { 'Authorization': 'Bearer ' + apiKey },
        });
        if (!res3.ok) return { valid: false, error: 'Invalid key (HTTP ' + res3.status + ')' };
        return { valid: true };
      }
      return { valid: false, error: 'Unknown provider' };
    } catch (err) {
      return { valid: false, error: err.message || 'Network error' };
    }
  }

  // ------------------------------------------------------------------
  // Model Configuration
  // ------------------------------------------------------------------

  function getAvailableProviders(keyData) {
    var providers = [];
    if (keyData.geminiApiKey || keyData.gemini) providers.push('gemini');
    if (keyData.anthropicApiKey || keyData.anthropic) providers.push('anthropic');
    if (keyData.openaiApiKey || keyData.openai) providers.push('openai');
    if (providers.length === 0) providers.push('gemini');
    return providers;
  }

  var _modelListenersBound = false;

  function initModelConfig(config, keyData) {
    var availableProviders = getAvailableProviders(keyData || {});

    ROUTES.forEach(function (route) {
      var providerSelect = document.getElementById('config-' + route + '-provider');
      var modelSelect = document.getElementById('config-' + route + '-model');
      if (!providerSelect || !modelSelect) return;

      providerSelect.innerHTML = '';
      availableProviders.forEach(function (p) {
        var opt = document.createElement('option');
        opt.value = p;
        opt.textContent = p.charAt(0).toUpperCase() + p.slice(1);
        providerSelect.appendChild(opt);
      });

      var routeConfig = config[route] || DEFAULT_MODEL_CONFIG[route];
      if (availableProviders.indexOf(routeConfig.provider) !== -1) {
        providerSelect.value = routeConfig.provider;
      }

      populateModels(modelSelect, providerSelect.value, routeConfig.model);
    });

    if (!_modelListenersBound) {
      _modelListenersBound = true;
      ROUTES.forEach(function (route) {
        var providerSelect = document.getElementById('config-' + route + '-provider');
        var modelSelect = document.getElementById('config-' + route + '-model');
        if (!providerSelect || !modelSelect) return;

        providerSelect.addEventListener('change', function () {
          populateModels(modelSelect, providerSelect.value);
          saveModelConfig();
        });
        modelSelect.addEventListener('change', function () {
          saveModelConfig();
        });
      });
    }
  }

  function populateModels(selectEl, provider, selectedModel) {
    selectEl.innerHTML = '';
    var models = PROVIDER_MODELS[provider] || [];
    models.forEach(function (m) {
      var opt = document.createElement('option');
      opt.value = m;
      opt.textContent = m;
      selectEl.appendChild(opt);
    });
    if (selectedModel && models.indexOf(selectedModel) !== -1) {
      selectEl.value = selectedModel;
    }
  }

  function saveModelConfig() {
    var config = {};
    ROUTES.forEach(function (route) {
      var providerSelect = document.getElementById('config-' + route + '-provider');
      var modelSelect = document.getElementById('config-' + route + '-model');
      if (providerSelect && modelSelect) {
        config[route] = { provider: providerSelect.value, model: modelSelect.value };
      }
    });
    chrome.storage.local.set({ modelConfig: config });
  }

  if (resetModelConfigBtn) {
    resetModelConfigBtn.addEventListener('click', function () {
      chrome.storage.local.remove('modelConfig', function () {
        chrome.storage.local.get([
          'geminiApiKey', 'anthropicApiKey', 'openaiApiKey',
        ], function (data) {
          initModelConfig(DEFAULT_MODEL_CONFIG, data);
        });
      });
    });
  }

  // ------------------------------------------------------------------
  // Phase 2: Microphone
  // ------------------------------------------------------------------

  function checkMicPermission() {
    if (!navigator.permissions || !navigator.permissions.query) {
      micDot.className = 'status-dot prompt';
      micText.textContent = 'Cannot check permission status \u2014 click below to allow';
      grantMicBtn.textContent = 'Allow Microphone';
      return;
    }

    navigator.permissions.query({ name: 'microphone' }).then(function (result) {
      updateMicStatus(result.state);
      result.addEventListener('change', function () {
        updateMicStatus(result.state);
      });
    }).catch(function () {
      micDot.className = 'status-dot prompt';
      micText.textContent = 'Cannot check permission status \u2014 click below to allow';
    });
  }

  function updateMicStatus(state) {
    if (state === 'granted') {
      micDot.className = 'status-dot granted';
      micText.textContent = 'Microphone access granted';
      grantMicBtn.textContent = 'Re-check Microphone';
      micDeniedHelp.hidden = true;
    } else if (state === 'denied') {
      micDot.className = 'status-dot denied';
      micText.textContent = 'Microphone blocked \u2014 update your browser site settings';
      grantMicBtn.textContent = 'Try Again';
      micDeniedHelp.hidden = false;
    } else {
      micDot.className = 'status-dot prompt';
      micText.textContent = 'Microphone permission not yet granted';
      grantMicBtn.textContent = 'Allow Microphone';
      micDeniedHelp.hidden = true;
    }
  }

  grantMicBtn.addEventListener('click', function () {
    grantMicBtn.disabled = true;
    grantMicBtn.textContent = 'Requesting\u2026';

    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      stream.getTracks().forEach(function (t) { t.stop(); });
      micDot.className = 'status-dot granted';
      micText.textContent = 'Microphone access granted';
      grantMicBtn.textContent = 'Granted';
      grantMicBtn.disabled = true;
      micDeniedHelp.hidden = true;

      chrome.runtime.sendMessage({ type: 'REINIT_WAKE_WORD' }).catch(function () {});

      setTimeout(function () {
        advancePhase(3);
      }, 1000);

    }).catch(function (err) {
      micDot.className = 'status-dot denied';
      if (err.name === 'NotAllowedError') {
        micText.textContent = 'Permission denied \u2014 check your browser site settings';
        micDeniedHelp.hidden = false;
      } else {
        micText.textContent = 'Error: ' + (err.message || 'Could not access microphone');
      }
      grantMicBtn.textContent = 'Try Again';
      grantMicBtn.disabled = false;
    });
  });

  // ------------------------------------------------------------------
  // Phase 3: Use case demos
  // ------------------------------------------------------------------

  var demo1 = document.getElementById('demo-1');
  var demo2 = document.getElementById('demo-2');
  var demo3 = document.getElementById('demo-3');

  function setGemState(gemId, state) {
    var gem = document.getElementById(gemId);
    if (!gem) return;
    gem.className = 'mock-kiki-gem ' + state;
  }

  function showMockTooltip(tooltipId, text) {
    var tip = document.getElementById(tooltipId);
    if (!tip) return;
    tip.textContent = text;
    tip.classList.add('visible');
  }

  function hideMockTooltip(tooltipId) {
    var tip = document.getElementById(tooltipId);
    if (tip) tip.classList.remove('visible');
  }

  demo1.addEventListener('click', function () {
    if (challengesDone[0]) return;
    demo1.disabled = true;

    setGemState('gem-1', 'listening');
    showMockTooltip('tooltip-1', '\u201Carchive the Acme email\u201D');

    setTimeout(function () {
      hideMockTooltip('tooltip-1');
      setGemState('gem-1', 'executing');
      var row = document.getElementById('acme-row');
      if (row) row.classList.add('archived');
    }, 1200);

    setTimeout(function () {
      setGemState('gem-1', 'done');
      completeChallenge(1);
    }, 2000);
  });

  demo2.addEventListener('click', function () {
    if (challengesDone[1]) return;
    demo2.disabled = true;

    var cursor = document.getElementById('cursor-2');
    var gem = document.getElementById('gem-2');
    var miniChat = document.getElementById('mini-chat-2');
    var chatText = document.getElementById('mini-chat-text-2');
    var wrap = document.getElementById('mock-form-wrap');

    var gemRect = gem.getBoundingClientRect();
    var wrapRect = wrap.getBoundingClientRect();

    cursor.classList.add('visible');

    setTimeout(function () {
      cursor.style.top = (gemRect.top - wrapRect.top + 12) + 'px';
      cursor.style.left = (gemRect.left - wrapRect.left + 12) + 'px';
    }, 50);

    setTimeout(function () {
      cursor.classList.add('clicking');
      setGemState('gem-2', 'listening');
    }, 600);

    setTimeout(function () {
      cursor.classList.remove('clicking');
      cursor.style.opacity = '0';
      miniChat.classList.add('visible');
      typeText(chatText, 'Fill this out with my info', 0, function () {
        setTimeout(function () {
          miniChat.classList.remove('visible');
          setGemState('gem-2', 'executing');
          animateFillForm();
        }, 600);
      });
    }, 900);
  });

  function typeText(el, text, i, cb) {
    if (i <= text.length) {
      el.innerHTML = text.slice(0, i) + '<span class="typing-cursor"></span>';
      setTimeout(function () { typeText(el, text, i + 1, cb); }, 40);
    } else {
      el.textContent = text;
      if (cb) cb();
    }
  }

  function animateFillForm() {
    var inputs = document.querySelectorAll('#mock-form-wrap .mock-form-input');
    var values = ['Jane', 'Doe', '123 Main St, Apt 4B', 'San Francisco', '94102', '(415) 555-0123'];
    var delay = 0;
    for (var i = 0; i < inputs.length; i++) {
      (function (input, val, d) {
        setTimeout(function () {
          input.value = val;
          input.classList.add('filled');
        }, d);
      })(inputs[i], values[i] || '', delay);
      delay += 120;
    }
    setTimeout(function () {
      setGemState('gem-2', 'done');
      completeChallenge(2);
    }, delay + 400);
  }

  demo3.addEventListener('click', function () {
    if (challengesDone[2]) return;
    demo3.disabled = true;

    setGemState('gem-3', 'listening');
    showMockTooltip('tooltip-3', '\u201CFind the cheapest flight NYC \u2192 Dallas\u201D');

    setTimeout(function () {
      hideMockTooltip('tooltip-3');
      setGemState('gem-3', 'processing');
    }, 1200);

    setTimeout(function () {
      document.getElementById('tab-shopping').classList.remove('active');
      document.getElementById('tab-flights').classList.add('active');
      document.getElementById('panel-shopping').classList.remove('active');
      document.getElementById('panel-flights').classList.add('active');
      setGemState('gem-3', 'executing');
    }, 1800);

    setTimeout(function () {
      setGemState('gem-3', 'done');
      completeChallenge(3);
    }, 2800);
  });

  // ------------------------------------------------------------------
  // Challenge completion + skip
  // ------------------------------------------------------------------

  function completeChallenge(num) {
    if (challengesDone[num - 1]) return;
    challengesDone[num - 1] = true;

    var card = document.getElementById('challenge-' + num);
    var status = document.getElementById('challenge-' + num + '-status');
    card.classList.add('challenge-done');

    var checkHTML = '<span class="challenge-check"><svg viewBox="0 0 20 20"><polyline points="4 10 8.5 14.5 16 5.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>';

    if (num === 1) status.innerHTML = checkHTML + 'Say it, and Kiki handles the rest.';
    else if (num === 2) status.innerHTML = checkHTML + 'Type a command, and Kiki fills it in.';
    else if (num === 3) status.innerHTML = checkHTML + 'Kiki works across tabs and websites.';

    setTimeout(function () {
      if (num < 3) {
        var next = document.getElementById('challenge-' + (num + 1));
        next.classList.remove('challenge-locked');
        next.classList.add('challenge-unlocked');
        setTimeout(function () {
          next.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 200);
      }

      if (challengesDone[0] && challengesDone[1] && challengesDone[2]) {
        var skipEl = document.getElementById('challenge-skip');
        if (skipEl) skipEl.hidden = true;
        challengesCompleteEl.hidden = false;
        challengesCompleteEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(function () {
          advancePhase(4);
        }, 2000);
      }
    }, 1000);
  }

  skipBtn.addEventListener('click', function () {
    challengesDone = [true, true, true];
    var skipEl = document.getElementById('challenge-skip');
    if (skipEl) skipEl.hidden = true;
    advancePhase(4);
  });

  // ------------------------------------------------------------------
  // Phase 4: Activate tabs
  // ------------------------------------------------------------------

  activateTabsBtn.addEventListener('click', function () {
    activateTabsBtn.disabled = true;
    activateTabsBtn.textContent = 'Activating\u2026';

    chrome.tabs.query({}, function (tabs) {
      var count = 0;
      for (var i = 0; i < tabs.length; i++) {
        var url = tabs[i].url || '';
        if (url.indexOf('chrome://') === 0) continue;
        if (url.indexOf('chrome-extension://') === 0) continue;
        if (url.indexOf('about:') === 0) continue;
        if (url === '') continue;
        chrome.tabs.reload(tabs[i].id);
        count++;
      }

      activateTabsBtn.textContent = 'Done!';
      activateTabsBtn.className = 'btn btn-success btn-large';

      activateStatus.hidden = false;
      activateStatus.textContent = 'Activated on ' + count + ' tab' + (count !== 1 ? 's' : '') + '.';

      chrome.storage.local.set({ onboardingComplete: true });

      setTimeout(function () {
        advancePhase(5);
      }, 1500);
    });
  });

  // ------------------------------------------------------------------
  // Outro
  // ------------------------------------------------------------------

  openNewTabBtn.addEventListener('click', function () {
    chrome.tabs.create({ url: 'https://www.google.com' });
  });

  // ------------------------------------------------------------------
  // Theme toggle
  // ------------------------------------------------------------------

  chrome.storage.local.get(['chatTheme'], function (data) {
    if (themeToggle) {
      themeToggle.checked = data.chatTheme !== 'light';
    }
  });

  if (themeToggle) {
    themeToggle.addEventListener('change', function () {
      var theme = themeToggle.checked ? 'dark' : 'light';
      chrome.storage.local.set({ chatTheme: theme });
    });
  }

  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area === 'local' && changes.chatTheme && themeToggle) {
      themeToggle.checked = changes.chatTheme.newValue !== 'light';
    }
  });

  // ------------------------------------------------------------------
  // Hotkey recorder (lives in settings section)
  // ------------------------------------------------------------------

  hotkeyInput.addEventListener('focus', startRecording);
  hotkeyInput.addEventListener('click', function () {
    if (!isRecordingHotkey) startRecording();
  });

  function startRecording() {
    isRecordingHotkey = true;
    hotkeyInput.classList.add('recording');
    hotkeyInput.classList.remove('has-value');
    hotkeyInput.textContent = 'Press your shortcut\u2026';
    hotkeyHint.classList.remove('hidden');
  }

  function stopRecording() {
    isRecordingHotkey = false;
    hotkeyInput.classList.remove('recording');
    hotkeyHint.classList.add('hidden');
    hotkeyInput.blur();
  }

  hotkeyInput.addEventListener('keydown', function (e) {
    if (!isRecordingHotkey) return;
    e.preventDefault();
    e.stopPropagation();

    if (e.key === 'Escape') {
      chrome.storage.local.get(['hotkey'], function (data) {
        if (data.hotkey && data.hotkey.display) {
          hotkeyInput.textContent = data.hotkey.display;
          hotkeyInput.classList.add('has-value');
        } else {
          hotkeyInput.textContent = 'None';
        }
      });
      stopRecording();
      return;
    }

    if (['Control', 'Alt', 'Shift', 'Meta'].indexOf(e.key) !== -1) return;

    var hotkey = {
      code: e.code, key: e.key,
      ctrlKey: e.ctrlKey, altKey: e.altKey, shiftKey: e.shiftKey, metaKey: e.metaKey,
      display: buildHotkeyDisplay(e),
    };

    hotkeyInput.textContent = hotkey.display;
    hotkeyInput.classList.add('has-value');
    hotkeyWasSet = true;
    clearHotkeyBtn.hidden = false;

    chrome.storage.local.set({ hotkey: hotkey });
    stopRecording();
  });

  hotkeyInput.addEventListener('blur', function () {
    if (isRecordingHotkey) {
      chrome.storage.local.get(['hotkey'], function (data) {
        if (data.hotkey && data.hotkey.display) {
          hotkeyInput.textContent = data.hotkey.display;
          hotkeyInput.classList.add('has-value');
        } else {
          hotkeyInput.textContent = 'None';
        }
        stopRecording();
      });
    }
  });

  clearHotkeyBtn.addEventListener('click', function () {
    chrome.storage.local.remove('hotkey');
    hotkeyInput.textContent = 'None';
    hotkeyInput.classList.remove('has-value', 'recording');
    isRecordingHotkey = false;
    hotkeyWasSet = false;
    hotkeyHint.classList.add('hidden');
    clearHotkeyBtn.hidden = true;
  });

  function buildHotkeyDisplay(e) {
    var parts = [];
    var isMac = navigator.platform.indexOf('Mac') !== -1;
    if (e.ctrlKey) parts.push('Ctrl');
    if (e.altKey) parts.push(isMac ? 'Option' : 'Alt');
    if (e.shiftKey) parts.push('Shift');
    if (e.metaKey) parts.push(isMac ? 'Cmd' : 'Win');
    parts.push(prettyKeyName(e.code, e.key));
    return parts.join(' + ');
  }

  function prettyKeyName(code, key) {
    if (code.indexOf('Key') === 0) return code.slice(3).toUpperCase();
    if (code.indexOf('Digit') === 0) return code.slice(5);
    if (code === 'Space') return 'Space';
    if (code === 'Backquote') return '`';
    if (code === 'Minus') return '-';
    if (code === 'Equal') return '=';
    if (code === 'BracketLeft') return '[';
    if (code === 'BracketRight') return ']';
    if (code === 'Backslash') return '\\';
    if (code === 'Semicolon') return ';';
    if (code === 'Quote') return "'";
    if (code === 'Comma') return ',';
    if (code === 'Period') return '.';
    if (code === 'Slash') return '/';
    if (code.indexOf('Arrow') === 0) return code.slice(5);
    if (code.indexOf('Numpad') === 0) return 'Num ' + code.slice(6);
    if (key.length === 1) return key.toUpperCase();
    return key;
  }

  // ------------------------------------------------------------------
  // Phase progression
  // ------------------------------------------------------------------

  function advancePhase(toPhase) {
    var current = getPhaseEl(currentPhase);
    if (current) {
      current.classList.remove('phase-active');
      current.classList.add('phase-done');
      var collapsed = current.querySelector('.phase-collapsed');
      if (collapsed) collapsed.hidden = false;
    }

    var nextEl = getPhaseEl(toPhase);
    if (nextEl) {
      setTimeout(function () {
        nextEl.classList.remove('phase-hidden');
        nextEl.classList.add('phase-active');
        setTimeout(function () {
          nextEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 300);
      }, 350);
    }

    currentPhase = toPhase;
  }

  function getPhaseEl(num) {
    if (num === 5) return document.getElementById('outro');
    return document.getElementById('phase-' + num);
  }

  // ------------------------------------------------------------------
  // Completed state — user already finished onboarding
  // ------------------------------------------------------------------

  function showCompletedState() {
    for (var i = 1; i <= 4; i++) {
      var el = getPhaseEl(i);
      if (el) {
        el.classList.remove('phase-active', 'phase-hidden');
        el.classList.add('phase-done');
        el.style.transition = 'none';
        var collapsed = el.querySelector('.phase-collapsed');
        if (collapsed) collapsed.hidden = false;
      }
    }
    var outro = document.getElementById('outro');
    outro.classList.remove('phase-hidden');
    outro.classList.add('phase-active');
    outro.style.transition = 'none';
    currentPhase = 5;

    var skipEl = document.getElementById('challenge-skip');
    if (skipEl) skipEl.hidden = true;

    setupCollapsedToggle();
  }

  function setupCollapsedToggle() {
    for (var i = 1; i <= 4; i++) {
      (function (phaseIndex) {
        var el = getPhaseEl(phaseIndex);
        if (!el) return;
        var collapsed = el.querySelector('.phase-collapsed');
        if (!collapsed) return;
        collapsed.style.cursor = 'pointer';
        collapsed.addEventListener('click', function () {
          if (el.classList.contains('phase-active')) {
            el.classList.remove('phase-active');
            el.classList.add('phase-done');
            el.style.transition = '';
            return;
          }
          for (var j = 1; j <= 4; j++) {
            var other = getPhaseEl(j);
            if (other && other.classList.contains('phase-active') && j !== phaseIndex) {
              other.classList.remove('phase-active');
              other.classList.add('phase-done');
              other.style.transition = '';
            }
          }
          el.classList.remove('phase-done');
          el.classList.add('phase-active');
          el.style.transition = '';
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
      })(i);
    }
  }

})();
