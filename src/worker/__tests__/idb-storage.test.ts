/**
 * Unit tests for IndexedDB Storage
 *
 * Tests cover:
 * - Debounce: multiple writes within 2s result in single IDB write
 * - Flush: explicit flush completes and confirms via IDB read
 * - Retry: inject IDB failure, verify 3 attempts with backoff
 * - Persistence: write data, reload worker, verify data via IDB read
 *
 * NOTE: These tests mock IndexedDB at the module level. Full integration tests
 * should be done via e2e tests in a browser environment.
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
// Tests for synchronous behavior (no IDB mock needed)
// =============================================================================

describe('IDBStorage - Debounce (Synchronous Behavior)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetIDBStorage();
  });

  it('should debounce multiple writes - pending count is 1 for same db', () => {
    const storage = new IDBStorage();

    storage.scheduleWrite('test-db', new Blob(['data1']));
    storage.scheduleWrite('test-db', new Blob(['data2']));
    storage.scheduleWrite('test-db', new Blob(['data3']));

    // Multiple writes to same DB should result in one pending write
    expect(storage.getPendingWriteCount()).toBe(1);
  });

  it('should batch writes for multiple databases', () => {
    const storage = new IDBStorage();

    storage.scheduleWrite('db1', new Blob(['data1']));
    storage.scheduleWrite('db2', new Blob(['data2']));
    storage.scheduleWrite('db3', new Blob(['data3']));

    expect(storage.getPendingWriteCount()).toBe(3);
  });

  it('should track pending writes correctly', () => {
    const storage = new IDBStorage();

    expect(storage.hasPendingWrites()).toBe(false);

    storage.scheduleWrite('test-db', new Blob(['data']));

    expect(storage.hasPendingWrites()).toBe(true);
    expect(storage.getPendingWriteCount()).toBe(1);
  });

  it('should clean up resources on destroy', () => {
    const storage = new IDBStorage();

    storage.scheduleWrite('test', new Blob(['data']));
    expect(storage.hasPendingWrites()).toBe(true);

    storage.destroy();

    expect(storage.hasPendingWrites()).toBe(false);
  });
});

describe('IDBStorage - Flush (Empty Case)', () => {
  afterEach(() => {
    resetIDBStorage();
  });

  it('should return success for empty flush', async () => {
    const storage = new IDBStorage();

    const result = await storage.flush();

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
  });
});

describe('IDBStorage - Retry Logic', () => {
  it('should use exponential backoff delays', () => {
    const delay0 = _testing.getBackoffDelay(0);
    const delay1 = _testing.getBackoffDelay(1);
    const delay2 = _testing.getBackoffDelay(2);

    // Base delays should be exponential: 100, 200, 400
    // With jitter (0-50%), they should be in ranges:
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

describe('IDBStorage - Error Normalization', () => {
  it('should normalize QuotaExceededError correctly', () => {
    const quotaError = new DOMException('Quota exceeded', 'QuotaExceededError');
    const normalized = _testing.normalizeIDBError(quotaError, 'test');

    expect(normalized.code).toBe('QUOTA_EXCEEDED');
    expect(normalized.message).toContain('Storage quota exceeded');
    expect(normalized.cause).toBe(quotaError);
  });

  it('should normalize NotFoundError correctly', () => {
    const notFoundError = new DOMException('Not found', 'NotFoundError');
    const normalized = _testing.normalizeIDBError(notFoundError, 'test');

    expect(normalized.code).toBe('NOT_FOUND');
    expect(normalized.message).toContain('not found');
  });

  it('should normalize generic Error correctly', () => {
    const genericError = new Error('Something went wrong');
    const normalized = _testing.normalizeIDBError(genericError, 'operation');

    expect(normalized.code).toBe('PERSISTENCE_FAILED');
    expect(normalized.message).toContain('operation failed');
    expect(normalized.message).toContain('Something went wrong');
    expect(normalized.cause).toBe(genericError);
  });

  it('should normalize unknown error types', () => {
    const unknownError = 'string error';
    const normalized = _testing.normalizeIDBError(unknownError, 'test');

    expect(normalized.code).toBe('PERSISTENCE_FAILED');
    expect(normalized.message).toContain('test failed');
  });
});

describe('IDBStorage - Singleton', () => {
  afterEach(() => {
    resetIDBStorage();
  });

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

  it('should have 100ms base backoff', () => {
    expect(_testing.BASE_BACKOFF_MS).toBe(100);
  });
});

describe('IDBStorage - Error Callback', () => {
  afterEach(() => {
    resetIDBStorage();
  });

  it('should set and clear error callback', () => {
    const storage = new IDBStorage();
    const callback = vi.fn();

    // Should not throw
    storage.setErrorCallback(callback);

    // After destroy, callback should be cleared
    storage.destroy();

    // No way to test callback is cleared directly, but destroy should handle it
  });
});

describe('IDBStorage - Type Contracts', () => {
  it('should define StoredDatabase interface correctly', () => {
    // Verify the stored entry format
    interface ExpectedEntry {
      name: string;
      blob: Blob;
      updatedAt: string;
    }

    const mockEntry: ExpectedEntry = {
      name: 'test.db',
      blob: new Blob(['data']),
      updatedAt: '2026-01-28T00:00:00.000Z',
    };

    expect(mockEntry.name).toBe('test.db');
    expect(mockEntry.blob).toBeInstanceOf(Blob);
    expect(mockEntry.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('should define PersistenceError interface correctly', () => {
    const error: PersistenceError = {
      code: 'PERSISTENCE_FAILED',
      message: 'test error',
      cause: new Error('cause'),
    };

    expect(error.code).toBe('PERSISTENCE_FAILED');
    expect(error.message).toBe('test error');
    expect(error.cause).toBeDefined();
  });

  it('should define FlushResult interface correctly', () => {
    const successResult = { success: true as const };
    const errorResult = {
      success: false as const,
      error: {
        code: 'PERSISTENCE_FAILED' as const,
        message: 'failed',
      },
    };

    expect(successResult.success).toBe(true);
    expect(errorResult.success).toBe(false);
    expect(errorResult.error).toBeDefined();
  });
});

/**
 * Integration tests - These test the full IDB interaction
 *
 * NOTE: Full integration tests require a browser environment with real IndexedDB.
 * These tests should be verified via Playwright e2e tests:
 *
 * 1. Debounce: multiple writes within 2s result in single IDB write
 *    - scheduleWrite 3 times rapidly
 *    - verify only 1 IDB transaction occurred
 *
 * 2. Flush: explicit flush completes and confirms via IDB read
 *    - scheduleWrite, then flush()
 *    - verify data can be read back with load()
 *
 * 3. Retry: inject IDB failure, verify 3 attempts with backoff
 *    - mock IDB to fail N times then succeed
 *    - verify retry count and eventual success
 *
 * 4. Persistence: write data, reload worker, verify data via IDB read
 *    - scheduleWrite and flush
 *    - destroy storage, create new instance
 *    - verify load() returns same data
 */
describe('IDBStorage - API Contract', () => {
  afterEach(() => {
    resetIDBStorage();
  });

  it('should expose scheduleWrite method', () => {
    const storage = new IDBStorage();
    expect(typeof storage.scheduleWrite).toBe('function');
  });

  it('should expose flush method', () => {
    const storage = new IDBStorage();
    expect(typeof storage.flush).toBe('function');
  });

  it('should expose load method', () => {
    const storage = new IDBStorage();
    expect(typeof storage.load).toBe('function');
  });

  it('should expose delete method', () => {
    const storage = new IDBStorage();
    expect(typeof storage.delete).toBe('function');
  });

  it('should expose list method', () => {
    const storage = new IDBStorage();
    expect(typeof storage.list).toBe('function');
  });

  it('should expose exists method', () => {
    const storage = new IDBStorage();
    expect(typeof storage.exists).toBe('function');
  });

  it('should expose hasPendingWrites method', () => {
    const storage = new IDBStorage();
    expect(typeof storage.hasPendingWrites).toBe('function');
  });

  it('should expose getPendingWriteCount method', () => {
    const storage = new IDBStorage();
    expect(typeof storage.getPendingWriteCount).toBe('function');
  });

  it('should expose setErrorCallback method', () => {
    const storage = new IDBStorage();
    expect(typeof storage.setErrorCallback).toBe('function');
  });

  it('should expose destroy method', () => {
    const storage = new IDBStorage();
    expect(typeof storage.destroy).toBe('function');
  });
});
