// Element Label Overlay
// Shows numbered badges on interactive elements so the user can say "click number 5".

(function () {
  'use strict';

  var badges = [];
  var visible = false;
  var scrollHandler = null;

  function showLabels() {
    hideLabels();
    var map = window.__kiki.tree.getElementMap();
    if (map.size === 0) return;

    visible = true;

    map.forEach(function (el, ref) {
      var rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return;

      var badge = document.createElement('div');
      badge.className = 'kiki-label-badge';
      badge.textContent = String(ref);
      badge.style.left = (window.scrollX + rect.left - 4) + 'px';
      badge.style.top = (window.scrollY + rect.top - 10) + 'px';

      document.body.appendChild(badge);
      badges.push(badge);
    });

    scrollHandler = function () { hideLabels(); };
    window.addEventListener('scroll', scrollHandler, { once: true, passive: true });
    window.addEventListener('resize', scrollHandler, { once: true, passive: true });
  }

  function hideLabels() {
    for (var i = 0; i < badges.length; i++) {
      badges[i].remove();
    }
    badges = [];
    if (visible && scrollHandler) {
      window.removeEventListener('scroll', scrollHandler);
      window.removeEventListener('resize', scrollHandler);
      scrollHandler = null;
    }
    visible = false;
  }

  function areLabelsVisible() {
    return visible;
  }

  window.__kiki = window.__kiki || {};
  window.__kiki.labels = {
    showLabels,
    hideLabels,
    areLabelsVisible,
  };
})();
