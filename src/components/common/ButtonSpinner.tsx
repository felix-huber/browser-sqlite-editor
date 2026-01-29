/**
 * ButtonSpinner Component
 *
 * An inline spinner for button loading states that replaces the button
 * content during loading.
 *
 * Features:
 * - Configurable size (sm, md, lg)
 * - Replaces text/icon during loading
 * - Automatic disabled state while loading
 * - Works with any button styling
 */

import { memo, type ReactNode, type ButtonHTMLAttributes } from 'react';

export interface ButtonSpinnerProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** Whether the button is in loading state */
  isLoading: boolean;
  /** Button content when not loading */
  children: ReactNode;
  /** Loading text to show (optional, defaults to showing just spinner) */
  loadingText?: string;
  /** Spinner size */
  size?: 'sm' | 'md' | 'lg';
}

/**
 * Inline spinner SVG
 */
const InlineSpinner = memo(function InlineSpinner({ size }: { size: 'sm' | 'md' | 'lg' }) {
  const sizeClasses = {
    sm: 'w-3 h-3',
    md: 'w-4 h-4',
    lg: 'w-5 h-5',
  };

  return (
    <svg
      className={`${sizeClasses[size]} animate-spin`}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden="true"
      data-testid="button-spinner-icon"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
});

/**
 * ButtonSpinner - Button with inline loading spinner
 */
export const ButtonSpinner = memo(function ButtonSpinner({
  isLoading,
  children,
  loadingText,
  size = 'md',
  disabled,
  className = '',
  ...buttonProps
}: ButtonSpinnerProps) {
  const isDisabled = disabled || isLoading;

  return (
    <button
      {...buttonProps}
      disabled={isDisabled}
      className={className}
      aria-busy={isLoading}
      data-testid="button-spinner"
    >
      {isLoading ? (
        <span className="flex items-center justify-center gap-2" data-testid="button-spinner-loading">
          <InlineSpinner size={size} />
          {loadingText && <span>{loadingText}</span>}
        </span>
      ) : (
        children
      )}
    </button>
  );
});

export default ButtonSpinner;
