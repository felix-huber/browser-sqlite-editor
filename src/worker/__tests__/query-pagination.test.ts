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
});
