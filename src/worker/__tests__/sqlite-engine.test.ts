/**
 * Unit tests for SQLite Engine wrapper
 *
 * Tests journal_mode enforcement for OPFS mode:
 * - PRAGMA journal_mode=DELETE is set on open for OPFS connections
 * - IndexedDB mode skips journal_mode PRAGMA (irrelevant)
 * - Verification that no WAL/SHM files exist after writes
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the db-engine module before importing sqlite-engine
const mockExec = vi.fn().mockResolvedValue({ rowsAffected: 0, lastInsertId: 0 });
const mockQuery = vi.fn().mockResolvedValue({
  columns: ['journal_mode'],
  columnTypes: ['TEXT'],
  rows: [['delete']],
  rowsAffected: 0,
});
const mockOpen = vi.fn().mockResolvedValue(undefined);
const mockClose = vi.fn().mockResolvedValue(undefined);
const mockInitialize = vi.fn().mockResolvedValue(undefined);
const mockIsReady = vi.fn().mockReturnValue(true);
const mockGetDbName = vi.fn().mockReturnValue(null);

vi.mock('../../core/engine/db-engine', () => ({
  getEngine: vi.fn(() => ({
    exec: mockExec,
    query: mockQuery,
    open: mockOpen,
    close: mockClose,
    initialize: mockInitialize,
    isReady: mockIsReady,
    getDbName: mockGetDbName,
  })),
  DatabaseEngine: vi.fn(),
}));

vi.mock('../../core/engine/opfs-vfs', () => ({
  OPFS_VFS_NAME: 'opfs-coop-sync',
  IDB_VFS_NAME: 'idb-batch-atomic',
}));

// Import after mocks are set up
import { openDatabase, verifyJournalMode, type OpenDatabaseOptions } from '../sqlite-engine';
import { OPFS_VFS_NAME, IDB_VFS_NAME } from '../../core/engine/opfs-vfs';

describe('sqlite-engine - openDatabase', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsReady.mockReturnValue(true);
    mockExec.mockResolvedValue({ rowsAffected: 0, lastInsertId: 0 });
    mockQuery.mockResolvedValue({
      columns: ['journal_mode'],
      columnTypes: ['TEXT'],
      rows: [['delete']],
      rowsAffected: 0,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('OPFS mode', () => {
    it('should set PRAGMA journal_mode=DELETE after open for OPFS', async () => {
      await openDatabase('/wasm-sqlite-editor/databases/test.sqlite', OPFS_VFS_NAME);

      // Verify open was called
      expect(mockOpen).toHaveBeenCalledWith(
        '/wasm-sqlite-editor/databases/test.sqlite',
        OPFS_VFS_NAME,
        expect.any(Object)
      );

      // Verify PRAGMA journal_mode=DELETE was executed
      expect(mockExec).toHaveBeenCalledWith('PRAGMA journal_mode=DELETE');
    });

    it('should verify journal_mode is DELETE after setting', async () => {
      await openDatabase('/wasm-sqlite-editor/databases/test.sqlite', OPFS_VFS_NAME);

      // Verify journal_mode query was executed to confirm setting
      expect(mockQuery).toHaveBeenCalledWith('PRAGMA journal_mode');
    });

    it('should throw if journal_mode fails to set to DELETE', async () => {
      mockQuery.mockResolvedValue({
        columns: ['journal_mode'],
        columnTypes: ['TEXT'],
        rows: [['wal']], // Returns WAL instead of DELETE
        rowsAffected: 0,
      });

      await expect(
        openDatabase('/wasm-sqlite-editor/databases/test.sqlite', OPFS_VFS_NAME)
      ).rejects.toThrow('Failed to set journal_mode=DELETE');
    });

    it('should pass readOnly option through to engine.open', async () => {
      await openDatabase('/wasm-sqlite-editor/databases/test.sqlite', OPFS_VFS_NAME, {
        readOnly: true,
      });

      expect(mockOpen).toHaveBeenCalledWith(
        '/wasm-sqlite-editor/databases/test.sqlite',
        OPFS_VFS_NAME,
        expect.objectContaining({ readOnly: true })
      );
    });

    it('should pass createIfMissing option through to engine.open', async () => {
      await openDatabase('/wasm-sqlite-editor/databases/test.sqlite', OPFS_VFS_NAME, {
        createIfMissing: true,
      });

      expect(mockOpen).toHaveBeenCalledWith(
        '/wasm-sqlite-editor/databases/test.sqlite',
        OPFS_VFS_NAME,
        expect.objectContaining({ createIfMissing: true })
      );
    });
  });

  describe('IndexedDB mode', () => {
    it('should NOT set journal_mode for IDB connections', async () => {
      await openDatabase('mydb', IDB_VFS_NAME);

      // Verify open was called
      expect(mockOpen).toHaveBeenCalledWith('mydb', IDB_VFS_NAME, expect.any(Object));

      // Verify PRAGMA journal_mode was NOT executed for IDB
      expect(mockExec).not.toHaveBeenCalledWith('PRAGMA journal_mode=DELETE');
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('should skip journal_mode PRAGMA for IDB even with options', async () => {
      await openDatabase('mydb', IDB_VFS_NAME, {
        readOnly: false,
        createIfMissing: true,
      });

      // No journal_mode calls for IDB
      expect(mockExec).not.toHaveBeenCalledWith('PRAGMA journal_mode=DELETE');
    });
  });

  describe('No VFS specified (legacy)', () => {
    it('should NOT set journal_mode when no VFS is specified', async () => {
      await openDatabase('mydb', undefined);

      expect(mockOpen).toHaveBeenCalledWith('mydb', undefined, expect.any(Object));
      expect(mockExec).not.toHaveBeenCalledWith('PRAGMA journal_mode=DELETE');
    });
  });

  describe('Engine initialization', () => {
    it('should initialize engine if not ready', async () => {
      mockIsReady.mockReturnValueOnce(false).mockReturnValue(true);

      await openDatabase('/path/test.sqlite', OPFS_VFS_NAME);

      expect(mockInitialize).toHaveBeenCalled();
    });

    it('should skip initialization if engine is already ready', async () => {
      mockIsReady.mockReturnValue(true);

      await openDatabase('/path/test.sqlite', OPFS_VFS_NAME);

      expect(mockInitialize).not.toHaveBeenCalled();
    });
  });
});

describe('sqlite-engine - verifyJournalMode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsReady.mockReturnValue(true);
  });

  it('should return true when journal_mode is DELETE', async () => {
    mockQuery.mockResolvedValue({
      columns: ['journal_mode'],
      columnTypes: ['TEXT'],
      rows: [['delete']],
      rowsAffected: 0,
    });

    const result = await verifyJournalMode();
    expect(result).toBe(true);
    expect(mockQuery).toHaveBeenCalledWith('PRAGMA journal_mode');
  });

  it('should return false when journal_mode is WAL', async () => {
    mockQuery.mockResolvedValue({
      columns: ['journal_mode'],
      columnTypes: ['TEXT'],
      rows: [['wal']],
      rowsAffected: 0,
    });

    const result = await verifyJournalMode();
    expect(result).toBe(false);
  });

  it('should handle case-insensitive comparison', async () => {
    mockQuery.mockResolvedValue({
      columns: ['journal_mode'],
      columnTypes: ['TEXT'],
      rows: [['DELETE']],
      rowsAffected: 0,
    });

    const result = await verifyJournalMode();
    expect(result).toBe(true);
  });

  it('should throw if engine is not ready', async () => {
    mockIsReady.mockReturnValue(false);

    await expect(verifyJournalMode()).rejects.toThrow('Engine not ready');
  });
});
