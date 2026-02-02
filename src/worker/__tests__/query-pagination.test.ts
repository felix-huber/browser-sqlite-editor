/**
 * Unit tests for Paginated Query Handler
 *
 * Tests cover:
 * - LIMIT/OFFSET pagination
 * - Stable sorting with rowid and PK
 * - Total count calculation and caching
 * - Generated column detection
 * - Empty table handling
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  wrapQueryWithPagination,
  buildCountQuery,
  calculatePaginationInfo,
  getPageOffset,
  getNextPageOffset,
  getPreviousPageOffset,
  getFirstPageOffset,
  getLastPageOffset,
  invalidateCountCache,
  executePaginatedQuery,
  type PaginatedQueryResult,
  type ColumnMeta,
} from '../query-pagination';
import type { QueryResult } from '../../types';
import type { DatabaseEngine } from '../../core/engine/db-engine';

type QueryHandler = (sql: string, params?: unknown[]) => QueryResult;

function createMockEngine(handler: QueryHandler): DatabaseEngine {
  return {
    query: vi.fn(async (sql: string, params?: unknown[]) => handler(sql, params)),
  } as unknown as DatabaseEngine;
}

// =============================================================================
// Query Wrapping Tests
// =============================================================================

describe('wrapQueryWithPagination', () => {
  it('should add LIMIT and OFFSET to simple query', () => {
    const sql = 'SELECT * FROM users';
    const result = wrapQueryWithPagination(sql, 100, 0, '');

    expect(result).toBe('SELECT * FROM users LIMIT 100 OFFSET 0');
  });

  it('should handle LIMIT 100 OFFSET 0 (first page)', () => {
    const sql = 'SELECT * FROM users';
    const result = wrapQueryWithPagination(sql, 100, 0, 'ORDER BY rowid');

    expect(result).toBe('SELECT * FROM users ORDER BY rowid LIMIT 100 OFFSET 0');
  });

  it('should handle LIMIT 100 OFFSET 200 (third page)', () => {
    const sql = 'SELECT * FROM users';
    const result = wrapQueryWithPagination(sql, 100, 200, 'ORDER BY rowid');

    expect(result).toBe('SELECT * FROM users ORDER BY rowid LIMIT 100 OFFSET 200');
  });

  it('should append stable sort to existing ORDER BY', () => {
    const sql = 'SELECT * FROM users ORDER BY name';
    const result = wrapQueryWithPagination(sql, 100, 0, 'rowid');

    expect(result).toBe('SELECT * FROM users ORDER BY name, rowid LIMIT 100 OFFSET 0');
  });

  it('should add ORDER BY if none exists and stable sort is provided', () => {
    const sql = 'SELECT * FROM users';
    const result = wrapQueryWithPagination(sql, 100, 0, 'ORDER BY rowid');

    expect(result).toBe('SELECT * FROM users ORDER BY rowid LIMIT 100 OFFSET 0');
  });

  it('should not modify query that already has LIMIT', () => {
    const sql = 'SELECT * FROM users LIMIT 50';
    const result = wrapQueryWithPagination(sql, 100, 0, 'ORDER BY rowid');

    expect(result).toBe('SELECT * FROM users LIMIT 50');
  });

  it('should not modify query that already has OFFSET', () => {
    const sql = 'SELECT * FROM users LIMIT 50 OFFSET 10';
    const result = wrapQueryWithPagination(sql, 100, 0, 'ORDER BY rowid');

    expect(result).toBe('SELECT * FROM users LIMIT 50 OFFSET 10');
  });

  it('should strip trailing semicolons', () => {
    const sql = 'SELECT * FROM users;';
    const result = wrapQueryWithPagination(sql, 100, 0, '');

    expect(result).toBe('SELECT * FROM users LIMIT 100 OFFSET 0');
  });

  it('should handle multiple trailing semicolons', () => {
    const sql = 'SELECT * FROM users;;;';
    const result = wrapQueryWithPagination(sql, 100, 0, '');

    expect(result).toBe('SELECT * FROM users LIMIT 100 OFFSET 0');
  });
});

// =============================================================================
// Count Query Tests
// =============================================================================

describe('buildCountQuery', () => {
  it('should wrap simple SELECT in COUNT(*)', () => {
    const sql = 'SELECT * FROM users';
    const result = buildCountQuery(sql);

    expect(result).toBe('SELECT COUNT(*) FROM (SELECT * FROM users)');
  });

  it('should remove ORDER BY clause for performance', () => {
    const sql = 'SELECT * FROM users ORDER BY name';
    const result = buildCountQuery(sql);

    expect(result).toBe('SELECT COUNT(*) FROM (SELECT * FROM users)');
  });

  it('should remove existing LIMIT and OFFSET', () => {
    const sql = 'SELECT * FROM users LIMIT 100 OFFSET 50';
    const result = buildCountQuery(sql);

    expect(result).toBe('SELECT COUNT(*) FROM (SELECT * FROM users)');
  });

  it('should handle complex query with WHERE clause', () => {
    const sql = 'SELECT id, name FROM users WHERE active = 1';
    const result = buildCountQuery(sql);

    expect(result).toBe('SELECT COUNT(*) FROM (SELECT id, name FROM users WHERE active = 1)');
  });

  it('should strip trailing semicolons', () => {
    const sql = 'SELECT * FROM users;';
    const result = buildCountQuery(sql);

    expect(result).toBe('SELECT COUNT(*) FROM (SELECT * FROM users)');
  });
});

// =============================================================================
// Pagination Info Tests
// =============================================================================

describe('calculatePaginationInfo', () => {
  it('should calculate first page correctly', () => {
    const info = calculatePaginationInfo(250, 100, 0);

    expect(info.currentPage).toBe(1);
    expect(info.totalPages).toBe(3);
    expect(info.startRow).toBe(1);
    expect(info.endRow).toBe(100);
    expect(info.hasPrevious).toBe(false);
    expect(info.hasNext).toBe(true);
  });

  it('should calculate middle page correctly', () => {
    const info = calculatePaginationInfo(250, 100, 100);

    expect(info.currentPage).toBe(2);
    expect(info.totalPages).toBe(3);
    expect(info.startRow).toBe(101);
    expect(info.endRow).toBe(200);
    expect(info.hasPrevious).toBe(true);
    expect(info.hasNext).toBe(true);
  });

  it('should calculate last page correctly', () => {
    const info = calculatePaginationInfo(250, 100, 200);

    expect(info.currentPage).toBe(3);
    expect(info.totalPages).toBe(3);
    expect(info.startRow).toBe(201);
    expect(info.endRow).toBe(250);
    expect(info.hasPrevious).toBe(true);
    expect(info.hasNext).toBe(false);
  });

  it('should handle empty table', () => {
    const info = calculatePaginationInfo(0, 100, 0);

    expect(info.currentPage).toBe(1);
    expect(info.totalPages).toBe(1);
    expect(info.startRow).toBe(0);
    expect(info.endRow).toBe(0);
    expect(info.hasPrevious).toBe(false);
    expect(info.hasNext).toBe(false);
  });

  it('should handle single page of results', () => {
    const info = calculatePaginationInfo(50, 100, 0);

    expect(info.currentPage).toBe(1);
    expect(info.totalPages).toBe(1);
    expect(info.startRow).toBe(1);
    expect(info.endRow).toBe(50);
    expect(info.hasPrevious).toBe(false);
    expect(info.hasNext).toBe(false);
  });

  it('should handle exact page boundary', () => {
    const info = calculatePaginationInfo(200, 100, 0);

    expect(info.currentPage).toBe(1);
    expect(info.totalPages).toBe(2);
    expect(info.endRow).toBe(100);
  });
});

// =============================================================================
// Page Offset Helpers Tests
// =============================================================================

describe('getPageOffset', () => {
  it('should calculate offset for page 1', () => {
    expect(getPageOffset(1, 100)).toBe(0);
  });

  it('should calculate offset for page 2', () => {
    expect(getPageOffset(2, 100)).toBe(100);
  });

  it('should calculate offset for page 3', () => {
    expect(getPageOffset(3, 100)).toBe(200);
  });

  it('should handle page 0 as page 1', () => {
    expect(getPageOffset(0, 100)).toBe(0);
  });

  it('should handle negative page as page 1', () => {
    expect(getPageOffset(-1, 100)).toBe(0);
  });
});

describe('getNextPageOffset', () => {
  it('should add limit to current offset', () => {
    expect(getNextPageOffset(0, 100)).toBe(100);
    expect(getNextPageOffset(100, 100)).toBe(200);
    expect(getNextPageOffset(200, 100)).toBe(300);
  });
});

describe('getPreviousPageOffset', () => {
  it('should subtract limit from current offset', () => {
    expect(getPreviousPageOffset(200, 100)).toBe(100);
    expect(getPreviousPageOffset(100, 100)).toBe(0);
  });

  it('should not go below zero', () => {
    expect(getPreviousPageOffset(50, 100)).toBe(0);
    expect(getPreviousPageOffset(0, 100)).toBe(0);
  });
});

describe('getFirstPageOffset', () => {
  it('should always return 0', () => {
    expect(getFirstPageOffset()).toBe(0);
  });
});

describe('getLastPageOffset', () => {
  it('should calculate last page offset', () => {
    expect(getLastPageOffset(250, 100)).toBe(200); // 3 pages, last starts at 200
    expect(getLastPageOffset(200, 100)).toBe(100); // 2 pages, last starts at 100
    expect(getLastPageOffset(100, 100)).toBe(0); // 1 page, last starts at 0
    expect(getLastPageOffset(50, 100)).toBe(0); // 1 page, last starts at 0
  });

  it('should handle empty results', () => {
    expect(getLastPageOffset(0, 100)).toBe(0);
  });
});

// =============================================================================
// Cache Tests
// =============================================================================

describe('invalidateCountCache', () => {
  beforeEach(() => {
    invalidateCountCache();
  });

  afterEach(() => {
    invalidateCountCache();
  });

  it('should not throw when clearing empty cache', () => {
    expect(() => invalidateCountCache()).not.toThrow();
  });

  it('should be callable multiple times', () => {
    invalidateCountCache();
    invalidateCountCache();
    invalidateCountCache();
    expect(true).toBe(true);
  });
});

// =============================================================================
// Type Contract Tests
// =============================================================================

describe('ColumnMeta type contract', () => {
  it('should include isGenerated flag', () => {
    const meta: ColumnMeta = {
      name: 'full_name',
      type: 'TEXT',
      isGenerated: true,
      generatedExpression: "first_name || ' ' || last_name",
    };

    expect(meta.isGenerated).toBe(true);
    expect(meta.generatedExpression).toBe("first_name || ' ' || last_name");
  });

  it('should handle non-generated column', () => {
    const meta: ColumnMeta = {
      name: 'id',
      type: 'INTEGER',
      isGenerated: false,
      generatedExpression: null,
    };

    expect(meta.isGenerated).toBe(false);
    expect(meta.generatedExpression).toBeNull();
  });
});

describe('PaginatedQueryResult type contract', () => {
  it('should include columns, rows, and totalCount', () => {
    const result: PaginatedQueryResult = {
      columns: [
        { name: 'id', type: 'INTEGER', isGenerated: false, generatedExpression: null },
        { name: 'name', type: 'TEXT', isGenerated: false, generatedExpression: null },
      ],
      rows: [
        [1, 'Alice'],
        [2, 'Bob'],
      ],
      totalCount: 100,
    };

    expect(result.columns).toHaveLength(2);
    expect(result.rows).toHaveLength(2);
    expect(result.totalCount).toBe(100);
  });

  it('should handle empty result', () => {
    const result: PaginatedQueryResult = {
      columns: [],
      rows: [],
      totalCount: 0,
    };

    expect(result.columns).toHaveLength(0);
    expect(result.rows).toHaveLength(0);
    expect(result.totalCount).toBe(0);
  });
});

// =============================================================================
// Integration Tests (mock engine)
// =============================================================================

describe('executePaginatedQuery integration', () => {
  const createSql = 'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)';

  beforeEach(() => {
    invalidateCountCache();
  });

  it('executes paginated query with rowid tie-breaker and returns metadata', async () => {
    const engine = createMockEngine((sql) => {
      if (sql.startsWith('SELECT COUNT(*)')) {
        return { columns: ['COUNT(*)'], columnTypes: ['INTEGER'], rows: [[3]] };
      }
      if (sql.startsWith('SELECT sql FROM sqlite_master')) {
        return { columns: ['sql'], columnTypes: ['TEXT'], rows: [[createSql]] };
      }
      if (sql.startsWith('PRAGMA table_xinfo("users")')) {
        return {
          columns: ['cid', 'name', 'type', 'notnull', 'dflt_value', 'pk', 'hidden'],
          columnTypes: ['INTEGER', 'TEXT', 'TEXT', 'INTEGER', 'TEXT', 'INTEGER', 'INTEGER'],
          rows: [
            [0, 'id', 'INTEGER', 0, null, 1, 0],
            [1, 'name', 'TEXT', 0, null, 0, 0],
          ],
        };
      }
      if (sql === 'SELECT * FROM users ORDER BY rowid LIMIT 2 OFFSET 0') {
        return {
          columns: ['id', 'name'],
          columnTypes: ['INTEGER', 'TEXT'],
          rows: [
            [1, 'Alice'],
            [2, 'Bob'],
          ],
        };
      }
      return { columns: [], columnTypes: [], rows: [] };
    });

    const result = await executePaginatedQuery(engine, {
      sql: 'SELECT * FROM users',
      limit: 2,
      offset: 0,
      tableName: 'users',
    });

    expect(result.totalCount).toBe(3);
    expect(result.columns).toEqual([
      { name: 'id', type: 'INTEGER', isGenerated: false, generatedExpression: null },
      { name: 'name', type: 'TEXT', isGenerated: false, generatedExpression: null },
    ]);
    expect(result.rows).toEqual([
      [1, 'Alice'],
      [2, 'Bob'],
    ]);
    expect((engine.query as unknown as { mock: { calls: Array<[string, unknown[] | undefined]> } }).mock.calls).toEqual(
      expect.arrayContaining([['SELECT * FROM users ORDER BY rowid LIMIT 2 OFFSET 0', undefined]]),
    );
  });

  it('uses primary key columns for WITHOUT ROWID tables', async () => {
    const engine = createMockEngine((sql) => {
      if (sql.startsWith('SELECT COUNT(*)')) {
        return { columns: ['COUNT(*)'], columnTypes: ['INTEGER'], rows: [[2]] };
      }
      if (sql.startsWith('SELECT sql FROM sqlite_master')) {
        return {
          columns: ['sql'],
          columnTypes: ['TEXT'],
          rows: [[`CREATE TABLE items (id INTEGER, name TEXT, PRIMARY KEY (id, name)) WITHOUT ROWID`]],
        };
      }
      if (sql.startsWith('PRAGMA table_info("items")')) {
        return {
          columns: ['cid', 'name', 'type', 'notnull', 'dflt_value', 'pk'],
          columnTypes: ['INTEGER', 'TEXT', 'TEXT', 'INTEGER', 'TEXT', 'INTEGER'],
          rows: [
            [0, 'id', 'INTEGER', 0, null, 1],
            [1, 'name', 'TEXT', 0, null, 2],
          ],
        };
      }
      if (sql.startsWith('PRAGMA table_xinfo("items")')) {
        return {
          columns: ['cid', 'name', 'type', 'notnull', 'dflt_value', 'pk', 'hidden'],
          columnTypes: ['INTEGER', 'TEXT', 'TEXT', 'INTEGER', 'TEXT', 'INTEGER', 'INTEGER'],
          rows: [
            [0, 'id', 'INTEGER', 0, null, 1, 0],
            [1, 'name', 'TEXT', 0, null, 2, 0],
          ],
        };
      }
      if (sql === 'SELECT * FROM items ORDER BY "id", "name" LIMIT 1 OFFSET 1') {
        return {
          columns: ['id', 'name'],
          columnTypes: ['INTEGER', 'TEXT'],
          rows: [[2, 'Two']],
        };
      }
      return { columns: [], columnTypes: [], rows: [] };
    });

    const result = await executePaginatedQuery(engine, {
      sql: 'SELECT * FROM items',
      limit: 1,
      offset: 1,
      tableName: 'items',
    });

    expect(result.rows).toEqual([[2, 'Two']]);
    expect((engine.query as unknown as { mock: { calls: Array<[string, unknown[] | undefined]> } }).mock.calls).toEqual(
      expect.arrayContaining([['SELECT * FROM items ORDER BY "id", "name" LIMIT 1 OFFSET 1', undefined]]),
    );
  });

  it('extracts generated column expressions', async () => {
    const createSqlWithGenerated =
      'CREATE TABLE calc (a INTEGER, b TEXT GENERATED ALWAYS AS (a || "x") STORED)';
    const engine = createMockEngine((sql) => {
      if (sql.startsWith('SELECT COUNT(*)')) {
        return { columns: ['COUNT(*)'], columnTypes: ['INTEGER'], rows: [[1]] };
      }
      if (sql.startsWith('SELECT sql FROM sqlite_master')) {
        return { columns: ['sql'], columnTypes: ['TEXT'], rows: [[createSqlWithGenerated]] };
      }
      if (sql.startsWith('PRAGMA table_xinfo("calc")')) {
        return {
          columns: ['cid', 'name', 'type', 'notnull', 'dflt_value', 'pk', 'hidden'],
          columnTypes: ['INTEGER', 'TEXT', 'TEXT', 'INTEGER', 'TEXT', 'INTEGER', 'INTEGER'],
          rows: [
            [0, 'a', 'INTEGER', 0, null, 0, 0],
            [1, 'b', 'TEXT', 0, null, 0, 2],
          ],
        };
      }
      if (sql === 'SELECT * FROM calc ORDER BY rowid LIMIT 1 OFFSET 0') {
        return {
          columns: ['a', 'b'],
          columnTypes: ['INTEGER', 'TEXT'],
          rows: [[1, '1x']],
        };
      }
      return { columns: [], columnTypes: [], rows: [] };
    });

    const result = await executePaginatedQuery(engine, {
      sql: 'SELECT * FROM calc',
      limit: 1,
      offset: 0,
      tableName: 'calc',
    });

    expect(result.columns[1]).toMatchObject({
      name: 'b',
      isGenerated: true,
      generatedExpression: 'a || "x"',
    });
  });

  it('reuses cached count for repeated queries', async () => {
    const engine = createMockEngine((sql) => {
      if (sql.startsWith('SELECT COUNT(*)')) {
        return { columns: ['COUNT(*)'], columnTypes: ['INTEGER'], rows: [[2]] };
      }
      if (sql.startsWith('SELECT sql FROM sqlite_master')) {
        return { columns: ['sql'], columnTypes: ['TEXT'], rows: [[createSql]] };
      }
      if (sql.startsWith('PRAGMA table_xinfo("users")')) {
        return {
          columns: ['cid', 'name', 'type', 'notnull', 'dflt_value', 'pk', 'hidden'],
          columnTypes: ['INTEGER', 'TEXT', 'TEXT', 'INTEGER', 'TEXT', 'INTEGER', 'INTEGER'],
          rows: [
            [0, 'id', 'INTEGER', 0, null, 1, 0],
            [1, 'name', 'TEXT', 0, null, 0, 0],
          ],
        };
      }
      if (sql.startsWith('SELECT * FROM users ORDER BY rowid LIMIT')) {
        return {
          columns: ['id', 'name'],
          columnTypes: ['INTEGER', 'TEXT'],
          rows: [[1, 'Alice']],
        };
      }
      return { columns: [], columnTypes: [], rows: [] };
    });

    await executePaginatedQuery(engine, { sql: 'SELECT * FROM users', limit: 1, offset: 0, tableName: 'users' });
    await executePaginatedQuery(engine, { sql: 'SELECT * FROM users', limit: 1, offset: 1, tableName: 'users' });

    const countCalls = (engine.query as unknown as { mock: { calls: Array<[string, unknown[] | undefined]> } })
      .mock.calls.filter(([sql]) => sql.startsWith('SELECT COUNT(*)'));
    expect(countCalls).toHaveLength(1);
  });

  /**
   * Test for the indexOf bug fix (line 424).
   *
   * Before the fix: result.columns.indexOf(colName) was used, which always returned
   * the index of the FIRST occurrence of a column name. For duplicate column names
   * (common in JOINs), this caused later duplicates to get the wrong columnType.
   *
   * After the fix: colIndex (the map callback's second parameter) is used instead,
   * correctly mapping each column to its corresponding type.
   */
  describe('duplicate column names in JOIN results', () => {
    it('assigns correct types to duplicate column names (indexOf bug fix)', async () => {
      // Simulates: SELECT a.id, a.name, b.id, b.status FROM users a JOIN orders b
      // Both tables have 'id' column, but with potentially different types
      const engine = createMockEngine((sql) => {
        if (sql.startsWith('SELECT COUNT(*)')) {
          return { columns: ['COUNT(*)'], columnTypes: ['INTEGER'], rows: [[2]] };
        }
        if (sql.startsWith('SELECT sql FROM sqlite_master')) {
          return { columns: ['sql'], columnTypes: ['TEXT'], rows: [] };
        }
        if (sql.startsWith('PRAGMA table_xinfo')) {
          return {
            columns: ['cid', 'name', 'type', 'notnull', 'dflt_value', 'pk', 'hidden'],
            columnTypes: ['INTEGER', 'TEXT', 'TEXT', 'INTEGER', 'TEXT', 'INTEGER', 'INTEGER'],
            rows: [], // Empty - columns not found in table metadata
          };
        }
        // The paginated query result with duplicate 'id' columns
        if (sql.includes('LIMIT')) {
          return {
            columns: ['id', 'name', 'id', 'status'],
            // Different types for the two 'id' columns to verify correct mapping
            columnTypes: ['INTEGER', 'TEXT', 'TEXT', 'TEXT'],
            rows: [
              [1, 'Alice', 'ORD-001', 'pending'],
              [2, 'Bob', 'ORD-002', 'shipped'],
            ],
          };
        }
        return { columns: [], columnTypes: [], rows: [] };
      });

      const result = await executePaginatedQuery(engine, {
        sql: 'SELECT a.id, a.name, b.id, b.status FROM users a JOIN orders b',
        limit: 10,
        offset: 0,
        // No tableName - simulates ad-hoc query without table metadata
      });

      // Verify each column has the correct type
      // Before the fix, columns[2] would have type 'INTEGER' (from indexOf('id') = 0)
      // After the fix, columns[2] correctly has type 'TEXT' (from colIndex = 2)
      expect(result.columns).toEqual([
        { name: 'id', type: 'INTEGER', isGenerated: false, generatedExpression: null },
        { name: 'name', type: 'TEXT', isGenerated: false, generatedExpression: null },
        { name: 'id', type: 'TEXT', isGenerated: false, generatedExpression: null },
        { name: 'status', type: 'TEXT', isGenerated: false, generatedExpression: null },
      ]);
    });

    it('handles three duplicate columns with different types', async () => {
      // Edge case: three columns with same name, each with different type
      const engine = createMockEngine((sql) => {
        if (sql.startsWith('SELECT COUNT(*)')) {
          return { columns: ['COUNT(*)'], columnTypes: ['INTEGER'], rows: [[1]] };
        }
        if (sql.startsWith('SELECT sql FROM sqlite_master')) {
          return { columns: ['sql'], columnTypes: ['TEXT'], rows: [] };
        }
        if (sql.startsWith('PRAGMA table_xinfo')) {
          return {
            columns: ['cid', 'name', 'type', 'notnull', 'dflt_value', 'pk', 'hidden'],
            columnTypes: ['INTEGER', 'TEXT', 'TEXT', 'INTEGER', 'TEXT', 'INTEGER', 'INTEGER'],
            rows: [],
          };
        }
        if (sql.includes('LIMIT')) {
          return {
            columns: ['val', 'val', 'val'],
            columnTypes: ['INTEGER', 'REAL', 'TEXT'],
            rows: [[1, 1.5, 'one']],
          };
        }
        return { columns: [], columnTypes: [], rows: [] };
      });

      const result = await executePaginatedQuery(engine, {
        sql: 'SELECT a.val, b.val, c.val FROM t1 a, t2 b, t3 c',
        limit: 10,
        offset: 0,
      });

      // Each 'val' column should have its own correct type
      expect(result.columns[0].type).toBe('INTEGER');
      expect(result.columns[1].type).toBe('REAL');
      expect(result.columns[2].type).toBe('TEXT');
    });

    it('correctly maps types when only some columns are duplicates', async () => {
      // Mix of unique and duplicate columns
      const engine = createMockEngine((sql) => {
        if (sql.startsWith('SELECT COUNT(*)')) {
          return { columns: ['COUNT(*)'], columnTypes: ['INTEGER'], rows: [[1]] };
        }
        if (sql.startsWith('SELECT sql FROM sqlite_master')) {
          return { columns: ['sql'], columnTypes: ['TEXT'], rows: [] };
        }
        if (sql.startsWith('PRAGMA table_xinfo')) {
          return {
            columns: ['cid', 'name', 'type', 'notnull', 'dflt_value', 'pk', 'hidden'],
            columnTypes: ['INTEGER', 'TEXT', 'TEXT', 'INTEGER', 'TEXT', 'INTEGER', 'INTEGER'],
            rows: [],
          };
        }
        if (sql.includes('LIMIT')) {
          return {
            columns: ['id', 'name', 'id', 'created_at', 'name'],
            columnTypes: ['INTEGER', 'TEXT', 'TEXT', 'DATETIME', 'VARCHAR'],
            rows: [[1, 'Alice', 'uuid-1', '2024-01-01', 'Product A']],
          };
        }
        return { columns: [], columnTypes: [], rows: [] };
      });

      const result = await executePaginatedQuery(engine, {
        sql: 'SELECT u.id, u.name, p.id, p.created_at, p.name FROM users u JOIN products p',
        limit: 10,
        offset: 0,
      });

      // Verify all columns have correct types
      expect(result.columns.map(c => ({ name: c.name, type: c.type }))).toEqual([
        { name: 'id', type: 'INTEGER' },
        { name: 'name', type: 'TEXT' },
        { name: 'id', type: 'TEXT' },
        { name: 'created_at', type: 'DATETIME' },
        { name: 'name', type: 'VARCHAR' },
      ]);
    });

    it('handles columns not found in table metadata with correct types', async () => {
      // When tableName is provided, columns not in table metadata should use columnTypes
      // The indexOf fix ensures we use the correct index, not indexOf(colName)
      const engine = createMockEngine((sql) => {
        if (sql.startsWith('SELECT COUNT(*)')) {
          return { columns: ['COUNT(*)'], columnTypes: ['INTEGER'], rows: [[1]] };
        }
        if (sql.startsWith('SELECT sql FROM sqlite_master')) {
          return {
            columns: ['sql'],
            columnTypes: ['TEXT'],
            rows: [['CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)']]
          };
        }
        if (sql.startsWith('PRAGMA table_xinfo("users")')) {
          return {
            columns: ['cid', 'name', 'type', 'notnull', 'dflt_value', 'pk', 'hidden'],
            columnTypes: ['INTEGER', 'TEXT', 'TEXT', 'INTEGER', 'TEXT', 'INTEGER', 'INTEGER'],
            rows: [
              [0, 'id', 'INTEGER', 0, null, 1, 0],
              [1, 'name', 'TEXT', 0, null, 0, 0],
            ],
          };
        }
        if (sql.includes('LIMIT')) {
          return {
            // id and name match users table, order_id and total don't
            // The fix ensures order_id gets BLOB (index 2) and total gets REAL (index 3)
            columns: ['id', 'name', 'order_id', 'total'],
            columnTypes: ['INTEGER', 'TEXT', 'BLOB', 'REAL'],
            rows: [[1, 'Alice', 'ORD-001', 99.99]],
          };
        }
        return { columns: [], columnTypes: [], rows: [] };
      });

      const result = await executePaginatedQuery(engine, {
        sql: 'SELECT u.id, u.name, o.order_id, o.total FROM users u JOIN orders o',
        limit: 10,
        offset: 0,
        tableName: 'users',
      });

      // id and name come from table metadata (users)
      expect(result.columns[0]).toEqual({
        name: 'id',
        type: 'INTEGER',
        isGenerated: false,
        generatedExpression: null,
      });
      expect(result.columns[1]).toEqual({
        name: 'name',
        type: 'TEXT',
        isGenerated: false,
        generatedExpression: null,
      });
      // order_id and total not in users table - use columnTypes with correct indices
      expect(result.columns[2]).toEqual({
        name: 'order_id',
        type: 'BLOB', // From columnTypes[2]
        isGenerated: false,
        generatedExpression: null,
      });
      expect(result.columns[3]).toEqual({
        name: 'total',
        type: 'REAL', // From columnTypes[3]
        isGenerated: false,
        generatedExpression: null,
      });
    });

    it('correctly handles multiple columns not in table metadata (indexOf bug scenario)', async () => {
      // This is the exact scenario the indexOf bug would affect:
      // Multiple columns with the same name that don't exist in table metadata
      // Before fix: all would get the type of the first occurrence via indexOf
      const engine = createMockEngine((sql) => {
        if (sql.startsWith('SELECT COUNT(*)')) {
          return { columns: ['COUNT(*)'], columnTypes: ['INTEGER'], rows: [[1]] };
        }
        if (sql.startsWith('SELECT sql FROM sqlite_master')) {
          return {
            columns: ['sql'],
            columnTypes: ['TEXT'],
            rows: [['CREATE TABLE metrics (timestamp INTEGER)']]
          };
        }
        if (sql.startsWith('PRAGMA table_xinfo("metrics")')) {
          return {
            columns: ['cid', 'name', 'type', 'notnull', 'dflt_value', 'pk', 'hidden'],
            columnTypes: ['INTEGER', 'TEXT', 'TEXT', 'INTEGER', 'TEXT', 'INTEGER', 'INTEGER'],
            rows: [
              [0, 'timestamp', 'INTEGER', 0, null, 0, 0],
            ],
          };
        }
        if (sql.includes('LIMIT')) {
          return {
            // 'value' appears 3 times - not in table metadata, each with different type
            // Before fix: all three would get INTEGER (indexOf('value') = 0)
            // After fix: each gets its correct type from colIndex
            columns: ['timestamp', 'value', 'value', 'value'],
            columnTypes: ['INTEGER', 'INTEGER', 'REAL', 'TEXT'],
            rows: [[1704067200, 42, 3.14, 'hello']],
          };
        }
        return { columns: [], columnTypes: [], rows: [] };
      });

      const result = await executePaginatedQuery(engine, {
        sql: 'SELECT timestamp, v1.value, v2.value, v3.value FROM metrics JOIN values v1...',
        limit: 10,
        offset: 0,
        tableName: 'metrics',
      });

      // timestamp comes from table metadata
      expect(result.columns[0]).toEqual({
        name: 'timestamp',
        type: 'INTEGER',
        isGenerated: false,
        generatedExpression: null,
      });
      // All three 'value' columns should have their correct types
      // This is what the indexOf bug fix enables
      expect(result.columns[1].name).toBe('value');
      expect(result.columns[1].type).toBe('INTEGER'); // columnTypes[1]

      expect(result.columns[2].name).toBe('value');
      expect(result.columns[2].type).toBe('REAL'); // columnTypes[2], not INTEGER

      expect(result.columns[3].name).toBe('value');
      expect(result.columns[3].type).toBe('TEXT'); // columnTypes[3], not INTEGER
    });
  });
});
