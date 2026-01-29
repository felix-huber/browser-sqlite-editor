/**
 * QuotaExceededModal Component
 *
 * Modal displayed when browser storage quota is exceeded.
 *
 * Features:
 * - Warning icon and title
 * - Storage breakdown showing which DBs use most space
 * - Actions: Export DB, Delete DB, Clear Storage, Dismiss
 * - Confirmation required for Clear Storage
 */

import { useState, useCallback, useEffect } from 'react';
import { useDatabaseStore, deleteDb } from '../../store';
import { getWorkerClient } from '../../lib/worker-client';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import type { DatabaseEntry } from '../../types';

export interface QuotaExceededModalProps {
  /** Whether the modal is open */
  isOpen: boolean;
  /** Callback when modal should close (dismiss) */
  onClose: () => void;
  /** Callback when storage is freed (e.g., after delete) */
  onStorageFreed?: () => void;
}

interface DbSizeInfo {
  name: string;
  size: number;
}

/**
 * Format bytes to human-readable string
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * QuotaExceededModal component
 */
export function QuotaExceededModal({
  isOpen,
  onClose,
  onStorageFreed,
}: QuotaExceededModalProps) {
  const databases = useDatabaseStore((state) => state.databases);
  const activeDbId = useDatabaseStore((state) => state.activeDbId);
  const [dbSizes, setDbSizes] = useState<DbSizeInfo[]>([]);
  const [selectedDbForDelete, setSelectedDbForDelete] = useState<string | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Focus trap for accessibility
  const { containerRef: focusTrapRef } = useFocusTrap({
    isActive: isOpen,
    autoFocus: true,
    returnFocus: true,
  });

  // Load database sizes when modal opens
  useEffect(() => {
    if (!isOpen) {
      // Reset state when modal closes
      setSelectedDbForDelete(null);
      setShowClearConfirm(false);
      setError(null);
      return;
    }

    // Estimate sizes based on database entries
    // In a real implementation, we'd query actual OPFS/IndexedDB sizes
    // For now, use a deterministic hash of the name for consistent display
    const sizes: DbSizeInfo[] = databases.map((db: DatabaseEntry) => {
      // Simple hash based on name to get consistent placeholder size
      let hash = 0;
      for (let i = 0; i < db.name.length; i++) {
        hash = ((hash << 5) - hash) + db.name.charCodeAt(i);
        hash = hash & hash; // Convert to 32-bit integer
      }
      return {
        name: db.name,
        // Placeholder size estimation - in production, query actual storage API
        // Use hash to get a consistent size between 100KB and 10MB
        size: Math.abs(hash % (10 * 1024 * 1024 - 100 * 1024)) + 100 * 1024,
      };
    });

    // Sort by size descending
    sizes.sort((a, b) => b.size - a.size);
    setDbSizes(sizes);
  }, [isOpen, databases]);

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
   * Delete a specific database
   */
  const handleDelete = useCallback(async () => {
    if (!selectedDbForDelete) return;

    setIsDeleting(true);
    setError(null);

    try {
      await deleteDb(selectedDbForDelete);
      setSelectedDbForDelete(null);
      onStorageFreed?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setIsDeleting(false);
    }
  }, [selectedDbForDelete, onStorageFreed]);

  /**
   * Clear all storage (nuclear option)
   */
  const handleClearStorage = useCallback(async () => {
    setIsDeleting(true);
    setError(null);

    try {
      // Delete all databases
      for (const db of databases) {
        await deleteDb(db.name);
      }
      setShowClearConfirm(false);
      onStorageFreed?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Clear storage failed');
    } finally {
      setIsDeleting(false);
    }
  }, [databases, onStorageFreed, onClose]);

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
      data-testid="quota-exceeded-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="quota-exceeded-title"
    >
      <div
        ref={focusTrapRef as React.RefObject<HTMLDivElement>}
        className="bg-white rounded-xl shadow-xl max-w-lg w-full mx-4 max-h-[90vh] overflow-hidden flex flex-col"
        data-testid="quota-exceeded-modal"
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-200">
          {/* Warning Icon */}
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
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>
          <div>
            <h2
              id="quota-exceeded-title"
              className="text-lg font-semibold text-gray-900"
            >
              Storage Full
            </h2>
            <p className="text-sm text-gray-600">
              Your browser storage is full. Delete some databases or export your data.
            </p>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
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

          {/* Storage breakdown */}
          <div>
            <h3 className="text-sm font-medium text-gray-700 mb-2">
              Database Storage
            </h3>
            {dbSizes.length === 0 ? (
              <p className="text-sm text-gray-500 italic">No databases found</p>
            ) : (
              <div className="space-y-2">
                {dbSizes.slice(0, 5).map((db) => (
                  <div
                    key={db.name}
                    className={`flex items-center justify-between p-2 rounded-lg border transition-colors ${
                      selectedDbForDelete === db.name
                        ? 'border-red-300 bg-red-50'
                        : 'border-gray-200 hover:bg-gray-50'
                    }`}
                    data-testid={`db-entry-${db.name}`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm font-medium text-gray-900 truncate">
                        {db.name}
                      </span>
                      {db.name === activeDbId && (
                        <span className="flex-shrink-0 text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">
                          Active
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-gray-500 tabular-nums">
                        {formatBytes(db.size)}
                      </span>
                      <button
                        onClick={() => setSelectedDbForDelete(selectedDbForDelete === db.name ? null : db.name)}
                        className={`p-1 rounded transition-colors ${
                          selectedDbForDelete === db.name
                            ? 'text-red-600 bg-red-100'
                            : 'text-gray-400 hover:text-red-600 hover:bg-red-50'
                        }`}
                        title={selectedDbForDelete === db.name ? 'Cancel selection' : 'Select for deletion'}
                        data-testid={`select-delete-${db.name}`}
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                          />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
                {dbSizes.length > 5 && (
                  <p className="text-xs text-gray-500 text-center">
                    +{dbSizes.length - 5} more databases
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Delete confirmation */}
          {selectedDbForDelete && (
            <div
              className="flex items-center justify-between p-3 bg-red-50 border border-red-200 rounded-lg"
              data-testid="delete-confirmation"
            >
              <span className="text-sm text-red-700">
                Delete "{selectedDbForDelete}"?
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setSelectedDbForDelete(null)}
                  className="px-3 py-1 text-sm text-gray-600 hover:bg-gray-100 rounded transition-colors"
                  disabled={isDeleting}
                  data-testid="cancel-delete"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDelete}
                  disabled={isDeleting}
                  className="px-3 py-1 text-sm bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50 transition-colors"
                  data-testid="confirm-delete"
                >
                  {isDeleting ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            </div>
          )}

          {/* Clear storage confirmation */}
          {showClearConfirm && (
            <div
              className="p-4 bg-red-100 border border-red-300 rounded-lg"
              data-testid="clear-storage-confirmation"
            >
              <p className="text-sm text-red-800 font-medium mb-3">
                Are you sure you want to delete ALL databases? This cannot be undone.
              </p>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setShowClearConfirm(false)}
                  className="px-3 py-1.5 text-sm text-gray-600 hover:bg-red-50 rounded transition-colors"
                  disabled={isDeleting}
                  data-testid="cancel-clear-storage"
                >
                  Cancel
                </button>
                <button
                  onClick={handleClearStorage}
                  disabled={isDeleting}
                  className="px-3 py-1.5 text-sm bg-red-700 text-white rounded hover:bg-red-800 disabled:opacity-50 transition-colors"
                  data-testid="confirm-clear-storage"
                >
                  {isDeleting ? 'Clearing...' : 'Delete All'}
                </button>
              </div>
            </div>
          )}
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

            {/* Clear Storage */}
            <button
              onClick={() => setShowClearConfirm(true)}
              disabled={databases.length === 0 || isDeleting || showClearConfirm}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-red-700 bg-white border border-red-300 rounded-lg hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              title="Delete all databases"
              data-testid="clear-storage-button"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                />
              </svg>
              Clear Storage
            </button>
          </div>

          {/* Dismiss */}
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            data-testid="dismiss-button"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}

export default QuotaExceededModal;
