/**
 * DDL (Data Definition Language) generation utilities for SQLite.
 *
 * This module generates CREATE TABLE and ALTER TABLE statements
 * from TypeScript interfaces, handling all SQLite-specific quirks.
 */

import type {
  ColumnInfo,
  ForeignKeyInfo,
  ForeignKeyAction,
} from '../types/index'

// SQLite reserved keywords that require quoting
const SQLITE_RESERVED_KEYWORDS = new Set([
  'ABORT', 'ACTION', 'ADD', 'AFTER', 'ALL', 'ALTER', 'ALWAYS', 'ANALYZE', 'AND',
  'AS', 'ASC', 'ATTACH', 'AUTOINCREMENT', 'BEFORE', 'BEGIN', 'BETWEEN', 'BY',
  'CASCADE', 'CASE', 'CAST', 'CHECK', 'COLLATE', 'COLUMN', 'COMMIT', 'CONFLICT',
  'CONSTRAINT', 'CREATE', 'CROSS', 'CURRENT', 'CURRENT_DATE', 'CURRENT_TIME',
  'CURRENT_TIMESTAMP', 'DATABASE', 'DEFAULT', 'DEFERRABLE', 'DEFERRED', 'DELETE',
  'DESC', 'DETACH', 'DISTINCT', 'DO', 'DROP', 'EACH', 'ELSE', 'END', 'ESCAPE',
  'EXCEPT', 'EXCLUDE', 'EXCLUSIVE', 'EXISTS', 'EXPLAIN', 'FAIL', 'FILTER',
  'FIRST', 'FOLLOWING', 'FOR', 'FOREIGN', 'FROM', 'FULL', 'GENERATED', 'GLOB',
  'GROUP', 'GROUPS', 'HAVING', 'IF', 'IGNORE', 'IMMEDIATE', 'IN', 'INDEX',
  'INDEXED', 'INITIALLY', 'INNER', 'INSERT', 'INSTEAD', 'INTERSECT', 'INTO',
  'IS', 'ISNULL', 'JOIN', 'KEY', 'LAST', 'LEFT', 'LIKE', 'LIMIT', 'MATCH',
  'MATERIALIZED', 'NATURAL', 'NO', 'NOT', 'NOTHING', 'NOTNULL', 'NULL', 'NULLS',
  'OF', 'OFFSET', 'ON', 'OR', 'ORDER', 'OTHERS', 'OUTER', 'OVER', 'PARTITION',
  'PLAN', 'PRAGMA', 'PRECEDING', 'PRIMARY', 'QUERY', 'RAISE', 'RANGE',
  'RECURSIVE', 'REFERENCES', 'REGEXP', 'REINDEX', 'RELEASE', 'RENAME', 'REPLACE',
  'RESTRICT', 'RETURNING', 'RIGHT', 'ROLLBACK', 'ROW', 'ROWS', 'SAVEPOINT',
  'SELECT', 'SET', 'TABLE', 'TEMP', 'TEMPORARY', 'THEN', 'TIES', 'TO',
  'TRANSACTION', 'TRIGGER', 'UNBOUNDED', 'UNION', 'UNIQUE', 'UPDATE', 'USING',
  'VACUUM', 'VALUES', 'VIEW', 'VIRTUAL', 'WHEN', 'WHERE', 'WINDOW', 'WITH',
  'WITHOUT',
])

/**
 * Table definition for DDL generation.
 * This interface extends TableInfo concepts for DDL-specific needs.
 */
export interface TableDefinition {
  /** Table name */
  name: string
  /** Column definitions */
  columns: ColumnDefinition[]
  /** Primary key columns (for composite PKs, or empty if pk defined per-column) */
  primaryKey?: string[]
  /** Foreign key constraints */
  foreignKeys?: ForeignKeyConstraint[]
  /** Table-level CHECK constraints */
  checkConstraints?: CheckConstraint[]
  /** Whether this is a WITHOUT ROWID table */
  withoutRowid?: boolean
  /** Whether to use IF NOT EXISTS */
  ifNotExists?: boolean
  /** STRICT table mode (SQLite 3.37+) */
  strict?: boolean
}

/**
 * Column definition for DDL generation.
 */
export interface ColumnDefinition {
  /** Column name */
  name: string
  /** SQLite type (TEXT, INTEGER, REAL, BLOB, NUMERIC, or custom) */
  type: string
  /** Whether NOT NULL constraint exists */
  notNull?: boolean
  /** Default value expression (as SQL literal or expression) */
  defaultValue?: string | null
  /** Primary key order (0 = not PK, 1+ for PK columns) */
  primaryKey?: number
  /** Whether AUTOINCREMENT (only valid with INTEGER PRIMARY KEY) */
  autoincrement?: boolean
  /** Whether UNIQUE constraint exists */
  unique?: boolean
  /** Generated column expression */
  generatedAs?: string
  /** Generated column storage type */
  generatedType?: 'stored' | 'virtual'
  /** COLLATE value */
  collate?: string
  /** Column-level CHECK constraint expression */
  check?: string
}

/**
 * Foreign key constraint definition.
 */
export interface ForeignKeyConstraint {
  /** Constraint name (optional) */
  name?: string
  /** Child columns (in this table) */
  columns: string[]
  /** Parent table */
  references: string
  /** Parent columns */
  refColumns: string[]
  /** ON DELETE action */
  onDelete?: ForeignKeyAction
  /** ON UPDATE action */
  onUpdate?: ForeignKeyAction
  /** Deferrable mode */
  deferrable?: 'DEFERRED' | 'IMMEDIATE' | false
}

/**
 * Table-level CHECK constraint.
 */
export interface CheckConstraint {
  /** Constraint name (optional) */
  name?: string
  /** Check expression */
  expression: string
}

/**
 * Checks if an identifier needs quoting in SQLite.
 *
 * Quoting is required for:
 * - Reserved keywords (ORDER, TABLE, etc.)
 * - Identifiers starting with a digit
 * - Identifiers containing spaces or special characters
 * - Empty strings
 *
 * @param identifier - The identifier to check
 * @returns True if the identifier needs to be quoted
 */
export function needsQuoting(identifier: string): boolean {
  if (!identifier || identifier.length === 0) {
    return true
  }

  // Reserved keywords need quoting
  if (SQLITE_RESERVED_KEYWORDS.has(identifier.toUpperCase())) {
    return true
  }

  // Starts with a digit
  if (/^\d/.test(identifier)) {
    return true
  }

  // Contains anything other than alphanumeric and underscore
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(identifier)) {
    return true
  }

  return false
}

/**
 * Quotes an identifier for use in DDL if necessary.
 *
 * Uses double quotes (SQL standard) and escapes embedded double quotes.
 *
 * @param identifier - The identifier to quote
 * @returns The quoted identifier, or the original if quoting isn't needed
 */
export function quoteIdentifier(identifier: string): string {
  if (!needsQuoting(identifier)) {
    return identifier
  }

  // Escape embedded double quotes by doubling them
  const escaped = identifier.replace(/"/g, '""')
  return `"${escaped}"`
}

/**
 * Quotes an identifier unconditionally.
 *
 * @param identifier - The identifier to quote
 * @returns The quoted identifier
 */
export function forceQuoteIdentifier(identifier: string): string {
  const escaped = identifier.replace(/"/g, '""')
  return `"${escaped}"`
}

/**
 * Generates a column definition SQL fragment.
 *
 * @param col - Column definition
 * @param includePrimaryKey - Whether to include PRIMARY KEY in column def
 * @returns SQL fragment for the column definition
 */
export function generateColumnDef(
  col: ColumnDefinition,
  includePrimaryKey = true
): string {
  const parts: string[] = [quoteIdentifier(col.name)]

  // Type (always included, even if empty)
  if (col.type) {
    parts.push(col.type)
  }

  // Generated column
  if (col.generatedAs) {
    const storageType = col.generatedType === 'stored' ? 'STORED' : 'VIRTUAL'
    parts.push(`GENERATED ALWAYS AS (${col.generatedAs}) ${storageType}`)
  } else {
    // Non-generated columns can have PRIMARY KEY, etc.
    if (includePrimaryKey && col.primaryKey && col.primaryKey > 0) {
      parts.push('PRIMARY KEY')
      if (col.autoincrement) {
        parts.push('AUTOINCREMENT')
      }
    }

    if (col.notNull) {
      parts.push('NOT NULL')
    }

    if (col.unique) {
      parts.push('UNIQUE')
    }

    if (col.defaultValue !== undefined && col.defaultValue !== null) {
      parts.push(`DEFAULT ${col.defaultValue}`)
    }

    if (col.collate) {
      parts.push(`COLLATE ${col.collate}`)
    }

    if (col.check) {
      parts.push(`CHECK (${col.check})`)
    }
  }

  return parts.join(' ')
}

/**
 * Generates a foreign key constraint SQL fragment.
 *
 * @param fk - Foreign key constraint definition
 * @returns SQL fragment for the foreign key constraint
 */
export function generateForeignKeyConstraint(fk: ForeignKeyConstraint): string {
  const parts: string[] = []

  if (fk.name) {
    parts.push(`CONSTRAINT ${quoteIdentifier(fk.name)}`)
  }

  parts.push('FOREIGN KEY')
  parts.push(`(${fk.columns.map(quoteIdentifier).join(', ')})`)
  parts.push('REFERENCES')
  parts.push(quoteIdentifier(fk.references))
  parts.push(`(${fk.refColumns.map(quoteIdentifier).join(', ')})`)

  if (fk.onDelete && fk.onDelete !== 'NO ACTION') {
    parts.push(`ON DELETE ${fk.onDelete}`)
  }

  if (fk.onUpdate && fk.onUpdate !== 'NO ACTION') {
    parts.push(`ON UPDATE ${fk.onUpdate}`)
  }

  if (fk.deferrable === 'DEFERRED') {
    parts.push('DEFERRABLE INITIALLY DEFERRED')
  } else if (fk.deferrable === 'IMMEDIATE') {
    parts.push('DEFERRABLE INITIALLY IMMEDIATE')
  }

  return parts.join(' ')
}

/**
 * Generates a CHECK constraint SQL fragment.
 *
 * @param check - Check constraint definition
 * @returns SQL fragment for the check constraint
 */
export function generateCheckConstraint(check: CheckConstraint): string {
  if (check.name) {
    return `CONSTRAINT ${quoteIdentifier(check.name)} CHECK (${check.expression})`
  }
  return `CHECK (${check.expression})`
}

/**
 * Generates a CREATE TABLE SQL statement.
 *
 * @param table - Table definition
 * @returns Complete CREATE TABLE SQL statement
 */
export function createTable(table: TableDefinition): string {
  const lines: string[] = []

  // Determine if we need table-level PRIMARY KEY
  const hasColumnLevelPK = table.columns.some(
    (col) => col.primaryKey && col.primaryKey > 0
  )
  const hasTableLevelPK = table.primaryKey && table.primaryKey.length > 0
  const useTableLevelPK = hasTableLevelPK && !hasColumnLevelPK

  // Generate column definitions
  for (const col of table.columns) {
    // If we're using table-level PK, don't include PK in column def
    const includePK = !useTableLevelPK
    lines.push(generateColumnDef(col, includePK))
  }

  // Table-level PRIMARY KEY
  if (useTableLevelPK && table.primaryKey) {
    lines.push(
      `PRIMARY KEY (${table.primaryKey.map(quoteIdentifier).join(', ')})`
    )
  }

  // Foreign key constraints
  if (table.foreignKeys) {
    for (const fk of table.foreignKeys) {
      lines.push(generateForeignKeyConstraint(fk))
    }
  }

  // CHECK constraints
  if (table.checkConstraints) {
    for (const check of table.checkConstraints) {
      lines.push(generateCheckConstraint(check))
    }
  }

  // Build the CREATE TABLE statement
  const parts: string[] = ['CREATE TABLE']

  if (table.ifNotExists) {
    parts.push('IF NOT EXISTS')
  }

  parts.push(quoteIdentifier(table.name))

  const tableDef = `(
  ${lines.join(',\n  ')}
)`

  parts.push(tableDef)

  if (table.withoutRowid) {
    parts.push('WITHOUT ROWID')
  }

  if (table.strict) {
    parts.push('STRICT')
  }

  return parts.join(' ')
}

/**
 * Options for ALTER TABLE ADD COLUMN.
 */
export interface AddColumnOptions {
  /** Table name */
  table: string
  /** Column definition */
  column: ColumnDefinition
}

/**
 * Generates an ALTER TABLE ADD COLUMN statement.
 *
 * Note: SQLite has restrictions on ADD COLUMN:
 * - Cannot add PRIMARY KEY columns
 * - Cannot add UNIQUE columns (unless the table is empty)
 * - DEFAULT must be a constant (not expression like CURRENT_TIMESTAMP for non-empty tables)
 *
 * @param options - Add column options
 * @returns ALTER TABLE ADD COLUMN SQL statement
 */
export function alterTableAddColumn(options: AddColumnOptions): string {
  // For ALTER TABLE, we never include PRIMARY KEY in column def
  const colDef = generateColumnDef(
    { ...options.column, primaryKey: undefined },
    false
  )

  return `ALTER TABLE ${quoteIdentifier(options.table)} ADD COLUMN ${colDef}`
}

/**
 * Options for ALTER TABLE RENAME TO.
 */
export interface RenameTableOptions {
  /** Current table name */
  from: string
  /** New table name */
  to: string
}

/**
 * Generates an ALTER TABLE RENAME TO statement.
 *
 * @param options - Rename table options
 * @returns ALTER TABLE RENAME TO SQL statement
 */
export function alterTableRename(options: RenameTableOptions): string {
  return `ALTER TABLE ${quoteIdentifier(options.from)} RENAME TO ${quoteIdentifier(options.to)}`
}

/**
 * Options for ALTER TABLE RENAME COLUMN.
 */
export interface RenameColumnOptions {
  /** Table name */
  table: string
  /** Current column name */
  from: string
  /** New column name */
  to: string
}

/**
 * Generates an ALTER TABLE RENAME COLUMN statement.
 *
 * Note: Requires SQLite 3.25.0+
 *
 * @param options - Rename column options
 * @returns ALTER TABLE RENAME COLUMN SQL statement
 */
export function alterTableRenameColumn(options: RenameColumnOptions): string {
  return `ALTER TABLE ${quoteIdentifier(options.table)} RENAME COLUMN ${quoteIdentifier(options.from)} TO ${quoteIdentifier(options.to)}`
}

/**
 * Options for ALTER TABLE DROP COLUMN.
 */
export interface DropColumnOptions {
  /** Table name */
  table: string
  /** Column name to drop */
  column: string
}

/**
 * Generates an ALTER TABLE DROP COLUMN statement.
 *
 * Note: Requires SQLite 3.35.0+. Has restrictions:
 * - Cannot drop PRIMARY KEY columns
 * - Cannot drop columns referenced by FK constraints
 * - Cannot drop columns referenced by indexes or triggers
 *
 * @param options - Drop column options
 * @returns ALTER TABLE DROP COLUMN SQL statement
 */
export function alterTableDropColumn(options: DropColumnOptions): string {
  return `ALTER TABLE ${quoteIdentifier(options.table)} DROP COLUMN ${quoteIdentifier(options.column)}`
}

/**
 * Converts a ColumnInfo (from PRAGMA table_xinfo) to a ColumnDefinition.
 *
 * @param info - Column info from database introspection
 * @returns Column definition for DDL generation
 */
export function columnInfoToDefinition(info: ColumnInfo): ColumnDefinition {
  const def: ColumnDefinition = {
    name: info.name,
    type: info.type || '',
    notNull: info.notnull,
    primaryKey: info.pk > 0 ? info.pk : undefined,
  }

  if (info.dfltValue !== null) {
    def.defaultValue = info.dfltValue
  }

  if (info.generated) {
    def.generatedType = info.generated
    // Note: generatedAs expression not available from table_xinfo,
    // would need to parse the original CREATE TABLE SQL
  }

  return def
}

/**
 * Converts ForeignKeyInfo items to a ForeignKeyConstraint.
 *
 * Groups related FK info items (same id) into a single constraint.
 *
 * @param infos - Foreign key info items (all with same id)
 * @returns Foreign key constraint definition
 */
export function foreignKeyInfoToConstraint(
  infos: ForeignKeyInfo[]
): ForeignKeyConstraint {
  if (infos.length === 0) {
    throw new Error('Cannot create FK constraint from empty array')
  }

  // Sort by sequence/position if needed (they should already be in order)
  const first = infos[0]

  return {
    columns: infos.map((i) => i.childColumn),
    references: first.parentTable,
    refColumns: infos.map((i) => i.parentColumn),
    onDelete: first.onDelete,
    onUpdate: first.onUpdate,
  }
}

/**
 * Groups ForeignKeyInfo items by constraint ID.
 *
 * @param infos - All foreign key infos for a table
 * @returns Map of constraint ID to list of infos
 */
export function groupForeignKeyInfos(
  infos: ForeignKeyInfo[]
): Map<number, ForeignKeyInfo[]> {
  const groups = new Map<number, ForeignKeyInfo[]>()

  for (const info of infos) {
    const existing = groups.get(info.id) || []
    existing.push(info)
    groups.set(info.id, existing)
  }

  return groups
}
