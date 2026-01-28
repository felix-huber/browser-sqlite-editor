/**
 * Table rebuild plan generation for SQLite.
 *
 * SQLite has limited ALTER TABLE support, so complex schema changes
 * require the "12-step" table rebuild process:
 * 1. Create new table with desired schema
 * 2. Copy data from old table
 * 3. Drop old table
 * 4. Rename new table to original name
 * 5. Recreate indexes, triggers, and views
 *
 * This module extracts dependent objects and produces a deterministic
 * rebuild plan with ordered operations.
 */

import type { ForeignKeyInfo, ForeignKeyAction } from '../types/index'
import type { DatabaseEngine } from './db-engine'

// =============================================================================
// Types
// =============================================================================

/**
 * SQLite object types stored in sqlite_master.
 */
export type SqliteObjectType = 'table' | 'index' | 'trigger' | 'view'

/**
 * An object from sqlite_master.
 */
export interface SqliteMasterObject {
  /** Object type */
  type: SqliteObjectType
  /** Object name */
  name: string
  /** Table this object is associated with (for indexes/triggers) */
  tblName: string
  /** Root page (not used for our purposes) */
  rootpage: number
  /** The SQL statement that created this object */
  sql: string | null
}

/**
 * Index information extracted from sqlite_master.
 */
export interface IndexObject {
  /** Index name */
  name: string
  /** Table the index belongs to */
  tableName: string
  /** Original CREATE INDEX SQL (null for auto-indexes) */
  sql: string | null
  /** Whether this is an auto-index (created by UNIQUE/PK constraints) */
  isAutoIndex: boolean
}

/**
 * Trigger information extracted from sqlite_master.
 */
export interface TriggerObject {
  /** Trigger name */
  name: string
  /** Table the trigger is on */
  tableName: string
  /** Original CREATE TRIGGER SQL */
  sql: string
}

/**
 * View that references a table.
 */
export interface ViewReference {
  /** View name */
  name: string
  /** Original CREATE VIEW SQL */
  sql: string
}

/**
 * Foreign key from another table pointing to this table.
 */
export interface IncomingForeignKey {
  /** The table containing the FK */
  fromTable: string
  /** Columns in the referring table */
  fromColumns: string[]
  /** Columns in this table being referenced */
  toColumns: string[]
  /** ON DELETE action */
  onDelete: ForeignKeyAction
  /** ON UPDATE action */
  onUpdate: ForeignKeyAction
}

/**
 * All dependent objects for a table.
 */
export interface TableDependents {
  /** Original CREATE TABLE statement */
  createTableSql: string
  /** User-created indexes on this table */
  indexes: IndexObject[]
  /** Triggers on this table */
  triggers: TriggerObject[]
  /** Views that reference this table */
  views: ViewReference[]
  /** Foreign keys from other tables pointing to this table */
  incomingForeignKeys: IncomingForeignKey[]
}

/**
 * Operation types in a rebuild plan.
 */
export type RebuildOperationType =
  | 'disable_fk'
  | 'begin_transaction'
  | 'create_temp_table'
  | 'copy_data'
  | 'drop_original'
  | 'rename_temp'
  | 'recreate_index'
  | 'recreate_trigger'
  | 'recreate_view'
  | 'update_fk_reference'
  | 'commit_transaction'
  | 'enable_fk'
  | 'fk_check'

/**
 * A single operation in the rebuild plan.
 */
export interface RebuildOperation {
  /** Operation type */
  type: RebuildOperationType
  /** SQL to execute (if applicable) */
  sql?: string
  /** Description of the operation */
  description: string
  /** Object name this operation relates to (for tracking) */
  objectName?: string
}

/**
 * Complete rebuild plan for a table.
 */
export interface RebuildPlan {
  /** Original table name */
  tableName: string
  /** List of operations in order */
  operations: RebuildOperation[]
  /** Dependent objects that will be affected */
  dependents: TableDependents
  /** Whether this plan modifies other tables (for FK updates) */
  affectsOtherTables: boolean
}

// =============================================================================
// Extraction Functions
// =============================================================================

/**
 * Extracts the CREATE TABLE statement for a table from sqlite_master.
 *
 * @param tableName - Table name
 * @param masterRows - Rows from sqlite_master
 * @returns The CREATE TABLE SQL, or null if not found
 */
export function extractCreateTableSql(
  tableName: string,
  masterRows: SqliteMasterObject[]
): string | null {
  const tableRow = masterRows.find(
    (row) =>
      row.type === 'table' &&
      row.name.toLowerCase() === tableName.toLowerCase()
  )
  return tableRow?.sql ?? null
}

/**
 * Extracts indexes for a table from sqlite_master.
 *
 * @param tableName - Table name
 * @param masterRows - Rows from sqlite_master
 * @returns List of indexes (excluding auto-indexes without SQL)
 */
export function extractIndexes(
  tableName: string,
  masterRows: SqliteMasterObject[]
): IndexObject[] {
  const indexes: IndexObject[] = []

  for (const row of masterRows) {
    if (
      row.type === 'index' &&
      row.tblName.toLowerCase() === tableName.toLowerCase()
    ) {
      // Auto-indexes created by UNIQUE/PK constraints have names starting with
      // "sqlite_autoindex_" and have null SQL
      const isAutoIndex = row.name.startsWith('sqlite_autoindex_') || row.sql === null

      indexes.push({
        name: row.name,
        tableName: row.tblName,
        sql: row.sql,
        isAutoIndex,
      })
    }
  }

  // Sort by name for deterministic output
  indexes.sort((a, b) => a.name.localeCompare(b.name))

  return indexes
}

/**
 * Extracts triggers for a table from sqlite_master.
 *
 * @param tableName - Table name
 * @param masterRows - Rows from sqlite_master
 * @returns List of triggers
 */
export function extractTriggers(
  tableName: string,
  masterRows: SqliteMasterObject[]
): TriggerObject[] {
  const triggers: TriggerObject[] = []

  for (const row of masterRows) {
    if (
      row.type === 'trigger' &&
      row.tblName.toLowerCase() === tableName.toLowerCase() &&
      row.sql !== null
    ) {
      triggers.push({
        name: row.name,
        tableName: row.tblName,
        sql: row.sql,
      })
    }
  }

  // Sort by name for deterministic output
  triggers.sort((a, b) => a.name.localeCompare(b.name))

  return triggers
}

/**
 * Extracts views that reference a table.
 *
 * This uses simple string matching to find table references in view SQL.
 * It may have false positives but won't miss actual references.
 *
 * @param tableName - Table name to search for
 * @param masterRows - Rows from sqlite_master
 * @returns List of views that reference the table
 */
export function extractViewsReferencingTable(
  tableName: string,
  masterRows: SqliteMasterObject[]
): ViewReference[] {
  const views: ViewReference[] = []
  const tableNameLower = tableName.toLowerCase()

  // Pattern to match table name with word boundaries
  // This matches: FROM tablename, JOIN tablename, ,tablename, etc.
  const tablePattern = new RegExp(
    `(?:^|[\\s,("'])${escapeRegExp(tableNameLower)}(?:[\\s,)"']|$)`,
    'i'
  )

  for (const row of masterRows) {
    if (row.type === 'view' && row.sql !== null) {
      // Check if the view SQL references the table
      if (tablePattern.test(row.sql)) {
        views.push({
          name: row.name,
          sql: row.sql,
        })
      }
    }
  }

  // Sort by name for deterministic output
  views.sort((a, b) => a.name.localeCompare(b.name))

  return views
}

/**
 * Escapes special regex characters in a string.
 */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Groups foreign key info items by constraint ID.
 *
 * @param fkInfos - Foreign key info items from PRAGMA foreign_key_list
 * @returns Array of grouped foreign keys
 */
export function groupForeignKeys(
  fkInfos: ForeignKeyInfo[]
): Map<number, ForeignKeyInfo[]> {
  const groups = new Map<number, ForeignKeyInfo[]>()

  for (const fk of fkInfos) {
    const existing = groups.get(fk.id) || []
    existing.push(fk)
    groups.set(fk.id, existing)
  }

  return groups
}

/**
 * Finds foreign keys from other tables that reference the given table.
 *
 * @param tableName - Table being referenced
 * @param allForeignKeys - Map of table name to its foreign keys
 * @returns List of incoming foreign keys
 */
export function extractIncomingForeignKeys(
  tableName: string,
  allForeignKeys: Map<string, ForeignKeyInfo[]>
): IncomingForeignKey[] {
  const incoming: IncomingForeignKey[] = []
  const tableNameLower = tableName.toLowerCase()

  for (const [fromTable, fkInfos] of allForeignKeys) {
    // Skip self-references for this list
    if (fromTable.toLowerCase() === tableNameLower) {
      continue
    }

    // Group by FK ID
    const grouped = groupForeignKeys(fkInfos)

    for (const [, fkGroup] of grouped) {
      // Check if this FK references our table
      if (fkGroup[0].parentTable.toLowerCase() === tableNameLower) {
        incoming.push({
          fromTable,
          fromColumns: fkGroup.map((fk) => fk.childColumn),
          toColumns: fkGroup.map((fk) => fk.parentColumn),
          onDelete: fkGroup[0].onDelete,
          onUpdate: fkGroup[0].onUpdate,
        })
      }
    }
  }

  // Sort by table name for deterministic output
  incoming.sort((a, b) => a.fromTable.localeCompare(b.fromTable))

  return incoming
}

/**
 * Extracts all dependent objects for a table.
 *
 * @param tableName - Table name
 * @param masterRows - Rows from sqlite_master
 * @param allForeignKeys - Map of table name to its foreign keys
 * @returns All dependent objects
 */
export function extractTableDependents(
  tableName: string,
  masterRows: SqliteMasterObject[],
  allForeignKeys: Map<string, ForeignKeyInfo[]>
): TableDependents {
  const createTableSql = extractCreateTableSql(tableName, masterRows)
  if (!createTableSql) {
    throw new Error(`Table "${tableName}" not found in sqlite_master`)
  }

  return {
    createTableSql,
    indexes: extractIndexes(tableName, masterRows),
    triggers: extractTriggers(tableName, masterRows),
    views: extractViewsReferencingTable(tableName, masterRows),
    incomingForeignKeys: extractIncomingForeignKeys(tableName, allForeignKeys),
  }
}

// =============================================================================
// Plan Generation
// =============================================================================

/**
 * Generates a rebuild plan for a table.
 *
 * The plan follows SQLite's recommended 12-step process but adapted:
 * 1. Disable foreign key enforcement
 * 2. Start transaction
 * 3. Create new table with new schema (temp name)
 * 4. Copy data from old table
 * 5. Drop old table
 * 6. Rename new table to original name
 * 7. Recreate indexes
 * 8. Recreate triggers
 * 9. (Views don't need recreation unless columns changed)
 * 10. Run FK check
 * 11. Commit transaction
 * 12. Re-enable foreign keys
 *
 * @param tableName - Table to rebuild
 * @param newCreateTableSql - New CREATE TABLE statement
 * @param dependents - Dependent objects from extractTableDependents
 * @param columnMapping - Optional mapping of old column names to new names for data copy
 * @returns Complete rebuild plan
 */
export function generateRebuildPlan(
  tableName: string,
  newCreateTableSql: string,
  dependents: TableDependents,
  columnMapping?: Map<string, string>
): RebuildPlan {
  const operations: RebuildOperation[] = []
  const tempTableName = `_${tableName}_rebuild_temp`

  // Step 1: Disable foreign key enforcement
  operations.push({
    type: 'disable_fk',
    sql: 'PRAGMA foreign_keys = OFF',
    description: 'Disable foreign key enforcement',
  })

  // Step 2: Begin transaction
  operations.push({
    type: 'begin_transaction',
    sql: 'BEGIN TRANSACTION',
    description: 'Start rebuild transaction',
  })

  // Step 3: Create temp table with new schema
  // Replace the table name in the CREATE statement with temp name
  const tempCreateSql = replaceTableNameInCreate(
    newCreateTableSql,
    tableName,
    tempTableName
  )
  operations.push({
    type: 'create_temp_table',
    sql: tempCreateSql,
    description: `Create temporary table "${tempTableName}"`,
    objectName: tempTableName,
  })

  // Step 4: Copy data
  const copyDataSql = generateCopyDataSql(
    tableName,
    tempTableName,
    columnMapping
  )
  operations.push({
    type: 'copy_data',
    sql: copyDataSql,
    description: `Copy data from "${tableName}" to "${tempTableName}"`,
  })

  // Step 5: Drop original table
  operations.push({
    type: 'drop_original',
    sql: `DROP TABLE ${quoteIdentifier(tableName)}`,
    description: `Drop original table "${tableName}"`,
    objectName: tableName,
  })

  // Step 6: Rename temp table to original name
  operations.push({
    type: 'rename_temp',
    sql: `ALTER TABLE ${quoteIdentifier(tempTableName)} RENAME TO ${quoteIdentifier(tableName)}`,
    description: `Rename "${tempTableName}" to "${tableName}"`,
  })

  // Step 7: Recreate user-created indexes (skip auto-indexes)
  for (const index of dependents.indexes) {
    if (!index.isAutoIndex && index.sql) {
      operations.push({
        type: 'recreate_index',
        sql: index.sql,
        description: `Recreate index "${index.name}"`,
        objectName: index.name,
      })
    }
  }

  // Step 8: Recreate triggers
  for (const trigger of dependents.triggers) {
    operations.push({
      type: 'recreate_trigger',
      sql: trigger.sql,
      description: `Recreate trigger "${trigger.name}"`,
      objectName: trigger.name,
    })
  }

  // Note: Views don't need to be recreated unless their columns are affected
  // The caller should handle view recreation if needed

  // Step 9: Run FK check
  operations.push({
    type: 'fk_check',
    sql: `PRAGMA foreign_key_check(${quoteIdentifier(tableName)})`,
    description: 'Verify foreign key integrity',
  })

  // Step 10: Commit transaction
  operations.push({
    type: 'commit_transaction',
    sql: 'COMMIT',
    description: 'Commit rebuild transaction',
  })

  // Step 11: Re-enable foreign keys
  operations.push({
    type: 'enable_fk',
    sql: 'PRAGMA foreign_keys = ON',
    description: 'Re-enable foreign key enforcement',
  })

  return {
    tableName,
    operations,
    dependents,
    affectsOtherTables: dependents.incomingForeignKeys.length > 0,
  }
}

/**
 * Replaces the table name in a CREATE TABLE statement.
 *
 * @param sql - Original CREATE TABLE SQL
 * @param oldName - Original table name
 * @param newName - New table name
 * @returns SQL with replaced table name
 */
export function replaceTableNameInCreate(
  sql: string,
  oldName: string,
  newName: string
): string {
  // Match CREATE TABLE [IF NOT EXISTS] <name>
  // Handle both quoted and unquoted names
  const patterns = [
    // Unquoted name
    new RegExp(
      `(CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?)${escapeRegExp(oldName)}(\\s*\\()`,
      'i'
    ),
    // Double-quoted name
    new RegExp(
      `(CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?)"${escapeRegExp(oldName)}"(\\s*\\()`,
      'i'
    ),
    // Square-bracket quoted name
    new RegExp(
      `(CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?)\\[${escapeRegExp(oldName)}\\](\\s*\\()`,
      'i'
    ),
  ]

  for (const pattern of patterns) {
    if (pattern.test(sql)) {
      return sql.replace(pattern, `$1${quoteIdentifier(newName)}$2`)
    }
  }

  // Fallback: just return original if we can't match
  // This shouldn't happen with valid SQL
  return sql
}

/**
 * Generates SQL to copy data between tables.
 *
 * @param fromTable - Source table
 * @param toTable - Destination table
 * @param columnMapping - Optional mapping of old column names to new names
 * @returns INSERT ... SELECT SQL
 */
export function generateCopyDataSql(
  fromTable: string,
  toTable: string,
  columnMapping?: Map<string, string>
): string {
  if (!columnMapping || columnMapping.size === 0) {
    // Simple case: copy all columns with same names
    return `INSERT INTO ${quoteIdentifier(toTable)} SELECT * FROM ${quoteIdentifier(fromTable)}`
  }

  // Build explicit column lists
  const oldColumns: string[] = []
  const newColumns: string[] = []

  for (const [oldCol, newCol] of columnMapping) {
    oldColumns.push(quoteIdentifier(oldCol))
    newColumns.push(quoteIdentifier(newCol))
  }

  return `INSERT INTO ${quoteIdentifier(toTable)} (${newColumns.join(', ')}) SELECT ${oldColumns.join(', ')} FROM ${quoteIdentifier(fromTable)}`
}

/**
 * Checks if an identifier needs quoting.
 */
function needsQuoting(identifier: string): boolean {
  if (!identifier || identifier.length === 0) {
    return true
  }

  // SQLite reserved keywords (subset - full list is in ddl.ts)
  const reserved = new Set([
    'ORDER', 'TABLE', 'SELECT', 'FROM', 'WHERE', 'CREATE', 'DROP',
    'INSERT', 'UPDATE', 'DELETE', 'INDEX', 'TRIGGER', 'VIEW', 'ALTER',
  ])

  if (reserved.has(identifier.toUpperCase())) {
    return true
  }

  if (/^\d/.test(identifier)) {
    return true
  }

  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(identifier)) {
    return true
  }

  return false
}

/**
 * Quotes an identifier if necessary.
 */
function quoteIdentifier(identifier: string): string {
  if (!needsQuoting(identifier)) {
    return identifier
  }
  const escaped = identifier.replace(/"/g, '""')
  return `"${escaped}"`
}

// =============================================================================
// Rebuild Execution
// =============================================================================

/**
 * Result of a rebuild execution.
 */
export interface RebuildExecutionResult {
  /** Whether the rebuild succeeded */
  success: boolean
  /** Row count before rebuild (for verification) */
  rowCountBefore: number
  /** Row count after rebuild (for verification) */
  rowCountAfter: number
  /** Operations that were executed */
  executedOperations: RebuildOperationType[]
  /** Error message if failed */
  error?: string
}

/**
 * Executes a rebuild plan transactionally.
 *
 * The execution follows these steps:
 * 1. Disable foreign key enforcement
 * 2. Begin transaction
 * 3. Create temp table with new schema
 * 4. Copy data from original table
 * 5. Drop original table
 * 6. Rename temp table to original name
 * 7. Recreate indexes
 * 8. Recreate triggers
 * 9. Run FK check
 * 10. Commit (or rollback on any failure)
 * 11. Re-enable foreign keys
 *
 * @param engine Database engine to execute on
 * @param plan Rebuild plan to execute
 * @returns Execution result with success status and row counts
 */
export async function executeRebuildPlan(
  engine: DatabaseEngine,
  plan: RebuildPlan
): Promise<RebuildExecutionResult> {
  const executedOperations: RebuildOperationType[] = []
  let rowCountBefore = 0
  let rowCountAfter = 0
  let inTransaction = false
  let fkWasEnabled = false

  try {
    // Get row count before rebuild for verification
    const countResult = await engine.query(
      `SELECT COUNT(*) as cnt FROM ${quoteIdentifier(plan.tableName)}`
    )
    rowCountBefore = countResult.rows[0]?.[0] as number ?? 0

    // Check current FK state
    const fkResult = await engine.query('PRAGMA foreign_keys')
    fkWasEnabled = (fkResult.rows[0]?.[0] as number) === 1

    // Execute each operation
    for (const op of plan.operations) {
      if (op.sql) {
        // Handle special operations
        if (op.type === 'begin_transaction') {
          await engine.exec(op.sql)
          inTransaction = true
          executedOperations.push(op.type)
        } else if (op.type === 'commit_transaction') {
          await engine.exec(op.sql)
          inTransaction = false
          executedOperations.push(op.type)
        } else if (op.type === 'fk_check') {
          // FK check returns rows if there are violations
          const violations = await engine.query(op.sql)
          if (violations.rows.length > 0) {
            throw new Error(
              `Foreign key violations detected: ${violations.rows.length} violation(s)`
            )
          }
          executedOperations.push(op.type)
        } else {
          // Regular SQL execution
          await engine.exec(op.sql)
          executedOperations.push(op.type)
        }
      }
    }

    // Get row count after rebuild for verification
    const countAfterResult = await engine.query(
      `SELECT COUNT(*) as cnt FROM ${quoteIdentifier(plan.tableName)}`
    )
    rowCountAfter = countAfterResult.rows[0]?.[0] as number ?? 0

    return {
      success: true,
      rowCountBefore,
      rowCountAfter,
      executedOperations,
    }
  } catch (err) {
    // Rollback if in transaction
    if (inTransaction) {
      try {
        await engine.exec('ROLLBACK')
      } catch {
        // Ignore rollback errors - original error is more important
      }
    }

    // Re-enable foreign keys if they were enabled before
    if (fkWasEnabled) {
      try {
        await engine.exec('PRAGMA foreign_keys = ON')
      } catch {
        // Ignore - best effort
      }
    }

    const message = err instanceof Error ? err.message : String(err)
    return {
      success: false,
      rowCountBefore,
      rowCountAfter,
      executedOperations,
      error: message,
    }
  }
}

/**
 * Generates SQL to copy data between tables with column transformations.
 *
 * This handles:
 * - Column renames (via mapping)
 * - Removed columns (excluded from copy)
 * - Added columns (receive NULL or DEFAULT)
 * - Type coercion (handled by SQLite automatically)
 *
 * @param fromTable Source table
 * @param toTable Destination table (temp table with new schema)
 * @param sourceColumns Columns in the source table
 * @param targetColumns Columns in the target table (new schema)
 * @param columnRenames Map from old column name to new column name
 * @returns INSERT ... SELECT SQL
 */
export function generateColumnMappedCopyDataSql(
  fromTable: string,
  toTable: string,
  sourceColumns: string[],
  targetColumns: string[],
  columnRenames?: Map<string, string>
): string {
  // Build mapping: for each target column, find the source column
  const selectExprs: string[] = []
  const targetColNames: string[] = []

  // Create reverse mapping: newName -> oldName
  const reverseRenames = new Map<string, string>()
  if (columnRenames) {
    for (const [oldName, newName] of columnRenames) {
      reverseRenames.set(newName.toLowerCase(), oldName)
    }
  }

  for (const targetCol of targetColumns) {
    const targetLower = targetCol.toLowerCase()

    // Check if this is a renamed column
    const sourceColName = reverseRenames.get(targetLower)
    if (sourceColName) {
      // Column was renamed: SELECT old_name as new_name
      selectExprs.push(quoteIdentifier(sourceColName))
      targetColNames.push(quoteIdentifier(targetCol))
    } else if (sourceColumns.some((s) => s.toLowerCase() === targetLower)) {
      // Column exists with same name in source
      selectExprs.push(quoteIdentifier(targetCol))
      targetColNames.push(quoteIdentifier(targetCol))
    }
    // Else: new column, will get NULL/DEFAULT - don't include in INSERT
  }

  if (selectExprs.length === 0) {
    // No columns to copy - just create empty table
    return `INSERT INTO ${quoteIdentifier(toTable)} SELECT * FROM ${quoteIdentifier(fromTable)} WHERE 0`
  }

  return `INSERT INTO ${quoteIdentifier(toTable)} (${targetColNames.join(', ')}) SELECT ${selectExprs.join(', ')} FROM ${quoteIdentifier(fromTable)}`
}

/**
 * Creates a rebuild plan with explicit column mapping for schema changes.
 *
 * Use this when you know exactly which columns are being:
 * - Renamed (provide in columnRenames map)
 * - Added (in newColumns but not in oldColumns)
 * - Removed (in oldColumns but not in newColumns)
 *
 * @param tableName Table to rebuild
 * @param newCreateTableSql New CREATE TABLE SQL
 * @param dependents Dependent objects
 * @param oldColumns Columns in current schema
 * @param newColumns Columns in new schema
 * @param columnRenames Map from old column name to new column name
 * @returns Rebuild plan with correct column mapping
 */
export function generateRebuildPlanWithColumnMapping(
  tableName: string,
  newCreateTableSql: string,
  dependents: TableDependents,
  oldColumns: string[],
  newColumns: string[],
  columnRenames?: Map<string, string>
): RebuildPlan {
  const operations: RebuildOperation[] = []
  const tempTableName = `_${tableName}_rebuild_temp`

  // Step 1: Disable foreign key enforcement
  operations.push({
    type: 'disable_fk',
    sql: 'PRAGMA foreign_keys = OFF',
    description: 'Disable foreign key enforcement',
  })

  // Step 2: Begin transaction
  operations.push({
    type: 'begin_transaction',
    sql: 'BEGIN TRANSACTION',
    description: 'Start rebuild transaction',
  })

  // Step 3: Create temp table with new schema
  const tempCreateSql = replaceTableNameInCreate(
    newCreateTableSql,
    tableName,
    tempTableName
  )
  operations.push({
    type: 'create_temp_table',
    sql: tempCreateSql,
    description: `Create temporary table "${tempTableName}"`,
    objectName: tempTableName,
  })

  // Step 4: Copy data with column mapping
  const copyDataSql = generateColumnMappedCopyDataSql(
    tableName,
    tempTableName,
    oldColumns,
    newColumns,
    columnRenames
  )
  operations.push({
    type: 'copy_data',
    sql: copyDataSql,
    description: `Copy data from "${tableName}" to "${tempTableName}"`,
  })

  // Step 5: Drop original table
  operations.push({
    type: 'drop_original',
    sql: `DROP TABLE ${quoteIdentifier(tableName)}`,
    description: `Drop original table "${tableName}"`,
    objectName: tableName,
  })

  // Step 6: Rename temp table to original name
  operations.push({
    type: 'rename_temp',
    sql: `ALTER TABLE ${quoteIdentifier(tempTableName)} RENAME TO ${quoteIdentifier(tableName)}`,
    description: `Rename "${tempTableName}" to "${tableName}"`,
  })

  // Step 7: Recreate user-created indexes (skip auto-indexes)
  for (const index of dependents.indexes) {
    if (!index.isAutoIndex && index.sql) {
      operations.push({
        type: 'recreate_index',
        sql: index.sql,
        description: `Recreate index "${index.name}"`,
        objectName: index.name,
      })
    }
  }

  // Step 8: Recreate triggers
  for (const trigger of dependents.triggers) {
    operations.push({
      type: 'recreate_trigger',
      sql: trigger.sql,
      description: `Recreate trigger "${trigger.name}"`,
      objectName: trigger.name,
    })
  }

  // Step 9: Run FK check
  operations.push({
    type: 'fk_check',
    sql: `PRAGMA foreign_key_check(${quoteIdentifier(tableName)})`,
    description: 'Verify foreign key integrity',
  })

  // Step 10: Commit transaction
  operations.push({
    type: 'commit_transaction',
    sql: 'COMMIT',
    description: 'Commit rebuild transaction',
  })

  // Step 11: Re-enable foreign keys
  operations.push({
    type: 'enable_fk',
    sql: 'PRAGMA foreign_keys = ON',
    description: 'Re-enable foreign key enforcement',
  })

  return {
    tableName,
    operations,
    dependents,
    affectsOtherTables: dependents.incomingForeignKeys.length > 0,
  }
}
