import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { JoinEdge, type JoinEdgeProps, type JoinType } from '../JoinEdge'

// Mock IntersectionObserver for React Flow
class IntersectionObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeAll(() => {
  Object.defineProperty(window, 'IntersectionObserver', {
    writable: true,
    value: IntersectionObserverMock,
  })

  // Mock getBoundingClientRect for React Flow viewport calculations
  Element.prototype.getBoundingClientRect = vi.fn(() => ({
    width: 800,
    height: 600,
    top: 0,
    left: 0,
    bottom: 600,
    right: 800,
    x: 0,
    y: 0,
    toJSON: () => {},
  }))
})

afterEach(() => {
  cleanup()
})

// Wrapper component to provide React Flow context
function TestWrapper({ children }: { children: React.ReactNode }) {
  return <ReactFlowProvider>{children}</ReactFlowProvider>
}

// Helper to create test props for JoinEdge
function createEdgeProps(
  overrides: Partial<JoinEdgeProps> = {}
): JoinEdgeProps {
  const defaults: JoinEdgeProps = {
    id: 'test-edge-1',
    source: 'table-users-123',
    target: 'table-orders-456',
    sourceX: 100,
    sourceY: 50,
    targetX: 300,
    targetY: 50,
    sourcePosition: 'right' as const,
    targetPosition: 'left' as const,
    sourceHandleId: 'id-source',
    targetHandleId: 'user_id-target',
    selected: false,
    animated: false,
    data: {
      joinType: 'INNER',
      sourceColumn: 'id',
      targetColumn: 'user_id',
      onJoinTypeChange: vi.fn(),
      onDelete: vi.fn(),
    },
    interactionWidth: 20,
  }

  return { ...defaults, ...overrides }
}

describe('JoinEdge', () => {
  it('renders edge with join type label', () => {
    const props = createEdgeProps()

    render(
      <TestWrapper>
        <svg>
          <JoinEdge {...props} />
        </svg>
      </TestWrapper>
    )

    expect(screen.getByTestId(`join-edge-label-${props.id}`)).toBeInTheDocument()
    expect(screen.getByTestId(`join-type-button-${props.id}`)).toHaveTextContent('INNER JOIN')
  })

  it('renders INNER JOIN with solid blue styling', () => {
    const props = createEdgeProps({
      data: {
        ...createEdgeProps().data!,
        joinType: 'INNER',
      },
    })

    render(
      <TestWrapper>
        <svg>
          <JoinEdge {...props} />
        </svg>
      </TestWrapper>
    )

    const button = screen.getByTestId(`join-type-button-${props.id}`)
    expect(button).toHaveTextContent('INNER JOIN')
    expect(button).toHaveStyle({ borderColor: '#2563eb' })
  })

  it('renders LEFT JOIN with dashed blue styling', () => {
    const props = createEdgeProps({
      data: {
        ...createEdgeProps().data!,
        joinType: 'LEFT',
      },
    })

    render(
      <TestWrapper>
        <svg>
          <JoinEdge {...props} />
        </svg>
      </TestWrapper>
    )

    const button = screen.getByTestId(`join-type-button-${props.id}`)
    expect(button).toHaveTextContent('LEFT JOIN')
  })

  it('renders RIGHT JOIN with dashed green styling', () => {
    const props = createEdgeProps({
      data: {
        ...createEdgeProps().data!,
        joinType: 'RIGHT',
      },
    })

    render(
      <TestWrapper>
        <svg>
          <JoinEdge {...props} />
        </svg>
      </TestWrapper>
    )

    const button = screen.getByTestId(`join-type-button-${props.id}`)
    expect(button).toHaveTextContent('RIGHT JOIN')
  })

  it('renders FULL OUTER JOIN with dotted purple styling', () => {
    const props = createEdgeProps({
      data: {
        ...createEdgeProps().data!,
        joinType: 'FULL',
      },
    })

    render(
      <TestWrapper>
        <svg>
          <JoinEdge {...props} />
        </svg>
      </TestWrapper>
    )

    const button = screen.getByTestId(`join-type-button-${props.id}`)
    expect(button).toHaveTextContent('FULL OUTER')
  })

  it('clicking label opens dropdown menu', async () => {
    const props = createEdgeProps()

    render(
      <TestWrapper>
        <svg>
          <JoinEdge {...props} />
        </svg>
      </TestWrapper>
    )

    const button = screen.getByTestId(`join-type-button-${props.id}`)
    fireEvent.click(button)

    await waitFor(() => {
      expect(screen.getByTestId(`join-type-dropdown-${props.id}`)).toBeInTheDocument()
    })

    // All join type options should be visible
    expect(screen.getByTestId('join-option-INNER')).toBeInTheDocument()
    expect(screen.getByTestId('join-option-LEFT')).toBeInTheDocument()
    expect(screen.getByTestId('join-option-RIGHT')).toBeInTheDocument()
    expect(screen.getByTestId('join-option-FULL')).toBeInTheDocument()
  })

  it('selecting join type calls onJoinTypeChange callback', async () => {
    const onJoinTypeChange = vi.fn()
    const props = createEdgeProps({
      data: {
        ...createEdgeProps().data!,
        onJoinTypeChange,
      },
    })

    render(
      <TestWrapper>
        <svg>
          <JoinEdge {...props} />
        </svg>
      </TestWrapper>
    )

    // Open dropdown
    const button = screen.getByTestId(`join-type-button-${props.id}`)
    fireEvent.click(button)

    await waitFor(() => {
      expect(screen.getByTestId(`join-type-dropdown-${props.id}`)).toBeInTheDocument()
    })

    // Select LEFT JOIN
    const leftOption = screen.getByTestId('join-option-LEFT')
    fireEvent.click(leftOption)

    expect(onJoinTypeChange).toHaveBeenCalledWith(props.id, 'LEFT')
  })

  it('change join type: edge updates correctly', async () => {
    const onJoinTypeChange = vi.fn()
    const props = createEdgeProps({
      data: {
        ...createEdgeProps().data!,
        onJoinTypeChange,
      },
    })

    render(
      <TestWrapper>
        <svg>
          <JoinEdge {...props} />
        </svg>
      </TestWrapper>
    )

    // Open dropdown and select RIGHT JOIN
    fireEvent.click(screen.getByTestId(`join-type-button-${props.id}`))

    await waitFor(() => {
      expect(screen.getByTestId(`join-type-dropdown-${props.id}`)).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('join-option-RIGHT'))

    expect(onJoinTypeChange).toHaveBeenCalledWith(props.id, 'RIGHT')
  })

  it('delete button visible on hover', async () => {
    const onDelete = vi.fn()
    const props = createEdgeProps({
      data: {
        ...createEdgeProps().data!,
        onDelete,
      },
    })

    render(
      <TestWrapper>
        <svg>
          <JoinEdge {...props} />
        </svg>
      </TestWrapper>
    )

    // Delete button should NOT be visible initially
    expect(screen.queryByTestId(`join-delete-button-${props.id}`)).not.toBeInTheDocument()

    // Hover over the label area
    const label = screen.getByTestId(`join-edge-label-${props.id}`)
    fireEvent.mouseEnter(label)

    // Delete button should now be visible
    expect(screen.getByTestId(`join-delete-button-${props.id}`)).toBeInTheDocument()
  })

  it('delete button visible when selected', () => {
    const onDelete = vi.fn()
    const props = createEdgeProps({
      selected: true,
      data: {
        ...createEdgeProps().data!,
        onDelete,
      },
    })

    render(
      <TestWrapper>
        <svg>
          <JoinEdge {...props} />
        </svg>
      </TestWrapper>
    )

    // Delete button should be visible because edge is selected
    expect(screen.getByTestId(`join-delete-button-${props.id}`)).toBeInTheDocument()
  })

  it('clicking delete button calls onDelete callback', async () => {
    const onDelete = vi.fn()
    const props = createEdgeProps({
      selected: true,
      data: {
        ...createEdgeProps().data!,
        onDelete,
      },
    })

    render(
      <TestWrapper>
        <svg>
          <JoinEdge {...props} />
        </svg>
      </TestWrapper>
    )

    const deleteButton = screen.getByTestId(`join-delete-button-${props.id}`)
    fireEvent.click(deleteButton)

    expect(onDelete).toHaveBeenCalledWith(props.id)
  })

  it('dropdown closes after selection', async () => {
    const onJoinTypeChange = vi.fn()
    const props = createEdgeProps({
      data: {
        ...createEdgeProps().data!,
        onJoinTypeChange,
      },
    })

    render(
      <TestWrapper>
        <svg>
          <JoinEdge {...props} />
        </svg>
      </TestWrapper>
    )

    // Open dropdown
    fireEvent.click(screen.getByTestId(`join-type-button-${props.id}`))

    await waitFor(() => {
      expect(screen.getByTestId(`join-type-dropdown-${props.id}`)).toBeInTheDocument()
    })

    // Select an option
    fireEvent.click(screen.getByTestId('join-option-FULL'))

    // Dropdown should close
    expect(screen.queryByTestId(`join-type-dropdown-${props.id}`)).not.toBeInTheDocument()
  })

  it('dropdown closes on outside click', async () => {
    const props = createEdgeProps()

    render(
      <TestWrapper>
        <svg>
          <JoinEdge {...props} />
        </svg>
      </TestWrapper>
    )

    // Open dropdown
    fireEvent.click(screen.getByTestId(`join-type-button-${props.id}`))

    await waitFor(() => {
      expect(screen.getByTestId(`join-type-dropdown-${props.id}`)).toBeInTheDocument()
    })

    // Click outside
    fireEvent.mouseDown(document.body)

    await waitFor(() => {
      expect(screen.queryByTestId(`join-type-dropdown-${props.id}`)).not.toBeInTheDocument()
    })
  })

  it('edge path is rendered', () => {
    const props = createEdgeProps()

    const { container } = render(
      <TestWrapper>
        <svg>
          <JoinEdge {...props} />
        </svg>
      </TestWrapper>
    )

    // The base edge should render a path element
    const path = container.querySelector('path')
    expect(path).toBeInTheDocument()
  })

  it('applies selected styles when selected', () => {
    const props = createEdgeProps({ selected: true })

    render(
      <TestWrapper>
        <svg>
          <JoinEdge {...props} />
        </svg>
      </TestWrapper>
    )

    const button = screen.getByTestId(`join-type-button-${props.id}`)
    // Selected should have ring style
    expect(button.className).toContain('ring-2')
  })

  it('handles missing data gracefully', () => {
    const props = createEdgeProps({
      data: undefined,
    })

    // Should not throw
    render(
      <TestWrapper>
        <svg>
          <JoinEdge {...props} />
        </svg>
      </TestWrapper>
    )

    // Should render with default INNER JOIN
    expect(screen.getByTestId(`join-type-button-${props.id}`)).toHaveTextContent('INNER JOIN')
  })

  it('all join type options have correct labels', async () => {
    const props = createEdgeProps()

    render(
      <TestWrapper>
        <svg>
          <JoinEdge {...props} />
        </svg>
      </TestWrapper>
    )

    // Open dropdown
    fireEvent.click(screen.getByTestId(`join-type-button-${props.id}`))

    await waitFor(() => {
      expect(screen.getByTestId(`join-type-dropdown-${props.id}`)).toBeInTheDocument()
    })

    expect(screen.getByTestId('join-option-INNER')).toHaveTextContent('INNER JOIN')
    expect(screen.getByTestId('join-option-LEFT')).toHaveTextContent('LEFT JOIN')
    expect(screen.getByTestId('join-option-RIGHT')).toHaveTextContent('RIGHT JOIN')
    expect(screen.getByTestId('join-option-FULL')).toHaveTextContent('FULL OUTER')
  })
})
