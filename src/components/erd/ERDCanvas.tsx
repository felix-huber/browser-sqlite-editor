import { useCallback } from 'react'
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
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

/** Node data for a database table */
export interface TableNodeData extends Record<string, unknown> {
  label: string
  columns?: Array<{
    name: string
    type: string
    isPrimaryKey?: boolean
    isForeignKey?: boolean
  }>
}

/** Edge data for a relationship between tables */
export interface RelationshipEdgeData extends Record<string, unknown> {
  label?: string
  relationshipType?: 'one-to-one' | 'one-to-many' | 'many-to-many'
}

export type TableNode = Node<TableNodeData>
export type RelationshipEdge = Edge<RelationshipEdgeData>

interface ERDCanvasProps {
  initialNodes?: TableNode[]
  initialEdges?: RelationshipEdge[]
  onNodesChange?: (nodes: TableNode[]) => void
  onEdgesChange?: (edges: RelationshipEdge[]) => void
}

const defaultNodes: TableNode[] = []
const defaultEdges: RelationshipEdge[] = []

export function ERDCanvas({
  initialNodes = defaultNodes,
  initialEdges = defaultEdges,
  onNodesChange: onNodesChangeCallback,
  onEdgesChange: onEdgesChangeCallback,
}: ERDCanvasProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)

  const onConnect: OnConnect = useCallback(
    (connection) => {
      setEdges((eds) => addEdge(connection, eds))
    },
    [setEdges]
  )

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
    </div>
  )
}

export default ERDCanvas
