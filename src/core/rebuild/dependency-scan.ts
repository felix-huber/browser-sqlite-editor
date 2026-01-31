/**
 * Pre-flight dependency scanning for table rebuild operations.
 *
 * This module implements Phase 1 of the PRD's two-phase dependency handling:
 * - Scans sqlite_master SQL text for references to target table/column
 * - Generates user-facing dependency warnings listing affected objects
 * - Best-effort: may miss obfuscated references (quoted identifiers, different casing, comments)
 *
 * Phase 2 (authoritative compile-check) is handled by compile-check.ts after rebuild.
 */

import type { SqliteMasterObject } from './types';
import { escapeRegExp } from './utils';

/**
 * A dependency found during pre-flight scan.
 */
export interface DependencyReference {
  /** Type of dependent object */
  type: 'view' | 'trigger';
  /** Name of the dependent object */
  name: string;
  /** SQL definition of the object */
  sql: string;
  /** Whether this is a potential match (might be false positive) */
  isPotential: boolean;
}

/**
 * Result of a pre-flight dependency scan.
 */
export interface DependencyScanResult {
  /** Table name that was scanned for */
  tableName: string;
  /** Column name that was scanned for (if provided) */
  columnName?: string;
  /** Views that reference the table/column */
  dependentViews: DependencyReference[];
  /** Triggers that reference the table/column */
  dependentTriggers: DependencyReference[];
  /** Total count of dependencies found */
  totalCount: number;
  /** Human-readable warning message (empty if no dependencies) */
  warningMessage: string;
}

/**
 * Scans sqlite_master SQL text for references to a table.
 *
 * This is a best-effort textual scan that looks for table name references
 * in view and trigger SQL definitions. It may have false positives but
 * should not miss actual references in typical SQL.
 *
 * Limitations:
 * - May miss references in comments
 * - May miss references with unusual quoting/escaping
 * - May have false positives from substring matches in quoted strings
 *
 * @param tableName Table name to search for
 * @param masterRows Rows from sqlite_master
 * @returns Scan result with found dependencies
 */
export function scanDependenciesForTable(
  tableName: string,
  masterRows: SqliteMasterObject[]
): DependencyScanResult {
  const dependentViews: DependencyReference[] = [];
  const dependentTriggers: DependencyReference[] = [];

  // Build patterns to match table name references
  // We look for the table name with word boundaries or common SQL delimiters
  const patterns = buildTableReferencePatterns(tableName);

  for (const row of masterRows) {
    if (!row.sql) continue;

    // Skip the table itself
    if (row.type === 'table' && row.name.toLowerCase() === tableName.toLowerCase()) {
      continue;
    }

    // Check views
    if (row.type === 'view') {
      const matches = matchesAnyPattern(row.sql, patterns);
      if (matches) {
        dependentViews.push({
          type: 'view',
          name: row.name,
          sql: row.sql,
          isPotential: true, // Textual scan is always potentially a match
        });
      }
    }

    // Check triggers (triggers NOT directly on the target table)
    // Triggers directly on the table are handled separately by the rebuild process
    if (row.type === 'trigger' && row.tblName.toLowerCase() !== tableName.toLowerCase()) {
      const matches = matchesAnyPattern(row.sql, patterns);
      if (matches) {
        dependentTriggers.push({
          type: 'trigger',
          name: row.name,
          sql: row.sql,
          isPotential: true,
        });
      }
    }
  }

  // Sort by name for deterministic output
  dependentViews.sort((a, b) => a.name.localeCompare(b.name));
  dependentTriggers.sort((a, b) => a.name.localeCompare(b.name));

  const totalCount = dependentViews.length + dependentTriggers.length;
  const warningMessage = buildWarningMessage(tableName, undefined, dependentViews, dependentTriggers);

  return {
    tableName,
    dependentViews,
    dependentTriggers,
    totalCount,
    warningMessage,
  };
}

/**
 * Scans sqlite_master SQL text for references to a specific column.
 *
 * This is a best-effort textual scan that looks for column name references
 * in view and trigger SQL definitions. It may have false positives but
 * should not miss actual references in typical SQL.
 *
 * @param tableName Table that contains the column
 * @param columnName Column name to search for
 * @param masterRows Rows from sqlite_master
 * @returns Scan result with found dependencies
 */
export function scanDependenciesForColumn(
  tableName: string,
  columnName: string,
  masterRows: SqliteMasterObject[]
): DependencyScanResult {
  const dependentViews: DependencyReference[] = [];
  const dependentTriggers: DependencyReference[] = [];

  // Build patterns to match column name references
  // More strict than table matching - look for column name with delimiters
  const columnPatterns = buildColumnReferencePatterns(tableName, columnName);
  const tablePatterns = buildTableReferencePatterns(tableName);

  for (const row of masterRows) {
    if (!row.sql) continue;

    // Skip the table itself
    if (row.type === 'table' && row.name.toLowerCase() === tableName.toLowerCase()) {
      continue;
    }

    // Check views
    if (row.type === 'view') {
      // First check if view references the table at all
      if (matchesAnyPattern(row.sql, tablePatterns)) {
        // Then check for column reference
        if (matchesAnyPattern(row.sql, columnPatterns)) {
          dependentViews.push({
            type: 'view',
            name: row.name,
            sql: row.sql,
            isPotential: true,
          });
        }
      }
    }

    // Check triggers not directly on the table
    if (row.type === 'trigger' && row.tblName.toLowerCase() !== tableName.toLowerCase()) {
      if (matchesAnyPattern(row.sql, tablePatterns)) {
        if (matchesAnyPattern(row.sql, columnPatterns)) {
          dependentTriggers.push({
            type: 'trigger',
            name: row.name,
            sql: row.sql,
            isPotential: true,
          });
        }
      }
    }
  }

  // Also include triggers ON the target table that reference the column
  // These are affected if we're renaming/dropping the column
  for (const row of masterRows) {
    if (!row.sql) continue;

    if (row.type === 'trigger' && row.tblName.toLowerCase() === tableName.toLowerCase()) {
      // Check if trigger SQL references the column
      if (matchesAnyPattern(row.sql, columnPatterns)) {
        dependentTriggers.push({
          type: 'trigger',
          name: row.name,
          sql: row.sql,
          isPotential: true,
        });
      }
    }
  }

  // Sort and deduplicate by name
  const uniqueViews = deduplicateByName(dependentViews);
  const uniqueTriggers = deduplicateByName(dependentTriggers);

  uniqueViews.sort((a, b) => a.name.localeCompare(b.name));
  uniqueTriggers.sort((a, b) => a.name.localeCompare(b.name));

  const totalCount = uniqueViews.length + uniqueTriggers.length;
  const warningMessage = buildWarningMessage(tableName, columnName, uniqueViews, uniqueTriggers);

  return {
    tableName,
    columnName,
    dependentViews: uniqueViews,
    dependentTriggers: uniqueTriggers,
    totalCount,
    warningMessage,
  };
}

/**
 * Builds regex patterns to match table name references in SQL.
 */
function buildTableReferencePatterns(tableName: string): RegExp[] {
  const escaped = escapeRegExp(tableName);

  return [
    // Unquoted: FROM table, JOIN table, INTO table, UPDATE table, etc.
    new RegExp(`(?:^|[\\s,.(])${escaped}(?:[\\s,.)"]|$)`, 'i'),
    // Double-quoted: "table"
    new RegExp(`"${escaped}"`, 'i'),
    // Square-bracket quoted: [table]
    new RegExp(`\\[${escaped}\\]`, 'i'),
    // Backtick quoted: `table`
    new RegExp(`\`${escaped}\``, 'i'),
  ];
}

/**
 * Builds regex patterns to match column name references in SQL.
 */
function buildColumnReferencePatterns(tableName: string, columnName: string): RegExp[] {
  const escapedCol = escapeRegExp(columnName);
  const escapedTable = escapeRegExp(tableName);

  return [
    // Unqualified column: SELECT column, WHERE column = ...
    new RegExp(`(?:^|[\\s,.(])${escapedCol}(?:[\\s,.)=<>!]|$)`, 'i'),
    // Qualified column: table.column
    new RegExp(`${escapedTable}\\.${escapedCol}(?:[\\s,.)=<>!]|$)`, 'i'),
    // Double-quoted: "column"
    new RegExp(`"${escapedCol}"`, 'i'),
    // Square-bracket quoted: [column]
    new RegExp(`\\[${escapedCol}\\]`, 'i'),
    // Backtick quoted: `column`
    new RegExp(`\`${escapedCol}\``, 'i'),
    // In NEW/OLD references for triggers: NEW.column, OLD.column
    new RegExp(`(?:NEW|OLD)\\.${escapedCol}(?:[\\s,.)=<>!]|$)`, 'i'),
  ];
}

/**
 * Tests if a SQL string matches any of the provided patterns.
 */
function matchesAnyPattern(sql: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(sql));
}

/**
 * Removes duplicate entries by name.
 */
function deduplicateByName(refs: DependencyReference[]): DependencyReference[] {
  const seen = new Set<string>();
  const result: DependencyReference[] = [];

  for (const ref of refs) {
    if (!seen.has(ref.name)) {
      seen.add(ref.name);
      result.push(ref);
    }
  }

  return result;
}

/**
 * Builds a human-readable warning message for found dependencies.
 */
function buildWarningMessage(
  tableName: string,
  columnName: string | undefined,
  views: DependencyReference[],
  triggers: DependencyReference[]
): string {
  if (views.length === 0 && triggers.length === 0) {
    return '';
  }

  const target = columnName
    ? `column "${columnName}" in table "${tableName}"`
    : `table "${tableName}"`;

  const parts: string[] = [];

  if (views.length > 0) {
    const viewNames = views.map((v) => `"${v.name}"`).join(', ');
    parts.push(`${views.length} view(s): ${viewNames}`);
  }

  if (triggers.length > 0) {
    const triggerNames = triggers.map((t) => `"${t.name}"`).join(', ');
    parts.push(`${triggers.length} trigger(s): ${triggerNames}`);
  }

  return `Found ${views.length + triggers.length} dependent object(s) that may reference ${target}:\n${parts.join('\n')}\n\nNote: These objects may fail to compile after the rebuild. The operation will be rolled back if any dependent object fails validation.`;
}

/**
 * Formats dependency scan results for display in confirmation dialogs.
 *
 * @param result Scan result to format
 * @returns Formatted string suitable for display
 */
export function formatDependencyScanForDisplay(result: DependencyScanResult): string {
  if (result.totalCount === 0) {
    return '';
  }

  const lines: string[] = [];
  lines.push(`⚠️ Dependency Warning`);
  lines.push('');
  lines.push(result.warningMessage);

  return lines.join('\n');
}

/**
 * Creates a combined scan for both table-level and column-level dependencies.
 *
 * Use this when you need to check dependencies for multiple columns being
 * modified in a single operation.
 *
 * @param tableName Table being modified
 * @param columnNames Columns being modified (renamed, dropped, etc.)
 * @param masterRows Rows from sqlite_master
 * @returns Combined scan result
 */
export function scanDependenciesForColumns(
  tableName: string,
  columnNames: string[],
  masterRows: SqliteMasterObject[]
): DependencyScanResult {
  // If no specific columns, just scan for table references
  if (columnNames.length === 0) {
    return scanDependenciesForTable(tableName, masterRows);
  }

  // Scan for each column and combine results
  const allViews: DependencyReference[] = [];
  const allTriggers: DependencyReference[] = [];

  for (const col of columnNames) {
    const colResult = scanDependenciesForColumn(tableName, col, masterRows);
    allViews.push(...colResult.dependentViews);
    allTriggers.push(...colResult.dependentTriggers);
  }

  // Deduplicate
  const uniqueViews = deduplicateByName(allViews);
  const uniqueTriggers = deduplicateByName(allTriggers);

  uniqueViews.sort((a, b) => a.name.localeCompare(b.name));
  uniqueTriggers.sort((a, b) => a.name.localeCompare(b.name));

  const totalCount = uniqueViews.length + uniqueTriggers.length;

  // Build combined warning message
  let warningMessage = '';
  if (totalCount > 0) {
    const colList = columnNames.map((c) => `"${c}"`).join(', ');
    const target =
      columnNames.length === 1
        ? `column ${colList} in table "${tableName}"`
        : `columns ${colList} in table "${tableName}"`;

    const parts: string[] = [];

    if (uniqueViews.length > 0) {
      const viewNames = uniqueViews.map((v) => `"${v.name}"`).join(', ');
      parts.push(`${uniqueViews.length} view(s): ${viewNames}`);
    }

    if (uniqueTriggers.length > 0) {
      const triggerNames = uniqueTriggers.map((t) => `"${t.name}"`).join(', ');
      parts.push(`${uniqueTriggers.length} trigger(s): ${triggerNames}`);
    }

    warningMessage = `Found ${totalCount} dependent object(s) that may reference ${target}:\n${parts.join('\n')}\n\nNote: These objects may fail to compile after the rebuild. The operation will be rolled back if any dependent object fails validation.`;
  }

  return {
    tableName,
    dependentViews: uniqueViews,
    dependentTriggers: uniqueTriggers,
    totalCount,
    warningMessage,
  };
}
