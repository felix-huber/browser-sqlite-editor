/**
 * Unit tests for SQLite Engine wrapper
 *
 * Tests journal_mode enforcement for OPFS mode:
 * - PRAGMA journal_mode=DELETE is set on open for OPFS connections
 * - IndexedDB mode skips journal_mode PRAGMA (irrelevant)
 * - Error handling when journal_mode enforcement fails
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Create spies that track call order and arguments
let execCalls: string[] = [];
let queryCalls: string[] = [];
let openCalls: Array<{ path: string; vfs: string | undefined; opts: unknown }> = [];
let engineReady = true;
let journalModeResponse = 'delete';

// Use vi.hoisted to ensure mock values are available during module hoisting
const { mockEngine, mockEnsureAppDirectories } = vi.hoisted(() => {
  const mockEnsureAppDirectories = vi.fn().mockResolvedValue(undefined);
  const mockEngine = {
    exec: vi.fn(),
    query: vi.fn(),
    open: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
    initialize: vi.fn().mockResolvedValue(undefined),
    isReady: vi.fn(() => true),
    getDbName: vi.fn().mockReturnValue(null),
  };
  return { mockEngine, mockEnsureAppDirectories };
});

vi.mock('../../core/engine/db-engine', () => ({
  getEngine: vi.fn(() => mockEngine),
  DatabaseEngine: vi.fn(),
}));

vi.mock('../../core/engine/opfs-vfs', () => ({
  OPFS_VFS_NAME: 'opfs-coop-sync',
  IDB_VFS_NAME: 'idb-batch-atomic',
  ensureAppDirectories: mockEnsureAppDirectories,
}));

// Import after mocks are set up
import { openDatabase, verifyJournalMode } from '../sqlite-engine';
import { OPFS_VFS_NAME, IDB_VFS_NAME } from '../../core/engine/opfs-vfs';

describe('sqlite-engine - openDatabase', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    execCalls = [];
    queryCalls = [];
    openCalls = [];
    engineReady = true;
    journalModeResponse = 'delete';

    // Set up mock implementations
    mockEngine.exec.mockImplementation(async (sql: string) => {
      execCalls.push(sql);
      return { rowsAffected: 0, lastInsertId: 0 };
    });
    mockEngine.query.mockImplementation(async (sql: string) => {
      queryCalls.push(sql);
      return {
        columns: ['journal_mode'],
        columnTypes: ['TEXT'],
        rows: [[journalModeResponse]],
        rowsAffected: 0,
      };
    });
    mockEngine.open.mockImplementation(async (path: string, vfs: string | undefined, opts: unknown) => {
      openCalls.push({ path, vfs, opts });
    });
    mockEngine.isReady.mockImplementation(() => engineReady);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('OPFS mode - journal_mode enforcement', () => {
    it('enforces journal_mode=DELETE for OPFS by running PRAGMA after open', async () => {
      await openDatabase('/wasm-sqlite-editor/databases/test.sqlite', OPFS_VFS_NAME);

      // Verify the sequence: open first, then PRAGMA
      expect(openCalls).toHaveLength(1);
      expect(openCalls[0].vfs).toBe(OPFS_VFS_NAME);
      expect(execCalls).toContain('PRAGMA journal_mode=DELETE');
      expect(queryCalls).toContain('PRAGMA journal_mode');
    });

    it('rejects when PRAGMA journal_mode returns non-DELETE value', async () => {
      journalModeResponse = 'wal';

      await expect(
        openDatabase('/wasm-sqlite-editor/databases/test.sqlite', OPFS_VFS_NAME)
      ).rejects.toThrow(/Failed to set journal_mode=DELETE.*current mode is 'wal'/);
    });

    it('rejects when PRAGMA query returns empty result', async () => {
      mockEngine.query.mockResolvedValueOnce({
        columns: ['journal_mode'],
        columnTypes: ['TEXT'],
        rows: [],
        rowsAffected: 0,
      });

      await expect(
        openDatabase('/wasm-sqlite-editor/databases/test.sqlite', OPFS_VFS_NAME)
      ).rejects.toThrow('no result from PRAGMA query');
    });
  });

  describe('IDB mode - no journal_mode enforcement', () => {
    it('skips PRAGMA journal_mode for IDB connections', async () => {
      await openDatabase('mydb', IDB_VFS_NAME);

      expect(openCalls).toHaveLength(1);
      expect(openCalls[0].vfs).toBe(IDB_VFS_NAME);
      // No PRAGMA calls for IDB
      expect(execCalls).not.toContain('PRAGMA journal_mode=DELETE');
      expect(queryCalls).toHaveLength(0);
    });
  });

  describe('undefined VFS - no journal_mode enforcement', () => {
    it('skips PRAGMA journal_mode when VFS is undefined', async () => {
      await openDatabase('mydb', undefined);

      expect(openCalls).toHaveLength(1);
      expect(openCalls[0].vfs).toBeUndefined();
      expect(execCalls).not.toContain('PRAGMA journal_mode=DELETE');
    });
  });

  describe('options passthrough', () => {
    it('passes readOnly=true to engine.open', async () => {
      await openDatabase('/path/test.sqlite', OPFS_VFS_NAME, { readOnly: true });

      expect(openCalls[0].opts).toMatchObject({ readOnly: true });
    });

    it('passes createIfMissing=true to engine.open', async () => {
      await openDatabase('/path/test.sqlite', OPFS_VFS_NAME, { createIfMissing: true });

      expect(openCalls[0].opts).toMatchObject({ createIfMissing: true });
    });

    it('defaults readOnly and createIfMissing to false', async () => {
      await openDatabase('/path/test.sqlite', OPFS_VFS_NAME);

      expect(openCalls[0].opts).toMatchObject({ readOnly: false, createIfMissing: false });
    });
  });

  describe('engine initialization', () => {
    it('initializes engine when not ready', async () => {
      engineReady = false;
      mockEngine.isReady.mockReturnValueOnce(false).mockReturnValue(true);

      await openDatabase('/path/test.sqlite', OPFS_VFS_NAME);

      expect(mockEngine.initialize).toHaveBeenCalled();
    });

    it('skips initialization when engine already ready', async () => {
      engineReady = true;

      await openDatabase('/path/test.sqlite', OPFS_VFS_NAME);

      expect(mockEngine.initialize).not.toHaveBeenCalled();
    });
  });
});

describe('sqlite-engine - verifyJournalMode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryCalls = [];
    engineReady = true;
    journalModeResponse = 'delete';

    // Set up mock implementations
    mockEngine.query.mockImplementation(async (sql: string) => {
      queryCalls.push(sql);
      return {
        columns: ['journal_mode'],
        columnTypes: ['TEXT'],
        rows: [[journalModeResponse]],
        rowsAffected: 0,
      };
    });
    mockEngine.isReady.mockImplementation(() => engineReady);
  });

  it('returns true when current journal_mode is delete', async () => {
    journalModeResponse = 'delete';

    const result = await verifyJournalMode();

    expect(result).toBe(true);
    expect(queryCalls).toContain('PRAGMA journal_mode');
  });

  it('returns false when current journal_mode is wal', async () => {
    journalModeResponse = 'wal';

    const result = await verifyJournalMode();

    expect(result).toBe(false);
  });

  it('returns false when current journal_mode is memory', async () => {
    journalModeResponse = 'memory';

    const result = await verifyJournalMode();

    expect(result).toBe(false);
  });

  it('handles uppercase DELETE response', async () => {
    journalModeResponse = 'DELETE';

    const result = await verifyJournalMode();

    expect(result).toBe(true);
  });

  it('throws when engine is not ready', async () => {
    engineReady = false;
    mockEngine.isReady.mockReturnValue(false);

    await expect(verifyJournalMode()).rejects.toThrow('Engine not ready');
  });

  it('returns false when query returns empty rows', async () => {
    engineReady = true;
    mockEngine.isReady.mockReturnValue(true);
    mockEngine.query.mockResolvedValueOnce({
      columns: ['journal_mode'],
      columnTypes: ['TEXT'],
      rows: [],
      rowsAffected: 0,
    });

    const result = await verifyJournalMode();

    expect(result).toBe(false);
  });
});
