import { useRef, useEffect, useCallback } from 'react'
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from '@codemirror/view'
import { EditorState, Extension, Compartment } from '@codemirror/state'
import { sql, SQLite } from '@codemirror/lang-sql'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { syntaxHighlighting, defaultHighlightStyle, HighlightStyle } from '@codemirror/language'
import { tags } from '@lezer/highlight'

/**
 * Custom theme matching app design tokens (navy/amber palette)
 * Colors derived from index.css @theme definitions
 */
const editorTheme = EditorView.theme({
  '&': {
    backgroundColor: '#102a43', // navy-900
    color: '#d9e2ec', // navy-100
    fontSize: '14px',
    fontFamily: "'Inter', monospace",
  },
  '.cm-content': {
    caretColor: '#fbbf24', // amber-400
    padding: '8px 0',
  },
  '.cm-cursor': {
    borderLeftColor: '#fbbf24', // amber-400
    borderLeftWidth: '2px',
  },
  '.cm-selectionBackground': {
    backgroundColor: '#334e68 !important', // navy-700
  },
  '&.cm-focused .cm-selectionBackground': {
    backgroundColor: '#486581 !important', // navy-600
  },
  '.cm-gutters': {
    backgroundColor: '#0a1929', // navy-950
    color: '#627d98', // navy-500
    border: 'none',
    borderRight: '1px solid #334e68', // navy-700
  },
  '.cm-activeLineGutter': {
    backgroundColor: '#243b53', // navy-800
  },
  '.cm-activeLine': {
    backgroundColor: '#243b5340', // navy-800 with alpha
  },
  '.cm-line': {
    padding: '0 8px',
  },
}, { dark: true })

/**
 * Syntax highlighting colors for SQL
 */
const sqlHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: '#fbbf24', fontWeight: 'bold' }, // amber-400 - SELECT, FROM, etc.
  { tag: tags.string, color: '#34d399' }, // green for strings
  { tag: tags.number, color: '#f472b6' }, // pink for numbers
  { tag: tags.comment, color: '#627d98', fontStyle: 'italic' }, // navy-500
  { tag: tags.operator, color: '#f59e0b' }, // amber-500
  { tag: tags.punctuation, color: '#9fb3c8' }, // navy-300
  { tag: tags.name, color: '#d9e2ec' }, // navy-100 - identifiers
  { tag: tags.typeName, color: '#60a5fa' }, // blue for types
  { tag: tags.function(tags.variableName), color: '#a78bfa' }, // purple for functions
  { tag: tags.special(tags.string), color: '#fcd34d' }, // amber-300 for special strings
])

export interface CodeMirrorEditorProps {
  /** Current value of the editor */
  value: string
  /** Callback when content changes */
  onChange?: (value: string) => void
  /** Show line numbers (default: true) */
  lineNumbers?: boolean
  /** Make editor read-only (default: false) */
  readOnly?: boolean
  /** Additional CSS class for the container */
  className?: string
  /** Placeholder text when empty */
  placeholder?: string
}

/**
 * React wrapper for CodeMirror 6 with SQLite syntax highlighting
 */
export function CodeMirrorEditor({
  value,
  onChange,
  lineNumbers: showLineNumbers = true,
  readOnly = false,
  className = '',
  placeholder,
}: CodeMirrorEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const readOnlyCompartment = useRef(new Compartment())

  // Store latest onChange in ref to avoid recreating extensions
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  // Create update listener that calls onChange
  const createUpdateListener = useCallback(() => {
    return EditorView.updateListener.of((update) => {
      if (update.docChanged && onChangeRef.current) {
        onChangeRef.current(update.state.doc.toString())
      }
    })
  }, [])

  // Initialize editor
  useEffect(() => {
    if (!containerRef.current) return

    const extensions: Extension[] = [
      editorTheme,
      syntaxHighlighting(sqlHighlightStyle),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      sql({ dialect: SQLite }),
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      highlightActiveLine(),
      highlightActiveLineGutter(),
      readOnlyCompartment.current.of(EditorState.readOnly.of(readOnly)),
      createUpdateListener(),
    ]

    if (showLineNumbers) {
      extensions.push(lineNumbers())
    }

    if (placeholder) {
      extensions.push(EditorView.contentAttributes.of({ 'aria-placeholder': placeholder }))
    }

    const state = EditorState.create({
      doc: value,
      extensions,
    })

    const view = new EditorView({
      state,
      parent: containerRef.current,
    })

    viewRef.current = view

    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, []) // Only run once on mount

  // Sync value from props to editor (controlled component)
  useEffect(() => {
    const view = viewRef.current
    if (!view) return

    const currentValue = view.state.doc.toString()
    if (currentValue !== value) {
      view.dispatch({
        changes: {
          from: 0,
          to: currentValue.length,
          insert: value,
        },
      })
    }
  }, [value])

  // Update read-only state
  useEffect(() => {
    const view = viewRef.current
    if (!view) return

    view.dispatch({
      effects: readOnlyCompartment.current.reconfigure(
        EditorState.readOnly.of(readOnly)
      ),
    })
  }, [readOnly])

  return (
    <div
      ref={containerRef}
      className={`overflow-hidden rounded-lg border border-navy-700 ${className}`}
      data-testid="codemirror-editor"
    />
  )
}

export default CodeMirrorEditor
