/**
 * Web Worker entry point for SQLite database operations
 *
 * This worker handles all database interactions off the main thread,
 * keeping the UI responsive during heavy operations.
 */

import type { WorkerRequest, WorkerResponse } from '../types';
import { getEngine } from '../lib/db-engine';
import { getSchemaInfo, getTableInfo, getAllForeignKeys } from '../lib/schema';
import { requestCancellation } from './query-cancel';
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
import { getRegistry } from './db-registry';
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
 * Current request ID for correlation (set before handling each message)
 */
let currentRequestId: number | undefined;

/**
 * Post a typed response back to the main thread with correlation ID
 */
function postResponse(response: WorkerResponse): void {
  self.postMessage({ ...response, id: currentRequestId });
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
export function handleStorageError(err: StorageError, dbName?: string): void {
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
  });
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
 * Handle incoming messages from the main thread
 */
async function handleMessage(event: WorkerMessageEvent): Promise<void> {
  const { id, request } = event.data;
  currentRequestId = id;

  switch (request.type) {
    case 'ping':
      postResponse({ type: 'pong' });
      break;

    case 'query':
      try {
        const engine = getEngine();
        // Engine must be open before querying
        if (!engine.isReady()) {
          throw new Error('No database open. Please open a database first.');
        }
        const result = await engine.query(request.sql, request.params);
        postResponse({ type: 'queryResult', result });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const code = message.includes('SQLITE_CONSTRAINT') ? 'CONSTRAINT_VIOLATION' :
                     message.includes('syntax error') ? 'SYNTAX_ERROR' : 'UNKNOWN';
        postResponse({
          type: 'error',
          message,
          code,
        });
      }
      break;

    case 'exec':
      try {
        const engine = getEngine();
        // Engine must be open before executing
        if (!engine.isReady()) {
          throw new Error('No database open. Please open a database first.');
        }
        const result = await engine.exec(request.sql, request.params);
        postResponse({ type: 'success', data: result });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const code = message.includes('SQLITE_CONSTRAINT') ? 'CONSTRAINT_VIOLATION' :
                     message.includes('syntax error') ? 'SYNTAX_ERROR' : 'UNKNOWN';
        postResponse({
          type: 'error',
          message,
          code,
        });
      }
      break;

    case 'open':
      try {
        const engine = getEngine();
        // Initialize engine if not ready
        if (!engine.isReady()) {
          await engine.initialize();
        }
        await engine.open(request.dbName);
        postResponse({ type: 'lockStatus', isWriter: true });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        postResponse({
          type: 'error',
          message: `Failed to open database: ${message}`,
          code: 'UNKNOWN',
        });
      }
      break;

    case 'close':
      try {
        const engine = getEngine();
        await engine.close();
        postResponse({ type: 'success' });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        postResponse({
          type: 'error',
          message: `Failed to close database: ${message}`,
          code: 'UNKNOWN',
        });
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
        await engine.open(request.name);
        // Add to registry
        const registry = getRegistry();
        if (!registry.isInitialized()) {
          await registry.init();
        }
        await registry.registerDatabase(request.name);
        postResponse({ type: 'success' });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        postResponse({
          type: 'error',
          message: `Failed to create database: ${message}`,
          code: 'UNKNOWN',
        });
      }
      break;

    case 'deleteDb':
      try {
        const registry = getRegistry();
        await registry.deleteDatabase(request.name);
        postResponse({ type: 'success' });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        postResponse({
          type: 'error',
          message: `Failed to delete database: ${message}`,
          code: 'UNKNOWN',
        });
      }
      break;

    case 'renameDb':
      try {
        const registry = getRegistry();
        await registry.renameDatabase(request.oldName, request.newName);
        postResponse({ type: 'success' });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        postResponse({
          type: 'error',
          message: `Failed to rename database: ${message}`,
          code: 'UNKNOWN',
        });
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
          file: e.name, // Use name as filename for now
          createdAt: e.createdAt,
          lastOpenedAt: e.lastOpenedAt,
          fkEnforced: true, // Default to enabled
        }));
        postResponse({
          type: 'registryResult',
          registry: { v: 1, databases },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        postResponse({
          type: 'error',
          message: `Failed to get registry: ${message}`,
          code: 'UNKNOWN',
        });
      }
      break;

    case 'acquireLock':
      // For now, always grant lock (multi-tab locking is handled separately)
      postResponse({ type: 'lockStatus', isWriter: true });
      break;

    case 'releaseLock':
      postResponse({ type: 'success' });
      break;

    case 'checkLock':
      postResponse({ type: 'lockStatus', isWriter: true });
      break;

    case 'flushSnapshot':
      postResponse({ type: 'success' });
      break;

    case 'export':
      // Export is not yet implemented - return error for now
      postResponse({
        type: 'error',
        message: 'Export not yet implemented',
        code: 'UNKNOWN',
      });
      break;

    case 'schema':
      try {
        const queryExecutor = createQueryExecutor();
        const schema = await getSchemaInfo(queryExecutor);
        postResponse({ type: 'schemaResult', schema });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        postResponse({
          type: 'error',
          message: `Failed to get schema: ${message}`,
          code: 'UNKNOWN',
        });
      }
      break;

    case 'tableInfo':
      try {
        const queryExecutor = createQueryExecutor();
        const tableInfo = await getTableInfo(queryExecutor, request.table);
        postResponse({ type: 'tableInfoResult', tableInfo });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const code = message.includes('not found') ? 'NOT_FOUND' : 'UNKNOWN';
        postResponse({
          type: 'error',
          message: `Failed to get table info: ${message}`,
          code,
        });
      }
      break;

    case 'foreignKeys':
      try {
        const queryExecutor = createQueryExecutor();
        const foreignKeys = await getAllForeignKeys(queryExecutor);
        postResponse({ type: 'foreignKeysResult', foreignKeys });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        postResponse({
          type: 'error',
          message: `Failed to query foreign keys: ${message}`,
          code: 'UNKNOWN',
        });
      }
      break;

    case 'cancel':
      try {
        // Request cancellation - the requestId is extracted from the tagged request
        // in the handleMessage caller if present
        await requestCancellation();
        postResponse({ type: 'success' });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        postResponse({
          type: 'error',
          message: `Failed to cancel: ${message}`,
          code: 'UNKNOWN',
        });
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
        });
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
        });
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
          });
        } else {
          postResponse({
            type: 'error',
            message: importResult.message,
            code: importResult.code,
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        postResponse({
          type: 'error',
          message: `Import failed: ${message}`,
          code: 'UNKNOWN',
        });
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
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        postResponse({
          type: 'schemaModificationResult',
          success: false,
          error: {
            code: 'UNKNOWN',
            message: `Create table failed: ${message}`,
          },
        });
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
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        postResponse({
          type: 'schemaModificationResult',
          success: false,
          error: {
            code: 'UNKNOWN',
            message: `Alter table failed: ${message}`,
          },
        });
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
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        postResponse({
          type: 'schemaModificationResult',
          success: false,
          error: {
            code: 'UNKNOWN',
            message: `Drop table failed: ${message}`,
          },
        });
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
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        postResponse({
          type: 'schemaModificationResult',
          success: false,
          error: {
            code: 'UNKNOWN',
            message: `Drop column failed: ${message}`,
          },
        });
      }
      break;

    // Future handlers will be added here as the worker is extended
    default:
      postResponse({
        type: 'error',
        message: `Unknown request type: ${(request as WorkerRequest).type}`,
        code: 'UNKNOWN',
      });
  }
}

// Register the message handler
self.addEventListener('message', (event: WorkerMessageEvent) => {
  handleMessage(event).catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    postResponse({
      type: 'error',
      message: `Worker error: ${message}`,
      code: 'UNKNOWN',
    });
  });
});

// Signal that the worker is ready (no request ID for this initial broadcast)
self.postMessage({ type: 'ready' });
