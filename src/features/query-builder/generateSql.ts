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

/**
 * Quote an identifier (table or column name) if needed.
 * SQLite allows most identifiers without quoting, but we quote
 * those that contain special characters or are reserved keywords.
 */
export function quoteIdentifier(name: string): string {
  // Simple check: if it contains non-alphanumeric chars (except underscore), quote it
  if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    // Check for SQLite reserved keywords (common ones)
    const reserved = new Set([
      'SELECT', 'FROM', 'WHERE', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER',
      'CROSS', 'ON', 'AND', 'OR', 'NOT', 'NULL', 'TRUE', 'FALSE', 'ORDER',
      'BY', 'ASC', 'DESC', 'LIMIT', 'OFFSET', 'GROUP', 'HAVING', 'UNION',
      'EXCEPT', 'INTERSECT', 'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'DROP',
      'ALTER', 'TABLE', 'INDEX', 'VIEW', 'AS', 'DISTINCT', 'ALL', 'BETWEEN',
      'LIKE', 'IN', 'IS', 'EXISTS', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
      'KEY', 'PRIMARY', 'FOREIGN', 'REFERENCES', 'DEFAULT', 'CHECK', 'UNIQUE',
      'CONSTRAINT', 'CASCADE', 'SET', 'ROWID', 'INTEGER', 'TEXT', 'REAL',
      'BLOB', 'NUMERIC', 'COLLATE', 'AUTOINCREMENT', 'ABORT', 'ACTION',
      'ADD', 'AFTER', 'ANALYZE', 'ATTACH', 'BEFORE', 'BEGIN', 'COLUMN',
      'COMMIT', 'CONFLICT', 'DATABASE', 'DEFERRED', 'DEFERRABLE', 'DETACH',
      'EACH', 'ESCAPE', 'EXPLAIN', 'FAIL', 'GLOB', 'IF', 'IGNORE', 'IMMEDIATE',
      'INDEXED', 'INITIALLY', 'INSTEAD', 'MATCH', 'NATURAL', 'NO', 'OF',
      'PLAN', 'PRAGMA', 'QUERY', 'RAISE', 'RECURSIVE', 'REINDEX', 'RELEASE',
      'RENAME', 'REPLACE', 'RESTRICT', 'RETURNING', 'ROLLBACK', 'ROW',
      'SAVEPOINT', 'TEMP', 'TEMPORARY', 'TRANSACTION', 'TRIGGER', 'VACUUM',
      'VALUES', 'VIRTUAL', 'WITH', 'WITHOUT',
    ])
    if (!reserved.has(name.toUpperCase())) {
      return name
    }
  }
  // Quote with double quotes, escaping any internal double quotes
  return `"${name.replace(/"/g, '""')}"`
}

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

  // Build SELECT columns
  const selectColumns: string[] = []
  for (const node of tableNodes) {
    const { alias, selectedColumns } = node.data
    if (selectedColumns.length === 0) {
      // If no columns selected, select all with alias.*
      selectColumns.push(`${alias}.*`)
    } else {
      for (const col of selectedColumns) {
        selectColumns.push(`${alias}.${quoteIdentifier(col)}`)
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
