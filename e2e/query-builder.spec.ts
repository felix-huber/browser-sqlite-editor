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
  // Use force:true to avoid interception issues when tables overlap
  await usersBox.hover({ force: true });
  await ordersBox.hover({ force: true });
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
// PRD E2E Scenarios
// =============================================================================

test.describe('Query Builder PRD Scenarios', () => {
  test.beforeEach(async ({ page }) => {
    await setupQueryDb(page);
  });

  /**
   * E2E-US-006-01: Join 2 tables, select 3 cols, add WHERE condition;
   * verify deterministic SQL output and parameterized values.
   */
  test('E2E-US-006-01: deterministic SQL with parameterized WHERE', async ({ page }) => {
    // 1. Add both tables to canvas
    await dragTable(page, 'users');
    await dragTable(page, 'orders');

    // 2. Create join between users.id and orders.user_id
    await connectJoin(page);
    await expect(page.getByTestId('join-count')).toContainText('1');

    // 3. Select specific columns from users (name) and orders (total, created_at) = 3 cols
    const usersBox = getTableBox(page, 'users');
    const ordersBox = getTableBox(page, 'orders');

    // Click on specific columns in users table (force: true to bypass overlays)
    await usersBox.locator('[data-testid="column-checkbox-1"]').click({ force: true }); // name

    // Click on specific columns in orders table
    // Note: orders columns are: 0=id, 1=user_id, 2=total, 3=created_at
    // Scroll into view and use evaluate to trigger the change event for better reliability
    const totalCheckbox = ordersBox.locator('[data-testid="column-checkbox-2"]');
    await totalCheckbox.scrollIntoViewIfNeeded();
    await totalCheckbox.evaluate((el: HTMLInputElement) => el.click()); // total
    await expect(totalCheckbox).toBeChecked();

    const createdAtCheckbox = ordersBox.locator('[data-testid="column-checkbox-3"]');
    await createdAtCheckbox.scrollIntoViewIfNeeded();
    await createdAtCheckbox.evaluate((el: HTMLInputElement) => el.click()); // created_at
    await expect(createdAtCheckbox).toBeChecked();

    // 4. Add WHERE condition: name = 'Alice'
    // Column options are in format: alias."column" (TYPE) e.g. t1."name" (TEXT)
    await page.getByTestId('add-condition-button').click();
    const columnSelect = page.locator('[data-testid^="condition-column-"]').first();
    // Column options: 0=Select column..., 1=t1."id", 2=t1."name", 3=t1."age", 4+=orders columns
    await columnSelect.selectOption({ index: 2 }); // t1."name"
    const valueInput = page.locator('[data-testid^="condition-value-"]').first();
    await valueInput.fill('Alice');

    // 5. Verify SQL preview contains expected deterministic structure
    // SQL format: SELECT alias."col" AS "Table.col" FROM "Table" AS alias
    const sqlPreview = page.getByTestId('sql-preview-text');
    await expect(sqlPreview).toContainText('SELECT');
    await expect(sqlPreview).toContainText('t1."name"');
    await expect(sqlPreview).toContainText('AS "users.name"'); // Deterministic alias format
    await expect(sqlPreview).toContainText('t2."total"');
    await expect(sqlPreview).toContainText('AS "orders.total"');
    await expect(sqlPreview).toContainText('t2."created_at"');
    await expect(sqlPreview).toContainText('AS "orders.created_at"');
    await expect(sqlPreview).toContainText('FROM "users" AS t1');
    await expect(sqlPreview).toContainText('JOIN "orders" AS t2');
    await expect(sqlPreview).toContainText('ON t1."id" = t2."user_id"');
    await expect(sqlPreview).toContainText('WHERE');
    await expect(sqlPreview).toContainText('t1.name = ?');

    // 6. Verify parameters are displayed
    const paramsPreview = page.getByTestId('params-preview');
    await expect(paramsPreview).toBeVisible();
    await expect(paramsPreview).toContainText('Alice');

    // 7. Execute the query and verify results
    await page.getByTestId('run-button').click();
    await expect(page.getByTestId('results-section')).toBeVisible();
    await expect(page.getByTestId('execution-status').getByTestId('row-count')).toContainText('1 row');

    // 8. Verify deterministic output - run query again and get same results
    // The SQL generation is deterministic (same inputs produce same SQL)
    // This is verified by re-running and checking the row count remains consistent
    await page.getByTestId('run-button').click();
    await expect(page.getByTestId('execution-status').getByTestId('row-count')).toContainText('1 row');
  });

  /**
   * E2E-US-006-02: Verify that:
   * 1. Adding the same table twice is blocked (table item becomes disabled)
   * 2. When joining tables with same column names, result headers are unique (aliased)
   */
  test('E2E-US-006-02: block duplicate table; unique result headers for same-named columns', async ({ page }) => {
    // Create additional table with same column name as users
    await page.getByTestId('tab-sql').click();
    await runSql(page, `
      CREATE TABLE customers (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT
      );
      INSERT INTO customers (name, email) VALUES ('Customer1', 'c1@test.com');
    `);
    await page.getByTestId('tab-query-builder').click();
    await expect(page.getByTestId('query-builder-view')).toBeVisible();

    // Part 1: Verify duplicate table is blocked
    // Add users table to canvas
    await dragTable(page, 'users');
    await expect(getTableBox(page, 'users')).toBeVisible();

    // Verify users table item is now disabled (aria-disabled="true")
    const usersTableItem = page.getByTestId('table-item-users');
    await expect(usersTableItem).toHaveAttribute('aria-disabled', 'true');

    // Verify the table item is not draggable (draggable="false" or no draggable attr when disabled)
    await expect(usersTableItem).toHaveAttribute('draggable', 'false');

    // Attempt to drag the disabled table - it should not create a second box
    await usersTableItem.dragTo(page.getByTestId('query-builder-canvas'), { force: true });
    // Still only one table box should exist
    await expect(page.locator('[data-testid="table-box"]')).toHaveCount(1);

    // Part 2: Verify unique result headers for columns with same name
    // Add customers table (has 'name' column like users)
    await dragTable(page, 'customers');
    await expect(page.locator('[data-testid="table-box"]')).toHaveCount(2);

    // Select 'name' column from both tables
    const usersBox = getTableBox(page, 'users');
    const customersBox = getTableBox(page, 'customers');
    await expect(customersBox).toBeVisible();

    // Select name column from users (index 1: id=0, name=1, age=2)
    // Use scrollIntoViewIfNeeded and evaluate for reliability (tables may overlap)
    const usersNameCheckbox = usersBox.locator('[data-testid="column-checkbox-1"]');
    await usersNameCheckbox.scrollIntoViewIfNeeded();
    await usersNameCheckbox.evaluate((el: HTMLInputElement) => el.click());
    await expect(usersNameCheckbox).toBeChecked();

    // Select name column from customers (index 1: id=0, name=1, email=2)
    const customersNameCheckbox = customersBox.locator('[data-testid="column-checkbox-1"]');
    await customersNameCheckbox.scrollIntoViewIfNeeded();
    await customersNameCheckbox.evaluate((el: HTMLInputElement) => el.click());
    await expect(customersNameCheckbox).toBeChecked();

    // Verify SQL shows aliased column names for disambiguation
    // Format: alias."col" AS "Table.col" - both 'name' columns get unique aliases
    const sqlPreview = page.getByTestId('sql-preview-text');
    await expect(sqlPreview).toContainText('t1."name"');
    await expect(sqlPreview).toContainText('AS "users.name"');
    await expect(sqlPreview).toContainText('t2."name"');
    await expect(sqlPreview).toContainText('AS "customers.name"');

    // Execute query and verify result headers are unique
    await page.getByTestId('run-button').click();
    await expect(page.getByTestId('results-section')).toBeVisible();

    // Check that result grid has both column headers - each with unique table.column format
    const resultSection = page.getByTestId('results-section');
    // The 'users.name' column header
    await expect(resultSection.getByRole('columnheader', { name: /users\.name/i })).toBeVisible();
    // The 'customers.name' column header
    await expect(resultSection.getByRole('columnheader', { name: /customers\.name/i })).toBeVisible();
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
