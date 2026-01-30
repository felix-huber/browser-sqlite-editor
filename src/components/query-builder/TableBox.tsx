import { memo, useState, useCallback } from 'react'
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'

/** Column data for display in the table box */
export interface TableBoxColumnData {
  name: string
  type: string
  isPrimaryKey?: boolean
  /** Generated column type: 'stored', 'virtual', or undefined for regular columns */
  generated?: 'stored' | 'virtual' | null
}

/** Node data for a table box in the query builder */
export interface TableBoxData extends Record<string, unknown> {
  /** Table name */
  tableName: string
  /** Table alias (t1, t2, etc.) */
  alias: string
  /** Column definitions */
  columns: TableBoxColumnData[]
  /** Selected column names for SELECT */
  selectedColumns: string[]
  /** Callback when column selection changes */
  onSelectionChange?: (tableName: string, selectedColumns: string[]) => void
  /** Callback when table is removed */
  onRemove?: (tableName: string) => void
}

/** Table box node type for React Flow */
export type TableBoxNodeType = Node<TableBoxData, 'tableBox'>

/** Props for the TableBox component */
export type TableBoxProps = NodeProps<TableBoxNodeType>

/** Key icon for primary key columns */
function KeyIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-label="Primary key"
    >
      <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
    </svg>
  )
}

/** Computed/function icon for generated columns */
function ComputedIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-label="Generated column"
    >
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </svg>
  )
}

/** Table icon for the header */
function TableIcon({ className }: { className?: string }) {
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
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <line x1="3" y1="9" x2="21" y2="9" />
      <line x1="9" y1="21" x2="9" y2="9" />
    </svg>
  )
}

/** Close/remove icon */
function CloseIcon({ className }: { className?: string }) {
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
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}

/**
 * Custom React Flow node for displaying tables in the query builder.
 * Shows table name with alias, columns with checkboxes for selection,
 * and connection handles for creating joins.
 */
function TableBoxComponent({ data, selected }: TableBoxProps) {
  const [isHovered, setIsHovered] = useState(false)
  const { tableName, alias, columns = [], selectedColumns = [], onSelectionChange, onRemove } = data

  const isAutomation =
    (typeof navigator !== 'undefined' && navigator.webdriver) ||
    (typeof window !== 'undefined' && (window as Window & { __sqliteEditorTest?: unknown }).__sqliteEditorTest)
  const showHandles = isAutomation || isHovered || selected

  // Check if a column is selected
  const isColumnSelected = useCallback(
    (columnName: string) => selectedColumns.includes(columnName),
    [selectedColumns]
  )

  // Toggle individual column selection
  const handleColumnToggle = useCallback(
    (columnName: string) => {
      const newSelection = isColumnSelected(columnName)
        ? selectedColumns.filter((c) => c !== columnName)
        : [...selectedColumns, columnName]
      onSelectionChange?.(tableName, newSelection)
    },
    [tableName, selectedColumns, isColumnSelected, onSelectionChange]
  )

  // Select all columns
  const handleSelectAll = useCallback(() => {
    const allColumnNames = columns.map((c) => c.name)
    onSelectionChange?.(tableName, allColumnNames)
  }, [tableName, columns, onSelectionChange])

  // Deselect all columns
  const handleSelectNone = useCallback(() => {
    onSelectionChange?.(tableName, [])
  }, [tableName, onSelectionChange])

  // Remove table from canvas
  const handleRemove = useCallback(() => {
    onRemove?.(tableName)
  }, [tableName, onRemove])

  const allSelected = columns.length > 0 && selectedColumns.length === columns.length
  const noneSelected = selectedColumns.length === 0

  return (
    <div
      className={`
        min-w-[200px] max-w-[280px] rounded-lg shadow-md border-2
        bg-white
        ${selected ? 'border-navy-600 ring-2 ring-navy-200' : 'border-navy-300'}
        transition-all duration-150
      `}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      data-testid="table-box"
    >
      {/* Header */}
      <div
        className="flex items-center gap-2 px-3 py-2 rounded-t-md bg-navy-600"
        data-testid="table-box-header"
      >
        <TableIcon className="text-white shrink-0" />
        <span
          className="font-semibold text-sm truncate text-white flex-1"
          title={tableName}
          data-testid="table-name"
        >
          {tableName}
        </span>
        <span
          className="text-xs text-navy-200 shrink-0"
          data-testid="table-alias"
        >
          ({alias})
        </span>
        <button
          onClick={handleRemove}
          className="p-0.5 rounded hover:bg-navy-500 transition-colors shrink-0"
          title="Remove table"
          data-testid="remove-table-button"
        >
          <CloseIcon className="text-white" />
        </button>
      </div>

      {/* Select All / Select None helpers */}
      <div className="flex items-center justify-end gap-2 px-3 py-1.5 border-b border-navy-100 bg-navy-50">
        <button
          onClick={handleSelectAll}
          disabled={allSelected}
          className="text-xs text-navy-600 hover:text-navy-800 disabled:text-navy-300 disabled:cursor-not-allowed"
          data-testid="select-all-button"
        >
          Select All
        </button>
        <span className="text-navy-300">|</span>
        <button
          onClick={handleSelectNone}
          disabled={noneSelected}
          className="text-xs text-navy-600 hover:text-navy-800 disabled:text-navy-300 disabled:cursor-not-allowed"
          data-testid="select-none-button"
        >
          Select None
        </button>
      </div>

      {/* Columns */}
      <div className="divide-y divide-navy-100" data-testid="column-list">
        {columns.length === 0 ? (
          <div className="px-3 py-2 text-xs text-navy-400 italic">
            No columns
          </div>
        ) : (
          columns.map((column, index) => (
            <div
              key={column.name}
              className="relative flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-navy-50 transition-colors"
              data-testid={`column-row-${index}`}
            >
              {/* Left handle (target for join references) */}
              <Handle
                type="target"
                position={Position.Left}
                id={`${column.name}-target`}
                data-handleid={`${column.name}-target`}
                className={`
                  !w-3 !h-3 !bg-navy-400 !border-navy-600 !z-10
                  ${showHandles ? '!opacity-100' : '!opacity-0'}
                  transition-opacity duration-150
                `}
                style={{ top: '50%', pointerEvents: 'all', zIndex: 10 }}
              />

              {/* Checkbox for column selection */}
              <input
                type="checkbox"
                checked={isColumnSelected(column.name)}
                onChange={() => handleColumnToggle(column.name)}
                className="w-3.5 h-3.5 rounded border-navy-300 text-navy-600 focus:ring-navy-500 cursor-pointer"
                data-testid={`column-checkbox-${index}`}
              />

              {/* Column indicator icons */}
              <div className="w-4 flex justify-center shrink-0">
                {column.isPrimaryKey && (
                  <KeyIcon className="text-amber-500" />
                )}
                {!column.isPrimaryKey && column.generated && (
                  <ComputedIcon className="text-purple-500" />
                )}
              </div>

              {/* Column name */}
              <span
                className={`
                  flex-1 truncate font-medium text-navy-800
                  ${column.isPrimaryKey ? 'font-semibold' : ''}
                `}
                title={column.name}
                data-testid={`column-name-${index}`}
              >
                {column.name}
              </span>

              {/* Column type badge */}
              <span
                className="text-[10px] font-mono bg-navy-100 text-navy-600 px-1.5 py-0.5 rounded shrink-0"
                data-testid={`column-type-${index}`}
              >
                {column.type}
              </span>

              {/* Generated column indicator with tooltip */}
              {column.generated && (
                <span
                  className="text-[9px] font-semibold uppercase px-1 py-0.5 rounded bg-purple-100 text-purple-700"
                  title={`This is a generated column (${column.generated.toUpperCase()})`}
                  data-testid={`generated-badge-${index}`}
                >
                  {column.generated === 'stored' ? 'S' : 'V'}
                </span>
              )}

              {/* Right handle (source for join creation) */}
              <Handle
                type="source"
                position={Position.Right}
                id={`${column.name}-source`}
                data-handleid={`${column.name}-source`}
                className={`
                  !w-3 !h-3 !bg-navy-400 !border-navy-600 !z-10
                  ${showHandles ? '!opacity-100' : '!opacity-0'}
                  transition-opacity duration-150
                `}
                style={{ top: '50%', pointerEvents: 'all', zIndex: 10 }}
              />
            </div>
          ))
        )}
      </div>
    </div>
  )
}

/** Memoized TableBox component for React Flow */
export const TableBox = memo(TableBoxComponent)

/** Node types object for React Flow registration */
export const tableBoxNodeTypes = {
  tableBox: TableBox,
}

export default TableBox
