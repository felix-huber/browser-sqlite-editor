/**
 * Database Export with Quota-Exceeded Handling
 *
 * Exports a transactionally consistent database snapshot via:
 * 1. VACUUM INTO (preferred, creates point-in-time snapshot)
 * 2. Direct file read fallback (when OPFS quota is exceeded)
 *
 * Features:
 * - Export succeeds even when OPFS quota is 0
 * - Progress reporting for large exports (>10MB)
 * - Cancel button support via AbortSignal
 * - Cleanup of partial artifacts on failure
 * - Never triggers partial downloads on failure
 *
 * Per PRD US-009:
 * - "Download Database" exports a transactionally consistent snapshot
 * - Quota exceeded: exports use direct file read (no additional OPFS/IDB writes)
 */

import { isStorageError } from './quota-errors';

// =============================================================================
// Types
// =============================================================================

/**
 * Progress information during export
 */
export interface ExportProgress {
  /** Progress percentage (0-100) */
  percent: number;
  /** Human-readable status message */
  message: string;
  /** Current phase of export */
  phase: 'preparing' | 'checkpointing' | 'writing' | 'reading' | 'complete';
  /** Bytes processed so far */
  bytesProcessed?: number;
  /** Total bytes to process */
  totalBytes?: number;
}

/**
 * Minimal engine interface for export
 */
export interface ExportEngine {
  isReady: () => boolean;
  getDbName: () => string | null;
  exec: (sql: string) => Promise<{ rowsAffected: number; lastInsertId: number }>;
}

/**
 * Options for database export
 */
export interface ExportOptions {
  /** Database engine instance */
  engine: ExportEngine;
  /** Storage adapter for OPFS/IDB operations */
  storageAdapter: ExportStorageAdapter;
  /** Progress callback for large exports */
  onProgress?: (progress: ExportProgress) => void;
  /** AbortSignal for cancellation */
  signal?: AbortSignal;
}

/**
 * Result of export operation
 */
export interface ExportResult {
  /** Whether export succeeded */
  success: boolean;
  /** Exported database bytes (undefined on failure) */
  data?: Uint8Array;
  /** Export method used */
  method?: 'vacuum_into' | 'direct_read';
  /** Error information on failure */
  error?: {
    code: string;
    message: string;
  };
}

/**
 * Storage adapter interface for export operations
 */
export interface ExportStorageAdapter {
  /** Check if OPFS is available */
  isOpfsAvailable: () => Promise<boolean>;
  /** Check if there's quota available for export temp file */
  hasQuotaForExport: () => Promise<boolean>;
  /** Read database file from storage (OPFS or IDB) */
  readDatabaseFile: (dbName: string) => Promise<Uint8Array>;
  /** Read export file from OPFS */
  readExportFile: (filename: string) => Promise<Uint8Array>;
  /** Delete export file from OPFS */
  deleteExportFile: (filename: string) => Promise<void>;
}

// =============================================================================
// Constants
// =============================================================================

/** Threshold for showing progress (10MB) */
const PROGRESS_THRESHOLD_BYTES = 10 * 1024 * 1024;

/** Export temp file prefix */
const EXPORT_FILE_PREFIX = '__export_';

// =============================================================================
// Export Implementation
// =============================================================================

/**
 * Generate a unique export filename
 */
function generateExportFilename(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 8);
  return `${EXPORT_FILE_PREFIX}${timestamp}_${random}.sqlite`;
}

/**
 * Check if an AbortSignal has been triggered
 */
function checkCanceled(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const error = new Error('Export canceled');
    (error as Error & { code: string }).code = 'CANCELED';
    throw error;
  }
}

/**
 * Report progress if callback is provided
 */
function reportProgress(
  onProgress: ((progress: ExportProgress) => void) | undefined,
  progress: ExportProgress
): void {
  if (onProgress) {
    onProgress(progress);
  }
}

/**
 * Export a database as a transactionally consistent snapshot.
 *
 * Strategy:
 * 1. If OPFS is available and has quota:
 *    - Use VACUUM INTO to create a temp file (point-in-time snapshot)
 *    - Read the file and return as Uint8Array
 *    - Clean up temp file
 *
 * 2. If OPFS quota is exceeded or unavailable:
 *    - Checkpoint any WAL changes first (best-effort)
 *    - Read the database file directly from storage
 *    - Return the file bytes (no additional writes required)
 *
 * This ensures exports always succeed even when storage is full.
 *
 * @param dbName - Database name to export
 * @param options - Export options
 * @returns Export result with data or error
 */
export async function exportDatabaseSnapshot(
  dbName: string,
  options: ExportOptions
): Promise<ExportResult> {
  const { engine, storageAdapter, onProgress, signal } = options;

  let exportFilename: string | null = null;

  try {
    // Check for cancellation before starting
    checkCanceled(signal);

    // Report initial progress
    reportProgress(onProgress, {
      percent: 0,
      message: 'Preparing export...',
      phase: 'preparing',
    });

    // Check if OPFS is available and has quota
    const opfsAvailable = await storageAdapter.isOpfsAvailable();
    const hasQuota = opfsAvailable && (await storageAdapter.hasQuotaForExport());

    checkCanceled(signal);

    // Strategy 1: VACUUM INTO (if OPFS has quota)
    if (hasQuota) {
      exportFilename = generateExportFilename();

      try {
        reportProgress(onProgress, {
          percent: 10,
          message: 'Creating snapshot via VACUUM INTO...',
          phase: 'writing',
        });

        // VACUUM INTO creates a point-in-time snapshot
        const exportPath = `/wasm-sqlite-editor/databases/${exportFilename}`;
        await engine.exec(`VACUUM INTO '${exportPath}'`);

        checkCanceled(signal);

        reportProgress(onProgress, {
          percent: 50,
          message: 'Reading export file...',
          phase: 'reading',
        });

        // Read the exported file
        const data = await storageAdapter.readExportFile(exportFilename);

        checkCanceled(signal);

        // Clean up temp file
        await storageAdapter.deleteExportFile(exportFilename);
        exportFilename = null;

        reportProgress(onProgress, {
          percent: 100,
          message: 'Export complete',
          phase: 'complete',
          bytesProcessed: data.length,
          totalBytes: data.length,
        });

        return {
          success: true,
          data,
          method: 'vacuum_into',
        };
      } catch (err) {
        // Clean up temp file on failure
        if (exportFilename) {
          try {
            await storageAdapter.deleteExportFile(exportFilename);
          } catch {
            // Ignore cleanup errors
          }
          exportFilename = null;
        }

        // Check if this is a cancellation
        if (
          err instanceof Error &&
          (err as Error & { code?: string }).code === 'CANCELED'
        ) {
          throw err;
        }

        // If it's a quota/storage error, fall through to direct read path
        if (!isStorageError(err)) {
          throw err;
        }

        // Fall through to direct file read
      }
    }

    // Strategy 2: Direct file read (when OPFS quota is exceeded or unavailable)
    // This path requires NO additional writes to storage
    checkCanceled(signal);

    reportProgress(onProgress, {
      percent: 20,
      message: 'Checkpointing WAL changes...',
      phase: 'checkpointing',
    });

    // Best-effort checkpoint to include any WAL changes
    try {
      await engine.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    } catch {
      // Continue even if checkpoint fails - export will still have consistent data
    }

    checkCanceled(signal);

    reportProgress(onProgress, {
      percent: 40,
      message: 'Reading database file...',
      phase: 'reading',
    });

    // Read the database file directly from storage
    const data = await storageAdapter.readDatabaseFile(dbName);

    checkCanceled(signal);

    // Report progress for large exports
    const shouldShowProgress = data.length > PROGRESS_THRESHOLD_BYTES;
    if (shouldShowProgress) {
      reportProgress(onProgress, {
        percent: 90,
        message: 'Finalizing export...',
        phase: 'reading',
        bytesProcessed: data.length,
        totalBytes: data.length,
      });
    }

    reportProgress(onProgress, {
      percent: 100,
      message: 'Export complete',
      phase: 'complete',
      bytesProcessed: data.length,
      totalBytes: data.length,
    });

    return {
      success: true,
      data,
      method: 'direct_read',
    };
  } catch (err) {
    // Clean up any temp files
    if (exportFilename) {
      try {
        await storageAdapter.deleteExportFile(exportFilename);
      } catch {
        // Ignore cleanup errors
      }
    }

    // Handle cancellation
    if (
      err instanceof Error &&
      (err as Error & { code?: string }).code === 'CANCELED'
    ) {
      return {
        success: false,
        error: {
          code: 'CANCELED',
          message: 'Export was canceled',
        },
      };
    }

    // Handle other errors
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: {
        code: 'EXPORT_FAILED',
        message: `Export failed: ${message}`,
      },
    };
  }
}
