/**
 * GridSkeleton Component
 *
 * A skeleton loader for the data grid that displays animated placeholder rows.
 * Used during initial table load and large query execution.
 *
 * Features:
 * - Matches actual grid column widths
 * - Shimmer animation on cells
 * - Configurable number of rows and columns
 * - Accessible with reduced motion support
 */

import { memo } from 'react';

/** Default row height matching DataGrid */
const ROW_HEIGHT = 32;

/** Default column width matching DataGrid */
const DEFAULT_COLUMN_WIDTH = 150;

/** Checkbox column width matching DataGrid */
const CHECKBOX_COLUMN_WIDTH = 40;

export interface GridSkeletonProps {
  /** Number of skeleton rows to display */
  rowCount?: number;
  /** Column widths (array of pixel values) */
  columnWidths?: number[];
  /** Default number of columns if widths not provided */
  columnCount?: number;
  /** Height of the skeleton container */
  height?: number;
  /** Whether to show the header row */
  showHeader?: boolean;
  /** Additional CSS classes */
  className?: string;
}

/**
 * Single skeleton cell with shimmer animation
 */
const SkeletonCell = memo(function SkeletonCell({
  width,
  seed
}: {
  width: number;
  seed: number;
}) {
  // Vary the content width for visual variety (40-80% of cell)
  // Use deterministic calculation based on seed to avoid re-render jitter
  const contentWidthPercent = 40 + ((seed * 17) % 40);

  return (
    <div
      className="flex-shrink-0 px-2 flex items-center"
      style={{ width, height: ROW_HEIGHT }}
    >
      <div
        className="h-4 bg-gray-200 rounded animate-shimmer"
        style={{ width: `${contentWidthPercent}%` }}
      />
    </div>
  );
});

/**
 * Skeleton header cell
 */
const SkeletonHeaderCell = memo(function SkeletonHeaderCell({ width }: { width: number }) {
  return (
    <div
      className="flex-shrink-0 px-2 flex items-center gap-2"
      style={{ width, height: ROW_HEIGHT }}
    >
      {/* Type indicator placeholder */}
      <div className="w-6 h-4 bg-gray-300 rounded animate-shimmer" />
      {/* Column name placeholder */}
      <div className="flex-1 h-4 bg-gray-300 rounded animate-shimmer" style={{ maxWidth: '60%' }} />
    </div>
  );
});

/**
 * Single skeleton row
 */
const SkeletonRow = memo(function SkeletonRow({
  columnWidths,
  rowIndex,
}: {
  columnWidths: number[];
  rowIndex: number;
}) {
  return (
    <div
      className={`flex items-center border-b border-gray-200 ${
        rowIndex % 2 === 0 ? 'bg-white' : 'bg-gray-50'
      }`}
      style={{ height: ROW_HEIGHT }}
      data-testid={`skeleton-row-${rowIndex}`}
    >
      {/* Checkbox placeholder */}
      <div
        className="flex-shrink-0 flex items-center justify-center"
        style={{ width: CHECKBOX_COLUMN_WIDTH, height: ROW_HEIGHT }}
      >
        <div className="w-4 h-4 bg-gray-200 rounded animate-shimmer" />
      </div>

      {/* Data cells */}
      {columnWidths.map((width, colIndex) => (
        <SkeletonCell key={colIndex} width={width} seed={rowIndex * 100 + colIndex} />
      ))}
    </div>
  );
});

/**
 * GridSkeleton - Animated placeholder for data grid loading state
 */
export const GridSkeleton = memo(function GridSkeleton({
  rowCount = 10,
  columnWidths,
  columnCount = 5,
  height = 400,
  showHeader = true,
  className = '',
}: GridSkeletonProps) {
  // Generate column widths if not provided
  const effectiveColumnWidths = columnWidths ?? Array(columnCount).fill(DEFAULT_COLUMN_WIDTH);

  // Calculate total width
  const totalWidth =
    CHECKBOX_COLUMN_WIDTH +
    effectiveColumnWidths.reduce((sum, w) => sum + w, 0);

  return (
    <div
      className={`flex flex-col overflow-hidden ${className}`}
      style={{ height }}
      data-testid="grid-skeleton"
      role="status"
      aria-label="Loading table data"
      aria-busy="true"
    >
      {/* Header skeleton */}
      {showHeader && (
        <div
          className="flex-shrink-0 bg-gray-100 border-b-2 border-gray-300"
          style={{ height: ROW_HEIGHT }}
          data-testid="skeleton-header"
        >
          <div className="flex items-center" style={{ width: totalWidth }}>
            {/* Select all checkbox placeholder */}
            <div
              className="flex-shrink-0 flex items-center justify-center"
              style={{ width: CHECKBOX_COLUMN_WIDTH, height: ROW_HEIGHT }}
            >
              <div className="w-4 h-4 bg-gray-300 rounded animate-shimmer" />
            </div>

            {/* Column header placeholders */}
            {effectiveColumnWidths.map((width, index) => (
              <SkeletonHeaderCell key={index} width={width} />
            ))}
          </div>
        </div>
      )}

      {/* Body skeleton */}
      <div className="flex-1 overflow-hidden">
        <div style={{ width: totalWidth }}>
          {Array.from({ length: rowCount }).map((_, index) => (
            <SkeletonRow
              key={index}
              columnWidths={effectiveColumnWidths}
              rowIndex={index}
            />
          ))}
        </div>
      </div>

      {/* Screen reader announcement */}
      <span className="sr-only">Loading table data, please wait...</span>
    </div>
  );
});

export default GridSkeleton;
