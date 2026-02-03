/**
 * Tests for useDataGrid hook and utilities
 */

import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { act } from '@testing-library/react';
import {
  useDataGrid,
  createColumnDefs,
  generatePaginationClause,
  generatePaginatedQuery,
  generateOrderByClause,
  escapeLike,
  generateFilterClause,
  generateWhereClause,
  getColumnTypeCategory,
  ROW_HEIGHT,
  DEFAULT_PAGE_SIZE,
  type PaginationState,
  type SortState,
  type ColumnFilter,
  type FilterState,
} from '../useDataGrid';
import type { TableInfo, ColumnInfo } from '../../../types';

// =============================================================================
// Test Data
// =============================================================================

const mockColumn = (name: string, type: string, pk: number = 0): ColumnInfo => ({
  cid: 0,
  name,
  type,
  notnull: false,
  dfltValue: null,
  pk,
  generated: null,
  hidden: false,
});

const mockTableInfo: TableInfo = {
  name: 'users',
  isView: false,
  isVirtual: false,
  withoutRowid: false,
  columns: [
    mockColumn('id', 'INTEGER', 1),
    mockColumn('name', 'TEXT'),
    mockColumn('email', 'TEXT'),
    mockColumn('age', 'INTEGER'),
  ],
  indexes: [],
  createSql: 'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT, age INTEGER)',
};

const mockEmptyTableInfo: TableInfo = {
  name: 'empty',
  isView: false,
  isVirtual: false,
  withoutRowid: false,
  columns: [],
  indexes: [],
  createSql: 'CREATE TABLE empty ()',
};

// =============================================================================
// useDataGrid Hook Tests
// =============================================================================

describe('useDataGrid', () => {
  it('initializes with empty data', () => {
    const { result } = renderHook(() =>
      useDataGrid({
        tableInfo: mockTableInfo,
        data: [],
      }),
    );

    expect(result.current.hasData).toBe(false);
    expect(result.current.isEmpty).toBe(false);
    expect(result.current.columns).toHaveLength(4);
    expect(result.current.table).toBeDefined();
  });

  it('returns isEmpty true when no tableInfo', () => {
    const { result } = renderHook(() =>
      useDataGrid({
        tableInfo: null,
        data: [],
      }),
    );

    expect(result.current.isEmpty).toBe(true);
    expect(result.current.hasData).toBe(false);
    expect(result.current.columns).toHaveLength(0);
  });

  it('returns isEmpty true when tableInfo has no columns', () => {
    const { result } = renderHook(() =>
      useDataGrid({
        tableInfo: mockEmptyTableInfo,
        data: [],
      }),
    );

    expect(result.current.isEmpty).toBe(true);
    expect(result.current.columns).toHaveLength(0);
  });

  it('returns hasData true when data is provided', () => {
    const { result } = renderHook(() =>
      useDataGrid({
        tableInfo: mockTableInfo,
        data: [{ id: 1, name: 'Alice', email: 'alice@example.com', age: 30 }],
      }),
    );

    expect(result.current.hasData).toBe(true);
    expect(result.current.isEmpty).toBe(false);
  });

  it('passes isReadOnly to table meta', () => {
    const { result } = renderHook(() =>
      useDataGrid({
        tableInfo: mockTableInfo,
        data: [],
        isReadOnly: true,
      }),
    );

    expect(result.current.table.options.meta?.isReadOnly).toBe(true);
  });

  it('passes pagination to table meta', () => {
    const pagination: PaginationState = {
      cursorRowId: 50,
      pageSize: 25,
      direction: 'forward',
    };

    const { result } = renderHook(() =>
      useDataGrid({
        tableInfo: mockTableInfo,
        data: [],
        pagination,
      }),
    );

    expect(result.current.table.options.meta?.pagination).toEqual(pagination);
  });

  it('sets rowHeight in table meta', () => {
    const { result } = renderHook(() =>
      useDataGrid({
        tableInfo: mockTableInfo,
        data: [],
      }),
    );

    expect(result.current.table.options.meta?.rowHeight).toBe(ROW_HEIGHT);
  });
});

// =============================================================================
// Column Definition Factory Tests
// =============================================================================

describe('createColumnDefs', () => {
  it('generates column definitions from TableInfo', () => {
    const columns = createColumnDefs(mockTableInfo);

    expect(columns).toHaveLength(4);
    expect(columns[0].id).toBe('id');
    expect(columns[0].header).toBe('id');
    expect(columns[1].id).toBe('name');
    expect(columns[2].id).toBe('email');
    expect(columns[3].id).toBe('age');
  });

  it('includes column metadata', () => {
    const columns = createColumnDefs(mockTableInfo);

    // First column is primary key
    expect(columns[0].meta?.isPrimaryKey).toBe(true);
    expect(columns[0].meta?.type).toBe('INTEGER');

    // Other columns are not primary keys
    expect(columns[1].meta?.isPrimaryKey).toBe(false);
    expect(columns[1].meta?.type).toBe('TEXT');
  });

  it('returns empty array for null tableInfo', () => {
    const columns = createColumnDefs(null);
    expect(columns).toHaveLength(0);
  });

  it('returns empty array for tableInfo with no columns', () => {
    const columns = createColumnDefs(mockEmptyTableInfo);
    expect(columns).toHaveLength(0);
  });

  it('handles generated columns', () => {
    const tableWithGenerated: TableInfo = {
      ...mockTableInfo,
      columns: [
        mockColumn('id', 'INTEGER', 1),
        {
          ...mockColumn('full_name', 'TEXT'),
          generated: 'stored',
        },
      ],
    };

    const columns = createColumnDefs(tableWithGenerated);

    expect(columns[1].meta?.isGenerated).toBe(true);
    expect(columns[1].meta?.generatedType).toBe('stored');
  });
});

// =============================================================================
// Pagination Tests
// =============================================================================

describe('generatePaginationClause', () => {
  it('generates simple LIMIT for first page', () => {
    const pagination: PaginationState = {
      cursorRowId: null,
      pageSize: 100,
      direction: 'forward',
    };

    const result = generatePaginationClause(pagination, 'users');

    expect(result.sql).toBe('LIMIT ?');
    expect(result.params).toEqual([100]);
  });

  it('generates cursor-based pagination for forward direction', () => {
    const pagination: PaginationState = {
      cursorRowId: 50,
      pageSize: 100,
      direction: 'forward',
    };

    const result = generatePaginationClause(pagination, 'users');

    expect(result.sql).toBe('WHERE rowid > ? ORDER BY rowid ASC LIMIT ?');
    expect(result.params).toEqual([50, 100]);
  });

  it('generates cursor-based pagination for backward direction', () => {
    const pagination: PaginationState = {
      cursorRowId: 150,
      pageSize: 100,
      direction: 'backward',
    };

    const result = generatePaginationClause(pagination, 'users');

    expect(result.sql).toBe('WHERE rowid < ? ORDER BY rowid DESC LIMIT ?');
    expect(result.params).toEqual([150, 100]);
  });

  it('uses simple LIMIT for WITHOUT ROWID tables', () => {
    const pagination: PaginationState = {
      cursorRowId: 50,
      pageSize: 100,
      direction: 'forward',
    };

    const result = generatePaginationClause(pagination, 'users', true);

    expect(result.sql).toBe('LIMIT ?');
    expect(result.params).toEqual([100]);
  });
});

describe('generatePaginatedQuery', () => {
  it('generates complete SELECT with pagination', () => {
    const pagination: PaginationState = {
      cursorRowId: null,
      pageSize: 50,
      direction: 'forward',
    };

    const result = generatePaginatedQuery('users', ['id', 'name', 'email'], pagination);

    expect(result.sql).toBe('SELECT rowid, "id", "name", "email" FROM "users" LIMIT ?');
    expect(result.params).toEqual([50]);
  });

  it('includes rowid in SELECT for cursor pagination', () => {
    const pagination: PaginationState = {
      cursorRowId: 100,
      pageSize: 25,
      direction: 'forward',
    };

    const result = generatePaginatedQuery('users', ['id', 'name'], pagination);

    expect(result.sql).toContain('SELECT rowid,');
    expect(result.sql).toContain('WHERE rowid > ?');
  });

  it('escapes table and column names', () => {
    const pagination: PaginationState = {
      cursorRowId: null,
      pageSize: 50,
      direction: 'forward',
    };

    const result = generatePaginatedQuery('user"table', ['col"name'], pagination);

    expect(result.sql).toContain('"user""table"');
    expect(result.sql).toContain('"col""name"');
  });

  it('excludes rowid for WITHOUT ROWID tables', () => {
    const pagination: PaginationState = {
      cursorRowId: null,
      pageSize: 50,
      direction: 'forward',
    };

    const result = generatePaginatedQuery('users', ['id', 'name'], pagination, true);

    expect(result.sql).toBe('SELECT "id", "name" FROM "users" LIMIT ?');
    expect(result.sql).not.toContain('rowid');
  });
});

// =============================================================================
// Sorting Tests
// =============================================================================

describe('generateOrderByClause', () => {
  it('returns empty string for empty sort state', () => {
    const result = generateOrderByClause([]);
    expect(result).toBe('');
  });

  it('generates single column ORDER BY ASC', () => {
    const sortState: SortState = [{ column: 'name', direction: 'asc' }];
    const result = generateOrderByClause(sortState);
    expect(result).toBe('"name" ASC');
  });

  it('generates single column ORDER BY DESC', () => {
    const sortState: SortState = [{ column: 'age', direction: 'desc' }];
    const result = generateOrderByClause(sortState);
    expect(result).toBe('"age" DESC');
  });

  it('generates multi-column ORDER BY', () => {
    const sortState: SortState = [
      { column: 'name', direction: 'asc' },
      { column: 'age', direction: 'desc' },
    ];
    const result = generateOrderByClause(sortState);
    expect(result).toBe('"name" ASC, "age" DESC');
  });

  it('generateOrderByClause escapes column names with quotes', () => {
    const sortState: SortState = [{ column: 'column"name', direction: 'asc' }];
    const result = generateOrderByClause(sortState);
    expect(result).toBe('"column""name" ASC');
  });
});

describe('generatePaginatedQuery with sorting', () => {
  it('includes ORDER BY clause when sort state is provided', () => {
    const pagination: PaginationState = {
      cursorRowId: null,
      pageSize: 50,
      direction: 'forward',
    };
    const sortState: SortState = [{ column: 'name', direction: 'asc' }];

    const result = generatePaginatedQuery('users', ['id', 'name'], pagination, false, sortState);

    expect(result.sql).toContain('ORDER BY "name" ASC');
    expect(result.sql).toContain('LIMIT ?');
  });

  it('includes multi-column ORDER BY', () => {
    const pagination: PaginationState = {
      cursorRowId: null,
      pageSize: 50,
      direction: 'forward',
    };
    const sortState: SortState = [
      { column: 'name', direction: 'asc' },
      { column: 'age', direction: 'desc' },
    ];

    const result = generatePaginatedQuery('users', ['id', 'name', 'age'], pagination, false, sortState);

    expect(result.sql).toContain('ORDER BY "name" ASC, "age" DESC');
  });
});

describe('useDataGrid sorting', () => {
  it('initializes with empty sort state', () => {
    const { result } = renderHook(() =>
      useDataGrid({
        tableInfo: mockTableInfo,
        data: [],
      }),
    );

    expect(result.current.sortState).toEqual([]);
  });

  it('handles single click to sort ASC', () => {
    const { result } = renderHook(() =>
      useDataGrid({
        tableInfo: mockTableInfo,
        data: [],
      }),
    );

    act(() => {
      result.current.handleSortClick('name', false);
    });

    expect(result.current.sortState).toEqual([{ column: 'name', direction: 'asc' }]);
    expect(result.current.getSortDirection('name')).toBe('asc');
  });

  it('handles second click to sort DESC', () => {
    const { result } = renderHook(() =>
      useDataGrid({
        tableInfo: mockTableInfo,
        data: [],
      }),
    );

    act(() => {
      result.current.handleSortClick('name', false);
    });

    act(() => {
      result.current.handleSortClick('name', false);
    });

    expect(result.current.sortState).toEqual([{ column: 'name', direction: 'desc' }]);
    expect(result.current.getSortDirection('name')).toBe('desc');
  });

  it('handles third click to remove sort', () => {
    const { result } = renderHook(() =>
      useDataGrid({
        tableInfo: mockTableInfo,
        data: [],
      }),
    );

    act(() => {
      result.current.handleSortClick('name', false);
    });

    act(() => {
      result.current.handleSortClick('name', false);
    });

    act(() => {
      result.current.handleSortClick('name', false);
    });

    expect(result.current.sortState).toEqual([]);
    expect(result.current.getSortDirection('name')).toBeNull();
  });

  it('handles shift+click to add secondary sort', () => {
    const { result } = renderHook(() =>
      useDataGrid({
        tableInfo: mockTableInfo,
        data: [],
      }),
    );

    // First click - primary sort
    act(() => {
      result.current.handleSortClick('name', false);
    });

    // Shift+click - add secondary sort
    act(() => {
      result.current.handleSortClick('age', true);
    });

    expect(result.current.sortState).toEqual([
      { column: 'name', direction: 'asc' },
      { column: 'age', direction: 'asc' },
    ]);
  });

  it('returns sort index for multi-column sort', () => {
    const { result } = renderHook(() =>
      useDataGrid({
        tableInfo: mockTableInfo,
        data: [],
      }),
    );

    act(() => {
      result.current.handleSortClick('name', false);
    });

    act(() => {
      result.current.handleSortClick('age', true);
    });

    expect(result.current.getSortIndex('name')).toBe(1);
    expect(result.current.getSortIndex('age')).toBe(2);
    expect(result.current.getSortIndex('email')).toBeNull();
  });

  it('returns null sort index for single-column sort', () => {
    const { result } = renderHook(() =>
      useDataGrid({
        tableInfo: mockTableInfo,
        data: [],
      }),
    );

    act(() => {
      result.current.handleSortClick('name', false);
    });

    // For single column sort, index should be null (not displayed)
    expect(result.current.getSortIndex('name')).toBeNull();
  });

  it('uses external sort state when provided', () => {
    const externalSortState: SortState = [{ column: 'email', direction: 'desc' }];

    const { result } = renderHook(() =>
      useDataGrid({
        tableInfo: mockTableInfo,
        data: [],
        sortState: externalSortState,
      }),
    );

    expect(result.current.sortState).toEqual(externalSortState);
    expect(result.current.getSortDirection('email')).toBe('desc');
  });

  it('calls onSortChange when sort changes with external state', () => {
    const onSortChange = vi.fn();
    const { result } = renderHook(() =>
      useDataGrid({
        tableInfo: mockTableInfo,
        data: [],
        onSortChange,
      }),
    );

    act(() => {
      result.current.handleSortClick('name', false);
    });

    expect(onSortChange).toHaveBeenCalledWith([{ column: 'name', direction: 'asc' }]);
  });
});

// =============================================================================
// Constants Tests
// =============================================================================

describe('Constants', () => {
  it('ROW_HEIGHT is 32px', () => {
    expect(ROW_HEIGHT).toBe(32);
  });

  it('DEFAULT_PAGE_SIZE is 100', () => {
    expect(DEFAULT_PAGE_SIZE).toBe(100);
  });
});

// =============================================================================
// Filter Utility Tests
// =============================================================================

describe('escapeLike', () => {
  it('escapes percent character', () => {
    expect(escapeLike('100%')).toBe('100\\%');
  });

  it('escapes underscore character', () => {
    expect(escapeLike('hello_world')).toBe('hello\\_world');
  });

  it('escapes backslash character', () => {
    expect(escapeLike('path\\to\\file')).toBe('path\\\\to\\\\file');
  });

  it('escapes multiple special characters', () => {
    expect(escapeLike('50% off_sale\\')).toBe('50\\% off\\_sale\\\\');
  });

  it('returns empty string unchanged', () => {
    expect(escapeLike('')).toBe('');
  });

  it('returns normal string unchanged', () => {
    expect(escapeLike('hello world')).toBe('hello world');
  });
});

describe('generateFilterClause', () => {
  describe('text operators', () => {
    it('generates case-insensitive contains LIKE pattern', () => {
      const filter: ColumnFilter = { column: 'name', operator: 'contains', value: 'Rock' };
      const result = generateFilterClause(filter);

      expect(result.sql).toBe('lower("name") LIKE lower(?) ESCAPE \'\\\'');
      expect(result.params).toEqual(['%Rock%']);
    });

    it('generates case-insensitive equals condition', () => {
      const filter: ColumnFilter = { column: 'status', operator: 'equals', value: 'Active' };
      const result = generateFilterClause(filter);

      expect(result.sql).toBe('lower("status") = lower(?)');
      expect(result.params).toEqual(['Active']);
    });

    it('generates case-insensitive starts_with LIKE pattern', () => {
      const filter: ColumnFilter = { column: 'name', operator: 'starts_with', value: 'John' };
      const result = generateFilterClause(filter);

      expect(result.sql).toBe('lower("name") LIKE lower(?) ESCAPE \'\\\'');
      expect(result.params).toEqual(['John%']);
    });

    it('generates case-insensitive ends_with LIKE pattern', () => {
      const filter: ColumnFilter = { column: 'email', operator: 'ends_with', value: '.COM' };
      const result = generateFilterClause(filter);

      expect(result.sql).toBe('lower("email") LIKE lower(?) ESCAPE \'\\\'');
      expect(result.params).toEqual(['%.COM']);
    });

    it('case-insensitive filter matches john, John, JOHN', () => {
      // Acceptance criteria: Filter 'john' matches 'John', 'JOHN' (case-insensitive)
      const filter: ColumnFilter = { column: 'name', operator: 'contains', value: 'john' };
      const result = generateFilterClause(filter);

      // The SQL uses lower() on both sides, so 'john' will match 'John', 'JOHN', etc.
      expect(result.sql).toBe('lower("name") LIKE lower(?) ESCAPE \'\\\'');
      expect(result.params).toEqual(['%john%']);
    });

    it('generates is_empty condition', () => {
      const filter: ColumnFilter = { column: 'description', operator: 'is_empty' };
      const result = generateFilterClause(filter);

      expect(result.sql).toBe('("description" = \'\' OR "description" IS NULL)');
      expect(result.params).toEqual([]);
    });

    it('generates is_not_empty condition', () => {
      const filter: ColumnFilter = { column: 'description', operator: 'is_not_empty' };
      const result = generateFilterClause(filter);

      expect(result.sql).toBe('("description" != \'\' AND "description" IS NOT NULL)');
      expect(result.params).toEqual([]);
    });

    it('escapes special characters in LIKE patterns', () => {
      const filter: ColumnFilter = { column: 'name', operator: 'contains', value: '50% off_sale' };
      const result = generateFilterClause(filter);

      expect(result.sql).toBe('lower("name") LIKE lower(?) ESCAPE \'\\\'');
      expect(result.params).toEqual(['%50\\% off\\_sale%']);
    });

    it('escapes backslash in LIKE patterns', () => {
      // Acceptance criteria: Special chars %, _, \ are escaped using backslash
      const filter: ColumnFilter = { column: 'path', operator: 'contains', value: 'C:\\Users' };
      const result = generateFilterClause(filter);

      expect(result.sql).toBe('lower("path") LIKE lower(?) ESCAPE \'\\\'');
      expect(result.params).toEqual(['%C:\\\\Users%']);
    });
  });

  describe('numeric operators', () => {
    it('generates eq condition', () => {
      const filter: ColumnFilter = { column: 'age', operator: 'eq', value: 25 };
      const result = generateFilterClause(filter);

      expect(result.sql).toBe('"age" = ?');
      expect(result.params).toEqual([25]);
    });

    it('generates neq condition', () => {
      const filter: ColumnFilter = { column: 'age', operator: 'neq', value: 0 };
      const result = generateFilterClause(filter);

      expect(result.sql).toBe('"age" != ?');
      expect(result.params).toEqual([0]);
    });

    it('generates gt condition', () => {
      const filter: ColumnFilter = { column: 'price', operator: 'gt', value: 100 };
      const result = generateFilterClause(filter);

      expect(result.sql).toBe('"price" > ?');
      expect(result.params).toEqual([100]);
    });

    it('generates lt condition', () => {
      const filter: ColumnFilter = { column: 'price', operator: 'lt', value: 50 };
      const result = generateFilterClause(filter);

      expect(result.sql).toBe('"price" < ?');
      expect(result.params).toEqual([50]);
    });

    it('generates gte condition', () => {
      const filter: ColumnFilter = { column: 'quantity', operator: 'gte', value: 10 };
      const result = generateFilterClause(filter);

      expect(result.sql).toBe('"quantity" >= ?');
      expect(result.params).toEqual([10]);
    });

    it('generates lte condition', () => {
      const filter: ColumnFilter = { column: 'quantity', operator: 'lte', value: 100 };
      const result = generateFilterClause(filter);

      expect(result.sql).toBe('"quantity" <= ?');
      expect(result.params).toEqual([100]);
    });

    it('generates between condition', () => {
      const filter: ColumnFilter = { column: 'price', operator: 'between', value: 10, value2: 50 };
      const result = generateFilterClause(filter);

      expect(result.sql).toBe('"price" BETWEEN ? AND ?');
      expect(result.params).toEqual([10, 50]);
    });

    it('numeric range [10, 20] filters with inclusive bounds', () => {
      // Acceptance criteria: Numeric range [10, 20] filters rows where 10 <= col <= 20
      // SQL BETWEEN is inclusive on both ends
      const filter: ColumnFilter = { column: 'age', operator: 'between', value: 10, value2: 20 };
      const result = generateFilterClause(filter);

      expect(result.sql).toBe('"age" BETWEEN ? AND ?');
      expect(result.params).toEqual([10, 20]);
    });
  });

  describe('null operators', () => {
    it('generates IS NULL condition', () => {
      const filter: ColumnFilter = { column: 'deleted_at', operator: 'is_null' };
      const result = generateFilterClause(filter);

      expect(result.sql).toBe('"deleted_at" IS NULL');
      expect(result.params).toEqual([]);
    });

    it('generates IS NOT NULL condition', () => {
      const filter: ColumnFilter = { column: 'email', operator: 'is_not_null' };
      const result = generateFilterClause(filter);

      expect(result.sql).toBe('"email" IS NOT NULL');
      expect(result.params).toEqual([]);
    });

    it('NULL toggle includes NULL rows with is_null', () => {
      // Acceptance criteria: NULL toggle includes/excludes NULL rows correctly
      const filter: ColumnFilter = { column: 'optional_field', operator: 'is_null' };
      const result = generateFilterClause(filter);

      expect(result.sql).toBe('"optional_field" IS NULL');
      expect(result.params).toEqual([]);
    });

    it('NULL toggle excludes NULL rows with is_not_null', () => {
      // Acceptance criteria: NULL toggle includes/excludes NULL rows correctly
      const filter: ColumnFilter = { column: 'optional_field', operator: 'is_not_null' };
      const result = generateFilterClause(filter);

      expect(result.sql).toBe('"optional_field" IS NOT NULL');
      expect(result.params).toEqual([]);
    });
  });

  it('generateFilterClause escapes column names with quotes', () => {
    const filter: ColumnFilter = { column: 'column"name', operator: 'eq', value: 1 };
    const result = generateFilterClause(filter);

    expect(result.sql).toBe('"column""name" = ?');
  });
});

describe('generateWhereClause', () => {
  it('returns empty for empty filter state', () => {
    const result = generateWhereClause([]);

    expect(result.sql).toBe('');
    expect(result.params).toEqual([]);
  });

  it('generates single filter WHERE clause with case-insensitive text', () => {
    const filterState: FilterState = [
      { column: 'name', operator: 'contains', value: 'Rock' }
    ];
    const result = generateWhereClause(filterState);

    expect(result.sql).toBe('WHERE lower("name") LIKE lower(?) ESCAPE \'\\\'');
    expect(result.params).toEqual(['%Rock%']);
  });

  it('combines multiple filters with AND', () => {
    const filterState: FilterState = [
      { column: 'name', operator: 'contains', value: 'Rock' },
      { column: 'price', operator: 'gt', value: 10 }
    ];
    const result = generateWhereClause(filterState);

    expect(result.sql).toBe('WHERE lower("name") LIKE lower(?) ESCAPE \'\\\' AND "price" > ?');
    expect(result.params).toEqual(['%Rock%', 10]);
  });

  it('combines three filters with AND', () => {
    const filterState: FilterState = [
      { column: 'status', operator: 'equals', value: 'active' },
      { column: 'age', operator: 'gte', value: 18 },
      { column: 'email', operator: 'is_not_null' }
    ];
    const result = generateWhereClause(filterState);

    expect(result.sql).toBe('WHERE lower("status") = lower(?) AND "age" >= ? AND "email" IS NOT NULL');
    expect(result.params).toEqual(['active', 18]);
  });
});

describe('getColumnTypeCategory', () => {
  it('returns numeric for INTEGER type', () => {
    expect(getColumnTypeCategory('INTEGER')).toBe('numeric');
  });

  it('returns numeric for INT type', () => {
    expect(getColumnTypeCategory('INT')).toBe('numeric');
  });

  it('returns numeric for BIGINT type', () => {
    expect(getColumnTypeCategory('BIGINT')).toBe('numeric');
  });

  it('returns numeric for REAL type', () => {
    expect(getColumnTypeCategory('REAL')).toBe('numeric');
  });

  it('returns numeric for FLOAT type', () => {
    expect(getColumnTypeCategory('FLOAT')).toBe('numeric');
  });

  it('returns numeric for DOUBLE type', () => {
    expect(getColumnTypeCategory('DOUBLE')).toBe('numeric');
  });

  it('returns numeric for NUMERIC type', () => {
    expect(getColumnTypeCategory('NUMERIC')).toBe('numeric');
  });

  it('returns numeric for DECIMAL type', () => {
    expect(getColumnTypeCategory('DECIMAL')).toBe('numeric');
  });

  it('returns text for TEXT type', () => {
    expect(getColumnTypeCategory('TEXT')).toBe('text');
  });

  it('returns text for VARCHAR type', () => {
    expect(getColumnTypeCategory('VARCHAR(255)')).toBe('text');
  });

  it('returns blob for BLOB type', () => {
    expect(getColumnTypeCategory('BLOB')).toBe('blob');
  });

  it('returns text for empty type', () => {
    expect(getColumnTypeCategory('')).toBe('text');
  });

  it('is case insensitive', () => {
    expect(getColumnTypeCategory('integer')).toBe('numeric');
    expect(getColumnTypeCategory('Integer')).toBe('numeric');
  });
});

// =============================================================================
// Edit State Tests
// =============================================================================

describe('useDataGrid Edit State', () => {
  const mockGeneratedColumn: ColumnInfo = {
    ...mockColumn('full_name', 'TEXT'),
    generated: 'stored',
  };

  const mockBlobColumn: ColumnInfo = mockColumn('avatar', 'BLOB');

  const mockTableWithSpecialColumns: TableInfo = {
    ...mockTableInfo,
    columns: [
      mockColumn('id', 'INTEGER', 1),
      mockColumn('name', 'TEXT'),
      mockGeneratedColumn,
      mockBlobColumn,
    ],
  };

  const mockData = [
    { id: 1, name: 'Alice', full_name: 'Alice Smith', avatar: null },
    { id: 2, name: 'Bob', full_name: 'Bob Jones', avatar: null },
  ];

  it('initializes with null editState', () => {
    const { result } = renderHook(() =>
      useDataGrid({
        tableInfo: mockTableInfo,
        data: mockData,
      }),
    );

    expect(result.current.editState).toBeNull();
  });

  it('startEdit returns success for regular columns', () => {
    const { result } = renderHook(() =>
      useDataGrid({
        tableInfo: mockTableInfo,
        data: mockData,
      }),
    );

    act(() => {
      const editResult = result.current.startEdit(0, 'name');
      expect(editResult.allowed).toBe(true);
    });

    expect(result.current.editState).not.toBeNull();
    expect(result.current.editState?.rowIndex).toBe(0);
    expect(result.current.editState?.columnName).toBe('name');
  });

  it('startEdit blocks when isReadOnly', () => {
    const { result } = renderHook(() =>
      useDataGrid({
        tableInfo: mockTableInfo,
        data: mockData,
        isReadOnly: true,
      }),
    );

    act(() => {
      const editResult = result.current.startEdit(0, 'name');
      expect(editResult.allowed).toBe(false);
      expect(editResult.blockedReason).toBe('read-only');
      expect(editResult.message).toBe('Database is read-only');
    });

    expect(result.current.editState).toBeNull();
  });

  it('startEdit blocks for generated columns', () => {
    const { result } = renderHook(() =>
      useDataGrid({
        tableInfo: mockTableWithSpecialColumns,
        data: mockData,
      }),
    );

    act(() => {
      const editResult = result.current.startEdit(0, 'full_name');
      expect(editResult.allowed).toBe(false);
      expect(editResult.blockedReason).toBe('generated-column');
      expect(editResult.message).toBe('Generated columns cannot be edited');
    });

    expect(result.current.editState).toBeNull();
  });

  it('startEdit blocks for BLOB columns', () => {
    const { result } = renderHook(() =>
      useDataGrid({
        tableInfo: mockTableWithSpecialColumns,
        data: mockData,
      }),
    );

    act(() => {
      const editResult = result.current.startEdit(0, 'avatar');
      expect(editResult.allowed).toBe(false);
      expect(editResult.blockedReason).toBe('blob-column');
      expect(editResult.message).toBe('BLOB columns cannot be edited inline');
    });

    expect(result.current.editState).toBeNull();
  });

  it('updateEditValue updates the current value', () => {
    const { result } = renderHook(() =>
      useDataGrid({
        tableInfo: mockTableInfo,
        data: mockData,
      }),
    );

    act(() => {
      result.current.startEdit(0, 'name');
    });

    act(() => {
      result.current.updateEditValue('New Name');
    });

    expect(result.current.editState?.currentValue).toBe('New Name');
    expect(result.current.editState?.isDirty).toBe(true);
  });

  it('cancelEdit clears editState', () => {
    const { result } = renderHook(() =>
      useDataGrid({
        tableInfo: mockTableInfo,
        data: mockData,
      }),
    );

    act(() => {
      result.current.startEdit(0, 'name');
    });

    expect(result.current.editState).not.toBeNull();

    act(() => {
      result.current.cancelEdit();
    });

    expect(result.current.editState).toBeNull();
  });

  it('commitEdit calls onCellEdit callback', async () => {
    const onCellEdit = vi.fn().mockResolvedValue(true);

    const { result } = renderHook(() =>
      useDataGrid({
        tableInfo: mockTableInfo,
        data: mockData,
        onCellEdit,
      }),
    );

    act(() => {
      result.current.startEdit(0, 'name');
    });

    act(() => {
      result.current.updateEditValue('New Name');
    });

    await act(async () => {
      await result.current.commitEdit();
    });

    expect(onCellEdit).toHaveBeenCalledWith(0, 'name', 'New Name');
    expect(result.current.editState).toBeNull();
  });

  it('commitEdit handles numeric values', async () => {
    const onCellEdit = vi.fn().mockResolvedValue(true);

    const { result } = renderHook(() =>
      useDataGrid({
        tableInfo: mockTableInfo,
        data: mockData,
        onCellEdit,
      }),
    );

    act(() => {
      result.current.startEdit(0, 'age');
    });

    act(() => {
      result.current.updateEditValue('42');
    });

    await act(async () => {
      await result.current.commitEdit();
    });

    expect(onCellEdit).toHaveBeenCalledWith(0, 'age', 42);
  });

  it('commitEdit handles null values', async () => {
    const onCellEdit = vi.fn().mockResolvedValue(true);

    const { result } = renderHook(() =>
      useDataGrid({
        tableInfo: mockTableInfo,
        data: mockData,
        onCellEdit,
      }),
    );

    act(() => {
      result.current.startEdit(0, 'name');
    });

    act(() => {
      result.current.updateEditValue('');
    });

    await act(async () => {
      await result.current.commitEdit();
    });

    expect(onCellEdit).toHaveBeenCalledWith(0, 'name', null);
  });

  it('commitEdit without changes just exits edit mode', async () => {
    const onCellEdit = vi.fn().mockResolvedValue(true);

    const { result } = renderHook(() =>
      useDataGrid({
        tableInfo: mockTableInfo,
        data: mockData,
        onCellEdit,
      }),
    );

    act(() => {
      result.current.startEdit(0, 'name');
    });

    // Don't change the value

    await act(async () => {
      await result.current.commitEdit();
    });

    expect(onCellEdit).not.toHaveBeenCalled();
    expect(result.current.editState).toBeNull();
  });

  it('isColumnEditable returns correct values', () => {
    const { result } = renderHook(() =>
      useDataGrid({
        tableInfo: mockTableWithSpecialColumns,
        data: mockData,
      }),
    );

    expect(result.current.isColumnEditable('name')).toBe(true);
    expect(result.current.isColumnEditable('full_name')).toBe(false); // generated
    expect(result.current.isColumnEditable('avatar')).toBe(false); // blob
    expect(result.current.isColumnEditable('nonexistent')).toBe(false);
  });

  it('calls onEditStateChange when entering/exiting edit mode', async () => {
    const onEditStateChange = vi.fn();

    const { result } = renderHook(() =>
      useDataGrid({
        tableInfo: mockTableInfo,
        data: mockData,
        onEditStateChange,
      }),
    );

    act(() => {
      result.current.startEdit(0, 'name');
    });

    expect(onEditStateChange).toHaveBeenCalledWith(true);

    act(() => {
      result.current.cancelEdit();
    });

    expect(onEditStateChange).toHaveBeenCalledWith(false);
  });

  it('isReadOnly is exposed from hook', () => {
    const { result: result1 } = renderHook(() =>
      useDataGrid({
        tableInfo: mockTableInfo,
        data: mockData,
        isReadOnly: true,
      }),
    );

    expect(result1.current.isReadOnly).toBe(true);

    const { result: result2 } = renderHook(() =>
      useDataGrid({
        tableInfo: mockTableInfo,
        data: mockData,
        isReadOnly: false,
      }),
    );

    expect(result2.current.isReadOnly).toBe(false);
  });
});
