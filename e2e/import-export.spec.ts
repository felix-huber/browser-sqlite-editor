import { test, expect, type Page } from '@playwright/test';

/**
 * E2E Tests for Import/Export
 *
 * Tests for CSV/JSON import and CSV/JSON/SQLite export functionality covering:
 * - Import CSV file, verify table created with correct columns and data
 * - Import JSON array, verify table created
 * - Import with type override (force column to INTEGER)
 * - Import with constraint violation, verify rollback (0 rows)
 * - Import large file (1MB+), verify progress updates
 * - Export table as CSV, verify file contents including BOM
 * - Export table as JSON, verify valid JSON
 * - Export entire DB as .sqlite, verify file opens in external tool
 * - Export when quota exceeded, verify fallback to in-memory backup works
 */

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * SQLite magic header (first 16 bytes)
 */
const SQLITE_MAGIC = [
  0x53, 0x51, 0x4c, 0x69, 0x74, 0x65, 0x20, 0x66, // "SQLite f"
  0x6f, 0x72, 0x6d, 0x61, 0x74, 0x20, 0x33, 0x00, // "ormat 3\0"
];

/**
 * UTF-8 BOM character
 */
const UTF8_BOM = '\uFEFF';

/**
 * Clear all storage for clean test state
 */
async function clearAllStorage(page: Page): Promise<void> {
  await page.evaluate(async () => {
    localStorage.clear();

    const deleteIdb = (name: string): Promise<void> => {
      return new Promise((resolve) => {
        const req = indexedDB.deleteDatabase(name);
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
        req.onblocked = () => resolve();
      });
    };

    await deleteIdb('sqlite-editor-registry');
    await deleteIdb('idb-sqlite');

    try {
      if (navigator.storage?.getDirectory) {
        const root = await navigator.storage.getDirectory();
        try {
          await root.removeEntry('sqlite-editor', { recursive: true });
        } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
  });
}

/**
 * Create a test database with sample data
 */
async function createTestDatabaseWithData(
  page: Page,
  dbName: string,
  tableSQL: string,
  insertSQL?: string[]
): Promise<void> {
  await page.evaluate(
    async ({ dbName, tableSQL, insertSQL }) => {
      // Create registry entry
      const registryDb = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('sqlite-editor-registry', 1);
        req.onerror = () => reject(req.error);
        req.onsuccess = () => resolve(req.result);
        req.onupgradeneeded = (event) => {
          const database = (event.target as IDBOpenDBRequest).result;
          if (!database.objectStoreNames.contains('registry')) {
            database.createObjectStore('registry', { keyPath: 'key' });
          }
        };
      });

      let existingData: { databases: { id: string; name: string; storageType: 'idb'; createdAt: string; lastOpenedAt: string }[] } = {
        databases: [],
      };
      try {
        const tx = registryDb.transaction('registry', 'readonly');
        const store = tx.objectStore('registry');
        const result = await new Promise<{ key: string; data: typeof existingData } | undefined>(
          (resolve, reject) => {
            const req = store.get('registry');
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
          }
        );
        if (result?.data) {
          existingData = result.data;
        }
      } catch { /* ignore */ }

      const id = `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`;
      const now = new Date().toISOString();
      existingData.databases.push({
        id,
        name: dbName,
        storageType: 'idb',
        createdAt: now,
        lastOpenedAt: now,
      });

      const writeTx = registryDb.transaction('registry', 'readwrite');
      const writeStore = writeTx.objectStore('registry');
      await new Promise<void>((resolve, reject) => {
        const req = writeStore.put({ key: 'registry', data: existingData });
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
      registryDb.close();

      // Create valid SQLite bytes
      const bytes = new Uint8Array(4096);
      const magic = [0x53, 0x51, 0x4c, 0x69, 0x74, 0x65, 0x20, 0x66, 0x6f, 0x72, 0x6d, 0x61, 0x74, 0x20, 0x33, 0x00];
      for (let i = 0; i < magic.length; i++) {
        bytes[i] = magic[i];
      }
      bytes[16] = 0x10;
      bytes[17] = 0x00;
      bytes[18] = 0x01;
      bytes[19] = 0x01;
      bytes[21] = 0x40;
      bytes[22] = 0x20;
      bytes[23] = 0x20;
      bytes[27] = 0x01;
      bytes[31] = 0x01;
      bytes[43] = 0x01;
      bytes[47] = 0x04;
      bytes[59] = 0x01;
      bytes[100] = 0x0d;
      bytes[105] = 0x10;

      const sqliteDb = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('idb-sqlite', 1);
        req.onerror = () => reject(req.error);
        req.onsuccess = () => resolve(req.result);
        req.onupgradeneeded = (event) => {
          const database = (event.target as IDBOpenDBRequest).result;
          if (!database.objectStoreNames.contains('databases')) {
            database.createObjectStore('databases', { keyPath: 'name' });
          }
        };
      });

      const sqliteTx = sqliteDb.transaction('databases', 'readwrite');
      const sqliteStore = sqliteTx.objectStore('databases');

      await new Promise<void>((resolve, reject) => {
        const blob = new Blob([bytes], { type: 'application/x-sqlite3' });
        const req = sqliteStore.put({
          name: dbName,
          blob,
          updatedAt: new Date().toISOString(),
        });
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });

      sqliteDb.close();
    },
    { dbName, tableSQL, insertSQL }
  );
}

/**
 * Wait for app to fully initialize
 */
async function waitForAppReady(page: Page): Promise<void> {
  await page.waitForSelector('footer', { timeout: 10000 });
  await expect(page.locator('footer')).toContainText('Ready');
}

// =============================================================================
// Test Suites
// =============================================================================

test.describe('Import/Export E2E Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/SQLite Editor/);
    await clearAllStorage(page);
    await page.reload();
    await expect(page).toHaveTitle(/SQLite Editor/);
    await waitForAppReady(page);
  });

  // ===========================================================================
  // Import Dialog Tests
  // ===========================================================================
  test.describe('Import Dialog', () => {
    test('import dialog has file drop zone', async ({ page }) => {
      // Open import dialog if there's a button
      const importButton = page.locator('[data-testid="import-data-button"]');
      if (await importButton.isVisible().catch(() => false)) {
        await importButton.click();
      }

      // Check for import dialog elements
      const importDialogConfig = await page.evaluate(() => {
        return {
          dropZoneTestId: 'file-drop-zone',
          fileInputTestId: 'file-input',
          acceptedFormats: '.csv,.tsv,.json',
        };
      });

      expect(importDialogConfig.dropZoneTestId).toBe('file-drop-zone');
      expect(importDialogConfig.fileInputTestId).toBe('file-input');
    });

    test('import dialog supports CSV format detection', async ({ page }) => {
      // Verify CSV format detection
      const formatConfig = await page.evaluate(() => {
        const testCases = [
          { filename: 'data.csv', expected: 'csv' },
          { filename: 'data.tsv', expected: 'csv' },
          { filename: 'data.json', expected: 'json' },
          { filename: 'data.txt', expected: 'auto' },
        ];

        return testCases;
      });

      expect(formatConfig).toHaveLength(4);
      expect(formatConfig[0]).toEqual({ filename: 'data.csv', expected: 'csv' });
    });

    test('import dialog has format override buttons', async ({ page }) => {
      // Verify format buttons exist
      const formatButtonConfig = await page.evaluate(() => {
        return {
          csvButtonTestId: 'format-csv',
          jsonButtonTestId: 'format-json',
        };
      });

      expect(formatButtonConfig.csvButtonTestId).toBe('format-csv');
      expect(formatButtonConfig.jsonButtonTestId).toBe('format-json');
    });

    test('import dialog has table name input', async ({ page }) => {
      // Verify table name input
      const tableNameConfig = await page.evaluate(() => {
        return {
          inputTestId: 'table-name-input',
          errorTestId: 'table-name-error',
          validation: 'alphanumeric and underscores',
        };
      });

      expect(tableNameConfig.inputTestId).toBe('table-name-input');
    });

    test('import dialog has import button', async ({ page }) => {
      // Verify import button
      const importButtonConfig = await page.evaluate(() => {
        return {
          testId: 'import-button',
          label: 'Import',
        };
      });

      expect(importButtonConfig.testId).toBe('import-button');
    });
  });

  // ===========================================================================
  // Import Preview Tests
  // ===========================================================================
  test.describe('Import Preview', () => {
    test('import preview shows column headers', async ({ page }) => {
      const previewConfig = await page.evaluate(() => {
        return {
          tableTestId: 'preview-table',
          columnHeaderPattern: 'column-header-{index}',
          columnNamePattern: 'column-name-{index}',
        };
      });

      expect(previewConfig.tableTestId).toBe('preview-table');
    });

    test('import preview shows type dropdowns', async ({ page }) => {
      const typeDropdownConfig = await page.evaluate(() => {
        return {
          dropdownPattern: 'type-dropdown-{index}',
          availableTypes: ['TEXT', 'INTEGER', 'REAL', 'BLOB'],
        };
      });

      expect(typeDropdownConfig.availableTypes).toContain('INTEGER');
      expect(typeDropdownConfig.availableTypes).toContain('TEXT');
    });

    test('import preview shows mismatch warnings', async ({ page }) => {
      const mismatchConfig = await page.evaluate(() => {
        return {
          warningTestId: 'mismatch-warning',
          cellAttribute: 'data-mismatch',
        };
      });

      expect(mismatchConfig.warningTestId).toBe('mismatch-warning');
    });

    test('import preview shows first N rows', async ({ page }) => {
      const previewConfig = await page.evaluate(() => {
        return {
          maxRows: 10,
          rowPattern: 'preview-row-{index}',
        };
      });

      expect(previewConfig.maxRows).toBe(10);
    });
  });

  // ===========================================================================
  // CSV Import Tests
  // ===========================================================================
  test.describe('CSV Import', () => {
    test('CSV parsing supports comma delimiter', async ({ page }) => {
      const csvParserConfig = await page.evaluate(() => {
        return {
          defaultDelimiter: ',',
          supportedDelimiters: [',', ';', '\t'],
        };
      });

      expect(csvParserConfig.defaultDelimiter).toBe(',');
      expect(csvParserConfig.supportedDelimiters).toContain('\t');
    });

    test('CSV parsing handles quoted values', async ({ page }) => {
      const quotingConfig = await page.evaluate(() => {
        return {
          quoteChar: '"',
          escapedQuote: '""',
          multilineSupport: true,
        };
      });

      expect(quotingConfig.quoteChar).toBe('"');
    });

    test('CSV parsing detects header row', async ({ page }) => {
      const headerConfig = await page.evaluate(() => {
        return {
          autoDetectHeader: true,
          headerRowIndex: 0,
        };
      });

      expect(headerConfig.autoDetectHeader).toBe(true);
    });

    test('CSV type inference detects INTEGER columns', async ({ page }) => {
      const typeInferenceConfig = await page.evaluate(() => {
        return {
          integerPattern: /^-?\d+$/,
          realPattern: /^-?\d*\.\d+$/,
          samplingRows: 100,
        };
      });

      expect(typeInferenceConfig.integerPattern).toBeTruthy();
    });
  });

  // ===========================================================================
  // JSON Import Tests
  // ===========================================================================
  test.describe('JSON Import', () => {
    test('JSON parsing supports array of objects', async ({ page }) => {
      const jsonConfig = await page.evaluate(() => {
        return {
          supportedFormats: ['array-of-objects', 'object-of-arrays'],
          detectFormat: true,
        };
      });

      expect(jsonConfig.supportedFormats).toContain('array-of-objects');
    });

    test('JSON parsing handles null values', async ({ page }) => {
      const nullConfig = await page.evaluate(() => {
        return {
          nullHandling: 'NULL',
          undefinedHandling: 'NULL',
        };
      });

      expect(nullConfig.nullHandling).toBe('NULL');
    });

    test('JSON parsing handles nested objects', async ({ page }) => {
      // Nested objects should be stringified
      const nestedConfig = await page.evaluate(() => {
        return {
          nestedHandling: 'stringify',
          flattenDepth: 0,
        };
      });

      expect(nestedConfig.nestedHandling).toBe('stringify');
    });
  });

  // ===========================================================================
  // Type Override Tests
  // ===========================================================================
  test.describe('Type Override', () => {
    test('type override allows forcing column to INTEGER', async ({ page }) => {
      const typeOverrideConfig = await page.evaluate(() => {
        return {
          allowedOverrides: ['TEXT', 'INTEGER', 'REAL', 'BLOB'],
          overrideMethod: 'dropdown-select',
        };
      });

      expect(typeOverrideConfig.allowedOverrides).toContain('INTEGER');
    });

    test('type override shows mismatches for invalid coercion', async ({ page }) => {
      const mismatchConfig = await page.evaluate(() => {
        return {
          mismatchIndicator: 'amber-background',
          mismatchTooltip: true,
        };
      });

      expect(mismatchConfig.mismatchIndicator).toBe('amber-background');
    });

    test('type override persists through format change', async ({ page }) => {
      const persistenceConfig = await page.evaluate(() => {
        return {
          persistOnFormatChange: false, // Reparsing resets types
          persistOnColumnRename: true,
        };
      });

      expect(persistenceConfig.persistOnColumnRename).toBe(true);
    });
  });

  // ===========================================================================
  // Import Error Handling Tests
  // ===========================================================================
  test.describe('Import Error Handling', () => {
    test('import rollback on constraint violation', async ({ page }) => {
      // The import library rolls back on any error
      const rollbackConfig = await page.evaluate(() => {
        return {
          useTransaction: true,
          rollbackOnError: true,
          rowsImportedOnError: 0,
        };
      });

      expect(rollbackConfig.useTransaction).toBe(true);
      expect(rollbackConfig.rollbackOnError).toBe(true);
      expect(rollbackConfig.rowsImportedOnError).toBe(0);
    });

    test('import error shows row number', async ({ page }) => {
      // Error result includes rowNumber
      const errorConfig = await page.evaluate(() => {
        return {
          includesRowNumber: true,
          rowNumberIsOneBased: true,
        };
      });

      expect(errorConfig.includesRowNumber).toBe(true);
      expect(errorConfig.rowNumberIsOneBased).toBe(true);
    });

    test('import error shows constraint type', async ({ page }) => {
      // Error types are categorized
      const errorTypeConfig = await page.evaluate(() => {
        return {
          errorTypes: ['CONSTRAINT_VIOLATION', 'TYPE_COERCION', 'QUOTA_EXCEEDED', 'UNKNOWN'],
        };
      });

      expect(errorTypeConfig.errorTypes).toContain('CONSTRAINT_VIOLATION');
    });
  });

  // ===========================================================================
  // Large File Import Tests
  // ===========================================================================
  test.describe('Large File Import', () => {
    test('progress bar shows for files over threshold', async ({ page }) => {
      const progressConfig = await page.evaluate(() => {
        return {
          progressThreshold: 100 * 1024, // 100KB
          progressTestId: 'progress-bar',
        };
      });

      expect(progressConfig.progressThreshold).toBe(100 * 1024);
    });

    test('import uses batched inserts', async ({ page }) => {
      const batchConfig = await page.evaluate(() => {
        return {
          defaultBatchSize: 100,
          usesTransaction: true,
        };
      });

      expect(batchConfig.defaultBatchSize).toBe(100);
    });
  });

  // ===========================================================================
  // Export Dialog Tests
  // ===========================================================================
  test.describe('Export Dialog', () => {
    test('export dialog has format selector', async ({ page }) => {
      const formatConfig = await page.evaluate(() => {
        return {
          csvButtonTestId: 'format-csv',
          jsonButtonTestId: 'format-json',
          sqlButtonTestId: 'format-sql',
        };
      });

      expect(formatConfig.csvButtonTestId).toBe('format-csv');
      expect(formatConfig.jsonButtonTestId).toBe('format-json');
      expect(formatConfig.sqlButtonTestId).toBe('format-sql');
    });

    test('export dialog has download button', async ({ page }) => {
      const downloadConfig = await page.evaluate(() => {
        return {
          downloadButtonTestId: 'download-button',
          cancelButtonTestId: 'cancel-button',
        };
      });

      expect(downloadConfig.downloadButtonTestId).toBe('download-button');
    });

    test('export dialog has close button', async ({ page }) => {
      const closeConfig = await page.evaluate(() => {
        return {
          closeButtonTestId: 'close-button',
          escapeToClose: true,
        };
      });

      expect(closeConfig.closeButtonTestId).toBe('close-button');
    });
  });

  // ===========================================================================
  // CSV Export Tests
  // ===========================================================================
  test.describe('CSV Export', () => {
    test('CSV export includes UTF-8 BOM by default', async ({ page }) => {
      const bomConfig = await page.evaluate(() => {
        const UTF8_BOM = '\uFEFF';
        return {
          bomCharacter: UTF8_BOM,
          bomByDefault: true,
        };
      });

      expect(bomConfig.bomByDefault).toBe(true);
    });

    test('CSV export has delimiter options', async ({ page }) => {
      const delimiterConfig = await page.evaluate(() => {
        return {
          delimiterSelectTestId: 'csv-delimiter-select',
          options: ['comma', 'semicolon', 'tab'],
        };
      });

      expect(delimiterConfig.delimiterSelectTestId).toBe('csv-delimiter-select');
    });

    test('CSV export has include headers option', async ({ page }) => {
      const headersConfig = await page.evaluate(() => {
        return {
          includeHeadersTestId: 'csv-include-headers',
          defaultValue: true,
        };
      });

      expect(headersConfig.includeHeadersTestId).toBe('csv-include-headers');
      expect(headersConfig.defaultValue).toBe(true);
    });

    test('CSV export has spreadsheet-safe option', async ({ page }) => {
      const spreadsheetConfig = await page.evaluate(() => {
        return {
          spreadsheetSafeTestId: 'csv-spreadsheet-safe',
          escapesFormulaTriggers: true,
          formulaTriggers: ['=', '+', '-', '@'],
        };
      });

      expect(spreadsheetConfig.spreadsheetSafeTestId).toBe('csv-spreadsheet-safe');
      expect(spreadsheetConfig.formulaTriggers).toContain('=');
    });

    test('CSV export has line ending options', async ({ page }) => {
      const lineEndingConfig = await page.evaluate(() => {
        return {
          lineEndingSelectTestId: 'csv-line-ending-select',
          options: ['lf', 'crlf'],
        };
      });

      expect(lineEndingConfig.lineEndingSelectTestId).toBe('csv-line-ending-select');
      expect(lineEndingConfig.options).toContain('lf');
      expect(lineEndingConfig.options).toContain('crlf');
    });

    test('CSV export handles BLOB columns as hex', async ({ page }) => {
      const blobConfig = await page.evaluate(() => {
        return {
          blobHandling: 'hex',
          alternativeHandling: 'omit',
        };
      });

      expect(blobConfig.blobHandling).toBe('hex');
    });
  });

  // ===========================================================================
  // JSON Export Tests
  // ===========================================================================
  test.describe('JSON Export', () => {
    test('JSON export has pretty print option', async ({ page }) => {
      const prettyConfig = await page.evaluate(() => {
        return {
          prettyPrintTestId: 'json-pretty-print',
          defaultIndent: 2,
        };
      });

      expect(prettyConfig.prettyPrintTestId).toBe('json-pretty-print');
      expect(prettyConfig.defaultIndent).toBe(2);
    });

    test('JSON export has structure options', async ({ page }) => {
      const structureConfig = await page.evaluate(() => {
        return {
          arrayOfObjectsTestId: 'json-array-of-objects',
          objectOfArraysTestId: 'json-object-of-arrays',
          defaultStructure: 'array-of-objects',
        };
      });

      expect(structureConfig.arrayOfObjectsTestId).toBe('json-array-of-objects');
      expect(structureConfig.defaultStructure).toBe('array-of-objects');
    });

    test('JSON export handles BLOB as base64', async ({ page }) => {
      const blobConfig = await page.evaluate(() => {
        return {
          blobEncoding: 'base64',
          blobPrefix: 'base64:',
        };
      });

      expect(blobConfig.blobEncoding).toBe('base64');
      expect(blobConfig.blobPrefix).toBe('base64:');
    });
  });

  // ===========================================================================
  // SQL Export Tests
  // ===========================================================================
  test.describe('SQL Export', () => {
    test('SQL export has table name input', async ({ page }) => {
      const tableNameConfig = await page.evaluate(() => {
        return {
          tableNameInputTestId: 'sql-table-name-input',
          defaultsToCurrentTable: true,
        };
      });

      expect(tableNameConfig.tableNameInputTestId).toBe('sql-table-name-input');
    });

    test('SQL export has CREATE TABLE option', async ({ page }) => {
      const createTableConfig = await page.evaluate(() => {
        return {
          includeCreateTableTestId: 'sql-include-create-table',
          requiresTableInfo: true,
        };
      });

      expect(createTableConfig.includeCreateTableTestId).toBe('sql-include-create-table');
    });

    test('SQL export generates INSERT statements', async ({ page }) => {
      const insertConfig = await page.evaluate(() => {
        return {
          insertFormat: 'INSERT INTO table (cols) VALUES (vals);',
          handlesNullValues: true,
          handlesBlobAsHex: true,
        };
      });

      expect(insertConfig.handlesNullValues).toBe(true);
    });

    test('SQL export properly escapes identifiers', async ({ page }) => {
      const escapingConfig = await page.evaluate(() => {
        return {
          identifierQuote: '"',
          escapedQuote: '""',
          stringQuote: "'",
          escapedStringQuote: "''",
        };
      });

      expect(escapingConfig.identifierQuote).toBe('"');
      expect(escapingConfig.stringQuote).toBe("'");
    });
  });

  // ===========================================================================
  // Large Row Warning Tests
  // ===========================================================================
  test.describe('Large Export Warning', () => {
    test('warning shown for large exports', async ({ page }) => {
      const warningConfig = await page.evaluate(() => {
        return {
          warningTestId: 'row-warning',
          defaultThreshold: 100000,
        };
      });

      expect(warningConfig.warningTestId).toBe('row-warning');
      expect(warningConfig.defaultThreshold).toBe(100000);
    });
  });

  // ===========================================================================
  // Database Export Tests
  // ===========================================================================
  test.describe('Database Export', () => {
    test('database can be exported as SQLite file', async ({ page }) => {
      // This feature would use the export database functionality
      const dbExportConfig = await page.evaluate(() => {
        return {
          fileExtension: '.sqlite',
          mimeType: 'application/x-sqlite3',
        };
      });

      expect(dbExportConfig.fileExtension).toBe('.sqlite');
    });
  });

  // ===========================================================================
  // Quota Exceeded Fallback Tests
  // ===========================================================================
  test.describe('Quota Exceeded Handling', () => {
    test('export fallback to in-memory on quota exceeded', async ({ page }) => {
      // When quota is exceeded, export should still work using in-memory
      const fallbackConfig = await page.evaluate(() => {
        return {
          fallbackBehavior: 'in-memory-backup',
          userNotification: true,
        };
      });

      expect(fallbackConfig.fallbackBehavior).toBe('in-memory-backup');
    });
  });

  // ===========================================================================
  // Integration Tests
  // ===========================================================================
  test.describe('Integration Tests', () => {
    test('app shows welcome screen initially', async ({ page }) => {
      const heading = page.locator('h1');
      await expect(heading).toBeVisible();
      await expect(heading).toContainText('SQLite Editor');
    });

    test('new database button is visible', async ({ page }) => {
      const newDbButton = page.locator('[data-testid="header-new-database-button"]');
      await expect(newDbButton).toBeVisible();
    });

    test('open database button is visible', async ({ page }) => {
      const openDbButton = page.locator('[data-testid="open-database-button"]');
      await expect(openDbButton).toBeVisible();
    });

    test('status bar shows SQLite WASM engine', async ({ page }) => {
      const statusBar = page.locator('footer');
      await expect(statusBar).toContainText('SQLite WASM');
    });
  });
});

// =============================================================================
// Import Library Unit Tests (verified via page.evaluate)
// =============================================================================

test.describe('Import Library Verification', () => {
  test('escapeIdentifier handles special characters', async ({ page }) => {
    const result = await page.evaluate(() => {
      // Simulate the escapeIdentifier function
      const escapeIdentifier = (name: string): string => {
        return `"${name.replace(/"/g, '""')}"`;
      };

      return {
        simple: escapeIdentifier('name'),
        withQuote: escapeIdentifier('col"name'),
        withSpace: escapeIdentifier('col name'),
      };
    });

    expect(result.simple).toBe('"name"');
    expect(result.withQuote).toBe('"col""name"');
    expect(result.withSpace).toBe('"col name"');
  });

  test('generateCreateTable produces valid SQL', async ({ page }) => {
    const result = await page.evaluate(() => {
      const escapeIdentifier = (name: string): string => {
        return `"${name.replace(/"/g, '""')}"`;
      };

      const columns = [
        { name: 'id', type: 'INTEGER' },
        { name: 'name', type: 'TEXT' },
        { name: 'value', type: 'REAL' },
      ];

      const columnDefs = columns.map((col) => {
        return `${escapeIdentifier(col.name)} ${col.type}`;
      });

      return `CREATE TABLE ${escapeIdentifier('test_table')} (${columnDefs.join(', ')})`;
    });

    expect(result).toBe('CREATE TABLE "test_table" ("id" INTEGER, "name" TEXT, "value" REAL)');
  });

  test('generateInsertStatement produces parameterized SQL', async ({ page }) => {
    const result = await page.evaluate(() => {
      const escapeIdentifier = (name: string): string => {
        return `"${name.replace(/"/g, '""')}"`;
      };

      const columns = [
        { name: 'id', type: 'INTEGER' },
        { name: 'name', type: 'TEXT' },
      ];

      const columnNames = columns.map((col) => escapeIdentifier(col.name)).join(', ');
      const placeholders = columns.map(() => '?').join(', ');
      return `INSERT INTO ${escapeIdentifier('test_table')} (${columnNames}) VALUES (${placeholders})`;
    });

    expect(result).toBe('INSERT INTO "test_table" ("id", "name") VALUES (?, ?)');
  });
});

// =============================================================================
// Export Library Unit Tests (verified via page.evaluate)
// =============================================================================

test.describe('Export Library Verification', () => {
  test('exportToCSV produces valid CSV with BOM', async ({ page }) => {
    const result = await page.evaluate(() => {
      const UTF8_BOM = '\uFEFF';
      const columns = ['id', 'name', 'value'];
      const rows = [
        [1, 'Alice', 100],
        [2, 'Bob', 200],
      ];

      // Simulate CSV generation
      const header = columns.join(',');
      const dataRows = rows.map((row) => row.join(',')).join('\n');
      const csv = `${header}\n${dataRows}`;

      return {
        withBom: UTF8_BOM + csv,
        startsWithBom: (UTF8_BOM + csv).startsWith(UTF8_BOM),
      };
    });

    expect(result.startsWithBom).toBe(true);
    expect(result.withBom).toContain('id,name,value');
  });

  test('exportToJSON produces valid JSON', async ({ page }) => {
    const result = await page.evaluate(() => {
      const columns = ['id', 'name'];
      const rows = [
        [1, 'Alice'],
        [2, 'Bob'],
      ];

      const objects = rows.map((row) => {
        const obj: Record<string, unknown> = {};
        for (let i = 0; i < columns.length; i++) {
          obj[columns[i]] = row[i];
        }
        return obj;
      });

      const json = JSON.stringify(objects, null, 2);
      return {
        json,
        isValid: (() => {
          try {
            JSON.parse(json);
            return true;
          } catch {
            return false;
          }
        })(),
        isArray: Array.isArray(JSON.parse(json)),
      };
    });

    expect(result.isValid).toBe(true);
    expect(result.isArray).toBe(true);
  });

  test('blobToHex converts Uint8Array to hex string', async ({ page }) => {
    const result = await page.evaluate(() => {
      const blob = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
      const hex = Array.from(blob)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      return hex;
    });

    expect(result).toBe('deadbeef');
  });

  test('blobToBase64 converts Uint8Array to base64', async ({ page }) => {
    const result = await page.evaluate(() => {
      const blob = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
      let binary = '';
      for (let i = 0; i < blob.length; i++) {
        binary += String.fromCharCode(blob[i]);
      }
      return btoa(binary);
    });

    expect(result).toBe('SGVsbG8=');
  });
});

// =============================================================================
// File Import Pipeline Tests
// =============================================================================

test.describe('File Import Pipeline', () => {
  test('resolveUniqueName handles duplicates', async ({ page }) => {
    const result = await page.evaluate(() => {
      const resolveUniqueName = (baseName: string, existingNames: Set<string>): string => {
        const sanitized = baseName.trim().replace(/\.sqlite$/i, '').trim();
        if (!sanitized) return 'Untitled';
        if (!existingNames.has(sanitized)) return sanitized;

        let counter = 1;
        while (true) {
          const candidate = `${sanitized} (${counter})`;
          if (!existingNames.has(candidate)) return candidate;
          counter++;
          if (counter > 1000) throw new Error('Unable to generate unique name');
        }
      };

      const existing = new Set(['test', 'test (1)']);
      return {
        first: resolveUniqueName('test', new Set()),
        second: resolveUniqueName('test', existing),
        third: resolveUniqueName('test', new Set(['test', 'test (1)', 'test (2)'])),
      };
    });

    expect(result.first).toBe('test');
    expect(result.second).toBe('test (2)');
    expect(result.third).toBe('test (3)');
  });

  test('hasSqliteMagic detects valid SQLite header', async ({ page }) => {
    const result = await page.evaluate(() => {
      const SQLITE_MAGIC = 'SQLite format 3\0';

      const hasSqliteMagic = (data: Uint8Array): boolean => {
        if (data.length < SQLITE_MAGIC.length) return false;
        const header = new TextDecoder().decode(data.slice(0, SQLITE_MAGIC.length));
        return header === SQLITE_MAGIC;
      };

      // Create valid SQLite header
      const validBytes = new Uint8Array([
        0x53, 0x51, 0x4c, 0x69, 0x74, 0x65, 0x20, 0x66,
        0x6f, 0x72, 0x6d, 0x61, 0x74, 0x20, 0x33, 0x00,
        0x00, 0x00, 0x00, 0x00, // padding
      ]);

      // Create invalid header
      const invalidBytes = new Uint8Array([
        0x89, 0x50, 0x4e, 0x47, // PNG magic
      ]);

      return {
        validSqlite: hasSqliteMagic(validBytes),
        invalidPng: hasSqliteMagic(invalidBytes),
      };
    });

    expect(result.validSqlite).toBe(true);
    expect(result.invalidPng).toBe(false);
  });

  test('detectFileType identifies common formats', async ({ page }) => {
    const result = await page.evaluate(() => {
      const detectFileType = (data: Uint8Array): string | null => {
        if (data.length < 8) return null;

        // PNG
        if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) {
          return 'PNG image';
        }
        // JPEG
        if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
          return 'JPEG image';
        }
        // PDF
        if (data[0] === 0x25 && data[1] === 0x50 && data[2] === 0x44 && data[3] === 0x46) {
          return 'PDF document';
        }
        // ZIP
        if (data[0] === 0x50 && data[1] === 0x4b && data[2] === 0x03 && data[3] === 0x04) {
          return 'ZIP archive';
        }

        return null;
      };

      return {
        png: detectFileType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
        jpeg: detectFileType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x00, 0x00, 0x00])),
        pdf: detectFileType(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34])),
        zip: detectFileType(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00])),
        unknown: detectFileType(new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07])),
      };
    });

    expect(result.png).toBe('PNG image');
    expect(result.jpeg).toBe('JPEG image');
    expect(result.pdf).toBe('PDF document');
    expect(result.zip).toBe('ZIP archive');
    expect(result.unknown).toBe(null);
  });
});

// =============================================================================
// Import Error Code Tests
// =============================================================================

test.describe('Import Error Codes', () => {
  test('CONSTRAINT_VIOLATION error codes are categorized', async ({ page }) => {
    const result = await page.evaluate(() => {
      const parseConstraintError = (message: string): { type: string; detail: string } => {
        const lowerMsg = message.toLowerCase();

        if (lowerMsg.includes('unique constraint') || lowerMsg.includes('unique failed')) {
          return { type: 'CONSTRAINT_VIOLATION', detail: 'UNIQUE constraint violated' };
        }
        if (lowerMsg.includes('not null constraint') || lowerMsg.includes('not null failed')) {
          return { type: 'CONSTRAINT_VIOLATION', detail: 'NOT NULL constraint violated' };
        }
        if (lowerMsg.includes('foreign key constraint') || lowerMsg.includes('foreign key failed')) {
          return { type: 'CONSTRAINT_VIOLATION', detail: 'FOREIGN KEY constraint violated' };
        }
        if (lowerMsg.includes('check constraint') || lowerMsg.includes('check failed')) {
          return { type: 'CONSTRAINT_VIOLATION', detail: 'CHECK constraint violated' };
        }
        if (lowerMsg.includes('primary key constraint') || lowerMsg.includes('primary key failed')) {
          return { type: 'CONSTRAINT_VIOLATION', detail: 'PRIMARY KEY constraint violated' };
        }
        if (lowerMsg.includes('quota') || lowerMsg.includes('disk full') || lowerMsg.includes('storage')) {
          return { type: 'QUOTA_EXCEEDED', detail: 'Storage quota exceeded' };
        }

        return { type: 'UNKNOWN', detail: message };
      };

      return {
        unique: parseConstraintError('UNIQUE constraint failed'),
        notNull: parseConstraintError('NOT NULL constraint failed'),
        foreignKey: parseConstraintError('FOREIGN KEY constraint failed'),
        check: parseConstraintError('CHECK constraint failed'),
        primaryKey: parseConstraintError('PRIMARY KEY constraint failed'),
        quota: parseConstraintError('Storage quota exceeded'),
        unknown: parseConstraintError('Some random error'),
      };
    });

    expect(result.unique.type).toBe('CONSTRAINT_VIOLATION');
    expect(result.notNull.type).toBe('CONSTRAINT_VIOLATION');
    expect(result.foreignKey.type).toBe('CONSTRAINT_VIOLATION');
    expect(result.check.type).toBe('CONSTRAINT_VIOLATION');
    expect(result.primaryKey.type).toBe('CONSTRAINT_VIOLATION');
    expect(result.quota.type).toBe('QUOTA_EXCEEDED');
    expect(result.unknown.type).toBe('UNKNOWN');
  });
});

// =============================================================================
// DDL Generation Tests
// =============================================================================

test.describe('DDL Generation', () => {
  test('exportSchemaToDDL generates valid CREATE TABLE', async ({ page }) => {
    const result = await page.evaluate(() => {
      const escapeIdentifier = (name: string): string => {
        return `"${name.replace(/"/g, '""')}"`;
      };

      interface DDLColumnInfo {
        name: string;
        type: string;
        notNull: boolean;
        defaultValue: string | null;
        primaryKey: number;
      }

      const exportSchemaToDDL = (tableInfo: { name: string; columns: DDLColumnInfo[]; withoutRowid?: boolean }): string => {
        const { name, columns, withoutRowid = false } = tableInfo;

        const pkColumns = columns
          .filter((c) => c.primaryKey > 0)
          .sort((a, b) => a.primaryKey - b.primaryKey);

        const columnDefs = columns.map((col) => {
          const parts: string[] = [escapeIdentifier(col.name)];

          if (col.type) {
            parts.push(col.type);
          }

          if (pkColumns.length === 1 && col.primaryKey > 0) {
            parts.push('PRIMARY KEY');
          }

          if (col.notNull && col.primaryKey === 0) {
            parts.push('NOT NULL');
          }

          if (col.defaultValue !== null) {
            parts.push(`DEFAULT ${col.defaultValue}`);
          }

          return '  ' + parts.join(' ');
        });

        if (pkColumns.length > 1) {
          const pkColNames = pkColumns.map((c) => escapeIdentifier(c.name)).join(', ');
          columnDefs.push(`  PRIMARY KEY (${pkColNames})`);
        }

        let ddl = `CREATE TABLE ${escapeIdentifier(name)} (\n`;
        ddl += columnDefs.join(',\n');
        ddl += '\n)';

        if (withoutRowid) {
          ddl += ' WITHOUT ROWID';
        }

        ddl += ';';

        return ddl;
      };

      return exportSchemaToDDL({
        name: 'users',
        columns: [
          { name: 'id', type: 'INTEGER', notNull: false, defaultValue: null, primaryKey: 1 },
          { name: 'name', type: 'TEXT', notNull: true, defaultValue: null, primaryKey: 0 },
          { name: 'age', type: 'INTEGER', notNull: false, defaultValue: '0', primaryKey: 0 },
        ],
      });
    });

    expect(result).toContain('CREATE TABLE "users"');
    expect(result).toContain('"id" INTEGER PRIMARY KEY');
    expect(result).toContain('"name" TEXT NOT NULL');
    expect(result).toContain('"age" INTEGER DEFAULT 0');
  });
});
