/**
 * SQL SELECT query generation from visual query builder state.
 * Produces deterministic SQL output with parameterized values.
 */

import type { JoinType } from '../../features/query-builder/JoinEdge'
import type { SortCondition } from '../../features/query-builder/OrderByBuilder'
import type { WhereCondition } from '../../features/query-builder/WhereBuilder'
import { generateWhereClause } from '../../features/query-builder/WhereBuilder'
import type { TableInfo } from '../../types'

/** Table on the canvas with its selection state */
export interface QueryTable {
  /** Table name */
  name: string
  /** Table alias (t1, t2, etc.) */
  alias: string
  /** Selected column names (empty = all columns) */
  selectedColumns: string[]
  /** All available columns for this table */
  allColumns: string[]
}

/** Join configuration between two tables */
export interface QueryJoin {
  /** Source table alias */
  sourceAlias: string
  /** Source column name */
  sourceColumn: string
  /** Target table alias */
  targetAlias: string
  /** Target column name */
  targetColumn: string
  /** Join type */
  joinType: JoinType
}

/** Complete query builder state */
export interface QueryBuilderState {
  /** Tables on the canvas (first is FROM, rest are JOINs) */
  tables: QueryTable[]
  /** Join definitions */
  joins: QueryJoin[]
  /** WHERE conditions */
  whereConditions: WhereCondition[]
  /** WHERE logic (AND/OR between conditions) */
  whereLogic: 'AND' | 'OR'
  /** ORDER BY conditions */
  sortConditions: SortCondition[]
  /** LIMIT value (null = no limit) */
  limit: number | null
}

/** Result of SQL generation */
export interface GeneratedQuery {
  /** The SQL query string */
  sql: string
  /** Parameterized values for prepared statement */
  params: unknown[]
}

/**
 * Quote an identifier (table or column name) for SQLite.
 * Uses double quotes and escapes internal quotes.
 */
export function quoteIdentifier(name: string): string {
  // Escape double quotes by doubling them
  const escaped = name.replace(/"/g, '""')
  return `"${escaped}"`
}

/**
 * Generate a qualified column reference: alias.column
 */
function qualifiedColumn(alias: string, column: string): string {
  return `${quoteIdentifier(alias)}.${quoteIdentifier(column)}`
}

/**
 * Handle duplicate column names by adding numeric suffixes.
 * Returns a map from original column reference to output alias.
 */
function resolveColumnAliases(
  tables: QueryTable[]
): Map<string, string> {
  const result = new Map<string, string>()
  const seenNames = new Map<string, number>()

  for (const table of tables) {
    const columns = table.selectedColumns.length > 0
      ? table.selectedColumns
      : table.allColumns

    for (const col of columns) {
      const key = `${table.alias}.${col}`
      const baseName = col
      const count = seenNames.get(baseName) ?? 0

      if (count === 0) {
        // First occurrence - no suffix needed
        result.set(key, baseName)
      } else {
        // Subsequent occurrence - add numeric suffix
        result.set(key, `${baseName}_${count + 1}`)
      }

      seenNames.set(baseName, count + 1)
    }
  }

  return result
}

/**
 * Generate SELECT clause.
 * Handles column selection, duplicate names with AS aliases.
 */
function generateSelectClause(tables: QueryTable[]): string {
  if (tables.length === 0) {
    return 'SELECT *'
  }

  // Check if any table has specific column selection
  const hasSpecificSelection = tables.some(t => t.selectedColumns.length > 0)

  if (!hasSpecificSelection) {
    // All columns from all tables
    if (tables.length === 1) {
      return `SELECT ${quoteIdentifier(tables[0].alias)}.*`
    }
    // Multiple tables - list each with alias.*
    const parts = tables.map(t => `${quoteIdentifier(t.alias)}.*`)
    return `SELECT ${parts.join(', ')}`
  }

  // Specific columns selected - need to handle duplicates
  const aliases = resolveColumnAliases(tables)
  const columns: string[] = []

  for (const table of tables) {
    const cols = table.selectedColumns.length > 0
      ? table.selectedColumns
      : table.allColumns

    for (const col of cols) {
      const key = `${table.alias}.${col}`
      const outputAlias = aliases.get(key) ?? col
      const qualRef = qualifiedColumn(table.alias, col)

      if (outputAlias !== col) {
        // Need AS for disambiguation
        columns.push(`${qualRef} AS ${quoteIdentifier(outputAlias)}`)
      } else {
        columns.push(qualRef)
      }
    }
  }

  return `SELECT ${columns.join(', ')}`
}

/**
 * Generate FROM clause with the first table.
 */
function generateFromClause(tables: QueryTable[]): string {
  if (tables.length === 0) {
    return ''
  }
  const first = tables[0]
  return `FROM ${quoteIdentifier(first.name)} ${quoteIdentifier(first.alias)}`
}

/**
 * Generate JOIN clauses for additional tables.
 */
function generateJoinClauses(tables: QueryTable[], joins: QueryJoin[]): string {
  if (tables.length <= 1) {
    return ''
  }

  // Build a map from target alias to join info
  const joinByTarget = new Map<string, QueryJoin>()
  for (const join of joins) {
    joinByTarget.set(join.targetAlias, join)
  }

  const clauses: string[] = []

  // Process tables in order (skip first, it's the FROM table)
  for (let i = 1; i < tables.length; i++) {
    const table = tables[i]
    const join = joinByTarget.get(table.alias)

    if (join) {
      const joinKeyword = getJoinKeyword(join.joinType)
      const onCondition = `${qualifiedColumn(join.sourceAlias, join.sourceColumn)} = ${qualifiedColumn(join.targetAlias, join.targetColumn)}`
      clauses.push(`${joinKeyword} ${quoteIdentifier(table.name)} ${quoteIdentifier(table.alias)} ON ${onCondition}`)
    } else {
      // No explicit join - cross join (shouldn't happen in practice)
      clauses.push(`CROSS JOIN ${quoteIdentifier(table.name)} ${quoteIdentifier(table.alias)}`)
    }
  }

  return clauses.join(' ')
}

/**
 * Get SQL keyword for join type.
 */
function getJoinKeyword(joinType: JoinType): string {
  switch (joinType) {
    case 'INNER':
      return 'INNER JOIN'
    case 'LEFT':
      return 'LEFT JOIN'
    case 'RIGHT':
      return 'RIGHT JOIN'
    case 'FULL':
      return 'FULL OUTER JOIN'
    default:
      return 'INNER JOIN'
  }
}

/**
 * Generate WHERE clause using the existing WhereBuilder function.
 */
function generateWhere(
  conditions: WhereCondition[],
  logic: 'AND' | 'OR'
): { clause: string; params: unknown[] } {
  const result = generateWhereClause(conditions, logic)
  if (!result.clause) {
    return { clause: '', params: [] }
  }
  return { clause: `WHERE ${result.clause}`, params: result.params }
}

/**
 * Generate tie-breaker columns for stable ordering.
 *
 * - For rowid tables: returns ['rowid']
 * - For WITHOUT ROWID tables: returns PK columns in pk order, quoted
 * - For views/virtual tables: returns [] (no tie-breaker possible)
 *
 * @param tableInfo - Table information
 * @returns Array of column references to append to ORDER BY
 */
export function generateTieBreakerColumns(tableInfo: TableInfo): string[] {
  // Views and virtual tables don't support stable ordering
  if (tableInfo.isView || tableInfo.isVirtual) {
    return []
  }

  // For WITHOUT ROWID tables, use PK columns
  if (tableInfo.withoutRowid) {
    const pkColumns = tableInfo.columns
      .filter(c => c.pk > 0)
      .sort((a, b) => a.pk - b.pk)

    return pkColumns.map(c => quoteIdentifier(c.name))
  }

  // For regular rowid tables, use rowid
  return ['rowid']
}

/**
 * Generate ORDER BY clause with optional tie-breaker for stable ordering.
 *
 * @param conditions - Sort conditions from the UI
 * @param tableAlias - Table alias to qualify tie-breaker columns
 * @param tieBreakerColumns - Tie-breaker columns from generateTieBreakerColumns (already quoted)
 */
function generateOrderBy(
  conditions: SortCondition[],
  tableAlias?: string,
  tieBreakerColumns?: string[]
): string {
  const valid = conditions.filter(c => c.column)
  if (valid.length === 0) {
    return ''
  }

  const quotedAlias = tableAlias ? quoteIdentifier(tableAlias) : undefined

  // Extract column names from user's sort conditions for deduplication
  // Format is "alias.column" - extract the column part after the dot
  const userSortColumns = new Set(
    valid.map(c => {
      const dotIndex = c.column.lastIndexOf('.')
      return dotIndex >= 0 ? c.column.slice(dotIndex + 1) : c.column
    })
  )

  const parts = valid.map(c => {
    // Parse alias.column format to quote consistently
    const dotIndex = c.column.lastIndexOf('.')
    if (dotIndex >= 0) {
      const alias = c.column.slice(0, dotIndex)
      const col = c.column.slice(dotIndex + 1)
      return `${quoteIdentifier(alias)}.${quoteIdentifier(col)} ${c.direction}`
    }
    return `${quoteIdentifier(c.column)} ${c.direction}`
  })

  // Append tie-breaker columns if provided, skipping those already in user's sort
  if (tieBreakerColumns && tieBreakerColumns.length > 0 && quotedAlias) {
    for (const col of tieBreakerColumns) {
      // col is already quoted (e.g., '"key"' or 'rowid')
      // Extract unquoted name to check for duplicates
      const unquotedCol = col.startsWith('"') && col.endsWith('"')
        ? col.slice(1, -1).replace(/""/g, '"')
        : col

      // Skip if this column is already in the user's sort order
      if (userSortColumns.has(unquotedCol)) {
        continue
      }

      // Tie-breaker columns always sort ASC for deterministic ordering
      parts.push(`${quotedAlias}.${col} ASC`)
    }
  }

  return `ORDER BY ${parts.join(', ')}`
}

/**
 * Generate LIMIT clause.
 */
function generateLimit(limit: number | null): string {
  if (limit === null || limit <= 0) {
    return ''
  }
  return `LIMIT ${Math.floor(limit)}`
}

/**
 * Generate a complete SELECT query from builder state.
 * Produces deterministic output - same state always yields same SQL.
 *
 * @param state - Query builder state
 * @param tableInfoMap - Optional map of table names to TableInfo for stable ordering tie-breakers
 */
export function generateSelectQuery(
  state: QueryBuilderState,
  tableInfoMap?: Map<string, TableInfo>
): GeneratedQuery {
  const { tables, joins, whereConditions, whereLogic, sortConditions, limit } = state

  if (tables.length === 0) {
    return { sql: '', params: [] }
  }

  const parts: string[] = []

  // SELECT
  parts.push(generateSelectClause(tables))

  // FROM
  parts.push(generateFromClause(tables))

  // JOIN
  const joinClause = generateJoinClauses(tables, joins)
  if (joinClause) {
    parts.push(joinClause)
  }

  // WHERE
  const whereResult = generateWhere(whereConditions, whereLogic)
  if (whereResult.clause) {
    parts.push(whereResult.clause)
  }

  // ORDER BY with tie-breakers
  // Get tie-breaker columns from the first table if tableInfo is available
  let tieBreakerColumns: string[] | undefined
  let tieBreakerAlias: string | undefined

  const validSortConditions = sortConditions.filter(c => c.column)
  if (tableInfoMap && tables.length > 0 && validSortConditions.length > 0) {
    const firstTable = tables[0]
    const tableInfo = tableInfoMap.get(firstTable.name)
    if (tableInfo) {
      tieBreakerColumns = generateTieBreakerColumns(tableInfo)
      tieBreakerAlias = firstTable.alias
    }
  }

  const orderBy = generateOrderBy(sortConditions, tieBreakerAlias, tieBreakerColumns)
  if (orderBy) {
    parts.push(orderBy)
  }

  // LIMIT
  const limitClause = generateLimit(limit)
  if (limitClause) {
    parts.push(limitClause)
  }

  return {
    sql: parts.join(' '),
    params: whereResult.params,
  }
}
