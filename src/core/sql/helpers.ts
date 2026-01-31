/**
 * Shared SQL generation helpers.
 *
 * This module centralizes common SQL string generation utilities used by
 * Grid filters, Query Builder, and other features.
 */

// Re-export existing escape utilities for convenience
export { escapeLike, getEscapeClause } from './escape'

// Re-export escapeLike as escapeLikePattern for backward compatibility
// Prefer using escapeLike directly in new code
export { escapeLike as escapeLikePattern } from './escape'

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
 * Generate a qualified alias for a column in the format 'Table.Column'.
 *
 * Used for display purposes and disambiguation in multi-table queries.
 *
 * @param table - The table name
 * @param column - The column name
 * @returns The qualified alias string
 *
 * @example
 * generateAlias('users', 'id')       // 'users.id'
 * generateAlias('orders', 'total')   // 'orders.total'
 */
export function generateAlias(table: string, column: string): string {
  return `${table}.${column}`
}

// Re-export conditional quoting from DDL module for cases where readable output is preferred
// Use quoteIdentifier (above) for safety with user-provided names
// Use quoteIdentifierIfNeeded for DDL generation where readability matters
export {
  needsQuoting,
  quoteIdentifier as quoteIdentifierIfNeeded,
} from '../db/ddl'

