import { memo, useState, useCallback, useRef, useEffect } from 'react'
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
  type Edge,
} from '@xyflow/react'

/** Supported SQL join types */
export type JoinType = 'INNER' | 'LEFT' | 'RIGHT' | 'FULL'

/** Edge data for a join between tables */
export interface JoinEdgeData extends Record<string, unknown> {
  /** The type of SQL JOIN */
  joinType: JoinType
  /** Source column name */
  sourceColumn: string
  /** Target column name */
  targetColumn: string
  /** Callback when join type changes */
  onJoinTypeChange?: (edgeId: string, joinType: JoinType) => void
  /** Callback when edge is deleted */
  onDelete?: (edgeId: string) => void
}

/** Join edge type for React Flow */
export type JoinEdgeType = Edge<JoinEdgeData, 'joinEdge'>

/** Props for the JoinEdge component */
export type JoinEdgeProps = EdgeProps<JoinEdgeType>

/** Join type configuration for styling */
const JOIN_STYLES: Record<JoinType, { color: string; strokeDasharray: string; label: string }> = {
  INNER: { color: '#2563eb', strokeDasharray: '0', label: 'INNER JOIN' },
  LEFT: { color: '#2563eb', strokeDasharray: '5,5', label: 'LEFT JOIN' },
  RIGHT: { color: '#16a34a', strokeDasharray: '5,5', label: 'RIGHT JOIN' },
  FULL: { color: '#9333ea', strokeDasharray: '2,4', label: 'FULL OUTER' },
}

/** Dropdown icon */
function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}

/** Delete/close icon */
function DeleteIcon({ className }: { className?: string }) {
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
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}

/**
 * Custom React Flow edge for visualizing SQL JOINs between tables.
 * Displays a styled path with join type label that can be clicked to change the join type.
 */
function JoinEdgeComponent({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
}: JoinEdgeProps) {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false)
  const [isHovered, setIsHovered] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const joinType = data?.joinType ?? 'INNER'
  const style = JOIN_STYLES[joinType]

  // Get path for the edge
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  })

  // Handle click outside to close dropdown
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false)
      }
    }

    if (isDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isDropdownOpen])

  // Toggle dropdown
  const handleLabelClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    setIsDropdownOpen((prev) => !prev)
  }, [])

  // Change join type
  const handleJoinTypeSelect = useCallback(
    (newType: JoinType) => {
      data?.onJoinTypeChange?.(id, newType)
      setIsDropdownOpen(false)
    },
    [id, data]
  )

  // Delete edge
  const handleDelete = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      data?.onDelete?.(id)
    },
    [id, data]
  )

  const strokeWidth = isHovered || selected ? 3 : 2

  return (
    <>
      {/* Edge path */}
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: style.color,
          strokeWidth,
          strokeDasharray: style.strokeDasharray,
          transition: 'stroke-width 150ms',
        }}
        interactionWidth={20}
      />

      {/* Hover detection overlay - invisible wider path for easier interaction */}
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={20}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        style={{ pointerEvents: 'stroke' }}
      />

      {/* Glow effect when selected */}
      {selected && (
        <path
          d={edgePath}
          fill="none"
          stroke={style.color}
          strokeWidth={8}
          strokeDasharray={style.strokeDasharray}
          style={{ opacity: 0.3, filter: 'blur(4px)', pointerEvents: 'none' }}
        />
      )}

      {/* Label with dropdown */}
      <EdgeLabelRenderer>
        <div
          ref={dropdownRef}
          className="absolute pointer-events-auto"
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
          }}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
          data-testid={`join-edge-label-${id}`}
        >
          {/* Label button */}
          <div className="flex items-center gap-1">
            <button
              onClick={handleLabelClick}
              className={`
                flex items-center gap-1 px-2 py-1 text-xs font-medium rounded
                border shadow-sm transition-all duration-150
                ${selected ? 'ring-2 ring-offset-1' : ''}
              `}
              style={{
                backgroundColor: 'white',
                borderColor: style.color,
                color: style.color,
                // @ts-expect-error ringColor is a valid Tailwind CSS property
                '--tw-ring-color': style.color,
              }}
              data-testid={`join-type-button-${id}`}
            >
              <span>{style.label}</span>
              <ChevronIcon className={isDropdownOpen ? 'rotate-180' : ''} />
            </button>

            {/* Delete button - visible on hover or selected */}
            {(isHovered || selected) && (
              <button
                onClick={handleDelete}
                className="p-1 rounded hover:bg-red-100 transition-colors"
                title="Remove join"
                data-testid={`join-delete-button-${id}`}
              >
                <DeleteIcon className="text-red-500" />
              </button>
            )}
          </div>

          {/* Dropdown menu */}
          {isDropdownOpen && (
            <div
              className="absolute left-0 top-full mt-1 bg-white border border-navy-200 rounded-md shadow-lg z-50 min-w-[120px]"
              data-testid={`join-type-dropdown-${id}`}
            >
              {(Object.keys(JOIN_STYLES) as JoinType[]).map((type) => (
                <button
                  key={type}
                  onClick={() => handleJoinTypeSelect(type)}
                  className={`
                    w-full px-3 py-1.5 text-xs text-left transition-colors
                    hover:bg-navy-50
                    ${type === joinType ? 'font-semibold bg-navy-50' : ''}
                  `}
                  style={{ color: JOIN_STYLES[type].color }}
                  data-testid={`join-option-${type}`}
                >
                  {JOIN_STYLES[type].label}
                </button>
              ))}
            </div>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  )
}

/** Memoized JoinEdge component for React Flow */
export const JoinEdge = memo(JoinEdgeComponent)

/** Edge types object for React Flow registration */
export const joinEdgeTypes = {
  joinEdge: JoinEdge,
}

export default JoinEdge
