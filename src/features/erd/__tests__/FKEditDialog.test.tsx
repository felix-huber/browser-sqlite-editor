import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { FKEditDialog } from '../FKEditDialog'

describe('FKEditDialog', () => {
  const defaultFkInfo = {
    childTable: 'orders',
    childColumn: 'user_id',
    parentTable: 'users',
    parentColumn: 'id',
    onDelete: 'NO ACTION' as const,
    onUpdate: 'NO ACTION' as const,
  }

  const defaultProps = {
    isOpen: true,
    fkInfo: defaultFkInfo,
    isSaving: false,
    onSave: vi.fn(),
    onClose: vi.fn(),
  }

  it('renders when open', () => {
    render(<FKEditDialog {...defaultProps} />)

    expect(screen.getByTestId('fk-edit-dialog')).toBeInTheDocument()
    expect(screen.getByText('Edit Foreign Key')).toBeInTheDocument()
  })

  it('does not render when closed', () => {
    render(<FKEditDialog {...defaultProps} isOpen={false} />)

    expect(screen.queryByTestId('fk-edit-dialog')).not.toBeInTheDocument()
  })

  it('displays FK reference info correctly (read-only)', () => {
    render(<FKEditDialog {...defaultProps} />)

    expect(screen.getByTestId('fk-edit-child-ref')).toHaveTextContent(
      'orders.user_id'
    )
    expect(screen.getByTestId('fk-edit-parent-ref')).toHaveTextContent(
      'users.id'
    )
  })

  it('shows ON DELETE dropdown with current value', () => {
    const fkInfo = { ...defaultFkInfo, onDelete: 'CASCADE' as const }
    render(<FKEditDialog {...defaultProps} fkInfo={fkInfo} />)

    const select = screen.getByTestId('fk-edit-on-delete-select') as HTMLSelectElement
    expect(select.value).toBe('CASCADE')
  })

  it('shows ON UPDATE dropdown with current value', () => {
    const fkInfo = { ...defaultFkInfo, onUpdate: 'SET NULL' as const }
    render(<FKEditDialog {...defaultProps} fkInfo={fkInfo} />)

    const select = screen.getByTestId('fk-edit-on-update-select') as HTMLSelectElement
    expect(select.value).toBe('SET NULL')
  })

  it('disables Save button when no changes made', () => {
    render(<FKEditDialog {...defaultProps} />)

    expect(screen.getByTestId('fk-edit-save-button')).toBeDisabled()
  })

  it('enables Save button when changes are made', () => {
    render(<FKEditDialog {...defaultProps} />)

    // Change ON DELETE
    fireEvent.change(screen.getByTestId('fk-edit-on-delete-select'), {
      target: { value: 'CASCADE' },
    })

    expect(screen.getByTestId('fk-edit-save-button')).not.toBeDisabled()
  })

  it('calls onSave with new values when Save is clicked', () => {
    const onSave = vi.fn()
    render(<FKEditDialog {...defaultProps} onSave={onSave} />)

    // Change ON DELETE to CASCADE
    fireEvent.change(screen.getByTestId('fk-edit-on-delete-select'), {
      target: { value: 'CASCADE' },
    })

    // Change ON UPDATE to RESTRICT
    fireEvent.change(screen.getByTestId('fk-edit-on-update-select'), {
      target: { value: 'RESTRICT' },
    })

    // Click Save
    fireEvent.click(screen.getByTestId('fk-edit-save-button'))

    expect(onSave).toHaveBeenCalledWith('CASCADE', 'RESTRICT')
  })

  it('calls onClose when Cancel is clicked', () => {
    const onClose = vi.fn()
    render(<FKEditDialog {...defaultProps} onClose={onClose} />)

    fireEvent.click(screen.getByTestId('fk-edit-cancel-button'))

    expect(onClose).toHaveBeenCalled()
  })

  it('calls onClose when overlay is clicked', () => {
    const onClose = vi.fn()
    render(<FKEditDialog {...defaultProps} onClose={onClose} />)

    fireEvent.click(screen.getByTestId('fk-edit-dialog-overlay'))

    expect(onClose).toHaveBeenCalled()
  })

  describe('saving state', () => {
    it('shows saving state with loading spinner', () => {
      render(<FKEditDialog {...defaultProps} isSaving={true} />)

      expect(screen.getByText('Saving...')).toBeInTheDocument()
    })

    it('disables Cancel button when saving', () => {
      render(<FKEditDialog {...defaultProps} isSaving={true} />)

      expect(screen.getByTestId('fk-edit-cancel-button')).toBeDisabled()
    })

    it('disables dropdowns when saving', () => {
      render(<FKEditDialog {...defaultProps} isSaving={true} />)

      expect(screen.getByTestId('fk-edit-on-delete-select')).toBeDisabled()
      expect(screen.getByTestId('fk-edit-on-update-select')).toBeDisabled()
    })

    it('does not close overlay when saving', () => {
      const onClose = vi.fn()
      render(<FKEditDialog {...defaultProps} isSaving={true} onClose={onClose} />)

      fireEvent.click(screen.getByTestId('fk-edit-dialog-overlay'))

      expect(onClose).not.toHaveBeenCalled()
    })
  })

  it('displays note about table rebuild', () => {
    render(<FKEditDialog {...defaultProps} />)

    expect(
      screen.getByText(/Modifying FK actions requires a table rebuild/)
    ).toBeInTheDocument()
  })

  it('has all FK action options in dropdowns', () => {
    render(<FKEditDialog {...defaultProps} />)

    const onDeleteSelect = screen.getByTestId('fk-edit-on-delete-select')
    const options = onDeleteSelect.querySelectorAll('option')
    const optionValues = Array.from(options).map((o) => o.value)

    expect(optionValues).toContain('NO ACTION')
    expect(optionValues).toContain('RESTRICT')
    expect(optionValues).toContain('CASCADE')
    expect(optionValues).toContain('SET NULL')
    expect(optionValues).toContain('SET DEFAULT')
  })

  describe('onDirtyChange callback', () => {
    it('calls onDirtyChange with true when changes are made', () => {
      const onDirtyChange = vi.fn()
      render(<FKEditDialog {...defaultProps} onDirtyChange={onDirtyChange} />)

      fireEvent.change(screen.getByTestId('fk-edit-on-delete-select'), {
        target: { value: 'CASCADE' },
      })

      expect(onDirtyChange).toHaveBeenCalledWith(true)
    })

    it('calls onDirtyChange with false when changes are reverted', () => {
      const onDirtyChange = vi.fn()
      render(<FKEditDialog {...defaultProps} onDirtyChange={onDirtyChange} />)

      // Make a change
      fireEvent.change(screen.getByTestId('fk-edit-on-delete-select'), {
        target: { value: 'CASCADE' },
      })

      onDirtyChange.mockClear()

      // Revert the change
      fireEvent.change(screen.getByTestId('fk-edit-on-delete-select'), {
        target: { value: 'NO ACTION' },
      })

      expect(onDirtyChange).toHaveBeenCalledWith(false)
    })

    it('calls onDirtyChange with false when dialog opens', () => {
      const onDirtyChange = vi.fn()
      render(<FKEditDialog {...defaultProps} onDirtyChange={onDirtyChange} />)

      // Should have been called with false on initial render
      expect(onDirtyChange).toHaveBeenCalledWith(false)
    })
  })
})
