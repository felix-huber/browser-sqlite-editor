/**
 * Welcome / Empty State Screen
 *
 * Shown when no database is selected. Features:
 * - Large database icon
 * - "New Database" and "Import Database" CTAs
 * - Drop zone for drag-and-drop file import with file type routing
 * - Keyboard shortcuts (Cmd/Ctrl+N for new database)
 */

import { useCallback, useRef, useEffect, useState } from 'react';
import { useDatabases } from '../../store';
import { DropZone } from '../common/DropZone';
import { OpenDatabaseButton } from '../layout/OpenDatabaseButton';

/** MIME types for file input accept attribute */
const ACCEPTED_MIME_TYPES =
  '.sqlite,.db,.sqlite3,.csv,.json,application/x-sqlite3,application/vnd.sqlite3,text/csv,application/json';

/** Accepted file extensions for import (for file picker validation) */
const ACCEPTED_EXTENSIONS = ['.sqlite', '.db', '.sqlite3', '.csv', '.json'];

export interface WelcomeProps {
  /** Callback when "New Database" is clicked */
  onNewDatabase?: () => void;
  /** Callback when SQLite file is imported (direct database import) */
  onSqliteImport?: (file: File) => void;
  /** Callback when CSV file is imported (routes to data import dialog) */
  onCsvImport?: (file: File) => void;
  /** Callback when JSON file is imported (routes to data import dialog) */
  onJsonImport?: (file: File) => void;
  /** Legacy callback for file(s) import via picker (supports multiple) */
  onImportFiles?: (files: File[]) => void;
  /** Callback to open the bundled sample database */
  onOpenSample?: () => void;
  /** Callback when a recent database is selected */
  onSelectDatabase?: (dbName: string) => void;
  /** Whether to show recent databases list */
  showRecentDatabases?: boolean;
}

/**
 * Checks if a file has a valid extension for import
 */
function isValidFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return ACCEPTED_EXTENSIONS.some((ext) => name.endsWith(ext));
}

/**
 * Detects if running on macOS (for keyboard shortcut display)
 */
function isMac(): boolean {
  return typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);
}

export function Welcome({
  onNewDatabase,
  onSqliteImport,
  onCsvImport,
  onJsonImport,
  onImportFiles,
  onOpenSample,
  onSelectDatabase,
  showRecentDatabases = true,
}: WelcomeProps) {
  const databases = useDatabases();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [toastMessage, setToastMessage] = useState<{ type: 'error' | 'warning'; text: string } | null>(null);

  // Auto-dismiss toast after 4 seconds
  useEffect(() => {
    if (toastMessage) {
      const timeout = setTimeout(() => setToastMessage(null), 4000);
      return () => clearTimeout(timeout);
    }
  }, [toastMessage]);

  // Keyboard shortcut: Cmd/Ctrl+N for new database
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMeta = isMac() ? e.metaKey : e.ctrlKey;
      if (isMeta && e.key === 'n') {
        e.preventDefault();
        onNewDatabase?.();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onNewDatabase]);

  // Handle SQLite file from DropZone
  const handleSqliteFile = useCallback(
    (file: File) => {
      if (onSqliteImport) {
        onSqliteImport(file);
      } else if (onImportFiles) {
        // Fallback to legacy handler
        onImportFiles([file]);
      }
    },
    [onSqliteImport, onImportFiles]
  );

  // Handle CSV file from DropZone
  const handleCsvFile = useCallback(
    (file: File) => {
      if (onCsvImport) {
        onCsvImport(file);
      } else if (onImportFiles) {
        // Fallback to legacy handler
        onImportFiles([file]);
      }
    },
    [onCsvImport, onImportFiles]
  );

  // Handle JSON file from DropZone
  const handleJsonFile = useCallback(
    (file: File) => {
      if (onJsonImport) {
        onJsonImport(file);
      } else if (onImportFiles) {
        // Fallback to legacy handler
        onImportFiles([file]);
      }
    },
    [onJsonImport, onImportFiles]
  );

  // Handle error from DropZone
  const handleDropError = useCallback((message: string) => {
    setToastMessage({ type: 'error', text: message });
  }, []);

  // Handle warning from DropZone
  const handleDropWarning = useCallback((message: string) => {
    setToastMessage({ type: 'warning', text: message });
  }, []);

  // Handle file input change (file picker)
  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && files.length > 0) {
        const validFiles = Array.from(files).filter(isValidFile);
        if (validFiles.length > 0) {
          onImportFiles?.(validFiles);
        }
      }
      // Reset input so same file can be selected again
      e.target.value = '';
    },
    [onImportFiles]
  );

  const shortcutKey = isMac() ? '⌘N' : 'Ctrl+N';
  const recentDatabases = showRecentDatabases ? databases.slice(0, 5) : [];

  return (
    <div
      className="flex-1 flex flex-col items-center justify-center p-8 min-h-0"
      data-testid="welcome-screen"
    >
      <div className="max-w-md w-full flex flex-col items-center gap-8">
        {/* Database Icon */}
        <div className="w-20 h-20 rounded-2xl bg-navy-100 flex items-center justify-center">
          <svg
            className="w-10 h-10 text-navy-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4"
            />
          </svg>
        </div>

        {/* Headlines */}
        <div className="text-center">
          <h1 className="text-2xl font-semibold text-navy-900 mb-2">
            Welcome to SQLite Editor
          </h1>
          <p className="text-navy-600">
            Create a new database or import an existing file
          </p>
        </div>

        {/* Call to Actions */}
        <div className="flex gap-3">
          <button
            onClick={onNewDatabase}
            className="px-5 py-2.5 bg-navy-600 text-white font-medium rounded-lg hover:bg-navy-700 focus:outline-none focus:ring-2 focus:ring-navy-600 focus:ring-offset-2 transition-colors"
            data-testid="new-database-button"
          >
            New Database
            <span className="ml-2 text-white text-sm opacity-80">{shortcutKey}</span>
          </button>

          <OpenDatabaseButton
            onFileSelect={handleSqliteFile}
            prominent
            testId="import-database-button"
            fileInputTestId="welcome-open-database-file-input"
          />

          {/* Legacy file input for CSV/JSON imports */}
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_MIME_TYPES}
            onChange={handleFileInputChange}
            className="hidden"
            data-testid="file-input"
            multiple
          />
        </div>

        {onOpenSample && (
          <button
            type="button"
            onClick={onOpenSample}
            className="text-sm text-navy-600 hover:text-navy-800 underline underline-offset-4"
            data-testid="open-sakila-sample-button"
          >
            Open Sakila sample database
          </button>
        )}

        {/* Drop Zone */}
        <DropZone
          onSqliteFile={handleSqliteFile}
          onCsvFile={handleCsvFile}
          onJsonFile={handleJsonFile}
          onError={handleDropError}
          onWarning={handleDropWarning}
        />

        {/* Recent Databases */}
        {recentDatabases.length > 0 && (
          <div className="w-full" data-testid="recent-databases">
            <h2 className="text-sm font-medium text-navy-600 mb-3">
              Recent databases
            </h2>
            <ul className="space-y-1">
              {recentDatabases.map((db) => (
                <li key={db.name}>
                  <button
                    onClick={() => onSelectDatabase?.(db.name)}
                    className="w-full px-3 py-2 text-left text-sm text-navy-700 hover:bg-navy-100 rounded-lg transition-colors flex items-center gap-2"
                    data-testid={`recent-db-${db.name}`}
                  >
                    <svg
                      className="w-4 h-4 text-navy-400 shrink-0"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4"
                      />
                    </svg>
                    <span className="truncate">{db.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Toast Notification */}
      {toastMessage && (
        <div
          className={`fixed bottom-4 left-1/2 -translate-x-1/2 px-4 py-3 rounded-lg shadow-lg flex items-center gap-2 animate-slide-up ${
            toastMessage.type === 'error'
              ? 'bg-red-50 text-red-800 border border-red-200'
              : 'bg-amber-50 text-amber-800 border border-amber-200'
          }`}
          role="alert"
          data-testid={`toast-${toastMessage.type}`}
        >
          {toastMessage.type === 'error' ? (
            <svg
              className="w-5 h-5 text-red-500 shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          ) : (
            <svg
              className="w-5 h-5 text-amber-500 shrink-0"
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
          )}
          <span className="text-sm font-medium">{toastMessage.text}</span>
          <button
            onClick={() => setToastMessage(null)}
            className={`ml-2 p-1 rounded-full transition-colors ${
              toastMessage.type === 'error'
                ? 'hover:bg-red-100'
                : 'hover:bg-amber-100'
            }`}
            aria-label="Dismiss"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}

export default Welcome;
