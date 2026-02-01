/**
 * WASM SQLite Database Engine
 *
 * Core database engine integration using wa-sqlite.
 * Handles WASM initialization, query execution, and error normalization.
 */

import * as SQLite from '@journeyapps/wa-sqlite';
import SQLiteESMFactory from '@journeyapps/wa-sqlite/dist/wa-sqlite-async.mjs';
import wasmUrl from '@journeyapps/wa-sqlite/dist/wa-sqlite-async.wasm?url';
import { initializeVFS, type VFSInitResult } from './opfs-vfs';

import type { QueryResult, QueryRow, WorkerErrorCode } from '../../types';
import {
  progressHandlerCallback,
  isInterruptError,
} from '../../worker/query-cancel';

// =============================================================================
// Types
// =============================================================================

/**
 * SQLite error with code and message
 */
export interface SQLiteError {
  code: WorkerErrorCode;
  message: string;
  sql?: string;
  sqliteCode?: number;
}

/**
 * Result of exec (DDL/DML without result set)
 */
export interface ExecResult {
  rowsAffected: number;
  lastInsertId: number;
}

/**
 * Database engine state
 */
type EngineState = 'uninitialized' | 'initializing' | 'ready' | 'error';

// =============================================================================
// SQLite Error Code Mapping
// =============================================================================

/**
 * Map SQLite error codes to WorkerErrorCode
 */
function mapSQLiteErrorCode(sqliteCode: number): WorkerErrorCode {
  // Check for interrupt/cancellation first
  if (isInterruptError(sqliteCode)) {
    return 'CANCELED';
  }

  // Primary error codes from sqlite-constants.js
  switch (sqliteCode) {
    case SQLite.SQLITE_CONSTRAINT:
    case SQLite.SQLITE_CONSTRAINT_CHECK:
    case SQLite.SQLITE_CONSTRAINT_FOREIGNKEY:
    case SQLite.SQLITE_CONSTRAINT_NOTNULL:
    case SQLite.SQLITE_CONSTRAINT_PRIMARYKEY:
    case SQLite.SQLITE_CONSTRAINT_UNIQUE:
      return 'CONSTRAINT_VIOLATION';
    case SQLite.SQLITE_ERROR:
      return 'SYNTAX_ERROR';
    case SQLite.SQLITE_CORRUPT:
    case SQLite.SQLITE_NOTADB:
      return 'CORRUPT_FILE';
    case SQLite.SQLITE_FULL:
      return 'QUOTA_EXCEEDED';
    case SQLite.SQLITE_READONLY:
      return 'LOCK_HELD';
    case SQLite.SQLITE_NOTFOUND:
    case SQLite.SQLITE_CANTOPEN:
      return 'NOT_FOUND';
    default:
      return 'UNKNOWN';
  }
}

/**
 * Extract error info from SQLite exception
 */
function normalizeError(err: unknown, sql?: string): SQLiteError {
  if (err instanceof SQLite.SQLiteError) {
    return {
      code: mapSQLiteErrorCode(err.code),
      message: err.message,
      sql,
      sqliteCode: err.code,
    };
  }

  if (err instanceof Error) {
    // Check for common error patterns in message
    const msg = err.message.toLowerCase();
    let code: WorkerErrorCode = 'UNKNOWN';

    // Check for interrupt/canceled first
    if (msg.includes('interrupt') || msg.includes('canceled') || msg.includes('cancelled')) {
      code = 'CANCELED';
    } else if (msg.includes('syntax') || msg.includes('near')) {
      code = 'SYNTAX_ERROR';
    } else if (msg.includes('constraint') || msg.includes('unique') || msg.includes('foreign key')) {
      code = 'CONSTRAINT_VIOLATION';
    } else if (msg.includes('corrupt') || msg.includes('not a database')) {
      code = 'CORRUPT_FILE';
    } else if (msg.includes('quota') || msg.includes('full')) {
      code = 'QUOTA_EXCEEDED';
    }

    return {
      code,
      message: err.message,
      sql,
    };
  }

  return {
    code: 'UNKNOWN',
    message: String(err),
    sql,
  };
}

// =============================================================================
// Database Engine Class
// =============================================================================

/**
 * WASM SQLite Database Engine
 *
 * Provides core database operations:
 * - exec(sql): Execute SQL without result set (DDL, DML)
 * - query(sql, params?): Execute SQL and return rows
 * - Parameterized queries with ? placeholders
 */
export class DatabaseEngine {
  private sqlite3: ReturnType<typeof SQLite.Factory> | null = null;
  private db: number | null = null;
  private vfs: VFSInitResult['vfs'] | null = null;
  private state: EngineState = 'uninitialized';
  private initPromise: Promise<void> | null = null;
  private dbName: string | null = null;

  /**
   * Initialize the WASM SQLite module
   *
   * This must be called before any database operations.
   * Safe to call multiple times - subsequent calls return immediately.
   */
  async initialize(): Promise<void> {
    if (this.state === 'ready') {
      return;
    }

    if (this.state === 'initializing' && this.initPromise) {
      return this.initPromise;
    }

    if (this.state === 'error') {
      // Reset state to allow retry
      this.state = 'uninitialized';
    }

    this.state = 'initializing';

    this.initPromise = this._doInitialize();

    try {
      await this.initPromise;
      this.state = 'ready';
    } catch (err) {
      this.state = 'error';
      throw err;
    }
  }

  private async _doInitialize(): Promise<void> {
    try {
      // Load the WASM module
      const resolvedWasmUrl = resolveWasmUrl(wasmUrl);
      const module = await SQLiteESMFactory({
        locateFile: (file: string) => (file.endsWith('.wasm') ? resolvedWasmUrl : file),
      });

      // Build the SQLite API
      this.sqlite3 = SQLite.Factory(module);

      // Initialize OPFS VFS with IDB fallback for persistence
      const vfsInit = await initializeVFS(module, this.sqlite3);
      this.vfs = vfsInit.vfs;
    } catch (err) {
      const normalized = normalizeError(err);
      throw new Error(`WASM initialization failed: ${normalized.message}`);
    }
  }

  /**
   * Check if the engine is ready for operations
   */
  isReady(): boolean {
    return this.state === 'ready' && this.sqlite3 !== null;
  }

  /**
   * Get current engine state
   */
  getState(): EngineState {
    return this.state;
  }

  /**
   * Open or create a database
   *
   * @param name Database name or file path (used as filename in VFS)
   * @param vfsName Optional VFS name override
   * @param options Open options (readOnly / createIfMissing)
   */
  async open(
    name: string,
    vfsName?: string,
    options?: { readOnly?: boolean; createIfMissing?: boolean }
  ): Promise<void> {
    if (!this.isReady() || !this.sqlite3) {
      throw new Error('Engine not initialized. Call initialize() first.');
    }

    // Close existing database if open
    if (this.db !== null) {
      await this.close();
    }

    try {
      const readOnly = options?.readOnly ?? false;
      const createIfMissing = options?.createIfMissing ?? false;

      // For OPFS mode with createIfMissing, we need READWRITE+CREATE even when the caller
      // wants read-only access. This is because:
      // 1. OPFSCoopSyncVFS has an internal accessiblePaths cache that may not include files
      //    written directly to OPFS (bypassing the VFS)
      // 2. The VFS only properly initializes persistent file handles when SQLITE_OPEN_MAIN_DB
      //    is set, which SQLite only adds for READWRITE mode
      // 3. Using READONLY+CREATE causes the VFS to skip the MAIN_DB path and may truncate
      //    unbound access handles (destroying file contents)
      // We enforce read-only via PRAGMA query_only = ON after opening.
      let flags: number;
      if (createIfMissing) {
        // Always use READWRITE+CREATE for VFS compatibility
        flags = SQLite.SQLITE_OPEN_READWRITE | SQLite.SQLITE_OPEN_CREATE;
      } else {
        flags = readOnly ? SQLite.SQLITE_OPEN_READONLY : SQLite.SQLITE_OPEN_READWRITE;
      }

      this.db = await this.sqlite3.open_v2(name, flags, vfsName);
      this.dbName = name;

      // Set up progress handler for cancellation support
      // Check every 1000 VM instructions for cancel requests
      this.sqlite3.progress_handler(this.db, 1000, progressHandlerCallback, null);

      // Enforce read-only at the connection level as a safety net
      if (readOnly) {
        await this.exec('PRAGMA query_only = ON');
      }
    } catch (err) {
      const normalized = normalizeError(err);
      throw new Error(`Failed to open database '${name}': ${normalized.message}`);
    }
  }

  /**
   * Close the current database
   */
  async close(): Promise<void> {
    if (this.db !== null && this.sqlite3) {
      try {
        await this.sqlite3.close(this.db);
      } catch {
        // Ignore close errors
      }
      this.db = null;
      this.dbName = null;
    }
  }

  /**
   * Get the current database name
   */
  getDbName(): string | null {
    return this.dbName;
  }

  /**
   * Execute SQL without returning a result set (DDL, DML)
   *
   * Use this for CREATE, INSERT, UPDATE, DELETE, etc.
   *
   * @param sql SQL statement to execute
   * @param params Optional parameters for ? placeholders
   * @returns Execution result with rowsAffected and lastInsertId
   */
  async exec(sql: string, params?: unknown[]): Promise<ExecResult> {
    this._ensureOpen();

    try {
      if (params && params.length > 0) {
        // Use parameterized execution
        await this._execParameterized(sql, params);
      } else {
        // Direct execution for simple statements
        await this.sqlite3!.exec(this.db!, sql);
      }

      return {
        rowsAffected: this.sqlite3!.changes(this.db!),
        lastInsertId: this.sqlite3!.last_insert_id(this.db!),
      };
    } catch (err) {
      throw normalizeError(err, sql);
    }
  }

  /**
   * Execute SQL and return result rows
   *
   * Use this for SELECT statements.
   *
   * @param sql SQL statement to execute
   * @param params Optional parameters for ? placeholders
   * @returns Query result with columns and rows
   */
  async query(sql: string, params?: unknown[]): Promise<QueryResult> {
    this._ensureOpen();

    const columns: string[] = [];
    const columnTypes: string[] = [];
    const rows: QueryRow[] = [];

    try {
      // Use the statements iterator for parameterized queries
      for await (const stmt of this.sqlite3!.statements(this.db!, sql)) {
        // Bind parameters if provided
        if (params && params.length > 0) {
          this.sqlite3!.bind_collection(stmt, params as SQLite.SQLiteCompatibleType[]);
        }

        // Get column metadata on first iteration
        if (columns.length === 0) {
          const count = this.sqlite3!.column_count(stmt);
          for (let i = 0; i < count; i++) {
            columns.push(this.sqlite3!.column_name(stmt, i));
            // Get column type - will be determined per-row for actual data
            columnTypes.push(''); // Placeholder, updated on first row
          }
        }

        // Fetch all rows
        while ((await this.sqlite3!.step(stmt)) === SQLite.SQLITE_ROW) {
          const row: QueryRow = [];

          // Update column types from first row if not set
          const count = this.sqlite3!.column_count(stmt);
          for (let i = 0; i < count; i++) {
            const type = this.sqlite3!.column_type(stmt, i);

            // Update column type hint if not set
            if (rows.length === 0 && columnTypes[i] === '') {
              columnTypes[i] = this._sqliteTypeToString(type);
            }

            // Get value based on type
            const value = this._extractColumnValue(stmt, i, type);
            row.push(value);
          }

          rows.push(row);
        }
      }

      return {
        columns,
        columnTypes,
        rows,
        rowsAffected: this.sqlite3!.changes(this.db!),
      };
    } catch (err) {
      throw normalizeError(err, sql);
    }
  }

  /**
   * Execute parameterized SQL statement
   */
  private async _execParameterized(sql: string, params: unknown[]): Promise<void> {
    for await (const stmt of this.sqlite3!.statements(this.db!, sql)) {
      this.sqlite3!.bind_collection(stmt, params as SQLite.SQLiteCompatibleType[]);

      // Step through the statement to completion
      while ((await this.sqlite3!.step(stmt)) === SQLite.SQLITE_ROW) {
        // Consume any results
      }
    }
  }

  /**
   * Extract column value from a statement
   */
  private _extractColumnValue(
    stmt: number,
    index: number,
    type: number,
  ): null | number | string | Uint8Array {
    switch (type) {
      case SQLite.SQLITE_NULL:
        return null;
      case SQLite.SQLITE_INTEGER: {
        // Use column() which handles BigInt for large integers
        const val = this.sqlite3!.column(stmt, index);
        // Convert BigInt to number if safe, otherwise to string
        if (typeof val === 'bigint') {
          if (val >= Number.MIN_SAFE_INTEGER && val <= Number.MAX_SAFE_INTEGER) {
            return Number(val);
          }
          // Return as string for very large integers
          return val.toString();
        }
        return val as number;
      }
      case SQLite.SQLITE_FLOAT:
        return this.sqlite3!.column_double(stmt, index);
      case SQLite.SQLITE_TEXT:
        return this.sqlite3!.column_text(stmt, index);
      case SQLite.SQLITE_BLOB:
        // Make a copy of the blob data
        return this.sqlite3!.column_blob(stmt, index).slice();
      default:
        return null;
    }
  }

  /**
   * Convert SQLite type constant to string
   */
  private _sqliteTypeToString(type: number): string {
    switch (type) {
      case SQLite.SQLITE_INTEGER:
        return 'INTEGER';
      case SQLite.SQLITE_FLOAT:
        return 'REAL';
      case SQLite.SQLITE_TEXT:
        return 'TEXT';
      case SQLite.SQLITE_BLOB:
        return 'BLOB';
      case SQLite.SQLITE_NULL:
        return 'NULL';
      default:
        return 'UNKNOWN';
    }
  }

  /**
   * Ensure database is open
   */
  private _ensureOpen(): void {
    if (!this.isReady() || !this.sqlite3) {
      throw new Error('Engine not initialized. Call initialize() first.');
    }
    if (this.db === null) {
      throw new Error('No database open. Call open(name) first.');
    }
  }

  /**
   * Shutdown the engine and clean up resources
   */
  async shutdown(): Promise<void> {
    await this.close();

    if (this.vfs) {
      await this.vfs.close();
      this.vfs = null;
    }

    this.sqlite3 = null;
    this.state = 'uninitialized';
    this.initPromise = null;
  }
}

function resolveWasmUrl(url: string): string {
  // Absolute/data/blob URLs can be used directly.
  if (/^(https?:|data:|blob:)/.test(url)) {
    return url;
  }

  // Handle blob-based workers by extracting the origin from the blob URL.
  try {
    if (typeof self !== 'undefined' && 'location' in self && self.location?.href) {
      const locationUrl = new URL(self.location.href);
      if (locationUrl.origin && locationUrl.origin !== 'null') {
        return new URL(url, locationUrl.origin).toString();
      }
    }
  } catch {
    // Fall through to import.meta.url resolution.
  }

  return new URL(url, import.meta.url).toString();
}

// =============================================================================
// Module-level Singleton (for worker context)
// =============================================================================

let _engineInstance: DatabaseEngine | null = null;

/**
 * Get the singleton database engine instance
 *
 * Creates the instance on first call. Safe to call multiple times.
 */
export function getEngine(): DatabaseEngine {
  if (!_engineInstance) {
    _engineInstance = new DatabaseEngine();
  }
  return _engineInstance;
}

/**
 * Reset the engine singleton
 *
 * Call this after shutdown() to ensure a completely fresh engine instance
 * is created on the next getEngine() call. This is necessary because shutdown()
 * clears internal state but doesn't remove the singleton reference, which can
 * cause issues when reinitializing (e.g., VFS re-registration conflicts).
 *
 * Use this when you need a full reset (e.g., after clearing storage).
 */
export function resetEngine(): void {
  _engineInstance = null;
}

/**
 * Type alias for SQLiteCompatibleType from wa-sqlite
 */
declare module '@journeyapps/wa-sqlite' {
  export type SQLiteCompatibleType = number | string | Uint8Array | number[] | bigint | null;
}
