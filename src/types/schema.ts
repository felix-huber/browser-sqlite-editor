/**
 * Schema-related types.
 */

/**
 * Complete schema information for a database
 */
export interface SchemaInfo {
  /** List of table names */
  tables: string[];
  /** List of view names */
  views: string[];
  /** List of index names (user-created, not auto-indexes) */
  indexes: string[];
}

/**
 * Detailed information about a table
 */
export interface TableInfo {
  /** Table name */
  name: string;
  /** Whether this is a view (read-only) */
  isView: boolean;
  /** Whether this is a virtual table */
  isVirtual: boolean;
  /** Whether this is a WITHOUT ROWID table */
  withoutRowid: boolean;
  /** Column definitions */
  columns: ColumnInfo[];
  /** Index definitions */
  indexes: IndexInfo[];
  /** The original CREATE TABLE SQL from sqlite_master */
  createSql: string;
}

/**
 * Column information from PRAGMA table_xinfo
 */
export interface ColumnInfo {
  /** Column index (0-based) */
  cid: number;
  /** Column name */
  name: string;
  /** Declared type (verbatim from schema, e.g., "VARCHAR(255)") */
  type: string;
  /** Whether NOT NULL constraint exists */
  notnull: boolean;
  /** Default value expression (null if none) */
  dfltValue: string | null;
  /** Primary key order (0 if not part of PK, 1+ for PK columns) */
  pk: number;
  /** Generated column type: 'stored', 'virtual', or null for regular columns */
  generated: 'stored' | 'virtual' | null;
  /** Whether this column is hidden (used by virtual tables) */
  hidden: boolean;
}

/**
 * Index information from PRAGMA index_list and PRAGMA index_info
 */
export interface IndexInfo {
  /** Index name */
  name: string;
  /** Whether the index enforces uniqueness */
  unique: boolean;
  /** Whether this is a partial index */
  partial: boolean;
  /** Columns included in the index, in order */
  columns: string[];
  /** The original CREATE INDEX SQL (null for auto-indexes) */
  createSql: string | null;
}

/**
 * Foreign key information from PRAGMA foreign_key_list
 */
export interface ForeignKeyInfo {
  /** FK constraint ID (for grouping composite FKs) */
  id: number;
  /** Child table containing the FK */
  childTable: string;
  /** Child column name */
  childColumn: string;
  /** Parent (referenced) table */
  parentTable: string;
  /** Parent (referenced) column */
  parentColumn: string;
  /** ON UPDATE action */
  onUpdate: ForeignKeyAction;
  /** ON DELETE action */
  onDelete: ForeignKeyAction;
  /** Match type (usually NONE for SQLite) */
  match: string;
}

/**
 * Foreign key referential actions
 */
export type ForeignKeyAction =
  | 'NO ACTION'
  | 'RESTRICT'
  | 'SET NULL'
  | 'SET DEFAULT'
  | 'CASCADE';
