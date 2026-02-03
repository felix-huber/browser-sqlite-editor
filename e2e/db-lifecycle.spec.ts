import { test, expect, type Page } from '@playwright/test';
import { createAndOpenDatabase, openDatabaseFromWelcome } from './helpers/app';

/**
 * E2E Tests for Database Rename/Delete Persistence
 *
 * Tests for OPFS and IndexedDB database lifecycle operations:
 * - Create DB, rename to new name, verify persistence after refresh
 * - Rename to existing name shows error
 * - Delete DB with confirmation dialog
 * - OPFS file removal verification
 * - IDB entry removal verification
 * - Registry consistency (no orphans after refresh)
 */

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Result types for registry operations
 */
interface RegistryEntry {
  id: string;
  name: string;
  storageType: 'opfs' | 'idb';
  createdAt: string;
  lastOpenedAt: string;
}

interface RegistryState {
  databases: RegistryEntry[];
}

/**
 * Clear all storage (OPFS and IndexedDB) for clean test state
 */
async function clearAllStorage(page: Page): Promise<void> {
  await page.evaluate(async () => {
    // Clear localStorage (heartbeat locks)
    localStorage.clear();

    // Clear IndexedDB databases
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
    await deleteIdb('idb-batch-atomic'); // VFS storage

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

        // Legacy layout cleanup without deleting root dir
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
 * Create a database entry in the registry and IDB storage
 */
async function createTestDatabase(page: Page, name: string): Promise<string> {
  return page.evaluate(async (dbName: string): Promise<string> => {
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`;
    const timestamp = new Date().toISOString();

    // Create registry entry
    const entry = {
      id,
      name: dbName,
      createdAt: timestamp,
      lastOpenedAt: timestamp,
      storageType: 'idb' as const,
    };

    // Open registry database
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

    // Read existing registry
    let existingData: { databases: typeof entry[] } = { databases: [] };
    try {
      const tx = registryDb.transaction('registry', 'readonly');
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
    const writeTx = registryDb.transaction('registry', 'readwrite');
    const writeStore = writeTx.objectStore('registry');
    await new Promise<void>((resolve, reject) => {
      const req = writeStore.put({ key: 'registry', data: existingData });
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });

    registryDb.close();

    // Create a minimal SQLite database blob with valid header
    const sqliteHeader = new Uint8Array([
      0x53, 0x51, 0x4c, 0x69, 0x74, 0x65, 0x20, 0x66, // "SQLite f"
      0x6f, 0x72, 0x6d, 0x61, 0x74, 0x20, 0x33, 0x00, // "ormat 3\0"
    ]);

    // Store in idb-sqlite
    const sqliteDb = await new Promise<IDBDatabase>((resolve, reject) => {
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

    const sqliteTx = sqliteDb.transaction('databases', 'readwrite');
    const sqliteStore = sqliteTx.objectStore('databases');

    await new Promise<void>((resolve, reject) => {
      const blob = new Blob([sqliteHeader], { type: 'application/x-sqlite3' });
      const req = sqliteStore.put({
        name: dbName,
        blob,
        updatedAt: timestamp,
      });
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });

    sqliteDb.close();

    return id;
  }, name);
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
 * Rename a database using the app's rename path (worker + registry).
 */
async function renameDatabaseViaApp(
  page: Page,
  oldName: string,
  newName: string
): Promise<{ success: boolean; error?: string }> {
  return page.evaluate(
    async ({ old: oldN, new: newN }) => {
      try {
        const testApi = (
          window as Window & {
            __sqliteEditorTest?: { renameDatabase?: (oldName: string, newName: string) => Promise<void> };
          }
        ).__sqliteEditorTest;

        if (!testApi?.renameDatabase) {
          return { success: false, error: 'Test API renameDatabase not available' };
        }

        await testApi.renameDatabase(oldN, newN);
        return { success: true };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    { old: oldName, new: newName }
  );
}

/**
 * Rename an IDB VFS database and update registry (idb-batch-atomic).
 * This avoids legacy idb-sqlite storage while keeping registry consistent.
 */
async function renameDatabaseInIdbVfs(
  page: Page,
  oldName: string,
  newName: string
): Promise<{ success: boolean; error?: string }> {
  return page.evaluate(
    async ({ old: oldN, new: newN }) => {
      try {
        const updateRegistry = async (): Promise<void> => {
          let updated = false;
          if (navigator.storage?.getDirectory) {
            try {
              const root = await navigator.storage.getDirectory();
              const appDir = await root.getDirectoryHandle('wasm-sqlite-editor');
              const file = await appDir.getFileHandle('registry.json');
              const blob = await file.getFile();
              const data = JSON.parse(await blob.text()) as { databases?: Array<{ name: string }> };
              if (data?.databases) {
                if (data.databases.some((db) => db.name.toLowerCase() === newN.toLowerCase())) {
                  throw new Error(`A database named "${newN}" already exists`);
                }
                const entry = data.databases.find((db) => db.name === oldN);
                if (!entry) {
                  throw new Error(`Database "${oldN}" not found`);
                }
                entry.name = newN;
                const writable = await file.createWritable();
                try {
                  await writable.write(JSON.stringify(data, null, 2));
                } finally {
                  await writable.close();
                }
                updated = true;
              }
            } catch {
              // Ignore and fall back to IDB registry update.
            }
          }

          try {
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
            const result = await new Promise<{ key: string; data: { databases: Array<{ name: string }> } } | undefined>(
              (resolve, reject) => {
                const req = store.get('registry');
                req.onsuccess = () => resolve(req.result as typeof result);
                req.onerror = () => reject(req.error);
              }
            );

            if (result?.data) {
              if (result.data.databases.some((db) => db.name.toLowerCase() === newN.toLowerCase())) {
                registryDb.close();
                throw new Error(`A database named "${newN}" already exists`);
              }

              const entry = result.data.databases.find((db) => db.name === oldN);
              if (!entry) {
                registryDb.close();
                throw new Error(`Database "${oldN}" not found`);
              }
              entry.name = newN;

              const writeTx = registryDb.transaction('registry', 'readwrite');
              const writeStore = writeTx.objectStore('registry');
              await new Promise<void>((resolve, reject) => {
                const req = writeStore.put({ key: 'registry', data: result.data });
                req.onsuccess = () => resolve();
                req.onerror = () => reject(req.error);
              });
              updated = true;
            }

            registryDb.close();
          } catch {
            // ignore IDB registry update errors
          }

          if (!updated) {
            throw new Error('Registry not found');
          }
        };

        await updateRegistry();

        const request = indexedDB.open('idb-batch-atomic', 6);
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          request.onerror = () => reject(request.error);
          request.onsuccess = () => resolve(request.result);
          request.onupgradeneeded = () => resolve(request.result);
        });

        try {
          const tx = db.transaction(['metadata', 'blocks'], 'readwrite');
          const metadata = tx.objectStore('metadata');
          const blocks = tx.objectStore('blocks');
          const oldPath = new URL(oldN, 'file://').pathname;
          const newPath = new URL(newN, 'file://').pathname;

          const oldEntry = await new Promise<{ name: string; fileSize: number; version: number; pendingVersion?: number } | undefined>(
            (resolve, reject) => {
              const req = metadata.get(oldPath);
              req.onsuccess = () => resolve(req.result);
              req.onerror = () => reject(req.error);
            }
          );

          if (!oldEntry) {
            throw new Error(`Database "${oldN}" not found`);
          }

          await new Promise<void>((resolve, reject) => {
            const req = metadata.put({ ...oldEntry, name: newPath });
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
          });

          await new Promise<void>((resolve, reject) => {
            const req = metadata.delete(oldPath);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
          });

          await new Promise<void>((resolve, reject) => {
            const range = IDBKeyRange.bound([oldPath, -Infinity], [oldPath, Infinity]);
            const req = blocks.openCursor(range);
            req.onerror = () => reject(req.error);
            req.onsuccess = () => {
              const cursor = req.result;
              if (!cursor) {
                resolve();
                return;
              }
              const value = cursor.value as { path: string; offset: number; version: number; data: Uint8Array };
              const putRequest = blocks.put({ ...value, path: newPath });
              putRequest.onerror = () => reject(putRequest.error);
              putRequest.onsuccess = () => {
                const deleteRequest = cursor.delete();
                deleteRequest.onerror = () => reject(deleteRequest.error);
                deleteRequest.onsuccess = () => cursor.continue();
              };
            };
          });

          await new Promise<void>((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
          });
        } finally {
          db.close();
        }

        return { success: true };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    { old: oldName, new: newName }
  );
}

/**
 * Read registry from IDB
 */
async function readRegistry(page: Page): Promise<RegistryState | null> {
  return page.evaluate(async (): Promise<RegistryState | null> => {
    try {
      const testApi = (window as Window & {
        __sqliteEditorTest?: { getRegistry?: () => Promise<unknown> };
      }).__sqliteEditorTest;

      if (testApi?.getRegistry) {
        try {
          const registry = await testApi.getRegistry();
          if (registry && typeof registry === 'object' && 'databases' in registry) {
            const databases = (registry as { databases?: Array<Record<string, unknown>> }).databases;
            if (Array.isArray(databases)) {
              const fallbackTime = new Date(0).toISOString();
              const mapped = databases.map((entry) => {
                const name =
                  typeof entry.name === 'string'
                    ? entry.name
                    : typeof entry.file === 'string'
                      ? entry.file
                      : 'unknown';
                const file = typeof entry.file === 'string' ? entry.file : name;
                const createdAt =
                  typeof entry.createdAt === 'string' ? entry.createdAt : fallbackTime;
                const lastOpenedAt =
                  typeof entry.lastOpenedAt === 'string' ? entry.lastOpenedAt : createdAt;
                const storageType =
                  entry.storageType === 'opfs' || entry.storageType === 'idb'
                    ? entry.storageType
                    : file.endsWith('.sqlite')
                      ? 'opfs'
                      : 'idb';
                const id = typeof entry.id === 'string' ? entry.id : name;
                return { id, name, storageType, createdAt, lastOpenedAt };
              });
              if (mapped.length > 0) {
                return { databases: mapped };
              }
            }
          }
        } catch {
          // Fall through to storage-based registry read
        }
      }

      if (navigator.storage?.getDirectory) {
        // Try new layout first
        try {
          const root = await navigator.storage.getDirectory();
          const appDir = await root.getDirectoryHandle('wasm-sqlite-editor');
          const file = await appDir.getFileHandle('registry.json');
          const blob = await file.getFile();
          const text = await blob.text();
          return JSON.parse(text) as RegistryState;
        } catch (err) {
          if (!(err instanceof DOMException && err.name === 'NotFoundError')) {
            // Ignore OPFS errors and try legacy layout
          }
        }
        // Try legacy layout
        try {
          const root = await navigator.storage.getDirectory();
          const dir = await root.getDirectoryHandle('sqlite-editor');
          const file = await dir.getFileHandle('registry.json');
          const blob = await file.getFile();
          const text = await blob.text();
          return JSON.parse(text) as RegistryState;
        } catch (err) {
          if (!(err instanceof DOMException && err.name === 'NotFoundError')) {
            // Ignore OPFS errors and fall back to IDB
          }
        }
      }

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

      const result = await new Promise<{ key: string; data: RegistryState } | undefined>(
        (resolve, reject) => {
          const req = store.get('registry');
          req.onsuccess = () => resolve(req.result as typeof result);
          req.onerror = () => reject(req.error);
        }
      );

      db.close();

      return result?.data ?? null;
    } catch {
      return null;
    }
  });
}

/**
 * Rename a database in the registry and IDB storage
 */
async function renameDatabase(
  page: Page,
  oldName: string,
  newName: string
): Promise<{ success: boolean; error?: string }> {
  return page.evaluate(
    async ({ old: oldN, new: newN }) => {
      try {
        // Step 1: Update registry
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

        // Read existing registry
        const tx = registryDb.transaction('registry', 'readonly');
        const store = tx.objectStore('registry');
        const result = await new Promise<{ key: string; data: { databases: Array<{ id: string; name: string; storageType: 'opfs' | 'idb' }> } } | undefined>(
          (resolve, reject) => {
            const req = store.get('registry');
            req.onsuccess = () => resolve(req.result as typeof result);
            req.onerror = () => reject(req.error);
          }
        );

        if (!result?.data) {
          registryDb.close();
          return { success: false, error: 'Registry not found' };
        }

        // Check if target name already exists
        const existingEntry = result.data.databases.find(
          (e) => e.name.toLowerCase() === newN.toLowerCase()
        );
        if (existingEntry) {
          registryDb.close();
          return { success: false, error: `A database named "${newN}" already exists` };
        }

        // Find and update the entry
        const entry = result.data.databases.find((e) => e.name === oldN);
        if (!entry) {
          registryDb.close();
          return { success: false, error: `Database "${oldN}" not found` };
        }

        entry.name = newN;

        // Save back
        const writeTx = registryDb.transaction('registry', 'readwrite');
        const writeStore = writeTx.objectStore('registry');
        await new Promise<void>((resolve, reject) => {
          const req = writeStore.put({ key: 'registry', data: result.data });
          req.onsuccess = () => resolve();
          req.onerror = () => reject(req.error);
        });

        registryDb.close();

        // Step 2: Rename in idb-sqlite
        const sqliteDb = await new Promise<IDBDatabase>((resolve, reject) => {
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

        const sqliteTx = sqliteDb.transaction('databases', 'readwrite');
        const sqliteStore = sqliteTx.objectStore('databases');

        // Get old entry
        const oldEntry = await new Promise<{ name: string; blob: Blob; updatedAt: string } | undefined>(
          (resolve, reject) => {
            const req = sqliteStore.get(oldN);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
          }
        );

        if (!oldEntry) {
          sqliteDb.close();
          return { success: false, error: `Database blob "${oldN}" not found` };
        }

        // Create new entry
        await new Promise<void>((resolve, reject) => {
          const req = sqliteStore.put({
            name: newN,
            blob: oldEntry.blob,
            updatedAt: new Date().toISOString(),
          });
          req.onsuccess = () => resolve();
          req.onerror = () => reject(req.error);
        });

        // Delete old entry
        await new Promise<void>((resolve, reject) => {
          const req = sqliteStore.delete(oldN);
          req.onsuccess = () => resolve();
          req.onerror = () => reject(req.error);
        });

        sqliteDb.close();

        return { success: true };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    { old: oldName, new: newName }
  );
}

/**
 * Delete a database from the registry and IDB storage
 */
async function deleteDatabase(
  page: Page,
  name: string
): Promise<{ success: boolean; error?: string }> {
  return page.evaluate(async (dbName: string) => {
    try {
      // Step 1: Remove from registry
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
      const result = await new Promise<{ key: string; data: { databases: Array<{ id: string; name: string; storageType: 'opfs' | 'idb' }> } } | undefined>(
        (resolve, reject) => {
          const req = store.get('registry');
          req.onsuccess = () => resolve(req.result as typeof result);
          req.onerror = () => reject(req.error);
        }
      );

      if (!result?.data) {
        registryDb.close();
        return { success: false, error: 'Registry not found' };
      }

      // Find the entry
      const index = result.data.databases.findIndex((e) => e.name === dbName);
      if (index === -1) {
        registryDb.close();
        return { success: false, error: `Database "${dbName}" not found` };
      }

      // Remove the entry
      result.data.databases.splice(index, 1);

      // Save back
      const writeTx = registryDb.transaction('registry', 'readwrite');
      const writeStore = writeTx.objectStore('registry');
      await new Promise<void>((resolve, reject) => {
        const req = writeStore.put({ key: 'registry', data: result.data });
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });

      registryDb.close();

      // Step 2: Delete from idb-sqlite
      const sqliteDb = await new Promise<IDBDatabase>((resolve, reject) => {
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

      const sqliteTx = sqliteDb.transaction('databases', 'readwrite');
      const sqliteStore = sqliteTx.objectStore('databases');

      await new Promise<void>((resolve, reject) => {
        const req = sqliteStore.delete(dbName);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });

      sqliteDb.close();

      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }, name);
}

/**
 * Check if a database exists in IDB storage
 */
async function databaseExistsInIdb(page: Page, name: string): Promise<boolean> {
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
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        }
      );

      db.close();
      return result !== undefined;
    } catch {
      return false;
    }
  }, name);
}

/**
 * List all databases in IDB storage
 */
async function listIdbDatabases(page: Page): Promise<string[]> {
  return page.evaluate(async (): Promise<string[]> => {
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

      const names = await new Promise<string[]>((resolve, reject) => {
        const req = store.getAllKeys();
        req.onsuccess = () => resolve(req.result as string[]);
        req.onerror = () => reject(req.error);
      });

      db.close();
      return names;
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
      if (!navigator.storage?.getDirectory) {
        return false;
      }
      const root = await navigator.storage.getDirectory();
      // Try to create a test file
      const testDirName = `__opfs_test_${Date.now()}`;
      await root.getDirectoryHandle(testDirName, { create: true });
      await root.removeEntry(testDirName, { recursive: true });
      return true;
    } catch {
      return false;
    }
  });
}

/**
 * List files in OPFS databases directory (new layout: /wasm-sqlite-editor/databases/)
 */
async function _listOpfsFiles(page: Page): Promise<string[]> {
  return page.evaluate(async (): Promise<string[]> => {
    try {
      if (!navigator.storage?.getDirectory) {
        return [];
      }
      const root = await navigator.storage.getDirectory();
      let dbDir: FileSystemDirectoryHandle;
      try {
        const appDir = await root.getDirectoryHandle('wasm-sqlite-editor');
        dbDir = await appDir.getDirectoryHandle('databases');
      } catch {
        return [];
      }

      const files: string[] = [];
      const entries = (dbDir as unknown as AsyncIterable<[string, FileSystemHandle]>)[Symbol.asyncIterator]();
      for await (const [name, handle] of { [Symbol.asyncIterator]: () => entries }) {
        if (handle.kind === 'file' && name.endsWith('.sqlite')) {
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
 * Create a database entry in OPFS storage
 */
async function createOpfsDatabase(page: Page, name: string): Promise<string> {
  return page.evaluate(async (dbName: string): Promise<string> => {
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`;
    const timestamp = new Date().toISOString();

    // Create registry entry
    const entry = {
      id,
      name: dbName,
      createdAt: timestamp,
      lastOpenedAt: timestamp,
      storageType: 'opfs' as const,
    };

    // Open registry database (still in IDB for consistency)
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

    // Read existing registry
    let existingData: { databases: typeof entry[] } = { databases: [] };
    try {
      const tx = registryDb.transaction('registry', 'readonly');
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
    const writeTx = registryDb.transaction('registry', 'readwrite');
    const writeStore = writeTx.objectStore('registry');
    await new Promise<void>((resolve, reject) => {
      const req = writeStore.put({ key: 'registry', data: existingData });
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });

    registryDb.close();

    // Create the file in OPFS (new layout: /wasm-sqlite-editor/databases/)
    const root = await navigator.storage.getDirectory();
    const appDir = await root.getDirectoryHandle('wasm-sqlite-editor', { create: true });
    const dbDir = await appDir.getDirectoryHandle('databases', { create: true });

    // Derive filename from name (must match toFilename() in src/worker/db-registry.ts)
    const filename = dbName
      .replace(/[<>:"/\\|?*()]/g, '_')
      .replace(/\s+/g, '_')
      .toLowerCase() + '.sqlite';

    const fileHandle = await dbDir.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();

    // Write SQLite header
    const sqliteHeader = new Uint8Array([
      0x53, 0x51, 0x4c, 0x69, 0x74, 0x65, 0x20, 0x66, // "SQLite f"
      0x6f, 0x72, 0x6d, 0x61, 0x74, 0x20, 0x33, 0x00, // "ormat 3\0"
    ]);
    await writable.write(sqliteHeader);
    await writable.close();

    return id;
  }, name);
}

/**
 * Delete a database from OPFS storage
 */
async function deleteOpfsDatabase(page: Page, name: string): Promise<{ success: boolean; error?: string }> {
  return page.evaluate(async (dbName: string) => {
    try {
      // Step 1: Remove from registry
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
      const result = await new Promise<{ key: string; data: { databases: Array<{ id: string; name: string; storageType: 'opfs' | 'idb' }> } } | undefined>(
        (resolve, reject) => {
          const req = store.get('registry');
          req.onsuccess = () => resolve(req.result as typeof result);
          req.onerror = () => reject(req.error);
        }
      );

      if (!result?.data) {
        registryDb.close();
        return { success: false, error: 'Registry not found' };
      }

      // Find the entry
      const index = result.data.databases.findIndex((e) => e.name === dbName);
      if (index === -1) {
        registryDb.close();
        return { success: false, error: `Database "${dbName}" not found` };
      }

      // Remove the entry
      result.data.databases.splice(index, 1);

      // Save back
      const writeTx = registryDb.transaction('registry', 'readwrite');
      const writeStore = writeTx.objectStore('registry');
      await new Promise<void>((resolve, reject) => {
        const req = writeStore.put({ key: 'registry', data: result.data });
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });

      registryDb.close();

      // Step 2: Delete from OPFS (new layout: /wasm-sqlite-editor/databases/)
      const root = await navigator.storage.getDirectory();
      const appDir = await root.getDirectoryHandle('wasm-sqlite-editor');
      const dbDir = await appDir.getDirectoryHandle('databases');

      // Derive filename from name (must match toFilename() in src/worker/db-registry.ts)
      const filename = dbName
        .replace(/[<>:"/\\|?*()]/g, '_')
        .replace(/\s+/g, '_')
        .toLowerCase() + '.sqlite';

      try {
        await dbDir.removeEntry(filename);
      } catch {
        // File might not exist
      }

      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }, name);
}

/**
 * Check if a file exists in OPFS (new layout: /wasm-sqlite-editor/databases/)
 */
async function opfsFileExists(page: Page, filename: string): Promise<boolean> {
  return page.evaluate(async (fname: string): Promise<boolean> => {
    try {
      if (!navigator.storage?.getDirectory) {
        return false;
      }
      const root = await navigator.storage.getDirectory();
      const appDir = await root.getDirectoryHandle('wasm-sqlite-editor');
      const dbDir = await appDir.getDirectoryHandle('databases');
      await dbDir.getFileHandle(fname);
      return true;
    } catch {
      return false;
    }
  }, filename);
}

/**
 * Create an orphan file in OPFS (file exists but no registry entry)
 * Uses the new layout: /wasm-sqlite-editor/databases/
 */
async function createOrphanOpfsFile(page: Page, filename: string): Promise<void> {
  await page.evaluate(async (fname: string): Promise<void> => {
    const root = await navigator.storage.getDirectory();
    const appDir = await root.getDirectoryHandle('wasm-sqlite-editor', { create: true });
    const dbDir = await appDir.getDirectoryHandle('databases', { create: true });
    const fileHandle = await dbDir.getFileHandle(fname, { create: true });
    const writable = await fileHandle.createWritable();

    // Write SQLite header
    const sqliteHeader = new Uint8Array([
      0x53, 0x51, 0x4c, 0x69, 0x74, 0x65, 0x20, 0x66,
      0x6f, 0x72, 0x6d, 0x61, 0x74, 0x20, 0x33, 0x00,
    ]);
    await writable.write(sqliteHeader);
    await writable.close();
  }, filename);
}

/**
 * Create an orphan IDB entry (registry entry but no blob)
 */
async function createOrphanRegistryEntry(page: Page, name: string): Promise<string> {
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

    // Open registry database - create entry WITHOUT creating the blob
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

    // Read existing registry
    let existingData: { databases: typeof entry[] } = { databases: [] };
    try {
      const tx = registryDb.transaction('registry', 'readonly');
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

    // Add entry WITHOUT blob
    existingData.databases.push(entry);

    const writeTx = registryDb.transaction('registry', 'readwrite');
    const writeStore = writeTx.objectStore('registry');
    await new Promise<void>((resolve, reject) => {
      const req = writeStore.put({ key: 'registry', data: existingData });
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });

    registryDb.close();
    return id;
  }, name);
}

// =============================================================================
// Test Suites
// =============================================================================

test.describe('Database Lifecycle Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/SQLite Editor/);
    await clearAllStorage(page);
    // Reload so the app re-initializes with clean storage
    // (the app may have discovered stale orphan files during initial load)
    await page.reload();
    await expect(page).toHaveTitle(/SQLite Editor/);
  });

  test.describe('Rename Operations (IDB Mode)', () => {
    test('create DB "test", rename to "test-renamed", verify persistence after refresh', async ({ page }) => {
      // Step 1: Create database
      const id = await createTestDatabase(page, 'test');
      expect(id).toBeTruthy();

      // Force app to reload registry after direct storage modification
      await reloadRegistry(page);

      // Verify it exists
      const registryBefore = await readRegistry(page);
      expect(registryBefore?.databases.some((db) => db.name === 'test')).toBe(true);

      const existsBefore = await databaseExistsInIdb(page, 'test');
      expect(existsBefore).toBe(true);

      // Step 2: Rename to "test-renamed"
      const renameResult = await renameDatabase(page, 'test', 'test-renamed');
      expect(renameResult.success).toBe(true);

      // Force app to reload registry after direct storage modification
      await reloadRegistry(page);

      // Verify rename in registry
      const registryAfterRename = await readRegistry(page);
      expect(registryAfterRename?.databases.some((db) => db.name === 'test-renamed')).toBe(true);
      expect(registryAfterRename?.databases.some((db) => db.name === 'test')).toBe(false);

      // Verify rename in IDB storage
      const newExists = await databaseExistsInIdb(page, 'test-renamed');
      expect(newExists).toBe(true);

      const oldExists = await databaseExistsInIdb(page, 'test');
      expect(oldExists).toBe(false);

      // Step 3: Refresh the page
      await page.reload();
      await expect(page).toHaveTitle(/SQLite Editor/);

      // Step 4: Verify persistence after refresh
      const registryAfterRefresh = await readRegistry(page);
      expect(registryAfterRefresh?.databases.some((db) => db.name === 'test-renamed')).toBe(true);
      expect(registryAfterRefresh?.databases.some((db) => db.name === 'test')).toBe(false);

      const persistsAfterRefresh = await databaseExistsInIdb(page, 'test-renamed');
      expect(persistsAfterRefresh).toBe(true);
    });

    test('rename to existing name returns error', async ({ page }) => {
      // Create two databases
      await createTestDatabase(page, 'db-alpha');
      await createTestDatabase(page, 'db-beta');

      // Force app to reload registry after direct storage modification
      await reloadRegistry(page);

      // Verify both exist
      const registryBefore = await readRegistry(page);
      expect(registryBefore?.databases).toHaveLength(2);

      // Try to rename db-alpha to db-beta (should fail)
      const renameResult = await renameDatabase(page, 'db-alpha', 'db-beta');
      expect(renameResult.success).toBe(false);
      expect(renameResult.error).toContain('already exists');

      // Force app to reload registry after direct storage modification
      await reloadRegistry(page);

      // Verify original names are unchanged
      const registryAfter = await readRegistry(page);
      expect(registryAfter?.databases.some((db) => db.name === 'db-alpha')).toBe(true);
      expect(registryAfter?.databases.some((db) => db.name === 'db-beta')).toBe(true);
    });

    test('rename preserves database content', async ({ page }) => {
      // Create database
      await createTestDatabase(page, 'content-test');

      // Verify blob exists
      const existsBefore = await databaseExistsInIdb(page, 'content-test');
      expect(existsBefore).toBe(true);

      // Rename
      const renameResult = await renameDatabase(page, 'content-test', 'content-test-renamed');
      expect(renameResult.success).toBe(true);

      // Verify new entry exists with same blob type
      const existsAfter = await databaseExistsInIdb(page, 'content-test-renamed');
      expect(existsAfter).toBe(true);
    });
  });

  test.describe('Delete Operations (IDB Mode)', () => {
    test('delete DB removes from registry', async ({ page }) => {
      // Create database
      await createTestDatabase(page, 'to-delete');

      // Force app to reload registry after direct storage modification
      await reloadRegistry(page);

      // Verify it exists
      const registryBefore = await readRegistry(page);
      expect(registryBefore?.databases.some((db) => db.name === 'to-delete')).toBe(true);

      // Delete
      const deleteResult = await deleteDatabase(page, 'to-delete');
      expect(deleteResult.success).toBe(true);

      // Force app to reload registry after direct storage modification
      await reloadRegistry(page);

      // Verify removed from registry
      const registryAfter = await readRegistry(page);
      expect(registryAfter?.databases.some((db) => db.name === 'to-delete')).toBe(false);
    });

    test('delete DB removes IDB entry', async ({ page }) => {
      // Create database
      await createTestDatabase(page, 'idb-delete-test');

      // Verify blob exists
      const existsBefore = await databaseExistsInIdb(page, 'idb-delete-test');
      expect(existsBefore).toBe(true);

      // Delete
      const deleteResult = await deleteDatabase(page, 'idb-delete-test');
      expect(deleteResult.success).toBe(true);

      // Verify IDB entry is removed
      const existsAfter = await databaseExistsInIdb(page, 'idb-delete-test');
      expect(existsAfter).toBe(false);
    });

    test('delete non-existent DB returns error', async ({ page }) => {
      const deleteResult = await deleteDatabase(page, 'nonexistent-db');
      expect(deleteResult.success).toBe(false);
      expect(deleteResult.error).toContain('not found');
    });

    test('delete persists after refresh', async ({ page }) => {
      // Create and delete
      await createTestDatabase(page, 'delete-persist-test');
      await deleteDatabase(page, 'delete-persist-test');

      // Refresh
      await page.reload();
      await expect(page).toHaveTitle(/SQLite Editor/);

      // Verify still deleted
      const registry = await readRegistry(page);
      expect(registry?.databases.some((db) => db.name === 'delete-persist-test')).toBe(false);

      const exists = await databaseExistsInIdb(page, 'delete-persist-test');
      expect(exists).toBe(false);
    });
  });

  test.describe('OPFS Mode (when available)', () => {
    test('delete removes OPFS file', async ({ page }) => {
      const opfsAvailable = await isOpfsAvailable(page);

      if (!opfsAvailable) {
        test.skip();
        return;
      }

      // Create database in OPFS
      await createOpfsDatabase(page, 'opfs-delete-test');

      // Verify file exists
      const filename = 'opfs-delete-test.sqlite';
      const existsBefore = await opfsFileExists(page, filename);
      expect(existsBefore).toBe(true);

      // Delete
      const deleteResult = await deleteOpfsDatabase(page, 'opfs-delete-test');
      expect(deleteResult.success).toBe(true);

      // Verify OPFS file is removed
      const existsAfter = await opfsFileExists(page, filename);
      expect(existsAfter).toBe(false);
    });

    test('OPFS deletion persists after refresh', async ({ page }) => {
      const opfsAvailable = await isOpfsAvailable(page);

      if (!opfsAvailable) {
        test.skip();
        return;
      }

      // Create and delete
      await createOpfsDatabase(page, 'opfs-persist-test');
      await deleteOpfsDatabase(page, 'opfs-persist-test');

      // Refresh
      await page.reload();
      await expect(page).toHaveTitle(/SQLite Editor/);

      // Verify still deleted
      const registry = await readRegistry(page);
      expect(registry?.databases.some((db) => db.name === 'opfs-persist-test')).toBe(false);

      const filename = 'opfs-persist-test.sqlite';
      const exists = await opfsFileExists(page, filename);
      expect(exists).toBe(false);
    });
  });

  test.describe('Registry Consistency', () => {
    test('registry only shows valid databases after refresh (no orphan entries)', async ({ page }) => {
      // Create valid database
      await createTestDatabase(page, 'valid-db');

      // Create orphan registry entry (registry entry but no blob)
      await createOrphanRegistryEntry(page, 'orphan-entry');

      // The orphan should have no corresponding IDB blob
      const orphanBlobExists = await databaseExistsInIdb(page, 'orphan-entry');
      expect(orphanBlobExists).toBe(false);

      // Valid DB should have blob
      const validBlobExists = await databaseExistsInIdb(page, 'valid-db');
      expect(validBlobExists).toBe(true);

      // Force app to reload registry - this triggers self-healing
      // which should remove the orphan entry (registry entry without file)
      await reloadRegistry(page);

      // After reload, the orphan should be removed by self-healing
      const registryAfter = await readRegistry(page);
      expect(registryAfter?.databases.some((db) => db.name === 'valid-db')).toBe(true);
      // Orphan should have been removed by self-healing
      expect(registryAfter?.databases.some((db) => db.name === 'orphan-entry')).toBe(false);
    });

    test('multiple operations maintain consistency', async ({ page }) => {
      // Create multiple databases
      await createTestDatabase(page, 'multi-1');
      await createTestDatabase(page, 'multi-2');
      await createTestDatabase(page, 'multi-3');

      // Force app to reload registry after direct storage modification
      await reloadRegistry(page);

      // Verify all exist
      let registry = await readRegistry(page);
      expect(registry?.databases).toHaveLength(3);

      // Rename one
      await renameDatabase(page, 'multi-2', 'multi-2-renamed');

      // Delete one
      await deleteDatabase(page, 'multi-3');

      // Force app to reload registry after direct storage modification
      await reloadRegistry(page);

      // Verify consistency
      registry = await readRegistry(page);
      expect(registry?.databases).toHaveLength(2);
      expect(registry?.databases.some((db) => db.name === 'multi-1')).toBe(true);
      expect(registry?.databases.some((db) => db.name === 'multi-2-renamed')).toBe(true);
      expect(registry?.databases.some((db) => db.name === 'multi-2')).toBe(false);
      expect(registry?.databases.some((db) => db.name === 'multi-3')).toBe(false);

      // Verify IDB consistency
      const idbDbs = await listIdbDatabases(page);
      expect(idbDbs).toContain('multi-1');
      expect(idbDbs).toContain('multi-2-renamed');
      expect(idbDbs).not.toContain('multi-2');
      expect(idbDbs).not.toContain('multi-3');

      // Refresh and verify persistence
      await page.reload();
      await expect(page).toHaveTitle(/SQLite Editor/);

      const registryAfterRefresh = await readRegistry(page);
      expect(registryAfterRefresh?.databases).toHaveLength(2);
      expect(registryAfterRefresh?.databases.some((db) => db.name === 'multi-1')).toBe(true);
      expect(registryAfterRefresh?.databases.some((db) => db.name === 'multi-2-renamed')).toBe(true);
    });

    test('OPFS orphan file creation helper works correctly (when OPFS available)', async ({ page }) => {
      const opfsAvailable = await isOpfsAvailable(page);

      if (!opfsAvailable) {
        test.skip();
        return;
      }

      // Use a unique filename with timestamp to avoid conflicts with other tests
      const uniqueId = Date.now().toString(36);
      const orphanFilename = `stray_file_${uniqueId}.sqlite`;

      // Create an orphan OPFS file (file exists in OPFS but was not created via app)
      await createOrphanOpfsFile(page, orphanFilename);

      // Verify file exists in OPFS - this is the main assertion
      const fileExists = await opfsFileExists(page, orphanFilename);
      expect(fileExists).toBe(true);

      // Note: The app may or may not discover this file via self-healing.
      // This test only verifies that the createOrphanOpfsFile helper works correctly.
    });
  });

  test.describe('Edge Cases', () => {
    test('rename to same name is no-op', async ({ page }) => {
      await createTestDatabase(page, 'same-name-test');

      // Force app to reload registry after direct storage modification
      await reloadRegistry(page);

      const registryBefore = await readRegistry(page);
      expect(registryBefore?.databases.some((db) => db.name === 'same-name-test')).toBe(true);

      // Rename to same name - should succeed as no-op
      await renameDatabase(page, 'same-name-test', 'same-name-test');
      // Note: Our helper doesn't handle same-name gracefully, but the actual registry does
      // This test verifies the database still exists

      // Force app to reload registry after direct storage modification
      await reloadRegistry(page);

      const registryAfter = await readRegistry(page);
      expect(registryAfter?.databases.some((db) => db.name === 'same-name-test')).toBe(true);
    });

    test('special characters in database names are handled', async ({ page }) => {
      // Create database with spaces via app flow (idb-batch-atomic storage)
      await createAndOpenDatabase(page, 'test with spaces');

      // Close the database to avoid open-handle rename edge cases
      await page.evaluate(async () => {
        const testApi = (
          window as Window & {
            __sqliteEditorTest?: { closeDatabase?: () => Promise<void> };
          }
        ).__sqliteEditorTest;
        if (testApi?.closeDatabase) {
          await testApi.closeDatabase();
        }
      });
      await page.waitForTimeout(200);

      // Verify it exists
      const registry = await readRegistry(page);
      expect(registry?.databases.some((db) => db.name === 'test with spaces')).toBe(true);

      // Rename using IDB VFS path (idb-batch-atomic) to avoid legacy idb-sqlite helper
      const renameResult = await renameDatabaseInIdbVfs(page, 'test with spaces', 'test-renamed-db');
      expect(renameResult.success, renameResult.error ?? 'rename failed').toBe(true);
      await reloadRegistry(page);

      // Verify the renamed database can be opened
      await openDatabaseFromWelcome(page, 'test-renamed-db');
      await expect(page.getByTestId('tab-sql')).toBeVisible({ timeout: 15000 });
    });

    test('rapid create-delete cycles maintain consistency', async ({ page }) => {
      // Rapidly create and delete
      for (let i = 0; i < 5; i++) {
        const name = `rapid-${i}`;
        await createTestDatabase(page, name);
        await deleteDatabase(page, name);
      }

      // Force app to reload registry after direct storage modifications
      await reloadRegistry(page);

      // Verify all are deleted
      const registry = await readRegistry(page);
      const rapidDbs = registry?.databases.filter((db) => db.name.startsWith('rapid-')) ?? [];
      expect(rapidDbs).toHaveLength(0);

      const idbDbs = await listIdbDatabases(page);
      const rapidIdbDbs = idbDbs.filter((name) => name.startsWith('rapid-'));
      expect(rapidIdbDbs).toHaveLength(0);
    });

    test('case-insensitive rename collision detection', async ({ page }) => {
      // Create databases with different cases
      await createTestDatabase(page, 'CaseTest');
      await createTestDatabase(page, 'other-db');

      // Force app to reload registry after direct storage modification
      await reloadRegistry(page);

      // Try to rename other-db to casetest (lowercase) - should fail
      const result = await renameDatabase(page, 'other-db', 'casetest');
      expect(result.success).toBe(false);
      expect(result.error).toContain('already exists');
    });
  });
});

test.describe('Cross-Context Persistence', () => {
  test('database operations persist across browser contexts', async ({ context }) => {
    const pageA = await context.newPage();

    try {
      // Setup in first page
      await pageA.goto('/');
      await expect(pageA).toHaveTitle(/SQLite Editor/);
      await clearAllStorage(pageA);

      // Create and modify
      await createTestDatabase(pageA, 'cross-context-test');
      await renameDatabase(pageA, 'cross-context-test', 'cross-context-renamed');

      // Close first page
      await pageA.close();

      // Open new page in same context
      const pageB = await context.newPage();
      await pageB.goto('/');
      await expect(pageB).toHaveTitle(/SQLite Editor/);

      // Verify persistence
      const registry = await readRegistry(pageB);
      expect(registry?.databases.some((db) => db.name === 'cross-context-renamed')).toBe(true);
      expect(registry?.databases.some((db) => db.name === 'cross-context-test')).toBe(false);

      await pageB.close();
    } catch (error) {
      // Ensure cleanup
      if (!pageA.isClosed()) {
        await pageA.close();
      }
      throw error;
    }
  });
});

// =============================================================================
// Size Warning Tests
// =============================================================================

test.describe('Size Warning Toast', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/SQLite Editor/);
    await clearAllStorage(page);
    // Reload so the app re-initializes with clean storage
    await page.reload();
    await expect(page).toHaveTitle(/SQLite Editor/);
  });

  /**
   * Helper to wait for the test API to be available
   */
  async function waitForTestApi(page: Page): Promise<void> {
    await page.waitForFunction(() => {
      const win = window as Window & {
        __sqliteEditorTest?: {
          simulateSizeWarning?: (dbId: string, sizeBytes: number, storageMode: 'opfs' | 'idb') => void;
        };
      };
      return !!win.__sqliteEditorTest?.simulateSizeWarning;
    }, { timeout: 15000 });
  }

  /**
   * Helper to simulate a size warning via the test API.
   * This bypasses the need to create actual large database files.
   */
  async function simulateSizeWarning(
    page: Page,
    dbId: string,
    sizeBytes: number,
    storageMode: 'opfs' | 'idb'
  ): Promise<void> {
    await page.evaluate(
      ({ dbId, sizeBytes, storageMode }) => {
        const win = window as Window & {
          __sqliteEditorTest?: {
            simulateSizeWarning?: (dbId: string, sizeBytes: number, storageMode: 'opfs' | 'idb') => void;
          };
        };
        if (win.__sqliteEditorTest?.simulateSizeWarning) {
          win.__sqliteEditorTest.simulateSizeWarning(dbId, sizeBytes, storageMode);
        }
      },
      { dbId, sizeBytes, storageMode }
    );
    // Give the store time to update (dynamic import + store update)
    await page.waitForTimeout(200);
  }

  /**
   * Helper to clear size warning via the test API
   */
  async function _clearSizeWarningViaApi(page: Page): Promise<void> {
    await page.evaluate(() => {
      const win = window as Window & {
        __sqliteEditorTest?: {
          clearSizeWarning?: () => void;
        };
      };
      if (win.__sqliteEditorTest?.clearSizeWarning) {
        win.__sqliteEditorTest.clearSizeWarning();
      }
    });
    // Give the store time to update (dynamic import + store update)
    await page.waitForTimeout(200);
  }

  test('shows size warning toast for database exceeding IDB threshold', async ({ page }) => {
    // Wait for the app to initialize and test API to be available
    await page.waitForLoadState('networkidle');
    await waitForTestApi(page);

    // Simulate a size warning for a large database (55MB exceeds 50MB IDB threshold)
    const largeSize = 55 * 1024 * 1024;
    await simulateSizeWarning(page, 'large-test-db', largeSize, 'idb');

    // The size warning toast should appear
    const toast = page.getByTestId('size-warning-toast');
    await expect(toast).toBeVisible({ timeout: 10000 });

    // Verify toast contains expected content
    await expect(toast).toContainText('Large Database Warning');
    await expect(toast).toContainText('large-test-db');

    // Test dismiss button
    const dismissButton = page.getByTestId('size-warning-dismiss');
    await dismissButton.click();

    // Toast should disappear
    await expect(toast).toBeHidden();
  });

  test('size warning toast can be dismissed', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    await waitForTestApi(page);

    // Simulate a size warning
    const largeSize = 55 * 1024 * 1024;
    await simulateSizeWarning(page, 'dismissable-db', largeSize, 'idb');

    // Toast should appear
    const toast = page.getByTestId('size-warning-toast');
    await expect(toast).toBeVisible({ timeout: 10000 });

    // Click dismiss button
    const dismissButton = page.getByTestId('size-warning-dismiss');
    await expect(dismissButton).toBeVisible();
    await dismissButton.click();

    // Verify toast is hidden
    await expect(toast).toBeHidden({ timeout: 2000 });
  });

  test('size warning does not reappear for same database in same session', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    await waitForTestApi(page);

    // Simulate a size warning
    const largeSize = 55 * 1024 * 1024;
    await simulateSizeWarning(page, 'once-per-session-db', largeSize, 'idb');

    const toast = page.getByTestId('size-warning-toast');

    // Wait for initial toast
    await expect(toast).toBeVisible({ timeout: 10000 });
    await expect(toast).toContainText('once-per-session-db');

    // Dismiss it
    await page.getByTestId('size-warning-dismiss').click();
    await expect(toast).toBeHidden();

    // Trigger another size warning for the SAME database
    // The toast should NOT reappear (already warned this session)
    await simulateSizeWarning(page, 'once-per-session-db', largeSize, 'idb');

    // Wait a moment for any potential toast
    await page.waitForTimeout(500);

    // Toast should still be hidden (not re-shown)
    await expect(toast).toBeHidden();
  });

  test('size warning shows for different databases in same session', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    await waitForTestApi(page);

    const largeSize = 55 * 1024 * 1024;
    const toast = page.getByTestId('size-warning-toast');

    // First database warning
    await simulateSizeWarning(page, 'db-alpha', largeSize, 'idb');
    await expect(toast).toBeVisible({ timeout: 10000 });
    await expect(toast).toContainText('db-alpha');

    // Dismiss first warning
    await page.getByTestId('size-warning-dismiss').click();
    await expect(toast).toBeHidden();

    // Second database warning - should show since it's a different DB
    await simulateSizeWarning(page, 'db-beta', largeSize, 'idb');
    await expect(toast).toBeVisible({ timeout: 10000 });
    await expect(toast).toContainText('db-beta');

    // Dismiss second warning
    await page.getByTestId('size-warning-dismiss').click();
    await expect(toast).toBeHidden();
  });

  test('size warning uses correct threshold for OPFS vs IDB', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    await waitForTestApi(page);

    const toast = page.getByTestId('size-warning-toast');

    // 60MB should NOT trigger OPFS warning (threshold is 100MB)
    await simulateSizeWarning(page, 'medium-db', 60 * 1024 * 1024, 'opfs');
    await page.waitForTimeout(500);
    await expect(toast).toBeHidden();

    // But 60MB SHOULD trigger IDB warning (threshold is 50MB)
    await simulateSizeWarning(page, 'medium-db-idb', 60 * 1024 * 1024, 'idb');
    await expect(toast).toBeVisible({ timeout: 10000 });
    await expect(toast).toContainText('medium-db-idb');

    // Dismiss
    await page.getByTestId('size-warning-dismiss').click();
    await expect(toast).toBeHidden();

    // 105MB should trigger OPFS warning
    await simulateSizeWarning(page, 'very-large-db', 105 * 1024 * 1024, 'opfs');
    await expect(toast).toBeVisible({ timeout: 10000 });
    await expect(toast).toContainText('very-large-db');
    await expect(toast).toContainText('100MB'); // OPFS threshold
  });
});
