/**
 * SQL Generation utility for Query Builder
 *
 * Generates SELECT statements from:
 * - Selected tables with their aliases and selected columns
 * - JOIN configurations
 * - WHERE conditions
 * - ORDER BY clauses
 * - LIMIT value
 */

import type { JoinConfig } from './QueryBuilder'
import type { TableBoxNodeType } from './TableBox'
import type { WhereCondition, WhereClauseResult } from './WhereBuilder'
import type { SortCondition } from './OrderByBuilder'
import { generateWhereClause } from './WhereBuilder'
import { generateOrderByClause } from './OrderByBuilder'
import { quoteIdentifier, generateAlias } from '../../core/sql/helpers'

/** Options for SQL generation */
export interface GenerateSqlOptions {
  /** Table nodes on the canvas */
  tableNodes: TableBoxNodeType[]
  /** Join configurations */
  joins: JoinConfig[]
  /** WHERE conditions */
  whereConditions: WhereCondition[]
  /** Logic operator for WHERE conditions */
  whereLogic: 'AND' | 'OR'
  /** Sort conditions for ORDER BY */
  sortConditions: SortCondition[]
  /** LIMIT value (null for no limit) */
  limit: number | null
}

/** Result of SQL generation */
export interface GenerateSqlResult {
  /** The generated SQL string */
  sql: string
  /** Parameter values for prepared statement */
  params: unknown[]
  /** Whether the SQL is valid (has at least one table and column) */
  isValid: boolean
  /** Validation message if not valid */
  validationMessage?: string
}

// Re-export quoteIdentifier for backwards compatibility
export { quoteIdentifier }

/**
 * Generate a SELECT statement from query builder state.
 */
export function generateSql(options: GenerateSqlOptions): GenerateSqlResult {
  const {
    tableNodes,
    joins,
    whereConditions,
    whereLogic,
    sortConditions,
    limit,
  } = options

  // Validation: need at least one table
  if (tableNodes.length === 0) {
    return {
      sql: '',
      params: [],
      isValid: false,
      validationMessage: 'Add at least one table to generate SQL',
    }
  }

  // Build table map for alias lookups
  const tableMap = new Map<string, { alias: string; selectedColumns: string[] }>()
  for (const node of tableNodes) {
    tableMap.set(node.data.tableName, {
      alias: node.data.alias,
      selectedColumns: node.data.selectedColumns,
    })
  }

  // Build SELECT columns with deterministic aliases: "Table"."Column" AS "Table.Column"
  const selectColumns: string[] = []
  for (const node of tableNodes) {
    const { tableName, alias, selectedColumns } = node.data
    if (selectedColumns.length === 0) {
      // If no columns selected, select all with alias.*
      selectColumns.push(`${alias}.*`)
    } else {
      for (const col of selectedColumns) {
        // Use deterministic alias format: "Table"."Column" AS "Table.Column"
        const qualifiedAlias = quoteIdentifier(generateAlias(tableName, col))
        selectColumns.push(`${alias}.${quoteIdentifier(col)} AS ${qualifiedAlias}`)
      }
    }
  }

  // Validation: need at least one column
  if (selectColumns.length === 0) {
    return {
      sql: '',
      params: [],
      isValid: false,
      validationMessage: 'Select at least one column or table',
    }
  }

  // Build FROM clause
  // First table is the primary table, rest are joined
  const primaryTable = tableNodes[0]
  const primaryAlias = primaryTable.data.alias
  const primaryTableName = primaryTable.data.tableName

  let fromClause = `${quoteIdentifier(primaryTableName)} AS ${primaryAlias}`

  // Add JOINs
  // Keep track of which tables have been joined
  const joinedTables = new Set<string>([primaryTableName])

  // Sort joins to ensure proper order (join tables that reference already-joined tables)
  // For now, we'll just add them in order - a more sophisticated approach would
  // topologically sort based on dependencies
  for (const join of joins) {
    // Determine which table is new (not yet joined)
    let newTable: string | null = null
    let existingTable: string | null = null
    let newColumn: string
    let existingColumn: string

    if (!joinedTables.has(join.sourceTable) && joinedTables.has(join.targetTable)) {
      newTable = join.sourceTable
      existingTable = join.targetTable
      newColumn = join.sourceColumn
      existingColumn = join.targetColumn
    } else if (!joinedTables.has(join.targetTable) && joinedTables.has(join.sourceTable)) {
      newTable = join.targetTable
      existingTable = join.sourceTable
      newColumn = join.targetColumn
      existingColumn = join.sourceColumn
    } else if (joinedTables.has(join.sourceTable) && joinedTables.has(join.targetTable)) {
      // Both tables already joined - this is an additional join condition
      // We'll handle this as an extra ON condition in a more complex implementation
      // For now, skip it
      continue
    } else {
      // Neither table is joined yet - this shouldn't happen with proper ordering
      // Skip for safety
      continue
    }

    if (newTable && existingTable) {
      const newTableInfo = tableMap.get(newTable)
      const existingTableInfo = tableMap.get(existingTable)

      if (newTableInfo && existingTableInfo) {
        const joinType = join.joinType === 'INNER' ? 'JOIN' : `${join.joinType} JOIN`
        fromClause += `\n  ${joinType} ${quoteIdentifier(newTable)} AS ${newTableInfo.alias}`
        fromClause += ` ON ${existingTableInfo.alias}.${quoteIdentifier(existingColumn)} = ${newTableInfo.alias}.${quoteIdentifier(newColumn)}`
        joinedTables.add(newTable)
      }
    }
  }

  // Handle additional tables that weren't joined (CROSS JOIN implicitly)
  for (const node of tableNodes) {
    if (!joinedTables.has(node.data.tableName)) {
      // Add as CROSS JOIN (Cartesian product)
      fromClause += `\n  CROSS JOIN ${quoteIdentifier(node.data.tableName)} AS ${node.data.alias}`
      joinedTables.add(node.data.tableName)
    }
  }

  // Build WHERE clause
  let whereResult: WhereClauseResult = { clause: '', params: [] }
  if (whereConditions.length > 0) {
    whereResult = generateWhereClause(whereConditions, whereLogic)
  }

  // Build ORDER BY clause
  let orderByClause = ''
  if (sortConditions.length > 0) {
    orderByClause = generateOrderByClause(sortConditions)
  }

  // Assemble the full query
  let sql = `SELECT ${selectColumns.join(',\n       ')}`
  sql += `\nFROM ${fromClause}`

  if (whereResult.clause) {
    sql += `\nWHERE ${whereResult.clause}`
  }

  if (orderByClause) {
    sql += `\n${orderByClause}`
  }

  if (limit !== null && limit > 0) {
    sql += `\nLIMIT ${limit}`
  }

  return {
    sql,
    params: whereResult.params,
    isValid: true,
  }
}

export default generateSql
