/**
 * Welcome / Empty State Screen
 *
 * Shown when no database is selected. Features:
 * - Large database icon
 * - "New Database" and "Import Database" CTAs
 * - Drop zone for drag-and-drop file import
 * - Keyboard shortcuts (Cmd/Ctrl+N for new database)
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { useDatabases } from '../../store';

/** Accepted file extensions for import */
const ACCEPTED_EXTENSIONS = ['.sqlite', '.db', '.sqlite3', '.csv', '.json'];

/** MIME types for file input accept attribute */
const ACCEPTED_MIME_TYPES =
  '.sqlite,.db,.sqlite3,.csv,.json,application/x-sqlite3,application/vnd.sqlite3,text/csv,application/json';

export interface WelcomeProps {
  /** Callback when "New Database" is clicked */
  onNewDatabase?: () => void;
  /** Callback when file(s) are imported via picker or drop */
  onImportFiles?: (files: File[]) => void;
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
  onImportFiles,
  onSelectDatabase,
  showRecentDatabases = true,
}: WelcomeProps) {
  const databases = useDatabases();
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);

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

  // Handle drag enter
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (e.dataTransfer.types.includes('Files')) {
      setIsDragOver(true);
    }
  }, []);

  // Handle drag leave
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDragOver(false);
    }
  }, []);

  // Handle drag over (required to allow drop)
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  // Handle drop
  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);
      dragCounterRef.current = 0;

      const files = Array.from(e.dataTransfer.files);
      const validFiles = files.filter(isValidFile);

      if (validFiles.length > 0) {
        onImportFiles?.(validFiles);
      }
    },
    [onImportFiles]
  );

  // Handle file input change
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

  // Open file picker
  const handleImportClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

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
            <span className="ml-2 text-navy-300 text-sm">{shortcutKey}</span>
          </button>

          <button
            onClick={handleImportClick}
            className="px-5 py-2.5 bg-white text-navy-700 font-medium rounded-lg border border-navy-300 hover:bg-navy-50 focus:outline-none focus:ring-2 focus:ring-navy-600 focus:ring-offset-2 transition-colors"
            data-testid="import-database-button"
          >
            Import Database
          </button>

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

        {/* Drop Zone */}
        <div
          className={`w-full p-8 border-2 border-dashed rounded-xl transition-colors ${
            isDragOver
              ? 'border-navy-600 bg-navy-50'
              : 'border-navy-300 hover:border-navy-400'
          }`}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          data-testid="drop-zone"
          role="region"
          aria-label="File drop zone"
        >
          <div className="flex flex-col items-center gap-3">
            {isDragOver ? (
              <>
                <svg
                  className="w-8 h-8 text-navy-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3-3m0 0l3 3m-3-3v12"
                  />
                </svg>
                <p className="text-navy-600 font-medium">Drop to import</p>
              </>
            ) : (
              <>
                <svg
                  className="w-8 h-8 text-navy-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                  />
                </svg>
                <p className="text-navy-500">Drop a .sqlite file here</p>
                <p className="text-sm text-navy-400">
                  Supports .sqlite, .db, .sqlite3, .csv, .json
                </p>
              </>
            )}
          </div>
        </div>

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
    </div>
  );
}

export default Welcome;
