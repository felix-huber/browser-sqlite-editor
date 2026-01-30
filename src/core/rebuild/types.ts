/**
 * Types for table rebuild planning and execution.
 */

import type { ForeignKeyAction } from '../../types';

/**
 * SQLite object types stored in sqlite_master.
 */
export type SqliteObjectType = 'table' | 'index' | 'trigger' | 'view';

/**
 * An object from sqlite_master.
 */
export interface SqliteMasterObject {
  /** Object type */
  type: SqliteObjectType;
  /** Object name */
  name: string;
  /** Table this object is associated with (for indexes/triggers) */
  tblName: string;
  /** Root page (not used for our purposes) */
  rootpage: number;
  /** The SQL statement that created this object */
  sql: string | null;
}

/**
 * Index information extracted from sqlite_master.
 */
export interface IndexObject {
  /** Index name */
  name: string;
  /** Table the index belongs to */
  tableName: string;
  /** Original CREATE INDEX SQL (null for auto-indexes) */
  sql: string | null;
  /** Whether this is an auto-index (created by UNIQUE/PK constraints) */
  isAutoIndex: boolean;
}

/**
 * Trigger information extracted from sqlite_master.
 */
export interface TriggerObject {
  /** Trigger name */
  name: string;
  /** Table the trigger is on */
  tableName: string;
  /** Original CREATE TRIGGER SQL */
  sql: string;
}

/**
 * View that references a table.
 */
export interface ViewReference {
  /** View name */
  name: string;
  /** Original CREATE VIEW SQL */
  sql: string;
}

/**
 * Foreign key from another table pointing to this table.
 */
export interface IncomingForeignKey {
  /** The table containing the FK */
  fromTable: string;
  /** Columns in the referring table */
  fromColumns: string[];
  /** Columns in this table being referenced */
  toColumns: string[];
  /** ON DELETE action */
  onDelete: ForeignKeyAction;
  /** ON UPDATE action */
  onUpdate: ForeignKeyAction;
}

/**
 * All dependent objects for a table.
 */
export interface TableDependents {
  /** Original CREATE TABLE statement */
  createTableSql: string;
  /** User-created indexes on this table */
  indexes: IndexObject[];
  /** Triggers on this table */
  triggers: TriggerObject[];
  /** Views that reference this table */
  views: ViewReference[];
  /** Foreign keys from other tables pointing to this table */
  incomingForeignKeys: IncomingForeignKey[];
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
  | 'fk_check';

/**
 * A single operation in the rebuild plan.
 */
export interface RebuildOperation {
  /** Operation type */
  type: RebuildOperationType;
  /** SQL to execute (if applicable) */
  sql?: string;
  /** Description of the operation */
  description: string;
  /** Object name this operation relates to (for tracking) */
  objectName?: string;
}

/**
 * Complete rebuild plan for a table.
 */
export interface RebuildPlan {
  /** Original table name */
  tableName: string;
  /** List of operations in order */
  operations: RebuildOperation[];
  /** Dependent objects that will be affected */
  dependents: TableDependents;
  /** Whether this plan modifies other tables (for FK updates) */
  affectsOtherTables: boolean;
}

/**
 * Result of a rebuild execution.
 */
export interface RebuildExecutionResult {
  /** Whether the rebuild succeeded */
  success: boolean;
  /** Row count before rebuild (for verification) */
  rowCountBefore: number;
  /** Row count after rebuild (for verification) */
  rowCountAfter: number;
  /** Operations that were executed */
  executedOperations: RebuildOperationType[];
  /** Error message if failed */
  error?: string;
  /** Detailed verification results (only present on failure) */
  verificationFailures?: VerificationFailure[];
}

/**
 * A single verification failure with details about what went wrong.
 */
export interface VerificationFailure {
  /** Type of verification that failed */
  type: 'schema_mismatch' | 'fk_violation' | 'view_broken' | 'trigger_broken';
  /** Name of the affected object (table, view, or trigger name) */
  objectName: string;
  /** Human-readable description of the failure */
  message: string;
  /** Additional details (e.g., expected vs actual for schema) */
  details?: string;
}

/**
 * Options for controlling rebuild verification.
 */
export interface RebuildVerificationOptions {
  /** Whether to verify schema matches after rebuild (default: true) */
  verifySchema?: boolean;
  /** Whether to verify FK integrity (default: true) */
  verifyForeignKeys?: boolean;
  /** Whether to verify dependent views still compile (default: true) */
  verifyViews?: boolean;
  /** Whether to verify triggers (default: true) */
  verifyTriggers?: boolean;
  /** Expected column names in the new schema (for schema verification) */
  expectedColumns?: string[];
}
