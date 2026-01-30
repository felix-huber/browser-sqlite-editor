/**
 * Extraction helpers for rebuild planning.
 */

import type { ForeignKeyInfo } from '../../types';
import type {
  SqliteMasterObject,
  IndexObject,
  TriggerObject,
  ViewReference,
  IncomingForeignKey,
  TableDependents,
} from './types';
import { escapeRegExp } from './utils';

/**
 * Extracts the CREATE TABLE statement for a table from sqlite_master.
 *
 * @param tableName - Table name
 * @param masterRows - Rows from sqlite_master
 * @returns The CREATE TABLE SQL, or null if not found
 */
export function extractCreateTableSql(
  tableName: string,
  masterRows: SqliteMasterObject[]
): string | null {
  const tableRow = masterRows.find(
    (row) =>
      row.type === 'table' &&
      row.name.toLowerCase() === tableName.toLowerCase()
  );
  return tableRow?.sql ?? null;
}

/**
 * Extracts indexes for a table from sqlite_master.
 *
 * @param tableName - Table name
 * @param masterRows - Rows from sqlite_master
 * @returns List of indexes (excluding auto-indexes without SQL)
 */
export function extractIndexes(
  tableName: string,
  masterRows: SqliteMasterObject[]
): IndexObject[] {
  const indexes: IndexObject[] = [];

  for (const row of masterRows) {
    if (
      row.type === 'index' &&
      row.tblName.toLowerCase() === tableName.toLowerCase()
    ) {
      // Auto-indexes created by UNIQUE/PK constraints have names starting with
      // "sqlite_autoindex_" and have null SQL
      const isAutoIndex = row.name.startsWith('sqlite_autoindex_') || row.sql === null;

      indexes.push({
        name: row.name,
        tableName: row.tblName,
        sql: row.sql,
        isAutoIndex,
      });
    }
  }

  // Sort by name for deterministic output
  indexes.sort((a, b) => a.name.localeCompare(b.name));

  return indexes;
}

/**
 * Extracts triggers for a table from sqlite_master.
 *
 * @param tableName - Table name
 * @param masterRows - Rows from sqlite_master
 * @returns List of triggers
 */
export function extractTriggers(
  tableName: string,
  masterRows: SqliteMasterObject[]
): TriggerObject[] {
  const triggers: TriggerObject[] = [];

  for (const row of masterRows) {
    if (
      row.type === 'trigger' &&
      row.tblName.toLowerCase() === tableName.toLowerCase() &&
      row.sql !== null
    ) {
      triggers.push({
        name: row.name,
        tableName: row.tblName,
        sql: row.sql,
      });
    }
  }

  // Sort by name for deterministic output
  triggers.sort((a, b) => a.name.localeCompare(b.name));

  return triggers;
}

/**
 * Extracts views that reference a table.
 *
 * This uses simple string matching to find table references in view SQL.
 * It may have false positives but won't miss actual references.
 *
 * @param tableName - Table name to search for
 * @param masterRows - Rows from sqlite_master
 * @returns List of views that reference the table
 */
export function extractViewsReferencingTable(
  tableName: string,
  masterRows: SqliteMasterObject[]
): ViewReference[] {
  const views: ViewReference[] = [];
  const tableNameLower = tableName.toLowerCase();

  // Pattern to match table name with word boundaries
  // This matches: FROM tablename, JOIN tablename, ,tablename, etc.
  const tablePattern = new RegExp(
    `(?:^|[\\s,("'])${escapeRegExp(tableNameLower)}(?:[\\s,)"']|$)`,
    'i'
  );

  for (const row of masterRows) {
    if (row.type === 'view' && row.sql !== null) {
      // Check if the view SQL references the table
      if (tablePattern.test(row.sql)) {
        views.push({
          name: row.name,
          sql: row.sql,
        });
      }
    }
  }

  // Sort by name for deterministic output
  views.sort((a, b) => a.name.localeCompare(b.name));

  return views;
}

/**
 * Groups foreign key info items by constraint ID.
 *
 * @param fkInfos - Foreign key info items from PRAGMA foreign_key_list
 * @returns Array of grouped foreign keys
 */
export function groupForeignKeys(
  fkInfos: ForeignKeyInfo[]
): Map<number, ForeignKeyInfo[]> {
  const groups = new Map<number, ForeignKeyInfo[]>();

  for (const fk of fkInfos) {
    const existing = groups.get(fk.id) || [];
    existing.push(fk);
    groups.set(fk.id, existing);
  }

  return groups;
}

/**
 * Finds foreign keys from other tables that reference the given table.
 *
 * @param tableName - Table being referenced
 * @param allForeignKeys - Map of table name to its foreign keys
 * @returns List of incoming foreign keys
 */
export function extractIncomingForeignKeys(
  tableName: string,
  allForeignKeys: Map<string, ForeignKeyInfo[]>
): IncomingForeignKey[] {
  const incoming: IncomingForeignKey[] = [];
  const tableNameLower = tableName.toLowerCase();

  for (const [fromTable, fkInfos] of allForeignKeys) {
    // Skip self-references for this list
    if (fromTable.toLowerCase() === tableNameLower) {
      continue;
    }

    // Group by FK ID
    const grouped = groupForeignKeys(fkInfos);

    for (const [, fkGroup] of grouped) {
      // Check if this FK references our table
      if (fkGroup[0].parentTable.toLowerCase() === tableNameLower) {
        incoming.push({
          fromTable,
          fromColumns: fkGroup.map((fk) => fk.childColumn),
          toColumns: fkGroup.map((fk) => fk.parentColumn),
          onDelete: fkGroup[0].onDelete,
          onUpdate: fkGroup[0].onUpdate,
        });
      }
    }
  }

  // Sort by table name for deterministic output
  incoming.sort((a, b) => a.fromTable.localeCompare(b.fromTable));

  return incoming;
}

/**
 * Extracts all dependent objects for a table.
 *
 * @param tableName - Table name
 * @param masterRows - Rows from sqlite_master
 * @param allForeignKeys - Map of table name to its foreign keys
 * @returns All dependent objects
 */
export function extractTableDependents(
  tableName: string,
  masterRows: SqliteMasterObject[],
  allForeignKeys: Map<string, ForeignKeyInfo[]>
): TableDependents {
  const createTableSql = extractCreateTableSql(tableName, masterRows);
  if (!createTableSql) {
    throw new Error(`Table "${tableName}" not found in sqlite_master`);
  }

  return {
    createTableSql,
    indexes: extractIndexes(tableName, masterRows),
    triggers: extractTriggers(tableName, masterRows),
    views: extractViewsReferencingTable(tableName, masterRows),
    incomingForeignKeys: extractIncomingForeignKeys(tableName, allForeignKeys),
  };
}
