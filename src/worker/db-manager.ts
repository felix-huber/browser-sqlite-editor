/**
 * Database Manager with Single-Writer Lock Enforcement
 *
 * Coordinates Web Locks and SQLite database opening to enforce single-writer
 * guarantee at the engine level (not just UI). When another tab holds the
 * write lock, the database is opened with SQLITE_OPEN_READONLY flag.
 *
 * Key behaviors:
 * - Acquires Web Lock before opening database for write
 * - Falls back to read-only mode when write lock unavailable
 * - Provides heartbeat mechanism for lock holder detection
 * - Reports lock status for UI indication
 */

import { openDatabase, type OpenDatabaseOptions } from './sqlite-engine';
import { getLockManager, type WebLockManager, type LockAcquisitionResult } from './web-locks';
import { getEngine } from '../core/engine/db-engine';

// =============================================================================
// Types
// =============================================================================

/**
 * Result of opening a database with lock coordination
 */
export interface OpenWithLockResult {
  /** Whether the database was opened successfully */
  success: boolean;
  /** Whether this tab is the writer (holds the lock) */
  isWriter: boolean;
  /** Whether the lock holder appears stale (for potential takeover) */
  holderStale: boolean;
  /** Error message if open failed */
  error?: string;
}

/**
 * Options for opening a database with lock coordination
 */
export interface OpenWithLockOptions {
  /** VFS name to use for the database connection */
  vfsName?: string;
  /** Create the database file if it doesn't exist */
  createIfMissing?: boolean;
  /** Force read-only mode regardless of lock status */
  forceReadOnly?: boolean;
}

/**
 * Database manager adapter for dependency injection in tests
 */
export interface DatabaseManagerAdapter {
  lockManager: WebLockManager;
  openDatabase: typeof openDatabase;
}

// =============================================================================
// Default Adapter
// =============================================================================

const defaultAdapter: DatabaseManagerAdapter = {
  get lockManager() {
    return getLockManager();
  },
  openDatabase,
};

// =============================================================================
// Module State
// =============================================================================

let _adapter: DatabaseManagerAdapter = defaultAdapter;
let _currentDbId: string | null = null;
let _isWriter: boolean = false;

// =============================================================================
// Public API
// =============================================================================

/**
 * Open a database with single-writer lock coordination
 *
 * This function:
 * 1. Attempts to acquire an exclusive Web Lock for the database
 * 2. Opens the database with readOnly=true if lock acquisition fails
 * 3. Opens the database with readOnly=false if lock is acquired
 *
 * @param dbId Database identifier (used for lock naming)
 * @param path Database file path
 * @param options Open options
 * @returns Result indicating writer status and any errors
 */
export async function openDatabaseWithLock(
  dbId: string,
  path: string,
  options: OpenWithLockOptions = {}
): Promise<OpenWithLockResult> {
  const { vfsName, createIfMissing = false, forceReadOnly = false } = options;

  // If forcing read-only, skip lock acquisition
  if (forceReadOnly) {
    try {
      await _adapter.openDatabase(path, vfsName, {
        readOnly: true,
        createIfMissing: false, // Never create in read-only mode
      });
      _currentDbId = dbId;
      _isWriter = false;
      return { success: true, isWriter: false, holderStale: false };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, isWriter: false, holderStale: false, error: message };
    }
  }

  // Attempt to acquire the write lock
  let lockResult: LockAcquisitionResult;
  try {
    lockResult = await _adapter.lockManager.acquireLock(dbId);
  } catch (err) {
    // Lock acquisition failed unexpectedly - open in read-only mode
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[db-manager] Lock acquisition failed for ${dbId}: ${message}`);
    lockResult = { acquired: false, holderId: null, holderStale: false };
  }

  // Determine open options based on lock result
  const readOnly = !lockResult.acquired;
  const openOptions: OpenDatabaseOptions = {
    readOnly,
    // Only allow create if we have write access
    createIfMissing: !readOnly && createIfMissing,
  };

  try {
    await _adapter.openDatabase(path, vfsName, openOptions);
    _currentDbId = dbId;
    _isWriter = lockResult.acquired;

    return {
      success: true,
      isWriter: lockResult.acquired,
      holderStale: lockResult.holderStale,
    };
  } catch (err) {
    // If write open failed, try read-only as fallback
    if (!readOnly) {
      try {
        await _adapter.openDatabase(path, vfsName, {
          readOnly: true,
          createIfMissing: false,
        });
        _currentDbId = dbId;
        _isWriter = false;

        // Release the lock since we couldn't use it
        try {
          await _adapter.lockManager.releaseLock(dbId);
        } catch {
          // Ignore release errors
        }

        return {
          success: true,
          isWriter: false,
          holderStale: lockResult.holderStale,
        };
      } catch (fallbackErr) {
        const message = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
        return { success: false, isWriter: false, holderStale: false, error: message };
      }
    }

    const message = err instanceof Error ? err.message : String(err);
    return { success: false, isWriter: false, holderStale: lockResult.holderStale, error: message };
  }
}

/**
 * Close the current database and release any held lock
 */
export async function closeDatabaseWithLock(): Promise<void> {
  // Close the SQLite connection first
  try {
    const engine = getEngine();
    await engine.close();
  } catch {
    // Ignore close errors
  }

  // Release the lock if we hold it
  if (_currentDbId && _isWriter) {
    try {
      await _adapter.lockManager.releaseLock(_currentDbId);
    } catch {
      // Ignore release errors
    }
  }
  _currentDbId = null;
  _isWriter = false;
}

/**
 * Check if the current connection is in writer mode
 */
export function isWriter(): boolean {
  return _isWriter;
}

/**
 * Get the current database ID
 */
export function getCurrentDbId(): string | null {
  return _currentDbId;
}

/**
 * Query the lock status for a database
 *
 * @param dbId Database identifier
 * @returns Lock status including holder info and staleness
 */
export async function queryLockStatus(dbId: string): Promise<{
  isLocked: boolean;
  holderId: string | null;
  isStale: boolean;
}> {
  const status = await _adapter.lockManager.queryLockStatus(dbId);
  return {
    isLocked: status.isLocked,
    holderId: status.holderId,
    isStale: status.isStale,
  };
}

/**
 * Attempt to upgrade from read-only to writer mode
 *
 * This can be called when the user wants to take over writing
 * (e.g., when they detect the previous writer is stale).
 *
 * @param dbId Database identifier
 * @param path Database file path
 * @param vfsName VFS name
 * @returns Result of the upgrade attempt
 */
export async function upgradeToWriter(
  dbId: string,
  path: string,
  vfsName?: string
): Promise<OpenWithLockResult> {
  // Close current connection first
  await closeDatabaseWithLock();

  // Try to open with write access
  return openDatabaseWithLock(dbId, path, { vfsName, createIfMissing: false });
}

// =============================================================================
// Testing Utilities
// =============================================================================

/**
 * Set the adapter for testing
 */
export function setAdapter(adapter: Partial<DatabaseManagerAdapter>): void {
  _adapter = { ...defaultAdapter, ...adapter };
}

/**
 * Reset to default adapter
 */
export function resetAdapter(): void {
  _adapter = defaultAdapter;
  _currentDbId = null;
  _isWriter = false;
}

/**
 * Get current adapter (for test inspection)
 */
export function getAdapter(): DatabaseManagerAdapter {
  return _adapter;
}

// =============================================================================
// Exports for testing
// =============================================================================

export const _testing = {
  get currentDbId() {
    return _currentDbId;
  },
  get isWriter() {
    return _isWriter;
  },
  resetState: () => {
    _currentDbId = null;
    _isWriter = false;
  },
};
