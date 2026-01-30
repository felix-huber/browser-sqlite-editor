import { expect, type Page } from '@playwright/test';

export async function waitForReady(page: Page) {
  await page.waitForLoadState('networkidle');
  await expect(page.locator('[data-testid="status-bar"]')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('[data-testid="status-bar"]')).toContainText('Ready');
}

export async function createAndOpenDatabase(page: Page, dbName: string) {
  await page.goto('/');
  await expect(page.locator('[data-testid="welcome-screen"]')).toBeVisible();
  await page.getByTestId('new-database-button').click();
  await expect(page.getByTestId('new-database-dialog')).toBeVisible();
  await page.getByTestId('database-name-input').fill(dbName);
  await page.getByTestId('create-button').click();
  await expect(page.getByTestId('new-database-dialog')).toBeHidden({ timeout: 5000 });
  await expect(page.getByTestId(`recent-db-${dbName}`)).toBeVisible({ timeout: 5000 });
  await page.getByTestId(`recent-db-${dbName}`).click();
  await waitForReady(page);
}

export async function openDatabaseFromWelcome(page: Page, dbName: string) {
  await expect(page.getByTestId(`recent-db-${dbName}`)).toBeVisible({ timeout: 5000 });
  await page.getByTestId(`recent-db-${dbName}`).click();
  await waitForReady(page);
}

export async function runSql(page: Page, sql: string) {
  await page.getByRole('button', { name: 'SQL' }).click();
  const editor = page.getByTestId('codemirror-editor');
  await expect(editor).toBeVisible({ timeout: 10000 });
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type(sql);
  await page.getByTestId('run-button').click();
  await page.waitForSelector('[data-testid="results-table"], [data-testid="empty-results"], [data-testid="error-display"]', { timeout: 15000 });
}

export async function runSqlStatements(page: Page, statements: string[]) {
  const sql = statements.filter(Boolean).join(';\n') + ';';
  await runSql(page, sql);
}

export async function createDatabaseWithTable(
  page: Page,
  dbName: string,
  createTableSql: string,
  inserts: string[] = []
) {
  await createAndOpenDatabase(page, dbName);
  await runSqlStatements(page, [createTableSql, ...inserts]);
}

export async function expandDatabaseInSidebar(page: Page, dbName: string) {
  const dbTree = page.getByTestId(`db-tree-${dbName}`);
  await expect(dbTree).toBeVisible({ timeout: 5000 });
  const expanded = await dbTree.getAttribute('aria-expanded');
  if (expanded !== 'true') {
    const dbRow = page.getByTestId(`db-row-${dbName}`);
    await dbRow.click();
  }
}

export async function openTable(page: Page, dbName: string, tableName: string) {
  await expandDatabaseInSidebar(page, dbName);
  const item = page.getByTestId(`item-table-${tableName}`);
  await expect(item).toBeVisible({ timeout: 5000 });
  await item.click();
  await expect(page.getByTestId('data-grid')).toBeVisible({ timeout: 10000 });
}

export async function openViewTab(page: Page, name: 'Table' | 'SQL' | 'Designer' | 'Query Builder' | 'ERD') {
  await page.getByRole('button', { name }).click();
}
