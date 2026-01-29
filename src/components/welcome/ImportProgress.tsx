/**
 * ImportProgress Component
 *
 * Manages the import progress UI including:
 * - Progress bar with percentage and bytes
 * - Size warning for files >100MB
 * - Quota warning when storage is low
 * - Cancel button to abort import
 *
 * Flow:
 * 1. Before import: Show confirmation dialog for large files or low quota
 * 2. During import: Show progress bar with cancel option
 * 3. On complete/cancel: Call appropriate callback
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { ProgressBar } from '../common/ProgressBar';

/** Threshold for large file warning (100MB) */
const LARGE_FILE_THRESHOLD = 100 * 1024 * 1024;

/** Multiplier for quota check (file size * 1.5) */
const QUOTA_SAFETY_MULTIPLIER = 1.5;

/** Progress state from worker */
export interface ImportProgressState {
  /** Current bytes read */
  bytesRead: number;
  /** Total bytes to read */
  totalBytes: number;
  /** Whether import is in progress */
  isImporting: boolean;
}

/** Warning type */
export type WarningType = 'size' | 'quota' | 'both' | null;

export interface ImportProgressProps {
  /** File being imported */
  file: File | null;
  /** Progress state from worker */
  progress: ImportProgressState | null;
  /** Whether import is currently active */
  isImporting: boolean;
  /** Callback to start the import (after confirmation) */
  onConfirmImport: () => void;
  /** Callback to cancel import */
  onCancel: () => void;
  /** Callback when user dismisses without importing */
  onDismiss: () => void;
  /** Storage quota estimate (optional) */
  storageEstimate?: { quota?: number; usage?: number };
}

/**
 * Format bytes as human-readable string
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/**
 * Check if storage space is low for the given file size
 */
function isStorageLow(
  fileSize: number,
  estimate?: { quota?: number; usage?: number }
): boolean {
  if (!estimate?.quota || estimate.usage === undefined) {
    return false;
  }
  const available = estimate.quota - estimate.usage;
  const required = fileSize * QUOTA_SAFETY_MULTIPLIER;
  return available < required;
}

/**
 * ImportProgress component for managing file import UI
 */
export function ImportProgress({
  file,
  progress,
  isImporting,
  onConfirmImport,
  onCancel,
  onDismiss,
  storageEstimate,
}: ImportProgressProps) {
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [warningType, setWarningType] = useState<WarningType>(null);
  const lastProgressRef = useRef<number>(0);
  const lastUpdateRef = useRef<number>(0);
  const [displayPercent, setDisplayPercent] = useState(0);

  // Ref to track the callback to avoid stale closure issues
  const onConfirmImportRef = useRef(onConfirmImport);
  onConfirmImportRef.current = onConfirmImport;

  // Track which file we've triggered import for (to prevent duplicates)
  const importTriggeredForRef = useRef<File | null>(null);

  // Check for warnings when file changes
  useEffect(() => {
    if (!file) {
      setShowConfirmation(false);
      setWarningType(null);
      importTriggeredForRef.current = null;
      return;
    }

    // Prevent duplicate import triggers for the same file
    // (e.g., if effect runs twice due to React strict mode or storageEstimate change)
    if (importTriggeredForRef.current === file) {
      return;
    }

    const isLargeFile = file.size > LARGE_FILE_THRESHOLD;
    const isLowStorage = isStorageLow(file.size, storageEstimate);

    if (isLargeFile && isLowStorage) {
      setWarningType('both');
      setShowConfirmation(true);
    } else if (isLargeFile) {
      setWarningType('size');
      setShowConfirmation(true);
    } else if (isLowStorage) {
      setWarningType('quota');
      setShowConfirmation(true);
    } else {
      // No warnings, start import directly
      setWarningType(null);
      setShowConfirmation(false);
      importTriggeredForRef.current = file;
      onConfirmImportRef.current();
    }
  }, [file, storageEstimate]);

  // Debounced progress updates (max every 100ms)
  useEffect(() => {
    if (!progress || !isImporting) {
      return;
    }

    const now = Date.now();
    const newPercent = progress.totalBytes > 0
      ? Math.round((progress.bytesRead / progress.totalBytes) * 100)
      : 0;

    // Only update if 100ms has passed or progress is complete
    if (now - lastUpdateRef.current >= 100 || newPercent === 100) {
      lastUpdateRef.current = now;
      lastProgressRef.current = newPercent;
      setDisplayPercent(newPercent);
    }
  }, [progress, isImporting]);

  // Reset display percent when not importing
  useEffect(() => {
    if (!isImporting) {
      setDisplayPercent(0);
    }
  }, [isImporting]);

  const handleConfirm = useCallback(() => {
    setShowConfirmation(false);
    importTriggeredForRef.current = file;
    onConfirmImport();
  }, [file, onConfirmImport]);

  const handleCancel = useCallback(() => {
    setShowConfirmation(false);
    onDismiss();
  }, [onDismiss]);

  // No file selected
  if (!file) {
    return null;
  }

  // Confirmation dialog for warnings
  if (showConfirmation && warningType) {
    return (
      <div
        className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
        data-testid="import-confirmation-overlay"
      >
        <div
          className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 p-6"
          data-testid="import-confirmation-dialog"
          role="alertdialog"
          aria-labelledby="import-warning-title"
          aria-describedby="import-warning-description"
        >
          {/* Warning icon */}
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
              <svg
                className="w-5 h-5 text-amber-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
            </div>
            <h2 id="import-warning-title" className="text-lg font-semibold text-navy-900">
              {warningType === 'quota' ? 'Low Storage Space' : 'Large File Warning'}
            </h2>
          </div>

          {/* Warning messages */}
          <div id="import-warning-description" className="space-y-3 mb-6">
            {(warningType === 'size' || warningType === 'both') && (
              <p className="text-sm text-navy-600" data-testid="size-warning">
                This file is very large ({formatBytes(file.size)}). Import may take several minutes.
              </p>
            )}
            {(warningType === 'quota' || warningType === 'both') && (
              <p className="text-sm text-navy-600" data-testid="quota-warning">
                Storage space is low. Consider deleting unused databases before importing.
                {storageEstimate?.quota && storageEstimate.usage !== undefined && (
                  <span className="block mt-1 text-navy-400">
                    Available: {formatBytes(storageEstimate.quota - storageEstimate.usage)} / {formatBytes(storageEstimate.quota)}
                  </span>
                )}
              </p>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex gap-3 justify-end">
            <button
              onClick={handleCancel}
              className="px-4 py-2 text-sm font-medium text-navy-700 hover:bg-navy-100 rounded-lg transition-colors"
              data-testid="import-cancel-button"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              className="px-4 py-2 text-sm font-medium text-white bg-navy-600 hover:bg-navy-700 rounded-lg transition-colors"
              data-testid="import-confirm-button"
            >
              Continue Anyway
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Progress display during import
  if (isImporting && progress) {
    return (
      <div
        className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
        data-testid="import-progress-overlay"
      >
        <div
          className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 p-6"
          data-testid="import-progress-dialog"
          role="dialog"
          aria-labelledby="import-progress-title"
          aria-describedby="import-progress-status"
        >
          {/* Header */}
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-full bg-navy-100 flex items-center justify-center shrink-0 animate-pulse">
              <svg
                className="w-5 h-5 text-navy-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
                />
              </svg>
            </div>
            <div>
              <h2 id="import-progress-title" className="text-lg font-semibold text-navy-900">
                {file.size > LARGE_FILE_THRESHOLD
                  ? 'Importing large file...'
                  : 'Importing database...'}
              </h2>
              <p className="text-sm text-navy-500 truncate max-w-xs">{file.name}</p>
            </div>
          </div>
          {/* Screen reader status announcement */}
          <div id="import-progress-status" className="sr-only" aria-live="polite" aria-atomic="true">
            Import progress: {displayPercent}% complete, {formatBytes(progress.bytesRead)} of {formatBytes(progress.totalBytes)}
          </div>

          {/* Progress bar */}
          <ProgressBar
            percent={displayPercent}
            bytesProcessed={progress.bytesRead}
            totalBytes={progress.totalBytes}
            showCancel
            onCancel={onCancel}
          />
        </div>
      </div>
    );
  }

  return null;
}

export default ImportProgress;
