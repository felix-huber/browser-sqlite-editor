/**
 * SQL escaping helpers.
 */

/**
 * Escape SQL identifier (table/column name) using double quotes.
 */
export function escapeIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * Escapes special LIKE pattern characters (%, _, and \) in a string.
 */
export function escapeLike(value: string, escapeChar = '\\'): string {
  if (!value) return value;

  return value
    .split(escapeChar).join(escapeChar + escapeChar)
    .split('%').join(escapeChar + '%')
    .split('_').join(escapeChar + '_');
}

/**
 * Returns the SQL ESCAPE clause for LIKE patterns escaped by escapeLike().
 */
export function getEscapeClause(escapeChar = '\\'): string {
  const safeChar = escapeChar.split("'").join("''");
  return `ESCAPE '${safeChar}'`;
}
