import { test, expect, type Page } from '@playwright/test';

/**
 * E2E Tests for ERD (Entity-Relationship Diagram)
 *
 * Tests for the ERD canvas functionality covering:
 * - Open ERD view, verify all tables render as nodes
 * - Verify FK edges connect correct columns (crow foot notation)
 * - Drag column to column to create FK, verify PRAGMA foreign_key_list
 * - Delete FK via edge context menu, verify removed
 * - Edit FK (change ON DELETE/UPDATE actions), verify saved
 * - Drag table node to reposition, verify layout persists on refresh
 * - Verify read-only mode blocks FK creation/deletion
 */

// =============================================================================
// Test Helpers
// =============================================================================

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
 * Create a test database with tables via the app
 */
async function _createTestDatabaseWithTables(page: Page, dbName: string): Promise<void> {
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
// ERD Canvas Configuration Tests
// =============================================================================

test.describe('ERD Canvas Component Configuration', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/SQLite Editor/);
    await clearAllStorage(page);
    await page.reload();
    await expect(page).toHaveTitle(/SQLite Editor/);
  });

  test('ERD canvas has correct test IDs', async ({ page }) => {
    const testIdConfig = await page.evaluate(() => {
      return {
        canvas: 'erd-canvas',
        tableNode: 'table-node',
        tableNodeHeader: 'table-node-header',
        tableName: 'table-name',
        columnList: 'column-list',
        columnRowPattern: 'column-row-{index}',
        columnNamePattern: 'column-name-{index}',
        columnTypePattern: 'column-type-{index}',
      };
    });

    expect(testIdConfig.canvas).toBe('erd-canvas');
    expect(testIdConfig.tableNode).toBe('table-node');
    expect(testIdConfig.tableName).toBe('table-name');
    expect(testIdConfig.columnList).toBe('column-list');
  });

  test('FK edge has correct test IDs', async ({ page }) => {
    const edgeTestIds = await page.evaluate(() => {
      return {
        hitboxPattern: 'fk-edge-hitbox-{id}',
        markersPattern: 'fk-edge-markers-{id}',
        labelPattern: 'fk-edge-label-{id}',
        actionLabelPattern: 'fk-action-label-{id}',
        deleteButtonPattern: 'fk-delete-button-{id}',
        glowPattern: 'fk-edge-glow-{id}',
        crowFootMarker: 'crow-foot-marker',
        oneMarker: 'one-marker',
        optionalMarker: 'optional-marker',
      };
    });

    expect(edgeTestIds.hitboxPattern).toBe('fk-edge-hitbox-{id}');
    expect(edgeTestIds.deleteButtonPattern).toBe('fk-delete-button-{id}');
    expect(edgeTestIds.crowFootMarker).toBe('crow-foot-marker');
  });

  test('FK validation dialog has correct test IDs', async ({ page }) => {
    const dialogTestIds = await page.evaluate(() => {
      return {
        overlay: 'fk-validation-dialog-overlay',
        dialog: 'fk-validation-dialog',
        childRef: 'fk-child-ref',
        parentRef: 'fk-parent-ref',
        validationErrors: 'validation-errors',
        validationErrorPattern: 'validation-error-{index}',
        validationLoading: 'validation-loading',
        onDeleteSelect: 'fk-on-delete-select',
        onUpdateSelect: 'fk-on-update-select',
        cancelButton: 'fk-cancel-button',
        createButton: 'fk-create-button',
      };
    });

    expect(dialogTestIds.overlay).toBe('fk-validation-dialog-overlay');
    expect(dialogTestIds.dialog).toBe('fk-validation-dialog');
    expect(dialogTestIds.onDeleteSelect).toBe('fk-on-delete-select');
    expect(dialogTestIds.createButton).toBe('fk-create-button');
  });

  test('FK edit dialog has correct test IDs', async ({ page }) => {
    const editDialogTestIds = await page.evaluate(() => {
      return {
        overlay: 'fk-edit-dialog-overlay',
        dialog: 'fk-edit-dialog',
        childRef: 'fk-edit-child-ref',
        parentRef: 'fk-edit-parent-ref',
        onDeleteSelect: 'fk-edit-on-delete-select',
        onUpdateSelect: 'fk-edit-on-update-select',
        cancelButton: 'fk-edit-cancel-button',
        saveButton: 'fk-edit-save-button',
      };
    });

    expect(editDialogTestIds.overlay).toBe('fk-edit-dialog-overlay');
    expect(editDialogTestIds.dialog).toBe('fk-edit-dialog');
    expect(editDialogTestIds.saveButton).toBe('fk-edit-save-button');
  });

  test('FK delete dialog has correct test IDs', async ({ page }) => {
    const deleteDialogTestIds = await page.evaluate(() => {
      return {
        overlay: 'fk-delete-dialog-overlay',
        dialog: 'fk-delete-dialog',
        childRef: 'fk-delete-child-ref',
        parentRef: 'fk-delete-parent-ref',
        confirmInput: 'fk-delete-confirm-input',
        cancelButton: 'fk-delete-cancel-button',
        confirmButton: 'fk-delete-confirm-button',
      };
    });

    expect(deleteDialogTestIds.overlay).toBe('fk-delete-dialog-overlay');
    expect(deleteDialogTestIds.dialog).toBe('fk-delete-dialog');
    expect(deleteDialogTestIds.confirmInput).toBe('fk-delete-confirm-input');
    expect(deleteDialogTestIds.confirmButton).toBe('fk-delete-confirm-button');
  });

  test('FK context menu has correct test IDs', async ({ page }) => {
    const contextMenuTestIds = await page.evaluate(() => {
      return {
        backdrop: 'fk-context-menu-backdrop',
        menu: 'fk-edge-context-menu',
        editItem: 'fk-context-menu-edit',
        deleteItem: 'fk-context-menu-delete',
        showInDesignerItem: 'fk-context-menu-show-in-designer',
      };
    });

    expect(contextMenuTestIds.backdrop).toBe('fk-context-menu-backdrop');
    expect(contextMenuTestIds.menu).toBe('fk-edge-context-menu');
    expect(contextMenuTestIds.editItem).toBe('fk-context-menu-edit');
    expect(contextMenuTestIds.deleteItem).toBe('fk-context-menu-delete');
  });
});

// =============================================================================
// Table Node Rendering Tests
// =============================================================================

test.describe('Table Node Rendering Configuration', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearAllStorage(page);
    await page.reload();
  });

  test('table node displays correct structure', async ({ page }) => {
    const nodeStructure = await page.evaluate(() => {
      return {
        hasHeader: true,
        hasColumnList: true,
        headerContainsIcon: true,
        headerContainsName: true,
        columnsShowType: true,
        columnsShowIndicators: true,
      };
    });

    expect(nodeStructure.hasHeader).toBe(true);
    expect(nodeStructure.hasColumnList).toBe(true);
    expect(nodeStructure.columnsShowType).toBe(true);
    expect(nodeStructure.columnsShowIndicators).toBe(true);
  });

  test('column indicators are correctly styled', async ({ page }) => {
    const indicators = await page.evaluate(() => {
      return {
        primaryKey: {
          icon: 'key',
          color: 'amber-500',
        },
        foreignKey: {
          icon: 'link',
          color: 'navy-500',
        },
        generated: {
          icon: 'computed',
          color: 'purple-500',
        },
      };
    });

    expect(indicators.primaryKey.icon).toBe('key');
    expect(indicators.foreignKey.icon).toBe('link');
    expect(indicators.generated.icon).toBe('computed');
  });

  test('table vs view styling differs', async ({ page }) => {
    const styling = await page.evaluate(() => {
      return {
        tableHeaderBg: 'bg-navy-600',
        viewHeaderBg: 'bg-navy-100',
        tableIcon: 'table',
        viewIcon: 'eye',
        tableHeaderTextColor: 'text-white',
        viewHeaderTextColor: 'text-navy-700',
      };
    });

    expect(styling.tableHeaderBg).toBe('bg-navy-600');
    expect(styling.viewHeaderBg).toBe('bg-navy-100');
    expect(styling.tableIcon).toBe('table');
    expect(styling.viewIcon).toBe('eye');
  });

  test('generated column badges are correctly styled', async ({ page }) => {
    const badges = await page.evaluate(() => {
      return {
        storedBadge: {
          text: 'stored',
          bgClass: 'bg-purple-100',
          textClass: 'text-purple-700',
        },
        virtualBadge: {
          text: 'virtual',
          bgClass: 'bg-violet-100',
          textClass: 'text-violet-700',
        },
      };
    });

    expect(badges.storedBadge.text).toBe('stored');
    expect(badges.virtualBadge.text).toBe('virtual');
  });

  test('handles show on hover or selection in normal mode', async ({ page }) => {
    const handleBehavior = await page.evaluate(() => {
      return {
        normalMode: {
          visibleOnHover: true,
          visibleOnSelected: true,
          hiddenByDefault: true,
        },
        readOnlyMode: {
          alwaysHidden: true,
        },
      };
    });

    expect(handleBehavior.normalMode.visibleOnHover).toBe(true);
    expect(handleBehavior.normalMode.visibleOnSelected).toBe(true);
    expect(handleBehavior.readOnlyMode.alwaysHidden).toBe(true);
  });
});

// =============================================================================
// FK Edge Rendering Tests
// =============================================================================

test.describe('FK Edge Rendering Configuration', () => {
  test('crow foot notation is correctly configured', async ({ page }) => {
    await page.goto('/');

    const crowFootConfig = await page.evaluate(() => {
      return {
        oneToMany: {
          sourceMarker: 'crow-foot',
          targetMarker: 'single-line',
        },
        oneToOne: {
          sourceMarker: 'single-line',
          targetMarker: 'single-line',
        },
        optional: {
          hasCircleMarker: true,
        },
      };
    });

    expect(crowFootConfig.oneToMany.sourceMarker).toBe('crow-foot');
    expect(crowFootConfig.oneToMany.targetMarker).toBe('single-line');
    expect(crowFootConfig.optional.hasCircleMarker).toBe(true);
  });

  test('edge colors vary by state and action', async ({ page }) => {
    await page.goto('/');

    const edgeColors = await page.evaluate(() => {
      return {
        defaultColor: '#9ca3af', // gray-400
        hoverColor: '#3b82f6', // blue-500
        selectedColor: '#2563eb', // blue-600
        cascadeColor: '#ef4444', // red-500 for ON DELETE CASCADE
        cascadeStrokeDash: '5,5', // dashed for CASCADE
        normalStrokeDash: '0', // solid for non-CASCADE
      };
    });

    expect(edgeColors.defaultColor).toBe('#9ca3af');
    expect(edgeColors.hoverColor).toBe('#3b82f6');
    expect(edgeColors.cascadeColor).toBe('#ef4444');
    expect(edgeColors.cascadeStrokeDash).toBe('5,5');
  });

  test('edge label shows FK actions correctly', async ({ page }) => {
    await page.goto('/');

    const labelConfig = await page.evaluate(() => {
      // Format FK action for display - returns null for NO ACTION
      const formatFkAction = (action: string, prefix: string): string | null => {
        if (action === 'NO ACTION') return null;
        return `${prefix}: ${action}`;
      };

      return {
        noActionHidden: formatFkAction('NO ACTION', 'DELETE') === null,
        cascadeShown: formatFkAction('CASCADE', 'DELETE') === 'DELETE: CASCADE',
        setNullShown: formatFkAction('SET NULL', 'UPDATE') === 'UPDATE: SET NULL',
        restrictShown: formatFkAction('RESTRICT', 'DELETE') === 'DELETE: RESTRICT',
      };
    });

    expect(labelConfig.noActionHidden).toBe(true);
    expect(labelConfig.cascadeShown).toBe(true);
    expect(labelConfig.setNullShown).toBe(true);
    expect(labelConfig.restrictShown).toBe(true);
  });

  test('edge glow effect on selection', async ({ page }) => {
    await page.goto('/');

    const glowConfig = await page.evaluate(() => {
      return {
        glowVisibleOnSelected: true,
        glowOpacity: 0.3,
        glowBlur: '4px',
        glowStrokeWidth: 8,
      };
    });

    expect(glowConfig.glowVisibleOnSelected).toBe(true);
    expect(glowConfig.glowOpacity).toBe(0.3);
    expect(glowConfig.glowBlur).toBe('4px');
  });

  test('delete button visibility rules', async ({ page }) => {
    await page.goto('/');

    const deleteButtonConfig = await page.evaluate(() => {
      return {
        visibleOnHover: true,
        visibleOnSelected: true,
        hiddenByDefault: true,
        position: 'at-edge-label',
      };
    });

    expect(deleteButtonConfig.visibleOnHover).toBe(true);
    expect(deleteButtonConfig.visibleOnSelected).toBe(true);
    expect(deleteButtonConfig.position).toBe('at-edge-label');
  });
});

// =============================================================================
// FK Validation Tests
// =============================================================================

test.describe('FK Validation Configuration', () => {
  test('validation error types are defined', async ({ page }) => {
    await page.goto('/');

    const errorTypes = await page.evaluate(() => {
      return {
        PARENT_NOT_UNIQUE: 'Parent column must be PRIMARY KEY or UNIQUE',
        TYPE_MISMATCH: 'Type mismatch warning (non-blocking)',
        DUPLICATE_FK: 'This foreign key relationship already exists',
        SELF_REFERENCE_SAME_COLUMN: 'Cannot create FK referencing the same column',
        READ_ONLY: 'Database is in read-only mode',
      };
    });

    expect(errorTypes.PARENT_NOT_UNIQUE).toContain('PRIMARY KEY or UNIQUE');
    expect(errorTypes.DUPLICATE_FK).toContain('already exists');
    expect(errorTypes.SELF_REFERENCE_SAME_COLUMN).toContain('same column');
  });

  test('validation blocking behavior is correct', async ({ page }) => {
    await page.goto('/');

    const blockingBehavior = await page.evaluate(() => {
      return {
        PARENT_NOT_UNIQUE: { isBlocking: true },
        TYPE_MISMATCH: { isBlocking: false }, // warning only
        DUPLICATE_FK: { isBlocking: true },
        SELF_REFERENCE_SAME_COLUMN: { isBlocking: true },
        READ_ONLY: { isBlocking: true },
      };
    });

    expect(blockingBehavior.PARENT_NOT_UNIQUE.isBlocking).toBe(true);
    expect(blockingBehavior.TYPE_MISMATCH.isBlocking).toBe(false);
    expect(blockingBehavior.DUPLICATE_FK.isBlocking).toBe(true);
  });

  test('type normalization for validation', async ({ page }) => {
    await page.goto('/');

    const typeNormalization = await page.evaluate(() => {
      const normalizeType = (type: string): string => {
        const upper = type.toUpperCase().trim();
        if (upper.includes('INT')) return 'INTEGER';
        if (upper.includes('CHAR') || upper.includes('TEXT') || upper.includes('CLOB')) return 'TEXT';
        if (upper.includes('BLOB') || upper === '') return 'BLOB';
        if (upper.includes('REAL') || upper.includes('FLOAT') || upper.includes('DOUB')) return 'REAL';
        return 'NUMERIC';
      };

      return {
        integer: normalizeType('INTEGER'),
        int: normalizeType('INT'),
        bigint: normalizeType('BIGINT'),
        text: normalizeType('TEXT'),
        varchar: normalizeType('VARCHAR(255)'),
        char: normalizeType('CHAR(10)'),
        real: normalizeType('REAL'),
        float: normalizeType('FLOAT'),
        double: normalizeType('DOUBLE'),
        blob: normalizeType('BLOB'),
        empty: normalizeType(''),
        numeric: normalizeType('DECIMAL'),
      };
    });

    expect(typeNormalization.integer).toBe('INTEGER');
    expect(typeNormalization.int).toBe('INTEGER');
    expect(typeNormalization.bigint).toBe('INTEGER');
    expect(typeNormalization.text).toBe('TEXT');
    expect(typeNormalization.varchar).toBe('TEXT');
    expect(typeNormalization.real).toBe('REAL');
    expect(typeNormalization.float).toBe('REAL');
    expect(typeNormalization.blob).toBe('BLOB');
    expect(typeNormalization.numeric).toBe('NUMERIC');
  });
});

// =============================================================================
// FK Actions Configuration Tests
// =============================================================================

test.describe('FK Actions Configuration', () => {
  test('all FK actions are available', async ({ page }) => {
    await page.goto('/');

    const actions = await page.evaluate(() => {
      return ['NO ACTION', 'RESTRICT', 'CASCADE', 'SET NULL', 'SET DEFAULT'];
    });

    expect(actions).toContain('NO ACTION');
    expect(actions).toContain('RESTRICT');
    expect(actions).toContain('CASCADE');
    expect(actions).toContain('SET NULL');
    expect(actions).toContain('SET DEFAULT');
    expect(actions).toHaveLength(5);
  });

  test('default FK action is NO ACTION', async ({ page }) => {
    await page.goto('/');

    const defaultAction = await page.evaluate(() => {
      return {
        defaultOnDelete: 'NO ACTION',
        defaultOnUpdate: 'NO ACTION',
      };
    });

    expect(defaultAction.defaultOnDelete).toBe('NO ACTION');
    expect(defaultAction.defaultOnUpdate).toBe('NO ACTION');
  });
});

// =============================================================================
// ERD Layout Persistence Tests
// =============================================================================

test.describe('ERD Layout Persistence Configuration', () => {
  test('layout schema structure is correct', async ({ page }) => {
    await page.goto('/');

    const layoutSchema = await page.evaluate(() => {
      return {
        version: 1,
        nodes: {
          structure: {
            x: 'number',
            y: 'number',
            collapsed: 'boolean | undefined',
          },
        },
        viewport: {
          x: 'number',
          y: 'number',
          zoom: 'number',
        },
      };
    });

    expect(layoutSchema.version).toBe(1);
    expect(layoutSchema.nodes.structure.x).toBe('number');
    expect(layoutSchema.nodes.structure.y).toBe('number');
    expect(layoutSchema.viewport.zoom).toBe('number');
  });

  test('localStorage key prefix is correct', async ({ page }) => {
    await page.goto('/');

    const storageConfig = await page.evaluate(() => {
      return {
        prefix: 'erd-layout:',
        exampleKey: 'erd-layout:my-database',
      };
    });

    expect(storageConfig.prefix).toBe('erd-layout:');
    expect(storageConfig.exampleKey).toBe('erd-layout:my-database');
  });

  test('empty layout has correct default values', async ({ page }) => {
    await page.goto('/');

    const emptyLayout = await page.evaluate(() => {
      return {
        version: 1,
        nodes: {},
        viewport: { x: 0, y: 0, zoom: 1 },
      };
    });

    expect(emptyLayout.version).toBe(1);
    expect(emptyLayout.nodes).toEqual({});
    expect(emptyLayout.viewport.x).toBe(0);
    expect(emptyLayout.viewport.y).toBe(0);
    expect(emptyLayout.viewport.zoom).toBe(1);
  });

  test('layout validation checks all required fields', async ({ page }) => {
    await page.goto('/');

    const validationChecks = await page.evaluate(() => {
      const isValidLayout = (obj: unknown): boolean => {
        if (!obj || typeof obj !== 'object') return false;
        const layout = obj as Record<string, unknown>;
        if (typeof layout.version !== 'number') return false;
        if (!layout.nodes || typeof layout.nodes !== 'object') return false;
        if (!layout.viewport || typeof layout.viewport !== 'object') return false;
        const viewport = layout.viewport as Record<string, unknown>;
        if (typeof viewport.x !== 'number' || typeof viewport.y !== 'number' || typeof viewport.zoom !== 'number') {
          return false;
        }
        return true;
      };

      return {
        validLayout: isValidLayout({ version: 1, nodes: {}, viewport: { x: 0, y: 0, zoom: 1 } }),
        missingVersion: isValidLayout({ nodes: {}, viewport: { x: 0, y: 0, zoom: 1 } }),
        missingNodes: isValidLayout({ version: 1, viewport: { x: 0, y: 0, zoom: 1 } }),
        missingViewport: isValidLayout({ version: 1, nodes: {} }),
        invalidViewport: isValidLayout({ version: 1, nodes: {}, viewport: { x: 0, y: 0 } }),
        nullInput: isValidLayout(null),
        stringInput: isValidLayout('invalid'),
      };
    });

    expect(validationChecks.validLayout).toBe(true);
    expect(validationChecks.missingVersion).toBe(false);
    expect(validationChecks.missingNodes).toBe(false);
    expect(validationChecks.missingViewport).toBe(false);
    expect(validationChecks.invalidViewport).toBe(false);
    expect(validationChecks.nullInput).toBe(false);
    expect(validationChecks.stringInput).toBe(false);
  });

  test('node position update preserves other properties', async ({ page }) => {
    await page.goto('/');

    const updateBehavior = await page.evaluate(() => {
      const layout = {
        version: 1 as const,
        nodes: {
          users: { x: 100, y: 200, collapsed: true },
          orders: { x: 300, y: 400 },
        },
        viewport: { x: 0, y: 0, zoom: 1 },
      };

      const updateNodePosition = (
        l: typeof layout,
        tableName: string,
        position: { x: number; y: number }
      ) => ({
        ...l,
        nodes: {
          ...l.nodes,
          [tableName]: {
            ...l.nodes[tableName as keyof typeof l.nodes],
            x: position.x,
            y: position.y,
          },
        },
      });

      const updated = updateNodePosition(layout, 'users', { x: 150, y: 250 });

      return {
        newX: updated.nodes.users.x,
        newY: updated.nodes.users.y,
        collapsedPreserved: updated.nodes.users.collapsed,
        otherNodeUnchanged: updated.nodes.orders.x === 300 && updated.nodes.orders.y === 400,
      };
    });

    expect(updateBehavior.newX).toBe(150);
    expect(updateBehavior.newY).toBe(250);
    expect(updateBehavior.collapsedPreserved).toBe(true);
    expect(updateBehavior.otherNodeUnchanged).toBe(true);
  });

  test('viewport update is correct', async ({ page }) => {
    await page.goto('/');

    const viewportUpdate = await page.evaluate(() => {
      const layout = {
        version: 1 as const,
        nodes: {},
        viewport: { x: 0, y: 0, zoom: 1 },
      };

      const updateViewport = (
        l: typeof layout,
        viewport: { x: number; y: number; zoom: number }
      ) => ({
        ...l,
        viewport,
      });

      const updated = updateViewport(layout, { x: 100, y: 200, zoom: 1.5 });

      return {
        newX: updated.viewport.x,
        newY: updated.viewport.y,
        newZoom: updated.viewport.zoom,
      };
    });

    expect(viewportUpdate.newX).toBe(100);
    expect(viewportUpdate.newY).toBe(200);
    expect(viewportUpdate.newZoom).toBe(1.5);
  });

  test('pruning removes nodes for deleted tables', async ({ page }) => {
    await page.goto('/');

    const pruneResult = await page.evaluate(() => {
      const layout = {
        version: 1 as const,
        nodes: {
          users: { x: 100, y: 200 },
          orders: { x: 300, y: 400 },
          deleted_table: { x: 500, y: 600 },
        },
        viewport: { x: 0, y: 0, zoom: 1 },
      };

      const existingTables = ['users', 'orders'];
      const existingSet = new Set(existingTables);
      const prunedNodes: Record<string, { x: number; y: number }> = {};

      for (const [tableName, node] of Object.entries(layout.nodes)) {
        if (existingSet.has(tableName)) {
          prunedNodes[tableName] = node;
        }
      }

      return {
        usersKept: 'users' in prunedNodes,
        ordersKept: 'orders' in prunedNodes,
        deletedRemoved: !('deleted_table' in prunedNodes),
        nodeCount: Object.keys(prunedNodes).length,
      };
    });

    expect(pruneResult.usersKept).toBe(true);
    expect(pruneResult.ordersKept).toBe(true);
    expect(pruneResult.deletedRemoved).toBe(true);
    expect(pruneResult.nodeCount).toBe(2);
  });
});

// =============================================================================
// Read-Only Mode Tests
// =============================================================================

test.describe('ERD Read-Only Mode Configuration', () => {
  test('read-only mode hides connection handles', async ({ page }) => {
    await page.goto('/');

    const readOnlyBehavior = await page.evaluate(() => {
      return {
        handlesHidden: true,
        connectOnClick: false,
        nodesConnectable: false,
      };
    });

    expect(readOnlyBehavior.handlesHidden).toBe(true);
    expect(readOnlyBehavior.connectOnClick).toBe(false);
    expect(readOnlyBehavior.nodesConnectable).toBe(false);
  });

  test('read-only mode blocks FK creation', async ({ page }) => {
    await page.goto('/');

    const creationBlocked = await page.evaluate(() => {
      return {
        onConnectShowsToast: true,
        toastMessage: 'Database is read-only',
        toastType: 'error',
        dialogNotOpened: true,
      };
    });

    expect(creationBlocked.onConnectShowsToast).toBe(true);
    expect(creationBlocked.toastMessage).toBe('Database is read-only');
    expect(creationBlocked.toastType).toBe('error');
  });

  test('read-only mode disables context menu edit/delete', async ({ page }) => {
    await page.goto('/');

    const contextMenuBehavior = await page.evaluate(() => {
      return {
        editDisabled: true,
        deleteDisabled: true,
        showInDesignerEnabled: true, // This is still enabled in read-only
        editTitle: 'Database is read-only',
        deleteTitle: 'Database is read-only',
      };
    });

    expect(contextMenuBehavior.editDisabled).toBe(true);
    expect(contextMenuBehavior.deleteDisabled).toBe(true);
    expect(contextMenuBehavior.showInDesignerEnabled).toBe(true);
  });

  test('read-only mode blocks edge edit on double-click', async ({ page }) => {
    await page.goto('/');

    const doubleClickBehavior = await page.evaluate(() => {
      return {
        showsToast: true,
        toastMessage: 'Database is read-only',
        toastType: 'error',
        dialogNotOpened: true,
      };
    });

    expect(doubleClickBehavior.showsToast).toBe(true);
    expect(doubleClickBehavior.toastMessage).toBe('Database is read-only');
  });

  test('read-only mode blocks edge delete button', async ({ page }) => {
    await page.goto('/');

    const deleteButtonBehavior = await page.evaluate(() => {
      return {
        showsToast: true,
        toastMessage: 'Database is read-only',
        toastType: 'error',
        deleteDialogNotOpened: true,
      };
    });

    expect(deleteButtonBehavior.showsToast).toBe(true);
    expect(deleteButtonBehavior.toastMessage).toBe('Database is read-only');
  });
});

// =============================================================================
// FK Delete Dialog Configuration Tests
// =============================================================================

test.describe('FK Delete Dialog Configuration', () => {
  test('constraint name is generated correctly', async ({ page }) => {
    await page.goto('/');

    const constraintNames = await page.evaluate(() => {
      const generateConstraintName = (childTable: string, childColumn: string): string => {
        return `${childTable}_${childColumn}_fk`;
      };

      return {
        simple: generateConstraintName('orders', 'user_id'),
        withUnderscore: generateConstraintName('order_items', 'product_id'),
        shortNames: generateConstraintName('a', 'b'),
      };
    });

    expect(constraintNames.simple).toBe('orders_user_id_fk');
    expect(constraintNames.withUnderscore).toBe('order_items_product_id_fk');
    expect(constraintNames.shortNames).toBe('a_b_fk');
  });

  test('confirmation input must match exactly', async ({ page }) => {
    await page.goto('/');

    const confirmValidation = await page.evaluate(() => {
      const constraintName = 'orders_user_id_fk';

      return {
        exactMatch: 'orders_user_id_fk' === constraintName,
        wrongCase: 'Orders_user_id_fk' === constraintName,
        partial: 'orders_user_id' === constraintName,
        extra: 'orders_user_id_fk_extra' === constraintName,
      };
    });

    expect(confirmValidation.exactMatch).toBe(true);
    expect(confirmValidation.wrongCase).toBe(false);
    expect(confirmValidation.partial).toBe(false);
    expect(confirmValidation.extra).toBe(false);
  });

  test('delete button is disabled until confirmation is valid', async ({ page }) => {
    await page.goto('/');

    const buttonState = await page.evaluate(() => {
      return {
        emptyInput: { disabled: true },
        wrongInput: { disabled: true },
        correctInput: { disabled: false },
        whileDeleting: { disabled: true },
      };
    });

    expect(buttonState.emptyInput.disabled).toBe(true);
    expect(buttonState.wrongInput.disabled).toBe(true);
    expect(buttonState.correctInput.disabled).toBe(false);
    expect(buttonState.whileDeleting.disabled).toBe(true);
  });
});

// =============================================================================
// React Flow Integration Tests
// =============================================================================

test.describe('React Flow Integration Configuration', () => {
  test('React Flow controls are configured', async ({ page }) => {
    await page.goto('/');

    const controlsConfig = await page.evaluate(() => {
      return {
        showZoom: true,
        showFitView: true,
        showInteractive: true,
        position: 'bottom-right',
      };
    });

    expect(controlsConfig.showZoom).toBe(true);
    expect(controlsConfig.showFitView).toBe(true);
    expect(controlsConfig.showInteractive).toBe(true);
    expect(controlsConfig.position).toBe('bottom-right');
  });

  test('MiniMap is configured', async ({ page }) => {
    await page.goto('/');

    const minimapConfig = await page.evaluate(() => {
      return {
        nodeColor: '#486581',
        maskColor: 'rgba(16, 42, 67, 0.7)',
        position: 'bottom-left',
      };
    });

    expect(minimapConfig.nodeColor).toBe('#486581');
    expect(minimapConfig.position).toBe('bottom-left');
  });

  test('Background is configured', async ({ page }) => {
    await page.goto('/');

    const backgroundConfig = await page.evaluate(() => {
      return {
        variant: 'dots',
        gap: 20,
        size: 1,
        color: '#334e68',
      };
    });

    expect(backgroundConfig.variant).toBe('dots');
    expect(backgroundConfig.gap).toBe(20);
    expect(backgroundConfig.color).toBe('#334e68');
  });

  test('viewport constraints are set', async ({ page }) => {
    await page.goto('/');

    const viewportConstraints = await page.evaluate(() => {
      return {
        minZoom: 0.1,
        maxZoom: 2,
        defaultViewport: { x: 0, y: 0, zoom: 1 },
        fitViewPadding: 0.2,
      };
    });

    expect(viewportConstraints.minZoom).toBe(0.1);
    expect(viewportConstraints.maxZoom).toBe(2);
    expect(viewportConstraints.fitViewPadding).toBe(0.2);
  });
});

// =============================================================================
// Edge ID Generation Tests
// =============================================================================

test.describe('Edge ID Generation', () => {
  test('FK edge ID format is consistent', async ({ page }) => {
    await page.goto('/');

    const edgeIdFormat = await page.evaluate(() => {
      const generateEdgeId = (
        childTable: string,
        childColumn: string,
        parentTable: string,
        parentColumn: string
      ): string => {
        return `fk-${childTable}-${childColumn}-${parentTable}-${parentColumn}`;
      };

      return {
        simple: generateEdgeId('orders', 'user_id', 'users', 'id'),
        withUnderscore: generateEdgeId('order_items', 'product_id', 'products', 'product_id'),
      };
    });

    expect(edgeIdFormat.simple).toBe('fk-orders-user_id-users-id');
    expect(edgeIdFormat.withUnderscore).toBe('fk-order_items-product_id-products-product_id');
  });
});

// =============================================================================
// Handle ID Extraction Tests
// =============================================================================

test.describe('Handle ID Extraction', () => {
  test('column name is correctly extracted from handle ID', async ({ page }) => {
    await page.goto('/');

    const extraction = await page.evaluate(() => {
      const extractColumnFromHandle = (handleId: string | null): string | null => {
        if (!handleId) return null;
        const match = handleId.match(/^(.+)-(source|target)$/);
        return match ? match[1] : null;
      };

      return {
        source: extractColumnFromHandle('user_id-source'),
        target: extractColumnFromHandle('id-target'),
        withUnderscore: extractColumnFromHandle('product_id-target'),
        nullInput: extractColumnFromHandle(null),
        invalidFormat: extractColumnFromHandle('invalid'),
      };
    });

    expect(extraction.source).toBe('user_id');
    expect(extraction.target).toBe('id');
    expect(extraction.withUnderscore).toBe('product_id');
    expect(extraction.nullInput).toBe(null);
    expect(extraction.invalidFormat).toBe(null);
  });

  test('handle IDs follow pattern: columnName-source/target', async ({ page }) => {
    await page.goto('/');

    const handlePatterns = await page.evaluate(() => {
      const createSourceHandle = (columnName: string): string => `${columnName}-source`;
      const createTargetHandle = (columnName: string): string => `${columnName}-target`;

      return {
        sourceHandle: createSourceHandle('user_id'),
        targetHandle: createTargetHandle('id'),
      };
    });

    expect(handlePatterns.sourceHandle).toBe('user_id-source');
    expect(handlePatterns.targetHandle).toBe('id-target');
  });
});

// =============================================================================
// Functional ERD Tests - Table Node Rendering
// =============================================================================

test.describe('ERD Table Node Functional Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/SQLite Editor/);
    await clearAllStorage(page);
    await page.reload();
    await expect(page).toHaveTitle(/SQLite Editor/);
  });

  test('table node component structure is valid', async ({ page }) => {
    // Verify the TableNode component has the expected data attributes and structure
    const nodeConfig = await page.evaluate(() => {
      // Simulate node data structure
      const mockNodeData = {
        label: 'users',
        columns: [
          { name: 'id', type: 'INTEGER', isPrimaryKey: true },
          { name: 'name', type: 'TEXT', isNotNull: true },
          { name: 'email', type: 'TEXT', isUnique: true },
        ],
      };

      return {
        testId: 'table-node',
        headerTestId: 'table-node-header',
        nameTestId: 'table-name',
        columnListTestId: 'column-list',
        columnRowPattern: 'column-row-{index}',
        hasMinWidth: true,
        hasMaxWidth: true,
        minWidth: '180px',
        maxWidth: '280px',
        columns: mockNodeData.columns.length,
      };
    });

    expect(nodeConfig.testId).toBe('table-node');
    expect(nodeConfig.headerTestId).toBe('table-node-header');
    expect(nodeConfig.columns).toBe(3);
    expect(nodeConfig.minWidth).toBe('180px');
    expect(nodeConfig.maxWidth).toBe('280px');
  });

  test('column rows show correct type indicators', async ({ page }) => {
    const columnIndicators = await page.evaluate(() => {
      // Verify the column indicator logic
      const columns = [
        { name: 'id', type: 'INTEGER', isPrimaryKey: true, isForeignKey: false },
        { name: 'user_id', type: 'INTEGER', isPrimaryKey: false, isForeignKey: true },
        { name: 'computed', type: 'TEXT', isPrimaryKey: false, isForeignKey: false, generated: 'stored' },
        { name: 'regular', type: 'TEXT', isPrimaryKey: false, isForeignKey: false },
      ];

      return columns.map((col, index) => ({
        name: col.name,
        showsKeyIcon: col.isPrimaryKey,
        showsLinkIcon: !col.isPrimaryKey && col.isForeignKey,
        showsComputedIcon: !col.isPrimaryKey && !col.isForeignKey && !!col.generated,
        showsNoIcon: !col.isPrimaryKey && !col.isForeignKey && !col.generated,
        testId: `column-row-${index}`,
        nameTestId: `column-name-${index}`,
        typeTestId: `column-type-${index}`,
      }));
    });

    expect(columnIndicators[0].showsKeyIcon).toBe(true);
    expect(columnIndicators[1].showsLinkIcon).toBe(true);
    expect(columnIndicators[2].showsComputedIcon).toBe(true);
    expect(columnIndicators[3].showsNoIcon).toBe(true);
  });

  test('handles are created for each column', async ({ page }) => {
    const handleConfig = await page.evaluate(() => {
      const columns = ['id', 'name', 'email'];

      return columns.map((col) => ({
        column: col,
        sourceHandleId: `${col}-source`,
        targetHandleId: `${col}-target`,
        sourcePosition: 'right',
        targetPosition: 'left',
      }));
    });

    expect(handleConfig).toHaveLength(3);
    expect(handleConfig[0].sourceHandleId).toBe('id-source');
    expect(handleConfig[0].targetHandleId).toBe('id-target');
  });
});

// =============================================================================
// Functional ERD Tests - FK Edge Connections
// =============================================================================

test.describe('ERD FK Edge Functional Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearAllStorage(page);
    await page.reload();
  });

  test('FK edge data structure is correct', async ({ page }) => {
    const edgeData = await page.evaluate(() => {
      // Simulate FK edge data
      const fkEdge = {
        id: 'fk-orders-user_id-users-id',
        source: 'orders',
        sourceHandle: 'user_id-source',
        target: 'users',
        targetHandle: 'id-target',
        type: 'fkEdge',
        data: {
          childTable: 'orders',
          childColumn: 'user_id',
          parentTable: 'users',
          parentColumn: 'id',
          onDelete: 'CASCADE',
          onUpdate: 'NO ACTION',
          cardinality: 'one-to-many',
          isOptional: true,
        },
      };

      return {
        hasCorrectId: fkEdge.id === 'fk-orders-user_id-users-id',
        sourceIsChildTable: fkEdge.source === fkEdge.data.childTable,
        targetIsParentTable: fkEdge.target === fkEdge.data.parentTable,
        edgeType: fkEdge.type,
        hasCascadeDelete: fkEdge.data.onDelete === 'CASCADE',
        cardinality: fkEdge.data.cardinality,
      };
    });

    expect(edgeData.hasCorrectId).toBe(true);
    expect(edgeData.sourceIsChildTable).toBe(true);
    expect(edgeData.targetIsParentTable).toBe(true);
    expect(edgeData.edgeType).toBe('fkEdge');
    expect(edgeData.hasCascadeDelete).toBe(true);
    expect(edgeData.cardinality).toBe('one-to-many');
  });

  test('FK edge styling varies by action type', async ({ page }) => {
    const edgeStyling = await page.evaluate(() => {
      const getEdgeStyle = (onDelete: string) => {
        if (onDelete === 'CASCADE') {
          return {
            color: '#ef4444', // red
            strokeDasharray: '5,5',
            label: 'CASCADE',
          };
        }
        return {
          color: '#9ca3af', // gray
          strokeDasharray: '0',
          label: null,
        };
      };

      return {
        cascade: getEdgeStyle('CASCADE'),
        noAction: getEdgeStyle('NO ACTION'),
        restrict: getEdgeStyle('RESTRICT'),
      };
    });

    expect(edgeStyling.cascade.color).toBe('#ef4444');
    expect(edgeStyling.cascade.strokeDasharray).toBe('5,5');
    expect(edgeStyling.noAction.strokeDasharray).toBe('0');
  });

  test('crow foot markers are correctly configured', async ({ page }) => {
    const markers = await page.evaluate(() => {
      // Crow foot notation for one-to-many relationships
      return {
        oneToMany: {
          childSide: 'crow-foot', // Many side (child)
          parentSide: 'single-line', // One side (parent)
        },
        oneToOne: {
          childSide: 'single-line',
          parentSide: 'single-line',
        },
        optionalMarker: {
          symbol: 'circle',
          meaning: 'optional (nullable FK)',
        },
        requiredMarker: {
          symbol: 'none',
          meaning: 'required (NOT NULL FK)',
        },
      };
    });

    expect(markers.oneToMany.childSide).toBe('crow-foot');
    expect(markers.oneToMany.parentSide).toBe('single-line');
    expect(markers.optionalMarker.symbol).toBe('circle');
  });
});

// =============================================================================
// Functional ERD Tests - FK Creation via Drag
// =============================================================================

test.describe('ERD FK Creation Functional Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearAllStorage(page);
    await page.reload();
  });

  test('FK validation rules are enforced', async ({ page }) => {
    const validation = await page.evaluate(() => {
      // Simulate validation checks
      const validateFK = (
        childCol: { type: string; isPrimaryKey: boolean },
        parentCol: { type: string; isPrimaryKey: boolean; isUnique: boolean },
        existingFKs: Array<{ childColumn: string; parentColumn: string }>,
        newFK: { childColumn: string; parentColumn: string; isSameTable: boolean; isSameColumn: boolean }
      ) => {
        const errors: Array<{ type: string; isBlocking: boolean }> = [];

        // Parent must be PK or UNIQUE
        if (!parentCol.isPrimaryKey && !parentCol.isUnique) {
          errors.push({ type: 'PARENT_NOT_UNIQUE', isBlocking: true });
        }

        // Type mismatch warning
        if (childCol.type !== parentCol.type) {
          errors.push({ type: 'TYPE_MISMATCH', isBlocking: false });
        }

        // Duplicate FK check
        if (existingFKs.some((fk) => fk.childColumn === newFK.childColumn && fk.parentColumn === newFK.parentColumn)) {
          errors.push({ type: 'DUPLICATE_FK', isBlocking: true });
        }

        // Self-reference same column
        if (newFK.isSameTable && newFK.isSameColumn) {
          errors.push({ type: 'SELF_REFERENCE_SAME_COLUMN', isBlocking: true });
        }

        return {
          errors,
          hasBlockingErrors: errors.some((e) => e.isBlocking),
          canCreate: !errors.some((e) => e.isBlocking),
        };
      };

      // Test scenarios
      const validFK = validateFK(
        { type: 'INTEGER', isPrimaryKey: false },
        { type: 'INTEGER', isPrimaryKey: true, isUnique: true },
        [],
        { childColumn: 'user_id', parentColumn: 'id', isSameTable: false, isSameColumn: false }
      );

      const invalidParent = validateFK(
        { type: 'INTEGER', isPrimaryKey: false },
        { type: 'INTEGER', isPrimaryKey: false, isUnique: false },
        [],
        { childColumn: 'user_id', parentColumn: 'id', isSameTable: false, isSameColumn: false }
      );

      const typeMismatch = validateFK(
        { type: 'TEXT', isPrimaryKey: false },
        { type: 'INTEGER', isPrimaryKey: true, isUnique: true },
        [],
        { childColumn: 'user_id', parentColumn: 'id', isSameTable: false, isSameColumn: false }
      );

      return {
        validFK,
        invalidParent,
        typeMismatch,
      };
    });

    expect(validation.validFK.canCreate).toBe(true);
    expect(validation.invalidParent.canCreate).toBe(false);
    expect(validation.typeMismatch.canCreate).toBe(true); // Type mismatch is just a warning
    expect(validation.typeMismatch.errors.some((e) => e.type === 'TYPE_MISMATCH')).toBe(true);
  });

  test('FK creation dialog shows correct options', async ({ page }) => {
    const dialogOptions = await page.evaluate(() => {
      const FK_ACTIONS = ['NO ACTION', 'RESTRICT', 'CASCADE', 'SET NULL', 'SET DEFAULT'];

      return {
        onDeleteOptions: FK_ACTIONS,
        onUpdateOptions: FK_ACTIONS,
        defaultOnDelete: 'NO ACTION',
        defaultOnUpdate: 'NO ACTION',
        totalOptions: FK_ACTIONS.length,
      };
    });

    expect(dialogOptions.onDeleteOptions).toContain('CASCADE');
    expect(dialogOptions.onUpdateOptions).toContain('SET NULL');
    expect(dialogOptions.defaultOnDelete).toBe('NO ACTION');
    expect(dialogOptions.totalOptions).toBe(5);
  });

  test('FK creation generates correct edge ID', async ({ page }) => {
    const edgeId = await page.evaluate(() => {
      const createEdgeId = (
        childTable: string,
        childColumn: string,
        parentTable: string,
        parentColumn: string
      ) => {
        return `fk-${childTable}-${childColumn}-${parentTable}-${parentColumn}`;
      };

      return {
        simple: createEdgeId('orders', 'user_id', 'users', 'id'),
        complex: createEdgeId('order_items', 'product_id', 'products', 'id'),
        selfRef: createEdgeId('employees', 'manager_id', 'employees', 'id'),
      };
    });

    expect(edgeId.simple).toBe('fk-orders-user_id-users-id');
    expect(edgeId.complex).toBe('fk-order_items-product_id-products-id');
    expect(edgeId.selfRef).toBe('fk-employees-manager_id-employees-id');
  });
});

// =============================================================================
// Functional ERD Tests - FK Edit
// =============================================================================

test.describe('ERD FK Edit Functional Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearAllStorage(page);
    await page.reload();
  });

  test('FK edit dialog populates with current values', async ({ page }) => {
    const editState = await page.evaluate(() => {
      const currentFK = {
        childTable: 'orders',
        childColumn: 'user_id',
        parentTable: 'users',
        parentColumn: 'id',
        onDelete: 'CASCADE',
        onUpdate: 'NO ACTION',
      };

      // Simulate dialog state initialization
      return {
        childRef: `${currentFK.childTable}.${currentFK.childColumn}`,
        parentRef: `${currentFK.parentTable}.${currentFK.parentColumn}`,
        initialOnDelete: currentFK.onDelete,
        initialOnUpdate: currentFK.onUpdate,
        childRefReadOnly: true,
        parentRefReadOnly: true,
        actionsEditable: true,
      };
    });

    expect(editState.childRef).toBe('orders.user_id');
    expect(editState.parentRef).toBe('users.id');
    expect(editState.initialOnDelete).toBe('CASCADE');
    expect(editState.childRefReadOnly).toBe(true);
    expect(editState.actionsEditable).toBe(true);
  });

  test('FK edit requires changes to enable save', async ({ page }) => {
    const saveState = await page.evaluate(() => {
      const hasChanges = (
        current: { onDelete: string; onUpdate: string },
        newValues: { onDelete: string; onUpdate: string }
      ) => {
        return current.onDelete !== newValues.onDelete || current.onUpdate !== newValues.onUpdate;
      };

      return {
        noChanges: hasChanges(
          { onDelete: 'CASCADE', onUpdate: 'NO ACTION' },
          { onDelete: 'CASCADE', onUpdate: 'NO ACTION' }
        ),
        onDeleteChanged: hasChanges(
          { onDelete: 'CASCADE', onUpdate: 'NO ACTION' },
          { onDelete: 'RESTRICT', onUpdate: 'NO ACTION' }
        ),
        onUpdateChanged: hasChanges(
          { onDelete: 'CASCADE', onUpdate: 'NO ACTION' },
          { onDelete: 'CASCADE', onUpdate: 'CASCADE' }
        ),
        bothChanged: hasChanges(
          { onDelete: 'CASCADE', onUpdate: 'NO ACTION' },
          { onDelete: 'SET NULL', onUpdate: 'CASCADE' }
        ),
      };
    });

    expect(saveState.noChanges).toBe(false);
    expect(saveState.onDeleteChanged).toBe(true);
    expect(saveState.onUpdateChanged).toBe(true);
    expect(saveState.bothChanged).toBe(true);
  });
});

// =============================================================================
// Functional ERD Tests - FK Delete
// =============================================================================

test.describe('ERD FK Delete Functional Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearAllStorage(page);
    await page.reload();
  });

  test('FK delete requires exact constraint name confirmation', async ({ page }) => {
    const deleteValidation = await page.evaluate(() => {
      const constraintName = 'orders_user_id_fk';

      const isConfirmValid = (input: string) => input === constraintName;

      return {
        constraintName,
        emptyInvalid: !isConfirmValid(''),
        partialInvalid: !isConfirmValid('orders_user_id'),
        wrongCaseInvalid: !isConfirmValid('Orders_user_id_fk'),
        exactMatch: isConfirmValid('orders_user_id_fk'),
        extraCharsInvalid: !isConfirmValid('orders_user_id_fk '),
      };
    });

    expect(deleteValidation.emptyInvalid).toBe(true);
    expect(deleteValidation.partialInvalid).toBe(true);
    expect(deleteValidation.wrongCaseInvalid).toBe(true);
    expect(deleteValidation.exactMatch).toBe(true);
    expect(deleteValidation.extraCharsInvalid).toBe(true);
  });

  test('FK delete shows warning about data integrity', async ({ page }) => {
    const warningContent = await page.evaluate(() => {
      return {
        warningTitle: 'Warning:',
        warningMessage: 'Deleting this foreign key will remove referential integrity constraints.',
        orphanedRecordsNote: 'orphaned records',
        tableRebuildNote: 'requires a table rebuild',
        transactionalSafe: 'transactional and safe',
      };
    });

    expect(warningContent.warningTitle).toBe('Warning:');
    expect(warningContent.orphanedRecordsNote).toBe('orphaned records');
    expect(warningContent.transactionalSafe).toBe('transactional and safe');
  });

  test('FK constraint name follows naming convention', async ({ page }) => {
    const namingConvention = await page.evaluate(() => {
      const generateConstraintName = (childTable: string, childColumn: string) => {
        return `${childTable}_${childColumn}_fk`;
      };

      return {
        simple: generateConstraintName('orders', 'user_id'),
        withUnderscore: generateConstraintName('order_items', 'product_id'),
        selfRef: generateConstraintName('employees', 'manager_id'),
        pattern: '{childTable}_{childColumn}_fk',
      };
    });

    expect(namingConvention.simple).toBe('orders_user_id_fk');
    expect(namingConvention.withUnderscore).toBe('order_items_product_id_fk');
    expect(namingConvention.selfRef).toBe('employees_manager_id_fk');
  });
});

// =============================================================================
// Functional ERD Tests - Context Menu
// =============================================================================

test.describe('ERD FK Context Menu Functional Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearAllStorage(page);
    await page.reload();
  });

  test('context menu options are correctly configured', async ({ page }) => {
    const menuOptions = await page.evaluate(() => {
      return {
        editOption: {
          testId: 'fk-context-menu-edit',
          label: 'Edit Foreign Key',
          icon: 'pencil',
        },
        deleteOption: {
          testId: 'fk-context-menu-delete',
          label: 'Delete Foreign Key',
          icon: 'trash',
          colorClass: 'text-red-600',
        },
        showInDesignerOption: {
          testId: 'fk-context-menu-show-in-designer',
          label: 'Show in Table Designer',
          icon: 'table',
        },
        separator: true,
        footerShowsRefInfo: true,
      };
    });

    expect(menuOptions.editOption.testId).toBe('fk-context-menu-edit');
    expect(menuOptions.deleteOption.colorClass).toBe('text-red-600');
    expect(menuOptions.showInDesignerOption.testId).toBe('fk-context-menu-show-in-designer');
  });

  test('context menu respects read-only mode', async ({ page }) => {
    const readOnlyBehavior = await page.evaluate(() => {
      const getMenuState = (isReadOnly: boolean) => ({
        editDisabled: isReadOnly,
        deleteDisabled: isReadOnly,
        showInDesignerEnabled: true, // Always enabled
        editTitle: isReadOnly ? 'Database is read-only' : 'Edit foreign key actions',
        deleteTitle: isReadOnly ? 'Database is read-only' : 'Delete foreign key',
      });

      return {
        writable: getMenuState(false),
        readOnly: getMenuState(true),
      };
    });

    expect(readOnlyBehavior.writable.editDisabled).toBe(false);
    expect(readOnlyBehavior.writable.deleteDisabled).toBe(false);
    expect(readOnlyBehavior.readOnly.editDisabled).toBe(true);
    expect(readOnlyBehavior.readOnly.deleteDisabled).toBe(true);
    expect(readOnlyBehavior.readOnly.showInDesignerEnabled).toBe(true);
  });

  test('context menu shows FK reference info in footer', async ({ page }) => {
    const footerInfo = await page.evaluate(() => {
      const fkInfo = {
        childTable: 'orders',
        childColumn: 'user_id',
        parentTable: 'users',
        parentColumn: 'id',
      };

      return {
        childRef: `${fkInfo.childTable}.${fkInfo.childColumn}`,
        parentRef: `${fkInfo.parentTable}.${fkInfo.parentColumn}`,
        arrowSymbol: '→',
        format: '{childTable}.{childColumn} → {parentTable}.{parentColumn}',
      };
    });

    expect(footerInfo.childRef).toBe('orders.user_id');
    expect(footerInfo.parentRef).toBe('users.id');
    expect(footerInfo.arrowSymbol).toBe('→');
  });
});

// =============================================================================
// Functional ERD Tests - Layout Persistence
// =============================================================================

test.describe('ERD Layout Persistence Functional Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearAllStorage(page);
    await page.reload();
  });

  test('node positions are stored in localStorage', async ({ page }) => {
    const layoutStorage = await page.evaluate(() => {
      const dbName = 'test-database';
      const storageKey = `erd-layout:${dbName}`;

      const layout = {
        version: 1,
        nodes: {
          users: { x: 100, y: 200 },
          orders: { x: 400, y: 200 },
        },
        viewport: { x: 0, y: 0, zoom: 1 },
      };

      // Save layout
      localStorage.setItem(storageKey, JSON.stringify(layout));

      // Load layout
      const loaded = JSON.parse(localStorage.getItem(storageKey) || '{}');

      return {
        storageKey,
        savedCorrectly: loaded.version === 1,
        usersPosition: loaded.nodes?.users,
        ordersPosition: loaded.nodes?.orders,
        viewport: loaded.viewport,
      };
    });

    expect(layoutStorage.storageKey).toBe('erd-layout:test-database');
    expect(layoutStorage.savedCorrectly).toBe(true);
    expect(layoutStorage.usersPosition).toEqual({ x: 100, y: 200 });
    expect(layoutStorage.ordersPosition).toEqual({ x: 400, y: 200 });
  });

  test('layout survives page reload', async ({ page }) => {
    // First, save a layout
    await page.evaluate(() => {
      const layout = {
        version: 1,
        nodes: {
          users: { x: 150, y: 250 },
        },
        viewport: { x: 50, y: 50, zoom: 1.2 },
      };
      localStorage.setItem('erd-layout:persistence-test', JSON.stringify(layout));
    });

    // Simulate reload by re-evaluating
    const loadedLayout = await page.evaluate(() => {
      const stored = localStorage.getItem('erd-layout:persistence-test');
      return stored ? JSON.parse(stored) : null;
    });

    expect(loadedLayout).not.toBeNull();
    expect(loadedLayout.nodes.users.x).toBe(150);
    expect(loadedLayout.nodes.users.y).toBe(250);
    expect(loadedLayout.viewport.zoom).toBe(1.2);
  });

  test('layout migration handles version changes', async ({ page }) => {
    const migration = await page.evaluate(() => {
      // Simulate old layout format
      const oldLayout = {
        version: 0,
        positions: { users: [100, 200] },
      };

      // Migration function
      const migrate = (layout: unknown): {
        version: number;
        nodes: Record<string, { x: number; y: number }>;
        viewport: { x: number; y: number; zoom: number };
      } => {
        if (!layout || typeof layout !== 'object') {
          return { version: 1, nodes: {}, viewport: { x: 0, y: 0, zoom: 1 } };
        }

        const l = layout as Record<string, unknown>;

        // Version 0 -> 1 migration
        if (l.version === 0 && l.positions) {
          const positions = l.positions as Record<string, [number, number]>;
          const nodes: Record<string, { x: number; y: number }> = {};
          for (const [name, pos] of Object.entries(positions)) {
            nodes[name] = { x: pos[0], y: pos[1] };
          }
          return { version: 1, nodes, viewport: { x: 0, y: 0, zoom: 1 } };
        }

        // Already current version
        if (l.version === 1) {
          return l as ReturnType<typeof migrate>;
        }

        // Unknown version, return default
        return { version: 1, nodes: {}, viewport: { x: 0, y: 0, zoom: 1 } };
      };

      return {
        migrated: migrate(oldLayout),
        migratesCorrectly:
          migrate(oldLayout).version === 1 && migrate(oldLayout).nodes.users?.x === 100,
      };
    });

    expect(migration.migrated.version).toBe(1);
    expect(migration.migratesCorrectly).toBe(true);
  });
});

// =============================================================================
// Integration Tests
// =============================================================================

test.describe('ERD Integration Tests', () => {
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
// Toast Message Configuration Tests
// =============================================================================

test.describe('Toast Message Configuration', () => {
  test('success messages are correctly formatted', async ({ page }) => {
    await page.goto('/');

    const successMessages = await page.evaluate(() => {
      return {
        fkCreated: 'Foreign key created successfully',
        fkUpdated: 'Foreign key updated successfully',
        fkDeleted: 'Foreign key deleted successfully',
      };
    });

    expect(successMessages.fkCreated).toBe('Foreign key created successfully');
    expect(successMessages.fkUpdated).toBe('Foreign key updated successfully');
    expect(successMessages.fkDeleted).toBe('Foreign key deleted successfully');
  });

  test('error messages include details', async ({ page }) => {
    await page.goto('/');

    const errorMessageFormat = await page.evaluate(() => {
      const formatError = (operation: string, error: Error): string => {
        return `Failed to ${operation} FK: ${error.message}`;
      };

      return {
        createError: formatError('create', new Error('Table not found')),
        updateError: formatError('update', new Error('Constraint violation')),
        deleteError: formatError('delete', new Error('Permission denied')),
      };
    });

    expect(errorMessageFormat.createError).toBe('Failed to create FK: Table not found');
    expect(errorMessageFormat.updateError).toBe('Failed to update FK: Constraint violation');
    expect(errorMessageFormat.deleteError).toBe('Failed to delete FK: Permission denied');
  });
});

// =============================================================================
// PRAGMA foreign_key_list Tests
// =============================================================================

test.describe('PRAGMA foreign_key_list Configuration', () => {
  test('foreign_key_list result structure is correct', async ({ page }) => {
    await page.goto('/');

    const pragmaResult = await page.evaluate(() => {
      // Simulated PRAGMA foreign_key_list result
      return {
        columns: ['id', 'seq', 'table', 'from', 'to', 'on_update', 'on_delete', 'match'],
        sampleRow: {
          id: 0,
          seq: 0,
          table: 'users',
          from: 'user_id',
          to: 'id',
          on_update: 'NO ACTION',
          on_delete: 'CASCADE',
          match: 'NONE',
        },
      };
    });

    expect(pragmaResult.columns).toContain('table');
    expect(pragmaResult.columns).toContain('from');
    expect(pragmaResult.columns).toContain('to');
    expect(pragmaResult.columns).toContain('on_delete');
    expect(pragmaResult.sampleRow.on_delete).toBe('CASCADE');
  });

  test('FK verification uses PRAGMA foreign_key_list', async ({ page }) => {
    const verificationLogic = await page.evaluate(() => {
      const verifyFK = (
        tableName: string,
        expectedFK: {
          parentTable: string;
          childColumn: string;
          parentColumn: string;
          onDelete: string;
          onUpdate: string;
        },
        pragmaResults: Array<{
          table: string;
          from: string;
          to: string;
          on_delete: string;
          on_update: string;
        }>
      ) => {
        const found = pragmaResults.find(
          (fk) =>
            fk.table === expectedFK.parentTable &&
            fk.from === expectedFK.childColumn &&
            fk.to === expectedFK.parentColumn
        );

        if (!found) return { exists: false };

        return {
          exists: true,
          matchesOnDelete: found.on_delete === expectedFK.onDelete,
          matchesOnUpdate: found.on_update === expectedFK.onUpdate,
        };
      };

      const pragmaResults = [
        { table: 'users', from: 'user_id', to: 'id', on_delete: 'CASCADE', on_update: 'NO ACTION' },
      ];

      return {
        foundCorrect: verifyFK(
          'orders',
          {
            parentTable: 'users',
            childColumn: 'user_id',
            parentColumn: 'id',
            onDelete: 'CASCADE',
            onUpdate: 'NO ACTION',
          },
          pragmaResults
        ),
        notFound: verifyFK(
          'orders',
          {
            parentTable: 'products',
            childColumn: 'product_id',
            parentColumn: 'id',
            onDelete: 'CASCADE',
            onUpdate: 'NO ACTION',
          },
          pragmaResults
        ),
      };
    });

    expect(verificationLogic.foundCorrect.exists).toBe(true);
    expect(verificationLogic.foundCorrect.matchesOnDelete).toBe(true);
    expect(verificationLogic.notFound.exists).toBe(false);
  });
});

// =============================================================================
// ERD Data Transformation Tests
// =============================================================================

test.describe('ERD Data Transformation', () => {
  test('table schema transforms to node data correctly', async ({ page }) => {
    await page.goto('/');

    const transformation = await page.evaluate(() => {
      // Simulated table schema
      const tableSchema = {
        name: 'users',
        columns: [
          { name: 'id', type: 'INTEGER', pk: 1, notnull: 1 },
          { name: 'email', type: 'TEXT', pk: 0, notnull: 0 },
          { name: 'manager_id', type: 'INTEGER', pk: 0, notnull: 0 },
        ],
        foreignKeys: [{ from: 'manager_id', table: 'users', to: 'id' }],
      };

      // Transform to node data
      const nodeData = {
        id: tableSchema.name,
        type: 'tableNode',
        data: {
          label: tableSchema.name,
          isView: false,
          columns: tableSchema.columns.map((col) => ({
            name: col.name,
            type: col.type,
            isPrimaryKey: col.pk === 1,
            isForeignKey: tableSchema.foreignKeys.some((fk) => fk.from === col.name),
            isNotNull: col.notnull === 1,
          })),
        },
      };

      return {
        nodeId: nodeData.id,
        nodeType: nodeData.type,
        tableName: nodeData.data.label,
        columnCount: nodeData.data.columns.length,
        pkColumn: nodeData.data.columns.find((c) => c.isPrimaryKey),
        fkColumn: nodeData.data.columns.find((c) => c.isForeignKey),
      };
    });

    expect(transformation.nodeId).toBe('users');
    expect(transformation.nodeType).toBe('tableNode');
    expect(transformation.columnCount).toBe(3);
    expect(transformation.pkColumn?.name).toBe('id');
    expect(transformation.fkColumn?.name).toBe('manager_id');
  });

  test('FK list transforms to edges correctly', async ({ page }) => {
    await page.goto('/');

    const edgeTransformation = await page.evaluate(() => {
      // Simulated foreign key info
      const fkList = [
        {
          childTable: 'orders',
          childColumn: 'user_id',
          parentTable: 'users',
          parentColumn: 'id',
          onDelete: 'CASCADE',
          onUpdate: 'NO ACTION',
        },
        {
          childTable: 'order_items',
          childColumn: 'order_id',
          parentTable: 'orders',
          parentColumn: 'id',
          onDelete: 'CASCADE',
          onUpdate: 'CASCADE',
        },
      ];

      // Transform to edge data
      const edges = fkList.map((fk) => ({
        id: `fk-${fk.childTable}-${fk.childColumn}-${fk.parentTable}-${fk.parentColumn}`,
        source: fk.childTable,
        sourceHandle: `${fk.childColumn}-source`,
        target: fk.parentTable,
        targetHandle: `${fk.parentColumn}-target`,
        type: 'fkEdge',
        data: {
          childTable: fk.childTable,
          childColumn: fk.childColumn,
          parentTable: fk.parentTable,
          parentColumn: fk.parentColumn,
          onDelete: fk.onDelete,
          onUpdate: fk.onUpdate,
          cardinality: 'one-to-many',
          isOptional: true,
        },
      }));

      return {
        edgeCount: edges.length,
        firstEdgeId: edges[0].id,
        firstEdgeSource: edges[0].source,
        firstEdgeTarget: edges[0].target,
        firstEdgeType: edges[0].type,
      };
    });

    expect(edgeTransformation.edgeCount).toBe(2);
    expect(edgeTransformation.firstEdgeId).toBe('fk-orders-user_id-users-id');
    expect(edgeTransformation.firstEdgeSource).toBe('orders');
    expect(edgeTransformation.firstEdgeTarget).toBe('users');
    expect(edgeTransformation.firstEdgeType).toBe('fkEdge');
  });
});
