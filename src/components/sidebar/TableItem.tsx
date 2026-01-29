/**
 * TableItem Component
 *
 * Individual tree item for tables, views, and indexes.
 * Features:
 * - Distinct icons for each type
 * - Active/selected state highlighting
 * - Optional row count badge (for tables)
 * - Keyboard navigation support
 * - Right-click context menu with type-specific actions
 */

import { useCallback } from 'react';
import {
  ContextMenu,
  useContextMenu,
  ContextMenuIcons,
  type ContextMenuItem,
} from '../common/ContextMenu';

/** Context menu action types for schema items */
export type SchemaContextAction =
  | 'view-data'
  | 'design'
  | 'copy-create'
  | 'truncate'
  | 'drop'
  | 'edit-definition';

export type SchemaItemType = 'table' | 'view' | 'index';

export interface TableItemProps {
  /** Item name */
  name: string;
  /** Item type (table, view, or index) */
  type: SchemaItemType;
  /** Whether this item is currently selected */
  isSelected?: boolean;
  /** Whether in read-only mode */
  isReadOnly?: boolean;
  /** Optional row count for tables */
  rowCount?: number;
  /** Optional target table name for indexes */
  targetTable?: string;
  /** Optional search filter for highlighting */
  searchFilter?: string;
  /** Click handler */
  onClick?: () => void;
  /** Context menu action handler */
  onContextAction?: (action: SchemaContextAction, itemType: SchemaItemType, itemName: string) => void;
}

export function TableItem({
  name,
  type,
  isSelected = false,
  isReadOnly = false,
  rowCount,
  targetTable,
  searchFilter,
  onClick,
  onContextAction,
}: TableItemProps) {
  const contextMenu = useContextMenu();

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'Enter':
        case ' ':
          e.preventDefault();
          onClick?.();
          break;
        case 'ArrowDown':
          // Move to next sibling
          e.preventDefault();
          {
            const nextItem = (e.currentTarget as HTMLElement).nextElementSibling;
            if (nextItem instanceof HTMLElement) {
              nextItem.focus();
            }
          }
          break;
        case 'ArrowUp':
          // Move to previous sibling
          e.preventDefault();
          {
            const prevItem = (e.currentTarget as HTMLElement).previousElementSibling;
            if (prevItem instanceof HTMLElement) {
              prevItem.focus();
            }
          }
          break;
      }
    },
    [onClick]
  );

  // Build context menu items based on item type
  const buildContextMenuItems = (): ContextMenuItem[] => {
    const readOnlyTooltip = 'Database is read-only';

    if (type === 'table') {
      return [
        {
          id: 'view-data',
          label: 'View Data',
          icon: ContextMenuIcons.table,
          onClick: () => onContextAction?.('view-data', type, name),
        },
        {
          id: 'design',
          label: 'Design Table',
          icon: ContextMenuIcons.design,
          onClick: () => onContextAction?.('design', type, name),
          dividerAfter: true,
        },
        {
          id: 'copy-create',
          label: 'Copy CREATE Statement',
          icon: ContextMenuIcons.copy,
          onClick: () => onContextAction?.('copy-create', type, name),
          dividerAfter: true,
        },
        {
          id: 'truncate',
          label: 'Truncate Table',
          icon: ContextMenuIcons.truncate,
          disabled: isReadOnly,
          disabledTooltip: readOnlyTooltip,
          onClick: () => onContextAction?.('truncate', type, name),
        },
        {
          id: 'drop',
          label: 'Drop Table',
          icon: ContextMenuIcons.drop,
          disabled: isReadOnly,
          disabledTooltip: readOnlyTooltip,
          onClick: () => onContextAction?.('drop', type, name),
        },
      ];
    }

    if (type === 'view') {
      return [
        {
          id: 'view-data',
          label: 'View Data',
          icon: ContextMenuIcons.view,
          onClick: () => onContextAction?.('view-data', type, name),
        },
        {
          id: 'edit-definition',
          label: 'Edit Definition',
          icon: ContextMenuIcons.code,
          onClick: () => onContextAction?.('edit-definition', type, name),
          dividerAfter: true,
        },
        {
          id: 'copy-create',
          label: 'Copy CREATE Statement',
          icon: ContextMenuIcons.copy,
          onClick: () => onContextAction?.('copy-create', type, name),
          dividerAfter: true,
        },
        {
          id: 'drop',
          label: 'Drop View',
          icon: ContextMenuIcons.drop,
          disabled: isReadOnly,
          disabledTooltip: readOnlyTooltip,
          onClick: () => onContextAction?.('drop', type, name),
        },
      ];
    }

    // Index type
    return [
      {
        id: 'copy-create',
        label: 'Copy CREATE Statement',
        icon: ContextMenuIcons.copy,
        onClick: () => onContextAction?.('copy-create', type, name),
        dividerAfter: true,
      },
      {
        id: 'drop',
        label: 'Drop Index',
        icon: ContextMenuIcons.drop,
        disabled: isReadOnly,
        disabledTooltip: readOnlyTooltip,
        onClick: () => onContextAction?.('drop', type, name),
      },
    ];
  };

  return (
    <>
      <li
        className={`flex items-center gap-2 px-2 py-1 rounded cursor-pointer transition-colors text-sm ${
          isSelected
            ? 'bg-navy-100 text-navy-900'
            : 'hover:bg-navy-50 text-navy-600'
        }`}
        onClick={onClick}
        onKeyDown={handleKeyDown}
        onContextMenu={contextMenu.onContextMenu}
        tabIndex={0}
        role="treeitem"
        aria-selected={isSelected}
        data-testid={`item-${type}-${name}`}
      >
        {/* Type Icon */}
        <ItemIcon type={type} />

        {/* Item Name */}
        <span className="truncate flex-1">
          <HighlightedText text={name} highlight={searchFilter} />
        </span>

        {/* Optional Badge */}
        {type === 'table' && rowCount !== undefined && (
          <span
            className="text-xs text-navy-400 bg-navy-100 px-1.5 py-0.5 rounded"
            data-testid={`row-count-${name}`}
          >
            {formatRowCount(rowCount)}
          </span>
        )}

        {/* Target table for indexes */}
        {type === 'index' && targetTable && (
          <span
            className="text-xs text-navy-400"
            data-testid={`target-table-${name}`}
          >
            → {targetTable}
          </span>
        )}
      </li>

      {/* Context Menu */}
      {contextMenu.isOpen && (
        <ContextMenu
          items={buildContextMenuItems()}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={contextMenu.close}
          testIdPrefix={`${type}-context-menu-${name}`}
        />
      )}
    </>
  );
}

interface ItemIconProps {
  type: SchemaItemType;
}

function ItemIcon({ type }: ItemIconProps) {
  switch (type) {
    case 'table':
      return (
        <span className="text-navy-400" aria-hidden="true">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
            />
          </svg>
        </span>
      );
    case 'view':
      return (
        <span className="text-navy-400" aria-hidden="true">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
            />
          </svg>
        </span>
      );
    case 'index':
      return (
        <span className="text-navy-400" aria-hidden="true">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
        </span>
      );
  }
}

/**
 * Format row count for display
 */
function formatRowCount(count: number): string {
  if (count >= 1000000) {
    return `${(count / 1000000).toFixed(1)}M`;
  }
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}K`;
  }
  return count.toLocaleString();
}

interface HighlightedTextProps {
  text: string;
  highlight?: string;
}

/**
 * Renders text with highlighted search matches
 * Uses amber-200 background for matches
 */
export function HighlightedText({ text, highlight }: HighlightedTextProps) {
  if (!highlight || !highlight.trim()) {
    return <>{text}</>;
  }

  const lowerText = text.toLowerCase();
  const lowerHighlight = highlight.toLowerCase().trim();
  const startIndex = lowerText.indexOf(lowerHighlight);

  if (startIndex === -1) {
    return <>{text}</>;
  }

  const endIndex = startIndex + lowerHighlight.length;
  const before = text.slice(0, startIndex);
  const match = text.slice(startIndex, endIndex);
  const after = text.slice(endIndex);

  return (
    <>
      {before}
      <mark
        className="bg-amber-200 text-inherit rounded-sm px-0.5"
        data-testid="highlight-match"
      >
        {match}
      </mark>
      {after}
    </>
  );
}

export default TableItem;
