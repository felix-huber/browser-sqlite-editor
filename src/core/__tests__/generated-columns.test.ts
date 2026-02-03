import { describe, it, expect } from 'vitest'
import {
  extractGeneratedExpressionFromCreateSql,
  applyGeneratedExpressions,
} from '../db/generated-columns'

describe('extractGeneratedExpressionFromCreateSql', () => {
  it('extracts generated expression for unquoted column', () => {
    const sql = `CREATE TABLE test (
      id INTEGER,
      total INTEGER GENERATED ALWAYS AS (price * qty) STORED
    )`

    expect(extractGeneratedExpressionFromCreateSql(sql, 'total')).toBe('price * qty')
  })

  it('extracts generated expression for quoted column with nested parentheses', () => {
    const sql = `CREATE TABLE test (
      "calc" INTEGER GENERATED AS ((a + b) * (c - 1)) VIRTUAL
    )`

    expect(extractGeneratedExpressionFromCreateSql(sql, 'calc')).toBe('(a + b) * (c - 1)')
  })

  it('returns null when column is not generated', () => {
    const sql = `CREATE TABLE test (
      name TEXT,
      age INTEGER
    )`

    expect(extractGeneratedExpressionFromCreateSql(sql, 'age')).toBe(null)
  })

  it('returns null for empty inputs', () => {
    expect(extractGeneratedExpressionFromCreateSql('', 'col')).toBe(null)
    expect(extractGeneratedExpressionFromCreateSql('CREATE TABLE t (a INT)', '')).toBe(null)
  })
})

describe('applyGeneratedExpressions', () => {
  it('fills generatedAs when generatedType exists', () => {
    const sql = `CREATE TABLE test (
      total INTEGER GENERATED ALWAYS AS (price * qty) STORED,
      name TEXT
    )`

    const columns = [
      { name: 'total', type: 'INTEGER', generatedType: 'stored' as const },
      { name: 'name', type: 'TEXT' },
    ]

    const result = applyGeneratedExpressions(columns, sql)

    expect(result[0].generatedAs).toBe('price * qty')
    expect(result[1].generatedAs).toBeUndefined()
  })

  it('does not override existing generatedAs', () => {
    const sql = `CREATE TABLE test (
      total INTEGER GENERATED ALWAYS AS (price * qty) STORED
    )`

    const columns = [
      {
        name: 'total',
        type: 'INTEGER',
        generatedType: 'stored' as const,
        generatedAs: 'price + qty',
      },
    ]

    const result = applyGeneratedExpressions(columns, sql)

    expect(result[0].generatedAs).toBe('price + qty')
  })
})
