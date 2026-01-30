/**
 * Tests for PRD-compliant database naming validation
 *
 * PRD Requirements (US-002):
 * - Names must be 1–64 characters, trimmed of leading/trailing whitespace
 * - Allowed characters: alphanumeric, spaces, hyphens, underscores, dots, parentheses
 * - No path separators or control characters
 * - Names are case-preserving but collision-checked case-insensitively
 * - Empty or invalid names show inline validation error
 * - Duplicate names are auto-suffixed with (1), (2), etc. on import
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  DatabaseRegistry,
  validateDatabaseName,
  generateImportName,
  resetRegistry,
  type StorageAdapter,
  type RegistryData,
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
  };
  resetRegistry();
});

afterEach(() => {
  vi.clearAllMocks();
});

// =============================================================================
// PRD Name Validation Tests
// =============================================================================

describe('validateDatabaseName - PRD compliance', () => {
  describe('length validation', () => {
    it('should reject names > 64 chars', () => {
      const longName = 'a'.repeat(65);
      const result = validateDatabaseName(longName);
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('NAME_TOO_LONG');
    });

    it('should accept names at exactly 64 chars', () => {
      const maxName = 'a'.repeat(64);
      const result = validateDatabaseName(maxName);
      expect(result.success).toBe(true);
    });

    it('should accept names at 1 char', () => {
      const result = validateDatabaseName('a');
      expect(result.success).toBe(true);
    });
  });

  describe('allowed characters', () => {
    it('should allow alphanumeric characters', () => {
      expect(validateDatabaseName('abc123').success).toBe(true);
      expect(validateDatabaseName('ABC123').success).toBe(true);
      expect(validateDatabaseName('abcXYZ123').success).toBe(true);
    });

    it('should allow spaces', () => {
      expect(validateDatabaseName('My Database').success).toBe(true);
      expect(validateDatabaseName('test db name').success).toBe(true);
    });

    it('should allow hyphens', () => {
      expect(validateDatabaseName('my-database').success).toBe(true);
      expect(validateDatabaseName('test-db-name').success).toBe(true);
    });

    it('should allow underscores', () => {
      expect(validateDatabaseName('my_database').success).toBe(true);
      expect(validateDatabaseName('test_db_name').success).toBe(true);
    });

    it('should allow dots', () => {
      expect(validateDatabaseName('my.database').success).toBe(true);
      expect(validateDatabaseName('test.db.name').success).toBe(true);
      expect(validateDatabaseName('v1.0').success).toBe(true);
    });

    it('should allow parentheses', () => {
      expect(validateDatabaseName('database (1)').success).toBe(true);
      expect(validateDatabaseName('test(backup)').success).toBe(true);
      expect(validateDatabaseName('(project)').success).toBe(true);
    });

    it('should allow combined PRD characters', () => {
      expect(validateDatabaseName('My_DB-v1.0 (backup)').success).toBe(true);
    });
  });

  describe('disallowed characters', () => {
    it('should reject path separators', () => {
      const forwardSlash = validateDatabaseName('my/database');
      expect(forwardSlash.success).toBe(false);
      expect(forwardSlash.error?.code).toBe('PATH_SEPARATOR');

      const backSlash = validateDatabaseName('my\\database');
      expect(backSlash.success).toBe(false);
      expect(backSlash.error?.code).toBe('PATH_SEPARATOR');
    });

    it('should reject control characters', () => {
      const result1 = validateDatabaseName('my\x00database');
      expect(result1.success).toBe(false);
      expect(result1.error?.code).toBe('INVALID_CHARS');

      const result2 = validateDatabaseName('my\x1Fdatabase');
      expect(result2.success).toBe(false);
      expect(result2.error?.code).toBe('INVALID_CHARS');
    });

    it('should reject @ symbol', () => {
      const result = validateDatabaseName('my@database');
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INVALID_CHARS');
    });

    it('should reject # symbol', () => {
      const result = validateDatabaseName('test#1');
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INVALID_CHARS');
    });

    it('should reject * symbol', () => {
      const result = validateDatabaseName('file*name');
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INVALID_CHARS');
    });

    it('should reject ? symbol', () => {
      const result = validateDatabaseName('what?');
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INVALID_CHARS');
    });

    it('should reject < and > symbols', () => {
      const result = validateDatabaseName('<script>');
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INVALID_CHARS');
    });

    it('should reject : and | symbols', () => {
      expect(validateDatabaseName('file:name').success).toBe(false);
      expect(validateDatabaseName('file|name').success).toBe(false);
    });

    it('should reject " and \' symbols', () => {
      expect(validateDatabaseName('file"name').success).toBe(false);
      expect(validateDatabaseName("file'name").success).toBe(false);
    });
  });

  describe('whitespace handling', () => {
    it('should trim leading whitespace', () => {
      const result = validateDatabaseName('  mydb');
      expect(result.success).toBe(true);
    });

    it('should trim trailing whitespace', () => {
      const result = validateDatabaseName('mydb  ');
      expect(result.success).toBe(true);
    });

    it('should reject empty after trimming', () => {
      const result = validateDatabaseName('   ');
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('NAME_EMPTY');
    });

    it('should reject names that are only tabs and newlines', () => {
      const result = validateDatabaseName('\t\n');
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('NAME_EMPTY');
    });
  });

  describe('case preservation', () => {
    it('should preserve case in the trimmed output', () => {
      // The function validates but the name is case-preserving
      // Collision checks are separate (case-insensitive)
      expect(validateDatabaseName('My DB').success).toBe(true);
      expect(validateDatabaseName('MY DB').success).toBe(true);
      expect(validateDatabaseName('my db').success).toBe(true);
    });
  });

  describe('existing rules preserved', () => {
    it('should reject names starting with dot', () => {
      const result = validateDatabaseName('.hidden');
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('HIDDEN_FILE');
    });

    it('should reject path traversal sequences', () => {
      const result = validateDatabaseName('..parent');
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('PATH_TRAVERSAL');
    });

    it('should reject Windows reserved names', () => {
      const reservedNames = ['CON', 'PRN', 'AUX', 'NUL', 'COM1', 'COM9', 'LPT1', 'LPT9'];
      for (const name of reservedNames) {
        const result = validateDatabaseName(name);
        expect(result.success).toBe(false);
        expect(result.error?.code).toBe('RESERVED_NAME');
      }
    });

    it('should reject reserved names case-insensitively', () => {
      expect(validateDatabaseName('con').success).toBe(false);
      expect(validateDatabaseName('Con').success).toBe(false);
      expect(validateDatabaseName('CON').success).toBe(false);
    });
  });
});

// =============================================================================
// Case-Insensitive Collision Detection Tests
// =============================================================================

describe('Case-insensitive collision detection', () => {
  describe('create/rename collision check', () => {
    it('should block rename when name exists with different case', async () => {
      const adapter = createMockAdapter(mockState);
      const registry = new DatabaseRegistry(adapter);
      await registry.init();

      await registry.registerDatabase('MyDB', 'idb');
      const id2 = await registry.registerDatabase('other', 'idb');

      const result = await registry.renameDatabase(id2, 'mydb');

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('NAME_EXISTS');
    });

    it('should allow rename to same name with different case (same db)', async () => {
      // Start with empty fileList so self-healing doesn't discover it
      const adapter = createMockAdapter(mockState);
      const registry = new DatabaseRegistry(adapter);
      await registry.init();

      // Register a database
      const id = await registry.registerDatabase('MyDB', 'idb');
      // Add to fileList so renameFile works
      mockState.fileList = ['MyDB'];

      const result = await registry.renameDatabase(id, 'mydb');

      // Renaming to the same db with different case should succeed
      expect(result.success).toBe(true);
      expect(registry.getDatabaseById(id)?.name).toBe('mydb');
    });

    it('should perform case-insensitive check on hasDatabase', async () => {
      const adapter = createMockAdapter(mockState);
      const registry = new DatabaseRegistry(adapter);
      await registry.init();

      await registry.registerDatabase('MyDB', 'idb');

      expect(registry.hasDatabaseCaseInsensitive('mydb')).toBe(true);
      expect(registry.hasDatabaseCaseInsensitive('MYDB')).toBe(true);
      expect(registry.hasDatabaseCaseInsensitive('MyDB')).toBe(true);
      expect(registry.hasDatabaseCaseInsensitive('other')).toBe(false);
    });
  });
});

// =============================================================================
// Import Auto-Suffix Tests
// =============================================================================

describe('generateImportName - auto-suffix on collision', () => {
  it('should return original name when no collision', () => {
    const result = generateImportName('mydb', []);
    expect(result).toBe('mydb');
  });

  it('should add (1) suffix on first collision', () => {
    const result = generateImportName('mydb', ['mydb']);
    expect(result).toBe('mydb(1)');
  });

  it('should add (2) suffix when (1) also exists', () => {
    const result = generateImportName('mydb', ['mydb', 'mydb(1)']);
    expect(result).toBe('mydb(2)');
  });

  it('should find next available suffix', () => {
    const result = generateImportName('mydb', ['mydb', 'mydb(1)', 'mydb(2)', 'mydb(3)']);
    expect(result).toBe('mydb(4)');
  });

  it('should handle case-insensitive collision', () => {
    const result = generateImportName('MyDB', ['mydb']);
    expect(result).toBe('MyDB(1)');
  });

  it('should handle case-insensitive collision with suffix', () => {
    const result = generateImportName('MyDB', ['mydb', 'MYDB(1)']);
    expect(result).toBe('MyDB(2)');
  });

  it('should preserve original case in output', () => {
    const result = generateImportName('My Database', ['my database']);
    expect(result).toBe('My Database(1)');
  });

  it('should handle filenames with existing parentheses', () => {
    const result = generateImportName('backup (final)', ['backup (final)']);
    expect(result).toBe('backup (final)(1)');
  });

  it('should validate resulting name length', () => {
    // Name that is exactly 64 chars - suffix would exceed limit
    const longName = 'a'.repeat(64);
    const result = generateImportName(longName, [longName]);
    // Should truncate base name to fit suffix
    expect(result.length).toBeLessThanOrEqual(64);
    expect(result).toMatch(/\(1\)$/);
  });
});

// =============================================================================
// Integration Tests
// =============================================================================

describe('Registry integration with PRD naming', () => {
  it('should preserve exact case when registering', async () => {
    const adapter = createMockAdapter(mockState);
    const registry = new DatabaseRegistry(adapter);
    await registry.init();

    await registry.registerDatabase('My DB', 'idb');

    const entry = registry.getDatabaseByName('My DB');
    expect(entry?.name).toBe('My DB');
  });

  it('should preserve spaces when registering', async () => {
    const adapter = createMockAdapter(mockState);
    const registry = new DatabaseRegistry(adapter);
    await registry.init();

    await registry.registerDatabase('Test Database Name', 'idb');

    const entry = registry.getDatabaseByName('Test Database Name');
    expect(entry?.name).toBe('Test Database Name');
  });
});
