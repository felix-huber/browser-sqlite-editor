import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ExportDialog, type ExportDialogProps } from '../ExportDialog'

// Mock dialog methods not available in jsdom
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn()
  HTMLDialogElement.prototype.close = vi.fn()
})

afterEach(() => {
  vi.restoreAllMocks()
})

const defaultProps: ExportDialogProps = {
  isOpen: true,
  onClose: vi.fn(),
  tableName: 'users',
  columns: ['id', 'name', 'email'],
  rows: [
    [1, 'Alice', 'alice@example.com'],
    [2, 'Bob', 'bob@example.com'],
  ],
}

function renderDialog(props: Partial<ExportDialogProps> = {}) {
  return render(<ExportDialog {...defaultProps} {...props} />)
}

describe('ExportDialog', () => {
  describe('format selection', () => {
    it('renders format selector with CSV, JSON, SQL options', () => {
      renderDialog()

      expect(screen.getByTestId('format-csv')).toBeInTheDocument()
      expect(screen.getByTestId('format-json')).toBeInTheDocument()
      expect(screen.getByTestId('format-sql')).toBeInTheDocument()
    })

    it('defaults to CSV format', () => {
      renderDialog()

      const csvButton = screen.getByTestId('format-csv')
      expect(csvButton).toHaveAttribute('aria-checked', 'true')
      expect(screen.getByTestId('csv-options')).toBeInTheDocument()
    })

    it('switches to JSON options when JSON format selected', async () => {
      const user = userEvent.setup()
      renderDialog()

      await user.click(screen.getByTestId('format-json'))

      expect(screen.getByTestId('format-json')).toHaveAttribute('aria-checked', 'true')
      expect(screen.getByTestId('json-options')).toBeInTheDocument()
      expect(screen.queryByTestId('csv-options')).not.toBeInTheDocument()
    })

    it('switches to SQL options when SQL format selected', async () => {
      const user = userEvent.setup()
      renderDialog()

      await user.click(screen.getByTestId('format-sql'))

      expect(screen.getByTestId('format-sql')).toHaveAttribute('aria-checked', 'true')
      expect(screen.getByTestId('sql-options')).toBeInTheDocument()
      expect(screen.queryByTestId('csv-options')).not.toBeInTheDocument()
    })
  })

  describe('CSV options', () => {
    it('renders delimiter selector', () => {
      renderDialog()

      const select = screen.getByTestId('csv-delimiter-select')
      expect(select).toBeInTheDocument()
      expect(select).toHaveValue(',')
    })

    it('changes delimiter option', async () => {
      const user = userEvent.setup()
      renderDialog()

      const select = screen.getByTestId('csv-delimiter-select')
      await user.selectOptions(select, ';')

      expect(select).toHaveValue(';')
    })

    it('renders include headers checkbox (checked by default)', () => {
      renderDialog()

      const checkbox = screen.getByTestId('csv-include-headers')
      expect(checkbox).toBeInTheDocument()
      expect(checkbox).toBeChecked()
    })

    it('toggles include headers option', async () => {
      const user = userEvent.setup()
      renderDialog()

      const checkbox = screen.getByTestId('csv-include-headers')
      await user.click(checkbox)

      expect(checkbox).not.toBeChecked()
    })

    it('renders formula protection checkbox (checked by default)', () => {
      renderDialog()

      const checkbox = screen.getByTestId('csv-formula-protection')
      expect(checkbox).toBeInTheDocument()
      expect(checkbox).toBeChecked()
    })

    it('toggles formula protection option', async () => {
      const user = userEvent.setup()
      renderDialog()

      const checkbox = screen.getByTestId('csv-formula-protection')
      await user.click(checkbox)

      expect(checkbox).not.toBeChecked()
    })

    it('renders line ending selector', () => {
      renderDialog()

      const select = screen.getByTestId('csv-line-ending-select')
      expect(select).toBeInTheDocument()
      expect(select).toHaveValue('lf')
    })

    it('changes line ending option', async () => {
      const user = userEvent.setup()
      renderDialog()

      const select = screen.getByTestId('csv-line-ending-select')
      await user.selectOptions(select, 'crlf')

      expect(select).toHaveValue('crlf')
    })
  })

  describe('JSON options', () => {
    it('renders pretty print checkbox (checked by default)', async () => {
      const user = userEvent.setup()
      renderDialog()

      await user.click(screen.getByTestId('format-json'))

      const checkbox = screen.getByTestId('json-pretty-print')
      expect(checkbox).toBeInTheDocument()
      expect(checkbox).toBeChecked()
    })

    it('toggles pretty print option', async () => {
      const user = userEvent.setup()
      renderDialog()

      await user.click(screen.getByTestId('format-json'))
      const checkbox = screen.getByTestId('json-pretty-print')
      await user.click(checkbox)

      expect(checkbox).not.toBeChecked()
    })

    it('renders structure radio buttons', async () => {
      const user = userEvent.setup()
      renderDialog()

      await user.click(screen.getByTestId('format-json'))

      expect(screen.getByTestId('json-array-of-objects')).toBeInTheDocument()
      expect(screen.getByTestId('json-object-of-arrays')).toBeInTheDocument()
    })

    it('defaults to array of objects structure', async () => {
      const user = userEvent.setup()
      renderDialog()

      await user.click(screen.getByTestId('format-json'))

      expect(screen.getByTestId('json-array-of-objects')).toBeChecked()
      expect(screen.getByTestId('json-object-of-arrays')).not.toBeChecked()
    })

    it('switches to object of arrays structure', async () => {
      const user = userEvent.setup()
      renderDialog()

      await user.click(screen.getByTestId('format-json'))
      await user.click(screen.getByTestId('json-object-of-arrays'))

      expect(screen.getByTestId('json-array-of-objects')).not.toBeChecked()
      expect(screen.getByTestId('json-object-of-arrays')).toBeChecked()
    })
  })

  describe('SQL options', () => {
    it('renders table name input with default value', async () => {
      const user = userEvent.setup()
      renderDialog()

      await user.click(screen.getByTestId('format-sql'))

      const input = screen.getByTestId('sql-table-name-input')
      expect(input).toBeInTheDocument()
      expect(input).toHaveValue('users')
    })

    it('allows changing table name', async () => {
      const user = userEvent.setup()
      renderDialog()

      await user.click(screen.getByTestId('format-sql'))
      const input = screen.getByTestId('sql-table-name-input')
      await user.clear(input)
      await user.type(input, 'new_table')

      expect(input).toHaveValue('new_table')
    })

    it('renders include CREATE TABLE checkbox', async () => {
      const user = userEvent.setup()
      renderDialog({
        tableInfo: {
          name: 'users',
          columns: [
            { name: 'id', type: 'INTEGER', notNull: true, defaultValue: null, primaryKey: 1 },
          ],
        },
      })

      await user.click(screen.getByTestId('format-sql'))

      const checkbox = screen.getByTestId('sql-include-create-table')
      expect(checkbox).toBeInTheDocument()
      expect(checkbox).toBeChecked()
      expect(checkbox).not.toBeDisabled()
    })

    it('disables CREATE TABLE checkbox when tableInfo not provided', async () => {
      const user = userEvent.setup()
      renderDialog({ tableInfo: undefined })

      await user.click(screen.getByTestId('format-sql'))

      const checkbox = screen.getByTestId('sql-include-create-table')
      expect(checkbox).toBeDisabled()
    })
  })

  describe('download trigger', () => {
    let createObjectURLSpy: ReturnType<typeof vi.spyOn>
    let revokeObjectURLSpy: ReturnType<typeof vi.spyOn>
    let originalCreateElement: typeof document.createElement
    const createdLinks: HTMLAnchorElement[] = []

    beforeEach(() => {
      createObjectURLSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test')
      revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})

      // Store original and override createElement to intercept anchor creation
      originalCreateElement = document.createElement.bind(document)
      createdLinks.length = 0

      document.createElement = ((tagName: string) => {
        const el = originalCreateElement(tagName)
        if (tagName === 'a') {
          // Override click to prevent navigation
          el.click = vi.fn()
          createdLinks.push(el as HTMLAnchorElement)
        }
        return el
      }) as typeof document.createElement
    })

    afterEach(() => {
      createObjectURLSpy.mockRestore()
      revokeObjectURLSpy.mockRestore()
      document.createElement = originalCreateElement
    })

    it('triggers download when Download button clicked', async () => {
      const user = userEvent.setup()
      const onClose = vi.fn()
      renderDialog({ onClose })

      await user.click(screen.getByTestId('download-button'))

      expect(createObjectURLSpy).toHaveBeenCalled()
      expect(createdLinks.length).toBeGreaterThan(0)
      expect(createdLinks[0].click).toHaveBeenCalled()
      expect(revokeObjectURLSpy).toHaveBeenCalled()
      expect(onClose).not.toHaveBeenCalled()
    })

    it('uses correct filename for CSV export', async () => {
      const user = userEvent.setup()
      renderDialog({ tableName: 'products' })

      await user.click(screen.getByTestId('download-button'))

      expect(createdLinks[0]?.download).toBe('products.csv')
    })

    it('uses correct filename for JSON export', async () => {
      const user = userEvent.setup()
      renderDialog({ tableName: 'orders' })

      await user.click(screen.getByTestId('format-json'))
      await user.click(screen.getByTestId('download-button'))

      expect(createdLinks[0]?.download).toBe('orders.json')
    })

    it('uses correct filename for SQL export', async () => {
      const user = userEvent.setup()
      renderDialog({ tableName: 'inventory' })

      await user.click(screen.getByTestId('format-sql'))
      await user.click(screen.getByTestId('download-button'))

      expect(createdLinks[0]?.download).toBe('inventory.sql')
    })
  })

  describe('row limit warning', () => {
    it('shows warning when row count exceeds limit', () => {
      // Use custom lower threshold to avoid creating huge arrays
      const manyRows = Array.from({ length: 500 }, (_, i) => [i, `User ${i}`, `user${i}@example.com`])
      renderDialog({ rows: manyRows, rowLimitWarning: 100 })

      expect(screen.getByTestId('row-warning')).toBeInTheDocument()
      expect(screen.getByText(/500 rows/)).toBeInTheDocument()
    })

    it('does not show warning when row count is below limit', () => {
      renderDialog() // default has 2 rows

      expect(screen.queryByTestId('row-warning')).not.toBeInTheDocument()
    })

    it('respects custom row limit warning threshold', () => {
      const rows = Array.from({ length: 50 }, (_, i) => [i, `User ${i}`, `user${i}@example.com`])
      renderDialog({ rows, rowLimitWarning: 25 })

      expect(screen.getByTestId('row-warning')).toBeInTheDocument()
    })
  })

  describe('BLOB warning', () => {
    it('shows BLOB warning when data contains Uint8Array cells in CSV mode', () => {
      const rows = [
        [1, 'Alice', new Uint8Array([0xde, 0xad])],
        [2, 'Bob', new Uint8Array([0xbe, 0xef])],
      ]
      renderDialog({ rows })

      expect(screen.getByTestId('blob-warning')).toBeInTheDocument()
      expect(screen.getByText(/2 BLOB cells/)).toBeInTheDocument()
    })

    it('shows singular "cell" when only one BLOB', () => {
      const rows = [
        [1, 'Alice', new Uint8Array([0x01])],
        [2, 'Bob', 'no blob here'],
      ]
      renderDialog({ rows })

      expect(screen.getByTestId('blob-warning')).toBeInTheDocument()
      expect(screen.getByText(/1 BLOB cell will/)).toBeInTheDocument()
    })

    it('does not show BLOB warning when no BLOBs present', () => {
      renderDialog() // default rows have no BLOBs

      expect(screen.queryByTestId('blob-warning')).not.toBeInTheDocument()
    })

    it('hides BLOB warning when switching to JSON format', async () => {
      const user = userEvent.setup()
      const rows = [[1, new Uint8Array([0x01])]]
      renderDialog({ rows })

      expect(screen.getByTestId('blob-warning')).toBeInTheDocument()

      await user.click(screen.getByTestId('format-json'))

      expect(screen.queryByTestId('blob-warning')).not.toBeInTheDocument()
    })

    it('hides BLOB warning when switching to SQL format', async () => {
      const user = userEvent.setup()
      const rows = [[1, new Uint8Array([0x01])]]
      renderDialog({ rows })

      expect(screen.getByTestId('blob-warning')).toBeInTheDocument()

      await user.click(screen.getByTestId('format-sql'))

      expect(screen.queryByTestId('blob-warning')).not.toBeInTheDocument()
    })

    it('BLOB warning has alert role for accessibility', () => {
      const rows = [[1, new Uint8Array([0x01])]]
      renderDialog({ rows })

      expect(screen.getByTestId('blob-warning')).toHaveAttribute('role', 'alert')
    })
  })

  describe('dialog controls', () => {
    it('calls onClose when Cancel button clicked', async () => {
      const user = userEvent.setup()
      const onClose = vi.fn()
      renderDialog({ onClose })

      await user.click(screen.getByTestId('cancel-button'))

      expect(onClose).toHaveBeenCalled()
    })

    it('calls onClose when close button (X) clicked', async () => {
      const user = userEvent.setup()
      const onClose = vi.fn()
      renderDialog({ onClose })

      await user.click(screen.getByTestId('close-button'))

      expect(onClose).toHaveBeenCalled()
    })

    it('does not render when isOpen is false', () => {
      renderDialog({ isOpen: false })

      expect(screen.queryByTestId('export-dialog')).not.toBeInTheDocument()
    })

    it('renders when isOpen is true', () => {
      renderDialog({ isOpen: true })

      expect(screen.getByTestId('export-dialog')).toBeInTheDocument()
    })
  })

  describe('accessibility', () => {
    it('has proper dialog role and aria-labelledby', () => {
      renderDialog()

      const dialog = screen.getByTestId('export-dialog')
      expect(dialog.tagName).toBe('DIALOG')
      expect(dialog).toHaveAttribute('aria-labelledby', 'export-dialog-title')
    })

    it('has descriptive title', () => {
      renderDialog()

      expect(screen.getByText('Export Data')).toBeInTheDocument()
    })

    it('format buttons have proper role and aria-checked', () => {
      renderDialog()

      const csvButton = screen.getByTestId('format-csv')
      expect(csvButton).toHaveAttribute('role', 'radio')
      expect(csvButton).toHaveAttribute('aria-checked', 'true')

      const jsonButton = screen.getByTestId('format-json')
      expect(jsonButton).toHaveAttribute('role', 'radio')
      expect(jsonButton).toHaveAttribute('aria-checked', 'false')
    })

    it('close button has aria-label', () => {
      renderDialog()

      expect(screen.getByTestId('close-button')).toHaveAttribute('aria-label', 'Close dialog')
    })

    it('row warning has alert role', () => {
      const manyRows = Array.from({ length: 500 }, () => [1, 'Test', 'test@test.com'])
      renderDialog({ rows: manyRows, rowLimitWarning: 100 })

      expect(screen.getByTestId('row-warning')).toHaveAttribute('role', 'alert')
    })
  })
})
