import { useCallback, useMemo } from 'react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

/** Single sort condition */
export interface SortCondition {
  /** Unique identifier for this sort condition */
  id: string
  /** Column name (may include table alias prefix) */
  column: string
  /** Sort direction */
  direction: 'ASC' | 'DESC'
}

/** Available column for sorting */
export interface AvailableColumn {
  /** Full column reference (e.g., "t1.name" or just "name") */
  value: string
  /** Display label */
  label: string
}

interface OrderByBuilderProps {
  /** Current sort conditions */
  sortConditions: SortCondition[]
  /** Callback when sort conditions change */
  onSortConditionsChange: (conditions: SortCondition[]) => void
  /** Available columns from selected tables */
  availableColumns: AvailableColumn[]
}

/** Drag handle icon */
function DragHandleIcon({ className }: { className?: string }) {
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
      <line x1="8" y1="6" x2="16" y2="6" />
      <line x1="8" y1="12" x2="16" y2="12" />
      <line x1="8" y1="18" x2="16" y2="18" />
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

interface SortRowProps {
  condition: SortCondition
  index: number
  availableColumns: AvailableColumn[]
  onColumnChange: (id: string, column: string) => void
  onDirectionToggle: (id: string) => void
  onRemove: (id: string) => void
}

/** Individual sortable row for a sort condition */
function SortRow({
  condition,
  index,
  availableColumns,
  onColumnChange,
  onDirectionToggle,
  onRemove,
}: SortRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: condition.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`
        flex items-center gap-2 px-3 py-2 bg-white border border-navy-200 rounded-lg
        ${isDragging ? 'shadow-lg z-10' : ''}
      `}
      data-testid={`sort-row-${index}`}
    >
      {/* Priority number */}
      <span
        className="w-5 h-5 flex items-center justify-center text-xs font-semibold text-navy-500 bg-navy-100 rounded"
        data-testid={`sort-priority-${index}`}
      >
        {index + 1}
      </span>

      {/* Drag handle */}
      <button
        type="button"
        className="cursor-grab active:cursor-grabbing p-1 text-navy-400 hover:text-navy-600 transition-colors"
        {...attributes}
        {...listeners}
        data-testid={`sort-drag-handle-${index}`}
        aria-label="Drag to reorder"
      >
        <DragHandleIcon />
      </button>

      {/* Column dropdown */}
      <select
        value={condition.column}
        onChange={(e) => onColumnChange(condition.id, e.target.value)}
        className="flex-1 text-sm border border-navy-200 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-navy-600 focus:border-transparent"
        data-testid={`sort-column-select-${index}`}
      >
        <option value="">Select column...</option>
        {availableColumns.map((col) => (
          <option key={col.value} value={col.value}>
            {col.label}
          </option>
        ))}
      </select>

      {/* Direction toggle */}
      <button
        type="button"
        onClick={() => onDirectionToggle(condition.id)}
        className={`
          px-2 py-1 text-xs font-semibold rounded transition-colors
          ${condition.direction === 'ASC'
            ? 'bg-navy-100 text-navy-700 hover:bg-navy-200'
            : 'bg-navy-600 text-white hover:bg-navy-700'
          }
        `}
        data-testid={`sort-direction-toggle-${index}`}
        title={`Sort ${condition.direction === 'ASC' ? 'ascending' : 'descending'}`}
      >
        {condition.direction}
      </button>

      {/* Remove button */}
      <button
        type="button"
        onClick={() => onRemove(condition.id)}
        className="p-1 text-navy-400 hover:text-red-500 transition-colors"
        data-testid={`sort-remove-${index}`}
        aria-label="Remove sort"
      >
        <CloseIcon />
      </button>
    </div>
  )
}

/**
 * ORDER BY builder panel component.
 * Allows users to add, remove, reorder, and configure sort conditions.
 */
export function OrderByBuilder({
  sortConditions,
  onSortConditionsChange,
  availableColumns,
}: OrderByBuilderProps) {
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  /** Add a new sort condition */
  const handleAddSort = useCallback(() => {
    const newCondition: SortCondition = {
      id: `sort-${Date.now()}`,
      column: '',
      direction: 'ASC',
    }
    onSortConditionsChange([...sortConditions, newCondition])
  }, [sortConditions, onSortConditionsChange])

  /** Update column for a sort condition */
  const handleColumnChange = useCallback(
    (id: string, column: string) => {
      const updated = sortConditions.map((c) =>
        c.id === id ? { ...c, column } : c
      )
      onSortConditionsChange(updated)
    },
    [sortConditions, onSortConditionsChange]
  )

  /** Toggle direction for a sort condition */
  const handleDirectionToggle = useCallback(
    (id: string) => {
      const updated = sortConditions.map((c): SortCondition =>
        c.id === id
          ? { ...c, direction: c.direction === 'ASC' ? 'DESC' : 'ASC' }
          : c
      )
      onSortConditionsChange(updated)
    },
    [sortConditions, onSortConditionsChange]
  )

  /** Remove a sort condition */
  const handleRemove = useCallback(
    (id: string) => {
      const updated = sortConditions.filter((c) => c.id !== id)
      onSortConditionsChange(updated)
    },
    [sortConditions, onSortConditionsChange]
  )

  /** Clear all sort conditions */
  const handleClearAll = useCallback(() => {
    onSortConditionsChange([])
  }, [onSortConditionsChange])

  /** Handle drag end for reordering */
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      if (over && active.id !== over.id) {
        const oldIndex = sortConditions.findIndex((c) => c.id === active.id)
        const newIndex = sortConditions.findIndex((c) => c.id === over.id)
        const reordered = arrayMove(sortConditions, oldIndex, newIndex)
        onSortConditionsChange(reordered)
      }
    },
    [sortConditions, onSortConditionsChange]
  )

  /** Generate SQL ORDER BY clause */
  const orderByClause = useMemo(() => {
    const validConditions = sortConditions.filter((c) => c.column)
    if (validConditions.length === 0) return ''
    const parts = validConditions.map((c) => `${c.column} ${c.direction}`)
    return `ORDER BY ${parts.join(', ')}`
  }, [sortConditions])

  const sortIds = useMemo(
    () => sortConditions.map((c) => c.id),
    [sortConditions]
  )

  return (
    <div className="flex flex-col gap-3" data-testid="order-by-builder">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-navy-700">ORDER BY</h4>
        <div className="flex items-center gap-2">
          {sortConditions.length > 0 && (
            <button
              type="button"
              onClick={handleClearAll}
              className="text-xs text-navy-500 hover:text-red-500 transition-colors"
              data-testid="clear-all-sorts"
            >
              Clear All
            </button>
          )}
          <button
            type="button"
            onClick={handleAddSort}
            className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-navy-600 bg-navy-100 hover:bg-navy-200 rounded transition-colors"
            data-testid="add-sort-button"
          >
            <PlusIcon className="w-3 h-3" />
            Add Sort
          </button>
        </div>
      </div>

      {/* Sort conditions list */}
      {sortConditions.length === 0 ? (
        <div
          className="text-sm text-navy-400 italic py-2"
          data-testid="no-sorts-message"
        >
          No sort conditions. Click "Add Sort" to add one.
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={sortIds} strategy={verticalListSortingStrategy}>
            <div className="flex flex-col gap-2" data-testid="sort-conditions-list">
              {sortConditions.map((condition, index) => (
                <SortRow
                  key={condition.id}
                  condition={condition}
                  index={index}
                  availableColumns={availableColumns}
                  onColumnChange={handleColumnChange}
                  onDirectionToggle={handleDirectionToggle}
                  onRemove={handleRemove}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {/* Generated SQL preview */}
      {orderByClause && (
        <div
          className="mt-2 p-2 bg-navy-50 border border-navy-200 rounded text-xs font-mono text-navy-700"
          data-testid="order-by-sql-preview"
        >
          {orderByClause}
        </div>
      )}
    </div>
  )
}

/**
 * Generate ORDER BY clause from sort conditions.
 * Exported for use in SQL generation.
 */
export function generateOrderByClause(conditions: SortCondition[]): string {
  const validConditions = conditions.filter((c) => c.column)
  if (validConditions.length === 0) return ''
  const parts = validConditions.map((c) => `${c.column} ${c.direction}`)
  return `ORDER BY ${parts.join(', ')}`
}

export default OrderByBuilder
