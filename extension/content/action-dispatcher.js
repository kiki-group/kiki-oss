// Action Dispatcher
// Receives actions from the service worker and executes them.
// Includes retry logic, DOM settle detection, and element re-resolution.

(function () {
  'use strict';

  let cancelled = false;

  async function dispatchAction(action, options) {
    cancelled = false;

    if (!action?.action) {
      return { ok: false, error: 'No action type specified' };
    }

    const executor = window.__kiki.executors[action.action];
    if (!executor) {
      return { ok: false, error: 'Unknown action type: ' + action.action };
    }

    const quick = options && options.quick;

    try {
      let result = await Promise.resolve(executor(action.target, action.params));

      if (cancelled) return { ok: false, error: 'Cancelled' };

      if (!result.ok && isElementNotFound(result.error) && action.target) {
        window.__kiki.tree.extractSnapshot();
        await sleep(200);
        result = await Promise.resolve(executor(action.target, action.params));
        if (cancelled) return { ok: false, error: 'Cancelled' };
      }

      if (!result.ok) return result;

      if (result.navigating) {
        return { ok: true, navigating: true };
      }

      if (quick) {
        return { ok: true };
      }

      await waitForDOMSettled(3000, 100);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  function isElementNotFound(error) {
    return error && typeof error === 'string' && error.startsWith('Element not found');
  }

  function cancelAll() {
    cancelled = true;
  }

  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function waitForDOMSettled(timeoutMs, quietMs) {
    timeoutMs = timeoutMs || 3000;
    quietMs = quietMs || 300;

    return new Promise(function (resolve) {
      var timer = null;
      var settled = false;
      var mutationCount = 0;

      function done() {
        if (settled) return;
        settled = true;
        observer.disconnect();
        resolve();
      }

      var observer = new MutationObserver(function (mutations) {
        mutationCount += mutations.length;
        if (timer) clearTimeout(timer);

        if (mutationCount > 500) {
          done();
          return;
        }

        timer = setTimeout(done, quietMs);
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true,
      });

      timer = setTimeout(done, quietMs);
      setTimeout(done, timeoutMs);
    });
  }

  window.__kiki = window.__kiki || {};
  window.__kiki.dispatcher = {
    dispatchAction,
    cancelAll,
  };
  window.__kiki.waitForDOMSettled = waitForDOMSettled;
})();
