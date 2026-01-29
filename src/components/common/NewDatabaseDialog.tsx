/**
 * NewDatabaseDialog Component
 *
 * A modal dialog for creating new databases with name validation.
 *
 * Features:
 * - Name input with real-time validation (debounced 200ms)
 * - Validation: path separators, hidden files, reserved names, empty, length, uniqueness
 * - Create and Cancel buttons
 * - Read-only guard: disabled/hidden when isReadOnly
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { useFocusTrap } from '../../hooks/useFocusTrap';

/** Windows reserved names */
const WINDOWS_RESERVED_NAMES = [
  'CON', 'PRN', 'NUL', 'AUX',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
];

/** Maximum name length */
const MAX_NAME_LENGTH = 255;

/** Debounce delay for validation */
const VALIDATION_DEBOUNCE_MS = 200;

export interface NewDatabaseDialogProps {
  /** Whether the dialog is open */
  isOpen: boolean;
  /** Callback when dialog should close */
  onClose: () => void;
  /** Callback when database should be created */
  onCreate: (name: string) => void;
  /** List of existing database names (for uniqueness check) */
  existingNames?: string[];
  /** Whether in read-only mode */
  isReadOnly?: boolean;
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validate a database name
 */
export function validateDatabaseName(
  name: string,
  existingNames: string[] = []
): ValidationResult {
  // Trim the name
  const trimmed = name.trim();

  // Check empty or whitespace-only
  if (trimmed.length === 0) {
    return { valid: false, error: 'Name cannot be empty' };
  }

  // Check max length
  if (trimmed.length > MAX_NAME_LENGTH) {
    return { valid: false, error: `Name cannot exceed ${MAX_NAME_LENGTH} characters` };
  }

  // Check path separators
  if (trimmed.includes('/') || trimmed.includes('\\')) {
    return { valid: false, error: 'Name cannot contain path separators (/ or \\)' };
  }

  // Check hidden files (starting with .)
  if (trimmed.startsWith('.')) {
    return { valid: false, error: 'Name cannot start with a dot (hidden files)' };
  }

  // Check Windows reserved names (case-insensitive)
  const upperName = trimmed.toUpperCase();
  // Check both exact match and with extension (e.g., CON.txt)
  const baseName = upperName.split('.')[0];
  if (WINDOWS_RESERVED_NAMES.includes(baseName)) {
    return { valid: false, error: `"${baseName}" is a reserved name` };
  }

  // Check uniqueness (case-insensitive)
  const lowerName = trimmed.toLowerCase();
  const isDuplicate = existingNames.some(
    (existing) => existing.toLowerCase() === lowerName
  );
  if (isDuplicate) {
    return { valid: false, error: 'A database with this name already exists' };
  }

  return { valid: true };
}

/**
 * NewDatabaseDialog component
 */
export function NewDatabaseDialog({
  isOpen,
  onClose,
  onCreate,
  existingNames = [],
  isReadOnly = false,
}: NewDatabaseDialogProps) {
  const [name, setName] = useState('');
  const [validationResult, setValidationResult] = useState<ValidationResult>({ valid: false });
  const [hasTyped, setHasTyped] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Focus trap for accessibility
  const { containerRef: focusTrapRef } = useFocusTrap({
    isActive: isOpen && !isReadOnly,
    autoFocus: true,
    returnFocus: true,
  });

  // Reset state when dialog opens
  useEffect(() => {
    if (isOpen) {
      setName('');
      setValidationResult({ valid: false });
      setHasTyped(false);
      // Focus input after dialog opens
      setTimeout(() => {
        inputRef.current?.focus();
      }, 0);
    }
  }, [isOpen]);

  // Debounced validation
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(() => {
      const result = validateDatabaseName(name, existingNames);
      setValidationResult(result);
    }, VALIDATION_DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [name, existingNames]);

  // Handle input change
  const handleNameChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setName(e.target.value);
    if (!hasTyped) {
      setHasTyped(true);
    }
  }, [hasTyped]);

  // Handle create action
  const handleCreate = useCallback(() => {
    const trimmed = name.trim();
    const result = validateDatabaseName(trimmed, existingNames);
    if (result.valid) {
      onCreate(trimmed);
      onClose();
    }
  }, [name, existingNames, onCreate, onClose]);

  // Handle Enter key
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && validationResult.valid) {
      e.preventDefault();
      handleCreate();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  }, [validationResult.valid, handleCreate, onClose]);

  // Handle backdrop click
  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  }, [onClose]);

  // Don't render if read-only or not open
  if (isReadOnly || !isOpen) {
    return null;
  }

  const showError = hasTyped && !validationResult.valid && validationResult.error;
  const isCreateDisabled = !validationResult.valid;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={handleBackdropClick}
      data-testid="new-database-dialog-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-database-dialog-title"
    >
      <div
        ref={focusTrapRef as React.RefObject<HTMLDivElement>}
        className="bg-white rounded-xl shadow-xl max-w-md w-full mx-4 p-6"
        data-testid="new-database-dialog"
      >
        {/* Header */}
        <h2
          id="new-database-dialog-title"
          className="text-xl font-semibold text-navy-900 mb-4"
        >
          Create New Database
        </h2>

        {/* Name Input */}
        <div className="mb-4">
          <label
            htmlFor="database-name-input"
            className="block text-sm font-medium text-navy-700 mb-1"
          >
            Database Name
          </label>
          <input
            ref={inputRef}
            id="database-name-input"
            type="text"
            value={name}
            onChange={handleNameChange}
            onKeyDown={handleKeyDown}
            placeholder="Enter database name"
            className={`w-full px-3 py-2 border rounded-lg text-navy-900 placeholder-navy-400 focus:outline-none focus:ring-2 focus:ring-navy-600 focus:border-transparent transition-colors ${
              showError
                ? 'border-red-500 focus:ring-red-500'
                : 'border-navy-300 hover:border-navy-400'
            }`}
            data-testid="database-name-input"
            aria-invalid={showError ? 'true' : 'false'}
            aria-describedby={showError ? 'name-error' : undefined}
          />
          {/* Error Message */}
          {showError && (
            <p
              id="name-error"
              className="mt-1 text-sm text-red-600"
              data-testid="name-validation-error"
              role="alert"
            >
              {validationResult.error}
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-navy-700 font-medium rounded-lg border border-navy-300 hover:bg-navy-50 focus:outline-none focus:ring-2 focus:ring-navy-600 focus:ring-offset-2 transition-colors"
            data-testid="cancel-button"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleCreate}
            disabled={isCreateDisabled}
            className={`px-4 py-2 font-medium rounded-lg focus:outline-none focus:ring-2 focus:ring-offset-2 transition-colors ${
              isCreateDisabled
                ? 'bg-navy-300 text-navy-500 cursor-not-allowed'
                : 'bg-navy-600 text-white hover:bg-navy-700 focus:ring-navy-600'
            }`}
            data-testid="create-button"
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}

export default NewDatabaseDialog;
