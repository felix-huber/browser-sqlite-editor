/**
 * useFKPreview Hook
 *
 * Generates DDL diff preview data for FK operations (create/edit/delete).
 * Used by FKPreviewModal to show before/after DDL with rebuild warning.
 *
 * Features:
 * - Generates original/proposed CREATE TABLE SQL for FK changes
 * - Shows FK clause modifications in child table
 * - Includes rebuild warning (FK changes require child table rebuild)
 * - Integrates with shared DDLDiffPreview component
 */

import { useState, useEffect, useMemo, useCallback } from 'react'
import { getWorkerClient } from '../../../core/worker/client'
import type { ForeignKeyAction, ForeignKeyInfo, TableInfo } from '../../../types'
import type { DependentObject } from '../../../shared/components/DDLDiffPreview'
import {
  createTable,
  type TableDefinition,
  type ColumnDefinition,
  type ForeignKeyConstraint,
} from '../../../core/db/ddl'

// =============================================================================
// Types
// =============================================================================

export type FKOperationType = 'create' | 'edit' | 'delete'

export interface FKOperationInfo {
  type: FKOperationType
  /** Child table (contains the FK) */
  childTable: string
  /** Child column */
  childColumn: string
  /** Parent table (referenced) */
  parentTable: string
  /** Parent column (referenced) */
  parentColumn: string
  /** Current ON DELETE action (for edit) */
  currentOnDelete?: ForeignKeyAction
  /** Current ON UPDATE action (for edit) */
  currentOnUpdate?: ForeignKeyAction
  /** New ON DELETE action (for create/edit) */
  newOnDelete?: ForeignKeyAction
  /** New ON UPDATE action (for create/edit) */
  newOnUpdate?: ForeignKeyAction
}

export interface FKPreviewData {
  /** Original CREATE TABLE SQL */
  originalSql: string
  /** Proposed CREATE TABLE SQL */
  proposedSql: string
  /** Dependent objects that will be affected */
  dependentObjects: DependentObject[]
  /** Summary of the change */
  netEffectSummary: string
  /** Whether data is loading */
  isLoading: boolean
  /** Error message if any */
  error: string | null
}

export interface UseFKPreviewInput {
  /** FK operation info */
  operation: FKOperationInfo | null
  /** Whether preview is active (dialog is open) */
  isActive: boolean
}

export interface UseFKPreviewResult extends FKPreviewData {
  /** Refresh the preview */
  refresh: () => void
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Converts TableInfo columns to ColumnDefinition array
 */
function tableInfoToColumns(tableInfo: TableInfo): ColumnDefinition[] {
  return tableInfo.columns.map((col) => ({
    name: col.name,
    type: col.type,
    notNull: col.notnull,
    defaultValue: col.dfltValue,
    primaryKey: col.pk > 0 ? col.pk : undefined,
    // Note: generatedAs expression not available from PRAGMA table_xinfo
    generatedType: col.generated || undefined,
  }))
}

/**
 * Converts ForeignKeyInfo array to ForeignKeyConstraint array
 */
function foreignKeysToConstraints(fks: ForeignKeyInfo[]): ForeignKeyConstraint[] {
  // Group by constraint ID
  const groups = new Map<number, ForeignKeyInfo[]>()
  for (const fk of fks) {
    const existing = groups.get(fk.id) || []
    existing.push(fk)
    groups.set(fk.id, existing)
  }

  const constraints: ForeignKeyConstraint[] = []
  for (const [, fkGroup] of groups) {
    const first = fkGroup[0]
    constraints.push({
      columns: fkGroup.map((f) => f.childColumn),
      references: first.parentTable,
      refColumns: fkGroup.map((f) => f.parentColumn),
      onDelete: first.onDelete,
      onUpdate: first.onUpdate,
    })
  }

  return constraints
}

/**
 * Generates CREATE TABLE SQL from TableInfo and ForeignKeyInfo
 */
function generateCreateTableSql(
  tableInfo: TableInfo,
  foreignKeys: ForeignKeyInfo[]
): string {
  const def: TableDefinition = {
    name: tableInfo.name,
    columns: tableInfoToColumns(tableInfo),
    foreignKeys: foreignKeysToConstraints(foreignKeys),
    withoutRowid: tableInfo.withoutRowid,
  }

  return createTable(def)
}

/**
 * Generates a summary for the FK operation
 */
function generateSummary(operation: FKOperationInfo): string {
  const fkRef = `${operation.childTable}.${operation.childColumn} → ${operation.parentTable}.${operation.parentColumn}`

  switch (operation.type) {
    case 'create':
      return `Add foreign key: ${fkRef}`
    case 'delete':
      return `Remove foreign key: ${fkRef}`
    case 'edit': {
      const changes: string[] = []
      if (operation.currentOnDelete !== operation.newOnDelete) {
        changes.push(`ON DELETE: ${operation.currentOnDelete} → ${operation.newOnDelete}`)
      }
      if (operation.currentOnUpdate !== operation.newOnUpdate) {
        changes.push(`ON UPDATE: ${operation.currentOnUpdate} → ${operation.newOnUpdate}`)
      }
      return changes.length > 0 ? changes.join('; ') : 'No changes'
    }
  }
}

// =============================================================================
// Hook Implementation
// =============================================================================

export function useFKPreview(input: UseFKPreviewInput): UseFKPreviewResult {
  const { operation, isActive } = input

  const [tableInfo, setTableInfo] = useState<TableInfo | null>(null)
  const [foreignKeys, setForeignKeys] = useState<ForeignKeyInfo[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refreshCounter, setRefreshCounter] = useState(0)

  // Fetch table info and foreign keys when active
  useEffect(() => {
    if (!isActive || !operation) {
      setTableInfo(null)
      setForeignKeys([])
      setError(null)
      return
    }

    let cancelled = false

    const fetchData = async () => {
      setIsLoading(true)
      setError(null)

      try {
        const client = getWorkerClient()

        // Fetch child table info
        const info = await client.getTableInfo(operation.childTable)

        if (cancelled) return
        setTableInfo(info)

        // Fetch foreign keys for the child table
        const allFKs = await client.getForeignKeys()

        if (cancelled) return

        // Filter to FKs from the child table
        const tableFKs = allFKs.filter(
          (fk) => fk.childTable.toLowerCase() === operation.childTable.toLowerCase()
        )
        setForeignKeys(tableFKs)

        setIsLoading(false)
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
        setIsLoading(false)
      }
    }

    void fetchData()

    return () => {
      cancelled = true
    }
  }, [isActive, operation, refreshCounter])

  // Compute original and proposed SQL
  const { originalSql, proposedSql, dependentObjects } = useMemo(() => {
    if (!tableInfo || !operation) {
      return { originalSql: '', proposedSql: '', dependentObjects: [] }
    }

    // Original SQL: current state
    const originalSql = generateCreateTableSql(tableInfo, foreignKeys)

    // Build proposed FK list based on operation
    let proposedFKs: ForeignKeyInfo[]

    switch (operation.type) {
      case 'create': {
        // Add new FK
        const newFK: ForeignKeyInfo = {
          id: Math.max(0, ...foreignKeys.map((fk) => fk.id)) + 1,
          childTable: operation.childTable,
          childColumn: operation.childColumn,
          parentTable: operation.parentTable,
          parentColumn: operation.parentColumn,
          onDelete: operation.newOnDelete || 'NO ACTION',
          onUpdate: operation.newOnUpdate || 'NO ACTION',
          match: 'NONE',
        }
        proposedFKs = [...foreignKeys, newFK]
        break
      }

      case 'delete': {
        // Remove matching FK
        proposedFKs = foreignKeys.filter(
          (fk) =>
            !(
              fk.childColumn.toLowerCase() === operation.childColumn.toLowerCase() &&
              fk.parentTable.toLowerCase() === operation.parentTable.toLowerCase() &&
              fk.parentColumn.toLowerCase() === operation.parentColumn.toLowerCase()
            )
        )
        break
      }

      case 'edit': {
        // Modify existing FK actions
        proposedFKs = foreignKeys.map((fk) => {
          if (
            fk.childColumn.toLowerCase() === operation.childColumn.toLowerCase() &&
            fk.parentTable.toLowerCase() === operation.parentTable.toLowerCase() &&
            fk.parentColumn.toLowerCase() === operation.parentColumn.toLowerCase()
          ) {
            return {
              ...fk,
              onDelete: operation.newOnDelete || fk.onDelete,
              onUpdate: operation.newOnUpdate || fk.onUpdate,
            }
          }
          return fk
        })
        break
      }
    }

    const proposedSql = generateCreateTableSql(tableInfo, proposedFKs)

    // Dependent objects: indexes and triggers on the child table will be recreated
    const deps: DependentObject[] = []

    // Add indexes from table info
    for (const idx of tableInfo.indexes) {
      // Skip auto-indexes, they'll be recreated automatically
      if (!idx.name.startsWith('sqlite_autoindex_')) {
        deps.push({ type: 'index', name: idx.name })
      }
    }

    // Add table itself as dependent (it will be rebuilt)
    deps.push({ type: 'table', name: tableInfo.name })

    return { originalSql, proposedSql, dependentObjects: deps }
  }, [tableInfo, foreignKeys, operation])

  // Compute summary
  const netEffectSummary = useMemo(() => {
    if (!operation) return ''
    const summary = generateSummary(operation)
    return `${summary}\n\nNote: Child table "${operation.childTable}" will be rebuilt.`
  }, [operation])

  const refresh = useCallback(() => {
    setRefreshCounter((c) => c + 1)
  }, [])

  return {
    originalSql,
    proposedSql,
    dependentObjects,
    netEffectSummary,
    isLoading,
    error,
    refresh,
  }
}

export default useFKPreview
