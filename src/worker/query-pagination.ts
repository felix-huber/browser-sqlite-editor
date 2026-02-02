/**
 * Paginated Query Handler for SQLite Worker
 *
 * Provides stable pagination with LIMIT/OFFSET, total count tracking,
 * and proper column metadata including generated column detection.
 */

import type { QueryRow } from '../types';
import type { DatabaseEngine } from '../core/engine/db-engine';

// =============================================================================
// Types
// =============================================================================

/**
 * Extended column metadata including generated column info
 */
export interface ColumnMeta {
  /** Column name */
  name: string;
  /** Column type (e.g., INTEGER, TEXT, BLOB) */
  type: string;
  /** Whether this is a generated column */
  isGenerated: boolean;
  /** Generated column expression (null if not generated) */
  generatedExpression: string | null;
}

/**
 * Paginated query request
 */
export interface PaginatedQueryRequest {
  /** SQL query to execute (SELECT only) */
  sql: string;
  /** Query parameters */
  params?: unknown[];
  /** Maximum rows to return */
  limit: number;
  /** Number of rows to skip */
  offset: number;
  /** Table name for stable sorting (optional) */
  tableName?: string;
  /** Cached total count (if known from previous query) */
  cachedTotalCount?: number;
}

/**
 * Paginated query result
 */
export interface PaginatedQueryResult {
  /** Column metadata */
  columns: ColumnMeta[];
  /** Query result rows */
  rows: QueryRow[];
  /** Total rows available (for pagination controls) */
  totalCount: number;
}

// =============================================================================
// Cache
// =============================================================================

/**
 * Simple total count cache
 * Key: SQL query hash, Value: { count, timestamp }
 */
const countCache = new Map<string, { count: number; timestamp: number }>();

/** Cache TTL in milliseconds (5 minutes) */
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Generate a simple hash for cache key
 */
function hashQuery(sql: string): string {
  // Simple hash - just use the normalized SQL
  return sql.trim().toLowerCase();
}

/**
 * Get cached count if valid
 */
function getCachedCount(sql: string): number | null {
  const key = hashQuery(sql);
  const cached = countCache.get(key);

  if (!cached) {
    return null;
  }

  // Check if cache is still valid
  if (Date.now() - cached.timestamp > CACHE_TTL_MS) {
    countCache.delete(key);
    return null;
  }

  return cached.count;
}

/**
 * Store count in cache
 */
function setCachedCount(sql: string, count: number): void {
  const key = hashQuery(sql);
  countCache.set(key, { count, timestamp: Date.now() });
}

/**
 * Invalidate all cached counts (call on mutation)
 */
export function invalidateCountCache(): void {
  countCache.clear();
}

// =============================================================================
// Table Info Helpers
// =============================================================================

/**
 * Check if a table is WITHOUT ROWID
 */
export async function isWithoutRowid(
  engine: DatabaseEngine,
  tableName: string,
): Promise<boolean> {
  const result = await engine.query(
    `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`,
    [tableName],
  );

  if (result.rows.length === 0) {
    return false;
  }

  const createSql = result.rows[0][0] as string;
  return /WITHOUT\s+ROWID/i.test(createSql);
}

/**
 * Get primary key columns for a table
 */
export async function getPrimaryKeyColumns(
  engine: DatabaseEngine,
  tableName: string,
): Promise<string[]> {
  const result = await engine.query(`PRAGMA table_info("${tableName}")`);

  const pkColumns: Array<{ name: string; pk: number }> = [];

  for (const row of result.rows) {
    const pk = row[5] as number; // pk column is at index 5
    if (pk > 0) {
      pkColumns.push({
        name: row[1] as string, // name column is at index 1
        pk,
      });
    }
  }

  // Sort by pk order
  pkColumns.sort((a, b) => a.pk - b.pk);
  return pkColumns.map((c) => c.name);
}

/**
 * Get column metadata for a table including generated column info
 */
export async function getColumnMeta(
  engine: DatabaseEngine,
  tableName: string,
): Promise<ColumnMeta[]> {
  // Use table_xinfo to get generated column information
  const result = await engine.query(`PRAGMA table_xinfo("${tableName}")`);

  const columns: ColumnMeta[] = [];

  for (const row of result.rows) {
    const name = row[1] as string;
    const type = (row[2] as string) || 'BLOB';
    // Hidden column (index 6): 0=normal, 1=hidden, 2=generated stored, 3=generated virtual
    const hidden = (row[6] as number) || 0;
    const isGenerated = hidden === 2 || hidden === 3;

    let generatedExpression: string | null = null;

    if (isGenerated) {
      // Get the generated column expression from CREATE TABLE statement
      generatedExpression = await extractGeneratedExpression(engine, tableName, name);
    }

    columns.push({
      name,
      type,
      isGenerated,
      generatedExpression,
    });
  }

  return columns;
}

/**
 * Extract generated column expression from CREATE TABLE SQL
 */
async function extractGeneratedExpression(
  engine: DatabaseEngine,
  tableName: string,
  columnName: string,
): Promise<string | null> {
  const result = await engine.query(
    `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`,
    [tableName],
  );

  if (result.rows.length === 0) {
    return null;
  }

  const createSql = result.rows[0][0] as string;

  // Parse the generated expression from CREATE TABLE
  // Look for: column_name type [GENERATED ALWAYS] AS (expression) [STORED|VIRTUAL]
  const escapedName = columnName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(
    `["']?${escapedName}["']?\\s+\\w+[^,]*?(?:GENERATED\\s+ALWAYS\\s+)?AS\\s*\\(`,
    'i',
  );
  const match = createSql.match(regex);

  if (!match) {
    return null;
  }

  // Find the matching closing parenthesis, handling nested parens
  const startIdx = match.index! + match[0].length;
  let depth = 1;
  let endIdx = startIdx;

  for (let i = startIdx; i < createSql.length && depth > 0; i++) {
    if (createSql[i] === '(') {
      depth++;
    } else if (createSql[i] === ')') {
      depth--;
    }
    if (depth === 0) {
      endIdx = i;
    }
  }

  if (depth !== 0) {
    return null; // Unbalanced parentheses
  }

  return createSql.slice(startIdx, endIdx).trim();
}

// =============================================================================
// Query Building
// =============================================================================

/**
 * Build stable sort order for pagination
 *
 * For rowid tables: ORDER BY rowid
 * For WITHOUT ROWID tables: ORDER BY pk_columns
 */
export async function buildStableSortClause(
  engine: DatabaseEngine,
  tableName: string,
  existingOrderBy?: string,
): Promise<string> {
  const isWor = await isWithoutRowid(engine, tableName);

  let tieBreaker: string;

  if (isWor) {
    // WITHOUT ROWID table: use primary key columns
    const pkColumns = await getPrimaryKeyColumns(engine, tableName);
    if (pkColumns.length === 0) {
      // Fallback: no stable sort possible
      return existingOrderBy || '';
    }
    tieBreaker = pkColumns.map((c) => `"${c}"`).join(', ');
  } else {
    // Regular table: use rowid
    tieBreaker = 'rowid';
  }

  if (existingOrderBy) {
    // Append tie-breaker to existing ORDER BY
    return `${existingOrderBy}, ${tieBreaker}`;
  }

  return `ORDER BY ${tieBreaker}`;
}

/**
 * Wrap a query with LIMIT/OFFSET and stable sorting
 */
export function wrapQueryWithPagination(
  sql: string,
  limit: number,
  offset: number,
  stableSortClause: string,
): string {
  // Normalize the SQL
  const trimmedSql = sql.trim().replace(/;+$/, '');

  // Check if query already has LIMIT/OFFSET
  const hasLimit = /\bLIMIT\s+\d+/i.test(trimmedSql);
  const hasOffset = /\bOFFSET\s+\d+/i.test(trimmedSql);

  if (hasLimit || hasOffset) {
    // Query already has pagination, don't modify
    return trimmedSql;
  }

  // Check if query has ORDER BY
  const orderByMatch = trimmedSql.match(/\bORDER\s+BY\s+(.+?)(?=\bLIMIT|\bOFFSET|$)/i);

  let resultSql: string;

  if (orderByMatch) {
    // Has ORDER BY - need to append tie-breaker if stableSortClause is provided
    if (stableSortClause && !stableSortClause.startsWith('ORDER BY')) {
      // stableSortClause is just the tie-breaker columns
      resultSql = `${trimmedSql}, ${stableSortClause}`;
    } else {
      resultSql = trimmedSql;
    }
  } else if (stableSortClause) {
    // No ORDER BY - add stable sort
    resultSql = `${trimmedSql} ${stableSortClause}`;
  } else {
    resultSql = trimmedSql;
  }

  // Add LIMIT and OFFSET
  return `${resultSql} LIMIT ${limit} OFFSET ${offset}`;
}

/**
 * Build a COUNT query from a SELECT query
 */
export function buildCountQuery(sql: string): string {
  const trimmedSql = sql.trim().replace(/;+$/, '');

  // Remove ORDER BY clause for count query (performance optimization)
  const withoutOrder = trimmedSql.replace(/\bORDER\s+BY\s+.+?(?=\bLIMIT|\bOFFSET|$)/gi, '');

  // Remove existing LIMIT/OFFSET
  const withoutPagination = withoutOrder
    .replace(/\bLIMIT\s+\d+/gi, '')
    .replace(/\bOFFSET\s+\d+/gi, '')
    .trim();

  return `SELECT COUNT(*) FROM (${withoutPagination})`;
}

// =============================================================================
// Main Handler
// =============================================================================

/**
 * Execute a paginated query
 *
 * @param engine Database engine instance
 * @param request Paginated query request
 * @returns Paginated query result with columns, rows, and totalCount
 */
export async function executePaginatedQuery(
  engine: DatabaseEngine,
  request: PaginatedQueryRequest,
): Promise<PaginatedQueryResult> {
  const { sql, params, limit, offset, tableName, cachedTotalCount } = request;

  // Determine total count
  let totalCount: number;

  if (cachedTotalCount !== undefined && cachedTotalCount >= 0) {
    // Use cached count from client
    totalCount = cachedTotalCount;
  } else {
    // Check our local cache
    const cached = getCachedCount(sql);
    if (cached !== null) {
      totalCount = cached;
    } else {
      // Execute count query
      const countSql = buildCountQuery(sql);
      const countResult = await engine.query(countSql, params);
      totalCount = (countResult.rows[0]?.[0] as number) ?? 0;
      setCachedCount(sql, totalCount);
    }
  }

  // Build stable sort clause if table name is provided
  let stableSortClause = '';
  if (tableName) {
    stableSortClause = await buildStableSortClause(engine, tableName);
  }

  // Build paginated query
  const paginatedSql = wrapQueryWithPagination(sql, limit, offset, stableSortClause);

  // Execute the query
  const result = await engine.query(paginatedSql, params);

  // Get column metadata
  let columns: ColumnMeta[];

  if (tableName) {
    // Get full metadata including generated column info
    const tableMeta = await getColumnMeta(engine, tableName);
    // Map to result columns (query may have subset or different order)
    columns = result.columns.map((colName, colIndex) => {
      const meta = tableMeta.find((m) => m.name === colName);
      if (meta) {
        return meta;
      }
      // Column not in table (e.g., expression or alias)
      // Use colIndex instead of indexOf to handle duplicate column names correctly
      return {
        name: colName,
        type: result.columnTypes[colIndex] || 'BLOB',
        isGenerated: false,
        generatedExpression: null,
      };
    });
  } else {
    // No table name - use basic metadata from query result
    columns = result.columns.map((name, i) => ({
      name,
      type: result.columnTypes[i] || 'BLOB',
      isGenerated: false,
      generatedExpression: null,
    }));
  }

  return {
    columns,
    rows: result.rows,
    totalCount,
  };
}

// =============================================================================
// Page Navigation Helpers
// =============================================================================

/**
 * Calculate pagination info from total count and page size
 */
export interface PaginationInfo {
  /** Current page (1-indexed) */
  currentPage: number;
  /** Total number of pages */
  totalPages: number;
  /** Starting row number (1-indexed) */
  startRow: number;
  /** Ending row number (1-indexed) */
  endRow: number;
  /** Whether there is a previous page */
  hasPrevious: boolean;
  /** Whether there is a next page */
  hasNext: boolean;
}

/**
 * Calculate pagination info
 */
export function calculatePaginationInfo(
  totalCount: number,
  limit: number,
  offset: number,
): PaginationInfo {
  const totalPages = Math.max(1, Math.ceil(totalCount / limit));
  const currentPage = Math.floor(offset / limit) + 1;
  const startRow = totalCount === 0 ? 0 : offset + 1;
  const endRow = Math.min(offset + limit, totalCount);

  return {
    currentPage,
    totalPages,
    startRow,
    endRow,
    hasPrevious: currentPage > 1,
    hasNext: currentPage < totalPages,
  };
}

/**
 * Calculate offset for a given page
 */
export function getPageOffset(page: number, limit: number): number {
  return (Math.max(1, page) - 1) * limit;
}

/**
 * Calculate offset for next page
 */
export function getNextPageOffset(currentOffset: number, limit: number): number {
  return currentOffset + limit;
}

/**
 * Calculate offset for previous page
 */
export function getPreviousPageOffset(currentOffset: number, limit: number): number {
  return Math.max(0, currentOffset - limit);
}

/**
 * Calculate offset for first page
 */
export function getFirstPageOffset(): number {
  return 0;
}

/**
 * Calculate offset for last page
 */
export function getLastPageOffset(totalCount: number, limit: number): number {
  const totalPages = Math.max(1, Math.ceil(totalCount / limit));
  return (totalPages - 1) * limit;
}
