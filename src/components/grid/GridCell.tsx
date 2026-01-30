/**
 * Grid cell renderers and editor.
 */

import { memo, useCallback, useEffect, useRef } from 'react';
import { getColumnTypeCategory, type CellEditState } from './useDataGrid';

// =============================================================================
// Cell Renderer
// =============================================================================

interface CellProps {
  value: unknown;
}

export const CellRenderer = memo(function CellRenderer({ value }: CellProps) {
  // NULL values: italic gray "(null)" - distinguishable from literal string "null"
  if (value === null) {
    return (
      <span
        className="italic"
        style={{ color: '#6b7280' }}
        aria-label="NULL value"
        data-testid="cell-null"
      >
        (null)
      </span>
    );
  }

  // BLOB values: monospace, gray background, "[BLOB, N bytes]" format
  if (value instanceof Uint8Array) {
    const byteCount = value.length;
    return (
      <span
        className="font-mono text-xs px-1 rounded"
        style={{ backgroundColor: '#f3f4f6', color: '#6b7280' }}
        aria-label={`Binary data, ${byteCount} bytes`}
        data-testid="cell-blob"
      >
        [BLOB, {byteCount} bytes]
      </span>
    );
  }

  // Numeric values: monospace tabular nums
  if (typeof value === 'number') {
    return <span className="font-mono tabular-nums">{value}</span>;
  }

  // Text values: rendered as-is via React (auto-escapes HTML entities)
  // This prevents XSS - any HTML/script tags are displayed as literal text
  const stringValue = String(value);

  // Empty string: render empty cell (not NULL)
  if (stringValue === '') {
    return (
      <span
        className="inline-block w-2 h-4"
        aria-hidden="true"
        data-testid="cell-empty"
      ></span>
    );
  }

  // Truncate long values
  if (stringValue.length > 100) {
    return (
      <span title={stringValue}>
        {stringValue.slice(0, 100)}…
      </span>
    );
  }

  return <span>{stringValue}</span>;
});

// =============================================================================
// Tooltip Component
// =============================================================================

interface TooltipProps {
  message: string;
  visible: boolean;
  position: { x: number; y: number };
}

export const Tooltip = memo(function Tooltip({ message, visible, position }: TooltipProps) {
  if (!visible) return null;

  return (
    <div
      className="fixed z-[100] px-2 py-1 text-sm text-white bg-gray-800 rounded shadow-lg pointer-events-none"
      style={{
        left: position.x,
        top: position.y - 30,
        transform: 'translateX(-50%)',
      }}
      data-testid="edit-blocked-tooltip"
    >
      {message}
    </div>
  );
});

// =============================================================================
// Editable Cell Component
// =============================================================================

interface EditableCellProps {
  value: unknown;
  columnType: string;
  editState: CellEditState | null;
  isEditing: boolean;
  onUpdateValue: (value: string) => void;
  onCommit: () => Promise<boolean>;
  onCancel: () => void;
  onMoveToNextCell?: () => void;
}

export const EditableCell = memo(function EditableCell({
  value,
  columnType,
  editState,
  isEditing,
  onUpdateValue,
  onCommit,
  onCancel,
  onMoveToNextCell,
}: EditableCellProps) {
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const typeCategory = getColumnTypeCategory(columnType);
  const isMultiline = typeof value === 'string' && (value.includes('\n') || value.length > 50);

  // Focus input when entering edit mode
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  // Handle keyboard events
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        onCommit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        onCommit().then((success) => {
          if (success && onMoveToNextCell) {
            onMoveToNextCell();
          }
        });
      }
    },
    [onCommit, onCancel, onMoveToNextCell]
  );

  // Handle blur (click outside)
  const handleBlur = useCallback(
    (e: React.FocusEvent) => {
      const relatedTarget = e.relatedTarget as HTMLElement | null;
      const stayingInGrid = relatedTarget?.closest('[data-testid="data-grid"]');
      if (stayingInGrid) {
        onCommit();
        return;
      }

      if (!relatedTarget) {
        setTimeout(() => {
          const active = document.activeElement as HTMLElement | null;
          if (active?.closest('[data-testid="data-grid"]')) {
            onCommit();
          }
        }, 0);
      }
    },
    [onCommit]
  );

  if (!isEditing) {
    return <CellRenderer value={value} />;
  }

  const currentValue = editState?.currentValue ?? '';
  const isDirty = editState?.isDirty ?? false;

  // Use textarea for multiline content
  if (isMultiline) {
    return (
      <div className="edit-input-container absolute inset-0 z-10">
        <textarea
          ref={inputRef as React.RefObject<HTMLTextAreaElement>}
          value={currentValue}
          onChange={(e) => onUpdateValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          className={`w-full h-full px-1 border-2 rounded resize-none ${
            isDirty ? 'bg-yellow-50 border-yellow-400' : 'border-blue-500'
          }`}
          data-testid="edit-textarea"
        />
      </div>
    );
  }

  return (
    <div className="edit-input-container absolute inset-0 z-10">
      <input
        ref={inputRef as React.RefObject<HTMLInputElement>}
        type="text"
        value={currentValue}
        onChange={(e) => onUpdateValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        className={`w-full h-full px-1 border-2 rounded ${
          isDirty ? 'bg-yellow-50 border-yellow-400' : 'border-blue-500'
        }`}
        inputMode={typeCategory === 'numeric' ? 'decimal' : 'text'}
        data-testid="edit-input"
      />
    </div>
  );
});
