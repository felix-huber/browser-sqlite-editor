/**
 * useFocusTrap Hook
 *
 * Traps focus within a container element for accessibility.
 * Used for modals and dialogs to ensure keyboard users can't tab out.
 *
 * Features:
 * - Traps Tab/Shift+Tab within container
 * - Returns focus to trigger element on close
 * - Auto-focuses first focusable element on open
 */

import { useEffect, useRef, useCallback } from 'react';

/** Selectors for focusable elements */
const FOCUSABLE_SELECTORS = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'textarea:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

export interface UseFocusTrapOptions {
  /** Whether the focus trap is active */
  isActive: boolean;
  /** Whether to auto-focus the first focusable element */
  autoFocus?: boolean;
  /** Whether to return focus to trigger on close */
  returnFocus?: boolean;
  /** Initial focus target selector (optional) */
  initialFocusSelector?: string;
}

export interface UseFocusTrapResult<T extends HTMLElement = HTMLElement> {
  /** Ref to attach to the container element */
  containerRef: React.RefObject<T>;
}

/**
 * Hook for creating an accessible focus trap
 */
export function useFocusTrap<T extends HTMLElement = HTMLElement>({
  isActive,
  autoFocus = true,
  returnFocus = true,
  initialFocusSelector,
}: UseFocusTrapOptions): UseFocusTrapResult<T> {
  const containerRef = useRef<T | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  // Get all focusable elements within the container
  const getFocusableElements = useCallback((): HTMLElement[] => {
    if (!containerRef.current) return [];
    return Array.from(
      containerRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS)
    ).filter((el) => el.offsetParent !== null); // Filter out hidden elements
  }, []);

  // Handle tab key to trap focus
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;

      const focusable = getFocusableElements();
      if (focusable.length === 0) return;

      const firstElement = focusable[0];
      const lastElement = focusable[focusable.length - 1];
      const activeElement = document.activeElement;

      // Shift+Tab on first element -> focus last
      if (event.shiftKey && activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
        return;
      }

      // Tab on last element -> focus first
      if (!event.shiftKey && activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
        return;
      }

      // Tab when focus is outside container -> focus first
      if (!containerRef.current?.contains(activeElement)) {
        event.preventDefault();
        if (event.shiftKey) {
          lastElement.focus();
        } else {
          firstElement.focus();
        }
      }
    },
    [getFocusableElements]
  );

  // Save trigger element when trap activates
  useEffect(() => {
    if (isActive) {
      triggerRef.current = document.activeElement as HTMLElement;
    }
  }, [isActive]);

  // Set up focus trap when active
  useEffect(() => {
    if (!isActive) return;

    // Auto-focus first element or specified element
    if (autoFocus && containerRef.current) {
      const focusTarget = initialFocusSelector
        ? containerRef.current.querySelector<HTMLElement>(initialFocusSelector)
        : getFocusableElements()[0];

      if (focusTarget) {
        // Delay focus to ensure element is rendered
        requestAnimationFrame(() => {
          focusTarget.focus();
        });
      }
    }

    // Add keydown listener for tab trap
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isActive, autoFocus, initialFocusSelector, getFocusableElements, handleKeyDown]);

  // Return focus to trigger when trap deactivates
  useEffect(() => {
    if (isActive) return;

    if (returnFocus && triggerRef.current) {
      // Delay to ensure any closing animations complete
      requestAnimationFrame(() => {
        triggerRef.current?.focus();
        triggerRef.current = null;
      });
    }
  }, [isActive, returnFocus]);

  return { containerRef: containerRef as React.RefObject<T> };
}

export default useFocusTrap;
