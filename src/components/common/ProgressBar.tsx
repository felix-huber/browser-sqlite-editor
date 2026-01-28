/**
 * ProgressBar Component
 *
 * A determinate progress bar for displaying operation progress.
 *
 * Features:
 * - Percentage display with visual bar
 * - Current operation label
 * - Bytes processed / total bytes display
 * - Cancel button
 * - Accessible with ARIA attributes
 */

export interface ProgressBarProps {
  /** Progress percentage (0-100) */
  percent: number;
  /** Current operation label */
  label?: string;
  /** Bytes processed so far */
  bytesProcessed?: number;
  /** Total bytes to process */
  totalBytes?: number;
  /** Whether to show cancel button */
  showCancel?: boolean;
  /** Cancel callback */
  onCancel?: () => void;
  /** Additional CSS classes */
  className?: string;
}

/**
 * Format bytes as human-readable string
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Progress bar component with percentage, label, and optional cancel
 */
export function ProgressBar({
  percent,
  label,
  bytesProcessed,
  totalBytes,
  showCancel = false,
  onCancel,
  className = '',
}: ProgressBarProps) {
  // Clamp percent between 0 and 100
  const clampedPercent = Math.min(100, Math.max(0, percent));
  const roundedPercent = Math.round(clampedPercent);

  return (
    <div className={`w-full ${className}`} data-testid="progress-bar">
      {/* Label and percentage */}
      <div className="flex items-center justify-between mb-2">
        {label && (
          <span className="text-sm font-medium text-navy-700" data-testid="progress-label">
            {label}
          </span>
        )}
        <span className="text-sm text-navy-500" data-testid="progress-percent">
          {roundedPercent}%
        </span>
      </div>

      {/* Progress bar */}
      <div
        className="h-2 bg-navy-100 rounded-full overflow-hidden"
        role="progressbar"
        aria-valuenow={roundedPercent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label || 'Progress'}
      >
        <div
          className="h-full bg-navy-600 rounded-full transition-all duration-200"
          style={{ width: `${clampedPercent}%` }}
          data-testid="progress-fill"
        />
      </div>

      {/* Bytes display and cancel button */}
      <div className="flex items-center justify-between mt-2">
        {bytesProcessed !== undefined && totalBytes !== undefined && totalBytes > 0 ? (
          <span className="text-xs text-navy-400" data-testid="progress-bytes">
            {formatBytes(bytesProcessed)} / {formatBytes(totalBytes)}
          </span>
        ) : (
          <span />
        )}

        {showCancel && onCancel && (
          <button
            onClick={onCancel}
            className="text-xs text-red-600 hover:text-red-700 font-medium transition-colors"
            data-testid="progress-cancel-button"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

export default ProgressBar;
