/**
 * Rebuild utilities.
 */

// Re-export quoteIdentifier from ddl.ts for convenience
export { quoteIdentifier } from '../db/ddl'

/**
 * Escapes special regex characters in a string.
 */
export function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
