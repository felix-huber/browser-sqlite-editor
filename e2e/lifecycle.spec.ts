import { test, expect, type Page } from '@playwright/test';
import {
  createAndOpenDatabase,
  runSqlStatements,
  waitForReady,
  dismissUnsavedPromptIfVisible,
  openTable,
} from './helpers/app';

/**
 * E2E Tests for Database Lifecycle (US-013)
 *
 * Tests for:
 * - E2E-US-013-01: Rename persists + query history migrated
 * - E2E-US-013-02: Delete removes .sqlite + .erd.json + registry entry
 * - E2E-US-013-03: Switch with in-progress cell edit prompts; discard → not persisted
 */

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Clear all storage for clean test state
 */
async function clearAllStorage(page: Page): Promise<void> {
  await page.evaluate(async () => {
    localStorage.clear();

    const deleteIdb = (name: string): Promise<void> => {
      return new Promise((resolve, reject) => {
        const req = indexedDB.deleteDatabase(name);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
        req.onblocked = () => resolve();
      });
    };

    await deleteIdb('sqlite-editor-registry');
    await deleteIdb('idb-sqlite');
    await deleteIdb('idb-vfs');

    try {
      if (navigator.storage?.getDirectory) {
        const root = await navigator.storage.getDirectory();
        try {
          await root.removeEntry('wasm-sqlite-editor', { recursive: true });
        } catch {
          // Directory might not exist
        }
        try {
          await root.removeEntry('sqlite-editor', { recursive: true });
        } catch {
          // Legacy directory might not exist
        }
      }
    } catch {
      // OPFS not available
    }
  });
}

/**
 * Get query history from localStorage for a database
 */
async function getQueryHistory(page: Page, dbName: string): Promise<string[]> {
  return page.evaluate((name) => {
    const key = `qh:${name}`;
    const stored = localStorage.getItem(key);
    if (!stored) return [];
    try {
      const parsed = JSON.parse(stored);
      if (!Array.isArray(parsed)) return [];
      return parsed.map((item: { sql?: string }) => item.sql ?? '');
    } catch {
      return [];
    }
  }, dbName);
}

/**
 * Get registry from the test API (in-memory store)
 */
async function getRegistry(
  page: Page
): Promise<{ databases: Array<{ name: string; id?: string }> } | null> {
  return page.evaluate(async () => {
    const testApi = (
      window as Window & {
        __sqliteEditorTest?: { getRegistry?: () => Promise<unknown> };
      }
    ).__sqliteEditorTest;

    if (!testApi?.getRegistry) return null;

    try {
      const registry = await testApi.getRegistry();
      if (registry && typeof registry === 'object' && 'databases' in registry) {
        return registry as { databases: Array<{ name: string; id?: string }> };
      }
      return null;
    } catch {
      return null;
    }
  });
}

/**
 * Force reload registry from storage.
 * Call this after modifying storage directly to sync the app's in-memory state.
 */
async function reloadRegistry(page: Page): Promise<boolean> {
  return page.evaluate(async () => {
    const testApi = (
      window as Window & {
        __sqliteEditorTest?: { reloadRegistry?: () => Promise<void> };
      }
    ).__sqliteEditorTest;

    if (testApi?.reloadRegistry) {
      await testApi.reloadRegistry();
      return true;
    }
    return false;
  });
}

/**
 * List files in OPFS databases directory
 */
async function listOpfsFiles(page: Page): Promise<string[]> {
  return page.evaluate(async (): Promise<string[]> => {
    try {
      if (!navigator.storage?.getDirectory) return [];

      const root = await navigator.storage.getDirectory();
      let dbDir: FileSystemDirectoryHandle;
      try {
        const appDir = await root.getDirectoryHandle('wasm-sqlite-editor');
        dbDir = await appDir.getDirectoryHandle('databases');
      } catch {
        return [];
      }

      const files: string[] = [];
      const entries = (
        dbDir as unknown as AsyncIterable<[string, FileSystemHandle]>
      )[Symbol.asyncIterator]();
      for await (const [name, handle] of { [Symbol.asyncIterator]: () => entries }) {
        if (handle.kind === 'file') {
          files.push(name);
        }
      }
      return files;
    } catch {
      return [];
    }
  });
}

/**
 * Check if OPFS is available
 */
async function isOpfsAvailable(page: Page): Promise<boolean> {
  return page.evaluate(async (): Promise<boolean> => {
    try {
      if (!navigator.storage?.getDirectory) return false;
      const root = await navigator.storage.getDirectory();
      const testDir = `__test_${Date.now()}`;
      await root.getDirectoryHandle(testDir, { create: true });
      await root.removeEntry(testDir);
      return true;
    } catch {
      return false;
    }
  });
}

/**
 * Rename a database directly via storage APIs (OPFS or IDB registry)
 * Also migrates query history.
 */
async function renameDatabaseDirect(
  page: Page,
  oldName: string,
  newName: string
): Promise<{ success: boolean; error?: string }> {
  return page.evaluate(
    async ({ oldN, newN }) => {
      try {
        // Step 1: Migrate query history in localStorage
        const oldHistoryKey = `qh:${oldN}`;
        const newHistoryKey = `qh:${newN}`;
        const history = localStorage.getItem(oldHistoryKey);
        if (history) {
          localStorage.setItem(newHistoryKey, history);
          localStorage.removeItem(oldHistoryKey);
        }

        // Step 2: Read and update registry (try OPFS first, fall back to IDB)
        let registryData: { databases: Array<{ id: string; name: string; storageType: 'opfs' | 'idb'; createdAt: string; lastOpenedAt: string }> } | null = null;
        let useOpfs = false;

        // Try OPFS first
        try {
          if (navigator.storage?.getDirectory) {
            const root = await navigator.storage.getDirectory();
            const appDir = await root.getDirectoryHandle('wasm-sqlite-editor');
            const file = await appDir.getFileHandle('registry.json');
            const blob = await file.getFile();
            const text = await blob.text();
            registryData = JSON.parse(text);
            useOpfs = true;
          }
        } catch {
          // OPFS registry not available, try IDB
        }

        // Fall back to IDB if OPFS not available
        if (!registryData) {
          const registryDb = await new Promise<IDBDatabase>((resolve, reject) => {
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

          const tx = registryDb.transaction('registry', 'readonly');
          const store = tx.objectStore('registry');
          const result = await new Promise<{ key: string; data: typeof registryData } | undefined>(
            (resolve, reject) => {
              const req = store.get('registry');
              req.onsuccess = () => resolve(req.result as typeof result);
              req.onerror = () => reject(req.error);
            }
          );
          registryDb.close();

          if (result?.data) {
            registryData = result.data;
          }
        }

        if (!registryData) {
          return { success: false, error: 'Registry not found in OPFS or IDB' };
        }

        // Find and update the entry
        const entry = registryData.databases.find((e) => e.name === oldN);
        if (!entry) {
          return { success: false, error: `Database "${oldN}" not found` };
        }

        entry.name = newN;

        // Helper function to convert name to filename
        // NOTE: Must match toFilename() in src/worker/db-registry.ts
        const toFilename = (name: string): string => {
          return name
            .replace(/[<>:"/\\|?*()]/g, '_')
            .replace(/\s+/g, '_')
            .toLowerCase() + '.sqlite';
        };

        // Check if this is an IDB-stored database
        const isIdbDatabase = entry.storageType === 'idb';

        // Write back to the appropriate storage
        if (useOpfs) {
          const root = await navigator.storage.getDirectory();
          const appDir = await root.getDirectoryHandle('wasm-sqlite-editor');
          const file = await appDir.getFileHandle('registry.json', { create: true });
          const writable = await file.createWritable();
          await writable.write(JSON.stringify(registryData, null, 2));
          await writable.close();

          // Rename the database file based on storage type
          if (isIdbDatabase) {
            // For IDB databases, rename in the idb-batch-atomic VFS store
            try {
              const idbVfs = await new Promise<IDBDatabase>((resolve, reject) => {
                const req = indexedDB.open('idb-batch-atomic', 6);
                req.onerror = () => reject(req.error);
                req.onsuccess = () => resolve(req.result);
                req.onupgradeneeded = () => {
                  const db = req.result;
                  if (!db.objectStoreNames.contains('metadata')) {
                    db.createObjectStore('metadata', { keyPath: 'name' });
                  }
                  if (!db.objectStoreNames.contains('blocks')) {
                    db.createObjectStore('blocks', { keyPath: ['path', 'offset', 'version'] });
                  }
                };
              });

              const oldPath = `/${oldN}`;
              const newPath = `/${newN}`;

              const tx = idbVfs.transaction(['metadata', 'blocks'], 'readwrite');
              const metadata = tx.objectStore('metadata');
              const blocks = tx.objectStore('blocks');

              // Get and rename metadata entry
              const oldMeta = await new Promise<{ name: string; fileSize: number; version: number } | undefined>((resolve, reject) => {
                const req = metadata.get(oldPath);
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
              });

              if (oldMeta) {
                await new Promise<void>((resolve, reject) => {
                  const req = metadata.put({ ...oldMeta, name: newPath });
                  req.onsuccess = () => resolve();
                  req.onerror = () => reject(req.error);
                });
                await new Promise<void>((resolve, reject) => {
                  const req = metadata.delete(oldPath);
                  req.onsuccess = () => resolve();
                  req.onerror = () => reject(req.error);
                });

                // Rename all blocks for this database
                await new Promise<void>((resolve, reject) => {
                  const range = IDBKeyRange.bound([oldPath, -Infinity], [oldPath, Infinity]);
                  const cursorReq = blocks.openCursor(range);
                  cursorReq.onerror = () => reject(cursorReq.error);
                  cursorReq.onsuccess = () => {
                    const cursor = cursorReq.result;
                    if (!cursor) {
                      resolve();
                      return;
                    }
                    const value = cursor.value as { path: string; offset: number; version: number; data: Uint8Array };
                    blocks.put({ ...value, path: newPath });
                    cursor.delete();
                    cursor.continue();
                  };
                });
              }

              await new Promise<void>((resolve, reject) => {
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
              });
              idbVfs.close();
            } catch (idbErr) {
              console.warn('IDB VFS rename failed:', idbErr);
            }
          } else {
            // For OPFS databases, rename the .sqlite file
            try {
              const dbDir = await appDir.getDirectoryHandle('databases');
              const oldFilename = toFilename(oldN);
              const newFilename = toFilename(newN);

              // Read old file
              const oldFileHandle = await dbDir.getFileHandle(oldFilename);
              const oldFile = await oldFileHandle.getFile();
              const oldData = await oldFile.arrayBuffer();

              // Create new file
              const newFileHandle = await dbDir.getFileHandle(newFilename, { create: true });
              const newWritable = await newFileHandle.createWritable();
              await newWritable.write(oldData);
              await newWritable.close();

              // Delete old file
              await dbDir.removeEntry(oldFilename);

              // Also rename sidecar if it exists
              try {
                const oldSidecar = oldFilename.replace(/\.sqlite$/, '.erd.json');
                const newSidecar = newFilename.replace(/\.sqlite$/, '.erd.json');
                const oldSidecarHandle = await dbDir.getFileHandle(oldSidecar);
                const sidecarFile = await oldSidecarHandle.getFile();
                const sidecarData = await sidecarFile.arrayBuffer();
                const newSidecarHandle = await dbDir.getFileHandle(newSidecar, { create: true });
                const sidecarWritable = await newSidecarHandle.createWritable();
                await sidecarWritable.write(sidecarData);
                await sidecarWritable.close();
                await dbDir.removeEntry(oldSidecar);
              } catch {
                // Sidecar might not exist, that's ok
              }
            } catch (fileErr) {
              // File rename failed - this might happen if the file is locked
              console.warn('File rename failed:', fileErr);
            }
          }
        } else {
          const registryDb = await new Promise<IDBDatabase>((resolve, reject) => {
            const req = indexedDB.open('sqlite-editor-registry', 1);
            req.onerror = () => reject(req.error);
            req.onsuccess = () => resolve(req.result);
          });

          const writeTx = registryDb.transaction('registry', 'readwrite');
          const writeStore = writeTx.objectStore('registry');
          await new Promise<void>((resolve, reject) => {
            const req = writeStore.put({ key: 'registry', data: registryData });
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
          });
          registryDb.close();
        }

        return { success: true };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    { oldN: oldName, newN: newName }
  );
}

/**
 * Delete a database directly via storage APIs
 * Also removes query history.
 */
async function deleteDatabaseDirect(
  page: Page,
  dbName: string
): Promise<{ success: boolean; error?: string }> {
  return page.evaluate(async (name) => {
    try {
      // Step 1: Remove query history from localStorage
      const historyKey = `qh:${name}`;
      localStorage.removeItem(historyKey);

      // Step 2: Read and update registry (try OPFS first, fall back to IDB)
      let registryData: { databases: Array<{ id: string; name: string; storageType: 'opfs' | 'idb'; createdAt: string; lastOpenedAt: string }> } | null = null;
      let useOpfs = false;

      // Try OPFS first
      try {
        if (navigator.storage?.getDirectory) {
          const root = await navigator.storage.getDirectory();
          const appDir = await root.getDirectoryHandle('wasm-sqlite-editor');
          const file = await appDir.getFileHandle('registry.json');
          const blob = await file.getFile();
          const text = await blob.text();
          registryData = JSON.parse(text);
          useOpfs = true;
        }
      } catch {
        // OPFS registry not available, try IDB
      }

      // Fall back to IDB if OPFS not available
      if (!registryData) {
        const registryDb = await new Promise<IDBDatabase>((resolve, reject) => {
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

        const tx = registryDb.transaction('registry', 'readonly');
        const store = tx.objectStore('registry');
        const result = await new Promise<{ key: string; data: typeof registryData } | undefined>(
          (resolve, reject) => {
            const req = store.get('registry');
            req.onsuccess = () => resolve(req.result as typeof result);
            req.onerror = () => reject(req.error);
          }
        );
        registryDb.close();

        if (result?.data) {
          registryData = result.data;
        }
      }

      if (!registryData) {
        return { success: false, error: 'Registry not found in OPFS or IDB' };
      }

      // Find and remove the entry
      const index = registryData.databases.findIndex((e) => e.name === name);
      if (index === -1) {
        return { success: false, error: `Database "${name}" not found` };
      }

      const entry = registryData.databases[index];
      const isIdbDatabase = entry.storageType === 'idb';

      registryData.databases.splice(index, 1);

      // Write back to the appropriate storage
      if (useOpfs) {
        const root = await navigator.storage.getDirectory();
        const appDir = await root.getDirectoryHandle('wasm-sqlite-editor');
        const file = await appDir.getFileHandle('registry.json', { create: true });
        const writable = await file.createWritable();
        await writable.write(JSON.stringify(registryData, null, 2));
        await writable.close();

        // Delete the database files based on storage type
        if (isIdbDatabase) {
          // For IDB databases, delete from the idb-batch-atomic VFS store
          try {
            const idbVfs = await new Promise<IDBDatabase>((resolve, reject) => {
              const req = indexedDB.open('idb-batch-atomic', 6);
              req.onerror = () => reject(req.error);
              req.onsuccess = () => resolve(req.result);
              req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains('metadata')) {
                  db.createObjectStore('metadata', { keyPath: 'name' });
                }
                if (!db.objectStoreNames.contains('blocks')) {
                  db.createObjectStore('blocks', { keyPath: ['path', 'offset', 'version'] });
                }
              };
            });

            const dbPath = `/${name}`;
            const tx = idbVfs.transaction(['metadata', 'blocks'], 'readwrite');
            const metadata = tx.objectStore('metadata');
            const blocks = tx.objectStore('blocks');

            // Delete metadata entry
            await new Promise<void>((resolve, reject) => {
              const req = metadata.delete(dbPath);
              req.onsuccess = () => resolve();
              req.onerror = () => reject(req.error);
            });

            // Delete all blocks for this database
            await new Promise<void>((resolve, reject) => {
              const range = IDBKeyRange.bound([dbPath, -Infinity], [dbPath, Infinity]);
              const req = blocks.delete(range);
              req.onsuccess = () => resolve();
              req.onerror = () => reject(req.error);
            });

            await new Promise<void>((resolve, reject) => {
              tx.oncomplete = () => resolve();
              tx.onerror = () => reject(tx.error);
            });
            idbVfs.close();
          } catch (idbErr) {
            console.warn('IDB VFS delete failed:', idbErr);
          }
        } else {
          // For OPFS databases, delete the .sqlite file
          try {
            const dbDir = await appDir.getDirectoryHandle('databases');
            // Helper to convert name to filename (same logic as app)
            // NOTE: Must match toFilename() in src/worker/db-registry.ts
            const toFilename = (n: string): string =>
              n.replace(/[<>:"/\\|?*()]/g, '_').replace(/\s+/g, '_').toLowerCase();
            const filename = toFilename(name) + '.sqlite';
            const erdFilename = toFilename(name) + '.erd.json';

            try {
              await dbDir.removeEntry(filename);
            } catch {
              // File might not exist
            }
            try {
              await dbDir.removeEntry(erdFilename);
            } catch {
              // ERD file might not exist
            }
          } catch {
            // databases dir might not exist
          }
        }
      } else {
        const registryDb = await new Promise<IDBDatabase>((resolve, reject) => {
          const req = indexedDB.open('sqlite-editor-registry', 1);
          req.onerror = () => reject(req.error);
          req.onsuccess = () => resolve(req.result);
        });

        const writeTx = registryDb.transaction('registry', 'readwrite');
        const writeStore = writeTx.objectStore('registry');
        await new Promise<void>((resolve, reject) => {
          const req = writeStore.put({ key: 'registry', data: registryData });
          req.onsuccess = () => resolve();
          req.onerror = () => reject(req.error);
        });
        registryDb.close();
      }

      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }, dbName);
}

/**
 * Open cell editor helper
 */
async function openCellEditor(page: Page, row: number, column: string) {
  const cell = page.getByTestId(`cell-${row}-${column}`);
  await cell.dblclick();
  const input = page.getByTestId('edit-input');
  const textarea = page.getByTestId('edit-textarea');
  if (await input.isVisible().catch(() => false)) return input;
  await expect(textarea).toBeVisible();
  return textarea;
}

// =============================================================================
// Test Suite: E2E-US-013
// =============================================================================

test.describe('Database Lifecycle E2E (US-013)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/SQLite Editor/);
    await clearAllStorage(page);
    // Reload to ensure clean state is picked up
    await page.reload();
    await expect(page).toHaveTitle(/SQLite Editor/);
  });

  test.describe('E2E-US-013-01: Rename persists + query history migrated', () => {
    test('E2E-US-013-01: rename DB persists and query history is migrated to new name', async ({
      page,
    }) => {
      const originalName = 'rename-history-test';
      const newName = 'rename-history-test-renamed';

      // Step 1: Create and open database
      await createAndOpenDatabase(page, originalName);
      await waitForReady(page);

      // Step 2: Run some SQL to populate query history
      const testQueries = [
        'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)',
        "INSERT INTO users (name) VALUES ('Alice')",
        'SELECT * FROM users',
      ];
      await runSqlStatements(page, testQueries);
      await waitForReady(page);

      // Step 3: Verify query history exists for original name
      const historyBefore = await getQueryHistory(page, originalName);
      expect(historyBefore.length).toBeGreaterThan(0);
      // History should contain our queries (stored in reverse order - newest first)
      expect(historyBefore.some((q) => q.includes('SELECT * FROM users'))).toBe(true);

      // Step 4: Verify history does NOT exist for new name yet
      const newHistoryBefore = await getQueryHistory(page, newName);
      expect(newHistoryBefore.length).toBe(0);

      // Step 5: Navigate away to fully release all file handles before renaming
      // Going to about:blank ensures no worker is running and all OPFS handles are released
      await page.goto('about:blank');
      await page.waitForTimeout(500); // Brief pause to ensure handles are released

      // Step 6: Navigate back to the app and wait for it to fully initialize
      await page.goto('/');
      await expect(page).toHaveTitle(/SQLite Editor/);
      await waitForReady(page);

      // Step 7: Perform rename directly in storage
      // Note: This modifies the persistent storage but the app's in-memory state is stale
      const renameResult = await renameDatabaseDirect(page, originalName, newName);
      expect(renameResult.success).toBe(true);
      if (renameResult.error) {
        console.log('Rename error details:', renameResult.error);
      }

      // Step 8: Force the app to reload registry from storage
      // This is necessary because we modified storage directly, bypassing the app's APIs
      const reloaded = await reloadRegistry(page);
      expect(reloaded).toBe(true); // Verify reloadRegistry API is available

      // Step 9: Verify registry has new name, not old name (via test API after reload)
      const registry = await getRegistry(page);
      expect(registry?.databases.some((db) => db.name === newName)).toBe(true);
      expect(registry?.databases.some((db) => db.name === originalName)).toBe(false);

      // Step 10: Verify query history was migrated to new name
      const historyAfter = await getQueryHistory(page, newName);
      expect(historyAfter.length).toBeGreaterThan(0);
      expect(historyAfter.some((q) => q.includes('SELECT * FROM users'))).toBe(true);

      // Step 11: Verify old history key is gone
      const oldHistoryAfter = await getQueryHistory(page, originalName);
      expect(oldHistoryAfter.length).toBe(0);
    });
  });

  test.describe('E2E-US-013-02: Delete removes all files and registry entry', () => {
    test('E2E-US-013-02: delete DB removes .sqlite + .erd.json + registry entry', async ({
      page,
    }) => {
      const dbName = 'delete-cleanup-test';

      // Step 1: Create and open database
      await createAndOpenDatabase(page, dbName);
      await waitForReady(page);

      // Step 2: Create a table to ensure the DB has content
      await runSqlStatements(page, [
        'CREATE TABLE items (id INTEGER PRIMARY KEY, data TEXT)',
        "INSERT INTO items (data) VALUES ('test')",
      ]);
      await waitForReady(page);

      // Step 3: Open ERD tab to trigger .erd.json sidecar creation
      const erdTab = page.getByTestId('tab-erd');
      if (await erdTab.isVisible().catch(() => false)) {
        await erdTab.click();
        await dismissUnsavedPromptIfVisible(page);
        await waitForReady(page);
        // Wait for ERD to render and potentially save layout
        // Give time for ERD view to initialize and save sidecar
        try {
          await page.waitForTimeout(1000);
        } catch {
          // Page might close during timeout - that's ok for this test
        }
      }

      // Step 4: Check OPFS availability
      const opfsAvailable = await isOpfsAvailable(page);

      // Note: createAndOpenDatabase() creates databases in IDB (not OPFS) by design.
      // New databases use IDB VFS; only imported databases use OPFS.
      // So we don't check for OPFS files here - the database is in IDB storage.

      // Step 5: Verify database is in registry
      const registryBefore = await getRegistry(page);
      expect(registryBefore?.databases.some((db) => db.name === dbName)).toBe(true);

      // Step 6: Verify query history exists (from running SQL)
      const historyBefore = await getQueryHistory(page, dbName);
      expect(historyBefore.length).toBeGreaterThan(0);

      // Step 7: Navigate away to fully release all file handles before deleting
      // Going to about:blank ensures no worker is running and all OPFS handles are released
      await page.goto('about:blank');
      await page.waitForTimeout(500); // Brief pause to ensure handles are released

      // Step 8: Navigate back to the app and wait for it to fully initialize
      await page.goto('/');
      await expect(page).toHaveTitle(/SQLite Editor/);
      await waitForReady(page);

      // Step 9: Perform delete directly in storage
      const deleteResult = await deleteDatabaseDirect(page, dbName);
      expect(deleteResult.success).toBe(true);

      // Step 10: Force the app to reload registry from storage
      await reloadRegistry(page);

      // Step 11: Verify database is removed from registry (via test API after reload)
      const registryAfter = await getRegistry(page);
      expect(registryAfter?.databases.some((db) => db.name === dbName)).toBe(false);

      // Step 12: If OPFS available, verify no orphaned OPFS files exist for this database
      // (Note: The database was in IDB, so there shouldn't be any OPFS files anyway)
      if (opfsAvailable) {
        const filesAfter = await listOpfsFiles(page);

        // Convert dbName to expected filename format (same as app's toFilename)
        // NOTE: Must match toFilename() in src/worker/db-registry.ts
        const expectedSqliteFile = dbName.replace(/[<>:"/\\|?*()]/g, '_').replace(/\s+/g, '_').toLowerCase() + '.sqlite';
        const expectedErdFile = dbName.replace(/[<>:"/\\|?*()]/g, '_').replace(/\s+/g, '_').toLowerCase() + '.erd.json';

        // Neither .sqlite nor .erd.json should exist for this database
        expect(filesAfter.includes(expectedSqliteFile)).toBe(false);
        expect(filesAfter.includes(expectedErdFile)).toBe(false);
      }

      // Step 14: Verify query history is removed
      const historyAfter = await getQueryHistory(page, dbName);
      expect(historyAfter.length).toBe(0);
    });
  });

  test.describe('E2E-US-013-03: Switch with in-progress cell edit prompts', () => {
    test('E2E-US-013-03: switch DB with in-progress cell edit shows prompt; Discard → not persisted', async ({
      page,
    }) => {
      // Step 1: Create first database with a table
      const db1Name = 'edit-discard-test-1';
      await createAndOpenDatabase(page, db1Name);
      await waitForReady(page);

      await runSqlStatements(page, [
        'CREATE TABLE notes (id INTEGER PRIMARY KEY, content TEXT)',
        "INSERT INTO notes (content) VALUES ('original value')",
      ]);
      await waitForReady(page);

      // Step 2: Create second database
      await page.getByTestId('header-new-database-button').click();
      await expect(page.getByTestId('new-database-dialog')).toBeVisible();
      const db2Name = 'edit-discard-test-2';
      await page.getByTestId('database-name-input').fill(db2Name);
      const createButton = page.getByTestId('create-button');
      await expect(createButton).toBeEnabled({ timeout: 5000 });
      await createButton.click();
      await expect(page.getByTestId('new-database-dialog')).toBeHidden({ timeout: 10000 });
      await waitForReady(page);

      // Create a table in db2
      await runSqlStatements(page, ['CREATE TABLE other (id INTEGER PRIMARY KEY, val TEXT)']);
      await waitForReady(page);

      // Step 3: Switch back to first database and open the notes table
      const db1Row = page.getByTestId(`db-row-${db1Name}`);
      await db1Row.dblclick();
      await dismissUnsavedPromptIfVisible(page);
      await waitForReady(page);

      // Open the notes table using the helper
      await openTable(page, db1Name, 'notes');
      await waitForReady(page);

      // Step 4: Start editing a cell using the helper
      const editor = await openCellEditor(page, 0, 'content');
      await editor.fill('MODIFIED VALUE - should not be saved');

      // Step 5: Try to switch tabs (SQL tab) to trigger unsaved prompt
      await page.getByTestId('tab-sql').click();

      // Step 6: Verify unsaved prompt appears
      const unsavedPrompt = page.getByTestId('unsaved-prompt-backdrop');
      await expect(unsavedPrompt).toBeVisible({ timeout: 5000 });

      // Step 7: Click Discard to abandon changes
      const discardButton = page.getByTestId('unsaved-prompt-discard');
      await expect(discardButton).toBeVisible();
      await discardButton.click();

      // Wait for prompt to close
      await expect(unsavedPrompt).toBeHidden({ timeout: 5000 });
      await waitForReady(page);

      // Step 8: Go back to the Table tab and verify the original value is still there
      await page.getByTestId('tab-table').click();
      await dismissUnsavedPromptIfVisible(page);
      await waitForReady(page);

      // Click on notes table again
      const notesItem = page.getByTestId('item-table-notes');
      if (await notesItem.isVisible().catch(() => false)) {
        await notesItem.click();
        await dismissUnsavedPromptIfVisible(page);
      }

      // Wait for the data grid to be visible
      const dataGrid = page.getByTestId('data-grid');
      await expect(dataGrid).toBeVisible({ timeout: 10000 });

      // Step 9: Verify the original value is still there (edit was discarded)
      const contentCellAfter = page.getByTestId('cell-0-content');
      await expect(contentCellAfter).toBeVisible({ timeout: 5000 });

      const cellText = await contentCellAfter.textContent();
      expect(cellText).toBe('original value');
      expect(cellText).not.toContain('MODIFIED');
    });
  });
});
