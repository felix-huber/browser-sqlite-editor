/**
 * Foreign Key Relationship Query Utilities
 *
 * This module provides functions to query and navigate foreign key relationships
 * in a SQLite database using PRAGMA foreign_key_list.
 */

import type { ForeignKeyInfo, ForeignKeyAction, QueryResult } from '../types';

/**
 * Raw row from PRAGMA foreign_key_list
 * Columns: id, seq, table, from, to, on_update, on_delete, match
 */
type ForeignKeyListRow = [
  number,  // id - FK constraint id
  number,  // seq - column sequence within this FK
  string,  // table - parent table name
  string,  // from - child column name
  string,  // to - parent column name
  string,  // on_update - ON UPDATE action
  string,  // on_delete - ON DELETE action
  string,  // match - MATCH type
];

/**
 * Normalize an action string from PRAGMA to ForeignKeyAction type.
 *
 * SQLite returns action names in various cases; normalize to uppercase.
 */
function normalizeAction(action: string): ForeignKeyAction {
  const normalized = action.toUpperCase().trim();
  switch (normalized) {
    case 'CASCADE':
      return 'CASCADE';
    case 'RESTRICT':
      return 'RESTRICT';
    case 'SET NULL':
      return 'SET NULL';
    case 'SET DEFAULT':
      return 'SET DEFAULT';
    case 'NO ACTION':
    default:
      return 'NO ACTION';
  }
}

/**
 * Parse PRAGMA foreign_key_list results for a single table.
 *
 * @param childTable - The table name that owns the FK constraints
 * @param result - Query result from PRAGMA foreign_key_list(table)
 * @returns Array of ForeignKeyInfo for this table
 */
export function parseForeignKeyList(
  childTable: string,
  result: QueryResult
): ForeignKeyInfo[] {
  const fks: ForeignKeyInfo[] = [];

  for (const row of result.rows) {
    const [id, , parentTable, childColumn, parentColumn, onUpdate, onDelete, match] =
      row as ForeignKeyListRow;

    fks.push({
      id,
      childTable,
      childColumn: childColumn || '',
      parentTable: parentTable || '',
      parentColumn: parentColumn || '',
      onUpdate: normalizeAction(onUpdate || 'NO ACTION'),
      onDelete: normalizeAction(onDelete || 'NO ACTION'),
      match: match || 'NONE',
    });
  }

  return fks;
}

/**
 * Relationship graph for navigating FK connections between tables.
 *
 * Provides efficient lookup of:
 * - Outgoing FKs: Which tables does a table reference?
 * - Incoming FKs: Which tables reference a given table?
 */
export class ForeignKeyGraph {
  /** All FK relationships in the database */
  private readonly relationships: ForeignKeyInfo[];

  /** Map from child table to its FK relationships (outgoing) */
  private readonly outgoing: Map<string, ForeignKeyInfo[]>;

  /** Map from parent table to FK relationships pointing to it (incoming) */
  private readonly incoming: Map<string, ForeignKeyInfo[]>;

  /**
   * Build a relationship graph from a list of foreign keys.
   *
   * @param foreignKeys - All FK relationships in the database
   */
  constructor(foreignKeys: ForeignKeyInfo[]) {
    this.relationships = foreignKeys;
    this.outgoing = new Map();
    this.incoming = new Map();

    for (const fk of foreignKeys) {
      // Add to outgoing map (child -> parent)
      const existingOut = this.outgoing.get(fk.childTable) || [];
      existingOut.push(fk);
      this.outgoing.set(fk.childTable, existingOut);

      // Add to incoming map (parent <- child)
      const existingIn = this.incoming.get(fk.parentTable) || [];
      existingIn.push(fk);
      this.incoming.set(fk.parentTable, existingIn);
    }
  }

  /**
   * Get all FK relationships in the database.
   */
  getAll(): ForeignKeyInfo[] {
    return this.relationships;
  }

  /**
   * Get FKs where the given table is the child (has FK columns).
   *
   * These are the "outgoing" references - tables this table depends on.
   *
   * @param table - Table name
   * @returns FK relationships where this table is the child
   */
  getOutgoingFKs(table: string): ForeignKeyInfo[] {
    return this.outgoing.get(table) || [];
  }

  /**
   * Get FKs where the given table is the parent (is referenced).
   *
   * These are the "incoming" references - tables that depend on this table.
   *
   * @param table - Table name
   * @returns FK relationships where this table is the parent
   */
  getIncomingFKs(table: string): ForeignKeyInfo[] {
    return this.incoming.get(table) || [];
  }

  /**
   * Get all tables that the given table references.
   *
   * @param table - Table name
   * @returns List of unique table names that this table references
   */
  getReferencedTables(table: string): string[] {
    const fks = this.getOutgoingFKs(table);
    const tables = new Set(fks.map((fk) => fk.parentTable));
    return Array.from(tables);
  }

  /**
   * Get all tables that reference the given table.
   *
   * @param table - Table name
   * @returns List of unique table names that reference this table
   */
  getReferencingTables(table: string): string[] {
    const fks = this.getIncomingFKs(table);
    const tables = new Set(fks.map((fk) => fk.childTable));
    return Array.from(tables);
  }

  /**
   * Check if a relationship exists between two tables.
   *
   * @param childTable - The table with the FK
   * @param parentTable - The referenced table
   * @returns True if childTable has an FK to parentTable
   */
  hasRelationship(childTable: string, parentTable: string): boolean {
    const fks = this.getOutgoingFKs(childTable);
    return fks.some((fk) => fk.parentTable === parentTable);
  }

  /**
   * Get FKs between two specific tables.
   *
   * @param childTable - The table with the FK
   * @param parentTable - The referenced table
   * @returns FK relationships from childTable to parentTable
   */
  getRelationships(childTable: string, parentTable: string): ForeignKeyInfo[] {
    const fks = this.getOutgoingFKs(childTable);
    return fks.filter((fk) => fk.parentTable === parentTable);
  }

  /**
   * Check if any table has a self-referential FK.
   *
   * @param table - Table name
   * @returns True if the table references itself
   */
  isSelfReferential(table: string): boolean {
    return this.hasRelationship(table, table);
  }

  /**
   * Get all tables involved in FK relationships.
   *
   * @returns Set of table names that have or are referenced by FKs
   */
  getAllTables(): Set<string> {
    const tables = new Set<string>();
    for (const fk of this.relationships) {
      tables.add(fk.childTable);
      tables.add(fk.parentTable);
    }
    return tables;
  }
}

/**
 * Build a ForeignKeyGraph from an array of ForeignKeyInfo.
 *
 * @param foreignKeys - All FK relationships in the database
 * @returns A navigable FK graph
 */
export function buildForeignKeyGraph(foreignKeys: ForeignKeyInfo[]): ForeignKeyGraph {
  return new ForeignKeyGraph(foreignKeys);
}
