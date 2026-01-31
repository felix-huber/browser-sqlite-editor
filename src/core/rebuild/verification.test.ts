import { describe, it, expect, vi } from 'vitest'
import {
  verifySchemaTextually,
  verifySchemaPreservation,
  UNSUPPORTED_SCHEMA_ERROR,
} from './verification'
import type { DatabaseEngine } from '../engine/db-engine'

/**
 * Mock DatabaseEngine for testing verification functions.
 */
function createMockEngine(sqliteMasterSql: string): DatabaseEngine {
  return {
    query: vi.fn().mockImplementation(async (sql: string) => {
      if (sql.includes('sqlite_master')) {
        return {
          columns: ['sql'],
          rows: [[sqliteMasterSql]],
        }
      }
      // PRAGMA table_info mock
      if (sql.includes('table_info')) {
        return { columns: [], rows: [] }
      }
      // PRAGMA index_list mock
      if (sql.includes('index_list')) {
        return { columns: [], rows: [] }
      }
      // PRAGMA foreign_key_list mock
      if (sql.includes('foreign_key_list')) {
        return { columns: [], rows: [] }
      }
      return { columns: [], rows: [] }
    }),
    exec: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  } as unknown as DatabaseEngine
}

describe('verification: textual clause detection', () => {
  describe('verifySchemaTextually', () => {
    it('detects CHECK constraint in original SQL', () => {
      const originalSql = 'CREATE TABLE t (x INTEGER CHECK (x > 0))'
      const result = verifySchemaTextually(originalSql)

      expect(result.hasCheck).toBe(true)
      expect(result.hasGenerated).toBe(false)
      expect(result.hasStrict).toBe(false)
      expect(result.hasWithoutRowid).toBe(false)
    })

    it('detects GENERATED column', () => {
      const originalSql =
        'CREATE TABLE t (a INTEGER, b INTEGER GENERATED ALWAYS AS (a * 2) STORED)'
      const result = verifySchemaTextually(originalSql)

      expect(result.hasGenerated).toBe(true)
    })

    it('detects VIRTUAL generated column', () => {
      const originalSql =
        'CREATE TABLE t (a INTEGER, b AS (a + 1) VIRTUAL)'
      const result = verifySchemaTextually(originalSql)

      expect(result.hasGenerated).toBe(true)
    })

    it('detects STRICT table option', () => {
      const originalSql = 'CREATE TABLE t (x INTEGER) STRICT'
      const result = verifySchemaTextually(originalSql)

      expect(result.hasStrict).toBe(true)
    })

    it('detects WITHOUT ROWID table option', () => {
      const originalSql =
        'CREATE TABLE t (k TEXT PRIMARY KEY, v BLOB) WITHOUT ROWID'
      const result = verifySchemaTextually(originalSql)

      expect(result.hasWithoutRowid).toBe(true)
    })

    it('detects multiple clauses', () => {
      const originalSql =
        'CREATE TABLE t (k TEXT PRIMARY KEY CHECK (length(k) > 0)) WITHOUT ROWID, STRICT'
      const result = verifySchemaTextually(originalSql)

      expect(result.hasCheck).toBe(true)
      expect(result.hasStrict).toBe(true)
      expect(result.hasWithoutRowid).toBe(true)
    })

    it('handles case insensitivity', () => {
      const originalSql = 'CREATE TABLE t (x INTEGER check (x > 0)) strict, without rowid'
      const result = verifySchemaTextually(originalSql)

      expect(result.hasCheck).toBe(true)
      expect(result.hasStrict).toBe(true)
      expect(result.hasWithoutRowid).toBe(true)
    })

    it('returns false for simple table without special clauses', () => {
      const originalSql = 'CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)'
      const result = verifySchemaTextually(originalSql)

      expect(result.hasCheck).toBe(false)
      expect(result.hasGenerated).toBe(false)
      expect(result.hasStrict).toBe(false)
      expect(result.hasWithoutRowid).toBe(false)
    })
  })
})

describe('verification: schema preservation check', () => {
  describe('verifySchemaPreservation', () => {
    it('passes when CHECK clause is preserved', async () => {
      const originalSql = 'CREATE TABLE t (x INTEGER CHECK (x > 0))'
      const engine = createMockEngine('CREATE TABLE t (x INTEGER CHECK (x > 0))')

      const result = await verifySchemaPreservation(engine, 't', originalSql)

      expect(result.success).toBe(true)
      expect(result.failures).toHaveLength(0)
    })

    it('fails when CHECK clause is missing in rebuilt table', async () => {
      const originalSql = 'CREATE TABLE t (x INTEGER CHECK (x > 0))'
      const engine = createMockEngine('CREATE TABLE t (x INTEGER)')

      const result = await verifySchemaPreservation(engine, 't', originalSql)

      expect(result.success).toBe(false)
      expect(result.failures).toContainEqual(
        expect.objectContaining({ type: 'missing_check' })
      )
    })

    it('fails when GENERATED clause is missing in rebuilt table', async () => {
      const originalSql =
        'CREATE TABLE t (a INTEGER, b INTEGER GENERATED ALWAYS AS (a * 2) STORED)'
      const engine = createMockEngine('CREATE TABLE t (a INTEGER, b INTEGER)')

      const result = await verifySchemaPreservation(engine, 't', originalSql)

      expect(result.success).toBe(false)
      expect(result.failures).toContainEqual(
        expect.objectContaining({ type: 'missing_generated' })
      )
    })

    it('fails when STRICT is missing in rebuilt table', async () => {
      const originalSql = 'CREATE TABLE t (x INTEGER) STRICT'
      const engine = createMockEngine('CREATE TABLE t (x INTEGER)')

      const result = await verifySchemaPreservation(engine, 't', originalSql)

      expect(result.success).toBe(false)
      expect(result.failures).toContainEqual(
        expect.objectContaining({ type: 'missing_strict' })
      )
    })

    it('fails when WITHOUT ROWID is missing in rebuilt table', async () => {
      const originalSql =
        'CREATE TABLE t (k TEXT PRIMARY KEY, v BLOB) WITHOUT ROWID'
      const engine = createMockEngine(
        'CREATE TABLE t (k TEXT PRIMARY KEY, v BLOB)'
      )

      const result = await verifySchemaPreservation(engine, 't', originalSql)

      expect(result.success).toBe(false)
      expect(result.failures).toContainEqual(
        expect.objectContaining({ type: 'missing_without_rowid' })
      )
    })

    it('reports multiple missing clauses', async () => {
      const originalSql =
        'CREATE TABLE t (x INTEGER CHECK (x > 0)) STRICT, WITHOUT ROWID'
      const engine = createMockEngine('CREATE TABLE t (x INTEGER)')

      const result = await verifySchemaPreservation(engine, 't', originalSql)

      expect(result.success).toBe(false)
      expect(result.failures.length).toBeGreaterThanOrEqual(3)
    })

    it('returns correct error message for unsupported schema', async () => {
      const originalSql = 'CREATE TABLE t (x INTEGER CHECK (x > 0))'
      const engine = createMockEngine('CREATE TABLE t (x INTEGER)')

      const result = await verifySchemaPreservation(engine, 't', originalSql)

      expect(result.errorMessage).toBe(UNSUPPORTED_SCHEMA_ERROR)
    })

    it('passes for simple table with no special clauses', async () => {
      const originalSql = 'CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)'
      const engine = createMockEngine(
        'CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)'
      )

      const result = await verifySchemaPreservation(engine, 't', originalSql)

      expect(result.success).toBe(true)
    })

    it('handles query errors gracefully', async () => {
      const originalSql = 'CREATE TABLE t (x INTEGER CHECK (x > 0))'
      const engine = {
        query: vi.fn().mockRejectedValue(new Error('Query failed')),
        exec: vi.fn(),
        close: vi.fn(),
      } as unknown as DatabaseEngine

      const result = await verifySchemaPreservation(engine, 't', originalSql)

      expect(result.success).toBe(false)
      expect(result.failures).toContainEqual(
        expect.objectContaining({ type: 'query_error' })
      )
    })

    it('handles table not found in sqlite_master', async () => {
      const originalSql = 'CREATE TABLE t (x INTEGER CHECK (x > 0))'
      const engine = {
        query: vi.fn().mockResolvedValue({ columns: ['sql'], rows: [] }),
        exec: vi.fn(),
        close: vi.fn(),
      } as unknown as DatabaseEngine

      const result = await verifySchemaPreservation(engine, 't', originalSql)

      expect(result.success).toBe(false)
      expect(result.shouldRollback).toBe(true)
      expect(result.failures).toContainEqual(
        expect.objectContaining({
          type: 'query_error',
          message: 'Table "t" not found in sqlite_master',
        })
      )
      expect(result.errorMessage).toBe(UNSUPPORTED_SCHEMA_ERROR)
    })
  })
})

describe('verification: rollback trigger', () => {
  it('verification failure should trigger rollback in executor', async () => {
    // This test verifies the contract that verification failures
    // result in rollback. The actual integration is tested in execute.ts
    const originalSql = 'CREATE TABLE t (x INTEGER CHECK (x > 0))'
    const engine = createMockEngine('CREATE TABLE t (x INTEGER)')

    const result = await verifySchemaPreservation(engine, 't', originalSql)

    // When verification fails, the result should indicate rollback is needed
    expect(result.success).toBe(false)
    expect(result.shouldRollback).toBe(true)
  })

  it('successful verification should not trigger rollback', async () => {
    const originalSql = 'CREATE TABLE t (x INTEGER CHECK (x > 0))'
    const engine = createMockEngine('CREATE TABLE t (x INTEGER CHECK (x > 0))')

    const result = await verifySchemaPreservation(engine, 't', originalSql)

    expect(result.success).toBe(true)
    expect(result.shouldRollback).toBe(false)
  })
})

describe('UNSUPPORTED_SCHEMA_ERROR constant', () => {
  it('has the correct PRD-specified message', () => {
    expect(UNSUPPORTED_SCHEMA_ERROR).toBe(
      'This table uses schema features that cannot be safely modified via the visual designer. Use the SQL editor instead.'
    )
  })
})
