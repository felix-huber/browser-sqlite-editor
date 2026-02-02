/**
 * SQLite Engine Wrapper
 *
 * Provides database opening functionality with OPFS-specific configuration.
 * Enforces PRAGMA journal_mode=DELETE for OPFS connections per PRD requirements.
 *
 * Key behaviors:
 * - OPFS mode: Sets journal_mode=DELETE to prevent WAL/SHM file creation
 * - IDB mode: Skips journal_mode PRAGMA (irrelevant for snapshot-based storage)
 */

import { getEngine } from '../core/engine/db-engine';
import { OPFS_VFS_NAME, ensureAppDirectories } from '../core/engine/opfs-vfs';
import { workerDebugLog } from '../shared/utils/debug';

// =============================================================================
// Types
// =============================================================================

/**
 * Options for opening a database
 */
export interface OpenDatabaseOptions {
  /** Open database in read-only mode */
  readOnly?: boolean;
  /** Create database file if it doesn't exist */
  createIfMissing?: boolean;
}

// =============================================================================
// Database Opening
// =============================================================================

/**
 * Open a database with storage-mode-appropriate configuration
 *
 * For OPFS connections:
 * - Sets PRAGMA journal_mode=DELETE to prevent WAL/SHM files
 * - Verifies the journal mode was set correctly
 *
 * For IDB connections:
 * - Skips journal_mode configuration (irrelevant for IDB snapshots)
 *
 * @param path Database path (OPFS full path or IDB name)
 * @param vfsName VFS to use (OPFS_VFS_NAME, IDB_VFS_NAME, or undefined)
 * @param options Open options
 * @throws Error if journal_mode fails to set to DELETE for OPFS
 */
export async function openDatabase(
  path: string,
  vfsName: string | undefined,
  options: OpenDatabaseOptions = {}
): Promise<void> {
  workerDebugLog('[openDatabase] Starting for path:', path, 'VFS:', vfsName);
  const engine = getEngine();

  // Initialize engine if needed
  if (!engine.isReady()) {
    workerDebugLog('[openDatabase] Engine not ready, initializing...');
    await engine.initialize();
    workerDebugLog('[openDatabase] Engine initialized');
  }

  // For OPFS mode, ensure directories exist before opening
  // This is critical after resetApp which deletes the OPFS directories
  if (vfsName === OPFS_VFS_NAME) {
    workerDebugLog('[openDatabase] Ensuring OPFS directories...');
    await ensureAppDirectories();
    workerDebugLog('[openDatabase] OPFS directories ensured');
  }

  // Open the database
  workerDebugLog('[openDatabase] Opening engine.open...');
  await engine.open(path, vfsName, {
    readOnly: options.readOnly ?? false,
    createIfMissing: options.createIfMissing ?? false,
  });
  workerDebugLog('[openDatabase] engine.open completed');

  // For OPFS connections, enforce journal_mode=DELETE
  if (vfsName === OPFS_VFS_NAME) {
    workerDebugLog('[openDatabase] Enforcing journal mode DELETE...');
    await enforceJournalModeDelete();
    workerDebugLog('[openDatabase] Journal mode set');
  }
  // IDB mode: journal_mode is irrelevant (snapshots serialize entire DB)
  // No VFS specified: legacy behavior, no journal_mode enforcement
}

/**
 * Enforce journal_mode=DELETE for the current database connection
 *
 * This prevents WAL (-wal) and SHM (-shm) files from being created,
 * which is required for OPFS mode per PRD requirements.
 *
 * @throws Error if journal_mode cannot be set to DELETE
 */
async function enforceJournalModeDelete(): Promise<void> {
  const engine = getEngine();

  // Set journal_mode to DELETE
  await engine.exec('PRAGMA journal_mode=DELETE');

  // Verify the setting took effect
  const result = await engine.query('PRAGMA journal_mode');

  if (result.rows.length === 0 || result.rows[0].length === 0) {
    throw new Error('Failed to set journal_mode=DELETE: no result from PRAGMA query');
  }

  const currentMode = String(result.rows[0][0]).toLowerCase();
  if (currentMode !== 'delete') {
    throw new Error(
      `Failed to set journal_mode=DELETE: current mode is '${currentMode}'. ` +
        'This may indicate the database was opened with WAL mode active or has uncommitted transactions.'
    );
  }
}

/**
 * Verify that the current database is using DELETE journal mode
 *
 * Use this to verify journal mode after writes to ensure no WAL files exist.
 *
 * @returns true if journal_mode is DELETE
 * @throws Error if engine is not ready
 */
export async function verifyJournalMode(): Promise<boolean> {
  const engine = getEngine();

  if (!engine.isReady()) {
    throw new Error('Engine not ready');
  }

  const result = await engine.query('PRAGMA journal_mode');

  if (result.rows.length === 0 || result.rows[0].length === 0) {
    return false;
  }

  const currentMode = String(result.rows[0][0]).toLowerCase();
  return currentMode === 'delete';
}
