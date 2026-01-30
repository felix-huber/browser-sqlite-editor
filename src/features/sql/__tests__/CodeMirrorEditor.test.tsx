import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CodeMirrorEditor } from '../CodeMirrorEditor'

describe('CodeMirrorEditor', () => {
  // Clean up after each test to prevent async CodeMirror callbacks from firing
  afterEach(() => {
    cleanup()
    // Clear any pending animation frames that CodeMirror might have scheduled
    vi.clearAllTimers()
  })
  it('mounts without errors', () => {
    render(<CodeMirrorEditor value="" />)
    expect(screen.getByTestId('codemirror-editor')).toBeInTheDocument()
  })

  it('initializes with value prop', async () => {
    const initialValue = 'SELECT * FROM users'
    render(<CodeMirrorEditor value={initialValue} />)

    const editor = screen.getByTestId('codemirror-editor')

    await waitFor(() => {
      expect(editor.querySelector('.cm-content')).toHaveTextContent('SELECT')
    })
  })

  it('calls onChange when content is edited', async () => {
    const user = userEvent.setup()
    const handleChange = vi.fn()

    render(<CodeMirrorEditor value="" onChange={handleChange} />)

    const editor = screen.getByTestId('codemirror-editor')
    const contentArea = editor.querySelector('.cm-content')
    expect(contentArea).toBeTruthy()

    // Focus and type
    await user.click(contentArea!)
    await user.keyboard('SELECT')

    await waitFor(() => {
      expect(handleChange).toHaveBeenCalled()
    })
  })

  it('prevents edits in read-only mode', async () => {
    const user = userEvent.setup()
    const handleChange = vi.fn()
    const initialValue = 'SELECT 1'

    render(
      <CodeMirrorEditor
        value={initialValue}
        onChange={handleChange}
        readOnly
      />
    )

    const editor = screen.getByTestId('codemirror-editor')
    const contentArea = editor.querySelector('.cm-content')

    await user.click(contentArea!)
    await user.keyboard('DELETE')

    // onChange should not be called in read-only mode
    expect(handleChange).not.toHaveBeenCalled()

    // Content should still have original value
    expect(contentArea).toHaveTextContent('SELECT')
  })

  it('highlights SQL keywords', async () => {
    render(<CodeMirrorEditor value="SELECT id FROM users WHERE active = 1" />)

    await waitFor(() => {
      const editor = screen.getByTestId('codemirror-editor')
      // Check that the editor rendered some highlighted content
      // Keywords like SELECT, FROM, WHERE should have the keyword highlighting
      const spans = editor.querySelectorAll('span')
      expect(spans.length).toBeGreaterThan(0)
    })
  })

  it('shows line numbers by default', async () => {
    render(<CodeMirrorEditor value="SELECT 1" />)

    await waitFor(() => {
      const editor = screen.getByTestId('codemirror-editor')
      const gutters = editor.querySelector('.cm-gutters')
      expect(gutters).toBeInTheDocument()
    })
  })

  it('hides line numbers when prop is false', async () => {
    render(<CodeMirrorEditor value="SELECT 1" lineNumbers={false} />)

    await waitFor(() => {
      const editor = screen.getByTestId('codemirror-editor')
      // The gutter might still exist for active line gutter,
      // but line number gutter should be absent
      const lineNumbers = editor.querySelector('.cm-lineNumbers')
      expect(lineNumbers).not.toBeInTheDocument()
    })
  })

  it('applies custom className', () => {
    render(<CodeMirrorEditor value="" className="custom-class" />)

    const editor = screen.getByTestId('codemirror-editor')
    expect(editor).toHaveClass('custom-class')
  })

  it('updates content when value prop changes', async () => {
    const { rerender } = render(<CodeMirrorEditor value="SELECT 1" />)

    await waitFor(() => {
      const editor = screen.getByTestId('codemirror-editor')
      expect(editor.querySelector('.cm-content')).toHaveTextContent('SELECT 1')
    })

    rerender(<CodeMirrorEditor value="SELECT 2" />)

    await waitFor(() => {
      const editor = screen.getByTestId('codemirror-editor')
      expect(editor.querySelector('.cm-content')).toHaveTextContent('SELECT 2')
    })
  })
})
