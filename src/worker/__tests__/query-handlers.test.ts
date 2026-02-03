import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => {
  const cleanup = vi.fn()
  return {
    engine: {
      isReady: vi.fn(),
    },
    cleanup,
    registerQuery: vi.fn(() => cleanup),
    requestCancellation: vi.fn(),
    createTransactionTracker: vi.fn(() => ({ id: 'tracker' })),
    executeWithTransactionTracking: vi.fn(),
  }
})

vi.mock('../../core/engine/db-engine', () => ({
  getEngine: () => mocks.engine,
}))

vi.mock('../query-cancel', () => ({
  registerQuery: mocks.registerQuery,
  requestCancellation: mocks.requestCancellation,
}))

vi.mock('../../features/sql/transactionTracker', () => ({
  createTransactionTracker: mocks.createTransactionTracker,
  executeWithTransactionTracking: mocks.executeWithTransactionTracking,
}))

import {
  handleQueryRequest,
  handleExecRequest,
  handleCancelRequest,
  getSessionTracker,
  resetSessionTracker,
} from '../handlers/query'

describe('query handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetSessionTracker()
  })

  it('resetSessionTracker creates a new tracker', () => {
    const first = getSessionTracker()
    resetSessionTracker()
    const second = getSessionTracker()
    expect(first).not.toBe(second)
  })

  it('handleQueryRequest returns error when engine not ready', async () => {
    mocks.engine.isReady.mockReturnValue(false)
    const postResponse = vi.fn()

    await handleQueryRequest({ type: 'query', sql: 'SELECT 1' }, 1, postResponse)

    expect(postResponse).toHaveBeenCalledWith(
      { type: 'error', message: 'No database open. Please open a database first.', code: 'UNKNOWN' },
      1
    )
    expect(mocks.cleanup).toHaveBeenCalled()
  })

  it('handleQueryRequest applies pagination and includes warnings', async () => {
    mocks.engine.isReady.mockReturnValue(true)
    mocks.executeWithTransactionTracking.mockResolvedValue({
      success: true,
      warnings: [{ type: 'orphan_begin', message: 'dangling' }],
      results: [
        {
          sql: 'SELECT 1',
          type: 'SELECT',
          queryResult: { columns: ['a'], columnTypes: ['INTEGER'], rows: [[1]], rowsAffected: 1 },
        },
      ],
      totalRowsAffected: 1,
    })
    const postResponse = vi.fn()

    await handleQueryRequest(
      { type: 'query', sql: 'SELECT 1;', limit: 5, offset: 10 },
      7,
      postResponse
    )

    expect(mocks.executeWithTransactionTracking).toHaveBeenCalledWith(
      mocks.engine,
      'SELECT 1 LIMIT 5 OFFSET 10',
      getSessionTracker(),
      { autoRollbackOrphan: true, params: undefined }
    )
    expect(postResponse).toHaveBeenCalledWith(
      {
        type: 'queryResult',
        result: { columns: ['a'], columnTypes: ['INTEGER'], rows: [[1]], rowsAffected: 1 },
        transactionWarnings: [{ type: 'orphan_begin', message: 'dangling' }],
      },
      7
    )
  })

  it('handleExecRequest returns lastInsertId and warnings', async () => {
    mocks.engine.isReady.mockReturnValue(true)
    mocks.executeWithTransactionTracking.mockResolvedValue({
      success: true,
      warnings: [{ type: 'rollback_on_error', message: 'rollback' }],
      results: [
        { sql: 'INSERT', type: 'INSERT', rowsAffected: 1, lastInsertId: 42 },
      ],
      totalRowsAffected: 1,
    })
    const postResponse = vi.fn()

    await handleExecRequest(
      { type: 'exec', sql: 'INSERT INTO t VALUES (1)', skipAutoRollback: true },
      9,
      postResponse
    )

    expect(mocks.executeWithTransactionTracking).toHaveBeenCalledWith(
      mocks.engine,
      'INSERT INTO t VALUES (1)',
      getSessionTracker(),
      { autoRollbackOrphan: false, params: undefined }
    )
    expect(postResponse).toHaveBeenCalledWith(
      {
        type: 'success',
        data: {
          rowsAffected: 1,
          lastInsertId: 42,
          transactionWarnings: [{ type: 'rollback_on_error', message: 'rollback' }],
        },
      },
      9
    )
  })

  it('handleExecRequest normalizes syntax errors', async () => {
    mocks.engine.isReady.mockReturnValue(true)
    mocks.executeWithTransactionTracking.mockRejectedValue(new Error('syntax error near "FORM"'))
    const postResponse = vi.fn()

    await handleExecRequest({ type: 'exec', sql: 'SELECT FORM' }, 11, postResponse)

    expect(postResponse).toHaveBeenCalledWith(
      { type: 'error', message: 'syntax error near "FORM"', code: 'SYNTAX_ERROR' },
      11
    )
  })

  it('handleCancelRequest returns success on cancellation', async () => {
    mocks.requestCancellation.mockResolvedValue(undefined)
    const postResponse = vi.fn()

    await handleCancelRequest({ type: 'cancel' }, 12, postResponse)

    expect(postResponse).toHaveBeenCalledWith({ type: 'success' }, 12)
  })

  it('handleCancelRequest returns error when cancellation fails', async () => {
    mocks.requestCancellation.mockRejectedValue(new Error('boom'))
    const postResponse = vi.fn()

    await handleCancelRequest({ type: 'cancel' }, 13, postResponse)

    expect(postResponse).toHaveBeenCalledWith(
      { type: 'error', message: 'Failed to cancel: boom', code: 'UNKNOWN' },
      13
    )
  })
})
