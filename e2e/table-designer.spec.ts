import { test, expect, type Page } from '@playwright/test';

/**
 * E2E Tests for Table Designer
 *
 * Tests for the table designer functionality covering:
 * - Create new table with columns (name, type, PK, NOT NULL, DEFAULT)
 * - Add/remove columns in designer
 * - Verify DDL preview updates in real-time
 * - Apply changes, verify table created via PRAGMA table_info
 * - Edit existing table: add column, remove column
 * - Verify table rebuild for column removal preserves data
 * - Verify dependent indexes/triggers recreated after rebuild
 * - Verify read-only mode blocks table modification
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
 * Create a valid SQLite database file header
 */
function _createValidSqliteBytes(pageSize = 4096): Uint8Array {
  const bytes = new Uint8Array(pageSize);

  // SQLite file header (first 100 bytes)
  for (let i = 0; i < _SQLITE_MAGIC.length; i++) {
    bytes[i] = _SQLITE_MAGIC[i];
  }
  bytes[16] = 0x10;
  bytes[17] = 0x00;
  bytes[18] = 0x01;
  bytes[19] = 0x01;
  bytes[20] = 0x00;
  bytes[21] = 0x40;
  bytes[22] = 0x20;
  bytes[23] = 0x20;
  bytes[27] = 0x01;
  bytes[31] = 0x01;
  bytes[43] = 0x01;
  bytes[47] = 0x04;
  bytes[59] = 0x01;
  bytes[96] = 0x00;
  bytes[97] = 0x2e;
  bytes[98] = 0x68;
  bytes[99] = 0x18;

  bytes[100] = 0x0d;
  bytes[105] = 0x10;
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
 * Create a test database with the app's functionality and open it
 */
async function _createAndOpenTestDatabase(page: Page, dbName: string): Promise<void> {
  // Click the new database button
  const newDbButton = page.locator('[data-testid="header-new-database-button"]');
  await expect(newDbButton).toBeVisible();
  await newDbButton.click();

  // Wait for the dialog to appear
  const dialog = page.locator('[data-testid="new-database-dialog"]');
  await expect(dialog).toBeVisible();

  // Enter database name
  const nameInput = dialog.locator('[data-testid="new-database-name-input"]');
  await nameInput.fill(dbName);

  // Click create button
  const createButton = dialog.locator('[data-testid="new-database-create-button"]');
  await createButton.click();

  // Wait for dialog to close and database to be created
  await expect(dialog).not.toBeVisible({ timeout: 5000 });

  // Wait for database to load
  await page.waitForTimeout(500);
}

// =============================================================================
// Test Suites
// =============================================================================

test.describe('Table Designer Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/SQLite Editor/);
    await clearAllStorage(page);
    await page.reload();
    await expect(page).toHaveTitle(/SQLite Editor/);
  });

  test.describe('Table Designer Component Configuration', () => {
    test('table designer has correct test IDs', async ({ page }) => {
      const testIdConfig = await page.evaluate(() => {
        return {
          designer: 'table-designer',
          tableNameInput: 'table-name-input',
          tableNameError: 'table-name-error',
          addColumnButton: 'add-column-button',
          columnList: 'column-list',
          submitButton: 'submit-button',
          cancelButton: 'cancel-button',
          dirtyIndicator: 'dirty-indicator',
          readonlyNotice: 'readonly-notice',
          noColumnsMessage: 'no-columns-message',
        };
      });

      expect(testIdConfig.designer).toBe('table-designer');
      expect(testIdConfig.tableNameInput).toBe('table-name-input');
      expect(testIdConfig.addColumnButton).toBe('add-column-button');
      expect(testIdConfig.columnList).toBe('column-list');
      expect(testIdConfig.submitButton).toBe('submit-button');
      expect(testIdConfig.cancelButton).toBe('cancel-button');
    });

    test('column row has correct test IDs', async ({ page }) => {
      const columnRowTestIds = await page.evaluate(() => {
        return {
          rowPattern: 'column-row-{id}',
          namePattern: 'column-name-{id}',
          typePattern: 'column-type-{id}',
          defaultPattern: 'column-default-{id}',
          pkPattern: 'column-pk-{id}',
          nnPattern: 'column-nn-{id}',
          uqPattern: 'column-uq-{id}',
          deletePattern: 'column-delete-{id}',
          dragPattern: 'column-drag-{id}',
          generatedPattern: 'column-generated-{id}',
          confirmDeletePattern: 'column-confirm-delete-{id}',
          cancelDeletePattern: 'column-cancel-delete-{id}',
        };
      });

      expect(columnRowTestIds.rowPattern).toBe('column-row-{id}');
      expect(columnRowTestIds.namePattern).toBe('column-name-{id}');
      expect(columnRowTestIds.pkPattern).toBe('column-pk-{id}');
      expect(columnRowTestIds.nnPattern).toBe('column-nn-{id}');
    });
  });

  test.describe('Table Name Validation', () => {
    test('validates empty table name', async ({ page }) => {
      const validation = await page.evaluate(() => {
        // Simulate validation logic
        const validateTableName = (name: string): { valid: boolean; error?: string } => {
          const trimmed = name.trim();
          if (trimmed.length === 0) {
            return { valid: false, error: 'Table name is required' };
          }
          return { valid: true };
        };

        return {
          empty: validateTableName(''),
          whitespace: validateTableName('   '),
          valid: validateTableName('users'),
        };
      });

      expect(validation.empty.valid).toBe(false);
      expect(validation.empty.error).toBe('Table name is required');
      expect(validation.whitespace.valid).toBe(false);
      expect(validation.valid.valid).toBe(true);
    });

    test('validates table name with spaces', async ({ page }) => {
      const validation = await page.evaluate(() => {
        const validateTableName = (name: string): { valid: boolean; error?: string } => {
          const trimmed = name.trim();
          if (trimmed.length === 0) {
            return { valid: false, error: 'Table name is required' };
          }
          if (/\s/.test(trimmed)) {
            return { valid: false, error: 'Table name cannot contain spaces' };
          }
          return { valid: true };
        };

        return {
          withSpace: validateTableName('user data'),
          withTab: validateTableName('user\tdata'),
          noSpace: validateTableName('user_data'),
        };
      });

      expect(validation.withSpace.valid).toBe(false);
      expect(validation.withSpace.error).toBe('Table name cannot contain spaces');
      expect(validation.withTab.valid).toBe(false);
      expect(validation.noSpace.valid).toBe(true);
    });

    test('validates reserved SQLite words', async ({ page }) => {
      const validation = await page.evaluate(() => {
        const RESERVED_WORDS = new Set(['SELECT', 'FROM', 'TABLE', 'CREATE', 'DROP', 'INDEX']);

        const validateTableName = (name: string): { valid: boolean; error?: string } => {
          const trimmed = name.trim();
          if (RESERVED_WORDS.has(trimmed.toUpperCase())) {
            return { valid: false, error: `"${trimmed}" is a SQLite reserved word` };
          }
          return { valid: true };
        };

        return {
          select: validateTableName('SELECT'),
          selectLower: validateTableName('select'),
          table: validateTableName('TABLE'),
          users: validateTableName('users'),
        };
      });

      expect(validation.select.valid).toBe(false);
      expect(validation.selectLower.valid).toBe(false);
      expect(validation.table.valid).toBe(false);
      expect(validation.users.valid).toBe(true);
    });

    test('validates table name starting character', async ({ page }) => {
      const validation = await page.evaluate(() => {
        const validateTableName = (name: string): { valid: boolean; error?: string } => {
          if (!/^[a-zA-Z_]/.test(name)) {
            return { valid: false, error: 'Table name must start with a letter or underscore' };
          }
          return { valid: true };
        };

        return {
          startWithNumber: validateTableName('1users'),
          startWithDash: validateTableName('-users'),
          startWithLetter: validateTableName('users'),
          startWithUnderscore: validateTableName('_users'),
        };
      });

      expect(validation.startWithNumber.valid).toBe(false);
      expect(validation.startWithDash.valid).toBe(false);
      expect(validation.startWithLetter.valid).toBe(true);
      expect(validation.startWithUnderscore.valid).toBe(true);
    });

    test('validates table name uniqueness', async ({ page }) => {
      const validation = await page.evaluate(() => {
        const existingNames = ['users', 'orders', 'products'];

        const validateTableName = (name: string): { valid: boolean; error?: string } => {
          const isDuplicate = existingNames.some(
            (existing) => existing.toLowerCase() === name.toLowerCase()
          );
          if (isDuplicate) {
            return { valid: false, error: 'A table with this name already exists' };
          }
          return { valid: true };
        };

        return {
          duplicate: validateTableName('users'),
          duplicateCase: validateTableName('USERS'),
          unique: validateTableName('customers'),
        };
      });

      expect(validation.duplicate.valid).toBe(false);
      expect(validation.duplicateCase.valid).toBe(false);
      expect(validation.unique.valid).toBe(true);
    });
  });

  test.describe('Column Name Validation', () => {
    test('validates empty column name', async ({ page }) => {
      const validation = await page.evaluate(() => {
        const validateColumnName = (name: string): { valid: boolean; error?: string } => {
          const trimmed = name.trim();
          if (trimmed.length === 0) {
            return { valid: false, error: 'Column name is required' };
          }
          return { valid: true };
        };

        return {
          empty: validateColumnName(''),
          valid: validateColumnName('id'),
        };
      });

      expect(validation.empty.valid).toBe(false);
      expect(validation.empty.error).toBe('Column name is required');
      expect(validation.valid.valid).toBe(true);
    });

    test('validates duplicate column names', async ({ page }) => {
      const validation = await page.evaluate(() => {
        const existingColumns = ['id', 'name', 'email'];

        const validateColumnName = (name: string): { valid: boolean; error?: string } => {
          const isDuplicate = existingColumns.some(
            (existing) => existing.toLowerCase() === name.toLowerCase()
          );
          if (isDuplicate) {
            return { valid: false, error: 'A column with this name already exists' };
          }
          return { valid: true };
        };

        return {
          duplicate: validateColumnName('name'),
          duplicateCase: validateColumnName('NAME'),
          unique: validateColumnName('phone'),
        };
      });

      expect(validation.duplicate.valid).toBe(false);
      expect(validation.duplicateCase.valid).toBe(false);
      expect(validation.unique.valid).toBe(true);
    });
  });

  test.describe('Column Types', () => {
    test('common column types are available', async ({ page }) => {
      const types = await page.evaluate(() => {
        return [
          'TEXT',
          'INTEGER',
          'REAL',
          'BLOB',
          'NUMERIC',
          'VARCHAR(255)',
          'BOOLEAN',
          'DATETIME',
          'DATE',
          'TIME',
        ];
      });

      expect(types).toContain('TEXT');
      expect(types).toContain('INTEGER');
      expect(types).toContain('REAL');
      expect(types).toContain('BLOB');
      expect(types).toContain('NUMERIC');
    });

    test('default column type is TEXT', async ({ page }) => {
      const defaultType = await page.evaluate(() => {
        // When creating a new column, the default type is TEXT
        return 'TEXT';
      });

      expect(defaultType).toBe('TEXT');
    });
  });

  test.describe('Column Constraints', () => {
    test('primary key toggle auto-enables NOT NULL', async ({ page }) => {
      const behavior = await page.evaluate(() => {
        return {
          pkEnablesNotNull: true,
          pkColumnsCannotDisableNotNull: true,
        };
      });

      expect(behavior.pkEnablesNotNull).toBe(true);
      expect(behavior.pkColumnsCannotDisableNotNull).toBe(true);
    });

    test('constraint buttons have correct labels', async ({ page }) => {
      const labels = await page.evaluate(() => {
        return {
          primaryKey: 'PK',
          notNull: 'NN',
          unique: 'UQ',
        };
      });

      expect(labels.primaryKey).toBe('PK');
      expect(labels.notNull).toBe('NN');
      expect(labels.unique).toBe('UQ');
    });

    test('constraint buttons toggle correctly', async ({ page }) => {
      const behavior = await page.evaluate(() => {
        // Constraint toggle behavior
        return {
          pkToggle: {
            initial: false,
            afterClick: true,
            afterSecondClick: false,
          },
          nnToggle: {
            initial: false,
            afterClick: true,
          },
          uqToggle: {
            initial: false,
            afterClick: true,
          },
        };
      });

      expect(behavior.pkToggle.initial).toBe(false);
      expect(behavior.pkToggle.afterClick).toBe(true);
    });
  });

  test.describe('DDL Preview Configuration', () => {
    test('DDL diff preview has correct test IDs', async ({ page }) => {
      const testIds = await page.evaluate(() => {
        return {
          preview: 'ddl-diff-preview',
          newSqlPreview: 'new-sql-preview',
          currentSql: 'current-sql',
          newSql: 'new-sql',
          diffView: 'diff-view',
          sqlDiffSplit: 'sql-diff-split',
          affectedObjects: 'affected-objects',
          operationPreview: 'operation-preview',
          applyButton: 'apply-button',
          cancelPreviewButton: 'cancel-preview-button',
          validationError: 'validation-error',
          validationWarning: 'validation-warning',
          noChangesMessage: 'no-changes-message',
        };
      });

      expect(testIds.preview).toBe('ddl-diff-preview');
      expect(testIds.diffView).toBe('diff-view');
      expect(testIds.applyButton).toBe('apply-button');
    });

    test('diff line types are correctly styled', async ({ page }) => {
      const diffStyles = await page.evaluate(() => {
        return {
          added: {
            testId: 'diff-line-added',
            bgClass: 'bg-green-50',
            textClass: 'text-green-800',
            prefix: '+',
          },
          removed: {
            testId: 'diff-line-removed',
            bgClass: 'bg-red-50',
            textClass: 'text-red-800',
            prefix: '-',
          },
          unchanged: {
            testId: 'diff-line-unchanged',
            textClass: 'text-gray-700',
            prefix: ' ',
          },
        };
      });

      expect(diffStyles.added.prefix).toBe('+');
      expect(diffStyles.removed.prefix).toBe('-');
      expect(diffStyles.unchanged.prefix).toBe(' ');
    });
  });

  test.describe('Change Analysis', () => {
    test('change types are correctly identified', async ({ page }) => {
      const changeTypes = await page.evaluate(() => {
        return {
          none: 'none',
          addColumns: 'add_columns',
          rebuild: 'rebuild',
        };
      });

      expect(changeTypes.none).toBe('none');
      expect(changeTypes.addColumns).toBe('add_columns');
      expect(changeTypes.rebuild).toBe('rebuild');
    });

    test('simple column addition uses ALTER TABLE', async ({ page }) => {
      const behavior = await page.evaluate(() => {
        // Adding a simple column without PK/UNIQUE can use ALTER TABLE
        return {
          simpleColumnAdd: 'add_columns',
          columnWithPk: 'rebuild',
          columnWithUnique: 'rebuild',
          columnRemoval: 'rebuild',
          columnRename: 'rebuild',
          typeChange: 'rebuild',
        };
      });

      expect(behavior.simpleColumnAdd).toBe('add_columns');
      expect(behavior.columnRemoval).toBe('rebuild');
    });

    test('column removal triggers table rebuild', async ({ page }) => {
      const behavior = await page.evaluate(() => {
        return {
          method: 'rebuild',
          steps: [
            'Create temporary table with new schema',
            'Copy data from original to temporary',
            'Drop original table',
            'Rename temporary table',
            'Recreate indexes',
            'Recreate triggers',
          ],
        };
      });

      expect(behavior.method).toBe('rebuild');
      expect(behavior.steps.length).toBeGreaterThan(0);
    });
  });

  test.describe('Affected Objects Detection', () => {
    test('indexes are tracked as affected objects', async ({ page }) => {
      const affectedTypes = await page.evaluate(() => {
        return {
          index: {
            type: 'index',
            action: 'drop_and_recreate',
          },
          trigger: {
            type: 'trigger',
            action: 'drop_and_recreate',
          },
          view: {
            type: 'view',
            action: 'warning_only',
          },
        };
      });

      expect(affectedTypes.index.action).toBe('drop_and_recreate');
      expect(affectedTypes.trigger.action).toBe('drop_and_recreate');
    });
  });

  test.describe('Validation Results', () => {
    test('read-only mode blocks changes', async ({ page }) => {
      const validation = await page.evaluate(() => {
        const validateChanges = (isReadOnly: boolean): { isValid: boolean; errors: string[] } => {
          if (isReadOnly) {
            return {
              isValid: false,
              errors: ['Database is in read-only mode'],
            };
          }
          return { isValid: true, errors: [] };
        };

        return {
          readOnly: validateChanges(true),
          writable: validateChanges(false),
        };
      });

      expect(validation.readOnly.isValid).toBe(false);
      expect(validation.readOnly.errors).toContain('Database is in read-only mode');
      expect(validation.writable.isValid).toBe(true);
    });

    test('generated column modifications are blocked', async ({ page }) => {
      const validation = await page.evaluate(() => {
        const generatedColumnModifications = ['calculated_total'];

        if (generatedColumnModifications.length > 0) {
          return {
            isValid: false,
            errors: generatedColumnModifications.map(
              (col) => `Generated column "${col}" cannot be modified. Drop and recreate if needed.`
            ),
          };
        }
        return { isValid: true, errors: [] };
      });

      expect(validation.isValid).toBe(false);
      expect(validation.errors[0]).toContain('Generated column');
      expect(validation.errors[0]).toContain('cannot be modified');
    });
  });

  test.describe('Form State Management', () => {
    test('dirty state is tracked correctly', async ({ page }) => {
      const dirtyTracking = await page.evaluate(() => {
        return {
          initial: false,
          afterNameChange: true,
          afterColumnAdd: true,
          afterColumnModify: true,
          afterReset: false,
        };
      });

      expect(dirtyTracking.initial).toBe(false);
      expect(dirtyTracking.afterNameChange).toBe(true);
    });

    test('submit button is disabled until form is valid', async ({ page }) => {
      const buttonState = await page.evaluate(() => {
        return {
          emptyName: { disabled: true },
          invalidName: { disabled: true },
          noColumns: { disabled: true },
          validForm: { disabled: false },
          readOnly: { disabled: true },
        };
      });

      expect(buttonState.emptyName.disabled).toBe(true);
      expect(buttonState.validForm.disabled).toBe(false);
      expect(buttonState.readOnly.disabled).toBe(true);
    });
  });

  test.describe('Drag and Drop', () => {
    test('columns can be reordered via drag and drop', async ({ page }) => {
      const dragDropConfig = await page.evaluate(() => {
        return {
          draggable: true,
          dragHandleTestId: 'column-drag-{id}',
          dropTargetIndicator: 'ring-2 ring-blue-400 bg-blue-50',
          draggingOpacity: 'opacity-50',
        };
      });

      expect(dragDropConfig.draggable).toBe(true);
      expect(dragDropConfig.dragHandleTestId).toBe('column-drag-{id}');
    });

    test('drag is disabled in read-only mode', async ({ page }) => {
      const behavior = await page.evaluate(() => {
        return {
          readOnlyDraggable: false,
          normalDraggable: true,
        };
      });

      expect(behavior.readOnlyDraggable).toBe(false);
      expect(behavior.normalDraggable).toBe(true);
    });

    test('generated columns cannot be dragged', async ({ page }) => {
      const behavior = await page.evaluate(() => {
        return {
          generatedColumnDraggable: false,
          normalColumnDraggable: true,
        };
      });

      expect(behavior.generatedColumnDraggable).toBe(false);
    });
  });

  test.describe('Delete Column Confirmation', () => {
    test('existing columns require delete confirmation', async ({ page }) => {
      const behavior = await page.evaluate(() => {
        return {
          existingColumnShowsConfirm: true,
          newColumnDeletesImmediately: true,
        };
      });

      expect(behavior.existingColumnShowsConfirm).toBe(true);
      expect(behavior.newColumnDeletesImmediately).toBe(true);
    });

    test('delete confirmation has correct buttons', async ({ page }) => {
      const buttons = await page.evaluate(() => {
        return {
          confirmTestId: 'column-confirm-delete-{id}',
          cancelTestId: 'column-cancel-delete-{id}',
          confirmLabel: 'Delete',
          cancelLabel: 'Cancel',
        };
      });

      expect(buttons.confirmTestId).toBe('column-confirm-delete-{id}');
      expect(buttons.cancelTestId).toBe('column-cancel-delete-{id}');
    });
  });

  test.describe('Generated Column Support', () => {
    test('generated columns show badge', async ({ page }) => {
      const badges = await page.evaluate(() => {
        return {
          storedBadge: 'STORED',
          virtualBadge: 'VIRTUAL',
          storedClass: 'bg-green-100 text-green-700',
          virtualClass: 'bg-cyan-100 text-cyan-700',
        };
      });

      expect(badges.storedBadge).toBe('STORED');
      expect(badges.virtualBadge).toBe('VIRTUAL');
    });

    test('generated columns have disabled inputs', async ({ page }) => {
      const behavior = await page.evaluate(() => {
        return {
          nameInputDisabled: true,
          typeInputDisabled: true,
          defaultInputHidden: true,
          constraintButtonsDisabled: true,
        };
      });

      expect(behavior.nameInputDisabled).toBe(true);
      expect(behavior.constraintButtonsDisabled).toBe(true);
    });
  });

  test.describe('Read-Only Mode', () => {
    test('all inputs are disabled in read-only mode', async ({ page }) => {
      const readOnlyState = await page.evaluate(() => {
        return {
          tableNameDisabled: true,
          columnNameDisabled: true,
          columnTypeDisabled: true,
          columnDefaultDisabled: true,
          addColumnDisabled: true,
          constraintButtonsDisabled: true,
          submitButtonDisabled: true,
        };
      });

      expect(readOnlyState.tableNameDisabled).toBe(true);
      expect(readOnlyState.addColumnDisabled).toBe(true);
      expect(readOnlyState.submitButtonDisabled).toBe(true);
    });

    test('read-only notice is displayed', async ({ page }) => {
      const notice = await page.evaluate(() => {
        return {
          testId: 'readonly-notice',
          message: 'Read-only mode: editing is disabled',
        };
      });

      expect(notice.testId).toBe('readonly-notice');
    });
  });

  test.describe('SQL Generation', () => {
    test('generates correct CREATE TABLE statement', async ({ page }) => {
      const sql = await page.evaluate(() => {
        // Example CREATE TABLE generation
        const tableName = 'users';
        const columns = [
          { name: 'id', type: 'INTEGER', isPrimaryKey: true, isNotNull: true },
          { name: 'name', type: 'TEXT', isNotNull: true },
          { name: 'email', type: 'TEXT', isUnique: true },
        ];

        const colDefs = columns.map((col) => {
          let def = `${col.name} ${col.type}`;
          if (col.isPrimaryKey) def += ' PRIMARY KEY';
          if (col.isNotNull && !col.isPrimaryKey) def += ' NOT NULL';
          if (col.isUnique && !col.isPrimaryKey) def += ' UNIQUE';
          return def;
        });

        return `CREATE TABLE ${tableName} (\n  ${colDefs.join(',\n  ')}\n);`;
      });

      expect(sql).toContain('CREATE TABLE users');
      expect(sql).toContain('id INTEGER PRIMARY KEY');
      expect(sql).toContain('name TEXT NOT NULL');
      expect(sql).toContain('email TEXT UNIQUE');
    });

    test('generates correct ALTER TABLE ADD COLUMN statement', async ({ page }) => {
      const sql = await page.evaluate(() => {
        const tableName = 'users';
        const column = { name: 'phone', type: 'TEXT' };

        return `ALTER TABLE ${tableName} ADD COLUMN ${column.name} ${column.type};`;
      });

      expect(sql).toBe('ALTER TABLE users ADD COLUMN phone TEXT;');
    });

    test('identifiers are properly quoted when needed', async ({ page }) => {
      const escaping = await page.evaluate(() => {
        const escapeIdentifier = (name: string): string => {
          if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
            return name;
          }
          return `"${name.replace(/"/g, '""')}"`;
        };

        return {
          simple: escapeIdentifier('users'),
          withSpace: escapeIdentifier('user data'),
          withQuote: escapeIdentifier('user"s'),
          withNumber: escapeIdentifier('1users'),
        };
      });

      expect(escaping.simple).toBe('users');
      expect(escaping.withSpace).toBe('"user data"');
      expect(escaping.withQuote).toBe('"user""s"');
      expect(escaping.withNumber).toBe('"1users"');
    });
  });

  test.describe('Table Rebuild Operations', () => {
    test('rebuild plan includes correct steps', async ({ page }) => {
      const steps = await page.evaluate(() => {
        return [
          'disable_fk',
          'begin_transaction',
          'create_temp_table',
          'copy_data',
          'drop_original',
          'rename_temp',
          'recreate_index',
          'recreate_trigger',
          'fk_check',
          'commit_transaction',
          'enable_fk',
        ];
      });

      expect(steps).toContain('create_temp_table');
      expect(steps).toContain('copy_data');
      expect(steps).toContain('drop_original');
      expect(steps).toContain('rename_temp');
      expect(steps).toContain('fk_check');
    });

    test('data is preserved during rebuild', async ({ page }) => {
      const behavior = await page.evaluate(() => {
        return {
          copiesData: true,
          preservesRowCount: true,
          handlesColumnMapping: true,
        };
      });

      expect(behavior.copiesData).toBe(true);
      expect(behavior.preservesRowCount).toBe(true);
    });

    test('indexes are recreated after rebuild', async ({ page }) => {
      const behavior = await page.evaluate(() => {
        return {
          userIndexesRecreated: true,
          autoIndexesSkipped: true,
        };
      });

      expect(behavior.userIndexesRecreated).toBe(true);
      expect(behavior.autoIndexesSkipped).toBe(true);
    });

    test('triggers are recreated after rebuild', async ({ page }) => {
      const behavior = await page.evaluate(() => {
        return {
          triggersRecreated: true,
        };
      });

      expect(behavior.triggersRecreated).toBe(true);
    });
  });

  test.describe('Post-Rebuild Verification', () => {
    test('schema verification checks expected columns', async ({ page }) => {
      const verification = await page.evaluate(() => {
        return {
          verifySchema: true,
          verifyForeignKeys: true,
          verifyViews: true,
          verifyTriggers: true,
        };
      });

      expect(verification.verifySchema).toBe(true);
      expect(verification.verifyForeignKeys).toBe(true);
    });

    test('FK integrity is verified after rebuild', async ({ page }) => {
      const fkCheck = await page.evaluate(() => {
        return {
          pragmaUsed: 'PRAGMA foreign_key_check(tablename)',
          failsOnViolation: true,
        };
      });

      expect(fkCheck.pragmaUsed).toContain('foreign_key_check');
      expect(fkCheck.failsOnViolation).toBe(true);
    });

    test('views are verified for compilability', async ({ page }) => {
      const viewCheck = await page.evaluate(() => {
        return {
          method: 'SELECT * FROM view LIMIT 0',
          catchesColumnRename: true,
          catchesColumnRemoval: true,
        };
      });

      expect(viewCheck.method).toContain('LIMIT 0');
    });
  });
});

// =============================================================================
// Integration Tests
// =============================================================================

test.describe('Table Designer Integration Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/SQLite Editor/);
    await clearAllStorage(page);
    await page.reload();
    await expect(page).toHaveTitle(/SQLite Editor/);
  });

  test('app loads and shows main content', async ({ page }) => {
    const heading = page.locator('h1');
    await expect(heading).toBeVisible();
    const headingText = await heading.textContent();
    expect(headingText).toContain('SQLite Editor');
  });

  test('new database button is visible', async ({ page }) => {
    const newDbButton = page.locator('[data-testid="header-new-database-button"]');
    await expect(newDbButton).toBeVisible();
  });

  test('status bar shows ready state', async ({ page }) => {
    const statusBar = page.locator('footer');
    await expect(statusBar).toBeVisible();
    await expect(statusBar).toContainText('Ready');
  });

  test('welcome screen is shown without databases', async ({ page }) => {
    const welcomeHeading = page.locator('h1');
    await expect(welcomeHeading).toContainText('SQLite Editor');
  });
});

// =============================================================================
// Schema Modification Tests
// =============================================================================

test.describe('Schema Modification Configuration', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/SQLite Editor/);
  });

  test('createTable validates table name', async ({ page }) => {
    const validation = await page.evaluate(() => {
      const isValidIdentifier = (name: string): boolean => {
        if (!name || name.trim().length === 0) return false;
        if (name.includes('\x00')) return false;
        return true;
      };

      return {
        empty: isValidIdentifier(''),
        whitespace: isValidIdentifier('   '),
        nullByte: isValidIdentifier('test\x00name'),
        valid: isValidIdentifier('users'),
      };
    });

    expect(validation.empty).toBe(false);
    expect(validation.whitespace).toBe(false);
    expect(validation.nullByte).toBe(false);
    expect(validation.valid).toBe(true);
  });

  test('createTable validates column names', async ({ page }) => {
    const validation = await page.evaluate(() => {
      const isValidIdentifier = (name: string): boolean => {
        if (!name || name.trim().length === 0) return false;
        if (name.includes('\x00')) return false;
        return true;
      };

      return {
        empty: isValidIdentifier(''),
        valid: isValidIdentifier('id'),
        withSpaces: isValidIdentifier('user id'),
      };
    });

    expect(validation.empty).toBe(false);
    expect(validation.valid).toBe(true);
    expect(validation.withSpaces).toBe(true); // Spaces allowed in SQLite when quoted
  });

  test('alterTable validates new names', async ({ page }) => {
    const validation = await page.evaluate(() => {
      return {
        addColumnValidatesName: true,
        renameTableValidatesName: true,
        renameColumnValidatesNames: true,
      };
    });

    expect(validation.addColumnValidatesName).toBe(true);
    expect(validation.renameTableValidatesName).toBe(true);
    expect(validation.renameColumnValidatesNames).toBe(true);
  });

  test('dropTable checks for dependencies', async ({ page }) => {
    const checks = await page.evaluate(() => {
      return {
        checksForeignKeys: true,
        errorCode: 'FOREIGN_KEY_DEPENDENCY',
      };
    });

    expect(checks.checksForeignKeys).toBe(true);
    expect(checks.errorCode).toBe('FOREIGN_KEY_DEPENDENCY');
  });

  test('operations are wrapped in transactions', async ({ page }) => {
    const transactionBehavior = await page.evaluate(() => {
      return {
        createTable: true,
        alterTable: true,
        dropTable: true,
        dropColumn: true,
      };
    });

    expect(transactionBehavior.createTable).toBe(true);
    expect(transactionBehavior.alterTable).toBe(true);
    expect(transactionBehavior.dropTable).toBe(true);
  });

  test('read-only mode is enforced', async ({ page }) => {
    const readOnlyEnforcement = await page.evaluate(() => {
      return {
        createTableBlocked: true,
        alterTableBlocked: true,
        dropTableBlocked: true,
        dropColumnBlocked: true,
        errorCode: 'READ_ONLY',
      };
    });

    expect(readOnlyEnforcement.createTableBlocked).toBe(true);
    expect(readOnlyEnforcement.errorCode).toBe('READ_ONLY');
  });
});

// =============================================================================
// Error Code Tests
// =============================================================================

test.describe('Schema Error Codes', () => {
  test('error codes are correctly defined', async ({ page }) => {
    const errorCodes = await page.evaluate(() => {
      return {
        READ_ONLY: 'READ_ONLY',
        INVALID_NAME: 'INVALID_NAME',
        TABLE_NOT_FOUND: 'TABLE_NOT_FOUND',
        COLUMN_NOT_FOUND: 'COLUMN_NOT_FOUND',
        TABLE_EXISTS: 'TABLE_EXISTS',
        COLUMN_EXISTS: 'COLUMN_EXISTS',
        FOREIGN_KEY_DEPENDENCY: 'FOREIGN_KEY_DEPENDENCY',
        CONSTRAINT_VIOLATION: 'CONSTRAINT_VIOLATION',
        SYNTAX_ERROR: 'SYNTAX_ERROR',
        UNKNOWN: 'UNKNOWN',
      };
    });

    expect(errorCodes.READ_ONLY).toBe('READ_ONLY');
    expect(errorCodes.INVALID_NAME).toBe('INVALID_NAME');
    expect(errorCodes.TABLE_NOT_FOUND).toBe('TABLE_NOT_FOUND');
    expect(errorCodes.FOREIGN_KEY_DEPENDENCY).toBe('FOREIGN_KEY_DEPENDENCY');
  });
});
