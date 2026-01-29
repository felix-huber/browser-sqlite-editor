import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { FKEdgeContextMenu } from '../FKEdgeContextMenu'

describe('FKEdgeContextMenu', () => {
  const defaultFkInfo = {
    childTable: 'orders',
    childColumn: 'user_id',
    parentTable: 'users',
    parentColumn: 'id',
  }

  const defaultProps = {
    position: { x: 100, y: 200 },
    fkInfo: defaultFkInfo,
    isReadOnly: false,
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    onShowInDesigner: vi.fn(),
    onClose: vi.fn(),
  }

  it('renders context menu at specified position', () => {
    render(<FKEdgeContextMenu {...defaultProps} />)

    const menu = screen.getByTestId('fk-edge-context-menu')
    expect(menu).toBeInTheDocument()
    expect(menu).toHaveStyle({ left: '100px', top: '200px' })
  })

  it('displays FK info in footer', () => {
    render(<FKEdgeContextMenu {...defaultProps} />)

    expect(screen.getByText('orders.user_id')).toBeInTheDocument()
    expect(screen.getByText(/users\.id/)).toBeInTheDocument()
  })

  it('shows Edit Foreign Key option', () => {
    render(<FKEdgeContextMenu {...defaultProps} />)

    expect(screen.getByTestId('fk-context-menu-edit')).toBeInTheDocument()
    expect(screen.getByText('Edit Foreign Key')).toBeInTheDocument()
  })

  it('shows Delete Foreign Key option', () => {
    render(<FKEdgeContextMenu {...defaultProps} />)

    expect(screen.getByTestId('fk-context-menu-delete')).toBeInTheDocument()
    expect(screen.getByText('Delete Foreign Key')).toBeInTheDocument()
  })

  it('shows Show in Table Designer option', () => {
    render(<FKEdgeContextMenu {...defaultProps} />)

    expect(screen.getByTestId('fk-context-menu-show-in-designer')).toBeInTheDocument()
    expect(screen.getByText('Show in Table Designer')).toBeInTheDocument()
  })

  it('calls onEdit when Edit is clicked', () => {
    const onEdit = vi.fn()
    render(<FKEdgeContextMenu {...defaultProps} onEdit={onEdit} />)

    fireEvent.click(screen.getByTestId('fk-context-menu-edit'))

    expect(onEdit).toHaveBeenCalled()
  })

  it('calls onDelete when Delete is clicked', () => {
    const onDelete = vi.fn()
    render(<FKEdgeContextMenu {...defaultProps} onDelete={onDelete} />)

    fireEvent.click(screen.getByTestId('fk-context-menu-delete'))

    expect(onDelete).toHaveBeenCalled()
  })

  it('calls onShowInDesigner and onClose when Show in Designer is clicked', () => {
    const onShowInDesigner = vi.fn()
    const onClose = vi.fn()
    render(
      <FKEdgeContextMenu
        {...defaultProps}
        onShowInDesigner={onShowInDesigner}
        onClose={onClose}
      />
    )

    fireEvent.click(screen.getByTestId('fk-context-menu-show-in-designer'))

    expect(onShowInDesigner).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('calls onClose when backdrop is clicked', () => {
    const onClose = vi.fn()
    render(<FKEdgeContextMenu {...defaultProps} onClose={onClose} />)

    fireEvent.click(screen.getByTestId('fk-context-menu-backdrop'))

    expect(onClose).toHaveBeenCalled()
  })

  describe('read-only mode', () => {
    it('disables Edit option when read-only', () => {
      render(<FKEdgeContextMenu {...defaultProps} isReadOnly={true} />)

      const editButton = screen.getByTestId('fk-context-menu-edit')
      expect(editButton).toBeDisabled()
      expect(editButton).toHaveAttribute('title', 'Database is read-only')
    })

    it('disables Delete option when read-only', () => {
      render(<FKEdgeContextMenu {...defaultProps} isReadOnly={true} />)

      const deleteButton = screen.getByTestId('fk-context-menu-delete')
      expect(deleteButton).toBeDisabled()
      expect(deleteButton).toHaveAttribute('title', 'Database is read-only')
    })

    it('keeps Show in Table Designer enabled when read-only', () => {
      render(<FKEdgeContextMenu {...defaultProps} isReadOnly={true} />)

      const showButton = screen.getByTestId('fk-context-menu-show-in-designer')
      expect(showButton).not.toBeDisabled()
    })

    it('does not call onEdit when Edit is clicked in read-only mode', () => {
      const onEdit = vi.fn()
      render(
        <FKEdgeContextMenu {...defaultProps} isReadOnly={true} onEdit={onEdit} />
      )

      fireEvent.click(screen.getByTestId('fk-context-menu-edit'))

      expect(onEdit).not.toHaveBeenCalled()
    })

    it('does not call onDelete when Delete is clicked in read-only mode', () => {
      const onDelete = vi.fn()
      render(
        <FKEdgeContextMenu {...defaultProps} isReadOnly={true} onDelete={onDelete} />
      )

      fireEvent.click(screen.getByTestId('fk-context-menu-delete'))

      expect(onDelete).not.toHaveBeenCalled()
    })
  })
})
