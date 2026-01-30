/**
 * useFKValidation Hook
 *
 * Async validation hook for FK creation with:
 * - Parent column uniqueness validation
 * - Data integrity validation (orphan row detection)
 * - One-click UNIQUE index creation
 * - Progress indicator and cancellation support
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { getWorkerClient } from '../../../core/worker/client'
import {
  validateParentColumnUniqueness,
  buildDataIntegrityQuery,
  parseDataIntegrityResult,
  generateCreateUniqueIndexDDL,
  escapeIdentifier,
  type ParentColumnValidation,
  type DataIntegrityResult,
  type TableSchemaInfo,
} from '../FKValidation'
import type { TableInfo, QueryResult } from '../../../types'

// =============================================================================
// Types
// =============================================================================

export interface FKValidationHookInput {
  childTable: string
  childColumn: string
  parentTable: string
  parentColumn: string
  /** Whether validation should run */
  isActive: boolean
  /** Optional: Skip data integrity check for large tables */
  skipDataIntegrity?: boolean
}

export interface FKValidationHookResult {
  /** Whether validation is in progress */
  isValidating: boolean
  /** Whether validation was cancelled */
  isCancelled: boolean
  /** Error message if validation failed */
  error: string | null
  /** Result of parent column uniqueness validation */
  uniquenessResult: ParentColumnValidation | null
  /** Result of data integrity validation */
  integrityResult: DataIntegrityResult | null
  /** DDL for creating a unique index (for preview) */
  createUniqueIndexDDL: string | null
  /** Function to create the unique index and re-validate */
  createUniqueIndex: (() => Promise<void>) | null
  /** Function to cancel ongoing validation */
  cancel: () => void
  /** Re-run validation */
  revalidate: () => void
  /** Whether we're validating a large table (>10k rows) - shows progress indicator */
  isLargeTable: boolean
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Convert TableInfo to TableSchemaInfo for validation
 */
function tableInfoToSchemaInfo(info: TableInfo): TableSchemaInfo {
  const pkColumns = info.columns
    .filter((col) => col.pk > 0)
    .sort((a, b) => a.pk - b.pk)
    .map((col) => col.name)

  return {
    name: info.name,
    columns: info.columns.map((col) => ({
      name: col.name,
      type: col.type,
      pk: col.pk,
      notnull: col.notnull,
    })),
    indexes: info.indexes.map((idx) => ({
      name: idx.name,
      unique: idx.unique,
      columns: idx.columns,
      partial: idx.partial,
    })),
    pkColumns,
  }
}

/**
 * Parse query result rows into Record objects
 */
function parseRows(result: QueryResult): Record<string, unknown>[] {
  return result.rows.map((row) => {
    const obj: Record<string, unknown> = {}
    result.columns.forEach((col, i) => {
      obj[col] = row[i]
    })
    return obj
  })
}

// =============================================================================
// Hook Implementation
// =============================================================================

export function useFKValidation(input: FKValidationHookInput): FKValidationHookResult {
  const {
    childTable,
    childColumn,
    parentTable,
    parentColumn,
    isActive,
    skipDataIntegrity = false,
  } = input

  const [isValidating, setIsValidating] = useState(false)
  const [isCancelled, setIsCancelled] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [uniquenessResult, setUniquenessResult] = useState<ParentColumnValidation | null>(null)
  const [integrityResult, setIntegrityResult] = useState<DataIntegrityResult | null>(null)
  const [isLargeTable, setIsLargeTable] = useState(false)

  // Use ref to track cancellation across async boundaries
  const cancelledRef = useRef(false)
  const validationIdRef = useRef(0)

  // Reset state when inactive
  useEffect(() => {
    if (!isActive) {
      setUniquenessResult(null)
      setIntegrityResult(null)
      setError(null)
      setIsCancelled(false)
      setIsLargeTable(false)
      cancelledRef.current = false
    }
  }, [isActive])

  // Main validation function
  const runValidation = useCallback(async () => {
    if (!isActive) return

    const currentValidationId = ++validationIdRef.current
    cancelledRef.current = false
    setIsCancelled(false)
    setIsValidating(true)
    setError(null)
    setUniquenessResult(null)
    setIntegrityResult(null)
    setIsLargeTable(false)

    try {
      const client = getWorkerClient()

      // Step 1: Get parent table info
      const parentInfo = await client.getTableInfo(parentTable)

      // Check if cancelled
      if (cancelledRef.current || currentValidationId !== validationIdRef.current) {
        return
      }

      // Step 2: Validate parent column uniqueness
      const schema = tableInfoToSchemaInfo(parentInfo)
      const uniquenessValidation = validateParentColumnUniqueness(schema, parentColumn)
      setUniquenessResult(uniquenessValidation)

      // If uniqueness fails, don't proceed with data integrity check
      if (!uniquenessValidation.isValid) {
        setIsValidating(false)
        return
      }

      // Step 3: Data integrity validation (skip if requested)
      if (skipDataIntegrity) {
        setIntegrityResult({ isValid: true, violationCount: 0, sampleViolations: [] })
        setIsValidating(false)
        return
      }

      // Check if cancelled
      if (cancelledRef.current || currentValidationId !== validationIdRef.current) {
        return
      }

      // Check child table row count for large table progress indicator
      const LARGE_TABLE_THRESHOLD = 10000
      const childRowCountResult = await client.query(
        `SELECT COUNT(*) FROM ${escapeIdentifier(childTable)}`,
        []
      )
      const childRowCount = (childRowCountResult.rows[0]?.[0] as number) ?? 0
      if (childRowCount > LARGE_TABLE_THRESHOLD) {
        setIsLargeTable(true)
      }

      // Check if cancelled after row count check
      if (cancelledRef.current || currentValidationId !== validationIdRef.current) {
        return
      }

      // Get count of violations first
      const countQuery = buildDataIntegrityQuery({
        childTable,
        childColumn,
        parentTable,
        parentColumn,
        mode: 'count',
      })

      const countResult = await client.query(countQuery, [])

      // Check if cancelled
      if (cancelledRef.current || currentValidationId !== validationIdRef.current) {
        return
      }

      const violationCount = (countResult.rows[0]?.[0] as number) ?? 0

      if (violationCount === 0) {
        setIntegrityResult({ isValid: true, violationCount: 0, sampleViolations: [] })
        setIsValidating(false)
        return
      }

      // Get sample rows if there are violations
      const sampleQuery = buildDataIntegrityQuery({
        childTable,
        childColumn,
        parentTable,
        parentColumn,
        mode: 'sample',
        limit: 10,
      })

      const sampleResult = await client.query(sampleQuery, [])

      // Check if cancelled
      if (cancelledRef.current || currentValidationId !== validationIdRef.current) {
        return
      }

      const sampleRows = parseRows(sampleResult)

      const integrity = parseDataIntegrityResult({ violationCount, sampleRows })
      setIntegrityResult(integrity)
      setIsValidating(false)
    } catch (err) {
      if (!cancelledRef.current && currentValidationId === validationIdRef.current) {
        setError(err instanceof Error ? err.message : String(err))
        setIsValidating(false)
      }
    }
  }, [isActive, childTable, childColumn, parentTable, parentColumn, skipDataIntegrity])

  // Run validation when active
  useEffect(() => {
    if (isActive) {
      void runValidation()
    }
  }, [isActive, runValidation])

  // Cancel function
  const cancel = useCallback(() => {
    cancelledRef.current = true
    setIsCancelled(true)
    setIsValidating(false)
  }, [])

  // Revalidate function
  const revalidate = useCallback(() => {
    void runValidation()
  }, [runValidation])

  // Create unique index function
  const createUniqueIndex = useCallback(async () => {
    if (!uniquenessResult?.canCreateUniqueIndex) return

    const ddl = generateCreateUniqueIndexDDL(parentTable, parentColumn)
    const client = getWorkerClient()

    await client.exec(ddl)

    // Re-run validation
    await runValidation()
  }, [uniquenessResult?.canCreateUniqueIndex, parentTable, parentColumn, runValidation])

  // DDL for preview
  const createUniqueIndexDDL =
    uniquenessResult?.canCreateUniqueIndex
      ? generateCreateUniqueIndexDDL(parentTable, parentColumn)
      : null

  return {
    isValidating,
    isCancelled,
    error,
    uniquenessResult,
    integrityResult,
    createUniqueIndexDDL,
    createUniqueIndex: uniquenessResult?.canCreateUniqueIndex ? createUniqueIndex : null,
    cancel,
    revalidate,
    isLargeTable,
  }
}

export default useFKValidation
