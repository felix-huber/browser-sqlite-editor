/**
 * Debug logging utilities
 *
 * Controls verbose debug logging throughout the application.
 * Debug mode can be enabled via:
 * - URL parameter: ?debug=true
 * - localStorage: localStorage.setItem('DEBUG_MODE', 'true')
 *
 * By default, debug logging is disabled in production.
 */

/**
 * Check if debug mode is enabled (main thread only).
 * This checks both localStorage and URL parameters.
 */
function checkDebugMode(): boolean {
  // In worker context, window is undefined - use workerDebugEnabled instead
  if (typeof window === 'undefined') {
    return false;
  }

  try {
    // Check localStorage first
    if (localStorage.getItem('DEBUG_MODE') === 'true') {
      return true;
    }

    // Check URL parameter
    const params = new URLSearchParams(window.location.search);
    if (params.get('debug') === 'true' || params.has('debug')) {
      return true;
    }
  } catch {
    // localStorage or location might not be accessible in some contexts
  }

  return false;
}

/**
 * Whether debug mode is enabled (main thread).
 * Cached at module load time for performance.
 */
export const DEBUG = checkDebugMode();

/**
 * Log a debug message (main thread).
 * Only logs if DEBUG mode is enabled.
 *
 * @param args - Arguments to pass to console.log
 */
export function debugLog(...args: unknown[]): void {
  if (DEBUG) {
    console.log(...args);
  }
}

// =============================================================================
// Worker Debug Support
// =============================================================================

/**
 * Worker-side debug flag.
 * This is set via setWorkerDebugMode() when the worker receives a debug config message.
 */
let workerDebugEnabled = false;

/**
 * Set the debug mode for workers.
 * Called when the worker receives a configuration message from the main thread.
 *
 * @param enabled - Whether debug mode should be enabled
 */
export function setWorkerDebugMode(enabled: boolean): void {
  workerDebugEnabled = enabled;
}

/**
 * Check if worker debug mode is enabled.
 */
export function isWorkerDebugEnabled(): boolean {
  return workerDebugEnabled;
}

/**
 * Log a debug message (worker-safe).
 * Works in both main thread and worker contexts.
 * In main thread, uses DEBUG flag.
 * In worker, uses workerDebugEnabled flag.
 *
 * @param args - Arguments to pass to console.log
 */
export function workerDebugLog(...args: unknown[]): void {
  // In main thread context, use DEBUG
  if (typeof window !== 'undefined') {
    if (DEBUG) {
      console.log(...args);
    }
    return;
  }

  // In worker context, use workerDebugEnabled
  if (workerDebugEnabled) {
    console.log(...args);
  }
}
