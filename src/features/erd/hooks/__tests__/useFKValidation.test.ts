import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useFKValidation, type FKValidationHookInput } from '../useFKValidation'
import type { QueryResult, TableInfo } from '../../../../types'

// Mock the worker client module
const mockQuery = vi.fn<[string, unknown[]], Promise<QueryResult>>()
const mockGetTableInfo = vi.fn<[string], Promise<TableInfo>>()
const mockExec = vi.fn<[string], Promise<{ rowsAffected?: number }>>()

vi.mock('../../../../core/worker/client', () => ({
  getWorkerClient: () => ({
    query: mockQuery,
    getTableInfo: mockGetTableInfo,
    exec: mockExec,
  }),
}))

describe('useFKValidation', () => {
  const defaultInput: FKValidationHookInput = {
    childTable: 'orders',
    childColumn: 'user_id',
    parentTable: 'users',
    parentColumn: 'id',
    isActive: false,
  }

  const mockParentTableInfo: TableInfo = {
    name: 'users',
    isView: false,
    isVirtual: false,
    withoutRowid: false,
    columns: [
      { cid: 0, name: 'id', type: 'INTEGER', notnull: true, dfltValue: null, pk: 1, generated: null, hidden: false },
      { cid: 1, name: 'email', type: 'TEXT', notnull: false, dfltValue: null, pk: 0, generated: null, hidden: false },
    ],
    indexes: [],
    createSql: 'CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT)',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetTableInfo.mockResolvedValue(mockParentTableInfo)
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  it('does not run validation when isActive is false', async () => {
    renderHook(() => useFKValidation(defaultInput))

    // Wait a tick
    await new Promise((r) => setTimeout(r, 10))

    expect(mockGetTableInfo).not.toHaveBeenCalled()
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('runs validation when isActive becomes true', async () => {
    mockQuery
      // Row count query for isLargeTable check
      .mockResolvedValueOnce({
        columns: ['COUNT(*)'],
        rows: [[100]],
      })
      // Violation count query
      .mockResolvedValueOnce({
        columns: ['violation_count'],
        rows: [[0]],
      })

    const { rerender } = renderHook(
      (props: FKValidationHookInput) => useFKValidation(props),
      { initialProps: defaultInput }
    )

    rerender({ ...defaultInput, isActive: true })

    await waitFor(() => {
      expect(mockGetTableInfo).toHaveBeenCalledWith('users')
    })
  })

  describe('Parent column uniqueness validation', () => {
    it('returns valid for single-column PK parent', async () => {
      mockQuery
        // Row count query for isLargeTable check
        .mockResolvedValueOnce({
          columns: ['COUNT(*)'],
          rows: [[100]],
        })
        // Violation count query
        .mockResolvedValueOnce({
          columns: ['violation_count'],
          rows: [[0]],
        })

      const { result, rerender } = renderHook(
        (props: FKValidationHookInput) => useFKValidation(props),
        { initialProps: defaultInput }
      )

      rerender({ ...defaultInput, isActive: true })

      await waitFor(() => {
        expect(result.current.isValidating).toBe(false)
      })

      expect(result.current.uniquenessResult?.isValid).toBe(true)
      expect(result.current.uniquenessResult?.isSingleColumnPK).toBe(true)
    })

    it('returns invalid for composite PK parent column', async () => {
      const compositePkTable: TableInfo = {
        ...mockParentTableInfo,
        columns: [
          { cid: 0, name: 'user_id', type: 'INTEGER', notnull: true, dfltValue: null, pk: 1, generated: null, hidden: false },
          { cid: 1, name: 'role_id', type: 'INTEGER', notnull: true, dfltValue: null, pk: 2, generated: null, hidden: false },
        ],
      }
      mockGetTableInfo.mockResolvedValue(compositePkTable)

      const { result, rerender } = renderHook(
        (props: FKValidationHookInput) => useFKValidation(props),
        { initialProps: defaultInput }
      )

      rerender({
        ...defaultInput,
        parentColumn: 'user_id',
        isActive: true,
      })

      await waitFor(() => {
        expect(result.current.isValidating).toBe(false)
      })

      expect(result.current.uniquenessResult?.isValid).toBe(false)
      expect(result.current.uniquenessResult?.isPartOfCompositePK).toBe(true)
    })

    it('returns valid for column with single-column UNIQUE index', async () => {
      const tableWithUnique: TableInfo = {
        ...mockParentTableInfo,
        indexes: [
          { name: 'idx_email', unique: true, columns: ['email'], partial: false, createSql: null },
        ],
      }
      mockGetTableInfo.mockResolvedValue(tableWithUnique)
      mockQuery
        // Row count query for isLargeTable check
        .mockResolvedValueOnce({
          columns: ['COUNT(*)'],
          rows: [[100]],
        })
        // Violation count query
        .mockResolvedValueOnce({
          columns: ['violation_count'],
          rows: [[0]],
        })

      const { result, rerender } = renderHook(
        (props: FKValidationHookInput) => useFKValidation(props),
        { initialProps: defaultInput }
      )

      rerender({
        ...defaultInput,
        parentColumn: 'email',
        isActive: true,
      })

      await waitFor(() => {
        expect(result.current.isValidating).toBe(false)
      })

      expect(result.current.uniquenessResult?.isValid).toBe(true)
      expect(result.current.uniquenessResult?.hasSingleColumnUniqueIndex).toBe(true)
    })
  })

  describe('Data integrity validation', () => {
    it('reports no violations when data is valid', async () => {
      mockQuery
        // Row count query for isLargeTable check
        .mockResolvedValueOnce({
          columns: ['COUNT(*)'],
          rows: [[100]],
        })
        // Violation count query
        .mockResolvedValueOnce({
          columns: ['violation_count'],
          rows: [[0]],
        })

      const { result, rerender } = renderHook(
        (props: FKValidationHookInput) => useFKValidation(props),
        { initialProps: defaultInput }
      )

      rerender({ ...defaultInput, isActive: true })

      await waitFor(() => {
        expect(result.current.isValidating).toBe(false)
      })

      expect(result.current.integrityResult?.isValid).toBe(true)
      expect(result.current.integrityResult?.violationCount).toBe(0)
    })

    it('reports violations when orphan rows exist', async () => {
      mockQuery
        // Row count query for isLargeTable check
        .mockResolvedValueOnce({
          columns: ['COUNT(*)'],
          rows: [[100]],
        })
        // Violation count query
        .mockResolvedValueOnce({
          columns: ['violation_count'],
          rows: [[5]],
        })
        // Sample violations query
        .mockResolvedValueOnce({
          columns: ['order_id', 'user_id'],
          rows: [
            [1, 999],
            [2, 888],
          ],
        })

      const { result, rerender } = renderHook(
        (props: FKValidationHookInput) => useFKValidation(props),
        { initialProps: defaultInput }
      )

      rerender({ ...defaultInput, isActive: true })

      await waitFor(() => {
        expect(result.current.isValidating).toBe(false)
      })

      expect(result.current.integrityResult?.isValid).toBe(false)
      expect(result.current.integrityResult?.violationCount).toBe(5)
      expect(result.current.integrityResult?.sampleViolations.length).toBe(2)
    })

    it('skips data validation when parent column uniqueness fails', async () => {
      mockGetTableInfo.mockResolvedValue({
        ...mockParentTableInfo,
        columns: [
          { cid: 0, name: 'id', type: 'INTEGER', notnull: true, dfltValue: null, pk: 0, generated: null, hidden: false },
        ],
        indexes: [],
      })

      const { result, rerender } = renderHook(
        (props: FKValidationHookInput) => useFKValidation(props),
        { initialProps: defaultInput }
      )

      rerender({ ...defaultInput, isActive: true })

      await waitFor(() => {
        expect(result.current.isValidating).toBe(false)
      })

      // Data validation should be skipped
      expect(mockQuery).not.toHaveBeenCalled()
      expect(result.current.integrityResult).toBeNull()
    })
  })

  describe('Create unique index', () => {
    it('provides createUniqueIndex function when canCreateUniqueIndex is true', async () => {
      mockGetTableInfo.mockResolvedValue({
        ...mockParentTableInfo,
        columns: [
          { cid: 0, name: 'id', type: 'INTEGER', notnull: true, dfltValue: null, pk: 0, generated: null, hidden: false },
        ],
        indexes: [],
      })

      const { result, rerender } = renderHook(
        (props: FKValidationHookInput) => useFKValidation(props),
        { initialProps: defaultInput }
      )

      rerender({ ...defaultInput, isActive: true })

      await waitFor(() => {
        expect(result.current.isValidating).toBe(false)
      })

      expect(result.current.uniquenessResult?.canCreateUniqueIndex).toBe(true)
      expect(typeof result.current.createUniqueIndex).toBe('function')
    })

    it('createUniqueIndex executes DDL and reruns validation', async () => {
      mockGetTableInfo.mockResolvedValue({
        ...mockParentTableInfo,
        columns: [
          { cid: 0, name: 'id', type: 'INTEGER', notnull: true, dfltValue: null, pk: 0, generated: null, hidden: false },
        ],
        indexes: [],
      })
      mockExec.mockResolvedValue({ rowsAffected: 0 })

      const { result, rerender } = renderHook(
        (props: FKValidationHookInput) => useFKValidation(props),
        { initialProps: defaultInput }
      )

      rerender({ ...defaultInput, isActive: true })

      await waitFor(() => {
        expect(result.current.isValidating).toBe(false)
      })

      // Now create the index
      mockGetTableInfo.mockResolvedValue({
        ...mockParentTableInfo,
        indexes: [
          { name: 'idx_users_id_unique', unique: true, columns: ['id'], partial: false, createSql: null },
        ],
      })
      mockQuery
        // Row count query for isLargeTable check
        .mockResolvedValueOnce({
          columns: ['COUNT(*)'],
          rows: [[100]],
        })
        // Violation count query
        .mockResolvedValueOnce({
          columns: ['violation_count'],
          rows: [[0]],
        })

      await act(async () => {
        await result.current.createUniqueIndex?.()
      })

      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('CREATE UNIQUE INDEX')
      )
    })

    it('returns createUniqueIndexDDL for preview', async () => {
      mockGetTableInfo.mockResolvedValue({
        ...mockParentTableInfo,
        columns: [
          { cid: 0, name: 'email', type: 'TEXT', notnull: false, dfltValue: null, pk: 0, generated: null, hidden: false },
        ],
        indexes: [],
      })

      const { result, rerender } = renderHook(
        (props: FKValidationHookInput) => useFKValidation(props),
        { initialProps: defaultInput }
      )

      rerender({ ...defaultInput, parentColumn: 'email', isActive: true })

      await waitFor(() => {
        expect(result.current.isValidating).toBe(false)
      })

      expect(result.current.createUniqueIndexDDL).toContain('CREATE UNIQUE INDEX')
      expect(result.current.createUniqueIndexDDL).toContain('email')
    })
  })

  describe('Progress and cancellation', () => {
    it('sets isValidating to true during validation', async () => {
      let resolveQuery: (value: QueryResult) => void
      mockQuery.mockReturnValue(
        new Promise((resolve) => {
          resolveQuery = resolve
        })
      )

      const { result, rerender } = renderHook(
        (props: FKValidationHookInput) => useFKValidation(props),
        { initialProps: defaultInput }
      )

      rerender({ ...defaultInput, isActive: true })

      await waitFor(() => {
        expect(result.current.isValidating).toBe(true)
      })

      await act(async () => {
        resolveQuery!({ columns: ['violation_count'], rows: [[0]] })
      })

      await waitFor(() => {
        expect(result.current.isValidating).toBe(false)
      })
    })

    it('provides cancel function that aborts validation', async () => {
      let resolveQuery: (value: QueryResult) => void
      mockQuery.mockReturnValue(
        new Promise((resolve) => {
          resolveQuery = resolve
        })
      )

      const { result, rerender } = renderHook(
        (props: FKValidationHookInput) => useFKValidation(props),
        { initialProps: defaultInput }
      )

      rerender({ ...defaultInput, isActive: true })

      await waitFor(() => {
        expect(result.current.isValidating).toBe(true)
      })

      act(() => {
        result.current.cancel()
      })

      expect(result.current.isCancelled).toBe(true)

      // Clean up the pending promise
      await act(async () => {
        resolveQuery!({ columns: ['violation_count'], rows: [[0]] })
      })
    })

    it('resets state when isActive becomes false', async () => {
      mockQuery
        // Row count query for isLargeTable check
        .mockResolvedValueOnce({
          columns: ['COUNT(*)'],
          rows: [[100]],
        })
        // Violation count query
        .mockResolvedValueOnce({
          columns: ['violation_count'],
          rows: [[0]],
        })

      const { result, rerender } = renderHook(
        (props: FKValidationHookInput) => useFKValidation(props),
        { initialProps: defaultInput }
      )

      rerender({ ...defaultInput, isActive: true })

      await waitFor(() => {
        expect(result.current.isValidating).toBe(false)
        expect(result.current.uniquenessResult).not.toBeNull()
      })

      rerender({ ...defaultInput, isActive: false })

      await waitFor(() => {
        expect(result.current.uniquenessResult).toBeNull()
        expect(result.current.integrityResult).toBeNull()
      })
    })
  })

  describe('Error handling', () => {
    it('sets error state when validation fails', async () => {
      mockGetTableInfo.mockRejectedValue(new Error('Database error'))

      const { result, rerender } = renderHook(
        (props: FKValidationHookInput) => useFKValidation(props),
        { initialProps: defaultInput }
      )

      rerender({ ...defaultInput, isActive: true })

      await waitFor(() => {
        expect(result.current.isValidating).toBe(false)
      })

      expect(result.current.error).toBe('Database error')
    })
  })
})
