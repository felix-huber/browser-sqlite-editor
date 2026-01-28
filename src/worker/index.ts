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

/**
 * Type-safe message event for worker requests
 */
type WorkerMessageEvent = MessageEvent<WorkerRequest>;

/**
 * Post a typed response back to the main thread
 */
function postResponse(response: WorkerResponse): void {
  self.postMessage(response);
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
  const request = event.data;

  switch (request.type) {
    case 'ping':
      postResponse({ type: 'pong' });
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

// Signal that the worker is ready
postResponse({ type: 'pong' });
