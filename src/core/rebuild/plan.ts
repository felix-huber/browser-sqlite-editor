/**
 * Rebuild plan generation.
 */

import type { RebuildPlan, RebuildOperation, TableDependents } from './types';
import { escapeRegExp, quoteIdentifier } from './utils';

/**
 * Generates a rebuild plan for a table.
 *
 * The plan follows SQLite's recommended 12-step process but adapted:
 * 1. Disable foreign key enforcement
 * 2. Start transaction
 * 3. Create new table with new schema (temp name)
 * 4. Copy data from old table
 * 5. Drop old table
 * 6. Rename new table to original name
 * 7. Recreate indexes
 * 8. Recreate triggers
 * 9. (Views don't need recreation unless columns changed)
 * 10. Run FK check
 * 11. Commit transaction
 * 12. Re-enable foreign keys
 *
 * @param tableName - Table to rebuild
 * @param newCreateTableSql - New CREATE TABLE statement
 * @param dependents - Dependent objects from extractTableDependents
 * @param columnMapping - Optional mapping of old column names to new names for data copy
 * @returns Complete rebuild plan
 */
export function generateRebuildPlan(
  tableName: string,
  newCreateTableSql: string,
  dependents: TableDependents,
  columnMapping?: Map<string, string>
): RebuildPlan {
  const operations: RebuildOperation[] = [];
  const tempTableName = `_${tableName}_rebuild_temp`;

  // Step 1: Disable foreign key enforcement
  operations.push({
    type: 'disable_fk',
    sql: 'PRAGMA foreign_keys = OFF',
    description: 'Disable foreign key enforcement',
  });

  // Step 2: Begin transaction
  operations.push({
    type: 'begin_transaction',
    sql: 'BEGIN TRANSACTION',
    description: 'Start rebuild transaction',
  });

  // Step 3: Create temp table with new schema
  // Replace the table name in the CREATE statement with temp name
  const tempCreateSql = replaceTableNameInCreate(
    newCreateTableSql,
    tableName,
    tempTableName
  );
  operations.push({
    type: 'create_temp_table',
    sql: tempCreateSql,
    description: `Create temporary table "${tempTableName}"`,
    objectName: tempTableName,
  });

  // Step 4: Copy data
  const copyDataSql = generateCopyDataSql(
    tableName,
    tempTableName,
    columnMapping
  );
  operations.push({
    type: 'copy_data',
    sql: copyDataSql,
    description: `Copy data from "${tableName}" to "${tempTableName}"`,
  });

  // Step 5: Drop original table
  operations.push({
    type: 'drop_original',
    sql: `DROP TABLE ${quoteIdentifier(tableName)}`,
    description: `Drop original table "${tableName}"`,
    objectName: tableName,
  });

  // Step 6: Rename temp table to original name
  operations.push({
    type: 'rename_temp',
    sql: `ALTER TABLE ${quoteIdentifier(tempTableName)} RENAME TO ${quoteIdentifier(tableName)}`,
    description: `Rename "${tempTableName}" to "${tableName}"`,
  });

  // Step 7: Recreate user-created indexes (skip auto-indexes)
  for (const index of dependents.indexes) {
    if (!index.isAutoIndex && index.sql) {
      operations.push({
        type: 'recreate_index',
        sql: index.sql,
        description: `Recreate index "${index.name}"`,
        objectName: index.name,
      });
    }
  }

  // Step 8: Recreate triggers
  for (const trigger of dependents.triggers) {
    operations.push({
      type: 'recreate_trigger',
      sql: trigger.sql,
      description: `Recreate trigger "${trigger.name}"`,
      objectName: trigger.name,
    });
  }

  // Note: Views don't need to be recreated unless their columns are affected
  // The caller should handle view recreation if needed

  // Step 9: Run FK check
  operations.push({
    type: 'fk_check',
    sql: `PRAGMA foreign_key_check(${quoteIdentifier(tableName)})`,
    description: 'Verify foreign key integrity',
  });

  // Step 10: Commit transaction
  operations.push({
    type: 'commit_transaction',
    sql: 'COMMIT',
    description: 'Commit rebuild transaction',
  });

  // Step 11: Re-enable foreign keys
  operations.push({
    type: 'enable_fk',
    sql: 'PRAGMA foreign_keys = ON',
    description: 'Re-enable foreign key enforcement',
  });

  return {
    tableName,
    operations,
    dependents,
    affectsOtherTables: dependents.incomingForeignKeys.length > 0,
  };
}

/**
 * Replaces the table name in a CREATE TABLE statement.
 *
 * @param sql - Original CREATE TABLE SQL
 * @param oldName - Original table name
 * @param newName - New table name
 * @returns SQL with replaced table name
 */
export function replaceTableNameInCreate(
  sql: string,
  oldName: string,
  newName: string
): string {
  // Match CREATE TABLE [IF NOT EXISTS] <name>
  // Handle both quoted and unquoted names
  const patterns = [
    // Unquoted name
    new RegExp(
      `(CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?)${escapeRegExp(oldName)}(\\s*\\()`,
      'i'
    ),
    // Double-quoted name
    new RegExp(
      `(CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?)"${escapeRegExp(oldName)}"(\\s*\\()`,
      'i'
    ),
    // Square-bracket quoted name
    new RegExp(
      `(CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?)\\[${escapeRegExp(oldName)}\\](\\s*\\()`,
      'i'
    ),
  ];

  for (const pattern of patterns) {
    if (pattern.test(sql)) {
      return sql.replace(pattern, `$1${quoteIdentifier(newName)}$2`);
    }
  }

  // Fallback: just return original if we can't match
  // This shouldn't happen with valid SQL
  return sql;
}

/**
 * Generates SQL to copy data between tables.
 *
 * @param fromTable - Source table
 * @param toTable - Destination table
 * @param columnMapping - Optional mapping of old column names to new names
 * @returns INSERT ... SELECT SQL
 */
export function generateCopyDataSql(
  fromTable: string,
  toTable: string,
  columnMapping?: Map<string, string>
): string {
  if (!columnMapping || columnMapping.size === 0) {
    // Simple case: copy all columns with same names
    return `INSERT INTO ${quoteIdentifier(toTable)} SELECT * FROM ${quoteIdentifier(fromTable)}`;
  }

  // Build explicit column lists
  const oldColumns: string[] = [];
  const newColumns: string[] = [];

  for (const [oldCol, newCol] of columnMapping) {
    oldColumns.push(quoteIdentifier(oldCol));
    newColumns.push(quoteIdentifier(newCol));
  }

  return `INSERT INTO ${quoteIdentifier(toTable)} (${newColumns.join(', ')}) SELECT ${oldColumns.join(', ')} FROM ${quoteIdentifier(fromTable)}`;
}

/**
 * Generates SQL to copy data between tables with column transformations.
 *
 * This handles:
 * - Column renames (via mapping)
 * - Removed columns (excluded from copy)
 * - Added columns (receive NULL or DEFAULT)
 * - Type coercion (handled by SQLite automatically)
 *
 * @param fromTable Source table
 * @param toTable Destination table (temp table with new schema)
 * @param sourceColumns Columns in the source table
 * @param targetColumns Columns in the target table (new schema)
 * @param columnRenames Map from old column name to new column name
 * @returns INSERT ... SELECT SQL
 */
export function generateColumnMappedCopyDataSql(
  fromTable: string,
  toTable: string,
  sourceColumns: string[],
  targetColumns: string[],
  columnRenames?: Map<string, string>
): string {
  // Build mapping: for each target column, find the source column
  const selectExprs: string[] = [];
  const targetColNames: string[] = [];

  // Create reverse mapping: newName -> oldName
  const reverseRenames = new Map<string, string>();
  if (columnRenames) {
    for (const [oldName, newName] of columnRenames) {
      reverseRenames.set(newName.toLowerCase(), oldName);
    }
  }

  for (const targetCol of targetColumns) {
    const targetLower = targetCol.toLowerCase();

    // Check if this is a renamed column
    const sourceColName = reverseRenames.get(targetLower);
    if (sourceColName) {
      // Column was renamed: SELECT old_name as new_name
      selectExprs.push(quoteIdentifier(sourceColName));
      targetColNames.push(quoteIdentifier(targetCol));
    } else if (sourceColumns.some((s) => s.toLowerCase() === targetLower)) {
      // Column exists with same name in source
      selectExprs.push(quoteIdentifier(targetCol));
      targetColNames.push(quoteIdentifier(targetCol));
    }
    // Else: new column, will get NULL/DEFAULT - don't include in INSERT
  }

  if (selectExprs.length === 0) {
    // No columns to copy - just create empty table
    return `INSERT INTO ${quoteIdentifier(toTable)} SELECT * FROM ${quoteIdentifier(fromTable)} WHERE 0`;
  }

  return `INSERT INTO ${quoteIdentifier(toTable)} (${targetColNames.join(', ')}) SELECT ${selectExprs.join(', ')} FROM ${quoteIdentifier(fromTable)}`;
}

/**
 * Creates a rebuild plan with explicit column mapping for schema changes.
 *
 * Use this when you know exactly which columns are being:
 * - Renamed (provide in columnRenames map)
 * - Added (in newColumns but not in oldColumns)
 * - Removed (in oldColumns but not in newColumns)
 *
 * @param tableName Table to rebuild
 * @param newCreateTableSql New CREATE TABLE SQL
 * @param dependents Dependent objects
 * @param oldColumns Columns in current schema
 * @param newColumns Columns in new schema
 * @param columnRenames Map from old column name to new column name
 * @returns Rebuild plan with correct column mapping
 */
export function generateRebuildPlanWithColumnMapping(
  tableName: string,
  newCreateTableSql: string,
  dependents: TableDependents,
  oldColumns: string[],
  newColumns: string[],
  columnRenames?: Map<string, string>
): RebuildPlan {
  const operations: RebuildOperation[] = [];
  const tempTableName = `_${tableName}_rebuild_temp`;

  // Step 1: Disable foreign key enforcement
  operations.push({
    type: 'disable_fk',
    sql: 'PRAGMA foreign_keys = OFF',
    description: 'Disable foreign key enforcement',
  });

  // Step 2: Begin transaction
  operations.push({
    type: 'begin_transaction',
    sql: 'BEGIN TRANSACTION',
    description: 'Start rebuild transaction',
  });

  // Step 3: Create temp table with new schema
  const tempCreateSql = replaceTableNameInCreate(
    newCreateTableSql,
    tableName,
    tempTableName
  );
  operations.push({
    type: 'create_temp_table',
    sql: tempCreateSql,
    description: `Create temporary table "${tempTableName}"`,
    objectName: tempTableName,
  });

  // Step 4: Copy data with column mapping
  const copyDataSql = generateColumnMappedCopyDataSql(
    tableName,
    tempTableName,
    oldColumns,
    newColumns,
    columnRenames
  );
  operations.push({
    type: 'copy_data',
    sql: copyDataSql,
    description: `Copy data from "${tableName}" to "${tempTableName}"`,
  });

  // Step 5: Drop original table
  operations.push({
    type: 'drop_original',
    sql: `DROP TABLE ${quoteIdentifier(tableName)}`,
    description: `Drop original table "${tableName}"`,
    objectName: tableName,
  });

  // Step 6: Rename temp table to original name
  operations.push({
    type: 'rename_temp',
    sql: `ALTER TABLE ${quoteIdentifier(tempTableName)} RENAME TO ${quoteIdentifier(tableName)}`,
    description: `Rename "${tempTableName}" to "${tableName}"`,
  });

  // Step 7: Recreate user-created indexes (skip auto-indexes)
  for (const index of dependents.indexes) {
    if (!index.isAutoIndex && index.sql) {
      operations.push({
        type: 'recreate_index',
        sql: index.sql,
        description: `Recreate index "${index.name}"`,
        objectName: index.name,
      });
    }
  }

  // Step 8: Recreate triggers
  for (const trigger of dependents.triggers) {
    operations.push({
      type: 'recreate_trigger',
      sql: trigger.sql,
      description: `Recreate trigger "${trigger.name}"`,
      objectName: trigger.name,
    });
  }

  // Step 9: Run FK check
  operations.push({
    type: 'fk_check',
    sql: `PRAGMA foreign_key_check(${quoteIdentifier(tableName)})`,
    description: 'Verify foreign key integrity',
  });

  // Step 10: Commit transaction
  operations.push({
    type: 'commit_transaction',
    sql: 'COMMIT',
    description: 'Commit rebuild transaction',
  });

  // Step 11: Re-enable foreign keys
  operations.push({
    type: 'enable_fk',
    sql: 'PRAGMA foreign_keys = ON',
    description: 'Re-enable foreign key enforcement',
  });

  return {
    tableName,
    operations,
    dependents,
    affectsOtherTables: dependents.incomingForeignKeys.length > 0,
  };
}
