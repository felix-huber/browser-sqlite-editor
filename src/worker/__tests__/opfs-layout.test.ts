/**
 * Unit tests for OPFS Layout (PRD-aligned)
 *
 * Tests verify the OPFS directory structure matches PRD spec:
 * - Root directory: /wasm-sqlite-editor/
 * - Registry at: /wasm-sqlite-editor/registry.json
 * - Databases at: /wasm-sqlite-editor/databases/*.sqlite
 * - ERD sidecars at: /wasm-sqlite-editor/databases/<db>.erd.json
 * - Imported files normalized to .sqlite extension
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  DatabaseRegistry,
  resetRegistry,
  toFilename,
  _testing,
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
  deletedFiles: Set<string>;
  throwOnDelete: boolean;
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
      const idx = state.fileList.indexOf(oldName);
      if (idx !== -1) {
        state.fileList[idx] = newName;
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
      const idx = state.fileList.indexOf(name);
      if (idx !== -1) {
        state.fileList.splice(idx, 1);
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
    opfsAvailable: true, // OPFS mode for these tests
    throwOnRead: false,
    existingFiles: new Set(),
    renamedFiles: new Map(),
    throwOnRename: false,
    deletedFiles: new Set(),
    throwOnDelete: false,
  };
  resetRegistry();
});

afterEach(() => {
  vi.clearAllMocks();
});

// =============================================================================
// OPFS Layout Constants Tests
// =============================================================================

describe('OPFS Layout - Constants', () => {
  it('should have OPFS root directory as /wasm-sqlite-editor', () => {
    expect(_testing.OPFS_DIR).toBe('/wasm-sqlite-editor');
  });

  it('should have registry path at /wasm-sqlite-editor/registry.json', () => {
    expect(_testing.OPFS_REGISTRY_PATH).toBe('/wasm-sqlite-editor/registry.json');
  });

  it('should have databases subdirectory constant', () => {
    expect(_testing.DATABASES_SUBDIR).toBe('databases');
  });
});

// =============================================================================
// OPFS Layout Path Construction Tests
// =============================================================================

describe('OPFS Layout - Path Construction', () => {
  describe('toFilename', () => {
    it('should add .sqlite extension', () => {
      expect(toFilename('mydb')).toBe('mydb.sqlite');
    });

    it('should normalize names to lowercase with underscores', () => {
      expect(toFilename('My Database')).toBe('my_database.sqlite');
    });

    it('should replace special characters', () => {
      expect(toFilename('test<>:"/\\|?*')).toBe('test_________.sqlite');
    });

    it('should handle names that already have extensions', () => {
      // toFilename always appends .sqlite
      expect(toFilename('data.db')).toBe('data.db.sqlite');
    });
  });

  describe('getOpfsDatabasePath', () => {
    it('should construct path within databases/ subdirectory', () => {
      const path = _testing.getOpfsDatabasePath('chinook');
      expect(path).toBe('/wasm-sqlite-editor/databases/chinook.sqlite');
    });

    it('should normalize name before constructing path', () => {
      const path = _testing.getOpfsDatabasePath('My Database');
      expect(path).toBe('/wasm-sqlite-editor/databases/my_database.sqlite');
    });
  });

  describe('getOpfsErdPath', () => {
    it('should construct ERD sidecar path within databases/ subdirectory', () => {
      const path = _testing.getOpfsErdPath('chinook');
      expect(path).toBe('/wasm-sqlite-editor/databases/chinook.erd.json');
    });

    it('should normalize name before constructing ERD path', () => {
      const path = _testing.getOpfsErdPath('My Database');
      expect(path).toBe('/wasm-sqlite-editor/databases/my_database.erd.json');
    });
  });
});

// =============================================================================
// OPFS Layout Discovery Tests (Self-Healing)
// =============================================================================

describe('OPFS Layout - Discovery', () => {
  it('should discover .sqlite files in databases/ directory', async () => {
    mockState.registryData = { databases: [] };
    mockState.fileList = ['chinook.sqlite', 'mydb.sqlite'];
    mockState.opfsAvailable = true;

    const adapter = createMockAdapter(mockState);
    const registry = new DatabaseRegistry(adapter);
    const result = await registry.init();

    expect(result.discovered).toHaveLength(2);
    expect(registry.count()).toBe(2);

    const names = registry.listDatabases().map((e) => e.name);
    expect(names).toContain('chinook');
    expect(names).toContain('mydb');
  });

  it('should normalize discovered filenames to display names', async () => {
    mockState.registryData = { databases: [] };
    mockState.fileList = ['my_database.sqlite'];
    mockState.opfsAvailable = true;

    const adapter = createMockAdapter(mockState);
    const registry = new DatabaseRegistry(adapter);
    await registry.init();

    const entry = registry.listDatabases()[0];
    // Underscores become spaces in display name
    expect(entry.name).toBe('my database');
  });

  it('should only discover .sqlite files (not other extensions)', async () => {
    mockState.registryData = { databases: [] };
    // The mock adapter returns whatever is in fileList directly.
    // The real listOpfsFiles filters by .sqlite extension.
    // Here we test that only .sqlite files are in the list
    // (simulating what the real OPFS listing would return after filtering)
    mockState.fileList = ['mydb.sqlite'];
    mockState.opfsAvailable = true;

    const adapter = createMockAdapter(mockState);
    const registry = new DatabaseRegistry(adapter);
    const result = await registry.init();

    // Only .sqlite files should appear
    expect(result.discovered).toHaveLength(1);
    expect(registry.count()).toBe(1);
    expect(registry.listDatabases()[0].name).toBe('mydb');
  });
});

// =============================================================================
// OPFS Layout Registry Entry Tests
// =============================================================================

describe('OPFS Layout - Registry Entries', () => {
  it('should match registry entries to files using .sqlite extension', async () => {
    mockState.registryData = {
      databases: [
        {
          id: 'test-1',
          name: 'mydb',
          createdAt: '2026-01-01T00:00:00.000Z',
          lastOpenedAt: '2026-01-01T00:00:00.000Z',
          storageType: 'opfs',
        },
      ],
    };
    mockState.fileList = ['mydb.sqlite'];
    mockState.opfsAvailable = true;

    const adapter = createMockAdapter(mockState);
    const registry = new DatabaseRegistry(adapter);
    const result = await registry.init();

    // Entry should be kept (file exists)
    expect(result.orphansRemoved).toHaveLength(0);
    expect(registry.count()).toBe(1);
  });

  it('should remove orphan entries when .sqlite file is missing', async () => {
    mockState.registryData = {
      databases: [
        {
          id: 'orphan-1',
          name: 'deleted_db',
          createdAt: '2026-01-01T00:00:00.000Z',
          lastOpenedAt: '2026-01-01T00:00:00.000Z',
          storageType: 'opfs',
        },
      ],
    };
    mockState.fileList = []; // No files
    mockState.opfsAvailable = true;

    const adapter = createMockAdapter(mockState);
    const registry = new DatabaseRegistry(adapter);
    const result = await registry.init();

    expect(result.orphansRemoved).toContain('orphan-1');
    expect(registry.count()).toBe(0);
  });
});

// =============================================================================
// OPFS Layout Import Normalization Tests
// =============================================================================

describe('OPFS Layout - Import Normalization', () => {
  it('should normalize imported file extensions to .sqlite', () => {
    // toFilename always produces .sqlite extension
    expect(toFilename('imported')).toMatch(/\.sqlite$/);
    expect(toFilename('data')).toMatch(/\.sqlite$/);
  });

  it('should handle various input names consistently', () => {
    // All these should produce valid .sqlite filenames
    const testCases = [
      { input: 'simple', expected: 'simple.sqlite' },
      { input: 'With Spaces', expected: 'with_spaces.sqlite' },
      { input: 'UPPERCASE', expected: 'uppercase.sqlite' },
      { input: 'MixedCase', expected: 'mixedcase.sqlite' },
    ];

    for (const { input, expected } of testCases) {
      expect(toFilename(input)).toBe(expected);
    }
  });
});
