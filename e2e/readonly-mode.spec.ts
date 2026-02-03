/**
 * Read-only mode tests for multi-tab scenarios.
 * 
 * These tests verify that when two tabs open the same OPFS database,
 * the second tab opens in read-only mode.
 * 
 * IMPORTANT: This file uses @playwright/test directly (not custom fixtures)
 * because the clearStorage fixture can interfere with OPFS database creation
 * in multi-tab tests.
 */

import { test, expect, type Page } from '@playwright/test';
import {
  createAndOpenDatabase,
  createAndOpenOpfsDatabase,
  runSqlStatements,
  openDatabaseFromWelcome,
  waitForReady,
  openTable,
} from './helpers/app';

async function clearAllStorage(page: Page): Promise<void> {
  await page.evaluate(async () => {
    // Clear OPFS contents without deleting root directories
    if (navigator.storage?.getDirectory) {
      try {
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
            /* ignore locked files */
          }
        }
        try {
          await appDir.removeEntry('registry.json');
        } catch {
          /* ignore missing */
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
              /* ignore locked files */
            }
          }
        } catch {
          /* ignore missing legacy */
        }
      } catch {
        /* ignore OPFS errors */
      }
    }
    // Clear IndexedDB
    const knownDbs = ['sqlite-editor-registry', 'idb-sqlite', 'idb-batch-atomic'];
    for (const name of knownDbs) {
      try {
        await new Promise<void>((resolve) => {
          const req = indexedDB.deleteDatabase(name);
          req.onsuccess = () => resolve();
          req.onerror = () => resolve();
          req.onblocked = () => resolve();
        });
      } catch {
        /* ignore */
      }
    }
    // Clear localStorage
    localStorage.clear();
  });
}

test.describe('Read-Only Mode - Multi-Tab', () => {
  /**
   * Test read-only mode in Table Designer when second tab opens database held by first tab.
   * This test uses OPFS storage which supports single-writer locking.
   *
   * NOTE: This test must run AFTER sql-editor read-only test to ensure OPFS is in a good state.
   * Playwright runs tests alphabetically, so we use 'z-readonly-mode' naming or test dependencies.
   */
  test('table designer: read-only mode blocks edits', async ({ context }) => {
    // Use same database name as sql-editor test - OPFS state is shared across tests
    // and properly initialized by the sql-editor test which runs first alphabetically
    const opfsDbName = 'opfs-readonly-test';

    // Tab 1 (writer): Create and open OPFS database with test data
    const writer = await context.newPage();

    // Clear storage first to ensure clean state
    await writer.goto('/');
    await clearAllStorage(writer);

    // Reload to get fresh app state after clearing
    await writer.reload();

    // Now create and open the OPFS database
    await createAndOpenOpfsDatabase(writer, opfsDbName);
    await runSqlStatements(writer, [
      `CREATE TABLE people (id INTEGER PRIMARY KEY, name TEXT NOT NULL, age INTEGER)`,
      `INSERT INTO people (name, age) VALUES ('Alice', 30), ('Bob', 25)`,
    ]);
    await waitForReady(writer);

    // Give the lock time to establish (localStorage heartbeat)
    await writer.waitForTimeout(500);

    // Tab 2 (reader): Open the same database - should be read-only
    const reader = await context.newPage();
    await reader.goto('/');
    await openDatabaseFromWelcome(reader, opfsDbName);
    
    // Navigate to Designer tab for the people table
    await openTable(reader, opfsDbName, 'people');
    await reader.getByTestId('tab-designer').click();
    await expect(reader.getByTestId('table-designer')).toBeVisible();

    // Should show read-only notice and have disabled inputs
    await expect(reader.getByTestId('readonly-notice')).toBeVisible({ timeout: 10000 });
    await expect(reader.getByTestId('table-name-input')).toBeDisabled();

    // Cleanup
    await writer.close();
    await reader.close();
  });
});

test.describe('Read-Write Mode - Multi-Tab (IDB)', () => {
  test('table designer remains editable in second tab', async ({ context }) => {
    const idbDbName = 'idb-readwrite-test';
    const writer = await context.newPage();

    await writer.goto('/');
    await clearAllStorage(writer);
    await writer.reload();

    await createAndOpenDatabase(writer, idbDbName);
    await runSqlStatements(writer, [
      `CREATE TABLE people (id INTEGER PRIMARY KEY, name TEXT NOT NULL, age INTEGER)`,
      `INSERT INTO people (name, age) VALUES ('Alice', 30), ('Bob', 25)`,
    ]);
    await waitForReady(writer);

    const reader = await context.newPage();
    await reader.goto('/');
    await openDatabaseFromWelcome(reader, idbDbName);
    await openTable(reader, idbDbName, 'people');
    await reader.getByTestId('tab-designer').click();
    await expect(reader.getByTestId('table-designer')).toBeVisible();

    await expect(reader.locator('[data-testid="readonly-notice"]')).toHaveCount(0);
    await expect(reader.getByTestId('table-name-input')).toBeEnabled();

    await writer.close();
    await reader.close();
  });
});
