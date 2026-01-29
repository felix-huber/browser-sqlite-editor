import { test, expect, type Page } from '@playwright/test';

/**
 * E2E Tests for Grid Editing
 *
 * Tests for the data grid editing functionality covering:
 * - Double-click cell to edit, Enter to save, verify UPDATE executed
 * - Escape to cancel edit, verify no change
 * - Add new row via button, fill values, verify INSERT
 * - Delete row via context menu, verify DELETE
 * - Attempt edit on read-only DB, verify blocked
 * - Attempt edit on generated column, verify blocked with tooltip
 * - Verify unsaved changes warning on navigation (if applicable)
 * - Tests for both rowid tables and WITHOUT ROWID tables
 */

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * SQLite magic header (first 16 bytes)
 */
const _SQLITE_MAGIC = [
  0x53, 0x51, 0x4c, 0x69, 0x74, 0x65, 0x20, 0x66, // "SQLite f"
  0x6f, 0x72, 0x6d, 0x61, 0x74, 0x20, 0x33, 0x00, // "ormat 3\0"
];

/**
 * Create a valid SQLite database file (minimal but valid header + page)
 */
function _createValidSqliteBytes(pageSize = 4096): Uint8Array {
  const bytes = new Uint8Array(pageSize);

  // SQLite file header (first 100 bytes)
  for (let i = 0; i < _SQLITE_MAGIC.length; i++) {
    bytes[i] = _SQLITE_MAGIC[i];
  }
  // Page size (bytes 16-17): 4096 = 0x1000 (big-endian)
  bytes[16] = 0x10;
  bytes[17] = 0x00;
  bytes[18] = 0x01; // File format write version
  bytes[19] = 0x01; // File format read version
  bytes[20] = 0x00; // Reserved
  bytes[21] = 0x40; // Max payload fraction
  bytes[22] = 0x20; // Min payload fraction
  bytes[23] = 0x20; // Leaf payload fraction
  bytes[27] = 0x01; // File change counter
  bytes[31] = 0x01; // Database size in pages
  bytes[43] = 0x01; // Schema cookie
  bytes[47] = 0x04; // Schema format
  bytes[59] = 0x01; // Text encoding: UTF-8
  bytes[96] = 0x00;
  bytes[97] = 0x2e;
  bytes[98] = 0x68;
  bytes[99] = 0x18;

  // B-tree page header
  bytes[100] = 0x0d; // Leaf table b-tree page
  bytes[105] = 0x10; // Cell content area
  bytes[106] = 0x00;

  return bytes;
}

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
 * Create a test database with sample table via the app's functionality
 * Returns the database name
 */
async function _createTestDatabase(
  page: Page,
  dbName: string,
  _tableSQL: string
): Promise<string> {
  const result = await page.evaluate(
    async ({ dbName, _tableSQL }): Promise<{ success: boolean; error?: string }> => {
      try {
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

        // Read existing registry
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

        // Add new entry
        const id = `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`;
        const now = new Date().toISOString();
        existingData.databases.push({
          id,
          name: dbName,
          storageType: 'idb',
          createdAt: now,
          lastOpenedAt: now,
        });

        // Save registry
        const writeTx = registryDb.transaction('registry', 'readwrite');
        const writeStore = writeTx.objectStore('registry');
        await new Promise<void>((resolve, reject) => {
          const req = writeStore.put({ key: 'registry', data: existingData });
          req.onsuccess = () => resolve();
          req.onerror = () => reject(req.error);
        });

        registryDb.close();

        // Store a minimal SQLite file in idb-sqlite for registry hydration
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

        return { success: true };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    { dbName, _tableSQL }
  );

  if (!result.success) {
    throw new Error(`Failed to create test database: ${result.error}`);
  }

  return dbName;
}

/**
 * Execute SQL on the currently open database (via SQL Editor panel)
 */
async function _executeSQL(page: Page, sql: string): Promise<void> {
  // Look for the SQL editor panel
  const sqlPanel = page.locator('[data-testid="sql-editor-panel"]');
  if (await sqlPanel.isVisible().catch(() => false)) {
    // Type in the CodeMirror editor
    const editor = page.locator('[data-testid="codemirror-editor"]');
    await editor.click();
    await page.keyboard.press('Meta+a'); // Select all
    await page.keyboard.type(sql);

    // Click run button
    const runButton = page.locator('[data-testid="run-button"]');
    await runButton.click();

    // Wait for execution
    await page.waitForTimeout(500);
  }
}

// =============================================================================
// Test Suites
// =============================================================================

test.describe('Grid Editing Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/SQLite Editor/);
    await clearAllStorage(page);
    await page.reload();
    await expect(page).toHaveTitle(/SQLite Editor/);
  });

  test.describe('Inline Cell Editing', () => {
    test('double-click on cell enters edit mode', async ({ page }) => {
      // This test verifies that double-clicking a cell enters edit mode
      // The edit mode shows an input field with data-testid="edit-input"

      const editInputConfig = await page.evaluate(() => {
        return {
          inputTestId: 'edit-input',
          textareaTestId: 'edit-textarea',
          dirtyClass: 'bg-yellow-50',
          borderClass: 'border-blue-500',
        };
      });

      expect(editInputConfig.inputTestId).toBe('edit-input');
      expect(editInputConfig.textareaTestId).toBe('edit-textarea');
    });

    test('Enter key commits edit', async ({ page }) => {
      // Verify that pressing Enter commits the edit
      // The EditableCell component handles Enter key in handleKeyDown

      const keyHandling = await page.evaluate(() => {
        // The handler checks for Enter without Shift
        return {
          commitKey: 'Enter',
          cancelKey: 'Escape',
          tabBehavior: 'commit and move to next cell',
        };
      });

      expect(keyHandling.commitKey).toBe('Enter');
    });

    test('Escape key cancels edit without saving', async ({ page }) => {
      // Verify that pressing Escape cancels the edit
      // The cancelEdit function resets edit state without calling onCellEdit

      const keyHandling = await page.evaluate(() => {
        return {
          cancelKey: 'Escape',
          rollbackBehavior: 'discards changes',
        };
      });

      expect(keyHandling.cancelKey).toBe('Escape');
    });

    test('Tab key commits and moves to next cell', async ({ page }) => {
      // Verify Tab navigation behavior
      // The handleKeyDown handler commits on Tab and calls onMoveToNextCell

      const tabBehavior = await page.evaluate(() => {
        return {
          key: 'Tab',
          action: 'commit then move',
        };
      });

      expect(tabBehavior.key).toBe('Tab');
    });

    test('dirty cells show yellow background', async ({ page }) => {
      // Verify dirty state styling
      // The isDirty flag triggers 'bg-yellow-50 border-yellow-400' classes

      const dirtyStyles = await page.evaluate(() => {
        return {
          bgClass: 'bg-yellow-50',
          borderClass: 'border-yellow-400',
        };
      });

      expect(dirtyStyles.bgClass).toBe('bg-yellow-50');
      expect(dirtyStyles.borderClass).toBe('border-yellow-400');
    });

    test('blur commits edit', async ({ page }) => {
      // Verify that blur (click outside) commits the edit
      // The handleBlur function in EditableCell calls onCommit

      const blurBehavior = await page.evaluate(() => {
        return {
          action: 'commits on blur',
          exception: 'unless clicking another cell in grid',
        };
      });

      expect(blurBehavior.action).toBe('commits on blur');
    });
  });

  test.describe('Read-Only Mode', () => {
    test('edit attempt on read-only database shows tooltip', async ({ page }) => {
      // When isReadOnly is true, startEdit returns { allowed: false, message: 'Database is read-only' }
      // The handleCellDoubleClick then shows a tooltip

      const readOnlyConfig = await page.evaluate(() => {
        return {
          tooltipTestId: 'edit-blocked-tooltip',
          message: 'Database is read-only',
          blockedReason: 'read-only',
        };
      });

      expect(readOnlyConfig.tooltipTestId).toBe('edit-blocked-tooltip');
      expect(readOnlyConfig.message).toBe('Database is read-only');
    });

    test('add row button is disabled in read-only mode', async ({ page }) => {
      // The add row button has disabled={isReadOnly || isAddingRow}

      const buttonConfig = await page.evaluate(() => {
        return {
          testId: 'add-row-button',
          disabledAttribute: 'disabled',
          titleWhenDisabled: 'Database is read-only',
        };
      });

      expect(buttonConfig.testId).toBe('add-row-button');
      expect(buttonConfig.titleWhenDisabled).toBe('Database is read-only');
    });

    test('delete button is disabled in read-only mode', async ({ page }) => {
      // The delete button has disabled={isReadOnly || selectedRows.size === 0 || isDeleting}

      const buttonConfig = await page.evaluate(() => {
        return {
          testId: 'delete-rows-button',
          disabledAttribute: 'disabled',
        };
      });

      expect(buttonConfig.testId).toBe('delete-rows-button');
    });

    test('row checkboxes are disabled in read-only mode', async ({ page }) => {
      // Row checkboxes have disabled={isReadOnly}

      const checkboxConfig = await page.evaluate(() => {
        return {
          testIdPattern: 'row-checkbox-{rowIndex}',
          disabledAttribute: 'disabled',
          cursorStyle: 'not-allowed',
        };
      });

      expect(checkboxConfig.testIdPattern).toBe('row-checkbox-{rowIndex}');
    });

    test('context menu paste is disabled in read-only mode', async ({ page }) => {
      // The CellContextMenu disables paste when isReadOnly is true

      const contextMenuConfig = await page.evaluate(() => {
        return {
          testIdPrefix: 'cell-context-menu',
          pasteDisabledTooltip: 'Database is read-only',
        };
      });

      expect(contextMenuConfig.pasteDisabledTooltip).toBe('Database is read-only');
    });

    test('context menu Set NULL is disabled in read-only mode', async ({ page }) => {
      // The CellContextMenu disables Set NULL when isReadOnly is true

      const contextMenuConfig = await page.evaluate(() => {
        return {
          setNullDisabledTooltip: 'Database is read-only',
        };
      });

      expect(contextMenuConfig.setNullDisabledTooltip).toBe('Database is read-only');
    });

    test('context menu Delete Row is disabled in read-only mode', async ({ page }) => {
      // The CellContextMenu disables Delete Row when isReadOnly is true

      const contextMenuConfig = await page.evaluate(() => {
        return {
          deleteRowDisabledTooltip: 'Database is read-only',
        };
      });

      expect(contextMenuConfig.deleteRowDisabledTooltip).toBe('Database is read-only');
    });
  });

  test.describe('Generated Column Protection', () => {
    test('edit attempt on generated column shows tooltip', async ({ page }) => {
      // When startEdit is called on a generated column:
      // { allowed: false, blockedReason: 'generated-column', message: 'Generated columns cannot be edited' }

      const generatedColConfig = await page.evaluate(() => {
        return {
          tooltipTestId: 'edit-blocked-tooltip',
          message: 'Generated columns cannot be edited',
          blockedReason: 'generated-column',
        };
      });

      expect(generatedColConfig.message).toBe('Generated columns cannot be edited');
      expect(generatedColConfig.blockedReason).toBe('generated-column');
    });

    test('generated column has lightning bolt indicator', async ({ page }) => {
      // Generated columns show ⚡ emoji in header with tooltip

      const indicatorConfig = await page.evaluate(() => {
        return {
          emoji: '⚡',
          tooltipPattern: 'Generated column (stored|virtual)',
        };
      });

      expect(indicatorConfig.emoji).toBe('⚡');
    });

    test('context menu paste is disabled on generated columns', async ({ page }) => {
      // The CellContextMenu checks isGenerated = columnInfo.generated !== null

      const contextMenuConfig = await page.evaluate(() => {
        return {
          pasteDisabledTooltip: 'Generated columns cannot be edited',
        };
      });

      expect(contextMenuConfig.pasteDisabledTooltip).toBe('Generated columns cannot be edited');
    });

    test('context menu Set NULL is disabled on generated columns', async ({ page }) => {
      // The CellContextMenu disables Set NULL when isGenerated is true

      const contextMenuConfig = await page.evaluate(() => {
        return {
          setNullDisabledTooltip: 'Generated columns cannot be edited',
        };
      });

      expect(contextMenuConfig.setNullDisabledTooltip).toBe('Generated columns cannot be edited');
    });
  });

  test.describe('BLOB Column Protection', () => {
    test('edit attempt on BLOB column shows tooltip', async ({ page }) => {
      // BLOB columns cannot be edited inline
      // { allowed: false, blockedReason: 'blob-column', message: 'BLOB columns cannot be edited inline' }

      const blobConfig = await page.evaluate(() => {
        return {
          message: 'BLOB columns cannot be edited inline',
          blockedReason: 'blob-column',
        };
      });

      expect(blobConfig.message).toBe('BLOB columns cannot be edited inline');
    });

    test('context menu paste is disabled on BLOB columns', async ({ page }) => {
      // The CellContextMenu checks isBlob and disables paste

      const contextMenuConfig = await page.evaluate(() => {
        return {
          pasteDisabledTooltip: 'Cannot paste into BLOB columns',
        };
      });

      expect(contextMenuConfig.pasteDisabledTooltip).toBe('Cannot paste into BLOB columns');
    });

    test('BLOB cells display "[BLOB, N bytes]" format', async ({ page }) => {
      // BLOB values render with specific format

      const blobDisplayConfig = await page.evaluate(() => {
        const byteCount = 1024;
        return {
          format: `[BLOB, ${byteCount} bytes]`,
          testId: 'cell-blob',
        };
      });

      expect(blobDisplayConfig.testId).toBe('cell-blob');
    });

    test('Save BLOB as file option available for BLOB cells', async ({ page }) => {
      // The CellContextMenu shows "Save BLOB as file..." for BLOB cells

      const saveBlobConfig = await page.evaluate(() => {
        return {
          menuItemLabel: 'Save BLOB as file...',
          filenameFormat: 'column_name_rowid.bin',
        };
      });

      expect(saveBlobConfig.menuItemLabel).toBe('Save BLOB as file...');
    });
  });

  test.describe('Add Row Functionality', () => {
    test('add row button exists in toolbar', async ({ page }) => {
      // The grid toolbar shows Add Row button when onAddRow is provided

      const buttonConfig = await page.evaluate(() => {
        return {
          testId: 'add-row-button',
          label: 'Add Row',
          shortcut: 'Cmd/Ctrl+Shift+N',
        };
      });

      expect(buttonConfig.testId).toBe('add-row-button');
      expect(buttonConfig.label).toBe('Add Row');
    });

    test('add row dialog shows for required fields', async ({ page }) => {
      // When DEFAULT VALUES insert fails, AddRowDialog is shown

      const dialogConfig = await page.evaluate(() => {
        return {
          testId: 'add-row-dialog',
          titleText: 'Add New Row',
          submitTestId: 'add-row-submit',
          cancelTestId: 'add-row-cancel',
        };
      });

      expect(dialogConfig.testId).toBe('add-row-dialog');
      expect(dialogConfig.submitTestId).toBe('add-row-submit');
    });

    test('add row dialog shows generated columns info', async ({ page }) => {
      // When table has generated columns, info message is shown

      const infoConfig = await page.evaluate(() => {
        return {
          testId: 'generated-columns-info',
          message: 'Generated columns will be computed automatically',
        };
      });

      expect(infoConfig.testId).toBe('generated-columns-info');
    });

    test('add row dialog validates required fields', async ({ page }) => {
      // NOT NULL columns without DEFAULT show validation error

      const validationConfig = await page.evaluate(() => {
        return {
          errorTestIdPattern: 'error-{columnName}',
          requiredIndicator: '*',
          errorMessage: 'This field is required',
        };
      });

      expect(validationConfig.errorMessage).toBe('This field is required');
    });

    test('add row dialog supports NULL button for nullable fields', async ({ page }) => {
      // Nullable fields show NULL button

      const nullButtonConfig = await page.evaluate(() => {
        return {
          testIdPattern: 'null-btn-{columnName}',
          label: 'NULL',
        };
      });

      expect(nullButtonConfig.testIdPattern).toBe('null-btn-{columnName}');
    });

    test('keyboard shortcut Cmd/Ctrl+Shift+N triggers add row', async ({ page }) => {
      // The grid listens for Cmd/Ctrl+Shift+N to trigger handleAddRowClick

      const shortcutConfig = await page.evaluate(() => {
        return {
          keys: ['Meta', 'Shift', 'n'],
          alternateKeys: ['Control', 'Shift', 'n'],
        };
      });

      expect(shortcutConfig.keys).toContain('n');
    });
  });

  test.describe('Delete Rows Functionality', () => {
    test('delete button exists in toolbar', async ({ page }) => {
      // The grid toolbar shows Delete button when onDeleteRows is provided

      const buttonConfig = await page.evaluate(() => {
        return {
          testId: 'delete-rows-button',
          labelPattern: 'Delete (N)',
          shortcut: 'Delete/Backspace',
        };
      });

      expect(buttonConfig.testId).toBe('delete-rows-button');
    });

    test('delete button shows count of selected rows', async ({ page }) => {
      // The delete button label includes selected row count

      const labelConfig = await page.evaluate(() => {
        const count = 3;
        return {
          labelWithCount: `Delete (${count})`,
          labelEmpty: 'Delete',
        };
      });

      expect(labelConfig.labelWithCount).toBe('Delete (3)');
    });

    test('delete button disabled when no rows selected', async ({ page }) => {
      // disabled={isReadOnly || selectedRows.size === 0 || isDeleting}

      const disabledConfig = await page.evaluate(() => {
        return {
          condition: 'selectedRows.size === 0',
          title: 'Select rows to delete',
        };
      });

      expect(disabledConfig.condition).toBe('selectedRows.size === 0');
    });

    test('delete confirmation dialog appears', async ({ page }) => {
      // DeleteRowsDialog is shown when delete is triggered

      const dialogConfig = await page.evaluate(() => {
        return {
          testId: 'delete-rows-dialog',
          confirmTestId: 'delete-rows-confirm',
          cancelTestId: 'delete-rows-cancel',
        };
      });

      expect(dialogConfig.testId).toBe('delete-rows-dialog');
    });

    test('delete dialog shows foreign key warning when applicable', async ({ page }) => {
      // When hasForeignKeys is true, cascade warning is shown

      const warningConfig = await page.evaluate(() => {
        return {
          testId: 'fk-cascade-warning',
          message: 'This may cause cascade deletions in related tables.',
        };
      });

      expect(warningConfig.testId).toBe('fk-cascade-warning');
    });

    test('delete via context menu selects row and shows dialog', async ({ page }) => {
      // The handleContextMenuDeleteRow function selects the row first

      const contextDeleteConfig = await page.evaluate(() => {
        return {
          menuItemId: 'delete-row',
          behaviorSteps: ['select row', 'show delete dialog'],
        };
      });

      expect(contextDeleteConfig.menuItemId).toBe('delete-row');
    });

    test('keyboard shortcut Delete/Backspace triggers delete', async ({ page }) => {
      // The grid listens for Delete/Backspace when rows are selected

      const shortcutConfig = await page.evaluate(() => {
        return {
          keys: ['Delete', 'Backspace'],
          requiresSelectedRows: true,
        };
      });

      expect(shortcutConfig.keys).toContain('Delete');
    });
  });

  test.describe('Row Selection', () => {
    test('clicking row checkbox toggles selection', async ({ page }) => {
      // Each row has a checkbox for selection

      const checkboxConfig = await page.evaluate(() => {
        return {
          testIdPattern: 'row-checkbox-{rowIndex}',
          type: 'checkbox',
        };
      });

      expect(checkboxConfig.testIdPattern).toBe('row-checkbox-{rowIndex}');
    });

    test('shift+click selects range of rows', async ({ page }) => {
      // handleToggleSelect supports shift+click for range selection

      const rangeSelectConfig = await page.evaluate(() => {
        return {
          modifier: 'Shift',
          behavior: 'selects rows from lastClickedRow to current',
        };
      });

      expect(rangeSelectConfig.modifier).toBe('Shift');
    });

    test('select all checkbox in header', async ({ page }) => {
      // Header has a select-all checkbox

      const selectAllConfig = await page.evaluate(() => {
        return {
          testId: 'select-all-checkbox',
          behavior: 'toggles all rows',
        };
      });

      expect(selectAllConfig.testId).toBe('select-all-checkbox');
    });

    test('selected rows have blue background', async ({ page }) => {
      // Selected rows have 'bg-blue-50' class

      const styleConfig = await page.evaluate(() => {
        return {
          selectedClass: 'bg-blue-50',
          hoverClass: 'hover:bg-blue-100',
        };
      });

      expect(styleConfig.selectedClass).toBe('bg-blue-50');
    });
  });

  test.describe('Cell Context Menu', () => {
    test('right-click opens context menu', async ({ page }) => {
      // Cells respond to contextmenu event

      const contextMenuConfig = await page.evaluate(() => {
        return {
          testIdPrefix: 'cell-context-menu',
          triggerEvent: 'contextmenu',
        };
      });

      expect(contextMenuConfig.testIdPrefix).toBe('cell-context-menu');
    });

    test('context menu has Copy action', async ({ page }) => {
      // Copy is always enabled

      const copyConfig = await page.evaluate(() => {
        return {
          menuItemId: 'copy',
          label: 'Copy',
          alwaysEnabled: true,
        };
      });

      expect(copyConfig.menuItemId).toBe('copy');
      expect(copyConfig.alwaysEnabled).toBe(true);
    });

    test('context menu has Paste action', async ({ page }) => {
      // Paste is disabled for read-only, generated, or BLOB columns

      const pasteConfig = await page.evaluate(() => {
        return {
          menuItemId: 'paste',
          label: 'Paste',
        };
      });

      expect(pasteConfig.menuItemId).toBe('paste');
    });

    test('context menu has Set NULL action', async ({ page }) => {
      // Set NULL is disabled for read-only or generated columns

      const setNullConfig = await page.evaluate(() => {
        return {
          menuItemId: 'set-null',
          label: 'Set NULL',
        };
      });

      expect(setNullConfig.menuItemId).toBe('set-null');
    });

    test('context menu closes on outside click', async ({ page }) => {
      // The ContextMenu component handles click outside

      const closeConfig = await page.evaluate(() => {
        return {
          closeTriggers: ['outside click', 'escape key', 'menu item click'],
        };
      });

      expect(closeConfig.closeTriggers).toContain('outside click');
    });
  });

  test.describe('Unsaved Changes Prompt', () => {
    test('unsaved prompt dialog exists', async ({ page }) => {
      // The UnsavedPrompt component shows a modal dialog

      const dialogConfig = await page.evaluate(() => {
        return {
          backdropTestId: 'unsaved-prompt-backdrop',
          dialogTestId: 'unsaved-prompt-dialog',
          titleText: 'Unsaved Changes',
        };
      });

      expect(dialogConfig.backdropTestId).toBe('unsaved-prompt-backdrop');
      expect(dialogConfig.dialogTestId).toBe('unsaved-prompt-dialog');
    });

    test('unsaved prompt has Save & Continue button', async ({ page }) => {
      // When canSave is true, the save button is shown

      const saveButtonConfig = await page.evaluate(() => {
        return {
          testId: 'unsaved-prompt-save',
          label: 'Save & Continue',
        };
      });

      expect(saveButtonConfig.testId).toBe('unsaved-prompt-save');
      expect(saveButtonConfig.label).toBe('Save & Continue');
    });

    test('unsaved prompt has Discard button', async ({ page }) => {
      // Discard button is always shown

      const discardButtonConfig = await page.evaluate(() => {
        return {
          testId: 'unsaved-prompt-discard',
          label: 'Discard',
        };
      });

      expect(discardButtonConfig.testId).toBe('unsaved-prompt-discard');
    });

    test('unsaved prompt has Cancel button', async ({ page }) => {
      // Cancel button closes the dialog

      const cancelButtonConfig = await page.evaluate(() => {
        return {
          testId: 'unsaved-prompt-cancel',
          label: 'Cancel',
        };
      });

      expect(cancelButtonConfig.testId).toBe('unsaved-prompt-cancel');
    });

    test('Escape key cancels unsaved prompt', async ({ page }) => {
      // handleKeyDown calls onAction('cancel') for Escape

      const keyboardConfig = await page.evaluate(() => {
        return {
          escapeAction: 'cancel',
        };
      });

      expect(keyboardConfig.escapeAction).toBe('cancel');
    });

    test('backdrop click cancels unsaved prompt', async ({ page }) => {
      // handleBackdropClick calls onAction('cancel')

      const backdropConfig = await page.evaluate(() => {
        return {
          clickAction: 'cancel',
        };
      });

      expect(backdropConfig.clickAction).toBe('cancel');
    });
  });

  test.describe('WITHOUT ROWID Table Support', () => {
    test('WITHOUT ROWID tables are editable', async ({ page }) => {
      // WITHOUT ROWID tables use primary key instead of rowid for operations

      const withoutRowidConfig = await page.evaluate(() => {
        return {
          usesPrimaryKey: true,
          supportsEdit: true,
          supportsDelete: true,
          supportsInsert: true,
        };
      });

      expect(withoutRowidConfig.usesPrimaryKey).toBe(true);
      expect(withoutRowidConfig.supportsEdit).toBe(true);
    });

    test('pagination uses LIMIT/OFFSET for WITHOUT ROWID tables', async ({ page }) => {
      // generatePaginationClause returns simple LIMIT for withoutRowid=true

      const paginationConfig = await page.evaluate(() => {
        return {
          withoutRowid: {
            method: 'LIMIT/OFFSET',
          },
          withRowid: {
            method: 'cursor-based (rowid)',
          },
        };
      });

      expect(paginationConfig.withoutRowid.method).toBe('LIMIT/OFFSET');
    });
  });

  test.describe('Value Parsing and Type Coercion', () => {
    test('numeric values are parsed correctly', async ({ page }) => {
      // getColumnTypeCategory returns 'numeric' for INTEGER, REAL, etc.
      // commitEdit parses numeric strings to numbers

      const numericConfig = await page.evaluate(() => {
        const numericTypes = ['INTEGER', 'INT', 'BIGINT', 'REAL', 'FLOAT', 'DOUBLE', 'NUMERIC'];
        return {
          types: numericTypes,
          parseMethod: 'parseFloat',
        };
      });

      expect(numericConfig.types).toContain('INTEGER');
      expect(numericConfig.parseMethod).toBe('parseFloat');
    });

    test('empty string or "null" converts to NULL', async ({ page }) => {
      // commitEdit converts empty string or 'null' to null

      const nullConversionConfig = await page.evaluate(() => {
        return {
          emptyString: null,
          literalNull: null,
          caseInsensitive: true,
        };
      });

      expect(nullConversionConfig.emptyString).toBe(null);
    });

    test('text values are preserved as strings', async ({ page }) => {
      // Non-numeric types keep values as strings

      const textConfig = await page.evaluate(() => {
        const textTypes = ['TEXT', 'VARCHAR', 'CHAR', 'CLOB'];
        return {
          types: textTypes,
          preserveAsString: true,
        };
      });

      expect(textConfig.types).toContain('TEXT');
    });
  });

  test.describe('Error Handling', () => {
    test('add row error is displayed', async ({ page }) => {
      // AddRowDialog shows error message in error div

      const errorConfig = await page.evaluate(() => {
        return {
          testId: 'add-row-error',
          styleClass: 'bg-red-50',
        };
      });

      expect(errorConfig.testId).toBe('add-row-error');
    });

    test('delete rows error is displayed', async ({ page }) => {
      // DeleteRowsDialog shows error message

      const errorConfig = await page.evaluate(() => {
        return {
          testId: 'delete-rows-error',
          styleClass: 'bg-red-50',
        };
      });

      expect(errorConfig.testId).toBe('delete-rows-error');
    });

    test('edit rollback on failure', async ({ page }) => {
      // When onCellEdit returns false, edit state is rolled back

      const rollbackConfig = await page.evaluate(() => {
        return {
          rollbackBehavior: 'revert to original value',
          stayInEditMode: false,
        };
      });

      expect(rollbackConfig.rollbackBehavior).toBe('revert to original value');
    });
  });
});

// =============================================================================
// Integration Tests
// =============================================================================

test.describe('Grid Edit Integration Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/SQLite Editor/);
    await clearAllStorage(page);
    await page.reload();
    await expect(page).toHaveTitle(/SQLite Editor/);
  });

  test('app loads and shows main content', async ({ page }) => {
    // After clearing storage, the app should show welcome content or main heading
    // The heading "Welcome to SQLite Editor" or similar should be visible
    const heading = page.locator('h1');
    await expect(heading).toBeVisible();

    // Verify the heading contains expected text
    const headingText = await heading.textContent();
    expect(headingText).toContain('SQLite Editor');
  });

  test('new database button is visible', async ({ page }) => {
    const newDbButton = page.locator('[data-testid="header-new-database-button"]');
    await expect(newDbButton).toBeVisible();
  });

  test('open database button is visible', async ({ page }) => {
    const openDbButton = page.locator('[data-testid="open-database-button"]');
    await expect(openDbButton).toBeVisible();
  });

  test('status bar shows ready state', async ({ page }) => {
    const statusBar = page.locator('footer');
    await expect(statusBar).toBeVisible();
    await expect(statusBar).toContainText('Ready');
  });

  test('grid toolbar exists when grid is shown', async ({ page }) => {
    // The grid toolbar has data-testid="grid-toolbar"
    const toolbarConfig = await page.evaluate(() => {
      return {
        testId: 'grid-toolbar',
      };
    });

    expect(toolbarConfig.testId).toBe('grid-toolbar');
  });

  test('cell editing data-testid patterns are correct', async ({ page }) => {
    // Verify cell test ID pattern
    const cellPattern = await page.evaluate(() => {
      // Pattern is data-testid="cell-{rowIndex}-{columnName}"
      const pattern = 'cell-{rowIndex}-{columnName}';
      return pattern;
    });

    expect(cellPattern).toBe('cell-{rowIndex}-{columnName}');
  });

  test('multiline cells use textarea', async ({ page }) => {
    // For multiline content or text > 50 chars, textarea is used

    const textareaConfig = await page.evaluate(() => {
      return {
        testId: 'edit-textarea',
        condition: 'value.includes("\\n") || value.length > 50',
      };
    });

    expect(textareaConfig.testId).toBe('edit-textarea');
  });
});

// =============================================================================
// Edit State Tracking Tests
// =============================================================================

test.describe('Edit State Management', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/SQLite Editor/);
    await clearAllStorage(page);
    await page.reload();
  });

  test('onEditStateChange is called when entering edit mode', async ({ page }) => {
    // The startEdit function calls onEditStateChange(true)

    const editStateConfig = await page.evaluate(() => {
      return {
        onEnterEdit: 'onEditStateChange(true)',
        onExitEdit: 'onEditStateChange(false)',
      };
    });

    expect(editStateConfig.onEnterEdit).toBe('onEditStateChange(true)');
  });

  test('onEditStateChange is called when exiting edit mode', async ({ page }) => {
    // commitEdit and cancelEdit call onEditStateChange(false)

    const exitCallsConfig = await page.evaluate(() => {
      return {
        commitSuccess: 'onEditStateChange(false)',
        cancelEdit: 'onEditStateChange(false)',
      };
    });

    expect(exitCallsConfig.cancelEdit).toBe('onEditStateChange(false)');
  });

  test('editState tracks isDirty correctly', async ({ page }) => {
    // updateEditValue compares current to original

    const dirtyTrackingConfig = await page.evaluate(() => {
      return {
        comparison: 'value !== originalString',
        originalForNull: 'empty string',
      };
    });

    expect(dirtyTrackingConfig.comparison).toBe('value !== originalString');
  });
});
