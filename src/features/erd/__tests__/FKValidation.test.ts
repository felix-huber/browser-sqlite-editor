import { describe, it, expect } from 'vitest'
import {
  validateParentColumnUniqueness,
  buildDataIntegrityQuery,
  parseDataIntegrityResult,
  generateCreateUniqueIndexDDL,
  type TableSchemaInfo,
} from '../FKValidation'

describe('FKValidation', () => {
  describe('validateParentColumnUniqueness', () => {
    const makeTableSchema = (overrides: Partial<TableSchemaInfo> = {}): TableSchemaInfo => ({
      name: 'users',
      columns: [
        { name: 'id', type: 'INTEGER', pk: 1, notnull: true },
        { name: 'email', type: 'TEXT', pk: 0, notnull: false },
      ],
      indexes: [],
      pkColumns: ['id'],
      ...overrides,
    })

    it('returns valid when parent column is single-column PK', () => {
      const schema = makeTableSchema({
        pkColumns: ['id'],
      })

      const result = validateParentColumnUniqueness(schema, 'id')

      expect(result.isValid).toBe(true)
      expect(result.isSingleColumnPK).toBe(true)
      expect(result.hasSingleColumnUniqueIndex).toBe(false)
    })

    it('returns valid when parent column has single-column UNIQUE index', () => {
      const schema = makeTableSchema({
        pkColumns: ['id'],
        indexes: [
          { name: 'idx_email', unique: true, columns: ['email'], partial: false },
        ],
      })

      const result = validateParentColumnUniqueness(schema, 'email')

      expect(result.isValid).toBe(true)
      expect(result.isSingleColumnPK).toBe(false)
      expect(result.hasSingleColumnUniqueIndex).toBe(true)
    })

    it('returns invalid when parent column is part of composite PK', () => {
      const schema = makeTableSchema({
        columns: [
          { name: 'user_id', type: 'INTEGER', pk: 1, notnull: true },
          { name: 'role_id', type: 'INTEGER', pk: 2, notnull: true },
        ],
        pkColumns: ['user_id', 'role_id'],
      })

      const result = validateParentColumnUniqueness(schema, 'user_id')

      expect(result.isValid).toBe(false)
      expect(result.isSingleColumnPK).toBe(false)
      expect(result.isPartOfCompositePK).toBe(true)
      expect(result.errorMessage).toBe(
        'Referenced column must be a single-column PRIMARY KEY or have a UNIQUE index on that column.'
      )
    })

    it('returns invalid when parent column is part of composite UNIQUE index only', () => {
      const schema = makeTableSchema({
        indexes: [
          { name: 'idx_composite', unique: true, columns: ['email', 'name'], partial: false },
        ],
      })

      const result = validateParentColumnUniqueness(schema, 'email')

      expect(result.isValid).toBe(false)
      expect(result.isPartOfCompositeUniqueIndex).toBe(true)
    })

    it('returns invalid when parent column has no unique constraint', () => {
      const schema = makeTableSchema({
        indexes: [],
      })

      const result = validateParentColumnUniqueness(schema, 'email')

      expect(result.isValid).toBe(false)
      expect(result.canCreateUniqueIndex).toBe(true)
    })

    it('returns canCreateUniqueIndex true for non-unique columns', () => {
      const schema = makeTableSchema({
        indexes: [
          { name: 'idx_email_nonunique', unique: false, columns: ['email'], partial: false },
        ],
      })

      const result = validateParentColumnUniqueness(schema, 'email')

      expect(result.isValid).toBe(false)
      expect(result.canCreateUniqueIndex).toBe(true)
    })

    it('case-insensitive column name matching', () => {
      const schema = makeTableSchema({
        pkColumns: ['ID'],
      })

      const result = validateParentColumnUniqueness(schema, 'id')

      expect(result.isValid).toBe(true)
      expect(result.isSingleColumnPK).toBe(true)
    })

    it('returns invalid for partial unique index on column', () => {
      const schema = makeTableSchema({
        indexes: [
          { name: 'idx_email_partial', unique: true, columns: ['email'], partial: true },
        ],
      })

      const result = validateParentColumnUniqueness(schema, 'email')

      // Partial indexes don't count as full uniqueness guarantees
      expect(result.isValid).toBe(false)
    })
  })

  describe('buildDataIntegrityQuery', () => {
    it('builds correct NULL-safe anti-join query for sample rows', () => {
      const query = buildDataIntegrityQuery({
        childTable: 'orders',
        childColumn: 'user_id',
        parentTable: 'users',
        parentColumn: 'id',
        mode: 'sample',
        limit: 10,
      })

      expect(query).toContain('SELECT')
      expect(query).toContain('"orders"')
      expect(query).toContain('"users"')
      expect(query).toContain('"user_id"')
      expect(query).toContain('IS NOT NULL')
      expect(query).toContain('IS NULL')
      expect(query).toContain('LIMIT 10')
    })

    it('builds correct count query for total violations', () => {
      const query = buildDataIntegrityQuery({
        childTable: 'orders',
        childColumn: 'user_id',
        parentTable: 'users',
        parentColumn: 'id',
        mode: 'count',
      })

      expect(query).toContain('COUNT(*)')
      expect(query).toContain('"orders"')
      expect(query).toContain('"users"')
      expect(query).not.toContain('LIMIT')
    })

    it('properly escapes table and column names with quotes', () => {
      const query = buildDataIntegrityQuery({
        childTable: 'my"table',
        childColumn: 'col"name',
        parentTable: 'parent"table',
        parentColumn: 'pk"col',
        mode: 'sample',
        limit: 10,
      })

      // Double quotes inside identifiers should be escaped as ""
      expect(query).toContain('"my""table"')
      expect(query).toContain('"col""name"')
      expect(query).toContain('"parent""table"')
      expect(query).toContain('"pk""col"')
    })

    it('handles self-referential FK correctly', () => {
      const query = buildDataIntegrityQuery({
        childTable: 'employees',
        childColumn: 'manager_id',
        parentTable: 'employees',
        parentColumn: 'id',
        mode: 'sample',
        limit: 10,
      })

      expect(query).toContain('AS child')
      expect(query).toContain('AS parent')
      // Self-reference should use aliased table names
      expect(query).toContain('child."manager_id"')
      expect(query).toContain('parent."id"')
    })
  })

  describe('parseDataIntegrityResult', () => {
    it('returns valid when no violations found', () => {
      const result = parseDataIntegrityResult({
        violationCount: 0,
        sampleRows: [],
      })

      expect(result.isValid).toBe(true)
      expect(result.violationCount).toBe(0)
      expect(result.sampleViolations).toEqual([])
    })

    it('returns invalid with sample rows when violations exist', () => {
      const sampleRows = [
        { user_id: 999, order_id: 1 },
        { user_id: 888, order_id: 2 },
      ]

      const result = parseDataIntegrityResult({
        violationCount: 42,
        sampleRows,
      })

      expect(result.isValid).toBe(false)
      expect(result.violationCount).toBe(42)
      expect(result.sampleViolations).toEqual(sampleRows)
      expect(result.errorMessage).toContain('42')
    })

    it('truncates sample rows to 10 maximum', () => {
      const sampleRows = Array.from({ length: 15 }, (_, i) => ({ id: i }))

      const result = parseDataIntegrityResult({
        violationCount: 15,
        sampleRows,
      })

      expect(result.sampleViolations.length).toBe(10)
    })
  })

  describe('generateCreateUniqueIndexDDL', () => {
    it('generates correct CREATE UNIQUE INDEX DDL', () => {
      const ddl = generateCreateUniqueIndexDDL('users', 'email')

      expect(ddl).toBe('CREATE UNIQUE INDEX "idx_users_email_unique" ON "users" ("email")')
    })

    it('escapes special characters in table and column names', () => {
      const ddl = generateCreateUniqueIndexDDL('my"table', 'col"name')

      expect(ddl).toContain('"my""table"')
      expect(ddl).toContain('"col""name"')
    })

    it('generates deterministic index name', () => {
      const ddl1 = generateCreateUniqueIndexDDL('users', 'email')
      const ddl2 = generateCreateUniqueIndexDDL('users', 'email')

      expect(ddl1).toBe(ddl2)
    })
  })
})
