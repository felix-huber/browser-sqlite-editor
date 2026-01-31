/* global window, document, navigator */
(function() {
  'use strict';

  function handleRetry() {
    if (navigator.onLine) {
      window.location.reload();
    }
  }

  var retryBtn = document.getElementById('retry-btn');
  if (retryBtn) {
    retryBtn.addEventListener('click', handleRetry);
  }

  window.addEventListener('online', function() {
    window.location.reload();
  });
})();
