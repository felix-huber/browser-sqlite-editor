/**
 * useFKCreate Hook
 *
 * Manages FK creation state and operations for the FK creation dialog.
 * Combines validation (from useFKValidation) with actual FK creation logic.
 *
 * Features:
 * - ON DELETE/UPDATE action configuration (defaults to NO ACTION)
 * - Integration with useFKValidation for async validation
 * - DDL generation and execution via table rebuild
 * - Error handling and loading states
 */

import { useState, useCallback } from 'react'
import type { ForeignKeyAction } from '../../../types/index'

/**
 * Available FK actions per PRD US-004.
 * SET DEFAULT is excluded as it requires DEFAULT value configuration.
 */
export const FK_ACTIONS: readonly ForeignKeyAction[] = [
  'NO ACTION',
  'RESTRICT',
  'CASCADE',
  'SET NULL',
] as const

/**
 * Default FK action per PRD US-004.
 */
export const DEFAULT_FK_ACTION: ForeignKeyAction = 'NO ACTION'

/**
 * FK creation configuration
 */
export interface FKCreateConfig {
  /** Child table (contains the FK column) */
  childTable: string
  /** Child column (the FK column) */
  childColumn: string
  /** Parent table (referenced table) */
  parentTable: string
  /** Parent column (referenced column) */
  parentColumn: string
  /** ON DELETE action */
  onDelete: ForeignKeyAction
  /** ON UPDATE action */
  onUpdate: ForeignKeyAction
}

/**
 * Input for the useFKCreate hook
 */
export interface UseFKCreateInput {
  /** Initial child table */
  childTable?: string
  /** Initial child column */
  childColumn?: string
  /** Initial parent table */
  parentTable?: string
  /** Initial parent column */
  parentColumn?: string
  /** Initial ON DELETE action (defaults to NO ACTION) */
  initialOnDelete?: ForeignKeyAction
  /** Initial ON UPDATE action (defaults to NO ACTION) */
  initialOnUpdate?: ForeignKeyAction
  /** Callback to execute FK creation (table rebuild) */
  onCreateFK?: (config: FKCreateConfig) => Promise<boolean>
}

/**
 * Result of the useFKCreate hook
 */
export interface UseFKCreateResult {
  /** Current ON DELETE action */
  onDelete: ForeignKeyAction
  /** Current ON UPDATE action */
  onUpdate: ForeignKeyAction
  /** Set ON DELETE action */
  setOnDelete: (action: ForeignKeyAction) => void
  /** Set ON UPDATE action */
  setOnUpdate: (action: ForeignKeyAction) => void
  /** Whether FK creation is in progress */
  isCreating: boolean
  /** Error from creation attempt */
  error: string | null
  /** Create the FK with current configuration */
  createFK: (
    childTable: string,
    childColumn: string,
    parentTable: string,
    parentColumn: string
  ) => Promise<boolean>
  /** Reset state to defaults */
  reset: () => void
  /** Available FK actions for dropdowns */
  availableActions: readonly ForeignKeyAction[]
}

/**
 * Hook for managing FK creation state and operations.
 *
 * Usage:
 * ```tsx
 * const {
 *   onDelete,
 *   onUpdate,
 *   setOnDelete,
 *   setOnUpdate,
 *   isCreating,
 *   createFK,
 *   availableActions,
 * } = useFKCreate({
 *   onCreateFK: async (config) => {
 *     // Perform table rebuild with new FK
 *     return true
 *   },
 * })
 * ```
 */
export function useFKCreate(input: UseFKCreateInput = {}): UseFKCreateResult {
  const {
    initialOnDelete = DEFAULT_FK_ACTION,
    initialOnUpdate = DEFAULT_FK_ACTION,
    onCreateFK,
  } = input

  const [onDelete, setOnDelete] = useState<ForeignKeyAction>(initialOnDelete)
  const [onUpdate, setOnUpdate] = useState<ForeignKeyAction>(initialOnUpdate)
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reset = useCallback(() => {
    setOnDelete(DEFAULT_FK_ACTION)
    setOnUpdate(DEFAULT_FK_ACTION)
    setIsCreating(false)
    setError(null)
  }, [])

  const createFK = useCallback(
    async (
      childTable: string,
      childColumn: string,
      parentTable: string,
      parentColumn: string
    ): Promise<boolean> => {
      if (!onCreateFK) {
        setError('No creation handler provided')
        return false
      }

      setIsCreating(true)
      setError(null)

      try {
        const config: FKCreateConfig = {
          childTable,
          childColumn,
          parentTable,
          parentColumn,
          onDelete,
          onUpdate,
        }

        const success = await onCreateFK(config)

        if (success) {
          reset()
        }

        return success
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        setError(message)
        return false
      } finally {
        setIsCreating(false)
      }
    },
    [onCreateFK, onDelete, onUpdate, reset]
  )

  return {
    onDelete,
    onUpdate,
    setOnDelete,
    setOnUpdate,
    isCreating,
    error,
    createFK,
    reset,
    availableActions: FK_ACTIONS,
  }
}

export default useFKCreate
