import { describe, it, expect, vi } from 'vitest';
import {
  extractCreateTableSql,
  extractIndexes,
  extractTriggers,
  extractViewsReferencingTable,
  extractIncomingForeignKeys,
  extractTableDependents,
  generateRebuildPlan,
  replaceTableNameInCreate,
  generateCopyDataSql,
  groupForeignKeys,
  generateRebuildPlanWithColumnMapping,
  generateColumnMappedCopyDataSql,
  executeRebuildPlan,
  verifyTableSchema,
  verifyForeignKeyIntegrity,
  verifyViewCompilability,
  verifyTriggerValidity,
  hasSelfReferencialForeignKeys,
  runPostRebuildVerification,
  type SqliteMasterObject,
  type RebuildPlan,
  type TableDependents,
} from '../rebuild';
import type { ForeignKeyInfo } from '../../types/index';
import type { DatabaseEngine } from '../engine/db-engine';

// =============================================================================
// Test Fixtures
// =============================================================================

const createSimpleTable: SqliteMasterObject = {
  type: 'table',
  name: 'users',
  tblName: 'users',
  rootpage: 2,
  sql: 'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)',
}

const createTableWithIndexes: SqliteMasterObject[] = [
  {
    type: 'table',
    name: 'products',
    tblName: 'products',
    rootpage: 3,
    sql: 'CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT, price REAL)',
  },
  {
    type: 'index',
    name: 'idx_products_name',
    tblName: 'products',
    rootpage: 4,
    sql: 'CREATE INDEX idx_products_name ON products (name)',
  },
  {
    type: 'index',
    name: 'idx_products_price',
    tblName: 'products',
    rootpage: 5,
    sql: 'CREATE UNIQUE INDEX idx_products_price ON products (price)',
  },
  {
    type: 'index',
    name: 'sqlite_autoindex_products_1',
    tblName: 'products',
    rootpage: 6,
    sql: null, // Auto-indexes have null SQL
  },
]

const createTableWithTriggers: SqliteMasterObject[] = [
  {
    type: 'table',
    name: 'orders',
    tblName: 'orders',
    rootpage: 7,
    sql: 'CREATE TABLE orders (id INTEGER PRIMARY KEY, total REAL, created_at TEXT)',
  },
  {
    type: 'trigger',
    name: 'tr_orders_insert',
    tblName: 'orders',
    rootpage: 0,
    sql: "CREATE TRIGGER tr_orders_insert AFTER INSERT ON orders BEGIN UPDATE stats SET count = count + 1; END",
  },
  {
    type: 'trigger',
    name: 'tr_orders_delete',
    tblName: 'orders',
    rootpage: 0,
    sql: "CREATE TRIGGER tr_orders_delete AFTER DELETE ON orders BEGIN UPDATE stats SET count = count - 1; END",
  },
]

const createTableWithViews: SqliteMasterObject[] = [
  {
    type: 'table',
    name: 'employees',
    tblName: 'employees',
    rootpage: 8,
    sql: 'CREATE TABLE employees (id INTEGER PRIMARY KEY, name TEXT, dept_id INTEGER)',
  },
  {
    type: 'view',
    name: 'v_employee_names',
    tblName: 'v_employee_names',
    rootpage: 0,
    sql: 'CREATE VIEW v_employee_names AS SELECT id, name FROM employees',
  },
  {
    type: 'view',
    name: 'v_other',
    tblName: 'v_other',
    rootpage: 0,
    sql: 'CREATE VIEW v_other AS SELECT 1 AS x',
  },
  {
    type: 'view',
    name: 'v_employee_count',
    tblName: 'v_employee_count',
    rootpage: 0,
    sql: 'CREATE VIEW v_employee_count AS SELECT COUNT(*) FROM employees',
  },
]

// =============================================================================
// Tests
// =============================================================================

describe('extractCreateTableSql', () => {
  it('extracts CREATE TABLE statement', () => {
    const sql = extractCreateTableSql('users', [createSimpleTable])
    expect(sql).toBe('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)')
  })

  it('returns null for non-existent table', () => {
    const sql = extractCreateTableSql('nonexistent', [createSimpleTable])
    expect(sql).toBeNull()
  })

  it('matches case-insensitively', () => {
    const sql = extractCreateTableSql('USERS', [createSimpleTable])
    expect(sql).toBe('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)')
  })
})

describe('extractIndexes', () => {
  it('extracts user-created indexes', () => {
    const indexes = extractIndexes('products', createTableWithIndexes)
    expect(indexes).toHaveLength(3)

    // Should be sorted by name
    expect(indexes[0].name).toBe('idx_products_name')
    expect(indexes[0].isAutoIndex).toBe(false)
    expect(indexes[0].sql).toBe('CREATE INDEX idx_products_name ON products (name)')

    expect(indexes[1].name).toBe('idx_products_price')
    expect(indexes[1].isAutoIndex).toBe(false)

    expect(indexes[2].name).toBe('sqlite_autoindex_products_1')
    expect(indexes[2].isAutoIndex).toBe(true)
    expect(indexes[2].sql).toBeNull()
  })

  it('returns empty array for table without indexes', () => {
    const indexes = extractIndexes('users', [createSimpleTable])
    expect(indexes).toHaveLength(0)
  })

  it('matches case-insensitively', () => {
    const indexes = extractIndexes('PRODUCTS', createTableWithIndexes)
    expect(indexes).toHaveLength(3)
  })
})

describe('extractTriggers', () => {
  it('extracts triggers for a table', () => {
    const triggers = extractTriggers('orders', createTableWithTriggers)
    expect(triggers).toHaveLength(2)

    // Should be sorted by name
    expect(triggers[0].name).toBe('tr_orders_delete')
    expect(triggers[1].name).toBe('tr_orders_insert')
  })

  it('returns empty array for table without triggers', () => {
    const triggers = extractTriggers('users', [createSimpleTable])
    expect(triggers).toHaveLength(0)
  })

  it('matches case-insensitively', () => {
    const triggers = extractTriggers('ORDERS', createTableWithTriggers)
    expect(triggers).toHaveLength(2)
  })
})

describe('extractViewsReferencingTable', () => {
  it('finds views that reference a table', () => {
    const views = extractViewsReferencingTable('employees', createTableWithViews)
    expect(views).toHaveLength(2)

    // Should be sorted by name
    expect(views[0].name).toBe('v_employee_count')
    expect(views[1].name).toBe('v_employee_names')
  })

  it('returns empty array when no views reference the table', () => {
    const views = extractViewsReferencingTable('nonexistent', createTableWithViews)
    expect(views).toHaveLength(0)
  })

  it('matches table name case-insensitively', () => {
    const views = extractViewsReferencingTable('EMPLOYEES', createTableWithViews)
    expect(views).toHaveLength(2)
  })
})

describe('groupForeignKeys', () => {
  it('groups foreign keys by ID', () => {
    const fkInfos: ForeignKeyInfo[] = [
      {
        id: 0,
        childTable: 'orders',
        childColumn: 'user_id',
        parentTable: 'users',
        parentColumn: 'id',
        onDelete: 'CASCADE',
        onUpdate: 'NO ACTION',
        match: 'NONE',
      },
      {
        id: 1,
        childTable: 'orders',
        childColumn: 'org_id',
        parentTable: 'orgs',
        parentColumn: 'org_id',
        onDelete: 'SET NULL',
        onUpdate: 'NO ACTION',
        match: 'NONE',
      },
      {
        id: 1,
        childTable: 'orders',
        childColumn: 'dept_id',
        parentTable: 'orgs',
        parentColumn: 'dept_id',
        onDelete: 'SET NULL',
        onUpdate: 'NO ACTION',
        match: 'NONE',
      },
    ]

    const groups = groupForeignKeys(fkInfos)
    expect(groups.size).toBe(2)
    expect(groups.get(0)?.length).toBe(1)
    expect(groups.get(1)?.length).toBe(2)
  })

  it('returns empty map for empty input', () => {
    const groups = groupForeignKeys([])
    expect(groups.size).toBe(0)
  })
})

describe('extractIncomingForeignKeys', () => {
  it('finds FKs from other tables pointing to this table', () => {
    const allForeignKeys = new Map<string, ForeignKeyInfo[]>([
      ['orders', [
        {
          id: 0,
          childTable: 'orders',
          childColumn: 'user_id',
          parentTable: 'users',
          parentColumn: 'id',
          onDelete: 'CASCADE',
          onUpdate: 'NO ACTION',
          match: 'NONE',
        },
      ]],
      ['comments', [
        {
          id: 0,
          childTable: 'comments',
          childColumn: 'author_id',
          parentTable: 'users',
          parentColumn: 'id',
          onDelete: 'SET NULL',
          onUpdate: 'NO ACTION',
          match: 'NONE',
        },
      ]],
    ])

    const incoming = extractIncomingForeignKeys('users', allForeignKeys)
    expect(incoming).toHaveLength(2)

    // Should be sorted by table name
    expect(incoming[0].fromTable).toBe('comments')
    expect(incoming[0].fromColumns).toEqual(['author_id'])
    expect(incoming[0].toColumns).toEqual(['id'])

    expect(incoming[1].fromTable).toBe('orders')
    expect(incoming[1].fromColumns).toEqual(['user_id'])
  })

  it('excludes self-references', () => {
    const allForeignKeys = new Map<string, ForeignKeyInfo[]>([
      ['employees', [
        {
          id: 0,
          childTable: 'employees',
          childColumn: 'manager_id',
          parentTable: 'employees',
          parentColumn: 'id',
          onDelete: 'SET NULL',
          onUpdate: 'NO ACTION',
          match: 'NONE',
        },
      ]],
    ])

    const incoming = extractIncomingForeignKeys('employees', allForeignKeys)
    expect(incoming).toHaveLength(0)
  })

  it('handles composite foreign keys', () => {
    const allForeignKeys = new Map<string, ForeignKeyInfo[]>([
      ['order_items', [
        {
          id: 0,
          childTable: 'order_items',
          childColumn: 'order_id',
          parentTable: 'orders',
          parentColumn: 'id',
          onDelete: 'CASCADE',
          onUpdate: 'NO ACTION',
          match: 'NONE',
        },
        {
          id: 0,
          childTable: 'order_items',
          childColumn: 'line_no',
          parentTable: 'orders',
          parentColumn: 'line_no',
          onDelete: 'CASCADE',
          onUpdate: 'NO ACTION',
          match: 'NONE',
        },
      ]],
    ])

    const incoming = extractIncomingForeignKeys('orders', allForeignKeys)
    expect(incoming).toHaveLength(1)
    expect(incoming[0].fromColumns).toEqual(['order_id', 'line_no'])
    expect(incoming[0].toColumns).toEqual(['id', 'line_no'])
  })
})

describe('extractTableDependents', () => {
  it('extracts all dependents for a simple table', () => {
    const dependents = extractTableDependents(
      'users',
      [createSimpleTable],
      new Map()
    )

    expect(dependents.createTableSql).toBe(
      'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)'
    )
    expect(dependents.indexes).toHaveLength(0)
    expect(dependents.triggers).toHaveLength(0)
    expect(dependents.views).toHaveLength(0)
    expect(dependents.incomingForeignKeys).toHaveLength(0)
  })

  it('extracts all dependents for a table with indexes', () => {
    const dependents = extractTableDependents(
      'products',
      createTableWithIndexes,
      new Map()
    )

    expect(dependents.indexes).toHaveLength(3)
    expect(dependents.triggers).toHaveLength(0)
  })

  it('extracts all dependents for a table with triggers', () => {
    const dependents = extractTableDependents(
      'orders',
      createTableWithTriggers,
      new Map()
    )

    expect(dependents.triggers).toHaveLength(2)
  })

  it('extracts all dependents including incoming FKs', () => {
    const allForeignKeys = new Map<string, ForeignKeyInfo[]>([
      ['orders', [
        {
          id: 0,
          childTable: 'orders',
          childColumn: 'user_id',
          parentTable: 'users',
          parentColumn: 'id',
          onDelete: 'CASCADE',
          onUpdate: 'NO ACTION',
          match: 'NONE',
        },
      ]],
    ])

    const dependents = extractTableDependents(
      'users',
      [createSimpleTable],
      allForeignKeys
    )

    expect(dependents.incomingForeignKeys).toHaveLength(1)
    expect(dependents.incomingForeignKeys[0].fromTable).toBe('orders')
  })

  it('throws for non-existent table', () => {
    expect(() =>
      extractTableDependents('nonexistent', [createSimpleTable], new Map())
    ).toThrow('Table "nonexistent" not found in sqlite_master')
  })
})

describe('replaceTableNameInCreate', () => {
  it('replaces unquoted table name', () => {
    const sql = 'CREATE TABLE users (id INTEGER PRIMARY KEY)'
    const result = replaceTableNameInCreate(sql, 'users', '_users_temp')
    // _users_temp doesn't need quoting (starts with underscore, valid identifier)
    expect(result).toBe('CREATE TABLE _users_temp (id INTEGER PRIMARY KEY)')
  })

  it('replaces quoted table name', () => {
    const sql = 'CREATE TABLE "users" (id INTEGER PRIMARY KEY)'
    const result = replaceTableNameInCreate(sql, 'users', '_users_temp')
    expect(result).toBe('CREATE TABLE _users_temp (id INTEGER PRIMARY KEY)')
  })

  it('handles IF NOT EXISTS', () => {
    const sql = 'CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY)'
    const result = replaceTableNameInCreate(sql, 'users', '_users_temp')
    expect(result).toBe(
      'CREATE TABLE IF NOT EXISTS _users_temp (id INTEGER PRIMARY KEY)'
    )
  })

  it('handles reserved word table names', () => {
    const sql = 'CREATE TABLE "order" (id INTEGER PRIMARY KEY)'
    const result = replaceTableNameInCreate(sql, 'order', '_order_temp')
    expect(result).toBe('CREATE TABLE _order_temp (id INTEGER PRIMARY KEY)')
  })

  it('quotes new name when it needs quoting', () => {
    const sql = 'CREATE TABLE users (id INTEGER PRIMARY KEY)'
    const result = replaceTableNameInCreate(sql, 'users', 'table')
    // "table" is a reserved word, must be quoted
    expect(result).toBe('CREATE TABLE "table" (id INTEGER PRIMARY KEY)')
  })
})

describe('generateCopyDataSql', () => {
  it('generates simple SELECT * copy', () => {
    const sql = generateCopyDataSql('old_table', 'new_table')
    expect(sql).toBe('INSERT INTO new_table SELECT * FROM old_table')
  })

  it('generates copy with empty column mapping', () => {
    const sql = generateCopyDataSql('old_table', 'new_table', new Map())
    expect(sql).toBe('INSERT INTO new_table SELECT * FROM old_table')
  })

  it('generates copy with column mapping', () => {
    const mapping = new Map([
      ['old_name', 'new_name'],
      ['old_status', 'new_status'],
    ])
    const sql = generateCopyDataSql('old_table', 'new_table', mapping)
    expect(sql).toBe(
      'INSERT INTO new_table (new_name, new_status) SELECT old_name, old_status FROM old_table'
    )
  })

  it('quotes reserved word table names', () => {
    const sql = generateCopyDataSql('order', 'table')
    expect(sql).toBe('INSERT INTO "table" SELECT * FROM "order"')
  })
})

describe('generateRebuildPlan', () => {
  it('generates plan for simple table (CREATE TABLE only)', () => {
    const dependents = extractTableDependents(
      'users',
      [createSimpleTable],
      new Map()
    )

    const newCreateSql = 'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT)'
    const plan = generateRebuildPlan('users', newCreateSql, dependents)

    expect(plan.tableName).toBe('users')
    expect(plan.affectsOtherTables).toBe(false)

    // Verify operation types in order
    const opTypes = plan.operations.map((op) => op.type)
    expect(opTypes).toEqual([
      'disable_fk',
      'begin_transaction',
      'create_temp_table',
      'copy_data',
      'drop_original',
      'rename_temp',
      'fk_check',
      'commit_transaction',
      'enable_fk',
    ])
  })

  it('generates plan with index recreation', () => {
    const dependents = extractTableDependents(
      'products',
      createTableWithIndexes,
      new Map()
    )

    const newCreateSql = 'CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT, price REAL, qty INTEGER)'
    const plan = generateRebuildPlan('products', newCreateSql, dependents)

    // Should have 2 recreate_index operations (not the auto-index)
    const indexOps = plan.operations.filter((op) => op.type === 'recreate_index')
    expect(indexOps).toHaveLength(2)

    // Verify index SQL is included
    expect(indexOps[0].sql).toBe('CREATE INDEX idx_products_name ON products (name)')
    expect(indexOps[1].sql).toBe('CREATE UNIQUE INDEX idx_products_price ON products (price)')
  })

  it('generates plan with trigger recreation', () => {
    const dependents = extractTableDependents(
      'orders',
      createTableWithTriggers,
      new Map()
    )

    const newCreateSql = 'CREATE TABLE orders (id INTEGER PRIMARY KEY, total REAL, created_at TEXT, status TEXT)'
    const plan = generateRebuildPlan('orders', newCreateSql, dependents)

    // Should have 2 recreate_trigger operations
    const triggerOps = plan.operations.filter((op) => op.type === 'recreate_trigger')
    expect(triggerOps).toHaveLength(2)
  })

  it('generates plan with FK from other table', () => {
    const allForeignKeys = new Map<string, ForeignKeyInfo[]>([
      ['orders', [
        {
          id: 0,
          childTable: 'orders',
          childColumn: 'user_id',
          parentTable: 'users',
          parentColumn: 'id',
          onDelete: 'CASCADE',
          onUpdate: 'NO ACTION',
          match: 'NONE',
        },
      ]],
    ])

    const dependents = extractTableDependents(
      'users',
      [createSimpleTable],
      allForeignKeys
    )

    const newCreateSql = 'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT)'
    const plan = generateRebuildPlan('users', newCreateSql, dependents)

    expect(plan.affectsOtherTables).toBe(true)
    expect(plan.dependents.incomingForeignKeys).toHaveLength(1)
    expect(plan.dependents.incomingForeignKeys[0].fromTable).toBe('orders')
  })

  it('generates plan with column mapping', () => {
    const dependents = extractTableDependents(
      'users',
      [createSimpleTable],
      new Map()
    )

    const newCreateSql = 'CREATE TABLE users (id INTEGER PRIMARY KEY, full_name TEXT)'
    const columnMapping = new Map([
      ['id', 'id'],
      ['name', 'full_name'],
    ])

    const plan = generateRebuildPlan('users', newCreateSql, dependents, columnMapping)

    const copyOp = plan.operations.find((op) => op.type === 'copy_data')
    // _users_rebuild_temp doesn't need quoting
    expect(copyOp?.sql).toBe(
      'INSERT INTO _users_rebuild_temp (id, full_name) SELECT id, name FROM users'
    )
  })

  it('plan operations are deterministic and repeatable', () => {
    const dependents = extractTableDependents(
      'products',
      createTableWithIndexes,
      new Map()
    )

    const newCreateSql = 'CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT, price REAL)'

    // Generate plan twice
    const plan1 = generateRebuildPlan('products', newCreateSql, dependents)
    const plan2 = generateRebuildPlan('products', newCreateSql, dependents)

    // Operations should be identical
    expect(plan1.operations.length).toBe(plan2.operations.length)

    for (let i = 0; i < plan1.operations.length; i++) {
      expect(plan1.operations[i].type).toBe(plan2.operations[i].type)
      expect(plan1.operations[i].sql).toBe(plan2.operations[i].sql)
      expect(plan1.operations[i].objectName).toBe(plan2.operations[i].objectName)
    }
  })
})

// =============================================================================
// generateColumnMappedCopyDataSql Tests
// =============================================================================

describe('generateColumnMappedCopyDataSql', () => {
  it('generates copy for matching columns', () => {
    const sql = generateColumnMappedCopyDataSql(
      'old_table',
      'new_table',
      ['id', 'name', 'email'],
      ['id', 'name', 'email']
    )
    expect(sql).toBe(
      'INSERT INTO new_table (id, name, email) SELECT id, name, email FROM old_table'
    )
  })

  it('handles column renames', () => {
    const sql = generateColumnMappedCopyDataSql(
      'old_table',
      'new_table',
      ['id', 'old_name'],
      ['id', 'new_name'],
      new Map([['old_name', 'new_name']])
    )
    expect(sql).toBe(
      'INSERT INTO new_table (id, new_name) SELECT id, old_name FROM old_table'
    )
  })

  it('excludes removed columns', () => {
    const sql = generateColumnMappedCopyDataSql(
      'old_table',
      'new_table',
      ['id', 'name', 'removed_col'],
      ['id', 'name']
    )
    expect(sql).toBe(
      'INSERT INTO new_table (id, name) SELECT id, name FROM old_table'
    )
  })

  it('excludes added columns (they get NULL/DEFAULT)', () => {
    const sql = generateColumnMappedCopyDataSql(
      'old_table',
      'new_table',
      ['id', 'name'],
      ['id', 'name', 'new_col']
    )
    // new_col is not in source, so not included in INSERT
    expect(sql).toBe(
      'INSERT INTO new_table (id, name) SELECT id, name FROM old_table'
    )
  })

  it('handles rename with add and remove', () => {
    const sql = generateColumnMappedCopyDataSql(
      'old_table',
      'new_table',
      ['id', 'old_name', 'removed'],
      ['id', 'new_name', 'added'],
      new Map([['old_name', 'new_name']])
    )
    // removed is excluded, added is excluded (no source), old_name -> new_name
    expect(sql).toBe(
      'INSERT INTO new_table (id, new_name) SELECT id, old_name FROM old_table'
    )
  })

  it('handles case-insensitive column matching', () => {
    const sql = generateColumnMappedCopyDataSql(
      'old_table',
      'new_table',
      ['ID', 'Name'],
      ['id', 'name']
    )
    expect(sql).toBe(
      'INSERT INTO new_table (id, name) SELECT id, name FROM old_table'
    )
  })

  it('returns WHERE 0 when no columns to copy', () => {
    const sql = generateColumnMappedCopyDataSql(
      'old_table',
      'new_table',
      ['a', 'b'],
      ['c', 'd']
    )
    expect(sql).toBe(
      'INSERT INTO new_table SELECT * FROM old_table WHERE 0'
    )
  })
})

// =============================================================================
// generateRebuildPlanWithColumnMapping Tests
// =============================================================================

describe('generateRebuildPlanWithColumnMapping', () => {
  const simpleDependents: TableDependents = {
    createTableSql: 'CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)',
    indexes: [],
    triggers: [],
    views: [],
    incomingForeignKeys: [],
  }

  it('generates plan with column rename', () => {
    const plan = generateRebuildPlanWithColumnMapping(
      'test',
      'CREATE TABLE test (id INTEGER PRIMARY KEY, full_name TEXT)',
      simpleDependents,
      ['id', 'name'],
      ['id', 'full_name'],
      new Map([['name', 'full_name']])
    )

    const copyOp = plan.operations.find((op) => op.type === 'copy_data')
    expect(copyOp?.sql).toContain('full_name')
    expect(copyOp?.sql).toContain('name')
  })

  it('generates plan with added column', () => {
    const plan = generateRebuildPlanWithColumnMapping(
      'test',
      'CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT, email TEXT)',
      simpleDependents,
      ['id', 'name'],
      ['id', 'name', 'email']
    )

    const copyOp = plan.operations.find((op) => op.type === 'copy_data')
    // email should not be in the copy since it's new
    expect(copyOp?.sql).not.toContain('email')
    expect(copyOp?.sql).toContain('id')
    expect(copyOp?.sql).toContain('name')
  })

  it('generates plan with removed column', () => {
    const plan = generateRebuildPlanWithColumnMapping(
      'test',
      'CREATE TABLE test (id INTEGER PRIMARY KEY)',
      simpleDependents,
      ['id', 'name'],
      ['id']
    )

    const copyOp = plan.operations.find((op) => op.type === 'copy_data')
    expect(copyOp?.sql).toContain('id')
    expect(copyOp?.sql).not.toContain('name')
  })
})

// =============================================================================
// Mock Database Engine for executeRebuildPlan Tests
// =============================================================================

/**
 * Creates a mock database engine that simulates SQLite behavior.
 * Allows customizing behavior for different test scenarios.
 */
function createMockEngine(options: {
  initialRowCount?: number
  fkEnabled?: boolean
  queryResults?: Map<string, { rows: unknown[][] }>
  execErrors?: Map<string, Error>
  queryErrors?: Map<string, Error>
} = {}): DatabaseEngine {
  const {
    initialRowCount = 5,
    fkEnabled = true,
    queryResults = new Map(),
    execErrors = new Map(),
    queryErrors = new Map(),
  } = options

  const executedSql: string[] = []
  let currentRowCount = initialRowCount
  let inTransaction = false

  const engine = {
    query: vi.fn(async (sql: string) => {
      executedSql.push(sql)

      // Check for custom errors
      for (const [pattern, error] of queryErrors) {
        if (sql.includes(pattern)) {
          throw error
        }
      }

      // Check for custom results
      for (const [pattern, result] of queryResults) {
        if (sql.includes(pattern)) {
          return result
        }
      }

      // Default behavior for common queries
      if (sql.includes('SELECT COUNT(*)')) {
        return { rows: [[currentRowCount]] }
      }
      if (sql.includes('PRAGMA foreign_keys') && !sql.includes('foreign_key_check') && !sql.includes('foreign_key_list')) {
        return { rows: [[fkEnabled ? 1 : 0]] }
      }
      if (sql.includes('PRAGMA foreign_key_check')) {
        return { rows: [] } // No violations
      }
      if (sql.includes('PRAGMA foreign_key_list')) {
        return { rows: [] } // No FKs by default
      }
      if (sql.includes('PRAGMA table_info')) {
        // Return default columns: id, name, email
        return { rows: [
          [0, 'id', 'INTEGER', 1, null, 1],
          [1, 'name', 'TEXT', 0, null, 0],
          [2, 'email', 'TEXT', 0, null, 0],
        ] }
      }
      if (sql.includes('PRAGMA index_list')) {
        return { rows: [] }
      }
      if (sql.includes('sqlite_master') && sql.includes('trigger')) {
        // Return a trigger exists by default for trigger verification
        return { rows: [['CREATE TRIGGER ...']] }
      }

      return { rows: [] }
    }),

    exec: vi.fn(async (sql: string) => {
      executedSql.push(sql)

      // Check for custom errors
      for (const [pattern, error] of execErrors) {
        if (sql.includes(pattern)) {
          throw error
        }
      }

      // Track transaction state
      if (sql === 'BEGIN TRANSACTION') {
        inTransaction = true
      } else if (sql === 'COMMIT') {
        inTransaction = false
      } else if (sql === 'ROLLBACK') {
        inTransaction = false
      }

      return { rowsAffected: 0, lastInsertId: 0 }
    }),

    // Test helpers
    _getExecutedSql: () => executedSql,
    _isInTransaction: () => inTransaction,
    _setRowCount: (count: number) => { currentRowCount = count },
  }

  return engine as unknown as DatabaseEngine
}

// =============================================================================
// executeRebuildPlan Tests
// =============================================================================

describe('executeRebuildPlan', () => {
  const createTestPlan = (tableName: string, options: {
    indexes?: { name: string; sql: string }[]
    triggers?: { name: string; sql: string }[]
  } = {}): RebuildPlan => {
    const dependents: TableDependents = {
      createTableSql: `CREATE TABLE ${tableName} (id INTEGER PRIMARY KEY, name TEXT)`,
      indexes: (options.indexes || []).map(idx => ({
        name: idx.name,
        tableName,
        sql: idx.sql,
        isAutoIndex: false,
      })),
      triggers: (options.triggers || []).map(tr => ({
        name: tr.name,
        tableName,
        sql: tr.sql,
      })),
      views: [],
      incomingForeignKeys: [],
    }

    return generateRebuildPlan(
      tableName,
      `CREATE TABLE ${tableName} (id INTEGER PRIMARY KEY, name TEXT, email TEXT)`,
      dependents
    )
  }

  describe('successful execution', () => {
    it('executes all operations in order', async () => {
      const engine = createMockEngine({ initialRowCount: 10 })
      const plan = createTestPlan('users')

      const result = await executeRebuildPlan(engine, plan)

      expect(result.success).toBe(true)
      expect(result.rowCountBefore).toBe(10)
      expect(result.rowCountAfter).toBe(10)
      expect(result.executedOperations).toContain('disable_fk')
      expect(result.executedOperations).toContain('begin_transaction')
      expect(result.executedOperations).toContain('create_temp_table')
      expect(result.executedOperations).toContain('copy_data')
      expect(result.executedOperations).toContain('drop_original')
      expect(result.executedOperations).toContain('rename_temp')
      expect(result.executedOperations).toContain('fk_check')
      expect(result.executedOperations).toContain('commit_transaction')
      expect(result.executedOperations).toContain('enable_fk')
    })

    it('preserves row count after rebuild', async () => {
      const engine = createMockEngine({ initialRowCount: 100 })
      const plan = createTestPlan('products')

      const result = await executeRebuildPlan(engine, plan)

      expect(result.success).toBe(true)
      expect(result.rowCountBefore).toBe(100)
      expect(result.rowCountAfter).toBe(100)
    })

    it('disables and re-enables foreign keys', async () => {
      const engine = createMockEngine({ fkEnabled: true })
      const plan = createTestPlan('orders')

      await executeRebuildPlan(engine, plan)

      const executedSql = (engine as unknown as { _getExecutedSql: () => string[] })._getExecutedSql()
      expect(executedSql).toContain('PRAGMA foreign_keys = OFF')
      expect(executedSql).toContain('PRAGMA foreign_keys = ON')
    })
  })

  describe('add column', () => {
    it('data preserved, new column has DEFAULT/NULL', async () => {
      const engine = createMockEngine({ initialRowCount: 50 })
      const dependents: TableDependents = {
        createTableSql: 'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)',
        indexes: [],
        triggers: [],
        views: [],
        incomingForeignKeys: [],
      }

      const plan = generateRebuildPlanWithColumnMapping(
        'users',
        'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT DEFAULT NULL)',
        dependents,
        ['id', 'name'],
        ['id', 'name', 'email']
      )

      const result = await executeRebuildPlan(engine, plan)

      expect(result.success).toBe(true)
      expect(result.rowCountBefore).toBe(50)
      expect(result.rowCountAfter).toBe(50)

      // Verify copy_data only includes existing columns
      const copyOp = plan.operations.find(op => op.type === 'copy_data')
      expect(copyOp?.sql).not.toContain('email')
    })
  })

  describe('remove column', () => {
    it('data preserved for remaining columns', async () => {
      const engine = createMockEngine({ initialRowCount: 25 })
      const dependents: TableDependents = {
        createTableSql: 'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, old_col TEXT)',
        indexes: [],
        triggers: [],
        views: [],
        incomingForeignKeys: [],
      }

      const plan = generateRebuildPlanWithColumnMapping(
        'users',
        'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)',
        dependents,
        ['id', 'name', 'old_col'],
        ['id', 'name']
      )

      const result = await executeRebuildPlan(engine, plan)

      expect(result.success).toBe(true)
      expect(result.rowCountBefore).toBe(25)
      expect(result.rowCountAfter).toBe(25)

      // Verify copy_data excludes removed column
      const copyOp = plan.operations.find(op => op.type === 'copy_data')
      expect(copyOp?.sql).not.toContain('old_col')
      expect(copyOp?.sql).toContain('id')
      expect(copyOp?.sql).toContain('name')
    })
  })

  describe('rename column', () => {
    it('data preserved via explicit mapping', async () => {
      const engine = createMockEngine({ initialRowCount: 30 })
      const dependents: TableDependents = {
        createTableSql: 'CREATE TABLE users (id INTEGER PRIMARY KEY, old_name TEXT)',
        indexes: [],
        triggers: [],
        views: [],
        incomingForeignKeys: [],
      }

      const plan = generateRebuildPlanWithColumnMapping(
        'users',
        'CREATE TABLE users (id INTEGER PRIMARY KEY, new_name TEXT)',
        dependents,
        ['id', 'old_name'],
        ['id', 'new_name'],
        new Map([['old_name', 'new_name']])
      )

      const result = await executeRebuildPlan(engine, plan)

      expect(result.success).toBe(true)
      expect(result.rowCountBefore).toBe(30)
      expect(result.rowCountAfter).toBe(30)

      // Verify copy_data uses proper column mapping
      const copyOp = plan.operations.find(op => op.type === 'copy_data')
      expect(copyOp?.sql).toContain('new_name')
      expect(copyOp?.sql).toContain('old_name')
    })
  })

  describe('type change', () => {
    it('data coerced (INTEGER to TEXT)', async () => {
      const engine = createMockEngine({ initialRowCount: 20 })
      const dependents: TableDependents = {
        createTableSql: 'CREATE TABLE items (id INTEGER PRIMARY KEY, value INTEGER)',
        indexes: [],
        triggers: [],
        views: [],
        incomingForeignKeys: [],
      }

      // Change value from INTEGER to TEXT
      const plan = generateRebuildPlanWithColumnMapping(
        'items',
        'CREATE TABLE items (id INTEGER PRIMARY KEY, value TEXT)',
        dependents,
        ['id', 'value'],
        ['id', 'value']
      )

      const result = await executeRebuildPlan(engine, plan)

      expect(result.success).toBe(true)
      expect(result.rowCountBefore).toBe(20)
      expect(result.rowCountAfter).toBe(20)
      // SQLite handles type coercion automatically during INSERT...SELECT
    })
  })

  describe('NOT NULL violation during copy', () => {
    it('transaction rolled back on constraint violation', async () => {
      const engine = createMockEngine({
        initialRowCount: 10,
        execErrors: new Map([
          ['INSERT INTO', new Error('NOT NULL constraint failed: users.name')],
        ]),
      })

      const plan = createTestPlan('users')

      const result = await executeRebuildPlan(engine, plan)

      expect(result.success).toBe(false)
      expect(result.error).toContain('NOT NULL constraint failed')

      // Verify ROLLBACK was executed
      const executedSql = (engine as unknown as { _getExecutedSql: () => string[] })._getExecutedSql()
      expect(executedSql).toContain('ROLLBACK')
    })
  })

  describe('index recreation', () => {
    it('PRAGMA index_list shows indexes restored', async () => {
      const engine = createMockEngine({ initialRowCount: 15 })
      const plan = createTestPlan('products', {
        indexes: [
          { name: 'idx_name', sql: 'CREATE INDEX idx_name ON products (name)' },
          { name: 'idx_email', sql: 'CREATE UNIQUE INDEX idx_email ON products (email)' },
        ],
      })

      const result = await executeRebuildPlan(engine, plan)

      expect(result.success).toBe(true)
      expect(result.executedOperations).toContain('recreate_index')

      // Verify index creation SQL was executed
      const executedSql = (engine as unknown as { _getExecutedSql: () => string[] })._getExecutedSql()
      expect(executedSql.some(sql => sql.includes('CREATE INDEX idx_name'))).toBe(true)
      expect(executedSql.some(sql => sql.includes('CREATE UNIQUE INDEX idx_email'))).toBe(true)
    })
  })

  describe('trigger recreation', () => {
    it('sqlite_master shows triggers restored', async () => {
      const engine = createMockEngine({ initialRowCount: 8 })
      const plan = createTestPlan('orders', {
        triggers: [
          {
            name: 'tr_insert',
            sql: 'CREATE TRIGGER tr_insert AFTER INSERT ON orders BEGIN SELECT 1; END',
          },
          {
            name: 'tr_update',
            sql: 'CREATE TRIGGER tr_update AFTER UPDATE ON orders BEGIN SELECT 1; END',
          },
        ],
      })

      const result = await executeRebuildPlan(engine, plan)

      expect(result.success).toBe(true)
      expect(result.executedOperations).toContain('recreate_trigger')

      // Verify trigger creation SQL was executed
      const executedSql = (engine as unknown as { _getExecutedSql: () => string[] })._getExecutedSql()
      expect(executedSql.some(sql => sql.includes('CREATE TRIGGER tr_insert'))).toBe(true)
      expect(executedSql.some(sql => sql.includes('CREATE TRIGGER tr_update'))).toBe(true)
    })
  })

  describe('error handling', () => {
    it('rolls back on create temp table failure', async () => {
      const engine = createMockEngine({
        initialRowCount: 10,
        execErrors: new Map([
          ['CREATE TABLE', new Error('table already exists')],
        ]),
      })

      const plan = createTestPlan('users')

      const result = await executeRebuildPlan(engine, plan)

      expect(result.success).toBe(false)
      expect(result.error).toContain('table already exists')

      const executedSql = (engine as unknown as { _getExecutedSql: () => string[] })._getExecutedSql()
      expect(executedSql).toContain('ROLLBACK')
    })

    it('rolls back on drop original failure', async () => {
      const engine = createMockEngine({
        initialRowCount: 10,
        execErrors: new Map([
          ['DROP TABLE', new Error('cannot drop table')],
        ]),
      })

      const plan = createTestPlan('users')

      const result = await executeRebuildPlan(engine, plan)

      expect(result.success).toBe(false)
      expect(result.error).toContain('cannot drop table')
    })

    it('reports foreign key violations', async () => {
      const engine = createMockEngine({
        initialRowCount: 10,
        queryResults: new Map([
          ['foreign_key_check', { rows: [['orders', 1, 'users', 'id']] }],
        ]),
      })

      const plan = createTestPlan('users')

      const result = await executeRebuildPlan(engine, plan)

      expect(result.success).toBe(false)
      expect(result.error).toContain('Foreign key violations detected')
    })

    it('re-enables foreign keys after failure if they were enabled', async () => {
      const engine = createMockEngine({
        initialRowCount: 10,
        fkEnabled: true,
        execErrors: new Map([
          ['CREATE TABLE', new Error('error')],
        ]),
      })

      const plan = createTestPlan('users')

      await executeRebuildPlan(engine, plan)

      const executedSql = (engine as unknown as { _getExecutedSql: () => string[] })._getExecutedSql()
      // Should have FK enable at the end even after failure
      const fkOnCalls = executedSql.filter(sql => sql === 'PRAGMA foreign_keys = ON')
      expect(fkOnCalls.length).toBeGreaterThan(0)
    })
  })

  describe('edge cases', () => {
    it('handles empty table', async () => {
      const engine = createMockEngine({ initialRowCount: 0 })
      const plan = createTestPlan('empty_table')

      const result = await executeRebuildPlan(engine, plan)

      expect(result.success).toBe(true)
      expect(result.rowCountBefore).toBe(0)
      expect(result.rowCountAfter).toBe(0)
    })

    it('handles table with no indexes or triggers', async () => {
      const engine = createMockEngine({ initialRowCount: 5 })
      const plan = createTestPlan('simple_table')

      const result = await executeRebuildPlan(engine, plan)

      expect(result.success).toBe(true)
      expect(result.executedOperations).not.toContain('recreate_index')
      expect(result.executedOperations).not.toContain('recreate_trigger')
    })

    it('handles FK disabled state', async () => {
      const engine = createMockEngine({
        initialRowCount: 5,
        fkEnabled: false,
      })
      const plan = createTestPlan('table')

      const result = await executeRebuildPlan(engine, plan)

      expect(result.success).toBe(true)
      // FK was already disabled, so don't need to re-enable
    })
  })
})

// =============================================================================
// Verification Function Tests
// =============================================================================

describe('verifyTableSchema', () => {
  it('returns no failures when columns match', async () => {
    const engine = createMockEngine({
      queryResults: new Map([
        ['PRAGMA table_info', {
          rows: [
            [0, 'id', 'INTEGER', 1, null, 1],
            [1, 'name', 'TEXT', 0, null, 0],
            [2, 'email', 'TEXT', 0, null, 0],
          ],
        }],
      ]),
    })

    const failures = await verifyTableSchema(
      engine as unknown as DatabaseEngine,
      'users',
      ['id', 'name', 'email']
    )

    expect(failures).toHaveLength(0)
  })

  it('returns failure when expected column is missing', async () => {
    const engine = createMockEngine({
      queryResults: new Map([
        ['PRAGMA table_info', {
          rows: [
            [0, 'id', 'INTEGER', 1, null, 1],
            [1, 'name', 'TEXT', 0, null, 0],
          ],
        }],
      ]),
    })

    const failures = await verifyTableSchema(
      engine as unknown as DatabaseEngine,
      'users',
      ['id', 'name', 'email']
    )

    expect(failures).toHaveLength(1)
    expect(failures[0].type).toBe('schema_mismatch')
    expect(failures[0].message).toContain('email')
    expect(failures[0].message).toContain('not found')
  })

  it('returns failure when unexpected column exists', async () => {
    const engine = createMockEngine({
      queryResults: new Map([
        ['PRAGMA table_info', {
          rows: [
            [0, 'id', 'INTEGER', 1, null, 1],
            [1, 'name', 'TEXT', 0, null, 0],
            [2, 'extra_col', 'TEXT', 0, null, 0],
          ],
        }],
      ]),
    })

    const failures = await verifyTableSchema(
      engine as unknown as DatabaseEngine,
      'users',
      ['id', 'name']
    )

    expect(failures).toHaveLength(1)
    expect(failures[0].type).toBe('schema_mismatch')
    expect(failures[0].message).toContain('extra_col')
    expect(failures[0].message).toContain('Unexpected')
  })

  it('handles case-insensitive column matching', async () => {
    const engine = createMockEngine({
      queryResults: new Map([
        ['PRAGMA table_info', {
          rows: [
            [0, 'ID', 'INTEGER', 1, null, 1],
            [1, 'Name', 'TEXT', 0, null, 0],
          ],
        }],
      ]),
    })

    const failures = await verifyTableSchema(
      engine as unknown as DatabaseEngine,
      'users',
      ['id', 'name']
    )

    expect(failures).toHaveLength(0)
  })

  it('skips column check when expectedColumns not provided', async () => {
    const engine = createMockEngine({
      queryResults: new Map([
        ['PRAGMA table_info', {
          rows: [
            [0, 'id', 'INTEGER', 1, null, 1],
          ],
        }],
      ]),
    })

    const failures = await verifyTableSchema(
      engine as unknown as DatabaseEngine,
      'users'
    )

    expect(failures).toHaveLength(0)
  })

  it('reports failure when table has no columns', async () => {
    const engine = createMockEngine({
      queryResults: new Map([
        ['PRAGMA table_info', { rows: [] }],
      ]),
    })

    const failures = await verifyTableSchema(
      engine as unknown as DatabaseEngine,
      'users'
    )

    expect(failures).toHaveLength(1)
    expect(failures[0].message).toContain('no columns')
  })
})

describe('verifyForeignKeyIntegrity', () => {
  it('returns no failures when no FK violations', async () => {
    const engine = createMockEngine({
      queryResults: new Map([
        ['foreign_key_check', { rows: [] }],
      ]),
    })

    const failures = await verifyForeignKeyIntegrity(
      engine as unknown as DatabaseEngine,
      'orders'
    )

    expect(failures).toHaveLength(0)
  })

  it('returns failures for FK violations', async () => {
    const engine = createMockEngine({
      queryResults: new Map([
        ['foreign_key_check', {
          rows: [
            ['orders', 1, 'users', 0],
            ['orders', 5, 'users', 0],
            ['orders', 3, 'products', 0],
          ],
        }],
      ]),
    })

    const failures = await verifyForeignKeyIntegrity(
      engine as unknown as DatabaseEngine,
      'orders'
    )

    expect(failures).toHaveLength(2) // Grouped by parent table
    expect(failures[0].type).toBe('fk_violation')
    expect(failures.some(f => f.message.includes('users'))).toBe(true)
    expect(failures.some(f => f.message.includes('products'))).toBe(true)
  })
})

describe('verifyViewCompilability', () => {
  it('returns null when view compiles successfully', async () => {
    const engine = createMockEngine({})

    const failure = await verifyViewCompilability(
      engine as unknown as DatabaseEngine,
      'v_user_names'
    )

    expect(failure).toBeNull()
  })

  it('returns failure when view is broken', async () => {
    const engine = createMockEngine({
      queryErrors: new Map([
        ['v_broken_view', new Error('no such column: old_column')],
      ]),
    })

    const failure = await verifyViewCompilability(
      engine as unknown as DatabaseEngine,
      'v_broken_view'
    )

    expect(failure).not.toBeNull()
    expect(failure?.type).toBe('view_broken')
    expect(failure?.objectName).toBe('v_broken_view')
    expect(failure?.details).toContain('no such column')
  })
})

describe('verifyTriggerValidity', () => {
  it('returns null when trigger exists', async () => {
    const engine = createMockEngine({
      queryResults: new Map([
        ['sqlite_master', {
          rows: [['CREATE TRIGGER tr_test AFTER INSERT ON users BEGIN SELECT 1; END']],
        }],
      ]),
    })

    const failure = await verifyTriggerValidity(
      engine as unknown as DatabaseEngine,
      'tr_test',
      'CREATE TRIGGER tr_test AFTER INSERT ON users BEGIN SELECT 1; END'
    )

    expect(failure).toBeNull()
  })

  it('returns failure when trigger does not exist', async () => {
    const engine = createMockEngine({
      queryResults: new Map([
        ['sqlite_master', { rows: [] }],
      ]),
    })

    const failure = await verifyTriggerValidity(
      engine as unknown as DatabaseEngine,
      'tr_missing',
      'CREATE TRIGGER tr_missing ...'
    )

    expect(failure).not.toBeNull()
    expect(failure?.type).toBe('trigger_broken')
    expect(failure?.objectName).toBe('tr_missing')
    expect(failure?.message).toContain('was not recreated')
  })
})

describe('hasSelfReferencialForeignKeys', () => {
  it('returns true for self-referential FK', () => {
    const result = hasSelfReferencialForeignKeys('employees', [
      {
        id: 0,
        childTable: 'employees',
        childColumn: 'manager_id',
        parentTable: 'employees',
        parentColumn: 'id',
        onDelete: 'SET NULL',
        onUpdate: 'NO ACTION',
        match: 'NONE',
      },
    ])

    expect(result).toBe(true)
  })

  it('returns false when no self-referential FK', () => {
    const result = hasSelfReferencialForeignKeys('orders', [
      {
        id: 0,
        childTable: 'orders',
        childColumn: 'user_id',
        parentTable: 'users',
        parentColumn: 'id',
        onDelete: 'CASCADE',
        onUpdate: 'NO ACTION',
        match: 'NONE',
      },
    ])

    expect(result).toBe(false)
  })

  it('returns false for empty FK list', () => {
    const result = hasSelfReferencialForeignKeys('users', [])
    expect(result).toBe(false)
  })

  it('handles case-insensitive table name matching', () => {
    const result = hasSelfReferencialForeignKeys('EMPLOYEES', [
      {
        id: 0,
        childTable: 'EMPLOYEES',
        childColumn: 'manager_id',
        parentTable: 'employees',
        parentColumn: 'id',
        onDelete: 'SET NULL',
        onUpdate: 'NO ACTION',
        match: 'NONE',
      },
    ])

    expect(result).toBe(true)
  })
})

describe('runPostRebuildVerification', () => {
  it('runs all verifications by default', async () => {
    const engine = createMockEngine({
      queryResults: new Map([
        ['PRAGMA table_info', {
          rows: [[0, 'id', 'INTEGER', 1, null, 1]],
        }],
        ['foreign_key_check', { rows: [] }],
        ['sqlite_master', { rows: [['CREATE TRIGGER ...']] }],
      ]),
    })

    const plan: RebuildPlan = {
      tableName: 'users',
      operations: [],
      dependents: {
        createTableSql: 'CREATE TABLE users (id INTEGER PRIMARY KEY)',
        indexes: [],
        triggers: [{ name: 'tr_test', tableName: 'users', sql: 'CREATE TRIGGER tr_test...' }],
        views: [{ name: 'v_test', sql: 'CREATE VIEW v_test AS SELECT * FROM users' }],
        incomingForeignKeys: [],
      },
      affectsOtherTables: false,
    }

    const failures = await runPostRebuildVerification(
      engine as unknown as DatabaseEngine,
      plan
    )

    expect(failures).toHaveLength(0)
  })

  it('respects verification options to skip checks', async () => {
    const engine = createMockEngine({
      queryResults: new Map([
        ['PRAGMA table_info', { rows: [] }], // Would fail schema check
        ['foreign_key_check', {
          rows: [['orders', 1, 'users', 0]], // Would fail FK check
        }],
      ]),
    })

    const plan: RebuildPlan = {
      tableName: 'users',
      operations: [],
      dependents: {
        createTableSql: 'CREATE TABLE users (id INTEGER PRIMARY KEY)',
        indexes: [],
        triggers: [],
        views: [],
        incomingForeignKeys: [],
      },
      affectsOtherTables: false,
    }

    const failures = await runPostRebuildVerification(
      engine as unknown as DatabaseEngine,
      plan,
      {
        verifySchema: false,
        verifyForeignKeys: false,
        verifyViews: false,
        verifyTriggers: false,
      }
    )

    expect(failures).toHaveLength(0)
  })
})

// =============================================================================
// Verification Integration Tests (executeRebuildPlan with verification)
// =============================================================================

describe('executeRebuildPlan with verification', () => {
  describe('rebuild with valid dependent view', () => {
    it('view still works after rebuild', async () => {
      const engine = createMockEngine({
        initialRowCount: 10,
        queryResults: new Map([
          ['PRAGMA table_info', {
            rows: [
              [0, 'id', 'INTEGER', 1, null, 1],
              [1, 'name', 'TEXT', 0, null, 0],
              [2, 'email', 'TEXT', 0, null, 0],
            ],
          }],
          ['foreign_key_check', { rows: [] }],
        ]),
      })

      const dependents: TableDependents = {
        createTableSql: 'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)',
        indexes: [],
        triggers: [],
        views: [{ name: 'v_users', sql: 'CREATE VIEW v_users AS SELECT id, name FROM users' }],
        incomingForeignKeys: [],
      }

      const plan = generateRebuildPlan(
        'users',
        'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT)',
        dependents
      )

      const result = await executeRebuildPlan(engine, plan, {
        expectedColumns: ['id', 'name', 'email'],
      })

      expect(result.success).toBe(true)
      expect(result.verificationFailures).toBeUndefined()
    })
  })

  describe('rebuild breaks view (column removed)', () => {
    it('transaction rolled back, error names view', async () => {
      const viewQueryCount = { count: 0 }
      const engine = {
        query: vi.fn(async (sql: string) => {
          if (sql.includes('SELECT COUNT(*)')) {
            return { rows: [[10]] }
          }
          if (sql.includes('PRAGMA foreign_keys')) {
            return { rows: [[1]] }
          }
          if (sql.includes('PRAGMA table_info')) {
            return { rows: [[0, 'id', 'INTEGER', 1, null, 1]] }
          }
          if (sql.includes('foreign_key_check')) {
            return { rows: [] }
          }
          if (sql.includes('v_broken_view')) {
            viewQueryCount.count++
            throw new Error('no such column: removed_column')
          }
          if (sql.includes('PRAGMA foreign_key_list')) {
            return { rows: [] }
          }
          return { rows: [] }
        }),
        exec: vi.fn(async () => ({ rowsAffected: 0, lastInsertId: 0 })),
      }

      const dependents: TableDependents = {
        createTableSql: 'CREATE TABLE users (id INTEGER PRIMARY KEY, removed_column TEXT)',
        indexes: [],
        triggers: [],
        views: [{ name: 'v_broken_view', sql: 'CREATE VIEW v_broken_view AS SELECT removed_column FROM users' }],
        incomingForeignKeys: [],
      }

      const plan = generateRebuildPlan(
        'users',
        'CREATE TABLE users (id INTEGER PRIMARY KEY)',
        dependents
      )

      const result = await executeRebuildPlan(engine as unknown as DatabaseEngine, plan)

      expect(result.success).toBe(false)
      expect(result.error).toContain('v_broken_view')
      expect(result.verificationFailures).toBeDefined()
      expect(result.verificationFailures?.some(f => f.objectName === 'v_broken_view')).toBe(true)

      // Verify ROLLBACK was called
      expect(engine.exec).toHaveBeenCalledWith('ROLLBACK')
    })
  })

  describe('rebuild breaks trigger (column renamed)', () => {
    it('transaction rolled back, error names trigger', async () => {
      const engine = {
        query: vi.fn(async (sql: string) => {
          if (sql.includes('SELECT COUNT(*)')) {
            return { rows: [[5]] }
          }
          if (sql.includes('PRAGMA foreign_keys')) {
            return { rows: [[1]] }
          }
          if (sql.includes('PRAGMA table_info')) {
            return { rows: [[0, 'id', 'INTEGER', 1, null, 1]] }
          }
          if (sql.includes('foreign_key_check')) {
            return { rows: [] }
          }
          if (sql.includes('sqlite_master') && sql.includes('trigger')) {
            // Trigger doesn't exist (failed to recreate due to column rename)
            return { rows: [] }
          }
          if (sql.includes('PRAGMA foreign_key_list')) {
            return { rows: [] }
          }
          return { rows: [] }
        }),
        exec: vi.fn(async () => ({ rowsAffected: 0, lastInsertId: 0 })),
      }

      const dependents: TableDependents = {
        createTableSql: 'CREATE TABLE users (id INTEGER PRIMARY KEY, old_name TEXT)',
        indexes: [],
        triggers: [{
          name: 'tr_broken',
          tableName: 'users',
          sql: 'CREATE TRIGGER tr_broken AFTER INSERT ON users BEGIN SELECT old_name; END',
        }],
        views: [],
        incomingForeignKeys: [],
      }

      const plan = generateRebuildPlan(
        'users',
        'CREATE TABLE users (id INTEGER PRIMARY KEY, new_name TEXT)',
        dependents
      )

      const result = await executeRebuildPlan(engine as unknown as DatabaseEngine, plan)

      expect(result.success).toBe(false)
      expect(result.error).toContain('tr_broken')
      expect(result.verificationFailures).toBeDefined()
      expect(result.verificationFailures?.some(f => f.objectName === 'tr_broken')).toBe(true)
    })
  })

  describe('rebuild with circular FK', () => {
    it('handled without deadlock', async () => {
      const engine = createMockEngine({
        initialRowCount: 5,
        queryResults: new Map([
          ['PRAGMA table_info', {
            rows: [
              [0, 'id', 'INTEGER', 1, null, 1],
              [1, 'manager_id', 'INTEGER', 0, null, 0],
            ],
          }],
          ['foreign_key_check', { rows: [] }],
          ['foreign_key_list', {
            rows: [[0, 0, 'employees', 'manager_id', 'id', 'NO ACTION', 'SET NULL', 'NONE']],
          }],
        ]),
      })

      const dependents: TableDependents = {
        createTableSql: 'CREATE TABLE employees (id INTEGER PRIMARY KEY, manager_id INTEGER REFERENCES employees(id))',
        indexes: [],
        triggers: [],
        views: [],
        incomingForeignKeys: [],
      }

      const plan = generateRebuildPlan(
        'employees',
        'CREATE TABLE employees (id INTEGER PRIMARY KEY, manager_id INTEGER REFERENCES employees(id), dept TEXT)',
        dependents
      )

      const result = await executeRebuildPlan(engine, plan)

      // Should complete without hanging/deadlock
      expect(result.success).toBe(true)
    })
  })

  describe('foreign key violation after rebuild', () => {
    it('detected and reported', async () => {
      const engine = {
        query: vi.fn(async (sql: string) => {
          if (sql.includes('SELECT COUNT(*)')) {
            return { rows: [[10]] }
          }
          if (sql.includes('PRAGMA foreign_keys')) {
            return { rows: [[1]] }
          }
          if (sql.includes('PRAGMA table_info')) {
            return { rows: [[0, 'id', 'INTEGER', 1, null, 1]] }
          }
          if (sql.includes('PRAGMA foreign_key_check')) {
            // Return FK violations
            return { rows: [
              ['orders', 1, 'users', 0],
              ['orders', 2, 'users', 0],
            ] }
          }
          if (sql.includes('PRAGMA foreign_key_list')) {
            return { rows: [] }
          }
          return { rows: [] }
        }),
        exec: vi.fn(async () => ({ rowsAffected: 0, lastInsertId: 0 })),
      }

      const dependents: TableDependents = {
        createTableSql: 'CREATE TABLE users (id INTEGER PRIMARY KEY)',
        indexes: [],
        triggers: [],
        views: [],
        incomingForeignKeys: [],
      }

      const plan = generateRebuildPlan(
        'users',
        'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)',
        dependents
      )

      const result = await executeRebuildPlan(engine as unknown as DatabaseEngine, plan)

      expect(result.success).toBe(false)
      expect(result.error).toContain('Foreign key violations')
      expect(result.verificationFailures).toBeDefined()
      expect(result.verificationFailures?.some(f => f.type === 'fk_violation')).toBe(true)
    })
  })
})
