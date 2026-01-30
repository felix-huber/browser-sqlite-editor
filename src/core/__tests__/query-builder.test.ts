import { describe, it, expect } from 'vitest'
import {
  generateSelectQuery,
  quoteIdentifier,
  type QueryBuilderState,
} from '../sql/query-builder'

describe('quoteIdentifier', () => {
  it('quotes simple identifier', () => {
    expect(quoteIdentifier('users')).toBe('"users"')
  })

  it('escapes double quotes', () => {
    expect(quoteIdentifier('my"table')).toBe('"my""table"')
  })

  it('handles multiple double quotes', () => {
    expect(quoteIdentifier('a"b"c')).toBe('"a""b""c"')
  })

  it('handles empty string', () => {
    expect(quoteIdentifier('')).toBe('""')
  })
})

describe('generateSelectQuery', () => {
  describe('empty state', () => {
    it('returns empty query for no tables', () => {
      const state: QueryBuilderState = {
        tables: [],
        joins: [],
        whereConditions: [],
        whereLogic: 'AND',
        sortConditions: [],
        limit: null,
      }

      const result = generateSelectQuery(state)

      expect(result.sql).toBe('')
      expect(result.params).toEqual([])
    })
  })

  describe('single table, all columns', () => {
    it('generates SELECT t1.* FROM table1 t1', () => {
      const state: QueryBuilderState = {
        tables: [
          { name: 'users', alias: 't1', selectedColumns: [], allColumns: ['id', 'name'] },
        ],
        joins: [],
        whereConditions: [],
        whereLogic: 'AND',
        sortConditions: [],
        limit: null,
      }

      const result = generateSelectQuery(state)

      expect(result.sql).toBe('SELECT "t1".* FROM "users" "t1"')
      expect(result.params).toEqual([])
    })
  })

  describe('single table, specific columns', () => {
    it('generates SELECT t1.col1, t1.col2 FROM table1 t1', () => {
      const state: QueryBuilderState = {
        tables: [
          {
            name: 'users',
            alias: 't1',
            selectedColumns: ['id', 'name'],
            allColumns: ['id', 'name', 'email'],
          },
        ],
        joins: [],
        whereConditions: [],
        whereLogic: 'AND',
        sortConditions: [],
        limit: null,
      }

      const result = generateSelectQuery(state)

      expect(result.sql).toBe('SELECT "t1"."id", "t1"."name" FROM "users" "t1"')
      expect(result.params).toEqual([])
    })
  })

  describe('duplicate column names', () => {
    it('adds AS alias for duplicate column names', () => {
      const state: QueryBuilderState = {
        tables: [
          {
            name: 'users',
            alias: 't1',
            selectedColumns: ['name'],
            allColumns: ['id', 'name'],
          },
          {
            name: 'products',
            alias: 't2',
            selectedColumns: ['name'],
            allColumns: ['id', 'name'],
          },
        ],
        joins: [
          {
            sourceAlias: 't1',
            sourceColumn: 'id',
            targetAlias: 't2',
            targetColumn: 'user_id',
            joinType: 'INNER',
          },
        ],
        whereConditions: [],
        whereLogic: 'AND',
        sortConditions: [],
        limit: null,
      }

      const result = generateSelectQuery(state)

      expect(result.sql).toContain('"t1"."name"')
      expect(result.sql).toContain('"t2"."name" AS "name_2"')
    })

    it('handles three tables with same column name', () => {
      const state: QueryBuilderState = {
        tables: [
          { name: 'a', alias: 't1', selectedColumns: ['id'], allColumns: ['id'] },
          { name: 'b', alias: 't2', selectedColumns: ['id'], allColumns: ['id'] },
          { name: 'c', alias: 't3', selectedColumns: ['id'], allColumns: ['id'] },
        ],
        joins: [
          { sourceAlias: 't1', sourceColumn: 'id', targetAlias: 't2', targetColumn: 'a_id', joinType: 'INNER' },
          { sourceAlias: 't1', sourceColumn: 'id', targetAlias: 't3', targetColumn: 'a_id', joinType: 'INNER' },
        ],
        whereConditions: [],
        whereLogic: 'AND',
        sortConditions: [],
        limit: null,
      }

      const result = generateSelectQuery(state)

      expect(result.sql).toContain('"t1"."id"')
      expect(result.sql).toContain('"t2"."id" AS "id_2"')
      expect(result.sql).toContain('"t3"."id" AS "id_3"')
    })
  })

  describe('two tables with JOIN', () => {
    it('generates proper INNER JOIN syntax', () => {
      const state: QueryBuilderState = {
        tables: [
          { name: 'users', alias: 't1', selectedColumns: [], allColumns: ['id', 'name'] },
          { name: 'orders', alias: 't2', selectedColumns: [], allColumns: ['id', 'user_id'] },
        ],
        joins: [
          {
            sourceAlias: 't1',
            sourceColumn: 'id',
            targetAlias: 't2',
            targetColumn: 'user_id',
            joinType: 'INNER',
          },
        ],
        whereConditions: [],
        whereLogic: 'AND',
        sortConditions: [],
        limit: null,
      }

      const result = generateSelectQuery(state)

      expect(result.sql).toBe(
        'SELECT "t1".*, "t2".* FROM "users" "t1" INNER JOIN "orders" "t2" ON "t1"."id" = "t2"."user_id"'
      )
    })

    it('generates LEFT JOIN syntax', () => {
      const state: QueryBuilderState = {
        tables: [
          { name: 'users', alias: 't1', selectedColumns: [], allColumns: ['id'] },
          { name: 'orders', alias: 't2', selectedColumns: [], allColumns: ['id'] },
        ],
        joins: [
          {
            sourceAlias: 't1',
            sourceColumn: 'id',
            targetAlias: 't2',
            targetColumn: 'user_id',
            joinType: 'LEFT',
          },
        ],
        whereConditions: [],
        whereLogic: 'AND',
        sortConditions: [],
        limit: null,
      }

      const result = generateSelectQuery(state)

      expect(result.sql).toContain('LEFT JOIN')
    })

    it('generates RIGHT JOIN syntax', () => {
      const state: QueryBuilderState = {
        tables: [
          { name: 'users', alias: 't1', selectedColumns: [], allColumns: ['id'] },
          { name: 'orders', alias: 't2', selectedColumns: [], allColumns: ['id'] },
        ],
        joins: [
          {
            sourceAlias: 't1',
            sourceColumn: 'id',
            targetAlias: 't2',
            targetColumn: 'user_id',
            joinType: 'RIGHT',
          },
        ],
        whereConditions: [],
        whereLogic: 'AND',
        sortConditions: [],
        limit: null,
      }

      const result = generateSelectQuery(state)

      expect(result.sql).toContain('RIGHT JOIN')
    })

    it('generates FULL OUTER JOIN syntax', () => {
      const state: QueryBuilderState = {
        tables: [
          { name: 'users', alias: 't1', selectedColumns: [], allColumns: ['id'] },
          { name: 'orders', alias: 't2', selectedColumns: [], allColumns: ['id'] },
        ],
        joins: [
          {
            sourceAlias: 't1',
            sourceColumn: 'id',
            targetAlias: 't2',
            targetColumn: 'user_id',
            joinType: 'FULL',
          },
        ],
        whereConditions: [],
        whereLogic: 'AND',
        sortConditions: [],
        limit: null,
      }

      const result = generateSelectQuery(state)

      expect(result.sql).toContain('FULL OUTER JOIN')
    })
  })

  describe('WHERE with equals', () => {
    it('generates WHERE clause with parameterized value', () => {
      const state: QueryBuilderState = {
        tables: [
          { name: 'users', alias: 't1', selectedColumns: [], allColumns: ['id', 'name'] },
        ],
        joins: [],
        whereConditions: [
          { id: 'c1', column: 't1.name', operator: '=', value: 'John' },
        ],
        whereLogic: 'AND',
        sortConditions: [],
        limit: null,
      }

      const result = generateSelectQuery(state)

      expect(result.sql).toContain('WHERE t1.name = ?')
      expect(result.params).toEqual(['John'])
    })
  })

  describe('WHERE with LIKE', () => {
    it('generates LIKE with proper escaping', () => {
      const state: QueryBuilderState = {
        tables: [
          { name: 'users', alias: 't1', selectedColumns: [], allColumns: ['id', 'name'] },
        ],
        joins: [],
        whereConditions: [
          { id: 'c1', column: 't1.name', operator: 'LIKE', value: 'test', likeMode: 'contains' },
        ],
        whereLogic: 'AND',
        sortConditions: [],
        limit: null,
      }

      const result = generateSelectQuery(state)

      expect(result.sql).toContain("WHERE t1.name LIKE ? ESCAPE '\\'")
      expect(result.params).toEqual(['%test%'])
    })

    it('escapes special LIKE characters in value', () => {
      const state: QueryBuilderState = {
        tables: [
          { name: 'users', alias: 't1', selectedColumns: [], allColumns: ['id', 'name'] },
        ],
        joins: [],
        whereConditions: [
          { id: 'c1', column: 't1.name', operator: 'LIKE', value: '100%_off', likeMode: 'contains' },
        ],
        whereLogic: 'AND',
        sortConditions: [],
        limit: null,
      }

      const result = generateSelectQuery(state)

      // Special chars %, _ should be escaped in the pattern
      expect(result.params).toEqual(['%100\\%\\_off%'])
    })
  })

  describe('ORDER BY', () => {
    it('generates ORDER BY clause', () => {
      const state: QueryBuilderState = {
        tables: [
          { name: 'users', alias: 't1', selectedColumns: [], allColumns: ['id', 'name'] },
        ],
        joins: [],
        whereConditions: [],
        whereLogic: 'AND',
        sortConditions: [
          { id: 's1', column: 't1.name', direction: 'ASC' },
        ],
        limit: null,
      }

      const result = generateSelectQuery(state)

      expect(result.sql).toContain('ORDER BY t1.name ASC')
    })

    it('handles multiple ORDER BY columns', () => {
      const state: QueryBuilderState = {
        tables: [
          { name: 'users', alias: 't1', selectedColumns: [], allColumns: ['id', 'name'] },
        ],
        joins: [],
        whereConditions: [],
        whereLogic: 'AND',
        sortConditions: [
          { id: 's1', column: 't1.name', direction: 'ASC' },
          { id: 's2', column: 't1.id', direction: 'DESC' },
        ],
        limit: null,
      }

      const result = generateSelectQuery(state)

      expect(result.sql).toContain('ORDER BY t1.name ASC, t1.id DESC')
    })

    it('skips empty column in ORDER BY', () => {
      const state: QueryBuilderState = {
        tables: [
          { name: 'users', alias: 't1', selectedColumns: [], allColumns: ['id', 'name'] },
        ],
        joins: [],
        whereConditions: [],
        whereLogic: 'AND',
        sortConditions: [
          { id: 's1', column: '', direction: 'ASC' },
          { id: 's2', column: 't1.id', direction: 'DESC' },
        ],
        limit: null,
      }

      const result = generateSelectQuery(state)

      expect(result.sql).toContain('ORDER BY t1.id DESC')
      expect(result.sql).not.toContain('ORDER BY ,')
    })
  })

  describe('LIMIT', () => {
    it('generates LIMIT clause', () => {
      const state: QueryBuilderState = {
        tables: [
          { name: 'users', alias: 't1', selectedColumns: [], allColumns: ['id', 'name'] },
        ],
        joins: [],
        whereConditions: [],
        whereLogic: 'AND',
        sortConditions: [],
        limit: 100,
      }

      const result = generateSelectQuery(state)

      expect(result.sql).toContain('LIMIT 100')
    })

    it('omits LIMIT when null', () => {
      const state: QueryBuilderState = {
        tables: [
          { name: 'users', alias: 't1', selectedColumns: [], allColumns: ['id', 'name'] },
        ],
        joins: [],
        whereConditions: [],
        whereLogic: 'AND',
        sortConditions: [],
        limit: null,
      }

      const result = generateSelectQuery(state)

      expect(result.sql).not.toContain('LIMIT')
    })

    it('truncates decimal limit to integer', () => {
      const state: QueryBuilderState = {
        tables: [
          { name: 'users', alias: 't1', selectedColumns: [], allColumns: ['id', 'name'] },
        ],
        joins: [],
        whereConditions: [],
        whereLogic: 'AND',
        sortConditions: [],
        limit: 10.7,
      }

      const result = generateSelectQuery(state)

      expect(result.sql).toContain('LIMIT 10')
    })
  })

  describe('combined query with all clauses', () => {
    it('generates full query with JOIN, WHERE, ORDER BY, LIMIT', () => {
      const state: QueryBuilderState = {
        tables: [
          { name: 'users', alias: 't1', selectedColumns: ['id', 'name'], allColumns: ['id', 'name', 'email'] },
          { name: 'orders', alias: 't2', selectedColumns: ['id', 'total'], allColumns: ['id', 'user_id', 'total'] },
        ],
        joins: [
          {
            sourceAlias: 't1',
            sourceColumn: 'id',
            targetAlias: 't2',
            targetColumn: 'user_id',
            joinType: 'LEFT',
          },
        ],
        whereConditions: [
          { id: 'c1', column: 't1.name', operator: '=', value: 'John' },
          { id: 'c2', column: 't2.total', operator: '>', value: '100' },
        ],
        whereLogic: 'AND',
        sortConditions: [
          { id: 's1', column: 't2.total', direction: 'DESC' },
        ],
        limit: 50,
      }

      const result = generateSelectQuery(state)

      // Check all clauses are present
      expect(result.sql).toContain('SELECT')
      expect(result.sql).toContain('"t1"."id"')
      expect(result.sql).toContain('"t1"."name"')
      expect(result.sql).toContain('"t2"."id" AS "id_2"')
      expect(result.sql).toContain('"t2"."total"')
      expect(result.sql).toContain('FROM "users" "t1"')
      expect(result.sql).toContain('LEFT JOIN "orders" "t2" ON "t1"."id" = "t2"."user_id"')
      expect(result.sql).toContain('WHERE t1.name = ? AND t2.total > ?')
      expect(result.sql).toContain('ORDER BY t2.total DESC')
      expect(result.sql).toContain('LIMIT 50')

      expect(result.params).toEqual(['John', '100'])
    })
  })

  describe('determinism', () => {
    it('produces identical output for same state', () => {
      const createState = (): QueryBuilderState => ({
        tables: [
          { name: 'users', alias: 't1', selectedColumns: ['id', 'name'], allColumns: ['id', 'name'] },
          { name: 'orders', alias: 't2', selectedColumns: ['id'], allColumns: ['id', 'user_id'] },
        ],
        joins: [
          { sourceAlias: 't1', sourceColumn: 'id', targetAlias: 't2', targetColumn: 'user_id', joinType: 'INNER' },
        ],
        whereConditions: [
          { id: 'c1', column: 't1.name', operator: 'LIKE', value: 'test', likeMode: 'contains' },
        ],
        whereLogic: 'AND',
        sortConditions: [
          { id: 's1', column: 't1.id', direction: 'ASC' },
        ],
        limit: 100,
      })

      const result1 = generateSelectQuery(createState())
      const result2 = generateSelectQuery(createState())

      expect(result1.sql).toBe(result2.sql)
      expect(result1.params).toEqual(result2.params)
    })

    it('produces identical output across multiple runs', () => {
      const state: QueryBuilderState = {
        tables: [
          { name: 'products', alias: 't1', selectedColumns: ['name', 'price'], allColumns: ['id', 'name', 'price'] },
        ],
        joins: [],
        whereConditions: [
          { id: 'c1', column: 't1.price', operator: '>', value: '50' },
        ],
        whereLogic: 'AND',
        sortConditions: [
          { id: 's1', column: 't1.price', direction: 'DESC' },
        ],
        limit: 10,
      }

      const results: string[] = []
      for (let i = 0; i < 10; i++) {
        results.push(generateSelectQuery(state).sql)
      }

      // All results should be identical
      const unique = [...new Set(results)]
      expect(unique).toHaveLength(1)
    })
  })

  describe('SQL injection prevention', () => {
    it('quotes table names with special characters', () => {
      const state: QueryBuilderState = {
        tables: [
          { name: 'my table', alias: 't1', selectedColumns: [], allColumns: ['id'] },
        ],
        joins: [],
        whereConditions: [],
        whereLogic: 'AND',
        sortConditions: [],
        limit: null,
      }

      const result = generateSelectQuery(state)

      expect(result.sql).toContain('"my table"')
    })

    it('escapes double quotes in identifiers', () => {
      const state: QueryBuilderState = {
        tables: [
          { name: 'table"name', alias: 't1', selectedColumns: [], allColumns: ['id'] },
        ],
        joins: [],
        whereConditions: [],
        whereLogic: 'AND',
        sortConditions: [],
        limit: null,
      }

      const result = generateSelectQuery(state)

      expect(result.sql).toContain('"table""name"')
    })

    it('uses parameterized values for WHERE conditions', () => {
      const state: QueryBuilderState = {
        tables: [
          { name: 'users', alias: 't1', selectedColumns: [], allColumns: ['id', 'name'] },
        ],
        joins: [],
        whereConditions: [
          { id: 'c1', column: 't1.name', operator: '=', value: "Robert'); DROP TABLE users;--" },
        ],
        whereLogic: 'AND',
        sortConditions: [],
        limit: null,
      }

      const result = generateSelectQuery(state)

      // SQL injection string should be in params, not in SQL
      expect(result.sql).toContain('t1.name = ?')
      expect(result.sql).not.toContain('DROP TABLE')
      expect(result.params).toEqual(["Robert'); DROP TABLE users;--"])
    })

    it('escapes special characters in LIKE patterns', () => {
      const state: QueryBuilderState = {
        tables: [
          { name: 'users', alias: 't1', selectedColumns: [], allColumns: ['id', 'name'] },
        ],
        joins: [],
        whereConditions: [
          { id: 'c1', column: 't1.name', operator: 'LIKE', value: '%admin%', likeMode: 'exact' },
        ],
        whereLogic: 'AND',
        sortConditions: [],
        limit: null,
      }

      const result = generateSelectQuery(state)

      // % should be escaped so it doesn't act as a wildcard
      expect(result.params).toEqual(['\\%admin\\%'])
    })
  })

  describe('edge cases', () => {
    it('handles table name with unicode', () => {
      const state: QueryBuilderState = {
        tables: [
          { name: 'utilisateurs', alias: 't1', selectedColumns: [], allColumns: ['id'] },
        ],
        joins: [],
        whereConditions: [],
        whereLogic: 'AND',
        sortConditions: [],
        limit: null,
      }

      const result = generateSelectQuery(state)

      expect(result.sql).toContain('"utilisateurs"')
    })

    it('handles column name with spaces', () => {
      const state: QueryBuilderState = {
        tables: [
          { name: 'users', alias: 't1', selectedColumns: ['first name'], allColumns: ['id', 'first name'] },
        ],
        joins: [],
        whereConditions: [],
        whereLogic: 'AND',
        sortConditions: [],
        limit: null,
      }

      const result = generateSelectQuery(state)

      expect(result.sql).toContain('"first name"')
    })

    it('handles zero limit as no limit', () => {
      const state: QueryBuilderState = {
        tables: [
          { name: 'users', alias: 't1', selectedColumns: [], allColumns: ['id'] },
        ],
        joins: [],
        whereConditions: [],
        whereLogic: 'AND',
        sortConditions: [],
        limit: 0,
      }

      const result = generateSelectQuery(state)

      expect(result.sql).not.toContain('LIMIT')
    })

    it('handles negative limit as no limit', () => {
      const state: QueryBuilderState = {
        tables: [
          { name: 'users', alias: 't1', selectedColumns: [], allColumns: ['id'] },
        ],
        joins: [],
        whereConditions: [],
        whereLogic: 'AND',
        sortConditions: [],
        limit: -10,
      }

      const result = generateSelectQuery(state)

      expect(result.sql).not.toContain('LIMIT')
    })
  })
})
