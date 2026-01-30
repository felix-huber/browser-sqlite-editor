/**
 * OpenDatabaseButton Component
 *
 * A toolbar button that opens a file picker for SQLite database files.
 *
 * Features:
 * - File System Access API where available (Chrome/Edge)
 * - Fallback to <input type="file"> for Firefox/Safari
 * - Accepts: .sqlite, .db, .sqlite3
 * - Icon: folder-open
 * - Tooltip: "Open Database (Cmd/Ctrl+O)"
 */

import { useCallback, useRef, useEffect } from 'react';
import { isMac } from '../../lib/platform/keyboard';

// File System Access API types (not in standard TypeScript lib)
interface FilePickerAcceptType {
  description?: string;
  accept: Record<string, string[]>;
}

interface FilePickerOptions {
  types?: FilePickerAcceptType[];
  multiple?: boolean;
  excludeAcceptAllOption?: boolean;
}

interface FileSystemFileHandle {
  getFile(): Promise<File>;
}

// Extend Window to include showOpenFilePicker
declare global {
  interface Window {
    showOpenFilePicker?: (options?: FilePickerOptions) => Promise<FileSystemFileHandle[]>;
  }
}

/** MIME types for file input accept attribute */
const ACCEPTED_FILE_TYPES =
  '.sqlite,.db,.sqlite3,application/x-sqlite3,application/vnd.sqlite3';

/** File picker options for File System Access API */
const FILE_PICKER_OPTIONS: FilePickerOptions = {
  types: [
    {
      description: 'SQLite Database',
      accept: {
        'application/x-sqlite3': ['.sqlite', '.db', '.sqlite3'],
      },
    },
  ],
  multiple: false,
};

export interface OpenDatabaseButtonProps {
  /** Callback when a SQLite file is selected */
  onFileSelect?: (file: File) => void;
  /** Whether to show as prominent CTA (larger style) */
  prominent?: boolean;
  /** Additional CSS classes */
  className?: string;
  /** Whether component is disabled */
  disabled?: boolean;
  /** Test ID override (default: 'open-database-button') */
  testId?: string;
  /** Test ID for the hidden file input (default: 'open-database-file-input') */
  fileInputTestId?: string;
}

/**
 * Detects if running on macOS (for keyboard shortcut display)
 */
/**
 * Check if File System Access API is available
 */
function hasFileSystemAccess(): boolean {
  return (
    typeof window !== 'undefined' &&
    'showOpenFilePicker' in window &&
    typeof window.showOpenFilePicker === 'function'
  );
}

/**
 * OpenDatabaseButton component for toolbar file selection
 */
export function OpenDatabaseButton({
  onFileSelect,
  prominent = false,
  className = '',
  disabled = false,
  testId = 'open-database-button',
  fileInputTestId = 'open-database-file-input',
}: OpenDatabaseButtonProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Format keyboard shortcut based on platform
  const shortcutKey = isMac() ? '⌘O' : 'Ctrl+O';

  // Handle file selection from File System Access API
  const handleFileSystemAccess = useCallback(async () => {
    if (!hasFileSystemAccess() || !window.showOpenFilePicker) return false;

    try {
      const [fileHandle] = await window.showOpenFilePicker(FILE_PICKER_OPTIONS);
      const file = await fileHandle.getFile();
      onFileSelect?.(file);
      return true;
    } catch (err) {
      // User cancelled or error
      if (err instanceof Error && err.name === 'AbortError') {
        // User cancelled - ignore
        return true;
      }
      // Other error - fall through to use fallback
      return false;
    }
  }, [onFileSelect]);

  // Handle file selection from input element (fallback)
  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && files.length > 0) {
        onFileSelect?.(files[0]);
      }
      // Reset input so same file can be selected again
      e.target.value = '';
    },
    [onFileSelect]
  );

  // Handle button click
  const handleClick = useCallback(async () => {
    if (disabled) return;

    // Try File System Access API first
    if (hasFileSystemAccess()) {
      const handled = await handleFileSystemAccess();
      if (handled) return;
    }

    // Fallback to file input
    fileInputRef.current?.click();
  }, [disabled, handleFileSystemAccess]);

  // Keyboard shortcut: Cmd/Ctrl+O
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (disabled) return;

      const isMeta = isMac() ? e.metaKey : e.ctrlKey;
      if (isMeta && e.key === 'o') {
        e.preventDefault();
        handleClick();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [disabled, handleClick]);

  // Folder-open icon
  const FolderOpenIcon = (
    <svg
      className={prominent ? 'w-5 h-5' : 'w-4 h-4'}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z"
      />
    </svg>
  );

  // Style variants
  const baseClasses = prominent
    ? 'px-5 py-2.5 bg-white text-navy-700 font-medium rounded-lg border border-navy-300 hover:bg-navy-50 focus:outline-none focus:ring-2 focus:ring-navy-600 focus:ring-offset-2 transition-colors flex items-center gap-2'
    : 'px-3 py-1.5 text-sm font-medium text-navy-700 hover:bg-navy-100 rounded transition-colors flex items-center gap-2';

  const disabledClasses = disabled ? 'opacity-50 cursor-not-allowed' : '';

  return (
    <>
      <button
        onClick={handleClick}
        className={`${baseClasses} ${disabledClasses} ${className}`}
        disabled={disabled}
        title={`Open Database (${shortcutKey})`}
        aria-label={`Open Database (${shortcutKey})`}
        data-testid={testId}
      >
        {FolderOpenIcon}
        <span>Open Database</span>
        {prominent && (
          <span className="text-navy-400 text-sm ml-1">{shortcutKey}</span>
        )}
      </button>

      {/* Hidden file input for fallback */}
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_FILE_TYPES}
        onChange={handleInputChange}
        className="hidden"
        data-testid={fileInputTestId}
      />
    </>
  );
}

export default OpenDatabaseButton;
