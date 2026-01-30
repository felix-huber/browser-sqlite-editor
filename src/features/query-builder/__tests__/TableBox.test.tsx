import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { TableBox, type TableBoxData, type TableBoxColumnData } from '../TableBox'

// Wrapper component to provide React Flow context
function TestWrapper({ children }: { children: React.ReactNode }) {
  return <ReactFlowProvider>{children}</ReactFlowProvider>
}

// Helper to create test props
function createNodeProps(
  data: TableBoxData,
  selected = false
): React.ComponentProps<typeof TableBox> {
  return {
    id: 'test-node',
    type: 'tableBox',
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

describe('TableBox', () => {
  it('renders table name and alias', () => {
    const columns: TableBoxColumnData[] = [
      { name: 'id', type: 'INTEGER' },
    ]
    const props = createNodeProps({
      tableName: 'users',
      alias: 't1',
      columns,
      selectedColumns: [],
    })

    render(
      <TestWrapper>
        <TableBox {...props} />
      </TestWrapper>
    )

    expect(screen.getByTestId('table-name')).toHaveTextContent('users')
    expect(screen.getByTestId('table-alias')).toHaveTextContent('(t1)')
  })

  it('renders all columns with checkboxes', () => {
    const columns: TableBoxColumnData[] = [
      { name: 'id', type: 'INTEGER' },
      { name: 'name', type: 'TEXT' },
      { name: 'email', type: 'TEXT' },
    ]
    const props = createNodeProps({
      tableName: 'users',
      alias: 't1',
      columns,
      selectedColumns: [],
    })

    render(
      <TestWrapper>
        <TableBox {...props} />
      </TestWrapper>
    )

    expect(screen.getByTestId('column-name-0')).toHaveTextContent('id')
    expect(screen.getByTestId('column-type-0')).toHaveTextContent('INTEGER')
    expect(screen.getByTestId('column-checkbox-0')).toBeInTheDocument()

    expect(screen.getByTestId('column-name-1')).toHaveTextContent('name')
    expect(screen.getByTestId('column-type-1')).toHaveTextContent('TEXT')
    expect(screen.getByTestId('column-checkbox-1')).toBeInTheDocument()

    expect(screen.getByTestId('column-name-2')).toHaveTextContent('email')
    expect(screen.getByTestId('column-type-2')).toHaveTextContent('TEXT')
    expect(screen.getByTestId('column-checkbox-2')).toBeInTheDocument()
  })

  it('checkbox toggle updates selection state', () => {
    const onSelectionChange = vi.fn()
    const columns: TableBoxColumnData[] = [
      { name: 'id', type: 'INTEGER' },
      { name: 'name', type: 'TEXT' },
    ]
    const props = createNodeProps({
      tableName: 'users',
      alias: 't1',
      columns,
      selectedColumns: ['id'],
      onSelectionChange,
    })

    render(
      <TestWrapper>
        <TableBox {...props} />
      </TestWrapper>
    )

    // Initially, 'id' is selected
    const idCheckbox = screen.getByTestId('column-checkbox-0')
    const nameCheckbox = screen.getByTestId('column-checkbox-1')
    expect(idCheckbox).toBeChecked()
    expect(nameCheckbox).not.toBeChecked()

    // Click name checkbox to select it
    fireEvent.click(nameCheckbox)
    expect(onSelectionChange).toHaveBeenCalledWith('users', ['id', 'name'])

    // Click id checkbox to deselect it
    fireEvent.click(idCheckbox)
    expect(onSelectionChange).toHaveBeenCalledWith('users', [])
  })

  it('generated columns show computed icon', () => {
    const columns: TableBoxColumnData[] = [
      { name: 'id', type: 'INTEGER', isPrimaryKey: true },
      { name: 'full_name', type: 'TEXT', generated: 'stored' },
      { name: 'display', type: 'TEXT', generated: 'virtual' },
    ]
    const props = createNodeProps({
      tableName: 'users',
      alias: 't1',
      columns,
      selectedColumns: [],
    })

    render(
      <TestWrapper>
        <TableBox {...props} />
      </TestWrapper>
    )

    // Generated stored column should have computed icon
    const storedRow = screen.getByTestId('column-row-1')
    const computedIcon = storedRow.querySelector('svg.text-purple-500')
    expect(computedIcon).toBeInTheDocument()

    const storedBadge = screen.getByTestId('generated-badge-1')
    expect(storedBadge).toHaveTextContent('S')
    expect(storedBadge).toHaveAttribute('title', 'This is a generated column (STORED)')

    // Generated virtual column should have VIRTUAL badge
    const virtualBadge = screen.getByTestId('generated-badge-2')
    expect(virtualBadge).toHaveTextContent('V')
    expect(virtualBadge).toHaveAttribute('title', 'This is a generated column (VIRTUAL)')
  })

  it('remove button removes table from canvas', () => {
    const onRemove = vi.fn()
    const columns: TableBoxColumnData[] = [
      { name: 'id', type: 'INTEGER' },
    ]
    const props = createNodeProps({
      tableName: 'users',
      alias: 't1',
      columns,
      selectedColumns: [],
      onRemove,
    })

    render(
      <TestWrapper>
        <TableBox {...props} />
      </TestWrapper>
    )

    const removeButton = screen.getByTestId('remove-table-button')
    fireEvent.click(removeButton)

    expect(onRemove).toHaveBeenCalledWith('users')
  })

  it('handles appear on hover for join creation', () => {
    const columns: TableBoxColumnData[] = [
      { name: 'id', type: 'INTEGER' },
    ]
    const props = createNodeProps({
      tableName: 'users',
      alias: 't1',
      columns,
      selectedColumns: [],
    })

    render(
      <TestWrapper>
        <TableBox {...props} />
      </TestWrapper>
    )

    const node = screen.getByTestId('table-box')

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

  it('PK columns show key icon', () => {
    const columns: TableBoxColumnData[] = [
      { name: 'id', type: 'INTEGER', isPrimaryKey: true },
      { name: 'name', type: 'TEXT' },
    ]
    const props = createNodeProps({
      tableName: 'users',
      alias: 't1',
      columns,
      selectedColumns: [],
    })

    render(
      <TestWrapper>
        <TableBox {...props} />
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

  it('Select All button selects all columns', () => {
    const onSelectionChange = vi.fn()
    const columns: TableBoxColumnData[] = [
      { name: 'id', type: 'INTEGER' },
      { name: 'name', type: 'TEXT' },
      { name: 'email', type: 'TEXT' },
    ]
    const props = createNodeProps({
      tableName: 'users',
      alias: 't1',
      columns,
      selectedColumns: [],
      onSelectionChange,
    })

    render(
      <TestWrapper>
        <TableBox {...props} />
      </TestWrapper>
    )

    const selectAllButton = screen.getByTestId('select-all-button')
    fireEvent.click(selectAllButton)

    expect(onSelectionChange).toHaveBeenCalledWith('users', ['id', 'name', 'email'])
  })

  it('Select None button deselects all columns', () => {
    const onSelectionChange = vi.fn()
    const columns: TableBoxColumnData[] = [
      { name: 'id', type: 'INTEGER' },
      { name: 'name', type: 'TEXT' },
    ]
    const props = createNodeProps({
      tableName: 'users',
      alias: 't1',
      columns,
      selectedColumns: ['id', 'name'],
      onSelectionChange,
    })

    render(
      <TestWrapper>
        <TableBox {...props} />
      </TestWrapper>
    )

    const selectNoneButton = screen.getByTestId('select-none-button')
    fireEvent.click(selectNoneButton)

    expect(onSelectionChange).toHaveBeenCalledWith('users', [])
  })

  it('Select All button is disabled when all columns are selected', () => {
    const columns: TableBoxColumnData[] = [
      { name: 'id', type: 'INTEGER' },
      { name: 'name', type: 'TEXT' },
    ]
    const props = createNodeProps({
      tableName: 'users',
      alias: 't1',
      columns,
      selectedColumns: ['id', 'name'],
    })

    render(
      <TestWrapper>
        <TableBox {...props} />
      </TestWrapper>
    )

    const selectAllButton = screen.getByTestId('select-all-button')
    expect(selectAllButton).toBeDisabled()
  })

  it('Select None button is disabled when no columns are selected', () => {
    const columns: TableBoxColumnData[] = [
      { name: 'id', type: 'INTEGER' },
      { name: 'name', type: 'TEXT' },
    ]
    const props = createNodeProps({
      tableName: 'users',
      alias: 't1',
      columns,
      selectedColumns: [],
    })

    render(
      <TestWrapper>
        <TableBox {...props} />
      </TestWrapper>
    )

    const selectNoneButton = screen.getByTestId('select-none-button')
    expect(selectNoneButton).toBeDisabled()
  })

  it('displays empty state when no columns', () => {
    const props = createNodeProps({
      tableName: 'empty_table',
      alias: 't1',
      columns: [],
      selectedColumns: [],
    })

    render(
      <TestWrapper>
        <TableBox {...props} />
      </TestWrapper>
    )

    const columnList = screen.getByTestId('column-list')
    expect(columnList).toHaveTextContent('No columns')
  })

  it('applies selected styles when selected', () => {
    const columns: TableBoxColumnData[] = [
      { name: 'id', type: 'INTEGER' },
    ]
    const props = createNodeProps(
      {
        tableName: 'users',
        alias: 't1',
        columns,
        selectedColumns: [],
      },
      true
    )

    render(
      <TestWrapper>
        <TableBox {...props} />
      </TestWrapper>
    )

    const node = screen.getByTestId('table-box')
    expect(node).toHaveClass('border-navy-600', 'ring-2', 'ring-navy-200')
  })

  it('handles appear when selected', () => {
    const columns: TableBoxColumnData[] = [
      { name: 'id', type: 'INTEGER' },
    ]
    const props = createNodeProps(
      {
        tableName: 'users',
        alias: 't1',
        columns,
        selectedColumns: [],
      },
      true
    )

    render(
      <TestWrapper>
        <TableBox {...props} />
      </TestWrapper>
    )

    const node = screen.getByTestId('table-box')
    const handles = node.querySelectorAll('.react-flow__handle')

    // Handles should be visible when selected
    handles.forEach((handle) => {
      expect(handle).toHaveClass('!opacity-100')
    })
  })
})
