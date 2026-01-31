import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import {
  useFKCreate,
  FK_ACTIONS,
  DEFAULT_FK_ACTION,
  type FKCreateConfig,
} from '../useFKCreate'

describe('useFKCreate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('initialization', () => {
    it('initializes with default NO ACTION values', () => {
      const { result } = renderHook(() => useFKCreate())

      expect(result.current.onDelete).toBe('NO ACTION')
      expect(result.current.onUpdate).toBe('NO ACTION')
      expect(result.current.isCreating).toBe(false)
      expect(result.current.error).toBeNull()
    })

    it('accepts initial action values', () => {
      const { result } = renderHook(() =>
        useFKCreate({
          initialOnDelete: 'CASCADE',
          initialOnUpdate: 'SET NULL',
        })
      )

      expect(result.current.onDelete).toBe('CASCADE')
      expect(result.current.onUpdate).toBe('SET NULL')
    })
  })

  describe('FK_ACTIONS constant', () => {
    it('includes NO ACTION, RESTRICT, CASCADE, SET NULL', () => {
      expect(FK_ACTIONS).toContain('NO ACTION')
      expect(FK_ACTIONS).toContain('RESTRICT')
      expect(FK_ACTIONS).toContain('CASCADE')
      expect(FK_ACTIONS).toContain('SET NULL')
    })

    it('excludes SET DEFAULT per PRD US-004', () => {
      expect(FK_ACTIONS).not.toContain('SET DEFAULT')
    })

    it('has exactly 4 actions', () => {
      expect(FK_ACTIONS).toHaveLength(4)
    })
  })

  describe('DEFAULT_FK_ACTION constant', () => {
    it('is NO ACTION per PRD US-004', () => {
      expect(DEFAULT_FK_ACTION).toBe('NO ACTION')
    })
  })

  describe('action setters', () => {
    it('allows setting ON DELETE action', () => {
      const { result } = renderHook(() => useFKCreate())

      act(() => {
        result.current.setOnDelete('CASCADE')
      })

      expect(result.current.onDelete).toBe('CASCADE')
    })

    it('allows setting ON UPDATE action', () => {
      const { result } = renderHook(() => useFKCreate())

      act(() => {
        result.current.setOnUpdate('RESTRICT')
      })

      expect(result.current.onUpdate).toBe('RESTRICT')
    })

    it('allows setting both actions independently', () => {
      const { result } = renderHook(() => useFKCreate())

      act(() => {
        result.current.setOnDelete('CASCADE')
        result.current.setOnUpdate('SET NULL')
      })

      expect(result.current.onDelete).toBe('CASCADE')
      expect(result.current.onUpdate).toBe('SET NULL')
    })
  })

  describe('availableActions', () => {
    it('returns FK_ACTIONS array', () => {
      const { result } = renderHook(() => useFKCreate())

      expect(result.current.availableActions).toBe(FK_ACTIONS)
      expect(result.current.availableActions).toHaveLength(4)
    })
  })

  describe('createFK', () => {
    it('calls onCreateFK with full config', async () => {
      const onCreateFK = vi.fn().mockResolvedValue(true)
      const { result } = renderHook(() => useFKCreate({ onCreateFK }))

      act(() => {
        result.current.setOnDelete('CASCADE')
        result.current.setOnUpdate('RESTRICT')
      })

      let success: boolean = false
      await act(async () => {
        success = await result.current.createFK(
          'orders',
          'user_id',
          'users',
          'id'
        )
      })

      expect(success).toBe(true)
      expect(onCreateFK).toHaveBeenCalledWith({
        childTable: 'orders',
        childColumn: 'user_id',
        parentTable: 'users',
        parentColumn: 'id',
        onDelete: 'CASCADE',
        onUpdate: 'RESTRICT',
      } satisfies FKCreateConfig)
    })

    it('uses default NO ACTION values when not changed', async () => {
      const onCreateFK = vi.fn().mockResolvedValue(true)
      const { result } = renderHook(() => useFKCreate({ onCreateFK }))

      await act(async () => {
        await result.current.createFK('orders', 'user_id', 'users', 'id')
      })

      expect(onCreateFK).toHaveBeenCalledWith(
        expect.objectContaining({
          onDelete: 'NO ACTION',
          onUpdate: 'NO ACTION',
        })
      )
    })

    it('sets isCreating to true during creation', async () => {
      let resolveCreate: (value: boolean) => void
      const onCreateFK = vi.fn().mockReturnValue(
        new Promise<boolean>((resolve) => {
          resolveCreate = resolve
        })
      )
      const { result } = renderHook(() => useFKCreate({ onCreateFK }))

      let createPromise: Promise<boolean>
      act(() => {
        createPromise = result.current.createFK(
          'orders',
          'user_id',
          'users',
          'id'
        )
      })

      expect(result.current.isCreating).toBe(true)

      await act(async () => {
        resolveCreate!(true)
        await createPromise!
      })

      expect(result.current.isCreating).toBe(false)
    })

    it('resets state on successful creation', async () => {
      const onCreateFK = vi.fn().mockResolvedValue(true)
      const { result } = renderHook(() => useFKCreate({ onCreateFK }))

      act(() => {
        result.current.setOnDelete('CASCADE')
        result.current.setOnUpdate('SET NULL')
      })

      await act(async () => {
        await result.current.createFK('orders', 'user_id', 'users', 'id')
      })

      expect(result.current.onDelete).toBe('NO ACTION')
      expect(result.current.onUpdate).toBe('NO ACTION')
    })

    it('does not reset state on failed creation', async () => {
      const onCreateFK = vi.fn().mockResolvedValue(false)
      const { result } = renderHook(() => useFKCreate({ onCreateFK }))

      act(() => {
        result.current.setOnDelete('CASCADE')
        result.current.setOnUpdate('SET NULL')
      })

      await act(async () => {
        await result.current.createFK('orders', 'user_id', 'users', 'id')
      })

      expect(result.current.onDelete).toBe('CASCADE')
      expect(result.current.onUpdate).toBe('SET NULL')
    })

    it('returns false and sets error when no handler provided', async () => {
      const { result } = renderHook(() => useFKCreate())

      let success: boolean = true
      await act(async () => {
        success = await result.current.createFK(
          'orders',
          'user_id',
          'users',
          'id'
        )
      })

      expect(success).toBe(false)
      expect(result.current.error).toBe('No creation handler provided')
    })

    it('sets error on exception', async () => {
      const onCreateFK = vi.fn().mockRejectedValue(new Error('Database error'))
      const { result } = renderHook(() => useFKCreate({ onCreateFK }))

      let success: boolean = true
      await act(async () => {
        success = await result.current.createFK(
          'orders',
          'user_id',
          'users',
          'id'
        )
      })

      expect(success).toBe(false)
      expect(result.current.error).toBe('Database error')
    })

    it('clears error on new creation attempt', async () => {
      const onCreateFK = vi.fn()
        .mockRejectedValueOnce(new Error('First error'))
        .mockResolvedValueOnce(true)
      const { result } = renderHook(() => useFKCreate({ onCreateFK }))

      await act(async () => {
        await result.current.createFK('orders', 'user_id', 'users', 'id')
      })

      expect(result.current.error).toBe('First error')

      await act(async () => {
        await result.current.createFK('orders', 'user_id', 'users', 'id')
      })

      expect(result.current.error).toBeNull()
    })
  })

  describe('reset', () => {
    it('resets all state to defaults', () => {
      const { result } = renderHook(() => useFKCreate())

      act(() => {
        result.current.setOnDelete('CASCADE')
        result.current.setOnUpdate('SET NULL')
      })

      act(() => {
        result.current.reset()
      })

      expect(result.current.onDelete).toBe('NO ACTION')
      expect(result.current.onUpdate).toBe('NO ACTION')
      expect(result.current.isCreating).toBe(false)
      expect(result.current.error).toBeNull()
    })
  })

  describe('integration: FK creation with CASCADE ON DELETE', () => {
    it('creates FK with CASCADE ON DELETE and verifies config', async () => {
      const onCreateFK = vi.fn().mockResolvedValue(true)
      const { result } = renderHook(() => useFKCreate({ onCreateFK }))

      // User selects CASCADE ON DELETE
      act(() => {
        result.current.setOnDelete('CASCADE')
      })

      // User clicks Create
      await act(async () => {
        await result.current.createFK('orders', 'user_id', 'users', 'id')
      })

      // Verify the handler was called with CASCADE
      expect(onCreateFK).toHaveBeenCalledWith(
        expect.objectContaining({
          childTable: 'orders',
          childColumn: 'user_id',
          parentTable: 'users',
          parentColumn: 'id',
          onDelete: 'CASCADE',
          onUpdate: 'NO ACTION',
        })
      )
    })
  })

  describe('integration: FK edit with changed ON DELETE', () => {
    it('supports editing FK by setting new action values', async () => {
      const onCreateFK = vi.fn().mockResolvedValue(true)
      // Simulating an edit scenario: start with pre-populated values
      const { result } = renderHook(() =>
        useFKCreate({
          initialOnDelete: 'NO ACTION',
          initialOnUpdate: 'NO ACTION',
          onCreateFK,
        })
      )

      // User edits ON DELETE from NO ACTION to CASCADE
      act(() => {
        result.current.setOnDelete('CASCADE')
      })

      // User saves
      await act(async () => {
        await result.current.createFK('orders', 'user_id', 'users', 'id')
      })

      // Verify the handler was called with updated value
      expect(onCreateFK).toHaveBeenCalledWith(
        expect.objectContaining({
          onDelete: 'CASCADE',
        })
      )
    })
  })
})
