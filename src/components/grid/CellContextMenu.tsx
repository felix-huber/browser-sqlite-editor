/**
 * Cell Context Menu Component
 *
 * Right-click context menu for grid cells with actions:
 * - Copy: Copy cell value to clipboard
 * - Paste: Paste from clipboard into cell
 * - Set NULL: Set cell value to NULL
 * - Save BLOB as file: Download BLOB data
 * - Delete Row: Delete the row containing this cell
 */

import { memo, useMemo } from 'react';
import { ContextMenu, ContextMenuIcons, type ContextMenuItem } from '../common/ContextMenu';
import type { CellValue } from './useDataGrid';
import type { ColumnInfo } from '../../types';

// =============================================================================
// Types
// =============================================================================

export interface CellContextMenuProps {
  /** X position for the menu */
  x: number;
  /** Y position for the menu */
  y: number;
  /** Callback when the menu should close */
  onClose: () => void;
  /** Cell value */
  cellValue: CellValue;
  /** Column information */
  columnInfo: ColumnInfo | null;
  /** Row index */
  rowIndex: number;
  /** Whether the database is read-only */
  isReadOnly: boolean;
  /** Called when copy is clicked */
  onCopy: () => void;
  /** Called when paste is clicked */
  onPaste: () => void;
  /** Called when Set NULL is clicked */
  onSetNull: () => void;
  /** Called when Save BLOB is clicked */
  onSaveBlob: () => void;
  /** Called when Delete Row is clicked */
  onDeleteRow: () => void;
}

// =============================================================================
// Icons
// =============================================================================

const NullIcon = (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
    />
  </svg>
);

const PasteIcon = (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
    />
  </svg>
);

const DownloadIcon = (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
    />
  </svg>
);

// =============================================================================
// Component
// =============================================================================

export const CellContextMenu = memo(function CellContextMenu({
  x,
  y,
  onClose,
  cellValue,
  columnInfo,
  isReadOnly,
  onCopy,
  onPaste,
  onSetNull,
  onSaveBlob,
  onDeleteRow,
}: CellContextMenuProps) {
  // Check if column is generated
  const isGenerated = columnInfo?.generated !== null;

  // Check if column is BLOB type
  const isBlob = columnInfo?.type?.toUpperCase() === 'BLOB';

  // Check if cell has a value (for Set NULL confirmation)
  const hasValue = cellValue !== null;

  // Build menu items
  const items = useMemo((): ContextMenuItem[] => {
    const menuItems: ContextMenuItem[] = [];

    // Copy - always enabled
    menuItems.push({
      id: 'copy',
      label: 'Copy',
      icon: ContextMenuIcons.copy,
      onClick: onCopy,
    });

    // Paste - disabled if read-only or generated
    menuItems.push({
      id: 'paste',
      label: 'Paste',
      icon: PasteIcon,
      disabled: isReadOnly || isGenerated,
      disabledTooltip: isReadOnly
        ? 'Database is read-only'
        : isGenerated
        ? 'Generated columns cannot be edited'
        : undefined,
      onClick: onPaste,
      dividerAfter: true,
    });

    // Set NULL - disabled if read-only or generated
    menuItems.push({
      id: 'set-null',
      label: hasValue ? 'Set NULL' : 'Set NULL',
      icon: NullIcon,
      disabled: isReadOnly || isGenerated,
      disabledTooltip: isReadOnly
        ? 'Database is read-only'
        : isGenerated
        ? 'Generated columns cannot be edited'
        : undefined,
      onClick: onSetNull,
    });

    // Save BLOB as file - only shown for BLOB columns with data
    if (isBlob && cellValue instanceof Uint8Array) {
      menuItems.push({
        id: 'save-blob',
        label: 'Save BLOB as file...',
        icon: DownloadIcon,
        onClick: onSaveBlob,
        dividerAfter: true,
      });
    } else if (!isBlob) {
      // Add divider after Set NULL for non-BLOB columns
      menuItems[menuItems.length - 1] = {
        ...menuItems[menuItems.length - 1],
        dividerAfter: true,
      };
    }

    // Delete Row - disabled if read-only
    menuItems.push({
      id: 'delete-row',
      label: 'Delete Row',
      icon: ContextMenuIcons.delete,
      disabled: isReadOnly,
      disabledTooltip: isReadOnly ? 'Database is read-only' : undefined,
      onClick: onDeleteRow,
    });

    return menuItems;
  }, [
    onCopy,
    onPaste,
    onSetNull,
    onSaveBlob,
    onDeleteRow,
    isReadOnly,
    isGenerated,
    isBlob,
    hasValue,
    cellValue,
  ]);

  return (
    <ContextMenu
      items={items}
      x={x}
      y={y}
      onClose={onClose}
      testIdPrefix="cell-context-menu"
    />
  );
});

// =============================================================================
// Utility functions for context menu actions
// =============================================================================

/**
 * Copy cell value to clipboard
 * For BLOB: copies as base64
 * For other types: copies as string
 */
export async function copyCellValue(value: CellValue): Promise<void> {
  let textToCopy: string;

  if (value === null) {
    textToCopy = '';
  } else if (value instanceof Uint8Array) {
    // Convert BLOB to base64
    const binary = String.fromCharCode(...value);
    textToCopy = btoa(binary);
  } else {
    textToCopy = String(value);
  }

  await navigator.clipboard.writeText(textToCopy);
}

/**
 * Parse pasted value with type coercion
 * Attempts to convert string to appropriate type based on column
 */
export function parsePastedValue(
  text: string,
  columnType: string
): CellValue {
  // Empty string or 'null' => NULL
  if (text === '' || text.toLowerCase() === 'null') {
    return null;
  }

  const upperType = columnType.toUpperCase().split('(')[0].trim();

  // Numeric types - try to parse as number
  if (['INTEGER', 'INT', 'BIGINT', 'SMALLINT', 'TINYINT'].includes(upperType)) {
    const parsed = parseInt(text, 10);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }

  if (['REAL', 'FLOAT', 'DOUBLE', 'NUMERIC', 'DECIMAL'].includes(upperType)) {
    const parsed = parseFloat(text);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }

  // Default: return as string
  return text;
}

/**
 * Generate filename for BLOB download
 * Format: column_name_rowid.bin
 */
export function generateBlobFilename(columnName: string, rowIndex: number): string {
  // Sanitize column name for filename
  const sanitized = columnName.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `${sanitized}_${rowIndex}.bin`;
}

/**
 * Download BLOB data as file
 */
export function downloadBlob(data: Uint8Array, filename: string): void {
  // Create a new ArrayBuffer copy to avoid SharedArrayBuffer issues
  const arrayBuffer = new ArrayBuffer(data.length);
  new Uint8Array(arrayBuffer).set(data);
  const blob = new Blob([arrayBuffer], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();

  // Cleanup
  URL.revokeObjectURL(url);
}

export default CellContextMenu;
