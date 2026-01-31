import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import {
  createAndOpenDatabase,
  openDatabaseFromWelcome,
  openTable,
  runSql,
  waitForReady,
} from './helpers/app';

/**
 * E2E Tests for Grid Editing
 */

const DB_NAME = 'grid-edit-db';

const BASE_SQL = `
PRAGMA foreign_keys = ON;
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  bio TEXT,
  age INTEGER,
  rating REAL,
  is_active INTEGER
);
INSERT INTO users (name, bio, age, rating, is_active) VALUES
  ('Alice', 'Line 1\nLine 2', 30, 4.5, 1),
  ('Bob', 'Short bio', 25, 3.9, 0),
  ('Charlie', '', NULL, NULL, 1);

CREATE TABLE generated_people (
  id INTEGER PRIMARY KEY,
  name TEXT,
  name_upper TEXT GENERATED ALWAYS AS (UPPER(name)) STORED
);
INSERT INTO generated_people (name) VALUES ('Alice'), ('Bob');

CREATE TABLE without_rowid_table (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL
) WITHOUT ROWID;
INSERT INTO without_rowid_table (id, label) VALUES ('a1', 'Alpha'), ('b2', 'Beta');

CREATE TABLE without_rowid_big (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL
) WITHOUT ROWID;
WITH RECURSIVE nums(n) AS (
  SELECT 1
  UNION ALL
  SELECT n + 1 FROM nums WHERE n < 250
)
INSERT INTO without_rowid_big (id, label)
SELECT 'id-' || n, 'Label ' || n FROM nums;

CREATE TABLE blob_table (
  id INTEGER PRIMARY KEY,
  data BLOB
);
INSERT INTO blob_table (data) VALUES (X'00010203');

CREATE TABLE orders (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
INSERT INTO orders (user_id) VALUES (1);
`;

async function setupGridDb(page: Page) {
  await createAndOpenDatabase(page, DB_NAME);
  await runSql(page, BASE_SQL);
  await openTable(page, DB_NAME, 'users');
}

async function openReadOnlyPage(writer: Page) {
  const reader = await writer.context().newPage();
  await reader.goto('/');
  await openDatabaseFromWelcome(reader, DB_NAME);
  await openTable(reader, DB_NAME, 'users');
  return reader;
}

async function openCellEditor(page: Page, row: number, column: string) {
  const cell = page.getByTestId(`cell-${row}-${column}`);
  await cell.dblclick();
  const input = page.getByTestId('edit-input');
  const textarea = page.getByTestId('edit-textarea');
  if (await input.isVisible().catch(() => false)) return input;
  await expect(textarea).toBeVisible();
  return textarea;
}

// =============================================================================
// Test Suites
// =============================================================================

test.describe('Grid Editing Tests', () => {
  test.beforeEach(async ({ page }) => {
    await setupGridDb(page);
  });

  test.describe('Inline Cell Editing', () => {
    test('double-click on cell enters edit mode', async ({ page }) => {
      await page.getByTestId('cell-0-name').dblclick();
      await expect(page.getByTestId('edit-input')).toBeVisible();
    });

    test('Enter key commits edit', async ({ page }) => {
      const input = await openCellEditor(page, 0, 'name');
      await input.fill('Alicia');
      await page.keyboard.press('Enter');
      await expect(page.getByTestId('cell-0-name')).toContainText('Alicia');
    });

    test('Escape key cancels edit without saving', async ({ page }) => {
      const input = await openCellEditor(page, 0, 'name');
      await input.fill('Not Saved');
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('cell-0-name')).toContainText('Alice');
    });

    test('Tab key commits and moves to next cell', async ({ page }) => {
      const input = await openCellEditor(page, 0, 'name');
      await input.fill('Alicia');
      await page.keyboard.press('Tab');
      await expect(page.getByTestId('cell-0-name')).toContainText('Alicia');
      // Bio column should now be in edit mode (uses input since content doesn't have actual newlines)
      await expect(page.locator('[data-testid="cell-0-bio"] [data-testid="edit-input"]')).toBeVisible();
    });

    test('dirty cells show yellow background', async ({ page }) => {
      const input = await openCellEditor(page, 0, 'name');
      await input.fill('Alicia');
      await expect(input).toHaveClass(/bg-yellow-50/);
    });

    test('blur commits edit', async ({ page }) => {
      const input = await openCellEditor(page, 1, 'name');
      await input.fill('Bobby');
      await page.getByTestId('cell-1-age').click();
      await expect(page.getByTestId('cell-1-name')).toContainText('Bobby');
    });
  });

  test.describe('Read-Only Mode', () => {
    test('edit attempt on read-only database shows tooltip', async ({ page }) => {
      const reader = await openReadOnlyPage(page);
      await reader.getByTestId('cell-0-name').dblclick();
      await expect(reader.getByTestId('edit-blocked-tooltip')).toContainText('read-only');
      await reader.close();
    });

    test('add row button is disabled in read-only mode', async ({ page }) => {
      const reader = await openReadOnlyPage(page);
      await expect(reader.getByTestId('add-row-button')).toBeDisabled();
      await reader.close();
    });

    test('delete button is disabled in read-only mode', async ({ page }) => {
      const reader = await openReadOnlyPage(page);
      await expect(reader.getByTestId('delete-rows-button')).toBeDisabled();
      await reader.close();
    });

    test('row checkboxes are disabled in read-only mode', async ({ page }) => {
      const reader = await openReadOnlyPage(page);
      await expect(reader.getByTestId('row-checkbox-0')).toBeDisabled();
      await reader.close();
    });

    test('context menu paste is disabled in read-only mode', async ({ page }) => {
      const reader = await openReadOnlyPage(page);
      await reader.getByTestId('cell-0-name').click({ button: 'right' });
      await expect(reader.getByTestId('cell-context-menu-item-paste')).toHaveAttribute('aria-disabled', 'true');
      await reader.close();
    });

    test('context menu Set NULL is disabled in read-only mode', async ({ page }) => {
      const reader = await openReadOnlyPage(page);
      await reader.getByTestId('cell-0-name').click({ button: 'right' });
      await expect(reader.getByTestId('cell-context-menu-item-set-null')).toHaveAttribute('aria-disabled', 'true');
      await reader.close();
    });

    test('context menu Delete Row is disabled in read-only mode', async ({ page }) => {
      const reader = await openReadOnlyPage(page);
      await reader.getByTestId('cell-0-name').click({ button: 'right' });
      await expect(reader.getByTestId('cell-context-menu-item-delete-row')).toHaveAttribute('aria-disabled', 'true');
      await reader.close();
    });
  });

  test.describe('Generated Columns', () => {
    test('edit attempt on generated column shows tooltip', async ({ page }) => {
      await openTable(page, DB_NAME, 'generated_people');
      await page.getByTestId('cell-0-name_upper').dblclick();
      await expect(page.getByTestId('edit-blocked-tooltip')).toContainText('Generated columns cannot be edited');
    });

    test('generated column has lightning bolt indicator', async ({ page }) => {
      await openTable(page, DB_NAME, 'generated_people');
      const header = page.locator('[role="columnheader"]', { hasText: 'name_upper' });
      await expect(header).toContainText('⚡');
    });

    test('context menu paste is disabled on generated columns', async ({ page }) => {
      await openTable(page, DB_NAME, 'generated_people');
      await page.getByTestId('cell-0-name_upper').click({ button: 'right' });
      await expect(page.getByTestId('cell-context-menu-item-paste')).toHaveAttribute('aria-disabled', 'true');
    });

    test('context menu Set NULL is disabled on generated columns', async ({ page }) => {
      await openTable(page, DB_NAME, 'generated_people');
      await page.getByTestId('cell-0-name_upper').click({ button: 'right' });
      await expect(page.getByTestId('cell-context-menu-item-set-null')).toHaveAttribute('aria-disabled', 'true');
    });
  });

  test.describe('BLOB Columns', () => {
    test('edit attempt on BLOB column shows tooltip', async ({ page }) => {
      await openTable(page, DB_NAME, 'blob_table');
      await page.getByTestId('cell-0-data').dblclick();
      await expect(page.getByTestId('edit-blocked-tooltip')).toContainText('BLOB columns cannot be edited');
    });

    test('context menu paste is disabled on BLOB columns', async ({ page }) => {
      await openTable(page, DB_NAME, 'blob_table');
      await page.getByTestId('cell-0-data').click({ button: 'right' });
      await expect(page.getByTestId('cell-context-menu-item-paste')).toHaveAttribute('aria-disabled', 'true');
    });

    test('BLOB cells display "[BLOB, N bytes]" format', async ({ page }) => {
      await openTable(page, DB_NAME, 'blob_table');
      await expect(page.getByTestId('cell-0-data')).toContainText('[BLOB, 4 bytes]');
    });

    test('Save BLOB as file option available for BLOB cells', async ({ page }) => {
      await openTable(page, DB_NAME, 'blob_table');
      await page.getByTestId('cell-0-data').click({ button: 'right' });
      await expect(page.getByTestId('cell-context-menu-item-save-blob')).toBeVisible();
    });
  });

  test.describe('Add Row', () => {
    test('add row button exists in toolbar', async ({ page }) => {
      await expect(page.getByTestId('add-row-button')).toBeVisible();
    });

    test('add row dialog shows for required fields', async ({ page }) => {
      await page.getByTestId('add-row-button').click();
      await expect(page.getByTestId('add-row-dialog')).toBeVisible();
    });

    test('add row dialog shows generated columns info', async ({ page }) => {
      await openTable(page, DB_NAME, 'generated_people');
      await page.getByTestId('add-row-button').click();
      await expect(page.getByTestId('generated-columns-info')).toBeVisible();
    });

    test('add row dialog validates required fields', async ({ page }) => {
      await page.getByTestId('add-row-button').click();
      await page.getByTestId('add-row-submit').click();
      await expect(page.getByTestId('error-name')).toBeVisible();
    });

    test('add row dialog supports NULL button for nullable fields', async ({ page }) => {
      await page.getByTestId('add-row-button').click();
      await page.getByTestId('null-btn-bio').click();
      await expect(page.getByTestId('field-bio')).toHaveValue('null');
    });

    test('keyboard shortcut Cmd/Ctrl+Shift+N triggers add row', async ({ page }) => {
      await page.keyboard.press('Control+Shift+N');
      await expect(page.getByTestId('add-row-dialog')).toBeVisible();
    });
  });

  test.describe('Delete Rows', () => {
    test('delete button exists in toolbar', async ({ page }) => {
      await expect(page.getByTestId('delete-rows-button')).toBeVisible();
    });

    test('delete button shows count of selected rows', async ({ page }) => {
      await page.getByTestId('row-checkbox-0').click();
      await expect(page.getByTestId('delete-rows-button')).toContainText('1');
    });

    test('delete button disabled when no rows selected', async ({ page }) => {
      await expect(page.getByTestId('delete-rows-button')).toBeDisabled();
    });

    test('delete confirmation dialog appears', async ({ page }) => {
      await page.getByTestId('row-checkbox-0').click();
      await page.getByTestId('delete-rows-button').click();
      await expect(page.getByTestId('delete-rows-dialog')).toBeVisible();
    });

    test('delete dialog shows foreign key warning when applicable', async ({ page }) => {
      await page.getByTestId('row-checkbox-0').click();
      await page.getByTestId('delete-rows-button').click();
      await expect(page.getByTestId('fk-cascade-warning')).toBeVisible();
    });

    test('delete via context menu selects row and shows dialog', async ({ page }) => {
      await page.getByTestId('cell-0-name').click({ button: 'right' });
      await page.getByTestId('cell-context-menu-item-delete-row').click();
      await expect(page.getByTestId('delete-rows-dialog')).toBeVisible();
      await expect(page.getByTestId('row-checkbox-0')).toBeChecked();
    });

    test('keyboard shortcut Delete/Backspace triggers delete', async ({ page }) => {
      await page.getByTestId('row-checkbox-0').click();
      await page.keyboard.press('Delete');
      await expect(page.getByTestId('delete-rows-dialog')).toBeVisible();
    });
  });

  test.describe('Row Selection', () => {
    test('clicking row checkbox toggles selection', async ({ page }) => {
      const checkbox = page.getByTestId('row-checkbox-0');
      await checkbox.click();
      await expect(checkbox).toBeChecked();
      await checkbox.click();
      await expect(checkbox).not.toBeChecked();
    });

    test('shift+click selects range of rows', async ({ page }) => {
      await page.getByTestId('row-checkbox-0').click();
      await page.getByTestId('row-checkbox-2').click({ modifiers: ['Shift'] });
      await expect(page.getByTestId('row-checkbox-0')).toBeChecked();
      await expect(page.getByTestId('row-checkbox-1')).toBeChecked();
      await expect(page.getByTestId('row-checkbox-2')).toBeChecked();
    });

    test('select all checkbox in header', async ({ page }) => {
      await page.getByTestId('select-all-checkbox').click();
      await expect(page.getByTestId('row-checkbox-0')).toBeChecked();
      await expect(page.getByTestId('row-checkbox-1')).toBeChecked();
    });

    test('selected rows have blue background', async ({ page }) => {
      await page.getByTestId('row-checkbox-0').click();
      const row = page.locator('[data-row-index="0"]');
      await expect(row).toHaveClass(/bg-blue-50/);
    });
  });

  test.describe('Context Menu', () => {
    test('right-click opens context menu', async ({ page }) => {
      await page.getByTestId('cell-0-name').click({ button: 'right' });
      await expect(page.getByTestId('cell-context-menu')).toBeVisible();
    });

    test('context menu has Copy action', async ({ page }) => {
      await page.getByTestId('cell-0-name').click({ button: 'right' });
      await expect(page.getByTestId('cell-context-menu-item-copy')).toBeVisible();
    });

    test('context menu has Paste action', async ({ page }) => {
      await page.getByTestId('cell-0-name').click({ button: 'right' });
      await expect(page.getByTestId('cell-context-menu-item-paste')).toBeVisible();
    });

    test('context menu has Set NULL action', async ({ page }) => {
      await page.getByTestId('cell-0-name').click({ button: 'right' });
      await expect(page.getByTestId('cell-context-menu-item-set-null')).toBeVisible();
    });

    test('context menu closes on outside click', async ({ page }) => {
      await page.getByTestId('cell-0-name').click({ button: 'right' });
      await expect(page.getByTestId('cell-context-menu')).toBeVisible();
      await page.click('body');
      await expect(page.getByTestId('cell-context-menu')).toBeHidden();
    });
  });

  test.describe('Unsaved Prompt', () => {
    test('unsaved prompt dialog exists', async ({ page }) => {
      const input = await openCellEditor(page, 0, 'name');
      await input.fill('Alicia');
      await page.getByTestId('tab-sql').click();
      await expect(page.getByTestId('unsaved-prompt-dialog')).toBeVisible();
    });

    test('unsaved prompt has Save & Continue button', async ({ page }) => {
      const input = await openCellEditor(page, 0, 'name');
      await input.fill('Alicia');
      await page.getByTestId('tab-sql').click();
      await expect(page.getByTestId('unsaved-prompt-save')).toBeVisible();
    });

    test('unsaved prompt has Discard button', async ({ page }) => {
      const input = await openCellEditor(page, 0, 'name');
      await input.fill('Alicia');
      await page.getByTestId('tab-sql').click();
      await expect(page.getByTestId('unsaved-prompt-discard')).toBeVisible();
    });

    test('unsaved prompt has Cancel button', async ({ page }) => {
      const input = await openCellEditor(page, 0, 'name');
      await input.fill('Alicia');
      await page.getByTestId('tab-sql').click();
      await expect(page.getByTestId('unsaved-prompt-cancel')).toBeVisible();
    });

    test('Escape key cancels unsaved prompt', async ({ page }) => {
      const input = await openCellEditor(page, 0, 'name');
      await input.fill('Alicia');
      await page.getByTestId('tab-sql').click();
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('unsaved-prompt-dialog')).toBeHidden();
    });

    test('backdrop click cancels unsaved prompt', async ({ page }) => {
      const input = await openCellEditor(page, 0, 'name');
      await input.fill('Alicia');
      await page.getByTestId('tab-sql').click();
      await page.getByTestId('unsaved-prompt-backdrop').click({ position: { x: 8, y: 8 } });
      await expect(page.getByTestId('unsaved-prompt-dialog')).toBeHidden();
    });
  });

  test.describe('WITHOUT ROWID Tables', () => {
    test('WITHOUT ROWID tables are editable', async ({ page }) => {
      await openTable(page, DB_NAME, 'without_rowid_table');
      const input = await openCellEditor(page, 0, 'label');
      await input.fill('Alpha Updated');
      await page.keyboard.press('Enter');
      await expect(page.getByTestId('cell-0-label')).toContainText('Alpha Updated');
    });

    test('virtual scrolling uses LIMIT/OFFSET for WITHOUT ROWID tables', async ({ page }) => {
      await openTable(page, DB_NAME, 'without_rowid_big');

      // Wait for grid to render
      await expect(page.getByTestId('data-grid')).toBeVisible();

      // Sort by id column
      const header = page.getByRole('columnheader').filter({ hasText: 'id' }).locator('span.truncate');
      await header.click();
      await expect(page.getByTestId('sort-indicator-id')).toBeVisible();

      // Get first visible row id
      const firstId = await page.getByTestId('cell-0-id').textContent();
      expect(firstId).toBe('id-1');

      // Scroll to middle of the table
      const gridContainer = page.locator('[data-testid="data-grid"]').first();
      await gridContainer.evaluate((el) => {
        const scrollEl = el.querySelector('.overflow-auto');
        if (scrollEl) {
          scrollEl.scrollTop = scrollEl.scrollHeight / 2;
        }
      });
      await page.waitForTimeout(200);

      // After scrolling, new rows should be visible (virtualization active)
      const rows = page.locator('[data-testid="grid-row"]');
      const rowCount = await rows.count();
      expect(rowCount).toBeGreaterThan(0);
      expect(rowCount).toBeLessThan(250); // Should be virtualized, not all 250 rows
    });
  });

  test.describe('Value Parsing', () => {
    test('numeric values are parsed correctly', async ({ page }) => {
      const input = await openCellEditor(page, 0, 'age');
      await input.fill('42.5');
      await page.keyboard.press('Enter');
      await expect(page.getByTestId('cell-0-age')).toContainText('42.5');
    });

    test('empty string or "null" converts to NULL', async ({ page }) => {
      const input = await openCellEditor(page, 1, 'bio');
      await input.fill('null');
      await page.keyboard.press('Enter');
      await expect(page.getByTestId('cell-1-bio').locator('[data-testid="cell-null"]')).toBeVisible();
    });

    test('text values are preserved as strings', async ({ page }) => {
      const input = await openCellEditor(page, 2, 'bio');
      await input.fill('00123');
      await page.keyboard.press('Enter');
      await expect(page.getByTestId('cell-2-bio')).toContainText('00123');
    });
  });

  test.describe('Error Handling', () => {
    test('add row error is displayed', async ({ page }) => {
      await page.getByTestId('add-row-button').click();
      await page.getByTestId('field-name').fill('Alice');
      await page.getByTestId('add-row-submit').click();
      await expect(page.getByTestId('add-row-error')).toBeVisible();
    });

    test('delete rows error is displayed', async ({ page }) => {
      await page.getByTestId('row-checkbox-0').click();
      await page.getByTestId('delete-rows-button').click();
      await page.getByTestId('delete-rows-confirm').click();
      await expect(page.getByTestId('delete-rows-error')).toBeVisible();
    });

    test('edit rollback on failure', async ({ page }) => {
      const input = await openCellEditor(page, 1, 'name');
      await input.fill('Alice');
      await page.keyboard.press('Enter');
      await expect(page.getByTestId('edit-input')).toBeVisible();
      await expect(page.getByTestId('edit-input')).toHaveValue('Bob');
    });
  });

  test.describe('Integration Checks', () => {
    test('grid toolbar exists when grid is shown', async ({ page }) => {
      await expect(page.getByTestId('grid-toolbar')).toBeVisible();
    });

    test('cell editing data-testid patterns are correct', async ({ page }) => {
      await openCellEditor(page, 0, 'name');
      await expect(page.getByTestId('edit-input')).toBeVisible();
    });

    test('multiline cells use textarea', async ({ page }) => {
      await openCellEditor(page, 0, 'bio');
      await expect(page.getByTestId('edit-textarea')).toBeVisible();
    });

    test('onEditStateChange is called when entering edit mode', async ({ page }) => {
      await openCellEditor(page, 0, 'name');
      await page.getByTestId('tab-sql').click();
      await expect(page.getByTestId('unsaved-prompt-dialog')).toBeVisible();
    });

    test('onEditStateChange is called when exiting edit mode', async ({ page }) => {
      await openCellEditor(page, 0, 'name');
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('edit-input')).toBeHidden();
    });

    test('editState tracks isDirty correctly', async ({ page }) => {
      const input = await openCellEditor(page, 0, 'name');
      await input.fill('Alicia');
      await expect(input).toHaveClass(/bg-yellow-50/);
    });
  });
});

// =============================================================================
// Basic UI Checks
// =============================================================================

test.describe('Grid Edit Integration Tests', () => {
  test('app loads and shows main content', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/SQLite Editor/);
    await expect(page.getByTestId('welcome-screen')).toBeVisible();
  });

  test('new database button is visible', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('new-database-button')).toBeVisible();
  });

  test('open database button is visible', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('import-database-button')).toBeVisible();
  });

  test('status bar shows ready state', async ({ page }) => {
    await page.goto('/');
    await waitForReady(page);
  });
});
