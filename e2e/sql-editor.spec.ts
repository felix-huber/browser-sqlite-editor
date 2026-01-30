import { test, expect } from '@playwright/test';
import { createAndOpenDatabase, runSqlStatements, runSql, openTable, openDatabaseFromWelcome, waitForReady } from './helpers/app';

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

  test('read-only warning appears when database is opened read-only', async ({ context }) => {
    const secondPage = await context.newPage();
    await secondPage.goto('/');
    await openDatabaseFromWelcome(secondPage, DB_NAME);
    await secondPage.getByRole('button', { name: 'SQL' }).click();
    await expect(secondPage.getByTestId('readonly-warning')).toBeVisible();
  });
});
