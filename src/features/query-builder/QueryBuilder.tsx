import { useCallback, useState, useMemo, useEffect, useRef, type DragEvent } from 'react'
import {
  ReactFlow,
  Controls,
  Background,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  addEdge,
  type Node,
  type OnConnect,
  type IsValidConnection,
  type ReactFlowInstance,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { tableBoxNodeTypes, type TableBoxData, type TableBoxNodeType, type TableBoxColumnData } from './TableBox'
import { joinEdgeTypes, type JoinEdgeType, type JoinType } from './JoinEdge'

/** Maximum number of tables allowed on canvas */
const MAX_TABLES = 10

/** Combined node types for React Flow */
const nodeTypes = tableBoxNodeTypes

/** Combined edge types for React Flow */
const edgeTypes = joinEdgeTypes

/** Re-exported node data type for backwards compatibility */
export type TableBoxNodeData = TableBoxData

export type TableBoxNode = Node<TableBoxNodeData>

/** Join configuration for external consumption */
export interface JoinConfig {
  /** Unique edge ID */
  id: string
  /** Source table name */
  sourceTable: string
  /** Source column name */
  sourceColumn: string
  /** Target table name */
  targetTable: string
  /** Target column name */
  targetColumn: string
  /** Join type */
  joinType: JoinType
}

interface QueryBuilderProps {
  /** List of available table names from the database schema */
  tables: string[]
  /** Column metadata for tables (table name -> columns) */
  tableColumns?: Record<string, TableBoxColumnData[]>
  /** Callback when tables on canvas change */
  onTablesChange?: (tableNames: string[]) => void
  /** Callback when joins change */
  onJoinsChange?: (joins: JoinConfig[]) => void
  /** Callback when nodes/edges change */
  onStateChange?: (nodes: TableBoxNodeType[], edges: JoinEdgeType[]) => void
}

/**
 * Visual query builder component with table list panel and React Flow canvas
 */
export function QueryBuilder({
  tables,
  tableColumns,
  onTablesChange,
  onJoinsChange,
  onStateChange,
}: QueryBuilderProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<TableBoxNodeType>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<JoinEdgeType>([])
  const [searchQuery, setSearchQuery] = useState('')

  // Keep refs for stable callbacks (avoids infinite loops in useEffect)
  const nodesRef = useRef(nodes)
  nodesRef.current = nodes

  // Refs for prop callbacks to avoid recreating internal callbacks when props change
  const onTablesChangeRef = useRef(onTablesChange)
  onTablesChangeRef.current = onTablesChange
  const onJoinsChangeRef = useRef(onJoinsChange)
  onJoinsChangeRef.current = onJoinsChange
  const onStateChangeRef = useRef(onStateChange)
  onStateChangeRef.current = onStateChange

  const [showLimitWarning, setShowLimitWarning] = useState(false)
  const [connectionError, setConnectionError] = useState<string | null>(null)

  // ReactFlow instance for programmatic control
  const reactFlowInstance = useRef<ReactFlowInstance<TableBoxNodeType, JoinEdgeType> | null>(null)

  // Track previous node count to detect when nodes are added
  const prevNodeCountRef = useRef(0)

  // Filter tables based on search query
  const filteredTables = useMemo(() => {
    if (!searchQuery.trim()) return tables
    const query = searchQuery.toLowerCase()
    return tables.filter((table) => table.toLowerCase().includes(query))
  }, [tables, searchQuery])

  // Get list of table names currently on canvas
  const tablesOnCanvas = useMemo(() => {
    return nodes.map((node) => node.data.tableName)
  }, [nodes])

  // Auto-fit view when nodes are added (with a small delay for node to render)
  useEffect(() => {
    const currentCount = nodes.length
    const prevCount = prevNodeCountRef.current
    prevNodeCountRef.current = currentCount

    // Only fitView when nodes are added (not removed or on mount with 0 nodes)
    if (currentCount > prevCount && currentCount > 0 && reactFlowInstance.current) {
      // Small delay to allow node to render before fitting
      const timeoutId = setTimeout(() => {
        reactFlowInstance.current?.fitView({
          padding: 0.3,
          maxZoom: 0.8, // Don't zoom in too close
          duration: 200,
        })
      }, 50)
      return () => clearTimeout(timeoutId)
    }
  }, [nodes.length])

  // Handle drag start from table list
  const handleDragStart = useCallback((event: DragEvent<HTMLDivElement>, tableName: string) => {
    event.dataTransfer.setData('application/query-builder-table', tableName)
    event.dataTransfer.effectAllowed = 'copy'
  }, [])

  const handleSelectionChange = useCallback(
    (tableName: string, selectedColumns: string[]) => {
      setNodes((nds) =>
        nds.map((node) =>
          node.data.tableName === tableName
            ? {
                ...node,
                data: {
                  ...node.data,
                  selectedColumns,
                },
              }
            : node
        )
      )
    },
    [setNodes]
  )

  // Handle drag over (required for drop to work)
  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }, [])

  // Clear all tables from canvas
  const handleClear = useCallback(() => {
    setNodes([])
    setEdges([])
    // Use queueMicrotask to defer parent callbacks and avoid "Cannot update while rendering" warning
    queueMicrotask(() => {
      onTablesChangeRef.current?.([])
      onJoinsChangeRef.current?.([])
    })
  }, [setNodes, setEdges])

  // Helper to extract column name from handle ID (e.g., "column_name-source" -> "column_name")
  const extractColumnFromHandle = useCallback((handleId: string | null | undefined): string => {
    if (!handleId) return ''
    // Handle ID format is "columnName-source" or "columnName-target"
    return handleId.replace(/-(?:source|target)$/, '')
  }, [])

  // Helper to get table name from node ID
  // Uses ref to avoid recreating callback when nodes change (prevents infinite loops)
  const getTableNameFromNode = useCallback(
    (nodeId: string): string => {
      const node = nodesRef.current.find((n) => n.id === nodeId)
      return node?.data.tableName ?? ''
    },
    []
  )

  // Notify parent of join changes
  // Uses queueMicrotask to defer callback and avoid "Cannot update while rendering" warning
  const notifyJoinsChange = useCallback(
    (currentEdges: JoinEdgeType[]) => {
      if (!onJoinsChangeRef.current) return

      const joins: JoinConfig[] = currentEdges.map((edge) => ({
        id: edge.id,
        sourceTable: getTableNameFromNode(edge.source),
        sourceColumn: edge.data?.sourceColumn ?? '',
        targetTable: getTableNameFromNode(edge.target),
        targetColumn: edge.data?.targetColumn ?? '',
        joinType: edge.data?.joinType ?? 'INNER',
      }))

      queueMicrotask(() => {
        onJoinsChangeRef.current?.(joins)
      })
    },
    [getTableNameFromNode]
  )

  const handleRemoveTable = useCallback(
    (tableName: string) => {
      let removedNodeIds: Set<string> | null = null

      setNodes((nds) => {
        const toRemove = nds.filter((node) => node.data.tableName === tableName)
        removedNodeIds = new Set(toRemove.map((node) => node.id))
        const updated = nds.filter((node) => node.data.tableName !== tableName)
        // Defer callback to avoid "Cannot update while rendering" warning
        const tableNames = updated.map((n) => n.data.tableName)
        queueMicrotask(() => {
          onTablesChangeRef.current?.(tableNames)
        })
        return updated
      })

      setEdges((eds) => {
        if (!removedNodeIds || removedNodeIds.size === 0) return eds
        const updated = eds.filter(
          (edge) => !removedNodeIds!.has(edge.source) && !removedNodeIds!.has(edge.target)
        )
        // notifyJoinsChange already uses queueMicrotask internally
        notifyJoinsChange(updated)
        return updated
      })
    },
    [setNodes, setEdges, notifyJoinsChange]
  )

  // Handle drop on canvas
  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault()

      const tableName = event.dataTransfer.getData('application/query-builder-table')
      if (!tableName) return

      // Check if table already exists on canvas
      if (tablesOnCanvas.includes(tableName)) return

      // Check table limit
      if (nodes.length >= MAX_TABLES) {
        setShowLimitWarning(true)
        setTimeout(() => setShowLimitWarning(false), 3000)
        return
      }

      // Calculate drop position relative to canvas
      const reactFlowBounds = event.currentTarget.getBoundingClientRect()
      const basePosition = {
        x: event.clientX - reactFlowBounds.left - 100, // Center the node
        y: event.clientY - reactFlowBounds.top - 50,
      }
      const offsetX = (nodes.length % 3) * 260
      const offsetY = Math.floor(nodes.length / 3) * 200
      const position = {
        x: basePosition.x + offsetX,
        y: basePosition.y + offsetY,
      }

      // Generate table alias (t1, t2, etc.)
      const existingCount = nodes.length
      const alias = `t${existingCount + 1}`

      const newNode: TableBoxNodeType = {
        id: `table-${tableName}-${Date.now()}`,
        type: 'tableBox',
        position,
        data: {
          tableName,
          alias,
          columns: tableColumns?.[tableName] ?? [], // Populate if available
          selectedColumns: [],
          onSelectionChange: handleSelectionChange,
          onRemove: handleRemoveTable,
        },
      }

      setNodes((nds) => {
        const updated = [...nds, newNode]
        // Defer callback to avoid "Cannot update while rendering" warning
        const tableNames = updated.map((n) => n.data.tableName)
        queueMicrotask(() => {
          onTablesChangeRef.current?.(tableNames)
        })
        return updated
      })
    },
    [nodes.length, tablesOnCanvas, setNodes, tableColumns, handleSelectionChange, handleRemoveTable]
  )

  // Update node columns when tableColumns change
  useEffect(() => {
    if (!tableColumns) return
    setNodes((nds) =>
      nds.map((node) => {
        const columns = tableColumns[node.data.tableName] ?? []
        const selected = node.data.selectedColumns.filter((col) =>
          columns.some((c) => c.name === col)
        )
        return {
          ...node,
          data: {
            ...node.data,
            columns,
            selectedColumns: selected,
            onSelectionChange: handleSelectionChange,
            onRemove: handleRemoveTable,
          },
        }
      })
    )
  }, [tableColumns, setNodes, handleSelectionChange, handleRemoveTable])

  // Notify parent of state changes
  // Use queueMicrotask to defer the callback and avoid "Cannot update component while rendering" warning
  useEffect(() => {
    queueMicrotask(() => {
      onStateChangeRef.current?.(nodes, edges)
    })
  }, [nodes, edges])

  // Validate connection - prevent self-join on same column
  const isValidConnection: IsValidConnection<JoinEdgeType> = useCallback(
    (connection) => {
      const { source, target, sourceHandle, targetHandle } = connection

      // Must have all required fields
      if (!source || !target || !sourceHandle || !targetHandle) return false

      const sourceColumn = extractColumnFromHandle(sourceHandle)
      const targetColumn = extractColumnFromHandle(targetHandle)

      // Prevent self-join on the exact same column
      if (source === target && sourceColumn === targetColumn) {
        setConnectionError('Cannot join a column to itself')
        setTimeout(() => setConnectionError(null), 2000)
        return false
      }

      return true
    },
    [extractColumnFromHandle]
  )

  // Handle edge deletion
  const handleDeleteEdge = useCallback(
    (edgeId: string) => {
      setEdges((eds) => {
        const updated = eds.filter((edge) => edge.id !== edgeId)
        notifyJoinsChange(updated)
        return updated
      })
    },
    [setEdges, notifyJoinsChange]
  )

  // Handle join type change
  const handleJoinTypeChange = useCallback(
    (edgeId: string, newJoinType: JoinType) => {
      setEdges((eds) => {
        const updated = eds.map((edge) =>
          edge.id === edgeId
            ? {
                ...edge,
                data: {
                  ...edge.data,
                  joinType: newJoinType,
                  onJoinTypeChange: handleJoinTypeChange,
                  onDelete: handleDeleteEdge,
                },
              }
            : edge
        ) as JoinEdgeType[]
        notifyJoinsChange(updated)
        return updated
      })
    },
    [setEdges, notifyJoinsChange, handleDeleteEdge]
  )

  // Handle new connection (join creation)
  const handleConnect: OnConnect = useCallback(
    (connection) => {
      const { source, target, sourceHandle, targetHandle } = connection

      if (!source || !target || !sourceHandle || !targetHandle) return

      const sourceColumn = extractColumnFromHandle(sourceHandle)
      const targetColumn = extractColumnFromHandle(targetHandle)
      const edgeId = `join-${source}-${sourceColumn}-${target}-${targetColumn}`

      // Check for duplicate edge
      const isDuplicate = edges.some((e) => e.id === edgeId)
      if (isDuplicate) return

      const newEdge: JoinEdgeType = {
        id: edgeId,
        source,
        target,
        sourceHandle,
        targetHandle,
        type: 'joinEdge',
        data: {
          joinType: 'INNER',
          sourceColumn,
          targetColumn,
          onJoinTypeChange: handleJoinTypeChange,
          onDelete: handleDeleteEdge,
        },
      }

      setEdges((eds) => {
        const updated = addEdge(newEdge, eds) as JoinEdgeType[]
        notifyJoinsChange(updated)
        return updated
      })
    },
    [edges, setEdges, extractColumnFromHandle, notifyJoinsChange, handleJoinTypeChange, handleDeleteEdge]
  )

  return (
    <div className="h-full w-full flex" data-testid="query-builder">
      {/* Left Panel: Table List */}
      <div className="w-48 bg-white border-r border-navy-200 flex flex-col shrink-0">
        <div className="p-3 border-b border-navy-200">
          <h3 className="text-sm font-semibold text-navy-700 mb-2">Tables</h3>
          <div className="relative">
            <svg
              className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-navy-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
            <input
              type="text"
              placeholder="Search..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-sm bg-navy-50 border border-navy-200 rounded focus:outline-none focus:ring-2 focus:ring-navy-600 focus:border-transparent"
              data-testid="table-search-input"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2" data-testid="table-list">
          {filteredTables.length === 0 ? (
            <div className="text-sm text-navy-500 p-3 text-center">
              {tables.length === 0 ? 'No tables available' : 'No matching tables'}
            </div>
          ) : (
            <div className="space-y-1">
              {filteredTables.map((table) => {
                const isOnCanvas = tablesOnCanvas.includes(table)
                return (
                  <div
                    key={table}
                    draggable={!isOnCanvas}
                    onDragStart={(e) => handleDragStart(e, table)}
                    className={`px-3 py-2 text-sm rounded cursor-grab select-none ${
                      isOnCanvas
                        ? 'bg-navy-100 text-navy-400 cursor-not-allowed'
                        : 'bg-navy-50 text-navy-700 hover:bg-navy-100 active:cursor-grabbing'
                    }`}
                    data-testid={`table-item-${table}`}
                    aria-disabled={isOnCanvas}
                  >
                    <div className="flex items-center gap-2">
                      <svg
                        className="w-4 h-4 shrink-0"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
                        />
                      </svg>
                      <span className="truncate">{table}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Right Panel: Canvas Area */}
      <div className="flex-1 flex flex-col">
        {/* Canvas Header */}
        <div className="h-10 bg-white border-b border-navy-200 flex items-center justify-between px-4 shrink-0">
          <h3 className="text-sm font-semibold text-navy-700">Query Builder</h3>
          <div className="flex items-center gap-2">
            {showLimitWarning && (
              <span className="text-xs text-amber-600" data-testid="limit-warning">
                Maximum {MAX_TABLES} tables allowed
              </span>
            )}
            {connectionError && (
              <span className="text-xs text-red-600" data-testid="connection-error">
                {connectionError}
              </span>
            )}
            <span className="text-xs text-navy-500">
              {nodes.length} / {MAX_TABLES} tables
            </span>
            {edges.length > 0 && (
              <span className="text-xs text-navy-500" data-testid="join-count">
                {edges.length} join{edges.length !== 1 ? 's' : ''}
              </span>
            )}
            <button
              onClick={handleClear}
              disabled={nodes.length === 0}
              className="px-2 py-1 text-xs font-medium text-navy-600 hover:bg-navy-100 rounded disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              data-testid="clear-canvas-button"
            >
              Clear
            </button>
          </div>
        </div>

        {/* Canvas */}
        <div
          className="flex-1"
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          data-testid="query-builder-canvas"
        >
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={handleConnect}
            isValidConnection={isValidConnection}
            onInit={(instance) => {
              reactFlowInstance.current = instance
            }}
            connectOnClick
            fitView
            fitViewOptions={{ padding: 0.3, maxZoom: 0.8 }}
            minZoom={0.25}
            maxZoom={2}
            defaultViewport={{ x: 0, y: 0, zoom: 0.7 }}
            proOptions={{ hideAttribution: true }}
          >
            <Controls showZoom showFitView position="bottom-right" />
            <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#d1d5db" />
          </ReactFlow>
        </div>
      </div>
    </div>
  )
}

export default QueryBuilder
