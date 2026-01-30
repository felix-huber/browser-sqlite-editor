import { describe, it, expect } from 'vitest'
import { generateSql, quoteIdentifier, type GenerateSqlOptions } from '../generateSql'
import type { TableBoxNodeType } from '../TableBox'
import type { JoinConfig } from '../QueryBuilder'
import type { WhereCondition } from '../WhereBuilder'
import type { SortCondition } from '../OrderByBuilder'

// Helper to create a minimal table node
function createTableNode(
  tableName: string,
  alias: string,
  selectedColumns: string[] = []
): TableBoxNodeType {
  return {
    id: `table-${tableName}`,
    type: 'tableBox',
    position: { x: 0, y: 0 },
    data: {
      tableName,
      alias,
      columns: [],
      selectedColumns,
    },
  }
}

// Helper to create default options
function createOptions(overrides: Partial<GenerateSqlOptions> = {}): GenerateSqlOptions {
  return {
    tableNodes: [],
    joins: [],
    whereConditions: [],
    whereLogic: 'AND',
    sortConditions: [],
    limit: null,
    ...overrides,
  }
}

describe('quoteIdentifier', () => {
  it('returns simple identifiers unchanged', () => {
    expect(quoteIdentifier('users')).toBe('users')
    expect(quoteIdentifier('user_id')).toBe('user_id')
    expect(quoteIdentifier('MyTable')).toBe('MyTable')
    expect(quoteIdentifier('_private')).toBe('_private')
  })

  it('quotes identifiers with special characters', () => {
    expect(quoteIdentifier('user-name')).toBe('"user-name"')
    expect(quoteIdentifier('user name')).toBe('"user name"')
    expect(quoteIdentifier('user.name')).toBe('"user.name"')
    expect(quoteIdentifier('123table')).toBe('"123table"')
  })

  it('quotes SQLite reserved keywords', () => {
    expect(quoteIdentifier('SELECT')).toBe('"SELECT"')
    expect(quoteIdentifier('select')).toBe('"select"')
    expect(quoteIdentifier('FROM')).toBe('"FROM"')
    expect(quoteIdentifier('WHERE')).toBe('"WHERE"')
    expect(quoteIdentifier('TABLE')).toBe('"TABLE"')
    expect(quoteIdentifier('ORDER')).toBe('"ORDER"')
  })

  it('escapes internal double quotes', () => {
    expect(quoteIdentifier('user"name')).toBe('"user""name"')
    expect(quoteIdentifier('say "hello"')).toBe('"say ""hello"""')
  })
})

describe('generateSql', () => {
  describe('validation', () => {
    it('returns invalid when no tables', () => {
      const result = generateSql(createOptions())

      expect(result.isValid).toBe(false)
      expect(result.sql).toBe('')
      expect(result.validationMessage).toBe('Add at least one table to generate SQL')
    })

    it('returns valid with at least one table', () => {
      const result = generateSql(
        createOptions({
          tableNodes: [createTableNode('users', 't1')],
        })
      )

      expect(result.isValid).toBe(true)
      expect(result.sql).toContain('SELECT')
    })
  })

  describe('SELECT clause', () => {
    it('selects all columns with * when no columns selected', () => {
      const result = generateSql(
        createOptions({
          tableNodes: [createTableNode('users', 't1', [])],
        })
      )

      expect(result.sql).toContain('SELECT t1.*')
    })

    it('selects specific columns when provided', () => {
      const result = generateSql(
        createOptions({
          tableNodes: [createTableNode('users', 't1', ['id', 'name', 'email'])],
        })
      )

      expect(result.sql).toContain('t1.id')
      expect(result.sql).toContain('t1.name')
      expect(result.sql).toContain('t1.email')
    })

    it('includes columns from multiple tables', () => {
      const result = generateSql(
        createOptions({
          tableNodes: [
            createTableNode('users', 't1', ['id', 'name']),
            createTableNode('orders', 't2', ['order_id', 'amount']),
          ],
        })
      )

      expect(result.sql).toContain('t1.id')
      expect(result.sql).toContain('t1.name')
      expect(result.sql).toContain('t2.order_id')
      expect(result.sql).toContain('t2.amount')
    })
  })

  describe('FROM clause', () => {
    it('includes table name with alias', () => {
      const result = generateSql(
        createOptions({
          tableNodes: [createTableNode('users', 't1')],
        })
      )

      expect(result.sql).toContain('FROM users AS t1')
    })

    it('quotes table names when needed', () => {
      const result = generateSql(
        createOptions({
          tableNodes: [createTableNode('user-data', 't1')],
        })
      )

      expect(result.sql).toContain('FROM "user-data" AS t1')
    })

    it('adds CROSS JOIN for multiple unjoined tables', () => {
      const result = generateSql(
        createOptions({
          tableNodes: [
            createTableNode('users', 't1'),
            createTableNode('products', 't2'),
          ],
        })
      )

      expect(result.sql).toContain('FROM users AS t1')
      expect(result.sql).toContain('CROSS JOIN products AS t2')
    })
  })

  describe('JOIN clause', () => {
    it('adds INNER JOIN', () => {
      const join: JoinConfig = {
        id: 'join-1',
        sourceTable: 'users',
        sourceColumn: 'id',
        targetTable: 'orders',
        targetColumn: 'user_id',
        joinType: 'INNER',
      }

      const result = generateSql(
        createOptions({
          tableNodes: [
            createTableNode('users', 't1', ['id']),
            createTableNode('orders', 't2', ['order_id']),
          ],
          joins: [join],
        })
      )

      expect(result.sql).toContain('JOIN orders AS t2 ON t1.id = t2.user_id')
    })

    it('adds LEFT JOIN', () => {
      const join: JoinConfig = {
        id: 'join-1',
        sourceTable: 'users',
        sourceColumn: 'id',
        targetTable: 'orders',
        targetColumn: 'user_id',
        joinType: 'LEFT',
      }

      const result = generateSql(
        createOptions({
          tableNodes: [
            createTableNode('users', 't1'),
            createTableNode('orders', 't2'),
          ],
          joins: [join],
        })
      )

      expect(result.sql).toContain('LEFT JOIN orders AS t2 ON t1.id = t2.user_id')
    })

    it('adds RIGHT JOIN', () => {
      const join: JoinConfig = {
        id: 'join-1',
        sourceTable: 'users',
        sourceColumn: 'id',
        targetTable: 'orders',
        targetColumn: 'user_id',
        joinType: 'RIGHT',
      }

      const result = generateSql(
        createOptions({
          tableNodes: [
            createTableNode('users', 't1'),
            createTableNode('orders', 't2'),
          ],
          joins: [join],
        })
      )

      expect(result.sql).toContain('RIGHT JOIN orders AS t2 ON t1.id = t2.user_id')
    })

    it('handles multiple joins', () => {
      const joins: JoinConfig[] = [
        {
          id: 'join-1',
          sourceTable: 'users',
          sourceColumn: 'id',
          targetTable: 'orders',
          targetColumn: 'user_id',
          joinType: 'INNER',
        },
        {
          id: 'join-2',
          sourceTable: 'orders',
          sourceColumn: 'product_id',
          targetTable: 'products',
          targetColumn: 'id',
          joinType: 'LEFT',
        },
      ]

      const result = generateSql(
        createOptions({
          tableNodes: [
            createTableNode('users', 't1'),
            createTableNode('orders', 't2'),
            createTableNode('products', 't3'),
          ],
          joins,
        })
      )

      expect(result.sql).toContain('JOIN orders AS t2 ON t1.id = t2.user_id')
      expect(result.sql).toContain('LEFT JOIN products AS t3 ON t2.product_id = t3.id')
    })
  })

  describe('WHERE clause', () => {
    it('omits WHERE when no conditions', () => {
      const result = generateSql(
        createOptions({
          tableNodes: [createTableNode('users', 't1')],
        })
      )

      expect(result.sql).not.toContain('WHERE')
    })

    it('adds simple equality condition', () => {
      const conditions: WhereCondition[] = [
        {
          id: 'cond-1',
          column: 't1.status',
          operator: '=',
          value: 'active',
        },
      ]

      const result = generateSql(
        createOptions({
          tableNodes: [createTableNode('users', 't1')],
          whereConditions: conditions,
        })
      )

      expect(result.sql).toContain('WHERE t1.status = ?')
      expect(result.params).toEqual(['active'])
    })

    it('combines conditions with AND', () => {
      const conditions: WhereCondition[] = [
        { id: 'cond-1', column: 't1.status', operator: '=', value: 'active' },
        { id: 'cond-2', column: 't1.age', operator: '>=', value: '18' },
      ]

      const result = generateSql(
        createOptions({
          tableNodes: [createTableNode('users', 't1')],
          whereConditions: conditions,
          whereLogic: 'AND',
        })
      )

      expect(result.sql).toContain('WHERE t1.status = ? AND t1.age >= ?')
    })

    it('combines conditions with OR', () => {
      const conditions: WhereCondition[] = [
        { id: 'cond-1', column: 't1.role', operator: '=', value: 'admin' },
        { id: 'cond-2', column: 't1.role', operator: '=', value: 'moderator' },
      ]

      const result = generateSql(
        createOptions({
          tableNodes: [createTableNode('users', 't1')],
          whereConditions: conditions,
          whereLogic: 'OR',
        })
      )

      expect(result.sql).toContain('WHERE t1.role = ? OR t1.role = ?')
    })

    it('handles IS NULL condition', () => {
      const conditions: WhereCondition[] = [
        { id: 'cond-1', column: 't1.deleted_at', operator: 'IS NULL', value: '' },
      ]

      const result = generateSql(
        createOptions({
          tableNodes: [createTableNode('users', 't1')],
          whereConditions: conditions,
        })
      )

      expect(result.sql).toContain('WHERE t1.deleted_at IS NULL')
      expect(result.params).toEqual([])
    })
  })

  describe('ORDER BY clause', () => {
    it('omits ORDER BY when no sort conditions', () => {
      const result = generateSql(
        createOptions({
          tableNodes: [createTableNode('users', 't1')],
        })
      )

      expect(result.sql).not.toContain('ORDER BY')
    })

    it('adds ORDER BY with single column', () => {
      const sortConditions: SortCondition[] = [
        { id: 'sort-1', column: 't1.name', direction: 'ASC' },
      ]

      const result = generateSql(
        createOptions({
          tableNodes: [createTableNode('users', 't1')],
          sortConditions,
        })
      )

      expect(result.sql).toContain('ORDER BY t1.name ASC')
    })

    it('adds ORDER BY with multiple columns', () => {
      const sortConditions: SortCondition[] = [
        { id: 'sort-1', column: 't1.last_name', direction: 'ASC' },
        { id: 'sort-2', column: 't1.first_name', direction: 'DESC' },
      ]

      const result = generateSql(
        createOptions({
          tableNodes: [createTableNode('users', 't1')],
          sortConditions,
        })
      )

      expect(result.sql).toContain('ORDER BY t1.last_name ASC, t1.first_name DESC')
    })
  })

  describe('LIMIT clause', () => {
    it('omits LIMIT when null', () => {
      const result = generateSql(
        createOptions({
          tableNodes: [createTableNode('users', 't1')],
          limit: null,
        })
      )

      expect(result.sql).not.toContain('LIMIT')
    })

    it('adds LIMIT when provided', () => {
      const result = generateSql(
        createOptions({
          tableNodes: [createTableNode('users', 't1')],
          limit: 100,
        })
      )

      expect(result.sql).toContain('LIMIT 100')
    })

    it('does not add LIMIT when zero', () => {
      const result = generateSql(
        createOptions({
          tableNodes: [createTableNode('users', 't1')],
          limit: 0,
        })
      )

      expect(result.sql).not.toContain('LIMIT')
    })
  })

  describe('full query generation', () => {
    it('generates complete SELECT statement', () => {
      const tableNodes = [
        createTableNode('users', 't1', ['id', 'name']),
        createTableNode('orders', 't2', ['order_id', 'total']),
      ]

      const joins: JoinConfig[] = [
        {
          id: 'join-1',
          sourceTable: 'users',
          sourceColumn: 'id',
          targetTable: 'orders',
          targetColumn: 'user_id',
          joinType: 'INNER',
        },
      ]

      const whereConditions: WhereCondition[] = [
        { id: 'cond-1', column: 't2.total', operator: '>', value: '100' },
      ]

      const sortConditions: SortCondition[] = [
        { id: 'sort-1', column: 't2.total', direction: 'DESC' },
      ]

      const result = generateSql(
        createOptions({
          tableNodes,
          joins,
          whereConditions,
          whereLogic: 'AND',
          sortConditions,
          limit: 50,
        })
      )

      expect(result.isValid).toBe(true)
      expect(result.sql).toContain('SELECT')
      expect(result.sql).toContain('t1.id')
      expect(result.sql).toContain('t1.name')
      expect(result.sql).toContain('t2.order_id')
      expect(result.sql).toContain('t2.total')
      expect(result.sql).toContain('FROM users AS t1')
      expect(result.sql).toContain('JOIN orders AS t2')
      expect(result.sql).toContain('WHERE t2.total > ?')
      expect(result.sql).toContain('ORDER BY t2.total DESC')
      expect(result.sql).toContain('LIMIT 50')
      expect(result.params).toEqual(['100'])
    })
  })
})
