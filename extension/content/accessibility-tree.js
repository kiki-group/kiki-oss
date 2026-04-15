// Accessibility Tree Extractor
// Produces a structured, LLM-optimized snapshot of the current page's interactive elements.
// Attaches to window.__kiki.tree (content scripts can't use ES modules in manifest)

(function () {
  'use strict';

  const INTERACTIVE_SELECTORS = [
    'a[href]',
    'button',
    'input:not([type="hidden"])',
    'textarea',
    'select',
    '[role="button"]',
    '[role="link"]',
    '[role="checkbox"]',
    '[role="radio"]',
    '[role="tab"]',
    '[role="menuitem"]',
    '[role="menuitemcheckbox"]',
    '[role="menuitemradio"]',
    '[role="option"]',
    '[role="switch"]',
    '[role="combobox"]',
    '[role="searchbox"]',
    '[role="textbox"]',
    '[role="slider"]',
    '[role="spinbutton"]',
    '[role="treeitem"]',
    '[contenteditable="true"]',
    '[onclick]',
    '[tabindex]:not([tabindex="-1"])',
    'summary',
    'details',
    'label[for]',
    'video',
    'audio',
  ];

  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'META', 'LINK', 'BR', 'HR']);
  const SKIP_HOST_ID = 'kiki-host';
  const MAX_INTERACTIVE = 400;
  const MAX_LABEL_LENGTH = 120;
  const MAX_VISIBLE_TEXT = 5000;

  // Reading mode: fewer elements, much more text for extraction/translation/summary tasks
  const READING_MAX_INTERACTIVE = 100;
  const READING_MAX_VISIBLE_TEXT = 15000;
  const READING_COMPACT_TEXT_LIMIT = 12000;

  let elementMap = new Map();

  function getElementByRef(ref) {
    return elementMap.get(ref) || null;
  }

  function getElementMap() {
    return elementMap;
  }

  function extractSnapshot(options) {
    var mode = (options && options.mode) || 'interactive';
    var maxElems = mode === 'reading' ? READING_MAX_INTERACTIVE : MAX_INTERACTIVE;
    var maxText = mode === 'reading' ? READING_MAX_VISIBLE_TEXT : MAX_VISIBLE_TEXT;
    var compactTextLimit = mode === 'reading' ? READING_COMPACT_TEXT_LIMIT : 2000;

    elementMap = new Map();
    const elements = collectInteractiveElements(maxElems);
    const dialogs = collectDialogs();
    const headings = collectHeadings();
    const landmarks = collectLandmarks();
    const notifications = collectNotifications();
    const visibleText = collectVisibleText(maxText);
    const focusedRef = findFocusedRef(elements);
    const scrollInfo = getScrollInfo();
    const pageInfo = {
      title: document.title,
      url: location.href,
      scrollTop: scrollInfo.scrollTop,
      scrollHeight: scrollInfo.scrollHeight,
      viewportHeight: scrollInfo.viewportHeight,
      scrollPercent: scrollInfo.scrollPercent,
    };

    const compact = buildCompactSnapshot(pageInfo, dialogs, headings, landmarks, notifications, elements, visibleText, focusedRef, compactTextLimit);

    return { compact };
  }

  // --- Scroll info ---

  function getScrollInfo() {
    const scrollTop = window.scrollY || document.documentElement.scrollTop || 0;
    const scrollHeight = Math.max(
      document.body.scrollHeight,
      document.documentElement.scrollHeight,
      document.body.offsetHeight,
      document.documentElement.offsetHeight
    );
    const viewportHeight = window.innerHeight;
    const maxScroll = scrollHeight - viewportHeight;
    const scrollPercent = maxScroll > 0 ? Math.round((scrollTop / maxScroll) * 100) : 0;

    return { scrollTop: Math.round(scrollTop), scrollHeight, viewportHeight, scrollPercent };
  }

  // --- Headings ---

  function collectHeadings() {
    const headings = [];
    const els = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
    for (const el of els) {
      if (!isVisible(el)) continue;
      const text = el.textContent?.trim().replace(/\s+/g, ' ').slice(0, 100);
      if (!text) continue;
      const level = parseInt(el.tagName[1]);
      headings.push({ level, text });
      if (headings.length >= 30) break;
    }
    return headings;
  }

  // --- Landmarks ---

  function collectLandmarks() {
    const landmarks = [];
    const selectors = [
      'nav', 'main', 'aside', 'header', 'footer',
      '[role="navigation"]', '[role="main"]', '[role="complementary"]',
      '[role="banner"]', '[role="contentinfo"]', '[role="search"]',
      '[role="form"]', '[role="region"]',
    ];
    for (const sel of selectors) {
      for (const el of document.querySelectorAll(sel)) {
        if (!isVisible(el)) continue;
        const label = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || '';
        const role = el.getAttribute('role') || el.tagName.toLowerCase();
        landmarks.push({ role, label: label.slice(0, 60) });
        if (landmarks.length >= 20) break;
      }
      if (landmarks.length >= 20) break;
    }
    return landmarks;
  }

  // --- Notifications / alerts / toasts ---

  function collectNotifications() {
    const notes = [];
    const selectors = [
      '[role="alert"]', '[role="alertdialog"]', '[role="status"]',
      '[role="log"]',
      '.toast', '.notification', '.snackbar',
      '[aria-live="polite"]', '[aria-live="assertive"]',
    ];
    const seen = new Set();
    for (const sel of selectors) {
      try {
        for (const el of document.querySelectorAll(sel)) {
          if (seen.has(el) || !isVisible(el)) continue;
          seen.add(el);
          const text = el.textContent?.trim().replace(/\s+/g, ' ').slice(0, 150);
          if (text && text.length > 3) {
            notes.push(text);
            if (notes.length >= 5) break;
          }
        }
      } catch { /* invalid selector on some pages */ }
      if (notes.length >= 5) break;
    }
    return notes;
  }

  // --- Interactive element collection ---

  function collectInteractiveElements(maxCount) {
    const limit = maxCount || MAX_INTERACTIVE;
    const selector = INTERACTIVE_SELECTORS.join(',');
    const candidates = document.querySelectorAll(selector);
    const elements = [];
    let ref = 1;

    for (const el of candidates) {
      if (ref > limit) break;
      if (!isActionable(el)) continue;

      const info = describeElement(el, ref);
      if (!info) continue;

      elementMap.set(ref, el);
      elements.push(info);
      ref++;
    }

    return elements;
  }

  function isActionable(el) {
    if (el.closest('#' + SKIP_HOST_ID)) return false;
    if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') return false;

    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    if (el.getAttribute('aria-hidden') === 'true') return false;
    if (el.disabled) return false;

    return true;
  }

  function isVisible(el) {
    if (el.closest('#' + SKIP_HOST_ID)) return false;
    if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') return false;
    const style = getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }

  function isInViewport(el) {
    const rect = el.getBoundingClientRect();
    return (
      rect.top < window.innerHeight &&
      rect.bottom > 0 &&
      rect.left < window.innerWidth &&
      rect.right > 0
    );
  }

  function describeElement(el, ref) {
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute('role') || inferRole(el);
    const label = computeLabel(el);
    if (!label && !role) return null;

    const info = { ref, tag, role };

    if (label) info.label = label.slice(0, MAX_LABEL_LENGTH);

    if (tag === 'input') {
      info.inputType = el.type || 'text';
      if (el.placeholder) info.placeholder = el.placeholder.slice(0, 80);
      if (el.type === 'password') {
        if (el.value) info.value = '••••••';
      } else if (el.value) {
        info.value = el.value.slice(0, 80);
      }
      const checkableType = el.type === 'checkbox' || el.type === 'radio';
      if (checkableType) info.checked = el.checked;
      if (el.required) info.required = true;
    }

    if (tag === 'textarea') {
      if (el.placeholder) info.placeholder = el.placeholder.slice(0, 80);
      if (el.value) info.value = el.value.slice(0, 120);
      if (el.required) info.required = true;
    }

    if (tag === 'select') {
      const selected = el.options[el.selectedIndex];
      if (selected) info.selectedOption = selected.textContent.trim().slice(0, 60);
      info.options = Array.from(el.options).slice(0, 20).map(o => o.textContent.trim().slice(0, 50));
      if (el.required) info.required = true;
    }

    if (tag === 'a' && el.href) {
      try {
        const url = new URL(el.href);
        if (url.origin !== location.origin) {
          info.href = el.href.slice(0, 100);
        } else {
          info.href = url.pathname.slice(0, 80);
        }
      } catch { /* ignore invalid URLs */ }
    }

    if (el.getAttribute('aria-expanded')) info.expanded = el.getAttribute('aria-expanded') === 'true';
    if (el.getAttribute('aria-pressed')) info.pressed = el.getAttribute('aria-pressed') === 'true';
    if (el.getAttribute('aria-selected')) info.selected = el.getAttribute('aria-selected') === 'true';
    if (el.getAttribute('aria-haspopup')) info.hasPopup = true;
    if (el.getAttribute('aria-controls')) info.controls = el.getAttribute('aria-controls').slice(0, 40);

    info.inViewport = isInViewport(el);

    const context = getElementContext(el);
    if (context) info.context = context;

    return info;
  }

  function getElementContext(el) {
    const parts = [];

    const form = el.closest('form');
    if (form) {
      const formLabel = form.getAttribute('aria-label') || form.getAttribute('name') || form.id || '';
      if (formLabel) parts.push('form:' + formLabel.slice(0, 40));
    }

    const landmark = el.closest('nav, main, aside, header, footer, [role="navigation"], [role="main"], [role="complementary"], [role="banner"], [role="contentinfo"], [role="search"]');
    if (landmark) {
      const lRole = landmark.getAttribute('role') || landmark.tagName.toLowerCase();
      const lLabel = landmark.getAttribute('aria-label') || '';
      parts.push(lLabel ? lRole + ':' + lLabel.slice(0, 30) : lRole);
    }

    const section = el.closest('section, [role="region"]');
    if (section) {
      const sLabel = section.getAttribute('aria-label') || section.getAttribute('aria-labelledby') || '';
      if (sLabel) parts.push('section:' + sLabel.slice(0, 30));
    }

    const closestHeading = findClosestHeading(el);
    if (closestHeading) parts.push('under:"' + closestHeading.slice(0, 40) + '"');

    return parts.length > 0 ? parts.join(', ') : null;
  }

  function findClosestHeading(el) {
    let node = el.previousElementSibling;
    for (let i = 0; i < 5 && node; i++) {
      if (/^H[1-6]$/.test(node.tagName)) {
        return node.textContent?.trim().replace(/\s+/g, ' ').slice(0, 50);
      }
      node = node.previousElementSibling;
    }

    let parent = el.parentElement;
    for (let i = 0; i < 5 && parent && parent !== document.body; i++) {
      let sibling = parent.previousElementSibling;
      for (let j = 0; j < 3 && sibling; j++) {
        if (/^H[1-6]$/.test(sibling.tagName)) {
          return sibling.textContent?.trim().replace(/\s+/g, ' ').slice(0, 50);
        }
        sibling = sibling.previousElementSibling;
      }
      parent = parent.parentElement;
    }

    return null;
  }

  function findFocusedRef(elements) {
    const active = document.activeElement;
    if (!active || active === document.body) return null;
    for (const el of elements) {
      if (elementMap.get(el.ref) === active) return el.ref;
    }
    return null;
  }

  function inferRole(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'a') return 'link';
    if (tag === 'button') return 'button';
    if (tag === 'input') {
      const type = el.type?.toLowerCase();
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      if (type === 'submit') return 'button';
      if (type === 'search') return 'searchbox';
      if (type === 'email') return 'textbox';
      if (type === 'password') return 'textbox';
      if (type === 'number') return 'spinbutton';
      if (type === 'range') return 'slider';
      if (type === 'tel') return 'textbox';
      if (type === 'url') return 'textbox';
      return 'textbox';
    }
    if (tag === 'textarea') return 'textbox';
    if (tag === 'select') return 'combobox';
    if (tag === 'summary') return 'button';
    if (tag === 'video') return 'video';
    if (tag === 'audio') return 'audio';
    if (el.contentEditable === 'true') return 'textbox';
    return null;
  }

  function computeLabel(el) {
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel.trim();

    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const parts = labelledBy.split(/\s+/).map(id => document.getElementById(id)?.textContent?.trim()).filter(Boolean);
      if (parts.length) return parts.join(' ');
    }

    if (el.id) {
      const assocLabel = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
      if (assocLabel) return assocLabel.textContent.trim();
    }

    const parentLabel = el.closest('label');
    if (parentLabel) {
      const labelText = getDirectText(parentLabel);
      if (labelText) return labelText;
    }

    const text = getDirectText(el);
    if (text) return text;

    if (el.title) return el.title.trim();
    if (el.alt) return el.alt.trim();
    if (el.placeholder) return el.placeholder.trim();
    if (el.name) return el.name;

    if (el.tagName === 'IMG' && el.src) return 'image';
    if (el.tagName === 'INPUT' && el.type) return el.type + ' input';

    return '';
  }

  const SKIP_TEXT_TAGS = new Set(['SVG', 'IMG']);

  function getDirectText(el) {
    let text = '';
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (SKIP_TEXT_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
        if (parent.getAttribute('aria-hidden') === 'true') return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    let node;
    while ((node = walker.nextNode()) && text.length < MAX_LABEL_LENGTH) {
      text += node.textContent;
    }
    return text.trim().replace(/\s+/g, ' ').slice(0, MAX_LABEL_LENGTH) || '';
  }

  // --- Dialogs ---

  function collectDialogs() {
    const dialogs = [];
    for (const d of document.querySelectorAll('dialog[open], [role="dialog"], [role="alertdialog"], [aria-modal="true"]')) {
      if (!isVisible(d)) continue;
      const title = d.querySelector('h1, h2, h3, h4, [role="heading"]')?.textContent?.trim().slice(0, 80) || '';
      const text = d.textContent?.trim().replace(/\s+/g, ' ').slice(0, 300);
      if (text) dialogs.push(title ? title + ': ' + text : text);
    }
    return dialogs;
  }

  // --- Visible text ---

  function collectVisibleText(maxLen) {
    const limit = maxLen || MAX_VISIBLE_TEXT;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (node.parentElement?.closest('#' + SKIP_HOST_ID)) return NodeFilter.FILTER_REJECT;
        if (SKIP_TAGS.has(node.parentElement?.tagName)) return NodeFilter.FILTER_REJECT;
        const text = node.textContent.trim();
        if (!text) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    let text = '';
    let node;
    while ((node = walker.nextNode()) && text.length < limit) {
      text += node.textContent.trim().replace(/\s+/g, ' ') + ' ';
    }
    return text.trim().slice(0, limit);
  }

  // --- Compact snapshot ---

  function buildCompactSnapshot(page, dialogs, headings, landmarks, notifications, elements, visibleText, focusedRef, compactTextLimit) {
    let s = 'PAGE: ' + page.title + ' | ' + page.url + '\n';
    s += 'SCROLL: ' + page.scrollPercent + '% (' + page.scrollTop + '/' + page.scrollHeight + 'px, viewport=' + page.viewportHeight + 'px)\n';

    if (focusedRef) {
      s += 'FOCUSED: [' + focusedRef + ']\n';
    }

    if (dialogs.length) {
      s += '\nDIALOGS:\n';
      for (const d of dialogs) s += '  ' + d.slice(0, 200) + '\n';
    }

    if (notifications.length) {
      s += '\nNOTIFICATIONS:\n';
      for (const n of notifications) s += '  ' + n + '\n';
    }

    if (headings.length) {
      s += '\nPAGE STRUCTURE:\n';
      for (const h of headings) {
        s += '  ' + '#'.repeat(h.level) + ' ' + h.text + '\n';
      }
    }

    if (landmarks.length) {
      s += '\nLANDMARKS: ' + landmarks.map(l => l.label ? l.role + '(' + l.label + ')' : l.role).join(', ') + '\n';
    }

    s += '\nELEMENTS:\n';
    for (const el of elements) {
      let line = '[' + el.ref + '] ' + (el.role || el.tag);
      if (el.label) line += ': "' + el.label + '"';
      if (el.inputType && el.inputType !== 'text') line += ' (' + el.inputType + ')';
      if (el.value) line += ' val="' + el.value + '"';
      if (el.placeholder) line += ' placeholder="' + el.placeholder + '"';
      if (el.checked !== undefined) line += el.checked ? ' [checked]' : ' [unchecked]';
      if (el.expanded !== undefined) line += el.expanded ? ' [expanded]' : ' [collapsed]';
      if (el.hasPopup) line += ' [has-popup]';
      if (el.pressed !== undefined) line += el.pressed ? ' [pressed]' : ' [not-pressed]';
      if (el.selected !== undefined) line += el.selected ? ' [selected]' : '';
      if (el.selectedOption) line += ' selected="' + el.selectedOption + '"';
      if (el.required) line += ' [required]';
      if (el.href) line += ' href="' + el.href + '"';
      if (el.context) line += ' {' + el.context + '}';
      if (!el.inViewport) line += ' [offscreen]';
      s += line + '\n';
    }

    const textExcerpt = visibleText.slice(0, compactTextLimit || 2000);
    if (textExcerpt) {
      s += '\nVISIBLE TEXT (excerpt):\n' + textExcerpt + '\n';
    }

    return s;
  }

  // --- Export ---

  window.__kiki = window.__kiki || {};
  window.__kiki.tree = {
    extractSnapshot,
    getElementByRef,
    getElementMap,
  };
})();
