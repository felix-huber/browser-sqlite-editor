/**
 * Context Menu Component
 *
 * A flexible context menu that appears on right-click.
 * Features:
 * - Position at click location
 * - Keyboard navigation
 * - Dividers between action groups
 * - Disabled items with tooltips
 * - Icon support
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';

export interface ContextMenuItem {
  /** Unique identifier for the item */
  id: string;
  /** Display label */
  label: string;
  /** Optional icon element */
  icon?: React.ReactNode;
  /** Whether the item is disabled */
  disabled?: boolean;
  /** Tooltip text when disabled */
  disabledTooltip?: string;
  /** Click handler */
  onClick?: () => void;
  /** Whether to show a divider after this item */
  dividerAfter?: boolean;
}

export interface ContextMenuProps {
  /** Items to display in the menu */
  items: ContextMenuItem[];
  /** X position of the menu */
  x: number;
  /** Y position of the menu */
  y: number;
  /** Callback when the menu should close */
  onClose: () => void;
  /** Test ID prefix */
  testIdPrefix?: string;
}

/**
 * ContextMenu component - renders at specified position with items
 */
export function ContextMenu({
  items,
  x,
  y,
  onClose,
  testIdPrefix = 'context-menu',
}: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);
  const [position, setPosition] = useState({ x, y });
  const [hoveredDisabledId, setHoveredDisabledId] = useState<string | null>(null);

  // Adjust position if menu would overflow viewport
  useEffect(() => {
    if (!menuRef.current) return;

    const rect = menuRef.current.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let adjustedX = x;
    let adjustedY = y;

    // Check right edge
    if (x + rect.width > viewportWidth) {
      adjustedX = viewportWidth - rect.width - 8;
    }

    // Check bottom edge
    if (y + rect.height > viewportHeight) {
      adjustedY = viewportHeight - rect.height - 8;
    }

    // Ensure minimum position
    adjustedX = Math.max(8, adjustedX);
    adjustedY = Math.max(8, adjustedY);

    if (adjustedX !== x || adjustedY !== y) {
      setPosition({ x: adjustedX, y: adjustedY });
    }
  }, [x, y]);

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    // Use capture to ensure we catch events before they bubble
    document.addEventListener('mousedown', handleClickOutside, true);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside, true);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  // Focus the menu on mount
  useEffect(() => {
    menuRef.current?.focus();
  }, []);

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const enabledItems = items
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => !item.disabled);

      if (enabledItems.length === 0) return;

      switch (e.key) {
        case 'ArrowDown': {
          e.preventDefault();
          const currentEnabledIndex = enabledItems.findIndex(
            ({ index }) => index === focusedIndex
          );
          const nextEnabledIndex =
            currentEnabledIndex === -1 || currentEnabledIndex === enabledItems.length - 1
              ? 0
              : currentEnabledIndex + 1;
          setFocusedIndex(enabledItems[nextEnabledIndex].index);
          break;
        }
        case 'ArrowUp': {
          e.preventDefault();
          const currentEnabledIndex = enabledItems.findIndex(
            ({ index }) => index === focusedIndex
          );
          const prevEnabledIndex =
            currentEnabledIndex === -1 || currentEnabledIndex === 0
              ? enabledItems.length - 1
              : currentEnabledIndex - 1;
          setFocusedIndex(enabledItems[prevEnabledIndex].index);
          break;
        }
        case 'Enter':
        case ' ': {
          e.preventDefault();
          const focusedItem = items[focusedIndex];
          if (focusedItem && !focusedItem.disabled && focusedItem.onClick) {
            focusedItem.onClick();
            onClose();
          }
          break;
        }
        case 'Home': {
          e.preventDefault();
          if (enabledItems.length > 0) {
            setFocusedIndex(enabledItems[0].index);
          }
          break;
        }
        case 'End': {
          e.preventDefault();
          if (enabledItems.length > 0) {
            setFocusedIndex(enabledItems[enabledItems.length - 1].index);
          }
          break;
        }
      }
    },
    [items, focusedIndex, onClose]
  );

  const handleItemClick = useCallback(
    (item: ContextMenuItem) => {
      if (item.disabled) return;
      item.onClick?.();
      onClose();
    },
    [onClose]
  );

  const menu = (
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[160px] bg-white border border-navy-200 rounded-lg shadow-lg py-1 outline-none"
      style={{ left: position.x, top: position.y }}
      role="menu"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      data-testid={testIdPrefix}
    >
      {items.map((item, index) => (
        <div key={item.id}>
          <div
            className={`relative flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer transition-colors ${
              item.disabled
                ? 'text-navy-300 cursor-not-allowed'
                : focusedIndex === index
                ? 'bg-navy-100 text-navy-900'
                : 'text-navy-700 hover:bg-navy-50'
            }`}
            role="menuitem"
            aria-disabled={item.disabled}
            tabIndex={-1}
            onClick={() => handleItemClick(item)}
            onMouseEnter={() => {
              if (!item.disabled) {
                setFocusedIndex(index);
              }
              if (item.disabled && item.disabledTooltip) {
                setHoveredDisabledId(item.id);
              }
            }}
            onMouseLeave={() => {
              setHoveredDisabledId(null);
            }}
            data-testid={`${testIdPrefix}-item-${item.id}`}
          >
            {item.icon && (
              <span className="w-4 h-4 flex items-center justify-center shrink-0">
                {item.icon}
              </span>
            )}
            <span className="flex-1">{item.label}</span>

            {/* Disabled tooltip */}
            {item.disabled && item.disabledTooltip && hoveredDisabledId === item.id && (
              <div
                className="absolute left-full ml-2 px-2 py-1 text-xs bg-navy-800 text-white rounded whitespace-nowrap z-10"
                role="tooltip"
                data-testid={`${testIdPrefix}-tooltip-${item.id}`}
              >
                {item.disabledTooltip}
              </div>
            )}
          </div>
          {item.dividerAfter && (
            <div
              className="my-1 border-t border-navy-200"
              role="separator"
              aria-orientation="horizontal"
              data-testid={`${testIdPrefix}-divider-${item.id}`}
            />
          )}
        </div>
      ))}
    </div>
  );

  return createPortal(menu, document.body);
}

// =============================================================================
// Hook for managing context menu state
// =============================================================================

export interface UseContextMenuResult {
  /** Whether the menu is open */
  isOpen: boolean;
  /** X position for the menu */
  x: number;
  /** Y position for the menu */
  y: number;
  /** Open the menu at a position */
  open: (x: number, y: number) => void;
  /** Close the menu */
  close: () => void;
  /** Handler for onContextMenu events */
  onContextMenu: (e: React.MouseEvent) => void;
}

/**
 * Hook for managing context menu state
 */
export function useContextMenu(): UseContextMenuResult {
  const [state, setState] = useState<{ isOpen: boolean; x: number; y: number }>({
    isOpen: false,
    x: 0,
    y: 0,
  });

  const open = useCallback((x: number, y: number) => {
    setState({ isOpen: true, x, y });
  }, []);

  const close = useCallback(() => {
    setState((prev) => ({ ...prev, isOpen: false }));
  }, []);

  const onContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      open(e.clientX, e.clientY);
    },
    [open]
  );

  return {
    isOpen: state.isOpen,
    x: state.x,
    y: state.y,
    open,
    close,
    onContextMenu,
  };
}

// =============================================================================
// Icons for context menu items
// =============================================================================

export const ContextMenuIcons = {
  /** Database icon */
  database: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4"
      />
    </svg>
  ),

  /** Table icon */
  table: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
      />
    </svg>
  ),

  /** View icon (eye) */
  view: (
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
  ),

  /** Index icon (search) */
  index: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
      />
    </svg>
  ),

  /** Open icon */
  open: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"
      />
    </svg>
  ),

  /** Rename/edit icon */
  rename: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
      />
    </svg>
  ),

  /** Delete/trash icon */
  delete: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
      />
    </svg>
  ),

  /** Refresh icon */
  refresh: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
      />
    </svg>
  ),

  /** Export/download icon */
  export: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
      />
    </svg>
  ),

  /** Copy icon */
  copy: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
      />
    </svg>
  ),

  /** Design/wrench icon */
  design: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
      />
    </svg>
  ),

  /** Truncate/clear icon */
  truncate: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M3 12l6.414 6.414a2 2 0 001.414.586H19a2 2 0 002-2V7a2 2 0 00-2-2h-8.172a2 2 0 00-1.414.586L3 12z"
      />
    </svg>
  ),

  /** Drop/x icon */
  drop: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M6 18L18 6M6 6l12 12"
      />
    </svg>
  ),

  /** Code/SQL icon */
  code: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"
      />
    </svg>
  ),
};

export default ContextMenu;
