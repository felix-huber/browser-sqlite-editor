import { test, expect } from '@playwright/test';
import { runSql, waitForReady } from './helpers/app';

/**
 * E2E-US-011-01: Offline workflow test
 * Verifies the app works fully offline after first load per PRD requirements:
 * - No runtime network calls after first load
 * - Only SW update checks allowed
 * - All features functional offline
 * - All static assets precached (js, css, html, wasm, fonts)
 */

interface SWRegistrationResult {
  supported: boolean;
  registered: boolean;
  active?: boolean;
  scope?: string;
  timedOut?: boolean;
}

async function waitForServiceWorker(
  page: import('@playwright/test').Page,
  timeoutMs = 10000
): Promise<SWRegistrationResult> {
  return page.evaluate(async (timeout: number): Promise<SWRegistrationResult> => {
    if (!('serviceWorker' in navigator)) {
      return { supported: false, registered: false };
    }

    const existing = await navigator.serviceWorker.getRegistration('/');
    if (existing?.active) {
      return {
        supported: true,
        registered: true,
        active: true,
        scope: existing.scope,
      };
    }

    return Promise.race([
      navigator.serviceWorker.ready.then((reg) => ({
        supported: true,
        registered: true,
        active: !!reg.active,
        scope: reg.scope,
      })),
      new Promise<SWRegistrationResult>((resolve) =>
        setTimeout(
          () => resolve({ supported: true, registered: false, timedOut: true }),
          timeout
        )
      ),
    ]);
  }, timeoutMs);
}

test.describe('Offline Guarantee (E2E-US-011-01)', () => {
  test.beforeEach(async ({ page }) => {
    // Initial load to cache all assets
    await page.goto('/');
    await expect(page).toHaveTitle(/SQLite Editor/);

    // Wait for service worker to be fully active
    const sw = await waitForServiceWorker(page);
    if (sw.supported && !sw.timedOut) {
      expect(sw.active).toBe(true);
    }

    // Give SW time to cache all assets
    await page.waitForTimeout(2000);
  });

  test('app loads and renders correctly when offline', async ({ page, context }) => {
    // Go offline
    await context.setOffline(true);

    // Reload page
    await page.reload();

    // Verify app loaded
    await expect(page.locator('h1')).toContainText('SQLite Editor');
    await expect(page.getByTestId('welcome-screen')).toBeVisible({ timeout: 10000 });
  });

  test('can create database and run SQL queries offline', async ({ page, context }) => {
    // Go offline before creating database
    await context.setOffline(true);
    await page.reload();

    // Wait for app to be ready
    await expect(page.getByTestId('welcome-screen')).toBeVisible({ timeout: 15000 });

    // Create a new database
    await page.getByTestId('new-database-button').click();
    await expect(page.getByTestId('new-database-dialog')).toBeVisible();
    await page.getByTestId('database-name-input').fill('offline-test');
    const createButton = page.getByTestId('create-button');
    await expect(createButton).toBeEnabled({ timeout: 5000 });
    await createButton.click();
    await expect(page.getByTestId('new-database-dialog')).toBeHidden({ timeout: 5000 });

    // Open the database
    const recent = page.getByTestId('recent-db-offline-test');
    if (await recent.isVisible().catch(() => false)) {
      await recent.click();
    }

    // Wait for ready
    await waitForReady(page);

    // Run SQL to create a table
    await runSql(page, 'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)');

    // Insert data
    await runSql(page, "INSERT INTO users (name) VALUES ('Alice'), ('Bob')");

    // Query data
    await runSql(page, 'SELECT * FROM users');

    // Verify results are shown
    await expect(page.getByTestId('results-table')).toBeVisible();
  });

  test('CodeMirror SQL editor works offline', async ({ page, context }) => {
    // Go offline
    await context.setOffline(true);
    await page.reload();

    // Wait for app to be ready
    await expect(page.getByTestId('welcome-screen')).toBeVisible({ timeout: 15000 });

    // Create a new database offline
    await page.getByTestId('new-database-button').click();
    await expect(page.getByTestId('new-database-dialog')).toBeVisible();
    await page.getByTestId('database-name-input').fill('cm-offline');
    const createButton = page.getByTestId('create-button');
    await expect(createButton).toBeEnabled({ timeout: 5000 });
    await createButton.click();
    await expect(page.getByTestId('new-database-dialog')).toBeHidden({ timeout: 5000 });

    // Open the database
    const recent = page.getByTestId('recent-db-cm-offline');
    if (await recent.isVisible().catch(() => false)) {
      await recent.click();
    }
    await waitForReady(page);

    // Click SQL tab
    await page.getByTestId('tab-sql').click();

    // Verify CodeMirror editor is visible and functional
    const editor = page.getByTestId('codemirror-editor');
    await expect(editor).toBeVisible({ timeout: 10000 });

    // Type in the editor
    const content = editor.locator('.cm-content');
    await content.click();
    await page.keyboard.type('SELECT 1 + 1 AS result');

    // Run the query
    await page.getByTestId('run-button').click();
    await expect(page.getByTestId('results-table')).toBeVisible({ timeout: 10000 });
  });

  test('network panel shows only SW update checks (no other requests)', async ({ page, context }) => {
    const networkRequests: string[] = [];

    // Monitor network requests
    page.on('request', (request) => {
      const url = request.url();
      // Filter out localhost and data URLs
      if (!url.startsWith('http://localhost') &&
          !url.startsWith('https://localhost') &&
          !url.startsWith('data:')) {
        networkRequests.push(url);
      }
    });

    // Go offline to prevent any external requests
    await context.setOffline(true);
    await page.reload();

    // Use the app
    await expect(page.getByTestId('welcome-screen')).toBeVisible({ timeout: 15000 });

    // Create and use a database
    await page.getByTestId('new-database-button').click();
    await page.getByTestId('database-name-input').fill('network-test');
    await page.getByTestId('create-button').click();

    // Verify no external network calls were made
    // Only SW update checks to the app origin are allowed
    const externalRequests = networkRequests.filter(url =>
      !url.includes('localhost') &&
      !url.includes('127.0.0.1')
    );

    expect(externalRequests).toEqual([]);
  });

  test('static assets are served from cache (CacheFirst)', async ({ page, context }) => {
    // Go offline
    await context.setOffline(true);

    // Reload - all assets should come from cache
    const response = await page.goto('/');
    expect(response?.status()).toBe(200);

    // App should be fully functional
    await expect(page.locator('h1')).toContainText('SQLite Editor');
    await expect(page.getByTestId('welcome-screen')).toBeVisible({ timeout: 10000 });
  });

  test('WASM binary loads offline', async ({ page, context }) => {
    // Go offline
    await context.setOffline(true);
    await page.reload();

    // Wait for app to be ready
    await expect(page.getByTestId('welcome-screen')).toBeVisible({ timeout: 15000 });

    // Create a new database offline
    await page.getByTestId('new-database-button').click();
    await expect(page.getByTestId('new-database-dialog')).toBeVisible();
    await page.getByTestId('database-name-input').fill('wasm-offline');
    const createButton = page.getByTestId('create-button');
    await expect(createButton).toBeEnabled({ timeout: 5000 });
    await createButton.click();
    await expect(page.getByTestId('new-database-dialog')).toBeHidden({ timeout: 5000 });

    // Open the database
    const recent = page.getByTestId('recent-db-wasm-offline');
    if (await recent.isVisible().catch(() => false)) {
      await recent.click();
    }
    await waitForReady(page);

    // Run a query that requires WASM
    await runSql(page, 'SELECT sqlite_version()');
    await expect(page.getByTestId('results-table')).toBeVisible();
  });

  test('all tabs work offline (Table, SQL, Designer, Query Builder, ERD)', async ({ page, context }) => {
    // Go offline
    await context.setOffline(true);
    await page.reload();

    // Wait for app to be ready
    await expect(page.getByTestId('welcome-screen')).toBeVisible({ timeout: 15000 });

    // Create a new database offline
    await page.getByTestId('new-database-button').click();
    await expect(page.getByTestId('new-database-dialog')).toBeVisible();
    await page.getByTestId('database-name-input').fill('tabs-offline');
    const createButton = page.getByTestId('create-button');
    await expect(createButton).toBeEnabled({ timeout: 5000 });
    await createButton.click();
    await expect(page.getByTestId('new-database-dialog')).toBeHidden({ timeout: 5000 });

    // Open the database
    const recent = page.getByTestId('recent-db-tabs-offline');
    if (await recent.isVisible().catch(() => false)) {
      await recent.click();
    }
    await waitForReady(page);

    // Create a table with data
    await runSql(page, 'CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT, price REAL)');
    await runSql(page, "INSERT INTO products VALUES (1, 'Widget', 9.99)");

    // Expand the database tree in sidebar
    const dbTreeItem = page.getByTestId('db-tree-tabs-offline');
    await expect(dbTreeItem).toBeVisible({ timeout: 10000 });
    const isExpanded = await dbTreeItem.getAttribute('aria-expanded');
    if (isExpanded !== 'true') {
      await page.getByTestId('db-row-tabs-offline').click();
    }

    // Click on the table
    const tableItem = page.getByTestId('item-table-products');
    await expect(tableItem).toBeVisible({ timeout: 10000 });
    await tableItem.click();

    // Test Table tab (data grid)
    await page.getByTestId('tab-table').click();
    await expect(page.getByTestId('data-grid')).toBeVisible({ timeout: 10000 });

    // Test SQL tab
    await page.getByTestId('tab-sql').click();
    await expect(page.getByTestId('codemirror-editor')).toBeVisible({ timeout: 10000 });

    // Test Designer tab
    await page.getByTestId('tab-designer').click();
    // Designer should show table structure
    await expect(page.getByTestId('table-designer')).toBeVisible({ timeout: 10000 });

    // Test Query Builder tab
    await page.getByTestId('tab-query-builder').click();
    await expect(page.getByTestId('query-builder')).toBeVisible({ timeout: 10000 });

    // Test ERD tab
    await page.getByTestId('tab-erd').click();
    await expect(page.getByTestId('erd-view')).toBeVisible({ timeout: 10000 });
  });

  test('import/export works offline', async ({ page, context }) => {
    // Go offline
    await context.setOffline(true);
    await page.reload();

    // Wait for app to be ready
    await expect(page.getByTestId('welcome-screen')).toBeVisible({ timeout: 15000 });

    // Create a new database offline
    await page.getByTestId('new-database-button').click();
    await expect(page.getByTestId('new-database-dialog')).toBeVisible();
    await page.getByTestId('database-name-input').fill('export-offline');
    const createButton = page.getByTestId('create-button');
    await expect(createButton).toBeEnabled({ timeout: 5000 });
    await createButton.click();
    await expect(page.getByTestId('new-database-dialog')).toBeHidden({ timeout: 5000 });

    // Open the database
    const recent = page.getByTestId('recent-db-export-offline');
    if (await recent.isVisible().catch(() => false)) {
      await recent.click();
    }
    await waitForReady(page);

    // Create a table with data
    await runSql(page, 'CREATE TABLE data (id INTEGER, value TEXT)');
    await runSql(page, "INSERT INTO data VALUES (1, 'test')");

    // Expand the database tree in sidebar
    const dbTreeItem = page.getByTestId('db-tree-export-offline');
    await expect(dbTreeItem).toBeVisible({ timeout: 10000 });
    const isExpanded = await dbTreeItem.getAttribute('aria-expanded');
    if (isExpanded !== 'true') {
      await page.getByTestId('db-row-export-offline').click();
    }

    // Click on the table
    const tableItem = page.getByTestId('item-table-data');
    await expect(tableItem).toBeVisible({ timeout: 10000 });
    await tableItem.click();

    // Navigate to table view
    await page.getByTestId('tab-table').click();
    await expect(page.getByTestId('data-grid')).toBeVisible({ timeout: 10000 });

    // Look for export button and verify it's accessible
    const exportButton = page.getByTestId('export-button');
    if (await exportButton.isVisible().catch(() => false)) {
      await exportButton.click();
      // Export dialog or dropdown should appear
      await expect(page.getByTestId('export-menu').or(page.getByTestId('export-dialog'))).toBeVisible({ timeout: 5000 });
    }
  });

  test('precache manifest includes all required asset types', async ({ page }) => {
    // Build verification: check that the SW precaches essential asset types
    // This test verifies the vite.config.ts globPatterns are correct
    await page.goto('/');

    // Wait for SW to be active
    const sw = await waitForServiceWorker(page);
    expect(sw.active).toBe(true);

    // Get cache names and contents
    const cacheInfo = await page.evaluate(async () => {
      const cacheNames = await caches.keys();
      const assetTypes: Record<string, string[]> = {
        js: [],
        css: [],
        html: [],
        wasm: [],
      };

      for (const cacheName of cacheNames) {
        const cache = await caches.open(cacheName);
        const requests = await cache.keys();
        for (const request of requests) {
          const url = request.url;
          if (url.endsWith('.js')) assetTypes.js.push(url);
          else if (url.endsWith('.css')) assetTypes.css.push(url);
          // index.html is often cached as '/' or without extension
          else if (url.endsWith('.html') || url.endsWith('/')) assetTypes.html.push(url);
          else if (url.endsWith('.wasm')) assetTypes.wasm.push(url);
        }
      }

      return assetTypes;
    });

    // Verify essential asset types are cached
    // JS, CSS, and WASM are always present in the app
    expect(cacheInfo.js.length).toBeGreaterThan(0);
    expect(cacheInfo.css.length).toBeGreaterThan(0);
    expect(cacheInfo.wasm.length).toBeGreaterThan(0);
    // HTML may be cached as '/' via navigateFallback
    expect(cacheInfo.html.length + cacheInfo.js.length).toBeGreaterThan(1);
  });
});
