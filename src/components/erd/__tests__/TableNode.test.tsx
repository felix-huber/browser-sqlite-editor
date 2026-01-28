import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { TableNode, type TableNodeData, type TableColumnData } from '../TableNode'

// Wrapper component to provide React Flow context
function TestWrapper({ children }: { children: React.ReactNode }) {
  return <ReactFlowProvider>{children}</ReactFlowProvider>
}

// Helper to create test props
function createNodeProps(
  data: TableNodeData,
  selected = false
): React.ComponentProps<typeof TableNode> {
  return {
    id: 'test-node',
    type: 'tableNode',
    data,
    selected,
    isConnectable: true,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
    zIndex: 1,
    dragging: false,
    draggable: true,
    deletable: true,
    selectable: true,
    parentId: undefined,
    sourcePosition: undefined,
    targetPosition: undefined,
    width: 200,
    height: 100,
    dragHandle: undefined,
  }
}

describe('TableNode', () => {
  it('renders table name in header', () => {
    const props = createNodeProps({ label: 'users' })

    render(
      <TestWrapper>
        <TableNode {...props} />
      </TestWrapper>
    )

    expect(screen.getByTestId('table-name')).toHaveTextContent('users')
  })

  it('renders all columns', () => {
    const columns: TableColumnData[] = [
      { name: 'id', type: 'INTEGER' },
      { name: 'name', type: 'TEXT' },
      { name: 'email', type: 'TEXT' },
    ]
    const props = createNodeProps({ label: 'users', columns })

    render(
      <TestWrapper>
        <TableNode {...props} />
      </TestWrapper>
    )

    expect(screen.getByTestId('column-name-0')).toHaveTextContent('id')
    expect(screen.getByTestId('column-type-0')).toHaveTextContent('INTEGER')
    expect(screen.getByTestId('column-name-1')).toHaveTextContent('name')
    expect(screen.getByTestId('column-type-1')).toHaveTextContent('TEXT')
    expect(screen.getByTestId('column-name-2')).toHaveTextContent('email')
    expect(screen.getByTestId('column-type-2')).toHaveTextContent('TEXT')
  })

  it('PK columns show key icon', () => {
    const columns: TableColumnData[] = [
      { name: 'id', type: 'INTEGER', isPrimaryKey: true },
      { name: 'name', type: 'TEXT' },
    ]
    const props = createNodeProps({ label: 'users', columns })

    render(
      <TestWrapper>
        <TableNode {...props} />
      </TestWrapper>
    )

    // PK column row should contain the key icon (amber colored SVG)
    const pkRow = screen.getByTestId('column-row-0')
    const keyIcon = pkRow.querySelector('svg.text-amber-500')
    expect(keyIcon).toBeInTheDocument()

    // Non-PK column should not have key icon
    const normalRow = screen.getByTestId('column-row-1')
    const noKeyIcon = normalRow.querySelector('svg.text-amber-500')
    expect(noKeyIcon).not.toBeInTheDocument()
  })

  it('FK columns show link icon', () => {
    const columns: TableColumnData[] = [
      { name: 'id', type: 'INTEGER', isPrimaryKey: true },
      { name: 'user_id', type: 'INTEGER', isForeignKey: true },
    ]
    const props = createNodeProps({ label: 'posts', columns })

    render(
      <TestWrapper>
        <TableNode {...props} />
      </TestWrapper>
    )

    // FK column row should contain the link icon
    const fkRow = screen.getByTestId('column-row-1')
    const linkIcon = fkRow.querySelector('svg.text-navy-500')
    expect(linkIcon).toBeInTheDocument()

    // PK column should show key icon, not link icon
    const pkRow = screen.getByTestId('column-row-0')
    const keyIcon = pkRow.querySelector('svg.text-amber-500')
    expect(keyIcon).toBeInTheDocument()
  })

  it('generated columns show computed icon with type badge', () => {
    const columns: TableColumnData[] = [
      { name: 'id', type: 'INTEGER', isPrimaryKey: true },
      { name: 'full_name', type: 'TEXT', generated: 'stored' },
      { name: 'display', type: 'TEXT', generated: 'virtual' },
    ]
    const props = createNodeProps({ label: 'users', columns })

    render(
      <TestWrapper>
        <TableNode {...props} />
      </TestWrapper>
    )

    // Generated stored column should have computed icon and STORED badge
    const storedRow = screen.getByTestId('column-row-1')
    const computedIcon = storedRow.querySelector('svg.text-purple-500')
    expect(computedIcon).toBeInTheDocument()

    const storedBadge = screen.getByTestId('generated-badge-1')
    expect(storedBadge).toHaveTextContent('stored')
    expect(storedBadge).toHaveClass('bg-purple-100', 'text-purple-700')

    // Generated virtual column should have VIRTUAL badge
    const virtualBadge = screen.getByTestId('generated-badge-2')
    expect(virtualBadge).toHaveTextContent('virtual')
    expect(virtualBadge).toHaveClass('bg-violet-100', 'text-violet-700')
  })

  it('handles appear on hover', () => {
    const columns: TableColumnData[] = [
      { name: 'id', type: 'INTEGER' },
    ]
    const props = createNodeProps({ label: 'users', columns })

    render(
      <TestWrapper>
        <TableNode {...props} />
      </TestWrapper>
    )

    const node = screen.getByTestId('table-node')

    // Handles should be hidden initially (opacity-0)
    const handles = node.querySelectorAll('.react-flow__handle')
    handles.forEach((handle) => {
      expect(handle).toHaveClass('!opacity-0')
    })

    // Hover over the node
    fireEvent.mouseEnter(node)

    // Handles should now be visible (opacity-100)
    handles.forEach((handle) => {
      expect(handle).toHaveClass('!opacity-100')
    })

    // Mouse leave
    fireEvent.mouseLeave(node)

    // Handles should be hidden again
    handles.forEach((handle) => {
      expect(handle).toHaveClass('!opacity-0')
    })
  })

  it('handles appear when selected', () => {
    const columns: TableColumnData[] = [
      { name: 'id', type: 'INTEGER' },
    ]
    const props = createNodeProps({ label: 'users', columns }, true)

    render(
      <TestWrapper>
        <TableNode {...props} />
      </TestWrapper>
    )

    const node = screen.getByTestId('table-node')
    const handles = node.querySelectorAll('.react-flow__handle')

    // Handles should be visible when selected
    handles.forEach((handle) => {
      expect(handle).toHaveClass('!opacity-100')
    })
  })

  it('shows view icon for views', () => {
    const props = createNodeProps({ label: 'user_summary', isView: true })

    render(
      <TestWrapper>
        <TableNode {...props} />
      </TestWrapper>
    )

    const header = screen.getByTestId('table-node-header')
    // View header has different background color
    expect(header).toHaveClass('bg-navy-100')
  })

  it('shows table icon for tables', () => {
    const props = createNodeProps({ label: 'users', isView: false })

    render(
      <TestWrapper>
        <TableNode {...props} />
      </TestWrapper>
    )

    const header = screen.getByTestId('table-node-header')
    // Table header has navy-600 background
    expect(header).toHaveClass('bg-navy-600')
  })

  it('displays empty state when no columns', () => {
    const props = createNodeProps({ label: 'empty_table', columns: [] })

    render(
      <TestWrapper>
        <TableNode {...props} />
      </TestWrapper>
    )

    const columnList = screen.getByTestId('column-list')
    expect(columnList).toHaveTextContent('No columns')
  })

  it('applies selected styles when selected', () => {
    const props = createNodeProps({ label: 'users' }, true)

    render(
      <TestWrapper>
        <TableNode {...props} />
      </TestWrapper>
    )

    const node = screen.getByTestId('table-node')
    expect(node).toHaveClass('border-navy-600', 'ring-2', 'ring-navy-200')
  })
})
