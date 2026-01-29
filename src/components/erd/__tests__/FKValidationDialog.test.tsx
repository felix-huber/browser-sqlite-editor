import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import {
  FKValidationDialog,
  validateForeignKey,
  type PendingFKInfo,
  type TableInfo,
  type ValidationError,
} from '../FKValidationDialog'

describe('FKValidationDialog', () => {
  const defaultPendingFK: PendingFKInfo = {
    childTable: 'orders',
    childColumn: 'user_id',
    parentTable: 'users',
    parentColumn: 'id',
  }

  const defaultProps = {
    isOpen: true,
    pendingFK: defaultPendingFK,
    errors: [] as ValidationError[],
    isValidating: false,
    isCreating: false,
    onClose: vi.fn(),
    onCreate: vi.fn(),
  }

  it('renders when open with pending FK', () => {
    render(<FKValidationDialog {...defaultProps} />)

    expect(screen.getByTestId('fk-validation-dialog')).toBeInTheDocument()
    expect(screen.getByText('Create Foreign Key?')).toBeInTheDocument()
  })

  it('does not render when closed', () => {
    render(<FKValidationDialog {...defaultProps} isOpen={false} />)

    expect(screen.queryByTestId('fk-validation-dialog')).not.toBeInTheDocument()
  })

  it('displays FK reference info correctly', () => {
    render(<FKValidationDialog {...defaultProps} />)

    expect(screen.getByTestId('fk-child-ref')).toHaveTextContent('orders.user_id')
    expect(screen.getByTestId('fk-parent-ref')).toHaveTextContent('users.id')
  })

  it('shows validation errors', () => {
    const errors: ValidationError[] = [
      {
        type: 'PARENT_NOT_UNIQUE',
        message: 'Parent column must be PRIMARY KEY or UNIQUE',
        isBlocking: true,
      },
      {
        type: 'TYPE_MISMATCH',
        message: 'Type mismatch warning',
        isBlocking: false,
      },
    ]

    render(<FKValidationDialog {...defaultProps} errors={errors} />)

    expect(screen.getByTestId('validation-errors')).toBeInTheDocument()
    expect(screen.getByTestId('validation-error-0')).toHaveAttribute(
      'data-error-type',
      'PARENT_NOT_UNIQUE'
    )
    expect(screen.getByTestId('validation-error-1')).toHaveAttribute(
      'data-error-type',
      'TYPE_MISMATCH'
    )
  })

  it('shows loading state during validation', () => {
    render(<FKValidationDialog {...defaultProps} isValidating={true} />)

    expect(screen.getByTestId('validation-loading')).toBeInTheDocument()
    expect(screen.getByText('Validating foreign key...')).toBeInTheDocument()
  })

  it('shows ON DELETE dropdown with default value', () => {
    render(<FKValidationDialog {...defaultProps} />)

    const select = screen.getByTestId('fk-on-delete-select') as HTMLSelectElement
    expect(select.value).toBe('NO ACTION')
  })

  it('shows ON UPDATE dropdown with default value', () => {
    render(<FKValidationDialog {...defaultProps} />)

    const select = screen.getByTestId('fk-on-update-select') as HTMLSelectElement
    expect(select.value).toBe('NO ACTION')
  })

  it('disables Create button when validation fails with blocking errors', () => {
    const errors: ValidationError[] = [
      {
        type: 'PARENT_NOT_UNIQUE',
        message: 'Parent column must be PRIMARY KEY or UNIQUE',
        isBlocking: true,
      },
    ]

    render(<FKValidationDialog {...defaultProps} errors={errors} />)

    expect(screen.getByTestId('fk-create-button')).toBeDisabled()
  })

  it('enables Create button when only non-blocking errors (warnings)', () => {
    const errors: ValidationError[] = [
      {
        type: 'TYPE_MISMATCH',
        message: 'Type mismatch warning',
        isBlocking: false,
      },
    ]

    render(<FKValidationDialog {...defaultProps} errors={errors} />)

    expect(screen.getByTestId('fk-create-button')).not.toBeDisabled()
  })

  it('calls onCreate with selected actions when Create is clicked', () => {
    const onCreate = vi.fn()
    render(<FKValidationDialog {...defaultProps} onCreate={onCreate} />)

    // Change ON DELETE to CASCADE
    fireEvent.change(screen.getByTestId('fk-on-delete-select'), {
      target: { value: 'CASCADE' },
    })

    // Click Create
    fireEvent.click(screen.getByTestId('fk-create-button'))

    expect(onCreate).toHaveBeenCalledWith('CASCADE', 'NO ACTION')
  })

  it('calls onClose when Cancel is clicked', () => {
    const onClose = vi.fn()
    render(<FKValidationDialog {...defaultProps} onClose={onClose} />)

    fireEvent.click(screen.getByTestId('fk-cancel-button'))

    expect(onClose).toHaveBeenCalled()
  })

  it('calls onClose when overlay is clicked', () => {
    const onClose = vi.fn()
    render(<FKValidationDialog {...defaultProps} onClose={onClose} />)

    fireEvent.click(screen.getByTestId('fk-validation-dialog-overlay'))

    expect(onClose).toHaveBeenCalled()
  })

  it('shows creating state with loading spinner', () => {
    render(<FKValidationDialog {...defaultProps} isCreating={true} />)

    expect(screen.getByText('Creating...')).toBeInTheDocument()
  })

  it('disables Cancel button when creating', () => {
    render(<FKValidationDialog {...defaultProps} isCreating={true} />)

    expect(screen.getByTestId('fk-cancel-button')).toBeDisabled()
  })

  it('disables dropdowns when creating', () => {
    render(<FKValidationDialog {...defaultProps} isCreating={true} />)

    expect(screen.getByTestId('fk-on-delete-select')).toBeDisabled()
    expect(screen.getByTestId('fk-on-update-select')).toBeDisabled()
  })
})

describe('validateForeignKey', () => {
  const makeTableInfo = (
    name: string,
    columns: Array<{
      name: string
      type: string
      isPrimaryKey?: boolean
      isUnique?: boolean
    }>
  ): TableInfo => ({
    name,
    columns: columns.map((c) => ({
      ...c,
      isPrimaryKey: c.isPrimaryKey || false,
      isUnique: c.isUnique || c.isPrimaryKey || false,
      isNotNull: false,
    })),
  })

  it('returns PARENT_NOT_UNIQUE error when parent column is not PK or UNIQUE', () => {
    const pendingFK: PendingFKInfo = {
      childTable: 'orders',
      childColumn: 'user_id',
      parentTable: 'users',
      parentColumn: 'email',
    }

    const childTable = makeTableInfo('orders', [
      { name: 'id', type: 'INTEGER', isPrimaryKey: true },
      { name: 'user_id', type: 'INTEGER' },
    ])

    const parentTable = makeTableInfo('users', [
      { name: 'id', type: 'INTEGER', isPrimaryKey: true },
      { name: 'email', type: 'TEXT' }, // Not PK or UNIQUE
    ])

    const errors = validateForeignKey(pendingFK, childTable, parentTable, [])

    expect(errors).toContainEqual(
      expect.objectContaining({
        type: 'PARENT_NOT_UNIQUE',
        isBlocking: true,
      })
    )
  })

  it('passes validation when parent column is PRIMARY KEY', () => {
    const pendingFK: PendingFKInfo = {
      childTable: 'orders',
      childColumn: 'user_id',
      parentTable: 'users',
      parentColumn: 'id',
    }

    const childTable = makeTableInfo('orders', [
      { name: 'id', type: 'INTEGER', isPrimaryKey: true },
      { name: 'user_id', type: 'INTEGER' },
    ])

    const parentTable = makeTableInfo('users', [
      { name: 'id', type: 'INTEGER', isPrimaryKey: true },
    ])

    const errors = validateForeignKey(pendingFK, childTable, parentTable, [])

    const blockingErrors = errors.filter((e) => e.isBlocking)
    expect(blockingErrors).toHaveLength(0)
  })

  it('passes validation when parent column is UNIQUE', () => {
    const pendingFK: PendingFKInfo = {
      childTable: 'profiles',
      childColumn: 'username',
      parentTable: 'users',
      parentColumn: 'username',
    }

    const childTable = makeTableInfo('profiles', [
      { name: 'id', type: 'INTEGER', isPrimaryKey: true },
      { name: 'username', type: 'TEXT' },
    ])

    const parentTable = makeTableInfo('users', [
      { name: 'id', type: 'INTEGER', isPrimaryKey: true },
      { name: 'username', type: 'TEXT', isUnique: true },
    ])

    const errors = validateForeignKey(pendingFK, childTable, parentTable, [])

    const blockingErrors = errors.filter((e) => e.isBlocking)
    expect(blockingErrors).toHaveLength(0)
  })

  it('returns TYPE_MISMATCH warning (non-blocking) when types differ', () => {
    const pendingFK: PendingFKInfo = {
      childTable: 'orders',
      childColumn: 'user_id',
      parentTable: 'users',
      parentColumn: 'id',
    }

    const childTable = makeTableInfo('orders', [
      { name: 'id', type: 'INTEGER', isPrimaryKey: true },
      { name: 'user_id', type: 'TEXT' }, // TEXT vs INTEGER
    ])

    const parentTable = makeTableInfo('users', [
      { name: 'id', type: 'INTEGER', isPrimaryKey: true },
    ])

    const errors = validateForeignKey(pendingFK, childTable, parentTable, [])

    expect(errors).toContainEqual(
      expect.objectContaining({
        type: 'TYPE_MISMATCH',
        isBlocking: false,
      })
    )
  })

  it('returns DUPLICATE_FK error when FK already exists', () => {
    const pendingFK: PendingFKInfo = {
      childTable: 'orders',
      childColumn: 'user_id',
      parentTable: 'users',
      parentColumn: 'id',
    }

    const childTable = makeTableInfo('orders', [
      { name: 'id', type: 'INTEGER', isPrimaryKey: true },
      { name: 'user_id', type: 'INTEGER' },
    ])

    const parentTable = makeTableInfo('users', [
      { name: 'id', type: 'INTEGER', isPrimaryKey: true },
    ])

    const existingFKs = [
      { childColumn: 'user_id', parentTable: 'users', parentColumn: 'id' },
    ]

    const errors = validateForeignKey(pendingFK, childTable, parentTable, existingFKs)

    expect(errors).toContainEqual(
      expect.objectContaining({
        type: 'DUPLICATE_FK',
        isBlocking: true,
      })
    )
  })

  it('allows self-reference with different columns', () => {
    const pendingFK: PendingFKInfo = {
      childTable: 'employees',
      childColumn: 'manager_id',
      parentTable: 'employees',
      parentColumn: 'id',
    }

    const employeesTable = makeTableInfo('employees', [
      { name: 'id', type: 'INTEGER', isPrimaryKey: true },
      { name: 'manager_id', type: 'INTEGER' },
    ])

    const errors = validateForeignKey(
      pendingFK,
      employeesTable,
      employeesTable,
      []
    )

    const blockingErrors = errors.filter((e) => e.isBlocking)
    expect(blockingErrors).toHaveLength(0)
  })

  it('returns SELF_REFERENCE_SAME_COLUMN error for same table and column', () => {
    const pendingFK: PendingFKInfo = {
      childTable: 'nodes',
      childColumn: 'id',
      parentTable: 'nodes',
      parentColumn: 'id',
    }

    const nodesTable = makeTableInfo('nodes', [
      { name: 'id', type: 'INTEGER', isPrimaryKey: true },
    ])

    const errors = validateForeignKey(pendingFK, nodesTable, nodesTable, [])

    expect(errors).toContainEqual(
      expect.objectContaining({
        type: 'SELF_REFERENCE_SAME_COLUMN',
        isBlocking: true,
      })
    )
  })

  it('case-insensitive duplicate FK check', () => {
    const pendingFK: PendingFKInfo = {
      childTable: 'orders',
      childColumn: 'USER_ID',
      parentTable: 'USERS',
      parentColumn: 'ID',
    }

    const childTable = makeTableInfo('orders', [
      { name: 'id', type: 'INTEGER', isPrimaryKey: true },
      { name: 'USER_ID', type: 'INTEGER' },
    ])

    const parentTable = makeTableInfo('USERS', [
      { name: 'ID', type: 'INTEGER', isPrimaryKey: true },
    ])

    const existingFKs = [
      { childColumn: 'user_id', parentTable: 'users', parentColumn: 'id' },
    ]

    const errors = validateForeignKey(pendingFK, childTable, parentTable, existingFKs)

    expect(errors).toContainEqual(
      expect.objectContaining({
        type: 'DUPLICATE_FK',
        isBlocking: true,
      })
    )
  })
})
