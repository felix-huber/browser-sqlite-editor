/**
 * Row UPDATE SQL generation with rowid/PK targeting
 *
 * Generates UPDATE statements that target specific rows via:
 * - rowid for regular tables
 * - Primary key columns for WITHOUT ROWID tables (including composite PKs)
 *
 * Handles NULL values correctly using IS NULL in WHERE clauses.
 */

import { quoteIdentifier } from '../core/db/ddl'
import type { ColumnInfo, TableInfo } from '../types'

/**
 * Error thrown when attempting to update a generated column
 */
export class GeneratedColumnError extends Error {
  constructor(columnName: string) {
    super(`Cannot update generated column: ${columnName}`)
    this.name = 'GeneratedColumnError'
  }
}

/**
 * Error thrown when a column doesn't exist in the table
 */
export class ColumnNotFoundError extends Error {
  constructor(columnName: string, tableName: string) {
    super(`Column '${columnName}' not found in table '${tableName}'`)
    this.name = 'ColumnNotFoundError'
  }
}

/**
 * Primary key value for WHERE clause targeting.
 * For rowid tables, this is the rowid value.
 * For WITHOUT ROWID tables, this is a map of PK column names to values.
 */
export type PrimaryKeyValue =
  | { type: 'rowid'; rowid: number | bigint }
  | { type: 'pk'; columns: Map<string, unknown> }

/**
 * Options for generating an UPDATE statement
 */
export interface UpdateOptions {
  /** Table name */
  tableName: string
  /** Column to update */
  columnName: string
  /** New value (null for SQL NULL) */
  newValue: unknown
  /** Primary key value for targeting the row */
  primaryKey: PrimaryKeyValue
  /** Table info for validation (optional but recommended) */
  tableInfo?: TableInfo
}

/**
 * Result of building an UPDATE statement
 */
export interface UpdateStatement {
  /** The SQL statement with ? placeholders */
  sql: string
  /** Parameter values in order */
  params: unknown[]
}

/**
 * Validates that a column can be updated.
 *
 * @param columnName - Name of the column to update
 * @param tableInfo - Table information for validation
 * @throws GeneratedColumnError if column is generated
 * @throws ColumnNotFoundError if column doesn't exist
 */
export function validateColumnForUpdate(
  columnName: string,
  tableInfo: TableInfo
): void {
  const column = tableInfo.columns.find((c) => c.name === columnName)

  if (!column) {
    throw new ColumnNotFoundError(columnName, tableInfo.name)
  }

  if (column.generated !== null) {
    throw new GeneratedColumnError(columnName)
  }
}

/**
 * Builds a WHERE clause condition for a single column.
 *
 * Handles NULL values by using IS NULL instead of = NULL.
 *
 * @param columnName - Column name (will be quoted if needed)
 * @param value - Value to match (null for IS NULL)
 * @returns Object with sql fragment and param (if not null)
 */
function buildWhereCondition(
  columnName: string,
  value: unknown
): { sql: string; param?: unknown } {
  const quotedCol = quoteIdentifier(columnName)

  if (value === null) {
    return { sql: `${quotedCol} IS NULL` }
  }

  return { sql: `${quotedCol} = ?`, param: value }
}

/**
 * Builds the WHERE clause for targeting a specific row.
 *
 * @param primaryKey - Primary key value (rowid or PK columns)
 * @returns Object with WHERE clause (without "WHERE" keyword) and params
 */
function buildWhereClause(primaryKey: PrimaryKeyValue): {
  whereClause: string
  params: unknown[]
} {
  if (primaryKey.type === 'rowid') {
    return {
      whereClause: 'rowid = ?',
      params: [primaryKey.rowid],
    }
  }

  // WITHOUT ROWID table with PK columns
  const conditions: string[] = []
  const params: unknown[] = []

  primaryKey.columns.forEach((value, colName) => {
    const { sql, param } = buildWhereCondition(colName, value)
    conditions.push(sql)
    if (param !== undefined) {
      params.push(param)
    }
  })

  return {
    whereClause: conditions.join(' AND '),
    params,
  }
}

/**
 * Builds an UPDATE statement for a single cell change.
 *
 * @param options - Update options
 * @returns UPDATE statement with SQL and params
 * @throws GeneratedColumnError if column is generated
 * @throws ColumnNotFoundError if column doesn't exist (when tableInfo provided)
 *
 * @example
 * // Update with rowid targeting
 * const stmt = buildUpdateStatement({
 *   tableName: 'users',
 *   columnName: 'name',
 *   newValue: 'Alice',
 *   primaryKey: { type: 'rowid', rowid: 42 }
 * })
 * // stmt.sql: UPDATE users SET name = ? WHERE rowid = ?
 * // stmt.params: ['Alice', 42]
 *
 * @example
 * // Update to NULL in WITHOUT ROWID table
 * const stmt = buildUpdateStatement({
 *   tableName: 'kv',
 *   columnName: 'value',
 *   newValue: null,
 *   primaryKey: { type: 'pk', columns: new Map([['key', 'foo']]) }
 * })
 * // stmt.sql: UPDATE kv SET value = ? WHERE key = ?
 * // stmt.params: [null, 'foo']
 *
 * @example
 * // Update with NULL PK column
 * const stmt = buildUpdateStatement({
 *   tableName: 'data',
 *   columnName: 'status',
 *   newValue: 'active',
 *   primaryKey: { type: 'pk', columns: new Map([['id', null]]) }
 * })
 * // stmt.sql: UPDATE data SET status = ? WHERE id IS NULL
 * // stmt.params: ['active']
 */
export function buildUpdateStatement(options: UpdateOptions): UpdateStatement {
  const { tableName, columnName, newValue, primaryKey, tableInfo } = options

  // Validate column if tableInfo is provided
  if (tableInfo) {
    validateColumnForUpdate(columnName, tableInfo)
  }

  const quotedTable = quoteIdentifier(tableName)
  const quotedColumn = quoteIdentifier(columnName)

  // Build SET clause
  const setClause = `${quotedColumn} = ?`
  const setParams = [newValue]

  // Build WHERE clause
  const { whereClause, params: whereParams } = buildWhereClause(primaryKey)

  // Combine into full statement
  const sql = `UPDATE ${quotedTable} SET ${setClause} WHERE ${whereClause}`
  const params = [...setParams, ...whereParams]

  return { sql, params }
}

/**
 * Extracts primary key value from a row for use in UPDATE targeting.
 *
 * @param tableInfo - Table information
 * @param row - Row data as column-value pairs
 * @param rowid - The rowid value (for rowid tables)
 * @returns Primary key value for UPDATE targeting
 */
export function extractPrimaryKeyFromRow(
  tableInfo: TableInfo,
  row: Record<string, unknown>,
  rowid?: number | bigint
): PrimaryKeyValue {
  // For WITHOUT ROWID tables, extract PK columns
  if (tableInfo.withoutRowid) {
    const pkColumns = tableInfo.columns.filter((c) => c.pk > 0)
    const pkMap = new Map<string, unknown>()

    for (const col of pkColumns.sort((a, b) => a.pk - b.pk)) {
      pkMap.set(col.name, row[col.name])
    }

    return { type: 'pk', columns: pkMap }
  }

  // For regular tables, prefer rowid if provided
  if (rowid !== undefined) {
    return { type: 'rowid', rowid }
  }

  // Fall back to PK columns if no rowid (shouldn't happen for rowid tables)
  const pkColumns = tableInfo.columns.filter((c) => c.pk > 0)
  if (pkColumns.length > 0) {
    const pkMap = new Map<string, unknown>()
    for (const col of pkColumns.sort((a, b) => a.pk - b.pk)) {
      pkMap.set(col.name, row[col.name])
    }
    return { type: 'pk', columns: pkMap }
  }

  throw new Error('Cannot extract primary key: no rowid or PK columns found')
}

/**
 * Gets the primary key columns for a table.
 *
 * @param tableInfo - Table information
 * @returns Array of PK column info, sorted by pk order
 */
export function getPrimaryKeyColumns(tableInfo: TableInfo): ColumnInfo[] {
  return tableInfo.columns
    .filter((c) => c.pk > 0)
    .sort((a, b) => a.pk - b.pk)
}

/**
 * Checks if a table has a usable identifier for UPDATE/DELETE operations.
 *
 * - Regular tables always have rowid (even without explicit PK)
 * - WITHOUT ROWID tables require explicit PK columns
 * - Views and virtual tables cannot be reliably edited by row
 *
 * @param tableInfo - Table information
 * @returns true if rows can be uniquely identified for edits
 */
export function hasUsableIdentifier(tableInfo: TableInfo): boolean {
  // Views cannot be edited via rowid/PK
  if (tableInfo.isView) return false

  // Virtual tables don't support standard row identity
  if (tableInfo.isVirtual) return false

  // Regular tables always have rowid
  if (!tableInfo.withoutRowid) return true

  // WITHOUT ROWID tables need explicit PK columns
  const pkColumns = tableInfo.columns.filter((c) => c.pk > 0)
  return pkColumns.length > 0
}

/**
 * Builds a DELETE statement for a specific row.
 *
 * @param tableName - Table name
 * @param primaryKey - Primary key value for targeting the row
 * @returns DELETE statement with SQL and params
 */
export function buildDeleteStatement(
  tableName: string,
  primaryKey: PrimaryKeyValue
): { sql: string; params: unknown[] } {
  const quotedTable = quoteIdentifier(tableName)

  if (primaryKey.type === 'rowid') {
    return {
      sql: `DELETE FROM ${quotedTable} WHERE rowid = ?`,
      params: [primaryKey.rowid],
    }
  }

  // WITHOUT ROWID table with PK columns
  const { whereClause, params } = buildWhereClause(primaryKey)

  return {
    sql: `DELETE FROM ${quotedTable} WHERE ${whereClause}`,
    params,
  }
}
