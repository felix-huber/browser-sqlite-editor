/**
 * Web Worker entry point for SQLite database operations
 *
 * This worker handles all database interactions off the main thread,
 * keeping the UI responsive during heavy operations.
 */

import type { WorkerRequest, WorkerResponse, WorkerErrorCode } from '../types';
import {
  isStorageError,
  normalizeStorageError,
  setStorageFull,
  blockDatabaseWrites,
  getStorageEstimate,
  type StorageError,
} from './quota-errors';
import { setWorkerDebugMode, workerDebugLog } from '../shared/utils/debug';
import {
  handleQueryRequest,
  handleExecRequest,
  handleCancelRequest,
} from './handlers/query';
import {
  handleOpenRequest,
  handleCloseRequest,
  handleCreateDbRequest,
  handleDeleteDbRequest,
  handleRenameDbRequest,
  handleGetRegistryRequest,
  handleGetDbSizeRequest,
  handleResetAppRequest,
  handleForceReinitRegistryRequest,
} from './handlers/registry';
import {
  handleFlushSnapshotRequest,
  handleExportRequest,
  handleImportRequest,
  handleImportOpfsRequest,
  handleFlushAndCloseRequest,
} from './handlers/import-export';
import {
  handleSchemaRequest,
  handleTableInfoRequest,
  handleForeignKeysRequest,
  handleCreateTableRequest,
  handleAlterTableRequest,
  handleDropTableRequest,
  handleDropColumnRequest,
  handleRebuildTableRequest,
} from './handlers/schema';

// =============================================================================
// Read-Only Error Detection (Native SQLite check via PRAGMA query_only)
// =============================================================================

/**
 * Error patterns that indicate a read-only violation.
 * SQLite returns these messages when PRAGMA query_only = ON is set
 * and a write operation is attempted.
 *
 * This uses native SQLite's enforcement rather than string-based SQL parsing,
 * per PRD requirements for sqlite3_stmt_readonly() equivalent behavior.
 */
const READ_ONLY_ERROR_PATTERNS = [
  'attempt to write a readonly database',
  'authorization denied',
  'database is read-only',
];

/**
 * Check if an error indicates a read-only violation.
 * Uses native SQLite error detection rather than regex-based SQL parsing.
 *
 * @param err - Error to check
 * @returns true if the error is a read-only violation
 */
export function isReadOnlyError(err: unknown): boolean {
  if (!err) return false;

  const message = err instanceof Error
    ? err.message.toLowerCase()
    : String(err).toLowerCase();

  return READ_ONLY_ERROR_PATTERNS.some(pattern => message.includes(pattern));
}

/**
 * Normalize a read-only error with a clear, user-friendly message.
 *
 * @param err - Original error
 * @returns Enhanced error with clear explanation of read-only restriction
 */
export function normalizeReadOnlyError(_err: unknown): {
  message: string;
  code: WorkerErrorCode;
} {
  return {
    message: 'Database is in read-only mode. Write operations (INSERT, UPDATE, DELETE, DDL) are not allowed. Another tab may hold the write lock.',
    code: 'LOCK_HELD',
  };
}

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
  workerDebugLog('[Worker] Sending response:', response.type, 'id:', requestId);
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
 * Handle incoming messages from the main thread
 */
async function handleMessage(event: WorkerMessageEvent): Promise<void> {
  const { id, request } = event.data;

  workerDebugLog('[Worker] Received message:', request.type, 'id:', id);

  switch (request.type) {
    case 'setDebugMode':
      setWorkerDebugMode(request.enabled);
      postResponse({ type: 'success' }, id);
      break;

    case 'ping':
      postResponse({ type: 'pong' }, id);
      break;

    case 'query':
      await handleQueryRequest(request, id, postResponse);
      break;

    case 'exec':
      await handleExecRequest(request, id, postResponse);
      break;

    case 'open':
      await handleOpenRequest(request, id, postResponse);
      break;

    case 'close':
      await handleCloseRequest(request, id, postResponse);
      break;

    case 'createDb':
      await handleCreateDbRequest(request, id, postResponse);
      break;

    case 'deleteDb':
      await handleDeleteDbRequest(request, id, postResponse);
      break;

    case 'renameDb':
      await handleRenameDbRequest(request, id, postResponse);
      break;

    case 'getRegistry':
      await handleGetRegistryRequest(request, id, postResponse);
      break;

    case 'getDbSize':
      await handleGetDbSizeRequest(request, id, postResponse);
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
      await handleFlushSnapshotRequest(request, id, postResponse);
      break;

    case 'export':
      await handleExportRequest(request, id, postResponse);
      break;

    case 'schema':
      await handleSchemaRequest(request, id, postResponse);
      break;

    case 'tableInfo':
      await handleTableInfoRequest(request, id, postResponse);
      break;

    case 'foreignKeys':
      await handleForeignKeysRequest(request, id, postResponse);
      break;

    case 'cancel':
      await handleCancelRequest(request, id, postResponse);
      break;

    case 'flushAndClose':
      await handleFlushAndCloseRequest(request, id, postResponse);
      break;

    case 'import':
      await handleImportRequest(request, id, postResponse, postBroadcast);
      break;
    case 'importOpfs':
      await handleImportOpfsRequest(request, id, postResponse, postBroadcast);
      break;

    case 'createTable':
      await handleCreateTableRequest(request, id, postResponse);
      break;

    case 'alterTable':
      await handleAlterTableRequest(request, id, postResponse);
      break;

    case 'dropTable':
      await handleDropTableRequest(request, id, postResponse);
      break;

    case 'dropColumn':
      await handleDropColumnRequest(request, id, postResponse);
      break;

    case 'rebuildTable':
      await handleRebuildTableRequest(request, id, postResponse);
      break;

    case 'resetApp':
      await handleResetAppRequest(request, id, postResponse);
      break;

    case 'forceReinitRegistry':
      await handleForceReinitRegistryRequest(request, id, postResponse);
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
      // Check for read-only errors and provide clear message
      if (isReadOnlyError(err)) {
        const { message, code } = normalizeReadOnlyError(err);
        postResponse(
          {
            type: 'error',
            message,
            code,
          },
          event.data?.id
        );
        return;
      }

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
      console.error('[Worker] Error handling message:', err);
      // Check for read-only errors and provide clear message
      if (isReadOnlyError(err)) {
        const { message, code } = normalizeReadOnlyError(err);
        postResponse(
          {
            type: 'error',
            message,
            code,
          },
          event.data?.id
        );
        return;
      }

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
