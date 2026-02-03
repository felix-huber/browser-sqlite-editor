/**
 * Unit tests for Zustand Store
 *
 * Tests cover:
 * - Initial state: all fields have expected defaults
 * - setActiveDb: updates activeDbId and resets schema
 * - setReadOnly: updates isReadOnly
 * - setStorageStatus: updates storageStatus
 * - Selectors: return correct derived state
 * - Database actions: loadRegistry, openDb, closeDb, createDb, deleteDb, renameDb, refreshSchema
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  useDatabaseStore,
  useActiveDb,
  useIsReadOnly,
  useTables,
  useStorageStatus,
  useViews,
  useIndexes,
  useStorageMode,
  useLockHolder,
  useDatabases,
  useIsStorageFull,
  useCanWrite,
  getState,
  setActionDeps,
  resetActionDeps,
  loadRegistry,
  openDb,
  closeDb,
  createDb,
  deleteDb,
  renameDb,
  refreshSchema,
  type SchemaState,
} from '../index';
import type { DatabaseEntry } from '../../types';

// =============================================================================
// Test Data
// =============================================================================

const mockDatabase1: DatabaseEntry = {
  name: 'test-db-1',
  file: 'test_db_1.sqlite',
  createdAt: '2026-01-28T00:00:00.000Z',
  lastOpenedAt: '2026-01-28T00:00:00.000Z',
  fkEnforced: true,
};

const mockDatabase2: DatabaseEntry = {
  name: 'test-db-2',
  file: 'test_db_2.sqlite',
  createdAt: '2026-01-28T01:00:00.000Z',
  lastOpenedAt: '2026-01-28T01:00:00.000Z',
  fkEnforced: false,
};

const mockSchema: SchemaState = {
  tables: ['users', 'posts', 'comments'],
  views: ['active_users'],
  indexes: ['idx_users_email'],
};

// =============================================================================
// Test Setup
// =============================================================================

beforeEach(() => {
  // Reset store to initial state before each test
  useDatabaseStore.getState().reset();
});

// =============================================================================
// Initial State Tests
// =============================================================================

describe('Zustand Store - Initial State', () => {
  it('should have empty databases array', () => {
    const state = getState();
    expect(state.databases).toEqual([]);
  });

  it('should have null activeDbId', () => {
    const state = getState();
    expect(state.activeDbId).toBeNull();
  });

  it('should have null schema', () => {
    const state = getState();
    expect(state.schema).toBeNull();
  });

  it('should have isReadOnly set to false', () => {
    const state = getState();
    expect(state.isReadOnly).toBe(false);
  });

  it('should have lockHolder set to null', () => {
    const state = getState();
    expect(state.lockHolder).toBeNull();
  });

  it('should have storageStatus set to "ok"', () => {
    const state = getState();
    expect(state.storageStatus).toBe('ok');
  });

  it('should have storageMode set to null', () => {
    const state = getState();
    expect(state.storageMode).toBeNull();
  });
});

// =============================================================================
// Action Tests
// =============================================================================

describe('Zustand Store - setDatabases', () => {
  it('should set the databases array', () => {
    const { result } = renderHook(() => useDatabaseStore());

    act(() => {
      result.current.setDatabases([mockDatabase1, mockDatabase2]);
    });

    expect(result.current.databases).toHaveLength(2);
    expect(result.current.databases[0]).toEqual(mockDatabase1);
    expect(result.current.databases[1]).toEqual(mockDatabase2);
  });

  it('should replace existing databases', () => {
    const { result } = renderHook(() => useDatabaseStore());

    act(() => {
      result.current.setDatabases([mockDatabase1]);
    });
    expect(result.current.databases).toHaveLength(1);

    act(() => {
      result.current.setDatabases([mockDatabase2]);
    });
    expect(result.current.databases).toHaveLength(1);
    expect(result.current.databases[0].name).toBe('test-db-2');
  });
});

describe('Zustand Store - setActiveDb', () => {
  it('should update activeDbId', () => {
    const { result } = renderHook(() => useDatabaseStore());

    act(() => {
      result.current.setActiveDb('test-db-1');
    });

    expect(result.current.activeDbId).toBe('test-db-1');
  });

  it('should reset schema to null when changing active database', () => {
    const { result } = renderHook(() => useDatabaseStore());

    // Set schema first
    act(() => {
      result.current.setSchema(mockSchema);
    });
    expect(result.current.schema).toEqual(mockSchema);

    // Change active database - schema should reset
    act(() => {
      result.current.setActiveDb('test-db-2');
    });

    expect(result.current.activeDbId).toBe('test-db-2');
    expect(result.current.schema).toBeNull();
  });

  it('should allow setting activeDbId to null', () => {
    const { result } = renderHook(() => useDatabaseStore());

    act(() => {
      result.current.setActiveDb('test-db-1');
    });
    expect(result.current.activeDbId).toBe('test-db-1');

    act(() => {
      result.current.setActiveDb(null);
    });
    expect(result.current.activeDbId).toBeNull();
  });
});

describe('Zustand Store - setSchema', () => {
  it('should update schema', () => {
    const { result } = renderHook(() => useDatabaseStore());

    act(() => {
      result.current.setSchema(mockSchema);
    });

    expect(result.current.schema).toEqual(mockSchema);
    expect(result.current.schema?.tables).toEqual(['users', 'posts', 'comments']);
    expect(result.current.schema?.views).toEqual(['active_users']);
    expect(result.current.schema?.indexes).toEqual(['idx_users_email']);
  });

  it('should allow setting schema to null', () => {
    const { result } = renderHook(() => useDatabaseStore());

    act(() => {
      result.current.setSchema(mockSchema);
    });
    expect(result.current.schema).not.toBeNull();

    act(() => {
      result.current.setSchema(null);
    });
    expect(result.current.schema).toBeNull();
  });
});

describe('Zustand Store - setReadOnly', () => {
  it('should update isReadOnly to true', () => {
    const { result } = renderHook(() => useDatabaseStore());

    act(() => {
      result.current.setReadOnly(true);
    });

    expect(result.current.isReadOnly).toBe(true);
  });

  it('should update isReadOnly to false', () => {
    const { result } = renderHook(() => useDatabaseStore());

    act(() => {
      result.current.setReadOnly(true);
    });
    expect(result.current.isReadOnly).toBe(true);

    act(() => {
      result.current.setReadOnly(false);
    });
    expect(result.current.isReadOnly).toBe(false);
  });
});

describe('Zustand Store - setLockHolder', () => {
  it('should update lockHolder to "self"', () => {
    const { result } = renderHook(() => useDatabaseStore());

    act(() => {
      result.current.setLockHolder('self');
    });

    expect(result.current.lockHolder).toBe('self');
  });

  it('should update lockHolder to "other"', () => {
    const { result } = renderHook(() => useDatabaseStore());

    act(() => {
      result.current.setLockHolder('other');
    });

    expect(result.current.lockHolder).toBe('other');
  });

  it('should update lockHolder to null', () => {
    const { result } = renderHook(() => useDatabaseStore());

    act(() => {
      result.current.setLockHolder('self');
    });
    expect(result.current.lockHolder).toBe('self');

    act(() => {
      result.current.setLockHolder(null);
    });
    expect(result.current.lockHolder).toBeNull();
  });
});

describe('Zustand Store - setStorageStatus', () => {
  it('should update storageStatus to "quota_exceeded"', () => {
    const { result } = renderHook(() => useDatabaseStore());

    act(() => {
      result.current.setStorageStatus('quota_exceeded');
    });

    expect(result.current.storageStatus).toBe('quota_exceeded');
  });

  it('should update storageStatus to "degraded"', () => {
    const { result } = renderHook(() => useDatabaseStore());

    act(() => {
      result.current.setStorageStatus('degraded');
    });

    expect(result.current.storageStatus).toBe('degraded');
  });

  it('should update storageStatus to "ok"', () => {
    const { result } = renderHook(() => useDatabaseStore());

    act(() => {
      result.current.setStorageStatus('quota_exceeded');
    });
    expect(result.current.storageStatus).toBe('quota_exceeded');

    act(() => {
      result.current.setStorageStatus('ok');
    });
    expect(result.current.storageStatus).toBe('ok');
  });
});

describe('Zustand Store - setStorageMode', () => {
  it('should update storageMode to "opfs"', () => {
    const { result } = renderHook(() => useDatabaseStore());

    act(() => {
      result.current.setStorageMode('opfs');
    });

    expect(result.current.storageMode).toBe('opfs');
  });

  it('should update storageMode to "idb"', () => {
    const { result } = renderHook(() => useDatabaseStore());

    act(() => {
      result.current.setStorageMode('idb');
    });

    expect(result.current.storageMode).toBe('idb');
  });

  it('should update storageMode to null', () => {
    const { result } = renderHook(() => useDatabaseStore());

    act(() => {
      result.current.setStorageMode('opfs');
    });
    expect(result.current.storageMode).toBe('opfs');

    act(() => {
      result.current.setStorageMode(null);
    });
    expect(result.current.storageMode).toBeNull();
  });
});

describe('Zustand Store - reset', () => {
  it('should reset all state to initial values', () => {
    const { result } = renderHook(() => useDatabaseStore());

    // Set various state values
    act(() => {
      result.current.setDatabases([mockDatabase1]);
      result.current.setActiveDb('test-db-1');
      result.current.setSchema(mockSchema);
      result.current.setReadOnly(true);
      result.current.setLockHolder('self');
      result.current.setStorageStatus('quota_exceeded');
      result.current.setStorageMode('opfs');
    });

    // Verify state was changed
    expect(result.current.databases).toHaveLength(1);
    expect(result.current.activeDbId).toBe('test-db-1');
    expect(result.current.schema).not.toBeNull();
    expect(result.current.isReadOnly).toBe(true);
    expect(result.current.lockHolder).toBe('self');
    expect(result.current.storageStatus).toBe('quota_exceeded');
    expect(result.current.storageMode).toBe('opfs');

    // Reset
    act(() => {
      result.current.reset();
    });

    // Verify all state is reset
    expect(result.current.databases).toEqual([]);
    expect(result.current.activeDbId).toBeNull();
    expect(result.current.schema).toBeNull();
    expect(result.current.isReadOnly).toBe(false);
    expect(result.current.lockHolder).toBeNull();
    expect(result.current.storageStatus).toBe('ok');
    expect(result.current.storageMode).toBeNull();
  });
});

// =============================================================================
// Selector Tests
// =============================================================================

describe('Zustand Store - Selectors', () => {
  describe('useActiveDb', () => {
    it('should return null when no database is active', () => {
      const { result } = renderHook(() => useActiveDb());
      expect(result.current).toBeNull();
    });

    it('should return null when activeDbId does not match any database', () => {
      const { result: storeResult } = renderHook(() => useDatabaseStore());
      const { result: selectorResult } = renderHook(() => useActiveDb());

      act(() => {
        storeResult.current.setDatabases([mockDatabase1]);
        storeResult.current.setActiveDb('nonexistent');
      });

      expect(selectorResult.current).toBeNull();
    });

    it('should return the active database entry', () => {
      const { result: storeResult } = renderHook(() => useDatabaseStore());
      const { result: selectorResult } = renderHook(() => useActiveDb());

      act(() => {
        storeResult.current.setDatabases([mockDatabase1, mockDatabase2]);
        storeResult.current.setActiveDb('test-db-1');
      });

      expect(selectorResult.current).toEqual(mockDatabase1);
    });
  });

  describe('useIsReadOnly', () => {
    it('should return false initially', () => {
      const { result } = renderHook(() => useIsReadOnly());
      expect(result.current).toBe(false);
    });

    it('should return true when set', () => {
      const { result: storeResult } = renderHook(() => useDatabaseStore());
      const { result: selectorResult } = renderHook(() => useIsReadOnly());

      act(() => {
        storeResult.current.setReadOnly(true);
      });

      expect(selectorResult.current).toBe(true);
    });
  });

  describe('useTables', () => {
    it('useTables returns empty array when schema is null', () => {
      const { result } = renderHook(() => useTables());
      expect(result.current).toEqual([]);
    });

    it('should return tables from schema', () => {
      const { result: storeResult } = renderHook(() => useDatabaseStore());
      const { result: selectorResult } = renderHook(() => useTables());

      act(() => {
        storeResult.current.setSchema(mockSchema);
      });

      expect(selectorResult.current).toEqual(['users', 'posts', 'comments']);
    });
  });

  describe('useStorageStatus', () => {
    it('should return "ok" initially', () => {
      const { result } = renderHook(() => useStorageStatus());
      expect(result.current).toBe('ok');
    });

    it('should return current storage status', () => {
      const { result: storeResult } = renderHook(() => useDatabaseStore());
      const { result: selectorResult } = renderHook(() => useStorageStatus());

      act(() => {
        storeResult.current.setStorageStatus('degraded');
      });

      expect(selectorResult.current).toBe('degraded');
    });
  });

  describe('useViews', () => {
    it('useViews returns empty array when schema is null', () => {
      const { result } = renderHook(() => useViews());
      expect(result.current).toEqual([]);
    });

    it('should return views from schema', () => {
      const { result: storeResult } = renderHook(() => useDatabaseStore());
      const { result: selectorResult } = renderHook(() => useViews());

      act(() => {
        storeResult.current.setSchema(mockSchema);
      });

      expect(selectorResult.current).toEqual(['active_users']);
    });
  });

  describe('useIndexes', () => {
    it('useIndexes returns empty array when schema is null', () => {
      const { result } = renderHook(() => useIndexes());
      expect(result.current).toEqual([]);
    });

    it('should return indexes from schema', () => {
      const { result: storeResult } = renderHook(() => useDatabaseStore());
      const { result: selectorResult } = renderHook(() => useIndexes());

      act(() => {
        storeResult.current.setSchema(mockSchema);
      });

      expect(selectorResult.current).toEqual(['idx_users_email']);
    });
  });

  describe('useStorageMode', () => {
    it('useStorageMode returns null initially', () => {
      const { result } = renderHook(() => useStorageMode());
      expect(result.current).toBeNull();
    });

    it('should return current storage mode', () => {
      const { result: storeResult } = renderHook(() => useDatabaseStore());
      const { result: selectorResult } = renderHook(() => useStorageMode());

      act(() => {
        storeResult.current.setStorageMode('opfs');
      });

      expect(selectorResult.current).toBe('opfs');
    });
  });

  describe('useLockHolder', () => {
    it('useLockHolder returns null initially', () => {
      const { result } = renderHook(() => useLockHolder());
      expect(result.current).toBeNull();
    });

    it('should return current lock holder', () => {
      const { result: storeResult } = renderHook(() => useDatabaseStore());
      const { result: selectorResult } = renderHook(() => useLockHolder());

      act(() => {
        storeResult.current.setLockHolder('other');
      });

      expect(selectorResult.current).toBe('other');
    });
  });

  describe('useDatabases', () => {
    it('should return empty array initially', () => {
      const { result } = renderHook(() => useDatabases());
      expect(result.current).toEqual([]);
    });

    it('should return all databases', () => {
      const { result: storeResult } = renderHook(() => useDatabaseStore());
      const { result: selectorResult } = renderHook(() => useDatabases());

      act(() => {
        storeResult.current.setDatabases([mockDatabase1, mockDatabase2]);
      });

      expect(selectorResult.current).toHaveLength(2);
      expect(selectorResult.current[0].name).toBe('test-db-1');
      expect(selectorResult.current[1].name).toBe('test-db-2');
    });
  });

  describe('useIsStorageFull', () => {
    it('should return false when storageStatus is "ok"', () => {
      const { result } = renderHook(() => useIsStorageFull());
      expect(result.current).toBe(false);
    });

    it('should return false when storageStatus is "degraded"', () => {
      const { result: storeResult } = renderHook(() => useDatabaseStore());
      const { result: selectorResult } = renderHook(() => useIsStorageFull());

      act(() => {
        storeResult.current.setStorageStatus('degraded');
      });

      expect(selectorResult.current).toBe(false);
    });

    it('should return true when storageStatus is "quota_exceeded"', () => {
      const { result: storeResult } = renderHook(() => useDatabaseStore());
      const { result: selectorResult } = renderHook(() => useIsStorageFull());

      act(() => {
        storeResult.current.setStorageStatus('quota_exceeded');
      });

      expect(selectorResult.current).toBe(true);
    });
  });

  describe('useCanWrite', () => {
    it('should return true when not read-only and storage is ok', () => {
      const { result } = renderHook(() => useCanWrite());
      expect(result.current).toBe(true);
    });

    it('should return false when read-only', () => {
      const { result: storeResult } = renderHook(() => useDatabaseStore());
      const { result: selectorResult } = renderHook(() => useCanWrite());

      act(() => {
        storeResult.current.setReadOnly(true);
      });

      expect(selectorResult.current).toBe(false);
    });

    it('should return false when storage is full (quota_exceeded)', () => {
      const { result: storeResult } = renderHook(() => useDatabaseStore());
      const { result: selectorResult } = renderHook(() => useCanWrite());

      act(() => {
        storeResult.current.setStorageStatus('quota_exceeded');
      });

      expect(selectorResult.current).toBe(false);
    });

    it('should return true when storage is degraded but not read-only', () => {
      const { result: storeResult } = renderHook(() => useDatabaseStore());
      const { result: selectorResult } = renderHook(() => useCanWrite());

      act(() => {
        storeResult.current.setStorageStatus('degraded');
      });

      expect(selectorResult.current).toBe(true);
    });

    it('should return false when both read-only and storage full', () => {
      const { result: storeResult } = renderHook(() => useDatabaseStore());
      const { result: selectorResult } = renderHook(() => useCanWrite());

      act(() => {
        storeResult.current.setReadOnly(true);
        storeResult.current.setStorageStatus('quota_exceeded');
      });

      expect(selectorResult.current).toBe(false);
    });
  });
});

// =============================================================================
// Non-hook Accessor Tests
// =============================================================================

describe('Zustand Store - Non-hook Accessors', () => {
  describe('getState', () => {
    it('should return current state synchronously', () => {
      const { result } = renderHook(() => useDatabaseStore());

      act(() => {
        result.current.setActiveDb('test-db');
        result.current.setReadOnly(true);
      });

      const state = getState();
      expect(state.activeDbId).toBe('test-db');
      expect(state.isReadOnly).toBe(true);
    });
  });
});

// =============================================================================
// Database Action Tests
// =============================================================================

describe('Database Actions', () => {
  // Mock dependencies
  const mockWorkerClient = {
    getRegistry: vi.fn(),
    openDb: vi.fn(),
    closeDb: vi.fn(),
    createDb: vi.fn(),
    deleteDb: vi.fn(),
    renameDb: vi.fn(),
    getSchema: vi.fn(),
    getDbSize: vi.fn(),
  };

  const mockLockManager = {
    acquireLock: vi.fn(),
    releaseLock: vi.fn(),
  };

  beforeEach(() => {
    // Reset store and mocks before each test
    useDatabaseStore.getState().reset();
    vi.resetAllMocks();

    // Inject mock dependencies
    setActionDeps({
      workerClient: mockWorkerClient as never,
      lockManager: mockLockManager as never,
    });
  });

  afterEach(() => {
    resetActionDeps();
  });

  describe('loadRegistry', () => {
    it('should populate databases[] from worker response', async () => {
      const mockRegistry = {
        v: 1 as const,
        databases: [mockDatabase1, mockDatabase2],
      };
      mockWorkerClient.getRegistry.mockResolvedValue(mockRegistry);

      await loadRegistry();

      expect(mockWorkerClient.getRegistry).toHaveBeenCalledTimes(1);
      const state = getState();
      expect(state.databases).toHaveLength(2);
      expect(state.databases[0].name).toBe('test-db-1');
      expect(state.databases[1].name).toBe('test-db-2');
    });
  });

  describe('openDb', () => {
    describe('OPFS storage mode (requires Web Locks)', () => {
      beforeEach(() => {
        // Default to OPFS storage mode for these tests
        mockWorkerClient.getDbSize.mockResolvedValue({
          sizeBytes: 1024,
          storageMode: 'opfs',
        });
      });

      it('should set activeDbId, isReadOnly=false and load schema when lock acquired', async () => {
        mockLockManager.acquireLock.mockResolvedValue({
          acquired: true,
          holderId: null,
          holderStale: false,
        });
        mockWorkerClient.openDb.mockResolvedValue({ isWriter: true });
        mockWorkerClient.getSchema.mockResolvedValue({
          tables: ['users', 'orders'],
          views: ['recent_orders'],
          indexes: ['idx_user_id'],
        });

        await openDb('test-db-1');

        // OPFS databases require lock acquisition
        expect(mockLockManager.acquireLock).toHaveBeenCalledWith('test-db-1');
        expect(mockWorkerClient.openDb).toHaveBeenCalledWith('test-db-1', { readOnly: false });
        expect(mockWorkerClient.getSchema).toHaveBeenCalledTimes(1);

        const state = getState();
        expect(state.activeDbId).toBe('test-db-1');
        expect(state.isReadOnly).toBe(false);
        expect(state.lockHolder).toBe('self');
        expect(state.storageMode).toBe('opfs');
        expect(state.schema).toEqual({
          tables: ['users', 'orders'],
          views: ['recent_orders'],
          indexes: ['idx_user_id'],
        });
      });

      it('should set isReadOnly=true when lock not acquired', async () => {
        mockLockManager.acquireLock.mockResolvedValue({
          acquired: false,
          holderId: 'other-tab',
          holderStale: false,
        });
        mockWorkerClient.openDb.mockResolvedValue({ isWriter: false });
        mockWorkerClient.getSchema.mockResolvedValue({
          tables: ['users'],
          views: [],
          indexes: [],
        });

        await openDb('test-db-1');

        const state = getState();
        expect(state.activeDbId).toBe('test-db-1');
        expect(state.isReadOnly).toBe(true);
        expect(state.lockHolder).toBe('other');
        expect(state.storageMode).toBe('opfs');
      });

      it('should open in read-only mode when lock acquisition fails', async () => {
        mockLockManager.acquireLock.mockResolvedValue({
          acquired: false,
          holderId: 'tab-xyz',
          holderStale: false,
        });
        mockWorkerClient.openDb.mockResolvedValue({ isWriter: false });
        mockWorkerClient.getSchema.mockResolvedValue({
          tables: ['data'],
          views: [],
          indexes: [],
        });

        await openDb('test-db-1');

        // Should open with readOnly=true because lock was not acquired
        expect(mockWorkerClient.openDb).toHaveBeenCalledWith('test-db-1', { readOnly: true });

        const state = getState();
        expect(state.isReadOnly).toBe(true);
        expect(state.lockHolder).toBe('other');
      });
    });

    describe('IDB storage mode (multi-tab safe, no Web Locks needed)', () => {
      beforeEach(() => {
        // Set IDB storage mode - multi-tab safe, no lock needed
        mockWorkerClient.getDbSize.mockResolvedValue({
          sizeBytes: 1024,
          storageMode: 'idb',
        });
      });

      it('should skip lock acquisition for IDB databases', async () => {
        mockWorkerClient.openDb.mockResolvedValue({ isWriter: true });
        mockWorkerClient.getSchema.mockResolvedValue({
          tables: ['users'],
          views: [],
          indexes: [],
        });

        await openDb('idb-database');

        // IDB databases should NOT call acquireLock
        expect(mockLockManager.acquireLock).not.toHaveBeenCalled();
        // Should open with readOnly=false (IDB is always writable)
        expect(mockWorkerClient.openDb).toHaveBeenCalledWith('idb-database', { readOnly: false });
      });

      it('should always have isWriter=true for IDB databases', async () => {
        mockWorkerClient.openDb.mockResolvedValue({ isWriter: true });
        mockWorkerClient.getSchema.mockResolvedValue({
          tables: ['products'],
          views: [],
          indexes: [],
        });

        await openDb('idb-database');

        const state = getState();
        expect(state.activeDbId).toBe('idb-database');
        expect(state.isReadOnly).toBe(false);
        expect(state.lockHolder).toBe('self');
        expect(state.storageMode).toBe('idb');
      });

      it('should set correct state for IDB database even without lock manager', async () => {
        mockWorkerClient.openDb.mockResolvedValue({ isWriter: true });
        mockWorkerClient.getSchema.mockResolvedValue({
          tables: ['orders'],
          views: ['recent_orders'],
          indexes: ['idx_date'],
        });

        await openDb('fallback-idb');

        const state = getState();
        expect(state.activeDbId).toBe('fallback-idb');
        expect(state.isReadOnly).toBe(false);
        expect(state.lockHolder).toBe('self');
        expect(state.storageMode).toBe('idb');
        expect(state.schema).toEqual({
          tables: ['orders'],
          views: ['recent_orders'],
          indexes: ['idx_date'],
        });
      });
    });

    describe('storage mode detection fallback', () => {
      it('should assume OPFS when getDbSize fails (safer default)', async () => {
        // getDbSize fails - should fall back to OPFS (safer)
        mockWorkerClient.getDbSize.mockRejectedValue(new Error('Size check failed'));
        mockLockManager.acquireLock.mockResolvedValue({
          acquired: true,
          holderId: null,
          holderStale: false,
        });
        mockWorkerClient.openDb.mockResolvedValue({ isWriter: true });
        mockWorkerClient.getSchema.mockResolvedValue({
          tables: [],
          views: [],
          indexes: [],
        });

        await openDb('unknown-db');

        // Should still try to acquire lock (OPFS fallback)
        expect(mockLockManager.acquireLock).toHaveBeenCalledWith('unknown-db');
      });
    });
  });

  describe('closeDb', () => {
    describe('OPFS storage mode', () => {
      it('should release lock when closing OPFS database with lock held', async () => {
        // Set up initial state with active OPFS database
        const store = useDatabaseStore.getState();
        store.setActiveDb('opfs-db');
        store.setLockHolder('self');
        store.setStorageMode('opfs');
        store.setSchema(mockSchema);

        mockWorkerClient.closeDb.mockResolvedValue(undefined);
        mockLockManager.releaseLock.mockResolvedValue(undefined);

        await closeDb();

        // OPFS databases should release lock
        expect(mockLockManager.releaseLock).toHaveBeenCalledWith('opfs-db');
        expect(mockWorkerClient.closeDb).toHaveBeenCalledTimes(1);

        const state = getState();
        expect(state.activeDbId).toBeNull();
        expect(state.schema).toBeNull();
        expect(state.isReadOnly).toBe(false);
        expect(state.lockHolder).toBeNull();
      });

      it('should not release lock when lock holder is other (OPFS)', async () => {
        const store = useDatabaseStore.getState();
        store.setActiveDb('opfs-db');
        store.setLockHolder('other');
        store.setStorageMode('opfs');

        mockWorkerClient.closeDb.mockResolvedValue(undefined);

        await closeDb();

        // Lock was held by other tab, so don't release it
        expect(mockLockManager.releaseLock).not.toHaveBeenCalled();
        expect(mockWorkerClient.closeDb).toHaveBeenCalledTimes(1);
      });
    });

    describe('IDB storage mode', () => {
      it('should NOT release lock when closing IDB database (multi-tab safe)', async () => {
        // Set up initial state with active IDB database
        const store = useDatabaseStore.getState();
        store.setActiveDb('idb-db');
        store.setLockHolder('self');
        store.setStorageMode('idb');
        store.setSchema(mockSchema);

        mockWorkerClient.closeDb.mockResolvedValue(undefined);
        mockLockManager.releaseLock.mockResolvedValue(undefined);

        await closeDb();

        // IDB databases should NOT release lock (they don't use Web Locks)
        expect(mockLockManager.releaseLock).not.toHaveBeenCalled();
        // But should still close the database
        expect(mockWorkerClient.closeDb).toHaveBeenCalledTimes(1);

        const state = getState();
        expect(state.activeDbId).toBeNull();
        expect(state.schema).toBeNull();
        expect(state.isReadOnly).toBe(false);
        expect(state.lockHolder).toBeNull();
      });

      it('should clear state even when storage mode is IDB', async () => {
        const store = useDatabaseStore.getState();
        store.setActiveDb('idb-db');
        store.setLockHolder('self');
        store.setStorageMode('idb');
        store.setSchema({
          tables: ['users', 'orders'],
          views: ['active_users'],
          indexes: ['idx_email'],
        });

        mockWorkerClient.closeDb.mockResolvedValue(undefined);

        await closeDb();

        const state = getState();
        expect(state.activeDbId).toBeNull();
        expect(state.schema).toBeNull();
        expect(state.lockHolder).toBeNull();
        expect(state.isReadOnly).toBe(false);
      });
    });

    it('closeDb does nothing when no active database', async () => {
      await closeDb();

      expect(mockLockManager.releaseLock).not.toHaveBeenCalled();
      expect(mockWorkerClient.closeDb).not.toHaveBeenCalled();
    });
  });

  describe('createDb', () => {
    it('should call worker, add to registry, and open new DB', async () => {
      const newDb: DatabaseEntry = {
        name: 'new-db',
        file: 'new_db.sqlite',
        createdAt: '2026-01-28T12:00:00.000Z',
        lastOpenedAt: '2026-01-28T12:00:00.000Z',
        fkEnforced: true,
      };

      mockWorkerClient.createDb.mockResolvedValue(undefined);
      mockWorkerClient.getRegistry.mockResolvedValue({
        v: 1 as const,
        databases: [newDb],
      });
      mockLockManager.acquireLock.mockResolvedValue({
        acquired: true,
        holderId: null,
        holderStale: false,
      });
      mockWorkerClient.openDb.mockResolvedValue({ isWriter: true });
      mockWorkerClient.getSchema.mockResolvedValue({
        tables: [],
        views: [],
        indexes: [],
      });

      await createDb('new-db');

      expect(mockWorkerClient.createDb).toHaveBeenCalledWith('new-db');
      expect(mockWorkerClient.getRegistry).toHaveBeenCalledTimes(1);
      expect(mockWorkerClient.openDb).toHaveBeenCalledWith('new-db', { readOnly: false });

      const state = getState();
      expect(state.databases).toHaveLength(1);
      expect(state.databases[0].name).toBe('new-db');
      expect(state.activeDbId).toBe('new-db');
    });
  });

  describe('deleteDb', () => {
    it('should call worker and remove from registry', async () => {
      // Set up initial state with databases
      useDatabaseStore.getState().setDatabases([mockDatabase1, mockDatabase2]);

      mockWorkerClient.deleteDb.mockResolvedValue(undefined);

      await deleteDb('test-db-1');

      expect(mockWorkerClient.deleteDb).toHaveBeenCalledWith('test-db-1');

      const state = getState();
      expect(state.databases).toHaveLength(1);
      expect(state.databases[0].name).toBe('test-db-2');
    });

    it('should close database first if it is active', async () => {
      // Set up initial state with active database
      const store = useDatabaseStore.getState();
      store.setDatabases([mockDatabase1]);
      store.setActiveDb('test-db-1');
      store.setLockHolder('self');
      store.setStorageMode('opfs'); // OPFS databases use Web Locks (IDB databases don't)

      mockWorkerClient.closeDb.mockResolvedValue(undefined);
      mockLockManager.releaseLock.mockResolvedValue(undefined);
      mockWorkerClient.deleteDb.mockResolvedValue(undefined);

      await deleteDb('test-db-1');

      // Should have closed first (with lock release for OPFS)
      expect(mockWorkerClient.closeDb).toHaveBeenCalledTimes(1);
      expect(mockLockManager.releaseLock).toHaveBeenCalledWith('test-db-1');
      expect(mockWorkerClient.deleteDb).toHaveBeenCalledWith('test-db-1');

      const state = getState();
      expect(state.databases).toHaveLength(0);
      expect(state.activeDbId).toBeNull();
    });

    it('should delete query history when deleting database', async () => {
      // Set up initial state with databases
      useDatabaseStore.getState().setDatabases([mockDatabase1]);

      // Add some query history for the database
      localStorage.setItem('qh:test-db-1', JSON.stringify([
        { sql: 'SELECT 1', executedAt: '2026-01-28T00:00:00.000Z' },
      ]));

      mockWorkerClient.deleteDb.mockResolvedValue(undefined);

      await deleteDb('test-db-1');

      // Query history should be deleted
      expect(localStorage.getItem('qh:test-db-1')).toBeNull();
    });
  });

  describe('renameDb', () => {
    it('should update registry entry name', async () => {
      // Set up initial state
      useDatabaseStore.getState().setDatabases([mockDatabase1]);

      mockWorkerClient.renameDb.mockResolvedValue(undefined);

      await renameDb('test-db-1', 'renamed-db');

      expect(mockWorkerClient.renameDb).toHaveBeenCalledWith('test-db-1', 'renamed-db');

      const state = getState();
      expect(state.databases).toHaveLength(1);
      expect(state.databases[0].name).toBe('renamed-db');
    });

    it('should update activeDbId if renaming active database', async () => {
      // Set up initial state with active database
      const store = useDatabaseStore.getState();
      store.setDatabases([mockDatabase1]);
      store.setActiveDb('test-db-1');

      mockWorkerClient.renameDb.mockResolvedValue(undefined);

      await renameDb('test-db-1', 'renamed-db');

      const state = getState();
      expect(state.activeDbId).toBe('renamed-db');
    });

    it('should migrate query history when renaming', async () => {
      // Set up initial state
      useDatabaseStore.getState().setDatabases([mockDatabase1]);

      // Add some history to the old name
      localStorage.setItem('qh:test-db-1', JSON.stringify([{ sql: 'SELECT 1', executedAt: '2026-01-28T00:00:00.000Z' }]));

      mockWorkerClient.renameDb.mockResolvedValue(undefined);

      await renameDb('test-db-1', 'renamed-db');

      // Old history should be gone
      expect(localStorage.getItem('qh:test-db-1')).toBeNull();

      // New history should exist
      const newHistory = localStorage.getItem('qh:renamed-db');
      expect(newHistory).not.toBeNull();
      expect(JSON.parse(newHistory!)).toEqual([{ sql: 'SELECT 1', executedAt: '2026-01-28T00:00:00.000Z' }]);
    });
  });

  describe('refreshSchema', () => {
    it('should update tables/views/indexes for active DB', async () => {
      // Set up initial state with active database
      useDatabaseStore.getState().setActiveDb('test-db-1');

      mockWorkerClient.getSchema.mockResolvedValue({
        tables: ['products', 'customers'],
        views: ['order_summary'],
        indexes: ['idx_product_id', 'idx_customer_id'],
      });

      await refreshSchema();

      expect(mockWorkerClient.getSchema).toHaveBeenCalledTimes(1);

      const state = getState();
      expect(state.schema).toEqual({
        tables: ['products', 'customers'],
        views: ['order_summary'],
        indexes: ['idx_product_id', 'idx_customer_id'],
      });
    });

    it('refreshSchema does nothing when no active database', async () => {
      await refreshSchema();

      expect(mockWorkerClient.getSchema).not.toHaveBeenCalled();
    });
  });
});

// =============================================================================
// Query Builder State Persistence Tests
// =============================================================================

describe('Query Builder State Persistence', () => {
  describe('setQueryBuilderState', () => {
    beforeEach(() => {
      useDatabaseStore.getState().reset();
    });

    it('should store QueryBuilderState with all fields', () => {
      const { result } = renderHook(() => useDatabaseStore());

      const queryBuilderState = {
        nodes: [
          {
            id: 'table-users-123',
            type: 'tableBox' as const,
            position: { x: 100, y: 100 },
            data: {
              tableName: 'users',
              alias: 't1',
              columns: [
                { name: 'id', type: 'INTEGER', isPrimaryKey: true },
                { name: 'name', type: 'TEXT' },
              ],
              selectedColumns: ['id', 'name'],
            },
          },
        ],
        joins: [
          {
            id: 'join-1',
            sourceTable: 'users',
            sourceColumn: 'id',
            targetTable: 'orders',
            targetColumn: 'user_id',
            joinType: 'INNER' as const,
          },
        ],
        whereConditions: [
          {
            id: 'where-1',
            column: 't1.id',
            operator: '>' as const,
            value: '10',
          },
        ],
        whereLogic: 'AND' as const,
        sortConditions: [
          { column: 't1.name', direction: 'ASC' as const },
        ],
        limit: 100,
      };

      act(() => {
        result.current.setQueryBuilderState(queryBuilderState);
      });

      expect(result.current.queryBuilderState).toEqual(queryBuilderState);
    });

    it('should allow setting queryBuilderState to null', () => {
      const { result } = renderHook(() => useDatabaseStore());

      // First set some state
      act(() => {
        result.current.setQueryBuilderState({
          nodes: [],
          joins: [],
          whereConditions: [],
          whereLogic: 'AND',
          sortConditions: [],
          limit: null,
        });
      });

      expect(result.current.queryBuilderState).not.toBeNull();

      // Then clear it
      act(() => {
        result.current.setQueryBuilderState(null);
      });

      expect(result.current.queryBuilderState).toBeNull();
    });

    it('should handle empty state correctly', () => {
      const { result } = renderHook(() => useDatabaseStore());

      const emptyState = {
        nodes: [],
        joins: [],
        whereConditions: [],
        whereLogic: 'AND' as const,
        sortConditions: [],
        limit: null,
      };

      act(() => {
        result.current.setQueryBuilderState(emptyState);
      });

      expect(result.current.queryBuilderState).toEqual(emptyState);
      expect(result.current.queryBuilderState?.nodes).toEqual([]);
      expect(result.current.queryBuilderState?.joins).toEqual([]);
      expect(result.current.queryBuilderState?.whereConditions).toEqual([]);
      expect(result.current.queryBuilderState?.sortConditions).toEqual([]);
      expect(result.current.queryBuilderState?.limit).toBeNull();
    });

    it('should handle state with only nodes (no joins/conditions)', () => {
      const { result } = renderHook(() => useDatabaseStore());

      const stateWithOnlyNodes = {
        nodes: [
          {
            id: 'table-products-456',
            type: 'tableBox' as const,
            position: { x: 200, y: 200 },
            data: {
              tableName: 'products',
              alias: 't1',
              columns: [
                { name: 'sku', type: 'TEXT' },
                { name: 'price', type: 'REAL' },
              ],
              selectedColumns: ['sku'],
            },
          },
        ],
        joins: [],
        whereConditions: [],
        whereLogic: 'AND' as const,
        sortConditions: [],
        limit: null,
      };

      act(() => {
        result.current.setQueryBuilderState(stateWithOnlyNodes);
      });

      expect(result.current.queryBuilderState?.nodes).toHaveLength(1);
      expect(result.current.queryBuilderState?.nodes[0].data.tableName).toBe('products');
    });

    it('should preserve complex WHERE conditions', () => {
      const { result } = renderHook(() => useDatabaseStore());

      const stateWithWhereConditions = {
        nodes: [],
        joins: [],
        whereConditions: [
          { id: 'w1', column: 't1.status', operator: '=' as const, value: 'active' },
          { id: 'w2', column: 't1.price', operator: '>=' as const, value: '100' },
          { id: 'w3', column: 't1.name', operator: 'LIKE' as const, value: '%test%' },
        ],
        whereLogic: 'OR' as const,
        sortConditions: [],
        limit: null,
      };

      act(() => {
        result.current.setQueryBuilderState(stateWithWhereConditions);
      });

      expect(result.current.queryBuilderState?.whereConditions).toHaveLength(3);
      expect(result.current.queryBuilderState?.whereLogic).toBe('OR');
    });

    it('should preserve ORDER BY sort conditions', () => {
      const { result } = renderHook(() => useDatabaseStore());

      const stateWithSortConditions = {
        nodes: [],
        joins: [],
        whereConditions: [],
        whereLogic: 'AND' as const,
        sortConditions: [
          { column: 't1.created_at', direction: 'DESC' as const },
          { column: 't1.name', direction: 'ASC' as const },
        ],
        limit: 50,
      };

      act(() => {
        result.current.setQueryBuilderState(stateWithSortConditions);
      });

      expect(result.current.queryBuilderState?.sortConditions).toHaveLength(2);
      expect(result.current.queryBuilderState?.sortConditions[0].direction).toBe('DESC');
      expect(result.current.queryBuilderState?.limit).toBe(50);
    });

    it('should handle multiple JOIN configurations', () => {
      const { result } = renderHook(() => useDatabaseStore());

      const stateWithMultipleJoins = {
        nodes: [],
        joins: [
          {
            id: 'join-1',
            sourceTable: 'orders',
            sourceColumn: 'customer_id',
            targetTable: 'customers',
            targetColumn: 'id',
            joinType: 'INNER' as const,
          },
          {
            id: 'join-2',
            sourceTable: 'orders',
            sourceColumn: 'product_id',
            targetTable: 'products',
            targetColumn: 'id',
            joinType: 'LEFT' as const,
          },
          {
            id: 'join-3',
            sourceTable: 'products',
            sourceColumn: 'category_id',
            targetTable: 'categories',
            targetColumn: 'id',
            joinType: 'LEFT' as const,
          },
        ],
        whereConditions: [],
        whereLogic: 'AND' as const,
        sortConditions: [],
        limit: null,
      };

      act(() => {
        result.current.setQueryBuilderState(stateWithMultipleJoins);
      });

      expect(result.current.queryBuilderState?.joins).toHaveLength(3);
      expect(result.current.queryBuilderState?.joins[0].joinType).toBe('INNER');
      expect(result.current.queryBuilderState?.joins[1].joinType).toBe('LEFT');
    });
  });

  describe('useQueryBuilderState selector', () => {
    beforeEach(() => {
      useDatabaseStore.getState().reset();
    });

    it('should return null when no state is set', () => {
      const { result: storeResult } = renderHook(() => useDatabaseStore());

      // Use the selector from the store
      expect(storeResult.current.queryBuilderState).toBeNull();
    });

    it('should return current state when set', () => {
      const { result } = renderHook(() => useDatabaseStore());

      const testState = {
        nodes: [],
        joins: [],
        whereConditions: [],
        whereLogic: 'AND' as const,
        sortConditions: [],
        limit: 25,
      };

      act(() => {
        result.current.setQueryBuilderState(testState);
      });

      expect(result.current.queryBuilderState).toEqual(testState);
    });
  });

  describe('reset clears queryBuilderState', () => {
    it('should clear queryBuilderState when store is reset', () => {
      const { result } = renderHook(() => useDatabaseStore());

      // Set some state first
      act(() => {
        result.current.setQueryBuilderState({
          nodes: [
            {
              id: 'node-1',
              type: 'tableBox' as const,
              position: { x: 0, y: 0 },
              data: {
                tableName: 'test',
                alias: 't1',
                columns: [],
                selectedColumns: [],
              },
            },
          ],
          joins: [],
          whereConditions: [],
          whereLogic: 'AND',
          sortConditions: [],
          limit: 100,
        });
      });

      expect(result.current.queryBuilderState).not.toBeNull();

      // Reset the store
      act(() => {
        result.current.reset();
      });

      expect(result.current.queryBuilderState).toBeNull();
    });
  });

  describe('closeDb clears queryBuilderState', () => {
    // Mock dependencies
    const mockWorkerClient = {
      getRegistry: vi.fn(),
      openDb: vi.fn(),
      closeDb: vi.fn(),
      createDb: vi.fn(),
      deleteDb: vi.fn(),
      renameDb: vi.fn(),
      getSchema: vi.fn(),
      getDbSize: vi.fn(),
    };

    const mockLockManager = {
      acquireLock: vi.fn(),
      releaseLock: vi.fn(),
    };

    beforeEach(() => {
      useDatabaseStore.getState().reset();
      vi.resetAllMocks();
      setActionDeps({
        workerClient: mockWorkerClient as never,
        lockManager: mockLockManager as never,
      });
    });

    afterEach(() => {
      resetActionDeps();
    });

    it('should clear queryBuilderState when database is closed', async () => {
      const store = useDatabaseStore.getState();

      // Set up initial state with active database and query builder state
      store.setActiveDb('test-db');
      store.setLockHolder('self');
      store.setStorageMode('opfs');
      store.setQueryBuilderState({
        nodes: [
          {
            id: 'node-1',
            type: 'tableBox' as const,
            position: { x: 100, y: 100 },
            data: {
              tableName: 'users',
              alias: 't1',
              columns: [],
              selectedColumns: ['id', 'name'],
            },
          },
        ],
        joins: [],
        whereConditions: [{ id: 'w1', column: 't1.id', operator: '>' as const, value: '5' }],
        whereLogic: 'AND',
        sortConditions: [],
        limit: 50,
      });

      expect(getState().queryBuilderState).not.toBeNull();
      expect(getState().queryBuilderState?.nodes).toHaveLength(1);

      mockWorkerClient.closeDb.mockResolvedValue(undefined);
      mockLockManager.releaseLock.mockResolvedValue(undefined);

      await closeDb();

      // Query builder state should be cleared
      expect(getState().queryBuilderState).toBeNull();
      expect(getState().activeDbId).toBeNull();
    });

    it('should clear queryBuilderState even for IDB databases', async () => {
      const store = useDatabaseStore.getState();

      // Set up IDB database (no lock release needed)
      store.setActiveDb('idb-test-db');
      store.setLockHolder('self');
      store.setStorageMode('idb');
      store.setQueryBuilderState({
        nodes: [],
        joins: [],
        whereConditions: [],
        whereLogic: 'AND',
        sortConditions: [{ column: 't1.date', direction: 'DESC' as const }],
        limit: null,
      });

      mockWorkerClient.closeDb.mockResolvedValue(undefined);

      await closeDb();

      expect(getState().queryBuilderState).toBeNull();
      // IDB doesn't release lock
      expect(mockLockManager.releaseLock).not.toHaveBeenCalled();
    });
  });

  describe('QueryBuilderState serialization edge cases', () => {
    beforeEach(() => {
      useDatabaseStore.getState().reset();
    });

    it('should handle nodes with callback functions stripped (for serialization)', () => {
      const { result } = renderHook(() => useDatabaseStore());

      // When saving to store, callback functions should be stripped
      // (they can't be serialized and will be re-attached on restore)
      const stateWithCallbacks = {
        nodes: [
          {
            id: 'node-1',
            type: 'tableBox' as const,
            position: { x: 0, y: 0 },
            data: {
              tableName: 'test',
              alias: 't1',
              columns: [{ name: 'id', type: 'INTEGER', isPrimaryKey: true }],
              selectedColumns: ['id'],
              // Note: onSelectionChange and onRemove would be undefined after serialization
              onSelectionChange: undefined,
              onRemove: undefined,
            },
          },
        ],
        joins: [],
        whereConditions: [],
        whereLogic: 'AND' as const,
        sortConditions: [],
        limit: null,
      };

      act(() => {
        result.current.setQueryBuilderState(stateWithCallbacks);
      });

      expect(result.current.queryBuilderState?.nodes[0].data.onSelectionChange).toBeUndefined();
      expect(result.current.queryBuilderState?.nodes[0].data.onRemove).toBeUndefined();
      // But other data should be preserved
      expect(result.current.queryBuilderState?.nodes[0].data.selectedColumns).toEqual(['id']);
    });

    it('should handle node positions for canvas restoration', () => {
      const { result } = renderHook(() => useDatabaseStore());

      const stateWithPositions = {
        nodes: [
          {
            id: 'node-1',
            type: 'tableBox' as const,
            position: { x: 150.5, y: 200.75 },
            data: {
              tableName: 'users',
              alias: 't1',
              columns: [],
              selectedColumns: [],
            },
          },
          {
            id: 'node-2',
            type: 'tableBox' as const,
            position: { x: 450, y: 100 },
            data: {
              tableName: 'orders',
              alias: 't2',
              columns: [],
              selectedColumns: [],
            },
          },
        ],
        joins: [],
        whereConditions: [],
        whereLogic: 'AND' as const,
        sortConditions: [],
        limit: null,
      };

      act(() => {
        result.current.setQueryBuilderState(stateWithPositions);
      });

      expect(result.current.queryBuilderState?.nodes[0].position).toEqual({ x: 150.5, y: 200.75 });
      expect(result.current.queryBuilderState?.nodes[1].position).toEqual({ x: 450, y: 100 });
    });

    it('should preserve selectedColumns arrays across state updates', () => {
      const { result } = renderHook(() => useDatabaseStore());

      const initialState = {
        nodes: [
          {
            id: 'node-1',
            type: 'tableBox' as const,
            position: { x: 0, y: 0 },
            data: {
              tableName: 'products',
              alias: 't1',
              columns: [
                { name: 'id', type: 'INTEGER', isPrimaryKey: true },
                { name: 'name', type: 'TEXT' },
                { name: 'price', type: 'REAL' },
                { name: 'category', type: 'TEXT' },
              ],
              selectedColumns: ['id', 'name', 'price'],
            },
          },
        ],
        joins: [],
        whereConditions: [],
        whereLogic: 'AND' as const,
        sortConditions: [],
        limit: null,
      };

      act(() => {
        result.current.setQueryBuilderState(initialState);
      });

      expect(result.current.queryBuilderState?.nodes[0].data.selectedColumns).toEqual(['id', 'name', 'price']);
      expect(result.current.queryBuilderState?.nodes[0].data.selectedColumns).toHaveLength(3);
    });
  });

  describe('openDb clears queryBuilderState', () => {
    // This tests the fix from commit 5fa131f: Clear Query Builder state when switching databases
    // (state is database-specific and must be reset)

    // Mock dependencies
    const mockWorkerClient = {
      getRegistry: vi.fn(),
      openDb: vi.fn(),
      closeDb: vi.fn(),
      createDb: vi.fn(),
      deleteDb: vi.fn(),
      renameDb: vi.fn(),
      getSchema: vi.fn(),
      getDbSize: vi.fn(),
    };

    const mockLockManager = {
      acquireLock: vi.fn(),
      releaseLock: vi.fn(),
    };

    beforeEach(() => {
      useDatabaseStore.getState().reset();
      vi.resetAllMocks();
      setActionDeps({
        workerClient: mockWorkerClient as never,
        lockManager: mockLockManager as never,
      });
    });

    afterEach(() => {
      resetActionDeps();
    });

    it('should clear queryBuilderState when opening a different database', async () => {
      const store = useDatabaseStore.getState();

      // Set up initial state with query builder state (simulating a user who
      // built a query and is now switching to a different database)
      store.setQueryBuilderState({
        nodes: [
          {
            id: 'table-users-789',
            type: 'tableBox' as const,
            position: { x: 100, y: 100 },
            data: {
              tableName: 'users',
              alias: 't1',
              columns: [{ name: 'id', type: 'INTEGER', isPrimaryKey: true }],
              selectedColumns: ['id'],
            },
          },
        ],
        joins: [
          {
            id: 'join-1',
            sourceTable: 'users',
            sourceColumn: 'id',
            targetTable: 'orders',
            targetColumn: 'user_id',
            joinType: 'INNER' as const,
          },
        ],
        whereConditions: [
          { id: 'w1', column: 't1.id', operator: '>' as const, value: '10' },
        ],
        whereLogic: 'AND',
        sortConditions: [{ column: 't1.id', direction: 'ASC' as const }],
        limit: 100,
      });

      expect(getState().queryBuilderState).not.toBeNull();
      expect(getState().queryBuilderState?.nodes).toHaveLength(1);
      expect(getState().queryBuilderState?.joins).toHaveLength(1);

      // Set up mocks for opening a new database
      mockWorkerClient.getDbSize.mockResolvedValue({
        sizeBytes: 1024,
        storageMode: 'opfs',
      });
      mockLockManager.acquireLock.mockResolvedValue({
        acquired: true,
        holderId: null,
        holderStale: false,
      });
      mockWorkerClient.openDb.mockResolvedValue({ isWriter: true });
      mockWorkerClient.getSchema.mockResolvedValue({
        tables: ['products', 'categories'],
        views: [],
        indexes: [],
      });

      await openDb('new-database');

      // Query builder state should be cleared when switching databases
      expect(getState().queryBuilderState).toBeNull();
      expect(getState().activeDbId).toBe('new-database');
    });

    it('should clear queryBuilderState even when opening IDB database', async () => {
      const store = useDatabaseStore.getState();

      // Set up existing query builder state
      store.setQueryBuilderState({
        nodes: [],
        joins: [],
        whereConditions: [
          { id: 'w1', column: 't1.status', operator: '=' as const, value: 'active' },
        ],
        whereLogic: 'OR',
        sortConditions: [],
        limit: 50,
      });

      expect(getState().queryBuilderState).not.toBeNull();

      // Set up mocks for IDB database
      mockWorkerClient.getDbSize.mockResolvedValue({
        sizeBytes: 512,
        storageMode: 'idb',
      });
      mockWorkerClient.openDb.mockResolvedValue({ isWriter: true });
      mockWorkerClient.getSchema.mockResolvedValue({
        tables: ['data'],
        views: [],
        indexes: [],
      });

      await openDb('idb-database');

      // Query builder state should still be cleared for IDB databases
      expect(getState().queryBuilderState).toBeNull();
      expect(getState().storageMode).toBe('idb');
    });

    it('should clear queryBuilderState before loading new schema', async () => {
      // This ensures the state is cleared at the right time in the openDb flow
      const store = useDatabaseStore.getState();

      store.setQueryBuilderState({
        nodes: [
          {
            id: 'old-node',
            type: 'tableBox' as const,
            position: { x: 0, y: 0 },
            data: {
              tableName: 'old_table',
              alias: 't1',
              columns: [],
              selectedColumns: ['col1', 'col2'],
            },
          },
        ],
        joins: [],
        whereConditions: [],
        whereLogic: 'AND',
        sortConditions: [],
        limit: null,
      });

      mockWorkerClient.getDbSize.mockResolvedValue({
        sizeBytes: 1024,
        storageMode: 'opfs',
      });
      mockLockManager.acquireLock.mockResolvedValue({
        acquired: true,
        holderId: null,
        holderStale: false,
      });
      mockWorkerClient.openDb.mockResolvedValue({ isWriter: true });

      // Track when queryBuilderState is cleared relative to getSchema
      let stateWhenSchemaFetched: typeof store.queryBuilderState = undefined;
      mockWorkerClient.getSchema.mockImplementation(async () => {
        // Capture the state at the moment getSchema is called
        stateWhenSchemaFetched = getState().queryBuilderState;
        return { tables: ['new_table'], views: [], indexes: [] };
      });

      await openDb('another-db');

      // queryBuilderState should have been null when getSchema was called
      expect(stateWhenSchemaFetched).toBeNull();
    });
  });
});
