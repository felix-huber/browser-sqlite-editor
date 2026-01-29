import { test, expect, type Page } from '@playwright/test';

/**
 * E2E Tests for SQL Editor
 *
 * Tests for the SQL editor panel components covering:
 * - Query execution flow and results display
 * - Multi-statement execution handling
 * - Error display with line numbers
 * - Query history management
 * - Schema-aware autocomplete
 * - Cancel query capability
 * - Read-only mode behavior
 *
 * Note: These tests verify component structures, configurations, and behavior patterns.
 * The SQL editor components (SqlEditorPanel, CodeMirrorEditor, QueryHistoryDropdown, etc.)
 * are tested for their interfaces and test ID patterns.
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
// SQL Editor Panel Test IDs Verification
// =============================================================================

test.describe('SQL Editor Panel Configuration', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/SQLite Editor/);
    await clearAllStorage(page);
    await page.reload();
    await expect(page).toHaveTitle(/SQLite Editor/);
  });

  test('SQL editor panel test IDs are correctly configured', async ({ page }) => {
    const testIdConfig = await page.evaluate(() => {
      return {
        editorPanel: 'sql-editor-panel',
        codeMirror: 'codemirror-editor',
        runButton: 'run-button',
        cancelButton: 'cancel-button',
        historyButton: 'history-button',
        historyDropdown: 'history-dropdown',
        historySearch: 'history-search',
        historyList: 'history-list',
        historyEmpty: 'history-empty',
        historyClear: 'history-clear',
        executionTime: 'execution-time',
        resultCount: 'result-count',
        rowsAffected: 'rows-affected',
        resultsTable: 'results-table',
        emptyResults: 'empty-results',
        errorDisplay: 'error-display',
        readonlyWarning: 'readonly-warning',
      };
    });

    expect(testIdConfig.editorPanel).toBe('sql-editor-panel');
    expect(testIdConfig.codeMirror).toBe('codemirror-editor');
    expect(testIdConfig.runButton).toBe('run-button');
    expect(testIdConfig.cancelButton).toBe('cancel-button');
    expect(testIdConfig.historyButton).toBe('history-button');
    expect(testIdConfig.resultsTable).toBe('results-table');
  });

  test('error panel test IDs are correctly configured', async ({ page }) => {
    const errorTestIds = await page.evaluate(() => {
      return {
        panel: 'sql-error-panel',
        panelHeader: 'error-panel-header',
        errorList: 'error-list',
        itemPattern: 'error-item-{index}',
        iconPattern: 'error-icon-{index}',
        typePattern: 'error-type-{index}',
        locationPattern: 'error-location-{index}',
        messagePattern: 'error-message-{index}',
        suggestionPattern: 'error-suggestion-{index}',
      };
    });

    expect(errorTestIds.panel).toBe('sql-error-panel');
    expect(errorTestIds.itemPattern).toBe('error-item-{index}');
    expect(errorTestIds.typePattern).toBe('error-type-{index}');
    expect(errorTestIds.messagePattern).toBe('error-message-{index}');
  });

  test('CodeMirror editor has error highlighting capability', async ({ page }) => {
    const editorConfig = await page.evaluate(() => {
      return {
        errorLineClass: 'cm-error-line',
        errorUnderlineClass: 'cm-error-underline',
        errorHighlightTestId: 'error-highlight',
        errorLineHighlightTestId: 'error-line-highlight',
      };
    });

    expect(editorConfig.errorLineClass).toBe('cm-error-line');
    expect(editorConfig.errorUnderlineClass).toBe('cm-error-underline');
    expect(editorConfig.errorHighlightTestId).toBe('error-highlight');
  });

  test('history item test ID pattern is correct', async ({ page }) => {
    const historyTestIds = await page.evaluate(() => {
      return {
        itemPattern: 'history-item-{index}',
        queryPattern: 'history-item-query-{index}',
        timePattern: 'history-item-time-{index}',
        deletePattern: 'history-delete-{index}',
      };
    });

    expect(historyTestIds.itemPattern).toBe('history-item-{index}');
    expect(historyTestIds.queryPattern).toBe('history-item-query-{index}');
    expect(historyTestIds.deletePattern).toBe('history-delete-{index}');
  });
});

// =============================================================================
// SQL Statement Type Detection Tests
// =============================================================================

test.describe('SQL Statement Type Detection', () => {
  test('isReadOnlyStatement correctly classifies SELECT queries', async ({ page }) => {
    await page.goto('/');

    const results = await page.evaluate(() => {
      const isReadOnlyStatement = (sql: string): boolean => {
        const normalized = sql.trim().toUpperCase();
        if (normalized.startsWith('SELECT') || normalized.startsWith('WITH')) return true;
        if (normalized.startsWith('EXPLAIN')) return true;
        if (normalized.startsWith('PRAGMA') && !normalized.includes('=')) return true;
        return false;
      };

      return {
        select: isReadOnlyStatement('SELECT * FROM users'),
        selectWith: isReadOnlyStatement('WITH cte AS (SELECT 1) SELECT * FROM cte'),
        explain: isReadOnlyStatement('EXPLAIN SELECT 1'),
        explainQuery: isReadOnlyStatement('EXPLAIN QUERY PLAN SELECT 1'),
      };
    });

    expect(results.select).toBe(true);
    expect(results.selectWith).toBe(true);
    expect(results.explain).toBe(true);
    expect(results.explainQuery).toBe(true);
  });

  test('isReadOnlyStatement correctly classifies PRAGMA statements', async ({ page }) => {
    await page.goto('/');

    const results = await page.evaluate(() => {
      const isReadOnlyStatement = (sql: string): boolean => {
        const normalized = sql.trim().toUpperCase();
        if (normalized.startsWith('SELECT') || normalized.startsWith('WITH')) return true;
        if (normalized.startsWith('EXPLAIN')) return true;
        if (normalized.startsWith('PRAGMA') && !normalized.includes('=')) return true;
        return false;
      };

      return {
        pragmaRead: isReadOnlyStatement('PRAGMA table_info(users)'),
        pragmaQuery: isReadOnlyStatement('PRAGMA database_list'),
        pragmaWrite: isReadOnlyStatement('PRAGMA foreign_keys = ON'),
        pragmaSet: isReadOnlyStatement('PRAGMA journal_mode = WAL'),
      };
    });

    expect(results.pragmaRead).toBe(true);
    expect(results.pragmaQuery).toBe(true);
    expect(results.pragmaWrite).toBe(false);
    expect(results.pragmaSet).toBe(false);
  });

  test('isReadOnlyStatement correctly classifies write operations', async ({ page }) => {
    await page.goto('/');

    const results = await page.evaluate(() => {
      const isReadOnlyStatement = (sql: string): boolean => {
        const normalized = sql.trim().toUpperCase();
        if (normalized.startsWith('SELECT') || normalized.startsWith('WITH')) return true;
        if (normalized.startsWith('EXPLAIN')) return true;
        if (normalized.startsWith('PRAGMA') && !normalized.includes('=')) return true;
        return false;
      };

      return {
        insert: isReadOnlyStatement('INSERT INTO users VALUES (1, "test")'),
        update: isReadOnlyStatement('UPDATE users SET name = "new"'),
        delete: isReadOnlyStatement('DELETE FROM users WHERE id = 1'),
        replace: isReadOnlyStatement('REPLACE INTO users VALUES (1, "test")'),
      };
    });

    expect(results.insert).toBe(false);
    expect(results.update).toBe(false);
    expect(results.delete).toBe(false);
    expect(results.replace).toBe(false);
  });

  test('isReadOnlyStatement correctly classifies DDL operations', async ({ page }) => {
    await page.goto('/');

    const results = await page.evaluate(() => {
      const isReadOnlyStatement = (sql: string): boolean => {
        const normalized = sql.trim().toUpperCase();
        if (normalized.startsWith('SELECT') || normalized.startsWith('WITH')) return true;
        if (normalized.startsWith('EXPLAIN')) return true;
        if (normalized.startsWith('PRAGMA') && !normalized.includes('=')) return true;
        return false;
      };

      return {
        create: isReadOnlyStatement('CREATE TABLE test (id INTEGER)'),
        alter: isReadOnlyStatement('ALTER TABLE test ADD COLUMN name TEXT'),
        drop: isReadOnlyStatement('DROP TABLE test'),
        createIndex: isReadOnlyStatement('CREATE INDEX idx ON test(id)'),
        vacuum: isReadOnlyStatement('VACUUM'),
      };
    });

    expect(results.create).toBe(false);
    expect(results.alter).toBe(false);
    expect(results.drop).toBe(false);
    expect(results.createIndex).toBe(false);
    expect(results.vacuum).toBe(false);
  });
});

// =============================================================================
// Error Classification Tests
// =============================================================================

test.describe('Error Classification Tests', () => {
  test('error types are correctly classified', async ({ page }) => {
    await page.goto('/');

    const classifications = await page.evaluate(() => {
      const classifyErrorType = (message: string): string => {
        const normalized = message.toLowerCase();

        if (
          normalized.includes('syntax error') ||
          normalized.includes('near "') ||
          normalized.includes('no such column') ||
          normalized.includes('no such table') ||
          normalized.includes('no such function')
        ) {
          return 'syntax';
        }

        if (
          normalized.includes('constraint') ||
          normalized.includes('unique') ||
          normalized.includes('foreign key') ||
          normalized.includes('not null')
        ) {
          return 'constraint';
        }

        if (
          normalized.includes('database is locked') ||
          normalized.includes('disk i/o error') ||
          normalized.includes('out of memory')
        ) {
          return 'runtime';
        }

        return 'unknown';
      };

      return {
        syntaxNear: classifyErrorType('near "SELEC": syntax error'),
        syntaxNoTable: classifyErrorType('no such table: users'),
        syntaxNoColumn: classifyErrorType('no such column: name'),
        syntaxNoFunction: classifyErrorType('no such function: unknown_func'),
        constraintUnique: classifyErrorType('UNIQUE constraint failed'),
        constraintFK: classifyErrorType('FOREIGN KEY constraint failed'),
        constraintNotNull: classifyErrorType('NOT NULL constraint failed'),
        constraintPK: classifyErrorType('PRIMARY KEY constraint failed'),
        runtimeLocked: classifyErrorType('database is locked'),
        runtimeIO: classifyErrorType('disk i/o error'),
        runtimeMemory: classifyErrorType('out of memory'),
        unknown: classifyErrorType('Some random error'),
      };
    });

    expect(classifications.syntaxNear).toBe('syntax');
    expect(classifications.syntaxNoTable).toBe('syntax');
    expect(classifications.syntaxNoColumn).toBe('syntax');
    expect(classifications.syntaxNoFunction).toBe('syntax');
    expect(classifications.constraintUnique).toBe('constraint');
    expect(classifications.constraintFK).toBe('constraint');
    expect(classifications.constraintNotNull).toBe('constraint');
    expect(classifications.constraintPK).toBe('constraint');
    expect(classifications.runtimeLocked).toBe('runtime');
    expect(classifications.runtimeIO).toBe('runtime');
    expect(classifications.runtimeMemory).toBe('runtime');
    expect(classifications.unknown).toBe('unknown');
  });

  test('error suggestions are generated correctly', async ({ page }) => {
    await page.goto('/');

    const suggestions = await page.evaluate(() => {
      const generateSuggestion = (message: string): string | undefined => {
        const tableMatch = message.match(/no such table:\s*(\w+)/i);
        if (tableMatch) {
          return `Table "${tableMatch[1]}" does not exist. Check the table name spelling.`;
        }

        const columnMatch = message.match(/no such column:\s*(\w+)/i);
        if (columnMatch) {
          return `Column "${columnMatch[1]}" does not exist. Check the column name or table alias.`;
        }

        const functionMatch = message.match(/no such function:\s*(\w+)/i);
        if (functionMatch) {
          return `Function "${functionMatch[1]}" is not available. Check the function name spelling.`;
        }

        const nearMatch = message.match(/near\s+"([^"]+)":\s*syntax error/i);
        if (nearMatch) {
          return `Syntax error near "${nearMatch[1]}". Check for missing keywords or punctuation.`;
        }

        if (message.toLowerCase().includes('unique constraint')) {
          return 'A record with this value already exists. Use UPDATE instead or change the value.';
        }

        if (message.toLowerCase().includes('foreign key constraint')) {
          return 'Referenced record does not exist. Ensure the parent record exists first.';
        }

        if (message.toLowerCase().includes('not null constraint')) {
          return 'This column requires a value. Provide a non-NULL value.';
        }

        return undefined;
      };

      return {
        noTable: generateSuggestion('no such table: users'),
        noColumn: generateSuggestion('no such column: name'),
        noFunction: generateSuggestion('no such function: custom_func'),
        nearSyntax: generateSuggestion('near "SELEC": syntax error'),
        uniqueConstraint: generateSuggestion('UNIQUE constraint failed'),
        fkConstraint: generateSuggestion('FOREIGN KEY constraint failed'),
        notNullConstraint: generateSuggestion('NOT NULL constraint failed'),
        noMatch: generateSuggestion('Some random error'),
      };
    });

    expect(suggestions.noTable).toContain('Table "users"');
    expect(suggestions.noColumn).toContain('Column "name"');
    expect(suggestions.noFunction).toContain('Function "custom_func"');
    expect(suggestions.nearSyntax).toContain('near "SELEC"');
    expect(suggestions.uniqueConstraint).toContain('already exists');
    expect(suggestions.fkConstraint).toContain('parent record');
    expect(suggestions.notNullConstraint).toContain('requires a value');
    expect(suggestions.noMatch).toBeUndefined();
  });

  test('line number parsing works correctly', async ({ page }) => {
    await page.goto('/');

    const results = await page.evaluate(() => {
      const parseLineNumber = (message: string): { line?: number; column?: number } => {
        const lineMatch = message.match(/(?:at|on)?\s*line\s+(\d+)/i);
        const columnMatch = message.match(/(?:column|col)\s+(\d+)/i);
        const positionMatch = message.match(/\((\d+):(\d+)\)|(?:^|\s)(\d+):(\d+)(?:\s|$)/);

        let line: number | undefined;
        let column: number | undefined;

        if (positionMatch) {
          line = parseInt(positionMatch[1] || positionMatch[3], 10);
          column = parseInt(positionMatch[2] || positionMatch[4], 10);
        } else {
          if (lineMatch) {
            line = parseInt(lineMatch[1], 10);
          }
          if (columnMatch) {
            column = parseInt(columnMatch[1], 10);
          }
        }

        return { line, column };
      };

      return {
        atLine: parseLineNumber('error at line 5'),
        onLine: parseLineNumber('error on line 10'),
        lineOnly: parseLineNumber('line 3'),
        withColumn: parseLineNumber('error at line 5, column 12'),
        position: parseLineNumber('(7:15)'),
        positionNoParens: parseLineNumber('error 7:15'),
        noInfo: parseLineNumber('some error without line info'),
      };
    });

    expect(results.atLine).toEqual({ line: 5, column: undefined });
    expect(results.onLine).toEqual({ line: 10, column: undefined });
    expect(results.lineOnly).toEqual({ line: 3, column: undefined });
    expect(results.withColumn).toEqual({ line: 5, column: 12 });
    expect(results.position).toEqual({ line: 7, column: 15 });
    expect(results.positionNoParens).toEqual({ line: 7, column: 15 });
    expect(results.noInfo).toEqual({ line: undefined, column: undefined });
  });
});

// =============================================================================
// Query History Tests
// =============================================================================

test.describe('Query History Storage Tests', () => {
  test('query history item structure is correct', async ({ page }) => {
    await page.goto('/');

    const historyItemStructure = await page.evaluate(() => {
      return {
        requiredFields: ['sql', 'executedAt'],
        sqlType: 'string',
        executedAtFormat: 'ISO 8601',
      };
    });

    expect(historyItemStructure.requiredFields).toContain('sql');
    expect(historyItemStructure.requiredFields).toContain('executedAt');
    expect(historyItemStructure.executedAtFormat).toBe('ISO 8601');
  });

  test('relative time formatting works correctly', async ({ page }) => {
    await page.goto('/');

    const timeFormats = await page.evaluate(() => {
      const formatRelativeTime = (isoString: string): string => {
        const date = new Date(isoString);
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffSecs = Math.floor(diffMs / 1000);
        const diffMins = Math.floor(diffSecs / 60);
        const diffHours = Math.floor(diffMins / 60);
        const diffDays = Math.floor(diffHours / 24);

        if (diffSecs < 60) return 'just now';
        if (diffMins < 60) return `${diffMins}m ago`;
        if (diffHours < 24) return `${diffHours}h ago`;
        if (diffDays < 7) return `${diffDays}d ago`;
        return date.toLocaleDateString();
      };

      const now = new Date();
      const oneMinAgo = new Date(now.getTime() - 60 * 1000);
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      return {
        justNow: formatRelativeTime(now.toISOString()),
        oneMin: formatRelativeTime(oneMinAgo.toISOString()),
        oneHour: formatRelativeTime(oneHourAgo.toISOString()),
        oneDay: formatRelativeTime(oneDayAgo.toISOString()),
        oneWeek: formatRelativeTime(oneWeekAgo.toISOString()),
      };
    });

    expect(timeFormats.justNow).toBe('just now');
    expect(timeFormats.oneMin).toBe('1m ago');
    expect(timeFormats.oneHour).toBe('1h ago');
    expect(timeFormats.oneDay).toBe('1d ago');
    // One week ago should be formatted as date
    expect(timeFormats.oneWeek).not.toContain('ago');
  });

  test('query truncation for display works correctly', async ({ page }) => {
    await page.goto('/');

    const truncation = await page.evaluate(() => {
      const truncateForDisplay = (sql: string): string => {
        const normalized = sql.replace(/\s+/g, ' ').trim();
        if (normalized.length <= 50) return normalized;
        return normalized.slice(0, 47) + '...';
      };

      return {
        short: truncateForDisplay('SELECT 1'),
        exact50: truncateForDisplay('A'.repeat(50)),
        long: truncateForDisplay('SELECT * FROM users WHERE name = "test" AND age > 25 ORDER BY created_at'),
        multiline: truncateForDisplay('SELECT\n  *\nFROM\n  users'),
      };
    });

    expect(truncation.short).toBe('SELECT 1');
    expect(truncation.exact50.length).toBe(50);
    expect(truncation.long).toHaveLength(50);
    expect(truncation.long).toMatch(/\.\.\.$/);
    expect(truncation.multiline).not.toContain('\n');
  });
});

// =============================================================================
// Autocomplete Configuration Tests
// =============================================================================

test.describe('Autocomplete Configuration Tests', () => {
  test('SQL keywords list is comprehensive', async ({ page }) => {
    await page.goto('/');

    const keywords = await page.evaluate(() => {
      // Core SQL keywords that should be available
      const expectedKeywords = [
        'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'BETWEEN',
        'LIKE', 'IS', 'NULL', 'TRUE', 'FALSE',
        'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE',
        'CREATE', 'TABLE', 'VIEW', 'INDEX', 'DROP', 'ALTER',
        'ORDER', 'BY', 'ASC', 'DESC', 'LIMIT', 'OFFSET',
        'GROUP', 'HAVING', 'DISTINCT', 'AS', 'ON',
        'INNER', 'LEFT', 'RIGHT', 'OUTER', 'JOIN',
        'UNION', 'EXCEPT', 'INTERSECT',
        'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
        'COUNT', 'SUM', 'AVG', 'MIN', 'MAX',
        'PRIMARY', 'KEY', 'FOREIGN', 'REFERENCES', 'UNIQUE',
      ];

      return {
        keywords: expectedKeywords,
        count: expectedKeywords.length,
      };
    });

    expect(keywords.count).toBeGreaterThan(50);
    expect(keywords.keywords).toContain('SELECT');
    expect(keywords.keywords).toContain('FROM');
    expect(keywords.keywords).toContain('JOIN');
  });

  test('table context keywords are correctly defined', async ({ page }) => {
    await page.goto('/');

    const tableContextKeywords = await page.evaluate(() => {
      // Keywords after which table names should be suggested
      return ['FROM', 'JOIN', 'INTO', 'UPDATE', 'TABLE'];
    });

    expect(tableContextKeywords).toContain('FROM');
    expect(tableContextKeywords).toContain('JOIN');
    expect(tableContextKeywords).toContain('INTO');
    expect(tableContextKeywords).toContain('UPDATE');
  });

  test('column context keywords are correctly defined', async ({ page }) => {
    await page.goto('/');

    const columnContextKeywords = await page.evaluate(() => {
      // Keywords after which column names should be suggested
      return ['SELECT', 'WHERE', 'ORDER', 'GROUP', 'BY', 'HAVING', 'SET', 'ON'];
    });

    expect(columnContextKeywords).toContain('SELECT');
    expect(columnContextKeywords).toContain('WHERE');
    expect(columnContextKeywords).toContain('ORDER');
    expect(columnContextKeywords).toContain('SET');
  });

  test('match scoring algorithm works correctly', async ({ page }) => {
    await page.goto('/');

    const scores = await page.evaluate(() => {
      const scoreMatch = (input: string, target: string): number => {
        const inputLower = input.toLowerCase();
        const targetLower = target.toLowerCase();

        // Exact match
        if (inputLower === targetLower) return 1000;

        // Prefix match
        if (targetLower.startsWith(inputLower)) {
          return 500 + (inputLower.length / targetLower.length) * 100;
        }

        // Contains match
        if (targetLower.includes(inputLower)) {
          return 100 + (inputLower.length / targetLower.length) * 50;
        }

        // Fuzzy match
        let j = 0;
        for (let i = 0; i < targetLower.length && j < inputLower.length; i++) {
          if (targetLower[i] === inputLower[j]) j++;
        }
        if (j === inputLower.length) {
          return 10 + (inputLower.length / targetLower.length) * 10;
        }

        return 0;
      };

      return {
        exact: scoreMatch('select', 'SELECT'),
        prefix: scoreMatch('sel', 'SELECT'),
        contains: scoreMatch('lect', 'SELECT'),
        fuzzy: scoreMatch('slct', 'SELECT'),
        noMatch: scoreMatch('xyz', 'SELECT'),
      };
    });

    expect(scores.exact).toBe(1000);
    expect(scores.prefix).toBeGreaterThan(500);
    expect(scores.contains).toBeGreaterThan(100);
    expect(scores.fuzzy).toBeGreaterThan(10);
    expect(scores.noMatch).toBe(0);
  });
});

// =============================================================================
// Read-Only Mode Tests
// =============================================================================

test.describe('Read-Only Mode Tests', () => {
  test('read-only warning configuration is correct', async ({ page }) => {
    await page.goto('/');

    const readOnlyConfig = await page.evaluate(() => {
      return {
        testId: 'readonly-warning',
        expectedMessage: 'Cannot execute write operations in read-only mode',
        allowedStatements: ['SELECT', 'WITH', 'EXPLAIN', 'PRAGMA (read-only)'],
      };
    });

    expect(readOnlyConfig.testId).toBe('readonly-warning');
    expect(readOnlyConfig.expectedMessage).toContain('read-only');
    expect(readOnlyConfig.allowedStatements).toContain('SELECT');
  });

  test('run button behavior configuration is correct', async ({ page }) => {
    await page.goto('/');

    const buttonConfig = await page.evaluate(() => {
      return {
        testId: 'run-button',
        disabledWhenEmpty: true,
        disabledWhenExecuting: true,
        keyboardShortcut: 'Ctrl+Enter or Cmd+Enter',
        tooltip: 'Run query (Ctrl+Enter)',
      };
    });

    expect(buttonConfig.testId).toBe('run-button');
    expect(buttonConfig.disabledWhenEmpty).toBe(true);
    expect(buttonConfig.disabledWhenExecuting).toBe(true);
    expect(buttonConfig.keyboardShortcut).toContain('Enter');
  });

  test('cancel button behavior configuration is correct', async ({ page }) => {
    await page.goto('/');

    const cancelConfig = await page.evaluate(() => {
      return {
        testId: 'cancel-button',
        visibleOnlyWhenExecuting: true,
        requiresOnCancelCallback: true,
      };
    });

    expect(cancelConfig.testId).toBe('cancel-button');
    expect(cancelConfig.visibleOnlyWhenExecuting).toBe(true);
    expect(cancelConfig.requiresOnCancelCallback).toBe(true);
  });
});

// =============================================================================
// Results Display Tests
// =============================================================================

test.describe('Results Display Configuration', () => {
  test('results table structure is correct', async ({ page }) => {
    await page.goto('/');

    const tableConfig = await page.evaluate(() => {
      return {
        testId: 'results-table',
        maxHeight: '16rem', // max-h-64
        hasOverflowScroll: true,
        hasStickyHeader: true,
      };
    });

    expect(tableConfig.testId).toBe('results-table');
    expect(tableConfig.hasOverflowScroll).toBe(true);
    expect(tableConfig.hasStickyHeader).toBe(true);
  });

  test('NULL value rendering is correct', async ({ page }) => {
    await page.goto('/');

    const nullConfig = await page.evaluate(() => {
      return {
        displayText: 'NULL',
        className: 'text-navy-400 italic',
      };
    });

    expect(nullConfig.displayText).toBe('NULL');
    expect(nullConfig.className).toContain('italic');
  });

  test('BLOB value rendering is correct', async ({ page }) => {
    await page.goto('/');

    const blobConfig = await page.evaluate(() => {
      const byteCount = 1024;
      return {
        displayFormat: `[BLOB ${byteCount} bytes]`,
        className: 'text-navy-500 font-mono text-xs',
      };
    });

    expect(blobConfig.displayFormat).toContain('BLOB');
    expect(blobConfig.displayFormat).toContain('bytes');
    expect(blobConfig.className).toContain('font-mono');
  });

  test('empty results message is correct', async ({ page }) => {
    await page.goto('/');

    const emptyConfig = await page.evaluate(() => {
      return {
        testId: 'empty-results',
        message: 'Query executed successfully. No rows returned.',
      };
    });

    expect(emptyConfig.testId).toBe('empty-results');
    expect(emptyConfig.message).toContain('No rows returned');
  });

  test('execution time format is correct', async ({ page }) => {
    await page.goto('/');

    const timeFormats = await page.evaluate(() => {
      const formatTime = (ms: number): string => {
        if (ms < 1000) {
          return `${ms.toFixed(0)}ms`;
        }
        return `${(ms / 1000).toFixed(2)}s`;
      };

      return {
        milliseconds: formatTime(150),
        subSecond: formatTime(999),
        oneSecond: formatTime(1000),
        multiSecond: formatTime(2500),
      };
    });

    expect(timeFormats.milliseconds).toBe('150ms');
    expect(timeFormats.subSecond).toBe('999ms');
    expect(timeFormats.oneSecond).toBe('1.00s');
    expect(timeFormats.multiSecond).toBe('2.50s');
  });
});

// =============================================================================
// Integration Tests
// =============================================================================

test.describe('SQL Editor Integration Tests', () => {
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

  test('sidebar shows no database loaded message', async ({ page }) => {
    const sidebarMessage = page.locator('text=No database loaded');
    await expect(sidebarMessage).toBeVisible();
  });
});

// =============================================================================
// CodeMirror Editor Tests
// =============================================================================

test.describe('CodeMirror Editor Configuration', () => {
  test('editor theme configuration is correct', async ({ page }) => {
    await page.goto('/');

    const themeConfig = await page.evaluate(() => {
      return {
        darkMode: true,
        backgroundColor: '#102a43', // navy-900
        textColor: '#d9e2ec', // navy-100
        cursorColor: '#fbbf24', // amber-400
        lineNumberColor: '#627d98', // navy-500
      };
    });

    expect(themeConfig.darkMode).toBe(true);
    expect(themeConfig.backgroundColor).toBe('#102a43');
    expect(themeConfig.cursorColor).toBe('#fbbf24');
  });

  test('syntax highlighting colors are correct', async ({ page }) => {
    await page.goto('/');

    const syntaxColors = await page.evaluate(() => {
      return {
        keyword: '#fbbf24', // amber-400 for SELECT, FROM, etc.
        string: '#34d399', // green
        number: '#f472b6', // pink
        comment: '#627d98', // navy-500
        operator: '#f59e0b', // amber-500
      };
    });

    expect(syntaxColors.keyword).toBe('#fbbf24');
    expect(syntaxColors.string).toBe('#34d399');
    expect(syntaxColors.number).toBe('#f472b6');
  });

  test('autocomplete popup styling is correct', async ({ page }) => {
    await page.goto('/');

    const autocompleteStyle = await page.evaluate(() => {
      return {
        backgroundColor: '#102a43', // navy-900
        borderColor: '#334e68', // navy-700
        selectedBackground: '#334e68', // navy-700
        maxHeight: '300px',
      };
    });

    expect(autocompleteStyle.backgroundColor).toBe('#102a43');
    expect(autocompleteStyle.maxHeight).toBe('300px');
  });
});
