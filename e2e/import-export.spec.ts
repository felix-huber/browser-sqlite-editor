import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createAndOpenDatabase, runSqlStatements, openTable, runSql, waitForReady } from './helpers/app';

const DB_NAME = 'import-export-db';

function writeTempFile(filename: string, content: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-editor-'));
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

async function saveDownloadText(download: import('@playwright/test').Download, ext: string): Promise<string> {
  const filePath = path.join(os.tmpdir(), `sqlite-export-${Date.now()}.${ext}`);
  await download.saveAs(filePath);
  return fs.readFileSync(filePath, 'utf8');
}

async function saveDownloadBuffer(download: import('@playwright/test').Download, ext: string): Promise<Buffer> {
  const filePath = path.join(os.tmpdir(), `sqlite-export-${Date.now()}.${ext}`);
  await download.saveAs(filePath);
  return fs.readFileSync(filePath);
}

async function openImportDialogWithFile(page: import('@playwright/test').Page, filePath: string) {
  await page.getByTestId('import-data-input').setInputFiles(filePath);
  await expect(page.getByTestId('import-dialog')).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId('import-preview')).toBeVisible({ timeout: 10000 });
}

test.describe('Import/Export (real UI)', () => {
  test.beforeEach(async ({ page }) => {
    await createAndOpenDatabase(page, DB_NAME);
    await runSqlStatements(page, [
      `CREATE TABLE export_table (id INTEGER PRIMARY KEY, name TEXT, data BLOB)`,
      `INSERT INTO export_table (id, name, data) VALUES (1, 'Alpha', X'01020304'), (2, 'Beta', X'FF')`,
      `CREATE TABLE unique_table (id INTEGER PRIMARY KEY, email TEXT UNIQUE)`,
      `INSERT INTO unique_table (email) VALUES ('a@example.com')`,
    ]);
    await waitForReady(page);
  });

  test('imports CSV into a new table', async ({ page }) => {
    const csvPath = writeTempFile('people.csv', 'id,name,age\n1,Ada,31\n2,Bob,42\n');
    await openImportDialogWithFile(page, csvPath);

    await page.getByTestId('table-name-input').fill('people');
    await page.getByTestId('import-button').click();
    await expect(page.getByTestId('import-dialog')).toBeHidden({ timeout: 10000 });

    await openTable(page, DB_NAME, 'people');
    await expect(page.getByTestId('cell-0-name')).toHaveText('Ada');
    await expect(page.getByTestId('cell-1-name')).toHaveText('Bob');
  });

  test('imports JSON array into a new table', async ({ page }) => {
    const jsonPath = writeTempFile(
      'items.json',
      JSON.stringify([
        { id: 1, name: 'Widget', price: 9.5 },
        { id: 2, name: 'Gadget', price: 12.0 },
      ])
    );
    await openImportDialogWithFile(page, jsonPath);

    await page.getByTestId('table-name-input').fill('items');
    await page.getByTestId('import-button').click();
    await expect(page.getByTestId('import-dialog')).toBeHidden({ timeout: 10000 });

    await openTable(page, DB_NAME, 'items');
    await expect(page.getByTestId('cell-0-name')).toHaveText('Widget');
  });

  test('type override applies to imported schema', async ({ page }) => {
    const csvPath = writeTempFile('ages.csv', 'id,age\n1,10\n2,20\n');
    await openImportDialogWithFile(page, csvPath);

    await page.getByTestId('table-name-input').fill('ages');
    await page.getByTestId('type-dropdown-1').selectOption('TEXT');
    await page.getByTestId('import-button').click();
    await expect(page.getByTestId('import-dialog')).toBeHidden({ timeout: 10000 });

    await runSql(page, "PRAGMA table_info('ages')");
    await expect(page.getByTestId('cell-1-type')).toHaveText('TEXT');
  });

  test('type override shows mismatch warnings for invalid coercion', async ({ page }) => {
    const csvPath = writeTempFile('badages.csv', 'id,age\n1,abc\n2,def\n');
    await openImportDialogWithFile(page, csvPath);

    await page.getByTestId('type-dropdown-1').selectOption('INTEGER');
    await expect(page.getByTestId('mismatch-warning')).toBeVisible();
  });

  test('import rollback occurs on constraint violation', async ({ page }) => {
    const csvPath = writeTempFile('dupes.csv', 'email\na@example.com\n');
    await openImportDialogWithFile(page, csvPath);

    await page.getByTestId('target-append').click();
    await page.getByTestId('table-name-select').selectOption('unique_table');
    await page.getByTestId('import-button').click();

    await expect(page.getByTestId('error-state')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/constraint/i)).toBeVisible();
    await page.getByTestId('close-button').click();

    await runSql(page, 'SELECT COUNT(*) AS count FROM unique_table');
    await expect(page.getByTestId('cell-0-count')).toHaveText('1');
  });

  test('exports CSV with BOM and delimiter options', async ({ page }) => {
    await openTable(page, DB_NAME, 'export_table');
    await page.getByTestId('table-export-button').click();
    await expect(page.getByTestId('export-dialog')).toBeVisible();

    let downloadPromise = page.waitForEvent('download');
    await page.getByTestId('download-button').click();
    const download = await downloadPromise;
    const csvContent = await saveDownloadText(download, 'csv');
    expect(csvContent.charCodeAt(0)).toBe(0xfeff);
    expect(csvContent).toContain('id,name,data');

    await page.getByTestId('csv-delimiter-select').selectOption(';');
    downloadPromise = page.waitForEvent('download');
    await page.getByTestId('download-button').click();
    const download2 = await downloadPromise;
    const csvContent2 = await saveDownloadText(download2, 'csv');
    expect(csvContent2).toContain('id;name;data');
  });

  test('exports JSON with base64 BLOBs', async ({ page }) => {
    await openTable(page, DB_NAME, 'export_table');
    await page.getByTestId('table-export-button').click();
    await expect(page.getByTestId('export-dialog')).toBeVisible();
    await page.getByTestId('format-json').click();

    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('download-button').click();
    const download = await downloadPromise;
    const jsonContent = await saveDownloadText(download, 'json');
    const parsed = JSON.parse(jsonContent);
    expect(parsed[0].data).toMatch(/^base64:/);
  });

  test('exports SQL with CREATE TABLE and INSERT statements', async ({ page }) => {
    await openTable(page, DB_NAME, 'export_table');
    await page.getByTestId('table-export-button').click();
    await expect(page.getByTestId('export-dialog')).toBeVisible();
    await page.getByTestId('format-sql').click();

    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('download-button').click();
    const download = await downloadPromise;
    const sqlContent = await saveDownloadText(download, 'sql');
    expect(sqlContent).toContain('CREATE TABLE');
    expect(sqlContent).toContain('INSERT INTO');
  });

  test('exports database as SQLite file', async ({ page }) => {
    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('export-db-button').click();
    const download = await downloadPromise;
    const buffer = await saveDownloadBuffer(download, 'sqlite');
    const magic = buffer.subarray(0, 16).toString('utf8');
    expect(magic).toContain('SQLite format 3');
  });
});
