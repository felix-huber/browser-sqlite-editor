/**
 * useGridVirtualizer Hook
 *
 * Wraps TanStack Virtual for efficient rendering of large datasets.
 * Uses fixed row height (32px) for consistent virtualization.
 */

import { useRef, useCallback, useEffect } from 'react';
import { useVirtualizer, type VirtualItem, type Virtualizer } from '@tanstack/react-virtual';
import { ROW_HEIGHT } from './useDataGrid';

// =============================================================================
// Types
// =============================================================================

/** Options for the grid virtualizer */
export interface UseGridVirtualizerOptions {
  /** Total number of rows */
  rowCount: number;
  /** Height of the visible viewport in pixels (optional, TanStack Virtual auto-measures) */
  viewportHeight?: number;
  /** Overscan count (rows to render outside visible area) */
  overscan?: number;
  /** Total rows available (for infinite scroll - may be more than rowCount) */
  totalRowsAvailable?: number;
  /** Called when user scrolls near the end and more data should be loaded */
  onLoadMore?: () => void;
  /** Whether more data is currently being loaded */
  isLoadingMore?: boolean;
}

/** Return type for useGridVirtualizer */
export interface UseGridVirtualizerResult {
  /** Ref to attach to the scrollable container */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** The virtualizer instance */
  virtualizer: Virtualizer<HTMLDivElement, Element>;
  /** Virtual items (rows) to render */
  virtualItems: VirtualItem[];
  /** Total height of all rows (for spacer) */
  totalHeight: number;
  /** Get the visible range of rows (0-indexed) */
  getVisibleRange: () => { startIndex: number; endIndex: number };
  /** Scroll to a specific row index */
  scrollToIndex: (index: number, options?: { align?: 'start' | 'center' | 'end' }) => void;
  /** Scroll to top (resets scroll position) */
  scrollToTop: () => void;
}

// =============================================================================
// Hook Implementation
// =============================================================================

/** Threshold (in rows) before the end to trigger loading more data */
const LOAD_MORE_THRESHOLD = 50;

/**
 * React hook for virtualizing grid rows
 *
 * Uses TanStack Virtual with fixed row heights for predictable
 * scroll behavior and efficient rendering.
 *
 * @param options - Virtualizer configuration
 * @returns Virtualizer instance and helper functions
 */
export function useGridVirtualizer(options: UseGridVirtualizerOptions): UseGridVirtualizerResult {
  // Note: viewportHeight is passed for documentation/type-safety but TanStack Virtual
  // measures the scroll container automatically. We destructure it to satisfy the interface.
  const {
    rowCount,
    viewportHeight: _viewportHeight,
    overscan = 5,
    totalRowsAvailable,
    onLoadMore,
    isLoadingMore = false,
  } = options;

  // Ref for the scrollable container
  const containerRef = useRef<HTMLDivElement>(null);

  // Create virtualizer instance
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => containerRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan,
  });

  // Get virtual items to render
  const virtualItems = virtualizer.getVirtualItems();

  // Calculate total height for the spacer element
  const totalHeight = virtualizer.getTotalSize();

  // Infinite scroll: check if we need to load more data
  useEffect(() => {
    if (!onLoadMore || isLoadingMore) return;
    if (totalRowsAvailable !== undefined && rowCount >= totalRowsAvailable) return;

    const items = virtualizer.getVirtualItems();
    if (items.length === 0) return;

    const lastVisibleIndex = items[items.length - 1].index;
    const distanceFromEnd = rowCount - 1 - lastVisibleIndex;

    if (distanceFromEnd < LOAD_MORE_THRESHOLD) {
      onLoadMore();
    }
  }, [virtualItems, rowCount, totalRowsAvailable, onLoadMore, isLoadingMore, virtualizer]);

  // Get visible range helper
  const getVisibleRange = useCallback((): { startIndex: number; endIndex: number } => {
    const items = virtualizer.getVirtualItems();
    if (items.length === 0) {
      return { startIndex: 0, endIndex: 0 };
    }
    return {
      startIndex: items[0].index,
      endIndex: items[items.length - 1].index,
    };
  }, [virtualizer]);

  // Scroll to index helper
  const scrollToIndex = useCallback(
    (index: number, options?: { align?: 'start' | 'center' | 'end' }) => {
      virtualizer.scrollToIndex(index, options);
    },
    [virtualizer],
  );

  // Scroll to top helper
  const scrollToTop = useCallback(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = 0;
    }
    virtualizer.scrollToIndex(0, { align: 'start' });
  }, [virtualizer]);

  return {
    containerRef,
    virtualizer,
    virtualItems,
    totalHeight,
    getVisibleRange,
    scrollToIndex,
    scrollToTop,
  };
}

/**
 * Calculate the visible row range from scroll position
 *
 * Utility function for calculating which rows are visible
 * given a scroll offset and viewport height.
 *
 * @param scrollOffset - Current scroll position in pixels
 * @param viewportHeight - Height of visible area in pixels
 * @param totalRows - Total number of rows
 * @returns Start and end indices (inclusive)
 */
export function calculateVisibleRange(
  scrollOffset: number,
  viewportHeight: number,
  totalRows: number,
): { startIndex: number; endIndex: number } {
  if (totalRows === 0) {
    return { startIndex: 0, endIndex: 0 };
  }

  const startIndex = Math.floor(scrollOffset / ROW_HEIGHT);
  const visibleCount = Math.ceil(viewportHeight / ROW_HEIGHT);
  const endIndex = Math.min(startIndex + visibleCount - 1, totalRows - 1);

  return {
    startIndex: Math.max(0, startIndex),
    endIndex: Math.max(0, endIndex),
  };
}
