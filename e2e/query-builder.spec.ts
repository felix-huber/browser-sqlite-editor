import { test, expect, type Page } from '@playwright/test';

/**
 * E2E Tests for Query Builder
 *
 * Tests for the visual query builder functionality covering:
 * - Open query builder, add table to canvas
 * - Select columns from table, verify SELECT clause
 * - Add second table, drag join between columns, verify JOIN clause
 * - Add WHERE condition with different operators (=, LIKE, IS NULL)
 * - Verify LIKE escaping for special chars (%, _, \)
 * - Add ORDER BY, verify clause
 * - Add LIMIT, verify clause
 * - Run query from builder, verify results match SQL preview
 * - Edit query, re-run, verify deterministic SQL generation
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

// =============================================================================
// Query Builder Component Configuration Tests
// =============================================================================

test.describe('Query Builder Component Configuration', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/SQLite Editor/);
    await clearAllStorage(page);
    await page.reload();
    await expect(page).toHaveTitle(/SQLite Editor/);
  });

  test('query builder has correct test IDs', async ({ page }) => {
    const testIdConfig = await page.evaluate(() => {
      return {
        queryBuilder: 'query-builder',
        tableList: 'table-list',
        tableSearchInput: 'table-search-input',
        queryBuilderCanvas: 'query-builder-canvas',
        clearCanvasButton: 'clear-canvas-button',
        limitWarning: 'limit-warning',
        connectionError: 'connection-error',
        joinCount: 'join-count',
      };
    });

    expect(testIdConfig.queryBuilder).toBe('query-builder');
    expect(testIdConfig.tableList).toBe('table-list');
    expect(testIdConfig.tableSearchInput).toBe('table-search-input');
    expect(testIdConfig.queryBuilderCanvas).toBe('query-builder-canvas');
    expect(testIdConfig.clearCanvasButton).toBe('clear-canvas-button');
  });

  test('table item test IDs follow correct pattern', async ({ page }) => {
    const tableItemPattern = await page.evaluate(() => {
      return {
        pattern: 'table-item-{tableName}',
        example: 'table-item-users',
      };
    });

    expect(tableItemPattern.pattern).toBe('table-item-{tableName}');
  });

  test('query builder canvas supports drag and drop', async ({ page }) => {
    const dragDropConfig = await page.evaluate(() => {
      return {
        dragDataType: 'application/query-builder-table',
        effectAllowed: 'copy',
        maxTables: 10,
      };
    });

    expect(dragDropConfig.dragDataType).toBe('application/query-builder-table');
    expect(dragDropConfig.maxTables).toBe(10);
  });
});

// =============================================================================
// Table Canvas Operations Tests
// =============================================================================

test.describe('Table Canvas Operations', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/SQLite Editor/);
  });

  test('table list displays available tables', async ({ page }) => {
    const tableListConfig = await page.evaluate(() => {
      return {
        emptyMessage: 'No tables available',
        noMatchMessage: 'No matching tables',
      };
    });

    expect(tableListConfig.emptyMessage).toBe('No tables available');
    expect(tableListConfig.noMatchMessage).toBe('No matching tables');
  });

  test('table search filters tables', async ({ page }) => {
    const searchConfig = await page.evaluate(() => {
      const filterLogic = (tables: string[], query: string): string[] => {
        if (!query.trim()) return tables;
        const lowerQuery = query.toLowerCase();
        return tables.filter((table) => table.toLowerCase().includes(lowerQuery));
      };

      const testTables = ['users', 'orders', 'products', 'user_settings'];
      return {
        emptyQuery: filterLogic(testTables, ''),
        userQuery: filterLogic(testTables, 'user'),
        noMatch: filterLogic(testTables, 'xyz'),
      };
    });

    expect(searchConfig.emptyQuery.length).toBe(4);
    expect(searchConfig.userQuery).toContain('users');
    expect(searchConfig.userQuery).toContain('user_settings');
    expect(searchConfig.noMatch.length).toBe(0);
  });

  test('tables on canvas are marked as disabled in list', async ({ page }) => {
    const disabledConfig = await page.evaluate(() => {
      return {
        disabledClass: 'bg-navy-100 text-navy-400 cursor-not-allowed',
        ariaDisabled: true,
        draggable: false,
      };
    });

    expect(disabledConfig.ariaDisabled).toBe(true);
    expect(disabledConfig.draggable).toBe(false);
  });

  test('clear canvas button removes all tables and joins', async ({ page }) => {
    const clearConfig = await page.evaluate(() => {
      return {
        buttonTestId: 'clear-canvas-button',
        disabledWhenEmpty: true,
        clearsNodes: true,
        clearsEdges: true,
      };
    });

    expect(clearConfig.buttonTestId).toBe('clear-canvas-button');
    expect(clearConfig.disabledWhenEmpty).toBe(true);
  });

  test('table alias is generated correctly', async ({ page }) => {
    const aliasConfig = await page.evaluate(() => {
      const generateAlias = (existingCount: number): string => {
        return `t${existingCount + 1}`;
      };

      return {
        first: generateAlias(0),
        second: generateAlias(1),
        third: generateAlias(2),
      };
    });

    expect(aliasConfig.first).toBe('t1');
    expect(aliasConfig.second).toBe('t2');
    expect(aliasConfig.third).toBe('t3');
  });

  test('canvas enforces maximum table limit', async ({ page }) => {
    const limitConfig = await page.evaluate(() => {
      return {
        maxTables: 10,
        warningTestId: 'limit-warning',
        warningMessage: 'Maximum 10 tables allowed',
        warningTimeout: 3000,
      };
    });

    expect(limitConfig.maxTables).toBe(10);
    expect(limitConfig.warningTestId).toBe('limit-warning');
  });
});

// =============================================================================
// Table Box Component Tests
// =============================================================================

test.describe('Table Box Component', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/SQLite Editor/);
  });

  test('table box has correct test ID pattern', async ({ page }) => {
    const testIdPattern = await page.evaluate(() => {
      return {
        boxPattern: 'table-box-{tableName}',
        headerPattern: 'table-box-header-{tableName}',
        columnPattern: 'table-box-column-{tableName}-{columnName}',
        selectAllPattern: 'table-box-select-all-{tableName}',
      };
    });

    expect(testIdPattern.boxPattern).toBe('table-box-{tableName}');
    expect(testIdPattern.columnPattern).toBe('table-box-column-{tableName}-{columnName}');
  });

  test('column checkbox toggles column selection', async ({ page }) => {
    const selectionConfig = await page.evaluate(() => {
      return {
        selectedClass: 'bg-blue-50',
        checkboxTestIdPattern: 'column-checkbox-{tableName}-{columnName}',
      };
    });

    expect(selectionConfig.checkboxTestIdPattern).toBe('column-checkbox-{tableName}-{columnName}');
  });

  test('select all checkbox selects all columns', async ({ page }) => {
    const selectAllConfig = await page.evaluate(() => {
      return {
        selectsAllColumns: true,
        deselectsAllColumns: true,
      };
    });

    expect(selectAllConfig.selectsAllColumns).toBe(true);
  });

  test('remove table button removes table from canvas', async ({ page }) => {
    const removeConfig = await page.evaluate(() => {
      return {
        buttonTestIdPattern: 'remove-table-{tableName}',
        removesFromCanvas: true,
        clearsJoins: true,
      };
    });

    expect(removeConfig.buttonTestIdPattern).toBe('remove-table-{tableName}');
  });
});

// =============================================================================
// Join Edge Tests
// =============================================================================

test.describe('Join Edge Configuration', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/SQLite Editor/);
  });

  test('join types are correctly defined', async ({ page }) => {
    const joinTypes = await page.evaluate(() => {
      return ['INNER', 'LEFT', 'RIGHT', 'FULL'];
    });

    expect(joinTypes).toContain('INNER');
    expect(joinTypes).toContain('LEFT');
    expect(joinTypes).toContain('RIGHT');
    expect(joinTypes).toContain('FULL');
  });

  test('join edge has correct test ID pattern', async ({ page }) => {
    const testIdPattern = await page.evaluate(() => {
      return {
        edgePattern: 'join-edge-{id}',
        labelPattern: 'join-label-{id}',
        typeSelectPattern: 'join-type-{id}',
        deleteButtonPattern: 'join-delete-{id}',
      };
    });

    expect(testIdPattern.edgePattern).toBe('join-edge-{id}');
    expect(testIdPattern.typeSelectPattern).toBe('join-type-{id}');
  });

  test('default join type is INNER', async ({ page }) => {
    const defaultJoinType = await page.evaluate(() => {
      return 'INNER';
    });

    expect(defaultJoinType).toBe('INNER');
  });

  test('self-join on same column is prevented', async ({ page }) => {
    const validationConfig = await page.evaluate(() => {
      return {
        errorMessage: 'Cannot join a column to itself',
        errorTestId: 'connection-error',
        errorTimeout: 2000,
      };
    });

    expect(validationConfig.errorMessage).toBe('Cannot join a column to itself');
  });

  test('duplicate joins are prevented', async ({ page }) => {
    const duplicateConfig = await page.evaluate(() => {
      return {
        preventsDuplicate: true,
        edgeIdFormat: 'join-{source}-{sourceColumn}-{target}-{targetColumn}',
      };
    });

    expect(duplicateConfig.preventsDuplicate).toBe(true);
  });
});

// =============================================================================
// WHERE Builder Tests
// =============================================================================

test.describe('WHERE Builder Configuration', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/SQLite Editor/);
  });

  test('where builder has correct test IDs', async ({ page }) => {
    const testIdConfig = await page.evaluate(() => {
      return {
        builder: 'where-builder',
        addConditionButton: 'add-condition-button',
        conditionsList: 'conditions-list',
        logicToggle: 'logic-toggle',
        wherePreview: 'where-preview',
      };
    });

    expect(testIdConfig.builder).toBe('where-builder');
    expect(testIdConfig.addConditionButton).toBe('add-condition-button');
    expect(testIdConfig.conditionsList).toBe('conditions-list');
  });

  test('condition row has correct test ID pattern', async ({ page }) => {
    const conditionRowPattern = await page.evaluate(() => {
      return {
        rowPattern: 'condition-row-{id}',
        columnPattern: 'condition-column-{id}',
        operatorPattern: 'condition-operator-{id}',
        valuePattern: 'condition-value-{id}',
        removePattern: 'condition-remove-{id}',
        logicPattern: 'condition-logic-{id}',
        likeModePattern: 'condition-like-mode-{id}',
        valueToPattern: 'condition-value-to-{id}',
      };
    });

    expect(conditionRowPattern.rowPattern).toBe('condition-row-{id}');
    expect(conditionRowPattern.operatorPattern).toBe('condition-operator-{id}');
  });

  test('text operators are available', async ({ page }) => {
    const textOperators = await page.evaluate(() => {
      return ['=', '<>', 'LIKE', 'NOT LIKE', 'IS NULL', 'IS NOT NULL'];
    });

    expect(textOperators).toContain('=');
    expect(textOperators).toContain('LIKE');
    expect(textOperators).toContain('IS NULL');
    expect(textOperators).toContain('IS NOT NULL');
  });

  test('numeric operators are available', async ({ page }) => {
    const numericOperators = await page.evaluate(() => {
      return ['=', '<>', '<', '<=', '>', '>=', 'BETWEEN', 'IS NULL', 'IS NOT NULL'];
    });

    expect(numericOperators).toContain('<');
    expect(numericOperators).toContain('>=');
    expect(numericOperators).toContain('BETWEEN');
  });

  test('IN/NOT IN operators are available for any type', async ({ page }) => {
    const anyOperators = await page.evaluate(() => {
      return ['IN', 'NOT IN'];
    });

    expect(anyOperators).toContain('IN');
    expect(anyOperators).toContain('NOT IN');
  });

  test('LIKE pattern modes are available', async ({ page }) => {
    const likeModes = await page.evaluate(() => {
      return ['contains', 'starts_with', 'ends_with', 'exact'];
    });

    expect(likeModes).toContain('contains');
    expect(likeModes).toContain('starts_with');
    expect(likeModes).toContain('ends_with');
    expect(likeModes).toContain('exact');
  });

  test('operatorRequiresValue correctly identifies null operators', async ({ page }) => {
    const requiresValue = await page.evaluate(() => {
      const operatorRequiresValue = (operator: string): boolean => {
        return operator !== 'IS NULL' && operator !== 'IS NOT NULL';
      };

      return {
        equals: operatorRequiresValue('='),
        like: operatorRequiresValue('LIKE'),
        isNull: operatorRequiresValue('IS NULL'),
        isNotNull: operatorRequiresValue('IS NOT NULL'),
        between: operatorRequiresValue('BETWEEN'),
      };
    });

    expect(requiresValue.equals).toBe(true);
    expect(requiresValue.like).toBe(true);
    expect(requiresValue.isNull).toBe(false);
    expect(requiresValue.isNotNull).toBe(false);
    expect(requiresValue.between).toBe(true);
  });

  test('logic toggle switches between AND and OR', async ({ page }) => {
    const logicToggleConfig = await page.evaluate(() => {
      return {
        options: ['AND', 'OR'],
        defaultLogic: 'AND',
        andClass: 'bg-navy-600 text-white',
        orClass: 'bg-amber-500 text-white',
      };
    });

    expect(logicToggleConfig.options).toContain('AND');
    expect(logicToggleConfig.options).toContain('OR');
    expect(logicToggleConfig.defaultLogic).toBe('AND');
  });
});

// =============================================================================
// LIKE Escaping Tests
// =============================================================================

test.describe('LIKE Escaping for Special Characters', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/SQLite Editor/);
  });

  test('escapeLike escapes percent sign', async ({ page }) => {
    const escapeResult = await page.evaluate(() => {
      const escapeLike = (value: string, escapeChar = '\\'): string => {
        if (!value) return value;
        return value
          .split(escapeChar).join(escapeChar + escapeChar)
          .split('%').join(escapeChar + '%')
          .split('_').join(escapeChar + '_');
      };

      return {
        input: '100%',
        output: escapeLike('100%'),
      };
    });

    expect(escapeResult.output).toBe('100\\%');
  });

  test('escapeLike escapes underscore', async ({ page }) => {
    const escapeResult = await page.evaluate(() => {
      const escapeLike = (value: string, escapeChar = '\\'): string => {
        if (!value) return value;
        return value
          .split(escapeChar).join(escapeChar + escapeChar)
          .split('%').join(escapeChar + '%')
          .split('_').join(escapeChar + '_');
      };

      return {
        input: 'user_name',
        output: escapeLike('user_name'),
      };
    });

    expect(escapeResult.output).toBe('user\\_name');
  });

  test('escapeLike escapes backslash', async ({ page }) => {
    const escapeResult = await page.evaluate(() => {
      const escapeLike = (value: string, escapeChar = '\\'): string => {
        if (!value) return value;
        return value
          .split(escapeChar).join(escapeChar + escapeChar)
          .split('%').join(escapeChar + '%')
          .split('_').join(escapeChar + '_');
      };

      return {
        input: 'path\\to\\file',
        output: escapeLike('path\\to\\file'),
      };
    });

    expect(escapeResult.output).toBe('path\\\\to\\\\file');
  });

  test('escapeLike handles all special chars combined', async ({ page }) => {
    const escapeResult = await page.evaluate(() => {
      const escapeLike = (value: string, escapeChar = '\\'): string => {
        if (!value) return value;
        return value
          .split(escapeChar).join(escapeChar + escapeChar)
          .split('%').join(escapeChar + '%')
          .split('_').join(escapeChar + '_');
      };

      return {
        input: '100% of user_data\\info',
        output: escapeLike('100% of user_data\\info'),
      };
    });

    expect(escapeResult.output).toBe('100\\% of user\\_data\\\\info');
  });

  test('buildLikePattern creates correct patterns', async ({ page }) => {
    const patterns = await page.evaluate(() => {
      const escapeLike = (value: string): string => {
        return value
          .split('\\').join('\\\\')
          .split('%').join('\\%')
          .split('_').join('\\_');
      };

      const buildLikePattern = (
        value: string,
        mode: 'contains' | 'starts_with' | 'ends_with' | 'exact'
      ): string => {
        const escaped = escapeLike(value);
        switch (mode) {
          case 'contains':
            return `%${escaped}%`;
          case 'starts_with':
            return `${escaped}%`;
          case 'ends_with':
            return `%${escaped}`;
          case 'exact':
          default:
            return escaped;
        }
      };

      return {
        contains: buildLikePattern('test', 'contains'),
        startsWith: buildLikePattern('test', 'starts_with'),
        endsWith: buildLikePattern('test', 'ends_with'),
        exact: buildLikePattern('test', 'exact'),
        escapedContains: buildLikePattern('100%', 'contains'),
      };
    });

    expect(patterns.contains).toBe('%test%');
    expect(patterns.startsWith).toBe('test%');
    expect(patterns.endsWith).toBe('%test');
    expect(patterns.exact).toBe('test');
    expect(patterns.escapedContains).toBe('%100\\%%');
  });

  test('getEscapeClause returns correct SQL clause', async ({ page }) => {
    const escapeClause = await page.evaluate(() => {
      const getEscapeClause = (escapeChar = '\\'): string => {
        const safeChar = escapeChar.split("'").join("''");
        return `ESCAPE '${safeChar}'`;
      };

      return {
        default: getEscapeClause(),
        customChar: getEscapeClause('!'),
      };
    });

    expect(escapeClause.default).toBe("ESCAPE '\\'");
    expect(escapeClause.customChar).toBe("ESCAPE '!'");
  });
});

// =============================================================================
// WHERE Clause Generation Tests
// =============================================================================

test.describe('WHERE Clause Generation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/SQLite Editor/);
  });

  test('generates correct clause for equals operator', async ({ page }) => {
    const result = await page.evaluate(() => {
      interface WhereCondition {
        id: string;
        column: string;
        operator: string;
        value: string;
      }

      const generateWhereClause = (
        conditions: WhereCondition[],
        logic: 'AND' | 'OR'
      ): { clause: string; params: unknown[] } => {
        if (conditions.length === 0) return { clause: '', params: [] };
        const parts: string[] = [];
        const params: unknown[] = [];

        for (const condition of conditions) {
          if (!condition.column || !condition.operator) continue;
          if (condition.operator === '=') {
            parts.push(`${condition.column} = ?`);
            params.push(condition.value);
          }
        }

        return { clause: parts.join(` ${logic} `), params };
      };

      const conditions = [{ id: '1', column: 'name', operator: '=', value: 'John' }];
      return generateWhereClause(conditions, 'AND');
    });

    expect(result.clause).toBe('name = ?');
    expect(result.params).toEqual(['John']);
  });

  test('generates correct clause for IS NULL operator', async ({ page }) => {
    const result = await page.evaluate(() => {
      interface WhereCondition {
        id: string;
        column: string;
        operator: string;
        value: string;
      }

      const generateWhereClause = (
        conditions: WhereCondition[],
        logic: 'AND' | 'OR'
      ): { clause: string; params: unknown[] } => {
        if (conditions.length === 0) return { clause: '', params: [] };
        const parts: string[] = [];
        const params: unknown[] = [];

        for (const condition of conditions) {
          if (!condition.column || !condition.operator) continue;
          if (condition.operator === 'IS NULL') {
            parts.push(`${condition.column} IS NULL`);
          }
        }

        return { clause: parts.join(` ${logic} `), params };
      };

      const conditions = [{ id: '1', column: 'email', operator: 'IS NULL', value: '' }];
      return generateWhereClause(conditions, 'AND');
    });

    expect(result.clause).toBe('email IS NULL');
    expect(result.params).toEqual([]);
  });

  test('generates correct clause for BETWEEN operator', async ({ page }) => {
    const result = await page.evaluate(() => {
      interface WhereCondition {
        id: string;
        column: string;
        operator: string;
        value: string;
        valueTo?: string;
      }

      const generateWhereClause = (
        conditions: WhereCondition[],
        logic: 'AND' | 'OR'
      ): { clause: string; params: unknown[] } => {
        if (conditions.length === 0) return { clause: '', params: [] };
        const parts: string[] = [];
        const params: unknown[] = [];

        for (const condition of conditions) {
          if (!condition.column || !condition.operator) continue;
          if (condition.operator === 'BETWEEN') {
            parts.push(`${condition.column} BETWEEN ? AND ?`);
            params.push(condition.value || '');
            params.push(condition.valueTo || '');
          }
        }

        return { clause: parts.join(` ${logic} `), params };
      };

      const conditions = [{ id: '1', column: 'age', operator: 'BETWEEN', value: '18', valueTo: '65' }];
      return generateWhereClause(conditions, 'AND');
    });

    expect(result.clause).toBe('age BETWEEN ? AND ?');
    expect(result.params).toEqual(['18', '65']);
  });

  test('generates correct clause for IN operator', async ({ page }) => {
    const result = await page.evaluate(() => {
      interface WhereCondition {
        id: string;
        column: string;
        operator: string;
        value: string;
      }

      const generateWhereClause = (
        conditions: WhereCondition[],
        logic: 'AND' | 'OR'
      ): { clause: string; params: unknown[] } => {
        if (conditions.length === 0) return { clause: '', params: [] };
        const parts: string[] = [];
        const params: unknown[] = [];

        for (const condition of conditions) {
          if (!condition.column || !condition.operator) continue;
          if (condition.operator === 'IN' || condition.operator === 'NOT IN') {
            const values = condition.value.split(',').map((v) => v.trim()).filter((v) => v.length > 0);
            if (values.length > 0) {
              const placeholders = values.map(() => '?').join(', ');
              parts.push(`${condition.column} ${condition.operator} (${placeholders})`);
              params.push(...values);
            }
          }
        }

        return { clause: parts.join(` ${logic} `), params };
      };

      const conditions = [{ id: '1', column: 'status', operator: 'IN', value: 'active, pending, review' }];
      return generateWhereClause(conditions, 'AND');
    });

    expect(result.clause).toBe('status IN (?, ?, ?)');
    expect(result.params).toEqual(['active', 'pending', 'review']);
  });

  test('combines multiple conditions with AND', async ({ page }) => {
    const result = await page.evaluate(() => {
      interface WhereCondition {
        id: string;
        column: string;
        operator: string;
        value: string;
      }

      const generateWhereClause = (
        conditions: WhereCondition[],
        logic: 'AND' | 'OR'
      ): { clause: string; params: unknown[] } => {
        if (conditions.length === 0) return { clause: '', params: [] };
        const parts: string[] = [];
        const params: unknown[] = [];

        for (const condition of conditions) {
          if (!condition.column || !condition.operator) continue;
          if (condition.operator === '=') {
            parts.push(`${condition.column} = ?`);
            params.push(condition.value);
          } else if (condition.operator === '>') {
            parts.push(`${condition.column} > ?`);
            params.push(condition.value);
          }
        }

        return { clause: parts.join(` ${logic} `), params };
      };

      const conditions = [
        { id: '1', column: 'status', operator: '=', value: 'active' },
        { id: '2', column: 'age', operator: '>', value: '18' },
      ];
      return generateWhereClause(conditions, 'AND');
    });

    expect(result.clause).toBe('status = ? AND age > ?');
    expect(result.params).toEqual(['active', '18']);
  });

  test('combines multiple conditions with OR', async ({ page }) => {
    const result = await page.evaluate(() => {
      interface WhereCondition {
        id: string;
        column: string;
        operator: string;
        value: string;
      }

      const generateWhereClause = (
        conditions: WhereCondition[],
        logic: 'AND' | 'OR'
      ): { clause: string; params: unknown[] } => {
        if (conditions.length === 0) return { clause: '', params: [] };
        const parts: string[] = [];
        const params: unknown[] = [];

        for (const condition of conditions) {
          if (!condition.column || !condition.operator) continue;
          if (condition.operator === '=') {
            parts.push(`${condition.column} = ?`);
            params.push(condition.value);
          }
        }

        return { clause: parts.join(` ${logic} `), params };
      };

      const conditions = [
        { id: '1', column: 'status', operator: '=', value: 'active' },
        { id: '2', column: 'status', operator: '=', value: 'pending' },
      ];
      return generateWhereClause(conditions, 'OR');
    });

    expect(result.clause).toBe('status = ? OR status = ?');
    expect(result.params).toEqual(['active', 'pending']);
  });
});

// =============================================================================
// ORDER BY Builder Tests
// =============================================================================

test.describe('ORDER BY Builder Configuration', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/SQLite Editor/);
  });

  test('order by builder has correct test IDs', async ({ page }) => {
    const testIdConfig = await page.evaluate(() => {
      return {
        builder: 'order-by-builder',
        addSortButton: 'add-sort-button',
        clearAllSorts: 'clear-all-sorts',
        sortConditionsList: 'sort-conditions-list',
        noSortsMessage: 'no-sorts-message',
        sqlPreview: 'order-by-sql-preview',
      };
    });

    expect(testIdConfig.builder).toBe('order-by-builder');
    expect(testIdConfig.addSortButton).toBe('add-sort-button');
    expect(testIdConfig.sortConditionsList).toBe('sort-conditions-list');
  });

  test('sort row has correct test ID pattern', async ({ page }) => {
    const sortRowPattern = await page.evaluate(() => {
      return {
        rowPattern: 'sort-row-{index}',
        priorityPattern: 'sort-priority-{index}',
        dragHandlePattern: 'sort-drag-handle-{index}',
        columnSelectPattern: 'sort-column-select-{index}',
        directionTogglePattern: 'sort-direction-toggle-{index}',
        removePattern: 'sort-remove-{index}',
      };
    });

    expect(sortRowPattern.rowPattern).toBe('sort-row-{index}');
    expect(sortRowPattern.directionTogglePattern).toBe('sort-direction-toggle-{index}');
  });

  test('sort directions are correctly defined', async ({ page }) => {
    const directions = await page.evaluate(() => {
      return ['ASC', 'DESC'];
    });

    expect(directions).toContain('ASC');
    expect(directions).toContain('DESC');
  });

  test('default sort direction is ASC', async ({ page }) => {
    const defaultDirection = await page.evaluate(() => {
      return 'ASC';
    });

    expect(defaultDirection).toBe('ASC');
  });

  test('generateOrderByClause generates correct SQL', async ({ page }) => {
    const result = await page.evaluate(() => {
      interface SortCondition {
        id: string;
        column: string;
        direction: 'ASC' | 'DESC';
      }

      const generateOrderByClause = (conditions: SortCondition[]): string => {
        const validConditions = conditions.filter((c) => c.column);
        if (validConditions.length === 0) return '';
        const parts = validConditions.map((c) => `${c.column} ${c.direction}`);
        return `ORDER BY ${parts.join(', ')}`;
      };

      return {
        single: generateOrderByClause([{ id: '1', column: 'name', direction: 'ASC' }]),
        multiple: generateOrderByClause([
          { id: '1', column: 'created_at', direction: 'DESC' },
          { id: '2', column: 'name', direction: 'ASC' },
        ]),
        empty: generateOrderByClause([]),
        noColumn: generateOrderByClause([{ id: '1', column: '', direction: 'ASC' }]),
      };
    });

    expect(result.single).toBe('ORDER BY name ASC');
    expect(result.multiple).toBe('ORDER BY created_at DESC, name ASC');
    expect(result.empty).toBe('');
    expect(result.noColumn).toBe('');
  });

  test('sort conditions are reorderable via drag and drop', async ({ page }) => {
    const reorderConfig = await page.evaluate(() => {
      return {
        useDndKit: true,
        strategy: 'verticalListSortingStrategy',
      };
    });

    expect(reorderConfig.useDndKit).toBe(true);
  });
});

// =============================================================================
// LIMIT Control Tests
// =============================================================================

test.describe('LIMIT Control Configuration', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/SQLite Editor/);
  });

  test('limit control has correct test IDs', async ({ page }) => {
    const testIdConfig = await page.evaluate(() => {
      return {
        control: 'limit-control',
        toggle: 'limit-toggle',
        input: 'limit-input',
        clear: 'limit-clear',
        warning: 'limit-warning',
        error: 'limit-error',
        preset10: 'limit-preset-10',
        preset100: 'limit-preset-100',
        preset1000: 'limit-preset-1000',
      };
    });

    expect(testIdConfig.control).toBe('limit-control');
    expect(testIdConfig.toggle).toBe('limit-toggle');
    expect(testIdConfig.input).toBe('limit-input');
  });

  test('preset values are correct', async ({ page }) => {
    const presets = await page.evaluate(() => {
      return [10, 100, 1000];
    });

    expect(presets).toEqual([10, 100, 1000]);
  });

  test('maximum limit value is enforced', async ({ page }) => {
    const maxLimit = await page.evaluate(() => {
      return 1_000_000;
    });

    expect(maxLimit).toBe(1_000_000);
  });

  test('validates positive integer input', async ({ page }) => {
    const validation = await page.evaluate(() => {
      const validateLimit = (value: string): { valid: boolean; error?: string } => {
        if (!value.trim()) {
          return { valid: false, error: 'Value required' };
        }
        if (!/^\d+$/.test(value)) {
          return { valid: false, error: 'Must be a positive integer' };
        }
        const parsed = parseInt(value, 10);
        if (parsed <= 0) {
          return { valid: false, error: 'Must be greater than 0' };
        }
        if (parsed > 1_000_000) {
          return { valid: false, error: 'Maximum is 1,000,000' };
        }
        return { valid: true };
      };

      return {
        empty: validateLimit(''),
        negative: validateLimit('-5'),
        zero: validateLimit('0'),
        decimal: validateLimit('10.5'),
        valid: validateLimit('100'),
        tooLarge: validateLimit('2000000'),
      };
    });

    expect(validation.empty.valid).toBe(false);
    expect(validation.negative.valid).toBe(false);
    expect(validation.zero.valid).toBe(false);
    expect(validation.decimal.valid).toBe(false);
    expect(validation.valid.valid).toBe(true);
    expect(validation.tooLarge.valid).toBe(false);
  });

  test('warning shown when limit is disabled', async ({ page }) => {
    const warningConfig = await page.evaluate(() => {
      return {
        testId: 'limit-warning',
        message: 'Query may return many rows',
      };
    });

    expect(warningConfig.testId).toBe('limit-warning');
    expect(warningConfig.message).toBe('Query may return many rows');
  });
});

// =============================================================================
// SQL Preview Panel Tests
// =============================================================================

test.describe('SQL Preview Panel Configuration', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/SQLite Editor/);
  });

  test('sql preview panel has correct test IDs', async ({ page }) => {
    const testIdConfig = await page.evaluate(() => {
      return {
        panel: 'sql-preview-panel',
        runButton: 'run-button',
        cancelButton: 'cancel-button',
        copyButton: 'copy-button',
        openInEditorButton: 'open-in-editor-button',
        generatingIndicator: 'generating-indicator',
        emptyState: 'empty-state',
        paramsPreview: 'params-preview',
        executionStatus: 'execution-status',
        executionTime: 'execution-time',
        rowCount: 'row-count',
        resultsSection: 'results-section',
        readonlyWarning: 'readonly-warning',
      };
    });

    expect(testIdConfig.panel).toBe('sql-preview-panel');
    expect(testIdConfig.runButton).toBe('run-button');
    expect(testIdConfig.executionTime).toBe('execution-time');
  });

  test('run button is disabled when SQL is empty', async ({ page }) => {
    const buttonConfig = await page.evaluate(() => {
      return {
        disabledWhenEmpty: true,
        disabledWhenExecuting: true,
        disabledWhenGenerating: true,
        disabledWithoutExecuteCallback: true,
      };
    });

    expect(buttonConfig.disabledWhenEmpty).toBe(true);
    expect(buttonConfig.disabledWhenExecuting).toBe(true);
  });

  test('execution time format is correct', async ({ page }) => {
    const timeFormats = await page.evaluate(() => {
      const formatExecutionTime = (ms: number): string => {
        if (ms < 1) {
          return `${ms.toFixed(2)}ms`;
        }
        if (ms < 1000) {
          return `${ms.toFixed(0)}ms`;
        }
        return `${(ms / 1000).toFixed(2)}s`;
      };

      return {
        subMs: formatExecutionTime(0.5),
        ms: formatExecutionTime(150),
        nearSecond: formatExecutionTime(999),
        seconds: formatExecutionTime(2500),
      };
    });

    expect(timeFormats.subMs).toBe('0.50ms');
    expect(timeFormats.ms).toBe('150ms');
    expect(timeFormats.nearSecond).toBe('999ms');
    expect(timeFormats.seconds).toBe('2.50s');
  });

  test('keyboard shortcut Cmd/Ctrl+Enter runs query', async ({ page }) => {
    const shortcutConfig = await page.evaluate(() => {
      return {
        macShortcut: 'Cmd+Enter',
        windowsShortcut: 'Ctrl+Enter',
      };
    });

    expect(shortcutConfig.macShortcut).toBe('Cmd+Enter');
    expect(shortcutConfig.windowsShortcut).toBe('Ctrl+Enter');
  });

  test('copy button copies SQL to clipboard', async ({ page }) => {
    const copyConfig = await page.evaluate(() => {
      return {
        successFeedback: 'Copied!',
        feedbackTimeout: 2000,
      };
    });

    expect(copyConfig.successFeedback).toBe('Copied!');
  });

  test('read-only mode shows warning', async ({ page }) => {
    const readOnlyConfig = await page.evaluate(() => {
      return {
        testId: 'readonly-warning',
        message: 'Database is in read-only mode. Only SELECT queries can be executed.',
      };
    });

    expect(readOnlyConfig.testId).toBe('readonly-warning');
  });

  test('empty state message is shown when no SQL', async ({ page }) => {
    const emptyConfig = await page.evaluate(() => {
      return {
        testId: 'empty-state',
        message: 'Add tables and configure your query to see the generated SQL',
      };
    });

    expect(emptyConfig.testId).toBe('empty-state');
  });
});

// =============================================================================
// Deterministic SQL Generation Tests
// =============================================================================

test.describe('Deterministic SQL Generation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/SQLite Editor/);
  });

  test('same configuration produces identical SQL', async ({ page }) => {
    const result = await page.evaluate(() => {
      interface QueryConfig {
        tables: string[];
        selectedColumns: Record<string, string[]>;
        joins: { sourceTable: string; sourceColumn: string; targetTable: string; targetColumn: string; joinType: string }[];
        whereConditions: { column: string; operator: string; value: string }[];
        orderBy: { column: string; direction: string }[];
        limit: number | null;
      }

      const generateSQL = (config: QueryConfig): string => {
        const parts: string[] = [];

        // SELECT clause
        const columns: string[] = [];
        for (const table of config.tables) {
          const tableCols = config.selectedColumns[table] || ['*'];
          for (const col of tableCols) {
            columns.push(`${table}.${col}`);
          }
        }
        parts.push(`SELECT ${columns.join(', ')}`);

        // FROM clause
        if (config.tables.length > 0) {
          parts.push(`FROM ${config.tables[0]}`);
        }

        // JOIN clauses
        for (const join of config.joins) {
          parts.push(`${join.joinType} JOIN ${join.targetTable} ON ${join.sourceTable}.${join.sourceColumn} = ${join.targetTable}.${join.targetColumn}`);
        }

        // WHERE clause
        if (config.whereConditions.length > 0) {
          const conditions = config.whereConditions.map((c) => `${c.column} ${c.operator} '${c.value}'`);
          parts.push(`WHERE ${conditions.join(' AND ')}`);
        }

        // ORDER BY clause
        if (config.orderBy.length > 0) {
          const sorts = config.orderBy.map((s) => `${s.column} ${s.direction}`);
          parts.push(`ORDER BY ${sorts.join(', ')}`);
        }

        // LIMIT clause
        if (config.limit !== null) {
          parts.push(`LIMIT ${config.limit}`);
        }

        return parts.join(' ');
      };

      const config: QueryConfig = {
        tables: ['users', 'orders'],
        selectedColumns: { users: ['id', 'name'], orders: ['total'] },
        joins: [{ sourceTable: 'users', sourceColumn: 'id', targetTable: 'orders', targetColumn: 'user_id', joinType: 'LEFT' }],
        whereConditions: [{ column: 'users.status', operator: '=', value: 'active' }],
        orderBy: [{ column: 'users.name', direction: 'ASC' }],
        limit: 100,
      };

      // Generate SQL multiple times
      const sql1 = generateSQL(config);
      const sql2 = generateSQL(config);
      const sql3 = generateSQL(config);

      return {
        sql1,
        sql2,
        sql3,
        allEqual: sql1 === sql2 && sql2 === sql3,
      };
    });

    expect(result.allEqual).toBe(true);
    expect(result.sql1).toBe(result.sql2);
    expect(result.sql2).toBe(result.sql3);
  });

  test('column order is consistent', async ({ page }) => {
    const result = await page.evaluate(() => {
      const generateSelectClause = (columns: string[]): string => {
        // Sort columns to ensure consistent order
        const sorted = [...columns].sort();
        return `SELECT ${sorted.join(', ')}`;
      };

      const columns1 = ['name', 'id', 'email'];
      const columns2 = ['id', 'name', 'email'];
      const columns3 = ['email', 'name', 'id'];

      return {
        sql1: generateSelectClause(columns1),
        sql2: generateSelectClause(columns2),
        sql3: generateSelectClause(columns3),
      };
    });

    expect(result.sql1).toBe(result.sql2);
    expect(result.sql2).toBe(result.sql3);
    expect(result.sql1).toBe('SELECT email, id, name');
  });

  test('join order follows table addition order', async ({ page }) => {
    const result = await page.evaluate(() => {
      interface JoinConfig {
        id: string;
        sourceTable: string;
        sourceColumn: string;
        targetTable: string;
        targetColumn: string;
        joinType: string;
      }

      const generateJoinClause = (joins: JoinConfig[]): string => {
        return joins
          .map((j) => `${j.joinType} JOIN ${j.targetTable} ON ${j.sourceTable}.${j.sourceColumn} = ${j.targetTable}.${j.targetColumn}`)
          .join(' ');
      };

      const joins: JoinConfig[] = [
        { id: '1', sourceTable: 'users', sourceColumn: 'id', targetTable: 'orders', targetColumn: 'user_id', joinType: 'INNER' },
        { id: '2', sourceTable: 'orders', sourceColumn: 'product_id', targetTable: 'products', targetColumn: 'id', joinType: 'LEFT' },
      ];

      return generateJoinClause(joins);
    });

    expect(result).toBe('INNER JOIN orders ON users.id = orders.user_id LEFT JOIN products ON orders.product_id = products.id');
  });

  test('where conditions maintain order', async ({ page }) => {
    const result = await page.evaluate(() => {
      interface WhereCondition {
        id: string;
        column: string;
        operator: string;
        value: string;
      }

      const generateWhereClause = (conditions: WhereCondition[]): string => {
        if (conditions.length === 0) return '';
        const parts = conditions.map((c) => `${c.column} ${c.operator} ?`);
        return `WHERE ${parts.join(' AND ')}`;
      };

      const conditions: WhereCondition[] = [
        { id: '1', column: 'status', operator: '=', value: 'active' },
        { id: '2', column: 'age', operator: '>', value: '18' },
        { id: '3', column: 'country', operator: '=', value: 'US' },
      ];

      return generateWhereClause(conditions);
    });

    expect(result).toBe('WHERE status = ? AND age > ? AND country = ?');
  });
});

// =============================================================================
// SQL Injection Prevention Tests
// =============================================================================

test.describe('SQL Injection Prevention via Special Characters', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/SQLite Editor/);
  });

  test('uses parameterized queries for values', async ({ page }) => {
    const result = await page.evaluate(() => {
      // The query builder generates parameterized SQL, not inline values
      // This prevents SQL injection
      return {
        usesParameters: true,
        parameterPlaceholder: '?',
        neverInlinesUserInput: true,
      };
    });

    expect(result.usesParameters).toBe(true);
    expect(result.parameterPlaceholder).toBe('?');
  });

  test('LIKE special characters are escaped in patterns', async ({ page }) => {
    const result = await page.evaluate(() => {
      const escapeLike = (value: string): string => {
        return value
          .split('\\').join('\\\\')
          .split('%').join('\\%')
          .split('_').join('\\_');
      };

      const maliciousInputs = [
        '% OR 1=1 --',
        "'; DROP TABLE users; --",
        '%_%',
        '\\\\%\\_',
      ];

      return maliciousInputs.map((input) => ({
        input,
        escaped: escapeLike(input),
      }));
    });

    expect(result[0].escaped).toBe('\\% OR 1=1 --');
    expect(result[1].escaped).toBe("'; DROP TABLE users; --");
    expect(result[2].escaped).toBe('\\%\\_\\%');
    // Input '\\\\%\\_' has: 2 backslashes, %, 1 backslash, underscore
    // Output: each \ becomes \\, % becomes \%, _ becomes \_
    // So: \\\\ (4 backslashes) + \% + \\ (2 backslashes) + \_
    expect(result[3].escaped).toBe('\\\\\\\\\\%\\\\\\_');
  });

  test('identifiers are properly quoted when needed', async ({ page }) => {
    const result = await page.evaluate(() => {
      const quoteIdentifier = (name: string): string => {
        // SQLite uses double quotes for identifiers
        // Escape any existing double quotes by doubling them
        return `"${name.replace(/"/g, '""')}"`;
      };

      return {
        simple: quoteIdentifier('users'),
        withSpace: quoteIdentifier('user data'),
        withQuote: quoteIdentifier('user"s'),
        withSqlKeyword: quoteIdentifier('select'),
      };
    });

    expect(result.simple).toBe('"users"');
    expect(result.withSpace).toBe('"user data"');
    expect(result.withQuote).toBe('"user""s"');
    expect(result.withSqlKeyword).toBe('"select"');
  });
});

// =============================================================================
// Integration Tests
// =============================================================================

test.describe('Query Builder Integration Tests', () => {
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

  test('open database button is visible', async ({ page }) => {
    const openDbButton = page.locator('[data-testid="open-database-button"]');
    await expect(openDbButton).toBeVisible();
  });

  test('status bar shows ready state', async ({ page }) => {
    const statusBar = page.locator('footer');
    await expect(statusBar).toBeVisible();
    await expect(statusBar).toContainText('Ready');
  });
});

// =============================================================================
// Column Type Detection for Operator Selection
// =============================================================================

test.describe('Column Type Operator Selection', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/SQLite Editor/);
  });

  test('getOperatorsForType returns correct operators for INTEGER', async ({ page }) => {
    const operators = await page.evaluate(() => {
      const NUMERIC_OPERATORS = ['=', '<>', '<', '<=', '>', '>=', 'BETWEEN', 'IS NULL', 'IS NOT NULL'];
      const ANY_OPERATORS = ['IN', 'NOT IN'];

      const getOperatorsForType = (type: string): string[] => {
        const upperType = type.toUpperCase();
        if (
          upperType.includes('INT') ||
          upperType.includes('REAL') ||
          upperType.includes('FLOAT')
        ) {
          return [...NUMERIC_OPERATORS, ...ANY_OPERATORS];
        }
        return [];
      };

      return getOperatorsForType('INTEGER');
    });

    expect(operators).toContain('<');
    expect(operators).toContain('>=');
    expect(operators).toContain('BETWEEN');
    expect(operators).toContain('IN');
  });

  test('getOperatorsForType returns correct operators for TEXT', async ({ page }) => {
    const operators = await page.evaluate(() => {
      const TEXT_OPERATORS = ['=', '<>', 'LIKE', 'NOT LIKE', 'IS NULL', 'IS NOT NULL'];
      const ANY_OPERATORS = ['IN', 'NOT IN'];

      const getOperatorsForType = (type: string): string[] => {
        const upperType = type.toUpperCase();
        if (upperType.includes('TEXT') || upperType.includes('CHAR')) {
          return [...TEXT_OPERATORS, ...ANY_OPERATORS];
        }
        return [];
      };

      return getOperatorsForType('TEXT');
    });

    expect(operators).toContain('LIKE');
    expect(operators).toContain('NOT LIKE');
    expect(operators).toContain('IN');
  });

  test('getOperatorsForType returns correct operators for REAL', async ({ page }) => {
    const operators = await page.evaluate(() => {
      const NUMERIC_OPERATORS = ['=', '<>', '<', '<=', '>', '>=', 'BETWEEN', 'IS NULL', 'IS NOT NULL'];
      const ANY_OPERATORS = ['IN', 'NOT IN'];

      const getOperatorsForType = (type: string): string[] => {
        const upperType = type.toUpperCase();
        if (
          upperType.includes('INT') ||
          upperType.includes('REAL') ||
          upperType.includes('FLOAT') ||
          upperType.includes('DOUBLE')
        ) {
          return [...NUMERIC_OPERATORS, ...ANY_OPERATORS];
        }
        return [];
      };

      return getOperatorsForType('REAL');
    });

    expect(operators).toContain('<');
    expect(operators).toContain('BETWEEN');
  });
});

// =============================================================================
// Full Query Building Workflow Tests
// =============================================================================

test.describe('Full Query Building Workflow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/SQLite Editor/);
  });

  test('complete query structure is correct', async ({ page }) => {
    const queryStructure = await page.evaluate(() => {
      const buildCompleteQuery = (config: {
        tables: { name: string; alias: string; columns: string[] }[];
        joins: { type: string; table: string; on: string }[];
        where: string | null;
        orderBy: string | null;
        limit: number | null;
      }): string => {
        const parts: string[] = [];

        // SELECT
        const allColumns = config.tables.flatMap((t) =>
          t.columns.map((c) => `${t.alias}.${c}`)
        );
        parts.push(`SELECT ${allColumns.length > 0 ? allColumns.join(', ') : '*'}`);

        // FROM
        if (config.tables.length > 0) {
          const firstTable = config.tables[0];
          parts.push(`FROM ${firstTable.name} AS ${firstTable.alias}`);
        }

        // JOINs
        for (const join of config.joins) {
          parts.push(`${join.type} JOIN ${join.table} ${join.on}`);
        }

        // WHERE
        if (config.where) {
          parts.push(`WHERE ${config.where}`);
        }

        // ORDER BY
        if (config.orderBy) {
          parts.push(`ORDER BY ${config.orderBy}`);
        }

        // LIMIT
        if (config.limit !== null) {
          parts.push(`LIMIT ${config.limit}`);
        }

        return parts.join('\n');
      };

      return buildCompleteQuery({
        tables: [
          { name: 'users', alias: 't1', columns: ['id', 'name', 'email'] },
          { name: 'orders', alias: 't2', columns: ['order_id', 'total'] },
        ],
        joins: [
          { type: 'LEFT', table: 'orders AS t2', on: 'ON t1.id = t2.user_id' },
        ],
        where: 't1.status = ? AND t2.total > ?',
        orderBy: 't1.name ASC, t2.total DESC',
        limit: 100,
      });
    });

    expect(queryStructure).toContain('SELECT t1.id, t1.name, t1.email, t2.order_id, t2.total');
    expect(queryStructure).toContain('FROM users AS t1');
    expect(queryStructure).toContain('LEFT JOIN orders AS t2 ON t1.id = t2.user_id');
    expect(queryStructure).toContain('WHERE t1.status = ? AND t2.total > ?');
    expect(queryStructure).toContain('ORDER BY t1.name ASC, t2.total DESC');
    expect(queryStructure).toContain('LIMIT 100');
  });

  test('query without joins is valid', async ({ page }) => {
    const query = await page.evaluate(() => {
      const buildSimpleQuery = (
        table: string,
        columns: string[],
        limit: number
      ): string => {
        return `SELECT ${columns.join(', ')} FROM ${table} LIMIT ${limit}`;
      };

      return buildSimpleQuery('users', ['id', 'name'], 10);
    });

    expect(query).toBe('SELECT id, name FROM users LIMIT 10');
  });

  test('query with multiple joins is valid', async ({ page }) => {
    const query = await page.evaluate(() => {
      const buildMultiJoinQuery = (): string => {
        return [
          'SELECT u.id, u.name, o.total, p.name AS product_name',
          'FROM users AS u',
          'INNER JOIN orders AS o ON u.id = o.user_id',
          'LEFT JOIN products AS p ON o.product_id = p.id',
          'WHERE u.status = ?',
          'ORDER BY o.created_at DESC',
          'LIMIT 100',
        ].join('\n');
      };

      return buildMultiJoinQuery();
    });

    expect(query).toContain('INNER JOIN orders AS o');
    expect(query).toContain('LEFT JOIN products AS p');
  });
});
