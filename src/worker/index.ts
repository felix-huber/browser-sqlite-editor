/**
 * Web Worker entry point for SQLite database operations
 *
 * This worker handles all database interactions off the main thread,
 * keeping the UI responsive during heavy operations.
 */

import type { WorkerRequest, WorkerResponse } from '../types';

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
 * Handle incoming messages from the main thread
 */
function handleMessage(event: WorkerMessageEvent): void {
  const request = event.data;

  switch (request.type) {
    case 'ping':
      postResponse({ type: 'pong' });
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
self.addEventListener('message', handleMessage);

// Signal that the worker is ready
postResponse({ type: 'pong' });
