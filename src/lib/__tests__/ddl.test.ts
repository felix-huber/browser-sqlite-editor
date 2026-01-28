import { describe, it, expect } from 'vitest'
import {
  needsQuoting,
  quoteIdentifier,
  forceQuoteIdentifier,
  generateColumnDef,
  generateForeignKeyConstraint,
  generateCheckConstraint,
  createTable,
  alterTableAddColumn,
  alterTableRename,
  alterTableRenameColumn,
  alterTableDropColumn,
  columnInfoToDefinition,
  foreignKeyInfoToConstraint,
  groupForeignKeyInfos,
  type ColumnDefinition,
  type TableDefinition,
  type ForeignKeyConstraint,
} from '../ddl'
import type { ColumnInfo, ForeignKeyInfo } from '../../types/index'

describe('needsQuoting', () => {
  it('returns true for reserved keywords', () => {
    expect(needsQuoting('ORDER')).toBe(true)
    expect(needsQuoting('order')).toBe(true)
    expect(needsQuoting('TABLE')).toBe(true)
    expect(needsQuoting('SELECT')).toBe(true)
    expect(needsQuoting('FROM')).toBe(true)
    expect(needsQuoting('WHERE')).toBe(true)
  })

  it('returns true for identifiers starting with digit', () => {
    expect(needsQuoting('1column')).toBe(true)
    expect(needsQuoting('123')).toBe(true)
    expect(needsQuoting('0test')).toBe(true)
  })

  it('returns true for identifiers with spaces', () => {
    expect(needsQuoting('my column')).toBe(true)
    expect(needsQuoting('first name')).toBe(true)
  })

  it('returns true for identifiers with special characters', () => {
    expect(needsQuoting('col-name')).toBe(true)
    expect(needsQuoting('col.name')).toBe(true)
    expect(needsQuoting('col@name')).toBe(true)
    expect(needsQuoting('col#name')).toBe(true)
  })

  it('returns true for empty string', () => {
    expect(needsQuoting('')).toBe(true)
  })

  it('returns false for simple identifiers', () => {
    expect(needsQuoting('id')).toBe(false)
    expect(needsQuoting('name')).toBe(false)
    expect(needsQuoting('user_id')).toBe(false)
    expect(needsQuoting('_private')).toBe(false)
    expect(needsQuoting('Column1')).toBe(false)
  })
})

describe('quoteIdentifier', () => {
  it('quotes reserved keywords', () => {
    expect(quoteIdentifier('order')).toBe('"order"')
    expect(quoteIdentifier('ORDER')).toBe('"ORDER"')
    expect(quoteIdentifier('table')).toBe('"table"')
  })

  it('does not quote simple identifiers', () => {
    expect(quoteIdentifier('id')).toBe('id')
    expect(quoteIdentifier('user_name')).toBe('user_name')
    expect(quoteIdentifier('Column1')).toBe('Column1')
  })

  it('escapes embedded double quotes', () => {
    expect(quoteIdentifier('col"name')).toBe('"col""name"')
    expect(quoteIdentifier('a"b"c')).toBe('"a""b""c"')
  })

  it('quotes identifiers with spaces', () => {
    expect(quoteIdentifier('first name')).toBe('"first name"')
  })
})

describe('forceQuoteIdentifier', () => {
  it('always quotes', () => {
    expect(forceQuoteIdentifier('id')).toBe('"id"')
    expect(forceQuoteIdentifier('simple')).toBe('"simple"')
  })

  it('escapes embedded double quotes', () => {
    expect(forceQuoteIdentifier('a"b')).toBe('"a""b"')
  })
})

describe('generateColumnDef', () => {
  it('generates simple column', () => {
    const col: ColumnDefinition = { name: 'id', type: 'INTEGER' }
    expect(generateColumnDef(col)).toBe('id INTEGER')
  })

  it('generates column with NOT NULL', () => {
    const col: ColumnDefinition = { name: 'name', type: 'TEXT', notNull: true }
    expect(generateColumnDef(col)).toBe('name TEXT NOT NULL')
  })

  it('generates column with DEFAULT', () => {
    const col: ColumnDefinition = {
      name: 'status',
      type: 'TEXT',
      defaultValue: "'active'",
    }
    expect(generateColumnDef(col)).toBe("status TEXT DEFAULT 'active'")
  })

  it('generates column with PRIMARY KEY', () => {
    const col: ColumnDefinition = {
      name: 'id',
      type: 'INTEGER',
      primaryKey: 1,
    }
    expect(generateColumnDef(col)).toBe('id INTEGER PRIMARY KEY')
  })

  it('generates column with PRIMARY KEY AUTOINCREMENT', () => {
    const col: ColumnDefinition = {
      name: 'id',
      type: 'INTEGER',
      primaryKey: 1,
      autoincrement: true,
    }
    expect(generateColumnDef(col)).toBe('id INTEGER PRIMARY KEY AUTOINCREMENT')
  })

  it('generates column with UNIQUE', () => {
    const col: ColumnDefinition = { name: 'email', type: 'TEXT', unique: true }
    expect(generateColumnDef(col)).toBe('email TEXT UNIQUE')
  })

  it('generates column with NOT NULL and DEFAULT', () => {
    const col: ColumnDefinition = {
      name: 'count',
      type: 'INTEGER',
      notNull: true,
      defaultValue: '0',
    }
    expect(generateColumnDef(col)).toBe('count INTEGER NOT NULL DEFAULT 0')
  })

  it('generates generated column STORED', () => {
    const col: ColumnDefinition = {
      name: 'total',
      type: 'INTEGER',
      generatedAs: 'a + b',
      generatedType: 'stored',
    }
    expect(generateColumnDef(col)).toBe(
      'total INTEGER GENERATED ALWAYS AS (a + b) STORED'
    )
  })

  it('generates generated column VIRTUAL', () => {
    const col: ColumnDefinition = {
      name: 'fullname',
      type: 'TEXT',
      generatedAs: "first || ' ' || last",
      generatedType: 'virtual',
    }
    expect(generateColumnDef(col)).toBe(
      "fullname TEXT GENERATED ALWAYS AS (first || ' ' || last) VIRTUAL"
    )
  })

  it('generates column with COLLATE', () => {
    const col: ColumnDefinition = {
      name: 'name',
      type: 'TEXT',
      collate: 'NOCASE',
    }
    expect(generateColumnDef(col)).toBe('name TEXT COLLATE NOCASE')
  })

  it('generates column with CHECK', () => {
    const col: ColumnDefinition = {
      name: 'age',
      type: 'INTEGER',
      check: 'age >= 0',
    }
    expect(generateColumnDef(col)).toBe('age INTEGER CHECK (age >= 0)')
  })

  it('quotes reserved word column names', () => {
    const col: ColumnDefinition = { name: 'order', type: 'INTEGER' }
    expect(generateColumnDef(col)).toBe('"order" INTEGER')
  })

  it('excludes PRIMARY KEY when includePrimaryKey is false', () => {
    const col: ColumnDefinition = {
      name: 'id',
      type: 'INTEGER',
      primaryKey: 1,
    }
    expect(generateColumnDef(col, false)).toBe('id INTEGER')
  })
})

describe('generateForeignKeyConstraint', () => {
  it('generates simple foreign key', () => {
    const fk: ForeignKeyConstraint = {
      columns: ['user_id'],
      references: 'users',
      refColumns: ['id'],
    }
    expect(generateForeignKeyConstraint(fk)).toBe(
      'FOREIGN KEY (user_id) REFERENCES users (id)'
    )
  })

  it('generates foreign key with ON DELETE CASCADE', () => {
    const fk: ForeignKeyConstraint = {
      columns: ['user_id'],
      references: 'users',
      refColumns: ['id'],
      onDelete: 'CASCADE',
    }
    expect(generateForeignKeyConstraint(fk)).toBe(
      'FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE'
    )
  })

  it('generates foreign key with ON UPDATE SET NULL', () => {
    const fk: ForeignKeyConstraint = {
      columns: ['parent_id'],
      references: 'items',
      refColumns: ['id'],
      onUpdate: 'SET NULL',
    }
    expect(generateForeignKeyConstraint(fk)).toBe(
      'FOREIGN KEY (parent_id) REFERENCES items (id) ON UPDATE SET NULL'
    )
  })

  it('generates foreign key with both ON DELETE and ON UPDATE', () => {
    const fk: ForeignKeyConstraint = {
      columns: ['category_id'],
      references: 'categories',
      refColumns: ['id'],
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    }
    expect(generateForeignKeyConstraint(fk)).toBe(
      'FOREIGN KEY (category_id) REFERENCES categories (id) ON DELETE CASCADE ON UPDATE CASCADE'
    )
  })

  it('generates composite foreign key', () => {
    const fk: ForeignKeyConstraint = {
      columns: ['org_id', 'user_id'],
      references: 'org_users',
      refColumns: ['org_id', 'user_id'],
    }
    expect(generateForeignKeyConstraint(fk)).toBe(
      'FOREIGN KEY (org_id, user_id) REFERENCES org_users (org_id, user_id)'
    )
  })

  it('generates named foreign key constraint', () => {
    const fk: ForeignKeyConstraint = {
      name: 'fk_orders_user',
      columns: ['user_id'],
      references: 'users',
      refColumns: ['id'],
    }
    expect(generateForeignKeyConstraint(fk)).toBe(
      'CONSTRAINT fk_orders_user FOREIGN KEY (user_id) REFERENCES users (id)'
    )
  })

  it('generates deferrable foreign key', () => {
    const fk: ForeignKeyConstraint = {
      columns: ['ref_id'],
      references: 'refs',
      refColumns: ['id'],
      deferrable: 'DEFERRED',
    }
    expect(generateForeignKeyConstraint(fk)).toBe(
      'FOREIGN KEY (ref_id) REFERENCES refs (id) DEFERRABLE INITIALLY DEFERRED'
    )
  })

  it('quotes reserved word table and column names', () => {
    const fk: ForeignKeyConstraint = {
      columns: ['order'],
      references: 'table',
      refColumns: ['select'],
    }
    expect(generateForeignKeyConstraint(fk)).toBe(
      'FOREIGN KEY ("order") REFERENCES "table" ("select")'
    )
  })

  it('omits NO ACTION since it is the default', () => {
    const fk: ForeignKeyConstraint = {
      columns: ['ref_id'],
      references: 'refs',
      refColumns: ['id'],
      onDelete: 'NO ACTION',
      onUpdate: 'NO ACTION',
    }
    expect(generateForeignKeyConstraint(fk)).toBe(
      'FOREIGN KEY (ref_id) REFERENCES refs (id)'
    )
  })
})

describe('generateCheckConstraint', () => {
  it('generates unnamed check constraint', () => {
    expect(generateCheckConstraint({ expression: 'age >= 0' })).toBe(
      'CHECK (age >= 0)'
    )
  })

  it('generates named check constraint', () => {
    expect(
      generateCheckConstraint({ name: 'chk_positive_age', expression: 'age > 0' })
    ).toBe('CONSTRAINT chk_positive_age CHECK (age > 0)')
  })
})

describe('createTable', () => {
  it('generates simple table with id and name', () => {
    const table: TableDefinition = {
      name: 't',
      columns: [
        { name: 'id', type: 'INTEGER', primaryKey: 1 },
        { name: 'name', type: 'TEXT' },
      ],
    }
    expect(createTable(table)).toBe(`CREATE TABLE t (
  id INTEGER PRIMARY KEY,
  name TEXT
)`)
  })

  it('generates table with NOT NULL and DEFAULT', () => {
    const table: TableDefinition = {
      name: 'users',
      columns: [
        { name: 'id', type: 'INTEGER', primaryKey: 1 },
        { name: 'status', type: 'TEXT', notNull: true, defaultValue: "'foo'" },
      ],
    }
    expect(createTable(table)).toBe(`CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'foo'
)`)
  })

  it('generates table with UNIQUE column', () => {
    const table: TableDefinition = {
      name: 'accounts',
      columns: [
        { name: 'id', type: 'INTEGER', primaryKey: 1 },
        { name: 'email', type: 'TEXT', unique: true },
      ],
    }
    expect(createTable(table)).toBe(`CREATE TABLE accounts (
  id INTEGER PRIMARY KEY,
  email TEXT UNIQUE
)`)
  })

  it('generates table with generated column STORED', () => {
    const table: TableDefinition = {
      name: 'calc',
      columns: [
        { name: 'a', type: 'INTEGER' },
        { name: 'b', type: 'INTEGER' },
        {
          name: 'sum',
          type: 'INTEGER',
          generatedAs: 'a + b',
          generatedType: 'stored',
        },
      ],
    }
    expect(createTable(table)).toBe(`CREATE TABLE calc (
  a INTEGER,
  b INTEGER,
  sum INTEGER GENERATED ALWAYS AS (a + b) STORED
)`)
  })

  it('generates table with composite primary key', () => {
    const table: TableDefinition = {
      name: 'junction',
      columns: [
        { name: 'left_id', type: 'INTEGER' },
        { name: 'right_id', type: 'INTEGER' },
      ],
      primaryKey: ['left_id', 'right_id'],
    }
    expect(createTable(table)).toBe(`CREATE TABLE junction (
  left_id INTEGER,
  right_id INTEGER,
  PRIMARY KEY (left_id, right_id)
)`)
  })

  it('generates table with foreign key and ON DELETE CASCADE', () => {
    const table: TableDefinition = {
      name: 'orders',
      columns: [
        { name: 'id', type: 'INTEGER', primaryKey: 1 },
        { name: 'user_id', type: 'INTEGER' },
      ],
      foreignKeys: [
        {
          columns: ['user_id'],
          references: 'users',
          refColumns: ['id'],
          onDelete: 'CASCADE',
        },
      ],
    }
    expect(createTable(table)).toBe(`CREATE TABLE orders (
  id INTEGER PRIMARY KEY,
  user_id INTEGER,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
)`)
  })

  it('generates table with reserved word column name quoted', () => {
    const table: TableDefinition = {
      name: 'items',
      columns: [
        { name: 'id', type: 'INTEGER', primaryKey: 1 },
        { name: 'order', type: 'INTEGER' },
      ],
    }
    expect(createTable(table)).toBe(`CREATE TABLE items (
  id INTEGER PRIMARY KEY,
  "order" INTEGER
)`)
  })

  it('generates table with IF NOT EXISTS', () => {
    const table: TableDefinition = {
      name: 'config',
      columns: [{ name: 'setting', type: 'TEXT' }],
      ifNotExists: true,
    }
    expect(createTable(table)).toBe(`CREATE TABLE IF NOT EXISTS config (
  setting TEXT
)`)
  })

  it('generates table with WITHOUT ROWID', () => {
    const table: TableDefinition = {
      name: 'kv',
      columns: [
        { name: 'k', type: 'TEXT', primaryKey: 1 },
        { name: 'v', type: 'BLOB' },
      ],
      withoutRowid: true,
    }
    expect(createTable(table)).toBe(`CREATE TABLE kv (
  k TEXT PRIMARY KEY,
  v BLOB
) WITHOUT ROWID`)
  })

  it('generates table with STRICT', () => {
    const table: TableDefinition = {
      name: 'strict_table',
      columns: [
        { name: 'id', type: 'INTEGER', primaryKey: 1 },
        { name: 'data', type: 'TEXT' },
      ],
      strict: true,
    }
    expect(createTable(table)).toBe(`CREATE TABLE strict_table (
  id INTEGER PRIMARY KEY,
  data TEXT
) STRICT`)
  })

  it('generates table with CHECK constraint', () => {
    const table: TableDefinition = {
      name: 'products',
      columns: [
        { name: 'id', type: 'INTEGER', primaryKey: 1 },
        { name: 'price', type: 'REAL' },
      ],
      checkConstraints: [{ expression: 'price > 0' }],
    }
    expect(createTable(table)).toBe(`CREATE TABLE products (
  id INTEGER PRIMARY KEY,
  price REAL,
  CHECK (price > 0)
)`)
  })
})

describe('alterTableAddColumn', () => {
  it('generates simple ADD COLUMN', () => {
    expect(
      alterTableAddColumn({
        table: 'users',
        column: { name: 'age', type: 'INTEGER' },
      })
    ).toBe('ALTER TABLE users ADD COLUMN age INTEGER')
  })

  it('generates ADD COLUMN with NOT NULL and DEFAULT', () => {
    expect(
      alterTableAddColumn({
        table: 'items',
        column: { name: 'status', type: 'TEXT', notNull: true, defaultValue: "'new'" },
      })
    ).toBe("ALTER TABLE items ADD COLUMN status TEXT NOT NULL DEFAULT 'new'")
  })

  it('quotes reserved word table and column names', () => {
    expect(
      alterTableAddColumn({
        table: 'order',
        column: { name: 'select', type: 'TEXT' },
      })
    ).toBe('ALTER TABLE "order" ADD COLUMN "select" TEXT')
  })

  it('does not include PRIMARY KEY in ADD COLUMN', () => {
    expect(
      alterTableAddColumn({
        table: 't',
        column: { name: 'id', type: 'INTEGER', primaryKey: 1 },
      })
    ).toBe('ALTER TABLE t ADD COLUMN id INTEGER')
  })
})

describe('alterTableRename', () => {
  it('generates RENAME TO', () => {
    expect(alterTableRename({ from: 'old_table', to: 'new_table' })).toBe(
      'ALTER TABLE old_table RENAME TO new_table'
    )
  })

  it('quotes reserved word table names', () => {
    expect(alterTableRename({ from: 'order', to: 'table' })).toBe(
      'ALTER TABLE "order" RENAME TO "table"'
    )
  })
})

describe('alterTableRenameColumn', () => {
  it('generates RENAME COLUMN', () => {
    expect(
      alterTableRenameColumn({ table: 'users', from: 'old_col', to: 'new_col' })
    ).toBe('ALTER TABLE users RENAME COLUMN old_col TO new_col')
  })

  it('quotes reserved word names', () => {
    expect(
      alterTableRenameColumn({ table: 'order', from: 'select', to: 'from' })
    ).toBe('ALTER TABLE "order" RENAME COLUMN "select" TO "from"')
  })
})

describe('alterTableDropColumn', () => {
  it('generates DROP COLUMN', () => {
    expect(alterTableDropColumn({ table: 'users', column: 'old_col' })).toBe(
      'ALTER TABLE users DROP COLUMN old_col'
    )
  })

  it('quotes reserved word names', () => {
    expect(alterTableDropColumn({ table: 'order', column: 'select' })).toBe(
      'ALTER TABLE "order" DROP COLUMN "select"'
    )
  })
})

describe('columnInfoToDefinition', () => {
  it('converts basic column info', () => {
    const info: ColumnInfo = {
      cid: 0,
      name: 'id',
      type: 'INTEGER',
      notnull: false,
      dfltValue: null,
      pk: 1,
      generated: null,
      hidden: false,
    }
    expect(columnInfoToDefinition(info)).toEqual({
      name: 'id',
      type: 'INTEGER',
      notNull: false,
      primaryKey: 1,
    })
  })

  it('converts column with NOT NULL and DEFAULT', () => {
    const info: ColumnInfo = {
      cid: 1,
      name: 'status',
      type: 'TEXT',
      notnull: true,
      dfltValue: "'active'",
      pk: 0,
      generated: null,
      hidden: false,
    }
    expect(columnInfoToDefinition(info)).toEqual({
      name: 'status',
      type: 'TEXT',
      notNull: true,
      primaryKey: undefined,
      defaultValue: "'active'",
    })
  })

  it('converts generated column', () => {
    const info: ColumnInfo = {
      cid: 2,
      name: 'total',
      type: 'INTEGER',
      notnull: false,
      dfltValue: null,
      pk: 0,
      generated: 'stored',
      hidden: false,
    }
    expect(columnInfoToDefinition(info)).toEqual({
      name: 'total',
      type: 'INTEGER',
      notNull: false,
      primaryKey: undefined,
      generatedType: 'stored',
    })
  })
})

describe('foreignKeyInfoToConstraint', () => {
  it('converts single-column FK', () => {
    const infos: ForeignKeyInfo[] = [
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
    ]
    expect(foreignKeyInfoToConstraint(infos)).toEqual({
      columns: ['user_id'],
      references: 'users',
      refColumns: ['id'],
      onDelete: 'CASCADE',
      onUpdate: 'NO ACTION',
    })
  })

  it('converts composite FK', () => {
    const infos: ForeignKeyInfo[] = [
      {
        id: 0,
        childTable: 'details',
        childColumn: 'org_id',
        parentTable: 'org_users',
        parentColumn: 'org_id',
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE',
        match: 'NONE',
      },
      {
        id: 0,
        childTable: 'details',
        childColumn: 'user_id',
        parentTable: 'org_users',
        parentColumn: 'user_id',
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE',
        match: 'NONE',
      },
    ]
    expect(foreignKeyInfoToConstraint(infos)).toEqual({
      columns: ['org_id', 'user_id'],
      references: 'org_users',
      refColumns: ['org_id', 'user_id'],
      onDelete: 'RESTRICT',
      onUpdate: 'CASCADE',
    })
  })

  it('throws for empty array', () => {
    expect(() => foreignKeyInfoToConstraint([])).toThrow(
      'Cannot create FK constraint from empty array'
    )
  })
})

describe('groupForeignKeyInfos', () => {
  it('groups FK infos by id', () => {
    const infos: ForeignKeyInfo[] = [
      {
        id: 0,
        childTable: 't',
        childColumn: 'a',
        parentTable: 'x',
        parentColumn: 'a',
        onDelete: 'NO ACTION',
        onUpdate: 'NO ACTION',
        match: 'NONE',
      },
      {
        id: 0,
        childTable: 't',
        childColumn: 'b',
        parentTable: 'x',
        parentColumn: 'b',
        onDelete: 'NO ACTION',
        onUpdate: 'NO ACTION',
        match: 'NONE',
      },
      {
        id: 1,
        childTable: 't',
        childColumn: 'c',
        parentTable: 'y',
        parentColumn: 'c',
        onDelete: 'CASCADE',
        onUpdate: 'NO ACTION',
        match: 'NONE',
      },
    ]
    const groups = groupForeignKeyInfos(infos)
    expect(groups.size).toBe(2)
    expect(groups.get(0)?.length).toBe(2)
    expect(groups.get(1)?.length).toBe(1)
  })

  it('handles empty input', () => {
    const groups = groupForeignKeyInfos([])
    expect(groups.size).toBe(0)
  })
})
