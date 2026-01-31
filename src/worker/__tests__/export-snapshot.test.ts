/**
 * Unit tests for Database Export with Quota-Exceeded Handling
 *
 * Tests cover:
 * - Export succeeds when OPFS quota is 0 (uses direct file read path)
 * - Progress callback for large exports (>10MB)
 * - Cancel button stops export
 * - Partial exports on failure are cleaned up
 * - Exported .sqlite file is a transactionally consistent snapshot (VACUUM INTO or direct read with checkpoint)
 * - E2E-US-009-02: Quota exceeded → Download Database still downloads a valid .sqlite snapshot
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  exportDatabaseSnapshot,
  type ExportStorageAdapter,
  type ExportEngine,
  type ExportProgress,
} from '../export-snapshot';

// =============================================================================
// Test Helpers
// =============================================================================

/** SQLite file magic header */
const SQLITE_MAGIC = new Uint8Array([
  0x53, 0x51, 0x4c, 0x69, 0x74, 0x65, 0x20, 0x66,
  0x6f, 0x72, 0x6d, 0x61, 0x74, 0x20, 0x33, 0x00, // "SQLite format 3\0"
]);

/**
 * Create a mock SQLite file with given size
 */
function createMockSQLiteData(size: number): Uint8Array {
  const data = new Uint8Array(Math.max(size, SQLITE_MAGIC.length));
  data.set(SQLITE_MAGIC);
  return data;
}

/**
 * Create a mock database engine for testing
 */
function createMockEngine(options: {
  dbName?: string;
  vacuumIntoFails?: boolean;
  vacuumIntoError?: Error;
} = {}): ExportEngine {
  const {
    dbName = 'test.db',
    vacuumIntoFails = false,
    vacuumIntoError = new Error('SQLITE_FULL: database or disk is full'),
  } = options;

  return {
    isReady: () => true,
    getDbName: () => dbName,
    exec: vi.fn().mockImplementation(async (sql: string) => {
      if (sql.includes('VACUUM INTO') && vacuumIntoFails) {
        throw vacuumIntoError;
      }
      return { rowsAffected: 0, lastInsertId: 0 };
    }),
  };
}

/**
 * Create a mock storage adapter for testing
 */
function createMockStorageAdapter(options: {
  opfsAvailable?: boolean;
  hasQuota?: boolean;
  databaseData?: Uint8Array;
  exportFileData?: Uint8Array;
  readFails?: boolean;
  writeFails?: boolean;
  writeError?: Error;
} = {}): ExportStorageAdapter {
  const {
    opfsAvailable = true,
    hasQuota = true,
    databaseData = createMockSQLiteData(1024),
    exportFileData = createMockSQLiteData(1024),
    readFails = false,
    writeFails = false,
    writeError = new DOMException('Quota exceeded', 'QuotaExceededError'),
  } = options;

  return {
    isOpfsAvailable: vi.fn().mockResolvedValue(opfsAvailable),
    hasQuotaForExport: vi.fn().mockResolvedValue(hasQuota),
    readDatabaseFile: vi.fn().mockImplementation(async () => {
      if (readFails) {
        throw new Error('Read failed');
      }
      return databaseData;
    }),
    readExportFile: vi.fn().mockImplementation(async () => {
      if (readFails) {
        throw new Error('Read failed');
      }
      return exportFileData;
    }),
    deleteExportFile: vi.fn().mockResolvedValue(undefined),
  };
}

/**
 * Check if a Uint8Array starts with SQLite magic bytes
 */
function isSQLiteFile(data: Uint8Array): boolean {
  if (data.length < SQLITE_MAGIC.length) return false;
  for (let i = 0; i < SQLITE_MAGIC.length; i++) {
    if (data[i] !== SQLITE_MAGIC[i]) return false;
  }
  return true;
}

// =============================================================================
// Export Snapshot Tests
// =============================================================================

describe('exportDatabaseSnapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('transactional consistency', () => {
    it('should use VACUUM INTO for point-in-time snapshot when storage is available', async () => {
      const mockEngine = createMockEngine();
      const mockStorageAdapter = createMockStorageAdapter();

      const result = await exportDatabaseSnapshot('test-db', {
        engine: mockEngine,
        storageAdapter: mockStorageAdapter,
      });

      expect(result.success).toBe(true);
      expect(mockEngine.exec).toHaveBeenCalledWith(
        expect.stringContaining('VACUUM INTO')
      );
      expect(result.method).toBe('vacuum_into');
      expect(isSQLiteFile(result.data!)).toBe(true);
    });

    it('should fall back to direct read when VACUUM INTO fails due to quota', async () => {
      const mockEngine = createMockEngine({ vacuumIntoFails: true });
      const mockStorageAdapter = createMockStorageAdapter({ hasQuota: false });

      const result = await exportDatabaseSnapshot('test-db', {
        engine: mockEngine,
        storageAdapter: mockStorageAdapter,
      });

      expect(result.success).toBe(true);
      expect(mockStorageAdapter.readDatabaseFile).toHaveBeenCalled();
      expect(result.method).toBe('direct_read');
      expect(isSQLiteFile(result.data!)).toBe(true);
    });

    it('should checkpoint WAL before direct read', async () => {
      const mockEngine = createMockEngine();
      const mockStorageAdapter = createMockStorageAdapter({ hasQuota: false });

      await exportDatabaseSnapshot('test-db', {
        engine: mockEngine,
        storageAdapter: mockStorageAdapter,
      });

      expect(mockEngine.exec).toHaveBeenCalledWith(
        expect.stringContaining('wal_checkpoint')
      );
    });
  });

  describe('quota exceeded handling', () => {
    it('should succeed when OPFS quota is 0', async () => {
      const mockEngine = createMockEngine();
      const mockStorageAdapter = createMockStorageAdapter({ hasQuota: false });

      const result = await exportDatabaseSnapshot('test-db', {
        engine: mockEngine,
        storageAdapter: mockStorageAdapter,
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(isSQLiteFile(result.data!)).toBe(true);
    });

    it('should not attempt VACUUM INTO when quota is exhausted', async () => {
      const mockEngine = createMockEngine();
      const mockStorageAdapter = createMockStorageAdapter({ hasQuota: false });

      await exportDatabaseSnapshot('test-db', {
        engine: mockEngine,
        storageAdapter: mockStorageAdapter,
      });

      // VACUUM INTO should not have been called
      const vacuumCalls = (mockEngine.exec as ReturnType<typeof vi.fn>).mock.calls.filter(
        (call) => call[0].includes('VACUUM INTO')
      );
      expect(vacuumCalls.length).toBe(0);
    });

    it('should use direct read path when OPFS is unavailable', async () => {
      const mockEngine = createMockEngine();
      const mockStorageAdapter = createMockStorageAdapter({ opfsAvailable: false });

      const result = await exportDatabaseSnapshot('test-db', {
        engine: mockEngine,
        storageAdapter: mockStorageAdapter,
      });

      expect(result.success).toBe(true);
      expect(result.method).toBe('direct_read');
      expect(mockStorageAdapter.readDatabaseFile).toHaveBeenCalled();
    });
  });

  describe('progress reporting', () => {
    it('should report progress for exports >10MB', async () => {
      const largeData = createMockSQLiteData(15 * 1024 * 1024); // 15MB
      const mockEngine = createMockEngine();
      const mockStorageAdapter = createMockStorageAdapter({
        hasQuota: false,
        databaseData: largeData,
      });

      const progressUpdates: ExportProgress[] = [];
      const onProgress = vi.fn((progress: ExportProgress) => {
        progressUpdates.push({ ...progress });
      });

      await exportDatabaseSnapshot('test-db', {
        engine: mockEngine,
        storageAdapter: mockStorageAdapter,
        onProgress,
      });

      expect(onProgress).toHaveBeenCalled();
      expect(progressUpdates.some((p) => p.percent > 0 && p.percent < 100)).toBe(true);
    });

    it('should report start and end progress for small exports', async () => {
      const smallData = createMockSQLiteData(5 * 1024 * 1024); // 5MB
      const mockEngine = createMockEngine();
      const mockStorageAdapter = createMockStorageAdapter({
        hasQuota: false,
        databaseData: smallData,
      });

      const progressUpdates: ExportProgress[] = [];
      const onProgress = vi.fn((progress: ExportProgress) => {
        progressUpdates.push({ ...progress });
      });

      await exportDatabaseSnapshot('test-db', {
        engine: mockEngine,
        storageAdapter: mockStorageAdapter,
        onProgress,
      });

      // Should have at least start (0%) and end (100%) progress
      expect(progressUpdates.some((p) => p.percent === 0)).toBe(true);
      expect(progressUpdates.some((p) => p.percent === 100)).toBe(true);
    });
  });

  describe('cancellation', () => {
    it('should stop export when cancel signal is triggered', async () => {
      const mockEngine = createMockEngine();
      const mockStorageAdapter = createMockStorageAdapter({ hasQuota: false });

      const abortController = new AbortController();
      // Abort immediately
      abortController.abort();

      const result = await exportDatabaseSnapshot('test-db', {
        engine: mockEngine,
        storageAdapter: mockStorageAdapter,
        signal: abortController.signal,
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('CANCELED');
    });

    it('should clean up partial artifacts when cancelled mid-export', async () => {
      const mockEngine = createMockEngine();
      const mockStorageAdapter = createMockStorageAdapter({
        hasQuota: true,
      });

      // Make readExportFile slow so we can cancel during it
      (mockStorageAdapter.readExportFile as ReturnType<typeof vi.fn>).mockImplementation(
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 100));
          return createMockSQLiteData(1024);
        }
      );

      const abortController = new AbortController();

      // Abort shortly after starting
      setTimeout(() => abortController.abort(), 10);

      const result = await exportDatabaseSnapshot('test-db', {
        engine: mockEngine,
        storageAdapter: mockStorageAdapter,
        signal: abortController.signal,
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('CANCELED');
      // Cleanup should have been called
      expect(mockStorageAdapter.deleteExportFile).toHaveBeenCalled();
    });
  });

  describe('cleanup on failure', () => {
    it('should clean up partial OPFS artifacts on failure', async () => {
      const mockEngine = createMockEngine();
      const mockStorageAdapter = createMockStorageAdapter({
        hasQuota: true,
        readFails: true,
      });

      const result = await exportDatabaseSnapshot('test-db', {
        engine: mockEngine,
        storageAdapter: mockStorageAdapter,
      });

      expect(result.success).toBe(false);
      expect(mockStorageAdapter.deleteExportFile).toHaveBeenCalled();
    });

    it('should not trigger partial download on failure', async () => {
      const mockEngine = createMockEngine();
      const mockStorageAdapter = createMockStorageAdapter({
        hasQuota: false,
        readFails: true,
      });

      const result = await exportDatabaseSnapshot('test-db', {
        engine: mockEngine,
        storageAdapter: mockStorageAdapter,
      });

      expect(result.success).toBe(false);
      expect(result.data).toBeUndefined();
    });
  });

  describe('IDB mode export', () => {
    it('should use direct read for IDB-backed databases', async () => {
      const mockEngine = createMockEngine();
      const mockStorageAdapter = createMockStorageAdapter({
        opfsAvailable: false,
      });

      const result = await exportDatabaseSnapshot('test-db', {
        engine: mockEngine,
        storageAdapter: mockStorageAdapter,
      });

      expect(result.success).toBe(true);
      expect(mockStorageAdapter.readDatabaseFile).toHaveBeenCalled();
      expect(result.method).toBe('direct_read');
    });
  });
});

// =============================================================================
// E2E Test Scenarios
// =============================================================================

describe('E2E-US-009-02: Quota exceeded → Download Database still works', () => {
  it('should export valid .sqlite snapshot when storage quota is exhausted', async () => {
    // Simulate quota exceeded state
    const mockEngine = createMockEngine();
    const mockStorageAdapter = createMockStorageAdapter({
      opfsAvailable: true,
      hasQuota: false,
    });

    const result = await exportDatabaseSnapshot('test-db', {
      engine: mockEngine,
      storageAdapter: mockStorageAdapter,
    });

    // Export should succeed
    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();

    // Exported data should be a valid SQLite file
    expect(isSQLiteFile(result.data!)).toBe(true);

    // Should have used direct read path (no additional writes)
    expect(result.method).toBe('direct_read');
  });

  it('should export valid snapshot even when VACUUM INTO fails with quota error', async () => {
    // VACUUM INTO fails due to quota
    const mockEngine = createMockEngine({
      vacuumIntoFails: true,
      vacuumIntoError: new DOMException('Quota exceeded', 'QuotaExceededError'),
    });
    const mockStorageAdapter = createMockStorageAdapter({
      hasQuota: true, // Initially thinks we have quota, but VACUUM INTO fails
    });

    const result = await exportDatabaseSnapshot('test-db', {
      engine: mockEngine,
      storageAdapter: mockStorageAdapter,
    });

    // Export should still succeed via fallback
    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(isSQLiteFile(result.data!)).toBe(true);
  });
});
