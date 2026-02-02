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

/**
 * Close any open database and return to welcome screen.
 * This is useful to ensure test isolation when starting a test that expects
 * the welcome screen to be visible.
 */
export async function ensureWelcomeScreen(page: Page, timeout = 10000) {
  // Check if welcome screen is already visible
  const welcomeScreen = page.locator('[data-testid="welcome-screen"]');
  if (await welcomeScreen.isVisible().catch(() => false)) {
    return; // Already on welcome screen
  }

  // Check if a database is open (SQL tab visible indicates a database is open)
  const sqlTab = page.getByTestId('tab-sql');
  if (await sqlTab.isVisible().catch(() => false)) {
    // A database is open - close it by clicking the Close DB button
    const closeButton = page.getByRole('button', { name: /close.*db/i });
    if (await closeButton.isVisible().catch(() => false)) {
      // Dismiss any unsaved prompt that might appear
      await dismissUnsavedPromptIfVisible(page, 500);
      await closeButton.click();
      // Wait for welcome screen to appear
      await expect(welcomeScreen).toBeVisible({ timeout });
      return;
    }
  }

  // If we got here and welcome screen is not visible, reload the page
  // This handles edge cases where the UI is in an unexpected state
  await page.reload();
  await expect(welcomeScreen).toBeVisible({ timeout });
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
  // Handle the case where a database might already be open from a previous test
  await ensureWelcomeScreen(page);
  // Ensure OPFS directories exist (may have been deleted by test fixtures)
  await page.evaluate(async () => {
    if (navigator.storage?.getDirectory) {
      try {
        const root = await navigator.storage.getDirectory();
        const appDir = await root.getDirectoryHandle('wasm-sqlite-editor', { create: true });
        await appDir.getDirectoryHandle('databases', { create: true });
      } catch {
        // OPFS not available, worker will use IDB fallback
      }
    }
  });
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
  // Increase timeout for CI environments and add retry logic
  try {
    await expect(page.getByTestId('new-database-dialog')).toBeHidden({ timeout: 15000 });
  } catch {
    // If dialog didn't close, check for error and try again
    const createError = page.getByTestId('create-error');
    if (await createError.isVisible().catch(() => false)) {
      throw new Error(`Database creation failed: ${await createError.textContent()}`);
    }
    // Try clicking create again if still visible
    if (await page.getByTestId('new-database-dialog').isVisible().catch(() => false)) {
      const retryButton = page.getByTestId('create-button');
      if (await retryButton.isEnabled().catch(() => false)) {
        await retryButton.click();
        await expect(page.getByTestId('new-database-dialog')).toBeHidden({ timeout: 15000 });
      } else {
        throw new Error('Create dialog stuck - button disabled and dialog still visible');
      }
    }
  }
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
  // Ensure we're on the welcome screen (close any open database first)
  await ensureWelcomeScreen(page);
  await waitForWorkerReady(page);
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
