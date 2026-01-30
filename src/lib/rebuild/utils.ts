/**
 * Rebuild utilities.
 */

/**
 * Escapes special regex characters in a string.
 */
export function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Checks if an identifier needs quoting.
 */
function needsQuoting(identifier: string): boolean {
  if (!identifier || identifier.length === 0) {
    return true;
  }

  // SQLite reserved keywords (subset - full list is in ddl.ts)
  const reserved = new Set([
    'ORDER', 'TABLE', 'SELECT', 'FROM', 'WHERE', 'CREATE', 'DROP',
    'INSERT', 'UPDATE', 'DELETE', 'INDEX', 'TRIGGER', 'VIEW', 'ALTER',
  ]);

  if (reserved.has(identifier.toUpperCase())) {
    return true;
  }

  if (/^\d/.test(identifier)) {
    return true;
  }

  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(identifier)) {
    return true;
  }

  return false;
}

/**
 * Quotes an identifier if necessary.
 */
export function quoteIdentifier(identifier: string): string {
  if (!needsQuoting(identifier)) {
    return identifier;
  }
  const escaped = identifier.replace(/"/g, '""');
  return `"${escaped}"`;
}
