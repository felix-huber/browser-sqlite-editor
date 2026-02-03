import { describe, it, expect, vi } from 'vitest'
import type { DatabaseEngine } from '../engine/db-engine'
import {
  compileCheckView,
  compileCheckTrigger,
  compileCheckAllViews,
  compileCheckAllTriggers,
  fetchSqliteMaster,
  runCompileChecks,
  runCompileChecksOnObjects,
  compileFailuresToVerificationFailures,
} from './compile-check'

function makeEngine(queryImpl: DatabaseEngine['query']): DatabaseEngine {
  return { query: queryImpl } as unknown as DatabaseEngine
}

describe('compileCheckView', () => {
  it('returns success when view compiles', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] })
    const engine = makeEngine(query)

    const result = await compileCheckView(engine, 'my_view', 'CREATE VIEW my_view AS SELECT 1')

    expect(query).toHaveBeenCalledWith('SELECT * FROM my_view LIMIT 0')
    expect(result.success).toBe(true)
    expect(result.type).toBe('view')
  })

  it('returns failure when view compile throws', async () => {
    const query = vi.fn().mockRejectedValue(new Error('bad view'))
    const engine = makeEngine(query)

    const result = await compileCheckView(engine, 'bad_view', 'CREATE VIEW bad_view AS SELECT *')

    expect(result.success).toBe(false)
    expect(result.error).toContain('bad view')
  })
})

describe('compileCheckTrigger', () => {
  it('returns failure when trigger is missing', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] })
    const engine = makeEngine(query)

    const result = await compileCheckTrigger(engine, 'trg_missing', 'CREATE TRIGGER trg_missing')

    expect(result.success).toBe(false)
    expect(result.error).toContain('Trigger was not recreated')
  })

  it('returns success when trigger exists', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [['CREATE TRIGGER t']] })
    const engine = makeEngine(query)

    const result = await compileCheckTrigger(engine, 'trg_ok', 'CREATE TRIGGER trg_ok')

    expect(result.success).toBe(true)
    expect(result.type).toBe('trigger')
  })
})

describe('compileCheckAllViews / compileCheckAllTriggers', () => {
  it('runs checks only for matching types', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [['CREATE TRIGGER t']] })
    const engine = makeEngine(query)
    const masterRows = [
      { type: 'view' as const, name: 'v1', tblName: 't1', rootpage: 0, sql: 'CREATE VIEW v1 AS SELECT 1' },
      { type: 'trigger' as const, name: 't1', tblName: 't1', rootpage: 0, sql: 'CREATE TRIGGER t1' },
    ]

    const views = await compileCheckAllViews(engine, masterRows)
    const triggers = await compileCheckAllTriggers(engine, masterRows)

    expect(views).toHaveLength(1)
    expect(views[0].type).toBe('view')
    expect(triggers).toHaveLength(1)
    expect(triggers[0].type).toBe('trigger')
  })
})

describe('fetchSqliteMaster', () => {
  it('maps sqlite_master rows to typed objects', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [['view', 'v1', 't1', 1, 'CREATE VIEW v1 AS SELECT 1']],
    })
    const engine = makeEngine(query)

    const result = await fetchSqliteMaster(engine)

    expect(result).toEqual([
      { type: 'view', name: 'v1', tblName: 't1', rootpage: 1, sql: 'CREATE VIEW v1 AS SELECT 1' },
    ])
  })
})

describe('runCompileChecks', () => {
  it('returns allPassed true when all objects compile', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.startsWith('SELECT type, name')) {
        return {
          rows: [
            ['view', 'v1', 't1', 0, 'CREATE VIEW v1 AS SELECT 1'],
            ['trigger', 't1', 't1', 0, 'CREATE TRIGGER t1'],
          ],
        }
      }
      if (sql.startsWith('SELECT * FROM "v1"')) {
        return { rows: [] }
      }
      if (sql.includes("type = 'trigger'")) {
        return { rows: [['CREATE TRIGGER t1']] }
      }
      return { rows: [] }
    })
    const engine = makeEngine(query)

    const result = await runCompileChecks(engine)

    expect(result.allPassed).toBe(true)
    expect(result.failures).toHaveLength(0)
    expect(result.errorMessage).toBe('')
  })
})

describe('runCompileChecksOnObjects', () => {
  it('returns failures and error message when objects are missing', async () => {
    const query = vi.fn(async () => ({ rows: [] }))
    const engine = makeEngine(query)

    const result = await runCompileChecksOnObjects(engine, ['missing_view'], ['missing_trigger'])

    expect(result.allPassed).toBe(false)
    expect(result.failures).toHaveLength(2)
    expect(result.errorMessage).toContain('dependent object(s) failed to compile')
    expect(result.errorMessage).toContain('missing_view')
    expect(result.errorMessage).toContain('missing_trigger')
  })
})

describe('compileFailuresToVerificationFailures', () => {
  it('maps compile failures to verification failures', () => {
    const failures = [
      { name: 'v1', type: 'view' as const, success: false, error: 'bad', sql: 'CREATE VIEW v1' },
      { name: 't1', type: 'trigger' as const, success: false, error: 'bad', sql: 'CREATE TRIGGER t1' },
    ]

    const result = compileFailuresToVerificationFailures(failures)

    expect(result).toEqual([
      {
        type: 'view_broken',
        objectName: 'v1',
        message: 'View "v1" failed to compile after rebuild',
        details: 'bad',
      },
      {
        type: 'trigger_broken',
        objectName: 't1',
        message: 'Trigger "t1" failed to compile after rebuild',
        details: 'bad',
      },
    ])
  })
})
