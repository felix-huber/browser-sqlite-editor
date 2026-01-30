/**
 * ImportDialog Component
 *
 * A modal dialog for importing CSV/JSON files into the database.
 *
 * Features:
 * - File picker: click to browse or drag-and-drop
 * - Format detection: auto-detect CSV vs JSON from file extension and content
 * - Format override: manual selector if auto-detect wrong
 * - Target selector: create new table or append to existing
 * - Table name input: for new table creation
 * - Read-only guard: dialog inaccessible when isReadOnly
 * - Progress indication: show parsing progress for large files
 *
 * States:
 * 1. Initial: file picker shown
 * 2. File selected: format detected, options shown
 * 3. Parsing: progress bar while reading file
 * 4. Preview: show first N rows before import
 * 5. Importing: progress while inserting
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { parseCSVFile, type ParseResult as CSVParseResult } from '../../core/io/csv';
import { parseJSONFile, type ParseResult as JSONParseResult } from '../../core/io/json';
import { ProgressBar } from '../../shared/components/ProgressBar';
import { ImportPreview, type PreviewColumn } from './ImportPreview';

export type ImportFormat = 'csv' | 'json' | 'auto';
export type ImportTarget = 'new' | 'append';

export interface ImportDialogProps {
  /** Whether the dialog is open */
  isOpen: boolean;
  /** Callback when the dialog should close */
  onClose: () => void;
  /** Callback when import is confirmed */
  onImport: (options: ImportOptions) => Promise<void>;
  /** Optional initial file to prefill and parse on open */
  initialFile?: File | null;
  /** List of existing table names (for append option) */
  existingTables?: string[];
  /** Whether in read-only mode (dialog will not render if true) */
  isReadOnly?: boolean;
}

export interface ImportOptions {
  /** Parsed columns */
  columns: Array<{ name: string; type: string }>;
  /** Parsed row data */
  rows: unknown[][];
  /** Target table name */
  tableName: string;
  /** Whether appending to existing table */
  appendToExisting: boolean;
  /** Original file for reference */
  file: File;
}

/** Number of preview rows to show */
const PREVIEW_ROWS = 10;

/** Minimum file size to show parsing progress (100KB) */
const PROGRESS_THRESHOLD = 100 * 1024;

type DialogState = 'initial' | 'parsing' | 'preview' | 'importing' | 'error';

interface ParsedData {
  columns: PreviewColumn[];
  rows: unknown[][];
}

/**
 * Detect format from file extension
 */
function detectFormatFromExtension(filename: string): ImportFormat {
  const ext = filename.toLowerCase().split('.').pop();
  if (ext === 'csv' || ext === 'tsv') return 'csv';
  if (ext === 'json') return 'json';
  return 'auto';
}

/**
 * Detect format from file content (first bytes)
 */
async function detectFormatFromContent(file: File): Promise<ImportFormat> {
  // Read first 1KB to detect format
  const slice = file.slice(0, 1024);
  const text = await slice.text();
  const trimmed = text.trim();

  // JSON typically starts with [ or {
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    return 'json';
  }

  // Default to CSV for anything else
  return 'csv';
}

/**
 * Generate a default table name from filename
 */
function generateTableName(filename: string): string {
  // Remove extension
  let name = filename.replace(/\.(csv|tsv|json)$/i, '');
  // Replace invalid characters with underscores
  name = name.replace(/[^a-zA-Z0-9_]/g, '_');
  // Ensure it starts with a letter or underscore
  if (/^[0-9]/.test(name)) {
    name = '_' + name;
  }
  // Truncate if too long
  if (name.length > 64) {
    name = name.substring(0, 64);
  }
  return name || 'imported_table';
}

/**
 * Validate table name
 */
function validateTableName(name: string, existingTables: string[], isAppend: boolean): string | null {
  const trimmed = name.trim();
  if (!trimmed) {
    return 'Table name is required';
  }
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(trimmed)) {
    return 'Table name must start with a letter or underscore and contain only letters, numbers, and underscores';
  }
  if (trimmed.length > 64) {
    return 'Table name is too long (max 64 characters)';
  }
  // Check for duplicates only when creating new table
  if (!isAppend && existingTables.some(t => t.toLowerCase() === trimmed.toLowerCase())) {
    return 'A table with this name already exists';
  }
  // Check for existence when appending
  if (isAppend && !existingTables.some(t => t.toLowerCase() === trimmed.toLowerCase())) {
    return 'Table does not exist';
  }
  return null;
}

/**
 * ImportDialog component
 */
export function ImportDialog({
  isOpen,
  onClose,
  onImport,
  initialFile = null,
  existingTables = [],
  isReadOnly = false,
}: ImportDialogProps) {
  // File and format state
  const [file, setFile] = useState<File | null>(null);
  const [format, setFormat] = useState<ImportFormat>('auto');
  const [detectedFormat, setDetectedFormat] = useState<ImportFormat>('auto');

  // Target state
  const [target, setTarget] = useState<ImportTarget>('new');
  const [tableName, setTableName] = useState('');
  const [tableNameError, setTableNameError] = useState<string | null>(null);

  // Dialog state
  const [dialogState, setDialogState] = useState<DialogState>('initial');
  const [parseError, setParseError] = useState<string | null>(null);
  const [parseProgress, setParseProgress] = useState(0);
  const [importProgress, setImportProgress] = useState(0);

  // Parsed data
  const [parsedData, setParsedData] = useState<ParsedData | null>(null);

  // Drag state
  const [isDragging, setIsDragging] = useState(false);

  // Refs
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);
  const initialFileRef = useRef<File | null>(null);

  // Reset state when dialog opens/closes
  useEffect(() => {
    if (isOpen) {
      setFile(null);
      setFormat('auto');
      setDetectedFormat('auto');
      setTarget('new');
      setTableName('');
      setTableNameError(null);
      setDialogState('initial');
      setParseError(null);
      setParseProgress(0);
      setImportProgress(0);
      setParsedData(null);
      setIsDragging(false);
      initialFileRef.current = null;
    }
  }, [isOpen]);

  // Validate table name on change
  useEffect(() => {
    if (tableName) {
      const error = validateTableName(tableName, existingTables, target === 'append');
      setTableNameError(error);
    } else {
      setTableNameError(null);
    }
  }, [tableName, existingTables, target]);

  // Handle file selection
  const handleFileSelect = useCallback(async (selectedFile: File) => {
    setFile(selectedFile);
    setParseError(null);

    // Detect format from extension first
    let detected = detectFormatFromExtension(selectedFile.name);

    // If extension doesn't give a clear answer, check content
    if (detected === 'auto') {
      detected = await detectFormatFromContent(selectedFile);
    }

    setDetectedFormat(detected);
    setFormat(detected);

    // Generate default table name
    const defaultName = generateTableName(selectedFile.name);
    setTableName(defaultName);

    // Start parsing
    setDialogState('parsing');
    setParseProgress(0);

    try {
      let result: CSVParseResult | JSONParseResult;

      if (detected === 'json') {
        result = await parseJSONFile(selectedFile);
        if ('isValid' in result && !result.isValid) {
          throw new Error(result.error || 'Invalid JSON file');
        }
      } else {
        result = await parseCSVFile(selectedFile);
      }

      // Simulate progress for small files (parsing is usually instant)
      if (selectedFile.size < PROGRESS_THRESHOLD) {
        setParseProgress(100);
      }

      // Convert columns to PreviewColumn format (with originalName)
      const previewColumns: PreviewColumn[] = result.columns.map((col) => ({
        name: col.name,
        originalName: 'originalName' in col ? (col as { originalName?: string }).originalName : col.name,
        type: col.type,
      }));

      setParsedData({
        columns: previewColumns,
        rows: result.rows,
      });
      setDialogState('preview');
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Failed to parse file');
      setDialogState('error');
    }
  }, []);

  useEffect(() => {
    if (!isOpen || !initialFile) return;
    if (initialFileRef.current === initialFile) return;
    initialFileRef.current = initialFile;
    void handleFileSelect(initialFile);
  }, [handleFileSelect, initialFile, isOpen]);

  // Handle file input change
  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      handleFileSelect(selectedFile);
    }
  }, [handleFileSelect]);

  // Handle drop zone click
  const handleDropZoneClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  // Handle drop zone keyboard activation (Enter/Space)
  const handleDropZoneKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInputRef.current?.click();
    }
  }, []);

  // Drag and drop handlers
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Only set isDragging to false if we're leaving the drop zone entirely
    // Check if the related target (element being entered) is outside the drop zone
    const relatedTarget = e.relatedTarget as Node | null;
    if (!relatedTarget || !e.currentTarget.contains(relatedTarget)) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) {
      handleFileSelect(droppedFile);
    }
  }, [handleFileSelect]);

  // Handle format override
  const handleFormatChange = useCallback(async (newFormat: ImportFormat) => {
    if (!file || newFormat === format) return;

    setFormat(newFormat);
    setDialogState('parsing');
    setParseError(null);
    setParseProgress(0);

    try {
      let result: CSVParseResult | JSONParseResult;

      if (newFormat === 'json') {
        result = await parseJSONFile(file);
        if ('isValid' in result && !result.isValid) {
          throw new Error(result.error || 'Invalid JSON file');
        }
      } else {
        result = await parseCSVFile(file);
      }

      setParseProgress(100);

      // Convert columns to PreviewColumn format (with originalName)
      const previewColumns: PreviewColumn[] = result.columns.map((col) => ({
        name: col.name,
        originalName: 'originalName' in col ? (col as { originalName?: string }).originalName : col.name,
        type: col.type,
      }));

      setParsedData({
        columns: previewColumns,
        rows: result.rows,
      });
      setDialogState('preview');
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Failed to parse file');
      setDialogState('error');
    }
  }, [file, format]);

  // Handle target change
  const handleTargetChange = useCallback((newTarget: ImportTarget) => {
    setTarget(newTarget);
    if (newTarget === 'append' && existingTables.length > 0) {
      setTableName(existingTables[0]);
    } else if (newTarget === 'new' && file) {
      setTableName(generateTableName(file.name));
    }
  }, [existingTables, file]);

  // Handle column changes (type override)
  const handleColumnsChange = useCallback((newColumns: PreviewColumn[]) => {
    if (!parsedData) return;
    setParsedData({
      ...parsedData,
      columns: newColumns,
    });
  }, [parsedData]);

  // Handle column rename
  const handleColumnRename = useCallback((index: number, newName: string) => {
    if (!parsedData) return;
    const newColumns = parsedData.columns.map((col, i) =>
      i === index ? { ...col, name: newName } : col
    );
    setParsedData({
      ...parsedData,
      columns: newColumns,
    });
  }, [parsedData]);

  // Handle import
  const handleImport = useCallback(async () => {
    if (!file || !parsedData || !tableName.trim()) return;

    const error = validateTableName(tableName, existingTables, target === 'append');
    if (error) {
      setTableNameError(error);
      return;
    }

    setDialogState('importing');
    setImportProgress(0);

    try {
      await onImport({
        columns: parsedData.columns,
        rows: parsedData.rows,
        tableName: tableName.trim(),
        appendToExisting: target === 'append',
        file,
      });
      onClose();
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Import failed');
      setDialogState('error');
    }
  }, [file, parsedData, tableName, target, existingTables, onImport, onClose]);

  // Handle backdrop click
  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  }, [onClose]);

  // Handle keyboard events
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  }, [onClose]);

  // Don't render if read-only or not open
  if (isReadOnly || !isOpen) {
    return null;
  }

  const effectiveFormat = format === 'auto' ? detectedFormat : format;
  const canImport = parsedData && tableName.trim() && !tableNameError && dialogState === 'preview';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={handleBackdropClick}
      onKeyDown={handleKeyDown}
      data-testid="import-dialog-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="import-dialog-title"
    >
      <div
        className="bg-white rounded-xl shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] flex flex-col"
        data-testid="import-dialog"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-navy-200">
          <h2
            id="import-dialog-title"
            className="text-xl font-semibold text-navy-900"
          >
            Import Data
          </h2>
          <button
            onClick={onClose}
            className="p-1 text-navy-500 hover:bg-navy-100 rounded transition-colors"
            aria-label="Close dialog"
            data-testid="close-button"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* File Picker (Initial State) */}
          {dialogState === 'initial' && (
            <div
              ref={dropZoneRef}
              onClick={handleDropZoneClick}
              onKeyDown={handleDropZoneKeyDown}
              onDragEnter={handleDragEnter}
              onDragLeave={handleDragLeave}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              className={`
                border-2 border-dashed rounded-lg p-8 text-center cursor-pointer
                transition-colors
                ${isDragging
                  ? 'border-navy-500 bg-navy-50'
                  : 'border-navy-300 hover:border-navy-400 hover:bg-navy-50'
                }
              `}
              data-testid="file-drop-zone"
              role="button"
              tabIndex={0}
              aria-label="Click to browse or drag and drop a file"
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.tsv,.json"
                onChange={handleFileInputChange}
                className="hidden"
                data-testid="file-input"
              />
              <svg
                className="w-12 h-12 mx-auto mb-4 text-navy-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                />
              </svg>
              <p className="text-navy-700 font-medium mb-1">
                {isDragging ? 'Drop file here' : 'Click to browse or drag and drop'}
              </p>
              <p className="text-sm text-navy-500">
                Supports CSV, TSV, and JSON files
              </p>
            </div>
          )}

          {/* Parsing State */}
          {dialogState === 'parsing' && file && (
            <div className="space-y-4" data-testid="parsing-state">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-navy-100 flex items-center justify-center animate-pulse">
                  <svg
                    className="w-5 h-5 text-navy-600"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                    />
                  </svg>
                </div>
                <div>
                  <p className="font-medium text-navy-900">Parsing file...</p>
                  <p className="text-sm text-navy-500 truncate max-w-md">{file.name}</p>
                </div>
              </div>
              <ProgressBar
                percent={parseProgress}
                bytesProcessed={Math.round((parseProgress / 100) * file.size)}
                totalBytes={file.size}
              />
            </div>
          )}

          {/* Error State */}
          {dialogState === 'error' && (
            <div
              className="p-4 bg-red-50 border border-red-200 rounded-lg"
              data-testid="error-state"
              role="alert"
            >
              <div className="flex items-start gap-3">
                <svg
                  className="w-5 h-5 text-red-600 shrink-0 mt-0.5"
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
                <div>
                  <p className="font-medium text-red-800">Failed to parse file</p>
                  <p className="text-sm text-red-700 mt-1">{parseError}</p>
                </div>
              </div>
              <button
                onClick={() => setDialogState('initial')}
                className="mt-4 px-4 py-2 text-sm font-medium text-red-700 bg-white border border-red-300 rounded hover:bg-red-50 transition-colors"
                data-testid="try-again-button"
              >
                Try another file
              </button>
            </div>
          )}

          {/* Preview State */}
          {dialogState === 'preview' && parsedData && file && (
            <>
              {/* File Info */}
              <div className="flex items-center gap-3 p-3 bg-navy-50 rounded-lg">
                <svg
                  className="w-8 h-8 text-navy-500"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                  />
                </svg>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-navy-900 truncate" data-testid="file-name">{file.name}</p>
                  <p className="text-sm text-navy-500">
                    {parsedData.columns.length} columns, {parsedData.rows.length.toLocaleString()} rows
                  </p>
                </div>
                <button
                  onClick={() => setDialogState('initial')}
                  className="text-sm text-navy-600 hover:text-navy-800 font-medium"
                  data-testid="change-file-button"
                >
                  Change
                </button>
              </div>

              {/* Format Override */}
              <div>
                <label className="block text-sm font-medium text-navy-700 mb-2">
                  File Format
                </label>
                <div className="flex gap-2" role="radiogroup" aria-label="File format">
                  {(['csv', 'json'] as const).map((f) => (
                    <button
                      key={f}
                      type="button"
                      role="radio"
                      aria-checked={effectiveFormat === f}
                      onClick={() => handleFormatChange(f)}
                      className={`flex-1 px-4 py-2 text-sm font-medium rounded border transition-colors ${
                        effectiveFormat === f
                          ? 'bg-navy-600 text-white border-navy-600'
                          : 'bg-white text-navy-700 border-navy-300 hover:bg-navy-50'
                      }`}
                      data-testid={`format-${f}`}
                    >
                      {f.toUpperCase()}
                      {detectedFormat === f && (
                        <span className="ml-1 text-xs opacity-70">(detected)</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {/* Target Selector */}
              <div>
                <label className="block text-sm font-medium text-navy-700 mb-2">
                  Import To
                </label>
                <div className="flex gap-2" role="radiogroup" aria-label="Import target">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={target === 'new'}
                    onClick={() => handleTargetChange('new')}
                    className={`flex-1 px-4 py-2 text-sm font-medium rounded border transition-colors ${
                      target === 'new'
                        ? 'bg-navy-600 text-white border-navy-600'
                        : 'bg-white text-navy-700 border-navy-300 hover:bg-navy-50'
                    }`}
                    data-testid="target-new"
                  >
                    New Table
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={target === 'append'}
                    onClick={() => handleTargetChange('append')}
                    disabled={existingTables.length === 0}
                    className={`flex-1 px-4 py-2 text-sm font-medium rounded border transition-colors ${
                      target === 'append'
                        ? 'bg-navy-600 text-white border-navy-600'
                        : existingTables.length === 0
                          ? 'bg-navy-100 text-navy-400 border-navy-200 cursor-not-allowed'
                          : 'bg-white text-navy-700 border-navy-300 hover:bg-navy-50'
                    }`}
                    data-testid="target-append"
                  >
                    Append to Existing
                  </button>
                </div>
              </div>

              {/* Table Name Input / Selector */}
              <div>
                <label
                  htmlFor="table-name-input"
                  className="block text-sm font-medium text-navy-700 mb-1"
                >
                  Table Name
                </label>
                {target === 'new' ? (
                  <input
                    id="table-name-input"
                    type="text"
                    value={tableName}
                    onChange={(e) => setTableName(e.target.value)}
                    placeholder="Enter table name"
                    className={`w-full px-3 py-2 border rounded-lg text-navy-900 placeholder-navy-400 focus:outline-none focus:ring-2 focus:ring-navy-600 focus:border-transparent transition-colors ${
                      tableNameError
                        ? 'border-red-500 focus:ring-red-500'
                        : 'border-navy-300 hover:border-navy-400'
                    }`}
                    data-testid="table-name-input"
                    aria-invalid={!!tableNameError}
                    aria-describedby={tableNameError ? 'table-name-error' : undefined}
                  />
                ) : (
                  <select
                    id="table-name-input"
                    value={tableName}
                    onChange={(e) => setTableName(e.target.value)}
                    className="w-full px-3 py-2 border border-navy-300 rounded-lg text-navy-900 focus:outline-none focus:ring-2 focus:ring-navy-600 focus:border-transparent"
                    data-testid="table-name-select"
                  >
                    {existingTables.map((table) => (
                      <option key={table} value={table}>
                        {table}
                      </option>
                    ))}
                  </select>
                )}
                {tableNameError && (
                  <p
                    id="table-name-error"
                    className="mt-1 text-sm text-red-600"
                    data-testid="table-name-error"
                    role="alert"
                  >
                    {tableNameError}
                  </p>
                )}
              </div>

              {/* Data Preview with type overrides */}
              <ImportPreview
                columns={parsedData.columns}
                rows={parsedData.rows}
                onColumnsChange={handleColumnsChange}
                onColumnRename={handleColumnRename}
                maxPreviewRows={PREVIEW_ROWS}
              />
            </>
          )}

          {/* Importing State */}
          {dialogState === 'importing' && (
            <div className="space-y-4" data-testid="importing-state">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-navy-100 flex items-center justify-center animate-pulse">
                  <svg
                    className="w-5 h-5 text-navy-600"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
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
                  <p className="font-medium text-navy-900">Importing data...</p>
                  <p className="text-sm text-navy-500">
                    {parsedData?.rows.length.toLocaleString()} rows to {tableName}
                  </p>
                </div>
              </div>
              <ProgressBar
                percent={importProgress}
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-navy-200 bg-navy-50 rounded-b-xl">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-navy-700 bg-white border border-navy-300 rounded-lg hover:bg-navy-50 transition-colors"
            data-testid="cancel-button"
          >
            Cancel
          </button>
          {dialogState === 'preview' && (
            <button
              onClick={handleImport}
              disabled={!canImport}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                canImport
                  ? 'bg-navy-600 text-white hover:bg-navy-700'
                  : 'bg-navy-300 text-navy-500 cursor-not-allowed'
              }`}
              data-testid="import-button"
            >
              Import {parsedData?.rows.length.toLocaleString()} Rows
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default ImportDialog;
