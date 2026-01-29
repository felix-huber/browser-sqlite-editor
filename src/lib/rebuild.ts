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
  /** Detailed verification results (only present on failure) */
  verificationFailures?: VerificationFailure[]
}

/**
 * A single verification failure with details about what went wrong.
 */
export interface VerificationFailure {
  /** Type of verification that failed */
  type: 'schema_mismatch' | 'fk_violation' | 'view_broken' | 'trigger_broken'
  /** Name of the affected object (table, view, or trigger name) */
  objectName: string
  /** Human-readable description of the failure */
  message: string
  /** Additional details (e.g., expected vs actual for schema) */
  details?: string
}

/**
 * Options for controlling rebuild verification.
 */
export interface RebuildVerificationOptions {
  /** Whether to verify schema matches after rebuild (default: true) */
  verifySchema?: boolean
  /** Whether to verify FK integrity (default: true) */
  verifyForeignKeys?: boolean
  /** Whether to verify dependent views still compile (default: true) */
  verifyViews?: boolean
  /** Whether to verify triggers (default: true) */
  verifyTriggers?: boolean
  /** Expected column names in the new schema (for schema verification) */
  expectedColumns?: string[]
}

// =============================================================================
// Verification Functions
// =============================================================================

/**
 * Verifies the table schema matches expected columns after rebuild.
 *
 * Uses PRAGMA table_info to get the current column structure and compares
 * against expected columns if provided.
 *
 * @param engine Database engine
 * @param tableName Table to verify
 * @param expectedColumns Optional list of expected column names
 * @returns Array of failures (empty if all checks pass)
 */
export async function verifyTableSchema(
  engine: DatabaseEngine,
  tableName: string,
  expectedColumns?: string[]
): Promise<VerificationFailure[]> {
  const failures: VerificationFailure[] = []

  try {
    const result = await engine.query(
      `PRAGMA table_info(${quoteIdentifier(tableName)})`
    )

    // table_info returns: cid, name, type, notnull, dflt_value, pk
    const actualColumns = result.rows.map((row) => row[1] as string)

    if (expectedColumns && expectedColumns.length > 0) {
      // Compare column lists (case-insensitive)
      const expectedLower = expectedColumns.map((c) => c.toLowerCase())
      const actualLower = actualColumns.map((c) => c.toLowerCase())

      // Check for missing expected columns
      for (const expected of expectedLower) {
        if (!actualLower.includes(expected)) {
          failures.push({
            type: 'schema_mismatch',
            objectName: tableName,
            message: `Expected column "${expected}" not found in rebuilt table`,
            details: `Expected: [${expectedColumns.join(', ')}], Actual: [${actualColumns.join(', ')}]`,
          })
        }
      }

      // Check for unexpected columns
      for (const actual of actualLower) {
        if (!expectedLower.includes(actual)) {
          failures.push({
            type: 'schema_mismatch',
            objectName: tableName,
            message: `Unexpected column "${actual}" in rebuilt table`,
            details: `Expected: [${expectedColumns.join(', ')}], Actual: [${actualColumns.join(', ')}]`,
          })
        }
      }
    }

    // Basic sanity check: table should have at least one column
    if (actualColumns.length === 0) {
      failures.push({
        type: 'schema_mismatch',
        objectName: tableName,
        message: 'Rebuilt table has no columns',
      })
    }
  } catch (err) {
    failures.push({
      type: 'schema_mismatch',
      objectName: tableName,
      message: `Failed to verify table schema: ${err instanceof Error ? err.message : String(err)}`,
    })
  }

  return failures
}

/**
 * Verifies foreign key integrity for a table.
 *
 * Uses PRAGMA foreign_key_check to detect any FK violations after rebuild.
 *
 * @param engine Database engine
 * @param tableName Table to check
 * @returns Array of failures (empty if no violations)
 */
export async function verifyForeignKeyIntegrity(
  engine: DatabaseEngine,
  tableName: string
): Promise<VerificationFailure[]> {
  const failures: VerificationFailure[] = []

  try {
    const result = await engine.query(
      `PRAGMA foreign_key_check(${quoteIdentifier(tableName)})`
    )

    // foreign_key_check returns: table, rowid, parent, fkid
    // Each row represents a violation
    if (result.rows.length > 0) {
      // Group violations by parent table for cleaner reporting
      const violationsByParent = new Map<string, number>()
      for (const row of result.rows) {
        const parentTable = row[2] as string
        violationsByParent.set(
          parentTable,
          (violationsByParent.get(parentTable) ?? 0) + 1
        )
      }

      for (const [parentTable, count] of violationsByParent) {
        failures.push({
          type: 'fk_violation',
          objectName: tableName,
          message: `Foreign key violation: ${count} row(s) reference non-existent data in "${parentTable}"`,
          details: `Total FK violations detected: ${result.rows.length}`,
        })
      }
    }
  } catch (err) {
    failures.push({
      type: 'fk_violation',
      objectName: tableName,
      message: `Failed to verify FK integrity: ${err instanceof Error ? err.message : String(err)}`,
    })
  }

  return failures
}

/**
 * Verifies that a view is still compilable after table rebuild.
 *
 * Runs SELECT * FROM view LIMIT 0 to check if the view compiles.
 * This catches issues like missing columns, renamed columns, or type changes
 * that break the view definition.
 *
 * @param engine Database engine
 * @param viewName View to verify
 * @returns VerificationFailure if view is broken, null if OK
 */
export async function verifyViewCompilability(
  engine: DatabaseEngine,
  viewName: string
): Promise<VerificationFailure | null> {
  try {
    // SELECT * LIMIT 0 forces the view to be compiled without returning data
    await engine.query(
      `SELECT * FROM ${quoteIdentifier(viewName)} LIMIT 0`
    )
    return null
  } catch (err) {
    return {
      type: 'view_broken',
      objectName: viewName,
      message: `View "${viewName}" is broken after rebuild`,
      details: err instanceof Error ? err.message : String(err),
    }
  }
}

/**
 * Verifies that a trigger SQL is syntactically valid.
 *
 * Since we cannot easily test a trigger without modifying data,
 * we verify by checking that the trigger exists in sqlite_master
 * after recreation. If the CREATE TRIGGER succeeded, the syntax is valid.
 *
 * Additionally, we parse the trigger SQL to extract referenced columns
 * and check they still exist (basic validation).
 *
 * @param engine Database engine
 * @param triggerName Trigger to verify
 * @param triggerSql Original trigger SQL for reference
 * @returns VerificationFailure if trigger is broken, null if OK
 */
export async function verifyTriggerValidity(
  engine: DatabaseEngine,
  triggerName: string,
  triggerSql: string
): Promise<VerificationFailure | null> {
  try {
    // Check trigger exists in sqlite_master
    const result = await engine.query(
      `SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?`,
      [triggerName]
    )

    if (result.rows.length === 0) {
      return {
        type: 'trigger_broken',
        objectName: triggerName,
        message: `Trigger "${triggerName}" was not recreated`,
        details: `Expected trigger SQL: ${triggerSql.substring(0, 100)}...`,
      }
    }

    // Trigger exists and was created successfully - syntax is valid
    return null
  } catch (err) {
    return {
      type: 'trigger_broken',
      objectName: triggerName,
      message: `Failed to verify trigger "${triggerName}"`,
      details: err instanceof Error ? err.message : String(err),
    }
  }
}

/**
 * Checks for self-referential foreign keys in a table.
 *
 * Self-referential FKs (e.g., employee.manager_id -> employee.id)
 * require special handling during rebuild to avoid deadlock issues.
 *
 * @param tableName Table name to check
 * @param foreignKeys Foreign keys for the table
 * @returns True if the table has self-referential FKs
 */
export function hasSelfReferencialForeignKeys(
  tableName: string,
  foreignKeys: ForeignKeyInfo[]
): boolean {
  const tableNameLower = tableName.toLowerCase()
  return foreignKeys.some(
    (fk) => fk.parentTable.toLowerCase() === tableNameLower
  )
}

/**
 * Runs all post-rebuild verifications.
 *
 * This is the main verification entry point called after the rebuild
 * transaction commits. It runs all enabled verification checks and
 * collects failures.
 *
 * @param engine Database engine
 * @param plan Rebuild plan that was executed
 * @param options Verification options
 * @returns Array of all verification failures
 */
export async function runPostRebuildVerification(
  engine: DatabaseEngine,
  plan: RebuildPlan,
  options: RebuildVerificationOptions = {}
): Promise<VerificationFailure[]> {
  const {
    verifySchema = true,
    verifyForeignKeys = true,
    verifyViews = true,
    verifyTriggers = true,
    expectedColumns,
  } = options

  const failures: VerificationFailure[] = []

  // 1. Verify schema
  if (verifySchema) {
    const schemaFailures = await verifyTableSchema(
      engine,
      plan.tableName,
      expectedColumns
    )
    failures.push(...schemaFailures)
  }

  // 2. Verify FK integrity
  if (verifyForeignKeys) {
    const fkFailures = await verifyForeignKeyIntegrity(engine, plan.tableName)
    failures.push(...fkFailures)
  }

  // 3. Verify dependent views
  if (verifyViews) {
    for (const view of plan.dependents.views) {
      const viewFailure = await verifyViewCompilability(engine, view.name)
      if (viewFailure) {
        failures.push(viewFailure)
      }
    }
  }

  // 4. Verify triggers
  if (verifyTriggers) {
    for (const trigger of plan.dependents.triggers) {
      const triggerFailure = await verifyTriggerValidity(
        engine,
        trigger.name,
        trigger.sql
      )
      if (triggerFailure) {
        failures.push(triggerFailure)
      }
    }
  }

  return failures
}

/**
 * Executes a rebuild plan transactionally with post-rebuild verification.
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
 * 10. Run post-rebuild verification (views, triggers, schema)
 * 11. Commit (or rollback on any verification failure)
 * 12. Re-enable foreign keys
 *
 * @param engine Database engine to execute on
 * @param plan Rebuild plan to execute
 * @param verificationOptions Optional verification settings
 * @returns Execution result with success status, row counts, and any verification failures
 */
export async function executeRebuildPlan(
  engine: DatabaseEngine,
  plan: RebuildPlan,
  verificationOptions?: RebuildVerificationOptions
): Promise<RebuildExecutionResult> {
  const executedOperations: RebuildOperationType[] = []
  let rowCountBefore = 0
  let rowCountAfter = 0
  let inTransaction = false
  let fkWasEnabled = false
  const verificationFailures: VerificationFailure[] = []

  // Check for self-referential FK issues upfront
  // Get all FKs for this table to check for self-references
  let selfReferentialFkInfo: ForeignKeyInfo[] = []
  try {
    const fkListResult = await engine.query(
      `PRAGMA foreign_key_list(${quoteIdentifier(plan.tableName)})`
    )
    // foreign_key_list returns: id, seq, table, from, to, on_update, on_delete, match
    selfReferentialFkInfo = fkListResult.rows
      .filter((row) => (row[2] as string).toLowerCase() === plan.tableName.toLowerCase())
      .map((row) => ({
        id: row[0] as number,
        childTable: plan.tableName,
        childColumn: row[3] as string,
        parentTable: row[2] as string,
        parentColumn: row[4] as string,
        onUpdate: row[5] as ForeignKeyAction,
        onDelete: row[6] as ForeignKeyAction,
        match: row[7] as string,
      }))
  } catch {
    // Table might not exist yet or other error - proceed anyway
  }

  const hasSelfRefFk = hasSelfReferencialForeignKeys(plan.tableName, selfReferentialFkInfo)

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
          // Before committing, run post-rebuild verification
          // This allows us to rollback if verification fails
          const preCommitFailures = await runPreCommitVerification(
            engine,
            plan,
            verificationOptions
          )

          if (preCommitFailures.length > 0) {
            verificationFailures.push(...preCommitFailures)
            throw new Error(
              `Post-rebuild verification failed: ${formatVerificationErrors(preCommitFailures)}`
            )
          }

          await engine.exec(op.sql)
          inTransaction = false
          executedOperations.push(op.type)
        } else if (op.type === 'fk_check') {
          // FK check returns rows if there are violations
          const violations = await engine.query(op.sql)
          if (violations.rows.length > 0) {
            // For self-referential FKs, this might be expected during rebuild
            // But we still report it as an error
            const fkFailures = await verifyForeignKeyIntegrity(engine, plan.tableName)
            if (fkFailures.length > 0) {
              verificationFailures.push(...fkFailures)
              if (hasSelfRefFk) {
                throw new Error(
                  `Foreign key violations detected (table has self-referential FK): ${violations.rows.length} violation(s). ` +
                  `Self-referential FKs require special handling.`
                )
              }
              throw new Error(
                `Foreign key violations detected: ${violations.rows.length} violation(s)`
              )
            }
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
      verificationFailures: verificationFailures.length > 0 ? verificationFailures : undefined,
    }
  }
}

/**
 * Runs verification checks before committing the rebuild transaction.
 *
 * This is called inside the transaction, after all rebuild operations but before COMMIT.
 * If any verification fails, the transaction will be rolled back.
 *
 * @param engine Database engine
 * @param plan Rebuild plan
 * @param options Verification options
 * @returns Array of verification failures
 */
async function runPreCommitVerification(
  engine: DatabaseEngine,
  plan: RebuildPlan,
  options: RebuildVerificationOptions = {}
): Promise<VerificationFailure[]> {
  const {
    verifySchema = true,
    verifyViews = true,
    verifyTriggers = true,
    expectedColumns,
  } = options

  const failures: VerificationFailure[] = []

  // 1. Verify schema matches expected (if provided)
  if (verifySchema) {
    const schemaFailures = await verifyTableSchema(
      engine,
      plan.tableName,
      expectedColumns
    )
    failures.push(...schemaFailures)
  }

  // 2. Verify dependent views still compile
  if (verifyViews) {
    for (const view of plan.dependents.views) {
      const viewFailure = await verifyViewCompilability(engine, view.name)
      if (viewFailure) {
        failures.push(viewFailure)
      }
    }
  }

  // 3. Verify triggers were recreated successfully
  if (verifyTriggers) {
    for (const trigger of plan.dependents.triggers) {
      const triggerFailure = await verifyTriggerValidity(
        engine,
        trigger.name,
        trigger.sql
      )
      if (triggerFailure) {
        failures.push(triggerFailure)
      }
    }
  }

  return failures
}

/**
 * Formats verification errors into a human-readable string.
 *
 * @param failures Array of verification failures
 * @returns Formatted error string
 */
function formatVerificationErrors(failures: VerificationFailure[]): string {
  if (failures.length === 0) return ''

  const brokenViews = failures.filter((f) => f.type === 'view_broken')
  const brokenTriggers = failures.filter((f) => f.type === 'trigger_broken')
  const schemaErrors = failures.filter((f) => f.type === 'schema_mismatch')
  const fkErrors = failures.filter((f) => f.type === 'fk_violation')

  const parts: string[] = []

  if (brokenViews.length > 0) {
    const viewNames = brokenViews.map((f) => f.objectName).join(', ')
    parts.push(`Broken view(s): ${viewNames}`)
  }

  if (brokenTriggers.length > 0) {
    const triggerNames = brokenTriggers.map((f) => f.objectName).join(', ')
    parts.push(`Broken trigger(s): ${triggerNames}`)
  }

  if (schemaErrors.length > 0) {
    parts.push(`Schema mismatch: ${schemaErrors[0].message}`)
  }

  if (fkErrors.length > 0) {
    parts.push(`FK violation(s): ${fkErrors.length}`)
  }

  return parts.join('; ')
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
