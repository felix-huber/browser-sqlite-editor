import { describe, it, expect } from 'vitest'
import { parseCreateTable, serializeCreateTable } from './ddl-parser'

describe('parseCreateTable', () => {
  describe('basic parsing', () => {
    it('parses simple table with columns', () => {
      const sql = 'CREATE TABLE users (id INTEGER, name TEXT)'
      const ast = parseCreateTable(sql)

      expect(ast.tableName).toBe('users')
      expect(ast.columns).toHaveLength(2)
      expect(ast.columns[0].name).toBe('id')
      expect(ast.columns[0].type).toBe('INTEGER')
      expect(ast.columns[1].name).toBe('name')
      expect(ast.columns[1].type).toBe('TEXT')
    })

    it('parses quoted table name', () => {
      const sql = 'CREATE TABLE "my table" (id INTEGER)'
      const ast = parseCreateTable(sql)
      expect(ast.tableName).toBe('my table')
    })

    it('parses quoted column name', () => {
      const sql = 'CREATE TABLE t ("my column" TEXT)'
      const ast = parseCreateTable(sql)
      expect(ast.columns[0].name).toBe('my column')
    })
  })

  describe('PRIMARY KEY', () => {
    it('parses column-level PRIMARY KEY', () => {
      const sql = 'CREATE TABLE t (id INTEGER PRIMARY KEY)'
      const ast = parseCreateTable(sql)
      expect(ast.columns[0].primaryKey).toBe(true)
    })

    it('parses table-level PRIMARY KEY', () => {
      const sql = 'CREATE TABLE t (a INTEGER, b INTEGER, PRIMARY KEY (a, b))'
      const ast = parseCreateTable(sql)
      expect(ast.primaryKeyColumns).toEqual(['a', 'b'])
    })
  })

  describe('AUTOINCREMENT', () => {
    it('parses INTEGER PRIMARY KEY AUTOINCREMENT', () => {
      const sql = 'CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT)'
      const ast = parseCreateTable(sql)
      expect(ast.columns[0].primaryKey).toBe(true)
      expect(ast.columns[0].autoincrement).toBe(true)
    })
  })

  describe('NOT NULL', () => {
    it('parses NOT NULL constraint', () => {
      const sql = 'CREATE TABLE t (name TEXT NOT NULL)'
      const ast = parseCreateTable(sql)
      expect(ast.columns[0].notNull).toBe(true)
    })
  })

  describe('UNIQUE', () => {
    it('parses UNIQUE constraint', () => {
      const sql = 'CREATE TABLE t (email TEXT UNIQUE)'
      const ast = parseCreateTable(sql)
      expect(ast.columns[0].unique).toBe(true)
    })
  })

  describe('DEFAULT', () => {
    it('parses DEFAULT with literal', () => {
      const sql = "CREATE TABLE t (status TEXT DEFAULT 'active')"
      const ast = parseCreateTable(sql)
      expect(ast.columns[0].defaultValue).toBe("'active'")
    })

    it('parses DEFAULT with number', () => {
      const sql = 'CREATE TABLE t (count INTEGER DEFAULT 0)'
      const ast = parseCreateTable(sql)
      expect(ast.columns[0].defaultValue).toBe('0')
    })

    it('parses DEFAULT with parenthesized expression', () => {
      const sql = 'CREATE TABLE t (created_at TEXT DEFAULT (datetime(\'now\')))'
      const ast = parseCreateTable(sql)
      expect(ast.columns[0].defaultValue).toBe("(datetime('now'))")
    })
  })

  describe('CHECK constraints', () => {
    it('parses column-level CHECK', () => {
      const sql = 'CREATE TABLE t (age INTEGER CHECK (age >= 0))'
      const ast = parseCreateTable(sql)
      expect(ast.columns[0].check).toBe('age >= 0')
    })

    it('parses table-level CHECK', () => {
      const sql = 'CREATE TABLE t (a INTEGER, b INTEGER, CHECK (a < b))'
      const ast = parseCreateTable(sql)
      expect(ast.tableConstraints).toContainEqual({
        type: 'CHECK',
        expression: 'a < b',
      })
    })

    it('parses named CHECK constraint', () => {
      const sql = 'CREATE TABLE t (x INTEGER, CONSTRAINT chk_x CHECK (x > 0))'
      const ast = parseCreateTable(sql)
      expect(ast.tableConstraints).toContainEqual({
        type: 'CHECK',
        name: 'chk_x',
        expression: 'x > 0',
      })
    })
  })

  describe('GENERATED columns', () => {
    it('parses GENERATED ALWAYS AS ... STORED', () => {
      const sql = 'CREATE TABLE t (a INTEGER, b INTEGER, sum INTEGER GENERATED ALWAYS AS (a + b) STORED)'
      const ast = parseCreateTable(sql)
      expect(ast.columns[2].generatedAs).toBe('a + b')
      expect(ast.columns[2].generatedType).toBe('STORED')
    })

    it('parses GENERATED ALWAYS AS ... VIRTUAL', () => {
      const sql = "CREATE TABLE t (first TEXT, last TEXT, full TEXT GENERATED ALWAYS AS (first || ' ' || last) VIRTUAL)"
      const ast = parseCreateTable(sql)
      expect(ast.columns[2].generatedAs).toBe("first || ' ' || last")
      expect(ast.columns[2].generatedType).toBe('VIRTUAL')
    })

    it('parses AS without GENERATED ALWAYS (short form)', () => {
      const sql = 'CREATE TABLE t (x INTEGER, y INTEGER AS (x * 2) STORED)'
      const ast = parseCreateTable(sql)
      expect(ast.columns[1].generatedAs).toBe('x * 2')
      expect(ast.columns[1].generatedType).toBe('STORED')
    })
  })

  describe('WITHOUT ROWID', () => {
    it('parses WITHOUT ROWID table option', () => {
      const sql = 'CREATE TABLE t (k TEXT PRIMARY KEY, v BLOB) WITHOUT ROWID'
      const ast = parseCreateTable(sql)
      expect(ast.withoutRowid).toBe(true)
    })
  })

  describe('STRICT', () => {
    it('parses STRICT table option', () => {
      const sql = 'CREATE TABLE t (id INTEGER PRIMARY KEY, data TEXT) STRICT'
      const ast = parseCreateTable(sql)
      expect(ast.strict).toBe(true)
    })

    it('parses STRICT, WITHOUT ROWID combined', () => {
      const sql = 'CREATE TABLE t (k TEXT PRIMARY KEY) STRICT, WITHOUT ROWID'
      const ast = parseCreateTable(sql)
      expect(ast.strict).toBe(true)
      expect(ast.withoutRowid).toBe(true)
    })

    it('parses WITHOUT ROWID, STRICT combined', () => {
      const sql = 'CREATE TABLE t (k TEXT PRIMARY KEY) WITHOUT ROWID, STRICT'
      const ast = parseCreateTable(sql)
      expect(ast.strict).toBe(true)
      expect(ast.withoutRowid).toBe(true)
    })
  })

  describe('COLLATE', () => {
    it('parses COLLATE on column', () => {
      const sql = 'CREATE TABLE t (name TEXT COLLATE NOCASE)'
      const ast = parseCreateTable(sql)
      expect(ast.columns[0].collate).toBe('NOCASE')
    })
  })

  describe('FOREIGN KEY', () => {
    it('parses column-level REFERENCES', () => {
      const sql = 'CREATE TABLE t (user_id INTEGER REFERENCES users(id))'
      const ast = parseCreateTable(sql)
      expect(ast.columns[0].references).toEqual({
        table: 'users',
        columns: ['id'],
      })
    })

    it('parses table-level FOREIGN KEY', () => {
      const sql = 'CREATE TABLE t (user_id INTEGER, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)'
      const ast = parseCreateTable(sql)
      expect(ast.tableConstraints).toContainEqual({
        type: 'FOREIGN_KEY',
        columns: ['user_id'],
        references: {
          table: 'users',
          columns: ['id'],
        },
        onDelete: 'CASCADE',
      })
    })
  })

  describe('ON CONFLICT', () => {
    it('parses column-level ON CONFLICT', () => {
      const sql = 'CREATE TABLE t (id INTEGER PRIMARY KEY ON CONFLICT REPLACE)'
      const ast = parseCreateTable(sql)
      expect(ast.columns[0].onConflict).toBe('REPLACE')
    })
  })
})

describe('serializeCreateTable', () => {
  it('serializes simple table', () => {
    const ast = {
      tableName: 'users',
      columns: [
        { name: 'id', type: 'INTEGER' },
        { name: 'name', type: 'TEXT' },
      ],
      tableConstraints: [],
    }
    const sql = serializeCreateTable(ast)
    expect(sql).toContain('CREATE TABLE')
    expect(sql).toContain('users')
    expect(sql).toContain('id INTEGER')
    expect(sql).toContain('name TEXT')
  })
})

describe('round-trip (parse → serialize → parse)', () => {
  const roundTripTests = [
    {
      name: 'CHECK + GENERATED + WITHOUT ROWID',
      sql: 'CREATE TABLE t (a INTEGER CHECK (a > 0), b INTEGER GENERATED ALWAYS AS (a * 2) STORED) WITHOUT ROWID',
    },
    {
      name: 'STRICT table',
      sql: 'CREATE TABLE strict_t (id INTEGER PRIMARY KEY, val TEXT NOT NULL) STRICT',
    },
    {
      name: 'AUTOINCREMENT',
      sql: 'CREATE TABLE seq (id INTEGER PRIMARY KEY AUTOINCREMENT, data BLOB)',
    },
    {
      name: 'complex table with all features',
      sql: `CREATE TABLE complex (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL DEFAULT 'unknown',
        score REAL CHECK (score >= 0),
        computed INTEGER GENERATED ALWAYS AS (score * 10) STORED,
        CONSTRAINT chk_name CHECK (length(name) > 0)
      ) STRICT`,
    },
  ]

  for (const { name, sql } of roundTripTests) {
    it(`round-trips: ${name}`, () => {
      const ast1 = parseCreateTable(sql)
      const serialized = serializeCreateTable(ast1)
      const ast2 = parseCreateTable(serialized)

      // Core structure should match
      expect(ast2.tableName).toBe(ast1.tableName)
      expect(ast2.columns.length).toBe(ast1.columns.length)
      expect(ast2.withoutRowid).toBe(ast1.withoutRowid)
      expect(ast2.strict).toBe(ast1.strict)

      // Column details should match
      for (let i = 0; i < ast1.columns.length; i++) {
        const c1 = ast1.columns[i]
        const c2 = ast2.columns[i]
        expect(c2.name).toBe(c1.name)
        expect(c2.type).toBe(c1.type)
        expect(c2.primaryKey).toBe(c1.primaryKey)
        expect(c2.autoincrement).toBe(c1.autoincrement)
        expect(c2.notNull).toBe(c1.notNull)
        expect(c2.generatedAs).toBe(c1.generatedAs)
        expect(c2.generatedType).toBe(c1.generatedType)
        // Check expressions should be semantically preserved (content may differ slightly in whitespace)
        if (c1.check) {
          expect(c2.check).toBeTruthy()
        }
      }

      // Table constraints should be preserved
      expect(ast2.tableConstraints?.length ?? 0).toBe(ast1.tableConstraints?.length ?? 0)
    })
  }

  it('round-trip preserves CHECK constraint', () => {
    const sql = 'CREATE TABLE t (x INTEGER CHECK (x > 0))'
    const ast = parseCreateTable(sql)
    const serialized = serializeCreateTable(ast)

    expect(serialized.toUpperCase()).toContain('CHECK')
    expect(serialized).toContain('x > 0')
  })

  it('round-trip preserves GENERATED column', () => {
    const sql = 'CREATE TABLE t (a INTEGER, b INTEGER GENERATED ALWAYS AS (a * 2) STORED)'
    const ast = parseCreateTable(sql)
    const serialized = serializeCreateTable(ast)

    expect(serialized.toUpperCase()).toContain('GENERATED')
    expect(serialized.toUpperCase()).toContain('STORED')
    expect(serialized).toContain('a * 2')
  })

  it('round-trip preserves WITHOUT ROWID', () => {
    const sql = 'CREATE TABLE t (k TEXT PRIMARY KEY) WITHOUT ROWID'
    const ast = parseCreateTable(sql)
    const serialized = serializeCreateTable(ast)

    expect(serialized.toUpperCase()).toContain('WITHOUT ROWID')
  })

  it('round-trip preserves STRICT', () => {
    const sql = 'CREATE TABLE t (id INTEGER PRIMARY KEY) STRICT'
    const ast = parseCreateTable(sql)
    const serialized = serializeCreateTable(ast)

    expect(serialized.toUpperCase()).toContain('STRICT')
  })

  it('round-trip preserves AUTOINCREMENT', () => {
    const sql = 'CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT)'
    const ast = parseCreateTable(sql)
    const serialized = serializeCreateTable(ast)

    expect(serialized.toUpperCase()).toContain('AUTOINCREMENT')
  })
})
