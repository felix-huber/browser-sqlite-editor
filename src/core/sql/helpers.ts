/**
 * Shared SQL generation helpers.
 *
 * This module centralizes common SQL string generation utilities used by
 * Grid filters, Query Builder, and other features.
 */

// Re-export existing escape utilities for convenience
export { escapeLike, getEscapeClause } from './escape'

/**
 * Quote an SQL identifier (table or column name) with double quotes.
 * Escapes embedded double quotes by doubling them.
 *
 * This function unconditionally quotes - use it when you always want
 * quoted identifiers (safer for user-provided names).
 *
 * @param name - The identifier to quote
 * @returns The quoted identifier
 *
 * @example
 * quoteIdentifier('name')       // '"name"'
 * quoteIdentifier('col"name')   // '"col""name"'
 * quoteIdentifier('SELECT')     // '"SELECT"'
 */
export function quoteIdentifier(name: string): string {
  const escaped = name.replace(/"/g, '""')
  return `"${escaped}"`
}

/**
 * Escape special characters in a LIKE pattern.
 * Escapes %, _, and \ with backslash.
 *
 * Use with `ESCAPE '\\'` clause in SQL.
 *
 * @param value - The string to escape for use in LIKE
 * @returns The escaped string
 *
 * @example
 * escapeLikePattern('100%')     // '100\\%'
 * escapeLikePattern('a_b')      // 'a\\_b'
 * escapeLikePattern('a\\b')     // 'a\\\\b'
 */
export function escapeLikePattern(value: string): string {
  if (!value) return value

  // Escape order matters: backslash first, then % and _
  return value
    .split('\\').join('\\\\')
    .split('%').join('\\%')
    .split('_').join('\\_')
}

/**
 * Generate a column alias in 'Table.Column' format.
 *
 * Used for deterministic column aliasing when columns from multiple
 * tables might have the same name.
 *
 * @param table - The table name (or alias)
 * @param column - The column name
 * @returns The alias in 'Table.Column' format
 *
 * @example
 * generateAlias('users', 'name')    // 'users.name'
 * generateAlias('orders', 'id')     // 'orders.id'
 */
export function generateAlias(table: string, column: string): string {
  return `${table}.${column}`
}
