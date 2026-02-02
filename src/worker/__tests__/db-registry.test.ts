/**
 * Unit tests for Database Registry
 *
 * Tests cover:
 * - Create DB: appears in registry with correct metadata
 * - Update DB: lastOpenedAt updates
 * - Remove DB: entry removed from registry
 * - List DBs: returns all registered databases
 * - Orphan cleanup: registry entry without file removed
 * - Discovery: file without registry entry added
 * - Corruption: invalid JSON resets to empty
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  DatabaseRegistry,
  getRegistry,
  resetRegistry,
  validateDatabaseName,
  _testing,
  type RegistryEntry,
  type RegistryData,
  type StorageAdapter,
} from '../db-registry';
import * as debugModule from '../../shared/utils/debug';

// =============================================================================
// Mock Storage Adapter Factory
// =============================================================================

interface MockStorageState {
  registryData: RegistryData | null;
  fileList: string[];
  /** List of IDB files (if different from OPFS fileList). Defaults to empty array. */
  idbFileList?: string[];
  opfsAvailable: boolean;
  throwOnRead: boolean;
  existingFiles: Set<string>;
  renamedFiles: Map<string, string>;
  throwOnRename: boolean;
  deletedFiles: Set<string>;
  throwOnDelete: boolean;
  /** Map of filename to lastModified timestamp */
  fileLastModified: Map<string, number>;
  /** List of ALL files in the directory (including sidecars, journals) */
  allFiles: string[];
  /** Files deleted via deleteRawFile */
  deletedRawFiles: Set<string>;
}

function createMockAdapter(state: MockStorageState): StorageAdapter {
  return {
    isOpfsAvailable: vi.fn(async () => state.opfsAvailable),
    readRegistry: vi.fn(async () => {
      if (state.throwOnRead) {
        throw new SyntaxError('Unexpected token');
      }
      return state.registryData;
    }),
    writeRegistry: vi.fn(async (_mode, data: RegistryData) => {
      state.registryData = data;
    }),
    listFiles: vi.fn(async (mode: 'opfs' | 'idb') => {
      // Return OPFS files for 'opfs' mode, IDB files for 'idb' mode
      // When opfsAvailable=false (pure IDB mode), fileList represents IDB files
      // When opfsAvailable=true, fileList is for OPFS and idbFileList is for IDB
      if (mode === 'opfs') {
        return state.fileList;
      }
      // IDB mode: use idbFileList if set, otherwise use fileList when in IDB-only mode
      return state.idbFileList ?? (state.opfsAvailable ? [] : state.fileList);
    }),
    renameFile: vi.fn(async (_mode, oldName: string, newName: string) => {
      if (state.throwOnRename) {
        throw new Error('Simulated rename failure');
      }
      state.renamedFiles.set(oldName, newName);
      // Update fileList
      const idx = state.fileList.indexOf(oldName);
      if (idx !== -1) {
        state.fileList[idx] = newName;
      }
      // Also update allFiles
      const allIdx = state.allFiles.indexOf(oldName);
      if (allIdx !== -1) {
        state.allFiles[allIdx] = newName;
      }
    }),
    fileExists: vi.fn(async (_mode, name: string) => {
      return state.existingFiles.has(name);
    }),
    deleteFile: vi.fn(async (_mode, name: string) => {
      if (state.throwOnDelete) {
        throw new Error('Simulated delete failure');
      }
      state.deletedFiles.add(name);
      // Remove from fileList
      const idx = state.fileList.indexOf(name);
      if (idx !== -1) {
        state.fileList.splice(idx, 1);
      }
    }),
    getFileLastModified: vi.fn(async (_mode, filename: string) => {
      return state.fileLastModified.get(filename) ?? 0;
    }),
    listAllFiles: vi.fn(async () => [...state.allFiles]),
    deleteRawFile: vi.fn(async (filename: string) => {
      state.deletedRawFiles.add(filename);
      const idx = state.allFiles.indexOf(filename);
      if (idx !== -1) {
        state.allFiles.splice(idx, 1);
      }
    }),
    renameRawFile: vi.fn(async (oldFilename: string, newFilename: string) => {
      if (state.throwOnRename) {
        throw new Error('Simulated rename failure');
      }
      state.renamedFiles.set(oldFilename, newFilename);
      const idx = state.allFiles.indexOf(oldFilename);
      if (idx !== -1) {
        state.allFiles[idx] = newFilename;
      }
      const fileListIdx = state.fileList.indexOf(oldFilename);
      if (fileListIdx !== -1) {
        state.fileList[fileListIdx] = newFilename;
      }
    }),
  };
}

// =============================================================================
// Test Setup/Teardown
// =============================================================================

let mockState: MockStorageState;

beforeEach(() => {
  mockState = {
    registryData: null,
    fileList: [],
    opfsAvailable: false,
    throwOnRead: false,
    existingFiles: new Set(),
    renamedFiles: new Map(),
    throwOnRename: false,
    deletedFiles: new Set(),
    throwOnDelete: false,
    fileLastModified: new Map(),
    allFiles: [],
    deletedRawFiles: new Set(),
  };
  resetRegistry();
});

afterEach(() => {
  vi.clearAllMocks();
});

// =============================================================================
// Unit Tests - Registry Class (IDB Mode)
// =============================================================================

describe('DatabaseRegistry - CRUD Operations', () => {
  describe('registerDatabase', () => {
    it('should create a new database entry with correct metadata', async () => {
      const adapter = createMockAdapter(mockState);
      const registry = new DatabaseRegistry(adapter);
      await registry.init();

      const id = await registry.registerDatabase('Test Database', 'idb');

      expect(id).toBeTruthy();
      expect(typeof id).toBe('string');

      const entry = registry.getDatabaseById(id);
      expect(entry).not.toBeNull();
      expect(entry?.name).toBe('Test Database');
      expect(entry?.storageType).toBe('idb');
      expect(entry?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(entry?.lastOpenedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('should generate unique IDs for each database', async () => {
      const adapter = createMockAdapter(mockState);
      const registry = new DatabaseRegistry(adapter);
      await registry.init();

      const id1 = await registry.registerDatabase('DB1', 'idb');
      const id2 = await registry.registerDatabase('DB2', 'idb');
      const id3 = await registry.registerDatabase('DB3', 'idb');

      expect(id1).not.toBe(id2);
      expect(id2).not.toBe(id3);
      expect(id1).not.toBe(id3);
    });

    it('should add entry to the registry list', async () => {
      const adapter = createMockAdapter(mockState);
      const registry = new DatabaseRegistry(adapter);
      await registry.init();

      expect(registry.count()).toBe(0);

      await registry.registerDatabase('First', 'idb');
      expect(registry.count()).toBe(1);

      await registry.registerDatabase('Second', 'idb');
      expect(registry.count()).toBe(2);
    });
  });

  describe('updateDatabase', () => {
    it('should update lastOpenedAt timestamp', async () => {
      const adapter = createMockAdapter(mockState);
      const registry = new DatabaseRegistry(adapter);
      await registry.init();

      const id = await registry.registerDatabase('Test', 'idb');
      const original = registry.getDatabaseById(id);
      const originalTimestamp = original?.lastOpenedAt;

      // Wait a bit to ensure different timestamp
      await new Promise((r) => setTimeout(r, 10));

      const newTimestamp = new Date().toISOString();
      await registry.updateDatabase(id, { lastOpenedAt: newTimestamp });

      const updated = registry.getDatabaseById(id);
      expect(updated?.lastOpenedAt).toBe(newTimestamp);
      expect(updated?.lastOpenedAt).not.toBe(originalTimestamp);
    });

    it('should update name', async () => {
      const adapter = createMockAdapter(mockState);
      const registry = new DatabaseRegistry(adapter);
      await registry.init();

      const id = await registry.registerDatabase('Original Name', 'idb');
      await registry.updateDatabase(id, { name: 'New Name' });

      const entry = registry.getDatabaseById(id);
      expect(entry?.name).toBe('New Name');
    });

    it('should return true when update succeeds', async () => {
      const adapter = createMockAdapter(mockState);
      const registry = new DatabaseRegistry(adapter);
      await registry.init();

      const id = await registry.registerDatabase('Test', 'idb');
      const result = await registry.updateDatabase(id, { name: 'Updated' });

      expect(result).toBe(true);
    });

    it('should return false when ID not found', async () => {
      const adapter = createMockAdapter(mockState);
      const registry = new DatabaseRegistry(adapter);
      await registry.init();

      const result = await registry.updateDatabase('nonexistent-id', { name: 'Test' });
      expect(result).toBe(false);
    });
  });

  describe('removeDatabase', () => {
    it('should remove entry from registry', async () => {
      const adapter = createMockAdapter(mockState);
      const registry = new DatabaseRegistry(adapter);
      await registry.init();

      const id = await registry.registerDatabase('To Remove', 'idb');
      expect(registry.count()).toBe(1);

      const result = await registry.removeDatabase(id);

      expect(result).toBe(true);
      expect(registry.count()).toBe(0);
      expect(registry.getDatabaseById(id)).toBeNull();
    });

    it('should return false when ID not found', async () => {
      const adapter = createMockAdapter(mockState);
      const registry = new DatabaseRegistry(adapter);
      await registry.init();

      const result = await registry.removeDatabase('nonexistent');
      expect(result).toBe(false);
    });

    it('should not affect other entries', async () => {
      const adapter = createMockAdapter(mockState);
      const registry = new DatabaseRegistry(adapter);
      await registry.init();

      const id1 = await registry.registerDatabase('Keep', 'idb');
      const id2 = await registry.registerDatabase('Remove', 'idb');
      const id3 = await registry.registerDatabase('Keep Too', 'idb');

      await registry.removeDatabase(id2);

      expect(registry.count()).toBe(2);
      expect(registry.getDatabaseById(id1)).not.toBeNull();
      expect(registry.getDatabaseById(id2)).toBeNull();
      expect(registry.getDatabaseById(id3)).not.toBeNull();
    });
  });

  describe('listDatabases', () => {
    it('should return all registered databases', async () => {
      const adapter = createMockAdapter(mockState);
      const registry = new DatabaseRegistry(adapter);
      await registry.init();

      await registry.registerDatabase('DB1', 'idb');
      await registry.registerDatabase('DB2', 'idb');
      await registry.registerDatabase('DB3', 'idb');

      const list = registry.listDatabases();

      expect(list).toHaveLength(3);
      expect(list.map((e) => e.name)).toContain('DB1');
      expect(list.map((e) => e.name)).toContain('DB2');
      expect(list.map((e) => e.name)).toContain('DB3');
    });

    it('should return empty array when no databases', async () => {
      const adapter = createMockAdapter(mockState);
      const registry = new DatabaseRegistry(adapter);
      await registry.init();

      const list = registry.listDatabases();
      expect(list).toEqual([]);
    });

    it('should return a copy, not the internal array', async () => {
      const adapter = createMockAdapter(mockState);
      const registry = new DatabaseRegistry(adapter);
      await registry.init();

      await registry.registerDatabase('Test', 'idb');

      const list1 = registry.listDatabases();
      const list2 = registry.listDatabases();

      expect(list1).not.toBe(list2);
      expect(list1).toEqual(list2);
    });
  });

  describe('getDatabaseById', () => {
    it('should return entry when found', async () => {
      const adapter = createMockAdapter(mockState);
      const registry = new DatabaseRegistry(adapter);
      await registry.init();

      const id = await registry.registerDatabase('Find Me', 'idb');
      const entry = registry.getDatabaseById(id);

      expect(entry).not.toBeNull();
      expect(entry?.name).toBe('Find Me');
    });

    it('should return null when not found', async () => {
      const adapter = createMockAdapter(mockState);
      const registry = new DatabaseRegistry(adapter);
      await registry.init();

      const entry = registry.getDatabaseById('nonexistent');
      expect(entry).toBeNull();
    });
  });

  describe('getDatabaseByName', () => {
    it('should return entry when found', async () => {
      const adapter = createMockAdapter(mockState);
      const registry = new DatabaseRegistry(adapter);
      await registry.init();

      await registry.registerDatabase('Named DB', 'idb');
      const entry = registry.getDatabaseByName('Named DB');

      expect(entry).not.toBeNull();
      expect(entry?.name).toBe('Named DB');
    });

    it('should return null when not found', async () => {
      const adapter = createMockAdapter(mockState);
      const registry = new DatabaseRegistry(adapter);
      await registry.init();

      const entry = registry.getDatabaseByName('Does Not Exist');
      expect(entry).toBeNull();
    });
  });
});

// =============================================================================
// Self-Healing Tests
// =============================================================================

describe('DatabaseRegistry - Self-Healing', () => {
  describe('Orphan Cleanup', () => {
    it('should remove registry entries without corresponding files', async () => {
      // Set up registry with an entry that has no file
      mockState.registryData = {
        databases: [
          {
            id: 'orphan-1',
            name: 'Orphan DB',
            createdAt: '2026-01-01T00:00:00.000Z',
            lastOpenedAt: '2026-01-01T00:00:00.000Z',
            storageType: 'idb',
          },
        ],
      };
      mockState.fileList = []; // No actual files

      const adapter = createMockAdapter(mockState);
      const registry = new DatabaseRegistry(adapter);
      const result = await registry.init();

      expect(result.orphansRemoved).toContain('orphan-1');
      expect(registry.count()).toBe(0);
    });

    it('should keep entries that have corresponding files', async () => {
      mockState.registryData = {
        databases: [
          {
            id: 'valid-1',
            name: 'Valid DB',
            createdAt: '2026-01-01T00:00:00.000Z',
            lastOpenedAt: '2026-01-01T00:00:00.000Z',
            storageType: 'idb',
          },
        ],
      };
      // IDB entries are checked against idbFileList, not fileList (which is for OPFS)
      mockState.idbFileList = ['Valid DB']; // File exists in IDB

      const adapter = createMockAdapter(mockState);
      const registry = new DatabaseRegistry(adapter);
      const result = await registry.init();

      expect(result.orphansRemoved).toHaveLength(0);
      expect(registry.count()).toBe(1);
    });
  });

  describe('Discovery', () => {
    it('should add registry entries for files without entries (OPFS)', async () => {
      mockState.registryData = { databases: [] };
      mockState.fileList = ['discovered.sqlite', 'another.sqlite'];
      mockState.opfsAvailable = true; // OPFS mode uses .sqlite extension

      const adapter = createMockAdapter(mockState);
      const registry = new DatabaseRegistry(adapter);
      const result = await registry.init();

      expect(result.discovered).toHaveLength(2);
      expect(registry.count()).toBe(2);

      const list = registry.listDatabases();
      const names = list.map((e) => e.name);
      expect(names).toContain('discovered');
      expect(names).toContain('another');
    });

    it('should add registry entries for files without entries (IDB)', async () => {
      mockState.registryData = { databases: [] };
      mockState.fileList = ['my database', 'another_db']; // IDB uses raw names
      mockState.opfsAvailable = false; // IDB mode

      const adapter = createMockAdapter(mockState);
      const registry = new DatabaseRegistry(adapter);
      const result = await registry.init();

      expect(result.discovered).toHaveLength(2);
      expect(registry.count()).toBe(2);

      const list = registry.listDatabases();
      const names = list.map((e) => e.name);
      // IDB mode preserves names exactly as stored
      expect(names).toContain('my database');
      expect(names).toContain('another_db');
    });

    it('should not duplicate existing entries', async () => {
      mockState.registryData = {
        databases: [
          {
            id: 'existing-1',
            name: 'existing',
            createdAt: '2026-01-01T00:00:00.000Z',
            lastOpenedAt: '2026-01-01T00:00:00.000Z',
            storageType: 'idb',
          },
        ],
      };
      mockState.fileList = ['existing']; // Same file

      const adapter = createMockAdapter(mockState);
      const registry = new DatabaseRegistry(adapter);
      const result = await registry.init();

      expect(result.discovered).toHaveLength(0);
      expect(registry.count()).toBe(1);
    });
  });

  describe('Corruption Repair', () => {
    it('should reset to empty when JSON is invalid', async () => {
      mockState.throwOnRead = true;

      const adapter = createMockAdapter(mockState);
      const registry = new DatabaseRegistry(adapter);
      const result = await registry.init();

      expect(result.wasCorrupted).toBe(true);
      expect(registry.count()).toBe(0);
    });

    it('should reset when databases array is missing', async () => {
      // Registry data without databases array
      mockState.registryData = {} as RegistryData;

      const adapter = createMockAdapter(mockState);
      const registry = new DatabaseRegistry(adapter);
      const result = await registry.init();

      expect(result.wasCorrupted).toBe(true);
      expect(registry.count()).toBe(0);
    });

    it('should reset when databases is not an array', async () => {
      mockState.registryData = { databases: 'not an array' } as unknown as RegistryData;

      const adapter = createMockAdapter(mockState);
      const registry = new DatabaseRegistry(adapter);
      const result = await registry.init();

      expect(result.wasCorrupted).toBe(true);
      expect(registry.count()).toBe(0);
    });
  });

  describe('Case Collision Resolution', () => {
    it('should resolve case collision by keeping most recently modified file', async () => {
      // Two files that differ only by case
      mockState.registryData = { databases: [] };
      mockState.fileList = ['mydb.sqlite', 'MyDB.sqlite'];
      mockState.allFiles = ['mydb.sqlite', 'MyDB.sqlite'];
      mockState.opfsAvailable = true;
      // mydb.sqlite was modified more recently
      mockState.fileLastModified.set('mydb.sqlite', 2000);
      mockState.fileLastModified.set('MyDB.sqlite', 1000);

      const adapter = createMockAdapter(mockState);
      const registry = new DatabaseRegistry(adapter);
      const debugSpy = vi.spyOn(debugModule, 'workerDebugLog').mockImplementation(() => {});
      const result = await registry.init();

      // Should rename the older file (MyDB.sqlite) to have (conflict-N) suffix
      // The renamed file preserves its original case: MyDB (conflict-1).sqlite
      expect(mockState.renamedFiles.get('MyDB.sqlite')).toBe('MyDB (conflict-1).sqlite');

      // Should discover both files (one as original, one as conflict)
      expect(result.discovered.length).toBe(2);
      expect(result.caseCollisionsResolved).toBe(1);

      // Should log the resolution (via workerDebugLog)
      expect(debugSpy).toHaveBeenCalledWith(
        expect.stringContaining('Case collision resolved')
      );

      debugSpy.mockRestore();
    });

    it('should use lexicographically first filename as tie-breaker when timestamps equal', async () => {
      mockState.registryData = { databases: [] };
      mockState.fileList = ['zoo.sqlite', 'ZOO.sqlite'];
      mockState.allFiles = ['zoo.sqlite', 'ZOO.sqlite'];
      mockState.opfsAvailable = true;
      // Same timestamp
      mockState.fileLastModified.set('zoo.sqlite', 1000);
      mockState.fileLastModified.set('ZOO.sqlite', 1000);

      const adapter = createMockAdapter(mockState);
      const registry = new DatabaseRegistry(adapter);
      const result = await registry.init();

      // Byte-wise comparison: 'Z' (90) < 'z' (122), so ZOO.sqlite comes first
      // ZOO.sqlite is kept, zoo.sqlite is renamed - preserving its original case
      expect(mockState.renamedFiles.get('zoo.sqlite')).toBe('zoo (conflict-1).sqlite');
      expect(result.caseCollisionsResolved).toBe(1);
    });

    it('should handle multiple case collision groups', async () => {
      mockState.registryData = { databases: [] };
      mockState.fileList = ['a.sqlite', 'A.sqlite', 'b.sqlite', 'B.sqlite'];
      mockState.allFiles = ['a.sqlite', 'A.sqlite', 'b.sqlite', 'B.sqlite'];
      mockState.opfsAvailable = true;
      mockState.fileLastModified.set('a.sqlite', 2000);
      mockState.fileLastModified.set('A.sqlite', 1000);
      mockState.fileLastModified.set('b.sqlite', 1000);
      mockState.fileLastModified.set('B.sqlite', 2000);

      const adapter = createMockAdapter(mockState);
      const registry = new DatabaseRegistry(adapter);
      const result = await registry.init();

      // a.sqlite kept (newer), A.sqlite renamed - preserves its case
      expect(mockState.renamedFiles.get('A.sqlite')).toBe('A (conflict-1).sqlite');
      // B.sqlite kept (newer), b.sqlite renamed - preserves its case
      expect(mockState.renamedFiles.get('b.sqlite')).toBe('b (conflict-1).sqlite');
      expect(result.caseCollisionsResolved).toBe(2);
    });

    it('should not resolve collisions when files have different names (not just case)', async () => {
      mockState.registryData = { databases: [] };
      mockState.fileList = ['mydb.sqlite', 'mydb2.sqlite'];
      mockState.allFiles = ['mydb.sqlite', 'mydb2.sqlite'];
      mockState.opfsAvailable = true;

      const adapter = createMockAdapter(mockState);
      const registry = new DatabaseRegistry(adapter);
      const result = await registry.init();

      // No renames should occur
      expect(mockState.renamedFiles.size).toBe(0);
      expect(result.caseCollisionsResolved).toBe(0);
      expect(registry.count()).toBe(2);
    });

    it('should handle 3+ way case collision with unique conflict suffixes', async () => {
      // Three files that differ only by case
      mockState.registryData = { databases: [] };
      mockState.fileList = ['mydb.sqlite', 'MyDB.sqlite', 'MYDB.sqlite'];
      mockState.allFiles = ['mydb.sqlite', 'MyDB.sqlite', 'MYDB.sqlite'];
      mockState.opfsAvailable = true;
      // mydb.sqlite is most recent, then MyDB.sqlite, then MYDB.sqlite
      mockState.fileLastModified.set('mydb.sqlite', 3000);
      mockState.fileLastModified.set('MyDB.sqlite', 2000);
      mockState.fileLastModified.set('MYDB.sqlite', 1000);

      const adapter = createMockAdapter(mockState);
      const registry = new DatabaseRegistry(adapter);
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const result = await registry.init();

      // mydb.sqlite should be kept (most recent)
      // MyDB.sqlite (2nd) should be renamed to MyDB (conflict-1).sqlite
      // MYDB.sqlite (3rd) should be renamed to MYDB (conflict-2).sqlite
      expect(mockState.renamedFiles.get('MyDB.sqlite')).toBe('MyDB (conflict-1).sqlite');
      expect(mockState.renamedFiles.get('MYDB.sqlite')).toBe('MYDB (conflict-2).sqlite');
      expect(mockState.renamedFiles.has('mydb.sqlite')).toBe(false); // Winner not renamed

      // Should have resolved 2 collisions
      expect(result.caseCollisionsResolved).toBe(2);

      // Should discover all 3 files (1 original + 2 conflicts)
      expect(result.discovered.length).toBe(3);

      consoleSpy.mockRestore();
    });
  });

  describe('Orphaned Sidecar Cleanup', () => {
    it('should delete .erd.json sidecar without matching .sqlite file', async () => {
      mockState.registryData = { databases: [] };
      mockState.fileList = ['existing.sqlite'];
      mockState.allFiles = ['existing.sqlite', 'existing.erd.json', 'orphan.erd.json'];
      mockState.opfsAvailable = true;

      const adapter = createMockAdapter(mockState);
      const registry = new DatabaseRegistry(adapter);
      const result = await registry.init();

      // orphan.erd.json should be deleted (no orphan.sqlite exists)
      expect(mockState.deletedRawFiles.has('orphan.erd.json')).toBe(true);
      // existing.erd.json should NOT be deleted
      expect(mockState.deletedRawFiles.has('existing.erd.json')).toBe(false);
      expect(result.orphanedSidecarsRemoved).toContain('orphan.erd.json');
    });

    it('should handle case-insensitive sidecar matching', async () => {
      mockState.registryData = { databases: [] };
      mockState.fileList = ['MyDB.sqlite'];
      mockState.allFiles = ['MyDB.sqlite', 'mydb.erd.json'];
      mockState.opfsAvailable = true;

      const adapter = createMockAdapter(mockState);
      const registry = new DatabaseRegistry(adapter);
      const result = await registry.init();

      // mydb.erd.json should NOT be deleted because MyDB.sqlite exists (case-insensitive match)
      expect(mockState.deletedRawFiles.has('mydb.erd.json')).toBe(false);
      expect(result.orphanedSidecarsRemoved?.length ?? 0).toBe(0);
    });
  });

  describe('Orphaned Journal Cleanup', () => {
    it('should delete orphaned -wal file without matching .sqlite', async () => {
      mockState.registryData = { databases: [] };
      mockState.fileList = ['existing.sqlite'];
      mockState.allFiles = ['existing.sqlite', 'existing.sqlite-wal', 'orphan.sqlite-wal'];
      mockState.opfsAvailable = true;

      const adapter = createMockAdapter(mockState);
      const registry = new DatabaseRegistry(adapter);
      const result = await registry.init();

      expect(mockState.deletedRawFiles.has('orphan.sqlite-wal')).toBe(true);
      expect(mockState.deletedRawFiles.has('existing.sqlite-wal')).toBe(false);
      expect(result.orphanedJournalsRemoved).toContain('orphan.sqlite-wal');
    });

    it('should delete orphaned -shm file without matching .sqlite', async () => {
      mockState.registryData = { databases: [] };
      mockState.fileList = ['existing.sqlite'];
      mockState.allFiles = ['existing.sqlite', 'orphan.sqlite-shm'];
      mockState.opfsAvailable = true;

      const adapter = createMockAdapter(mockState);
      const registry = new DatabaseRegistry(adapter);
      const result = await registry.init();

      expect(mockState.deletedRawFiles.has('orphan.sqlite-shm')).toBe(true);
      expect(result.orphanedJournalsRemoved).toContain('orphan.sqlite-shm');
    });

    it('should delete orphaned -journal file without matching .sqlite', async () => {
      mockState.registryData = { databases: [] };
      mockState.fileList = ['existing.sqlite'];
      mockState.allFiles = ['existing.sqlite', 'orphan.sqlite-journal'];
      mockState.opfsAvailable = true;

      const adapter = createMockAdapter(mockState);
      const registry = new DatabaseRegistry(adapter);
      const result = await registry.init();

      expect(mockState.deletedRawFiles.has('orphan.sqlite-journal')).toBe(true);
      expect(result.orphanedJournalsRemoved).toContain('orphan.sqlite-journal');
    });

    it('should not delete journal files that have matching .sqlite files', async () => {
      mockState.registryData = { databases: [] };
      mockState.fileList = ['test.sqlite'];
      mockState.allFiles = ['test.sqlite', 'test.sqlite-wal', 'test.sqlite-shm', 'test.sqlite-journal'];
      mockState.opfsAvailable = true;

      const adapter = createMockAdapter(mockState);
      const registry = new DatabaseRegistry(adapter);
      const result = await registry.init();

      expect(mockState.deletedRawFiles.size).toBe(0);
      expect(result.orphanedJournalsRemoved?.length ?? 0).toBe(0);
    });

    it('should handle all journal types together', async () => {
      mockState.registryData = { databases: [] };
      // No .sqlite files
      mockState.fileList = [];
      // But there are orphaned journal files
      mockState.allFiles = [
        'orphan.sqlite-wal',
        'orphan.sqlite-shm',
        'orphan.sqlite-journal',
      ];
      mockState.opfsAvailable = true;

      const adapter = createMockAdapter(mockState);
      const registry = new DatabaseRegistry(adapter);
      const result = await registry.init();

      expect(mockState.deletedRawFiles.has('orphan.sqlite-wal')).toBe(true);
      expect(mockState.deletedRawFiles.has('orphan.sqlite-shm')).toBe(true);
      expect(mockState.deletedRawFiles.has('orphan.sqlite-journal')).toBe(true);
      expect(result.orphanedJournalsRemoved?.length).toBe(3);
    });
  });

  describe('Combined Self-Heal Scenarios', () => {
    it('should handle mixed scenario: case collision + orphan sidecars + orphan journals', async () => {
      mockState.registryData = { databases: [] };
      mockState.fileList = ['mydb.sqlite', 'MyDB.sqlite'];
      mockState.allFiles = [
        'mydb.sqlite',
        'MyDB.sqlite',
        'mydb.erd.json',
        'orphan.erd.json',
        'orphan.sqlite-wal',
      ];
      mockState.opfsAvailable = true;
      mockState.fileLastModified.set('mydb.sqlite', 2000);
      mockState.fileLastModified.set('MyDB.sqlite', 1000);

      const adapter = createMockAdapter(mockState);
      const registry = new DatabaseRegistry(adapter);
      const result = await registry.init();

      // Case collision resolved - MyDB.sqlite renamed preserving its case
      expect(mockState.renamedFiles.get('MyDB.sqlite')).toBe('MyDB (conflict-1).sqlite');
      expect(result.caseCollisionsResolved).toBe(1);

      // Orphan sidecar cleaned
      expect(mockState.deletedRawFiles.has('orphan.erd.json')).toBe(true);

      // Orphan journal cleaned
      expect(mockState.deletedRawFiles.has('orphan.sqlite-wal')).toBe(true);

      // Valid sidecar NOT deleted
      expect(mockState.deletedRawFiles.has('mydb.erd.json')).toBe(false);
    });
  });

  describe('healFileOperationFailures', () => {
    it('should clean up orphaned .sqlite files not in registry', async () => {
      mockState.opfsAvailable = true;
      mockState.registryData = {
        databases: [
          {
            id: 'db1',
            name: 'registered',
            createdAt: '2026-01-01T00:00:00.000Z',
            lastOpenedAt: '2026-01-01T00:00:00.000Z',
            storageType: 'opfs',
          },
        ],
      };
      mockState.fileList = ['registered.sqlite'];
      mockState.allFiles = ['registered.sqlite'];

      const adapter = createMockAdapter(mockState);
      const registry = new DatabaseRegistry(adapter);
      await registry.init();

      // Simulate a scenario where files appeared after init (e.g., failed delete left orphans)
      // Add orphan files AFTER init to simulate leftover from failed operation
      mockState.allFiles.push('orphan.sqlite', 'orphan.erd.json');

      // Run heal after file operation failures
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const result = await registry.healFileOperationFailures();

      // Should delete the orphaned file and its sidecar
      expect(mockState.deletedRawFiles.has('orphan.sqlite')).toBe(true);
      expect(mockState.deletedRawFiles.has('orphan.erd.json')).toBe(true);
      expect(result.orphansRemoved).toContain('orphan.sqlite');
      expect(result.orphanedSidecarsRemoved).toContain('orphan.erd.json');

      // Should NOT delete registered file
      expect(mockState.deletedRawFiles.has('registered.sqlite')).toBe(false);

      consoleSpy.mockRestore();
    });

    it('should clean up orphaned journal files', async () => {
      mockState.opfsAvailable = true;
      mockState.registryData = { databases: [] };
      mockState.fileList = [];
      mockState.allFiles = [];

      const adapter = createMockAdapter(mockState);
      const registry = new DatabaseRegistry(adapter);
      await registry.init();

      // Add orphan journal files AFTER init (simulating leftover from crash/failed op)
      mockState.allFiles.push('orphan.sqlite-wal', 'orphan.sqlite-shm', 'orphan.sqlite-journal');

      const result = await registry.healFileOperationFailures();

      expect(mockState.deletedRawFiles.has('orphan.sqlite-wal')).toBe(true);
      expect(mockState.deletedRawFiles.has('orphan.sqlite-shm')).toBe(true);
      expect(mockState.deletedRawFiles.has('orphan.sqlite-journal')).toBe(true);
      expect(result.orphanedJournalsRemoved.length).toBe(3);
    });

    it('should return empty result for IDB mode', async () => {
      mockState.opfsAvailable = false; // IDB mode
      mockState.registryData = { databases: [] };
      mockState.fileList = [];

      const adapter = createMockAdapter(mockState);
      const registry = new DatabaseRegistry(adapter);
      await registry.init();

      const result = await registry.healFileOperationFailures();

      // No cleanup in IDB mode
      expect(result.orphansRemoved.length).toBe(0);
      expect(result.orphanedSidecarsRemoved.length).toBe(0);
      expect(result.orphanedJournalsRemoved.length).toBe(0);
    });
  });
});

// =============================================================================
// Utility Function Tests
// =============================================================================

describe('DatabaseRegistry - Utility Functions', () => {
  describe('generateId', () => {
    it('should generate unique IDs', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(_testing.generateId());
      }
      expect(ids.size).toBe(100);
    });

    it('should generate string IDs', () => {
      const id = _testing.generateId();
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
    });
  });

  describe('now', () => {
    it('should return ISO 8601 timestamp', () => {
      const timestamp = _testing.now();
      expect(timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });
  });

  describe('toFilename', () => {
    it('should convert name to safe filename', () => {
      expect(_testing.toFilename('My Database')).toBe('my_database.sqlite');
    });

    it('should replace special characters', () => {
      expect(_testing.toFilename('Test<>:"/\\|?*')).toBe('test_________.sqlite');
    });

    it('should handle simple names', () => {
      expect(_testing.toFilename('simple')).toBe('simple.sqlite');
    });
  });
});

// =============================================================================
// Singleton Tests
// =============================================================================

describe('DatabaseRegistry - Singleton', () => {
  it('should return same instance from getRegistry', () => {
    const instance1 = getRegistry();
    const instance2 = getRegistry();
    expect(instance1).toBe(instance2);
  });

  it('should create new instance after reset', () => {
    const instance1 = getRegistry();
    resetRegistry();
    const instance2 = getRegistry();
    expect(instance1).not.toBe(instance2);
  });
});

// =============================================================================
// Helper Method Tests
// =============================================================================

describe('DatabaseRegistry - Helper Methods', () => {
  describe('hasDatabase', () => {
    it('should return true when database exists', async () => {
      const adapter = createMockAdapter(mockState);
      const registry = new DatabaseRegistry(adapter);
      await registry.init();

      await registry.registerDatabase('Exists', 'idb');

      expect(registry.hasDatabase('Exists')).toBe(true);
    });

    it('should return false when database does not exist', async () => {
      const adapter = createMockAdapter(mockState);
      const registry = new DatabaseRegistry(adapter);
      await registry.init();

      expect(registry.hasDatabase('Does Not Exist')).toBe(false);
    });
  });

  describe('count', () => {
    it('should return correct count', async () => {
      const adapter = createMockAdapter(mockState);
      const registry = new DatabaseRegistry(adapter);
      await registry.init();

      expect(registry.count()).toBe(0);

      await registry.registerDatabase('One', 'idb');
      expect(registry.count()).toBe(1);

      await registry.registerDatabase('Two', 'idb');
      expect(registry.count()).toBe(2);
    });
  });

  describe('isInitialized', () => {
    it('should return false before init', () => {
      const adapter = createMockAdapter(mockState);
      const registry = new DatabaseRegistry(adapter);
      expect(registry.isInitialized()).toBe(false);
    });

    it('should return true after init', async () => {
      const adapter = createMockAdapter(mockState);
      const registry = new DatabaseRegistry(adapter);
      await registry.init();
      expect(registry.isInitialized()).toBe(true);
    });
  });

  describe('touchDatabase', () => {
    it('should update lastOpenedAt', async () => {
      const adapter = createMockAdapter(mockState);
      const registry = new DatabaseRegistry(adapter);
      await registry.init();

      const id = await registry.registerDatabase('Touch Test', 'idb');
      const original = registry.getDatabaseById(id)?.lastOpenedAt;

      await new Promise((r) => setTimeout(r, 10));
      await registry.touchDatabase(id);

      const updated = registry.getDatabaseById(id)?.lastOpenedAt;
      expect(updated).not.toBe(original);
    });
  });

  describe('clear', () => {
    it('should remove all entries', async () => {
      const adapter = createMockAdapter(mockState);
      const registry = new DatabaseRegistry(adapter);
      await registry.init();

      await registry.registerDatabase('One', 'idb');
      await registry.registerDatabase('Two', 'idb');
      expect(registry.count()).toBe(2);

      await registry.clear();
      expect(registry.count()).toBe(0);
    });
  });

  describe('reload', () => {
    it('should re-run healing', async () => {
      const adapter = createMockAdapter(mockState);
      const registry = new DatabaseRegistry(adapter);
      await registry.init();

      await registry.registerDatabase('Test', 'idb');

      // Simulate a new file appearing
      mockState.fileList = ['new_file.sqlite'];

      const result = await registry.reload();
      expect(result.discovered.length).toBeGreaterThan(0);
    });
  });
});

// =============================================================================
// Constants Tests
// =============================================================================

describe('DatabaseRegistry - Constants', () => {
  it('should have correct OPFS directory', () => {
    expect(_testing.OPFS_DIR).toBe('/wasm-sqlite-editor');
  });

  it('should have correct OPFS registry path', () => {
    expect(_testing.OPFS_REGISTRY_PATH).toBe('/wasm-sqlite-editor/registry.json');
  });

  it('should have correct IDB registry database name', () => {
    expect(_testing.IDB_REGISTRY_DB).toBe('sqlite-editor-registry');
  });

  it('should have correct IDB registry store name', () => {
    expect(_testing.IDB_REGISTRY_STORE).toBe('registry');
  });
});

// =============================================================================
// Type Contract Tests
// =============================================================================

describe('DatabaseRegistry - Type Contracts', () => {
  it('should define RegistryEntry correctly', () => {
    const entry: RegistryEntry = {
      id: 'test-id',
      name: 'Test DB',
      createdAt: '2026-01-28T00:00:00.000Z',
      lastOpenedAt: '2026-01-28T00:00:00.000Z',
      storageType: 'idb',
    };

    expect(entry.id).toBe('test-id');
    expect(entry.name).toBe('Test DB');
    expect(entry.storageType).toBe('idb');
  });

  it('should define RegistryData correctly', () => {
    const data: RegistryData = {
      databases: [
        {
          id: 'test',
          name: 'Test',
          createdAt: '2026-01-28T00:00:00.000Z',
          lastOpenedAt: '2026-01-28T00:00:00.000Z',
          storageType: 'opfs',
        },
      ],
    };

    expect(data.databases).toHaveLength(1);
    expect(data.databases[0].storageType).toBe('opfs');
  });
});

// =============================================================================
// Name Validation Tests
// =============================================================================

describe('validateDatabaseName', () => {
  it('should accept valid names', () => {
    expect(validateDatabaseName('my_database').success).toBe(true);
    expect(validateDatabaseName('My Database').success).toBe(true);
    expect(validateDatabaseName('test-123').success).toBe(true);
    expect(validateDatabaseName('database (1)').success).toBe(true);
  });

  it('should reject empty names', () => {
    const result = validateDatabaseName('');
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('NAME_EMPTY');
  });

  it('should reject whitespace-only names', () => {
    const result = validateDatabaseName('   ');
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('NAME_EMPTY');
  });

  it('should reject names with forward slash', () => {
    const result = validateDatabaseName('my/database');
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('PATH_SEPARATOR');
  });

  it('should reject names with backslash', () => {
    const result = validateDatabaseName('my\\database');
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('PATH_SEPARATOR');
  });

  it('should reject names starting with dot', () => {
    const result = validateDatabaseName('.hidden');
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('HIDDEN_FILE');
  });

  it('should reject path traversal sequences', () => {
    const result = validateDatabaseName('..parent');
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('PATH_TRAVERSAL');

    const result2 = validateDatabaseName('foo..bar');
    expect(result2.success).toBe(false);
    expect(result2.error?.code).toBe('PATH_TRAVERSAL');
  });

  it('should reject Windows reserved names', () => {
    const reservedNames = ['CON', 'PRN', 'AUX', 'NUL', 'COM1', 'COM9', 'LPT1', 'LPT9'];
    for (const name of reservedNames) {
      const result = validateDatabaseName(name);
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('RESERVED_NAME');
    }

    // Case-insensitive
    expect(validateDatabaseName('con').success).toBe(false);
    expect(validateDatabaseName('Con').success).toBe(false);
  });

  it('should reject names exceeding max length (64 per PRD)', () => {
    const longName = 'a'.repeat(65);
    const result = validateDatabaseName(longName);
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('NAME_TOO_LONG');
  });

  it('should accept names at max length (64 per PRD)', () => {
    const maxName = 'a'.repeat(64);
    const result = validateDatabaseName(maxName);
    expect(result.success).toBe(true);
  });
});

// =============================================================================
// Rename Database Tests
// =============================================================================

describe('DatabaseRegistry - renameDatabase', () => {
  describe('successful rename', () => {
    it('should rename "a" to "b": success, registry updated', async () => {
      mockState.fileList = ['a'];
      const adapter = createMockAdapter(mockState);
      const registry = new DatabaseRegistry(adapter);
      await registry.init();

      // Register database 'a'
      const id = await registry.registerDatabase('a', 'idb');

      // Rename to 'b'
      const result = await registry.renameDatabase(id, 'b');

      expect(result.success).toBe(true);

      // Check registry is updated
      const entry = registry.getDatabaseById(id);
      expect(entry?.name).toBe('b');

      // Check file was renamed
      expect(mockState.renamedFiles.get('a')).toBe('b');
    });

    it('should trim whitespace from new name', async () => {
      mockState.fileList = ['test'];
      const adapter = createMockAdapter(mockState);
      const registry = new DatabaseRegistry(adapter);
      await registry.init();

      const id = await registry.registerDatabase('test', 'idb');
      const result = await registry.renameDatabase(id, '  new name  ');

      expect(result.success).toBe(true);
      expect(registry.getDatabaseById(id)?.name).toBe('new name');
    });

    it('should succeed when renaming to same name (no-op)', async () => {
      mockState.fileList = ['test'];
      const adapter = createMockAdapter(mockState);
      const registry = new DatabaseRegistry(adapter);
      await registry.init();

      const id = await registry.registerDatabase('test', 'idb');
      const result = await registry.renameDatabase(id, 'test');

      expect(result.success).toBe(true);
      // No rename should have occurred
      expect(mockState.renamedFiles.size).toBe(0);
    });
  });

  describe('validation errors', () => {
    it('should return NAME_EXISTS error for existing name', async () => {
      mockState.fileList = ['a', 'b'];
      const adapter = createMockAdapter(mockState);
      const registry = new DatabaseRegistry(adapter);
      await registry.init();

      await registry.registerDatabase('a', 'idb');
      const idB = await registry.registerDatabase('b', 'idb');

      const result = await registry.renameDatabase(idB, 'a');

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('NAME_EXISTS');
    });

    it('should return INVALID_NAME error for "/" in name', async () => {
      mockState.fileList = ['test'];
      const adapter = createMockAdapter(mockState);
      const registry = new DatabaseRegistry(adapter);
      await registry.init();

      const id = await registry.registerDatabase('test', 'idb');
      const result = await registry.renameDatabase(id, 'new/name');

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('PATH_SEPARATOR');
    });

    it('should return INVALID_NAME error for ".." in name', async () => {
      mockState.fileList = ['test'];
      const adapter = createMockAdapter(mockState);
      const registry = new DatabaseRegistry(adapter);
      await registry.init();

      const id = await registry.registerDatabase('test', 'idb');
      const result = await registry.renameDatabase(id, '..parent');

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('PATH_TRAVERSAL');
    });

    it('should return NOT_FOUND for unknown ID', async () => {
      const adapter = createMockAdapter(mockState);
      const registry = new DatabaseRegistry(adapter);
      await registry.init();

      const result = await registry.renameDatabase('nonexistent-id', 'new-name');

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('NOT_FOUND');
    });
  });

  describe('storage errors', () => {
    it('should return NAME_EXISTS when target file already exists in storage', async () => {
      mockState.fileList = ['a'];
      mockState.existingFiles.add('b'); // File exists but not in registry
      const adapter = createMockAdapter(mockState);
      const registry = new DatabaseRegistry(adapter);
      await registry.init();

      const id = await registry.registerDatabase('a', 'idb');
      const result = await registry.renameDatabase(id, 'b');

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('NAME_EXISTS');
    });

    it('should return RENAME_FAILED when file rename fails', async () => {
      mockState.fileList = ['a'];
      mockState.throwOnRename = true;
      const adapter = createMockAdapter(mockState);
      const registry = new DatabaseRegistry(adapter);
      await registry.init();

      const id = await registry.registerDatabase('a', 'idb');
      const result = await registry.renameDatabase(id, 'b');

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('RENAME_FAILED');
    });
  });

  describe('sidecar handling', () => {
    it('should succeed even when sidecar is missing (sidecar optional)', async () => {
      // The mock adapter doesn't actually handle sidecars,
      // but the default adapter silently ignores missing sidecars
      mockState.fileList = ['test'];
      const adapter = createMockAdapter(mockState);
      const registry = new DatabaseRegistry(adapter);
      await registry.init();

      const id = await registry.registerDatabase('test', 'idb');
      const result = await registry.renameDatabase(id, 'renamed');

      expect(result.success).toBe(true);
    });
  });
});

// =============================================================================
// Constants Tests for Rename
// =============================================================================

describe('Rename Constants', () => {
  it('should have correct max name length (64 per PRD)', () => {
    expect(_testing.MAX_NAME_LENGTH).toBe(64);
  });

  it('should have Windows reserved names defined', () => {
    expect(_testing.WINDOWS_RESERVED_NAMES).toContain('con');
    expect(_testing.WINDOWS_RESERVED_NAMES).toContain('prn');
    expect(_testing.WINDOWS_RESERVED_NAMES).toContain('aux');
    expect(_testing.WINDOWS_RESERVED_NAMES).toContain('nul');
    expect(_testing.WINDOWS_RESERVED_NAMES).toContain('com1');
    expect(_testing.WINDOWS_RESERVED_NAMES).toContain('lpt1');
  });
});

// =============================================================================
// Delete Database Tests
// =============================================================================

// =============================================================================
// WAL/SHM File Verification Tests
// =============================================================================

describe('DatabaseRegistry - verifyNoWalFiles', () => {
  describe('OPFS mode', () => {
    it('should return success when no WAL/SHM files exist for a database', async () => {
      mockState.opfsAvailable = true;
      mockState.registryData = {
        databases: [
          {
            id: 'db1',
            name: 'mydb',
            createdAt: '2026-01-01T00:00:00.000Z',
            lastOpenedAt: '2026-01-01T00:00:00.000Z',
            storageType: 'opfs',
          },
        ],
      };
      mockState.fileList = ['mydb.sqlite'];
      mockState.allFiles = ['mydb.sqlite']; // No WAL/SHM files

      const adapter = createMockAdapter(mockState);
      const registry = new DatabaseRegistry(adapter);
      await registry.init();

      const result = await registry.verifyNoWalFiles('mydb');

      expect(result.success).toBe(true);
      expect(result.walFilesFound).toHaveLength(0);
    });

    it('should return failure when WAL file exists', async () => {
      mockState.opfsAvailable = true;
      mockState.registryData = {
        databases: [
          {
            id: 'db1',
            name: 'mydb',
            createdAt: '2026-01-01T00:00:00.000Z',
            lastOpenedAt: '2026-01-01T00:00:00.000Z',
            storageType: 'opfs',
          },
        ],
      };
      mockState.fileList = ['mydb.sqlite'];
      mockState.allFiles = ['mydb.sqlite', 'mydb.sqlite-wal'];

      const adapter = createMockAdapter(mockState);
      const registry = new DatabaseRegistry(adapter);
      await registry.init();

      const result = await registry.verifyNoWalFiles('mydb');

      expect(result.success).toBe(false);
      expect(result.walFilesFound).toContain('mydb.sqlite-wal');
    });

    it('should return failure when SHM file exists', async () => {
      mockState.opfsAvailable = true;
      mockState.registryData = {
        databases: [
          {
            id: 'db1',
            name: 'mydb',
            createdAt: '2026-01-01T00:00:00.000Z',
            lastOpenedAt: '2026-01-01T00:00:00.000Z',
            storageType: 'opfs',
          },
        ],
      };
      mockState.fileList = ['mydb.sqlite'];
      mockState.allFiles = ['mydb.sqlite', 'mydb.sqlite-shm'];

      const adapter = createMockAdapter(mockState);
      const registry = new DatabaseRegistry(adapter);
      await registry.init();

      const result = await registry.verifyNoWalFiles('mydb');

      expect(result.success).toBe(false);
      expect(result.walFilesFound).toContain('mydb.sqlite-shm');
    });

    it('should detect both WAL and SHM files', async () => {
      mockState.opfsAvailable = true;
      mockState.registryData = {
        databases: [
          {
            id: 'db1',
            name: 'mydb',
            createdAt: '2026-01-01T00:00:00.000Z',
            lastOpenedAt: '2026-01-01T00:00:00.000Z',
            storageType: 'opfs',
          },
        ],
      };
      mockState.fileList = ['mydb.sqlite'];
      mockState.allFiles = ['mydb.sqlite', 'mydb.sqlite-wal', 'mydb.sqlite-shm'];

      const adapter = createMockAdapter(mockState);
      const registry = new DatabaseRegistry(adapter);
      await registry.init();

      const result = await registry.verifyNoWalFiles('mydb');

      expect(result.success).toBe(false);
      expect(result.walFilesFound).toHaveLength(2);
      expect(result.walFilesFound).toContain('mydb.sqlite-wal');
      expect(result.walFilesFound).toContain('mydb.sqlite-shm');
    });

    it('should not flag -journal files (DELETE mode uses -journal)', async () => {
      mockState.opfsAvailable = true;
      mockState.registryData = {
        databases: [
          {
            id: 'db1',
            name: 'mydb',
            createdAt: '2026-01-01T00:00:00.000Z',
            lastOpenedAt: '2026-01-01T00:00:00.000Z',
            storageType: 'opfs',
          },
        ],
      };
      mockState.fileList = ['mydb.sqlite'];
      // -journal is expected in DELETE mode during a transaction
      mockState.allFiles = ['mydb.sqlite', 'mydb.sqlite-journal'];

      const adapter = createMockAdapter(mockState);
      const registry = new DatabaseRegistry(adapter);
      await registry.init();

      const result = await registry.verifyNoWalFiles('mydb');

      // -journal files are okay in DELETE mode (they indicate rollback journal, not WAL)
      expect(result.success).toBe(true);
      expect(result.walFilesFound).toHaveLength(0);
    });

    it('should handle database not found', async () => {
      mockState.opfsAvailable = true;
      mockState.registryData = { databases: [] };
      mockState.fileList = [];
      mockState.allFiles = [];

      const adapter = createMockAdapter(mockState);
      const registry = new DatabaseRegistry(adapter);
      await registry.init();

      const result = await registry.verifyNoWalFiles('nonexistent');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Database not found');
    });
  });

  describe('IDB mode', () => {
    it('should always return success for IDB mode (WAL not applicable)', async () => {
      mockState.opfsAvailable = false; // IDB mode
      mockState.registryData = {
        databases: [
          {
            id: 'db1',
            name: 'mydb',
            createdAt: '2026-01-01T00:00:00.000Z',
            lastOpenedAt: '2026-01-01T00:00:00.000Z',
            storageType: 'idb',
          },
        ],
      };
      mockState.fileList = ['mydb'];

      const adapter = createMockAdapter(mockState);
      const registry = new DatabaseRegistry(adapter);
      await registry.init();

      const result = await registry.verifyNoWalFiles('mydb');

      // IDB mode doesn't use file-based WAL, so always success
      expect(result.success).toBe(true);
      expect(result.walFilesFound).toHaveLength(0);
    });
  });
});

describe('DatabaseRegistry - deleteDatabase', () => {
  describe('successful deletion', () => {
    it('should delete a closed database: all artifacts removed', async () => {
      // Start with empty fileList, registry will auto-add to fileList when registering
      const adapter = createMockAdapter(mockState);
      const registry = new DatabaseRegistry(adapter);
      await registry.init();

      // Register a database (this won't create a file in our mock, but that's ok)
      await registry.registerDatabase('mydb', 'idb');
      expect(registry.count()).toBe(1);

      // Delete it
      const result = await registry.deleteDatabase('mydb');

      expect(result.success).toBe(true);
      expect(result.warnings).toBeUndefined();
      expect(registry.count()).toBe(0);
      expect(registry.getDatabaseByName('mydb')).toBeNull();
      expect(mockState.deletedFiles.has('mydb')).toBe(true);
    });

    it('should succeed when sidecar is missing (sidecar optional)', async () => {
      const adapter = createMockAdapter(mockState);
      const registry = new DatabaseRegistry(adapter);
      await registry.init();

      await registry.registerDatabase('testdb', 'idb');

      // Delete - should succeed even without sidecar
      const result = await registry.deleteDatabase('testdb');

      expect(result.success).toBe(true);
      expect(registry.count()).toBe(0);
    });

    it('should remove registry entry before attempting file deletion', async () => {
      const adapter = createMockAdapter(mockState);
      const registry = new DatabaseRegistry(adapter);
      await registry.init();

      await registry.registerDatabase('test', 'idb');

      // Delete
      await registry.deleteDatabase('test');

      // Registry should be empty
      expect(registry.count()).toBe(0);
      // Registry data should be updated
      expect(mockState.registryData?.databases).toHaveLength(0);
    });
  });

  describe('error handling', () => {
    it('should return NOT_FOUND for unknown database name', async () => {
      const adapter = createMockAdapter(mockState);
      const registry = new DatabaseRegistry(adapter);
      await registry.init();

      const result = await registry.deleteDatabase('nonexistent');

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('NOT_FOUND');
      expect(result.error?.message).toContain('nonexistent');
    });

    it('should continue with registry update even if file deletion fails', async () => {
      mockState.throwOnDelete = true;
      const adapter = createMockAdapter(mockState);
      const registry = new DatabaseRegistry(adapter);
      await registry.init();

      await registry.registerDatabase('faildb', 'idb');
      expect(registry.count()).toBe(1);

      // Delete - file deletion will fail
      const result = await registry.deleteDatabase('faildb');

      // Should still succeed (registry updated) but with warnings
      expect(result.success).toBe(true);
      expect(result.warnings).toBeDefined();
      expect(result.warnings?.length).toBeGreaterThan(0);
      expect(result.warnings?.[0]).toContain('File deletion failed');

      // Registry should be updated even though file deletion failed
      expect(registry.count()).toBe(0);
    });
  });

  describe('multiple databases', () => {
    it('should only delete the specified database', async () => {
      const adapter = createMockAdapter(mockState);
      const registry = new DatabaseRegistry(adapter);
      await registry.init();

      await registry.registerDatabase('db1', 'idb');
      await registry.registerDatabase('db2', 'idb');
      await registry.registerDatabase('db3', 'idb');
      expect(registry.count()).toBe(3);

      // Delete only db2
      const result = await registry.deleteDatabase('db2');

      expect(result.success).toBe(true);
      expect(registry.count()).toBe(2);
      expect(registry.getDatabaseByName('db1')).not.toBeNull();
      expect(registry.getDatabaseByName('db2')).toBeNull();
      expect(registry.getDatabaseByName('db3')).not.toBeNull();
      expect(mockState.deletedFiles.has('db2')).toBe(true);
      expect(mockState.deletedFiles.has('db1')).toBe(false);
      expect(mockState.deletedFiles.has('db3')).toBe(false);
    });
  });
});

// =============================================================================
// Layout Migration Tests (bd-2am: P1-06)
// =============================================================================

describe('DatabaseRegistry - Legacy Layout Migration', () => {
  /**
   * Extended mock state for migration testing
   */
  interface MigrationMockState extends MockStorageState {
    /** Files in the legacy /sqlite-editor/ directory */
    legacyFiles: Map<string, ArrayBuffer>;
    /** Registry data in legacy /sqlite-editor/registry.json */
    legacyRegistryData: RegistryData | null;
    /** Whether legacy directory exists */
    legacyDirExists: boolean;
    /** Whether new directory exists */
    newDirExists: boolean;
    /** Track files that have been copied */
    copiedFiles: Set<string>;
  }

  let migrationMockState: MigrationMockState;

  function createMigrationMockAdapter(state: MigrationMockState): StorageAdapter {
    const baseAdapter = createMockAdapter(state);
    return {
      ...baseAdapter,
      checkLegacyLayout: vi.fn(async () => state.legacyDirExists),
      readLegacyRegistry: vi.fn(async () => state.legacyRegistryData),
      listLegacyFiles: vi.fn(async () => [...state.legacyFiles.keys()]),
      copyLegacyFile: vi.fn(async (filename: string) => {
        const data = state.legacyFiles.get(filename);
        if (data && !state.fileList.includes(filename)) {
          state.fileList.push(filename);
          state.allFiles.push(filename);
          state.copiedFiles.add(filename);
        }
      }),
    };
  }

  beforeEach(() => {
    migrationMockState = {
      registryData: null,
      fileList: [],
      opfsAvailable: true,
      throwOnRead: false,
      existingFiles: new Set(),
      renamedFiles: new Map(),
      throwOnRename: false,
      deletedFiles: new Set(),
      throwOnDelete: false,
      fileLastModified: new Map(),
      allFiles: [],
      deletedRawFiles: new Set(),
      // Migration-specific state
      legacyFiles: new Map(),
      legacyRegistryData: null,
      legacyDirExists: false,
      newDirExists: false,
      copiedFiles: new Set(),
    };
  });

  describe('DatabaseRegistry.init() with legacy layout', () => {
    it('should migrate legacy files when legacy directory exists (OPFS mode)', async () => {
      migrationMockState.legacyDirExists = true;
      migrationMockState.legacyFiles.set('mydb.sqlite', new ArrayBuffer(16));
      migrationMockState.legacyFiles.set('another.sqlite', new ArrayBuffer(16));

      const adapter = createMigrationMockAdapter(migrationMockState);
      const registry = new DatabaseRegistry(adapter);
      const debugSpy = vi.spyOn(debugModule, 'workerDebugLog').mockImplementation(() => {});

      const result = await registry.init();

      // Should have migrated the files
      expect(result.migratedFiles).toContain('mydb.sqlite');
      expect(result.migratedFiles).toContain('another.sqlite');
      expect(result.migratedFiles).toHaveLength(2);

      // Should log migration (via workerDebugLog)
      expect(debugSpy).toHaveBeenCalledWith(
        expect.stringContaining('Legacy layout detected')
      );

      debugSpy.mockRestore();
    });

    it('should migrate legacy registry.json when new registry does not exist', async () => {
      migrationMockState.legacyDirExists = true;
      migrationMockState.legacyRegistryData = {
        databases: [
          {
            id: 'legacy-db-1',
            name: 'My Legacy DB',
            createdAt: '2025-01-01T00:00:00.000Z',
            lastOpenedAt: '2025-12-01T00:00:00.000Z',
            storageType: 'opfs',
          },
        ],
      };
      // Add the file so it matches the registry
      migrationMockState.legacyFiles.set('my_legacy_db.sqlite', new ArrayBuffer(16));

      const adapter = createMigrationMockAdapter(migrationMockState);
      const registry = new DatabaseRegistry(adapter);

      const result = await registry.init();

      expect(result.migratedRegistry).toBe(true);
      // After init, the registry should have the migrated entry
      expect(registry.count()).toBe(1);
      expect(registry.getDatabaseByName('My Legacy DB')).not.toBeNull();
    });

    it('should NOT migrate when legacy directory does not exist', async () => {
      migrationMockState.legacyDirExists = false;

      const adapter = createMigrationMockAdapter(migrationMockState);
      const registry = new DatabaseRegistry(adapter);

      const result = await registry.init();

      expect(result.migratedFiles).toHaveLength(0);
      expect(result.migratedRegistry).toBe(false);
    });

    it('should NOT overwrite new registry if it already exists', async () => {
      migrationMockState.legacyDirExists = true;
      migrationMockState.legacyRegistryData = {
        databases: [{ id: 'old', name: 'Old', createdAt: '2025-01-01T00:00:00.000Z', lastOpenedAt: '2025-01-01T00:00:00.000Z', storageType: 'opfs' }],
      };
      migrationMockState.registryData = {
        databases: [{ id: 'new', name: 'New', createdAt: '2026-01-01T00:00:00.000Z', lastOpenedAt: '2026-01-01T00:00:00.000Z', storageType: 'opfs' }],
      };
      // Add file for new registry entry
      migrationMockState.fileList = ['new.sqlite'];
      migrationMockState.allFiles = ['new.sqlite'];

      const adapter = createMigrationMockAdapter(migrationMockState);
      const registry = new DatabaseRegistry(adapter);

      const result = await registry.init();

      // Should not migrate registry
      expect(result.migratedRegistry).toBe(false);
      // Registry should still have the "New" entry
      expect(registry.getDatabaseByName('New')).not.toBeNull();
    });

    it('should be idempotent: re-running migration does not duplicate files', async () => {
      migrationMockState.legacyDirExists = true;
      migrationMockState.legacyFiles.set('test.sqlite', new ArrayBuffer(16));
      // Simulate file already exists in new location
      migrationMockState.fileList = ['test.sqlite'];
      migrationMockState.allFiles = ['test.sqlite'];

      const adapter = createMigrationMockAdapter(migrationMockState);
      const registry = new DatabaseRegistry(adapter);

      const result = await registry.init();

      // File should not be migrated (already exists)
      expect(result.migratedFiles).not.toContain('test.sqlite');
      expect(result.migratedFiles).toHaveLength(0);
    });

    it('should resume migration when both directories exist (interrupted migration)', async () => {
      migrationMockState.legacyDirExists = true;
      migrationMockState.newDirExists = true;
      // Legacy has 3 files, new already has 1 (partial migration)
      migrationMockState.legacyFiles.set('db1.sqlite', new ArrayBuffer(16));
      migrationMockState.legacyFiles.set('db2.sqlite', new ArrayBuffer(16));
      migrationMockState.legacyFiles.set('db3.sqlite', new ArrayBuffer(16));
      migrationMockState.fileList = ['db1.sqlite']; // Already migrated
      migrationMockState.allFiles = ['db1.sqlite'];

      const adapter = createMigrationMockAdapter(migrationMockState);
      const registry = new DatabaseRegistry(adapter);

      const result = await registry.init();

      // Should migrate only the missing files
      expect(result.migratedFiles).toContain('db2.sqlite');
      expect(result.migratedFiles).toContain('db3.sqlite');
      expect(result.migratedFiles).not.toContain('db1.sqlite');
      expect(result.migratedFiles).toHaveLength(2);
    });

    it('should NOT run migration in IDB mode', async () => {
      migrationMockState.opfsAvailable = false; // IDB mode
      migrationMockState.legacyDirExists = true;
      migrationMockState.legacyFiles.set('test.sqlite', new ArrayBuffer(16));

      const adapter = createMigrationMockAdapter(migrationMockState);
      const registry = new DatabaseRegistry(adapter);

      const result = await registry.init();

      // Should not migrate - migration only runs in OPFS mode
      expect(result.migratedFiles).toHaveLength(0);
      expect(result.migratedRegistry).toBe(false);
    });
  });

  describe('Constants', () => {
    it('should have correct legacy OPFS directory constant', () => {
      expect(_testing.LEGACY_OPFS_DIR).toBe('sqlite-editor');
    });
  });
});
