// Offline page functionality - CSP compliant (no inline scripts)

function handleRetry() {
  if (navigator.onLine) {
    window.location.reload();
  }
}

document.addEventListener('DOMContentLoaded', function() {
  const retryButton = document.getElementById('retry-button');
  if (retryButton) {
    retryButton.addEventListener('click', handleRetry);
  }
});

window.addEventListener('online', function() {
  window.location.reload();
});
