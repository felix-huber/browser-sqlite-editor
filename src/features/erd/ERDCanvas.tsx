import { useCallback, useState, useMemo } from 'react'
import {
  ReactFlow,
  Controls,
  MiniMap,
  Background,
  useNodesState,
  useEdgesState,
  addEdge,
  BackgroundVariant,
  type Node,
  type Edge,
  type OnConnect,
  type Connection,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { ForeignKeyAction } from '../../types/index'
import TableNodeComponent, { type TableNodeData as TableNodeDataType } from './TableNode'
import {
  FKValidationDialog,
  validateForeignKey,
  type PendingFKInfo,
  type ValidationError,
  type TableInfo,
  type ColumnInfo,
} from './FKValidationDialog'
import { useFKValidation } from './hooks/useFKValidation'
import { FKEdgeContextMenu } from './FKEdgeContextMenu'
import { FKEditDialog } from './FKEditDialog'
import { FKDeleteDialog } from './FKDeleteDialog'
import { foreignKeyEdgeTypes, type ForeignKeyEdgeData } from './ForeignKeyEdge'

/** Edge data for a relationship between tables */
export interface RelationshipEdgeData extends Record<string, unknown> {
  label?: string
  relationshipType?: 'one-to-one' | 'one-to-many' | 'many-to-many'
}

export type TableNode = Node<TableNodeDataType, 'tableNode'>
export type RelationshipEdge = Edge<RelationshipEdgeData>

/**
 * Existing FK info for duplicate checking
 */
export interface ExistingFKInfo {
  childTable?: string
  childColumn: string
  parentTable: string
  parentColumn: string
}

interface ERDCanvasProps {
  initialNodes?: TableNode[]
  initialEdges?: RelationshipEdge[]
  /** Whether canvas is in read-only mode */
  isReadOnly?: boolean
  /** Existing FKs for duplicate checking */
  existingFKs?: ExistingFKInfo[]
  onNodesChange?: (nodes: TableNode[]) => void
  onEdgesChange?: (edges: RelationshipEdge[]) => void
  /** Called when FK creation is confirmed. Returns true if successful. */
  onCreateFK?: (
    childTable: string,
    childColumn: string,
    parentTable: string,
    parentColumn: string,
    onDelete: ForeignKeyAction,
    onUpdate: ForeignKeyAction
  ) => Promise<boolean>
  /** Called when FK edit is confirmed. Returns true if successful. */
  onEditFK?: (
    childTable: string,
    childColumn: string,
    parentTable: string,
    parentColumn: string,
    onDelete: ForeignKeyAction,
    onUpdate: ForeignKeyAction
  ) => Promise<boolean>
  /** Called when FK delete is confirmed. Returns true if successful. */
  onDeleteFK?: (
    childTable: string,
    childColumn: string,
    parentTable: string,
    parentColumn: string
  ) => Promise<boolean>
  /** Called when "Show in Table Designer" is clicked */
  onShowInDesigner?: (tableName: string) => void
  /** Called to show a toast message */
  onShowToast?: (message: string, type: 'error' | 'success' | 'warning') => void
  /** Called when FK dialog dirty state changes */
  onFKDialogDirtyChange?: (dirty: boolean) => void
  /** Called when position dirty state changes */
  onPositionsDirtyChange?: (dirty: boolean) => void
  /** Called when pending FK creation state changes */
  onPendingFKCreationChange?: (pending: boolean) => void
  /** Whether ERD has draft changes (for showing indicator) */
  isDirty?: boolean
}

/** Context menu state */
interface ContextMenuState {
  isOpen: boolean
  position: { x: number; y: number }
  edgeId: string | null
}

/** FK info for dialogs */
interface FKDialogInfo {
  childTable: string
  childColumn: string
  parentTable: string
  parentColumn: string
  onDelete: ForeignKeyAction
  onUpdate: ForeignKeyAction
  isComposite?: boolean
}

const defaultNodes: TableNode[] = []
const defaultEdges: RelationshipEdge[] = []

/**
 * Extract column name from React Flow handle ID
 * Handle IDs are formatted as: "columnName-source" or "columnName-target"
 */
function extractColumnFromHandle(handleId: string | null): string | null {
  if (!handleId) return null
  const match = handleId.match(/^(.+)-(source|target)$/)
  return match ? match[1] : null
}

export function ERDCanvas({
  initialNodes = defaultNodes,
  initialEdges = defaultEdges,
  isReadOnly = false,
  existingFKs = [],
  onNodesChange: onNodesChangeCallback,
  onEdgesChange: onEdgesChangeCallback,
  onCreateFK,
  onEditFK,
  onDeleteFK,
  onShowInDesigner,
  onShowToast,
  onFKDialogDirtyChange,
  onPositionsDirtyChange,
  onPendingFKCreationChange,
  isDirty = false,
}: ERDCanvasProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)

  // FK Validation dialog state (for creation)
  const [showFKDialog, setShowFKDialog] = useState(false)
  const [pendingFK, setPendingFK] = useState<PendingFKInfo | null>(null)
  const [validationErrors, setValidationErrors] = useState<ValidationError[]>([])
  const [isCreating, setIsCreating] = useState(false)
  const [isCreatingIndex, setIsCreatingIndex] = useState(false)

  // Use the async FK validation hook
  const fkValidation = useFKValidation({
    childTable: pendingFK?.childTable ?? '',
    childColumn: pendingFK?.childColumn ?? '',
    parentTable: pendingFK?.parentTable ?? '',
    parentColumn: pendingFK?.parentColumn ?? '',
    isActive: showFKDialog && pendingFK !== null,
  })

  // Context menu state
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    isOpen: false,
    position: { x: 0, y: 0 },
    edgeId: null,
  })

  // Edit dialog state
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [editingFK, setEditingFK] = useState<FKDialogInfo | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  // Delete dialog state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deletingFK, setDeletingFK] = useState<FKDialogInfo | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  /**
   * Handle connection attempt - intercept and show validation dialog
   */
  const onConnect: OnConnect = useCallback(
    (connection: Connection) => {
      // Read-only guard
      if (isReadOnly) {
        onShowToast?.('Database is read-only', 'error')
        return
      }

      // Extract source (child) and target (parent) info
      const childTable = connection.source
      const parentTable = connection.target
      const childColumn = extractColumnFromHandle(connection.sourceHandle)
      const parentColumn = extractColumnFromHandle(connection.targetHandle)

      if (!childTable || !parentTable || !childColumn || !parentColumn) {
        return
      }

      // Find node data for validation
      const childNode = nodes.find((n) => n.id === childTable)
      const parentNode = nodes.find((n) => n.id === parentTable)

      if (!childNode || !parentNode) {
        return
      }

      // Create pending FK
      const fkInfo: PendingFKInfo = {
        childTable,
        childColumn,
        parentTable,
        parentColumn,
      }

      // Set pending FK and show dialog - hook will handle async validation
      setPendingFK(fkInfo)
      setShowFKDialog(true)
      onPendingFKCreationChange?.(true)

      // Build table info for synchronous (legacy) validation
      const childTableInfo: TableInfo = {
        name: childTable,
        columns: (childNode.data.columns || []).map((c): ColumnInfo => ({
          name: c.name,
          type: c.type,
          isPrimaryKey: c.isPrimaryKey || false,
          isUnique: c.isUnique || c.isPrimaryKey || false, // PKs are implicitly unique
          isNotNull: c.isNotNull || false,
        })),
      }

      const parentTableInfo: TableInfo = {
        name: parentTable,
        columns: (parentNode.data.columns || []).map((c): ColumnInfo => ({
          name: c.name,
          type: c.type,
          isPrimaryKey: c.isPrimaryKey || false,
          isUnique: c.isUnique || c.isPrimaryKey || false,
          isNotNull: c.isNotNull || false,
        })),
      }

      // Run synchronous (legacy) validation for immediate errors like DUPLICATE_FK
      const errors = validateForeignKey(
        fkInfo,
        childTableInfo,
        parentTableInfo,
        existingFKs
      )

      setValidationErrors(errors)
    },
    [isReadOnly, nodes, existingFKs, onShowToast, onPendingFKCreationChange]
  )

  /**
   * Handle FK creation confirmation
   */
  const handleCreateFK = useCallback(
    async (onDelete: ForeignKeyAction, onUpdate: ForeignKeyAction) => {
      if (!pendingFK || !onCreateFK) {
        setShowFKDialog(false)
        return
      }

      setIsCreating(true)

      try {
        const success = await onCreateFK(
          pendingFK.childTable,
          pendingFK.childColumn,
          pendingFK.parentTable,
          pendingFK.parentColumn,
          onDelete,
          onUpdate
        )

        if (success) {
          // Add the edge to the graph
          const newEdge: Edge = {
            id: `fk-${pendingFK.childTable}-${pendingFK.childColumn}-${pendingFK.parentTable}-${pendingFK.parentColumn}`,
            source: pendingFK.childTable,
            sourceHandle: `${pendingFK.childColumn}-source`,
            target: pendingFK.parentTable,
            targetHandle: `${pendingFK.parentColumn}-target`,
            type: 'fkEdge',
            data: {
              childTable: pendingFK.childTable,
              childColumns: [pendingFK.childColumn],
              parentTable: pendingFK.parentTable,
              parentColumns: [pendingFK.parentColumn],
              onDelete,
              onUpdate,
              cardinality: 'one-to-many',
              isOptional: true,
              isComposite: false,
            } as ForeignKeyEdgeData,
          }
          setEdges((eds) => addEdge(newEdge, eds))
          onShowToast?.('Foreign key created successfully', 'success')
        }
      } catch (err) {
        onShowToast?.(
          `Failed to create FK: ${err instanceof Error ? err.message : String(err)}`,
          'error'
        )
      } finally {
        setIsCreating(false)
        setShowFKDialog(false)
        setPendingFK(null)
        setValidationErrors([])
        onPendingFKCreationChange?.(false)
      }
    },
    [pendingFK, onCreateFK, setEdges, onShowToast, onPendingFKCreationChange]
  )

  /**
   * Handle dialog close
   */
  const handleDialogClose = useCallback(() => {
    if (!isCreating && !isCreatingIndex) {
      setShowFKDialog(false)
      setPendingFK(null)
      setValidationErrors([])
      onPendingFKCreationChange?.(false)
    }
  }, [isCreating, isCreatingIndex, onPendingFKCreationChange])

  /**
   * Handle creating unique index from validation dialog
   */
  const handleCreateUniqueIndex = useCallback(async () => {
    if (!fkValidation.createUniqueIndex) return
    setIsCreatingIndex(true)
    try {
      await fkValidation.createUniqueIndex()
    } finally {
      setIsCreatingIndex(false)
    }
  }, [fkValidation])

  /**
   * Get FK data from edge ID
   */
  const getFKDataFromEdge = useCallback(
    (edgeId: string): FKDialogInfo | null => {
      const edge = edges.find((e) => e.id === edgeId)
      if (!edge || !edge.data) return null

      const data = edge.data as ForeignKeyEdgeData
      const isComposite = data.isComposite ?? false
      // Use first column for single-column FKs, all columns for composite (read-only)
      const childColumns = data.childColumns ?? []
      const parentColumns = data.parentColumns ?? []
      return {
        childTable: data.childTable,
        childColumn: childColumns[0] ?? '',
        parentTable: data.parentTable,
        parentColumn: parentColumns[0] ?? '',
        onDelete: data.onDelete ?? 'NO ACTION',
        onUpdate: data.onUpdate ?? 'NO ACTION',
        isComposite,
      }
    },
    [edges]
  )

  /**
   * Handle context menu request from edge
   */
  const handleEdgeContextMenu = useCallback(
    (edgeId: string, position: { x: number; y: number }) => {
      setContextMenu({
        isOpen: true,
        position,
        edgeId,
      })
    },
    []
  )

  /**
   * Close context menu
   */
  const closeContextMenu = useCallback(() => {
    setContextMenu({ isOpen: false, position: { x: 0, y: 0 }, edgeId: null })
  }, [])

  /**
   * Handle edit FK from context menu
   */
  const handleEditFromContextMenu = useCallback(() => {
    if (!contextMenu.edgeId) return

    const fkData = getFKDataFromEdge(contextMenu.edgeId)
    if (fkData) {
      setEditingFK(fkData)
      setEditDialogOpen(true)
    }
    // Note: context menu is closed by FKEdgeContextMenu after calling this
  }, [contextMenu.edgeId, getFKDataFromEdge])

  /**
   * Handle delete FK from context menu
   */
  const handleDeleteFromContextMenu = useCallback(() => {
    if (!contextMenu.edgeId) return

    const fkData = getFKDataFromEdge(contextMenu.edgeId)
    if (fkData) {
      setDeletingFK(fkData)
      setDeleteDialogOpen(true)
    }
    // Note: context menu is closed by FKEdgeContextMenu after calling this
  }, [contextMenu.edgeId, getFKDataFromEdge])

  /**
   * Handle show in table designer from context menu
   */
  const handleShowInDesignerFromContextMenu = useCallback(() => {
    if (!contextMenu.edgeId) return

    const fkData = getFKDataFromEdge(contextMenu.edgeId)
    if (fkData) {
      onShowInDesigner?.(fkData.childTable)
    }
    // Note: context menu is closed by FKEdgeContextMenu after calling this
  }, [contextMenu.edgeId, getFKDataFromEdge, onShowInDesigner])

  /**
   * Handle edge edit (double-click)
   */
  const handleEdgeEdit = useCallback(
    (edgeId: string) => {
      if (isReadOnly) {
        onShowToast?.('Database is read-only', 'error')
        return
      }

      const fkData = getFKDataFromEdge(edgeId)
      if (fkData) {
        setEditingFK(fkData)
        setEditDialogOpen(true)
      }
    },
    [isReadOnly, getFKDataFromEdge, onShowToast]
  )

  /**
   * Handle edge delete (from inline button)
   */
  const handleEdgeDelete = useCallback(
    (edgeId: string) => {
      if (isReadOnly) {
        onShowToast?.('Database is read-only', 'error')
        return
      }

      const fkData = getFKDataFromEdge(edgeId)
      if (fkData) {
        setDeletingFK(fkData)
        setDeleteDialogOpen(true)
      }
    },
    [isReadOnly, getFKDataFromEdge, onShowToast]
  )

  /**
   * Handle save from edit dialog
   */
  const handleSaveFK = useCallback(
    async (newOnDelete: ForeignKeyAction, newOnUpdate: ForeignKeyAction) => {
      if (!editingFK || !onEditFK) {
        setEditDialogOpen(false)
        return
      }

      setIsSaving(true)

      try {
        const success = await onEditFK(
          editingFK.childTable,
          editingFK.childColumn,
          editingFK.parentTable,
          editingFK.parentColumn,
          newOnDelete,
          newOnUpdate
        )

        if (success) {
          // Update the edge in the graph
          setEdges((eds) =>
            eds.map((e) => {
              const data = e.data as ForeignKeyEdgeData | undefined
              if (
                data &&
                data.childTable === editingFK.childTable &&
                data.childColumns?.[0] === editingFK.childColumn &&
                data.parentTable === editingFK.parentTable &&
                data.parentColumns?.[0] === editingFK.parentColumn
              ) {
                return {
                  ...e,
                  data: {
                    ...data,
                    onDelete: newOnDelete,
                    onUpdate: newOnUpdate,
                  },
                }
              }
              return e
            })
          )
          onShowToast?.('Foreign key updated successfully', 'success')
          setEditDialogOpen(false)
          setEditingFK(null)
          // Clear dirty state after successful save
          onFKDialogDirtyChange?.(false)
        }
      } catch (err) {
        onShowToast?.(
          `Failed to update FK: ${err instanceof Error ? err.message : String(err)}`,
          'error'
        )
      } finally {
        setIsSaving(false)
      }
    },
    [editingFK, onEditFK, setEdges, onShowToast, onFKDialogDirtyChange]
  )

  /**
   * Handle close edit dialog
   */
  const handleCloseEditDialog = useCallback(() => {
    if (!isSaving) {
      setEditDialogOpen(false)
      setEditingFK(null)
      // Clear dirty state when dialog is closed
      onFKDialogDirtyChange?.(false)
    }
  }, [isSaving, onFKDialogDirtyChange])

  /**
   * Handle confirm delete from delete dialog
   */
  const handleConfirmDelete = useCallback(async () => {
    if (!deletingFK || !onDeleteFK) {
      setDeleteDialogOpen(false)
      return
    }

    setIsDeleting(true)

    try {
      const success = await onDeleteFK(
        deletingFK.childTable,
        deletingFK.childColumn,
        deletingFK.parentTable,
        deletingFK.parentColumn
      )

      if (success) {
        // Remove the edge from the graph
        setEdges((eds) =>
          eds.filter((e) => {
            const data = e.data as ForeignKeyEdgeData | undefined
            if (!data) return true
            return !(
              data.childTable === deletingFK.childTable &&
              data.childColumns?.[0] === deletingFK.childColumn &&
              data.parentTable === deletingFK.parentTable &&
              data.parentColumns?.[0] === deletingFK.parentColumn
            )
          })
        )
        onShowToast?.('Foreign key deleted successfully', 'success')
        setDeleteDialogOpen(false)
        setDeletingFK(null)
      }
    } catch (err) {
      onShowToast?.(
        `Failed to delete FK: ${err instanceof Error ? err.message : String(err)}`,
        'error'
      )
    } finally {
      setIsDeleting(false)
    }
  }, [deletingFK, onDeleteFK, setEdges, onShowToast])

  /**
   * Handle close delete dialog
   */
  const handleCloseDeleteDialog = useCallback(() => {
    if (!isDeleting) {
      setDeleteDialogOpen(false)
      setDeletingFK(null)
    }
  }, [isDeleting])

  /**
   * Memoized edges with callbacks injected
   */
  const edgesWithCallbacks = useMemo(() => {
    return edges.map((edge) => {
      if (edge.type === 'fkEdge') {
        return {
          ...edge,
          data: {
            ...edge.data,
            onEdgeDelete: handleEdgeDelete,
            onContextMenu: handleEdgeContextMenu,
            onEdgeEdit: handleEdgeEdit,
          },
        }
      }
      return edge
    })
  }, [edges, handleEdgeDelete, handleEdgeContextMenu, handleEdgeEdit])

  // Notify parent of node changes
  const handleNodesChange = useCallback(
    (changes: Parameters<typeof onNodesChange>[0]) => {
      onNodesChange(changes)

      // Check if any position changes occurred
      const hasPositionChange = changes.some(
        (change) => change.type === 'position' && change.dragging === false
      )
      if (hasPositionChange) {
        onPositionsDirtyChange?.(true)
      }

      if (onNodesChangeCallback) {
        // Get updated nodes after changes are applied
        setNodes((currentNodes) => {
          onNodesChangeCallback(currentNodes as TableNode[])
          return currentNodes
        })
      }
    },
    [onNodesChange, onNodesChangeCallback, setNodes, onPositionsDirtyChange]
  )

  // Notify parent of edge changes
  const handleEdgesChange = useCallback(
    (changes: Parameters<typeof onEdgesChange>[0]) => {
      onEdgesChange(changes)
      if (onEdgesChangeCallback) {
        setEdges((currentEdges) => {
          onEdgesChangeCallback(currentEdges as RelationshipEdge[])
          return currentEdges
        })
      }
    },
    [onEdgesChange, onEdgesChangeCallback, setEdges]
  )

  // Get FK info for context menu
  const contextMenuFKInfo = contextMenu.edgeId
    ? getFKDataFromEdge(contextMenu.edgeId)
    : null

  return (
    <div className="h-full w-full" data-testid="erd-canvas">
      <ReactFlow
        nodes={nodes}
        edges={edgesWithCallbacks}
        nodeTypes={{ tableNode: TableNodeComponent }}
        edgeTypes={foreignKeyEdgeTypes}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={onConnect}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.1}
        maxZoom={2}
        defaultViewport={{ x: 0, y: 0, zoom: 1 }}
        proOptions={{ hideAttribution: true }}
        // Disable connecting when read-only
        connectOnClick={!isReadOnly}
        nodesConnectable={!isReadOnly}
      >
        <Controls
          showZoom
          showFitView
          showInteractive
          position="bottom-right"
        />
        {/* Draft indicator - matches designer pattern */}
        {isDirty && (
          <div
            className="absolute top-4 left-4 z-10 px-3 py-1.5 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-600"
            data-testid="erd-draft-indicator"
          >
            Unsaved changes
          </div>
        )}
        <MiniMap
          nodeColor="#486581"
          maskColor="rgba(16, 42, 67, 0.7)"
          position="bottom-left"
        />
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          color="#334e68"
        />
      </ReactFlow>

      {/* FK Validation Dialog (for creation) */}
      <FKValidationDialog
        isOpen={showFKDialog}
        pendingFK={pendingFK}
        errors={validationErrors}
        isValidating={fkValidation.isValidating}
        isCreating={isCreating}
        onClose={handleDialogClose}
        onCreate={handleCreateFK}
        uniquenessResult={fkValidation.uniquenessResult}
        integrityResult={fkValidation.integrityResult}
        createUniqueIndexDDL={fkValidation.createUniqueIndexDDL}
        onCreateUniqueIndex={handleCreateUniqueIndex}
        isCreatingIndex={isCreatingIndex}
        onCancelValidation={fkValidation.cancel}
        isLargeTable={fkValidation.isLargeTable}
      />

      {/* FK Context Menu */}
      {contextMenu.isOpen && contextMenuFKInfo && (
        <FKEdgeContextMenu
          position={contextMenu.position}
          fkInfo={contextMenuFKInfo}
          isReadOnly={isReadOnly}
          onEdit={handleEditFromContextMenu}
          onDelete={handleDeleteFromContextMenu}
          onShowInDesigner={handleShowInDesignerFromContextMenu}
          onClose={closeContextMenu}
        />
      )}

      {/* FK Edit Dialog */}
      {editingFK && (
        <FKEditDialog
          isOpen={editDialogOpen}
          fkInfo={editingFK}
          isSaving={isSaving}
          onSave={handleSaveFK}
          onClose={handleCloseEditDialog}
          onDirtyChange={onFKDialogDirtyChange}
        />
      )}

      {/* FK Delete Dialog */}
      {deletingFK && (
        <FKDeleteDialog
          isOpen={deleteDialogOpen}
          fkInfo={deletingFK}
          isDeleting={isDeleting}
          onConfirm={handleConfirmDelete}
          onClose={handleCloseDeleteDialog}
        />
      )}
    </div>
  )
}

export default ERDCanvas
