import { describe, it, expect } from 'vitest'
import {
  buildUpdateStatement,
  buildDeleteStatement,
  validateColumnForUpdate,
  extractPrimaryKeyFromRow,
  getPrimaryKeyColumns,
  hasUsableIdentifier,
  GeneratedColumnError,
  ColumnNotFoundError,
  type UpdateOptions,
} from '../row-update'
import type { TableInfo, ColumnInfo } from '../../types'

// Helper to create minimal TableInfo
function makeTableInfo(
  name: string,
  columns: ColumnInfo[],
  withoutRowid = false
): TableInfo {
  return {
    name,
    isView: false,
    isVirtual: false,
    withoutRowid,
    columns,
    indexes: [],
    createSql: '',
  }
}

// Helper to create ColumnInfo
function makeColumn(
  name: string,
  opts: Partial<ColumnInfo> = {}
): ColumnInfo {
  return {
    cid: 0,
    name,
    type: 'TEXT',
    notnull: false,
    dfltValue: null,
    pk: 0,
    generated: null,
    hidden: false,
    ...opts,
  }
}

describe('buildUpdateStatement', () => {
  describe('rowid tables', () => {
    it('generates UPDATE with rowid targeting', () => {
      const result = buildUpdateStatement({
        tableName: 'users',
        columnName: 'name',
        newValue: 'Alice',
        primaryKey: { type: 'rowid', rowid: 42 },
      })

      expect(result.sql).toBe('UPDATE users SET name = ? WHERE rowid = ?')
      expect(result.params).toEqual(['Alice', 42])
    })

    it('handles bigint rowid', () => {
      const result = buildUpdateStatement({
        tableName: 'items',
        columnName: 'status',
        newValue: 'active',
        primaryKey: { type: 'rowid', rowid: BigInt(9007199254740993) },
      })

      expect(result.sql).toBe('UPDATE items SET status = ? WHERE rowid = ?')
      expect(result.params).toEqual(['active', BigInt(9007199254740993)])
    })

    it('quotes reserved word table and column names', () => {
      const result = buildUpdateStatement({
        tableName: 'order',
        columnName: 'select',
        newValue: 'test',
        primaryKey: { type: 'rowid', rowid: 1 },
      })

      expect(result.sql).toBe('UPDATE "order" SET "select" = ? WHERE rowid = ?')
      expect(result.params).toEqual(['test', 1])
    })

    it('returns affected = 1 pattern (statement structure)', () => {
      const result = buildUpdateStatement({
        tableName: 't',
        columnName: 'col',
        newValue: 'val',
        primaryKey: { type: 'rowid', rowid: 1 },
      })

      // The SQL structure ensures rowid targeting for exactly one row
      expect(result.sql).toContain('WHERE rowid = ?')
    })
  })

  describe('WITHOUT ROWID tables', () => {
    it('generates UPDATE with single PK column', () => {
      const result = buildUpdateStatement({
        tableName: 'kv',
        columnName: 'value',
        newValue: 'bar',
        primaryKey: { type: 'pk', columns: new Map([['pk_id', 'foo']]) },
      })

      expect(result.sql).toBe('UPDATE kv SET value = ? WHERE pk_id = ?')
      expect(result.params).toEqual(['bar', 'foo'])
    })

    it('generates UPDATE with composite PK', () => {
      const result = buildUpdateStatement({
        tableName: 'junction',
        columnName: 'data',
        newValue: 'updated',
        primaryKey: {
          type: 'pk',
          columns: new Map([
            ['left_id', 10],
            ['right_id', 20],
          ]),
        },
      })

      expect(result.sql).toBe(
        'UPDATE junction SET data = ? WHERE left_id = ? AND right_id = ?'
      )
      expect(result.params).toEqual(['updated', 10, 20])
    })
  })

  describe('NULL value handling', () => {
    it('handles update TO NULL', () => {
      const result = buildUpdateStatement({
        tableName: 'users',
        columnName: 'middle_name',
        newValue: null,
        primaryKey: { type: 'rowid', rowid: 5 },
      })

      expect(result.sql).toBe(
        'UPDATE users SET middle_name = ? WHERE rowid = ?'
      )
      expect(result.params).toEqual([null, 5])
    })

    it('handles NULL PK column with IS NULL', () => {
      const result = buildUpdateStatement({
        tableName: 'data',
        columnName: 'status',
        newValue: 'active',
        primaryKey: { type: 'pk', columns: new Map([['id', null]]) },
      })

      expect(result.sql).toBe('UPDATE data SET status = ? WHERE id IS NULL')
      expect(result.params).toEqual(['active'])
    })

    it('handles mixed NULL and non-NULL PK columns', () => {
      const pkColumns = new Map<string, unknown>()
      pkColumns.set('a', 1)
      pkColumns.set('b', null)
      pkColumns.set('c', 'test')

      const result = buildUpdateStatement({
        tableName: 'multi',
        columnName: 'val',
        newValue: 'x',
        primaryKey: {
          type: 'pk',
          columns: pkColumns,
        },
      })

      expect(result.sql).toBe(
        'UPDATE multi SET val = ? WHERE a = ? AND b IS NULL AND c = ?'
      )
      expect(result.params).toEqual(['x', 1, 'test'])
    })
  })

  describe('non-existent row', () => {
    it('produces valid SQL even for non-existent row (affected = 0)', () => {
      // The statement is valid; affected count depends on execution
      const result = buildUpdateStatement({
        tableName: 'users',
        columnName: 'name',
        newValue: 'Nobody',
        primaryKey: { type: 'rowid', rowid: 999999 },
      })

      expect(result.sql).toBe('UPDATE users SET name = ? WHERE rowid = ?')
      expect(result.params).toEqual(['Nobody', 999999])
      // When executed against a DB without row 999999, affected = 0
    })
  })
})

describe('validateColumnForUpdate', () => {
  it('passes for regular columns', () => {
    const tableInfo = makeTableInfo('users', [
      makeColumn('id', { pk: 1 }),
      makeColumn('name'),
      makeColumn('email'),
    ])

    expect(() => validateColumnForUpdate('name', tableInfo)).not.toThrow()
    expect(() => validateColumnForUpdate('email', tableInfo)).not.toThrow()
  })

  it('throws ColumnNotFoundError for missing column', () => {
    const tableInfo = makeTableInfo('users', [
      makeColumn('id', { pk: 1 }),
      makeColumn('name'),
    ])

    expect(() => validateColumnForUpdate('nonexistent', tableInfo)).toThrow(
      ColumnNotFoundError
    )
    expect(() => validateColumnForUpdate('nonexistent', tableInfo)).toThrow(
      "Column 'nonexistent' not found in table 'users'"
    )
  })

  it('throws GeneratedColumnError for generated STORED column', () => {
    const tableInfo = makeTableInfo('calc', [
      makeColumn('a'),
      makeColumn('b'),
      makeColumn('sum', { generated: 'stored' }),
    ])

    expect(() => validateColumnForUpdate('sum', tableInfo)).toThrow(
      GeneratedColumnError
    )
    expect(() => validateColumnForUpdate('sum', tableInfo)).toThrow(
      'Cannot update generated column: sum'
    )
  })

  it('throws GeneratedColumnError for generated VIRTUAL column', () => {
    const tableInfo = makeTableInfo('calc', [
      makeColumn('first'),
      makeColumn('last'),
      makeColumn('fullname', { generated: 'virtual' }),
    ])

    expect(() => validateColumnForUpdate('fullname', tableInfo)).toThrow(
      GeneratedColumnError
    )
  })

  it('allows updating PK columns', () => {
    const tableInfo = makeTableInfo('users', [
      makeColumn('id', { pk: 1 }),
      makeColumn('name'),
    ])

    // PK columns can technically be updated (though may fail FK constraints)
    expect(() => validateColumnForUpdate('id', tableInfo)).not.toThrow()
  })
})

describe('buildUpdateStatement with validation', () => {
  it('validates column when tableInfo provided', () => {
    const tableInfo = makeTableInfo('calc', [
      makeColumn('a'),
      makeColumn('sum', { generated: 'stored' }),
    ])

    expect(() =>
      buildUpdateStatement({
        tableName: 'calc',
        columnName: 'sum',
        newValue: 100,
        primaryKey: { type: 'rowid', rowid: 1 },
        tableInfo,
      })
    ).toThrow(GeneratedColumnError)
  })

  it('skips validation when tableInfo not provided', () => {
    // Without tableInfo, no validation is performed
    const result = buildUpdateStatement({
      tableName: 'calc',
      columnName: 'sum',
      newValue: 100,
      primaryKey: { type: 'rowid', rowid: 1 },
    })

    expect(result.sql).toBe('UPDATE calc SET sum = ? WHERE rowid = ?')
  })
})

describe('extractPrimaryKeyFromRow', () => {
  it('extracts rowid for regular tables', () => {
    const tableInfo = makeTableInfo('users', [
      makeColumn('id', { pk: 1, cid: 0 }),
      makeColumn('name', { cid: 1 }),
    ])

    const result = extractPrimaryKeyFromRow(
      tableInfo,
      { id: 42, name: 'Alice' },
      42
    )

    expect(result).toEqual({ type: 'rowid', rowid: 42 })
  })

  it('extracts PK columns for WITHOUT ROWID tables', () => {
    const tableInfo = makeTableInfo(
      'kv',
      [
        makeColumn('key', { pk: 1, cid: 0 }),
        makeColumn('value', { cid: 1 }),
      ],
      true // withoutRowid
    )

    const result = extractPrimaryKeyFromRow(tableInfo, {
      key: 'mykey',
      value: 'myvalue',
    })

    expect(result.type).toBe('pk')
    if (result.type === 'pk') {
      expect(result.columns.get('key')).toBe('mykey')
      expect(result.columns.size).toBe(1)
    }
  })

  it('extracts composite PK columns in order', () => {
    const tableInfo = makeTableInfo(
      'junction',
      [
        makeColumn('left_id', { pk: 1, cid: 0 }),
        makeColumn('right_id', { pk: 2, cid: 1 }),
        makeColumn('data', { cid: 2 }),
      ],
      true
    )

    const result = extractPrimaryKeyFromRow(tableInfo, {
      left_id: 10,
      right_id: 20,
      data: 'test',
    })

    expect(result.type).toBe('pk')
    if (result.type === 'pk') {
      const keys = Array.from(result.columns.keys())
      expect(keys).toEqual(['left_id', 'right_id'])
      expect(result.columns.get('left_id')).toBe(10)
      expect(result.columns.get('right_id')).toBe(20)
    }
  })

  it('falls back to PK columns for rowid table without rowid param', () => {
    const tableInfo = makeTableInfo('users', [
      makeColumn('id', { pk: 1, cid: 0 }),
      makeColumn('name', { cid: 1 }),
    ])

    const result = extractPrimaryKeyFromRow(tableInfo, { id: 42, name: 'Bob' })

    expect(result.type).toBe('pk')
    if (result.type === 'pk') {
      expect(result.columns.get('id')).toBe(42)
    }
  })

  it('throws when no PK or rowid available', () => {
    const tableInfo = makeTableInfo('data', [
      makeColumn('a', { cid: 0 }),
      makeColumn('b', { cid: 1 }),
    ])

    expect(() =>
      extractPrimaryKeyFromRow(tableInfo, { a: 1, b: 2 })
    ).toThrow('Cannot extract primary key: no rowid or PK columns found')
  })
})

describe('getPrimaryKeyColumns', () => {
  it('returns PK columns sorted by pk order', () => {
    const tableInfo = makeTableInfo('multi', [
      makeColumn('data', { cid: 0 }),
      makeColumn('pk2', { pk: 2, cid: 1 }),
      makeColumn('pk1', { pk: 1, cid: 2 }),
    ])

    const result = getPrimaryKeyColumns(tableInfo)

    expect(result.map((c) => c.name)).toEqual(['pk1', 'pk2'])
  })

  it('returns empty array for table without PK', () => {
    const tableInfo = makeTableInfo('data', [
      makeColumn('a', { cid: 0 }),
      makeColumn('b', { cid: 1 }),
    ])

    const result = getPrimaryKeyColumns(tableInfo)
    expect(result).toEqual([])
  })

  it('returns single column for simple PK', () => {
    const tableInfo = makeTableInfo('users', [
      makeColumn('id', { pk: 1, cid: 0 }),
      makeColumn('name', { cid: 1 }),
    ])

    const result = getPrimaryKeyColumns(tableInfo)
    expect(result.map((c) => c.name)).toEqual(['id'])
  })
})

describe('concurrent update (last write wins)', () => {
  it('produces deterministic SQL for same input', () => {
    const options: UpdateOptions = {
      tableName: 'users',
      columnName: 'name',
      newValue: 'Updated',
      primaryKey: { type: 'rowid', rowid: 1 },
    }

    const result1 = buildUpdateStatement(options)
    const result2 = buildUpdateStatement(options)

    expect(result1.sql).toBe(result2.sql)
    expect(result1.params).toEqual(result2.params)
    // Last write wins is a DB behavior, not statement generation
  })
})

describe('buildDeleteStatement', () => {
  it('generates DELETE with rowid targeting', () => {
    const result = buildDeleteStatement(
      'users',
      { type: 'rowid', rowid: 42 }
    )

    expect(result.sql).toBe('DELETE FROM users WHERE rowid = ?')
    expect(result.params).toEqual([42])
  })

  it('generates DELETE with single PK column', () => {
    const result = buildDeleteStatement('kv', {
      type: 'pk',
      columns: new Map([['key', 'mykey']]),
    })

    expect(result.sql).toBe('DELETE FROM kv WHERE "key" = ?')
    expect(result.params).toEqual(['mykey'])
  })

  it('generates DELETE with composite PK', () => {
    const result = buildDeleteStatement('junction', {
      type: 'pk',
      columns: new Map([
        ['left_id', 10],
        ['right_id', 20],
      ]),
    })

    expect(result.sql).toBe(
      'DELETE FROM junction WHERE left_id = ? AND right_id = ?'
    )
    expect(result.params).toEqual([10, 20])
  })

  it('handles NULL PK column with IS NULL', () => {
    const result = buildDeleteStatement('data', {
      type: 'pk',
      columns: new Map([['id', null]]),
    })

    expect(result.sql).toBe('DELETE FROM data WHERE id IS NULL')
    expect(result.params).toEqual([])
  })

  it('quotes reserved word table and column names', () => {
    const result = buildDeleteStatement('order', {
      type: 'pk',
      columns: new Map([['select', 'test']]),
    })

    expect(result.sql).toBe('DELETE FROM "order" WHERE "select" = ?')
    expect(result.params).toEqual(['test'])
  })
})

describe('hasUsableIdentifier', () => {
  it('returns true for regular rowid table', () => {
    const tableInfo = makeTableInfo('users', [
      makeColumn('id', { pk: 1, cid: 0 }),
      makeColumn('name', { cid: 1 }),
    ])

    expect(hasUsableIdentifier(tableInfo)).toBe(true)
  })

  it('returns true for rowid table without explicit PK', () => {
    // Regular tables always have rowid even without explicit PK
    const tableInfo = makeTableInfo('data', [
      makeColumn('a', { cid: 0 }),
      makeColumn('b', { cid: 1 }),
    ])

    expect(hasUsableIdentifier(tableInfo)).toBe(true)
  })

  it('returns true for WITHOUT ROWID table with PK', () => {
    const tableInfo = makeTableInfo(
      'kv',
      [
        makeColumn('key', { pk: 1, cid: 0 }),
        makeColumn('value', { cid: 1 }),
      ],
      true // withoutRowid
    )

    expect(hasUsableIdentifier(tableInfo)).toBe(true)
  })

  it('returns false for WITHOUT ROWID table without PK columns', () => {
    // This is technically invalid in SQLite (WITHOUT ROWID requires PK),
    // but we handle it defensively
    const tableInfo = makeTableInfo(
      'broken',
      [makeColumn('a', { cid: 0 }), makeColumn('b', { cid: 1 })],
      true // withoutRowid
    )

    expect(hasUsableIdentifier(tableInfo)).toBe(false)
  })

  it('returns false for views', () => {
    const tableInfo: TableInfo = {
      name: 'user_view',
      isView: true,
      isVirtual: false,
      withoutRowid: false,
      columns: [makeColumn('id'), makeColumn('name')],
      indexes: [],
      createSql: 'CREATE VIEW user_view AS SELECT * FROM users',
    }

    expect(hasUsableIdentifier(tableInfo)).toBe(false)
  })

  it('returns false for virtual tables', () => {
    const tableInfo: TableInfo = {
      name: 'fts_table',
      isView: false,
      isVirtual: true,
      withoutRowid: false,
      columns: [makeColumn('content')],
      indexes: [],
      createSql: 'CREATE VIRTUAL TABLE fts_table USING fts5(content)',
    }

    expect(hasUsableIdentifier(tableInfo)).toBe(false)
  })
})
