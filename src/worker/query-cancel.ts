/**
 * Query Cancellation Module
 *
 * Provides query cancellation support via sqlite3_interrupt-like behavior
 * using the progress_handler mechanism. When a cancel request is received,
 * the progress handler returns non-zero, causing SQLite to abort with
 * SQLITE_INTERRUPT which maps to the 'CANCELED' error code.
 */

import type { WorkerErrorCode } from '../types';

// =============================================================================
// Types
// =============================================================================

/**
 * State for tracking cancellable queries
 */
interface QueryState {
  /** When the query started (for timeout tracking) */
  startTime: number;
  /** Whether cancellation has been requested */
  cancelRequested: boolean;
  /** Auto-cancel timeout in ms (0 = no auto-cancel) */
  autoTimeoutMs: number;
  /** Resolve function for the cancel promise */
  onCanceled?: () => void;
}

/**
 * Cancel request message format
 */
export interface CancelRequest {
  type: 'cancel';
  requestId?: string;
}

// =============================================================================
// State Management
// =============================================================================

/**
 * Map of requestId -> query state for tracking active queries
 */
const activeQueries = new Map<string, QueryState>();

/**
 * Default auto-cancel timeout in milliseconds (0 = disabled)
 */
let defaultAutoTimeoutMs = 0;

/**
 * Current request ID being executed (set by worker before query execution)
 */
let currentRequestId: string | null = null;

// =============================================================================
// Public API
// =============================================================================

/**
 * Register a query as cancellable before execution
 *
 * @param requestId Unique identifier for the request
 * @param autoTimeoutMs Optional auto-cancel timeout in ms (0 = use default)
 * @returns Cleanup function to call when query completes
 */
export function registerQuery(requestId: string, autoTimeoutMs?: number): () => void {
  const state: QueryState = {
    startTime: Date.now(),
    cancelRequested: false,
    autoTimeoutMs: autoTimeoutMs ?? defaultAutoTimeoutMs,
  };

  activeQueries.set(requestId, state);
  currentRequestId = requestId;

  // Return cleanup function
  return () => {
    activeQueries.delete(requestId);
    if (currentRequestId === requestId) {
      currentRequestId = null;
    }
  };
}

/**
 * Request cancellation of a running query
 *
 * @param requestId ID of the query to cancel (if undefined, cancels current query)
 * @returns Promise that resolves when cancellation is acknowledged or immediately if no such query
 */
export function requestCancellation(requestId?: string): Promise<void> {
  // If no requestId provided, try to cancel the current query
  const targetId = requestId ?? currentRequestId;

  if (!targetId) {
    // No query to cancel - no-op
    return Promise.resolve();
  }

  const state = activeQueries.get(targetId);
  if (!state) {
    // Query not found (already completed or never existed) - no-op
    return Promise.resolve();
  }

  if (state.cancelRequested) {
    // Already requested cancellation - return existing promise or resolve
    return Promise.resolve();
  }

  // Mark as cancel requested
  state.cancelRequested = true;

  // The progress handler will check this flag and return non-zero to trigger interrupt
  return Promise.resolve();
}

/**
 * Check if cancellation has been requested for the current or specified query
 *
 * This is called by the progress handler to determine whether to interrupt.
 *
 * @param requestId Optional specific request to check (defaults to current)
 * @returns true if cancellation was requested or auto-timeout exceeded
 */
export function isCancellationRequested(requestId?: string): boolean {
  const targetId = requestId ?? currentRequestId;

  if (!targetId) {
    return false;
  }

  const state = activeQueries.get(targetId);
  if (!state) {
    return false;
  }

  // Check explicit cancellation request
  if (state.cancelRequested) {
    return true;
  }

  // Check auto-timeout
  if (state.autoTimeoutMs > 0) {
    const elapsed = Date.now() - state.startTime;
    if (elapsed >= state.autoTimeoutMs) {
      state.cancelRequested = true; // Mark as canceled for consistency
      return true;
    }
  }

  return false;
}

/**
 * Check if a query with the given ID is currently active
 *
 * @param requestId Query ID to check
 * @returns true if the query is registered and running
 */
export function isQueryActive(requestId: string): boolean {
  return activeQueries.has(requestId);
}

/**
 * Get the current request ID being executed
 *
 * @returns Current request ID or null if no query is running
 */
export function getCurrentRequestId(): string | null {
  return currentRequestId;
}

/**
 * Set the default auto-cancel timeout for new queries
 *
 * @param timeoutMs Timeout in milliseconds (0 to disable)
 */
export function setDefaultAutoTimeout(timeoutMs: number): void {
  defaultAutoTimeoutMs = Math.max(0, timeoutMs);
}

/**
 * Get the default auto-cancel timeout
 *
 * @returns Current default timeout in milliseconds
 */
export function getDefaultAutoTimeout(): number {
  return defaultAutoTimeoutMs;
}

/**
 * Clear all active query registrations (for testing/reset)
 */
export function clearAllQueries(): void {
  activeQueries.clear();
  currentRequestId = null;
}

/**
 * Get count of active queries (for testing/debugging)
 */
export function getActiveQueryCount(): number {
  return activeQueries.size;
}

// =============================================================================
// Progress Handler
// =============================================================================

/**
 * Progress handler callback for SQLite
 *
 * This function is passed to sqlite3.progress_handler() and is called
 * periodically during query execution. Returning non-zero causes SQLite
 * to abort the query with SQLITE_INTERRUPT.
 *
 * @returns 0 to continue, non-zero to interrupt
 */
export function progressHandlerCallback(): number {
  return isCancellationRequested() ? 1 : 0;
}

// =============================================================================
// Error Code Mapping
// =============================================================================

/**
 * SQLite error code for interrupted queries
 */
export const SQLITE_INTERRUPT = 9;

/**
 * Check if an error code indicates a canceled query
 *
 * @param sqliteCode The SQLite error code
 * @returns true if this is an interrupt/cancellation error
 */
export function isInterruptError(sqliteCode: number): boolean {
  return sqliteCode === SQLITE_INTERRUPT;
}

/**
 * Map a SQLite error code to WorkerErrorCode, handling SQLITE_INTERRUPT
 *
 * @param sqliteCode The SQLite error code
 * @returns 'CANCELED' for interrupt errors, undefined for others
 */
export function mapInterruptError(sqliteCode: number): WorkerErrorCode | undefined {
  if (isInterruptError(sqliteCode)) {
    return 'CANCELED';
  }
  return undefined;
}
