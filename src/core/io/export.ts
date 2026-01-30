/**
 * Export handlers for SQLite editor.
 * Supports CSV, JSON, and SQL DDL export formats.
 */

import { escapeIdentifier } from '../sql/escape';

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
  /** How to handle BLOB columns: 'hex' to show hex string, 'placeholder' to replace with placeholder (default: 'placeholder') */
  blobHandling?: 'hex' | 'placeholder';
  /** Placeholder text for BLOBs (default: '[BLOB]') */
  blobPlaceholder?: string;
  /** Enable formula injection protection by prefixing dangerous chars with single quote (default: true) */
  formulaProtection?: boolean;
  /** Field delimiter character (default: ',') */
  delimiter?: ',' | ';' | '\t';
}

/** Characters that trigger formula injection in spreadsheets */
const FORMULA_INJECTION_CHARS = ['=', '+', '-', '@', '\t'];

/**
 * Sentinel value to represent NULL in CSV output (will become empty unquoted cell)
 */
const NULL_SENTINEL = Symbol('NULL');

/**
 * Sentinel value to represent empty string in CSV output (will become quoted "")
 */
const EMPTY_STRING_SENTINEL = Symbol('EMPTY_STRING');

/**
 * Check if a string value starts with a formula-dangerous character
 */
function isFormulaDangerous(value: string): boolean {
  return FORMULA_INJECTION_CHARS.some((char) => value.startsWith(char));
}

/**
 * Escape formula-dangerous values by prefixing with single quote
 */
function escapeFormula(value: string): string {
  if (isFormulaDangerous(value)) {
    return "'" + value;
  }
  return value;
}

/**
 * Export table data to CSV string.
 *
 * NULL values are exported as empty unquoted cells.
 * Empty strings are exported as quoted "" cells.
 * Formula-dangerous values (starting with =, +, -, @, tab) are prefixed with ' when protection is enabled.
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
    blobHandling = 'placeholder',
    blobPlaceholder = '[BLOB]',
    formulaProtection = true,
    delimiter = ',',
  } = options;

  // Process rows to handle BLOBs, NULLs, empty strings, and formula protection
  const processedRows = rows.map((row) =>
    row.map((cell) => {
      // Handle BLOBs
      if (isBlob(cell)) {
        return blobHandling === 'hex' ? blobToHex(cell) : blobPlaceholder;
      }

      // Handle NULL - use sentinel that will become empty unquoted cell
      if (cell === null || cell === undefined) {
        return NULL_SENTINEL;
      }

      // Handle empty string - use sentinel to distinguish from NULL
      if (cell === '') {
        return EMPTY_STRING_SENTINEL;
      }

      // Handle string values with formula protection
      if (typeof cell === 'string') {
        return formulaProtection ? escapeFormula(cell) : cell;
      }

      // Other types (numbers, etc.)
      return cell;
    })
  );

  // Custom unparse to handle NULL sentinel properly
  // We can't use Papa.unparse directly because it doesn't support our NULL sentinel
  const csvRows: string[] = [];

  if (includeHeader) {
    csvRows.push(columns.map((col) => escapeCSVField(col, delimiter)).join(delimiter));
  }

  for (const row of processedRows) {
    const csvCells = row.map((cell) => {
      if (cell === NULL_SENTINEL) {
        return ''; // Empty unquoted cell for NULL
      }
      if (cell === EMPTY_STRING_SENTINEL) {
        return '""'; // Quoted empty string
      }
      return escapeCSVField(cell, delimiter);
    });
    csvRows.push(csvCells.join(delimiter));
  }

  const csv = csvRows.join('\r\n');

  return includeBOM ? UTF8_BOM + csv : csv;
}

/**
 * Escape a field for CSV output according to RFC 4180
 */
function escapeCSVField(value: unknown, delimiter: string): string {
  if (value === null || value === undefined) {
    return '';
  }

  const str = String(value);

  // Check if quoting is needed - must quote if contains delimiter, quote, or newline
  const needsQuoting = str.includes(delimiter) || str.includes('"') || str.includes('\n') || str.includes('\r');

  if (needsQuoting) {
    // Escape quotes by doubling them, then wrap in quotes
    return '"' + str.replace(/"/g, '""') + '"';
  }

  return str;
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
