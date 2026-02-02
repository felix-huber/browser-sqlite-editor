/**
 * Tests for Query Builder state management in store (Fix #5)
 *
 * The bug: Query Builder state was not being cleared when switching databases.
 * The fix clears queryBuilderState in openDb() when a new database is opened.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from '@testing-library/react';
import {
  useDatabaseStore,
  setQueryBuilderState,
  clearQueryBuilderState,
  openDb,
  closeDb,
  setActionDeps,
  resetActionDeps,
  type QueryBuilderState,
} from '../index';
// Mock type imports removed - using inline type assertions

// =============================================================================
// Mock Worker Client
// =============================================================================

function createMockWorkerClient() {
  return {
    openDb: vi.fn().mockResolvedValue({ isWriter: true }),
    closeDb: vi.fn().mockResolvedValue(undefined),
    getSchema: vi.fn().mockResolvedValue({ tables: [], views: [], indexes: [] }),
    getDbSize: vi.fn().mockResolvedValue({ sizeBytes: 1000, storageMode: 'opfs' as const }),
    request: vi.fn(),
    ping: vi.fn().mockResolvedValue(undefined),
    query: vi.fn(),
    exec: vi.fn(),
    getRegistry: vi.fn().mockResolvedValue({ v: 1, databases: [] }),
    getTableInfo: vi.fn(),
    getForeignKeys: vi.fn(),
    createDb: vi.fn(),
    deleteDb: vi.fn(),
    renameDb: vi.fn(),
    importFile: vi.fn(),
    exportDb: vi.fn(),
    cancel: vi.fn(),
    acquireLock: vi.fn(),
    releaseLock: vi.fn(),
    resetApp: vi.fn(),
    isReady: vi.fn().mockReturnValue(true),
  };
}

function createMockLockManager() {
  return {
    acquireLock: vi.fn().mockResolvedValue({ acquired: true, holderStale: false }),
    releaseLock: vi.fn().mockResolvedValue(undefined),
    hasLock: vi.fn().mockReturnValue(false),
    isLockHeld: vi.fn().mockReturnValue(false),
  };
}

// =============================================================================
// Test Setup
// =============================================================================

describe('Store - Query Builder state cleared on DB switch', () => {
  let mockWorkerClient: ReturnType<typeof createMockWorkerClient>;
  let mockLockManager: ReturnType<typeof createMockLockManager>;

  beforeEach(() => {
    useDatabaseStore.getState().reset();
    mockWorkerClient = createMockWorkerClient();
    mockLockManager = createMockLockManager();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setActionDeps({ workerClient: mockWorkerClient, lockManager: mockLockManager } as any);
  });

  afterEach(() => {
    resetActionDeps();
    useDatabaseStore.getState().reset();
  });

  it('should have null queryBuilderState initially', () => {
    const state = useDatabaseStore.getState();
    expect(state.queryBuilderState).toBeNull();
  });

  it('should store Query Builder state when set', () => {
    const testState: QueryBuilderState = {
      nodes: [
        {
          id: 'test-node',
          type: 'tableBox',
          position: { x: 0, y: 0 },
          data: {
            tableName: 'users',
            alias: 't1',
            columns: [],
            selectedColumns: ['id'],
          },
        },
      ],
      joins: [],
      whereConditions: [],
      whereLogic: 'AND',
      sortConditions: [],
      limit: null,
    };

    act(() => {
      setQueryBuilderState(testState);
    });

    const state = useDatabaseStore.getState();
    expect(state.queryBuilderState).toEqual(testState);
  });

  it('should clear Query Builder state when opening a different database', async () => {
    // Set up initial state with Query Builder data
    const testState: QueryBuilderState = {
      nodes: [
        {
          id: 'test-node',
          type: 'tableBox',
          position: { x: 0, y: 0 },
          data: {
            tableName: 'users',
            alias: 't1',
            columns: [],
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
          joinType: 'INNER',
        },
      ],
      whereConditions: [
        { column: 'id', operator: '=', value: '1' },
      ],
      whereLogic: 'AND',
      sortConditions: [{ column: 't1.id', direction: 'ASC' }],
      limit: 100,
    };

    act(() => {
      setQueryBuilderState(testState);
    });

    expect(useDatabaseStore.getState().queryBuilderState).not.toBeNull();

    // Open a new database
    await act(async () => {
      await openDb('new-database');
    });

    // Query Builder state should be cleared
    expect(useDatabaseStore.getState().queryBuilderState).toBeNull();
  });

  it('should clear Query Builder state when closing database', async () => {
    // Set up state
    act(() => {
      useDatabaseStore.getState().setActiveDb('test-db');
      useDatabaseStore.getState().setLockHolder('self');
      useDatabaseStore.getState().setStorageMode('opfs');
      setQueryBuilderState({
        nodes: [],
        joins: [],
        whereConditions: [],
        whereLogic: 'AND',
        sortConditions: [],
        limit: 10,
      });
    });

    expect(useDatabaseStore.getState().queryBuilderState).not.toBeNull();

    // Close database
    await act(async () => {
      await closeDb();
    });

    // Query Builder state should be cleared
    expect(useDatabaseStore.getState().queryBuilderState).toBeNull();
  });

  it('should clear Query Builder state on store reset', () => {
    act(() => {
      setQueryBuilderState({
        nodes: [],
        joins: [],
        whereConditions: [],
        whereLogic: 'OR',
        sortConditions: [],
        limit: 50,
      });
    });

    expect(useDatabaseStore.getState().queryBuilderState).not.toBeNull();

    act(() => {
      useDatabaseStore.getState().reset();
    });

    expect(useDatabaseStore.getState().queryBuilderState).toBeNull();
  });
});

describe('Store - Query Builder state source code verification', () => {
  it('should clear queryBuilderState in openDb function', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const storePath = resolve(__dirname, '../index.ts');
    const content = readFileSync(storePath, 'utf-8');

    // Verify openDb clears Query Builder state
    const openDbMatch = content.match(
      /export async function openDb[\s\S]*?store\.setQueryBuilderState\(null\)/
    );
    expect(openDbMatch).not.toBeNull();
  });

  it('should have comment explaining why state is cleared on DB switch', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const storePath = resolve(__dirname, '../index.ts');
    const content = readFileSync(storePath, 'utf-8');

    // Verify there's a comment about clearing Query Builder state
    expect(content).toMatch(/Clear Query Builder state when switching databases/i);
  });

  it('should clear queryBuilderState in closeDb function', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const storePath = resolve(__dirname, '../index.ts');
    const content = readFileSync(storePath, 'utf-8');

    // Verify closeDb also clears Query Builder state
    const closeDbMatch = content.match(
      /export async function closeDb[\s\S]*?store\.setQueryBuilderState\(null\)/
    );
    expect(closeDbMatch).not.toBeNull();
  });

  it('should clear queryBuilderState in reset action', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const storePath = resolve(__dirname, '../index.ts');
    const content = readFileSync(storePath, 'utf-8');

    // Verify reset clears Query Builder state
    expect(content).toMatch(/reset:[\s\S]*?queryBuilderState:\s*null/);
  });
});

describe('Store - clearQueryBuilderState helper', () => {
  beforeEach(() => {
    useDatabaseStore.getState().reset();
  });

  it('should export clearQueryBuilderState function', async () => {
    const storeModule = await import('../index');
    expect(typeof storeModule.clearQueryBuilderState).toBe('function');
  });

  it('should clear state when called', () => {
    act(() => {
      setQueryBuilderState({
        nodes: [],
        joins: [],
        whereConditions: [],
        whereLogic: 'AND',
        sortConditions: [],
        limit: 25,
      });
    });

    expect(useDatabaseStore.getState().queryBuilderState).not.toBeNull();

    act(() => {
      clearQueryBuilderState();
    });

    expect(useDatabaseStore.getState().queryBuilderState).toBeNull();
  });
});
