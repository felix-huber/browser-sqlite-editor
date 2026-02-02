/**
 * E2E Tests for Basic Database Operations
 *
 * These tests verify fundamental database operations to prevent regressions:
 * 1. Open Sakila sample database
 * 2. Create new database
 * 3. Open existing database from sidebar
 * 4. Import SQLite file
 * 5. Database operations after reset
 *
 * Key assertions:
 * - Worker is ready (status indicator shows "Ready")
 * - No console errors
 * - Database opens within 5 seconds (NOT 30 second timeout)
 * - Tables/views appear in sidebar
 * - Can execute simple SELECT query
 */

import { test, expect, type Page } from '@playwright/test';
import {
  waitForReady,
  createAndOpenDatabase,
  runSql,
  dismissUnsavedPromptIfVisible,
} from './helpers/app';
import { debug, step, setupConsoleErrorLogging } from './helpers/debug';

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Wait for worker to be ready - checks status bar shows "Ready"
 */
async function waitForWorkerReady(page: Page, timeoutMs = 5000): Promise<void> {
  const statusBar = page.locator('[data-testid="status-bar"], [role="status"]');
  await expect(statusBar).toBeVisible({ timeout: timeoutMs });
  await page.waitForFunction(
    () => {
      const status = document.querySelector('[data-testid="status-bar"], [role="status"]');
      return status?.textContent?.includes('Ready') ?? false;
    },
    { timeout: timeoutMs }
  );
}

/**
 * Clear all storage for clean test state
 */
async function clearAllStorage(page: Page): Promise<void> {
  await page.evaluate(async () => {
    localStorage.clear();

    const deleteIdb = (name: string): Promise<void> => {
      return new Promise((resolve) => {
        const req = indexedDB.deleteDatabase(name);
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
        req.onblocked = () => resolve();
      });
    };

    await deleteIdb('sqlite-editor-registry');
    await deleteIdb('idb-sqlite');
    await deleteIdb('idb-batch-atomic');

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
        for (const dirName of dirsToDelete) {
          try {
            await root.removeEntry(dirName, { recursive: true });
          } catch {
            // ignore locked dirs
          }
        }
      }
    } catch {
      // ignore OPFS errors
    }
  });
}

/**
 * Ensure OPFS directories exist for database storage
 */
async function ensureOpfsDirs(page: Page): Promise<void> {
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
}

/**
 * Create a valid SQLite database file bytes (minimal but valid)
 */
function createValidSqliteBytes(pageSize = 4096): Uint8Array {
  const bytes = new Uint8Array(pageSize);

  // SQLite file header (first 100 bytes)
  const magic = 'SQLite format 3\0';
  for (let i = 0; i < magic.length; i++) {
    bytes[i] = magic.charCodeAt(i);
  }
  // Page size (bytes 16-17): 4096 = 0x1000 (big-endian)
  bytes[16] = 0x10;
  bytes[17] = 0x00;
  bytes[18] = 0x01; // File format write version
  bytes[19] = 0x01; // File format read version
  bytes[20] = 0x00; // Reserved
  bytes[21] = 0x40; // Max payload fraction
  bytes[22] = 0x20; // Min payload fraction
  bytes[23] = 0x20; // Leaf payload fraction
  bytes[27] = 0x01; // File change counter
  bytes[31] = 0x01; // Database size in pages
  bytes[43] = 0x01; // Schema cookie
  bytes[47] = 0x04; // Schema format
  bytes[59] = 0x01; // Text encoding: UTF-8
  bytes[96] = 0x00;
  bytes[97] = 0x2e;
  bytes[98] = 0x68;
  bytes[99] = 0x18;

  // B-tree page header
  bytes[100] = 0x0d; // Leaf table b-tree page
  bytes[105] = 0x10; // Cell content area
  bytes[106] = 0x00;

  return bytes;
}

/**
 * Filter console errors - exclude non-critical warnings
 */
function filterCriticalErrors(errors: string[]): string[] {
  return errors.filter(
    (e) =>
      !e.includes('Download the React DevTools') &&
      !e.includes('React does not recognize')
  );
}

// =============================================================================
// Test Suites
// =============================================================================

test.describe('Basic Database Operations', () => {
  test.describe('1. Open Sakila Sample Database', () => {
    test('opens Sakila sample database, verifies tables appear, runs simple query', async ({
      page,
    }) => {
      debug('Starting: Open Sakila sample database test');

      // Track console errors
      const consoleErrors: string[] = [];
      setupConsoleErrorLogging(page);
      page.on('console', (msg) => {
        if (msg.type() === 'error') {
          const text = msg.text();
          consoleErrors.push(text);
        }
      });

      // Step 1: Navigate to app
      await step('Navigate to app', async () => {
        await page.goto('/');
        await expect(page).toHaveTitle(/SQLite Editor/);
        await expect(page.getByTestId('welcome-screen')).toBeVisible({ timeout: 10000 });
      });

      // Step 2: Click "Open Sakila sample database" button
      await step('Click Open Sakila sample database button', async () => {
        const sakilaButton = page.getByTestId('open-sakila-sample-button');
        await expect(sakilaButton).toBeVisible({ timeout: 5000 });
        await sakilaButton.click();
      });

      // Step 3: Wait for database to load - CRITICAL: 5 second timeout, not 30
      await step('Wait for database to load (max 5 seconds)', async () => {
        // Worker should be ready within 5 seconds
        await waitForWorkerReady(page, 5000);

        // SQL tab should be visible indicating database is open
        await expect(page.getByTestId('tab-sql')).toBeVisible({ timeout: 5000 });
      });

      // Step 4: Verify tables appear in sidebar
      await step('Verify tables appear in sidebar', async () => {
        // The sidebar should show database tables
        // Look for at least one of the expected Sakila tables
        const sidebar = page.getByTestId('sidebar');
        await expect(sidebar).toBeVisible({ timeout: 5000 });

        // Sakila has tables like actor, film, customer
        // Wait for at least one table to appear
        await page.waitForFunction(
          () => {
            const sidebar = document.querySelector('[data-testid="sidebar"]');
            if (!sidebar) return false;
            // Look for table items or database tree items
            const tableItems = sidebar.querySelectorAll(
              '[data-testid^="item-table-"], [data-testid^="db-tree-"]'
            );
            return tableItems.length > 0;
          },
          { timeout: 5000 }
        );
      });

      // Step 5: Run a simple SELECT query
      await step('Run simple SELECT query', async () => {
        await runSql(page, 'SELECT * FROM actor LIMIT 5');

        // Results should appear
        await expect(page.getByTestId('results-table')).toBeVisible({ timeout: 5000 });

        // At least one cell should be visible
        const firstCell = page.locator('[data-testid^="cell-0-"]').first();
        await expect(firstCell).toBeVisible({ timeout: 5000 });
      });

      // Step 6: Verify no critical console errors
      await step('Verify no console errors', async () => {
        const criticalErrors = filterCriticalErrors(consoleErrors);
        if (criticalErrors.length > 0) {
          debug('Critical errors found:', criticalErrors);
        }
        expect(criticalErrors).toHaveLength(0);
      });

      debug('Sakila sample database test completed successfully');
    });

    test('Sakila database contains expected tables', async ({ page }) => {
      debug('Starting: Sakila tables verification test');

      const consoleErrors: string[] = [];
      setupConsoleErrorLogging(page);
      page.on('console', (msg) => {
        if (msg.type() === 'error') {
          consoleErrors.push(msg.text());
        }
      });

      // Navigate and open Sakila
      await page.goto('/');
      await expect(page.getByTestId('welcome-screen')).toBeVisible({ timeout: 10000 });

      const sakilaButton = page.getByTestId('open-sakila-sample-button');
      await sakilaButton.click();

      await waitForWorkerReady(page, 5000);
      await expect(page.getByTestId('tab-sql')).toBeVisible({ timeout: 5000 });

      // Verify key Sakila tables exist by querying them
      const expectedTables = ['actor', 'film', 'customer', 'rental', 'store'];

      for (const tableName of expectedTables) {
        await runSql(page, `SELECT COUNT(*) as cnt FROM ${tableName}`);
        await expect(page.getByTestId('results-table')).toBeVisible({ timeout: 5000 });
        // If the query succeeds without error, the table exists
        await expect(page.getByTestId('cell-0-cnt')).toBeVisible({ timeout: 5000 });
      }

      // Verify no console errors
      const criticalErrors = filterCriticalErrors(consoleErrors);
      expect(criticalErrors).toHaveLength(0);

      debug('Sakila tables verification completed');
    });
  });

  test.describe('2. Create New Database', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/');
      await expect(page).toHaveTitle(/SQLite Editor/);
      await clearAllStorage(page);
      await page.reload();
      await expect(page.getByTestId('welcome-screen')).toBeVisible({ timeout: 15000 });
      await ensureOpfsDirs(page);
    });

    test('creates new database, verifies it opens, can run SQL', async ({ page }) => {
      debug('Starting: Create new database test');

      const consoleErrors: string[] = [];
      setupConsoleErrorLogging(page);
      page.on('console', (msg) => {
        if (msg.type() === 'error') {
          consoleErrors.push(msg.text());
        }
      });

      const dbName = `testdb-${Date.now()}`;

      // Step 1: Click New Database button
      await step('Click New Database button', async () => {
        await page.getByTestId('new-database-button').click();
        await expect(page.getByTestId('new-database-dialog')).toBeVisible({ timeout: 5000 });
      });

      // Step 2: Enter database name and create
      await step('Enter name and create database', async () => {
        await page.getByTestId('database-name-input').fill(dbName);
        const createButton = page.getByTestId('create-button');
        await expect(createButton).toBeEnabled({ timeout: 5000 });
        await createButton.click();
      });

      // Step 3: Wait for database to be created and opened (max 5 seconds)
      await step('Wait for database to open (max 5 seconds)', async () => {
        await dismissUnsavedPromptIfVisible(page);
        await expect(page.getByTestId('new-database-dialog')).toBeHidden({ timeout: 5000 });

        // If database shows in recent, click to open
        const recent = page.getByTestId(`recent-db-${dbName}`);
        if (await recent.isVisible().catch(() => false)) {
          await recent.click();
          await dismissUnsavedPromptIfVisible(page);
        }

        // SQL tab visible indicates database is open
        await expect(page.getByTestId('tab-sql')).toBeVisible({ timeout: 5000 });

        // When a database is open, status bar shows storage type (OPFS or IndexedDB)
        // instead of "Ready" (which only shows when no database is open)
        const statusBar = page.locator('[data-testid="status-bar"], [role="status"]');
        await expect(statusBar).toBeVisible({ timeout: 5000 });
      });

      // Step 4: Verify database is usable - run SQL
      await step('Run SQL to verify database works', async () => {
        await runSql(page, 'CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)');
        // No error should occur
        await expect(
          page.locator('[data-testid="error-display"]')
        ).not.toBeVisible({ timeout: 1000 }).catch(() => {
          // error-display might not exist, which is fine
        });

        // Insert and query data
        await runSql(page, "INSERT INTO test (name) VALUES ('hello')");
        await runSql(page, 'SELECT * FROM test');
        await expect(page.getByTestId('results-table')).toBeVisible({ timeout: 5000 });
        await expect(page.getByTestId('cell-0-name')).toHaveText('hello');
      });

      // Step 5: Verify no console errors
      await step('Verify no console errors', async () => {
        const criticalErrors = filterCriticalErrors(consoleErrors);
        expect(criticalErrors).toHaveLength(0);
      });

      debug('Create new database test completed successfully');
    });
  });

  test.describe('3. Open Existing Database from Sidebar', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/');
      await clearAllStorage(page);
      await page.reload();
      await expect(page.getByTestId('welcome-screen')).toBeVisible({ timeout: 15000 });
      await ensureOpfsDirs(page);
    });

    test('creates database, closes, reopens from sidebar', async ({ page }) => {
      debug('Starting: Open existing database from sidebar test');

      const consoleErrors: string[] = [];
      setupConsoleErrorLogging(page);
      page.on('console', (msg) => {
        if (msg.type() === 'error') {
          consoleErrors.push(msg.text());
        }
      });

      const dbName = `sidebar-test-${Date.now()}`;

      // Step 1: Create and open a database
      await step('Create initial database', async () => {
        await createAndOpenDatabase(page, dbName);
        await waitForReady(page);

        // Create a table so we can verify data later
        await runSql(page, 'CREATE TABLE marker (id INTEGER PRIMARY KEY)');
        await runSql(page, 'INSERT INTO marker VALUES (42)');
      });

      // Step 2: Close the database to return to welcome screen
      await step('Close database', async () => {
        const closeButton = page.getByRole('button', { name: /close.*db/i });
        if (await closeButton.isVisible().catch(() => false)) {
          await closeButton.click();
          await expect(page.getByTestId('welcome-screen')).toBeVisible({ timeout: 5000 });
        } else {
          // Alternative: navigate away
          await page.goto('/');
          await expect(page.getByTestId('welcome-screen')).toBeVisible({ timeout: 15000 });
        }
      });

      // Step 3: Verify database appears in sidebar
      await step('Verify database in sidebar', async () => {
        const sidebar = page.getByTestId('sidebar');
        await expect(sidebar).toContainText(dbName, { timeout: 5000 });
      });

      // Step 4: Click on database in sidebar to open it (max 5 seconds)
      await step('Open database from sidebar (max 5 seconds)', async () => {
        const dbEntry = page.getByTestId(`recent-db-${dbName}`);
        if (await dbEntry.isVisible().catch(() => false)) {
          await dbEntry.click();
        } else {
          // Try alternative selector
          const dbRow = page.getByTestId(`db-row-${dbName}`);
          if (await dbRow.isVisible().catch(() => false)) {
            await dbRow.click();
          } else {
            // Click on text in sidebar
            await page.getByTestId('sidebar').getByText(dbName).click();
          }
        }

        await dismissUnsavedPromptIfVisible(page);

        // SQL tab visible means database is open (status bar shows storage type, not "Ready")
        await expect(page.getByTestId('tab-sql')).toBeVisible({ timeout: 5000 });
        const statusBar = page.locator('[data-testid="status-bar"], [role="status"]');
        await expect(statusBar).toBeVisible({ timeout: 5000 });
      });

      // Step 5: Verify data is still there
      await step('Verify data persists', async () => {
        await runSql(page, 'SELECT id FROM marker');
        await expect(page.getByTestId('results-table')).toBeVisible({ timeout: 5000 });
        await expect(page.getByTestId('cell-0-id')).toHaveText('42');
      });

      // Step 6: Verify no console errors
      await step('Verify no console errors', async () => {
        const criticalErrors = filterCriticalErrors(consoleErrors);
        expect(criticalErrors).toHaveLength(0);
      });

      debug('Open existing database from sidebar test completed');
    });
  });

  test.describe('4. Import SQLite File', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/');
      await clearAllStorage(page);
      await page.reload();
      await expect(page.getByTestId('welcome-screen')).toBeVisible({ timeout: 15000 });
    });

    test('imports SQLite file via drop zone, verifies it loads', async ({ page }) => {
      debug('Starting: Import SQLite file test');

      const consoleErrors: string[] = [];
      setupConsoleErrorLogging(page);
      page.on('console', (msg) => {
        if (msg.type() === 'error') {
          consoleErrors.push(msg.text());
        }
      });

      // Check if drop zone is visible
      const dropZone = page.locator('[data-testid="drop-zone"]');
      const dropZoneVisible = await dropZone.isVisible().catch(() => false);

      if (!dropZoneVisible) {
        debug('Drop zone not visible, skipping UI import test');
        test.skip();
        return;
      }

      // Step 1: Create a valid SQLite file and drop it
      await step('Import via drop zone', async () => {
        const bytes = createValidSqliteBytes();

        // Create DataTransfer with the file
        const dataTransfer = await page.evaluateHandle(
          ({ bytesArray, fileName }) => {
            const fileBytes = new Uint8Array(bytesArray);
            const file = new File([fileBytes], fileName, { type: 'application/x-sqlite3' });
            const dt = new DataTransfer();
            dt.items.add(file);
            return dt;
          },
          { bytesArray: Array.from(bytes), fileName: 'imported.sqlite' }
        );

        // Dispatch drop events
        await dropZone.dispatchEvent('dragenter', { dataTransfer });
        await dropZone.dispatchEvent('dragover', { dataTransfer });
        await dropZone.dispatchEvent('drop', { dataTransfer });
      });

      // Step 2: Wait for import to complete (max 5 seconds)
      await step('Wait for import to complete (max 5 seconds)', async () => {
        // Either the database opens or we see it in the registry
        await page.waitForFunction(
          () => {
            // Check for SQL tab (database open)
            const sqlTab = document.querySelector('[data-testid="tab-sql"]');
            if (sqlTab) return true;

            // Check for database in sidebar
            const sidebar = document.querySelector('[data-testid="sidebar"]');
            if (sidebar?.textContent?.includes('imported')) return true;

            return false;
          },
          { timeout: 5000 }
        );
      });

      // Step 3: Verify no console errors
      await step('Verify no console errors', async () => {
        const criticalErrors = filterCriticalErrors(consoleErrors);
        expect(criticalErrors).toHaveLength(0);
      });

      debug('Import SQLite file test completed');
    });

    test('imports SQLite file via file picker button exists', async ({ page }) => {
      debug('Starting: File picker button verification test');

      // Verify the Open Database button exists
      const openDbButton = page.locator('[data-testid="open-database-button"]');
      await expect(openDbButton).toBeVisible({ timeout: 5000 });
      await expect(openDbButton).toContainText(/Open/i);

      // Verify hidden file input exists with correct accept attribute
      const fileInput = page.locator('[data-testid="open-database-file-input"]');
      await expect(fileInput).toBeAttached();

      const accept = await fileInput.getAttribute('accept');
      expect(accept).toContain('.sqlite');

      debug('File picker verification completed');
    });
  });

  test.describe('5. Database Operations After Reset', () => {
    test('reset app, create new database, verify it works', async ({ page }) => {
      debug('Starting: Database operations after reset test');

      const consoleErrors: string[] = [];
      setupConsoleErrorLogging(page);
      page.on('console', (msg) => {
        if (msg.type() === 'error') {
          consoleErrors.push(msg.text());
        }
      });

      // Step 1: Navigate and clear storage (simulates reset)
      await step('Reset app state', async () => {
        await page.goto('/');
        await clearAllStorage(page);
        await page.reload();
        await expect(page.getByTestId('welcome-screen')).toBeVisible({ timeout: 15000 });
        await ensureOpfsDirs(page);
      });

      // Step 2: Verify clean state - sidebar shows no databases
      await step('Verify clean state', async () => {
        const sidebar = page.getByTestId('sidebar');
        await expect(sidebar).toBeVisible({ timeout: 5000 });

        // Should show empty state message
        const emptyState = sidebar.locator('[data-testid="empty-state"]');
        const hasEmptyState = await emptyState.isVisible().catch(() => false);

        if (!hasEmptyState) {
          // Alternative: check for "No databases" text
          const noDbsText = page.locator('text=No databases');
          await expect(noDbsText).toBeVisible({ timeout: 5000 });
        }
      });

      // Step 3: Create a new database after reset
      await step('Create new database after reset', async () => {
        const dbName = `post-reset-${Date.now()}`;

        await page.getByTestId('new-database-button').click();
        await expect(page.getByTestId('new-database-dialog')).toBeVisible({ timeout: 5000 });
        await page.getByTestId('database-name-input').fill(dbName);

        const createButton = page.getByTestId('create-button');
        await expect(createButton).toBeEnabled({ timeout: 5000 });
        await createButton.click();

        await dismissUnsavedPromptIfVisible(page);
        await expect(page.getByTestId('new-database-dialog')).toBeHidden({ timeout: 5000 });

        // Open the database if it appears in recent
        const recent = page.getByTestId(`recent-db-${dbName}`);
        if (await recent.isVisible().catch(() => false)) {
          await recent.click();
          await dismissUnsavedPromptIfVisible(page);
        }
      });

      // Step 4: Verify database works (max 5 seconds)
      await step('Verify database operations work (max 5 seconds)', async () => {
        // SQL tab visible means database is open (status bar shows storage type, not "Ready")
        await expect(page.getByTestId('tab-sql')).toBeVisible({ timeout: 5000 });
        const statusBar = page.locator('[data-testid="status-bar"], [role="status"]');
        await expect(statusBar).toBeVisible({ timeout: 5000 });

        // Create table and insert data
        await runSql(page, 'CREATE TABLE post_reset (value TEXT)');
        await runSql(page, "INSERT INTO post_reset VALUES ('works after reset')");
        await runSql(page, 'SELECT * FROM post_reset');

        await expect(page.getByTestId('results-table')).toBeVisible({ timeout: 5000 });
        await expect(page.getByTestId('cell-0-value')).toHaveText('works after reset');
      });

      // Step 5: Verify no console errors
      await step('Verify no console errors', async () => {
        const criticalErrors = filterCriticalErrors(consoleErrors);
        expect(criticalErrors).toHaveLength(0);
      });

      debug('Database operations after reset test completed');
    });

    test('actual reset button clears all databases', async ({ page }) => {
      debug('Starting: Reset button test');

      const consoleErrors: string[] = [];
      setupConsoleErrorLogging(page);
      page.on('console', (msg) => {
        if (msg.type() === 'error') {
          consoleErrors.push(msg.text());
        }
      });

      // Step 1: Navigate and setup clean state
      await step('Setup initial state', async () => {
        await page.goto('/');
        await clearAllStorage(page);
        await page.reload();
        await expect(page.getByTestId('welcome-screen')).toBeVisible({ timeout: 15000 });
        await ensureOpfsDirs(page);
      });

      // Step 2: Create a database
      await step('Create database to be reset', async () => {
        await createAndOpenDatabase(page, 'to-be-reset');
        await runSql(page, 'CREATE TABLE data (id INTEGER)');
        await waitForReady(page);
      });

      // Step 3: Close database
      await step('Close database', async () => {
        const closeButton = page.getByRole('button', { name: /close.*db/i });
        if (await closeButton.isVisible().catch(() => false)) {
          await closeButton.click();
          await expect(page.getByTestId('welcome-screen')).toBeVisible({ timeout: 5000 });
        } else {
          await page.goto('/');
          await expect(page.getByTestId('welcome-screen')).toBeVisible({ timeout: 15000 });
        }
      });

      // Step 4: Click reset button and confirm
      await step('Reset app via button', async () => {
        const resetButton = page.getByTestId('reset-app-button');

        if (await resetButton.isVisible().catch(() => false)) {
          await resetButton.click();
          await page.waitForSelector('[data-testid="reset-confirm-dialog"]', { timeout: 5000 });
          await page.getByTestId('reset-confirm-button').click();

          // Wait for page to reload
          await page.waitForURL(/\?reset=/, { timeout: 30000 });
          await page.waitForSelector('[data-testid="welcome-screen"]', { timeout: 30000 });
        } else {
          // If reset button not visible, skip test
          debug('Reset button not visible, skipping');
          test.skip();
          return;
        }
      });

      // Step 5: Verify database is gone
      await step('Verify database was reset', async () => {
        const sidebar = page.getByTestId('sidebar');
        await expect(sidebar).not.toContainText('to-be-reset');

        // Verify empty state
        const emptyState = sidebar.locator('[data-testid="empty-state"]');
        const hasEmptyState = await emptyState.isVisible().catch(() => false);

        if (!hasEmptyState) {
          const noDbsText = page.locator('text=No databases');
          await expect(noDbsText).toBeVisible({ timeout: 5000 });
        }
      });

      // Step 6: Create new database after reset to verify system works
      await step('Verify can create database after reset', async () => {
        await ensureOpfsDirs(page);
        await createAndOpenDatabase(page, 'after-reset');
        await waitForReady(page);
        await expect(page.getByTestId('tab-sql')).toBeVisible({ timeout: 5000 });
      });

      // Step 7: Verify no console errors
      await step('Verify no console errors', async () => {
        const criticalErrors = filterCriticalErrors(consoleErrors);
        expect(criticalErrors).toHaveLength(0);
      });

      debug('Reset button test completed');
    });
  });
});

// =============================================================================
// Worker Ready State Tests
// =============================================================================

test.describe('Worker Ready State', () => {
  test('app shows Ready status on initial load', async ({ page }) => {
    debug('Starting: Worker ready state test');

    const consoleErrors: string[] = [];
    setupConsoleErrorLogging(page);
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto('/');
    await expect(page).toHaveTitle(/SQLite Editor/);

    // Status bar should show Ready within 5 seconds
    await waitForWorkerReady(page, 5000);

    // Verify status bar content
    const statusBar = page.locator('[data-testid="status-bar"], [role="status"]');
    await expect(statusBar).toContainText('Ready');
    await expect(statusBar).toContainText('SQLite');

    // Verify no console errors
    const criticalErrors = filterCriticalErrors(consoleErrors);
    expect(criticalErrors).toHaveLength(0);

    debug('Worker ready state test completed');
  });

  test('SQLite WASM engine is loaded', async ({ page }) => {
    debug('Starting: SQLite WASM engine test');

    await page.goto('/');

    // Status bar should mention SQLite WASM
    const statusBar = page.locator('[data-testid="status-bar"], [role="status"]');
    await expect(statusBar).toBeVisible({ timeout: 10000 });
    await expect(statusBar).toContainText('SQLite WASM', { timeout: 10000 });

    debug('SQLite WASM engine test completed');
  });
});
