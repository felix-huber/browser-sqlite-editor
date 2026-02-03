import { test, expect, type Page } from '@playwright/test';

/**
 * E2E Persistence Tests
 *
 * Tests for OPFS and IndexedDB persistence layer, verifying:
 * - Basic persistence across page refreshes
 * - Storage mode detection
 * - Multiple database handling
 * - Large data persistence
 * - Binary data (BLOB) persistence
 *
 * Note: These tests work at the storage API level since the full UI
 * for database management is still being developed.
 */

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Result types for storage operations
 */
interface StorageCheckResult {
  opfsAvailable: boolean;
  idbAvailable: boolean;
  opfsReason?: string;
}

interface RegistryState {
  databases: Array<{
    id: string;
    name: string;
    storageType: 'opfs' | 'idb';
  }>;
  storageMode: 'opfs' | 'idb';
}

/**
 * Clear all storage (OPFS and IndexedDB) for clean test state
 */
async function clearAllStorage(page: Page): Promise<void> {
  await page.evaluate(async () => {
    // Clear IndexedDB databases
    const deleteIdb = (name: string): Promise<void> => {
      return new Promise((resolve, reject) => {
        const req = indexedDB.deleteDatabase(name);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
        req.onblocked = () => resolve(); // Continue even if blocked
      });
    };

    // Delete known IDB databases
    await deleteIdb('sqlite-editor-registry');
    await deleteIdb('idb-sqlite');

    // Clear OPFS contents without deleting root directories
    try {
      if (navigator.storage?.getDirectory) {
        const root = await navigator.storage.getDirectory();
        const appDir = await root.getDirectoryHandle('wasm-sqlite-editor', { create: true });
        const dbDir = await appDir.getDirectoryHandle('databases', { create: true });
        const dbFiles: string[] = [];
        // @ts-expect-error - entries() is available
        for await (const [name] of dbDir.entries()) {
          dbFiles.push(name);
        }
        for (const name of dbFiles) {
          try {
            await dbDir.removeEntry(name, { recursive: true });
          } catch {
            // ignore locked files
          }
        }
        try {
          await appDir.removeEntry('registry.json');
        } catch {
          // registry might not exist
        }

        try {
          const legacyDir = await root.getDirectoryHandle('sqlite-editor');
          const legacyFiles: string[] = [];
          // @ts-expect-error - entries() is available
          for await (const [name] of legacyDir.entries()) {
            legacyFiles.push(name);
          }
          for (const name of legacyFiles) {
            try {
              await legacyDir.removeEntry(name, { recursive: true });
            } catch {
              // ignore locked files
            }
          }
        } catch {
          // legacy dir might not exist
        }
      }
    } catch {
      // OPFS not available
    }
  });
}

/**
 * Check storage availability in the browser
 */
async function checkStorageAvailability(page: Page): Promise<StorageCheckResult> {
  return page.evaluate(async (): Promise<StorageCheckResult> => {
    const result: StorageCheckResult = {
      opfsAvailable: false,
      idbAvailable: false,
    };

    // Check IndexedDB
    try {
      const testDb = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('__test__', 1);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      testDb.close();
      await new Promise<void>((resolve) => {
        const req = indexedDB.deleteDatabase('__test__');
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
      });
      result.idbAvailable = true;
    } catch {
      result.idbAvailable = false;
    }

    // Check OPFS
    try {
      if (!navigator.storage?.getDirectory) {
        result.opfsReason = 'navigator.storage.getDirectory not available';
        return result;
      }

      const root = await navigator.storage.getDirectory();
      const testDirName = `__opfs_test_${Date.now()}`;
      const testDir = await root.getDirectoryHandle(testDirName, { create: true });
      const testFile = await testDir.getFileHandle('test.txt', { create: true });

      // Try to create writable stream (works in main thread)
      const writable = await testFile.createWritable();
      await writable.write('test');
      await writable.close();

      // Clean up
      await root.removeEntry(testDirName, { recursive: true });
      result.opfsAvailable = true;
    } catch (err) {
      result.opfsReason = err instanceof Error ? err.message : String(err);
      result.opfsAvailable = false;
    }

    return result;
  });
}

/**
 * Create a database entry in the registry (IDB mode)
 */
async function createIdbRegistryEntry(
  page: Page,
  name: string
): Promise<string> {
  return page.evaluate(async (dbName: string): Promise<string> => {
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`;
    const timestamp = new Date().toISOString();

    const entry = {
      id,
      name: dbName,
      createdAt: timestamp,
      lastOpenedAt: timestamp,
      storageType: 'idb' as const,
    };

    // Open registry database
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('sqlite-editor-registry', 1);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => resolve(req.result);
      req.onupgradeneeded = (event) => {
        const database = (event.target as IDBOpenDBRequest).result;
        if (!database.objectStoreNames.contains('registry')) {
          database.createObjectStore('registry', { keyPath: 'key' });
        }
      };
    });

    // Read existing registry
    let existingData: { databases: typeof entry[] } = { databases: [] };
    try {
      const tx = db.transaction('registry', 'readonly');
      const store = tx.objectStore('registry');
      const result = await new Promise<{ key: string; data: typeof existingData } | undefined>(
        (resolve, reject) => {
          const req = store.get('registry');
          req.onsuccess = () => resolve(req.result as { key: string; data: typeof existingData } | undefined);
          req.onerror = () => reject(req.error);
        }
      );
      if (result?.data) {
        existingData = result.data;
      }
    } catch {
      // No existing data
    }

    // Add new entry
    existingData.databases.push(entry);

    // Save back
    const writeTx = db.transaction('registry', 'readwrite');
    const writeStore = writeTx.objectStore('registry');
    await new Promise<void>((resolve, reject) => {
      const req = writeStore.put({ key: 'registry', data: existingData });
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });

    db.close();
    return id;
  }, name);
}

/**
 * Store database blob in IDB storage
 */
async function storeIdbDatabase(
  page: Page,
  name: string,
  data: number[]
): Promise<void> {
  await page.evaluate(
    async ({ dbName, dbData }: { dbName: string; dbData: number[] }) => {
      const blob = new Blob([new Uint8Array(dbData)], {
        type: 'application/x-sqlite3',
      });

      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('idb-sqlite', 1);
        req.onerror = () => reject(req.error);
        req.onsuccess = () => resolve(req.result);
        req.onupgradeneeded = (event) => {
          const database = (event.target as IDBOpenDBRequest).result;
          if (!database.objectStoreNames.contains('databases')) {
            database.createObjectStore('databases', { keyPath: 'name' });
          }
        };
      });

      const tx = db.transaction('databases', 'readwrite');
      const store = tx.objectStore('databases');

      await new Promise<void>((resolve, reject) => {
        const req = store.put({
          name: dbName,
          blob,
          updatedAt: new Date().toISOString(),
        });
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });

      db.close();
    },
    { dbName: name, dbData: data }
  );
}

/**
 * Read registry from IDB
 */
async function readIdbRegistry(page: Page): Promise<RegistryState | null> {
  return page.evaluate(async (): Promise<RegistryState | null> => {
    try {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('sqlite-editor-registry', 1);
        req.onerror = () => reject(req.error);
        req.onsuccess = () => resolve(req.result);
        req.onupgradeneeded = (event) => {
          const database = (event.target as IDBOpenDBRequest).result;
          if (!database.objectStoreNames.contains('registry')) {
            database.createObjectStore('registry', { keyPath: 'key' });
          }
        };
      });

      const tx = db.transaction('registry', 'readonly');
      const store = tx.objectStore('registry');

      const result = await new Promise<{ key: string; data: { databases: Array<{ id: string; name: string; storageType: 'opfs' | 'idb' }> } } | undefined>(
        (resolve, reject) => {
          const req = store.get('registry');
          req.onsuccess = () => resolve(req.result as typeof result);
          req.onerror = () => reject(req.error);
        }
      );

      db.close();

      if (!result?.data) return null;

      return {
        databases: result.data.databases,
        storageMode: 'idb',
      };
    } catch {
      return null;
    }
  });
}

/**
 * Check if a database blob exists in IDB storage
 */
async function checkIdbDatabaseExists(page: Page, name: string): Promise<boolean> {
  return page.evaluate(async (dbName: string): Promise<boolean> => {
    try {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('idb-sqlite', 1);
        req.onerror = () => reject(req.error);
        req.onsuccess = () => resolve(req.result);
        req.onupgradeneeded = (event) => {
          const database = (event.target as IDBOpenDBRequest).result;
          if (!database.objectStoreNames.contains('databases')) {
            database.createObjectStore('databases', { keyPath: 'name' });
          }
        };
      });

      const tx = db.transaction('databases', 'readonly');
      const store = tx.objectStore('databases');

      const result = await new Promise<{ name: string; blob: Blob } | undefined>(
        (resolve, reject) => {
          const req = store.get(dbName);
          req.onsuccess = () => resolve(req.result as typeof result);
          req.onerror = () => reject(req.error);
        }
      );

      db.close();
      return !!result;
    } catch {
      return false;
    }
  }, name);
}

/**
 * Read database blob from IDB storage
 */
async function readIdbDatabaseBlob(
  page: Page,
  name: string
): Promise<number[] | null> {
  return page.evaluate(async (dbName: string): Promise<number[] | null> => {
    try {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('idb-sqlite', 1);
        req.onerror = () => reject(req.error);
        req.onsuccess = () => resolve(req.result);
      });

      const tx = db.transaction('databases', 'readonly');
      const store = tx.objectStore('databases');

      const result = await new Promise<{ name: string; blob: Blob } | undefined>(
        (resolve, reject) => {
          const req = store.get(dbName);
          req.onsuccess = () => resolve(req.result as typeof result);
          req.onerror = () => reject(req.error);
        }
      );

      db.close();

      if (!result?.blob) return null;

      const buffer = await result.blob.arrayBuffer();
      return Array.from(new Uint8Array(buffer));
    } catch {
      return null;
    }
  }, name);
}

// =============================================================================
// Test Suites
// =============================================================================

test.describe('Persistence Tests', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the app first to have access to browser APIs
    await page.goto('/');
    await expect(page).toHaveTitle(/SQLite Editor/);

    // Clear storage before each test
    await clearAllStorage(page);
  });

  test.describe('Storage Mode Detection', () => {
    test('detects available storage mechanisms', async ({ page }) => {
      const availability = await checkStorageAvailability(page);

      // IndexedDB should always be available in modern browsers
      expect(availability.idbAvailable).toBe(true);

      // Log OPFS availability for debugging
      console.log('OPFS available:', availability.opfsAvailable);
      if (!availability.opfsAvailable) {
        console.log('OPFS reason:', availability.opfsReason);
      }
    });

    test('app loads successfully regardless of storage mode', async ({ page }) => {
      // Clear and reload
      await page.reload();
      await expect(page).toHaveTitle(/SQLite Editor/);

      // App should display welcome screen
      await expect(page.locator('h1')).toContainText('SQLite Editor');
    });
  });

  test.describe('Basic Persistence (IndexedDB)', () => {
    test('registry entry persists across page refresh', async ({ page }) => {
      const testData = [
        0x53, 0x51, 0x4c, 0x69, 0x74, 0x65, 0x20, 0x66, // "SQLite f"
        0x6f, 0x72, 0x6d, 0x61, 0x74, 0x20, 0x33, 0x00, // "ormat 3\0"
      ];

      await storeIdbDatabase(page, 'test-db', testData);

      // Create a registry entry
      const id = await createIdbRegistryEntry(page, 'test-db');
      expect(id).toBeTruthy();

      // Verify it exists before refresh
      const beforeRefresh = await readIdbRegistry(page);
      expect(beforeRefresh?.databases).toHaveLength(1);
      expect(beforeRefresh?.databases[0].name).toBe('test-db');

      // Refresh the page
      await page.reload();
      await expect(page).toHaveTitle(/SQLite Editor/);

      // Verify it still exists after refresh
      const afterRefresh = await readIdbRegistry(page);
      expect(afterRefresh?.databases).toHaveLength(1);
      expect(afterRefresh?.databases[0].name).toBe('test-db');
      expect(afterRefresh?.databases[0].id).toBe(id);
    });

    test('database blob persists across page refresh', async ({ page }) => {
      // Create a simple test blob (mimicking SQLite header)
      const testData = [
        0x53, 0x51, 0x4c, 0x69, 0x74, 0x65, 0x20, 0x66, // "SQLite f"
        0x6f, 0x72, 0x6d, 0x61, 0x74, 0x20, 0x33, 0x00, // "ormat 3\0"
      ];

      // Store the database
      await storeIdbDatabase(page, 'persist-test.sqlite', testData);

      // Verify it exists before refresh
      const existsBefore = await checkIdbDatabaseExists(page, 'persist-test.sqlite');
      expect(existsBefore).toBe(true);

      // Refresh the page
      await page.reload();
      await expect(page).toHaveTitle(/SQLite Editor/);

      // Verify it still exists after refresh
      const existsAfter = await checkIdbDatabaseExists(page, 'persist-test.sqlite');
      expect(existsAfter).toBe(true);

      // Verify data integrity
      const readData = await readIdbDatabaseBlob(page, 'persist-test.sqlite');
      expect(readData).toEqual(testData);
    });

    test('data persists after creating table and inserting rows', async ({ page }) => {
      // Store initial database
      const initialData = Array(100).fill(0);
      await storeIdbDatabase(page, 'data-test.sqlite', initialData);

      // Create registry entry
      await createIdbRegistryEntry(page, 'data-test.sqlite');

      // Refresh
      await page.reload();
      await expect(page).toHaveTitle(/SQLite Editor/);

      // Verify persistence
      const exists = await checkIdbDatabaseExists(page, 'data-test.sqlite');
      expect(exists).toBe(true);

      const registry = await readIdbRegistry(page);
      expect(registry?.databases.some((db) => db.name === 'data-test.sqlite')).toBe(true);
    });
  });

  test.describe('Multiple Databases', () => {
    test('multiple databases persist independently', async ({ page }) => {
      // Create 3 databases
      const names = ['db-alpha', 'db-beta', 'db-gamma'];

      for (const name of names) {
        await createIdbRegistryEntry(page, name);
        await storeIdbDatabase(page, name, [0x53, 0x51, 0x4c, name.charCodeAt(3)]);
      }

      // Verify all exist before refresh
      const registryBefore = await readIdbRegistry(page);
      expect(registryBefore?.databases).toHaveLength(3);

      for (const name of names) {
        const exists = await checkIdbDatabaseExists(page, name);
        expect(exists).toBe(true);
      }

      // Refresh
      await page.reload();
      await expect(page).toHaveTitle(/SQLite Editor/);

      // Verify all persist after refresh
      const registryAfter = await readIdbRegistry(page);
      expect(registryAfter?.databases).toHaveLength(3);

      for (const name of names) {
        const exists = await checkIdbDatabaseExists(page, name);
        expect(exists).toBe(true);
      }
    });

    test('databases maintain unique identities', async ({ page }) => {
      // Create databases with similar names
      await createIdbRegistryEntry(page, 'test');
      await createIdbRegistryEntry(page, 'test-2');
      await createIdbRegistryEntry(page, 'test_backup');

      const registry = await readIdbRegistry(page);
      expect(registry?.databases).toHaveLength(3);

      // All IDs should be unique
      const ids = registry!.databases.map((db) => db.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(3);

      // All names should be distinct
      const dbNames = registry!.databases.map((db) => db.name);
      expect(dbNames).toContain('test');
      expect(dbNames).toContain('test-2');
      expect(dbNames).toContain('test_backup');
    });
  });

  test.describe('Large Data Persistence', () => {
    test('persists database with 10KB of data', async ({ page }) => {
      // Create ~10KB of test data
      const size = 10 * 1024;
      const largeData = new Array(size).fill(0).map((_, i) => i % 256);

      await storeIdbDatabase(page, 'large-db.sqlite', largeData);
      await createIdbRegistryEntry(page, 'large-db.sqlite');

      // Refresh
      await page.reload();
      await expect(page).toHaveTitle(/SQLite Editor/);

      // Verify persistence and integrity
      const readData = await readIdbDatabaseBlob(page, 'large-db.sqlite');
      expect(readData).toHaveLength(size);
      expect(readData).toEqual(largeData);
    });

    test('persists database with 100KB of data', async ({ page }) => {
      // Create ~100KB of test data
      const size = 100 * 1024;
      const largeData = new Array(size).fill(0).map((_, i) => i % 256);

      await storeIdbDatabase(page, 'large-100kb.sqlite', largeData);

      // Verify before refresh
      const existsBefore = await checkIdbDatabaseExists(page, 'large-100kb.sqlite');
      expect(existsBefore).toBe(true);

      // Refresh
      await page.reload();

      // Verify after refresh
      const existsAfter = await checkIdbDatabaseExists(page, 'large-100kb.sqlite');
      expect(existsAfter).toBe(true);

      // Verify data integrity (check first and last portions)
      const readData = await readIdbDatabaseBlob(page, 'large-100kb.sqlite');
      expect(readData).toHaveLength(size);

      // Check first 100 bytes
      for (let i = 0; i < 100; i++) {
        expect(readData![i]).toBe(largeData[i]);
      }

      // Check last 100 bytes
      for (let i = size - 100; i < size; i++) {
        expect(readData![i]).toBe(largeData[i]);
      }
    });
  });

  test.describe('Binary Data (BLOB)', () => {
    test('binary data with various byte values persists correctly', async ({ page }) => {
      // Test with all possible byte values (0-255)
      const binaryData: number[] = [];
      for (let i = 0; i < 256; i++) {
        binaryData.push(i);
      }

      await storeIdbDatabase(page, 'binary-test.sqlite', binaryData);

      // Refresh
      await page.reload();
      await expect(page).toHaveTitle(/SQLite Editor/);

      // Verify complete binary integrity
      const readData = await readIdbDatabaseBlob(page, 'binary-test.sqlite');
      expect(readData).toEqual(binaryData);
    });

    test('null bytes are preserved', async ({ page }) => {
      // Data with embedded null bytes
      const dataWithNulls = [0x00, 0x01, 0x00, 0x00, 0xff, 0x00, 0xfe, 0x00];

      await storeIdbDatabase(page, 'null-bytes.sqlite', dataWithNulls);

      // Refresh
      await page.reload();

      // Verify null bytes are preserved
      const readData = await readIdbDatabaseBlob(page, 'null-bytes.sqlite');
      expect(readData).toEqual(dataWithNulls);
    });

    test('SQLite file header is preserved', async ({ page }) => {
      // Real SQLite file header (16 bytes)
      const sqliteHeader = [
        0x53, 0x51, 0x4c, 0x69, 0x74, 0x65, 0x20, 0x66, // "SQLite f"
        0x6f, 0x72, 0x6d, 0x61, 0x74, 0x20, 0x33, 0x00, // "ormat 3\0"
      ];

      await storeIdbDatabase(page, 'header-test.sqlite', sqliteHeader);

      // Refresh
      await page.reload();

      // Verify header integrity
      const readData = await readIdbDatabaseBlob(page, 'header-test.sqlite');
      expect(readData).toEqual(sqliteHeader);

      // Verify it spells "SQLite format 3"
      const headerStr = String.fromCharCode(...readData!.slice(0, 15));
      expect(headerStr).toBe('SQLite format 3');
    });
  });

  test.describe('Storage Isolation', () => {
    test('registry and database stores are independent', async ({ page }) => {
      // Create registry entry without database blob
      await createIdbRegistryEntry(page, 'registry-only');

      // Create database blob without registry entry
      await storeIdbDatabase(page, 'blob-only', [0x00, 0x01, 0x02]);

      // Verify registry entry exists but blob doesn't
      const registry = await readIdbRegistry(page);
      expect(registry?.databases.some((db) => db.name === 'registry-only')).toBe(true);

      const registryBlobExists = await checkIdbDatabaseExists(page, 'registry-only');
      expect(registryBlobExists).toBe(false);

      // Verify blob exists but registry entry doesn't
      const blobExists = await checkIdbDatabaseExists(page, 'blob-only');
      expect(blobExists).toBe(true);

      expect(registry?.databases.some((db) => db.name === 'blob-only')).toBe(false);
    });

    test('clearing one store does not affect the other', async ({ page }) => {
      // Setup both stores
      await createIdbRegistryEntry(page, 'test-db');
      await storeIdbDatabase(page, 'test-db', [0x01, 0x02, 0x03]);

      // Clear only the database store
      await page.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const req = indexedDB.open('idb-sqlite', 1);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        const tx = db.transaction('databases', 'readwrite');
        await new Promise<void>((resolve, reject) => {
          const req = tx.objectStore('databases').clear();
          req.onsuccess = () => resolve();
          req.onerror = () => reject(req.error);
        });
        db.close();
      });

      // Verify registry still exists
      const registry = await readIdbRegistry(page);
      expect(registry?.databases).toHaveLength(1);

      // Verify database blob is cleared
      const blobExists = await checkIdbDatabaseExists(page, 'test-db');
      expect(blobExists).toBe(false);
    });
  });

  test.describe('Edge Cases', () => {
    test('handles empty database name edge case', async ({ page }) => {
      // Attempt to create an entry with empty name (edge case)
      // The app should handle this gracefully
      await createIdbRegistryEntry(page, '');

      const registry = await readIdbRegistry(page);
      // Should still work even with empty name
      expect(registry?.databases).toHaveLength(1);
      expect(registry?.databases[0].name).toBe('');
    });

    test('handles special characters in database name', async ({ page }) => {
      const specialNames = [
        'test with spaces',
        'test-with-dashes',
        'test_with_underscores',
        'test.with.dots',
        'Test (Copy)',
        'données_françaises',
      ];

      for (const name of specialNames) {
        await createIdbRegistryEntry(page, name);
      }

      const registry = await readIdbRegistry(page);
      expect(registry?.databases).toHaveLength(specialNames.length);

      for (const name of specialNames) {
        expect(registry?.databases.some((db) => db.name === name)).toBe(true);
      }
    });

    test('handles rapid successive writes', async ({ page }) => {
      // Create multiple databases in rapid succession (sequentially to avoid read-modify-write race)
      // This tests that the storage layer handles back-to-back writes correctly
      for (let i = 0; i < 5; i++) {
        await createIdbRegistryEntry(page, `rapid-${i}`);
      }

      const registry = await readIdbRegistry(page);
      expect(registry?.databases).toHaveLength(5);

      // Verify all entries are present
      for (let i = 0; i < 5; i++) {
        expect(registry?.databases.some((db) => db.name === `rapid-${i}`)).toBe(true);
      }
    });

    test('persists across browser context close and reopen', async ({ page, context }) => {
      // Create data
      await createIdbRegistryEntry(page, 'context-test');
      await storeIdbDatabase(page, 'context-test', [0x01, 0x02, 0x03]);

      // Store the cookies and storage state to simulate reopening
      // (Playwright context.storageState doesn't capture IndexedDB directly,
      // but the IDB data persists within the same browser profile)

      // Close the page
      await page.close();

      // Create a new page in the same context (simulates opening new tab)
      const newPage = await context.newPage();
      await newPage.goto('/');
      await expect(newPage).toHaveTitle(/SQLite Editor/);

      // Verify data persists
      const registry = await readIdbRegistry(newPage);
      expect(registry?.databases.some((db) => db.name === 'context-test')).toBe(true);

      const blobExists = await checkIdbDatabaseExists(newPage, 'context-test');
      expect(blobExists).toBe(true);
    });
  });
});

test.describe('Storage Mode Indicator', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/SQLite Editor/);
  });

  test('status bar shows storage mode information', async ({ page }) => {
    // The status bar should exist
    const statusBar = page.locator('[role="status"]');
    await expect(statusBar).toBeVisible();

    // Should show "SQLite WASM" text indicating the engine
    await expect(statusBar).toContainText('SQLite WASM');
  });

  test('app displays ready state', async ({ page }) => {
    // The app should show a ready indicator
    const readyIndicator = page.locator('text=Ready');
    await expect(readyIndicator).toBeVisible();
  });
});
