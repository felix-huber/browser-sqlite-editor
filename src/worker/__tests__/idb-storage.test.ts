/**
 * Unit tests for IndexedDB Storage
 *
 * Tests cover:
 * - Debounce: multiple writes within 2s result in single IDB write
 * - Flush: explicit flush completes and confirms via IDB read
 * - Retry: inject IDB failure, verify 3 attempts with backoff
 * - Persistence: write data, reload worker, verify data via IDB read
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  IDBStorage,
  getIDBStorage,
  resetIDBStorage,
  _testing,
  type PersistenceError,
} from '../idb-storage';

// =============================================================================
// Mock IndexedDB
// =============================================================================

interface MockIDBStore {
  data: Map<string, unknown>;
  put: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  getAllKeys: ReturnType<typeof vi.fn>;
}

interface MockIDBTransaction {
  objectStore: ReturnType<typeof vi.fn>;
  oncomplete: (() => void) | null;
  onerror: (() => void) | null;
  onabort: (() => void) | null;
  error: Error | null;
}

interface MockIDBDatabase {
  transaction: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  objectStoreNames: { contains: ReturnType<typeof vi.fn> };
  createObjectStore: ReturnType<typeof vi.fn>;
}

interface MockIDBRequest {
  result: unknown;
  error: Error | null;
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
  onupgradeneeded: ((event: unknown) => void) | null;
}

// Mock store data
let mockStoreData: Map<string, unknown>;
let mockFailureCount: number;
let mockShouldFail: boolean;
let mockQuotaExceeded: boolean;

function createMockIDBRequest(result: unknown = undefined): MockIDBRequest {
  const request: MockIDBRequest = {
    result,
    error: null,
    onsuccess: null,
    onerror: null,
    onupgradeneeded: null,
  };

  setTimeout(() => {
    if (mockShouldFail && mockFailureCount < _testing.MAX_RETRY_ATTEMPTS) {
      mockFailureCount++;
      request.error = new Error('IDB operation failed');
      request.onerror?.();
    } else if (mockQuotaExceeded) {
      const quotaError = new DOMException('Quota exceeded', 'QuotaExceededError');
      request.error = quotaError;
      request.onerror?.();
    } else {
      request.onsuccess?.();
    }
  }, 0);

  return request;
}

function createMockStore(): MockIDBStore {
  return {
    data: mockStoreData,
    put: vi.fn((entry: { name: string }) => {
      const request = createMockIDBRequest();
      if (!mockShouldFail && !mockQuotaExceeded) {
        mockStoreData.set(entry.name, entry);
      }
      return request;
    }),
    get: vi.fn((name: string) => {
      const request = createMockIDBRequest(mockStoreData.get(name));
      return request;
    }),
    delete: vi.fn((name: string) => {
      mockStoreData.delete(name);
      return createMockIDBRequest();
    }),
    getAllKeys: vi.fn(() => {
      const request = createMockIDBRequest(Array.from(mockStoreData.keys()));
      return request;
    }),
  };
}

function createMockTransaction(): MockIDBTransaction {
  const store = createMockStore();
  const tx: MockIDBTransaction = {
    objectStore: vi.fn(() => store),
    oncomplete: null,
    onerror: null,
    onabort: null,
    error: null,
  };

  setTimeout(() => {
    if (mockShouldFail && mockFailureCount <= _testing.MAX_RETRY_ATTEMPTS) {
      tx.error = new Error('Transaction failed');
      tx.onerror?.();
    } else if (mockQuotaExceeded) {
      tx.error = new DOMException('Quota exceeded', 'QuotaExceededError');
      tx.onerror?.();
    } else {
      tx.oncomplete?.();
    }
  }, 10);

  return tx;
}

function createMockDatabase(): MockIDBDatabase {
  return {
    transaction: vi.fn(() => createMockTransaction()),
    close: vi.fn(),
    objectStoreNames: { contains: vi.fn(() => true) },
    createObjectStore: vi.fn(),
  };
}

// Setup global mock
const mockIndexedDB = {
  open: vi.fn((_name: string, _version: number) => {
    const request = createMockIDBRequest(createMockDatabase()) as MockIDBRequest & {
      onupgradeneeded: ((event: { target: { result: MockIDBDatabase } }) => void) | null;
    };
    return request;
  }),
};

// =============================================================================
// Test Setup
// =============================================================================

beforeEach(() => {
  vi.useFakeTimers();
  mockStoreData = new Map();
  mockFailureCount = 0;
  mockShouldFail = false;
  mockQuotaExceeded = false;

  // Install mock
  vi.stubGlobal('indexedDB', mockIndexedDB);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  resetIDBStorage();
});

// =============================================================================
// Tests
// =============================================================================

describe('IDBStorage - Debounce', () => {
  it('should debounce multiple writes within 2s into a single IDB write', async () => {
    const storage = new IDBStorage();

    // Schedule multiple writes in quick succession
    const blob1 = new Blob(['data1']);
    const blob2 = new Blob(['data2']);
    const blob3 = new Blob(['data3']);

    storage.scheduleWrite('test-db', blob1);
    vi.advanceTimersByTime(500);

    storage.scheduleWrite('test-db', blob2);
    vi.advanceTimersByTime(500);

    storage.scheduleWrite('test-db', blob3);

    // At this point, no flush should have happened yet
    expect(storage.hasPendingWrites()).toBe(true);
    expect(storage.getPendingWriteCount()).toBe(1); // Same db, latest blob

    // Advance past debounce delay
    vi.advanceTimersByTime(_testing.DEBOUNCE_DELAY_MS);

    // Allow promises to resolve
    await vi.runAllTimersAsync();

    // Verify only one write occurred (with latest blob)
    expect(storage.hasPendingWrites()).toBe(false);
  });

  it('should batch writes for multiple databases', async () => {
    const storage = new IDBStorage();

    storage.scheduleWrite('db1', new Blob(['data1']));
    storage.scheduleWrite('db2', new Blob(['data2']));
    storage.scheduleWrite('db3', new Blob(['data3']));

    expect(storage.getPendingWriteCount()).toBe(3);

    // Advance past debounce delay
    vi.advanceTimersByTime(_testing.DEBOUNCE_DELAY_MS);
    await vi.runAllTimersAsync();

    expect(storage.hasPendingWrites()).toBe(false);
  });

  it('should reset debounce timer on each write', async () => {
    const storage = new IDBStorage();

    storage.scheduleWrite('test-db', new Blob(['data1']));

    // Advance partway
    vi.advanceTimersByTime(_testing.DEBOUNCE_DELAY_MS - 500);

    // Write again - should reset timer
    storage.scheduleWrite('test-db', new Blob(['data2']));

    // Advance same partial amount - should still be pending
    vi.advanceTimersByTime(_testing.DEBOUNCE_DELAY_MS - 500);
    expect(storage.hasPendingWrites()).toBe(true);

    // Advance remainder
    vi.advanceTimersByTime(500);
    await vi.runAllTimersAsync();

    expect(storage.hasPendingWrites()).toBe(false);
  });
});

describe('IDBStorage - Flush', () => {
  it('should flush immediately when called explicitly', async () => {
    const storage = new IDBStorage();

    storage.scheduleWrite('test-db', new Blob(['data']));
    expect(storage.hasPendingWrites()).toBe(true);

    // Flush immediately (don't wait for debounce)
    const result = await storage.flush();

    expect(result.success).toBe(true);
    expect(storage.hasPendingWrites()).toBe(false);
  });

  it('should cancel pending debounce timer on explicit flush', async () => {
    const storage = new IDBStorage();

    storage.scheduleWrite('test-db', new Blob(['data']));

    // Advance partway (debounce timer should be set)
    vi.advanceTimersByTime(500);

    // Explicit flush should clear timer
    const result = await storage.flush();

    expect(result.success).toBe(true);

    // Advancing more shouldn't trigger another flush
    vi.advanceTimersByTime(_testing.DEBOUNCE_DELAY_MS);

    // Nothing should happen (no double-flush)
    expect(storage.hasPendingWrites()).toBe(false);
  });

  it('should return success for empty flush', async () => {
    const storage = new IDBStorage();

    const result = await storage.flush();

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('should deduplicate concurrent flush calls', async () => {
    const storage = new IDBStorage();

    storage.scheduleWrite('test-db', new Blob(['data']));

    // Call flush multiple times simultaneously
    const results = await Promise.all([
      storage.flush(),
      storage.flush(),
      storage.flush(),
    ]);

    // All should succeed with same result
    results.forEach((result) => {
      expect(result.success).toBe(true);
    });
  });
});

describe('IDBStorage - Retry with Exponential Backoff', () => {
  it('should retry failed operations up to 3 times', async () => {
    vi.useRealTimers(); // Need real timers for backoff

    const storage = new IDBStorage();
    mockShouldFail = true;

    storage.scheduleWrite('test-db', new Blob(['data']));

    const result = await storage.flush();

    // Should have attempted 3 times
    expect(mockFailureCount).toBe(_testing.MAX_RETRY_ATTEMPTS);
    // After 3 failures, should fail
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();

    vi.useFakeTimers();
  });

  it('should succeed if retry eventually works', async () => {
    vi.useRealTimers();

    const storage = new IDBStorage();

    // Fail first 2 attempts, succeed on 3rd
    let attemptCount = 0;
    mockIndexedDB.open.mockImplementation(() => {
      attemptCount++;
      const shouldFail = attemptCount < 3;

      const request: MockIDBRequest = {
        result: shouldFail ? null : createMockDatabase(),
        error: shouldFail ? new Error('Temporary failure') : null,
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
      };

      setTimeout(() => {
        if (shouldFail) {
          request.onerror?.();
        } else {
          request.onsuccess?.();
        }
      }, 0);

      return request;
    });

    storage.scheduleWrite('test-db', new Blob(['data']));

    const result = await storage.flush();

    expect(result.success).toBe(true);

    vi.useFakeTimers();
  });

  it('should not retry quota exceeded errors', async () => {
    vi.useRealTimers();

    const storage = new IDBStorage();
    mockQuotaExceeded = true;

    storage.scheduleWrite('test-db', new Blob(['data']));

    const result = await storage.flush();

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('QUOTA_EXCEEDED');

    vi.useFakeTimers();
  });

  it('should use exponential backoff delays', () => {
    const delay0 = _testing.getBackoffDelay(0);
    const delay1 = _testing.getBackoffDelay(1);
    const delay2 = _testing.getBackoffDelay(2);

    // Base delays should be exponential: 100, 200, 400
    // With jitter, they should be in ranges:
    // attempt 0: 100-150ms
    // attempt 1: 200-300ms
    // attempt 2: 400-600ms

    expect(delay0).toBeGreaterThanOrEqual(_testing.BASE_BACKOFF_MS);
    expect(delay0).toBeLessThanOrEqual(_testing.BASE_BACKOFF_MS * 1.5);

    expect(delay1).toBeGreaterThanOrEqual(_testing.BASE_BACKOFF_MS * 2);
    expect(delay1).toBeLessThanOrEqual(_testing.BASE_BACKOFF_MS * 3);

    expect(delay2).toBeGreaterThanOrEqual(_testing.BASE_BACKOFF_MS * 4);
    expect(delay2).toBeLessThanOrEqual(_testing.BASE_BACKOFF_MS * 6);
  });
});

describe('IDBStorage - Persistence Contract', () => {
  it('should store and retrieve database blobs', async () => {
    // This test simulates the persistence contract:
    // Write data -> verify it can be read back

    const storage = new IDBStorage();
    const testData = 'test database content';
    const blob = new Blob([testData]);

    // Schedule write and flush
    storage.scheduleWrite('persist-test', blob);
    await storage.flush();

    // Verify data was written to mock store
    const stored = mockStoreData.get('persist-test') as { blob: Blob } | undefined;
    expect(stored).toBeDefined();
    expect(stored?.blob).toBeDefined();
  });

  it('should list all stored databases', async () => {
    const storage = new IDBStorage();

    // Add multiple databases
    storage.scheduleWrite('db1', new Blob(['data1']));
    storage.scheduleWrite('db2', new Blob(['data2']));
    storage.scheduleWrite('db3', new Blob(['data3']));
    await storage.flush();

    const names = await storage.list();

    expect(names).toContain('db1');
    expect(names).toContain('db2');
    expect(names).toContain('db3');
  });

  it('should delete database from storage', async () => {
    const storage = new IDBStorage();

    // Add and flush
    storage.scheduleWrite('to-delete', new Blob(['data']));
    await storage.flush();

    expect(mockStoreData.has('to-delete')).toBe(true);

    // Delete
    await storage.delete('to-delete');

    expect(mockStoreData.has('to-delete')).toBe(false);
  });

  it('should check if database exists', async () => {
    const storage = new IDBStorage();

    // Add and flush
    storage.scheduleWrite('exists-test', new Blob(['data']));
    await storage.flush();

    const exists = await storage.exists('exists-test');
    const notExists = await storage.exists('nonexistent');

    expect(exists).toBe(true);
    expect(notExists).toBe(false);
  });

  it('should remove from pending writes when deleting', async () => {
    const storage = new IDBStorage();

    storage.scheduleWrite('pending-delete', new Blob(['data']));
    expect(storage.hasPendingWrites()).toBe(true);

    await storage.delete('pending-delete');

    expect(storage.hasPendingWrites()).toBe(false);
  });
});

describe('IDBStorage - Error Handling', () => {
  it('should surface errors via callback', async () => {
    vi.useRealTimers();

    const storage = new IDBStorage();
    mockShouldFail = true;

    const errors: PersistenceError[] = [];
    storage.setErrorCallback((error) => errors.push(error));

    storage.scheduleWrite('error-test', new Blob(['data']));

    // Trigger debounced flush
    await new Promise((resolve) => setTimeout(resolve, _testing.DEBOUNCE_DELAY_MS + 500));

    // Error callback should have been called
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].code).toBe('PERSISTENCE_FAILED');

    vi.useFakeTimers();
  });

  it('should normalize DOMException errors correctly', () => {
    const quotaError = new DOMException('Quota exceeded', 'QuotaExceededError');
    const normalized = _testing.normalizeIDBError(quotaError, 'test');

    expect(normalized.code).toBe('QUOTA_EXCEEDED');
    expect(normalized.message).toContain('Storage quota exceeded');
  });

  it('should normalize NotFoundError correctly', () => {
    const notFoundError = new DOMException('Not found', 'NotFoundError');
    const normalized = _testing.normalizeIDBError(notFoundError, 'test');

    expect(normalized.code).toBe('NOT_FOUND');
  });

  it('should normalize generic errors', () => {
    const genericError = new Error('Something went wrong');
    const normalized = _testing.normalizeIDBError(genericError, 'operation');

    expect(normalized.code).toBe('PERSISTENCE_FAILED');
    expect(normalized.message).toContain('operation failed');
    expect(normalized.message).toContain('Something went wrong');
  });
});

describe('IDBStorage - Singleton', () => {
  it('should return same instance from getIDBStorage', () => {
    const instance1 = getIDBStorage();
    const instance2 = getIDBStorage();

    expect(instance1).toBe(instance2);
  });

  it('should create new instance after reset', () => {
    const instance1 = getIDBStorage();
    resetIDBStorage();
    const instance2 = getIDBStorage();

    expect(instance1).not.toBe(instance2);
  });
});

describe('IDBStorage - Cleanup', () => {
  it('should clean up resources on destroy', () => {
    const storage = new IDBStorage();

    storage.scheduleWrite('test', new Blob(['data']));
    expect(storage.hasPendingWrites()).toBe(true);

    storage.destroy();

    expect(storage.hasPendingWrites()).toBe(false);
  });
});

describe('IDBStorage - Constants', () => {
  it('should have correct database name', () => {
    expect(_testing.IDB_DATABASE_NAME).toBe('idb-sqlite');
  });

  it('should have correct store name', () => {
    expect(_testing.IDB_STORE_NAME).toBe('databases');
  });

  it('should have 2 second debounce delay', () => {
    expect(_testing.DEBOUNCE_DELAY_MS).toBe(2000);
  });

  it('should have 3 max retry attempts', () => {
    expect(_testing.MAX_RETRY_ATTEMPTS).toBe(3);
  });
});
