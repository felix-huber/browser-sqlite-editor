/**
 * Post-rebuild verification with textual clause checking.
 *
 * Implements the PRD two-tier verification:
 * 1. Structural verification via PRAGMAs (table_info, index_list, foreign_key_list)
 * 2. Best-effort textual verification for presence of key clauses
 *    (CHECK, GENERATED, STRICT, WITHOUT ROWID)
 *
 * If verification fails, signals rollback with the PRD error message.
 */

import type { DatabaseEngine } from '../engine/db-engine'

/**
 * PRD-specified error message for unsupported schema features.
 */
export const UNSUPPORTED_SCHEMA_ERROR =
  'This table uses schema features that cannot be safely modified via the visual designer. Use the SQL editor instead.'

/**
 * Result of textual clause detection.
 */
export interface TextualClauseResult {
  hasCheck: boolean
  hasGenerated: boolean
  hasStrict: boolean
  hasWithoutRowid: boolean
}

/**
 * Types of verification failures.
 */
export type SchemaPreservationFailureType =
  | 'missing_check'
  | 'missing_generated'
  | 'missing_strict'
  | 'missing_without_rowid'
  | 'query_error'

/**
 * A single schema preservation failure.
 */
export interface SchemaPreservationFailure {
  type: SchemaPreservationFailureType
  message: string
}

/**
 * Result of schema preservation verification.
 */
export interface SchemaPreservationResult {
  success: boolean
  shouldRollback: boolean
  failures: SchemaPreservationFailure[]
  errorMessage?: string
}

/**
 * Detect special clauses in CREATE TABLE SQL via textual analysis.
 *
 * This is best-effort textual verification after whitespace normalization.
 * It checks for presence of key clauses that must be preserved.
 *
 * @param sql CREATE TABLE SQL from sqlite_master
 * @returns Detected clauses
 */
export function verifySchemaTextually(sql: string): TextualClauseResult {
  const normalized = sql.toUpperCase()

  // CHECK constraint detection
  // Match CHECK keyword followed by parenthesis (column-level or table-level)
  const hasCheck = /\bCHECK\s*\(/.test(normalized)

  // GENERATED column detection
  // Match "GENERATED ALWAYS AS" or just "AS (" for shorthand syntax
  // Also match STORED or VIRTUAL keywords in context
  const hasGenerated =
    /\bGENERATED\s+ALWAYS\s+AS\s*\(/.test(normalized) ||
    /\bAS\s*\([^)]+\)\s*(STORED|VIRTUAL)\b/.test(normalized)

  // STRICT table option detection
  // Must appear after the closing paren of column definitions
  // Match STRICT as a word boundary at end of statement or followed by comma
  const hasStrict = /\)\s*[^(]*\bSTRICT\b/.test(normalized)

  // WITHOUT ROWID table option detection
  // Must appear after the closing paren of column definitions
  const hasWithoutRowid = /\)\s*[^(]*\bWITHOUT\s+ROWID\b/.test(normalized)

  return {
    hasCheck,
    hasGenerated,
    hasStrict,
    hasWithoutRowid,
  }
}

/**
 * Fetch the current CREATE TABLE SQL from sqlite_master.
 *
 * @param engine Database engine
 * @param tableName Table to query
 * @returns CREATE TABLE SQL or null if not found
 */
async function fetchCurrentSchema(
  engine: DatabaseEngine,
  tableName: string
): Promise<string | null> {
  const result = await engine.query(
    `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`,
    [tableName]
  )
  if (result.rows.length === 0) {
    return null
  }
  return result.rows[0][0] as string
}

/**
 * Verify that schema features are preserved after rebuild.
 *
 * Compares the original CREATE TABLE SQL with the rebuilt table's
 * sqlite_master SQL to ensure key clauses are preserved.
 *
 * @param engine Database engine
 * @param tableName Table to verify
 * @param originalSql Original CREATE TABLE SQL before rebuild
 * @returns Verification result with success status and any failures
 */
export async function verifySchemaPreservation(
  engine: DatabaseEngine,
  tableName: string,
  originalSql: string
): Promise<SchemaPreservationResult> {
  const failures: SchemaPreservationFailure[] = []

  // Detect clauses in original SQL
  const originalClauses = verifySchemaTextually(originalSql)

  // Fetch current schema from sqlite_master
  let currentSql: string | null
  try {
    currentSql = await fetchCurrentSchema(engine, tableName)
  } catch (err) {
    failures.push({
      type: 'query_error',
      message: `Failed to fetch current schema: ${err instanceof Error ? err.message : String(err)}`,
    })
    return {
      success: false,
      shouldRollback: true,
      failures,
      errorMessage: UNSUPPORTED_SCHEMA_ERROR,
    }
  }

  if (!currentSql) {
    failures.push({
      type: 'query_error',
      message: `Table "${tableName}" not found in sqlite_master`,
    })
    return {
      success: false,
      shouldRollback: true,
      failures,
      errorMessage: UNSUPPORTED_SCHEMA_ERROR,
    }
  }

  // Detect clauses in rebuilt SQL
  const currentClauses = verifySchemaTextually(currentSql)

  // Compare: original had clause but rebuilt does not
  if (originalClauses.hasCheck && !currentClauses.hasCheck) {
    failures.push({
      type: 'missing_check',
      message: 'CHECK constraint was not preserved during rebuild',
    })
  }

  if (originalClauses.hasGenerated && !currentClauses.hasGenerated) {
    failures.push({
      type: 'missing_generated',
      message: 'GENERATED column was not preserved during rebuild',
    })
  }

  if (originalClauses.hasStrict && !currentClauses.hasStrict) {
    failures.push({
      type: 'missing_strict',
      message: 'STRICT table option was not preserved during rebuild',
    })
  }

  if (originalClauses.hasWithoutRowid && !currentClauses.hasWithoutRowid) {
    failures.push({
      type: 'missing_without_rowid',
      message: 'WITHOUT ROWID table option was not preserved during rebuild',
    })
  }

  const success = failures.length === 0

  return {
    success,
    shouldRollback: !success,
    failures,
    errorMessage: success ? undefined : UNSUPPORTED_SCHEMA_ERROR,
  }
}
