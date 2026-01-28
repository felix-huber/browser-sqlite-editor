import { memo, useState, useCallback } from 'react'
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
  type Edge,
} from '@xyflow/react'
import type { ForeignKeyAction } from '../../types/index'

/** Edge data for a foreign key relationship */
export interface ForeignKeyEdgeData extends Record<string, unknown> {
  /** Child table (source of FK) */
  childTable: string
  /** Child column */
  childColumn: string
  /** Parent table (referenced) */
  parentTable: string
  /** Parent column (referenced) */
  parentColumn: string
  /** ON DELETE action */
  onDelete: ForeignKeyAction
  /** ON UPDATE action */
  onUpdate: ForeignKeyAction
  /** Relationship cardinality: one-to-one or one-to-many */
  cardinality: 'one-to-one' | 'one-to-many'
  /** Whether the FK column is nullable (optional relationship) */
  isOptional: boolean
  /** Callback when edge is deleted */
  onEdgeDelete?: (edgeId: string) => void
}

/** FK edge type for React Flow */
export type ForeignKeyEdgeType = Edge<ForeignKeyEdgeData, 'fkEdge'>

/** Props for the ForeignKeyEdge component */
export type ForeignKeyEdgeProps = EdgeProps<ForeignKeyEdgeType>

/** Delete icon */
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
 * Crow's foot marker for one-to-many relationships.
 * Renders on the "many" side (source/child side).
 */
function CrowFootMarker({
  x,
  y,
  angle,
  isOptional,
  color,
}: {
  x: number
  y: number
  angle: number
  isOptional: boolean
  color: string
}) {
  // Crow's foot spans about 16px, so offset slightly from the node edge
  const footLength = 12
  const spread = 8

  // Calculate crow's foot lines
  // Main direction is angle radians (toward the target)
  const cosA = Math.cos(angle)
  const sinA = Math.sin(angle)

  // Perpendicular for the spread
  const perpCos = Math.cos(angle + Math.PI / 2)
  const perpSin = Math.sin(angle + Math.PI / 2)

  // Three foot lines extending from center point
  const footLines = [
    // Top foot
    {
      x1: x,
      y1: y,
      x2: x - cosA * footLength + perpCos * spread,
      y2: y - sinA * footLength + perpSin * spread,
    },
    // Middle foot
    {
      x1: x,
      y1: y,
      x2: x - cosA * footLength,
      y2: y - sinA * footLength,
    },
    // Bottom foot
    {
      x1: x,
      y1: y,
      x2: x - cosA * footLength - perpCos * spread,
      y2: y - sinA * footLength - perpSin * spread,
    },
  ]

  // Optional circle (hollow) position - slightly before the crow's foot
  const circleOffset = footLength + 6
  const circleX = x - cosA * circleOffset
  const circleY = y - sinA * circleOffset

  return (
    <g data-testid="crow-foot-marker">
      {footLines.map((line, i) => (
        <line
          key={i}
          x1={line.x1}
          y1={line.y1}
          x2={line.x2}
          y2={line.y2}
          stroke={color}
          strokeWidth={2}
          strokeLinecap="round"
        />
      ))}
      {isOptional && (
        <circle
          cx={circleX}
          cy={circleY}
          r={4}
          fill="white"
          stroke={color}
          strokeWidth={2}
          data-testid="optional-marker"
        />
      )}
    </g>
  )
}

/**
 * One marker for one-to-one relationships.
 * Simple perpendicular line at the target end.
 */
function OneMarker({
  x,
  y,
  angle,
  color,
}: {
  x: number
  y: number
  angle: number
  color: string
}) {
  const lineLength = 8

  // Perpendicular
  const perpCos = Math.cos(angle + Math.PI / 2)
  const perpSin = Math.sin(angle + Math.PI / 2)

  return (
    <line
      x1={x + perpCos * lineLength}
      y1={y + perpSin * lineLength}
      x2={x - perpCos * lineLength}
      y2={y - perpSin * lineLength}
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      data-testid="one-marker"
    />
  )
}

/**
 * Format FK action for display. Returns null for NO ACTION (no display needed).
 */
function formatFkAction(
  action: ForeignKeyAction,
  prefix: 'DELETE' | 'UPDATE'
): string | null {
  if (action === 'NO ACTION') return null
  return `${prefix}: ${action}`
}

/**
 * Custom React Flow edge for visualizing foreign key relationships.
 * Supports crow's foot notation with optional markers.
 */
function ForeignKeyEdgeComponent({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
}: ForeignKeyEdgeProps) {
  const [isHovered, setIsHovered] = useState(false)

  const onDelete = data?.onDelete ?? 'NO ACTION'
  const onUpdate = data?.onUpdate ?? 'NO ACTION'
  const cardinality = data?.cardinality ?? 'one-to-many'
  const isOptional = data?.isOptional ?? false

  // Determine colors based on state
  const defaultColor = '#9ca3af' // gray-400
  const hoverColor = '#3b82f6' // blue-500
  const selectedColor = '#2563eb' // blue-600
  const cascadeColor = '#ef4444' // red-500 (for ON DELETE CASCADE)

  // Use cascade color if ON DELETE CASCADE for visual warning
  const isCascade = onDelete === 'CASCADE'
  const baseColor = isCascade ? cascadeColor : defaultColor
  const activeColor = isHovered ? hoverColor : selected ? selectedColor : baseColor

  // Dashed line for CASCADE (visual warning)
  const strokeDasharray = isCascade ? '5,5' : '0'

  // Get path for the edge
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  })

  // Calculate angle for markers
  const dx = targetX - sourceX
  const dy = targetY - sourceY
  const sourceAngle = Math.atan2(dy, dx)
  const targetAngle = sourceAngle + Math.PI

  // Stroke width based on state
  const strokeWidth = isHovered || selected ? 3 : 2

  // Build tooltip content
  const tooltipLines: string[] = [
    `${data?.childTable}.${data?.childColumn}`,
    `    -> ${data?.parentTable}.${data?.parentColumn}`,
  ]
  if (onDelete !== 'NO ACTION') tooltipLines.push(`ON DELETE ${onDelete}`)
  if (onUpdate !== 'NO ACTION') tooltipLines.push(`ON UPDATE ${onUpdate}`)
  const tooltipText = tooltipLines.join('\n')

  // Build label content (only show non-NO ACTION actions)
  const deleteLabel = formatFkAction(onDelete, 'DELETE')
  const updateLabel = formatFkAction(onUpdate, 'UPDATE')
  const hasLabel = deleteLabel || updateLabel

  // Delete handler
  const handleDelete = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      data?.onEdgeDelete?.(id)
    },
    [id, data]
  )

  return (
    <>
      {/* Main edge path */}
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: activeColor,
          strokeWidth,
          strokeDasharray,
          transition: 'stroke 150ms, stroke-width 150ms',
        }}
        interactionWidth={20}
      />

      {/* Hover detection overlay */}
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={20}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        style={{ pointerEvents: 'stroke' }}
        data-testid={`fk-edge-hitbox-${id}`}
      />

      {/* Glow effect when selected */}
      {selected && (
        <path
          d={edgePath}
          fill="none"
          stroke={activeColor}
          strokeWidth={8}
          strokeDasharray={strokeDasharray}
          style={{ opacity: 0.3, filter: 'blur(4px)', pointerEvents: 'none' }}
          data-testid={`fk-edge-glow-${id}`}
        />
      )}

      {/* Crow's foot notation markers */}
      <g data-testid={`fk-edge-markers-${id}`}>
        {/* Source side (child/many side): crow's foot for one-to-many */}
        {cardinality === 'one-to-many' && (
          <CrowFootMarker
            x={sourceX}
            y={sourceY}
            angle={sourceAngle}
            isOptional={isOptional}
            color={activeColor}
          />
        )}

        {/* Source side for one-to-one: single line */}
        {cardinality === 'one-to-one' && (
          <OneMarker x={sourceX} y={sourceY} angle={sourceAngle} color={activeColor} />
        )}

        {/* Target side (parent/one side): always a single line */}
        <OneMarker x={targetX} y={targetY} angle={targetAngle} color={activeColor} />
      </g>

      {/* Label with FK actions and delete button */}
      <EdgeLabelRenderer>
        <div
          className="absolute pointer-events-auto"
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
          }}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
          title={tooltipText}
          data-testid={`fk-edge-label-${id}`}
        >
          <div className="flex items-center gap-1">
            {/* FK action labels */}
            {hasLabel && (
              <div
                className={`
                  px-2 py-0.5 text-[10px] font-medium rounded
                  border shadow-sm bg-white transition-all duration-150
                  ${selected ? 'ring-2 ring-offset-1' : ''}
                `}
                style={{
                  borderColor: activeColor,
                  color: activeColor,
                  // @ts-expect-error ringColor is a valid CSS custom property
                  '--tw-ring-color': activeColor,
                }}
                data-testid={`fk-action-label-${id}`}
              >
                {deleteLabel && <div>{deleteLabel}</div>}
                {updateLabel && <div>{updateLabel}</div>}
              </div>
            )}

            {/* Delete button - visible on hover or selected */}
            {(isHovered || selected) && (
              <button
                onClick={handleDelete}
                className="p-1 rounded hover:bg-red-100 transition-colors bg-white border border-navy-200 shadow-sm"
                title="Delete foreign key"
                data-testid={`fk-delete-button-${id}`}
              >
                <DeleteIcon className="text-red-500" />
              </button>
            )}
          </div>
        </div>
      </EdgeLabelRenderer>
    </>
  )
}

/** Memoized ForeignKeyEdge component for React Flow */
export const ForeignKeyEdge = memo(ForeignKeyEdgeComponent)

/** Edge types object for React Flow registration */
export const foreignKeyEdgeTypes = {
  fkEdge: ForeignKeyEdge,
}

export default ForeignKeyEdge
