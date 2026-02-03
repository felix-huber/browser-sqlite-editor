import { describe, it, expect } from 'vitest'
import { parseCreateTable, serializeCreateTable } from './ddl-parser'
import { addColumn, renameColumn } from './ast-patch'
import type { ColumnNode } from './ddl-parser'

describe('AST Patch: addColumn', () => {
  describe('basic add column', () => {
    it('adds column to simple table', () => {
      const sql = 'CREATE TABLE users (id INTEGER, name TEXT)'
      const ast = parseCreateTable(sql)
      const newColumn: ColumnNode = { name: 'email', type: 'TEXT' }

      const patched = addColumn(ast, newColumn)

      expect(patched.columns).toHaveLength(3)
      expect(patched.columns[2].name).toBe('email')
      expect(patched.columns[2].type).toBe('TEXT')
    })

    it('adds column at specific position', () => {
      const sql = 'CREATE TABLE users (id INTEGER, name TEXT)'
      const ast = parseCreateTable(sql)
      const newColumn: ColumnNode = { name: 'email', type: 'TEXT' }

      const patched = addColumn(ast, newColumn, { afterColumn: 'id' })

      expect(patched.columns).toHaveLength(3)
      expect(patched.columns[1].name).toBe('email')
    })

    it('adds column with NOT NULL constraint', () => {
      const sql = 'CREATE TABLE users (id INTEGER)'
      const ast = parseCreateTable(sql)
      const newColumn: ColumnNode = { name: 'created', type: 'TEXT', notNull: true }

      const patched = addColumn(ast, newColumn)
      const serialized = serializeCreateTable(patched)

      expect(serialized.toUpperCase()).toContain('NOT NULL')
    })

    it('adds column with DEFAULT value', () => {
      const sql = 'CREATE TABLE users (id INTEGER)'
      const ast = parseCreateTable(sql)
      const newColumn: ColumnNode = {
        name: 'status',
        type: 'TEXT',
        defaultValue: "'active'",
      }

      const patched = addColumn(ast, newColumn)
      const serialized = serializeCreateTable(patched)

      expect(serialized).toContain("DEFAULT 'active'")
    })
  })

  describe('preserves existing clauses after addColumn', () => {
    it('addColumn preserves CHECK constraint', () => {
      const sql = 'CREATE TABLE t (x INTEGER CHECK (x > 0))'
      const ast = parseCreateTable(sql)
      const newColumn: ColumnNode = { name: 'y', type: 'INTEGER' }

      const patched = addColumn(ast, newColumn)
      const serialized = serializeCreateTable(patched)

      expect(serialized.toUpperCase()).toContain('CHECK')
      expect(serialized).toContain('x > 0')
    })

    it('addColumn preserves table-level CHECK constraint', () => {
      const sql = 'CREATE TABLE t (a INTEGER, b INTEGER, CHECK (a < b))'
      const ast = parseCreateTable(sql)
      const newColumn: ColumnNode = { name: 'c', type: 'INTEGER' }

      const patched = addColumn(ast, newColumn)
      const serialized = serializeCreateTable(patched)

      expect(serialized.toUpperCase()).toContain('CHECK')
      expect(serialized).toContain('a < b')
    })

    it('addColumn preserves GENERATED column', () => {
      const sql =
        'CREATE TABLE t (a INTEGER, b INTEGER GENERATED ALWAYS AS (a * 2) STORED)'
      const ast = parseCreateTable(sql)
      const newColumn: ColumnNode = { name: 'c', type: 'TEXT' }

      const patched = addColumn(ast, newColumn)
      const serialized = serializeCreateTable(patched)

      expect(serialized.toUpperCase()).toContain('GENERATED ALWAYS AS')
      expect(serialized.toUpperCase()).toContain('STORED')
      expect(serialized).toContain('a * 2')
    })

    it('addColumn preserves WITHOUT ROWID', () => {
      const sql = 'CREATE TABLE t (k TEXT PRIMARY KEY, v BLOB) WITHOUT ROWID'
      const ast = parseCreateTable(sql)
      const newColumn: ColumnNode = { name: 'extra', type: 'TEXT' }

      const patched = addColumn(ast, newColumn)
      const serialized = serializeCreateTable(patched)

      expect(serialized.toUpperCase()).toContain('WITHOUT ROWID')
    })

    it('addColumn preserves STRICT', () => {
      const sql = 'CREATE TABLE t (id INTEGER PRIMARY KEY, data TEXT) STRICT'
      const ast = parseCreateTable(sql)
      const newColumn: ColumnNode = { name: 'extra', type: 'TEXT' }

      const patched = addColumn(ast, newColumn)
      const serialized = serializeCreateTable(patched)

      expect(serialized.toUpperCase()).toContain('STRICT')
    })

    it('addColumn preserves STRICT and WITHOUT ROWID combined', () => {
      const sql =
        'CREATE TABLE t (k TEXT PRIMARY KEY, v BLOB) STRICT, WITHOUT ROWID'
      const ast = parseCreateTable(sql)
      const newColumn: ColumnNode = { name: 'extra', type: 'TEXT' }

      const patched = addColumn(ast, newColumn)
      const serialized = serializeCreateTable(patched)

      expect(serialized.toUpperCase()).toContain('STRICT')
      expect(serialized.toUpperCase()).toContain('WITHOUT ROWID')
    })

    it('addColumn preserves AUTOINCREMENT', () => {
      const sql = 'CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)'
      const ast = parseCreateTable(sql)
      const newColumn: ColumnNode = { name: 'extra', type: 'TEXT' }

      const patched = addColumn(ast, newColumn)
      const serialized = serializeCreateTable(patched)

      expect(serialized.toUpperCase()).toContain('AUTOINCREMENT')
    })

    it('addColumn preserves FOREIGN KEY constraint', () => {
      const sql =
        'CREATE TABLE t (user_id INTEGER, FOREIGN KEY (user_id) REFERENCES users(id))'
      const ast = parseCreateTable(sql)
      const newColumn: ColumnNode = { name: 'extra', type: 'TEXT' }

      const patched = addColumn(ast, newColumn)
      const serialized = serializeCreateTable(patched)

      expect(serialized.toUpperCase()).toContain('FOREIGN KEY')
      expect(serialized.toUpperCase()).toContain('REFERENCES')
    })

    it('addColumn preserves column-level REFERENCES', () => {
      const sql = 'CREATE TABLE t (user_id INTEGER REFERENCES users(id))'
      const ast = parseCreateTable(sql)
      const newColumn: ColumnNode = { name: 'extra', type: 'TEXT' }

      const patched = addColumn(ast, newColumn)
      const serialized = serializeCreateTable(patched)

      expect(serialized.toUpperCase()).toContain('REFERENCES')
    })

    it('addColumn preserves COLLATE', () => {
      const sql = 'CREATE TABLE t (name TEXT COLLATE NOCASE)'
      const ast = parseCreateTable(sql)
      const newColumn: ColumnNode = { name: 'extra', type: 'TEXT' }

      const patched = addColumn(ast, newColumn)
      const serialized = serializeCreateTable(patched)

      expect(serialized.toUpperCase()).toContain('COLLATE NOCASE')
    })

    it('addColumn preserves ON CONFLICT', () => {
      const sql = 'CREATE TABLE t (id INTEGER PRIMARY KEY ON CONFLICT REPLACE)'
      const ast = parseCreateTable(sql)
      const newColumn: ColumnNode = { name: 'extra', type: 'TEXT' }

      const patched = addColumn(ast, newColumn)
      const serialized = serializeCreateTable(patched)

      expect(serialized.toUpperCase()).toContain('ON CONFLICT REPLACE')
    })

    it('addColumn preserves table-level PRIMARY KEY', () => {
      const sql = 'CREATE TABLE t (a INTEGER, b INTEGER, PRIMARY KEY (a, b))'
      const ast = parseCreateTable(sql)
      const newColumn: ColumnNode = { name: 'c', type: 'TEXT' }

      const patched = addColumn(ast, newColumn)
      const serialized = serializeCreateTable(patched)

      expect(serialized.toUpperCase()).toContain('PRIMARY KEY (')
    })

    it('addColumn preserves UNIQUE table constraint', () => {
      const sql = 'CREATE TABLE t (a INTEGER, b INTEGER, UNIQUE (a, b))'
      const ast = parseCreateTable(sql)
      const newColumn: ColumnNode = { name: 'c', type: 'TEXT' }

      const patched = addColumn(ast, newColumn)
      const serialized = serializeCreateTable(patched)

      expect(serialized.toUpperCase()).toContain('UNIQUE (')
    })

    it('addColumn preserves named constraint', () => {
      const sql = 'CREATE TABLE t (x INTEGER, CONSTRAINT chk_x CHECK (x > 0))'
      const ast = parseCreateTable(sql)
      const newColumn: ColumnNode = { name: 'y', type: 'INTEGER' }

      const patched = addColumn(ast, newColumn)
      const serialized = serializeCreateTable(patched)

      expect(serialized.toUpperCase()).toContain('CONSTRAINT')
      expect(serialized).toContain('chk_x')
    })
  })

  describe('immutability', () => {
    it('addColumn does not mutate original AST', () => {
      const sql = 'CREATE TABLE users (id INTEGER)'
      const ast = parseCreateTable(sql)
      const originalLength = ast.columns.length
      const newColumn: ColumnNode = { name: 'email', type: 'TEXT' }

      addColumn(ast, newColumn)

      expect(ast.columns.length).toBe(originalLength)
    })
  })
})

describe('AST Patch: renameColumn', () => {
  describe('basic rename', () => {
    it('renames a column', () => {
      const sql = 'CREATE TABLE users (id INTEGER, name TEXT)'
      const ast = parseCreateTable(sql)

      const patched = renameColumn(ast, 'name', 'full_name')

      expect(patched.columns[1].name).toBe('full_name')
    })

    it('preserves column type', () => {
      const sql = 'CREATE TABLE users (id INTEGER, name TEXT)'
      const ast = parseCreateTable(sql)

      const patched = renameColumn(ast, 'name', 'full_name')

      expect(patched.columns[1].type).toBe('TEXT')
    })

    it('preserves column constraints', () => {
      const sql = 'CREATE TABLE users (id INTEGER, name TEXT NOT NULL UNIQUE)'
      const ast = parseCreateTable(sql)

      const patched = renameColumn(ast, 'name', 'full_name')

      expect(patched.columns[1].notNull).toBe(true)
      expect(patched.columns[1].unique).toBe(true)
    })

    it('throws when column not found', () => {
      const sql = 'CREATE TABLE users (id INTEGER, name TEXT)'
      const ast = parseCreateTable(sql)

      expect(() => renameColumn(ast, 'nonexistent', 'new_name')).toThrow()
    })
  })

  describe('preserves existing clauses after renameColumn', () => {
    it('renameColumn preserves CHECK constraint', () => {
      const sql = 'CREATE TABLE t (x INTEGER CHECK (x > 0), y TEXT)'
      const ast = parseCreateTable(sql)

      const patched = renameColumn(ast, 'y', 'z')
      const serialized = serializeCreateTable(patched)

      expect(serialized.toUpperCase()).toContain('CHECK')
      expect(serialized).toContain('x > 0')
    })

    it('renameColumn preserves CHECK constraint on renamed column', () => {
      const sql = 'CREATE TABLE t (x INTEGER CHECK (x > 0))'
      const ast = parseCreateTable(sql)

      const patched = renameColumn(ast, 'x', 'y')
      const serialized = serializeCreateTable(patched)

      expect(serialized.toUpperCase()).toContain('CHECK')
      // Note: the check expression still references 'x' - SQLite would need
      // a separate ALTER to update CHECK expressions
      expect(serialized).toContain('x > 0')
    })

    it('renameColumn preserves table-level CHECK constraint', () => {
      const sql = 'CREATE TABLE t (a INTEGER, b INTEGER, CHECK (a < b))'
      const ast = parseCreateTable(sql)

      const patched = renameColumn(ast, 'a', 'alpha')
      const serialized = serializeCreateTable(patched)

      expect(serialized.toUpperCase()).toContain('CHECK')
      expect(serialized).toContain('a < b')
    })

    it('renameColumn preserves GENERATED column', () => {
      const sql =
        'CREATE TABLE t (a INTEGER, b INTEGER GENERATED ALWAYS AS (a * 2) STORED)'
      const ast = parseCreateTable(sql)

      const patched = renameColumn(ast, 'a', 'x')
      const serialized = serializeCreateTable(patched)

      expect(serialized.toUpperCase()).toContain('GENERATED ALWAYS AS')
      expect(serialized.toUpperCase()).toContain('STORED')
      expect(serialized).toContain('a * 2')
    })

    it('renameColumn preserves WITHOUT ROWID', () => {
      const sql = 'CREATE TABLE t (k TEXT PRIMARY KEY, v BLOB) WITHOUT ROWID'
      const ast = parseCreateTable(sql)

      const patched = renameColumn(ast, 'v', 'value')
      const serialized = serializeCreateTable(patched)

      expect(serialized.toUpperCase()).toContain('WITHOUT ROWID')
    })

    it('renameColumn preserves STRICT', () => {
      const sql = 'CREATE TABLE t (id INTEGER PRIMARY KEY, data TEXT) STRICT'
      const ast = parseCreateTable(sql)

      const patched = renameColumn(ast, 'data', 'payload')
      const serialized = serializeCreateTable(patched)

      expect(serialized.toUpperCase()).toContain('STRICT')
    })

    it('renameColumn preserves STRICT and WITHOUT ROWID combined', () => {
      const sql =
        'CREATE TABLE t (k TEXT PRIMARY KEY, v BLOB) STRICT, WITHOUT ROWID'
      const ast = parseCreateTable(sql)

      const patched = renameColumn(ast, 'v', 'value')
      const serialized = serializeCreateTable(patched)

      expect(serialized.toUpperCase()).toContain('STRICT')
      expect(serialized.toUpperCase()).toContain('WITHOUT ROWID')
    })

    it('renameColumn preserves AUTOINCREMENT', () => {
      const sql =
        'CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)'
      const ast = parseCreateTable(sql)

      const patched = renameColumn(ast, 'name', 'title')
      const serialized = serializeCreateTable(patched)

      expect(serialized.toUpperCase()).toContain('AUTOINCREMENT')
    })

    it('renameColumn preserves FOREIGN KEY constraint', () => {
      const sql =
        'CREATE TABLE t (user_id INTEGER, extra TEXT, FOREIGN KEY (user_id) REFERENCES users(id))'
      const ast = parseCreateTable(sql)

      const patched = renameColumn(ast, 'extra', 'notes')
      const serialized = serializeCreateTable(patched)

      expect(serialized.toUpperCase()).toContain('FOREIGN KEY')
      expect(serialized.toUpperCase()).toContain('REFERENCES')
    })

    it('renameColumn preserves column-level REFERENCES', () => {
      const sql =
        'CREATE TABLE t (user_id INTEGER REFERENCES users(id), extra TEXT)'
      const ast = parseCreateTable(sql)

      const patched = renameColumn(ast, 'extra', 'notes')
      const serialized = serializeCreateTable(patched)

      expect(serialized.toUpperCase()).toContain('REFERENCES')
    })

    it('renameColumn preserves COLLATE', () => {
      const sql = 'CREATE TABLE t (name TEXT COLLATE NOCASE, extra TEXT)'
      const ast = parseCreateTable(sql)

      const patched = renameColumn(ast, 'extra', 'notes')
      const serialized = serializeCreateTable(patched)

      expect(serialized.toUpperCase()).toContain('COLLATE NOCASE')
    })

    it('renameColumn preserves ON CONFLICT', () => {
      const sql =
        'CREATE TABLE t (id INTEGER PRIMARY KEY ON CONFLICT REPLACE, extra TEXT)'
      const ast = parseCreateTable(sql)

      const patched = renameColumn(ast, 'extra', 'notes')
      const serialized = serializeCreateTable(patched)

      expect(serialized.toUpperCase()).toContain('ON CONFLICT REPLACE')
    })

    it('renameColumn preserves table-level PRIMARY KEY', () => {
      const sql = 'CREATE TABLE t (a INTEGER, b INTEGER, c TEXT, PRIMARY KEY (a, b))'
      const ast = parseCreateTable(sql)

      const patched = renameColumn(ast, 'c', 'd')
      const serialized = serializeCreateTable(patched)

      expect(serialized.toUpperCase()).toContain('PRIMARY KEY (')
    })

    it('renameColumn preserves UNIQUE table constraint', () => {
      const sql = 'CREATE TABLE t (a INTEGER, b INTEGER, c TEXT, UNIQUE (a, b))'
      const ast = parseCreateTable(sql)

      const patched = renameColumn(ast, 'c', 'd')
      const serialized = serializeCreateTable(patched)

      expect(serialized.toUpperCase()).toContain('UNIQUE (')
    })

    it('renameColumn preserves named constraint', () => {
      const sql =
        'CREATE TABLE t (x INTEGER, y TEXT, CONSTRAINT chk_x CHECK (x > 0))'
      const ast = parseCreateTable(sql)

      const patched = renameColumn(ast, 'y', 'z')
      const serialized = serializeCreateTable(patched)

      expect(serialized.toUpperCase()).toContain('CONSTRAINT')
      expect(serialized).toContain('chk_x')
    })
  })

  describe('immutability', () => {
    it('renameColumn does not mutate original AST', () => {
      const sql = 'CREATE TABLE users (id INTEGER, name TEXT)'
      const ast = parseCreateTable(sql)
      const originalName = ast.columns[1].name

      renameColumn(ast, 'name', 'full_name')

      expect(ast.columns[1].name).toBe(originalName)
    })
  })
})

describe('complex scenarios', () => {
  it('add column then rename another preserves all clauses', () => {
    const sql = `CREATE TABLE complex (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL DEFAULT 'unknown',
      score REAL CHECK (score >= 0),
      computed INTEGER GENERATED ALWAYS AS (score * 10) STORED,
      CONSTRAINT chk_name CHECK (length(name) > 0)
    ) STRICT`
    const ast = parseCreateTable(sql)

    let patched = addColumn(ast, { name: 'email', type: 'TEXT', notNull: true })
    patched = renameColumn(patched, 'name', 'full_name')
    const serialized = serializeCreateTable(patched)

    // All original features preserved
    expect(serialized.toUpperCase()).toContain('AUTOINCREMENT')
    expect(serialized.toUpperCase()).toContain('NOT NULL')
    expect(serialized.toUpperCase()).toContain('CHECK')
    expect(serialized.toUpperCase()).toContain('GENERATED ALWAYS AS')
    expect(serialized.toUpperCase()).toContain('STORED')
    expect(serialized.toUpperCase()).toContain('STRICT')
    expect(serialized.toUpperCase()).toContain('CONSTRAINT')

    // New column added
    expect(patched.columns.some((c) => c.name === 'email')).toBe(true)

    // Column renamed
    expect(patched.columns.some((c) => c.name === 'full_name')).toBe(true)
    expect(patched.columns.some((c) => c.name === 'name')).toBe(false)
  })
})
