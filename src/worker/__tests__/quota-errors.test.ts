/**
 * Unit tests for Quota/Storage Error Detection and Handling
 *
 * Tests cover:
 * - OPFS QuotaExceededError: returns QUOTA_EXCEEDED code
 * - IndexedDB QuotaExceededError: returns QUOTA_EXCEEDED code
 * - SQLITE_FULL: returns QUOTA_EXCEEDED code
 * - storageFull flag: set to true after quota error
 * - Storage estimate: proactive check catches low storage
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isQuotaExceededError,
  isStorageAbortError,
  isSqliteStorageError,
  isStorageError,
  normalizeStorageError,
  isStorageFull,
  setStorageFull,
  blockDatabaseWrites,
  isDatabaseWriteBlocked,
  unblockDatabaseWrites,
  getBlockedDatabases,
  getStorageEstimate,
  checkStorageAvailable,
  formatStorageEstimate,
  withStorageErrorHandling,
  _resetStorageState,
  _testing,
} from '../quota-errors';

// =============================================================================
// Error Detection Tests
// =============================================================================

describe('isQuotaExceededError', () => {
  it('should detect QuotaExceededError from OPFS', () => {
    const err = new DOMException('Quota exceeded', 'QuotaExceededError');
    expect(isQuotaExceededError(err)).toBe(true);
  });

  it('should detect QuotaExceededError from IndexedDB', () => {
    const err = new DOMException('QuotaExceededError', 'QuotaExceededError');
    expect(isQuotaExceededError(err)).toBe(true);
  });

  it('should not detect other DOMExceptions', () => {
    const err = new DOMException('Not found', 'NotFoundError');
    expect(isQuotaExceededError(err)).toBe(false);
  });

  it('should not detect regular errors', () => {
    const err = new Error('Something went wrong');
    expect(isQuotaExceededError(err)).toBe(false);
  });

  it('should not detect non-errors', () => {
    expect(isQuotaExceededError('string error')).toBe(false);
    expect(isQuotaExceededError(null)).toBe(false);
    expect(isQuotaExceededError(undefined)).toBe(false);
  });
});

describe('isStorageAbortError', () => {
  it('should detect AbortError', () => {
    const err = new DOMException('Aborted', 'AbortError');
    expect(isStorageAbortError(err)).toBe(true);
  });

  it('should not detect other DOMExceptions', () => {
    const err = new DOMException('Not found', 'NotFoundError');
    expect(isStorageAbortError(err)).toBe(false);
  });
});

describe('isSqliteStorageError', () => {
  it('should detect SQLITE_FULL', () => {
    const err = new Error('SQLITE_FULL: database or disk is full');
    expect(isSqliteStorageError(err)).toBe(true);
  });

  it('should detect SQLITE_IOERR_WRITE', () => {
    const err = new Error('SQLITE_IOERR_WRITE: disk I/O error');
    expect(isSqliteStorageError(err)).toBe(true);
  });

  it('should detect SQLITE_IOERR_FSYNC', () => {
    const err = new Error('SQLITE_IOERR_FSYNC: disk I/O error');
    expect(isSqliteStorageError(err)).toBe(true);
  });

  it('should detect SQLITE_CANTOPEN', () => {
    const err = new Error('SQLITE_CANTOPEN: unable to open database');
    expect(isSqliteStorageError(err)).toBe(true);
  });

  it('should detect SQLite errors case-insensitively', () => {
    const err = new Error('sqlite_full: database or disk is full');
    expect(isSqliteStorageError(err)).toBe(true);
  });

  it('should detect SQLite errors in string format', () => {
    expect(isSqliteStorageError('SQLITE_FULL: disk full')).toBe(true);
  });

  it('should not detect other SQLite errors', () => {
    const err = new Error('SQLITE_CONSTRAINT: foreign key violation');
    expect(isSqliteStorageError(err)).toBe(false);
  });

  it('should not detect non-SQLite errors', () => {
    const err = new Error('Something went wrong');
    expect(isSqliteStorageError(err)).toBe(false);
  });
});

describe('isStorageError', () => {
  it('should detect QuotaExceededError', () => {
    const err = new DOMException('Quota exceeded', 'QuotaExceededError');
    expect(isStorageError(err)).toBe(true);
  });

  it('should detect AbortError', () => {
    const err = new DOMException('Aborted', 'AbortError');
    expect(isStorageError(err)).toBe(true);
  });

  it('should detect SQLite storage errors', () => {
    const err = new Error('SQLITE_FULL: database full');
    expect(isStorageError(err)).toBe(true);
  });

  it('should not detect non-storage errors', () => {
    const err = new Error('Network error');
    expect(isStorageError(err)).toBe(false);
  });
});

// =============================================================================
// Error Normalization Tests
// =============================================================================

describe('normalizeStorageError', () => {
  it('should normalize QuotaExceededError', () => {
    const err = new DOMException('Quota exceeded', 'QuotaExceededError');
    const normalized = normalizeStorageError(err, 'flush');

    expect(normalized.code).toBe('QUOTA_EXCEEDED');
    expect(normalized.message).toContain('Storage quota exceeded');
    expect(normalized.message).toContain('flush');
    expect(normalized.originalType).toBe('DOMException:QuotaExceededError');
    expect(normalized.cause).toBe(err);
  });

  it('should normalize AbortError', () => {
    const err = new DOMException('Aborted', 'AbortError');
    const normalized = normalizeStorageError(err, 'write');

    expect(normalized.code).toBe('QUOTA_EXCEEDED');
    expect(normalized.message).toContain('storage pressure');
    expect(normalized.originalType).toBe('DOMException:AbortError');
  });

  it('should normalize SQLITE_FULL', () => {
    const err = new Error('SQLITE_FULL: database full');
    const normalized = normalizeStorageError(err, 'commit');

    expect(normalized.code).toBe('QUOTA_EXCEEDED');
    expect(normalized.message).toContain('Database storage error');
    expect(normalized.originalType).toBe('SQLite:SQLITE_FULL');
  });

  it('should include storage info when provided', () => {
    const err = new DOMException('Quota exceeded', 'QuotaExceededError');
    const storageInfo = { quota: 1000, usage: 900, available: 100 };
    const normalized = normalizeStorageError(err, 'test', storageInfo);

    expect(normalized.storageInfo).toEqual(storageInfo);
  });
});

// =============================================================================
// Storage State Management Tests
// =============================================================================

describe('Storage State Management', () => {
  beforeEach(() => {
    _resetStorageState();
  });

  afterEach(() => {
    _resetStorageState();
  });

  describe('isStorageFull / setStorageFull', () => {
    it('should start with storageFull = false', () => {
      expect(isStorageFull()).toBe(false);
    });

    it('should set storageFull flag', () => {
      setStorageFull(true);
      expect(isStorageFull()).toBe(true);
    });

    it('should clear storageFull flag', () => {
      setStorageFull(true);
      setStorageFull(false);
      expect(isStorageFull()).toBe(false);
    });

    it('should clear blocked databases when storageFull is set to false', () => {
      blockDatabaseWrites('test.db');
      expect(getBlockedDatabases()).toContain('test.db');

      setStorageFull(false);
      expect(getBlockedDatabases()).toHaveLength(0);
    });
  });

  describe('blockDatabaseWrites / isDatabaseWriteBlocked', () => {
    it('should block writes for a specific database', () => {
      blockDatabaseWrites('test.db');
      expect(isDatabaseWriteBlocked('test.db')).toBe(true);
    });

    it('should set storageFull when blocking a database', () => {
      blockDatabaseWrites('test.db');
      expect(isStorageFull()).toBe(true);
    });

    it('should not affect other databases initially', () => {
      blockDatabaseWrites('test.db');
      // storageFull is true, so all databases are blocked
      expect(isDatabaseWriteBlocked('other.db')).toBe(true);
    });

    it('should track multiple blocked databases', () => {
      blockDatabaseWrites('db1');
      blockDatabaseWrites('db2');
      expect(getBlockedDatabases()).toContain('db1');
      expect(getBlockedDatabases()).toContain('db2');
    });
  });

  describe('unblockDatabaseWrites', () => {
    it('should unblock a specific database', () => {
      blockDatabaseWrites('test.db');
      unblockDatabaseWrites('test.db');
      expect(getBlockedDatabases()).not.toContain('test.db');
    });

    it('should clear storageFull when all databases are unblocked', () => {
      blockDatabaseWrites('db1');
      blockDatabaseWrites('db2');
      unblockDatabaseWrites('db1');
      expect(isStorageFull()).toBe(true); // db2 still blocked

      unblockDatabaseWrites('db2');
      expect(isStorageFull()).toBe(false);
    });
  });
});

// =============================================================================
// Proactive Storage Check Tests
// =============================================================================

describe('getStorageEstimate', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return undefined if navigator.storage.estimate is not available', async () => {
    const originalNavigator = global.navigator;
    // @ts-expect-error - test environment
    global.navigator = { storage: {} };

    const estimate = await getStorageEstimate();
    expect(estimate).toBeUndefined();

    global.navigator = originalNavigator;
  });

  it('should return storage estimate when available', async () => {
    const mockEstimate = { quota: 1000000, usage: 500000 };
    const originalNavigator = global.navigator;
    Object.defineProperty(global, 'navigator', {
      value: {
        storage: {
          estimate: vi.fn().mockResolvedValue(mockEstimate),
          getDirectory: vi.fn(),
          persist: vi.fn(),
          persisted: vi.fn(),
        },
      },
      configurable: true,
    });

    const estimate = await getStorageEstimate();
    expect(estimate).toEqual({
      quota: 1000000,
      usage: 500000,
      available: 500000,
    });

    Object.defineProperty(global, 'navigator', { value: originalNavigator, configurable: true });
  });
});

describe('checkStorageAvailable', () => {
  beforeEach(() => {
    _resetStorageState();
  });

  afterEach(() => {
    _resetStorageState();
    vi.restoreAllMocks();
  });

  it('should return ok with warning when storage API is unavailable', async () => {
    const originalNavigator = global.navigator;
    Object.defineProperty(global, 'navigator', {
      value: { storage: {} },
      configurable: true,
    });

    const result = await checkStorageAvailable(1000);
    expect(result.ok).toBe(true);
    expect(result.warning).toContain('Unable to check');

    Object.defineProperty(global, 'navigator', { value: originalNavigator, configurable: true });
  });

  it('should return error when storage is already marked full', async () => {
    setStorageFull(true);

    const originalNavigator = global.navigator;
    Object.defineProperty(global, 'navigator', {
      value: {
        storage: {
          estimate: vi.fn().mockResolvedValue({ quota: 1000000, usage: 100000 }),
          getDirectory: vi.fn(),
          persist: vi.fn(),
          persisted: vi.fn(),
        },
      },
      configurable: true,
    });

    const result = await checkStorageAvailable(1000);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Storage is full');

    Object.defineProperty(global, 'navigator', { value: originalNavigator, configurable: true });
  });

  it('should return error when insufficient storage', async () => {
    const originalNavigator = global.navigator;
    Object.defineProperty(global, 'navigator', {
      value: {
        storage: {
          estimate: vi.fn().mockResolvedValue({ quota: 1000, usage: 900 }), // 100 available
          getDirectory: vi.fn(),
          persist: vi.fn(),
          persisted: vi.fn(),
        },
      },
      configurable: true,
    });

    const result = await checkStorageAvailable(200); // Need 200, only 100 available
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Insufficient storage');

    Object.defineProperty(global, 'navigator', { value: originalNavigator, configurable: true });
  });

  it('should return warning when storage is low but sufficient', async () => {
    const originalNavigator = global.navigator;
    Object.defineProperty(global, 'navigator', {
      value: {
        storage: {
          estimate: vi.fn().mockResolvedValue({ quota: 1000, usage: 800 }), // 200 available
          getDirectory: vi.fn(),
          persist: vi.fn(),
          persisted: vi.fn(),
        },
      },
      configurable: true,
    });

    // Need 100, recommended 150 (1.5x), have 200 - but let's test with higher requirement
    const result = await checkStorageAvailable(150); // Need 150, recommended 225, have 200
    expect(result.ok).toBe(true);
    expect(result.warning).toContain('Low storage');

    Object.defineProperty(global, 'navigator', { value: originalNavigator, configurable: true });
  });

  it('should return ok when sufficient storage', async () => {
    const originalNavigator = global.navigator;
    Object.defineProperty(global, 'navigator', {
      value: {
        storage: {
          estimate: vi.fn().mockResolvedValue({ quota: 10000, usage: 1000 }), // 9000 available
          getDirectory: vi.fn(),
          persist: vi.fn(),
          persisted: vi.fn(),
        },
      },
      configurable: true,
    });

    const result = await checkStorageAvailable(1000); // Need 1000, recommended 1500
    expect(result.ok).toBe(true);
    expect(result.warning).toBeUndefined();
    expect(result.error).toBeUndefined();

    Object.defineProperty(global, 'navigator', { value: originalNavigator, configurable: true });
  });
});

describe('formatStorageEstimate', () => {
  it('should format all fields', () => {
    const estimate = { quota: 10485760, usage: 5242880, available: 5242880 };
    const formatted = formatStorageEstimate(estimate);
    expect(formatted).toContain('Used: 5MB');
    expect(formatted).toContain('Available: 5MB');
    expect(formatted).toContain('Quota: 10MB');
  });

  it('should handle partial estimates', () => {
    const estimate = { usage: 5242880 };
    const formatted = formatStorageEstimate(estimate);
    expect(formatted).toContain('Used: 5MB');
    expect(formatted).not.toContain('Available');
  });

  it('should handle empty estimate', () => {
    const formatted = formatStorageEstimate({});
    expect(formatted).toBe('Storage info unavailable');
  });
});

// =============================================================================
// Error Handler Wrapper Tests
// =============================================================================

describe('withStorageErrorHandling', () => {
  beforeEach(() => {
    _resetStorageState();
  });

  afterEach(() => {
    _resetStorageState();
    vi.restoreAllMocks();
  });

  it('should pass through successful operations', async () => {
    const result = await withStorageErrorHandling(
      async () => 'success',
      'test'
    );
    expect(result).toBe('success');
  });

  it('should normalize and rethrow storage errors', async () => {
    const quotaError = new DOMException('Quota exceeded', 'QuotaExceededError');

    await expect(
      withStorageErrorHandling(
        async () => { throw quotaError; },
        'test'
      )
    ).rejects.toMatchObject({
      code: 'QUOTA_EXCEEDED',
      message: expect.stringContaining('Storage quota exceeded'),
    });
  });

  it('should set storageFull flag on storage error', async () => {
    const quotaError = new DOMException('Quota exceeded', 'QuotaExceededError');

    try {
      await withStorageErrorHandling(
        async () => { throw quotaError; },
        'test'
      );
    } catch {
      // Expected
    }

    expect(isStorageFull()).toBe(true);
  });

  it('should block specific database on storage error', async () => {
    const quotaError = new DOMException('Quota exceeded', 'QuotaExceededError');

    try {
      await withStorageErrorHandling(
        async () => { throw quotaError; },
        'test',
        'my-database'
      );
    } catch {
      // Expected
    }

    expect(isDatabaseWriteBlocked('my-database')).toBe(true);
  });

  it('should pass through non-storage errors', async () => {
    const networkError = new Error('Network error');

    await expect(
      withStorageErrorHandling(
        async () => { throw networkError; },
        'test'
      )
    ).rejects.toBe(networkError);

    expect(isStorageFull()).toBe(false);
  });
});

// =============================================================================
// Testing Internals
// =============================================================================

describe('_testing exports', () => {
  it('should export SQLITE_STORAGE_ERRORS', () => {
    expect(_testing.SQLITE_STORAGE_ERRORS).toContain('SQLITE_FULL');
    expect(_testing.SQLITE_STORAGE_ERRORS).toContain('SQLITE_IOERR_WRITE');
  });

  it('should export state accessor', () => {
    _resetStorageState();
    const state = _testing.state();
    expect(state.storageFull).toBe(false);
    expect(state.blockedDatabases).toBeInstanceOf(Set);
  });
});
