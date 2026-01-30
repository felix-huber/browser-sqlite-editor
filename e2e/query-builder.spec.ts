import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import {
  createAndOpenDatabase,
  runSql,
  waitForReady,
} from './helpers/app';

/**
 * E2E Tests for Query Builder
 */

const DB_NAME = 'query-builder-db';

const BASE_SQL = `
PRAGMA foreign_keys = ON;
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  age INTEGER
);
INSERT INTO users (name, age) VALUES
  ('Alice', 30),
  ('Bob', 25),
  ('Charlie', 40);

CREATE TABLE orders (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  total REAL,
  created_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
INSERT INTO orders (user_id, total, created_at) VALUES
  (1, 120.50, '2024-01-10'),
  (2, 42.00, '2024-01-11');
`;

async function setupQueryDb(page: Page) {
  await createAndOpenDatabase(page, DB_NAME);
  await runSql(page, BASE_SQL);
  await page.getByTestId('tab-query-builder').click();
  await expect(page.getByTestId('query-builder-view')).toBeVisible();
}

async function dragTable(page: Page, tableName: string) {
  const tableItem = page.getByTestId(`table-item-${tableName}`);
  await expect(tableItem).toBeVisible();
  await tableItem.dragTo(page.getByTestId('query-builder-canvas'), { force: true });
}

function getTableBox(page: Page, tableName: string) {
  return page.locator('[data-testid="table-box"]', { hasText: tableName });
}

async function connectJoin(page: Page) {
  const usersBox = getTableBox(page, 'users');
  const ordersBox = getTableBox(page, 'orders');
  await usersBox.hover();
  await ordersBox.hover();
  const source = usersBox.locator('[data-handleid="id-source"]');
  const target = ordersBox.locator('[data-handleid="user_id-target"]');
  await expect(source).toBeVisible();
  await expect(target).toBeVisible();
  await source.click({ force: true });
  await target.click({ force: true });
  await page.waitForTimeout(200);
  if (await page.getByTestId('join-count').isVisible()) {
    return;
  }
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  if (!sourceBox || !targetBox) {
    throw new Error('Join handles not visible for drag');
  }
  await page.mouse.move(
    sourceBox.x + sourceBox.width / 2,
    sourceBox.y + sourceBox.height / 2
  );
  await page.mouse.down();
  await page.mouse.move(
    targetBox.x + targetBox.width / 2,
    targetBox.y + targetBox.height / 2,
    { steps: 24 }
  );
  await page.waitForTimeout(100);
  await page.mouse.up();
  await page.waitForTimeout(200);
}

// =============================================================================
// Test Suites
// =============================================================================

test.describe('Query Builder', () => {
  test.beforeEach(async ({ page }) => {
    await setupQueryDb(page);
  });

  test('table list shows available tables', async ({ page }) => {
    await expect(page.getByTestId('table-item-users')).toBeVisible();
    await expect(page.getByTestId('table-item-orders')).toBeVisible();
  });

  test('dragging table adds it to the canvas', async ({ page }) => {
    await dragTable(page, 'users');
    await expect(getTableBox(page, 'users')).toBeVisible();
  });

  test('table item disables after adding to canvas', async ({ page }) => {
    await dragTable(page, 'users');
    await expect(page.getByTestId('table-item-users')).toHaveAttribute('aria-disabled', 'true');
  });

  test('selecting columns updates SQL preview', async ({ page }) => {
    await dragTable(page, 'users');
    const usersBox = getTableBox(page, 'users');
    await usersBox.locator('[data-testid="select-all-button"]').click();
    await expect(page.getByTestId('sql-preview-text')).toContainText('SELECT');
    await expect(page.getByTestId('sql-preview-text')).toContainText('users');
  });

  test('creating a join updates SQL preview and join count', async ({ page }) => {
    await dragTable(page, 'users');
    await dragTable(page, 'orders');
    await connectJoin(page);
    await expect(page.getByTestId('join-count')).toContainText('1');
    await expect(page.getByTestId('sql-preview-text')).toContainText('JOIN');
  });

  test('where builder adds conditions to SQL', async ({ page }) => {
    await dragTable(page, 'users');
    await page.getByTestId('add-condition-button').click();
    const columnSelect = page.locator('[data-testid^="condition-column-"]').first();
    await columnSelect.selectOption({ index: 1 });
    const valueInput = page.locator('[data-testid^="condition-value-"]').first();
    await valueInput.fill('Alice');
    await expect(page.getByTestId('sql-preview-text')).toContainText('WHERE');
  });

  test('order by builder adds sorting', async ({ page }) => {
    await dragTable(page, 'users');
    await page.getByTestId('add-sort-button').click();
    const sortSelect = page.locator('[data-testid^="sort-column-select-"]').first();
    await sortSelect.selectOption({ index: 1 });
    await expect(page.getByTestId('sql-preview-text')).toContainText('ORDER BY');
  });

  test('limit control updates SQL', async ({ page }) => {
    await dragTable(page, 'users');
    await page.getByTestId('limit-toggle').click();
    await page.getByTestId('limit-input').fill('5');
    await expect(page.getByTestId('sql-preview-text')).toContainText('LIMIT 5');
  });

  test('run query returns results', async ({ page }) => {
    await dragTable(page, 'users');
    const usersBox = getTableBox(page, 'users');
    await usersBox.locator('[data-testid="select-all-button"]').click();
    await page.getByTestId('run-button').click();
    await expect(page.getByTestId('results-section')).toBeVisible();
    await expect(page.getByTestId('sql-results-display')).toBeVisible();
  });

  test('open in SQL editor loads query', async ({ page }) => {
    await dragTable(page, 'users');
    const usersBox = getTableBox(page, 'users');
    await usersBox.locator('[data-testid="select-all-button"]').click();
    await page.getByTestId('open-in-editor-button').click();
    await expect(page.getByTestId('sql-editor-panel')).toBeVisible();
    await expect(page.getByTestId('run-button')).toBeEnabled();
  });

  test('clear canvas removes tables', async ({ page }) => {
    await dragTable(page, 'users');
    await page.getByTestId('clear-canvas-button').click();
    await expect(page.locator('[data-testid="table-box"]')).toHaveCount(0);
    await expect(page.getByTestId('empty-state')).toBeVisible();
  });
});

// =============================================================================
// Basic UI Checks
// =============================================================================

test.describe('Query Builder Integration Checks', () => {
  test('welcome screen visible on load', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('welcome-screen')).toBeVisible();
  });

  test('status bar ready state', async ({ page }) => {
    await page.goto('/');
    await waitForReady(page);
  });
});
