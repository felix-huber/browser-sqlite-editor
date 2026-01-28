/**
 * Export handlers for SQLite editor.
 * Supports CSV, JSON, and SQL DDL export formats.
 */

import Papa from 'papaparse';

/** UTF-8 BOM for Excel compatibility */
const UTF8_BOM = '\uFEFF';

/**
 * Check if a value is a BLOB (Uint8Array)
 */
function isBlob(value: unknown): value is Uint8Array {
  return value instanceof Uint8Array;
}

/**
 * Convert Uint8Array to hex string (e.g., "X'deadbeef'")
 */
function blobToHex(blob: Uint8Array): string {
  const hex = Array.from(blob)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return hex;
}

/**
 * Convert Uint8Array to base64 string
 */
function blobToBase64(blob: Uint8Array): string {
  // Use btoa for browser compatibility
  let binary = '';
  for (let i = 0; i < blob.length; i++) {
    binary += String.fromCharCode(blob[i]);
  }
  return btoa(binary);
}

/**
 * Options for CSV export
 */
export interface CSVExportOptions {
  /** Include UTF-8 BOM for Excel compatibility (default: true) */
  includeBOM?: boolean;
  /** Include header row (default: true) */
  includeHeader?: boolean;
  /** How to handle BLOB columns: 'hex' to show hex string, 'omit' to replace with placeholder (default: 'hex') */
  blobHandling?: 'hex' | 'omit';
  /** Placeholder text for omitted BLOBs (default: '[BLOB]') */
  blobPlaceholder?: string;
}

/**
 * Export table data to CSV string.
 *
 * @param columns - Column names
 * @param rows - Row data (may contain Uint8Array for BLOBs)
 * @param options - Export options
 * @returns CSV string (with BOM if enabled)
 */
export function exportToCSV(
  columns: string[],
  rows: unknown[][],
  options: CSVExportOptions = {}
): string {
  const {
    includeBOM = true,
    includeHeader = true,
    blobHandling = 'hex',
    blobPlaceholder = '[BLOB]',
  } = options;

  // Process rows to handle BLOBs
  const processedRows = rows.map((row) =>
    row.map((cell) => {
      if (isBlob(cell)) {
        return blobHandling === 'hex' ? blobToHex(cell) : blobPlaceholder;
      }
      return cell ?? '';
    })
  );

  // Build data array for Papa.unparse
  const data = includeHeader
    ? [columns, ...processedRows]
    : processedRows;

  const csv = Papa.unparse(data);

  return includeBOM ? UTF8_BOM + csv : csv;
}

/**
 * Options for JSON export
 */
export interface JSONExportOptions {
  /** Pretty-print with indentation (default: true) */
  pretty?: boolean;
  /** Indentation spaces for pretty-print (default: 2) */
  indent?: number;
}

/**
 * Export table data to JSON string (array of objects).
 *
 * BLOB columns are encoded as base64 strings with a special prefix.
 *
 * @param columns - Column names
 * @param rows - Row data (may contain Uint8Array for BLOBs)
 * @param options - Export options
 * @returns JSON string
 */
export function exportToJSON(
  columns: string[],
  rows: unknown[][],
  options: JSONExportOptions = {}
): string {
  const { pretty = true, indent = 2 } = options;

  const objects = rows.map((row) => {
    const obj: Record<string, unknown> = {};
    for (let i = 0; i < columns.length; i++) {
      const colName = columns[i];
      const value = row[i];

      if (isBlob(value)) {
        // Encode BLOB as base64 with prefix for identification
        obj[colName] = `base64:${blobToBase64(value)}`;
      } else {
        obj[colName] = value;
      }
    }
    return obj;
  });

  return pretty
    ? JSON.stringify(objects, null, indent)
    : JSON.stringify(objects);
}

/**
 * Column information for DDL generation
 */
export interface DDLColumnInfo {
  /** Column name */
  name: string;
  /** Column type (e.g., 'INTEGER', 'TEXT', 'REAL', 'BLOB') */
  type: string;
  /** Whether NOT NULL constraint exists */
  notNull: boolean;
  /** Default value expression (null if none) */
  defaultValue: string | null;
  /** Primary key order (0 if not part of PK) */
  primaryKey: number;
}

/**
 * Table information for DDL generation
 */
export interface DDLTableInfo {
  /** Table name */
  name: string;
  /** Column definitions */
  columns: DDLColumnInfo[];
  /** Whether this is WITHOUT ROWID table */
  withoutRowid?: boolean;
}

/**
 * Escape SQL identifier (table/column name).
 * Uses double-quote escaping per SQL standard.
 */
function escapeIdentifier(name: string): string {
  // Always quote identifiers to handle reserved words and special characters
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * Export table schema as SQL DDL CREATE TABLE statement.
 *
 * @param tableInfo - Table metadata
 * @returns SQL CREATE TABLE statement
 */
export function exportSchemaToDDL(tableInfo: DDLTableInfo): string {
  const { name, columns, withoutRowid = false } = tableInfo;

  // Collect primary key columns in order
  const pkColumns = columns
    .filter((c) => c.primaryKey > 0)
    .sort((a, b) => a.primaryKey - b.primaryKey);

  const columnDefs = columns.map((col) => {
    const parts: string[] = [escapeIdentifier(col.name)];

    // Type
    if (col.type) {
      parts.push(col.type);
    }

    // Inline PRIMARY KEY only if single column PK
    if (pkColumns.length === 1 && col.primaryKey > 0) {
      parts.push('PRIMARY KEY');
    }

    // NOT NULL
    if (col.notNull && col.primaryKey === 0) {
      // PK columns are implicitly NOT NULL
      parts.push('NOT NULL');
    }

    // DEFAULT
    if (col.defaultValue !== null) {
      parts.push(`DEFAULT ${col.defaultValue}`);
    }

    return '  ' + parts.join(' ');
  });

  // Add composite primary key constraint if multiple columns
  if (pkColumns.length > 1) {
    const pkColNames = pkColumns.map((c) => escapeIdentifier(c.name)).join(', ');
    columnDefs.push(`  PRIMARY KEY (${pkColNames})`);
  }

  let ddl = `CREATE TABLE ${escapeIdentifier(name)} (\n`;
  ddl += columnDefs.join(',\n');
  ddl += '\n)';

  if (withoutRowid) {
    ddl += ' WITHOUT ROWID';
  }

  ddl += ';';

  return ddl;
}

/**
 * Export multiple table schemas as SQL DDL.
 *
 * @param tables - Array of table metadata
 * @returns SQL DDL statements separated by newlines
 */
export function exportMultipleSchemaToDDL(tables: DDLTableInfo[]): string {
  return tables.map(exportSchemaToDDL).join('\n\n');
}
