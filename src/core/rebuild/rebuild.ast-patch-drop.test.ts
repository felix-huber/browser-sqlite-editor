import { describe, it, expect } from 'vitest'
import { parseCreateTable, serializeCreateTable } from './ddl-parser'
import { dropColumn } from './ast-patch'
import { generateColumnMappedCopyDataSql } from './plan'

describe('AST Patch: dropColumn', () => {
  describe('basic drop column', () => {
    it('drops a column from simple table', () => {
      const sql = 'CREATE TABLE users (id INTEGER, name TEXT, email TEXT)'
      const ast = parseCreateTable(sql)

      const patched = dropColumn(ast, 'name')

      expect(patched.columns).toHaveLength(2)
      expect(patched.columns.map((c) => c.name)).toEqual(['id', 'email'])
    })

    it('drops first column', () => {
      const sql = 'CREATE TABLE t (a INTEGER, b TEXT, c REAL)'
      const ast = parseCreateTable(sql)

      const patched = dropColumn(ast, 'a')

      expect(patched.columns).toHaveLength(2)
      expect(patched.columns[0].name).toBe('b')
      expect(patched.columns[1].name).toBe('c')
    })

    it('drops last column', () => {
      const sql = 'CREATE TABLE t (a INTEGER, b TEXT, c REAL)'
      const ast = parseCreateTable(sql)

      const patched = dropColumn(ast, 'c')

      expect(patched.columns).toHaveLength(2)
      expect(patched.columns[0].name).toBe('a')
      expect(patched.columns[1].name).toBe('b')
    })

    it('throws when column not found', () => {
      const sql = 'CREATE TABLE users (id INTEGER, name TEXT)'
      const ast = parseCreateTable(sql)

      expect(() => dropColumn(ast, 'nonexistent')).toThrow()
    })

    it('handles case-insensitive column matching', () => {
      const sql = 'CREATE TABLE users (ID INTEGER, Name TEXT)'
      const ast = parseCreateTable(sql)

      const patched = dropColumn(ast, 'name')

      expect(patched.columns).toHaveLength(1)
      expect(patched.columns[0].name).toBe('ID')
    })
  })

  describe('preserves existing clauses after dropColumn', () => {
    it('preserves CHECK constraint on remaining column', () => {
      const sql = 'CREATE TABLE t (x INTEGER CHECK (x > 0), y TEXT)'
      const ast = parseCreateTable(sql)

      const patched = dropColumn(ast, 'y')
      const serialized = serializeCreateTable(patched)

      expect(serialized.toUpperCase()).toContain('CHECK')
      expect(serialized).toContain('x > 0')
    })

    it('preserves table-level CHECK constraint', () => {
      const sql = 'CREATE TABLE t (a INTEGER, b INTEGER, c TEXT, CHECK (a < b))'
      const ast = parseCreateTable(sql)

      const patched = dropColumn(ast, 'c')
      const serialized = serializeCreateTable(patched)

      expect(serialized.toUpperCase()).toContain('CHECK')
      expect(serialized).toContain('a < b')
    })

    it('preserves GENERATED column', () => {
      const sql =
        'CREATE TABLE t (a INTEGER, b INTEGER GENERATED ALWAYS AS (a * 2) STORED, c TEXT)'
      const ast = parseCreateTable(sql)

      const patched = dropColumn(ast, 'c')
      const serialized = serializeCreateTable(patched)

      expect(serialized.toUpperCase()).toContain('GENERATED ALWAYS AS')
      expect(serialized.toUpperCase()).toContain('STORED')
      expect(serialized).toContain('a * 2')
    })

    it('preserves WITHOUT ROWID', () => {
      const sql = 'CREATE TABLE t (k TEXT PRIMARY KEY, v BLOB, extra TEXT) WITHOUT ROWID'
      const ast = parseCreateTable(sql)

      const patched = dropColumn(ast, 'extra')
      const serialized = serializeCreateTable(patched)

      expect(serialized.toUpperCase()).toContain('WITHOUT ROWID')
    })

    it('preserves STRICT', () => {
      const sql = 'CREATE TABLE t (id INTEGER PRIMARY KEY, data TEXT, extra TEXT) STRICT'
      const ast = parseCreateTable(sql)

      const patched = dropColumn(ast, 'extra')
      const serialized = serializeCreateTable(patched)

      expect(serialized.toUpperCase()).toContain('STRICT')
    })

    it('preserves STRICT and WITHOUT ROWID combined', () => {
      const sql =
        'CREATE TABLE t (k TEXT PRIMARY KEY, v BLOB, extra TEXT) STRICT, WITHOUT ROWID'
      const ast = parseCreateTable(sql)

      const patched = dropColumn(ast, 'extra')
      const serialized = serializeCreateTable(patched)

      expect(serialized.toUpperCase()).toContain('STRICT')
      expect(serialized.toUpperCase()).toContain('WITHOUT ROWID')
    })

    it('preserves AUTOINCREMENT', () => {
      const sql = 'CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, extra TEXT)'
      const ast = parseCreateTable(sql)

      const patched = dropColumn(ast, 'extra')
      const serialized = serializeCreateTable(patched)

      expect(serialized.toUpperCase()).toContain('AUTOINCREMENT')
    })

    it('preserves FOREIGN KEY constraint', () => {
      const sql =
        'CREATE TABLE t (user_id INTEGER, extra TEXT, FOREIGN KEY (user_id) REFERENCES users(id))'
      const ast = parseCreateTable(sql)

      const patched = dropColumn(ast, 'extra')
      const serialized = serializeCreateTable(patched)

      expect(serialized.toUpperCase()).toContain('FOREIGN KEY')
      expect(serialized.toUpperCase()).toContain('REFERENCES')
    })

    it('preserves column-level REFERENCES', () => {
      const sql = 'CREATE TABLE t (user_id INTEGER REFERENCES users(id), extra TEXT)'
      const ast = parseCreateTable(sql)

      const patched = dropColumn(ast, 'extra')
      const serialized = serializeCreateTable(patched)

      expect(serialized.toUpperCase()).toContain('REFERENCES')
    })

    it('preserves COLLATE', () => {
      const sql = 'CREATE TABLE t (name TEXT COLLATE NOCASE, extra TEXT)'
      const ast = parseCreateTable(sql)

      const patched = dropColumn(ast, 'extra')
      const serialized = serializeCreateTable(patched)

      expect(serialized.toUpperCase()).toContain('COLLATE NOCASE')
    })

    it('preserves ON CONFLICT', () => {
      const sql = 'CREATE TABLE t (id INTEGER PRIMARY KEY ON CONFLICT REPLACE, extra TEXT)'
      const ast = parseCreateTable(sql)

      const patched = dropColumn(ast, 'extra')
      const serialized = serializeCreateTable(patched)

      expect(serialized.toUpperCase()).toContain('ON CONFLICT REPLACE')
    })

    it('preserves table-level PRIMARY KEY', () => {
      const sql = 'CREATE TABLE t (a INTEGER, b INTEGER, c TEXT, PRIMARY KEY (a, b))'
      const ast = parseCreateTable(sql)

      const patched = dropColumn(ast, 'c')
      const serialized = serializeCreateTable(patched)

      expect(serialized.toUpperCase()).toContain('PRIMARY KEY (')
    })

    it('preserves UNIQUE table constraint', () => {
      const sql = 'CREATE TABLE t (a INTEGER, b INTEGER, c TEXT, UNIQUE (a, b))'
      const ast = parseCreateTable(sql)

      const patched = dropColumn(ast, 'c')
      const serialized = serializeCreateTable(patched)

      expect(serialized.toUpperCase()).toContain('UNIQUE (')
    })

    it('preserves named constraint', () => {
      const sql = 'CREATE TABLE t (x INTEGER, y TEXT, CONSTRAINT chk_x CHECK (x > 0))'
      const ast = parseCreateTable(sql)

      const patched = dropColumn(ast, 'y')
      const serialized = serializeCreateTable(patched)

      expect(serialized.toUpperCase()).toContain('CONSTRAINT')
      expect(serialized).toContain('chk_x')
    })
  })

  describe('immutability', () => {
    it('does not mutate original AST', () => {
      const sql = 'CREATE TABLE users (id INTEGER, name TEXT)'
      const ast = parseCreateTable(sql)
      const originalLength = ast.columns.length

      dropColumn(ast, 'name')

      expect(ast.columns.length).toBe(originalLength)
    })
  })
})

describe('Copy statement for drop column', () => {
  it('excludes dropped column from copy', () => {
    const sourceColumns = ['id', 'name', 'email']
    const targetColumns = ['id', 'email'] // 'name' dropped

    const sql = generateColumnMappedCopyDataSql(
      'users',
      '_users_rebuild_temp',
      sourceColumns,
      targetColumns
    )

    expect(sql).toContain('INSERT INTO _users_rebuild_temp')
    expect(sql).toContain('SELECT id, email')
    expect(sql).not.toContain('name')
  })

  it('preserves column order when dropping middle column', () => {
    const sourceColumns = ['a', 'b', 'c', 'd']
    const targetColumns = ['a', 'c', 'd'] // 'b' dropped

    const sql = generateColumnMappedCopyDataSql(
      't',
      '_t_rebuild_temp',
      sourceColumns,
      targetColumns
    )

    expect(sql).toBe(
      'INSERT INTO _t_rebuild_temp (a, c, d) SELECT a, c, d FROM t'
    )
  })

  it('handles dropping first column', () => {
    const sourceColumns = ['first', 'second', 'third']
    const targetColumns = ['second', 'third']

    const sql = generateColumnMappedCopyDataSql(
      't',
      '_t_rebuild_temp',
      sourceColumns,
      targetColumns
    )

    expect(sql).toBe(
      'INSERT INTO _t_rebuild_temp (second, third) SELECT second, third FROM t'
    )
  })

  it('handles dropping last column', () => {
    const sourceColumns = ['first', 'second', 'third']
    const targetColumns = ['first', 'second']

    const sql = generateColumnMappedCopyDataSql(
      't',
      '_t_rebuild_temp',
      sourceColumns,
      targetColumns
    )

    expect(sql).toBe(
      'INSERT INTO _t_rebuild_temp (first, second) SELECT first, second FROM t'
    )
  })

  it('handles dropping multiple columns', () => {
    const sourceColumns = ['a', 'b', 'c', 'd', 'e']
    const targetColumns = ['a', 'd'] // b, c, e dropped

    const sql = generateColumnMappedCopyDataSql(
      't',
      '_t_rebuild_temp',
      sourceColumns,
      targetColumns
    )

    expect(sql).toBe(
      'INSERT INTO _t_rebuild_temp (a, d) SELECT a, d FROM t'
    )
  })
})

describe('complex drop column scenarios', () => {
  it('drop column then rename another preserves all clauses', () => {
    const sql = `CREATE TABLE complex (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL DEFAULT 'unknown',
      score REAL CHECK (score >= 0),
      computed INTEGER GENERATED ALWAYS AS (score * 10) STORED,
      extra TEXT,
      CONSTRAINT chk_name CHECK (length(name) > 0)
    ) STRICT`
    const ast = parseCreateTable(sql)

    const patched = dropColumn(ast, 'extra')
    const serialized = serializeCreateTable(patched)

    // All original features preserved
    expect(serialized.toUpperCase()).toContain('AUTOINCREMENT')
    expect(serialized.toUpperCase()).toContain('NOT NULL')
    expect(serialized.toUpperCase()).toContain('CHECK')
    expect(serialized.toUpperCase()).toContain('GENERATED ALWAYS AS')
    expect(serialized.toUpperCase()).toContain('STORED')
    expect(serialized.toUpperCase()).toContain('STRICT')
    expect(serialized.toUpperCase()).toContain('CONSTRAINT')

    // Column removed
    expect(patched.columns.some((c) => c.name === 'extra')).toBe(false)
    expect(patched.columns).toHaveLength(4)
  })
})
