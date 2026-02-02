/**
 * Unit tests for Registry Handlers
 *
 * Tests cover:
 * - handleOpenRequest: IDB vs OPFS storage mode affects isWriter response
 * - IDB databases always return isWriter: true (multi-tab safe)
 * - OPFS databases return isWriter based on readOnly parameter
 * - Stale registry cleanup when file not found
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies before import
const mockResolveDbPath = vi.fn();
const mockOpenDatabase = vi.fn();
const mockResetSessionTracker = vi.fn();
const mockGetRegistry = vi.fn();

vi.mock('../../storage', () => ({
  resolveDbPath: (...args: unknown[]) => mockResolveDbPath(...args),
}));

vi.mock('../../sqlite-engine', () => ({
  openDatabase: (...args: unknown[]) => mockOpenDatabase(...args),
}));

vi.mock('../query', () => ({
  resetSessionTracker: () => mockResetSessionTracker(),
}));

vi.mock('../../db-registry', () => ({
  getRegistry: () => mockGetRegistry(),
  toFilename: vi.fn((name: string) => `${name}.sqlite`),
  forceReinitializeRegistry: vi.fn(),
  resetRegistry: vi.fn(),
}));

vi.mock('../../../core/engine/db-engine', () => ({
  getEngine: vi.fn(),
  resetEngine: vi.fn(),
}));

vi.mock('../../../core/engine/opfs-vfs', () => ({
  OPFS_VFS_NAME: 'opfs-coop-sync',
  getOPFSDatabaseSize: vi.fn(),
  ensureAppDirectories: vi.fn(),
}));

vi.mock('../../idb-storage', () => ({
  getIdbDbSize: vi.fn(),
}));

// Import after mocks
import { handleOpenRequest, type PostResponse } from '../registry';
import { OPFS_VFS_NAME } from '../../../core/engine/opfs-vfs';

describe('handleOpenRequest', () => {
  let mockPostResponse: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPostResponse = vi.fn();
    mockResetSessionTracker.mockClear();
    mockOpenDatabase.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('IDB storage mode (multi-tab safe)', () => {
    beforeEach(() => {
      // IDB uses the idb-batch-atomic VFS, not OPFS
      mockResolveDbPath.mockResolvedValue({
        path: 'idb:test-db.sqlite',
        vfsName: 'idb-batch-atomic',
      });
    });

    it('should always return isWriter: true for IDB databases', async () => {
      await handleOpenRequest(
        { type: 'open', dbName: 'test-idb-db' },
        1,
        mockPostResponse as PostResponse
      );

      expect(mockPostResponse).toHaveBeenCalledWith(
        { type: 'lockStatus', isWriter: true },
        1
      );
    });

    it('should return isWriter: true even when readOnly is requested for IDB', async () => {
      // For IDB, even if readOnly is requested, isWriter should be true
      // because IDB is multi-tab safe
      await handleOpenRequest(
        { type: 'open', dbName: 'test-idb-db', readOnly: true },
        2,
        mockPostResponse as PostResponse
      );

      expect(mockPostResponse).toHaveBeenCalledWith(
        { type: 'lockStatus', isWriter: true },
        2
      );
    });

    it('should open database without createIfMissing for IDB', async () => {
      await handleOpenRequest(
        { type: 'open', dbName: 'test-idb-db' },
        3,
        mockPostResponse as PostResponse
      );

      expect(mockOpenDatabase).toHaveBeenCalledWith(
        'idb:test-db.sqlite',
        'idb-batch-atomic',
        { readOnly: false, createIfMissing: false }
      );
    });
  });

  describe('OPFS storage mode (requires Web Locks)', () => {
    beforeEach(() => {
      // OPFS uses the opfs-coop-sync VFS
      mockResolveDbPath.mockResolvedValue({
        path: '/wasm-sqlite-editor/databases/test-db.sqlite',
        vfsName: OPFS_VFS_NAME,
      });
    });

    it('should return isWriter: true when not readOnly for OPFS', async () => {
      await handleOpenRequest(
        { type: 'open', dbName: 'test-opfs-db' },
        4,
        mockPostResponse as PostResponse
      );

      expect(mockPostResponse).toHaveBeenCalledWith(
        { type: 'lockStatus', isWriter: true },
        4
      );
    });

    it('should return isWriter: false when readOnly is true for OPFS', async () => {
      await handleOpenRequest(
        { type: 'open', dbName: 'test-opfs-db', readOnly: true },
        5,
        mockPostResponse as PostResponse
      );

      expect(mockPostResponse).toHaveBeenCalledWith(
        { type: 'lockStatus', isWriter: false },
        5
      );
    });

    it('should open database with createIfMissing: true for OPFS', async () => {
      await handleOpenRequest(
        { type: 'open', dbName: 'test-opfs-db' },
        6,
        mockPostResponse as PostResponse
      );

      // OPFS mode uses createIfMissing to work around VFS cache issues
      expect(mockOpenDatabase).toHaveBeenCalledWith(
        '/wasm-sqlite-editor/databases/test-db.sqlite',
        OPFS_VFS_NAME,
        { readOnly: false, createIfMissing: true }
      );
    });

    it('should pass readOnly through to openDatabase for OPFS', async () => {
      await handleOpenRequest(
        { type: 'open', dbName: 'test-opfs-db', readOnly: true },
        7,
        mockPostResponse as PostResponse
      );

      expect(mockOpenDatabase).toHaveBeenCalledWith(
        '/wasm-sqlite-editor/databases/test-db.sqlite',
        OPFS_VFS_NAME,
        { readOnly: true, createIfMissing: true }
      );
    });
  });

  describe('error handling', () => {
    it('should return error response when resolveDbPath fails', async () => {
      mockResolveDbPath.mockRejectedValue(new Error('Path resolution failed'));

      await handleOpenRequest(
        { type: 'open', dbName: 'bad-db' },
        8,
        mockPostResponse as PostResponse
      );

      expect(mockPostResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'error',
          message: expect.stringContaining('Path resolution failed'),
          code: 'UNKNOWN',
        }),
        8
      );
    });

    it('should return NOT_FOUND error and clean stale entry when file not found', async () => {
      mockResolveDbPath.mockResolvedValue({
        path: '/wasm-sqlite-editor/databases/missing.sqlite',
        vfsName: OPFS_VFS_NAME,
      });
      mockOpenDatabase.mockRejectedValue(new Error('NotFoundError: file not found'));

      const mockRegistry = {
        getDatabaseByName: vi.fn().mockReturnValue({ id: 'stale-id' }),
        removeDatabase: vi.fn().mockResolvedValue(undefined),
      };
      mockGetRegistry.mockReturnValue(mockRegistry);

      await handleOpenRequest(
        { type: 'open', dbName: 'missing-db' },
        9,
        mockPostResponse as PostResponse
      );

      // Should attempt to clean up stale entry
      expect(mockRegistry.getDatabaseByName).toHaveBeenCalledWith('missing-db');
      expect(mockRegistry.removeDatabase).toHaveBeenCalledWith('stale-id');

      // Should return NOT_FOUND error
      expect(mockPostResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'error',
          code: 'NOT_FOUND',
        }),
        9
      );
    });

    it('should handle SQLITE_CANTOPEN as NOT_FOUND', async () => {
      mockResolveDbPath.mockResolvedValue({
        path: '/wasm-sqlite-editor/databases/cantopen.sqlite',
        vfsName: OPFS_VFS_NAME,
      });
      mockOpenDatabase.mockRejectedValue(new Error('SQLITE_CANTOPEN: unable to open database file'));
      mockGetRegistry.mockReturnValue({
        getDatabaseByName: vi.fn().mockReturnValue(null),
        removeDatabase: vi.fn(),
      });

      await handleOpenRequest(
        { type: 'open', dbName: 'cantopen-db' },
        10,
        mockPostResponse as PostResponse
      );

      expect(mockPostResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'error',
          code: 'NOT_FOUND',
        }),
        10
      );
    });
  });

  describe('session tracker reset', () => {
    it('should reset session tracker before opening database', async () => {
      mockResolveDbPath.mockResolvedValue({
        path: 'idb:test.sqlite',
        vfsName: 'idb-batch-atomic',
      });

      await handleOpenRequest(
        { type: 'open', dbName: 'test-db' },
        11,
        mockPostResponse as PostResponse
      );

      expect(mockResetSessionTracker).toHaveBeenCalled();
    });
  });
});
