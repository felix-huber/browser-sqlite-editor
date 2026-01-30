/**
 * Schema Modification Operations for SQLite
 *
 * Provides worker handlers for DDL operations:
 * - createTable: Generate and execute CREATE TABLE DDL
 * - alterTable: Handle ALTER TABLE operations (addColumn, renameTable, renameColumn)
 * - dropTable: DROP TABLE with dependency checking
 * - dropColumn: Trigger table rebuild for column removal
 *
 * Safety features:
 * - All operations wrapped in transaction
 * - Validates table/column names (prevents SQL injection)
 * - Checks for dependent objects before drop
 * - Respects read-only mode
 */

import {
  quoteIdentifier,
  createTable as generateCreateTableDDL,
  alterTableAddColumn,
  alterTableRename,
  alterTableRenameColumn,
  alterTableDropColumn,
  type TableDefinition,
  type ColumnDefinition,
} from '../core/db/ddl'
import type { QueryResult, ForeignKeyInfo } from '../types'

// =============================================================================
// Types
// =============================================================================

/**
 * Query executor function type
 */
export type QueryExecutor = (sql: string, params?: unknown[]) => Promise<QueryResult>

/**
 * Result of schema modification operations
 */
export interface SchemaModificationResult {
  success: boolean
  error?: SchemaModificationError
}

/**
 * Error from schema modification
 */
export interface SchemaModificationError {
  code: SchemaErrorCode
  message: string
  details?: string
}

/**
 * Error codes for schema modifications
 */
export type SchemaErrorCode =
  | 'READ_ONLY'
  | 'INVALID_NAME'
  | 'TABLE_NOT_FOUND'
  | 'COLUMN_NOT_FOUND'
  | 'TABLE_EXISTS'
  | 'COLUMN_EXISTS'
  | 'FOREIGN_KEY_DEPENDENCY'
  | 'CONSTRAINT_VIOLATION'
  | 'SYNTAX_ERROR'
  | 'UNKNOWN'

// =============================================================================
// Validation
// =============================================================================

/**
 * Regex pattern for valid SQLite identifiers
 * Must not be empty and should not contain only whitespace
 */
const VALID_IDENTIFIER_PATTERN = /^[^\x00]+$/

/**
 * Validates a table or column name for SQL injection prevention.
 * SQLite allows virtually any string as an identifier when quoted,
 * but we reject null bytes and empty strings.
 *
 * @param name - The identifier to validate
 * @returns True if valid, false otherwise
 */
export function isValidIdentifier(name: string): boolean {
  if (!name || name.trim().length === 0) {
    return false
  }
  // Reject null bytes (could cause truncation issues)
  if (name.includes('\x00')) {
    return false
  }
  return VALID_IDENTIFIER_PATTERN.test(name)
}

/**
 * Validates a table name and returns an error if invalid.
 *
 * @param name - Table name to validate
 * @returns Error or null if valid
 */
export function validateTableName(name: string): SchemaModificationError | null {
  if (!isValidIdentifier(name)) {
    return {
      code: 'INVALID_NAME',
      message: `Invalid table name: "${name}"`,
      details: 'Table names cannot be empty or contain null bytes',
    }
  }
  return null
}

/**
 * Validates a column name and returns an error if invalid.
 *
 * @param name - Column name to validate
 * @returns Error or null if valid
 */
export function validateColumnName(name: string): SchemaModificationError | null {
  if (!isValidIdentifier(name)) {
    return {
      code: 'INVALID_NAME',
      message: `Invalid column name: "${name}"`,
      details: 'Column names cannot be empty or contain null bytes',
    }
  }
  return null
}

// =============================================================================
// Dependency Checking
// =============================================================================

/**
 * Gets all foreign keys that reference a table (incoming FKs).
 *
 * @param query - Query executor
 * @param tableName - Table to check
 * @returns Array of ForeignKeyInfo objects referencing this table
 */
export async function getIncomingForeignKeys(
  query: QueryExecutor,
  tableName: string
): Promise<ForeignKeyInfo[]> {
  // Get all tables
  const tablesResult = await query(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`
  )

  const incomingFKs: ForeignKeyInfo[] = []

  for (const row of tablesResult.rows) {
    const childTable = row[0] as string
    if (childTable === tableName) continue // Skip self

    // Check FKs from this table
    const fkResult = await query(`PRAGMA foreign_key_list(${quoteIdentifier(childTable)})`)

    for (const fkRow of fkResult.rows) {
      const [id, _seq, parentTable, from, to, onUpdate, onDelete, match] = fkRow
      if (parentTable === tableName) {
        incomingFKs.push({
          id: id as number,
          childTable,
          childColumn: from as string,
          parentTable: parentTable as string,
          parentColumn: to as string,
          onUpdate: (onUpdate as string).replace('_', ' ') as ForeignKeyInfo['onUpdate'],
          onDelete: (onDelete as string).replace('_', ' ') as ForeignKeyInfo['onDelete'],
          match: match as string,
        })
      }
    }
  }

  return incomingFKs
}

/**
 * Checks if a table has any incoming foreign key references.
 *
 * @param query - Query executor
 * @param tableName - Table to check
 * @returns Error if dependencies exist, null otherwise
 */
export async function checkTableDependencies(
  query: QueryExecutor,
  tableName: string
): Promise<SchemaModificationError | null> {
  const incomingFKs = await getIncomingForeignKeys(query, tableName)

  if (incomingFKs.length > 0) {
    const dependentTables = [...new Set(incomingFKs.map((fk) => fk.childTable))]
    return {
      code: 'FOREIGN_KEY_DEPENDENCY',
      message: `Cannot drop table "${tableName}" because it is referenced by foreign keys`,
      details: `Tables referencing this table: ${dependentTables.join(', ')}`,
    }
  }

  return null
}

/**
 * Checks if a table exists.
 *
 * @param query - Query executor
 * @param tableName - Table to check
 * @returns True if exists
 */
export async function tableExists(query: QueryExecutor, tableName: string): Promise<boolean> {
  const result = await query(
    `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`,
    [tableName]
  )
  return result.rows.length > 0
}

/**
 * Checks if a column exists in a table.
 *
 * @param query - Query executor
 * @param tableName - Table name
 * @param columnName - Column name
 * @returns True if exists
 */
export async function columnExists(
  query: QueryExecutor,
  tableName: string,
  columnName: string
): Promise<boolean> {
  const result = await query(`PRAGMA table_info(${quoteIdentifier(tableName)})`)
  return result.rows.some((row) => row[1] === columnName)
}

// =============================================================================
// Schema Modification Operations
// =============================================================================

/**
 * Options for createTable operation
 */
export interface CreateTableOptions {
  /** Table definition */
  def: TableDefinition
  /** Query executor */
  query: QueryExecutor
  /** Whether in read-only mode */
  isReadOnly: boolean
}

/**
 * Creates a new table.
 *
 * @param options - Create table options
 * @returns Result with success/error
 */
export async function handleCreateTable(
  options: CreateTableOptions
): Promise<SchemaModificationResult> {
  const { def, query, isReadOnly } = options

  // Check read-only mode
  if (isReadOnly) {
    return {
      success: false,
      error: {
        code: 'READ_ONLY',
        message: 'Cannot create table in read-only mode',
      },
    }
  }

  // Validate table name
  const tableNameError = validateTableName(def.name)
  if (tableNameError) {
    return { success: false, error: tableNameError }
  }

  // Validate column names
  for (const col of def.columns) {
    const colNameError = validateColumnName(col.name)
    if (colNameError) {
      return { success: false, error: colNameError }
    }
  }

  // Check if table already exists
  if (await tableExists(query, def.name)) {
    return {
      success: false,
      error: {
        code: 'TABLE_EXISTS',
        message: `Table "${def.name}" already exists`,
      },
    }
  }

  // Generate and execute DDL
  const ddl = generateCreateTableDDL(def)

  try {
    await query('BEGIN TRANSACTION')
    try {
      await query(ddl)
      await query('COMMIT')
      return { success: true }
    } catch (err) {
      await query('ROLLBACK')
      throw err
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      success: false,
      error: {
        code: message.includes('SQLITE_CONSTRAINT') ? 'CONSTRAINT_VIOLATION' : 'SYNTAX_ERROR',
        message: `Failed to create table: ${message}`,
      },
    }
  }
}

/**
 * Alter table action types
 */
export type AlterTableAction =
  | { type: 'addColumn'; column: ColumnDefinition }
  | { type: 'renameTable'; newName: string }
  | { type: 'renameColumn'; oldName: string; newName: string }

/**
 * Options for alterTable operation
 */
export interface AlterTableOptions {
  /** Table name */
  table: string
  /** Action to perform */
  action: AlterTableAction
  /** Query executor */
  query: QueryExecutor
  /** Whether in read-only mode */
  isReadOnly: boolean
}

/**
 * Performs ALTER TABLE operations.
 *
 * @param options - Alter table options
 * @returns Result with success/error
 */
export async function handleAlterTable(
  options: AlterTableOptions
): Promise<SchemaModificationResult> {
  const { table, action, query, isReadOnly } = options

  // Check read-only mode
  if (isReadOnly) {
    return {
      success: false,
      error: {
        code: 'READ_ONLY',
        message: 'Cannot alter table in read-only mode',
      },
    }
  }

  // Validate table name
  const tableNameError = validateTableName(table)
  if (tableNameError) {
    return { success: false, error: tableNameError }
  }

  // Check table exists
  if (!(await tableExists(query, table))) {
    return {
      success: false,
      error: {
        code: 'TABLE_NOT_FOUND',
        message: `Table "${table}" not found`,
      },
    }
  }

  let ddl: string

  switch (action.type) {
    case 'addColumn': {
      // Validate column name
      const colNameError = validateColumnName(action.column.name)
      if (colNameError) {
        return { success: false, error: colNameError }
      }

      // Check column doesn't already exist
      if (await columnExists(query, table, action.column.name)) {
        return {
          success: false,
          error: {
            code: 'COLUMN_EXISTS',
            message: `Column "${action.column.name}" already exists in table "${table}"`,
          },
        }
      }

      ddl = alterTableAddColumn({ table, column: action.column })
      break
    }

    case 'renameTable': {
      // Validate new name
      const newNameError = validateTableName(action.newName)
      if (newNameError) {
        return { success: false, error: newNameError }
      }

      // Check new name doesn't exist
      if (await tableExists(query, action.newName)) {
        return {
          success: false,
          error: {
            code: 'TABLE_EXISTS',
            message: `Table "${action.newName}" already exists`,
          },
        }
      }

      ddl = alterTableRename({ from: table, to: action.newName })
      break
    }

    case 'renameColumn': {
      // Validate column names
      const oldNameError = validateColumnName(action.oldName)
      if (oldNameError) {
        return { success: false, error: oldNameError }
      }

      const newNameError = validateColumnName(action.newName)
      if (newNameError) {
        return { success: false, error: newNameError }
      }

      // Check old column exists
      if (!(await columnExists(query, table, action.oldName))) {
        return {
          success: false,
          error: {
            code: 'COLUMN_NOT_FOUND',
            message: `Column "${action.oldName}" not found in table "${table}"`,
          },
        }
      }

      // Check new column doesn't exist (unless same name)
      if (
        action.oldName !== action.newName &&
        (await columnExists(query, table, action.newName))
      ) {
        return {
          success: false,
          error: {
            code: 'COLUMN_EXISTS',
            message: `Column "${action.newName}" already exists in table "${table}"`,
          },
        }
      }

      ddl = alterTableRenameColumn({ table, from: action.oldName, to: action.newName })
      break
    }

    default:
      return {
        success: false,
        error: {
          code: 'UNKNOWN',
          message: `Unknown alter action type`,
        },
      }
  }

  // Execute in transaction
  try {
    await query('BEGIN TRANSACTION')
    try {
      await query(ddl)
      await query('COMMIT')
      return { success: true }
    } catch (err) {
      await query('ROLLBACK')
      throw err
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      success: false,
      error: {
        code: message.includes('SQLITE_CONSTRAINT') ? 'CONSTRAINT_VIOLATION' : 'SYNTAX_ERROR',
        message: `Failed to alter table: ${message}`,
      },
    }
  }
}

/**
 * Options for dropTable operation
 */
export interface DropTableOptions {
  /** Table name */
  table: string
  /** Query executor */
  query: QueryExecutor
  /** Whether in read-only mode */
  isReadOnly: boolean
}

/**
 * Drops a table with dependency checking.
 *
 * @param options - Drop table options
 * @returns Result with success/error
 */
export async function handleDropTable(
  options: DropTableOptions
): Promise<SchemaModificationResult> {
  const { table, query, isReadOnly } = options

  // Check read-only mode
  if (isReadOnly) {
    return {
      success: false,
      error: {
        code: 'READ_ONLY',
        message: 'Cannot drop table in read-only mode',
      },
    }
  }

  // Validate table name
  const tableNameError = validateTableName(table)
  if (tableNameError) {
    return { success: false, error: tableNameError }
  }

  // Check table exists
  if (!(await tableExists(query, table))) {
    return {
      success: false,
      error: {
        code: 'TABLE_NOT_FOUND',
        message: `Table "${table}" not found`,
      },
    }
  }

  // Check for incoming foreign key dependencies
  const depError = await checkTableDependencies(query, table)
  if (depError) {
    return { success: false, error: depError }
  }

  // Execute in transaction
  const ddl = `DROP TABLE ${quoteIdentifier(table)}`

  try {
    await query('BEGIN TRANSACTION')
    try {
      await query(ddl)
      await query('COMMIT')
      return { success: true }
    } catch (err) {
      await query('ROLLBACK')
      throw err
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      success: false,
      error: {
        code: 'UNKNOWN',
        message: `Failed to drop table: ${message}`,
      },
    }
  }
}

/**
 * Options for dropColumn operation
 */
export interface DropColumnOptions {
  /** Table name */
  table: string
  /** Column name */
  column: string
  /** Query executor */
  query: QueryExecutor
  /** Whether in read-only mode */
  isReadOnly: boolean
}

/**
 * Drops a column from a table.
 *
 * SQLite 3.35+ supports ALTER TABLE DROP COLUMN directly.
 * For older versions or complex cases (column is in PK, FK, etc.),
 * a table rebuild would be needed (handled separately).
 *
 * @param options - Drop column options
 * @returns Result with success/error
 */
export async function handleDropColumn(
  options: DropColumnOptions
): Promise<SchemaModificationResult> {
  const { table, column, query, isReadOnly } = options

  // Check read-only mode
  if (isReadOnly) {
    return {
      success: false,
      error: {
        code: 'READ_ONLY',
        message: 'Cannot drop column in read-only mode',
      },
    }
  }

  // Validate names
  const tableNameError = validateTableName(table)
  if (tableNameError) {
    return { success: false, error: tableNameError }
  }

  const columnNameError = validateColumnName(column)
  if (columnNameError) {
    return { success: false, error: columnNameError }
  }

  // Check table exists
  if (!(await tableExists(query, table))) {
    return {
      success: false,
      error: {
        code: 'TABLE_NOT_FOUND',
        message: `Table "${table}" not found`,
      },
    }
  }

  // Check column exists
  if (!(await columnExists(query, table, column))) {
    return {
      success: false,
      error: {
        code: 'COLUMN_NOT_FOUND',
        message: `Column "${column}" not found in table "${table}"`,
      },
    }
  }

  // Try direct DROP COLUMN (SQLite 3.35+)
  const ddl = alterTableDropColumn({ table, column })

  try {
    await query('BEGIN TRANSACTION')
    try {
      await query(ddl)
      await query('COMMIT')
      return { success: true }
    } catch (err) {
      await query('ROLLBACK')
      throw err
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)

    // If DROP COLUMN fails (e.g., column is PK, referenced by FK, etc.),
    // the caller should use the table rebuild approach
    return {
      success: false,
      error: {
        code: message.includes('SQLITE_CONSTRAINT')
          ? 'CONSTRAINT_VIOLATION'
          : message.includes('cannot')
            ? 'CONSTRAINT_VIOLATION'
            : 'UNKNOWN',
        message: `Failed to drop column: ${message}`,
        details: 'Column may be part of a primary key, index, or foreign key constraint',
      },
    }
  }
}
