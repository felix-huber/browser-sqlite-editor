/**
 * Schema Introspection for SQLite
 *
 * Provides functions to query and parse SQLite schema metadata:
 * - Tables, views, and indexes from sqlite_master
 * - Column info from PRAGMA table_xinfo (includes generated columns)
 * - Index details from PRAGMA index_list and index_info
 * - Foreign key relationships from PRAGMA foreign_key_list
 */

import type {
  SchemaInfo,
  TableInfo,
  ColumnInfo,
  IndexInfo,
  ForeignKeyInfo,
  ForeignKeyAction,
  QueryResult,
} from '../../types';

// =============================================================================
// Types for PRAGMA Results
// =============================================================================

/**
 * Row from sqlite_master table
 */
interface SqliteMasterRow {
  type: string;
  name: string;
  tbl_name: string;
  sql: string | null;
}

/**
 * Row from PRAGMA table_xinfo
 * Returns: cid, name, type, notnull, dflt_value, pk, hidden
 * hidden: 0 = normal, 1 = hidden (virtual table), 2 = virtual generated, 3 = stored generated
 */
interface TableXInfoRow {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
  hidden: number;
}

/**
 * Row from PRAGMA index_list
 * Returns: seq, name, unique, origin, partial
 */
interface IndexListRow {
  seq: number;
  name: string;
  unique: number;
  origin: string;
  partial: number;
}

/**
 * Row from PRAGMA index_info
 * Returns: seqno, cid, name
 */
interface IndexInfoRow {
  seqno: number;
  cid: number;
  name: string | null;
}

/**
 * Row from PRAGMA foreign_key_list
 * Returns: id, seq, table, from, to, on_update, on_delete, match
 */
interface ForeignKeyListRow {
  id: number;
  seq: number;
  table: string;
  from: string;
  to: string;
  on_update: string;
  on_delete: string;
  match: string;
}

// =============================================================================
// Query Executor Type
// =============================================================================

/**
 * Function type for executing SQL queries
 * This allows the schema functions to be used with different query backends
 */
export type QueryExecutor = (sql: string, params?: unknown[]) => Promise<QueryResult>;

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Convert QueryResult rows to typed objects
 */
function rowsToObjects<T>(result: QueryResult): T[] {
  const { columns, rows } = result;
  return rows.map((row) => {
    const obj: Record<string, unknown> = {};
    columns.forEach((col, i) => {
      obj[col] = row[i];
    });
    return obj as T;
  });
}

/**
 * Parse FK action string to typed ForeignKeyAction
 */
function parseForeignKeyAction(action: string): ForeignKeyAction {
  const normalized = action.toUpperCase().replace('_', ' ');
  switch (normalized) {
    case 'NO ACTION':
      return 'NO ACTION';
    case 'RESTRICT':
      return 'RESTRICT';
    case 'SET NULL':
      return 'SET NULL';
    case 'SET DEFAULT':
      return 'SET DEFAULT';
    case 'CASCADE':
      return 'CASCADE';
    default:
      return 'NO ACTION';
  }
}

/**
 * Detect if a table is WITHOUT ROWID from its CREATE TABLE SQL
 */
function isWithoutRowid(createSql: string | null): boolean {
  if (!createSql) return false;
  // WITHOUT ROWID appears at the end of the CREATE TABLE statement
  return /WITHOUT\s+ROWID\s*$/i.test(createSql);
}

/**
 * Detect if a table is a virtual table from its CREATE SQL
 */
function isVirtualTable(createSql: string | null): boolean {
  if (!createSql) return false;
  return /^\s*CREATE\s+VIRTUAL\s+TABLE/i.test(createSql);
}

// =============================================================================
// Schema Introspection Functions
// =============================================================================

/**
 * Get complete schema information for the database
 *
 * Queries sqlite_master to get lists of tables, views, and indexes.
 * Excludes SQLite internal objects (sqlite_*) and auto-indexes.
 *
 * @param query - Function to execute SQL queries
 * @returns SchemaInfo with tables, views, and indexes arrays
 */
export async function getSchemaInfo(query: QueryExecutor): Promise<SchemaInfo> {
  const result = await query(
    `SELECT type, name, tbl_name, sql
     FROM sqlite_master
     WHERE type IN ('table', 'view', 'index')
       AND name NOT LIKE 'sqlite_%'
     ORDER BY type, name`,
  );

  const rows = rowsToObjects<SqliteMasterRow>(result);

  const tables: string[] = [];
  const views: string[] = [];
  const indexes: string[] = [];

  for (const row of rows) {
    switch (row.type) {
      case 'table':
        tables.push(row.name);
        break;
      case 'view':
        views.push(row.name);
        break;
      case 'index':
        // Only include user-created indexes (those with SQL)
        // Auto-indexes for UNIQUE constraints have sql = null
        if (row.sql !== null) {
          indexes.push(row.name);
        }
        break;
    }
  }

  return { tables, views, indexes };
}

/**
 * Get detailed information about a specific table or view
 *
 * Combines data from:
 * - sqlite_master (CREATE SQL, type detection)
 * - PRAGMA table_xinfo (columns with generated column info)
 * - PRAGMA index_list + index_info (indexes)
 *
 * @param query - Function to execute SQL queries
 * @param tableName - Name of the table or view
 * @returns TableInfo with columns, indexes, and metadata
 */
export async function getTableInfo(query: QueryExecutor, tableName: string): Promise<TableInfo> {
  // Get CREATE SQL and determine type
  const masterResult = await query(
    `SELECT type, sql FROM sqlite_master WHERE name = ? AND type IN ('table', 'view')`,
    [tableName],
  );

  const masterRows = rowsToObjects<{ type: string; sql: string | null }>(masterResult);

  if (masterRows.length === 0) {
    throw new Error(`Table or view '${tableName}' not found`);
  }

  const { type, sql: createSql } = masterRows[0];
  const isView = type === 'view';
  const isVirtual = isVirtualTable(createSql);
  const withoutRowid = isWithoutRowid(createSql);

  // Get column info using table_xinfo (includes generated columns)
  const columnResult = await query(`PRAGMA table_xinfo("${tableName.replace(/"/g, '""')}")`);
  const columnRows = rowsToObjects<TableXInfoRow>(columnResult);

  const columns: ColumnInfo[] = columnRows.map((row) => {
    // Determine generated column type from hidden value
    // 0 = normal, 1 = hidden (virtual table), 2 = virtual generated, 3 = stored generated
    let generated: 'stored' | 'virtual' | null = null;
    if (row.hidden === 2) {
      generated = 'virtual';
    } else if (row.hidden === 3) {
      generated = 'stored';
    }

    return {
      cid: row.cid,
      name: row.name,
      type: row.type,
      notnull: row.notnull === 1,
      dfltValue: row.dflt_value,
      pk: row.pk,
      generated,
      hidden: row.hidden === 1,
    };
  });

  // Get indexes (only for tables, not views)
  const indexes: IndexInfo[] = [];

  if (!isView) {
    const indexListResult = await query(`PRAGMA index_list("${tableName.replace(/"/g, '""')}")`);
    const indexListRows = rowsToObjects<IndexListRow>(indexListResult);

    for (const idx of indexListRows) {
      // Get columns in this index
      const indexInfoResult = await query(`PRAGMA index_info("${idx.name.replace(/"/g, '""')}")`);
      const indexInfoRows = rowsToObjects<IndexInfoRow>(indexInfoResult);

      // Get CREATE INDEX SQL from sqlite_master
      const indexSqlResult = await query(
        `SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?`,
        [idx.name],
      );
      const indexSqlRows = rowsToObjects<{ sql: string | null }>(indexSqlResult);
      const indexSql = indexSqlRows.length > 0 ? indexSqlRows[0].sql : null;

      indexes.push({
        name: idx.name,
        unique: idx.unique === 1,
        partial: idx.partial === 1,
        columns: indexInfoRows
          .sort((a, b) => a.seqno - b.seqno)
          .map((r) => r.name ?? `<expr>`)
          .filter((name): name is string => name !== null),
        createSql: indexSql,
      });
    }
  }

  return {
    name: tableName,
    isView,
    isVirtual,
    withoutRowid,
    columns,
    indexes,
    createSql: createSql ?? '',
  };
}

/**
 * Get all foreign key relationships in the database
 *
 * Iterates through all tables and queries PRAGMA foreign_key_list
 * for each one, collecting all FK constraints.
 *
 * @param query - Function to execute SQL queries
 * @returns Array of ForeignKeyInfo objects
 */
export async function getAllForeignKeys(query: QueryExecutor): Promise<ForeignKeyInfo[]> {
  // Get all tables
  const tablesResult = await query(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`,
  );
  const tables = rowsToObjects<{ name: string }>(tablesResult);

  const foreignKeys: ForeignKeyInfo[] = [];

  for (const { name: tableName } of tables) {
    const fkResult = await query(`PRAGMA foreign_key_list("${tableName.replace(/"/g, '""')}")`);
    const fkRows = rowsToObjects<ForeignKeyListRow>(fkResult);

    for (const fk of fkRows) {
      foreignKeys.push({
        id: fk.id,
        childTable: tableName,
        childColumn: fk.from,
        parentTable: fk.table,
        parentColumn: fk.to,
        onUpdate: parseForeignKeyAction(fk.on_update),
        onDelete: parseForeignKeyAction(fk.on_delete),
        match: fk.match,
      });
    }
  }

  return foreignKeys;
}

/**
 * Get foreign keys for a specific table
 *
 * @param query - Function to execute SQL queries
 * @param tableName - Name of the table
 * @returns Array of ForeignKeyInfo objects for this table
 */
export async function getTableForeignKeys(
  query: QueryExecutor,
  tableName: string,
): Promise<ForeignKeyInfo[]> {
  const fkResult = await query(`PRAGMA foreign_key_list("${tableName.replace(/"/g, '""')}")`);
  const fkRows = rowsToObjects<ForeignKeyListRow>(fkResult);

  return fkRows.map((fk) => ({
    id: fk.id,
    childTable: tableName,
    childColumn: fk.from,
    parentTable: fk.table,
    parentColumn: fk.to,
    onUpdate: parseForeignKeyAction(fk.on_update),
    onDelete: parseForeignKeyAction(fk.on_delete),
    match: fk.match,
  }));
}
