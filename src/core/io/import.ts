/**
 * Transactional data import for SQLite editor.
 * Handles importing parsed CSV/JSON data into tables with batched inserts,
 * progress tracking, and full rollback on error.
 */

import { escapeIdentifier } from '../sql/escape';

export { escapeIdentifier };

export type ColumnType = 'INTEGER' | 'REAL' | 'TEXT' | 'BLOB' | 'NULL';

export interface ColumnDef {
  name: string;
  type: ColumnType;
  originalName?: string;
}

export interface ImportProgress {
  imported: number;
  total: number;
  percent: number;
}

export type ImportProgressCallback = (progress: ImportProgress) => void;

export interface ImportResult {
  success: boolean;
  rowsImported: number;
  tableName: string;
  error?: ImportError;
}

export interface ImportError {
  type: 'CONSTRAINT_VIOLATION' | 'TYPE_COERCION' | 'QUOTA_EXCEEDED' | 'UNKNOWN';
  message: string;
  rowNumber?: number;
  columnName?: string;
  value?: unknown;
}

export interface ImportOptions {
  tableName: string;
  columns: ColumnDef[];
  rows: unknown[][];
  batchSize?: number;
  onProgress?: ImportProgressCallback;
  /** Column type overrides (for BLOB support) */
  typeOverrides?: Record<string, 'BLOB' | 'INTEGER' | 'REAL' | 'TEXT'>;
}

/**
 * Database executor interface for running SQL statements.
 * This abstracts the actual database implementation (e.g., sql.js worker).
 */
export interface DatabaseExecutor {
  exec(sql: string, params?: unknown[]): Promise<void>;
  run(sql: string, params?: unknown[]): Promise<{ changes: number }>;
}

const DEFAULT_BATCH_SIZE = 100;

/**
 * Maps a column type to SQLite type for CREATE TABLE.
 */
function mapToSQLiteType(type: string, override?: string): string {
  if (override) return override;
  switch (type) {
    case 'INTEGER':
      return 'INTEGER';
    case 'REAL':
      return 'REAL';
    case 'BLOB':
      return 'BLOB';
    case 'NULL':
      return 'TEXT'; // NULL type becomes TEXT
    default:
      return 'TEXT';
  }
}

/**
 * Generates a CREATE TABLE statement from column definitions.
 */
export function generateCreateTable(
  tableName: string,
  columns: ColumnDef[],
  typeOverrides?: Record<string, string>
): string {
  const columnDefs = columns.map((col) => {
    const colName = escapeIdentifier(col.name);
    const colType = mapToSQLiteType(col.type, typeOverrides?.[col.name]);
    return `${colName} ${colType}`;
  });

  return `CREATE TABLE ${escapeIdentifier(tableName)} (${columnDefs.join(', ')})`;
}

/**
 * Generates a parameterized INSERT statement.
 */
export function generateInsertStatement(
  tableName: string,
  columns: ColumnDef[]
): string {
  const columnNames = columns.map((col) => escapeIdentifier(col.name)).join(', ');
  const placeholders = columns.map(() => '?').join(', ');
  return `INSERT INTO ${escapeIdentifier(tableName)} (${columnNames}) VALUES (${placeholders})`;
}

/**
 * Decodes a base64 string to Uint8Array for BLOB import.
 */
export function decodeBase64(base64: string): Uint8Array {
  // Handle browser and Node.js environments
  if (typeof atob === 'function') {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  }
  // Node.js fallback
  return new Uint8Array(Buffer.from(base64, 'base64'));
}

/**
 * Processes a row value for insertion, handling type coercion and BLOB decoding.
 */
function processValue(
  value: unknown,
  columnName: string,
  typeOverride?: string
): unknown {
  if (value === null || value === undefined) {
    return null;
  }

  // Handle BLOB columns: decode base64
  if (typeOverride === 'BLOB' && typeof value === 'string') {
    try {
      return decodeBase64(value);
    } catch {
      throw new Error(`Invalid base64 value for BLOB column "${columnName}"`);
    }
  }

  return value;
}

/**
 * Parses an SQLite error message to extract constraint violation details.
 */
function parseConstraintError(message: string): { type: ImportError['type']; detail: string } {
  const lowerMsg = message.toLowerCase();

  if (lowerMsg.includes('unique constraint') || lowerMsg.includes('unique failed')) {
    return { type: 'CONSTRAINT_VIOLATION', detail: 'UNIQUE constraint violated' };
  }
  if (lowerMsg.includes('not null constraint') || lowerMsg.includes('not null failed')) {
    return { type: 'CONSTRAINT_VIOLATION', detail: 'NOT NULL constraint violated' };
  }
  if (lowerMsg.includes('foreign key constraint') || lowerMsg.includes('foreign key failed')) {
    return { type: 'CONSTRAINT_VIOLATION', detail: 'FOREIGN KEY constraint violated' };
  }
  if (lowerMsg.includes('check constraint') || lowerMsg.includes('check failed')) {
    return { type: 'CONSTRAINT_VIOLATION', detail: 'CHECK constraint violated' };
  }
  if (lowerMsg.includes('primary key constraint') || lowerMsg.includes('primary key failed')) {
    return { type: 'CONSTRAINT_VIOLATION', detail: 'PRIMARY KEY constraint violated' };
  }
  if (lowerMsg.includes('quota') || lowerMsg.includes('disk full') || lowerMsg.includes('storage')) {
    return { type: 'QUOTA_EXCEEDED', detail: 'Storage quota exceeded' };
  }

  return { type: 'UNKNOWN', detail: message };
}

/**
 * Imports parsed data into a table with transactional batching.
 *
 * Process:
 * 1. BEGIN TRANSACTION
 * 2. CREATE TABLE if it doesn't exist (or use existing)
 * 3. Batch insert rows (default 100 rows per batch)
 * 4. Fire progress events after each batch
 * 5. COMMIT on success, ROLLBACK on any error
 *
 * @param db - Database executor for running SQL
 * @param options - Import options including table name, columns, rows, etc.
 * @returns Import result with success status and row count
 */
export async function importData(
  db: DatabaseExecutor,
  options: ImportOptions
): Promise<ImportResult> {
  const {
    tableName,
    columns,
    rows,
    batchSize = DEFAULT_BATCH_SIZE,
    onProgress,
    typeOverrides,
  } = options;

  const totalRows = rows.length;
  let importedCount = 0;
  let transactionStarted = false;

  try {
    // Begin transaction
    await db.exec('BEGIN TRANSACTION');
    transactionStarted = true;

    // Create the INSERT statement
    const insertSql = generateInsertStatement(tableName, columns);

    // Process rows in batches
    for (let batchStart = 0; batchStart < totalRows; batchStart += batchSize) {
      const batchEnd = Math.min(batchStart + batchSize, totalRows);

      // Insert each row in the batch
      for (let rowIndex = batchStart; rowIndex < batchEnd; rowIndex++) {
        const row = rows[rowIndex];

        try {
          // Process values (handle BLOB decoding, type coercion)
          const processedValues = row.map((value, colIndex) => {
            const column = columns[colIndex];
            if (!column) return null;
            return processValue(value, column.name, typeOverrides?.[column.name]);
          });

          await db.run(insertSql, processedValues);
          importedCount++;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const { type, detail } = parseConstraintError(message);

          // Rollback and return error
          await db.exec('ROLLBACK');

          return {
            success: false,
            rowsImported: 0, // Full rollback means 0 committed rows
            tableName,
            error: {
              type,
              message: detail,
              rowNumber: rowIndex + 1, // 1-indexed for user display
              columnName: undefined, // Could be enhanced to detect from error message
              value: undefined,
            },
          };
        }
      }

      // Fire progress event after each batch
      if (onProgress) {
        const percent = Math.round((batchEnd / totalRows) * 100);
        onProgress({
          imported: batchEnd,
          total: totalRows,
          percent,
        });
      }
    }

    // Commit transaction
    await db.exec('COMMIT');
    transactionStarted = false;

    return {
      success: true,
      rowsImported: importedCount,
      tableName,
    };
  } catch (error) {
    // Ensure rollback on any unexpected error
    if (transactionStarted) {
      try {
        await db.exec('ROLLBACK');
      } catch {
        // Ignore rollback errors
      }
    }

    const message = error instanceof Error ? error.message : String(error);
    const { type, detail } = parseConstraintError(message);

    return {
      success: false,
      rowsImported: 0,
      tableName,
      error: {
        type,
        message: detail,
      },
    };
  }
}

/**
 * Creates a table and imports data in a single transaction.
 * This is the full import flow for creating new tables from CSV/JSON data.
 */
export async function createTableAndImport(
  db: DatabaseExecutor,
  options: ImportOptions
): Promise<ImportResult> {
  const { tableName, columns, typeOverrides } = options;

  let transactionStarted = false;

  try {
    // Begin transaction
    await db.exec('BEGIN TRANSACTION');
    transactionStarted = true;

    // Create the table
    const createSql = generateCreateTable(tableName, columns, typeOverrides);
    await db.exec(createSql);

    // Import the data (without starting a new transaction)
    const insertSql = generateInsertStatement(tableName, columns);
    const { rows, batchSize = DEFAULT_BATCH_SIZE, onProgress } = options;
    const totalRows = rows.length;
    let importedCount = 0;

    for (let batchStart = 0; batchStart < totalRows; batchStart += batchSize) {
      const batchEnd = Math.min(batchStart + batchSize, totalRows);

      for (let rowIndex = batchStart; rowIndex < batchEnd; rowIndex++) {
        const row = rows[rowIndex];

        try {
          const processedValues = row.map((value, colIndex) => {
            const column = columns[colIndex];
            if (!column) return null;
            return processValue(value, column.name, typeOverrides?.[column.name]);
          });

          await db.run(insertSql, processedValues);
          importedCount++;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const { type, detail } = parseConstraintError(message);

          await db.exec('ROLLBACK');

          return {
            success: false,
            rowsImported: 0,
            tableName,
            error: {
              type,
              message: detail,
              rowNumber: rowIndex + 1,
            },
          };
        }
      }

      if (onProgress) {
        const percent = Math.round((batchEnd / totalRows) * 100);
        onProgress({
          imported: batchEnd,
          total: totalRows,
          percent,
        });
      }
    }

    // Commit transaction
    await db.exec('COMMIT');
    transactionStarted = false;

    return {
      success: true,
      rowsImported: importedCount,
      tableName,
    };
  } catch (error) {
    if (transactionStarted) {
      try {
        await db.exec('ROLLBACK');
      } catch {
        // Ignore rollback errors
      }
    }

    const message = error instanceof Error ? error.message : String(error);
    const { type, detail } = parseConstraintError(message);

    return {
      success: false,
      rowsImported: 0,
      tableName,
      error: {
        type,
        message: detail,
      },
    };
  }
}
