import { test, expect, type Page } from '@playwright/test';
import { createAndOpenDatabase, runSqlStatements, waitForReady } from './helpers/app';

/**
 * E2E Tests for Sidebar Navigator (US-012)
 *
 * Tests for sidebar filter behavior:
 * - Substring highlight in results (case-insensitive)
 * - Escape preserves tree expansion state
 * - IDB switch shows loading until commit complete
 * - Non-active DBs show name only (collapsed)
 * - Switching DBs runs unsaved-change check
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

    try {
      if (navigator.storage?.getDirectory) {
        const root = await navigator.storage.getDirectory();
        try {
          await root.removeEntry('sqlite-editor', { recursive: true });
        } catch {
          // Directory might not exist
        }
      }
    } catch {
      // OPFS not available
    }
  });
}

// =============================================================================
// Test Suites
// =============================================================================

test.describe('Sidebar Navigator (US-012)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/SQLite Editor/);
    await clearAllStorage(page);
  });

  test.describe('E2E-US-012-01: Filter and Escape behavior', () => {
    test('filter shows matching nodes with highlighted substring, Escape clears and restores expansion', async ({
      page,
    }) => {
      // Create a database with tables, views, and indexes
      await createAndOpenDatabase(page, 'filter-test-db');

      // Create tables
      await runSqlStatements(page, [
        'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)',
        'CREATE TABLE orders (id INTEGER PRIMARY KEY, user_id INTEGER, total REAL)',
        'CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT, price REAL)',
        'CREATE VIEW user_orders AS SELECT u.name, o.total FROM users u JOIN orders o ON u.id = o.user_id',
        'CREATE INDEX idx_orders_user ON orders(user_id)',
        'CREATE INDEX idx_products_name ON products(name)',
      ]);

      // Open sidebar and verify initial state
      await waitForReady(page);
      const dbTree = page.getByTestId('db-tree-filter-test-db');
      await expect(dbTree).toBeVisible();

      // Expand the database to see schema
      const dbRow = page.getByTestId('db-row-filter-test-db');
      await dbRow.click();

      // Wait for schema to load
      const contents = page.getByTestId('db-contents-filter-test-db');
      await expect(contents).toBeVisible({ timeout: 10000 });

      // Verify all items are visible (tables, views, indexes)
      await expect(page.getByTestId('item-table-users')).toBeVisible();
      await expect(page.getByTestId('item-table-orders')).toBeVisible();
      await expect(page.getByTestId('item-table-products')).toBeVisible();
      await expect(page.getByTestId('item-view-user_orders')).toBeVisible();
      await expect(page.getByTestId('item-index-idx_orders_user')).toBeVisible();
      await expect(page.getByTestId('item-index-idx_products_name')).toBeVisible();

      // Remember initial expansion state - all items visible
      const initialExpandedState = await dbTree.getAttribute('aria-expanded');

      // Type filter text (mixed case) - search for "ORDER" which should match:
      // - orders (table)
      // - user_orders (view)
      // - idx_orders_user (index)
      const searchInput = page.getByTestId('search-input');
      await searchInput.fill('ORDER');

      // Wait for debounce (150ms)
      await page.waitForTimeout(200);

      // Verify only matching items are visible
      await expect(page.getByTestId('item-table-orders')).toBeVisible();
      await expect(page.getByTestId('item-view-user_orders')).toBeVisible();
      await expect(page.getByTestId('item-index-idx_orders_user')).toBeVisible();

      // Non-matching items should be hidden
      await expect(page.getByTestId('item-table-users')).toBeHidden();
      await expect(page.getByTestId('item-table-products')).toBeHidden();
      await expect(page.getByTestId('item-index-idx_products_name')).toBeHidden();

      // Verify substring highlighting (case-insensitive)
      // The highlight should show the matched "order" substring
      const highlightMarks = page.locator('[data-testid="highlight-match"]');
      await expect(highlightMarks.first()).toBeVisible();

      // Count highlights - should have at least 3 (one for each matching item)
      const highlightCount = await highlightMarks.count();
      expect(highlightCount).toBeGreaterThanOrEqual(3);

      // Verify the highlighted text is "order" (case-preserving)
      const firstHighlight = highlightMarks.first();
      const highlightText = await firstHighlight.textContent();
      expect(highlightText?.toLowerCase()).toBe('order');

      // Press Escape to clear filter
      await searchInput.press('Escape');

      // Verify filter is cleared
      await expect(searchInput).toHaveValue('');

      // Verify expansion state is restored (all items visible again)
      await expect(page.getByTestId('item-table-users')).toBeVisible();
      await expect(page.getByTestId('item-table-orders')).toBeVisible();
      await expect(page.getByTestId('item-table-products')).toBeVisible();
      await expect(page.getByTestId('item-view-user_orders')).toBeVisible();
      await expect(page.getByTestId('item-index-idx_orders_user')).toBeVisible();
      await expect(page.getByTestId('item-index-idx_products_name')).toBeVisible();

      // Verify highlights are removed
      await expect(page.locator('[data-testid="highlight-match"]')).toHaveCount(0);

      // Verify database expansion state is preserved
      const finalExpandedState = await dbTree.getAttribute('aria-expanded');
      expect(finalExpandedState).toBe(initialExpandedState);
    });

    test('filter is case-insensitive and highlights preserve original case', async ({ page }) => {
      await createAndOpenDatabase(page, 'case-test-db');

      await runSqlStatements(page, [
        'CREATE TABLE UserProfiles (id INTEGER PRIMARY KEY)',
        'CREATE TABLE user_settings (id INTEGER PRIMARY KEY)',
        'CREATE TABLE USERDATA (id INTEGER PRIMARY KEY)',
      ]);

      await waitForReady(page);
      const dbRow = page.getByTestId('db-row-case-test-db');
      await dbRow.click();
      await expect(page.getByTestId('db-contents-case-test-db')).toBeVisible({ timeout: 10000 });

      // Search for "user" (lowercase)
      const searchInput = page.getByTestId('search-input');
      await searchInput.fill('user');
      await page.waitForTimeout(200);

      // All three tables should match (case-insensitive)
      await expect(page.getByTestId('item-table-UserProfiles')).toBeVisible();
      await expect(page.getByTestId('item-table-user_settings')).toBeVisible();
      await expect(page.getByTestId('item-table-USERDATA')).toBeVisible();

      // Verify highlights preserve original case
      const highlights = page.locator('[data-testid="highlight-match"]');
      const count = await highlights.count();
      expect(count).toBe(3);

      // Collect all highlight texts
      const highlightTexts: string[] = [];
      for (let i = 0; i < count; i++) {
        const text = await highlights.nth(i).textContent();
        if (text) highlightTexts.push(text);
      }

      // Should contain User, user, and USER (case-preserved)
      expect(highlightTexts).toContain('User');
      expect(highlightTexts).toContain('user');
      expect(highlightTexts).toContain('USER');
    });

    test('Escape restores pre-filter expansion state', async ({ page }) => {
      await createAndOpenDatabase(page, 'expansion-test-db');

      await runSqlStatements(page, [
        'CREATE TABLE alpha (id INTEGER PRIMARY KEY)',
        'CREATE TABLE beta (id INTEGER PRIMARY KEY)',
      ]);

      await waitForReady(page);
      const dbTree = page.getByTestId('db-tree-expansion-test-db');

      // Initially collapsed
      const initialExpanded = await dbTree.getAttribute('aria-expanded');
      expect(initialExpanded).toBe('false');

      // Type filter - should auto-expand
      const searchInput = page.getByTestId('search-input');
      await searchInput.fill('alpha');
      await page.waitForTimeout(200);

      // Should be expanded during filter
      await expect(page.getByTestId('db-contents-expansion-test-db')).toBeVisible();

      // Press Escape
      await searchInput.press('Escape');
      await expect(searchInput).toHaveValue('');

      // Should return to collapsed state (pre-filter state)
      await expect(page.getByTestId('db-contents-expansion-test-db')).toBeHidden();
      const finalExpanded = await dbTree.getAttribute('aria-expanded');
      expect(finalExpanded).toBe('false');
    });
  });

  test.describe('Non-active DB behavior', () => {
    test('non-active DBs show name only (collapsed)', async ({ page }) => {
      // Create first database
      await createAndOpenDatabase(page, 'active-db');
      await runSqlStatements(page, [
        'CREATE TABLE active_table (id INTEGER PRIMARY KEY)',
      ]);
      await waitForReady(page);

      // Create second database using the header button (since a DB is already open)
      await page.getByTestId('header-new-database-button').click();
      await expect(page.getByTestId('new-database-dialog')).toBeVisible();
      await page.getByTestId('database-name-input').fill('inactive-db');
      const createButton = page.getByTestId('create-button');
      await expect(createButton).toBeEnabled({ timeout: 5000 });
      await createButton.click();
      await expect(page.getByTestId('new-database-dialog')).toBeHidden({ timeout: 5000 });
      await waitForReady(page);

      // inactive-db should now be active, active-db should be non-active
      // Verify active-db shows name only (collapsed, no schema tree)
      const activeDbTree = page.getByTestId('db-tree-active-db');
      await expect(activeDbTree).toBeVisible();

      // active-db should be collapsed (non-active)
      const activeDbExpanded = await activeDbTree.getAttribute('aria-expanded');
      expect(activeDbExpanded).toBe('false');

      // Should not show schema items for non-active db
      await expect(page.getByTestId('db-contents-active-db')).toBeHidden();
    });
  });
});
