/**
 * StatusBar Component
 *
 * Displays persistence status, storage mode, lock status, and database info
 * at the bottom of the application workspace.
 *
 * Sections (left to right):
 * 1. Save status indicator (Saved/Unsaved/Saving/Error)
 * 2. Storage mode badge (OPFS/IndexedDB)
 * 3. Lock status (Write/Read-only) when multi-tab
 * 4. Database info (size, table count, row count)
 */

import { useState, useCallback } from 'react';
import {
  useDatabaseStore,
  useStorageMode,
  useIsReadOnly,
  useLockHolder,
  usePersistenceStatus,
  usePersistenceError,
} from '../../store';

/**
 * Props for StatusBar
 */
export interface StatusBarProps {
  /** Current table name for row count display */
  currentTable?: string | null;
  /** Current table row count */
  currentTableRowCount?: number | null;
  /** Database file size in bytes */
  dbFileSize?: number | null;
}

/**
 * Format bytes to human-readable string
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const size = bytes / Math.pow(k, i);
  return `${size.toFixed(i > 0 ? 1 : 0)} ${sizes[i]}`;
}

/**
 * Format number with locale-aware separators
 */
function formatNumber(num: number): string {
  return num.toLocaleString();
}

/**
 * Save status indicator icons
 */
function SavedIcon() {
  return (
    <svg
      className="w-3.5 h-3.5 text-green-600"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M5 13l4 4L19 7"
      />
    </svg>
  );
}

function UnsavedIcon() {
  return (
    <span
      className="w-2 h-2 bg-amber-500 rounded-full"
      aria-hidden="true"
    />
  );
}

function SavingIcon() {
  return (
    <svg
      className="w-3.5 h-3.5 text-navy-500 animate-spin"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden="true"
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
}

function ErrorIcon() {
  return (
    <svg
      className="w-3.5 h-3.5 text-red-600"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M6 18L18 6M6 6l12 12"
      />
    </svg>
  );
}

/**
 * StatusBar component displaying persistence and database status
 */
export function StatusBar({
  currentTable,
  currentTableRowCount,
  dbFileSize,
}: StatusBarProps) {
  const activeDbId = useDatabaseStore((state) => state.activeDbId);
  const schema = useDatabaseStore((state) => state.schema);
  const storageMode = useStorageMode();
  const isReadOnly = useIsReadOnly();
  const lockHolder = useLockHolder();
  const persistenceStatus = usePersistenceStatus();
  const persistenceError = usePersistenceError();

  // Error details popover state
  const [showErrorDetails, setShowErrorDetails] = useState(false);

  const handleErrorClick = useCallback(() => {
    if (persistenceStatus === 'error' && persistenceError) {
      setShowErrorDetails((prev) => !prev);
    }
  }, [persistenceStatus, persistenceError]);

  // If no database is loaded, show minimal status
  if (!activeDbId) {
    return (
      <footer
        className="h-7 bg-white border-t border-navy-200 flex items-center px-4 text-xs shrink-0"
        data-testid="status-bar"
        role="status"
        aria-label="Application status"
        aria-live="polite"
      >
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-navy-500 font-medium">
            <span className="w-1.5 h-1.5 bg-navy-400 rounded-full" />
            Ready
          </span>
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-3 text-navy-500">
          <span className="font-mono">SQLite WASM</span>
        </div>
      </footer>
    );
  }

  // Determine save status display
  const getSaveStatusDisplay = () => {
    switch (persistenceStatus) {
      case 'saved':
        return {
          icon: <SavedIcon />,
          text: 'Saved',
          className: 'text-green-700',
        };
      case 'unsaved':
        return {
          icon: <UnsavedIcon />,
          text: 'Unsaved',
          className: 'text-amber-700',
        };
      case 'saving':
        return {
          icon: <SavingIcon />,
          text: 'Saving...',
          className: 'text-navy-600',
        };
      case 'error':
        return {
          icon: <ErrorIcon />,
          text: 'Error',
          className: 'text-red-700 cursor-pointer hover:underline',
        };
      default:
        return {
          icon: <SavedIcon />,
          text: 'Saved',
          className: 'text-green-700',
        };
    }
  };

  const saveStatus = getSaveStatusDisplay();

  // Storage mode display
  const storageModeDisplay = storageMode === 'opfs' ? 'OPFS' : 'IndexedDB';
  const storageModeTooltip =
    storageMode === 'opfs'
      ? 'Origin Private File System - fast, persistent storage'
      : 'IndexedDB fallback - compatible but slower';

  // Lock status display (only show when relevant)
  const showLockStatus = lockHolder !== null;
  const lockStatusDisplay = isReadOnly ? 'Read-only' : 'Write';
  const lockStatusTooltip = isReadOnly
    ? 'Another tab holds the write lock'
    : 'This tab holds the write lock';

  // Table count from schema
  const tableCount = schema?.tables.length ?? 0;

  return (
    <footer
      className="h-7 bg-white border-t border-navy-200 flex items-center px-4 text-xs shrink-0"
      data-testid="status-bar"
      role="status"
      aria-label="Application status"
    >
      {/* Left section: Save status */}
      <div className="flex items-center gap-4">
        {/* Save status indicator - live region for screen readers */}
        <button
          type="button"
          className={`flex items-center gap-1.5 font-medium ${saveStatus.className}`}
          onClick={handleErrorClick}
          disabled={persistenceStatus !== 'error'}
          data-testid="save-status"
          aria-label={`Save status: ${saveStatus.text}`}
          aria-live="polite"
          aria-atomic="true"
        >
          {saveStatus.icon}
          <span>{saveStatus.text}</span>
        </button>

        {/* Error details popover */}
        {showErrorDetails && persistenceError && (
          <div
            className="absolute bottom-8 left-4 bg-white border border-red-200 rounded shadow-lg p-3 max-w-sm z-50"
            data-testid="error-details"
          >
            <div className="flex items-start gap-2">
              <ErrorIcon />
              <div className="flex-1">
                <p className="font-medium text-red-800">Save Error</p>
                <p className="text-red-600 mt-1">{persistenceError}</p>
              </div>
              <button
                type="button"
                onClick={() => setShowErrorDetails(false)}
                className="text-navy-400 hover:text-navy-600"
                aria-label="Close error details"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        )}

        {/* Divider */}
        <div className="w-px h-4 bg-navy-200" />

        {/* Storage mode badge */}
        <span
          className="px-1.5 py-0.5 bg-navy-100 text-navy-700 rounded text-[10px] font-semibold uppercase tracking-wide"
          title={storageModeTooltip}
          data-testid="storage-mode"
        >
          {storageModeDisplay}
        </span>

        {/* Lock status (when multi-tab) */}
        {showLockStatus && (
          <>
            <div className="w-px h-4 bg-navy-200" />
            <span
              className={`flex items-center gap-1 font-medium ${
                isReadOnly ? 'text-navy-500' : 'text-green-700'
              }`}
              title={lockStatusTooltip}
              data-testid="lock-status"
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  isReadOnly ? 'bg-navy-400' : 'bg-green-500'
                }`}
              />
              {lockStatusDisplay}
            </span>
          </>
        )}
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Right section: Database info */}
      <div className="flex items-center gap-3 text-navy-500">
        {/* File size */}
        {dbFileSize !== null && dbFileSize !== undefined && (
          <span data-testid="db-file-size" title="Database file size">
            {formatBytes(dbFileSize)}
          </span>
        )}

        {/* Table count */}
        <span data-testid="table-count" title="Number of tables">
          {tableCount} {tableCount === 1 ? 'table' : 'tables'}
        </span>

        {/* Current table row count */}
        {currentTable && currentTableRowCount !== null && currentTableRowCount !== undefined && (
          <span data-testid="row-count" title={`Rows in ${currentTable}`}>
            {formatNumber(currentTableRowCount)} rows
          </span>
        )}

        {/* Divider before SQLite WASM label */}
        <div className="w-px h-4 bg-navy-200" />

        {/* SQLite WASM label */}
        <span className="font-mono">SQLite WASM</span>
      </div>
    </footer>
  );
}

export default StatusBar;
