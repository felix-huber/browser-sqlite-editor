/**
 * Unit tests for multi-statement SQL execution
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { QueryResult } from '../../types';
import type { DatabaseEngine, ExecResult } from '../db-engine';
import {
  splitStatements,
  inferStatementType,
  isTransactionControl,
  executeMultiStatement,
  executeAndCollectResults,
  generateSummary,
  type MultiExecResult,
  type MultiExecError,
} from '../multi-exec';

// =============================================================================
// Statement Splitting Tests
// =============================================================================

describe('splitStatements', () => {
  it('splits simple semicolon-separated statements', () => {
    const sql = 'SELECT 1; SELECT 2; SELECT 3';
    expect(splitStatements(sql)).toEqual(['SELECT 1', 'SELECT 2', 'SELECT 3']);
  });

  it('handles statement without trailing semicolon', () => {
    const sql = 'SELECT 1; SELECT 2';
    expect(splitStatements(sql)).toEqual(['SELECT 1', 'SELECT 2']);
  });

  it('handles single statement', () => {
    expect(splitStatements('SELECT 1')).toEqual(['SELECT 1']);
    expect(splitStatements('SELECT 1;')).toEqual(['SELECT 1']);
  });

  it('handles empty input', () => {
    expect(splitStatements('')).toEqual([]);
    expect(splitStatements('   ')).toEqual([]);
    expect(splitStatements(';;')).toEqual([]);
  });

  it('preserves semicolons in single-quoted strings', () => {
    const sql = "SELECT ';' as x; SELECT 2";
    expect(splitStatements(sql)).toEqual(["SELECT ';' as x", 'SELECT 2']);
  });

  it('preserves semicolons in double-quoted identifiers', () => {
    const sql = 'SELECT "col;name" FROM t; SELECT 2';
    expect(splitStatements(sql)).toEqual(['SELECT "col;name" FROM t', 'SELECT 2']);
  });

  it('preserves semicolons in backtick-quoted identifiers', () => {
    const sql = 'SELECT `col;name` FROM t; SELECT 2';
    expect(splitStatements(sql)).toEqual(['SELECT `col;name` FROM t', 'SELECT 2']);
  });

  it('handles escaped single quotes', () => {
    const sql = "SELECT 'it''s; tricky'; SELECT 2";
    expect(splitStatements(sql)).toEqual(["SELECT 'it''s; tricky'", 'SELECT 2']);
  });

  it('handles escaped double quotes', () => {
    const sql = 'SELECT "col""name;here" FROM t; SELECT 2';
    expect(splitStatements(sql)).toEqual([
      'SELECT "col""name;here" FROM t',
      'SELECT 2',
    ]);
  });

  it('ignores semicolons in line comments', () => {
    const sql = `SELECT 1; -- comment; ignored
SELECT 2`;
    expect(splitStatements(sql)).toEqual(['SELECT 1', 'SELECT 2']);
  });

  it('ignores semicolons in block comments', () => {
    const sql = 'SELECT 1; /* comment; ignored */ SELECT 2';
    expect(splitStatements(sql)).toEqual(['SELECT 1', 'SELECT 2']);
  });

  it('handles multi-line block comments', () => {
    const sql = `SELECT 1; /*
    comment with; semicolons
    */ SELECT 2`;
    expect(splitStatements(sql)).toEqual(['SELECT 1', 'SELECT 2']);
  });

  it('handles comments and empty statements gracefully', () => {
    const sql = `
-- This is a comment
SELECT 1;
-- Another comment
; ; ;
SELECT 2;
`;
    expect(splitStatements(sql)).toEqual(['SELECT 1', 'SELECT 2']);
  });

  it('handles complex CREATE TABLE with constraints', () => {
    const sql = `
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL
);
INSERT INTO users VALUES (1, 'John');
SELECT * FROM users;
`;
    const statements = splitStatements(sql);
    expect(statements).toHaveLength(3);
    expect(statements[0]).toContain('CREATE TABLE users');
    expect(statements[1]).toBe("INSERT INTO users VALUES (1, 'John')");
    expect(statements[2]).toBe('SELECT * FROM users');
  });
});

// =============================================================================
// Statement Type Inference Tests
// =============================================================================

describe('inferStatementType', () => {
  it('identifies SELECT statements', () => {
    expect(inferStatementType('SELECT * FROM t')).toBe('SELECT');
    expect(inferStatementType('  select * from t')).toBe('SELECT');
    expect(inferStatementType('SELECT 1+1')).toBe('SELECT');
  });

  it('identifies WITH (CTE) as SELECT', () => {
    expect(inferStatementType('WITH cte AS (SELECT 1) SELECT * FROM cte')).toBe(
      'SELECT',
    );
  });

  it('identifies INSERT statements', () => {
    expect(inferStatementType('INSERT INTO t VALUES (1)')).toBe('INSERT');
    expect(inferStatementType('  insert into t values (1)')).toBe('INSERT');
  });

  it('identifies UPDATE statements', () => {
    expect(inferStatementType('UPDATE t SET x = 1')).toBe('UPDATE');
    expect(inferStatementType('  update t set x = 1')).toBe('UPDATE');
  });

  it('identifies DELETE statements', () => {
    expect(inferStatementType('DELETE FROM t WHERE x = 1')).toBe('DELETE');
    expect(inferStatementType('  delete from t')).toBe('DELETE');
  });

  it('identifies DDL statements', () => {
    expect(inferStatementType('CREATE TABLE t (id INT)')).toBe('DDL');
    expect(inferStatementType('DROP TABLE t')).toBe('DDL');
    expect(inferStatementType('ALTER TABLE t ADD col INT')).toBe('DDL');
    expect(inferStatementType('VACUUM')).toBe('DDL');
    expect(inferStatementType('REINDEX')).toBe('DDL');
    expect(inferStatementType('ANALYZE')).toBe('DDL');
  });

  it('identifies OTHER for unknown statements', () => {
    expect(inferStatementType('PRAGMA table_info(t)')).toBe('OTHER');
    expect(inferStatementType('EXPLAIN SELECT 1')).toBe('OTHER');
  });

  it('handles leading comments', () => {
    expect(inferStatementType('-- comment\nSELECT 1')).toBe('SELECT');
  });
});

// =============================================================================
// Transaction Control Detection Tests
// =============================================================================

describe('isTransactionControl', () => {
  it('detects BEGIN', () => {
    expect(isTransactionControl('BEGIN')).toBe(true);
    expect(isTransactionControl('BEGIN TRANSACTION')).toBe(true);
    expect(isTransactionControl('  begin  ')).toBe(true);
  });

  it('detects COMMIT', () => {
    expect(isTransactionControl('COMMIT')).toBe(true);
    expect(isTransactionControl('COMMIT TRANSACTION')).toBe(true);
  });

  it('detects ROLLBACK', () => {
    expect(isTransactionControl('ROLLBACK')).toBe(true);
    expect(isTransactionControl('ROLLBACK TRANSACTION')).toBe(true);
    expect(isTransactionControl('ROLLBACK TO savepoint1')).toBe(true);
  });

  it('detects SAVEPOINT', () => {
    expect(isTransactionControl('SAVEPOINT sp1')).toBe(true);
  });

  it('detects RELEASE', () => {
    expect(isTransactionControl('RELEASE sp1')).toBe(true);
    expect(isTransactionControl('RELEASE SAVEPOINT sp1')).toBe(true);
  });

  it('returns false for non-transaction statements', () => {
    expect(isTransactionControl('SELECT 1')).toBe(false);
    expect(isTransactionControl('INSERT INTO t VALUES (1)')).toBe(false);
    expect(isTransactionControl('CREATE TABLE t (id INT)')).toBe(false);
  });
});

// =============================================================================
// Multi-Statement Execution Tests (Mocked Engine)
// =============================================================================

describe('executeMultiStatement', () => {
  let mockEngine: DatabaseEngine;
  let execCalls: string[];
  let queryCalls: string[];

  beforeEach(() => {
    execCalls = [];
    queryCalls = [];

    const mockQueryResult: QueryResult = {
      columns: ['result'],
      columnTypes: ['INTEGER'],
      rows: [[42]],
      rowsAffected: 0,
    };

    const mockExecResult: ExecResult = {
      rowsAffected: 1,
      lastInsertId: 100,
    };

    mockEngine = {
      exec: vi.fn().mockImplementation((sql: string) => {
        execCalls.push(sql);
        return Promise.resolve(mockExecResult);
      }),
      query: vi.fn().mockImplementation((sql: string) => {
        queryCalls.push(sql);
        return Promise.resolve(mockQueryResult);
      }),
    } as unknown as DatabaseEngine;
  });

  it('returns empty result for empty input', async () => {
    const result = await executeMultiStatement(mockEngine, '');
    expect(result.statements).toEqual([]);
    expect(result.totalRowsAffected).toBe(0);
    expect(result.success).toBe(true);
  });

  it('executes single SELECT and returns result', async () => {
    const result = await executeMultiStatement(mockEngine, 'SELECT 1');

    expect(result.statements).toHaveLength(1);
    expect(result.statements[0].type).toBe('SELECT');
    expect(result.statements[0].queryResult).toBeDefined();
    expect(result.success).toBe(true);

    // Should wrap in implicit transaction
    expect(execCalls).toContain('BEGIN');
    expect(execCalls).toContain('COMMIT');
  });

  it('executes multi-statement (CREATE + INSERT + SELECT) with transaction', async () => {
    const sql = `
      CREATE TABLE t (id INT);
      INSERT INTO t VALUES (1);
      SELECT * FROM t
    `;

    const result = await executeMultiStatement(mockEngine, sql);

    expect(result.statements).toHaveLength(3);
    expect(result.statements[0].type).toBe('DDL');
    expect(result.statements[1].type).toBe('INSERT');
    expect(result.statements[2].type).toBe('SELECT');
    expect(result.success).toBe(true);

    // Transaction control
    expect(execCalls[0]).toBe('BEGIN');
    expect(execCalls[execCalls.length - 1]).toBe('COMMIT');
  });

  it('rolls back entire batch on mid-error', async () => {
    // Make the second exec fail
    let callCount = 0;
    mockEngine.exec = vi.fn().mockImplementation((sql: string) => {
      execCalls.push(sql);
      callCount++;
      if (callCount === 3) {
        // Third call is INSERT (after BEGIN and CREATE)
        return Promise.reject(new Error('constraint violation'));
      }
      return Promise.resolve({ rowsAffected: 1, lastInsertId: 0 });
    });

    const sql = 'CREATE TABLE t (id INT); INSERT INTO t VALUES (1); SELECT * FROM t';

    let error: MultiExecError | null = null;
    try {
      await executeMultiStatement(mockEngine, sql);
    } catch (err) {
      error = err as MultiExecError;
    }

    expect(error).not.toBeNull();
    expect(error!.statementIndex).toBe(1); // INSERT failed
    expect(error!.message).toContain('Statement 2 failed');
    expect(error!.originalMessage).toContain('constraint violation');

    // Should have attempted rollback
    expect(execCalls).toContain('ROLLBACK');
  });

  it('handles DDL then DML in transaction', async () => {
    const sql = 'CREATE TABLE t (id INT); INSERT INTO t VALUES (1)';

    const result = await executeMultiStatement(mockEngine, sql);

    expect(result.statements).toHaveLength(2);
    expect(result.statements[0].type).toBe('DDL');
    expect(result.statements[1].type).toBe('INSERT');
    expect(result.totalRowsAffected).toBe(1); // Only INSERT counts

    // Both in same transaction
    expect(execCalls[0]).toBe('BEGIN');
    expect(execCalls).toContain('COMMIT');
  });

  it('skips implicit transaction when user manages their own', async () => {
    const sql = 'BEGIN; INSERT INTO t VALUES (1); COMMIT';

    await executeMultiStatement(mockEngine, sql);

    // Should not add extra BEGIN/COMMIT
    expect(execCalls.filter((c) => c === 'BEGIN')).toHaveLength(1);
    expect(execCalls.filter((c) => c === 'COMMIT')).toHaveLength(1);
  });

  it('tracks affected rows for DML statements', async () => {
    mockEngine.exec = vi.fn().mockImplementation((sql: string) => {
      execCalls.push(sql);
      const normalized = sql.toUpperCase();
      if (normalized.startsWith('INSERT')) {
        return Promise.resolve({ rowsAffected: 3, lastInsertId: 5 });
      }
      if (normalized.startsWith('UPDATE')) {
        return Promise.resolve({ rowsAffected: 2, lastInsertId: 0 });
      }
      if (normalized.startsWith('DELETE')) {
        return Promise.resolve({ rowsAffected: 1, lastInsertId: 0 });
      }
      return Promise.resolve({ rowsAffected: 0, lastInsertId: 0 });
    });

    const sql = 'INSERT INTO t VALUES (1); UPDATE t SET x = 2; DELETE FROM t WHERE 1=0';

    const result = await executeMultiStatement(mockEngine, sql);

    expect(result.totalRowsAffected).toBe(6); // 3 + 2 + 1
    expect(result.statements[0].rowsAffected).toBe(3);
    expect(result.statements[0].lastInsertId).toBe(5);
    expect(result.statements[1].rowsAffected).toBe(2);
    expect(result.statements[2].rowsAffected).toBe(1);
  });
});

// =============================================================================
// executeAndCollectResults Tests
// =============================================================================

describe('executeAndCollectResults', () => {
  let mockEngine: DatabaseEngine;

  beforeEach(() => {
    const mockResults: QueryResult[] = [
      { columns: ['a'], columnTypes: ['INT'], rows: [[1]] },
      { columns: ['b'], columnTypes: ['INT'], rows: [[2]] },
    ];
    let selectIndex = 0;

    mockEngine = {
      exec: vi.fn().mockResolvedValue({ rowsAffected: 1, lastInsertId: 0 }),
      query: vi.fn().mockImplementation(() => {
        return Promise.resolve(mockResults[selectIndex++] || mockResults[0]);
      }),
    } as unknown as DatabaseEngine;
  });

  it('returns only SELECT results', async () => {
    const sql = 'INSERT INTO t VALUES (1); SELECT a FROM t; UPDATE t SET x = 2; SELECT b FROM t';

    const results = await executeAndCollectResults(mockEngine, sql);

    expect(results).toHaveLength(2);
    expect(results[0].columns).toEqual(['a']);
    expect(results[1].columns).toEqual(['b']);
  });

  it('returns empty array when no SELECTs', async () => {
    const sql = 'INSERT INTO t VALUES (1); UPDATE t SET x = 2';

    const results = await executeAndCollectResults(mockEngine, sql);

    expect(results).toEqual([]);
  });
});

// =============================================================================
// Summary Generation Tests
// =============================================================================

describe('generateSummary', () => {
  it('generates summary for mixed statements', () => {
    const result: MultiExecResult = {
      statements: [
        { sql: 'SELECT 1', index: 0, type: 'SELECT' },
        { sql: 'INSERT INTO t VALUES (1)', index: 1, type: 'INSERT', rowsAffected: 3 },
        { sql: 'UPDATE t SET x = 2', index: 2, type: 'UPDATE', rowsAffected: 2 },
        { sql: 'DELETE FROM t', index: 3, type: 'DELETE', rowsAffected: 1 },
      ],
      totalRowsAffected: 6,
      success: true,
    };

    const summary = generateSummary(result);
    expect(summary).toBe('1 SELECT, 1 INSERT, 1 UPDATE, 1 DELETE; 6 row(s) affected');
  });

  it('generates summary for SELECT only', () => {
    const result: MultiExecResult = {
      statements: [{ sql: 'SELECT 1', index: 0, type: 'SELECT' }],
      totalRowsAffected: 0,
      success: true,
    };

    const summary = generateSummary(result);
    expect(summary).toBe('1 SELECT');
  });

  it('generates summary for DDL', () => {
    const result: MultiExecResult = {
      statements: [
        { sql: 'CREATE TABLE t (id INT)', index: 0, type: 'DDL' },
        { sql: 'DROP TABLE old_t', index: 1, type: 'DDL' },
      ],
      totalRowsAffected: 0,
      success: true,
    };

    const summary = generateSummary(result);
    expect(summary).toBe('2 DDL');
  });

  it('handles empty result', () => {
    const result: MultiExecResult = {
      statements: [],
      totalRowsAffected: 0,
      success: true,
    };

    const summary = generateSummary(result);
    expect(summary).toBe('No statements');
  });
});
