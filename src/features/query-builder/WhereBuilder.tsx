import { memo, useCallback, useMemo } from 'react'
import { escapeLike, getEscapeClause } from '../../core/sql/escape'

/** Column info for condition building */
export interface WhereBuilderColumn {
  /** Column name (may include table alias, e.g., "t1.name") */
  name: string
  /** Column type (INTEGER, TEXT, REAL, BLOB, etc.) */
  type: string
  /** Whether column is nullable */
  nullable?: boolean
}

/** Operators available for TEXT columns */
export const TEXT_OPERATORS = [
  '=',
  '<>',
  'LIKE',
  'NOT LIKE',
  'IS NULL',
  'IS NOT NULL',
] as const

/** Operators available for numeric columns (INTEGER, REAL) */
export const NUMERIC_OPERATORS = [
  '=',
  '<>',
  '<',
  '<=',
  '>',
  '>=',
  'BETWEEN',
  'IS NULL',
  'IS NOT NULL',
] as const

/** Operators available for any column type */
export const ANY_OPERATORS = ['IN', 'NOT IN'] as const

/** All possible operators */
export type WhereOperator =
  | (typeof TEXT_OPERATORS)[number]
  | (typeof NUMERIC_OPERATORS)[number]
  | (typeof ANY_OPERATORS)[number]

/** LIKE pattern mode for helper */
export type LikePatternMode = 'contains' | 'starts_with' | 'ends_with' | 'exact'

/** Single WHERE condition */
export interface WhereCondition {
  /** Unique ID for React keys */
  id: string
  /** Selected column name */
  column: string
  /** Selected operator */
  operator: WhereOperator
  /** Value for the condition (for operators that need one) */
  value: string
  /** Second value for BETWEEN operator */
  valueTo?: string
  /** LIKE pattern mode (for LIKE/NOT LIKE operators) */
  likeMode?: LikePatternMode
}

/** Condition group with AND/OR logic */
export interface WhereConditionGroup {
  /** Group ID */
  id: string
  /** Conditions in this group */
  conditions: WhereCondition[]
  /** How conditions within group are combined */
  logic: 'AND' | 'OR'
}

/** Props for WhereBuilder component */
export interface WhereBuilderProps {
  /** Available columns from tables on canvas */
  columns: WhereBuilderColumn[]
  /** Current conditions */
  conditions: WhereCondition[]
  /** Logic operator between conditions (AND/OR) */
  logic: 'AND' | 'OR'
  /** Callback when conditions change */
  onConditionsChange: (conditions: WhereCondition[]) => void
  /** Callback when logic changes */
  onLogicChange: (logic: 'AND' | 'OR') => void
  /** Optional nested groups (for complex conditions) */
  groups?: WhereConditionGroup[]
  /** Callback when groups change */
  onGroupsChange?: (groups: WhereConditionGroup[]) => void
}

/** Generated WHERE clause result */
export interface WhereClauseResult {
  /** SQL WHERE clause (without 'WHERE' keyword) */
  clause: string
  /** Parameter values for prepared statement */
  params: unknown[]
}

/** Plus icon for add button */
function PlusIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}

/** Trash icon for remove button */
function TrashIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  )
}

/**
 * Get operators available for a column type
 */
export function getOperatorsForType(type: string): WhereOperator[] {
  const upperType = type.toUpperCase()

  // Check for numeric types
  if (
    upperType.includes('INT') ||
    upperType.includes('REAL') ||
    upperType.includes('FLOAT') ||
    upperType.includes('DOUBLE') ||
    upperType.includes('NUMERIC') ||
    upperType.includes('DECIMAL')
  ) {
    return [...NUMERIC_OPERATORS, ...ANY_OPERATORS]
  }

  // TEXT and other types
  return [...TEXT_OPERATORS, ...ANY_OPERATORS]
}

/**
 * Check if operator requires a value
 */
export function operatorRequiresValue(operator: WhereOperator): boolean {
  return operator !== 'IS NULL' && operator !== 'IS NOT NULL'
}

/**
 * Check if operator is LIKE-based
 */
export function isLikeOperator(operator: WhereOperator): boolean {
  return operator === 'LIKE' || operator === 'NOT LIKE'
}

/**
 * Check if operator is BETWEEN
 */
export function isBetweenOperator(operator: WhereOperator): boolean {
  return operator === 'BETWEEN'
}

/**
 * Check if operator is IN/NOT IN
 */
export function isInOperator(operator: WhereOperator): boolean {
  return operator === 'IN' || operator === 'NOT IN'
}

/**
 * Generate a unique ID for conditions
 */
function generateId(): string {
  return `cond-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

/**
 * Build LIKE pattern from value and mode
 */
export function buildLikePattern(
  value: string,
  mode: LikePatternMode
): string {
  const escaped = escapeLike(value)
  switch (mode) {
    case 'contains':
      return `%${escaped}%`
    case 'starts_with':
      return `${escaped}%`
    case 'ends_with':
      return `%${escaped}`
    case 'exact':
    default:
      return escaped
  }
}

/**
 * Generate WHERE clause from conditions
 */
export function generateWhereClause(
  conditions: WhereCondition[],
  logic: 'AND' | 'OR'
): WhereClauseResult {
  if (conditions.length === 0) {
    return { clause: '', params: [] }
  }

  const parts: string[] = []
  const params: unknown[] = []

  for (const condition of conditions) {
    if (!condition.column || !condition.operator) continue

    const col = condition.column

    switch (condition.operator) {
      case 'IS NULL':
        parts.push(`${col} IS NULL`)
        break

      case 'IS NOT NULL':
        parts.push(`${col} IS NOT NULL`)
        break

      case 'LIKE':
      case 'NOT LIKE': {
        const pattern = buildLikePattern(
          condition.value || '',
          condition.likeMode || 'exact'
        )
        parts.push(`${col} ${condition.operator} ? ${getEscapeClause()}`)
        params.push(pattern)
        break
      }

      case 'BETWEEN': {
        parts.push(`${col} BETWEEN ? AND ?`)
        params.push(condition.value || '')
        params.push(condition.valueTo || '')
        break
      }

      case 'IN':
      case 'NOT IN': {
        // Parse comma-separated values
        const values = (condition.value || '')
          .split(',')
          .map((v) => v.trim())
          .filter((v) => v.length > 0)

        if (values.length > 0) {
          const placeholders = values.map(() => '?').join(', ')
          parts.push(`${col} ${condition.operator} (${placeholders})`)
          params.push(...values)
        }
        break
      }

      default:
        // Standard operators: =, <>, <, <=, >, >=
        parts.push(`${col} ${condition.operator} ?`)
        params.push(condition.value || '')
    }
  }

  if (parts.length === 0) {
    return { clause: '', params: [] }
  }

  const clause = parts.join(` ${logic} `)
  return { clause, params }
}

/**
 * Single condition row component
 */
interface ConditionRowProps {
  condition: WhereCondition
  columns: WhereBuilderColumn[]
  onUpdate: (id: string, updates: Partial<WhereCondition>) => void
  onRemove: (id: string) => void
  showLogic: boolean
  logic: 'AND' | 'OR'
}

function ConditionRowComponent({
  condition,
  columns,
  onUpdate,
  onRemove,
  showLogic,
  logic,
}: ConditionRowProps) {
  // Get selected column info
  const selectedColumn = useMemo(
    () => columns.find((c) => c.name === condition.column),
    [columns, condition.column]
  )

  // Get available operators for selected column
  const availableOperators = useMemo(
    () => getOperatorsForType(selectedColumn?.type || 'TEXT'),
    [selectedColumn?.type]
  )

  // Handle column change - reset operator if not available for new type
  const handleColumnChange = useCallback(
    (newColumn: string) => {
      const newColumnInfo = columns.find((c) => c.name === newColumn)
      const newOperators = getOperatorsForType(newColumnInfo?.type || 'TEXT')

      const updates: Partial<WhereCondition> = { column: newColumn }

      // Reset operator if current one isn't available for new type
      if (!newOperators.includes(condition.operator)) {
        updates.operator = newOperators[0]
      }

      onUpdate(condition.id, updates)
    },
    [columns, condition.id, condition.operator, onUpdate]
  )

  // Handle operator change - reset value for null operators
  const handleOperatorChange = useCallback(
    (newOperator: WhereOperator) => {
      const updates: Partial<WhereCondition> = { operator: newOperator }

      // Clear value for null operators
      if (!operatorRequiresValue(newOperator)) {
        updates.value = ''
        updates.valueTo = undefined
        updates.likeMode = undefined
      }

      // Set default like mode for LIKE operators
      if (isLikeOperator(newOperator) && !condition.likeMode) {
        updates.likeMode = 'contains'
      }

      // Clear like mode for non-LIKE operators
      if (!isLikeOperator(newOperator)) {
        updates.likeMode = undefined
      }

      // Clear valueTo for non-BETWEEN operators
      if (!isBetweenOperator(newOperator)) {
        updates.valueTo = undefined
      }

      onUpdate(condition.id, updates)
    },
    [condition.id, condition.likeMode, onUpdate]
  )

  const showValue = operatorRequiresValue(condition.operator)
  const showLikeMode = isLikeOperator(condition.operator)
  const showBetweenTo = isBetweenOperator(condition.operator)
  const showInHint = isInOperator(condition.operator)

  return (
    <div
      className="flex items-center gap-2 p-2 bg-white rounded border border-navy-200"
      data-testid={`condition-row-${condition.id}`}
    >
      {/* Logic indicator (AND/OR) */}
      {showLogic && (
        <span
          className="text-xs font-semibold text-navy-500 w-8"
          data-testid={`condition-logic-${condition.id}`}
        >
          {logic}
        </span>
      )}

      {/* Column selector */}
      <select
        value={condition.column}
        onChange={(e) => handleColumnChange(e.target.value)}
        className="flex-1 min-w-[120px] px-2 py-1.5 text-sm bg-navy-50 border border-navy-200 rounded focus:outline-none focus:ring-2 focus:ring-navy-600 focus:border-transparent"
        data-testid={`condition-column-${condition.id}`}
      >
        <option value="">Select column...</option>
        {columns.map((col) => (
          <option key={col.name} value={col.name}>
            {col.name} ({col.type})
          </option>
        ))}
      </select>

      {/* Operator selector */}
      <select
        value={condition.operator}
        onChange={(e) => handleOperatorChange(e.target.value as WhereOperator)}
        className="w-28 px-2 py-1.5 text-sm bg-navy-50 border border-navy-200 rounded focus:outline-none focus:ring-2 focus:ring-navy-600 focus:border-transparent"
        data-testid={`condition-operator-${condition.id}`}
      >
        {availableOperators.map((op) => (
          <option key={op} value={op}>
            {op}
          </option>
        ))}
      </select>

      {/* LIKE pattern mode selector */}
      {showLikeMode && (
        <select
          value={condition.likeMode || 'contains'}
          onChange={(e) =>
            onUpdate(condition.id, {
              likeMode: e.target.value as LikePatternMode,
            })
          }
          className="w-28 px-2 py-1.5 text-sm bg-navy-50 border border-navy-200 rounded focus:outline-none focus:ring-2 focus:ring-navy-600 focus:border-transparent"
          data-testid={`condition-like-mode-${condition.id}`}
        >
          <option value="contains">Contains</option>
          <option value="starts_with">Starts with</option>
          <option value="ends_with">Ends with</option>
          <option value="exact">Exact match</option>
        </select>
      )}

      {/* Value input */}
      {showValue && (
        <div className="flex items-center gap-1 flex-1">
          <input
            type="text"
            value={condition.value}
            onChange={(e) => onUpdate(condition.id, { value: e.target.value })}
            placeholder={showInHint ? 'val1, val2, val3' : 'Value'}
            className="flex-1 min-w-[100px] px-2 py-1.5 text-sm bg-navy-50 border border-navy-200 rounded focus:outline-none focus:ring-2 focus:ring-navy-600 focus:border-transparent"
            data-testid={`condition-value-${condition.id}`}
          />

          {/* BETWEEN "to" value */}
          {showBetweenTo && (
            <>
              <span className="text-xs text-navy-500">and</span>
              <input
                type="text"
                value={condition.valueTo || ''}
                onChange={(e) =>
                  onUpdate(condition.id, { valueTo: e.target.value })
                }
                placeholder="Value"
                className="flex-1 min-w-[100px] px-2 py-1.5 text-sm bg-navy-50 border border-navy-200 rounded focus:outline-none focus:ring-2 focus:ring-navy-600 focus:border-transparent"
                data-testid={`condition-value-to-${condition.id}`}
              />
            </>
          )}
        </div>
      )}

      {/* Remove button */}
      <button
        onClick={() => onRemove(condition.id)}
        className="p-1.5 text-navy-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
        title="Remove condition"
        data-testid={`condition-remove-${condition.id}`}
      >
        <TrashIcon />
      </button>
    </div>
  )
}

const ConditionRow = memo(ConditionRowComponent)

/**
 * WHERE condition builder component.
 * Allows adding, removing, and configuring filter conditions with AND/OR grouping.
 */
function WhereBuilderComponent({
  columns,
  conditions,
  logic,
  onConditionsChange,
  onLogicChange,
}: WhereBuilderProps) {
  // Add new condition
  const handleAddCondition = useCallback(() => {
    const newCondition: WhereCondition = {
      id: generateId(),
      column: columns.length > 0 ? columns[0].name : '',
      operator: '=',
      value: '',
    }
    onConditionsChange([...conditions, newCondition])
  }, [columns, conditions, onConditionsChange])

  // Update existing condition
  const handleUpdateCondition = useCallback(
    (id: string, updates: Partial<WhereCondition>) => {
      onConditionsChange(
        conditions.map((c) => (c.id === id ? { ...c, ...updates } : c))
      )
    },
    [conditions, onConditionsChange]
  )

  // Remove condition
  const handleRemoveCondition = useCallback(
    (id: string) => {
      onConditionsChange(conditions.filter((c) => c.id !== id))
    },
    [conditions, onConditionsChange]
  )

  // Toggle AND/OR logic
  const handleToggleLogic = useCallback(() => {
    onLogicChange(logic === 'AND' ? 'OR' : 'AND')
  }, [logic, onLogicChange])

  return (
    <div
      className="flex flex-col gap-2 p-3 bg-navy-50 rounded-lg border border-navy-200"
      data-testid="where-builder"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-navy-700">WHERE Conditions</h4>
        <div className="flex items-center gap-2">
          {/* AND/OR toggle */}
          {conditions.length > 1 && (
            <button
              onClick={handleToggleLogic}
              className={`px-2 py-1 text-xs font-semibold rounded transition-colors ${
                logic === 'AND'
                  ? 'bg-navy-600 text-white'
                  : 'bg-amber-500 text-white'
              }`}
              title={`Conditions are combined with ${logic}. Click to toggle.`}
              data-testid="logic-toggle"
            >
              {logic}
            </button>
          )}

          {/* Add condition button */}
          <button
            onClick={handleAddCondition}
            disabled={columns.length === 0}
            className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-navy-600 bg-white border border-navy-300 rounded hover:bg-navy-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            data-testid="add-condition-button"
          >
            <PlusIcon />
            Add Condition
          </button>
        </div>
      </div>

      {/* Conditions list */}
      {conditions.length === 0 ? (
        <div className="text-sm text-navy-500 py-2 text-center">
          No conditions. Click "Add Condition" to filter results.
        </div>
      ) : (
        <div className="flex flex-col gap-2" data-testid="conditions-list">
          {conditions.map((condition, index) => (
            <ConditionRow
              key={condition.id}
              condition={condition}
              columns={columns}
              onUpdate={handleUpdateCondition}
              onRemove={handleRemoveCondition}
              showLogic={index > 0}
              logic={logic}
            />
          ))}
        </div>
      )}

      {/* Preview of generated clause */}
      {conditions.length > 0 && (
        <div className="mt-2 pt-2 border-t border-navy-200">
          <div className="text-xs text-navy-500">Preview:</div>
          <code
            className="text-xs font-mono text-navy-700 bg-white px-2 py-1 rounded block mt-1 overflow-x-auto"
            data-testid="where-preview"
          >
            WHERE {generateWhereClause(conditions, logic).clause || '...'}
          </code>
        </div>
      )}
    </div>
  )
}

/** Memoized WhereBuilder component */
export const WhereBuilder = memo(WhereBuilderComponent)

export default WhereBuilder
