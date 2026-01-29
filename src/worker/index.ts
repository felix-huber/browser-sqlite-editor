/**
 * Web Worker entry point for SQLite database operations
 *
 * This worker handles all database interactions off the main thread,
 * keeping the UI responsive during heavy operations.
 */

import type { WorkerRequest, WorkerResponse, WorkerErrorCode } from '../types';
import { getEngine } from '../lib/db-engine';
import { getSchemaInfo, getTableInfo, getAllForeignKeys } from '../lib/schema';
import { registerQuery, requestCancellation } from './query-cancel';
import {
  isStorageError,
  normalizeStorageError,
  setStorageFull,
  blockDatabaseWrites,
  getStorageEstimate,
  type StorageError,
} from './quota-errors';
import { getIDBStorage } from './idb-storage';
import { importDatabase } from './file-import';
import { getRegistry, toFilename } from './db-registry';
import {
  getOPFSPath,
  OPFS_VFS_NAME,
  IDB_VFS_NAME,
  readOPFSDatabase,
  deleteOPFSDatabase,
} from '../lib/opfs-vfs';
import {
  handleCreateTable,
  handleAlterTable,
  handleDropTable,
  handleDropColumn,
} from './schema-modification';

/**
 * Tagged request with correlation ID from main thread
 */
interface TaggedRequest {
  id: number;
  request: WorkerRequest;
}

/**
 * Type-safe message event for worker requests
 */
type WorkerMessageEvent = MessageEvent<TaggedRequest>;

/**
 * Post a typed response back to the main thread with correlation ID
 */
function postResponse(response: WorkerResponse, requestId?: number): void {
  if (requestId === undefined) {
    self.postMessage(response);
    return;
  }
  self.postMessage({ ...response, id: requestId });
}

/**
 * Post a broadcast event (no correlation ID - not a response to a request)
 */
function postBroadcast(event: WorkerResponse): void {
  self.postMessage(event);
}

/**
 * Handle storage errors by posting appropriate response
 */
export function handleStorageError(
  err: StorageError,
  dbName?: string,
  requestId?: number
): void {
  // Block writes for this database
  if (dbName) {
    blockDatabaseWrites(dbName);
  }

  // Post storage full notification (broadcast, not a response)
  if (dbName) {
    postBroadcast({ type: 'storageFull', dbName });
  }

  // Post error response
  postResponse({
    type: 'error',
    message: err.message,
    code: err.code,
  }, requestId);
}

/**
 * Wrap an operation with storage error detection
 *
 * @param operation - Async operation to wrap
 * @param operationName - Name for error messages
 * @param _dbName - Optional database name to track (reserved for future use)
 */
export async function withStorageProtection<T>(
  operation: () => Promise<T>,
  operationName: string,
  _dbName?: string
): Promise<T> {
  try {
    return await operation();
  } catch (err) {
    if (isStorageError(err)) {
      const estimate = await getStorageEstimate();
      const storageError = normalizeStorageError(err, operationName, estimate);
      setStorageFull(true);
      throw storageError;
    }
    throw err;
  }
}

/**
 * Create a query executor bound to the current engine instance
 */
function createQueryExecutor() {
  const engine = getEngine();
  return async (sql: string, params?: unknown[]) => {
    return engine.query(sql, params);
  };
}

/**
 * Resolve database path based on storage mode
 */
async function resolveDbPath(
  dbName: string
): Promise<{ path: string; vfsName?: string }> {
  const registry = getRegistry();
  if (!registry.isInitialized()) {
    await registry.init();
  }
  const entry = registry.getDatabaseByName(dbName);
  const storageMode = entry?.storageType ?? registry.getStorageMode();
  if (storageMode === 'opfs') {
    return { path: getOPFSPath(toFilename(dbName)), vfsName: OPFS_VFS_NAME };
  }
  if (storageMode === 'idb') {
    return { path: dbName, vfsName: IDB_VFS_NAME };
  }
  return { path: dbName };
}

/**
 * Export a database as a Blob based on storage mode
 */
async function exportDatabaseBlob(dbName: string): Promise<Blob> {
  const registry = getRegistry();
  if (!registry.isInitialized()) {
    await registry.init();
  }

  const entry = registry.getDatabaseByName(dbName);
  if (!entry) {
    throw new Error(`Database "${dbName}" not found`);
  }

  const storageMode = entry.storageType ?? registry.getStorageMode();

  // If this DB is currently open, attempt a checkpoint to include WAL changes.
  try {
    const engine = getEngine();
    if (engine.isReady() && engine.getDbName()) {
      const { path } = await resolveDbPath(dbName);
      if (engine.getDbName() === path) {
        await engine.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      }
    }
  } catch {
    // Best-effort: export can still proceed without checkpoint
  }

  if (storageMode === 'opfs') {
    const engine = getEngine();
    const exportFile = `__export_${Date.now()}_${Math.random().toString(36).slice(2)}.sqlite`;
    let vacuumed = false;

    try {
      if (engine.isReady() && engine.getDbName()) {
        const { path } = await resolveDbPath(dbName);
        if (engine.getDbName() === path) {
          try {
            await engine.exec(`VACUUM INTO '${getOPFSPath(exportFile)}'`);
            vacuumed = true;
          } catch {
            // Fall back to reading the live file
          }
        }
      }

      const bytes = await readOPFSDatabase(vacuumed ? exportFile : toFilename(entry.name));
      if (!bytes) {
        throw new Error(`Database file for "${dbName}" not found in OPFS`);
      }
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      return new Blob([copy.buffer], { type: 'application/x-sqlite3' });
    } finally {
      if (vacuumed) {
        try {
          await deleteOPFSDatabase(exportFile);
        } catch {
          // Best-effort cleanup
        }
      }
    }
  }

  // IDB mode: rely on snapshot storage
  const storage = getIDBStorage();
  try {
    await storage.flush();
  } catch {
    // Ignore flush failures here; try to export the last good snapshot
  }

  const blob = await storage.load(entry.name);
  if (!blob) {
    throw new Error(`Database file for "${dbName}" not found in IndexedDB`);
  }
  return blob.type ? blob : blob.slice(0, blob.size, 'application/x-sqlite3');
}

/**
 * Handle incoming messages from the main thread
 */
async function handleMessage(event: WorkerMessageEvent): Promise<void> {
  const { id, request } = event.data;

  switch (request.type) {
    case 'ping':
      postResponse({ type: 'pong' }, id);
      break;

    case 'query':
      {
        const cleanup = registerQuery(String(id));
        try {
          const engine = getEngine();
          // Engine must be open before querying
          if (!engine.isReady()) {
            throw new Error('No database open. Please open a database first.');
          }
          const result = await engine.query(request.sql, request.params);
          postResponse({ type: 'queryResult', result }, id);
        } catch (err) {
          const normalized =
            typeof err === 'object' && err !== null && 'code' in err && 'message' in err
              ? (err as { code?: string; message?: string })
              : null;
          const message =
            normalized?.message ??
            (err instanceof Error ? err.message : String(err));
          const lowerMessage = message.toLowerCase();
          const normalizedCode =
            typeof normalized?.code === 'string'
              ? (normalized.code as WorkerErrorCode)
              : undefined;
          const code: WorkerErrorCode =
            normalizedCode ??
            (message.toUpperCase().includes('SQLITE_CONSTRAINT')
              ? 'CONSTRAINT_VIOLATION'
              : lowerMessage.includes('syntax error')
              ? 'SYNTAX_ERROR'
              : lowerMessage.includes('interrupt') || lowerMessage.includes('cancel')
              ? 'CANCELED'
              : 'UNKNOWN');
          postResponse({
            type: 'error',
            message,
            code,
          }, id);
        } finally {
          cleanup();
        }
      }
      break;

    case 'exec':
      {
        const cleanup = registerQuery(String(id));
        try {
          const engine = getEngine();
          // Engine must be open before executing
          if (!engine.isReady()) {
            throw new Error('No database open. Please open a database first.');
          }
          const result = await engine.exec(request.sql, request.params);
          postResponse({ type: 'success', data: result }, id);
        } catch (err) {
          const normalized =
            typeof err === 'object' && err !== null && 'code' in err && 'message' in err
              ? (err as { code?: string; message?: string })
              : null;
          const message =
            normalized?.message ??
            (err instanceof Error ? err.message : String(err));
          const lowerMessage = message.toLowerCase();
          const normalizedCode =
            typeof normalized?.code === 'string'
              ? (normalized.code as WorkerErrorCode)
              : undefined;
          const code: WorkerErrorCode =
            normalizedCode ??
            (message.toUpperCase().includes('SQLITE_CONSTRAINT')
              ? 'CONSTRAINT_VIOLATION'
              : lowerMessage.includes('syntax error')
              ? 'SYNTAX_ERROR'
              : lowerMessage.includes('interrupt') || lowerMessage.includes('cancel')
              ? 'CANCELED'
              : 'UNKNOWN');
          postResponse({
            type: 'error',
            message,
            code,
          }, id);
        } finally {
          cleanup();
        }
      }
      break;

    case 'open':
      try {
        const engine = getEngine();
        // Initialize engine if not ready
        if (!engine.isReady()) {
          await engine.initialize();
        }
        const { path, vfsName } = await resolveDbPath(request.dbName);
        await engine.open(path, vfsName, { readOnly: request.readOnly ?? false });
        postResponse({ type: 'lockStatus', isWriter: !(request.readOnly ?? false) }, id);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        postResponse({
          type: 'error',
          message: `Failed to open database: ${message}`,
          code: 'UNKNOWN',
        }, id);
      }
      break;

    case 'close':
      try {
        const engine = getEngine();
        await engine.close();
        postResponse({ type: 'success' }, id);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        postResponse({
          type: 'error',
          message: `Failed to close database: ${message}`,
          code: 'UNKNOWN',
        }, id);
      }
      break;

    case 'createDb':
      try {
        const engine = getEngine();
        // Initialize engine if not ready
        if (!engine.isReady()) {
          await engine.initialize();
        }
        // Open creates the database if it doesn't exist
        const { path, vfsName } = await resolveDbPath(request.name);
        await engine.open(path, vfsName, { createIfMissing: true });
        // Add to registry
        const registry = getRegistry();
        if (!registry.isInitialized()) {
          await registry.init();
        }
        await registry.registerDatabase(request.name);
        postResponse({ type: 'success' }, id);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        postResponse({
          type: 'error',
          message: `Failed to create database: ${message}`,
          code: 'UNKNOWN',
        }, id);
      }
      break;

    case 'deleteDb':
      try {
        const registry = getRegistry();
        if (!registry.isInitialized()) {
          await registry.init();
        }
        const result = await registry.deleteDatabase(request.name);
        if (!result.success) {
          const code = result.error?.code === 'NOT_FOUND' ? 'NOT_FOUND' : 'UNKNOWN';
          postResponse({
            type: 'error',
            message: result.error?.message ?? 'Failed to delete database',
            code,
          }, id);
          break;
        }
        postResponse({
          type: 'success',
          data: result.warnings ? { warnings: result.warnings } : undefined,
        }, id);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        postResponse({
          type: 'error',
          message: `Failed to delete database: ${message}`,
          code: 'UNKNOWN',
        }, id);
      }
      break;

    case 'renameDb':
      try {
        const registry = getRegistry();
        if (!registry.isInitialized()) {
          await registry.init();
        }
        const entry = registry.getDatabaseByName(request.oldName);
        if (!entry) {
          postResponse({
            type: 'error',
            message: `Database "${request.oldName}" not found`,
            code: 'NOT_FOUND',
          }, id);
          break;
        }

        const result = await registry.renameDatabase(entry.id, request.newName);
        if (!result.success) {
          const errorCode = result.error?.code;
          const code =
            errorCode === 'NOT_FOUND'
              ? 'NOT_FOUND'
              : errorCode === 'NAME_EXISTS' ||
                errorCode === 'NAME_EMPTY' ||
                errorCode === 'NAME_TOO_LONG' ||
                errorCode === 'PATH_SEPARATOR' ||
                errorCode === 'HIDDEN_FILE' ||
                errorCode === 'RESERVED_NAME' ||
                errorCode === 'PATH_TRAVERSAL'
              ? 'INVALID_NAME'
              : 'UNKNOWN';
          postResponse({
            type: 'error',
            message: result.error?.message ?? 'Failed to rename database',
            code,
          }, id);
          break;
        }

        postResponse({ type: 'success' }, id);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        postResponse({
          type: 'error',
          message: `Failed to rename database: ${message}`,
          code: 'UNKNOWN',
        }, id);
      }
      break;

    case 'getRegistry':
      try {
        const registry = getRegistry();
        if (!registry.isInitialized()) {
          await registry.init();
        }
        const entries = registry.listDatabases();
        // Convert RegistryEntry to DatabaseEntry format
        const databases = entries.map((e) => ({
          name: e.name,
          file: e.storageType === 'opfs' ? toFilename(e.name) : e.name,
          createdAt: e.createdAt,
          lastOpenedAt: e.lastOpenedAt,
          fkEnforced: true, // Default to enabled
        }));
        postResponse({
          type: 'registryResult',
          registry: { v: 1, databases },
        }, id);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        postResponse({
          type: 'error',
          message: `Failed to get registry: ${message}`,
          code: 'UNKNOWN',
        }, id);
      }
      break;

    case 'acquireLock':
      // For now, always grant lock (multi-tab locking is handled separately)
      postResponse({ type: 'lockStatus', isWriter: true }, id);
      break;

    case 'releaseLock':
      postResponse({ type: 'success' }, id);
      break;

    case 'checkLock':
      postResponse({ type: 'lockStatus', isWriter: true }, id);
      break;

    case 'flushSnapshot':
      try {
        const storage = getIDBStorage();
        const result = await storage.flush();
        if (!result.success) {
          postResponse({
            type: 'error',
            message: result.error?.message ?? 'Failed to flush snapshot',
            code: result.error?.code ?? 'UNKNOWN',
          }, id);
          break;
        }
        postResponse({ type: 'success' }, id);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        postResponse({
          type: 'error',
          message: `Failed to flush snapshot: ${message}`,
          code: 'UNKNOWN',
        }, id);
      }
      break;

    case 'export':
      try {
        const blob = await exportDatabaseBlob(request.dbName);
        postResponse({ type: 'success', data: blob }, id);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const code = message.includes('not found') ? 'NOT_FOUND' : 'UNKNOWN';
        postResponse({
          type: 'error',
          message: `Export failed: ${message}`,
          code,
        }, id);
      }
      break;

    case 'schema':
      try {
        const queryExecutor = createQueryExecutor();
        const schema = await getSchemaInfo(queryExecutor);
        postResponse({ type: 'schemaResult', schema }, id);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        postResponse({
          type: 'error',
          message: `Failed to get schema: ${message}`,
          code: 'UNKNOWN',
        }, id);
      }
      break;

    case 'tableInfo':
      try {
        const queryExecutor = createQueryExecutor();
        const tableInfo = await getTableInfo(queryExecutor, request.table);
        postResponse({ type: 'tableInfoResult', tableInfo }, id);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const code = message.includes('not found') ? 'NOT_FOUND' : 'UNKNOWN';
        postResponse({
          type: 'error',
          message: `Failed to get table info: ${message}`,
          code,
        }, id);
      }
      break;

    case 'foreignKeys':
      try {
        const queryExecutor = createQueryExecutor();
        const foreignKeys = await getAllForeignKeys(queryExecutor);
        postResponse({ type: 'foreignKeysResult', foreignKeys }, id);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        postResponse({
          type: 'error',
          message: `Failed to query foreign keys: ${message}`,
          code: 'UNKNOWN',
        }, id);
      }
      break;

    case 'cancel':
      try {
        // Request cancellation - the requestId is extracted from the tagged request
        // in the handleMessage caller if present
        await requestCancellation();
        postResponse({ type: 'success' }, id);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        postResponse({
          type: 'error',
          message: `Failed to cancel: ${message}`,
          code: 'UNKNOWN',
        }, id);
      }
      break;

    case 'flushAndClose':
      try {
        const storage = getIDBStorage();
        const result = await storage.flushAndClose(request.dbId);

        postResponse({
          type: 'flushAndCloseResult',
          success: result.success,
          error: result.error
            ? {
                code: result.error.code,
                message: result.error.message,
                attempts: result.error.attempts,
              }
            : undefined,
        }, id);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        postResponse({
          type: 'flushAndCloseResult',
          success: false,
          error: {
            code: 'IDB_FLUSH_FAILED',
            message: `Unexpected error during flushAndClose: ${message}`,
            attempts: 0,
          },
        }, id);
      }
      break;

    case 'import':
      try {
        // Initialize registry if needed
        const registry = getRegistry();
        if (!registry.isInitialized()) {
          await registry.init();
        }

        const storageMode = registry.getStorageMode();

        // Import with progress reporting (progress is broadcast, not a response)
        const importResult = await importDatabase(request.file, {
          nameHint: request.nameHint,
          storageMode,
          onProgress: (percent) => {
            postBroadcast({ type: 'progress', percent, message: 'Importing database...' });
          },
        });

        if (importResult.success) {
          postResponse({
            type: 'success',
            data: {
              dbId: importResult.dbId,
              dbName: importResult.dbName,
              storageType: importResult.storageType,
              fileSize: importResult.fileSize,
            },
          }, id);
        } else {
          postResponse({
            type: 'error',
            message: importResult.message,
            code: importResult.code,
          }, id);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        postResponse({
          type: 'error',
          message: `Import failed: ${message}`,
          code: 'UNKNOWN',
        }, id);
      }
      break;

    case 'createTable':
      try {
        const queryExecutor = createQueryExecutor();
        const result = await handleCreateTable({
          def: request.def,
          query: queryExecutor,
          isReadOnly: request.isReadOnly,
        });

        postResponse({
          type: 'schemaModificationResult',
          success: result.success,
          error: result.error
            ? {
                code: result.error.code,
                message: result.error.message,
                details: result.error.details,
              }
            : undefined,
        }, id);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        postResponse({
          type: 'schemaModificationResult',
          success: false,
          error: {
            code: 'UNKNOWN',
            message: `Create table failed: ${message}`,
          },
        }, id);
      }
      break;

    case 'alterTable':
      try {
        const queryExecutor = createQueryExecutor();
        const result = await handleAlterTable({
          table: request.table,
          action: request.action,
          query: queryExecutor,
          isReadOnly: request.isReadOnly,
        });

        postResponse({
          type: 'schemaModificationResult',
          success: result.success,
          error: result.error
            ? {
                code: result.error.code,
                message: result.error.message,
                details: result.error.details,
              }
            : undefined,
        }, id);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        postResponse({
          type: 'schemaModificationResult',
          success: false,
          error: {
            code: 'UNKNOWN',
            message: `Alter table failed: ${message}`,
          },
        }, id);
      }
      break;

    case 'dropTable':
      try {
        const queryExecutor = createQueryExecutor();
        const result = await handleDropTable({
          table: request.table,
          query: queryExecutor,
          isReadOnly: request.isReadOnly,
        });

        postResponse({
          type: 'schemaModificationResult',
          success: result.success,
          error: result.error
            ? {
                code: result.error.code,
                message: result.error.message,
                details: result.error.details,
              }
            : undefined,
        }, id);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        postResponse({
          type: 'schemaModificationResult',
          success: false,
          error: {
            code: 'UNKNOWN',
            message: `Drop table failed: ${message}`,
          },
        }, id);
      }
      break;

    case 'dropColumn':
      try {
        const queryExecutor = createQueryExecutor();
        const result = await handleDropColumn({
          table: request.table,
          column: request.column,
          query: queryExecutor,
          isReadOnly: request.isReadOnly,
        });

        postResponse({
          type: 'schemaModificationResult',
          success: result.success,
          error: result.error
            ? {
                code: result.error.code,
                message: result.error.message,
                details: result.error.details,
              }
            : undefined,
        }, id);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        postResponse({
          type: 'schemaModificationResult',
          success: false,
          error: {
            code: 'UNKNOWN',
            message: `Drop column failed: ${message}`,
          },
        }, id);
      }
      break;

    // Future handlers will be added here as the worker is extended
    default:
      postResponse({
        type: 'error',
        message: `Unknown request type: ${(request as WorkerRequest).type}`,
        code: 'UNKNOWN',
      }, id);
  }
}

let messageQueue: Promise<void> = Promise.resolve();

// Register the message handler
self.addEventListener('message', (event: WorkerMessageEvent) => {
  // Allow cancellation messages to interrupt queued work
  if (event.data?.request?.type === 'cancel') {
    handleMessage(event).catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      postResponse(
        {
          type: 'error',
          message: `Worker error: ${message}`,
          code: 'UNKNOWN',
        },
        event.data?.id
      );
    });
    return;
  }

  messageQueue = messageQueue
    .then(() => handleMessage(event))
    .catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      postResponse(
        {
          type: 'error',
          message: `Worker error: ${message}`,
          code: 'UNKNOWN',
        },
        event.data?.id
      );
    });
});

// Signal that the worker is ready (no request ID for this initial broadcast)
self.postMessage({ type: 'ready' });
