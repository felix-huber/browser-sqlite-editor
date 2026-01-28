import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ERDCanvas, type TableNode, type RelationshipEdge } from '../ERDCanvas'

// Mock IntersectionObserver for React Flow
class IntersectionObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

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

describe('ERDCanvas', () => {
  it('renders without errors', () => {
    render(<ERDCanvas />)
    expect(screen.getByTestId('erd-canvas')).toBeInTheDocument()
  })

  it('renders with initial nodes', () => {
    const initialNodes: TableNode[] = [
      {
        id: 'users',
        type: 'default',
        position: { x: 100, y: 100 },
        data: { label: 'users' },
      },
    ]

    render(<ERDCanvas initialNodes={initialNodes} />)
    expect(screen.getByTestId('erd-canvas')).toBeInTheDocument()
  })

  it('renders with initial edges', () => {
    const initialNodes: TableNode[] = [
      {
        id: 'users',
        type: 'default',
        position: { x: 100, y: 100 },
        data: { label: 'users' },
      },
      {
        id: 'posts',
        type: 'default',
        position: { x: 300, y: 100 },
        data: { label: 'posts' },
      },
    ]

    const initialEdges: RelationshipEdge[] = [
      {
        id: 'users-posts',
        source: 'users',
        target: 'posts',
        data: { relationshipType: 'one-to-many' },
      },
    ]

    render(<ERDCanvas initialNodes={initialNodes} initialEdges={initialEdges} />)
    expect(screen.getByTestId('erd-canvas')).toBeInTheDocument()
  })

  it('renders controls (zoom buttons)', () => {
    render(<ERDCanvas />)

    // React Flow Controls component renders zoom in/out and fit view buttons
    const controls = document.querySelector('.react-flow__controls')
    expect(controls).toBeInTheDocument()
  })

  it('renders minimap', () => {
    render(<ERDCanvas />)

    const minimap = document.querySelector('.react-flow__minimap')
    expect(minimap).toBeInTheDocument()
  })

  it('renders background', () => {
    render(<ERDCanvas />)

    const background = document.querySelector('.react-flow__background')
    expect(background).toBeInTheDocument()
  })

  it('has interactive pane that supports pan', () => {
    render(<ERDCanvas />)

    // Verify the pane element exists and is configured for interaction
    const pane = document.querySelector('.react-flow__pane')
    expect(pane).toBeInTheDocument()

    // The viewport element should exist for pan/zoom transformations
    const viewport = document.querySelector('.react-flow__viewport')
    expect(viewport).toBeInTheDocument()
  })

  it('has viewport configured for zoom via scroll wheel', () => {
    render(<ERDCanvas />)

    // Verify viewport exists (React Flow handles zoom internally)
    const viewport = document.querySelector('.react-flow__viewport')
    expect(viewport).toBeInTheDocument()

    // Canvas should be functional
    expect(screen.getByTestId('erd-canvas')).toBeInTheDocument()
  })

  it('renders zoom in button', () => {
    render(<ERDCanvas />)

    const zoomInButton = document.querySelector('.react-flow__controls-zoomin')
    expect(zoomInButton).toBeInTheDocument()
  })

  it('renders zoom out button', () => {
    render(<ERDCanvas />)

    const zoomOutButton = document.querySelector('.react-flow__controls-zoomout')
    expect(zoomOutButton).toBeInTheDocument()
  })

  it('renders fit view button', () => {
    render(<ERDCanvas />)

    const fitViewButton = document.querySelector('.react-flow__controls-fitview')
    expect(fitViewButton).toBeInTheDocument()
  })
})
