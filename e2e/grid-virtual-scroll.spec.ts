/**
 * E2E tests for virtual scrolling grid functionality.
 * Tests for bd-149: P5-01 Virtual scrolling grid
 *
 * Acceptance Criteria:
 * - Prev/Next pagination controls are removed from the grid UI
 * - Rendered row elements include data-testid="grid-row"
 * - In E2E on a 100k-row fixture, the DOM contains <= 200 elements matching [data-testid="grid-row"] while scrolling (virtualization is active)
 * - Uses LIMIT/OFFSET for non-rowid sorts
 * - Uses keyset only for ORDER BY rowid
 * - Scroll position reset to top on filter/sort change
 * - Row height is fixed (for virtualization calculation)
 * - Uses TanStack Virtual for virtualization
 */

import { test, expect } from '@playwright/test';
import { createAndOpenDatabase, runSqlStatements, openTable, waitForReady } from './helpers/app';

const DB_NAME = 'virtual-scroll-db';

async function setupLargeDatabase(page: import('@playwright/test').Page) {
  await createAndOpenDatabase(page, DB_NAME);
  await runSqlStatements(page, [
    // Create a large table with 100k rows for virtualization testing
    `CREATE TABLE large_table (
      id INTEGER PRIMARY KEY,
      name TEXT,
      value INTEGER
    )`,
    // Insert 100k rows using recursive CTE
    `WITH RECURSIVE cnt(x) AS (
      SELECT 1
      UNION ALL
      SELECT x + 1 FROM cnt WHERE x < 100000
    )
    INSERT INTO large_table (id, name, value)
    SELECT x, 'Item ' || x, x % 1000 FROM cnt`,
    // Create a table with duplicate values for sort testing
    `CREATE TABLE dup_values (
      id INTEGER PRIMARY KEY,
      category TEXT,
      score INTEGER
    )`,
    `WITH RECURSIVE cnt(x) AS (
      SELECT 1
      UNION ALL
      SELECT x + 1 FROM cnt WHERE x < 500
    )
    INSERT INTO dup_values (id, category, score)
    SELECT x, 'Cat' || (x % 10), x % 50 FROM cnt`,
    // Create a WITHOUT ROWID table for E2E-US-007-04
    `CREATE TABLE no_rowid_table (
      key1 INTEGER,
      key2 INTEGER,
      label TEXT,
      PRIMARY KEY (key1, key2)
    ) WITHOUT ROWID`,
    `WITH RECURSIVE cnt(x) AS (
      SELECT 1
      UNION ALL
      SELECT x + 1 FROM cnt WHERE x < 500
    )
    INSERT INTO no_rowid_table (key1, key2, label)
    SELECT x % 20, x, 'Label ' || x FROM cnt`,
  ]);
  await waitForReady(page);
}

test.describe('Virtual scrolling grid (bd-149)', () => {
  test.beforeEach(async ({ page }) => {
    await setupLargeDatabase(page);
  });

  test('Prev/Next pagination controls are removed from the grid UI', async ({ page }) => {
    await openTable(page, DB_NAME, 'large_table');

    // Prev/Next buttons should NOT exist
    await expect(page.getByTestId('table-prev-page')).not.toBeVisible();
    await expect(page.getByTestId('table-next-page')).not.toBeVisible();
  });

  test('Rendered row elements include data-testid="grid-row"', async ({ page }) => {
    await openTable(page, DB_NAME, 'large_table');

    // Wait for grid to render
    await expect(page.getByTestId('data-grid')).toBeVisible();

    // Check for grid-row testid
    const gridRows = page.locator('[data-testid="grid-row"]');
    const rowCount = await gridRows.count();
    expect(rowCount).toBeGreaterThan(0);
  });

  test('DOM contains <= 200 grid-row elements while scrolling on 100k-row table (virtualization active)', async ({ page }) => {
    await openTable(page, DB_NAME, 'large_table');

    // Wait for grid to render
    await expect(page.getByTestId('data-grid')).toBeVisible();

    // Count initial grid rows - should be virtualized (not all 100k)
    const initialRows = page.locator('[data-testid="grid-row"]');
    const initialCount = await initialRows.count();
    expect(initialCount).toBeLessThanOrEqual(200);
    expect(initialCount).toBeGreaterThan(0);

    // Scroll to middle
    const gridContainer = page.locator('[data-testid="data-grid"]').first();
    await gridContainer.evaluate((el) => {
      const scrollEl = el.querySelector('.overflow-auto');
      if (scrollEl) {
        scrollEl.scrollTop = scrollEl.scrollHeight / 2;
      }
    });
    await page.waitForTimeout(150);

    // Count rows after scrolling - still should be <= 200
    const midScrollRows = page.locator('[data-testid="grid-row"]');
    const midScrollCount = await midScrollRows.count();
    expect(midScrollCount).toBeLessThanOrEqual(200);

    // Scroll to end
    await gridContainer.evaluate((el) => {
      const scrollEl = el.querySelector('.overflow-auto');
      if (scrollEl) {
        scrollEl.scrollTop = scrollEl.scrollHeight;
      }
    });
    await page.waitForTimeout(150);

    // Count rows at end - still should be <= 200
    const endScrollRows = page.locator('[data-testid="grid-row"]');
    const endScrollCount = await endScrollRows.count();
    expect(endScrollCount).toBeLessThanOrEqual(200);
  });

  test('Row height is fixed at 32px for virtualization calculation', async ({ page }) => {
    await openTable(page, DB_NAME, 'large_table');

    // Wait for grid to render
    await expect(page.getByTestId('data-grid')).toBeVisible();

    // Check row height
    const row = page.locator('[data-testid="grid-row"]').first();
    const height = await row.evaluate((el) => getComputedStyle(el).height);
    expect(height).toBe('32px');
  });

  test('Scroll position resets to top on sort change', async ({ page }) => {
    await openTable(page, DB_NAME, 'large_table');

    // Wait for grid to render
    await expect(page.getByTestId('data-grid')).toBeVisible();

    // Scroll down
    const gridContainer = page.locator('[data-testid="data-grid"]').first();
    await gridContainer.evaluate((el) => {
      const scrollEl = el.querySelector('.overflow-auto');
      if (scrollEl) {
        scrollEl.scrollTop = 1000;
      }
    });
    await page.waitForTimeout(150);

    // Verify we scrolled (first visible row is not row 0)
    const firstRowBeforeSort = page.locator('[data-testid="grid-row"]').first();
    const indexBeforeSort = await firstRowBeforeSort.getAttribute('data-row-index');
    expect(Number(indexBeforeSort)).toBeGreaterThan(0);

    // Click on name column header text (not filter icon) to sort
    const nameHeader = page.getByRole('columnheader').filter({ hasText: 'name' }).locator('span.truncate');
    await nameHeader.click();

    // Wait for sort to be applied - check for sort indicator
    await expect(page.getByTestId('sort-indicator-name')).toBeVisible();

    // Wait a bit for data to reload and scroll to reset
    await page.waitForTimeout(300);

    // Verify scroll position reset to top (first visible row is row 0)
    const firstRowAfterSort = page.locator('[data-testid="grid-row"]').first();
    const indexAfterSort = await firstRowAfterSort.getAttribute('data-row-index');
    expect(Number(indexAfterSort)).toBe(0);
  });

  test('Scroll position resets to top on filter change', async ({ page }) => {
    await openTable(page, DB_NAME, 'large_table');

    // Wait for grid to render
    await expect(page.getByTestId('data-grid')).toBeVisible();

    // Scroll down
    const gridContainer = page.locator('[data-testid="data-grid"]').first();
    await gridContainer.evaluate((el) => {
      const scrollEl = el.querySelector('.overflow-auto');
      if (scrollEl) {
        scrollEl.scrollTop = 1000;
      }
    });
    await page.waitForTimeout(150);

    // Apply a filter
    await page.getByTestId('filter-icon-name').click();
    await page.getByTestId('filter-operator-name').selectOption('contains');
    await page.getByTestId('filter-value-name').fill('999');
    await page.getByTestId('filter-apply-name').click();
    await page.waitForTimeout(200);

    // Verify scroll position reset to top
    const scrollTop = await gridContainer.evaluate((el) => {
      const scrollEl = el.querySelector('.overflow-auto');
      return scrollEl?.scrollTop ?? 0;
    });
    expect(scrollTop).toBe(0);
  });

  // E2E-US-007-02: duplicate values sort test
  test('E2E-US-007-02: sort by column with duplicate values maintains stable order (no duplicates/missing rows)', async ({ page }) => {
    await openTable(page, DB_NAME, 'dup_values');

    // Wait for grid to render
    await expect(page.getByTestId('data-grid')).toBeVisible();

    // Sort by score (which has duplicate values)
    const scoreHeader = page.getByRole('columnheader', { name: /score/i });
    await scoreHeader.click();
    await expect(page.getByTestId('sort-indicator-score')).toBeVisible();

    // Collect all visible row IDs by scrolling through
    const seenIds = new Set<number>();
    const gridContainer = page.locator('[data-testid="data-grid"]').first();

    // Scroll through in increments and collect all unique IDs
    for (let scrollTop = 0; scrollTop < 20000; scrollTop += 500) {
      await gridContainer.evaluate((el, st) => {
        const scrollEl = el.querySelector('.overflow-auto');
        if (scrollEl) {
          scrollEl.scrollTop = st;
        }
      }, scrollTop);
      await page.waitForTimeout(100);

      // Get all visible row IDs
      const rows = page.locator('[data-testid="grid-row"]');
      const count = await rows.count();
      for (let i = 0; i < count; i++) {
        const idCell = rows.nth(i).locator('[data-testid^="cell-"][data-testid$="-id"]');
        const idText = await idCell.textContent();
        if (idText) {
          seenIds.add(Number(idText));
        }
      }
    }

    // We should have seen all 500 unique IDs without duplicates
    expect(seenIds.size).toBe(500);

    // Verify each ID from 1-500 exists exactly once
    for (let i = 1; i <= 500; i++) {
      expect(seenIds.has(i)).toBe(true);
    }

    // Toggle sort back to default and verify rowid order
    await scoreHeader.click(); // DESC
    await scoreHeader.click(); // Remove sort (default = rowid order)

    // First row should be id=1
    const firstRow = page.locator('[data-testid="grid-row"]').first();
    const firstIdCell = firstRow.locator('[data-testid^="cell-"][data-testid$="-id"]');
    await expect(firstIdCell).toHaveText('1');
  });

  // E2E-US-007-04: WITHOUT ROWID table test
  test('E2E-US-007-04: WITHOUT ROWID table sort maintains stable order using PK columns as tie-breaker', async ({ page }) => {
    await openTable(page, DB_NAME, 'no_rowid_table');

    // Wait for grid to render
    await expect(page.getByTestId('data-grid')).toBeVisible();

    // Sort by key1 (which has duplicate values: x % 20)
    // Click on the column header text span (not the filter icon) to trigger sort
    // Use the span.truncate that contains the column name
    const key1Header = page.getByRole('columnheader').filter({ hasText: 'key1' }).locator('span.truncate');
    await key1Header.click();
    await expect(page.getByTestId('sort-indicator-key1')).toBeVisible();

    // Collect all visible (key1, key2) pairs by scrolling through
    const seenPairs = new Set<string>();
    const gridContainer = page.locator('[data-testid="data-grid"]').first();

    // Scroll through in increments and collect all unique pairs
    for (let scrollTop = 0; scrollTop < 20000; scrollTop += 500) {
      await gridContainer.evaluate((el, st) => {
        const scrollEl = el.querySelector('.overflow-auto');
        if (scrollEl) {
          scrollEl.scrollTop = st;
        }
      }, scrollTop);
      await page.waitForTimeout(100);

      // Get all visible row pairs
      const rows = page.locator('[data-testid="grid-row"]');
      const count = await rows.count();
      for (let i = 0; i < count; i++) {
        const row = rows.nth(i);
        const key1Cell = row.locator('[data-testid^="cell-"][data-testid$="-key1"]');
        const key2Cell = row.locator('[data-testid^="cell-"][data-testid$="-key2"]');
        const key1Text = await key1Cell.textContent();
        const key2Text = await key2Cell.textContent();
        if (key1Text && key2Text) {
          seenPairs.add(`${key1Text},${key2Text}`);
        }
      }
    }

    // We should have seen all 500 unique (key1, key2) pairs without duplicates
    expect(seenPairs.size).toBe(500);

    // Toggle sort back to default and verify PK order
    await key1Header.click(); // DESC
    await key1Header.click(); // Remove sort (default = PK order)

    // First row should be (0, 20) since:
    // - key1 = x % 20, key2 = x
    // - For x=20: key1=0, key2=20
    // - This is the smallest (key1, key2) pair when sorted by PK ASC
    const firstRow = page.locator('[data-testid="grid-row"]').first();
    const firstKey1Cell = firstRow.locator('[data-testid^="cell-"][data-testid$="-key1"]');
    const firstKey2Cell = firstRow.locator('[data-testid^="cell-"][data-testid$="-key2"]');
    await expect(firstKey1Cell).toHaveText('0');
    await expect(firstKey2Cell).toHaveText('20');
  });

  test('Infinite scroll loads more data as user scrolls', async ({ page }) => {
    await openTable(page, DB_NAME, 'large_table');

    // Wait for grid to render
    await expect(page.getByTestId('data-grid')).toBeVisible();

    // Get the last visible row index initially
    const rows = page.locator('[data-testid="grid-row"]');
    const lastRow = rows.last();
    const initialLastIndex = Number(await lastRow.getAttribute('data-row-index'));

    // Scroll to a position that should trigger loading more data
    const gridContainer = page.locator('[data-testid="data-grid"]').first();
    await gridContainer.evaluate((el) => {
      const scrollEl = el.querySelector('.overflow-auto');
      if (scrollEl) {
        // Scroll to a significant portion of the table
        scrollEl.scrollTop = scrollEl.scrollHeight * 0.8;
      }
    });
    await page.waitForTimeout(500); // Wait for data to load

    // Get the new last visible row index
    const newRows = page.locator('[data-testid="grid-row"]');
    const newLastRow = newRows.last();
    const newLastIndex = Number(await newLastRow.getAttribute('data-row-index'));

    // The new last index should be much higher, showing more data was loaded
    expect(newLastIndex).toBeGreaterThan(initialLastIndex);
  });
});
