import { test, expect } from './fixtures';
import type { Download } from '@playwright/test';
import {
  createAndOpenDatabase,
  openTable,
  runSql,
} from './helpers/app';

/**
 * E2E Tests for Grid scenarios specified in E2E-US-007-01/03/06/07
 */

const DB_NAME = 'grid-spec-db';

// =============================================================================
// E2E-US-007-01: Cell edit persistence
// =============================================================================

test.describe('E2E-US-007-01: Cell edit persists after re-query', () => {
  const SQL_SETUP = `
    CREATE TABLE test_persistence (
      id INTEGER PRIMARY KEY,
      name TEXT
    );
    INSERT INTO test_persistence (name) VALUES ('original_value');
  `;

  test.beforeEach(async ({ page }) => {
    await createAndOpenDatabase(page, DB_NAME);
    await runSql(page, SQL_SETUP);
    await openTable(page, DB_NAME, 'test_persistence');
  });

  test('E2E-US-007-01: double-click cell, edit, Enter; verify persisted on re-query', async ({ page }) => {
    // Step 1: Double-click the cell to enter edit mode
    const cell = page.getByTestId('cell-0-name');
    await expect(cell).toContainText('original_value');
    await cell.dblclick();

    // Step 2: Edit the value
    const input = page.getByTestId('edit-input');
    await expect(input).toBeVisible();
    await input.fill('updated_value');

    // Step 3: Press Enter to commit
    await page.keyboard.press('Enter');

    // Step 4: Verify the cell shows the updated value
    await expect(cell).toContainText('updated_value');

    // Step 5: Re-query the row by switching away and back to verify persistence
    // Navigate to SQL tab
    await page.getByTestId('tab-sql').click();

    // Run a SELECT query to verify the data was persisted
    const editor = page.getByTestId('codemirror-editor');
    await expect(editor).toBeVisible({ timeout: 10000 });
    const content = editor.locator('.cm-content');
    if (await content.count()) {
      await content.click();
    } else {
      await editor.click();
    }
    await page.keyboard.press('Control+A');
    await page.keyboard.type('SELECT name FROM test_persistence WHERE id = 1');
    await page.getByTestId('run-button').click();

    // Verify the result shows the updated value
    await expect(page.getByTestId('results-table')).toContainText('updated_value');

    // Step 6: Re-open the table and verify the cell still shows updated value
    await openTable(page, DB_NAME, 'test_persistence');
    await expect(page.getByTestId('cell-0-name')).toContainText('updated_value');
  });
});

// =============================================================================
// E2E-US-007-03: Add row required-fields UI
// =============================================================================

test.describe('E2E-US-007-03: Add row to NOT NULL table; required fields UI', () => {
  const SQL_SETUP = `
    CREATE TABLE required_fields (
      id INTEGER PRIMARY KEY,
      required_col TEXT NOT NULL,
      optional_col TEXT
    );
  `;

  test.beforeEach(async ({ page }) => {
    await createAndOpenDatabase(page, DB_NAME);
    await runSql(page, SQL_SETUP);
    await openTable(page, DB_NAME, 'required_fields');
  });

  test('E2E-US-007-03: add row shows required-fields UI; cancel results in 0 new rows; submit with value inserts row', async ({ page }) => {
    // Verify the table starts empty
    await expect(page.getByText('No data')).toBeVisible();

    // Step 1: Click "Add row" button
    await page.getByTestId('add-row-button').click();

    // Step 2: Verify required-fields UI appears (dialog is visible)
    await expect(page.getByTestId('add-row-dialog')).toBeVisible();

    // Step 3: Verify required field is marked/indicated
    // The required_col field should have some indication it's required
    const requiredField = page.getByTestId('field-required_col');
    await expect(requiredField).toBeVisible();

    // Step 4: Try to submit without filling required field - should show error
    await page.getByTestId('add-row-submit').click();
    await expect(page.getByTestId('error-required_col')).toBeVisible();

    // Step 5: Cancel the dialog
    await page.getByTestId('add-row-cancel').click();
    await expect(page.getByTestId('add-row-dialog')).toBeHidden();

    // Step 6: Verify 0 new rows (table still empty)
    await expect(page.getByText('No data')).toBeVisible();

    // Step 7: Open dialog again and submit with required field filled
    await page.getByTestId('add-row-button').click();
    await expect(page.getByTestId('add-row-dialog')).toBeVisible();

    await page.getByTestId('field-required_col').fill('ok');
    await page.getByTestId('add-row-submit').click();

    // Step 8: Verify dialog closes and exactly one row exists
    await expect(page.getByTestId('add-row-dialog')).toBeHidden();
    await expect(page.getByTestId('cell-0-required_col')).toContainText('ok');

    // Verify only one row by checking row count
    const rows = page.locator('[data-row-index]');
    await expect(rows).toHaveCount(1);
  });
});

// =============================================================================
// E2E-US-007-06: Save BLOB as file
// =============================================================================

test.describe('E2E-US-007-06: BLOB "Save as file"; verify content', () => {
  // Known byte sequence: 0xDE 0xAD 0xBE 0xEF (4 bytes)
  const BLOB_HEX = 'DEADBEEF';
  const EXPECTED_BYTES = [0xDE, 0xAD, 0xBE, 0xEF];

  const SQL_SETUP = `
    CREATE TABLE blob_data (
      id INTEGER PRIMARY KEY,
      data BLOB
    );
    INSERT INTO blob_data (data) VALUES (X'${BLOB_HEX}');
  `;

  test.beforeEach(async ({ page }) => {
    await createAndOpenDatabase(page, DB_NAME);
    await runSql(page, SQL_SETUP);
    await openTable(page, DB_NAME, 'blob_data');
  });

  test('E2E-US-007-06: BLOB cell Save as file downloads correct bytes', async ({ page }) => {
    // Step 1: Verify BLOB cell is displayed correctly
    const blobCell = page.getByTestId('cell-0-data');
    await expect(blobCell).toContainText('[BLOB, 4 bytes]');

    // Step 2: Right-click to open context menu
    await blobCell.click({ button: 'right' });
    await expect(page.getByTestId('cell-context-menu')).toBeVisible();

    // Step 3: Click "Save BLOB as file" option
    const saveBlobOption = page.getByTestId('cell-context-menu-item-save-blob');
    await expect(saveBlobOption).toBeVisible();

    // Step 4: Set up download listener and click save
    const downloadPromise = page.waitForEvent('download');
    await saveBlobOption.click();

    // Step 5: Wait for download and verify file content
    const download: Download = await downloadPromise;

    // Get the download path and read the file
    const downloadPath = await download.path();
    expect(downloadPath).toBeTruthy();

    // Read the downloaded file content
    const fs = await import('fs/promises');
    const fileContent = await fs.readFile(downloadPath!);

    // Step 6: Verify file size matches (4 bytes)
    expect(fileContent.length).toBe(4);

    // Step 7: Verify byte content matches the inserted BLOB
    expect(Array.from(fileContent)).toEqual(EXPECTED_BYTES);
  });
});

// =============================================================================
// E2E-US-007-07: Generated columns read-only
// =============================================================================

test.describe('E2E-US-007-07: Generated column not editable', () => {
  const SQL_SETUP = `
    CREATE TABLE generated_cols (
      id INTEGER PRIMARY KEY,
      a INTEGER,
      b INTEGER GENERATED ALWAYS AS (a + 1) STORED
    );
    INSERT INTO generated_cols (a) VALUES (1);
  `;

  test.beforeEach(async ({ page }) => {
    await createAndOpenDatabase(page, DB_NAME);
    await runSql(page, SQL_SETUP);
    await openTable(page, DB_NAME, 'generated_cols');
  });

  test('E2E-US-007-07: generated column shows computed value and is not editable', async ({ page }) => {
    // Step 1: Verify the computed column shows the correct value (a+1 = 1+1 = 2)
    const generatedCell = page.getByTestId('cell-0-b');
    await expect(generatedCell).toContainText('2');

    // Step 2: Verify attempting to edit the generated column does not work
    // Double-click should show a tooltip/indicator that editing is blocked
    await generatedCell.dblclick();

    // Step 3: Verify edit blocked tooltip appears
    await expect(page.getByTestId('edit-blocked-tooltip')).toContainText('Generated columns cannot be edited');

    // Step 4: Verify no input field appears (editing is truly blocked)
    await expect(page.getByTestId('edit-input')).not.toBeVisible();
    await expect(page.getByTestId('edit-textarea')).not.toBeVisible();

    // Step 5: Verify the data hasn't changed
    await expect(generatedCell).toContainText('2');

    // Step 6: Verify via SQL that the value is still 2
    await page.getByTestId('tab-sql').click();
    const editor = page.getByTestId('codemirror-editor');
    await expect(editor).toBeVisible({ timeout: 10000 });
    const content = editor.locator('.cm-content');
    if (await content.count()) {
      await content.click();
    } else {
      await editor.click();
    }
    await page.keyboard.press('Control+A');
    await page.keyboard.type('SELECT b FROM generated_cols WHERE id = 1');
    await page.getByTestId('run-button').click();

    // Verify the result shows 2
    await expect(page.getByTestId('results-table')).toContainText('2');
  });

  test('E2E-US-007-07: generated column context menu paste/set-null are disabled', async ({ page }) => {
    // Right-click on generated column
    const generatedCell = page.getByTestId('cell-0-b');
    await generatedCell.click({ button: 'right' });
    await expect(page.getByTestId('cell-context-menu')).toBeVisible();

    // Verify paste is disabled
    await expect(page.getByTestId('cell-context-menu-item-paste')).toHaveAttribute('aria-disabled', 'true');

    // Verify Set NULL is disabled
    await expect(page.getByTestId('cell-context-menu-item-set-null')).toHaveAttribute('aria-disabled', 'true');
  });
});
