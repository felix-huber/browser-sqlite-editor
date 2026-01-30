/**
 * DropZone Component
 *
 * A file drop zone with visual feedback and file type routing.
 *
 * Features:
 * - Dashed border drop area with drag-over visual state
 * - File type routing (SQLite → import, CSV/JSON → data import dialog)
 * - File validation (max size, single file, magic bytes for SQLite)
 * - Security: only processes dataTransfer.files, not URLs or text
 * - Animations: success pulse, error shake
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { formatBytes } from '../format/bytes';

/** Maximum file size in bytes (500MB) */
const MAX_FILE_SIZE = 500 * 1024 * 1024;

/** SQLite magic bytes (first 16 bytes of SQLite 3 file) */
const SQLITE_MAGIC = 'SQLite format 3\0';

/** File type categories for routing */
export type FileCategory = 'sqlite' | 'csv' | 'json' | 'unsupported';

/** Result of file validation */
export interface FileValidationResult {
  valid: boolean;
  file: File | null;
  category: FileCategory;
  error?: string;
}

/** Props for DropZone component */
export interface DropZoneProps {
  /** Callback when SQLite file is dropped (routes to SQLite import) */
  onSqliteFile?: (file: File) => void;
  /** Callback when CSV file is dropped (routes to data import dialog) */
  onCsvFile?: (file: File) => void;
  /** Callback when JSON file is dropped (routes to data import dialog) */
  onJsonFile?: (file: File) => void;
  /** Callback for validation errors (shows toast) */
  onError?: (message: string) => void;
  /** Callback for warnings (e.g., multiple files) */
  onWarning?: (message: string) => void;
  /** Max file size in bytes (default: 500MB) */
  maxFileSize?: number;
  /** Whether component is disabled */
  disabled?: boolean;
  /** Additional CSS classes */
  className?: string;
  /** Children to render inside the drop zone */
  children?: React.ReactNode;
}

/**
 * Determine file category based on extension
 */
function getFileCategory(file: File): FileCategory {
  const name = file.name.toLowerCase();
  if (name.endsWith('.sqlite') || name.endsWith('.db') || name.endsWith('.sqlite3')) {
    return 'sqlite';
  }
  if (name.endsWith('.csv')) {
    return 'csv';
  }
  if (name.endsWith('.json')) {
    return 'json';
  }
  return 'unsupported';
}

/**
 * Check if file data starts with SQLite magic bytes
 */
async function checkSqliteMagic(file: File): Promise<boolean> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const buffer = reader.result as ArrayBuffer;
      const bytes = new Uint8Array(buffer);
      const header = String.fromCharCode(...bytes.slice(0, 16));
      resolve(header === SQLITE_MAGIC);
    };
    reader.onerror = () => resolve(false);
    // Read only the first 16 bytes
    reader.readAsArrayBuffer(file.slice(0, 16));
  });
}

/**
 * DropZone component for file drag-and-drop with visual feedback
 */
export function DropZone({
  onSqliteFile,
  onCsvFile,
  onJsonFile,
  onError,
  onWarning,
  maxFileSize = MAX_FILE_SIZE,
  disabled = false,
  className = '',
  children,
}: DropZoneProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [animationState, setAnimationState] = useState<'idle' | 'success' | 'error'>('idle');
  const dragCounterRef = useRef(0);
  const animationTimeoutRef = useRef<ReturnType<typeof setTimeout>>();

  // Clear animation timeout on unmount
  useEffect(() => {
    return () => {
      if (animationTimeoutRef.current) {
        clearTimeout(animationTimeoutRef.current);
      }
    };
  }, []);

  /**
   * Trigger animation and reset after delay
   */
  const triggerAnimation = useCallback((state: 'success' | 'error') => {
    setAnimationState(state);
    if (animationTimeoutRef.current) {
      clearTimeout(animationTimeoutRef.current);
    }
    animationTimeoutRef.current = setTimeout(() => {
      setAnimationState('idle');
    }, 500);
  }, []);

  /**
   * Validate and process a single file
   */
  const processFile = useCallback(
    async (file: File): Promise<FileValidationResult> => {
      const category = getFileCategory(file);

      // Check file extension first
      if (category === 'unsupported') {
        return {
          valid: false,
          file: null,
          category,
          error: `Unsupported file type: ${file.name.split('.').pop() || 'unknown'}`,
        };
      }

      // Check file size
      if (file.size > maxFileSize) {
        return {
          valid: false,
          file: null,
          category,
          error: `File too large: ${formatBytes(file.size)} (max ${formatBytes(maxFileSize)})`,
        };
      }

      // For SQLite files, verify magic bytes
      if (category === 'sqlite') {
        const isValidSqlite = await checkSqliteMagic(file);
        if (!isValidSqlite) {
          return {
            valid: false,
            file: null,
            category,
            error: `Invalid SQLite file: ${file.name} does not appear to be a valid SQLite database`,
          };
        }
      }

      return {
        valid: true,
        file,
        category,
      };
    },
    [maxFileSize]
  );

  /**
   * Handle drag enter event
   */
  const handleDragEnter = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (disabled) return;

      dragCounterRef.current++;
      // Only activate if Files are being dragged (not URLs or text)
      if (e.dataTransfer.types.includes('Files')) {
        setIsDragOver(true);
      }
    },
    [disabled]
  );

  /**
   * Handle drag leave event
   */
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDragOver(false);
    }
  }, []);

  /**
   * Handle drag over event (required to allow drop)
   */
  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!disabled) {
        e.dataTransfer.dropEffect = 'copy';
      }
    },
    [disabled]
  );

  /**
   * Handle drop event
   */
  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);
      dragCounterRef.current = 0;

      if (disabled) return;

      // Security: only process dataTransfer.files, not URLs or text
      const files = Array.from(e.dataTransfer.files);

      if (files.length === 0) {
        onError?.('No valid files dropped');
        triggerAnimation('error');
        return;
      }

      // Warn about multiple files
      if (files.length > 1) {
        onWarning?.('Multiple files dropped. Only the first file will be processed.');
      }

      // Process only the first file
      const file = files[0];
      const result = await processFile(file);

      if (!result.valid || !result.file) {
        onError?.(result.error || 'File validation failed');
        triggerAnimation('error');
        return;
      }

      // Route based on file category
      triggerAnimation('success');
      switch (result.category) {
        case 'sqlite':
          onSqliteFile?.(result.file);
          break;
        case 'csv':
          onCsvFile?.(result.file);
          break;
        case 'json':
          onJsonFile?.(result.file);
          break;
      }
    },
    [disabled, processFile, onSqliteFile, onCsvFile, onJsonFile, onError, onWarning, triggerAnimation]
  );

  // Compute CSS classes based on state
  const baseClasses = 'w-full p-8 border-2 rounded-xl transition-all duration-200';
  const stateClasses = isDragOver
    ? 'border-solid border-navy-600 bg-navy-50'
    : 'border-dashed border-navy-300 hover:border-navy-400';
  const animationClasses =
    animationState === 'success'
      ? 'drop-zone-success'
      : animationState === 'error'
        ? 'drop-zone-shake'
        : '';
  const disabledClasses = disabled ? 'opacity-50 cursor-not-allowed' : '';

  return (
    <div
      className={`${baseClasses} ${stateClasses} ${animationClasses} ${disabledClasses} ${className}`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      data-testid="drop-zone"
      data-drag-over={isDragOver}
      data-animation={animationState}
      role="region"
      aria-label="File drop zone"
      aria-disabled={disabled}
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
            <p className="text-navy-600 font-medium" data-testid="drop-zone-active-text">
              Drop file here
            </p>
          </>
        ) : children ? (
          children
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
            <p className="text-sm text-navy-400">Supports .sqlite, .db, .sqlite3, .csv, .json</p>
          </>
        )}
      </div>
    </div>
  );
}

export default DropZone;
