/**
 * Strategy module for deciding between native ALTER TABLE and table rebuild.
 *
 * SQLite supports native ALTER TABLE for:
 * - RENAME COLUMN (3.25+): Correctly propagates to indexes/triggers/views
 * - DROP COLUMN (3.35+): When column has no dependencies (not in FK/index/trigger/view)
 *
 * This module encapsulates the decision logic to prefer native ALTER when safe.
 */

import type { SqliteMasterObject, TableDependents } from './types';
import type { DependencyScanResult } from './dependency-scan';
import { scanDependenciesForColumn } from './dependency-scan';
import { quoteIdentifier, escapeRegExp } from './utils';

/**
 * Types of schema modifications that can be applied.
 */
export type SchemaModificationType =
  | 'rename_column'
  | 'drop_column'
  | 'change_type'
  | 'change_fk'
  | 'add_column'
  | 'other';

/**
 * Strategy decision for a schema modification.
 */
export type ModificationStrategy = 'native_alter' | 'rebuild';

/**
 * Result of strategy decision with details.
 */
export interface StrategyDecision {
  /** The recommended strategy */
  strategy: ModificationStrategy;
  /** SQL to execute if using native_alter (undefined for rebuild) */
  sql?: string;
  /** Reason for the decision */
  reason: string;
  /** Column dependencies that forced a rebuild (if any) */
  dependencies?: DependencyScanResult;
}

/**
 * Input for a column rename operation.
 */
export interface ColumnRenameInput {
  tableName: string;
  oldColumnName: string;
  newColumnName: string;
}

/**
 * Input for a column drop operation.
 */
export interface ColumnDropInput {
  tableName: string;
  columnName: string;
  /** Rows from sqlite_master for dependency scanning */
  masterRows: SqliteMasterObject[];
  /** Table dependents (indexes, triggers, etc.) */
  dependents: TableDependents;
}

/**
 * Determines the strategy for renaming a column.
 *
 * Column renames always use native ALTER TABLE RENAME COLUMN (SQLite >= 3.25).
 * SQLite correctly propagates the rename to indexes, triggers, and views.
 *
 * @param input - Column rename parameters
 * @returns Strategy decision with SQL for native alter
 */
export function getColumnRenameStrategy(input: ColumnRenameInput): StrategyDecision {
  const { tableName, oldColumnName, newColumnName } = input;

  // Column rename always uses native ALTER TABLE
  // SQLite handles view/trigger updates automatically since 3.25
  const sql = `ALTER TABLE ${quoteIdentifier(tableName)} RENAME COLUMN ${quoteIdentifier(oldColumnName)} TO ${quoteIdentifier(newColumnName)}`;

  return {
    strategy: 'native_alter',
    sql,
    reason: 'Column rename uses native ALTER TABLE RENAME COLUMN (SQLite handles view/trigger updates)',
  };
}

/**
 * Determines the strategy for dropping a column.
 *
 * Column drops use native ALTER TABLE DROP COLUMN (SQLite >= 3.35) when safe:
 * - Column is not referenced by any index
 * - Column is not referenced by any foreign key constraint
 * - Column is not referenced by any trigger
 * - Column is not referenced by any view
 *
 * If the column has dependencies, a table rebuild is required.
 *
 * @param input - Column drop parameters
 * @returns Strategy decision (native alter or rebuild with reason)
 */
export function getColumnDropStrategy(input: ColumnDropInput): StrategyDecision {
  const { tableName, columnName, masterRows, dependents } = input;

  // Check if column is referenced by any index
  const indexRefs = getColumnIndexReferences(columnName, dependents);
  if (indexRefs.length > 0) {
    return {
      strategy: 'rebuild',
      reason: `Column "${columnName}" is referenced by index(es): ${indexRefs.join(', ')}`,
    };
  }

  // Check if column is part of a foreign key constraint (either as child or parent)
  const fkRefs = getColumnForeignKeyReferences(columnName, dependents);
  if (fkRefs.length > 0) {
    return {
      strategy: 'rebuild',
      reason: `Column "${columnName}" is referenced by foreign key constraint(s): ${fkRefs.join(', ')}`,
    };
  }

  // Check if column is referenced by triggers or views using dependency scan
  const depScan = scanDependenciesForColumn(tableName, columnName, masterRows);
  if (depScan.totalCount > 0) {
    return {
      strategy: 'rebuild',
      reason: `Column "${columnName}" is referenced by dependent objects`,
      dependencies: depScan,
    };
  }

  // No dependencies found - safe to use native DROP COLUMN
  const sql = `ALTER TABLE ${quoteIdentifier(tableName)} DROP COLUMN ${quoteIdentifier(columnName)}`;

  return {
    strategy: 'native_alter',
    sql,
    reason: 'Column has no dependencies, using native ALTER TABLE DROP COLUMN',
  };
}

/**
 * Determines the strategy for a type change.
 *
 * Type changes always require a rebuild because SQLite does not support
 * modifying column types directly.
 *
 * @param tableName - Table name
 * @param columnName - Column being modified
 * @param oldType - Current type
 * @param newType - New type
 * @returns Strategy decision (always rebuild)
 */
export function getTypeChangeStrategy(
  _tableName: string,
  columnName: string,
  oldType: string,
  newType: string
): StrategyDecision {
  return {
    strategy: 'rebuild',
    reason: `Column "${columnName}" type change from ${oldType} to ${newType} requires table rebuild`,
  };
}

/**
 * Determines the strategy for a foreign key modification.
 *
 * FK modifications always require a rebuild because SQLite does not support
 * modifying foreign key constraints directly.
 *
 * @param tableName - Table name
 * @returns Strategy decision (always rebuild)
 */
export function getForeignKeyModificationStrategy(_tableName: string): StrategyDecision {
  return {
    strategy: 'rebuild',
    reason: `Foreign key modification requires table rebuild`,
  };
}

/**
 * Batch strategy input for multiple modifications.
 */
export interface BatchModificationInput {
  tableName: string;
  /** Columns being renamed: oldName -> newName */
  columnRenames?: Map<string, string>;
  /** Columns being dropped */
  columnsToDrop?: string[];
  /** Columns with type changes: columnName -> { oldType, newType } */
  typeChanges?: Map<string, { oldType: string; newType: string }>;
  /** Whether FK is being modified */
  fkModification?: boolean;
  /** Rows from sqlite_master */
  masterRows: SqliteMasterObject[];
  /** Table dependents */
  dependents: TableDependents;
}

/**
 * Result of batch strategy analysis.
 */
export interface BatchStrategyResult {
  /** Overall strategy needed */
  overallStrategy: ModificationStrategy;
  /** Native ALTER statements that can be executed (if not doing full rebuild) */
  nativeAlterStatements: string[];
  /** Modifications that require rebuild */
  rebuildReasons: string[];
  /** Dependency scan results for columns that have dependencies */
  columnDependencies: Map<string, DependencyScanResult>;
}

/**
 * Analyzes a batch of modifications and determines the best strategy.
 *
 * If any modification requires a rebuild, the entire operation should use rebuild.
 * Otherwise, returns the list of native ALTER statements to execute.
 *
 * @param input - Batch modification parameters
 * @returns Batch strategy result
 */
export function getBatchModificationStrategy(input: BatchModificationInput): BatchStrategyResult {
  const {
    tableName,
    columnRenames,
    columnsToDrop,
    typeChanges,
    fkModification,
    masterRows,
    dependents,
  } = input;

  const nativeAlterStatements: string[] = [];
  const rebuildReasons: string[] = [];
  const columnDependencies = new Map<string, DependencyScanResult>();

  // Type changes always require rebuild
  if (typeChanges && typeChanges.size > 0) {
    for (const [colName, { oldType, newType }] of typeChanges) {
      rebuildReasons.push(`Type change on "${colName}": ${oldType} -> ${newType}`);
    }
  }

  // FK modifications always require rebuild
  if (fkModification) {
    rebuildReasons.push('Foreign key constraint modification');
  }

  // If we already know rebuild is needed, skip checking individual columns
  if (rebuildReasons.length > 0) {
    return {
      overallStrategy: 'rebuild',
      nativeAlterStatements: [],
      rebuildReasons,
      columnDependencies,
    };
  }

  // Check column renames (always native)
  if (columnRenames && columnRenames.size > 0) {
    for (const [oldName, newName] of columnRenames) {
      const decision = getColumnRenameStrategy({
        tableName,
        oldColumnName: oldName,
        newColumnName: newName,
      });
      if (decision.sql) {
        nativeAlterStatements.push(decision.sql);
      }
    }
  }

  // Check column drops
  if (columnsToDrop && columnsToDrop.length > 0) {
    for (const colName of columnsToDrop) {
      const decision = getColumnDropStrategy({
        tableName,
        columnName: colName,
        masterRows,
        dependents,
      });

      if (decision.strategy === 'rebuild') {
        rebuildReasons.push(decision.reason);
        if (decision.dependencies) {
          columnDependencies.set(colName, decision.dependencies);
        }
      } else if (decision.sql) {
        nativeAlterStatements.push(decision.sql);
      }
    }
  }

  // Determine overall strategy
  const overallStrategy: ModificationStrategy =
    rebuildReasons.length > 0 ? 'rebuild' : 'native_alter';

  return {
    overallStrategy,
    nativeAlterStatements: overallStrategy === 'native_alter' ? nativeAlterStatements : [],
    rebuildReasons,
    columnDependencies,
  };
}

/**
 * Finds indexes that reference a specific column.
 *
 * @param columnName - Column to check
 * @param dependents - Table dependents
 * @returns Array of index names that reference the column
 */
function getColumnIndexReferences(
  columnName: string,
  dependents: TableDependents
): string[] {
  const refs: string[] = [];
  const colLower = columnName.toLowerCase();

  for (const index of dependents.indexes) {
    // Skip auto-indexes (they're recreated automatically)
    if (index.isAutoIndex) continue;

    // Check if index SQL contains the column name
    if (index.sql) {
      // Simple heuristic: look for the column name in the index definition
      // This handles most cases like: CREATE INDEX idx ON table (col1, col2)
      const sqlLower = index.sql.toLowerCase();

      // Check for column name with common delimiters
      // Use word boundaries or explicit delimiters to avoid matching partial names
      // (e.g., "foo" should not match "foobar")
      const escapedCol = escapeRegExp(colLower);
      const patterns = [
        // Unquoted: (col, or (col) or ,col, or ,col)
        new RegExp(`[,(]\\s*${escapedCol}\\s*(?:[,)]|\\s+(?:asc|desc|collate))`, 'i'),
        // Double-quoted: "col"
        new RegExp(`"${escapedCol}"`, 'i'),
        // Bracket-quoted: [col]
        new RegExp(`\\[${escapedCol}\\]`, 'i'),
        // Backtick-quoted: `col`
        new RegExp(`\`${escapedCol}\``, 'i'),
      ];

      if (patterns.some((p) => p.test(sqlLower))) {
        refs.push(index.name);
      }
    }
  }

  return refs;
}

/**
 * Finds foreign key constraints that reference a specific column.
 *
 * @param columnName - Column to check
 * @param dependents - Table dependents
 * @returns Array of descriptions of FK references
 */
function getColumnForeignKeyReferences(
  columnName: string,
  dependents: TableDependents
): string[] {
  const refs: string[] = [];
  const colLower = columnName.toLowerCase();

  // Check incoming foreign keys (FKs from other tables pointing to this column)
  for (const fk of dependents.incomingForeignKeys) {
    const toColsLower = fk.toColumns.map((c) => c.toLowerCase());
    if (toColsLower.includes(colLower)) {
      refs.push(`FK from ${fk.fromTable}(${fk.fromColumns.join(', ')})`);
    }
  }

  // Check if this column is a FK child by inspecting the CREATE TABLE statement.
  // Look for REFERENCES clauses that use this column.
  // Pattern: column_name ... REFERENCES ... or FOREIGN KEY (column_name) REFERENCES ...
  const createSql = dependents.createTableSql;
  if (createSql) {
    const sqlLower = createSql.toLowerCase();

    // Pattern 1: FOREIGN KEY (col1, col2) REFERENCES ...
    const fkPattern = new RegExp(
      `foreign\\s+key\\s*\\([^)]*\\b${escapeRegExp(colLower)}\\b[^)]*\\)\\s*references`,
      'i'
    );
    if (fkPattern.test(sqlLower)) {
      refs.push(`Column is part of a FOREIGN KEY constraint`);
    }

    // Pattern 2: column_name TYPE REFERENCES table(col) - inline FK
    // This is trickier; for safety, check if column appears near REFERENCES
    const inlinePattern = new RegExp(
      `\\b${escapeRegExp(colLower)}\\b[^,)]*\\breferences\\b`,
      'i'
    );
    if (inlinePattern.test(sqlLower) && !refs.includes(`Column is part of a FOREIGN KEY constraint`)) {
      refs.push(`Column has inline REFERENCES constraint`);
    }
  }

  return refs;
}

