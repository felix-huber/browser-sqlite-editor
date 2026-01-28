import { describe, it, expect } from 'vitest'
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
  type SqliteMasterObject,
} from '../rebuild'
import type { ForeignKeyInfo } from '../../types/index'

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
