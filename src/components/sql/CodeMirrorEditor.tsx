import { useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react'
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, Decoration, DecorationSet } from '@codemirror/view'
import { EditorState, Extension, Compartment, StateField, StateEffect, RangeSetBuilder } from '@codemirror/state'
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

// =============================================================================
// Error Highlighting
// =============================================================================

/** Location of an error in the editor */
export interface ErrorLocation {
  /** Line number (1-based) */
  line: number;
  /** Column number (1-based, optional) */
  column?: number;
  /** Length of the error highlight (default: rest of line) */
  length?: number;
}

/** Effect to set error locations */
const setErrorLocations = StateEffect.define<ErrorLocation[]>();

/** Effect to clear all error highlights */
const clearErrorLocations = StateEffect.define<void>();

/** Error underline decoration */
const errorUnderlineMark = Decoration.mark({
  class: 'cm-error-underline',
  attributes: { 'data-testid': 'error-highlight' },
});

/** Error line highlight decoration */
const errorLineHighlight = Decoration.line({
  class: 'cm-error-line',
  attributes: { 'data-testid': 'error-line-highlight' },
});

/** State field to track error decorations */
const errorDecorations = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(decorations, tr) {
    // Check for error location effects
    for (const e of tr.effects) {
      if (e.is(setErrorLocations)) {
        const builder = new RangeSetBuilder<Decoration>();
        const lineDecorations: { pos: number; decoration: Decoration }[] = [];

        for (const loc of e.value) {
          // Convert 1-based line to position
          if (loc.line < 1 || loc.line > tr.state.doc.lines) continue;

          const lineInfo = tr.state.doc.line(loc.line);
          const lineStart = lineInfo.from;
          const lineEnd = lineInfo.to;

          // Add line highlight
          lineDecorations.push({ pos: lineStart, decoration: errorLineHighlight });

          // Calculate underline position
          let underlineStart = lineStart;
          let underlineEnd = lineEnd;

          if (loc.column !== undefined && loc.column > 0) {
            // Column is 1-based
            underlineStart = Math.min(lineStart + loc.column - 1, lineEnd);
            if (loc.length !== undefined && loc.length > 0) {
              underlineEnd = Math.min(underlineStart + loc.length, lineEnd);
            }
          }

          // Only add mark if there's content to underline
          if (underlineStart < underlineEnd) {
            builder.add(underlineStart, underlineEnd, errorUnderlineMark);
          }
        }

        // Build the decoration set with both line and range decorations
        let result = builder.finish();
        for (const { pos, decoration } of lineDecorations) {
          result = result.update({ add: [decoration.range(pos)] });
        }

        return result;
      }
      if (e.is(clearErrorLocations)) {
        return Decoration.none;
      }
    }

    // Map decorations through document changes
    if (tr.docChanged) {
      return decorations.map(tr.changes);
    }

    return decorations;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/** Theme extension for error highlighting */
const errorHighlightTheme = EditorView.theme({
  '.cm-error-line': {
    backgroundColor: 'rgba(239, 68, 68, 0.15)', // red-500 with alpha
  },
  '.cm-error-underline': {
    textDecoration: 'underline wavy #ef4444', // red-500
    textUnderlineOffset: '3px',
  },
});

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
  /** Error locations to highlight */
  errorLocations?: ErrorLocation[]
}

/** Handle for imperative editor methods */
export interface CodeMirrorEditorHandle {
  /** Jump to a specific line and column, scrolling it into view */
  jumpToLocation: (line: number, column?: number) => void
  /** Focus the editor */
  focus: () => void
  /** Clear all error highlights */
  clearErrors: () => void
}

/**
 * React wrapper for CodeMirror 6 with SQLite syntax highlighting
 */
export const CodeMirrorEditor = forwardRef<CodeMirrorEditorHandle, CodeMirrorEditorProps>(
  function CodeMirrorEditor({
    value,
    onChange,
    lineNumbers: showLineNumbers = true,
    readOnly = false,
    className = '',
    placeholder,
    errorLocations,
  }, ref) {
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

  // Expose imperative methods via ref
  useImperativeHandle(ref, () => ({
    jumpToLocation: (line: number, column?: number) => {
      const view = viewRef.current
      if (!view) return

      // Validate line number
      if (line < 1 || line > view.state.doc.lines) return

      const lineInfo = view.state.doc.line(line)
      const pos = column !== undefined && column > 0
        ? Math.min(lineInfo.from + column - 1, lineInfo.to)
        : lineInfo.from

      // Set cursor position and scroll into view
      view.dispatch({
        selection: { anchor: pos },
        scrollIntoView: true,
      })
      view.focus()
    },
    focus: () => {
      viewRef.current?.focus()
    },
    clearErrors: () => {
      const view = viewRef.current
      if (!view) return

      view.dispatch({
        effects: clearErrorLocations.of(undefined),
      })
    },
  }), [])

  // Initialize editor
  useEffect(() => {
    if (!containerRef.current) return

    const extensions: Extension[] = [
      editorTheme,
      errorHighlightTheme,
      errorDecorations,
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

  // Sync error locations
  useEffect(() => {
    const view = viewRef.current
    if (!view) return

    if (errorLocations && errorLocations.length > 0) {
      view.dispatch({
        effects: setErrorLocations.of(errorLocations),
      })
    } else {
      view.dispatch({
        effects: clearErrorLocations.of(undefined),
      })
    }
  }, [errorLocations])

  return (
    <div
      ref={containerRef}
      className={`overflow-hidden rounded-lg border border-navy-700 ${className}`}
      data-testid="codemirror-editor"
    />
  )
})

export default CodeMirrorEditor
