// Individual action executors for DOM operations.
// Each executor receives an action object and returns { ok, navigating?, error? }

(function () {
  'use strict';

  const tree = () => window.__kiki.tree;

  function executeClick(target) {
    const el = resolveTarget(target);
    if (!el) return { ok: false, error: 'Element not found: ' + target };

    highlightElement(el);
    scrollIntoViewIfNeeded(el);

    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, composed: true }));
    el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, composed: true }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, composed: true }));
    el.click();

    const willNavigate = isNavigationElement(el);
    return { ok: true, navigating: willNavigate };
  }

  function executeHover(target) {
    const el = resolveTarget(target);
    if (!el) return { ok: false, error: 'Element not found: ' + target };

    highlightElement(el);
    scrollIntoViewIfNeeded(el);

    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const opts = { bubbles: true, composed: true, clientX: cx, clientY: cy };

    el.dispatchEvent(new PointerEvent('pointerenter', opts));
    el.dispatchEvent(new MouseEvent('mouseenter', opts));
    el.dispatchEvent(new PointerEvent('pointermove', opts));
    el.dispatchEvent(new MouseEvent('mousemove', opts));
    el.dispatchEvent(new MouseEvent('mouseover', opts));

    return { ok: true };
  }

  function executeType(target, params) {
    const el = resolveTarget(target);
    if (!el) return { ok: false, error: 'Element not found: ' + target };

    highlightElement(el);
    scrollIntoViewIfNeeded(el);
    el.focus();

    const text = params?.text ?? '';
    const append = params?.append === true;

    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      const proto = el.tagName === 'INPUT' ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
      const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;

      if (!append) {
        if (nativeSetter) {
          nativeSetter.call(el, '');
        } else {
          el.value = '';
        }
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }

      const newValue = append ? (el.value + text) : text;
      if (nativeSetter) {
        nativeSetter.call(el, newValue);
      } else {
        el.value = newValue;
      }

      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (el.isContentEditable) {
      if (!append) {
        document.execCommand('selectAll', false, null);
      }
      document.execCommand('insertText', false, text);
    }

    return { ok: true };
  }

  function executeTypeKey(target, params) {
    const el = resolveTarget(target);
    const textEl = el || document.activeElement || document.body;

    const text = params?.text ?? '';
    if (!text) return { ok: true };

    if (el) {
      highlightElement(el);
      scrollIntoViewIfNeeded(el);
      el.focus();
    }

    for (const char of text) {
      const keyOpts = { key: char, code: 'Key' + char.toUpperCase(), bubbles: true, cancelable: true };
      textEl.dispatchEvent(new KeyboardEvent('keydown', keyOpts));
      textEl.dispatchEvent(new KeyboardEvent('keypress', keyOpts));

      if (textEl.tagName === 'INPUT' || textEl.tagName === 'TEXTAREA') {
        const proto = textEl.tagName === 'INPUT' ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
        const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        const cur = textEl.value;
        if (nativeSetter) {
          nativeSetter.call(textEl, cur + char);
        } else {
          textEl.value = cur + char;
        }
        textEl.dispatchEvent(new Event('input', { bubbles: true }));
      } else if (textEl.isContentEditable) {
        document.execCommand('insertText', false, char);
      }

      textEl.dispatchEvent(new KeyboardEvent('keyup', keyOpts));
    }

    if (textEl.tagName === 'INPUT' || textEl.tagName === 'TEXTAREA') {
      textEl.dispatchEvent(new Event('change', { bubbles: true }));
    }

    return { ok: true };
  }

  function executeScroll(_target, params) {
    const direction = params?.direction || 'down';
    const amount = params?.amount || 3;
    const px = amount * 100;

    if (amount >= 999) {
      window.scrollTo({
        top: direction === 'up' ? 0 : document.body.scrollHeight,
        behavior: 'smooth',
      });
    } else {
      const map = { up: [0, -px], down: [0, px], left: [-px, 0], right: [px, 0] };
      const [x, y] = map[direction] || [0, px];
      window.scrollBy({ left: x, top: y, behavior: 'smooth' });
    }

    return { ok: true };
  }

  function executeScrollToElement(target) {
    const el = resolveTarget(target);
    if (!el) return { ok: false, error: 'Element not found: ' + target };

    highlightElement(el);
    el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });

    return { ok: true };
  }

  const BLOCKED_SCHEMES = /^(javascript|data|vbscript|blob):/i;

  function executeNavigate(_target, params) {
    const url = params?.url;
    if (!url) return { ok: false, error: 'No URL provided' };

    if (BLOCKED_SCHEMES.test(url.trim())) {
      return { ok: false, error: 'Blocked URL scheme' };
    }

    let resolved = url;
    if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('chrome://')) {
      resolved = 'https://' + url;
    }

    window.location.href = resolved;
    return { ok: true, navigating: true };
  }

  function executeBack() {
    history.back();
    return { ok: true, navigating: true };
  }

  function executeForward() {
    history.forward();
    return { ok: true, navigating: true };
  }

  function executeSelect(target, params) {
    const el = resolveTarget(target);
    if (!el || el.tagName !== 'SELECT') return { ok: false, error: 'Select element not found: ' + target };

    highlightElement(el);
    const value = params?.value;
    if (!value) return { ok: false, error: 'No value provided for select' };

    let matched = false;
    const lowerVal = value.toLowerCase();

    for (const opt of el.options) {
      if (opt.value === value || opt.textContent.trim().toLowerCase() === lowerVal) {
        el.value = opt.value;
        matched = true;
        break;
      }
    }

    if (!matched) {
      for (const opt of el.options) {
        if (opt.textContent.trim().toLowerCase().includes(lowerVal) ||
            opt.value.toLowerCase().includes(lowerVal)) {
          el.value = opt.value;
          matched = true;
          break;
        }
      }
    }

    if (!matched) return { ok: false, error: 'Option "' + value + '" not found' };

    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return { ok: true };
  }

  function executeFocus(target) {
    const el = resolveTarget(target);
    if (!el) return { ok: false, error: 'Element not found: ' + target };

    highlightElement(el);
    scrollIntoViewIfNeeded(el);
    el.focus();
    return { ok: true };
  }

  const KEY_CODE_MAP = {
    Enter: 'Enter', Tab: 'Tab', Escape: 'Escape', Backspace: 'Backspace',
    Delete: 'Delete', Space: ' ', ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown',
    ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight', Home: 'Home', End: 'End',
    PageUp: 'PageUp', PageDown: 'PageDown',
  };

  function keyToCode(key) {
    if (key === ' ' || key === 'Space') return 'Space';
    if (KEY_CODE_MAP[key]) return KEY_CODE_MAP[key];
    if (key.length === 1) return 'Key' + key.toUpperCase();
    return key;
  }

  function executePressKey(_target, params) {
    const key = params?.key || 'Enter';
    const target = document.activeElement || document.body;

    const modifiers = {
      ctrlKey: !!params?.ctrl,
      shiftKey: !!params?.shift,
      altKey: !!params?.alt,
      metaKey: !!params?.meta,
    };

    const opts = { key, code: keyToCode(key), bubbles: true, cancelable: true, ...modifiers };
    target.dispatchEvent(new KeyboardEvent('keydown', opts));
    target.dispatchEvent(new KeyboardEvent('keypress', opts));
    target.dispatchEvent(new KeyboardEvent('keyup', opts));

    if (key === 'Enter' && target.form) {
      try {
        target.form.requestSubmit();
      } catch {
        target.form.submit();
      }
      return { ok: true, navigating: !!target.form.action };
    }

    if (key === 'Enter') {
      return { ok: true, navigating: false };
    }

    return { ok: true };
  }

  function executeWait(_target, params) {
    const ms = Math.min(params?.ms || 500, 5000);
    return new Promise(resolve => setTimeout(() => resolve({ ok: true }), ms));
  }

  function executeWaitFor(_target, params) {
    const selector = params?.selector;
    const text = params?.text;
    const timeout = Math.min(params?.timeout || 5000, 10000);

    if (!selector && !text) {
      return executeWait(null, { ms: timeout });
    }

    return new Promise(resolve => {
      const deadline = Date.now() + timeout;

      function check() {
        if (selector) {
          try {
            const el = document.querySelector(selector);
            if (el && isElementVisible(el)) {
              resolve({ ok: true });
              return;
            }
          } catch { /* invalid selector */ }
        }

        if (text) {
          if (document.body.innerText.includes(text)) {
            resolve({ ok: true });
            return;
          }
        }

        if (Date.now() >= deadline) {
          resolve({ ok: false });
          return;
        }

        setTimeout(check, 300);
      }

      check();
    });
  }

  function isElementVisible(el) {
    if (!el) return false;
    const style = getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  }

  // --- Target resolution ---

  function resolveTarget(target) {
    if (target == null) return null;

    if (typeof target === 'number') return tree().getElementByRef(target);

    const str = String(target);
    const byRef = parseInt(str, 10);
    if (!isNaN(byRef) && String(byRef) === str.trim()) return tree().getElementByRef(byRef);

    const el = findByDescription(str);
    if (el) return el;

    return findBySelector(str);
  }

  function findBySelector(desc) {
    try {
      const el = document.querySelector(desc);
      if (el) return el;
    } catch { /* not a valid selector, that's fine */ }
    return null;
  }

  const FALLBACK_SELECTORS = [
    'a[href]', 'button', 'input:not([type="hidden"])', 'textarea', 'select',
    '[role="button"]', '[role="link"]', '[role="checkbox"]', '[role="radio"]',
    '[role="tab"]', '[role="menuitem"]', '[role="option"]', '[role="switch"]',
    '[role="combobox"]', '[role="searchbox"]', '[role="textbox"]', '[role="slider"]',
    '[contenteditable="true"]', '[onclick]', '[tabindex]:not([tabindex="-1"])',
    'summary',
  ].join(',');

  function findByDescription(desc) {
    const lower = desc.toLowerCase().trim();

    const refMap = tree().getElementMap();
    let containsMatch = null;
    let containsScore = 0;
    let fuzzyMatch = null;
    let fuzzyScore = 0;

    for (const [, el] of refMap) {
      const label = getElementSearchText(el);

      if (label === lower) return el;

      if (label.includes(lower)) {
        const score = lower.length / label.length;
        if (score > containsScore) {
          containsScore = score;
          containsMatch = el;
        }
      } else if (lower.includes(label) && label.length > 2) {
        const score = label.length / lower.length;
        if (score > containsScore) {
          containsScore = score;
          containsMatch = el;
        }
      }

      const fScore = fuzzyMatchScore(lower, label);
      if (fScore > 0.6 && fScore > fuzzyScore) {
        fuzzyScore = fScore;
        fuzzyMatch = el;
      }
    }

    if (containsMatch || fuzzyMatch) {
      return containsMatch || fuzzyMatch;
    }

    const allInteractive = document.querySelectorAll(FALLBACK_SELECTORS);
    for (const el of allInteractive) {
      if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') continue;
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') continue;

      const label = getElementSearchText(el);

      if (label === lower) return el;

      if (label.includes(lower)) {
        const score = lower.length / label.length;
        if (score > containsScore) {
          containsScore = score;
          containsMatch = el;
        }
      } else if (lower.includes(label) && label.length > 2) {
        const score = label.length / lower.length;
        if (score > containsScore) {
          containsScore = score;
          containsMatch = el;
        }
      }

      const fScore = fuzzyMatchScore(lower, label);
      if (fScore > 0.6 && fScore > fuzzyScore) {
        fuzzyScore = fScore;
        fuzzyMatch = el;
      }
    }

    return containsMatch || fuzzyMatch;
  }

  function getElementSearchText(el) {
    return (
      (el.getAttribute('aria-label') || '') + ' ' +
      (el.textContent?.trim() || '') + ' ' +
      (el.title || '') + ' ' +
      (el.placeholder || '') + ' ' +
      (el.value || '') + ' ' +
      (el.name || '') + ' ' +
      (el.id || '') + ' ' +
      (el.className && typeof el.className === 'string' ? el.className : '')
    ).toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function fuzzyMatchScore(query, text) {
    if (!query || !text) return 0;

    const words = query.split(/\s+/);
    let matchedWords = 0;
    for (const word of words) {
      if (word.length < 2) continue;
      if (text.includes(word)) matchedWords++;
    }
    if (words.length === 0) return 0;
    return matchedWords / words.length;
  }

  // --- Helpers ---

  function scrollIntoViewIfNeeded(el) {
    const rect = el.getBoundingClientRect();
    if (rect.top < 0 || rect.bottom > window.innerHeight ||
        rect.left < 0 || rect.right > window.innerWidth) {
      el.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'nearest' });
    }
  }

  function isNavigationElement(el) {
    if (el.tagName === 'A' && el.href && !el.href.startsWith('javascript:')) {
      return el.target !== '_blank';
    }
    if (el.type === 'submit' && el.form?.action) return true;
    return false;
  }

  function highlightElement(el) {
    const prev = el.style.outline;
    const prevOffset = el.style.outlineOffset;
    el.style.outline = '2px solid #E8735A';
    el.style.outlineOffset = '2px';
    setTimeout(() => {
      el.style.outline = prev;
      el.style.outlineOffset = prevOffset;
    }, 600);
  }

  // --- Export ---

  window.__kiki = window.__kiki || {};
  window.__kiki.executors = {
    click: executeClick,
    hover: executeHover,
    type: executeType,
    type_keys: executeTypeKey,
    scroll: executeScroll,
    scroll_to: executeScrollToElement,
    navigate: executeNavigate,
    back: executeBack,
    forward: executeForward,
    select: executeSelect,
    focus: executeFocus,
    press_key: executePressKey,
    wait: executeWait,
    wait_for: executeWaitFor,
  };
})();
