/**
 * JSON import parser for SQLite editor.
 * Parses JSON arrays of flat objects into table-ready format.
 */

export type SQLiteType = 'INTEGER' | 'REAL' | 'TEXT' | 'NULL';

export interface ColumnDef {
  name: string;
  type: SQLiteType;
}

export interface ParseResult {
  columns: ColumnDef[];
  rows: unknown[][];
  isValid: boolean;
  error?: string;
}

/**
 * Infers the SQLite type from a JavaScript value.
 */
function inferType(value: unknown): SQLiteType {
  if (value === null || value === undefined) {
    return 'NULL';
  }
  if (typeof value === 'number') {
    return Number.isInteger(value) ? 'INTEGER' : 'REAL';
  }
  if (typeof value === 'boolean') {
    return 'INTEGER'; // SQLite stores booleans as 0/1
  }
  return 'TEXT';
}

/**
 * Merges two SQLite types, returning the safer/broader type.
 * NULL is neutral (doesn't affect the other type).
 * INTEGER + REAL = REAL
 * Anything + TEXT = TEXT
 */
function mergeTypes(a: SQLiteType, b: SQLiteType): SQLiteType {
  if (a === 'NULL') return b;
  if (b === 'NULL') return a;
  if (a === b) return a;
  if ((a === 'INTEGER' && b === 'REAL') || (a === 'REAL' && b === 'INTEGER')) {
    return 'REAL';
  }
  return 'TEXT';
}

/**
 * Checks if a value is a nested object or array (invalid for flat import).
 */
function isNested(value: unknown): boolean {
  if (value === null) return false;
  if (Array.isArray(value)) return true;
  if (typeof value === 'object') return true;
  return false;
}

/**
 * Parses a JSON string containing an array of flat objects.
 *
 * Validation rules:
 * - Root must be an array
 * - Each element must be a plain object
 * - No nested objects or arrays in values
 * - Inconsistent keys across objects result in union of all keys
 *
 * @param jsonString - The JSON string to parse
 * @returns ParseResult with columns, rows, validity status, and optional error
 */
export function parseJSON(jsonString: string): ParseResult {
  // Parse JSON
  let data: unknown;
  try {
    data = JSON.parse(jsonString);
  } catch (e) {
    return {
      columns: [],
      rows: [],
      isValid: false,
      error: `Invalid JSON: ${e instanceof Error ? e.message : 'parse error'}`,
    };
  }

  // Validate root is array
  if (!Array.isArray(data)) {
    return {
      columns: [],
      rows: [],
      isValid: false,
      error: 'JSON root must be an array',
    };
  }

  // Handle empty array
  if (data.length === 0) {
    return {
      columns: [],
      rows: [],
      isValid: true,
    };
  }

  // Collect all column names and their types
  const columnTypes = new Map<string, SQLiteType>();
  const columnOrder: string[] = [];

  // First pass: validate objects and collect column info
  for (let i = 0; i < data.length; i++) {
    const item = data[i];

    // Each element must be a plain object
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      return {
        columns: [],
        rows: [],
        isValid: false,
        error: `Element at index ${i} must be an object`,
      };
    }

    const obj = item as Record<string, unknown>;

    // Check each property
    for (const [key, value] of Object.entries(obj)) {
      // Check for nested values
      if (isNested(value)) {
        const valueType = Array.isArray(value) ? 'array' : 'nested object';
        return {
          columns: [],
          rows: [],
          isValid: false,
          error: `Element at index ${i} has ${valueType} value for key "${key}"`,
        };
      }

      // Track column order (first occurrence)
      if (!columnTypes.has(key)) {
        columnOrder.push(key);
        columnTypes.set(key, 'NULL');
      }

      // Merge type inference
      const currentType = columnTypes.get(key)!;
      const valueType = inferType(value);
      columnTypes.set(key, mergeTypes(currentType, valueType));
    }
  }

  // Build column definitions
  const columns: ColumnDef[] = columnOrder.map(name => ({
    name,
    type: columnTypes.get(name)!,
  }));

  // Build rows
  const rows: unknown[][] = data.map(item => {
    const obj = item as Record<string, unknown>;
    return columnOrder.map(key => {
      const value = obj[key];
      return value === undefined ? null : value;
    });
  });

  return {
    columns,
    rows,
    isValid: true,
  };
}

/**
 * Reads file content as text using FileReader.
 * Used instead of file.text() for broader browser/test environment compatibility.
 */
function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

/**
 * Parses JSON from a File object.
 *
 * @param file - The File to parse
 * @returns Promise resolving to ParseResult
 */
export async function parseJSONFile(file: File): Promise<ParseResult> {
  try {
    const text = await readFileAsText(file);
    return parseJSON(text);
  } catch (e) {
    return {
      columns: [],
      rows: [],
      isValid: false,
      error: `Failed to read file: ${e instanceof Error ? e.message : 'unknown error'}`,
    };
  }
}
