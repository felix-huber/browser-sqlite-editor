/**
 * Core TypeScript interfaces for WASM SQLite Editor
 *
 * This module defines all type definitions for:
 * - Worker Protocol (request/response messages)
 * - Database Registry (persistence metadata)
 * - Store Types (Zustand state)
 * - Schema Types (SQLite introspection)
 * - UI Types (component state)
 */

// =============================================================================
// Worker Protocol Types
// =============================================================================

/**
 * All possible request types sent from main thread to worker
 */
export type WorkerRequest =
  | { type: 'ping' }
  | { type: 'open'; dbName: string }
  | { type: 'close' }
  | { type: 'exec'; sql: string; params?: unknown[] }
  | {
      type: 'query';
      sql: string;
      params?: unknown[];
      limit?: number;
      offset?: number;
    }
  | { type: 'import'; file: File; nameHint: string }
  | { type: 'export'; dbName: string }
  | { type: 'schema' }
  | { type: 'tableInfo'; table: string }
  | { type: 'foreignKeys' }
  | { type: 'acquireLock'; dbName: string }
  | { type: 'releaseLock' }
  | { type: 'checkLock'; dbName: string }
  | { type: 'cancel' }
  | { type: 'createDb'; name: string }
  | { type: 'deleteDb'; name: string }
  | { type: 'renameDb'; oldName: string; newName: string }
  | { type: 'getRegistry' }
  | { type: 'flushSnapshot' } // For IndexedDB mode: flush pending snapshot
  | { type: 'flushAndClose'; dbId: string } // Flush pending writes and close database connection
  // Schema modification operations
  | { type: 'createTable'; def: TableDefinitionInput; isReadOnly: boolean }
  | {
      type: 'alterTable';
      table: string;
      action: AlterTableActionInput;
      isReadOnly: boolean;
    }
  | { type: 'dropTable'; table: string; isReadOnly: boolean }
  | { type: 'dropColumn'; table: string; column: string; isReadOnly: boolean };

/**
 * Table definition input for createTable worker request
 */
export interface TableDefinitionInput {
  name: string;
  columns: ColumnDefinitionInput[];
  primaryKey?: string[];
  foreignKeys?: ForeignKeyConstraintInput[];
  withoutRowid?: boolean;
  strict?: boolean;
}

/**
 * Column definition input for schema operations
 */
export interface ColumnDefinitionInput {
  name: string;
  type: string;
  notNull?: boolean;
  defaultValue?: string | null;
  primaryKey?: number;
  autoincrement?: boolean;
  unique?: boolean;
  generatedAs?: string;
  generatedType?: 'stored' | 'virtual';
}

/**
 * Foreign key constraint input for schema operations
 */
export interface ForeignKeyConstraintInput {
  name?: string;
  columns: string[];
  references: string;
  refColumns: string[];
  onDelete?: ForeignKeyAction;
  onUpdate?: ForeignKeyAction;
}

/**
 * Alter table action input types
 */
export type AlterTableActionInput =
  | { type: 'addColumn'; column: ColumnDefinitionInput }
  | { type: 'renameTable'; newName: string }
  | { type: 'renameColumn'; oldName: string; newName: string }

/**
 * Error codes returned by worker
 */
export type WorkerErrorCode =
  | 'QUOTA_EXCEEDED'
  | 'CANCELED'
  | 'INVALID_FILE'
  | 'ENCRYPTED_FILE'
  | 'CORRUPT_FILE'
  | 'LOCK_HELD'
  | 'NOT_FOUND'
  | 'CONSTRAINT_VIOLATION'
  | 'SYNTAX_ERROR'
  | 'PERSISTENCE_FAILED'
  | 'IDB_FLUSH_FAILED'
  // Schema modification error codes
  | 'READ_ONLY'
  | 'INVALID_NAME'
  | 'TABLE_NOT_FOUND'
  | 'COLUMN_NOT_FOUND'
  | 'TABLE_EXISTS'
  | 'COLUMN_EXISTS'
  | 'FOREIGN_KEY_DEPENDENCY'
  | 'UNKNOWN';

/**
 * All possible response types from worker to main thread
 */
export type WorkerResponse =
  | { type: 'success'; data?: unknown }
  | { type: 'pong' }
  | { type: 'error'; message: string; code?: WorkerErrorCode }
  | { type: 'progress'; percent: number; message?: string }
  | { type: 'lockStatus'; isWriter: boolean; holderStale?: boolean }
  | { type: 'storageFull'; dbName: string }
  | { type: 'persistenceDegraded'; dbName: string }
  | { type: 'schemaResult'; schema: SchemaInfo }
  | { type: 'tableInfoResult'; tableInfo: TableInfo }
  | { type: 'queryResult'; result: QueryResult }
  | { type: 'foreignKeysResult'; foreignKeys: ForeignKeyInfo[] }
  | { type: 'registryResult'; registry: DatabaseRegistry }
  | { type: 'flushAndCloseResult'; success: boolean; error?: FlushAndCloseError }
  | { type: 'schemaModificationResult'; success: boolean; error?: SchemaModificationErrorInfo };

/**
 * Error from flushAndClose operation - deterministic for UI prompt
 */
export interface FlushAndCloseError {
  /** Error code - IDB_FLUSH_FAILED for retry exhausted, QUOTA_EXCEEDED for quota issues */
  code: 'IDB_FLUSH_FAILED' | 'QUOTA_EXCEEDED';
  /** Human-readable error message */
  message: string;
  /** Number of attempts made before failure */
  attempts: number;
}

/**
 * Error from schema modification operations
 */
export interface SchemaModificationErrorInfo {
  /** Error code */
  code: WorkerErrorCode;
  /** Human-readable error message */
  message: string;
  /** Additional details about the error */
  details?: string;
}

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

// =============================================================================
// Database Registry Types
// =============================================================================

/**
 * Database registry stored in OPFS/IndexedDB
 */
export interface DatabaseRegistry {
  /** Schema version for future migrations */
  v: 1;
  /** List of persisted databases */
  databases: DatabaseEntry[];
}

/**
 * Metadata for a persisted database
 */
export interface DatabaseEntry {
  /** Display name (user-facing) */
  name: string;
  /** Filename in storage (e.g., "chinook.sqlite") */
  file: string;
  /** When the database was created (ISO 8601 UTC) */
  createdAt: string;
  /** When the database was last opened (ISO 8601 UTC) */
  lastOpenedAt: string;
  /** Whether PRAGMA foreign_keys is enabled for this DB */
  fkEnforced: boolean;
}

/**
 * ERD layout metadata stored per-database
 */
export interface ERDLayout {
  /** Schema version for future migrations */
  v: 1;
  /** Table positions keyed by table name */
  tables: Record<string, TablePosition>;
}

/**
 * Position of a table on the ERD canvas
 */
export interface TablePosition {
  x: number;
  y: number;
}

// =============================================================================
// Schema Types
// =============================================================================

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

// =============================================================================
// Store Types (Zustand)
// =============================================================================

/**
 * Storage mode for persistence
 */
export type StorageMode = 'opfs' | 'idb';

/**
 * Persistence status for status bar
 */
export type PersistenceStatus = 'saved' | 'unsaved' | 'saving' | 'error';

/**
 * Lock holder state
 */
export type LockHolder = 'self' | 'other' | null;

/**
 * Storage status for quota/degradation tracking
 */
export type StorageStatus = 'ok' | 'quota_exceeded' | 'degraded';

/**
 * Active view in main area
 */
export type ActiveView = 'grid' | 'designer' | 'sql' | 'query-builder' | 'erd';

/**
 * Lock state for multi-tab coordination
 */
export interface LockState {
  /** Whether current tab is in read-only mode */
  isReadOnly: boolean;
  /** Who holds the write lock */
  lockHolder: LockHolder;
  /** Whether the lock holder's heartbeat is stale (for fallback mode) */
  lockStale: boolean;
}

/**
 * Main application state (Zustand store)
 */
export interface AppState {
  // --- Registry ---
  /** List of all persisted databases */
  databases: DatabaseEntry[];
  /** Currently active database name (null if none) */
  activeDb: string | null;

  // --- Schema (for active DB) ---
  /** Tables in active database */
  tables: string[];
  /** Views in active database */
  views: string[];
  /** Indexes in active database (user-created) */
  indexes: string[];

  // --- UI State ---
  /** Width of the sidebar in pixels */
  sidebarWidth: number;
  /** Currently selected table/view name */
  activeTable: string | null;
  /** Current view in main area */
  activeView: ActiveView;

  // --- Unsaved-Edit Check (navigation guard) ---
  /** True while a grid cell is being edited (not yet committed) */
  gridEditInProgress: boolean;
  /** True when table designer has unapplied changes */
  designerDraftInProgress: boolean;
  /** True when ERD FK dialog has unapplied changes */
  erdDraftInProgress: boolean;
  /** True when query builder state would be lost on navigation */
  queryBuilderDraftInProgress: boolean;

  // --- Persistence Status ---
  /** Current storage mode */
  storageMode: StorageMode;
  /** Current persistence status */
  persistenceStatus: PersistenceStatus;
  /** Current storage health status */
  storageStatus: StorageStatus;

  // --- Lock State ---
  /** Whether current tab is in read-only mode */
  isReadOnly: boolean;
  /** Who holds the write lock */
  lockHolder: LockHolder;
  /** Whether the lock holder's heartbeat is stale (for fallback mode) */
  lockStale: boolean;
}

// =============================================================================
// UI Component Types
// =============================================================================

/**
 * Grid cell editing state
 */
export interface GridEditState {
  /** Row index being edited */
  rowIndex: number;
  /** Column name being edited */
  columnName: string;
  /** Original value before edit */
  originalValue: unknown;
  /** Current edited value */
  currentValue: unknown;
}

/**
 * Grid sort state
 */
export interface GridSortState {
  /** Column to sort by */
  column: string;
  /** Sort direction */
  direction: 'asc' | 'desc' | 'default';
}

/**
 * Grid filter for a single column
 */
export interface GridColumnFilter {
  /** Column name */
  column: string;
  /** Filter type */
  filterType: 'text' | 'numeric' | 'null';
  /** For text: contains string */
  textValue?: string;
  /** For numeric: min value (inclusive) */
  numericMin?: number;
  /** For numeric: max value (inclusive) */
  numericMax?: number;
  /** For null: filter mode */
  nullMode?: 'is_null' | 'is_not_null';
}

/**
 * Complete grid state
 */
export interface GridState {
  /** Current sort state */
  sort: GridSortState | null;
  /** Active filters */
  filters: GridColumnFilter[];
  /** Current scroll offset (for virtual scrolling) */
  scrollOffset: number;
  /** Currently selected row indices */
  selectedRows: Set<number>;
  /** Current edit state (null if not editing) */
  editState: GridEditState | null;
}

/**
 * Table designer column definition (draft state)
 */
export interface DesignerColumnDraft {
  /** Unique ID for React keys */
  id: string;
  /** Column name */
  name: string;
  /** Declared type */
  type: string;
  /** Is primary key */
  isPrimaryKey: boolean;
  /** Is NOT NULL */
  isNotNull: boolean;
  /** Is UNIQUE */
  isUnique: boolean;
  /** Default value expression */
  defaultValue: string | null;
  /** Whether this is an existing column (vs newly added) */
  isExisting: boolean;
  /** Original name if renamed */
  originalName?: string;
  /** Generated column type: 'stored', 'virtual', or null for regular columns */
  generated?: 'stored' | 'virtual' | null;
  /** Generated column expression (the AS (...) part) */
  generatedExpression?: string | null;
}

/**
 * Table designer state
 */
export interface TableDesignerState {
  /** Table name */
  tableName: string;
  /** Whether editing an existing table (vs creating new) */
  isEditing: boolean;
  /** Column definitions */
  columns: DesignerColumnDraft[];
  /** Columns marked for deletion (by original name) */
  deletedColumns: string[];
  /** Whether there are unsaved changes */
  isDirty: boolean;
}

/**
 * Query builder table on canvas
 */
export interface QueryBuilderTable {
  /** Table name */
  name: string;
  /** Columns available in this table */
  columns: string[];
  /** Columns selected for output */
  selectedColumns: string[];
  /** Position on canvas */
  position: { x: number; y: number };
}

/**
 * Query builder join definition
 */
export interface QueryBuilderJoin {
  /** Join type */
  type: 'INNER' | 'LEFT' | 'RIGHT';
  /** Left table name */
  leftTable: string;
  /** Left column name */
  leftColumn: string;
  /** Right table name */
  rightTable: string;
  /** Right column name */
  rightColumn: string;
}

/**
 * Query builder WHERE condition
 */
export interface QueryBuilderCondition {
  /** Unique ID for React keys */
  id: string;
  /** Table.Column reference */
  column: string;
  /** Operator */
  operator:
    | '='
    | '!='
    | '<'
    | '<='
    | '>'
    | '>='
    | 'LIKE'
    | 'STARTS WITH'
    | 'IS NULL'
    | 'IS NOT NULL';
  /** Value (for operators that need one) */
  value?: string | number;
  /** Value type hint */
  valueType: 'text' | 'number' | 'null';
}

/**
 * Query builder ORDER BY clause
 */
export interface QueryBuilderOrderBy {
  /** Table.Column reference */
  column: string;
  /** Sort direction */
  direction: 'ASC' | 'DESC';
}

/**
 * Query builder state
 */
export interface QueryBuilderState {
  /** Tables on canvas */
  tables: QueryBuilderTable[];
  /** Join definitions */
  joins: QueryBuilderJoin[];
  /** WHERE conditions (all ANDed) */
  conditions: QueryBuilderCondition[];
  /** ORDER BY clauses */
  orderBy: QueryBuilderOrderBy[];
  /** LIMIT value (null for no limit) */
  limit: number | null;
  /** Generated SQL (computed from state) */
  generatedSql: string;
  /** Parameters for the generated SQL */
  generatedParams: unknown[];
}

/**
 * SQL editor state
 */
export interface SqlEditorState {
  /** Current SQL text */
  sql: string;
  /** Whether a query is currently executing */
  isExecuting: boolean;
  /** Last error message (null if none) */
  error: SqlError | null;
  /** Last query results */
  results: QueryResult | null;
  /** Execution summary (for multi-statement) */
  summary: string | null;
}

/**
 * SQL execution error
 */
export interface SqlError {
  /** Error message */
  message: string;
  /** Statement index (0-based) for multi-statement */
  statementIndex?: number;
  /** Line number (1-based) */
  line?: number;
  /** Column number (1-based, if available) */
  column?: number;
}

/**
 * ERD editor state
 */
export interface ErdEditorState {
  /** Whether FK creation is in progress */
  isCreatingFk: boolean;
  /** Source of FK being created */
  fkSource: { table: string; column: string } | null;
  /** Currently selected FK edge ID */
  selectedEdgeId: string | null;
  /** Whether positions have been modified */
  layoutDirty: boolean;
}

/**
 * FK creation/edit dialog state
 */
export interface FkDialogState {
  /** Parent table */
  parentTable: string;
  /** Parent column */
  parentColumn: string;
  /** Child table */
  childTable: string;
  /** Child column */
  childColumn: string;
  /** ON DELETE action */
  onDelete: ForeignKeyAction;
  /** ON UPDATE action */
  onUpdate: ForeignKeyAction;
  /** Whether editing an existing FK */
  isEditing: boolean;
}

// =============================================================================
// Import/Export Types
// =============================================================================

/**
 * Import file type
 */
export type ImportFileType = 'csv' | 'json';

/**
 * Import column mapping
 */
export interface ImportColumnMapping {
  /** Source column name (from file) */
  sourceColumn: string;
  /** Normalized column name (for table) */
  normalizedName: string;
  /** Detected/overridden type */
  type: 'INTEGER' | 'REAL' | 'TEXT';
  /** Whether the name was normalized */
  wasNormalized: boolean;
}

/**
 * Import preview data
 */
export interface ImportPreview {
  /** File type */
  fileType: ImportFileType;
  /** Column mappings */
  columns: ImportColumnMapping[];
  /** First 10 rows for preview */
  previewRows: unknown[][];
  /** Total row count (if known) */
  totalRows?: number;
  /** Warnings (e.g., normalized columns) */
  warnings: string[];
}

/**
 * Import target selection
 */
export interface ImportTarget {
  /** Import mode */
  mode: 'new_table' | 'append';
  /** Table name (auto-generated for new, selected for append) */
  tableName: string;
}

/**
 * Import dialog state
 */
export interface ImportDialogState {
  /** Current step */
  step: 'file' | 'preview' | 'importing' | 'complete' | 'error';
  /** Selected file */
  file: File | null;
  /** Preview data (after file is parsed) */
  preview: ImportPreview | null;
  /** Import target selection */
  target: ImportTarget | null;
  /** Import progress (0-100) */
  progress: number;
  /** Error message (if step === 'error') */
  error: string | null;
}

/**
 * Export format
 */
export type ExportFormat = 'csv' | 'json';

/**
 * Export scope
 */
export type ExportScope = 'database' | 'table' | 'results';

/**
 * Export options
 */
export interface ExportOptions {
  /** Export format (for table/results) */
  format: ExportFormat;
  /** Spreadsheet-safe export (prefix potential formulas) */
  spreadsheetSafe: boolean;
}

/**
 * Export dialog state
 */
export interface ExportDialogState {
  /** Current step */
  step: 'scope' | 'format' | 'exporting' | 'complete' | 'error';
  /** Export scope */
  scope: ExportScope;
  /** Export options */
  options: ExportOptions;
  /** Export progress (0-100) */
  progress: number;
  /** Error message (if step === 'error') */
  error: string | null;
  /** Warnings (e.g., BLOB placeholders) */
  warnings: string[];
}

// =============================================================================
// Validation Types
// =============================================================================

/**
 * Validation result
 */
export interface ValidationResult {
  /** Whether validation passed */
  isValid: boolean;
  /** Error message (if not valid) */
  error?: string;
}

/**
 * Database name validation rules
 */
export interface DatabaseNameRules {
  minLength: 1;
  maxLength: 64;
  /** Allowed: alphanumeric, spaces, hyphens, underscores, dots, parentheses */
  pattern: RegExp;
}

/**
 * Column/Table name validation rules
 */
export interface SchemaNameRules {
  minLength: 1;
  maxLength: 128;
  /** Any printable characters allowed (quoted in DDL if needed) */
  requiresQuoting: (name: string) => boolean;
}

// =============================================================================
// Utility Types
// =============================================================================

/**
 * Deep partial type utility
 */
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

/**
 * Action types for Zustand store
 */
export interface AppActions {
  // Registry actions
  loadRegistry: () => Promise<void>;
  openDb: (name: string) => Promise<void>;
  closeDb: () => Promise<void>;
  createDb: (name: string) => Promise<void>;
  deleteDb: (name: string) => Promise<void>;
  renameDb: (oldName: string, newName: string) => Promise<void>;

  // Schema actions
  loadSchema: () => Promise<void>;
  refreshSchema: () => Promise<void>;

  // UI actions
  setSidebarWidth: (width: number) => void;
  setActiveTable: (table: string | null) => void;
  setActiveView: (view: ActiveView) => void;

  // Edit tracking actions
  setGridEditInProgress: (inProgress: boolean) => void;
  setDesignerDraftInProgress: (inProgress: boolean) => void;
  setErdDraftInProgress: (inProgress: boolean) => void;
  setQueryBuilderDraftInProgress: (inProgress: boolean) => void;

  // Persistence actions
  setPersistenceStatus: (status: PersistenceStatus) => void;
  setStorageStatus: (status: StorageStatus) => void;

  // Lock actions
  acquireLock: (dbName: string) => Promise<boolean>;
  releaseLock: () => Promise<void>;
  setLockState: (state: Partial<LockState>) => void;
}

/**
 * Complete store type (state + actions)
 */
export type AppStore = AppState & AppActions;
