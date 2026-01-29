import { describe, it, expect, vi } from 'vitest'
import {
  isValidIdentifier,
  validateTableName,
  validateColumnName,
  handleCreateTable,
  handleAlterTable,
  handleDropTable,
  handleDropColumn,
  tableExists,
  columnExists,
  getIncomingForeignKeys,
  checkTableDependencies,
  type QueryExecutor,
} from '../schema-modification'
import type { QueryResult } from '../../types'

// =============================================================================
// Mock Query Executor
// =============================================================================

/**
 * Creates a mock query executor that tracks queries and returns predefined results
 */
function createMockQueryExecutor(results: Record<string, QueryResult | Error> = {}) {
  const queries: { sql: string; params?: unknown[] }[] = []

  const executor: QueryExecutor = vi.fn(async (sql: string, params?: unknown[]) => {
    queries.push({ sql, params })

    // Find matching result by partial SQL match
    for (const [pattern, result] of Object.entries(results)) {
      if (sql.includes(pattern)) {
        if (result instanceof Error) {
          throw result
        }
        return result
      }
    }

    // Default empty result
    return {
      columns: [],
      columnTypes: [],
      rows: [],
    }
  })

  return { executor, queries }
}

/**
 * Empty query result
 */
const emptyResult: QueryResult = {
  columns: [],
  columnTypes: [],
  rows: [],
}

/**
 * Result indicating table exists
 */
const tableExistsResult: QueryResult = {
  columns: ['1'],
  columnTypes: ['INTEGER'],
  rows: [[1]],
}

/**
 * Result indicating table does not exist
 */
const tableNotExistsResult: QueryResult = emptyResult

// =============================================================================
// Validation Tests
// =============================================================================

describe('isValidIdentifier', () => {
  it('rejects empty string', () => {
    expect(isValidIdentifier('')).toBe(false)
  })

  it('rejects whitespace-only string', () => {
    expect(isValidIdentifier('   ')).toBe(false)
    expect(isValidIdentifier('\t\n')).toBe(false)
  })

  it('rejects null bytes', () => {
    expect(isValidIdentifier('test\x00name')).toBe(false)
    expect(isValidIdentifier('\x00')).toBe(false)
  })

  it('accepts valid identifiers', () => {
    expect(isValidIdentifier('users')).toBe(true)
    expect(isValidIdentifier('_private')).toBe(true)
    expect(isValidIdentifier('Table123')).toBe(true)
  })

  it('accepts identifiers with special characters (SQLite allows these when quoted)', () => {
    expect(isValidIdentifier('my table')).toBe(true)
    expect(isValidIdentifier('user-data')).toBe(true)
    expect(isValidIdentifier("Tom's Table")).toBe(true)
  })

  it('accepts unicode identifiers', () => {
    expect(isValidIdentifier('テーブル')).toBe(true)
    expect(isValidIdentifier('表')).toBe(true)
  })
})

describe('validateTableName', () => {
  it('returns null for valid table names', () => {
    expect(validateTableName('users')).toBeNull()
    expect(validateTableName('my_table')).toBeNull()
  })

  it('returns error for empty table name', () => {
    const error = validateTableName('')
    expect(error).not.toBeNull()
    expect(error?.code).toBe('INVALID_NAME')
    expect(error?.message).toContain('Invalid table name')
  })

  it('returns error for null byte in table name', () => {
    const error = validateTableName('test\x00table')
    expect(error).not.toBeNull()
    expect(error?.code).toBe('INVALID_NAME')
  })
})

describe('validateColumnName', () => {
  it('returns null for valid column names', () => {
    expect(validateColumnName('id')).toBeNull()
    expect(validateColumnName('user_name')).toBeNull()
  })

  it('returns error for empty column name', () => {
    const error = validateColumnName('')
    expect(error).not.toBeNull()
    expect(error?.code).toBe('INVALID_NAME')
    expect(error?.message).toContain('Invalid column name')
  })
})

// =============================================================================
// createTable Tests
// =============================================================================

describe('handleCreateTable', () => {
  it('rejects in read-only mode', async () => {
    const { executor } = createMockQueryExecutor()

    const result = await handleCreateTable({
      def: {
        name: 'test_table',
        columns: [{ name: 'id', type: 'INTEGER' }],
      },
      query: executor,
      isReadOnly: true,
    })

    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('READ_ONLY')
    expect(executor).not.toHaveBeenCalled()
  })

  it('creates table successfully', async () => {
    const { executor, queries } = createMockQueryExecutor({
      'SELECT 1 FROM sqlite_master': tableNotExistsResult,
    })

    const result = await handleCreateTable({
      def: {
        name: 'test_table',
        columns: [
          { name: 'id', type: 'INTEGER', primaryKey: 1 },
          { name: 'name', type: 'TEXT', notNull: true },
        ],
      },
      query: executor,
      isReadOnly: false,
    })

    expect(result.success).toBe(true)
    expect(result.error).toBeUndefined()

    // Verify transaction and CREATE TABLE were executed
    const sqlStatements = queries.map((q) => q.sql)
    expect(sqlStatements).toContain('BEGIN TRANSACTION')
    expect(sqlStatements).toContain('COMMIT')
    expect(sqlStatements.some((s) => s.includes('CREATE TABLE'))).toBe(true)
    expect(sqlStatements.some((s) => s.includes('test_table'))).toBe(true)
  })

  it('rejects duplicate table name', async () => {
    const { executor } = createMockQueryExecutor({
      'SELECT 1 FROM sqlite_master': tableExistsResult,
    })

    const result = await handleCreateTable({
      def: {
        name: 'existing_table',
        columns: [{ name: 'id', type: 'INTEGER' }],
      },
      query: executor,
      isReadOnly: false,
    })

    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('TABLE_EXISTS')
    expect(result.error?.message).toContain('already exists')
  })

  it('rejects invalid table name', async () => {
    const { executor } = createMockQueryExecutor()

    const result = await handleCreateTable({
      def: {
        name: '',
        columns: [{ name: 'id', type: 'INTEGER' }],
      },
      query: executor,
      isReadOnly: false,
    })

    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('INVALID_NAME')
  })

  it('rejects invalid column name', async () => {
    const { executor } = createMockQueryExecutor()

    const result = await handleCreateTable({
      def: {
        name: 'test_table',
        columns: [{ name: '\x00bad', type: 'INTEGER' }],
      },
      query: executor,
      isReadOnly: false,
    })

    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('INVALID_NAME')
  })

  it('rolls back on SQL error', async () => {
    const { executor, queries } = createMockQueryExecutor({
      'SELECT 1 FROM sqlite_master': tableNotExistsResult,
      'CREATE TABLE': new Error('syntax error'),
    })

    const result = await handleCreateTable({
      def: {
        name: 'test_table',
        columns: [{ name: 'id', type: 'INVALID_TYPE_HERE' }],
      },
      query: executor,
      isReadOnly: false,
    })

    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('SYNTAX_ERROR')

    // Verify rollback was attempted
    const sqlStatements = queries.map((q) => q.sql)
    expect(sqlStatements).toContain('ROLLBACK')
  })
})

// =============================================================================
// alterTable Tests
// =============================================================================

describe('handleAlterTable', () => {
  describe('addColumn', () => {
    it('rejects in read-only mode', async () => {
      const { executor } = createMockQueryExecutor()

      const result = await handleAlterTable({
        table: 'users',
        action: { type: 'addColumn', column: { name: 'age', type: 'INTEGER' } },
        query: executor,
        isReadOnly: true,
      })

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('READ_ONLY')
    })

    it('adds column successfully', async () => {
      const { executor, queries } = createMockQueryExecutor({
        'SELECT 1 FROM sqlite_master': tableExistsResult,
        'PRAGMA table_info': {
          columns: ['cid', 'name', 'type', 'notnull', 'dflt_value', 'pk'],
          columnTypes: ['INTEGER', 'TEXT', 'TEXT', 'INTEGER', 'TEXT', 'INTEGER'],
          rows: [[0, 'id', 'INTEGER', 0, null, 1]],
        },
      })

      const result = await handleAlterTable({
        table: 'users',
        action: { type: 'addColumn', column: { name: 'age', type: 'INTEGER' } },
        query: executor,
        isReadOnly: false,
      })

      expect(result.success).toBe(true)

      // Verify ALTER TABLE ADD COLUMN was executed
      const sqlStatements = queries.map((q) => q.sql)
      expect(sqlStatements.some((s) => s.includes('ALTER TABLE'))).toBe(true)
      expect(sqlStatements.some((s) => s.includes('ADD COLUMN'))).toBe(true)
    })

    it('rejects when table does not exist', async () => {
      const { executor } = createMockQueryExecutor({
        'SELECT 1 FROM sqlite_master': tableNotExistsResult,
      })

      const result = await handleAlterTable({
        table: 'nonexistent',
        action: { type: 'addColumn', column: { name: 'age', type: 'INTEGER' } },
        query: executor,
        isReadOnly: false,
      })

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('TABLE_NOT_FOUND')
    })

    it('rejects when column already exists', async () => {
      const { executor } = createMockQueryExecutor({
        'SELECT 1 FROM sqlite_master': tableExistsResult,
        'PRAGMA table_info': {
          columns: ['cid', 'name', 'type', 'notnull', 'dflt_value', 'pk'],
          columnTypes: ['INTEGER', 'TEXT', 'TEXT', 'INTEGER', 'TEXT', 'INTEGER'],
          rows: [
            [0, 'id', 'INTEGER', 0, null, 1],
            [1, 'age', 'INTEGER', 0, null, 0],
          ],
        },
      })

      const result = await handleAlterTable({
        table: 'users',
        action: { type: 'addColumn', column: { name: 'age', type: 'INTEGER' } },
        query: executor,
        isReadOnly: false,
      })

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('COLUMN_EXISTS')
    })
  })

  describe('renameTable', () => {
    it('renames table successfully', async () => {
      const queries: { sql: string; params?: unknown[] }[] = []

      // Mock: first call (old table exists) returns result, second call (new table) returns empty
      let tableExistsCallCount = 0
      const executor: QueryExecutor = vi.fn(async (sql: string, params?: unknown[]) => {
        queries.push({ sql, params })

        if (sql.includes('SELECT 1 FROM sqlite_master')) {
          tableExistsCallCount++
          // First call: check old table exists - return exists
          // Second call: check new table exists - return not exists
          if (tableExistsCallCount === 1) {
            return tableExistsResult
          } else {
            return tableNotExistsResult
          }
        }
        return emptyResult
      })

      const result = await handleAlterTable({
        table: 'old_name',
        action: { type: 'renameTable', newName: 'new_name' },
        query: executor,
        isReadOnly: false,
      })

      expect(result.success).toBe(true)

      // Verify RENAME TO was in one of the queries
      const sqlStatements = queries.map((q) => q.sql)
      expect(sqlStatements.some((s) => s.includes('RENAME TO'))).toBe(true)
    })

    it('rejects when new name already exists', async () => {
      const { executor } = createMockQueryExecutor()

      // Both old and new table exist
      ;(executor as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        return tableExistsResult
      })

      const result = await handleAlterTable({
        table: 'old_name',
        action: { type: 'renameTable', newName: 'existing_table' },
        query: executor,
        isReadOnly: false,
      })

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('TABLE_EXISTS')
    })
  })

  describe('renameColumn', () => {
    it('renames column successfully', async () => {
      const { executor, queries } = createMockQueryExecutor({
        'SELECT 1 FROM sqlite_master': tableExistsResult,
        'PRAGMA table_info': {
          columns: ['cid', 'name', 'type', 'notnull', 'dflt_value', 'pk'],
          columnTypes: ['INTEGER', 'TEXT', 'TEXT', 'INTEGER', 'TEXT', 'INTEGER'],
          rows: [[0, 'old_col', 'TEXT', 0, null, 0]],
        },
      })

      const result = await handleAlterTable({
        table: 'users',
        action: { type: 'renameColumn', oldName: 'old_col', newName: 'new_col' },
        query: executor,
        isReadOnly: false,
      })

      expect(result.success).toBe(true)

      // Verify RENAME COLUMN was executed
      const sqlStatements = queries.map((q) => q.sql)
      expect(sqlStatements.some((s) => s.includes('RENAME COLUMN'))).toBe(true)
    })

    it('rejects when old column does not exist', async () => {
      const { executor } = createMockQueryExecutor({
        'SELECT 1 FROM sqlite_master': tableExistsResult,
        'PRAGMA table_info': {
          columns: ['cid', 'name', 'type', 'notnull', 'dflt_value', 'pk'],
          columnTypes: ['INTEGER', 'TEXT', 'TEXT', 'INTEGER', 'TEXT', 'INTEGER'],
          rows: [[0, 'other_col', 'TEXT', 0, null, 0]],
        },
      })

      const result = await handleAlterTable({
        table: 'users',
        action: { type: 'renameColumn', oldName: 'nonexistent', newName: 'new_col' },
        query: executor,
        isReadOnly: false,
      })

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('COLUMN_NOT_FOUND')
    })

    it('rejects when new column name already exists', async () => {
      const { executor } = createMockQueryExecutor({
        'SELECT 1 FROM sqlite_master': tableExistsResult,
        'PRAGMA table_info': {
          columns: ['cid', 'name', 'type', 'notnull', 'dflt_value', 'pk'],
          columnTypes: ['INTEGER', 'TEXT', 'TEXT', 'INTEGER', 'TEXT', 'INTEGER'],
          rows: [
            [0, 'old_col', 'TEXT', 0, null, 0],
            [1, 'existing_col', 'TEXT', 0, null, 0],
          ],
        },
      })

      const result = await handleAlterTable({
        table: 'users',
        action: { type: 'renameColumn', oldName: 'old_col', newName: 'existing_col' },
        query: executor,
        isReadOnly: false,
      })

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('COLUMN_EXISTS')
    })
  })
})

// =============================================================================
// dropTable Tests
// =============================================================================

describe('handleDropTable', () => {
  it('rejects in read-only mode', async () => {
    const { executor } = createMockQueryExecutor()

    const result = await handleDropTable({
      table: 'users',
      query: executor,
      isReadOnly: true,
    })

    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('READ_ONLY')
  })

  it('drops table successfully when no dependencies', async () => {
    const { executor, queries } = createMockQueryExecutor({
      'SELECT 1 FROM sqlite_master WHERE type': tableExistsResult,
      "SELECT name FROM sqlite_master WHERE type = 'table'": {
        columns: ['name'],
        columnTypes: ['TEXT'],
        rows: [['users'], ['orders']],
      },
      'PRAGMA foreign_key_list': emptyResult,
    })

    const result = await handleDropTable({
      table: 'users',
      query: executor,
      isReadOnly: false,
    })

    expect(result.success).toBe(true)

    // Verify DROP TABLE was executed
    const sqlStatements = queries.map((q) => q.sql)
    expect(sqlStatements.some((s) => s.includes('DROP TABLE'))).toBe(true)
  })

  it('rejects when table does not exist', async () => {
    const { executor } = createMockQueryExecutor({
      'SELECT 1 FROM sqlite_master': tableNotExistsResult,
    })

    const result = await handleDropTable({
      table: 'nonexistent',
      query: executor,
      isReadOnly: false,
    })

    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('TABLE_NOT_FOUND')
  })

  it('rejects when table has incoming foreign keys', async () => {
    const { executor } = createMockQueryExecutor({
      'SELECT 1 FROM sqlite_master WHERE type': tableExistsResult,
      "SELECT name FROM sqlite_master WHERE type = 'table'": {
        columns: ['name'],
        columnTypes: ['TEXT'],
        rows: [['users'], ['orders']],
      },
    })

    // Mock FK check to show orders references users
    let fkCallCount = 0
    ;(executor as ReturnType<typeof vi.fn>).mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT 1 FROM sqlite_master WHERE type')) {
        return tableExistsResult
      }
      if (sql.includes("SELECT name FROM sqlite_master WHERE type = 'table'")) {
        return {
          columns: ['name'],
          columnTypes: ['TEXT'],
          rows: [['users'], ['orders']],
        }
      }
      if (sql.includes('PRAGMA foreign_key_list')) {
        fkCallCount++
        // First call is for 'orders' table (since we skip 'users' which is the target)
        if (fkCallCount === 1) {
          return {
            columns: ['id', 'seq', 'table', 'from', 'to', 'on_update', 'on_delete', 'match'],
            columnTypes: ['INTEGER', 'INTEGER', 'TEXT', 'TEXT', 'TEXT', 'TEXT', 'TEXT', 'TEXT'],
            rows: [[0, 0, 'users', 'user_id', 'id', 'NO ACTION', 'CASCADE', 'NONE']],
          }
        }
      }
      return emptyResult
    })

    const result = await handleDropTable({
      table: 'users',
      query: executor,
      isReadOnly: false,
    })

    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('FOREIGN_KEY_DEPENDENCY')
    expect(result.error?.details).toContain('orders')
  })
})

// =============================================================================
// dropColumn Tests
// =============================================================================

describe('handleDropColumn', () => {
  it('rejects in read-only mode', async () => {
    const { executor } = createMockQueryExecutor()

    const result = await handleDropColumn({
      table: 'users',
      column: 'age',
      query: executor,
      isReadOnly: true,
    })

    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('READ_ONLY')
  })

  it('drops column successfully (SQLite 3.35+)', async () => {
    const { executor, queries } = createMockQueryExecutor({
      'SELECT 1 FROM sqlite_master': tableExistsResult,
      'PRAGMA table_info': {
        columns: ['cid', 'name', 'type', 'notnull', 'dflt_value', 'pk'],
        columnTypes: ['INTEGER', 'TEXT', 'TEXT', 'INTEGER', 'TEXT', 'INTEGER'],
        rows: [
          [0, 'id', 'INTEGER', 0, null, 1],
          [1, 'age', 'INTEGER', 0, null, 0],
          [2, 'name', 'TEXT', 0, null, 0],
        ],
      },
    })

    const result = await handleDropColumn({
      table: 'users',
      column: 'age',
      query: executor,
      isReadOnly: false,
    })

    expect(result.success).toBe(true)

    // Verify DROP COLUMN was executed
    const sqlStatements = queries.map((q) => q.sql)
    expect(sqlStatements.some((s) => s.includes('DROP COLUMN'))).toBe(true)
    expect(sqlStatements.some((s) => s.includes('age'))).toBe(true)
  })

  it('rejects when table does not exist', async () => {
    const { executor } = createMockQueryExecutor({
      'SELECT 1 FROM sqlite_master': tableNotExistsResult,
    })

    const result = await handleDropColumn({
      table: 'nonexistent',
      column: 'age',
      query: executor,
      isReadOnly: false,
    })

    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('TABLE_NOT_FOUND')
  })

  it('rejects when column does not exist', async () => {
    const { executor } = createMockQueryExecutor({
      'SELECT 1 FROM sqlite_master': tableExistsResult,
      'PRAGMA table_info': {
        columns: ['cid', 'name', 'type', 'notnull', 'dflt_value', 'pk'],
        columnTypes: ['INTEGER', 'TEXT', 'TEXT', 'INTEGER', 'TEXT', 'INTEGER'],
        rows: [[0, 'id', 'INTEGER', 0, null, 1]],
      },
    })

    const result = await handleDropColumn({
      table: 'users',
      column: 'nonexistent',
      query: executor,
      isReadOnly: false,
    })

    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('COLUMN_NOT_FOUND')
  })

  it('returns constraint error when column is in primary key', async () => {
    const { executor } = createMockQueryExecutor({
      'SELECT 1 FROM sqlite_master': tableExistsResult,
      'PRAGMA table_info': {
        columns: ['cid', 'name', 'type', 'notnull', 'dflt_value', 'pk'],
        columnTypes: ['INTEGER', 'TEXT', 'TEXT', 'INTEGER', 'TEXT', 'INTEGER'],
        rows: [[0, 'id', 'INTEGER', 0, null, 1]],
      },
      'DROP COLUMN': new Error('cannot drop PRIMARY KEY column'),
    })

    const result = await handleDropColumn({
      table: 'users',
      column: 'id',
      query: executor,
      isReadOnly: false,
    })

    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('CONSTRAINT_VIOLATION')
  })
})

// =============================================================================
// Helper Function Tests
// =============================================================================

describe('tableExists', () => {
  it('returns true when table exists', async () => {
    const { executor } = createMockQueryExecutor({
      'SELECT 1 FROM sqlite_master': tableExistsResult,
    })

    const exists = await tableExists(executor, 'users')
    expect(exists).toBe(true)
  })

  it('returns false when table does not exist', async () => {
    const { executor } = createMockQueryExecutor({
      'SELECT 1 FROM sqlite_master': tableNotExistsResult,
    })

    const exists = await tableExists(executor, 'nonexistent')
    expect(exists).toBe(false)
  })
})

describe('columnExists', () => {
  it('returns true when column exists', async () => {
    const { executor } = createMockQueryExecutor({
      'PRAGMA table_info': {
        columns: ['cid', 'name', 'type', 'notnull', 'dflt_value', 'pk'],
        columnTypes: ['INTEGER', 'TEXT', 'TEXT', 'INTEGER', 'TEXT', 'INTEGER'],
        rows: [
          [0, 'id', 'INTEGER', 0, null, 1],
          [1, 'name', 'TEXT', 0, null, 0],
        ],
      },
    })

    const exists = await columnExists(executor, 'users', 'name')
    expect(exists).toBe(true)
  })

  it('returns false when column does not exist', async () => {
    const { executor } = createMockQueryExecutor({
      'PRAGMA table_info': {
        columns: ['cid', 'name', 'type', 'notnull', 'dflt_value', 'pk'],
        columnTypes: ['INTEGER', 'TEXT', 'TEXT', 'INTEGER', 'TEXT', 'INTEGER'],
        rows: [[0, 'id', 'INTEGER', 0, null, 1]],
      },
    })

    const exists = await columnExists(executor, 'users', 'nonexistent')
    expect(exists).toBe(false)
  })
})

describe('getIncomingForeignKeys', () => {
  it('returns foreign keys referencing the table', async () => {
    const { executor } = createMockQueryExecutor()

    ;(executor as ReturnType<typeof vi.fn>).mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT name FROM sqlite_master WHERE type = 'table'")) {
        return {
          columns: ['name'],
          columnTypes: ['TEXT'],
          rows: [['users'], ['orders']],
        }
      }
      if (sql.includes('PRAGMA foreign_key_list') && sql.includes('orders')) {
        return {
          columns: ['id', 'seq', 'table', 'from', 'to', 'on_update', 'on_delete', 'match'],
          columnTypes: ['INTEGER', 'INTEGER', 'TEXT', 'TEXT', 'TEXT', 'TEXT', 'TEXT', 'TEXT'],
          rows: [[0, 0, 'users', 'user_id', 'id', 'NO_ACTION', 'CASCADE', 'NONE']],
        }
      }
      return emptyResult
    })

    const fks = await getIncomingForeignKeys(executor, 'users')

    expect(fks).toHaveLength(1)
    expect(fks[0].childTable).toBe('orders')
    expect(fks[0].childColumn).toBe('user_id')
    expect(fks[0].parentTable).toBe('users')
    expect(fks[0].parentColumn).toBe('id')
  })

  it('returns empty array when no incoming FKs', async () => {
    const { executor } = createMockQueryExecutor({
      "SELECT name FROM sqlite_master WHERE type = 'table'": {
        columns: ['name'],
        columnTypes: ['TEXT'],
        rows: [['users'], ['products']],
      },
      'PRAGMA foreign_key_list': emptyResult,
    })

    const fks = await getIncomingForeignKeys(executor, 'users')
    expect(fks).toHaveLength(0)
  })
})

describe('checkTableDependencies', () => {
  it('returns null when no dependencies', async () => {
    const { executor } = createMockQueryExecutor({
      "SELECT name FROM sqlite_master WHERE type = 'table'": {
        columns: ['name'],
        columnTypes: ['TEXT'],
        rows: [['users']],
      },
      'PRAGMA foreign_key_list': emptyResult,
    })

    const error = await checkTableDependencies(executor, 'users')
    expect(error).toBeNull()
  })

  it('returns error when dependencies exist', async () => {
    const { executor } = createMockQueryExecutor()

    ;(executor as ReturnType<typeof vi.fn>).mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT name FROM sqlite_master WHERE type = 'table'")) {
        return {
          columns: ['name'],
          columnTypes: ['TEXT'],
          rows: [['users'], ['orders'], ['invoices']],
        }
      }
      if (sql.includes('PRAGMA foreign_key_list')) {
        if (sql.includes('orders')) {
          return {
            columns: ['id', 'seq', 'table', 'from', 'to', 'on_update', 'on_delete', 'match'],
            columnTypes: ['INTEGER', 'INTEGER', 'TEXT', 'TEXT', 'TEXT', 'TEXT', 'TEXT', 'TEXT'],
            rows: [[0, 0, 'users', 'user_id', 'id', 'NO_ACTION', 'CASCADE', 'NONE']],
          }
        }
        if (sql.includes('invoices')) {
          return {
            columns: ['id', 'seq', 'table', 'from', 'to', 'on_update', 'on_delete', 'match'],
            columnTypes: ['INTEGER', 'INTEGER', 'TEXT', 'TEXT', 'TEXT', 'TEXT', 'TEXT', 'TEXT'],
            rows: [[0, 0, 'users', 'customer_id', 'id', 'NO_ACTION', 'RESTRICT', 'NONE']],
          }
        }
      }
      return emptyResult
    })

    const error = await checkTableDependencies(executor, 'users')

    expect(error).not.toBeNull()
    expect(error?.code).toBe('FOREIGN_KEY_DEPENDENCY')
    expect(error?.details).toContain('orders')
    expect(error?.details).toContain('invoices')
  })
})

// =============================================================================
// SQL Injection Prevention Tests
// =============================================================================

describe('SQL injection prevention', () => {
  it('handles table names with special characters safely', async () => {
    const { executor, queries } = createMockQueryExecutor({
      'SELECT 1 FROM sqlite_master': tableNotExistsResult,
    })

    await handleCreateTable({
      def: {
        name: 'Robert\'); DROP TABLE Students;--',
        columns: [{ name: 'id', type: 'INTEGER' }],
      },
      query: executor,
      isReadOnly: false,
    })

    // The table name should be quoted properly - check it doesn't execute DROP TABLE
    const sqlStatements = queries.map((q) => q.sql)
    const createStmt = sqlStatements.find((s) => s.includes('CREATE TABLE'))
    if (createStmt) {
      // The malicious table name should be quoted, not executed as separate SQL
      expect(createStmt).toContain('"Robert\'); DROP TABLE Students;--"')
    }
  })

  it('handles column names with SQL injection attempts safely', async () => {
    const { executor, queries } = createMockQueryExecutor({
      'SELECT 1 FROM sqlite_master': tableNotExistsResult,
    })

    await handleCreateTable({
      def: {
        name: 'safe_table',
        columns: [{ name: 'id"; DELETE FROM users;--', type: 'INTEGER' }],
      },
      query: executor,
      isReadOnly: false,
    })

    // The column name should be quoted properly
    const sqlStatements = queries.map((q) => q.sql)
    const createStmt = sqlStatements.find((s) => s.includes('CREATE TABLE'))
    if (createStmt) {
      expect(createStmt).toContain('"id""; DELETE FROM users;--"')
    }
  })
})

// =============================================================================
// Transaction Boundary Tests
// =============================================================================

describe('transaction boundaries', () => {
  it('createTable wraps in transaction', async () => {
    const { executor, queries } = createMockQueryExecutor({
      'SELECT 1 FROM sqlite_master': tableNotExistsResult,
    })

    await handleCreateTable({
      def: {
        name: 'test',
        columns: [{ name: 'id', type: 'INTEGER' }],
      },
      query: executor,
      isReadOnly: false,
    })

    const sqlStatements = queries.map((q) => q.sql)
    const beginIndex = sqlStatements.indexOf('BEGIN TRANSACTION')
    const commitIndex = sqlStatements.indexOf('COMMIT')

    expect(beginIndex).toBeGreaterThanOrEqual(0)
    expect(commitIndex).toBeGreaterThan(beginIndex)
  })

  it('alterTable wraps in transaction', async () => {
    const { executor, queries } = createMockQueryExecutor({
      'SELECT 1 FROM sqlite_master': tableExistsResult,
      'PRAGMA table_info': {
        columns: ['cid', 'name', 'type', 'notnull', 'dflt_value', 'pk'],
        columnTypes: ['INTEGER', 'TEXT', 'TEXT', 'INTEGER', 'TEXT', 'INTEGER'],
        rows: [[0, 'id', 'INTEGER', 0, null, 1]],
      },
    })

    await handleAlterTable({
      table: 'test',
      action: { type: 'addColumn', column: { name: 'col', type: 'TEXT' } },
      query: executor,
      isReadOnly: false,
    })

    const sqlStatements = queries.map((q) => q.sql)
    expect(sqlStatements).toContain('BEGIN TRANSACTION')
    expect(sqlStatements).toContain('COMMIT')
  })

  it('dropTable wraps in transaction', async () => {
    const { executor, queries } = createMockQueryExecutor({
      'SELECT 1 FROM sqlite_master WHERE type': tableExistsResult,
      "SELECT name FROM sqlite_master WHERE type = 'table'": {
        columns: ['name'],
        columnTypes: ['TEXT'],
        rows: [['test']],
      },
      'PRAGMA foreign_key_list': emptyResult,
    })

    await handleDropTable({
      table: 'test',
      query: executor,
      isReadOnly: false,
    })

    const sqlStatements = queries.map((q) => q.sql)
    expect(sqlStatements).toContain('BEGIN TRANSACTION')
    expect(sqlStatements).toContain('COMMIT')
  })

  it('dropColumn wraps in transaction', async () => {
    const { executor, queries } = createMockQueryExecutor({
      'SELECT 1 FROM sqlite_master': tableExistsResult,
      'PRAGMA table_info': {
        columns: ['cid', 'name', 'type', 'notnull', 'dflt_value', 'pk'],
        columnTypes: ['INTEGER', 'TEXT', 'TEXT', 'INTEGER', 'TEXT', 'INTEGER'],
        rows: [
          [0, 'id', 'INTEGER', 0, null, 1],
          [1, 'col', 'TEXT', 0, null, 0],
        ],
      },
    })

    await handleDropColumn({
      table: 'test',
      column: 'col',
      query: executor,
      isReadOnly: false,
    })

    const sqlStatements = queries.map((q) => q.sql)
    expect(sqlStatements).toContain('BEGIN TRANSACTION')
    expect(sqlStatements).toContain('COMMIT')
  })
})
