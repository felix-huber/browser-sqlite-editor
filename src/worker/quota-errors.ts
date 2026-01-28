/**
 * Quota/Storage Error Detection and Normalization
 *
 * Provides standardized detection and handling for storage-related errors:
 * - OPFS: QuotaExceededError on file write operations
 * - IndexedDB: QuotaExceededError on store.put() operations
 * - SQLite: SQLITE_FULL (disk full) and SQLITE_IOERR_WRITE
 * - Network: AbortError due to storage pressure
 *
 * All storage errors are normalized to WorkerResponse.code = "QUOTA_EXCEEDED"
 */

import type { WorkerErrorCode } from '../types';

// =============================================================================
// Types
// =============================================================================

/**
 * Normalized storage error with details
 */
export interface StorageError {
  /** Always QUOTA_EXCEEDED for storage errors */
  code: WorkerErrorCode;
  /** Human-readable error message */
  message: string;
  /** Original error type for debugging */
  originalType: string;
  /** Original error for stack trace */
  cause?: unknown;
  /** Estimated storage info if available */
  storageInfo?: StorageEstimate;
}

/**
 * Storage estimate from navigator.storage.estimate()
 */
export interface StorageEstimate {
  /** Total quota in bytes */
  quota?: number;
  /** Used storage in bytes */
  usage?: number;
  /** Available storage in bytes (quota - usage) */
  available?: number;
}

/**
 * Storage check result for proactive validation
 */
export interface StorageCheckResult {
  /** Whether there's sufficient storage */
  ok: boolean;
  /** Warning message if storage is low */
  warning?: string;
  /** Error message if storage is insufficient */
  error?: string;
  /** Storage estimate */
  estimate?: StorageEstimate;
}

// =============================================================================
// Error Detection
// =============================================================================

/**
 * SQLite error codes that indicate storage issues
 */
const SQLITE_STORAGE_ERRORS = [
  'SQLITE_FULL',       // Disk full
  'SQLITE_IOERR_WRITE', // I/O error on write
  'SQLITE_IOERR_FSYNC', // I/O error on fsync
  'SQLITE_IOERR_DIR_FSYNC', // I/O error on directory fsync
  'SQLITE_IOERR_TRUNCATE', // I/O error on truncate
  'SQLITE_CANTOPEN',    // Unable to open file (may be due to quota)
] as const;

/**
 * Check if error is a QuotaExceededError (OPFS or IndexedDB)
 */
export function isQuotaExceededError(err: unknown): boolean {
  if (err instanceof DOMException) {
    return err.name === 'QuotaExceededError';
  }
  return false;
}

/**
 * Check if error is an AbortError due to storage pressure
 */
export function isStorageAbortError(err: unknown): boolean {
  if (err instanceof DOMException) {
    // AbortError can occur due to storage pressure during file operations
    return err.name === 'AbortError';
  }
  return false;
}

/**
 * Check if error is a SQLite storage error
 */
export function isSqliteStorageError(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message.toUpperCase();
    return SQLITE_STORAGE_ERRORS.some((code) => msg.includes(code));
  }
  if (typeof err === 'string') {
    const msg = err.toUpperCase();
    return SQLITE_STORAGE_ERRORS.some((code) => msg.includes(code));
  }
  return false;
}

/**
 * Check if error is any type of storage/quota error
 */
export function isStorageError(err: unknown): boolean {
  return (
    isQuotaExceededError(err) ||
    isStorageAbortError(err) ||
    isSqliteStorageError(err)
  );
}

/**
 * Get the original error type for debugging
 */
function getOriginalErrorType(err: unknown): string {
  if (err instanceof DOMException) {
    return `DOMException:${err.name}`;
  }
  if (err instanceof Error) {
    // Check for SQLite errors
    const msg = err.message.toUpperCase();
    for (const code of SQLITE_STORAGE_ERRORS) {
      if (msg.includes(code)) {
        return `SQLite:${code}`;
      }
    }
    return err.constructor.name;
  }
  return typeof err;
}

// =============================================================================
// Error Normalization
// =============================================================================

/**
 * Normalize any storage error to a standardized StorageError
 */
export function normalizeStorageError(
  err: unknown,
  operation: string,
  storageInfo?: StorageEstimate
): StorageError {
  const originalType = getOriginalErrorType(err);
  let message: string;

  if (isQuotaExceededError(err)) {
    message = `Storage quota exceeded during ${operation}. Please free up space and try again.`;
  } else if (isStorageAbortError(err)) {
    message = `Operation aborted due to storage pressure during ${operation}. Please free up space and try again.`;
  } else if (isSqliteStorageError(err)) {
    message = `Database storage error during ${operation}. The disk may be full.`;
  } else {
    message = `Storage error during ${operation}: ${err instanceof Error ? err.message : String(err)}`;
  }

  return {
    code: 'QUOTA_EXCEEDED',
    message,
    originalType,
    cause: err,
    storageInfo,
  };
}

// =============================================================================
// Storage State Management
// =============================================================================

/**
 * Global storage state for the worker
 */
interface StorageState {
  /** Whether storage is full (blocks writes) */
  storageFull: boolean;
  /** Last known storage estimate */
  lastEstimate?: StorageEstimate;
  /** Databases in write-blocked state */
  blockedDatabases: Set<string>;
}

const state: StorageState = {
  storageFull: false,
  lastEstimate: undefined,
  blockedDatabases: new Set(),
};

/**
 * Get whether storage is currently full
 */
export function isStorageFull(): boolean {
  return state.storageFull;
}

/**
 * Set storage full flag (called after quota error)
 */
export function setStorageFull(full: boolean): void {
  state.storageFull = full;
  if (!full) {
    state.blockedDatabases.clear();
  }
}

/**
 * Mark a specific database as write-blocked
 */
export function blockDatabaseWrites(dbName: string): void {
  state.blockedDatabases.add(dbName);
  state.storageFull = true;
}

/**
 * Check if a specific database is write-blocked
 */
export function isDatabaseWriteBlocked(dbName: string): boolean {
  return state.blockedDatabases.has(dbName) || state.storageFull;
}

/**
 * Clear write-block for a specific database (e.g., after user frees space)
 */
export function unblockDatabaseWrites(dbName: string): void {
  state.blockedDatabases.delete(dbName);
  if (state.blockedDatabases.size === 0) {
    state.storageFull = false;
  }
}

/**
 * Get list of blocked databases
 */
export function getBlockedDatabases(): string[] {
  return Array.from(state.blockedDatabases);
}

// =============================================================================
// Proactive Storage Checks
// =============================================================================

/**
 * Get current storage estimate
 *
 * Uses navigator.storage.estimate() to get quota/usage info.
 * Returns undefined if storage API is not available.
 */
export async function getStorageEstimate(): Promise<StorageEstimate | undefined> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.estimate) {
      return undefined;
    }
    const estimate = await navigator.storage.estimate();
    const result: StorageEstimate = {
      quota: estimate.quota,
      usage: estimate.usage,
      available:
        estimate.quota !== undefined && estimate.usage !== undefined
          ? estimate.quota - estimate.usage
          : undefined,
    };
    state.lastEstimate = result;
    return result;
  } catch {
    return undefined;
  }
}

/**
 * Check if there's sufficient storage for an operation
 *
 * @param requiredBytes - Estimated bytes needed for the operation
 * @param safetyFactor - Multiplier for required bytes (default 1.5)
 * @returns StorageCheckResult with ok/warning/error
 */
export async function checkStorageAvailable(
  requiredBytes: number,
  safetyFactor = 1.5
): Promise<StorageCheckResult> {
  const estimate = await getStorageEstimate();

  if (!estimate || estimate.available === undefined) {
    // Can't check storage, proceed with caution
    return {
      ok: true,
      warning: 'Unable to check available storage. Proceeding with operation.',
      estimate,
    };
  }

  const safeRequired = requiredBytes * safetyFactor;

  // If storage is already marked as full, reject
  if (state.storageFull) {
    return {
      ok: false,
      error: 'Storage is full. Please free up space before proceeding.',
      estimate,
    };
  }

  // Insufficient storage - reject
  if (estimate.available < requiredBytes) {
    const availableMB = Math.round(estimate.available / (1024 * 1024));
    const requiredMB = Math.round(requiredBytes / (1024 * 1024));
    return {
      ok: false,
      error: `Insufficient storage: ${availableMB}MB available, ${requiredMB}MB required.`,
      estimate,
    };
  }

  // Low storage - warn but allow
  if (estimate.available < safeRequired) {
    const availableMB = Math.round(estimate.available / (1024 * 1024));
    const recommendedMB = Math.round(safeRequired / (1024 * 1024));
    return {
      ok: true,
      warning: `Low storage: ${availableMB}MB available. Recommended: ${recommendedMB}MB for safe operation.`,
      estimate,
    };
  }

  // Sufficient storage
  return {
    ok: true,
    estimate,
  };
}

/**
 * Format storage estimate for display
 */
export function formatStorageEstimate(estimate: StorageEstimate): string {
  const parts: string[] = [];

  if (estimate.usage !== undefined) {
    const usedMB = Math.round(estimate.usage / (1024 * 1024));
    parts.push(`Used: ${usedMB}MB`);
  }

  if (estimate.available !== undefined) {
    const availableMB = Math.round(estimate.available / (1024 * 1024));
    parts.push(`Available: ${availableMB}MB`);
  }

  if (estimate.quota !== undefined) {
    const quotaMB = Math.round(estimate.quota / (1024 * 1024));
    parts.push(`Quota: ${quotaMB}MB`);
  }

  return parts.join(', ') || 'Storage info unavailable';
}

// =============================================================================
// Error Handler Wrapper
// =============================================================================

/**
 * Wrap an async operation with storage error detection
 *
 * If a storage error occurs, it will:
 * 1. Normalize the error to StorageError
 * 2. Set the storageFull flag
 * 3. Optionally block writes for a specific database
 *
 * @param operation - Async operation to wrap
 * @param operationName - Name for error messages
 * @param dbName - Optional database name to block on error
 */
export async function withStorageErrorHandling<T>(
  operation: () => Promise<T>,
  operationName: string,
  dbName?: string
): Promise<T> {
  try {
    return await operation();
  } catch (err) {
    if (isStorageError(err)) {
      const estimate = await getStorageEstimate();
      const storageError = normalizeStorageError(err, operationName, estimate);

      // Set global storage full flag
      setStorageFull(true);

      // Block specific database if provided
      if (dbName) {
        blockDatabaseWrites(dbName);
      }

      throw storageError;
    }
    // Re-throw non-storage errors
    throw err;
  }
}

// =============================================================================
// Reset for Testing
// =============================================================================

/**
 * Reset storage state (for testing only)
 */
export function _resetStorageState(): void {
  state.storageFull = false;
  state.lastEstimate = undefined;
  state.blockedDatabases.clear();
}

// =============================================================================
// Exports for Testing
// =============================================================================

export const _testing = {
  SQLITE_STORAGE_ERRORS,
  getOriginalErrorType,
  state: () => ({ ...state, blockedDatabases: new Set(state.blockedDatabases) }),
};
