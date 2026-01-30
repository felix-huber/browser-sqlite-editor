/**
 * IndexedDB Storage for SQLite Database Persistence
 *
 * Provides an IndexedDB-backed storage layer as a fallback when OPFS is unavailable.
 * Features:
 * - Store/retrieve database blobs keyed by name
 * - Debounced flush (2s idle) to batch writes
 * - Explicit flush API for switch/close scenarios
 * - Retry with exponential backoff on write failures (3 attempts)
 *
 * Store structure:
 * - Database: "idb-sqlite"
 * - Object store: "databases" (keyed by database name)
 */

import type { WorkerErrorCode } from '../types';
import { isStorageError, setStorageFull } from './quota-errors';

// =============================================================================
// FlushAndClose Types
// =============================================================================

/**
 * Result of flushAndClose operation
 */
export interface FlushAndCloseResult {
  success: boolean;
  error?: FlushAndCloseError;
}

/**
 * Error from flushAndClose operation - deterministic for UI prompt
 */
export interface FlushAndCloseError {
  code: 'IDB_FLUSH_FAILED' | 'QUOTA_EXCEEDED';
  message: string;
  /** Number of attempts made before failure */
  attempts: number;
  cause?: unknown;
}

// =============================================================================
// Constants
// =============================================================================

/** IndexedDB database name for SQLite storage */
const IDB_DATABASE_NAME = 'idb-sqlite';

/** Object store name for database blobs */
const IDB_STORE_NAME = 'databases';

/** IndexedDB schema version */
const IDB_VERSION = 1;

/** Debounce delay for flush (2 seconds) */
const DEBOUNCE_DELAY_MS = 2000;

/** Maximum retry attempts for IDB operations */
const MAX_RETRY_ATTEMPTS = 3;

/** Base delay for exponential backoff (ms) */
const BASE_BACKOFF_MS = 100;

// =============================================================================
// Types
// =============================================================================

/**
 * Stored database entry in IndexedDB
 */
export interface StoredDatabase {
  /** Database name (primary key) */
  name: string;
  /** SQLite database file as blob */
  blob: Blob;
  /** Last modified timestamp (ISO 8601) */
  updatedAt: string;
}

/**
 * Persistence error with code and message
 */
export interface PersistenceError {
  code: WorkerErrorCode;
  message: string;
  cause?: unknown;
}

/**
 * Flush result
 */
export interface FlushResult {
  success: boolean;
  error?: PersistenceError;
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calculate backoff delay for retry attempt (exponential with jitter)
 */
function getBackoffDelay(attempt: number): number {
  const exponentialDelay = BASE_BACKOFF_MS * Math.pow(2, attempt);
  // Add jitter: 0-50% of delay
  const jitter = Math.random() * 0.5 * exponentialDelay;
  return exponentialDelay + jitter;
}

/**
 * Normalize IDB error to PersistenceError
 */
function normalizeIDBError(err: unknown, operation: string): PersistenceError {
  if (err instanceof DOMException) {
    if (err.name === 'QuotaExceededError') {
      return {
        code: 'QUOTA_EXCEEDED',
        message: `Storage quota exceeded during ${operation}`,
        cause: err,
      };
    }
    if (err.name === 'NotFoundError') {
      return {
        code: 'NOT_FOUND',
        message: `Database not found during ${operation}`,
        cause: err,
      };
    }
  }

  if (err instanceof Error) {
    return {
      code: 'PERSISTENCE_FAILED',
      message: `${operation} failed: ${err.message}`,
      cause: err,
    };
  }

  return {
    code: 'PERSISTENCE_FAILED',
    message: `${operation} failed: ${String(err)}`,
    cause: err,
  };
}

// =============================================================================
// IndexedDB Operations (with retry)
// =============================================================================

/**
 * Open the IndexedDB database
 */
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_DATABASE_NAME, IDB_VERSION);

    request.onerror = () => {
      reject(normalizeIDBError(request.error, 'openDatabase'));
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // Create object store if it doesn't exist
      if (!db.objectStoreNames.contains(IDB_STORE_NAME)) {
        db.createObjectStore(IDB_STORE_NAME, { keyPath: 'name' });
      }
    };
  });
}

/**
 * Execute an IDB operation with retry and exponential backoff
 */
async function withRetry<T>(
  operation: () => Promise<T>,
  operationName: string,
): Promise<T> {
  let lastError: PersistenceError | undefined;

  for (let attempt = 0; attempt < MAX_RETRY_ATTEMPTS; attempt++) {
    try {
      return await operation();
    } catch (err) {
      lastError = err instanceof Error && 'code' in err
        ? err as PersistenceError
        : normalizeIDBError(err, operationName);

      // Don't retry quota exceeded errors - they won't succeed
      if (lastError.code === 'QUOTA_EXCEEDED') {
        throw lastError;
      }

      // Wait before retry (except on last attempt)
      if (attempt < MAX_RETRY_ATTEMPTS - 1) {
        await sleep(getBackoffDelay(attempt));
      }
    }
  }

  // All retries exhausted
  throw lastError;
}

// =============================================================================
// IDBStorage Class
// =============================================================================

/**
 * IndexedDB Storage Manager
 *
 * Handles database blob persistence with:
 * - Debounced writes (2s idle)
 * - Explicit flush for critical operations
 * - Retry with exponential backoff
 * - Queued flushAndClose for safe database switching
 */
export class IDBStorage {
  /** Pending blob data to be flushed (keyed by database name) */
  private pendingWrites: Map<string, Blob> = new Map();

  /** Debounce timer ID */
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  /** Flush in progress promise (for coordination) */
  private flushPromise: Promise<FlushResult> | null = null;

  /** Callback for persistence errors */
  private onError: ((error: PersistenceError) => void) | null = null;

  /** Queue for flushAndClose operations (to handle concurrent requests) */
  private flushAndCloseQueue: Map<string, Promise<FlushAndCloseResult>> = new Map();

  /**
   * Set error callback for surfacing persistence failures
   */
  setErrorCallback(callback: (error: PersistenceError) => void): void {
    this.onError = callback;
  }

  /**
   * Schedule a database blob to be persisted
   *
   * This uses debouncing: the actual write happens after 2s of idle time.
   * Multiple writes within the debounce window are batched.
   *
   * @param name Database name
   * @param blob Database file as Blob
   */
  scheduleWrite(name: string, blob: Blob): void {
    // Store the latest blob for this database
    this.pendingWrites.set(name, blob);

    // Reset debounce timer
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
    }

    // Schedule flush after debounce delay
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.flush().catch((err) => {
        // Surface error via callback
        if (this.onError) {
          this.onError(
            err instanceof Error && 'code' in err
              ? err as PersistenceError
              : normalizeIDBError(err, 'flush'),
          );
        }
      });
    }, DEBOUNCE_DELAY_MS);
  }

  /**
   * Flush all pending writes immediately
   *
   * Use this for critical operations like:
   * - Switching databases
   * - Closing databases
   * - Before page unload
   *
   * @returns FlushResult indicating success/failure
   */
  async flush(): Promise<FlushResult> {
    // If a flush is already in progress, wait for it
    if (this.flushPromise !== null) {
      return this.flushPromise;
    }

    // Cancel any pending debounce
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    // Nothing to flush
    if (this.pendingWrites.size === 0) {
      return { success: true };
    }

    // Create flush promise
    this.flushPromise = this.doFlush();

    try {
      return await this.flushPromise;
    } finally {
      this.flushPromise = null;
    }
  }

  /**
   * Internal flush implementation
   */
  private async doFlush(): Promise<FlushResult> {
    // Snapshot pending writes and clear
    const writes = new Map(this.pendingWrites);
    this.pendingWrites.clear();

    try {
      await withRetry(async () => {
        const db = await openDatabase();

        try {
          const tx = db.transaction(IDB_STORE_NAME, 'readwrite');
          const store = tx.objectStore(IDB_STORE_NAME);

          const promises: Promise<void>[] = [];

          for (const [name, blob] of writes) {
            const entry: StoredDatabase = {
              name,
              blob,
              updatedAt: new Date().toISOString(),
            };

            promises.push(
              new Promise<void>((resolve, reject) => {
                const request = store.put(entry);
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
              }),
            );
          }

          // Wait for all writes
          await Promise.all(promises);

          // Wait for transaction to complete
          await new Promise<void>((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
          });
        } finally {
          db.close();
        }
      }, 'flush');

      return { success: true };
    } catch (err) {
      const error = err instanceof Error && 'code' in err
        ? err as PersistenceError
        : normalizeIDBError(err, 'flush');

      // Set global storage full flag for quota errors
      if (isStorageError(err)) {
        setStorageFull(true);
      }

      // Re-add failed writes to pending (will be retried on next schedule)
      for (const [name, blob] of writes) {
        if (!this.pendingWrites.has(name)) {
          this.pendingWrites.set(name, blob);
        }
      }

      return { success: false, error };
    }
  }

  /**
   * Load a database blob from IndexedDB
   *
   * @param name Database name
   * @returns The stored blob, or null if not found
   */
  async load(name: string): Promise<Blob | null> {
    try {
      const blob = await withRetry(async () => {
        const db = await openDatabase();

        try {
          const tx = db.transaction(IDB_STORE_NAME, 'readonly');
          const store = tx.objectStore(IDB_STORE_NAME);

          const result = await new Promise<StoredDatabase | undefined>((resolve, reject) => {
            const request = store.get(name);
            request.onsuccess = () => resolve(request.result as StoredDatabase | undefined);
            request.onerror = () => reject(request.error);
          });

          return result?.blob ?? null;
        } finally {
          db.close();
        }
      }, 'load');

      if (!blob) return null;
      if (!(blob instanceof Blob)) {
        return null;
      }
      return blob;
    } catch (err) {
      if (err && typeof err === 'object' && 'code' in err) {
        const code = (err as PersistenceError).code;
        if (code === 'NOT_FOUND') {
          return null;
        }
      }
      throw err;
    }
  }

  /**
   * Delete a database from IndexedDB
   *
   * @param name Database name to delete
   */
  async delete(name: string): Promise<void> {
    // Remove from pending writes if present
    this.pendingWrites.delete(name);

    return withRetry(async () => {
      const db = await openDatabase();

      try {
        const tx = db.transaction(IDB_STORE_NAME, 'readwrite');
        const store = tx.objectStore(IDB_STORE_NAME);

        await new Promise<void>((resolve, reject) => {
          const request = store.delete(name);
          request.onsuccess = () => resolve();
          request.onerror = () => reject(request.error);
        });

        // Wait for transaction to complete
        await new Promise<void>((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
        });
      } finally {
        db.close();
      }
    }, 'delete');
  }

  /**
   * List all stored database names
   *
   * @returns Array of database names
   */
  async list(): Promise<string[]> {
    return withRetry(async () => {
      const db = await openDatabase();

      try {
        const tx = db.transaction(IDB_STORE_NAME, 'readonly');
        const store = tx.objectStore(IDB_STORE_NAME);

        const names = await new Promise<string[]>((resolve, reject) => {
          const request = store.getAllKeys();
          request.onsuccess = () => resolve(request.result as string[]);
          request.onerror = () => reject(request.error);
        });

        return names;
      } finally {
        db.close();
      }
    }, 'list');
  }

  /**
   * Check if a database exists in storage
   *
   * @param name Database name
   * @returns true if exists
   */
  async exists(name: string): Promise<boolean> {
    const blob = await this.load(name);
    return blob !== null;
  }

  /**
   * Flush pending writes for a database and close its connection.
   *
   * This is the explicit worker API for safely switching/closing databases:
   * - Flushes any pending snapshot writes for the specified database
   * - Awaits IDB transaction commit
   * - Retries with exponential backoff (3 attempts)
   * - Returns deterministic IDB_FLUSH_FAILED error on persistent failure
   *
   * Handles concurrent requests by queuing them - if a flushAndClose is already
   * in progress for this database, subsequent calls will wait for it to complete.
   *
   * @param dbId Database identifier to flush and close
   * @returns FlushAndCloseResult with success or deterministic error for UI prompt
   */
  async flushAndClose(dbId: string): Promise<FlushAndCloseResult> {
    // Check if there's already a flushAndClose in progress for this database
    const existingOperation = this.flushAndCloseQueue.get(dbId);
    if (existingOperation) {
      // Wait for the existing operation to complete
      return existingOperation;
    }

    // Create the operation and add to queue
    const operation = this.doFlushAndClose(dbId);
    this.flushAndCloseQueue.set(dbId, operation);

    try {
      return await operation;
    } finally {
      // Remove from queue when done
      this.flushAndCloseQueue.delete(dbId);
    }
  }

  /**
   * Internal implementation of flushAndClose with retry logic
   */
  private async doFlushAndClose(dbId: string): Promise<FlushAndCloseResult> {
    let lastError: FlushAndCloseError | undefined;
    let attempts = 0;

    // Get the pending write for this specific database (if any)
    const pendingBlob = this.pendingWrites.get(dbId);

    // If no pending writes for this db, nothing to flush - success
    if (!pendingBlob) {
      return { success: true };
    }

    // Cancel any pending debounce timer for this write
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    // Remove from pending writes (we'll handle it directly)
    this.pendingWrites.delete(dbId);

    // Retry loop with exponential backoff
    for (attempts = 1; attempts <= MAX_RETRY_ATTEMPTS; attempts++) {
      try {
        const db = await openDatabase();

        try {
          const tx = db.transaction(IDB_STORE_NAME, 'readwrite');
          const store = tx.objectStore(IDB_STORE_NAME);

          const entry: StoredDatabase = {
            name: dbId,
            blob: pendingBlob,
            updatedAt: new Date().toISOString(),
          };

          // Put the entry
          await new Promise<void>((resolve, reject) => {
            const request = store.put(entry);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
          });

          // Wait for transaction to fully commit
          await new Promise<void>((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
          });

          // Success - transaction committed
          return { success: true };
        } finally {
          db.close();
        }
      } catch (err) {
        // Normalize the error
        if (err instanceof DOMException && err.name === 'QuotaExceededError') {
          // Quota exceeded - don't retry, return immediately
          setStorageFull(true);
          return {
            success: false,
            error: {
              code: 'QUOTA_EXCEEDED',
              message: `Storage quota exceeded while saving database "${dbId}". Please free up space.`,
              attempts,
              cause: err,
            },
          };
        }

        // Store error for potential return after all retries
        lastError = {
          code: 'IDB_FLUSH_FAILED',
          message: `Failed to save database "${dbId}" after ${attempts} attempt(s): ${err instanceof Error ? err.message : String(err)}`,
          attempts,
          cause: err,
        };

        // Wait before retry (except on last attempt)
        if (attempts < MAX_RETRY_ATTEMPTS) {
          await sleep(getBackoffDelay(attempts - 1));
        }
      }
    }

    // All retries exhausted - re-add to pending writes so data isn't lost
    this.pendingWrites.set(dbId, pendingBlob);

    // Return the deterministic error for UI to show "switch anyway" prompt
    return {
      success: false,
      error: lastError ?? {
        code: 'IDB_FLUSH_FAILED',
        message: `Failed to save database "${dbId}" after ${MAX_RETRY_ATTEMPTS} attempts.`,
        attempts: MAX_RETRY_ATTEMPTS,
      },
    };
  }

  /**
   * Check if there are pending writes
   */
  hasPendingWrites(): boolean {
    return this.pendingWrites.size > 0;
  }

  /**
   * Check if there are pending writes for a specific database
   *
   * @param name Database name
   * @returns true if there are pending writes for this database
   */
  hasPendingWritesFor(name: string): boolean {
    return this.pendingWrites.has(name);
  }

  /**
   * Get pending write count (for testing)
   */
  getPendingWriteCount(): number {
    return this.pendingWrites.size;
  }

  /**
   * Check if a flushAndClose operation is in progress for a database
   *
   * @param name Database name
   * @returns true if flushAndClose is in progress
   */
  isFlushAndCloseInProgress(name: string): boolean {
    return this.flushAndCloseQueue.has(name);
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.pendingWrites.clear();
    this.flushAndCloseQueue.clear();
    this.onError = null;
  }
}

// =============================================================================
// Module-level Singleton (for worker context)
// =============================================================================

let _storageInstance: IDBStorage | null = null;

/**
 * Get the singleton IDB storage instance
 *
 * Creates the instance on first call. Safe to call multiple times.
 */
export function getIDBStorage(): IDBStorage {
  if (!_storageInstance) {
    _storageInstance = new IDBStorage();
  }
  return _storageInstance;
}

/**
 * Reset the singleton instance (for testing)
 */
export function resetIDBStorage(): void {
  if (_storageInstance) {
    _storageInstance.destroy();
    _storageInstance = null;
  }
}

// =============================================================================
// Exports for testing
// =============================================================================

export const _testing = {
  IDB_DATABASE_NAME,
  IDB_STORE_NAME,
  IDB_VERSION,
  DEBOUNCE_DELAY_MS,
  MAX_RETRY_ATTEMPTS,
  BASE_BACKOFF_MS,
  openDatabase,
  getBackoffDelay,
  normalizeIDBError,
  sleep,
};
