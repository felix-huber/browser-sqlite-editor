import { test, expect } from '@playwright/test';
import {
  createAndOpenDatabase,
  createAndOpenOpfsDatabase,
  runSqlStatements,
  runSql,
  openTable,
  openDatabaseFromWelcome,
  waitForReady,
} from './helpers/app';

const DB_NAME = 'sql-editor-db';

async function setupDatabase(page: import('@playwright/test').Page) {
  await createAndOpenDatabase(page, DB_NAME);
  await runSqlStatements(page, [
    `CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, age INTEGER)`,
    `INSERT INTO users (name, age) VALUES ('Ada', 31), ('Bob', 42)`,
  ]);
  await waitForReady(page);
}

test.describe('SQL editor (real UI)', () => {
  test.beforeEach(async ({ page }) => {
    await setupDatabase(page);
  });

  /**
   * E2E-US-005-02: Multi-statement script shows DML + SELECT
   * Execute a script containing INSERT followed by SELECT and verify DML result displayed
   * and SELECT confirms persisted data.
   */
  test('E2E-US-005-02: multi-statement script shows DML + SELECT', async ({ page }) => {
    // Run a multi-statement script with INSERT and SELECT
    await runSql(page, `
      INSERT INTO users (name, age) VALUES ('Carol', 28);
      SELECT name, age FROM users WHERE name = 'Carol';
    `);

    // Should show results panel (INSERT result is displayed since it's first DML)
    await expect(page.getByTestId('results-table')).toBeVisible();

    // Verify the INSERT actually persisted by running a fresh SELECT
    await runSql(page, "SELECT name, age FROM users WHERE name = 'Carol'");
    await expect(page.getByTestId('results-table')).toBeVisible();
    await expect(page.getByTestId('cell-0-name')).toHaveText('Carol');
    await expect(page.getByTestId('cell-0-age')).toHaveText('28');
  });

  /**
   * E2E-US-005-03: Mid-script error rolls back
   * Execute a script with explicit BEGIN where mid-statement fails; verify rollback.
   * Note: Without explicit BEGIN, SQLite auto-commits each statement separately.
   */
  test('E2E-US-005-03: mid-script error rolls back', async ({ page }) => {
    // Get initial count
    await runSql(page, 'SELECT COUNT(*) as cnt FROM users');
    const initialCountCell = page.getByTestId('cell-0-cnt');
    const initialCount = await initialCountCell.textContent();

    // Run a script with explicit BEGIN that should fail mid-execution
    // First INSERT is valid, second refers to non-existent table causing error
    await runSql(page, `
      BEGIN;
      INSERT INTO users (name, age) VALUES ('Dave', 35);
      INSERT INTO nonexistent_table (col) VALUES (1);
      COMMIT;
    `);

    // Should show error panel
    await expect(page.getByTestId('error-display')).toBeVisible();

    // Verify the first INSERT was rolled back - count should be unchanged
    await runSql(page, 'SELECT COUNT(*) as cnt FROM users');
    await expect(page.getByTestId('cell-0-cnt')).toHaveText(initialCount!);

    // Double-check: Dave should not exist
    await runSql(page, "SELECT COUNT(*) as cnt FROM users WHERE name = 'Dave'");
    await expect(page.getByTestId('cell-0-cnt')).toHaveText('0');
  });

  /**
   * E2E-US-005-04: Explicit BEGIN then error rolls back
   * Execute BEGIN; INSERT; failing statement; verify INSERT was rolled back.
   */
  test('E2E-US-005-04: explicit BEGIN then error rolls back', async ({ page }) => {
    // Get initial count
    await runSql(page, 'SELECT COUNT(*) as cnt FROM users');
    const initialCountCell = page.getByTestId('cell-0-cnt');
    const initialCount = await initialCountCell.textContent();

    // Run explicit transaction that fails before COMMIT
    await runSql(page, `
      BEGIN;
      INSERT INTO users (name, age) VALUES ('Frank', 40);
      SELECT * FROM nonexistent_table;
      COMMIT;
    `);

    // Should show error panel
    await expect(page.getByTestId('error-display')).toBeVisible();

    // Verify the INSERT was rolled back - count should be unchanged
    await runSql(page, 'SELECT COUNT(*) as cnt FROM users');
    await expect(page.getByTestId('cell-0-cnt')).toHaveText(initialCount!);

    // Double-check: Frank should not exist
    await runSql(page, "SELECT COUNT(*) as cnt FROM users WHERE name = 'Frank'");
    await expect(page.getByTestId('cell-0-cnt')).toHaveText('0');
  });

  /**
   * E2E-US-005-05: BEGIN without COMMIT shows auto-rollback warning
   * Execute BEGIN; INSERT; (no COMMIT); verify warning about orphan transaction.
   */
  test('E2E-US-005-05: BEGIN without COMMIT auto-rollback warning', async ({ page }) => {
    // Get initial count
    await runSql(page, 'SELECT COUNT(*) as cnt FROM users');
    const initialCountCell = page.getByTestId('cell-0-cnt');
    const initialCount = await initialCountCell.textContent();

    // Run a script with BEGIN but no COMMIT
    await runSql(page, `
      BEGIN;
      INSERT INTO users (name, age) VALUES ('Grace', 45);
    `);

    // Should show transaction warning about orphan BEGIN
    await expect(page.getByTestId('transaction-warning')).toBeVisible();
    await expect(page.getByTestId('transaction-warning')).toContainText('auto-rollback');

    // Verify the INSERT was auto-rolled back - count should be unchanged
    await runSql(page, 'SELECT COUNT(*) as cnt FROM users');
    await expect(page.getByTestId('cell-0-cnt')).toHaveText(initialCount!);

    // Double-check: Grace should not exist
    await runSql(page, "SELECT COUNT(*) as cnt FROM users WHERE name = 'Grace'");
    await expect(page.getByTestId('cell-0-cnt')).toHaveText('0');
  });

  test('runs SELECT queries and renders results grid', async ({ page }) => {
    await runSql(page, 'SELECT id, name FROM users ORDER BY id');
    await expect(page.getByTestId('results-table')).toBeVisible();
    await expect(page.getByTestId('cell-0-name')).toHaveText('Ada');
    await expect(page.getByTestId('cell-1-name')).toHaveText('Bob');
  });

  test('shows empty results state for queries with no rows', async ({ page }) => {
    await runSql(page, 'SELECT * FROM users WHERE age > 100');
    await expect(page.getByTestId('select-empty-results')).toBeVisible();
  });

  test('shows rows affected for UPDATE statements', async ({ page }) => {
    await runSql(page, "UPDATE users SET age = 43 WHERE name = 'Bob'");
    await expect(page.getByTestId('update-result')).toBeVisible();
    await expect(page.getByTestId('affected-rows-message')).toContainText('1');
  });

  test('shows DDL success and refreshes sidebar tables', async ({ page }) => {
    await runSql(page, 'CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT)');
    await expect(page.getByTestId('ddl-result')).toBeVisible();

    await openTable(page, DB_NAME, 'projects');
    await expect(page.getByTestId('data-grid')).toBeVisible();
  });

  test('shows error panel for invalid SQL', async ({ page }) => {
    await runSql(page, 'SELCT * FROM users');
    await expect(page.getByTestId('error-display')).toBeVisible();
    await expect(page.getByTestId('sql-error-panel')).toBeVisible();
    await expect(page.getByTestId('error-message-0')).toContainText('syntax');
  });

  test('query history lists executed statements and can re-run', async ({ page }) => {
    await runSql(page, 'SELECT COUNT(*) FROM users');
    await runSql(page, 'SELECT name FROM users WHERE name = "Ada"');

    await page.getByTestId('history-button').click();
    await expect(page.getByTestId('history-dropdown')).toBeVisible();
    await expect(page.getByTestId('history-item-0')).toBeVisible();

    await page.getByTestId('history-item-0').click();
    await page.getByTestId('run-button').click();
    await expect(page.getByTestId('results-table')).toBeVisible();
  });

  /**
   * Test read-only warning when second tab opens database held by first tab.
   * This test uses OPFS storage which supports single-writer locking.
   * The first tab (created in beforeEach) uses IDB, so we create a separate OPFS database.
   */
  test('read-only warning appears when database is opened read-only', async ({ context }) => {
    // Create a fresh OPFS database for this test (separate from DB_NAME which uses IDB)
    const opfsDbName = 'opfs-readonly-test';
    const firstPage = await context.newPage();

    // Tab 1: Create and open an OPFS database with test data
    await createAndOpenOpfsDatabase(firstPage, opfsDbName);
    await runSqlStatements(firstPage, [
      `CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, age INTEGER)`,
      `INSERT INTO users (name, age) VALUES ('Ada', 31), ('Bob', 42)`,
    ]);
    await waitForReady(firstPage);

    // Give the lock time to establish (localStorage heartbeat)
    await firstPage.waitForTimeout(500);

    // Tab 2: Open the same database - should be read-only
    const secondPage = await context.newPage();
    await secondPage.goto('/');
    await openDatabaseFromWelcome(secondPage, opfsDbName);
    await secondPage.getByTestId('tab-sql').click();

    // Try to run an UPDATE query
    const editor = secondPage.getByTestId('sql-input');
    if (await editor.count()) {
      await editor.fill("UPDATE users SET age = 50 WHERE name = 'Ada'", { force: true });
    } else {
      const cm = secondPage.getByTestId('codemirror-editor');
      await expect(cm).toBeVisible();
      await cm.click();
      await secondPage.keyboard.press('Control+A');
      await secondPage.keyboard.type("UPDATE users SET age = 50 WHERE name = 'Ada'");
    }
    await secondPage.getByTestId('run-button').click();

    // Should show read-only warning (either in the ReadOnlyBanner or as an error)
    const readonlyWarning = secondPage.getByTestId('readonly-warning');
    const readonlyBanner = secondPage.getByTestId('readonly-banner');
    await expect(readonlyWarning.or(readonlyBanner)).toBeVisible({ timeout: 10000 });

    // Cleanup
    await firstPage.close();
    await secondPage.close();
  });
});
