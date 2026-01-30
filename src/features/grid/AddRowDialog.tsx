/**
 * AddRowDialog Component
 *
 * Dialog for adding a new row when DEFAULT VALUES insert fails.
 * Shows only columns that require user input:
 * - NOT NULL without DEFAULT
 * - NOT a generated column (generated columns are excluded)
 */

import { memo, useState, useCallback, useEffect, useRef, useMemo } from 'react';
import type { ColumnInfo } from '../../types';
import { getColumnTypeCategory } from './useDataGrid';
import { useFocusTrap } from '../../shared/hooks/useFocusTrap';

// =============================================================================
// Types
// =============================================================================

export interface AddRowDialogProps {
  /** Whether the dialog is open */
  isOpen: boolean;
  /** Columns that require user input */
  requiredColumns: ColumnInfo[];
  /** All table columns (for info display) */
  allColumns: ColumnInfo[];
  /** Called when the dialog is closed */
  onClose: () => void;
  /** Called when the form is submitted with values */
  onSubmit: (values: Record<string, unknown>) => void;
  /** Whether a submission is in progress */
  isSubmitting?: boolean;
  /** Error message to display */
  error?: string | null;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get input type for a column type
 */
function getInputType(columnType: string): 'text' | 'number' | 'checkbox' {
  const category = getColumnTypeCategory(columnType);
  if (category === 'numeric') return 'number';

  const upperType = columnType.toUpperCase().split('(')[0].trim();
  if (upperType === 'BOOLEAN') return 'checkbox';

  return 'text';
}

/**
 * Parse input value based on column type
 */
function parseValue(value: string, columnType: string): unknown {
  if (value === '' || value.toLowerCase() === 'null') {
    return null;
  }

  const category = getColumnTypeCategory(columnType);
  if (category === 'numeric') {
    const parsed = parseFloat(value);
    return Number.isNaN(parsed) ? value : parsed;
  }

  return value;
}

// =============================================================================
// Component
// =============================================================================

export const AddRowDialog = memo(function AddRowDialog({
  isOpen,
  requiredColumns,
  allColumns,
  onClose,
  onSubmit,
  isSubmitting = false,
  error = null,
}: AddRowDialogProps) {
  // Form state: column name -> string value
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  // Track which fields have been touched (for validation display)
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  // Reference to first input for autofocus
  const firstInputRef = useRef<HTMLInputElement>(null);

  // Focus trap for accessibility
  const { containerRef: focusTrapRef } = useFocusTrap({
    isActive: isOpen,
    autoFocus: true,
    returnFocus: true,
  });

  // Check if there are generated columns
  const hasGeneratedColumns = allColumns.some((col) => col.generated !== null);
  const editableColumns = useMemo(
    () => allColumns.filter((col) => col.generated === null),
    [allColumns]
  );
  const requiredColumnNames = useMemo(
    () => new Set(requiredColumns.map((col) => col.name)),
    [requiredColumns]
  );

  // Reset form when dialog opens
  useEffect(() => {
    if (isOpen) {
      const initialValues: Record<string, string> = {};
      editableColumns.forEach((col) => {
        initialValues[col.name] = '';
      });
      setFormValues(initialValues);
      setTouched({});
    }
  }, [isOpen, editableColumns]);

  // Focus first input when dialog opens
  useEffect(() => {
    if (isOpen && firstInputRef.current) {
      // Delay focus to ensure dialog is rendered
      setTimeout(() => {
        firstInputRef.current?.focus();
      }, 50);
    }
  }, [isOpen]);

  // Handle input change
  const handleChange = useCallback((columnName: string, value: string) => {
    setFormValues((prev) => ({
      ...prev,
      [columnName]: value,
    }));
  }, []);

  // Handle input blur (mark as touched)
  const handleBlur = useCallback((columnName: string) => {
    setTouched((prev) => ({
      ...prev,
      [columnName]: true,
    }));
  }, []);

  // Handle NULL button click
  const handleSetNull = useCallback((columnName: string) => {
    setFormValues((prev) => ({
      ...prev,
      [columnName]: 'null',
    }));
    setTouched((prev) => ({
      ...prev,
      [columnName]: true,
    }));
  }, []);

  // Validate form
  const getValidationErrors = useCallback((): Record<string, string> => {
    const errors: Record<string, string> = {};

    requiredColumns.forEach((col) => {
      const value = formValues[col.name] ?? '';
      const isNull = value === '' || value.toLowerCase() === 'null';

      // If column is NOT NULL and value is empty/null, it's an error
      if (col.notnull && isNull) {
        errors[col.name] = 'This field is required';
      }
    });

    return errors;
  }, [formValues, requiredColumns]);

  const validationErrors = getValidationErrors();
  const isValid = Object.keys(validationErrors).length === 0;

  // Handle form submission
  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();

      // Mark all fields as touched
      const allTouched: Record<string, boolean> = {};
      requiredColumns.forEach((col) => {
        allTouched[col.name] = true;
      });
      setTouched(allTouched);

      if (!isValid) {
        return;
      }

      // Parse values
      const parsedValues: Record<string, unknown> = {};
      editableColumns.forEach((col) => {
        const rawValue = formValues[col.name] ?? '';
        const isRequired = requiredColumnNames.has(col.name);

        if (!isRequired && rawValue === '') {
          return;
        }

        parsedValues[col.name] = parseValue(rawValue, col.type);
      });

      onSubmit(parsedValues);
    },
    [editableColumns, formValues, isValid, onSubmit, requiredColumns, requiredColumnNames]
  );

  // Handle keyboard events
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape' && !isSubmitting) {
        onClose();
      }
    },
    [onClose, isSubmitting]
  );

  // Handle backdrop click (only close if not submitting)
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget && !isSubmitting) {
        onClose();
      }
    },
    [onClose, isSubmitting]
  );

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={handleBackdropClick}
      onKeyDown={handleKeyDown}
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-row-dialog-title"
      data-testid="add-row-dialog"
    >
      <div
        ref={focusTrapRef as React.RefObject<HTMLDivElement>}
        className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 max-h-[80vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 py-3 border-b border-gray-200">
          <h2 id="add-row-dialog-title" className="text-lg font-semibold text-gray-900">
            Add New Row
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            Required fields are marked with an asterisk. Optional fields can be left blank.
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-auto">
          <div className="px-4 py-3 space-y-4">
            {/* Generated columns info */}
            {hasGeneratedColumns && (
              <div
                className="bg-blue-50 border border-blue-200 rounded px-3 py-2 text-sm text-blue-700"
                data-testid="generated-columns-info"
              >
                Generated columns will be computed automatically
              </div>
            )}

            {/* Editable fields */}
            {editableColumns.map((col, index) => {
              const inputType = getInputType(col.type);
              const error = touched[col.name] ? validationErrors[col.name] : undefined;
              const isNullable = !col.notnull;
              const isRequired = requiredColumnNames.has(col.name);

              return (
                <div key={col.name} className="space-y-1">
                  <label
                    htmlFor={`field-${col.name}`}
                    className="block text-sm font-medium text-gray-700"
                  >
                    {col.name}
                    {isRequired && <span className="text-red-500 ml-1">*</span>}
                    <span className="ml-2 text-xs text-gray-400 font-normal">
                      {col.type}
                    </span>
                  </label>

                  <div className="flex gap-2">
                    {inputType === 'checkbox' ? (
                      <div className="flex items-center gap-2">
                        <input
                          ref={index === 0 ? firstInputRef : undefined}
                          type="checkbox"
                          id={`field-${col.name}`}
                          checked={formValues[col.name] === '1' || formValues[col.name] === 'true'}
                          onChange={(e) => handleChange(col.name, e.target.checked ? '1' : '0')}
                          onBlur={() => handleBlur(col.name)}
                          className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          disabled={isSubmitting}
                          data-testid={`field-${col.name}`}
                        />
                        <span className="text-sm text-gray-600">
                          {formValues[col.name] === '1' || formValues[col.name] === 'true' ? 'true' : 'false'}
                        </span>
                      </div>
                    ) : (
                      <input
                        ref={index === 0 ? firstInputRef : undefined}
                        type={inputType}
                        id={`field-${col.name}`}
                        value={formValues[col.name] ?? ''}
                        onChange={(e) => handleChange(col.name, e.target.value)}
                        onBlur={() => handleBlur(col.name)}
                        placeholder={col.dfltValue ? `Default: ${col.dfltValue}` : undefined}
                        className={`flex-1 px-3 py-2 border rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                          error ? 'border-red-500' : 'border-gray-300'
                        }`}
                        disabled={isSubmitting}
                        data-testid={`field-${col.name}`}
                      />
                    )}

                    {/* NULL button for nullable columns */}
                    {isNullable && inputType !== 'checkbox' && (
                      <button
                        type="button"
                        onClick={() => handleSetNull(col.name)}
                        className={`px-2 py-1 text-xs rounded border ${
                          formValues[col.name]?.toLowerCase() === 'null'
                            ? 'bg-gray-200 border-gray-400 text-gray-700'
                            : 'border-gray-300 text-gray-500 hover:bg-gray-100'
                        }`}
                        disabled={isSubmitting}
                        data-testid={`null-btn-${col.name}`}
                      >
                        NULL
                      </button>
                    )}
                  </div>

                  {/* Error message */}
                  {error && (
                    <p className="text-xs text-red-500" data-testid={`error-${col.name}`}>
                      {error}
                    </p>
                  )}
                </div>
              );
            })}

            {/* Global error */}
            {error && (
              <div
                className="bg-red-50 border border-red-200 rounded px-3 py-2 text-sm text-red-700"
                data-testid="add-row-error"
              >
                {error}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-4 py-3 border-t border-gray-200 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded"
              disabled={isSubmitting}
              data-testid="add-row-cancel"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={isSubmitting}
              data-testid="add-row-submit"
            >
              {isSubmitting ? 'Inserting...' : 'Insert'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
});

export default AddRowDialog;
