/**
 * Unit tests for WorkerClient
 *
 * Tests the main-thread client for database worker communication,
 * including request/response correlation, timeouts, and error handling.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  WorkerClient,
  WorkerError,
  WorkerTimeoutError,
  WorkerCrashError,
  getWorkerClient,
} from '../worker-client';

// =============================================================================
// Mock Worker
// =============================================================================

/**
 * Mock worker type with test helpers
 */
type MockWorker = Worker & {
  postMessage: ReturnType<typeof vi.fn>;
  terminate: ReturnType<typeof vi.fn>;
  simulateMessage: (data: unknown) => void;
  simulateError: (message: string) => void;
};

/**
 * Create a mock Worker for testing
 */
function createMockWorker(): MockWorker {
  const handlers: {
    onmessage: ((event: MessageEvent) => void) | null;
    onerror: ((event: ErrorEvent) => void) | null;
  } = {
    onmessage: null,
    onerror: null,
  };

  const postMessageFn = vi.fn();
  const terminateFn = vi.fn();

  const mockWorker = {
    postMessage: postMessageFn,
    terminate: terminateFn,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
    onmessageerror: null,
    set onmessage(fn: ((event: MessageEvent) => void) | null) {
      handlers.onmessage = fn;
    },
    get onmessage() {
      return handlers.onmessage;
    },
    set onerror(fn: ((event: ErrorEvent) => void) | null) {
      handlers.onerror = fn;
    },
    get onerror() {
      return handlers.onerror;
    },
    // Helper to simulate receiving a message
    simulateMessage(data: unknown) {
      if (handlers.onmessage) {
        handlers.onmessage({ data } as MessageEvent);
      }
    },
    // Helper to simulate a worker error
    simulateError(message: string) {
      if (handlers.onerror) {
        handlers.onerror({ message } as ErrorEvent);
      }
    },
  };

  return mockWorker as MockWorker;
}

// =============================================================================
// Tests
// =============================================================================

describe('WorkerClient - Initialization', () => {
  it('should start in not-ready state', () => {
    const client = new WorkerClient();
    expect(client.isReady()).toBe(false);
  });

  it('should be ready after init with worker', () => {
    const client = new WorkerClient();
    const mockWorker = createMockWorker();
    client.init(mockWorker);
    expect(client.isReady()).toBe(true);
  });

  it('should accept worker in constructor options', () => {
    const mockWorker = createMockWorker();
    const client = new WorkerClient({ worker: mockWorker });
    expect(client.isReady()).toBe(true);
  });

  it('should throw when requesting without initialization', async () => {
    const client = new WorkerClient();
    await expect(client.request({ type: 'ping' })).rejects.toThrow('Worker not initialized');
  });
});

describe('WorkerClient - Simple Request/Response', () => {
  let client: WorkerClient;
  let mockWorker: MockWorker;

  beforeEach(() => {
    mockWorker = createMockWorker();
    client = new WorkerClient({ worker: mockWorker });
  });

  afterEach(() => {
    client.terminate();
  });

  it('should send request and receive response', async () => {
    const responsePromise = client.request({ type: 'ping' });

    // Get the request ID from the posted message
    expect(mockWorker.postMessage).toHaveBeenCalledTimes(1);
    const postedMessage = mockWorker.postMessage.mock.calls[0][0];
    expect(postedMessage.id).toBeDefined();
    expect(postedMessage.request).toEqual({ type: 'ping' });

    // Simulate worker response
    mockWorker.simulateMessage({ id: postedMessage.id, type: 'pong' });

    const response = await responsePromise;
    expect(response.type).toBe('pong');
  });

  it('should handle query request and return result', async () => {
    const queryPromise = client.query('SELECT * FROM users');

    const postedMessage = mockWorker.postMessage.mock.calls[0][0];
    expect(postedMessage.request.type).toBe('query');
    expect(postedMessage.request.sql).toBe('SELECT * FROM users');

    mockWorker.simulateMessage({
      id: postedMessage.id,
      type: 'queryResult',
      result: {
        columns: ['id', 'name'],
        columnTypes: ['INTEGER', 'TEXT'],
        rows: [[1, 'Alice']],
      },
    });

    const result = await queryPromise;
    expect(result.columns).toEqual(['id', 'name']);
    expect(result.rows).toEqual([[1, 'Alice']]);
  });

  it('should handle exec request and return affected count', async () => {
    const execPromise = client.exec('DELETE FROM users WHERE id = ?', [1]);

    const postedMessage = mockWorker.postMessage.mock.calls[0][0];
    expect(postedMessage.request.type).toBe('exec');
    expect(postedMessage.request.sql).toBe('DELETE FROM users WHERE id = ?');
    expect(postedMessage.request.params).toEqual([1]);

    mockWorker.simulateMessage({
      id: postedMessage.id,
      type: 'success',
      data: { rowsAffected: 1 },
    });

    const result = await execPromise;
    expect(result.rowsAffected).toBe(1);
  });
});

describe('WorkerClient - Request Timeout', () => {
  let client: WorkerClient;
  let mockWorker: MockWorker;

  beforeEach(() => {
    vi.useFakeTimers();
    mockWorker = createMockWorker();
    client = new WorkerClient({ worker: mockWorker, timeout: 100 });
  });

  afterEach(() => {
    client.terminate();
    vi.useRealTimers();
  });

  it('should reject after timeout', async () => {
    const responsePromise = client.request({ type: 'ping' });

    // Advance time past the timeout
    vi.advanceTimersByTime(150);

    await expect(responsePromise).rejects.toThrow(WorkerTimeoutError);
    expect(client.getPendingCount()).toBe(0);
  });

  it('should use custom timeout when provided', async () => {
    const responsePromise = client.request({ type: 'ping' }, 50);

    // Not timed out yet
    vi.advanceTimersByTime(40);
    expect(client.getPendingCount()).toBe(1);

    // Now timed out
    vi.advanceTimersByTime(20);

    await expect(responsePromise).rejects.toThrow(WorkerTimeoutError);
  });

  it('should clear timeout when response received', async () => {
    const responsePromise = client.request({ type: 'ping' });

    // Respond before timeout
    vi.advanceTimersByTime(50);
    const postedMessage = mockWorker.postMessage.mock.calls[0][0];
    mockWorker.simulateMessage({ id: postedMessage.id, type: 'pong' });

    const response = await responsePromise;
    expect(response.type).toBe('pong');

    // Advance past original timeout - should not affect resolved promise
    vi.advanceTimersByTime(100);
    expect(client.getPendingCount()).toBe(0);
  });
});

describe('WorkerClient - Worker Crash Detection', () => {
  let client: WorkerClient;
  let mockWorker: MockWorker;

  beforeEach(() => {
    mockWorker = createMockWorker();
    client = new WorkerClient({ worker: mockWorker });
  });

  afterEach(() => {
    client.terminate();
  });

  it('should reject all pending requests on worker error', async () => {
    const promise1 = client.request({ type: 'ping' });
    const promise2 = client.request({ type: 'schema' });

    expect(client.getPendingCount()).toBe(2);

    // Simulate worker crash
    mockWorker.simulateError('Worker crashed');

    await expect(promise1).rejects.toThrow(WorkerCrashError);
    await expect(promise2).rejects.toThrow(WorkerCrashError);
    expect(client.getPendingCount()).toBe(0);
  });

  it('should include error message in WorkerCrashError', async () => {
    const promise = client.request({ type: 'ping' });

    mockWorker.simulateError('Out of memory');

    try {
      await promise;
      expect.fail('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(WorkerCrashError);
      expect((error as Error).message).toBe('Out of memory');
    }
  });
});

describe('WorkerClient - Request Correlation', () => {
  let client: WorkerClient;
  let mockWorker: MockWorker;

  beforeEach(() => {
    mockWorker = createMockWorker();
    client = new WorkerClient({ worker: mockWorker });
  });

  afterEach(() => {
    client.terminate();
  });

  it('should correlate concurrent requests with correct responses', async () => {
    const promise1 = client.ping();
    const promise2 = client.getSchema();
    const promise3 = client.query('SELECT 1');

    expect(client.getPendingCount()).toBe(3);

    const calls = mockWorker.postMessage.mock.calls;
    const id1 = calls[0][0].id;
    const id2 = calls[1][0].id;
    const id3 = calls[2][0].id;

    // Respond out of order
    mockWorker.simulateMessage({
      id: id3,
      type: 'queryResult',
      result: { columns: ['1'], columnTypes: ['INTEGER'], rows: [[1]] },
    });
    mockWorker.simulateMessage({ id: id1, type: 'pong' });
    mockWorker.simulateMessage({
      id: id2,
      type: 'schemaResult',
      schema: { tables: ['t1'], views: [], indexes: [] },
    });

    // All should resolve correctly
    await expect(promise1).resolves.toBeUndefined();
    const result3 = await promise3;
    expect(result3.rows).toEqual([[1]]);
    const result2 = await promise2;
    expect(result2.tables).toEqual(['t1']);
  });

  it('should ignore responses for unknown request IDs', async () => {
    const promise = client.request({ type: 'ping' });
    const postedMessage = mockWorker.postMessage.mock.calls[0][0];

    // Send response with wrong ID
    mockWorker.simulateMessage({ id: 9999, type: 'pong' });

    // Original request should still be pending
    expect(client.getPendingCount()).toBe(1);

    // Now send correct response
    mockWorker.simulateMessage({ id: postedMessage.id, type: 'pong' });

    await expect(promise).resolves.toEqual({ type: 'pong' });
  });

  it('should ignore broadcast messages (no id)', async () => {
    const promise = client.request({ type: 'ping' });

    // Broadcast message without ID
    mockWorker.simulateMessage({ type: 'storageFull', dbName: 'test' });

    // Request should still be pending
    expect(client.getPendingCount()).toBe(1);

    // Send actual response
    const postedMessage = mockWorker.postMessage.mock.calls[0][0];
    mockWorker.simulateMessage({ id: postedMessage.id, type: 'pong' });

    await expect(promise).resolves.toBeDefined();
  });
});

describe('WorkerClient - Cancel Request', () => {
  let client: WorkerClient;
  let mockWorker: MockWorker;

  beforeEach(() => {
    mockWorker = createMockWorker();
    client = new WorkerClient({ worker: mockWorker });
  });

  afterEach(() => {
    client.terminate();
  });

  it('should send cancel message', async () => {
    const cancelPromise = client.cancel();

    const postedMessage = mockWorker.postMessage.mock.calls[0][0];
    expect(postedMessage.request.type).toBe('cancel');

    mockWorker.simulateMessage({ id: postedMessage.id, type: 'success' });

    await expect(cancelPromise).resolves.toBeUndefined();
  });
});

describe('WorkerClient - Error Handling', () => {
  let client: WorkerClient;
  let mockWorker: MockWorker;

  beforeEach(() => {
    mockWorker = createMockWorker();
    client = new WorkerClient({ worker: mockWorker });
  });

  afterEach(() => {
    client.terminate();
  });

  it('should reject with WorkerError on error response', async () => {
    const promise = client.query('INVALID SQL');

    const postedMessage = mockWorker.postMessage.mock.calls[0][0];
    mockWorker.simulateMessage({
      id: postedMessage.id,
      type: 'error',
      message: 'syntax error near "INVALID"',
      code: 'SYNTAX_ERROR',
    });

    try {
      await promise;
      expect.fail('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(WorkerError);
      expect((error as WorkerError).message).toBe('syntax error near "INVALID"');
      expect((error as WorkerError).code).toBe('SYNTAX_ERROR');
    }
  });

  it('should use UNKNOWN code when not provided', async () => {
    const promise = client.request({ type: 'ping' });

    const postedMessage = mockWorker.postMessage.mock.calls[0][0];
    mockWorker.simulateMessage({
      id: postedMessage.id,
      type: 'error',
      message: 'Unknown error',
    });

    try {
      await promise;
      expect.fail('Should have thrown');
    } catch (error) {
      expect((error as WorkerError).code).toBe('UNKNOWN');
    }
  });
});

describe('WorkerClient - Terminate', () => {
  let client: WorkerClient;
  let mockWorker: MockWorker;

  beforeEach(() => {
    mockWorker = createMockWorker();
    client = new WorkerClient({ worker: mockWorker });
  });

  it('should reject pending requests on terminate', async () => {
    const promise1 = client.request({ type: 'ping' });
    const promise2 = client.request({ type: 'schema' });

    client.terminate();

    await expect(promise1).rejects.toThrow(WorkerCrashError);
    await expect(promise2).rejects.toThrow(WorkerCrashError);
  });

  it('should call worker.terminate()', () => {
    client.terminate();
    expect(mockWorker.terminate).toHaveBeenCalledTimes(1);
  });

  it('should not be ready after terminate', () => {
    expect(client.isReady()).toBe(true);
    client.terminate();
    expect(client.isReady()).toBe(false);
  });

  it('should be safe to call terminate multiple times', () => {
    client.terminate();
    client.terminate();
    expect(mockWorker.terminate).toHaveBeenCalledTimes(1);
  });

  it('should reject new requests after terminate', async () => {
    client.terminate();
    await expect(client.request({ type: 'ping' })).rejects.toThrow('Worker not initialized');
  });
});

describe('WorkerClient - Singleton', () => {
  it('should return same instance from getWorkerClient', () => {
    const client1 = getWorkerClient();
    const client2 = getWorkerClient();
    expect(client1).toBe(client2);
  });
});

describe('WorkerClient - High-Level API', () => {
  let client: WorkerClient;
  let mockWorker: MockWorker;

  beforeEach(() => {
    mockWorker = createMockWorker();
    client = new WorkerClient({ worker: mockWorker });
  });

  afterEach(() => {
    client.terminate();
  });

  it('openDb should return lock status', async () => {
    const promise = client.openDb('testdb');

    const postedMessage = mockWorker.postMessage.mock.calls[0][0];
    expect(postedMessage.request).toEqual({ type: 'open', dbName: 'testdb' });

    mockWorker.simulateMessage({
      id: postedMessage.id,
      type: 'lockStatus',
      isWriter: true,
    });

    const result = await promise;
    expect(result.isWriter).toBe(true);
  });

  it('closeDb should complete successfully', async () => {
    const promise = client.closeDb();

    const postedMessage = mockWorker.postMessage.mock.calls[0][0];
    expect(postedMessage.request.type).toBe('close');

    mockWorker.simulateMessage({ id: postedMessage.id, type: 'success' });

    await expect(promise).resolves.toBeUndefined();
  });

  it('getTableInfo should return table info', async () => {
    const promise = client.getTableInfo('users');

    const postedMessage = mockWorker.postMessage.mock.calls[0][0];
    expect(postedMessage.request).toEqual({ type: 'tableInfo', table: 'users' });

    mockWorker.simulateMessage({
      id: postedMessage.id,
      type: 'tableInfoResult',
      tableInfo: {
        name: 'users',
        isView: false,
        isVirtual: false,
        withoutRowid: false,
        columns: [],
        indexes: [],
        createSql: 'CREATE TABLE users (id INTEGER)',
      },
    });

    const result = await promise;
    expect(result.name).toBe('users');
  });

  it('getForeignKeys should return FK list', async () => {
    const promise = client.getForeignKeys();

    const postedMessage = mockWorker.postMessage.mock.calls[0][0];
    expect(postedMessage.request.type).toBe('foreignKeys');

    mockWorker.simulateMessage({
      id: postedMessage.id,
      type: 'foreignKeysResult',
      foreignKeys: [
        {
          id: 0,
          childTable: 'orders',
          childColumn: 'user_id',
          parentTable: 'users',
          parentColumn: 'id',
          onUpdate: 'NO ACTION',
          onDelete: 'CASCADE',
          match: 'NONE',
        },
      ],
    });

    const result = await promise;
    expect(result).toHaveLength(1);
    expect(result[0].childTable).toBe('orders');
  });

  it('acquireLock should return lock status with stale flag', async () => {
    const promise = client.acquireLock('testdb');

    const postedMessage = mockWorker.postMessage.mock.calls[0][0];
    expect(postedMessage.request).toEqual({ type: 'acquireLock', dbName: 'testdb' });

    mockWorker.simulateMessage({
      id: postedMessage.id,
      type: 'lockStatus',
      isWriter: false,
      holderStale: true,
    });

    const result = await promise;
    expect(result.isWriter).toBe(false);
    expect(result.holderStale).toBe(true);
  });
});
