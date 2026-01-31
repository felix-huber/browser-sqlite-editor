/**
 * AST patch operations for CREATE TABLE modifications.
 *
 * These operations modify the AST immutably and preserve all clauses
 * (CHECK, GENERATED, STRICT, WITHOUT ROWID, etc.).
 */

import type { CreateTableNode, ColumnNode } from './ddl-parser'

export interface AddColumnOptions {
  /** Insert the column after this column name. If not specified, adds at end. */
  afterColumn?: string
}

/**
 * Adds a column to a CREATE TABLE AST.
 *
 * @param ast - The CREATE TABLE AST to modify
 * @param column - The column definition to add
 * @param options - Optional placement options
 * @returns A new AST with the column added (original is not mutated)
 */
export function addColumn(
  ast: CreateTableNode,
  column: ColumnNode,
  options?: AddColumnOptions
): CreateTableNode {
  const newColumns = [...ast.columns]

  if (options?.afterColumn) {
    const index = newColumns.findIndex(
      (c) => c.name.toLowerCase() === options.afterColumn!.toLowerCase()
    )
    if (index === -1) {
      throw new Error(`Column "${options.afterColumn}" not found`)
    }
    newColumns.splice(index + 1, 0, column)
  } else {
    newColumns.push(column)
  }

  return {
    ...ast,
    columns: newColumns,
    // Explicitly preserve all other properties
    tableConstraints: [...ast.tableConstraints],
    primaryKeyColumns: ast.primaryKeyColumns ? [...ast.primaryKeyColumns] : undefined,
    withoutRowid: ast.withoutRowid,
    strict: ast.strict,
  }
}

/**
 * Renames a column in a CREATE TABLE AST.
 *
 * Note: This only renames the column definition. It does NOT update
 * references to the column in CHECK constraints, GENERATED expressions,
 * or foreign key constraints. Those would need separate handling.
 *
 * @param ast - The CREATE TABLE AST to modify
 * @param oldName - The current column name
 * @param newName - The new column name
 * @returns A new AST with the column renamed (original is not mutated)
 */
export function renameColumn(
  ast: CreateTableNode,
  oldName: string,
  newName: string
): CreateTableNode {
  const index = ast.columns.findIndex(
    (c) => c.name.toLowerCase() === oldName.toLowerCase()
  )
  if (index === -1) {
    throw new Error(`Column "${oldName}" not found`)
  }

  const newColumns = ast.columns.map((col, i) => {
    if (i === index) {
      return { ...col, name: newName }
    }
    return { ...col }
  })

  return {
    ...ast,
    columns: newColumns,
    // Explicitly preserve all other properties
    tableConstraints: [...ast.tableConstraints],
    primaryKeyColumns: ast.primaryKeyColumns ? [...ast.primaryKeyColumns] : undefined,
    withoutRowid: ast.withoutRowid,
    strict: ast.strict,
  }
}
