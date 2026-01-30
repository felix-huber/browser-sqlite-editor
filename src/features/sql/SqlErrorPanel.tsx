/**
 * SqlErrorPanel Component
 *
 * Displays SQL errors with:
 * - Error type icon (syntax, constraint, runtime)
 * - Error message text
 * - Line:Column indicator (clickable to jump to location)
 * - Multiple errors from multi-statement execution
 * - Suggestions when available
 */

import { memo, useCallback, useMemo } from 'react';
import type { SqlError } from '../../types';

// =============================================================================
// Types
// =============================================================================

/** Error type classification */
export type SqlErrorType = 'syntax' | 'constraint' | 'runtime' | 'unknown';

/** Parsed error with type classification */
export interface ParsedSqlError extends SqlError {
  /** Classified error type */
  type: SqlErrorType;
  /** Suggestion for fixing the error */
  suggestion?: string;
}

/** Props for SqlErrorPanel */
export interface SqlErrorPanelProps {
  /** Array of errors to display */
  errors: SqlError[];
  /** Callback when user clicks on a line:column indicator */
  onJumpToLocation?: (line: number, column?: number) => void;
  /** Additional className */
  className?: string;
}

// =============================================================================
// Error Parsing Utilities
// =============================================================================

/**
 * Parse line number from SQLite error message
 * SQLite typically reports errors as:
 * - "near X: syntax error" (no line info)
 * - "at line N" or "on line N"
 * - Sometimes includes column info
 */
export function parseLineNumber(message: string): { line?: number; column?: number } {
  // Pattern: "at line N" or "on line N" or "line N"
  const lineMatch = message.match(/(?:at|on)?\s*line\s+(\d+)/i);
  // Pattern: "column N" or "col N"
  const columnMatch = message.match(/(?:column|col)\s+(\d+)/i);
  // Pattern: "(N:M)" or "N:M" for line:column
  const positionMatch = message.match(/\((\d+):(\d+)\)|(?:^|\s)(\d+):(\d+)(?:\s|$)/);

  let line: number | undefined;
  let column: number | undefined;

  if (positionMatch) {
    line = parseInt(positionMatch[1] || positionMatch[3], 10);
    column = parseInt(positionMatch[2] || positionMatch[4], 10);
  } else {
    if (lineMatch) {
      line = parseInt(lineMatch[1], 10);
    }
    if (columnMatch) {
      column = parseInt(columnMatch[1], 10);
    }
  }

  return { line, column };
}

/**
 * Classify an error by type based on message content
 */
export function classifyErrorType(message: string): SqlErrorType {
  const normalized = message.toLowerCase();

  // Syntax errors
  if (
    normalized.includes('syntax error') ||
    normalized.includes('near "') ||
    normalized.includes('incomplete input') ||
    normalized.includes('unrecognized token') ||
    normalized.includes('unexpected token') ||
    normalized.includes('no such column') ||
    normalized.includes('no such table') ||
    normalized.includes('no such function')
  ) {
    return 'syntax';
  }

  // Constraint violations
  if (
    normalized.includes('constraint') ||
    normalized.includes('unique') ||
    normalized.includes('foreign key') ||
    normalized.includes('not null') ||
    normalized.includes('check constraint') ||
    normalized.includes('primary key')
  ) {
    return 'constraint';
  }

  // Runtime errors (database operations)
  if (
    normalized.includes('database is locked') ||
    normalized.includes('disk i/o error') ||
    normalized.includes('database disk image is malformed') ||
    normalized.includes('out of memory') ||
    normalized.includes('read-only database') ||
    normalized.includes('unable to open database')
  ) {
    return 'runtime';
  }

  return 'unknown';
}

/**
 * Generate a suggestion for fixing common errors
 */
export function generateSuggestion(message: string): string | undefined {
  const normalized = message.toLowerCase();

  // Missing table
  const tableMatch = message.match(/no such table:\s*(\w+)/i);
  if (tableMatch) {
    return `Table "${tableMatch[1]}" does not exist. Check the table name spelling.`;
  }

  // Missing column
  const columnMatch = message.match(/no such column:\s*(\w+)/i);
  if (columnMatch) {
    return `Column "${columnMatch[1]}" does not exist. Check the column name or table alias.`;
  }

  // Missing function
  const functionMatch = message.match(/no such function:\s*(\w+)/i);
  if (functionMatch) {
    return `Function "${functionMatch[1]}" is not available. Check the function name spelling.`;
  }

  // Near token syntax error
  const nearMatch = message.match(/near\s+"([^"]+)":\s*syntax error/i);
  if (nearMatch) {
    return `Syntax error near "${nearMatch[1]}". Check for missing keywords or punctuation.`;
  }

  // Unique constraint
  if (normalized.includes('unique constraint')) {
    return 'A record with this value already exists. Use UPDATE instead or change the value.';
  }

  // Foreign key constraint
  if (normalized.includes('foreign key constraint')) {
    return 'Referenced record does not exist. Ensure the parent record exists first.';
  }

  // NOT NULL constraint
  if (normalized.includes('not null constraint')) {
    return 'This column requires a value. Provide a non-NULL value.';
  }

  return undefined;
}

/**
 * Parse and enhance a raw SqlError with type and suggestion
 */
export function parseError(error: SqlError): ParsedSqlError {
  const { line, column } = parseLineNumber(error.message);
  const type = classifyErrorType(error.message);
  const suggestion = generateSuggestion(error.message);

  return {
    ...error,
    line: error.line ?? line,
    column: error.column ?? column,
    type,
    suggestion,
  };
}

// =============================================================================
// Sub-Components
// =============================================================================

/** Icon for syntax errors */
const SyntaxErrorIcon = memo(function SyntaxErrorIcon() {
  return (
    <svg
      className="w-5 h-5 text-red-500"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  );
});

/** Icon for constraint errors */
const ConstraintErrorIcon = memo(function ConstraintErrorIcon() {
  return (
    <svg
      className="w-5 h-5 text-orange-500"
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
  );
});

/** Icon for runtime errors */
const RuntimeErrorIcon = memo(function RuntimeErrorIcon() {
  return (
    <svg
      className="w-5 h-5 text-purple-500"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  );
});

/** Icon for unknown errors */
const UnknownErrorIcon = memo(function UnknownErrorIcon() {
  return (
    <svg
      className="w-5 h-5 text-red-600"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  );
});

/** Get the appropriate icon for an error type */
function getErrorIcon(type: SqlErrorType) {
  switch (type) {
    case 'syntax':
      return <SyntaxErrorIcon />;
    case 'constraint':
      return <ConstraintErrorIcon />;
    case 'runtime':
      return <RuntimeErrorIcon />;
    default:
      return <UnknownErrorIcon />;
  }
}

/** Get the label for an error type */
function getErrorTypeLabel(type: SqlErrorType): string {
  switch (type) {
    case 'syntax':
      return 'Syntax Error';
    case 'constraint':
      return 'Constraint Violation';
    case 'runtime':
      return 'Runtime Error';
    default:
      return 'Error';
  }
}

/** Single error item display */
interface ErrorItemProps {
  error: ParsedSqlError;
  index: number;
  onJumpToLocation?: (line: number, column?: number) => void;
}

const ErrorItem = memo(function ErrorItem({
  error,
  index,
  onJumpToLocation,
}: ErrorItemProps) {
  const handleLocationClick = useCallback(() => {
    if (error.line && onJumpToLocation) {
      onJumpToLocation(error.line, error.column);
    }
  }, [error.line, error.column, onJumpToLocation]);

  const hasLocation = error.line !== undefined;
  const locationText = hasLocation
    ? error.column !== undefined
      ? `${error.line}:${error.column}`
      : `Line ${error.line}`
    : null;

  return (
    <div
      className="flex items-start gap-3 p-3 bg-red-50 border-b border-red-100 last:border-b-0"
      role="alert"
      data-testid={`error-item-${index}`}
    >
      {/* Error type icon */}
      <div className="shrink-0 mt-0.5" data-testid={`error-icon-${index}`}>
        {getErrorIcon(error.type)}
      </div>

      {/* Error content */}
      <div className="flex-1 min-w-0">
        {/* Header with type and location */}
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className="text-sm font-medium text-red-800"
            data-testid={`error-type-${index}`}
          >
            {getErrorTypeLabel(error.type)}
          </span>

          {/* Statement index for multi-statement */}
          {error.statementIndex !== undefined && (
            <span className="text-xs text-red-600 bg-red-100 px-1.5 py-0.5 rounded">
              Statement {error.statementIndex + 1}
            </span>
          )}

          {/* Clickable line:column indicator */}
          {hasLocation && (
            <button
              onClick={handleLocationClick}
              className="text-xs text-red-600 hover:text-red-800 hover:underline focus:outline-none focus:ring-1 focus:ring-red-500 rounded px-1"
              title="Click to jump to location"
              data-testid={`error-location-${index}`}
            >
              {locationText}
            </button>
          )}
        </div>

        {/* Error message */}
        <p
          className="text-sm text-red-700 mt-1"
          data-testid={`error-message-${index}`}
        >
          {error.message}
        </p>

        {/* Suggestion */}
        {error.suggestion && (
          <p
            className="text-xs text-red-600 mt-2 bg-red-100/50 px-2 py-1 rounded"
            data-testid={`error-suggestion-${index}`}
          >
            💡 {error.suggestion}
          </p>
        )}
      </div>
    </div>
  );
});

// =============================================================================
// Main Component
// =============================================================================

export const SqlErrorPanel = memo(function SqlErrorPanel({
  errors,
  onJumpToLocation,
  className = '',
}: SqlErrorPanelProps) {
  // Parse and enhance all errors
  const parsedErrors = useMemo(
    () => errors.map(parseError),
    [errors]
  );

  if (errors.length === 0) {
    return null;
  }

  return (
    <div
      className={`bg-red-50 border border-red-200 rounded-lg overflow-hidden ${className}`}
      data-testid="sql-error-panel"
    >
      {/* Header for multiple errors */}
      {parsedErrors.length > 1 && (
        <div
          className="px-3 py-2 bg-red-100 border-b border-red-200 text-sm font-medium text-red-800"
          data-testid="error-panel-header"
        >
          {parsedErrors.length} errors found
        </div>
      )}

      {/* Error list */}
      <div className="max-h-64 overflow-y-auto" data-testid="error-list">
        {parsedErrors.map((error, index) => (
          <ErrorItem
            key={index}
            error={error}
            index={index}
            onJumpToLocation={onJumpToLocation}
          />
        ))}
      </div>
    </div>
  );
});

export default SqlErrorPanel;
