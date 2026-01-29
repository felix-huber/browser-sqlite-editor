import { memo, useState } from 'react'
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'

/** Column data for display in the table node */
export interface TableColumnData {
  name: string
  type: string
  isPrimaryKey?: boolean
  isForeignKey?: boolean
  isUnique?: boolean
  isNotNull?: boolean
  /** Generated column type: 'stored', 'virtual', or undefined for regular columns */
  generated?: 'stored' | 'virtual' | null
}

/** Node data for a database table */
export interface TableNodeData extends Record<string, unknown> {
  /** Table name */
  label: string
  /** Whether this is a view (read-only) */
  isView?: boolean
  /** Whether handles should be hidden (read-only mode) */
  isReadOnly?: boolean
  /** Column definitions */
  columns?: TableColumnData[]
}

/** Table node type for React Flow */
export type TableNodeType = Node<TableNodeData, 'tableNode'>

/** Props for the TableNode component */
export type TableNodeProps = NodeProps<TableNodeType>

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
    >
      <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
    </svg>
  )
}

/** Link icon for foreign key columns */
function LinkIcon({ className }: { className?: string }) {
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
    >
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
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
    >
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <line x1="3" y1="9" x2="21" y2="9" />
      <line x1="9" y1="21" x2="9" y2="9" />
    </svg>
  )
}

/** View icon for the header */
function ViewIcon({ className }: { className?: string }) {
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
    >
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

/**
 * Custom React Flow node for displaying database tables in the ERD.
 * Shows table name, columns with types, and visual indicators for keys.
 */
function TableNodeComponent({ data, selected }: TableNodeProps) {
  const [isHovered, setIsHovered] = useState(false)
  const { label, isView = false, isReadOnly = false, columns = [] } = data

  // In read-only mode, handles are always hidden
  const showHandles = !isReadOnly && (isHovered || selected)

  return (
    <div
      className={`
        min-w-[180px] max-w-[280px] rounded-lg shadow-md border-2
        bg-white
        ${selected ? 'border-navy-600 ring-2 ring-navy-200' : 'border-navy-300'}
        transition-all duration-150
      `}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      data-testid="table-node"
    >
      {/* Header */}
      <div
        className={`
          flex items-center gap-2 px-3 py-2 rounded-t-md
          ${isView ? 'bg-navy-100' : 'bg-navy-600'}
        `}
        data-testid="table-node-header"
      >
        {isView ? (
          <ViewIcon className="text-navy-600 shrink-0" />
        ) : (
          <TableIcon className="text-white shrink-0" />
        )}
        <span
          className={`
            font-semibold text-sm truncate
            ${isView ? 'text-navy-700' : 'text-white'}
          `}
          title={label}
          data-testid="table-name"
        >
          {label}
        </span>
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
              {/* Left handle (target for FK references) */}
              <Handle
                type="target"
                position={Position.Left}
                id={`${column.name}-target`}
                className={`
                  !w-2 !h-2 !bg-navy-400 !border-navy-600
                  ${showHandles ? '!opacity-100' : '!opacity-0'}
                  transition-opacity duration-150
                `}
                style={{ top: '50%' }}
              />

              {/* Column indicator icons */}
              <div className="w-4 flex justify-center shrink-0">
                {column.isPrimaryKey && (
                  <KeyIcon
                    className="text-amber-500"
                  />
                )}
                {!column.isPrimaryKey && column.isForeignKey && (
                  <LinkIcon
                    className="text-navy-500"
                  />
                )}
                {!column.isPrimaryKey && !column.isForeignKey && column.generated && (
                  <ComputedIcon
                    className="text-purple-500"
                  />
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

              {/* Column type */}
              <span
                className="text-navy-400 font-mono shrink-0"
                data-testid={`column-type-${index}`}
              >
                {column.type}
              </span>

              {/* Generated column badge */}
              {column.generated && (
                <span
                  className={`
                    text-[9px] font-semibold uppercase px-1 py-0.5 rounded
                    ${column.generated === 'stored'
                      ? 'bg-purple-100 text-purple-700'
                      : 'bg-violet-100 text-violet-700'
                    }
                  `}
                  data-testid={`generated-badge-${index}`}
                >
                  {column.generated}
                </span>
              )}

              {/* Right handle (source for FK creation) */}
              <Handle
                type="source"
                position={Position.Right}
                id={`${column.name}-source`}
                className={`
                  !w-2 !h-2 !bg-navy-400 !border-navy-600
                  ${showHandles ? '!opacity-100' : '!opacity-0'}
                  transition-opacity duration-150
                `}
                style={{ top: '50%' }}
              />
            </div>
          ))
        )}
      </div>
    </div>
  )
}

/** Memoized TableNode component for React Flow */
export const TableNode = memo(TableNodeComponent)

/** Node types object for React Flow registration */
export const tableNodeTypes = {
  tableNode: TableNode,
}

export default TableNode
