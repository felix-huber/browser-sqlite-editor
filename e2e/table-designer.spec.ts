import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import {
  createAndOpenDatabase,
  openDatabaseFromWelcome,
  openTable,
  runSql,
  waitForReady,
  expandDatabaseInSidebar,
} from './helpers/app';

/**
 * E2E Tests for Table Designer
 */

const DB_PREFIX = 'table-designer-db';

function createUniqueDbName() {
  return `${DB_PREFIX}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const BASE_SQL = `
PRAGMA foreign_keys = ON;
CREATE TABLE people (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  age INTEGER,
  note TEXT
);
INSERT INTO people (name, age, note) VALUES ('Ada', 30, 'Note');
CREATE INDEX idx_people_name ON people(name);
CREATE TRIGGER people_update AFTER UPDATE ON people BEGIN UPDATE people SET note = note; END;

CREATE TABLE generated_table (
  id INTEGER PRIMARY KEY,
  name TEXT,
  name_upper TEXT GENERATED ALWAYS AS (UPPER(name)) STORED
);
`;

async function setupEmptyDb(page: Page) {
  const dbName = createUniqueDbName();
  await createAndOpenDatabase(page, dbName);
  return dbName;
}

async function setupDbWithTables(page: Page) {
  const dbName = createUniqueDbName();
  await createAndOpenDatabase(page, dbName);
  await runSql(page, BASE_SQL);
  return dbName;
}

async function openDesigner(page: Page) {
  await page.getByTestId('tab-designer').click();
  await expect(page.getByTestId('table-designer')).toBeVisible();
}

async function openDesignerForTable(page: Page, dbName: string, tableName: string) {
  await openTable(page, dbName, tableName);
  await openDesigner(page);
}

function columnNameInputs(page: Page) {
  return page.locator('[data-testid^="column-name-"]');
}

function columnTypeInputs(page: Page) {
  return page.locator('[data-testid^="column-type-"]');
}

function columnRows(page: Page) {
  return page.locator('[data-testid^="column-row-"]');
}

// =============================================================================
// Test Suites
// =============================================================================

test.describe('Table Designer - Create Mode', () => {
  let dbName = '';
  test.beforeEach(async ({ page }) => {
    dbName = await setupEmptyDb(page);
    await openDesigner(page);
  });

  test('table designer renders core controls', async ({ page }) => {
    await expect(page.getByTestId('table-designer')).toBeVisible();
    await expect(page.getByTestId('table-name-input')).toBeVisible();
    await expect(page.getByTestId('add-column-button')).toBeVisible();
    await expect(page.getByTestId('submit-button')).toBeVisible();
  });

  test('validates empty table name', async ({ page }) => {
    const nameInput = page.getByTestId('table-name-input');
    await nameInput.fill('temp');
    await nameInput.fill('');
    await page.waitForTimeout(400);
    await expect(page.getByTestId('table-name-error')).toBeVisible();
  });

  test('validates table name with spaces', async ({ page }) => {
    await page.getByTestId('table-name-input').fill('bad name');
    await page.waitForTimeout(400);
    await expect(page.getByTestId('table-name-error')).toContainText('cannot contain spaces');
  });

  test('rejects reserved table name', async ({ page }) => {
    await page.getByTestId('table-name-input').fill('select');
    await page.waitForTimeout(400);
    await expect(page.getByTestId('table-name-error')).toContainText('reserved word');
  });

  test('rejects invalid table name characters', async ({ page }) => {
    await page.getByTestId('table-name-input').fill('1bad');
    await page.waitForTimeout(400);
    await expect(page.getByTestId('table-name-error')).toContainText('must start');
  });

  test('add column button adds new column row', async ({ page }) => {
    const initialCount = await columnRows(page).count();
    await page.getByTestId('add-column-button').click();
    await expect(columnRows(page)).toHaveCount(initialCount + 1);
  });

  test('validates empty column name', async ({ page }) => {
    const nameInput = columnNameInputs(page).first();
    await nameInput.focus();
    await nameInput.blur();
    await expect(page.locator('[data-testid^="column-name-error-"]')).toBeVisible();
  });

  test('rejects duplicate column names', async ({ page }) => {
    await page.getByTestId('add-column-button').click();
    const inputs = columnNameInputs(page);
    await inputs.nth(0).fill('id');
    await inputs.nth(1).fill('id');
    await inputs.nth(1).blur();
    await expect(page.locator('[data-testid^="column-name-error-"]')).toContainText('already exists');
  });

  test('PK toggle enforces NOT NULL', async ({ page }) => {
    const pkButton = page.locator('[data-testid^="column-pk-"]').first();
    const nnButton = page.locator('[data-testid^="column-nn-"]').first();
    await pkButton.click();
    await expect(nnButton).toHaveClass(/bg-blue-100/);
  });

  test('dirty indicator appears after changes', async ({ page }) => {
    await page.getByTestId('table-name-input').fill('people');
    await expect(page.getByTestId('dirty-indicator')).toBeVisible();
  });

  test('creates table via designer and shows in sidebar', async ({ page }) => {
    await page.getByTestId('table-name-input').fill('projects');
    await columnNameInputs(page).first().fill('id');
    await columnTypeInputs(page).first().fill('INTEGER');
    await page.locator('[data-testid^="column-pk-"]').first().click();
    await expect(page.getByTestId('submit-button')).toBeEnabled({ timeout: 15000 });
    await page.getByTestId('submit-button').click();
    await expect(page.getByTestId('table-title')).toContainText('projects', { timeout: 15000 });
    await expandDatabaseInSidebar(page, dbName);
    await expect(page.getByTestId('item-table-projects')).toBeVisible();
  });
});

test.describe('Table Designer - Edit Mode', () => {
  let dbName = '';
  test.beforeEach(async ({ page }) => {
    dbName = await setupDbWithTables(page);
  });

  test('diff preview appears for existing table', async ({ page }) => {
    await openDesignerForTable(page, dbName, 'people');
    await expect(page.getByTestId('ddl-diff-preview')).toBeVisible();
  });

  test('diff preview updates when columns change', async ({ page }) => {
    await openDesignerForTable(page, dbName, 'people');
    await columnNameInputs(page).first().fill('id_updated');
    await expect(page.getByTestId('diff-view')).toBeVisible();
  });

  test('rename table updates sidebar entry', async ({ page }) => {
    await openDesignerForTable(page, dbName, 'people');
    await page.getByTestId('table-name-input').fill('people_renamed');
    await expect(page.getByTestId('table-name-input')).toHaveValue('people_renamed');
    await expect(page.getByTestId('submit-button')).toBeEnabled({ timeout: 15000 });
    await page.getByTestId('submit-button').click();
    await expect(page.getByTestId('table-title')).toContainText('people_renamed', { timeout: 15000 });
    await expandDatabaseInSidebar(page, dbName);
    await expect(page.getByTestId('item-table-people_renamed')).toBeVisible();
  });

  test('add column to existing table', async ({ page }) => {
    await openDesignerForTable(page, dbName, 'people');
    await page.getByTestId('add-column-button').click();
    await columnNameInputs(page).last().fill('status');
    await columnTypeInputs(page).last().fill('TEXT');
    await expect(page.getByTestId('submit-button')).toBeEnabled({ timeout: 15000 });
    await page.getByTestId('submit-button').click();
    await expect(page.getByTestId('table-title')).toContainText('people', { timeout: 15000 });
    await expect(page.getByTestId('cell-0-status')).toBeVisible();
  });

  test('delete existing column requires confirmation', async ({ page }) => {
    await openDesignerForTable(page, dbName, 'people');
    const deleteButton = page.locator('[data-testid^="column-delete-"]').nth(2);
    await deleteButton.click();
    await expect(page.locator('[data-testid^="column-delete-confirm-"]')).toBeVisible();
  });

  test('column rebuild preserves data', async ({ page }) => {
    await openDesignerForTable(page, dbName, 'people');
    const deleteButton = page.locator('[data-testid^="column-delete-"]').nth(2);
    await deleteButton.click();
    await page.locator('[data-testid^="column-confirm-delete-"]').first().click();
    await expect(page.getByTestId('submit-button')).toBeEnabled({ timeout: 15000 });
    await page.getByTestId('submit-button').click();
    await expect(page.getByTestId('table-title')).toContainText('people', { timeout: 15000 });
    await expect(page.getByTestId('cell-0-name')).toContainText('Ada');
  });

  test('indexes and triggers survive rebuild', async ({ page }) => {
    await openDesignerForTable(page, dbName, 'people');
    const deleteButton = page.locator('[data-testid^="column-delete-"]').nth(2);
    await deleteButton.click();
    await page.locator('[data-testid^="column-confirm-delete-"]').first().click();
    await expect(page.getByTestId('submit-button')).toBeEnabled({ timeout: 15000 });
    await page.getByTestId('submit-button').click();

    await expect(page.getByTestId('table-title')).toContainText('people', { timeout: 15000 });
    await page.getByTestId('tab-sql').click();
    await runSql(page, `SELECT name FROM sqlite_master WHERE type='index' AND name='idx_people_name';`);
    await expect(page.getByTestId('results-table')).toBeVisible();
    await expect(page.locator('[data-testid="results-table"]')).toContainText('idx_people_name');

    await runSql(page, `SELECT name FROM sqlite_master WHERE type='trigger' AND name='people_update';`);
    await expect(page.locator('[data-testid="results-table"]')).toContainText('people_update');
  });

  test('generated columns are read-only in designer', async ({ page }) => {
    await openDesignerForTable(page, dbName, 'generated_table');
    const generatedBadge = page.locator('[data-testid^="column-generated-"]');
    await expect(generatedBadge).toBeVisible();
    const nameInput = columnNameInputs(page).nth(2);
    await expect(nameInput).toBeDisabled();
  });
});

test.describe('Table Designer - Read Only Mode', () => {
  test('read-only mode blocks edits', async ({ page }) => {
    const dbName = await setupDbWithTables(page);
    const reader = await page.context().newPage();
    await reader.goto('/');
    await openDatabaseFromWelcome(reader, dbName);
    await openDesignerForTable(reader, dbName, 'people');
    await expect(reader.getByTestId('readonly-notice')).toBeVisible();
    await expect(reader.getByTestId('table-name-input')).toBeDisabled();
    await reader.close();
  });
});

// =============================================================================
// Basic UI Checks
// =============================================================================

test.describe('Table Designer Integration Checks', () => {
  test('welcome screen visible on load', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('welcome-screen')).toBeVisible();
  });

  test('status bar ready state', async ({ page }) => {
    await page.goto('/');
    await waitForReady(page);
  });
});
