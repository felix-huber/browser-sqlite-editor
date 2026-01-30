/**
 * Web Worker entry point for SQLite database operations
 *
 * This worker handles all database interactions off the main thread,
 * keeping the UI responsive during heavy operations.
 */

import type { WorkerRequest, WorkerResponse } from '../types';
import {
  isStorageError,
  normalizeStorageError,
  setStorageFull,
  blockDatabaseWrites,
  getStorageEstimate,
  type StorageError,
} from './quota-errors';
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
} from './handlers/registry';
import {
  handleFlushSnapshotRequest,
  handleExportRequest,
  handleImportRequest,
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
 * Handle incoming messages from the main thread
 */
async function handleMessage(event: WorkerMessageEvent): Promise<void> {
  const { id, request } = event.data;

  switch (request.type) {
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
