import { expect, type Page } from '@playwright/test';

/**
 * Dismiss the UnsavedPrompt modal if it appears.
 * This modal blocks navigation when there are unsaved changes.
 * In tests, we typically want to discard changes and continue.
 */
export async function dismissUnsavedPromptIfVisible(page: Page, timeout = 2000) {
  const discardButton = page.getByTestId('unsaved-prompt-discard');
  try {
    await discardButton.waitFor({ state: 'visible', timeout });
    await discardButton.click();
    // Wait for modal to close
    await page.getByTestId('unsaved-prompt-backdrop').waitFor({ state: 'hidden', timeout: 2000 });
  } catch {
    // Modal didn't appear, which is fine
  }
}

export async function waitForReady(page: Page) {
  await page.waitForLoadState('networkidle');
  const statusBar = page.locator('[data-testid="status-bar"]');
  await expect(statusBar).toBeVisible({ timeout: 15000 });
  await page.waitForFunction(() => {
    const status = document.querySelector('[data-testid="status-bar"]');
    if (!status) return false;
    const saveStatus = document.querySelector('[data-testid="save-status"]');
    if (saveStatus) return true;
    return status.textContent?.includes('Ready') ?? false;
  });
}

async function waitForWorkerReady(page: Page) {
  await page.waitForFunction(async () => {
    const api = (window as Window & { __sqliteEditorTest?: { getRegistry?: () => Promise<unknown> } }).__sqliteEditorTest;
    if (!api?.getRegistry) return false;
    const registry = await api.getRegistry();
    return registry !== null;
  }, { timeout: 15000 });
}

export async function createAndOpenDatabase(page: Page, dbName: string) {
  await page.goto('/');
  await expect(page.locator('[data-testid="welcome-screen"]')).toBeVisible();
  await waitForWorkerReady(page);
  await page.getByTestId('new-database-button').click();
  await expect(page.getByTestId('new-database-dialog')).toBeVisible();
  await page.getByTestId('database-name-input').fill(dbName);
  const createButton = page.getByTestId('create-button');
  await expect(createButton).toBeEnabled({ timeout: 5000 });
  await createButton.click();
  // Handle UnsavedPrompt modal if it appears (e.g., from previous unsaved changes)
  // This can appear BEFORE the new-database-dialog closes
  await dismissUnsavedPromptIfVisible(page);
  // Wait for both the new-database-dialog and any UnsavedPrompt to be hidden
  await expect(page.getByTestId('new-database-dialog')).toBeHidden({ timeout: 10000 });
  const recent = page.getByTestId(`recent-db-${dbName}`);
  if (await recent.isVisible().catch(() => false)) {
    await recent.click();
    // Handle UnsavedPrompt again if it appears when opening the database
    await dismissUnsavedPromptIfVisible(page);
  }
  await waitForReady(page);
  await expect(page.getByTestId('tab-sql')).toBeVisible({ timeout: 15000 });
}

export async function openDatabaseFromWelcome(page: Page, dbName: string) {
  await waitForWorkerReady(page);
  await expect(page.getByTestId('welcome-screen')).toBeVisible({ timeout: 15000 });
  await page.waitForFunction(async (name: string) => {
    const api = (window as Window & { __sqliteEditorTest?: { getRegistry?: () => Promise<unknown> } }).__sqliteEditorTest;
    if (!api?.getRegistry) return false;
    const registry = await api.getRegistry();
    if (!registry || typeof registry !== 'object' || !('databases' in registry)) return false;
    const databases = (registry as { databases?: Array<{ name: string }> }).databases ?? [];
    return databases.some((db) => db.name === name);
  }, dbName, { timeout: 15000 });
  const recent = page.getByTestId(`recent-db-${dbName}`);
  if (await recent.isVisible().catch(() => false)) {
    await recent.click();
  } else {
    const dbRow = page.getByTestId(`db-row-${dbName}`);
    await expect(dbRow).toBeVisible({ timeout: 15000 });
    await dbRow.click();
  }
  // Handle UnsavedPrompt modal if it appears when switching databases
  await dismissUnsavedPromptIfVisible(page);
  await waitForReady(page);
  await expect(page.getByTestId('tab-sql')).toBeVisible({ timeout: 15000 });
}

export async function runSql(page: Page, sql: string) {
  await page.getByTestId('tab-sql').click();
  // Handle UnsavedPrompt modal if it appears when switching to SQL tab
  await dismissUnsavedPromptIfVisible(page);
  const directInput = page.getByTestId('sql-input');
  if (await directInput.count()) {
    await directInput.fill(sql, { force: true });
  } else {
    const editor = page.getByTestId('codemirror-editor');
    await expect(editor).toBeVisible({ timeout: 10000 });
    const content = editor.locator('.cm-content');
    if (await content.count()) {
      await content.click();
    } else {
      await editor.click();
    }
    await page.keyboard.press('Control+A');
    await page.keyboard.type(sql);
  }
  await expect(page.getByTestId('run-button')).toBeEnabled();
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
  // Handle UnsavedPrompt modal if it appears when switching tables
  await dismissUnsavedPromptIfVisible(page);
  await expect(page.getByTestId('data-grid')).toBeVisible({ timeout: 10000 });
}

export async function openViewTab(page: Page, name: 'Table' | 'SQL' | 'Designer' | 'Query Builder' | 'ERD') {
  const mapping: Record<typeof name, string> = {
    Table: 'tab-table',
    SQL: 'tab-sql',
    Designer: 'tab-designer',
    'Query Builder': 'tab-query-builder',
    ERD: 'tab-erd',
  };
  await page.getByTestId(mapping[name]).click();
  // Handle UnsavedPrompt modal if it appears when switching tabs
  await dismissUnsavedPromptIfVisible(page);
}
