import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { FKDeleteDialog } from '../FKDeleteDialog'

describe('FKDeleteDialog', () => {
  const defaultFkInfo = {
    childTable: 'orders',
    childColumn: 'user_id',
    parentTable: 'users',
    parentColumn: 'id',
  }

  const defaultProps = {
    isOpen: true,
    fkInfo: defaultFkInfo,
    isDeleting: false,
    onConfirm: vi.fn(),
    onClose: vi.fn(),
  }

  // Constraint name format: childTable_childColumn_fk
  const expectedConstraintName = 'orders_user_id_fk'

  it('renders when open', () => {
    render(<FKDeleteDialog {...defaultProps} />)

    expect(screen.getByTestId('fk-delete-dialog')).toBeInTheDocument()
    // Use heading role to distinguish from button text
    expect(screen.getByRole('heading', { name: 'Delete Foreign Key' })).toBeInTheDocument()
  })

  it('does not render when closed', () => {
    render(<FKDeleteDialog {...defaultProps} isOpen={false} />)

    expect(screen.queryByTestId('fk-delete-dialog')).not.toBeInTheDocument()
  })

  it('displays FK reference info correctly', () => {
    render(<FKDeleteDialog {...defaultProps} />)

    expect(screen.getByTestId('fk-delete-child-ref')).toHaveTextContent(
      'orders.user_id'
    )
    expect(screen.getByTestId('fk-delete-parent-ref')).toHaveTextContent(
      'users.id'
    )
  })

  it('displays warning about data integrity', () => {
    render(<FKDeleteDialog {...defaultProps} />)

    expect(
      screen.getByText(/Deleting this foreign key will remove referential integrity/)
    ).toBeInTheDocument()
  })

  it('shows confirmation input with constraint name instruction', () => {
    render(<FKDeleteDialog {...defaultProps} />)

    expect(screen.getByTestId('fk-delete-confirm-input')).toBeInTheDocument()
    expect(screen.getByText(expectedConstraintName)).toBeInTheDocument()
  })

  it('disables Delete button when confirmation text does not match', () => {
    render(<FKDeleteDialog {...defaultProps} />)

    expect(screen.getByTestId('fk-delete-confirm-button')).toBeDisabled()
  })

  it('enables Delete button when confirmation text matches', () => {
    render(<FKDeleteDialog {...defaultProps} />)

    fireEvent.change(screen.getByTestId('fk-delete-confirm-input'), {
      target: { value: expectedConstraintName },
    })

    expect(screen.getByTestId('fk-delete-confirm-button')).not.toBeDisabled()
  })

  it('calls onConfirm when Delete is clicked with correct confirmation', () => {
    const onConfirm = vi.fn()
    render(<FKDeleteDialog {...defaultProps} onConfirm={onConfirm} />)

    // Type confirmation text
    fireEvent.change(screen.getByTestId('fk-delete-confirm-input'), {
      target: { value: expectedConstraintName },
    })

    // Click Delete
    fireEvent.click(screen.getByTestId('fk-delete-confirm-button'))

    expect(onConfirm).toHaveBeenCalled()
  })

  it('does not call onConfirm when confirmation text is wrong', () => {
    const onConfirm = vi.fn()
    render(<FKDeleteDialog {...defaultProps} onConfirm={onConfirm} />)

    // Type wrong confirmation text
    fireEvent.change(screen.getByTestId('fk-delete-confirm-input'), {
      target: { value: 'wrong_text' },
    })

    // Click Delete (should still be disabled)
    fireEvent.click(screen.getByTestId('fk-delete-confirm-button'))

    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('calls onClose when Cancel is clicked', () => {
    const onClose = vi.fn()
    render(<FKDeleteDialog {...defaultProps} onClose={onClose} />)

    fireEvent.click(screen.getByTestId('fk-delete-cancel-button'))

    expect(onClose).toHaveBeenCalled()
  })

  it('calls onClose when overlay is clicked', () => {
    const onClose = vi.fn()
    render(<FKDeleteDialog {...defaultProps} onClose={onClose} />)

    fireEvent.click(screen.getByTestId('fk-delete-dialog-overlay'))

    expect(onClose).toHaveBeenCalled()
  })

  it('calls onConfirm when Enter is pressed with correct confirmation', () => {
    const onConfirm = vi.fn()
    render(<FKDeleteDialog {...defaultProps} onConfirm={onConfirm} />)

    const input = screen.getByTestId('fk-delete-confirm-input')

    // Type confirmation text
    fireEvent.change(input, { target: { value: expectedConstraintName } })

    // Press Enter
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onConfirm).toHaveBeenCalled()
  })

  describe('deleting state', () => {
    it('shows deleting state with loading spinner', () => {
      render(<FKDeleteDialog {...defaultProps} isDeleting={true} />)

      expect(screen.getByText('Deleting...')).toBeInTheDocument()
    })

    it('disables Cancel button when deleting', () => {
      render(<FKDeleteDialog {...defaultProps} isDeleting={true} />)

      expect(screen.getByTestId('fk-delete-cancel-button')).toBeDisabled()
    })

    it('disables confirmation input when deleting', () => {
      render(<FKDeleteDialog {...defaultProps} isDeleting={true} />)

      expect(screen.getByTestId('fk-delete-confirm-input')).toBeDisabled()
    })

    it('does not close overlay when deleting', () => {
      const onClose = vi.fn()
      render(
        <FKDeleteDialog {...defaultProps} isDeleting={true} onClose={onClose} />
      )

      fireEvent.click(screen.getByTestId('fk-delete-dialog-overlay'))

      expect(onClose).not.toHaveBeenCalled()
    })
  })

  it('displays note about table rebuild', () => {
    render(<FKDeleteDialog {...defaultProps} />)

    expect(
      screen.getByText(/This requires a table rebuild/)
    ).toBeInTheDocument()
    expect(screen.getByText('orders')).toBeInTheDocument() // Child table name
  })

  it('resets confirmation text when dialog reopens', () => {
    const { rerender } = render(
      <FKDeleteDialog {...defaultProps} isOpen={true} />
    )

    // Type some text
    fireEvent.change(screen.getByTestId('fk-delete-confirm-input'), {
      target: { value: 'partial' },
    })

    // Close and reopen
    rerender(<FKDeleteDialog {...defaultProps} isOpen={false} />)
    rerender(<FKDeleteDialog {...defaultProps} isOpen={true} />)

    // Check input is empty
    const input = screen.getByTestId('fk-delete-confirm-input') as HTMLInputElement
    expect(input.value).toBe('')
  })

  it('generates correct constraint name for different FK info', () => {
    const customFkInfo = {
      childTable: 'posts',
      childColumn: 'author_id',
      parentTable: 'authors',
      parentColumn: 'id',
    }

    render(<FKDeleteDialog {...defaultProps} fkInfo={customFkInfo} />)

    expect(screen.getByText('posts_author_id_fk')).toBeInTheDocument()
  })
})
