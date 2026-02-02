import { test, expect, type Page } from '@playwright/test';
import {
  openDatabaseFromWelcome,
  openTable,
  runSql,
  ensureWelcomeScreen,
  waitForReady,
} from './helpers/app';

/**
 * OPFS Multi-Tab Web Locks E2E Tests
 *
 * Tests the single-writer guarantee using localStorage heartbeat fallback:
 * - Tab A acquires write lock, Tab B gets read-only mode
 * - When Tab A closes (heartbeat stops), Tab B can retry and become editable
 *
 * Note: Playwright tests use localStorage heartbeat fallback, not Web Locks API.
 * The lock becomes "stale" after 6 seconds without heartbeat updates.
 *
 * IMPORTANT: This test imports a SQLite file to ensure the database is stored in OPFS.
 * New databases created via the UI are stored in IndexedDB which is multi-tab safe
 * and doesn't use the locking mechanism.
 */

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Minimal SQLite database file header and structure.
 * This creates a valid empty SQLite database that can be imported.
 *
 * SQLite file format:
 * - First 16 bytes: "SQLite format 3\0" header
 * - Database page size (2 bytes at offset 16): typically 4096
 * - File format version (1 byte at offset 18): 1 for legacy, 2 for WAL
 * - Page count, etc.
 *
 * This is a minimal valid SQLite database (single page, no tables).
 */
function createMinimalSqliteFile(): Uint8Array {
  // SQLite file header - 100 bytes minimum
  // This is a minimal valid SQLite database with a single page
  const header = new Uint8Array(4096); // One page (typical page size)

  // "SQLite format 3\0" magic header
  const magic = 'SQLite format 3\0';
  for (let i = 0; i < magic.length; i++) {
    header[i] = magic.charCodeAt(i);
  }

  // Page size: 4096 (big-endian at offset 16-17)
  header[16] = 0x10; // 4096 >> 8
  header[17] = 0x00; // 4096 & 0xFF

  // File format write version: 1 (rollback journal)
  header[18] = 1;
  // File format read version: 1
  header[19] = 1;

  // Reserved space per page: 0
  header[20] = 0;

  // Maximum embedded payload fraction: 64
  header[21] = 64;
  // Minimum embedded payload fraction: 32
  header[22] = 32;
  // Leaf payload fraction: 32
  header[23] = 32;

  // File change counter: 1 (big-endian at offset 24-27)
  header[27] = 1;

  // Database size in pages: 1 (big-endian at offset 28-31)
  header[31] = 1;

  // First freelist trunk page: 0 (offset 32-35)
  // Total freelist pages: 0 (offset 36-39)

  // Schema cookie: 0 (offset 40-43)

  // Schema format number: 4 (offset 44-47)
  header[47] = 4;

  // Default page cache size: 0 (offset 48-51)
  // Largest root b-tree page: 0 (offset 52-55)

  // Text encoding: 1 = UTF-8 (offset 56-59)
  header[59] = 1;

  // User version: 0 (offset 60-63)
  // Incremental vacuum mode: 0 (offset 64-67)
  // Application ID: 0 (offset 68-71)

  // Reserved for expansion: zeros (offset 72-91)

  // Version valid for: same as file change counter (offset 92-95)
  header[95] = 1;

  // SQLite version number (offset 96-99): 3.39.0 = 3039000
  // 3039000 = 0x2E5E68
  header[96] = 0x00;
  header[97] = 0x2E;
  header[98] = 0x5E;
  header[99] = 0x68;

  // Page 1 content: B-tree page header for a leaf table b-tree page
  // Offset 100 is the start of the page content
  // B-tree page header:
  header[100] = 0x0D; // Page type: 13 = leaf table b-tree page
  header[101] = 0x00; // First freeblock offset (2 bytes): 0
  header[102] = 0x00;
  header[103] = 0x00; // Number of cells (2 bytes): 0
  header[104] = 0x00;
  header[105] = 0x10; // Cell content area offset (2 bytes): 4096 (end of page)
  header[106] = 0x00;
  header[107] = 0x00; // Fragmented free bytes: 0

  return header;
}

/**
 * Import a SQLite file to OPFS via file input.
 * This ensures the database is stored in OPFS (not IndexedDB) so locking applies.
 */
async function importSqliteToOpfs(page: Page, dbName: string): Promise<void> {
  await ensureWelcomeScreen(page);

  // Ensure OPFS directories exist
  await page.evaluate(async () => {
    if (navigator.storage?.getDirectory) {
      try {
        const root = await navigator.storage.getDirectory();
        const appDir = await root.getDirectoryHandle('wasm-sqlite-editor', { create: true });
        await appDir.getDirectoryHandle('databases', { create: true });
      } catch {
        // OPFS not available
      }
    }
  });

  // Wait for worker to be ready
  await page.waitForFunction(
    async () => {
      const api = (
        window as Window & { __sqliteEditorTest?: { getRegistry?: () => Promise<unknown> } }
      ).__sqliteEditorTest;
      if (!api?.getRegistry) return false;
      const registry = await api.getRegistry();
      return registry !== null;
    },
    { timeout: 15000 }
  );

  // Create a minimal SQLite file
  const sqliteBytes = createMinimalSqliteFile();

  // Find the hidden file input used by OpenDatabaseButton
  // Note: Chrome uses File System Access API which doesn't trigger filechooser event,
  // so we directly set files on the hidden input element
  const fileInput = page.getByTestId('open-database-file-input');

  // Set the file directly on the input element
  await fileInput.setInputFiles({
    name: `${dbName}.sqlite`,
    mimeType: 'application/x-sqlite3',
    buffer: Buffer.from(sqliteBytes),
  });

  // Wait for the database to be opened
  await waitForReady(page);
  await expect(page.getByTestId('tab-sql')).toBeVisible({ timeout: 15000 });
}

/**
 * Clear all storage for clean test state.
 */
async function clearAllStorage(page: Page): Promise<void> {
  await page.evaluate(async () => {
    // Clear localStorage (heartbeat locks)
    localStorage.clear();

    // Clear IndexedDB databases
    const deleteIdb = (name: string): Promise<void> => {
      return new Promise((resolve) => {
        const req = indexedDB.deleteDatabase(name);
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
        req.onblocked = () => resolve();
      });
    };

    // Known databases that might exist
    const knownDbs = [
      'sqlite-editor-registry',
      'idb-sqlite',
      'idb-batch-atomic',
    ];

    // Try to list all databases if available
    if (typeof indexedDB.databases === 'function') {
      try {
        const dbs = await indexedDB.databases();
        for (const db of dbs) {
          if (db.name) {
            await deleteIdb(db.name);
          }
        }
      } catch {
        for (const name of knownDbs) {
          await deleteIdb(name);
        }
      }
    } else {
      for (const name of knownDbs) {
        await deleteIdb(name);
      }
    }

    // Clear ALL OPFS directories
    try {
      if (navigator.storage?.getDirectory) {
        const root = await navigator.storage.getDirectory();
        const dirsToDelete: string[] = [];
        // @ts-expect-error - entries() is available
        for await (const [name, handle] of root.entries()) {
          if (handle.kind === 'directory') {
            dirsToDelete.push(name);
          }
        }
        for (const name of dirsToDelete) {
          try {
            await root.removeEntry(name, { recursive: true });
          } catch {
            // Ignore errors - directory might be locked
          }
        }
      }
    } catch {
      // OPFS not available
    }
  });
}

// =============================================================================
// Test Suite
// =============================================================================

test.describe('OPFS Multi-Tab Web Locks', () => {
  /**
   * NOTE: This test is skipped because the current implementation always uses
   * IndexedDB for database storage, not OPFS:
   * - New databases: Created in IDB (OPFSCoopSyncVFS can't create files)
   * - Imported databases: Stored in IDB (to avoid OPFS multi-tab conflicts during import)
   *
   * Since IDB is inherently multi-tab safe, the Web Locks mechanism is not needed
   * and not active for IDB databases. The test would need OPFS storage to verify
   * the locking behavior.
   *
   * See: src/worker/handlers/import-export.ts line 72-75
   * See: src/worker/handlers/registry.ts handleCreateDbRequest
   */
  test.skip('E2E-US-010-03: second tab read-only; close writer; retry → editable', async ({
    context,
  }) => {
    /**
     * This test verifies the complete multi-tab locking flow:
     * 1. Tab A acquires write lock and can write to database
     * 2. Tab B opens same database in read-only mode (due to lock)
     * 3. Tab A closes (heartbeat stops updating)
     * 4. Tab B waits for stale detection, then takes over
     * 5. Tab B can successfully write to database
     *
     * Uses localStorage heartbeat fallback since Web Locks are disabled in Playwright.
     * Lock becomes stale after 6s without heartbeat → stale warning appears → take over.
     */
    const pageA = await context.newPage();
    const pageB = await context.newPage();

    const dbName = 'opfs-lock-test';

    try {
      // Tab A: Setup clean state and import database as writer
      // IMPORTANT: We import a SQLite file (not create new) to ensure OPFS storage.
      // New databases use IndexedDB which is multi-tab safe and skips locking.
      await pageA.goto('/');
      await expect(pageA).toHaveTitle(/SQLite Editor/);
      await clearAllStorage(pageA);
      await pageA.reload();

      // Tab A: Import a SQLite file to OPFS (this enables locking)
      await importSqliteToOpfs(pageA, dbName);

      // Create test table and insert data
      await runSql(
        pageA,
        `CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT);
         INSERT INTO products (name) VALUES ('Widget');`
      );
      await openTable(pageA, dbName, 'products');

      // Verify Tab A can see the data it wrote
      await expect(pageA.getByText('Widget')).toBeVisible();

      // Tab B: Navigate and open same database (will be read-only due to lock)
      await pageB.goto('/');
      await openDatabaseFromWelcome(pageB, dbName);
      await openTable(pageB, dbName, 'products');

      // Tab B should be in read-only mode with banner visible
      await expect(pageB.getByTestId('read-only-banner')).toBeVisible();

      // Tab B should still see the data (read works in read-only mode)
      await expect(pageB.getByText('Widget')).toBeVisible();

      // Verify Tab B's table grid shows read-only state
      await expect(pageB.getByTestId('table-readonly')).toBeVisible();

      // Close Tab A (writer) - this stops the heartbeat updates
      await pageA.close();

      // Tab B: Wait for stale detection (heartbeat threshold is 6s, check interval is 1s)
      // The stale warning should appear once the heartbeat is detected as stale
      await expect(pageB.getByTestId('stale-warning')).toBeVisible({
        timeout: 15000,
      });

      // Tab B: Click "Take Over" button to steal the stale lock
      const takeOverButton = pageB.getByTestId('take-over-button');
      await expect(takeOverButton).toBeVisible();
      await takeOverButton.click();

      // Tab B should now have write access - read-only banner should be hidden
      await expect(pageB.getByTestId('read-only-banner')).toBeHidden({
        timeout: 15000,
      });

      // Verify Tab B is no longer in read-only state
      await expect(pageB.getByTestId('table-readonly')).toBeHidden();

      // Tab B should now be able to write - verify via SQL
      await runSql(
        pageB,
        `INSERT INTO products (name) VALUES ('Gadget after takeover');`
      );

      // Verify the new data is visible - refresh the table view
      await openTable(pageB, dbName, 'products');
      await expect(pageB.getByText('Gadget after takeover')).toBeVisible();

      // Also verify original data is still there
      await expect(pageB.getByText('Widget')).toBeVisible();
    } finally {
      await pageB.close();
    }
  });
});
