import { useCallback, useState } from 'react'
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
import {
  FKValidationDialog,
  validateForeignKey,
  type PendingFKInfo,
  type ValidationError,
  type TableInfo,
  type ColumnInfo,
} from './FKValidationDialog'

/** Node data for a database table */
export interface TableNodeData extends Record<string, unknown> {
  label: string
  columns?: Array<{
    name: string
    type: string
    isPrimaryKey?: boolean
    isForeignKey?: boolean
    isUnique?: boolean
    isNotNull?: boolean
  }>
}

/** Edge data for a relationship between tables */
export interface RelationshipEdgeData extends Record<string, unknown> {
  label?: string
  relationshipType?: 'one-to-one' | 'one-to-many' | 'many-to-many'
}

export type TableNode = Node<TableNodeData>
export type RelationshipEdge = Edge<RelationshipEdgeData>

/**
 * Existing FK info for duplicate checking
 */
export interface ExistingFKInfo {
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
  /** Called to show a toast message */
  onShowToast?: (message: string, type: 'error' | 'success' | 'warning') => void
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
  onShowToast,
}: ERDCanvasProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)

  // FK Validation dialog state
  const [showFKDialog, setShowFKDialog] = useState(false)
  const [pendingFK, setPendingFK] = useState<PendingFKInfo | null>(null)
  const [validationErrors, setValidationErrors] = useState<ValidationError[]>([])
  const [isValidating, setIsValidating] = useState(false)
  const [isCreating, setIsCreating] = useState(false)

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

      // Run validation
      setIsValidating(true)
      setPendingFK(fkInfo)
      setShowFKDialog(true)

      // Build table info for validation
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

      // Validate FK
      const errors = validateForeignKey(
        fkInfo,
        childTableInfo,
        parentTableInfo,
        existingFKs
      )

      setValidationErrors(errors)
      setIsValidating(false)
    },
    [isReadOnly, nodes, existingFKs, onShowToast]
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
              childColumn: pendingFK.childColumn,
              parentTable: pendingFK.parentTable,
              parentColumn: pendingFK.parentColumn,
              onDelete,
              onUpdate,
              cardinality: 'one-to-many',
              isOptional: true,
            },
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
      }
    },
    [pendingFK, onCreateFK, setEdges, onShowToast]
  )

  /**
   * Handle dialog close
   */
  const handleDialogClose = useCallback(() => {
    if (!isCreating) {
      setShowFKDialog(false)
      setPendingFK(null)
      setValidationErrors([])
    }
  }, [isCreating])

  // Notify parent of node changes
  const handleNodesChange = useCallback(
    (changes: Parameters<typeof onNodesChange>[0]) => {
      onNodesChange(changes)
      if (onNodesChangeCallback) {
        // Get updated nodes after changes are applied
        setNodes((currentNodes) => {
          onNodesChangeCallback(currentNodes as TableNode[])
          return currentNodes
        })
      }
    },
    [onNodesChange, onNodesChangeCallback, setNodes]
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

  return (
    <div className="h-full w-full" data-testid="erd-canvas">
      <ReactFlow
        nodes={nodes}
        edges={edges}
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

      {/* FK Validation Dialog */}
      <FKValidationDialog
        isOpen={showFKDialog}
        pendingFK={pendingFK}
        errors={validationErrors}
        isValidating={isValidating}
        isCreating={isCreating}
        onClose={handleDialogClose}
        onCreate={handleCreateFK}
      />
    </div>
  )
}

export default ERDCanvas
