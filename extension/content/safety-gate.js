// Safety Gate
// Classifies vocal confirmations / cancellations for destructive actions.

(function () {
  'use strict';

  var CONFIRM_WORDS = [
    'yes', 'yeah', 'yep', 'yup', 'confirm', 'do it', 'go ahead',
    'proceed', 'ok', 'okay', 'sure', 'affirmative', 'approve',
  ];

  var CANCEL_WORDS = [
    'no', 'nope', 'cancel', 'stop', 'abort', 'never mind',
    'negative', 'wait', 'hold on', "don't", 'do not',
  ];

  function matchesWord(phrase, word) {
    if (phrase === word) return true;
    var re = new RegExp('\\b' + word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b');
    return re.test(phrase);
  }

  function classifyConfirmation(transcript) {
    var lower = transcript.toLowerCase().trim();

    // Check cancel FIRST — "don't" contains "do" so cancel must take priority
    for (var j = 0; j < CANCEL_WORDS.length; j++) {
      if (matchesWord(lower, CANCEL_WORDS[j])) return 'cancel';
    }

    for (var i = 0; i < CONFIRM_WORDS.length; i++) {
      if (matchesWord(lower, CONFIRM_WORDS[i])) return 'confirm';
    }

    return null;
  }

  window.__kiki = window.__kiki || {};
  window.__kiki.safety = {
    classifyConfirmation,
  };
})();
