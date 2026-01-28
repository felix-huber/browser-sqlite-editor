import { useCallback, useState, useMemo, type DragEvent } from 'react'
import {
  ReactFlow,
  Controls,
  Background,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

/** Maximum number of tables allowed on canvas */
const MAX_TABLES = 10

/** Node data for a table on the query builder canvas */
export interface TableBoxNodeData extends Record<string, unknown> {
  tableName: string
  columns: string[]
  selectedColumns: string[]
}

export type TableBoxNode = Node<TableBoxNodeData>

interface QueryBuilderProps {
  /** List of available table names from the database schema */
  tables: string[]
  /** Callback when tables on canvas change */
  onTablesChange?: (tableNames: string[]) => void
}

/**
 * Visual query builder component with table list panel and React Flow canvas
 */
export function QueryBuilder({ tables, onTablesChange }: QueryBuilderProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<TableBoxNode>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [showLimitWarning, setShowLimitWarning] = useState(false)

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

  // Handle drag start from table list
  const handleDragStart = useCallback((event: DragEvent<HTMLDivElement>, tableName: string) => {
    event.dataTransfer.setData('application/query-builder-table', tableName)
    event.dataTransfer.effectAllowed = 'copy'
  }, [])

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
      const position = {
        x: event.clientX - reactFlowBounds.left - 100, // Center the node
        y: event.clientY - reactFlowBounds.top - 50,
      }

      const newNode: TableBoxNode = {
        id: `table-${tableName}-${Date.now()}`,
        type: 'default',
        position,
        data: {
          tableName,
          columns: [], // Will be populated when connected to schema
          selectedColumns: [],
        },
      }

      setNodes((nds) => {
        const updated = [...nds, newNode]
        onTablesChange?.(updated.map((n) => n.data.tableName))
        return updated
      })
    },
    [nodes.length, tablesOnCanvas, setNodes, onTablesChange]
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
    onTablesChange?.([])
  }, [setNodes, setEdges, onTablesChange])

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
            <span className="text-xs text-navy-500">
              {nodes.length} / {MAX_TABLES} tables
            </span>
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
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            minZoom={0.5}
            maxZoom={2}
            defaultViewport={{ x: 0, y: 0, zoom: 1 }}
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
