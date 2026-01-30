/**
 * FK Validation Logic
 *
 * Provides validation functions for foreign key creation:
 * - Parent column uniqueness checks (single-column PK or UNIQUE index)
 * - Data integrity validation (NULL-safe anti-join)
 * - DDL generation for creating UNIQUE indexes
 */

// =============================================================================
// Types
// =============================================================================

export interface TableSchemaInfo {
  name: string
  columns: Array<{
    name: string
    type: string
    pk: number
    notnull: boolean
  }>
  indexes: Array<{
    name: string
    unique: boolean
    columns: string[]
    partial: boolean
  }>
  /** Column names that form the primary key, in order */
  pkColumns: string[]
}

export interface ParentColumnValidation {
  isValid: boolean
  isSingleColumnPK: boolean
  hasSingleColumnUniqueIndex: boolean
  isPartOfCompositePK: boolean
  isPartOfCompositeUniqueIndex: boolean
  canCreateUniqueIndex: boolean
  errorMessage?: string
}

export interface DataIntegrityQueryOptions {
  childTable: string
  childColumn: string
  parentTable: string
  parentColumn: string
  mode: 'sample' | 'count'
  limit?: number
}

export interface DataIntegrityInput {
  violationCount: number
  sampleRows: Record<string, unknown>[]
}

export interface DataIntegrityResult {
  isValid: boolean
  violationCount: number
  sampleViolations: Record<string, unknown>[]
  errorMessage?: string
}

// =============================================================================
// Identifier Escaping
// =============================================================================

/**
 * Escape a SQLite identifier by doubling internal quotes and wrapping in quotes.
 */
export function escapeIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

// =============================================================================
// Parent Column Uniqueness Validation
// =============================================================================

/**
 * Validate that a parent column can be referenced by a single-column FK.
 *
 * Rules:
 * - Parent column must be a SINGLE-COLUMN PRIMARY KEY, OR
 * - Parent column must have a SINGLE-COLUMN UNIQUE index (non-partial)
 * - Composite PK/UNIQUE does NOT qualify
 */
export function validateParentColumnUniqueness(
  schema: TableSchemaInfo,
  columnName: string
): ParentColumnValidation {
  const colLower = columnName.toLowerCase()

  // Check if column is part of primary key
  const pkColumnsLower = schema.pkColumns.map((c) => c.toLowerCase())
  const isPKColumn = pkColumnsLower.includes(colLower)
  const isSingleColumnPK = isPKColumn && schema.pkColumns.length === 1
  const isPartOfCompositePK = isPKColumn && schema.pkColumns.length > 1

  // Check for single-column UNIQUE index (non-partial)
  let hasSingleColumnUniqueIndex = false
  let isPartOfCompositeUniqueIndex = false

  for (const idx of schema.indexes) {
    if (!idx.unique) continue

    const idxColumnsLower = idx.columns.map((c) => c.toLowerCase())
    const isInThisIndex = idxColumnsLower.includes(colLower)

    if (isInThisIndex) {
      if (idx.columns.length === 1 && !idx.partial) {
        hasSingleColumnUniqueIndex = true
      } else if (idx.columns.length > 1) {
        isPartOfCompositeUniqueIndex = true
      }
      // Partial indexes don't count as full uniqueness guarantee
    }
  }

  const isValid = isSingleColumnPK || hasSingleColumnUniqueIndex

  const result: ParentColumnValidation = {
    isValid,
    isSingleColumnPK,
    hasSingleColumnUniqueIndex,
    isPartOfCompositePK,
    isPartOfCompositeUniqueIndex,
    canCreateUniqueIndex: !isValid,
  }

  if (!isValid) {
    result.errorMessage =
      'Referenced column must be a single-column PRIMARY KEY or have a UNIQUE index on that column.'
  }

  return result
}

// =============================================================================
// Data Integrity Validation
// =============================================================================

/**
 * Build a SQL query to check for FK data integrity violations.
 *
 * Uses a NULL-safe anti-join pattern:
 * SELECT child.* FROM child
 * LEFT JOIN parent ON child.fk_col = parent.pk_col
 * WHERE child.fk_col IS NOT NULL AND parent.pk_col IS NULL
 *
 * This finds rows where:
 * - The child FK column has a non-NULL value (would be enforced)
 * - But no matching row exists in the parent table
 */
export function buildDataIntegrityQuery(options: DataIntegrityQueryOptions): string {
  const {
    childTable,
    childColumn,
    parentTable,
    parentColumn,
    mode,
    limit = 10,
  } = options

  const childTableEsc = escapeIdentifier(childTable)
  const childColEsc = escapeIdentifier(childColumn)
  const parentTableEsc = escapeIdentifier(parentTable)
  const parentColEsc = escapeIdentifier(parentColumn)

  // Always use aliases to handle self-referential FKs
  const childAlias = 'child'
  const parentAlias = 'parent'

  const selectClause =
    mode === 'count' ? 'COUNT(*) AS violation_count' : `${childAlias}.*`

  const query = `
SELECT ${selectClause}
FROM ${childTableEsc} AS ${childAlias}
LEFT JOIN ${parentTableEsc} AS ${parentAlias}
  ON ${childAlias}.${childColEsc} = ${parentAlias}.${parentColEsc}
WHERE ${childAlias}.${childColEsc} IS NOT NULL
  AND ${parentAlias}.${parentColEsc} IS NULL
${mode === 'sample' ? `LIMIT ${limit}` : ''}
`.trim()

  return query
}

/**
 * Parse the results of data integrity validation queries.
 */
export function parseDataIntegrityResult(input: DataIntegrityInput): DataIntegrityResult {
  const { violationCount, sampleRows } = input

  if (violationCount === 0) {
    return {
      isValid: true,
      violationCount: 0,
      sampleViolations: [],
    }
  }

  // Truncate to 10 samples max
  const truncatedSamples = sampleRows.slice(0, 10)

  return {
    isValid: false,
    violationCount,
    sampleViolations: truncatedSamples,
    errorMessage: `${violationCount} row${violationCount === 1 ? '' : 's'} in the child table reference non-existent parent values.`,
  }
}

// =============================================================================
// DDL Generation
// =============================================================================

/**
 * Generate DDL to create a UNIQUE index on a column.
 */
export function generateCreateUniqueIndexDDL(
  tableName: string,
  columnName: string
): string {
  const tableEsc = escapeIdentifier(tableName)
  const colEsc = escapeIdentifier(columnName)

  // Generate a deterministic index name
  const indexName = `idx_${tableName}_${columnName}_unique`
  const indexNameEsc = escapeIdentifier(indexName)

  return `CREATE UNIQUE INDEX ${indexNameEsc} ON ${tableEsc} (${colEsc})`
}
