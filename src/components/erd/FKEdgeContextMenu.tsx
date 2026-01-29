/**
 * Context menu for FK edges in the ERD canvas.
 *
 * Provides options to:
 * - Edit FK (ON DELETE/UPDATE actions)
 * - Delete FK
 * - Show in Table Designer (navigate to the child table)
 */

import { useCallback } from 'react'

export interface FKEdgeContextMenuProps {
  /** Position to render the menu */
  position: { x: number; y: number }
  /** FK info for display and actions */
  fkInfo: {
    childTable: string
    childColumn: string
    parentTable: string
    parentColumn: string
  }
  /** Whether the database is in read-only mode */
  isReadOnly: boolean
  /** Called when Edit FK is clicked */
  onEdit: () => void
  /** Called when Delete FK is clicked */
  onDelete: () => void
  /** Called when Show in Table Designer is clicked */
  onShowInDesigner: () => void
  /** Called when the menu should close */
  onClose: () => void
}

export function FKEdgeContextMenu({
  position,
  fkInfo,
  isReadOnly,
  onEdit,
  onDelete,
  onShowInDesigner,
  onClose,
}: FKEdgeContextMenuProps) {
  // Prevent menu click from propagating
  const handleMenuClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
  }, [])

  // Close on backdrop click
  const handleBackdropClick = useCallback(() => {
    onClose()
  }, [onClose])

  const handleEdit = useCallback(() => {
    if (!isReadOnly) {
      onEdit()
      onClose()
    }
  }, [isReadOnly, onEdit, onClose])

  const handleDelete = useCallback(() => {
    if (!isReadOnly) {
      onDelete()
      onClose()
    }
  }, [isReadOnly, onDelete, onClose])

  const handleShowInDesigner = useCallback(() => {
    onShowInDesigner()
    onClose()
  }, [onShowInDesigner, onClose])

  return (
    <>
      {/* Backdrop to catch clicks outside */}
      <div
        className="fixed inset-0 z-40"
        onClick={handleBackdropClick}
        data-testid="fk-context-menu-backdrop"
      />

      {/* Context menu */}
      <div
        className="fixed z-50 bg-white rounded-lg shadow-lg border border-navy-200 py-1 min-w-[180px]"
        style={{
          left: position.x,
          top: position.y,
        }}
        onClick={handleMenuClick}
        data-testid="fk-edge-context-menu"
      >
        {/* Edit FK */}
        <button
          type="button"
          onClick={handleEdit}
          disabled={isReadOnly}
          className={`w-full px-4 py-2 text-left text-sm flex items-center gap-2 transition-colors ${
            isReadOnly
              ? 'text-navy-400 cursor-not-allowed'
              : 'text-navy-700 hover:bg-navy-50'
          }`}
          title={isReadOnly ? 'Database is read-only' : 'Edit foreign key actions'}
          data-testid="fk-context-menu-edit"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
            />
          </svg>
          Edit Foreign Key
        </button>

        {/* Delete FK */}
        <button
          type="button"
          onClick={handleDelete}
          disabled={isReadOnly}
          className={`w-full px-4 py-2 text-left text-sm flex items-center gap-2 transition-colors ${
            isReadOnly
              ? 'text-navy-400 cursor-not-allowed'
              : 'text-red-600 hover:bg-red-50'
          }`}
          title={isReadOnly ? 'Database is read-only' : 'Delete foreign key'}
          data-testid="fk-context-menu-delete"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
            />
          </svg>
          Delete Foreign Key
        </button>

        {/* Separator */}
        <div className="my-1 border-t border-navy-200" />

        {/* Show in Table Designer */}
        <button
          type="button"
          onClick={handleShowInDesigner}
          className="w-full px-4 py-2 text-left text-sm text-navy-700 hover:bg-navy-50 flex items-center gap-2 transition-colors"
          data-testid="fk-context-menu-show-in-designer"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z"
            />
          </svg>
          Show in Table Designer
        </button>

        {/* FK info footer */}
        <div className="px-4 py-2 mt-1 border-t border-navy-200 text-xs text-navy-500">
          <div className="truncate">
            {fkInfo.childTable}.{fkInfo.childColumn}
          </div>
          <div className="truncate text-navy-400">
            &rarr; {fkInfo.parentTable}.{fkInfo.parentColumn}
          </div>
        </div>
      </div>
    </>
  )
}

export default FKEdgeContextMenu
