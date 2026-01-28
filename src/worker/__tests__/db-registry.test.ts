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

// =============================================================================
// Mock Storage Adapter Factory
// =============================================================================

interface MockStorageState {
  registryData: RegistryData | null;
  fileList: string[];
  opfsAvailable: boolean;
  throwOnRead: boolean;
  existingFiles: Set<string>;
  renamedFiles: Map<string, string>;
  throwOnRename: boolean;
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
    listFiles: vi.fn(async () => state.fileList),
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
    }),
    fileExists: vi.fn(async (_mode, name: string) => {
      return state.existingFiles.has(name);
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
      mockState.fileList = ['Valid DB']; // File exists

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
    expect(_testing.OPFS_DIR).toBe('/sqlite-editor');
  });

  it('should have correct OPFS registry path', () => {
    expect(_testing.OPFS_REGISTRY_PATH).toBe('/sqlite-editor/registry.json');
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

  it('should reject names exceeding max length', () => {
    const longName = 'a'.repeat(256);
    const result = validateDatabaseName(longName);
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('NAME_TOO_LONG');
  });

  it('should accept names at max length', () => {
    const maxName = 'a'.repeat(255);
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
  it('should have correct max name length', () => {
    expect(_testing.MAX_NAME_LENGTH).toBe(255);
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
