/**
 * Worker protocol types.
 */

import type { QueryResult } from './query';
import type {
  SchemaInfo,
  TableInfo,
  ForeignKeyInfo,
  ForeignKeyAction,
} from './schema';
import type { DatabaseRegistry } from './store';

/**
 * All possible request types sent from main thread to worker
 */
export type WorkerRequest =
  | { type: 'ping' }
  | { type: 'open'; dbName: string; readOnly?: boolean }
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
  | { type: 'dropColumn'; table: string; column: string; isReadOnly: boolean }
  | {
      type: 'rebuildTable';
      table: string;
      newCreateSql: string;
      newColumns: string[];
      columnRenames?: ColumnRenameInput[];
      isReadOnly: boolean;
    }
  | { type: 'getDbSize'; dbName: string };

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
 * Column rename input for rebuild operations
 */
export interface ColumnRenameInput {
  oldName: string;
  newName: string;
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
  | { type: 'renameColumn'; oldName: string; newName: string };

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
  | { type: 'schemaModificationResult'; success: boolean; error?: SchemaModificationErrorInfo }
  | { type: 'dbSizeResult'; sizeBytes: number; storageMode: 'opfs' | 'idb' };

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
