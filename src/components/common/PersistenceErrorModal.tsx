/**
 * PersistenceErrorModal Component
 *
 * Modal displayed when IndexedDB persistence fails after multiple retries.
 *
 * Features:
 * - Database error icon and title
 * - Warning message about potential data loss
 * - Collapsible technical details showing IDB error
 * - Actions: Export Database, Retry Save, Continue Without Saving, Discard Changes
 */

import { useState, useCallback } from 'react';
import {
  useDatabaseStore,
  usePersistenceError,
  useFailedSaveAttempts,
} from '../../store';
import { getWorkerClient } from '../../lib/worker-client';

export interface PersistenceErrorModalProps {
  /** Whether the modal is open */
  isOpen: boolean;
  /** Callback when modal should close (dismiss) */
  onClose: () => void;
  /** Callback when retry succeeds */
  onRetrySuccess?: () => void;
  /** Callback when user discards changes */
  onDiscardChanges?: () => void;
}

/**
 * PersistenceErrorModal component
 */
export function PersistenceErrorModal({
  isOpen,
  onClose,
  onRetrySuccess,
  onDiscardChanges,
}: PersistenceErrorModalProps) {
  const activeDbId = useDatabaseStore((state) => state.activeDbId);
  const persistenceError = usePersistenceError();
  const failedAttempts = useFailedSaveAttempts();
  const setPersistenceStatus = useDatabaseStore((state) => state.setPersistenceStatus);
  const setStorageStatus = useDatabaseStore((state) => state.setStorageStatus);
  const clearFailedSaveAttempts = useDatabaseStore((state) => state.clearFailedSaveAttempts);

  const [showDetails, setShowDetails] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Export the current database as .sqlite file
   */
  const handleExport = useCallback(async () => {
    if (!activeDbId) {
      setError('No database selected');
      return;
    }

    setIsExporting(true);
    setError(null);

    try {
      const workerClient = getWorkerClient();
      const blob = await workerClient.exportDb(activeDbId);

      // Trigger download
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${activeDbId}.sqlite`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setIsExporting(false);
    }
  }, [activeDbId]);

  /**
   * Retry saving to IndexedDB
   */
  const handleRetry = useCallback(async () => {
    if (!activeDbId) {
      setError('No database selected');
      return;
    }

    setIsRetrying(true);
    setError(null);

    try {
      const workerClient = getWorkerClient();
      await workerClient.flushSnapshot();

      // Success - clear degraded state
      clearFailedSaveAttempts();
      setStorageStatus('ok');
      setPersistenceStatus('saved');
      onRetrySuccess?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Retry failed');
    } finally {
      setIsRetrying(false);
    }
  }, [activeDbId, clearFailedSaveAttempts, setStorageStatus, setPersistenceStatus, onRetrySuccess, onClose]);

  /**
   * Discard changes and reload from last good save
   */
  const handleDiscardChanges = useCallback(() => {
    // Clear degraded state
    clearFailedSaveAttempts();
    setStorageStatus('ok');
    setPersistenceStatus('saved');
    onDiscardChanges?.();
    onClose();
    // Reload the page to get fresh state from storage
    window.location.reload();
  }, [clearFailedSaveAttempts, setStorageStatus, setPersistenceStatus, onDiscardChanges, onClose]);

  /**
   * Handle backdrop click
   */
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose]
  );

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={handleBackdropClick}
      data-testid="persistence-error-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="persistence-error-title"
    >
      <div
        className="bg-white rounded-xl shadow-xl max-w-lg w-full mx-4 max-h-[90vh] overflow-hidden flex flex-col"
        data-testid="persistence-error-modal"
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-200">
          {/* Database Error Icon */}
          <div className="flex-shrink-0 w-10 h-10 bg-red-100 rounded-full flex items-center justify-center">
            <svg
              className="w-6 h-6 text-red-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4m0 4h.01"
              />
            </svg>
          </div>
          <div>
            <h2
              id="persistence-error-title"
              className="text-lg font-semibold text-gray-900"
            >
              Persistence Error
            </h2>
            <p className="text-sm text-gray-600">
              Failed to save changes to storage after {failedAttempts} attempts
            </p>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* Warning message */}
          <div
            className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-lg"
            role="alert"
          >
            <svg
              className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
            <p className="text-sm text-amber-800">
              Changes may be lost if you close this tab
            </p>
          </div>

          {/* Error message */}
          {error && (
            <div
              className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700"
              role="alert"
              data-testid="error-message"
            >
              <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                  clipRule="evenodd"
                />
              </svg>
              {error}
            </div>
          )}

          {/* Technical details (collapsible) */}
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <button
              onClick={() => setShowDetails(!showDetails)}
              className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              data-testid="toggle-details"
              aria-expanded={showDetails}
            >
              <span>Technical Details</span>
              <svg
                className={`w-4 h-4 transition-transform ${showDetails ? 'rotate-180' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 9l-7 7-7-7"
                />
              </svg>
            </button>
            {showDetails && (
              <div
                className="px-4 py-3 bg-gray-50 border-t border-gray-200 text-xs font-mono text-gray-600 whitespace-pre-wrap break-all"
                data-testid="technical-details"
              >
                {persistenceError || 'IndexedDB write failed'}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-t border-gray-200 bg-gray-50">
          <div className="flex gap-2">
            {/* Export Database */}
            <button
              onClick={handleExport}
              disabled={!activeDbId || isExporting}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              title={activeDbId ? `Export ${activeDbId}` : 'No database selected'}
              data-testid="export-button"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                />
              </svg>
              {isExporting ? 'Exporting...' : 'Export Database'}
            </button>

            {/* Retry Save */}
            <button
              onClick={handleRetry}
              disabled={!activeDbId || isRetrying}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              data-testid="retry-button"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
              {isRetrying ? 'Retrying...' : 'Retry Save'}
            </button>
          </div>

          <div className="flex gap-2">
            {/* Continue Without Saving */}
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              data-testid="continue-button"
            >
              Continue Without Saving
            </button>

            {/* Discard Changes */}
            <button
              onClick={handleDiscardChanges}
              className="px-4 py-2 text-sm font-medium text-red-700 bg-white border border-red-300 rounded-lg hover:bg-red-50 transition-colors"
              data-testid="discard-button"
            >
              Discard Changes
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default PersistenceErrorModal;
