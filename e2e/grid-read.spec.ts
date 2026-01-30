import { test, expect } from '@playwright/test';
import { createAndOpenDatabase, runSqlStatements, openTable, waitForReady } from './helpers/app';

const DB_NAME = 'grid-read-db';
const LONG_TEXT = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.';

async function setupDatabase(page: import('@playwright/test').Page) {
  await createAndOpenDatabase(page, DB_NAME);
  await runSqlStatements(page, [
    `CREATE TABLE items (
      id INTEGER PRIMARY KEY,
      name TEXT,
      price REAL,
      qty INTEGER,
      notes TEXT,
      data BLOB,
      empty_text TEXT,
      generated TEXT GENERATED ALWAYS AS (name || '-' || qty) STORED
    )`,
    `INSERT INTO items (id, name, price, qty, notes, data, empty_text)
      VALUES
        (1, 'Alpha', 12.5, 2, NULL, X'01020304', ''),
        (2, 'Beta', 7.25, 5, '${LONG_TEXT}', X'FF', ''),
        (3, 'Gamma', 3.0, 1, '', NULL, '')`,
    `CREATE TABLE empty_table (id INTEGER PRIMARY KEY, name TEXT)`,
    `CREATE TABLE big_table (id INTEGER PRIMARY KEY, label TEXT)`,
    `WITH RECURSIVE cnt(x) AS (
      SELECT 1
      UNION ALL
      SELECT x + 1 FROM cnt WHERE x < 1200
    )
    INSERT INTO big_table (id, label)
    SELECT x, 'Item ' || x FROM cnt`,
  ]);
  await waitForReady(page);
}

test.describe('Grid reading (real UI)', () => {
  test.beforeEach(async ({ page }) => {
    await setupDatabase(page);
  });

  test('virtual scrolling renders subset of rows and updates on scroll', async ({ page }) => {
    await openTable(page, DB_NAME, 'big_table');

    const rows = page.locator('[data-row-index]');
    const initialCount = await rows.count();
    expect(initialCount).toBeGreaterThan(0);
    expect(initialCount).toBeLessThan(200);

    const firstRow = rows.first();
    const firstIndex = Number(await firstRow.getAttribute('data-row-index'));

    const gridContainer = page.locator('[data-testid="data-grid"]').first();
    await gridContainer.evaluate((el) => {
      const scrollEl = el.querySelector('.overflow-auto');
      if (scrollEl) {
        scrollEl.scrollTop = scrollEl.scrollHeight;
      }
    });
    await page.waitForTimeout(150);

    const lastRow = rows.last();
    const lastIndex = Number(await lastRow.getAttribute('data-row-index'));
    expect(lastIndex).toBeGreaterThan(firstIndex + 100);
  });

  test('sorting toggles and updates visible order', async ({ page }) => {
    await openTable(page, DB_NAME, 'items');

    const priceHeader = page.getByRole('columnheader', { name: /price/i });
    await priceHeader.click();
    await expect(page.getByTestId('sort-indicator-price')).toBeVisible();

    const firstPrice = page.getByTestId('cell-0-price');
    await expect(firstPrice).toHaveText('3');

    await priceHeader.click();
    const sortIndicator = page.getByTestId('sort-indicator-price');
    await expect(sortIndicator).toBeVisible();

    const firstPriceDesc = page.getByTestId('cell-0-price');
    await expect(firstPriceDesc).toHaveText('12.5');
  });

  test('text filter narrows rows and shows active filter status', async ({ page }) => {
    await openTable(page, DB_NAME, 'items');

    await page.getByTestId('filter-icon-name').click();
    await expect(page.getByTestId('filter-popover-name')).toBeVisible();
    await page.getByTestId('filter-operator-name').selectOption('contains');
    await page.getByTestId('filter-value-name').fill('Beta');
    await page.getByTestId('filter-apply-name').click();

    await expect(page.getByTestId('filter-status-bar')).toBeVisible();
    const visibleRows = page.locator('[data-row-index]');
    await expect(visibleRows).toHaveCount(1);
    await expect(page.getByTestId('cell-0-name')).toHaveText('Beta');
  });

  test('numeric and null filters apply correctly', async ({ page }) => {
    await openTable(page, DB_NAME, 'items');

    await page.getByTestId('filter-icon-price').click();
    await page.getByTestId('filter-operator-price').selectOption('gt');
    await page.getByTestId('filter-value-price').fill('10');
    await page.getByTestId('filter-apply-price').click();

    await page.getByTestId('filter-icon-notes').click();
    await page.getByTestId('filter-operator-notes').selectOption('is_null');
    await page.getByTestId('filter-apply-notes').click();

    await expect(page.getByTestId('filter-status-bar')).toBeVisible();
    const rows = page.locator('[data-row-index]');
    await expect(rows).toHaveCount(1);
    await expect(page.getByTestId('cell-0-name')).toHaveText('Alpha');
  });

  test('NULL and BLOB cells render with correct labels', async ({ page }) => {
    await openTable(page, DB_NAME, 'items');

    const nullCell = page.getByTestId('cell-0-notes');
    await expect(nullCell.getByTestId('cell-null')).toBeVisible();
    await expect(nullCell.getByLabel('NULL value')).toBeVisible();

    const blobCell = page.getByTestId('cell-0-data');
    await expect(blobCell.getByTestId('cell-blob')).toHaveText('[BLOB, 4 bytes]');
    await expect(blobCell.getByLabel('Binary data, 4 bytes')).toBeVisible();
  });

  test('generated column shows indicator and tooltip', async ({ page }) => {
    await openTable(page, DB_NAME, 'items');

    const generatedHeader = page.getByRole('columnheader', { name: /generated/i });
    await expect(generatedHeader).toBeVisible();
    await expect(generatedHeader).toContainText('⚡');
  });

  test('type indicators render for common types', async ({ page }) => {
    await openTable(page, DB_NAME, 'items');

    await expect(page.getByRole('columnheader', { name: /123\s*id/i })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: /Aa\s*name/i })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: /1\.2\s*price/i })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: /01\s*data/i })).toBeVisible();
  });

  test('row selection checkbox and select-all are present', async ({ page }) => {
    await openTable(page, DB_NAME, 'items');
    await expect(page.getByTestId('row-checkbox-0')).toBeVisible();
    await expect(page.getByTestId('select-all-checkbox')).toBeVisible();
  });

  test('empty table shows "No data" message', async ({ page }) => {
    await openTable(page, DB_NAME, 'empty_table');
    await expect(page.getByText('No data')).toBeVisible();
  });

  test('empty strings render as empty cells', async ({ page }) => {
    await openTable(page, DB_NAME, 'items');
    const emptyCell = page.getByTestId('cell-0-empty_text');
    await expect(emptyCell.getByTestId('cell-empty')).toBeVisible();
  });

  test('long text values are truncated with ellipsis and title', async ({ page }) => {
    await openTable(page, DB_NAME, 'items');
    const longCell = page.getByTestId('cell-1-notes');
    const truncatedSpan = longCell.locator('span[title]');
    await expect(truncatedSpan).toHaveAttribute('title', LONG_TEXT);
    await expect(truncatedSpan).toContainText('…');
  });

  test('numeric values use tabular-nums styling', async ({ page }) => {
    await openTable(page, DB_NAME, 'items');
    const priceCell = page.getByTestId('cell-0-price');
    await expect(priceCell.locator('.tabular-nums')).toBeVisible();
  });

  test('row height and resize handle styles are applied', async ({ page }) => {
    await openTable(page, DB_NAME, 'items');

    const row = page.locator('[data-row-index]').first();
    const height = await row.evaluate((el) => getComputedStyle(el).height);
    expect(height).toBe('32px');

    const resizeHandle = page.locator('.cursor-col-resize').first();
    await expect(resizeHandle).toBeVisible();
  });

  test('table view shows ready state and welcome UI initially', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('welcome-screen')).toBeVisible();
    await expect(page.getByTestId('new-database-button')).toBeVisible();
    await expect(page.getByTestId('import-database-button')).toBeVisible();
    await expect(page.getByTestId('status-bar')).toContainText('Ready');
  });
});
