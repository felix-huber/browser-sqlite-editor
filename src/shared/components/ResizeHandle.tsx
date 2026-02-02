/**
 * ResizeHandle Component
 *
 * A draggable handle for resizing panels.
 * Supports both horizontal (for width) and vertical (for height) resizing.
 */

import { memo } from 'react';

export interface ResizeHandleProps {
  /** Direction of resize */
  direction: 'horizontal' | 'vertical';
  /** Mouse down handler from useResizable hook */
  onMouseDown: (e: React.MouseEvent) => void;
  /** Whether currently dragging */
  isDragging?: boolean;
  /** Additional CSS classes */
  className?: string;
  /** Test ID for testing */
  'data-testid'?: string;
}

/**
 * A draggable resize handle component.
 *
 * - Horizontal: creates a vertical bar for resizing width (cursor: col-resize)
 * - Vertical: creates a horizontal bar for resizing height (cursor: row-resize)
 */
function ResizeHandleComponent({
  direction,
  onMouseDown,
  isDragging = false,
  className = '',
  'data-testid': testId,
}: ResizeHandleProps) {
  const isHorizontal = direction === 'horizontal';

  const baseClasses = isHorizontal
    ? 'w-1 cursor-col-resize hover:bg-navy-300 active:bg-navy-400 transition-colors'
    : 'h-1 cursor-row-resize hover:bg-navy-300 active:bg-navy-400 transition-colors';

  const draggingClasses = isDragging ? 'bg-navy-400' : 'bg-transparent';

  // Expand hit area for easier grabbing
  const hitAreaClasses = isHorizontal
    ? 'relative before:absolute before:inset-y-0 before:-left-1 before:-right-1 before:content-[""]'
    : 'relative before:absolute before:inset-x-0 before:-top-1 before:-bottom-1 before:content-[""]';

  return (
    <div
      className={`${baseClasses} ${draggingClasses} ${hitAreaClasses} ${className}`}
      onMouseDown={onMouseDown}
      role="separator"
      aria-orientation={isHorizontal ? 'vertical' : 'horizontal'}
      aria-label={`Resize ${isHorizontal ? 'width' : 'height'}`}
      tabIndex={0}
      data-testid={testId}
    />
  );
}

export const ResizeHandle = memo(ResizeHandleComponent);

export default ResizeHandle;
