/**
 * SQL LIKE pattern escaping utilities for SQLite.
 *
 * SQLite LIKE patterns use % for any sequence of characters and _ for any single character.
 * The backslash is used as the default escape character to allow literal % and _ in patterns.
 */

/**
 * Escapes special LIKE pattern characters (%, _, and \) in a string.
 *
 * @param value - The string to escape
 * @param escapeChar - The escape character to use (defaults to backslash)
 * @returns The escaped string safe for use in LIKE patterns
 *
 * @example
 * // Basic usage
 * escapeLike("100%") // "100\\%"
 * escapeLike("a_b")  // "a\\_b"
 *
 * // Use in query
 * const pattern = `%${escapeLike(searchTerm)}%`
 * db.exec(`SELECT * FROM t WHERE col LIKE ? ${getEscapeClause()}`, [pattern])
 */
export function escapeLike(value: string, escapeChar = '\\'): string {
  if (!value) return value

  // Escape the escape character first, then % and _
  return value
    .split(escapeChar).join(escapeChar + escapeChar)
    .split('%').join(escapeChar + '%')
    .split('_').join(escapeChar + '_')
}

/**
 * Returns the SQL ESCAPE clause to use with LIKE patterns escaped by escapeLike().
 *
 * @param escapeChar - The escape character (must match what was passed to escapeLike)
 * @returns The ESCAPE clause string, e.g., "ESCAPE '\\'"
 *
 * @example
 * const sql = `SELECT * FROM t WHERE col LIKE ? ${getEscapeClause()}`
 */
export function getEscapeClause(escapeChar = '\\'): string {
  // Escape single quotes in the escape character for SQL safety
  const safeChar = escapeChar.split("'").join("''")
  return `ESCAPE '${safeChar}'`
}
