/**
 * UI and feature-state related types.
 */

import type { QueryResult } from './query';
import type { ForeignKeyAction } from './schema';

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
