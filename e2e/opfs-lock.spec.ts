import { test, expect, type Page } from '@playwright/test';
import {
  createAndOpenDatabase,
  openDatabaseFromWelcome,
  openTable,
  runSql,
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
 */

// =============================================================================
// Test Helpers
// =============================================================================

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
  test('E2E-US-010-03: second tab read-only; close writer; retry → editable', async ({
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
      // Tab A: Setup clean state and create database as writer
      await pageA.goto('/');
      await expect(pageA).toHaveTitle(/SQLite Editor/);
      await clearAllStorage(pageA);
      await pageA.reload();

      // Tab A: Create DB with test table as writer
      await createAndOpenDatabase(pageA, dbName);
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
