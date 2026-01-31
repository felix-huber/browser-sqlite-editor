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
  warnings?: string[];
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
 * Checks if a value is a BLOB placeholder object from JSON export.
 * Format: { "__blob_base64__": "<base64>", "bytes": N }
 */
function isBlobPlaceholder(value: unknown): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const obj = value as Record<string, unknown>;
  return '__blob_base64__' in obj && 'bytes' in obj;
}

/**
 * Checks if a value is a nested object or array (invalid for flat import).
 * BLOB placeholders are treated separately, not as nested objects.
 */
function isNested(value: unknown): boolean {
  if (value === null) return false;
  if (Array.isArray(value)) return true;
  if (typeof value === 'object') {
    // BLOB placeholders are handled separately, not as nested objects
    return !isBlobPlaceholder(value);
  }
  return false;
}

/**
 * Pre-computes line start positions for efficient line number lookup.
 * Returns an array where lineStarts[i] is the character position where line i+1 starts.
 */
function buildLineIndex(text: string): number[] {
  const lineStarts: number[] = [0]; // Line 1 starts at position 0
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') {
      lineStarts.push(i + 1);
    }
  }
  return lineStarts;
}

/**
 * Finds the line number for a given character position using pre-computed line index.
 * Line numbers are 1-indexed. Uses binary search for O(log n) lookup.
 */
function getLineNumber(lineStarts: number[], charPosition: number): number {
  // Binary search for the largest line start <= charPosition
  let low = 0;
  let high = lineStarts.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high + 1) / 2);
    if (lineStarts[mid] <= charPosition) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return low + 1; // Convert to 1-indexed line number
}

/**
 * Finds the character position where a key appears in the JSON string,
 * starting from a given offset. Returns the position or -1 if not found.
 */
function findKeyPosition(jsonString: string, key: string, startOffset: number): number {
  // Look for the key as a JSON string (quoted)
  const searchKey = `"${key}"`;
  const pos = jsonString.indexOf(searchKey, startOffset);
  return pos;
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
  const warnings: string[] = [];

  // Pre-compute line index for O(log n) line number lookups
  const lineStarts = buildLineIndex(jsonString);

  // Track positions for line number calculation
  // We find each array element by looking for opening braces after '[' or ','
  let searchOffset = jsonString.indexOf('[');

  // First pass: validate objects and collect column info
  for (let i = 0; i < data.length; i++) {
    const item = data[i];

    // Skip whitespace and commas to find the start of this element
    while (searchOffset < jsonString.length) {
      const char = jsonString[searchOffset];
      if (char !== ' ' && char !== '\n' && char !== '\r' && char !== '\t' && char !== ',' && char !== '[') {
        break;
      }
      searchOffset++;
    }

    // Each element must be a plain object - check before finding position
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      const elementLine = getLineNumber(lineStarts, searchOffset);
      return {
        columns: [],
        rows: [],
        isValid: false,
        error: `Element at line ${elementLine} must be an object`,
      };
    }

    // Find the start of this array element (the '{' character)
    const elementStart = jsonString.indexOf('{', searchOffset);

    const obj = item as Record<string, unknown>;

    // Check each property
    for (const [key, value] of Object.entries(obj)) {
      // Find position of this key for line number
      const keyPos = findKeyPosition(jsonString, key, elementStart >= 0 ? elementStart : 0);
      const keyLine = keyPos >= 0 ? getLineNumber(lineStarts, keyPos) : elementLine;

      // Check for BLOB placeholder - import as TEXT with warning
      if (isBlobPlaceholder(value)) {
        warnings.push(`BLOB placeholder at line ${keyLine} for key "${key}" imported as TEXT (BLOBs cannot be re-imported)`);
        // Will be converted to TEXT string in second pass
        if (!columnTypes.has(key)) {
          columnOrder.push(key);
        }
        columnTypes.set(key, 'TEXT');
        continue;
      }

      // Check for nested values
      if (isNested(value)) {
        const valueType = Array.isArray(value) ? 'array' : 'nested object';
        return {
          columns: [],
          rows: [],
          isValid: false,
          error: `Element at line ${keyLine} has ${valueType} value for key "${key}"`,
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

    // Update search offset to find next element
    // We need to skip past the entire current object to find the next element
    if (elementStart >= 0) {
      // Find the matching closing brace by counting braces
      let braceCount = 1;
      let pos = elementStart + 1;
      let inString = false;
      while (pos < jsonString.length && braceCount > 0) {
        const char = jsonString[pos];
        if (inString) {
          if (char === '"' && jsonString[pos - 1] !== '\\') {
            inString = false;
          }
        } else {
          if (char === '"') {
            inString = true;
          } else if (char === '{') {
            braceCount++;
          } else if (char === '}') {
            braceCount--;
          }
        }
        pos++;
      }
      searchOffset = pos;
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
      if (value === undefined) return null;
      // Convert BLOB placeholders to JSON string representation
      if (isBlobPlaceholder(value)) {
        return JSON.stringify(value);
      }
      return value;
    });
  });

  const result: ParseResult = {
    columns,
    rows,
    isValid: true,
  };

  if (warnings.length > 0) {
    result.warnings = warnings;
  }

  return result;
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
