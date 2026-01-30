/**
 * Query-related types.
 */

/**
 * Result of a SQL query execution
 */
export interface QueryResult {
  /** Column names in order */
  columns: string[];
  /** Column types (from SQLite affinity or declared type) */
  columnTypes: string[];
  /** Rows as arrays of values (null, number, string, or Uint8Array for BLOB) */
  rows: QueryRow[];
  /** Number of rows affected (for INSERT/UPDATE/DELETE) */
  rowsAffected?: number;
  /** Total rows available (for pagination) */
  totalRows?: number;
  /** Whether more rows are available beyond the fetched window */
  hasMore?: boolean;
}

/**
 * A single row in a query result
 */
export type QueryRow = (null | number | string | Uint8Array)[];

/**
 * Query history item stored in localStorage
 */
export interface QueryHistoryItem {
  /** The SQL query text */
  sql: string;
  /** When the query was executed (ISO 8601) */
  executedAt: string;
}
