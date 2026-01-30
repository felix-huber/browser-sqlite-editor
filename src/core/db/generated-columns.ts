/**
 * Generated column helpers
 *
 * Utilities for extracting generated column expressions from CREATE TABLE SQL
 * so rebuilds can preserve GENERATED ALWAYS AS (...) definitions.
 */

import type { ColumnDefinition } from './ddl';

/**
 * Extract a generated column expression from a CREATE TABLE statement.
 *
 * Returns the expression inside AS ( ... ) or null if not found.
 */
export function extractGeneratedExpressionFromCreateSql(
  createSql: string,
  columnName: string
): string | null {
  if (!createSql || !columnName) return null;

  // Escape column name for regex and allow optional quoting
  const escapedName = columnName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const namePattern = `(?:"${escapedName}"|\\[${escapedName}\\]|\`${escapedName}\`|${escapedName})`;

  // Look for: <col> <type> ... GENERATED ALWAYS AS (
  const regex = new RegExp(
    `${namePattern}\\s+[^,]*?GENERATED\\s+(?:ALWAYS\\s+)?AS\\s*\\(`,
    'i'
  );
  const match = createSql.match(regex);
  if (!match || match.index === undefined) return null;

  // Find matching closing parenthesis, handling nesting
  const startIdx = match.index + match[0].length;
  let depth = 1;
  let endIdx = startIdx;

  for (let i = startIdx; i < createSql.length; i++) {
    const ch = createSql[i];
    if (ch === '(') depth += 1;
    if (ch === ')') {
      depth -= 1;
      if (depth === 0) {
        endIdx = i;
        break;
      }
    }
  }

  if (depth !== 0 || endIdx <= startIdx) return null;

  return createSql.slice(startIdx, endIdx).trim();
}

/**
 * Apply generated column expressions to column definitions.
 */
export function applyGeneratedExpressions(
  columns: ColumnDefinition[],
  createSql: string
): ColumnDefinition[] {
  return columns.map((col) => {
    if (col.generatedType && !col.generatedAs) {
      const expression = extractGeneratedExpressionFromCreateSql(createSql, col.name);
      if (expression) {
        return { ...col, generatedAs: expression };
      }
    }
    return col;
  });
}
