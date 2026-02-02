/**
 * useResizable Hook
 *
 * Provides drag-based resizing functionality with localStorage persistence.
 * Supports both horizontal (width) and vertical (height) resizing.
 */

import { useState, useCallback, useEffect, useRef } from 'react';

export interface UseResizableOptions {
  /** Storage key for localStorage persistence */
  storageKey: string;
  /** Initial size in pixels */
  initialSize: number;
  /** Minimum allowed size in pixels */
  minSize: number;
  /** Maximum allowed size in pixels */
  maxSize: number;
  /** Direction of resize: 'horizontal' for width, 'vertical' for height */
  direction: 'horizontal' | 'vertical';
  /** Whether resize handle is on the start (left/top) or end (right/bottom) */
  handlePosition?: 'start' | 'end';
}

export interface UseResizableResult {
  /** Current size in pixels */
  size: number;
  /** Whether the user is currently dragging */
  isDragging: boolean;
  /** Handler for mouse down on the resize handle */
  handleMouseDown: (e: React.MouseEvent) => void;
  /** Reset size to initial value */
  resetSize: () => void;
  /** Set size programmatically */
  setSize: (size: number) => void;
}

/**
 * Hook for creating resizable panels with localStorage persistence.
 */
export function useResizable({
  storageKey,
  initialSize,
  minSize,
  maxSize,
  direction,
  handlePosition = 'end',
}: UseResizableOptions): UseResizableResult {
  // Load initial size from localStorage or use default
  const [size, setSizeState] = useState<number>(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const parsed = parseInt(stored, 10);
        if (!isNaN(parsed) && parsed >= minSize && parsed <= maxSize) {
          return parsed;
        }
      }
    } catch {
      // Ignore localStorage errors
    }
    return initialSize;
  });

  const [isDragging, setIsDragging] = useState(false);
  const startPosRef = useRef<number>(0);
  const startSizeRef = useRef<number>(0);

  // Clamp size within bounds
  const clampSize = useCallback(
    (value: number): number => {
      return Math.min(Math.max(value, minSize), maxSize);
    },
    [minSize, maxSize]
  );

  // Set size with clamping and persistence
  const setSize = useCallback(
    (newSize: number) => {
      const clamped = clampSize(newSize);
      setSizeState(clamped);
      try {
        localStorage.setItem(storageKey, String(clamped));
      } catch {
        // Ignore localStorage errors
      }
    },
    [clampSize, storageKey]
  );

  // Reset to initial size
  const resetSize = useCallback(() => {
    setSize(initialSize);
  }, [initialSize, setSize]);

  // Handle mouse down on resize handle
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsDragging(true);
      startPosRef.current = direction === 'horizontal' ? e.clientX : e.clientY;
      startSizeRef.current = size;
    },
    [direction, size]
  );

  // Handle mouse move during drag
  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const currentPos = direction === 'horizontal' ? e.clientX : e.clientY;
      const delta = currentPos - startPosRef.current;

      // Calculate new size based on handle position
      // For 'end' position: dragging right/down increases size
      // For 'start' position: dragging right/down decreases size
      const multiplier = handlePosition === 'end' ? 1 : -1;
      const newSize = startSizeRef.current + delta * multiplier;

      setSize(newSize);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    // Add listeners to document to catch events outside the element
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    // Prevent text selection during drag
    document.body.style.userSelect = 'none';
    document.body.style.cursor = direction === 'horizontal' ? 'col-resize' : 'row-resize';

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
  }, [isDragging, direction, handlePosition, setSize]);

  return {
    size,
    isDragging,
    handleMouseDown,
    resetSize,
    setSize,
  };
}

export default useResizable;
