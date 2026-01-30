/**
 * SqlResultsDisplay Component
 *
 * Displays SQL query results with support for:
 * - SELECT results using DataGrid component
 * - INSERT/UPDATE/DELETE affected row counts
 * - DDL success messages
 * - Error display with line numbers
 * - Multi-result tabs for batch queries
 * - Execution time display
 * - Column/row counts in status
 * - NULL/BLOB display consistent with DataGrid styling
 */

import { memo, useState, useMemo, useCallback } from 'react';
import type { QueryResult, SqlError, TableInfo, ColumnInfo } from '../../types';
import { DataGrid } from '../grid';
import type { DataRow } from '../grid';
import { formatExecutionTime } from '../../shared/format/time';

export { formatExecutionTime };

// =============================================================================
// Types
// =============================================================================

/** Result type classification */
export type ResultType = 'select' | 'insert' | 'update' | 'delete' | 'ddl' | 'error';

/** Single result from a statement */
export interface StatementResult {
  /** The SQL statement that produced this result */
  sql: string;
  /** Type of statement */
  type: ResultType;
  /** Query result data (for SELECT) */
  result?: QueryResult;
  /** Number of affected rows (for INSERT/UPDATE/DELETE) */
  rowsAffected?: number;
  /** Error information (if failed) */
  error?: SqlError;
  /** Execution time in milliseconds */
  executionTime?: number;
}

/** Props for SqlResultsDisplay */
export interface SqlResultsDisplayProps {
  /** Array of results (one per statement in batch) */
  results: StatementResult[];
  /** Total execution time for all statements */
  totalExecutionTime?: number;
  /** Height available for the results display */
  height?: number;
  /** Additional className */
  className?: string;
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Classify a SQL statement by its type
 */
export function classifyStatement(sql: string): ResultType {
  const normalized = sql.trim().toUpperCase();

  if (normalized.startsWith('SELECT') || normalized.startsWith('WITH')) {
    return 'select';
  }
  if (normalized.startsWith('INSERT') || normalized.startsWith('REPLACE')) {
    return 'insert';
  }
  if (normalized.startsWith('UPDATE')) {
    return 'update';
  }
  if (normalized.startsWith('DELETE')) {
    return 'delete';
  }
  // DDL and other statements
  return 'ddl';
}

/**
 * Get a short label for a result tab
 */
function getTabLabel(result: StatementResult, index: number): string {
  if (result.error) {
    return `Error ${index + 1}`;
  }
  if (result.type === 'select' && result.result) {
    return `Result ${index + 1}`;
  }
  if (result.type === 'insert') {
    return `Insert ${index + 1}`;
  }
  if (result.type === 'update') {
    return `Update ${index + 1}`;
  }
  if (result.type === 'delete') {
    return `Delete ${index + 1}`;
  }
  return `Statement ${index + 1}`;
}

/**
 * Convert QueryResult rows to DataGrid DataRow format
 */
function convertToDataRows(result: QueryResult): DataRow[] {
  return result.rows.map((row) => {
    const dataRow: DataRow = {};
    result.columns.forEach((col, idx) => {
      dataRow[col] = row[idx];
    });
    return dataRow;
  });
}

/**
 * Create a minimal TableInfo from QueryResult for DataGrid
 */
function createTableInfoFromResult(result: QueryResult): TableInfo {
  const columns: ColumnInfo[] = result.columns.map((name, idx) => ({
    cid: idx,
    name,
    type: result.columnTypes[idx] || 'TEXT',
    notnull: false,
    dfltValue: null,
    pk: 0,
    generated: null,
    hidden: false,
  }));

  return {
    name: 'query_result',
    isView: true, // Treat as read-only view
    isVirtual: false,
    withoutRowid: false,
    columns,
    indexes: [],
    createSql: '',
  };
}

// =============================================================================
// Sub-Components
// =============================================================================

/** Props for single result display */
interface SingleResultProps {
  result: StatementResult;
  height: number;
}

/** Display a SELECT result using DataGrid */
const SelectResultDisplay = memo(function SelectResultDisplay({
  result,
  height,
}: SingleResultProps) {
  const queryResult = result.result;

  // Memoize data conversion - must be called unconditionally (Rules of Hooks)
  const data = useMemo(
    () => (queryResult ? convertToDataRows(queryResult) : []),
    [queryResult]
  );
  const tableInfo = useMemo(
    () => (queryResult ? createTableInfoFromResult(queryResult) : null),
    [queryResult]
  );

  // Handle no query result
  if (!queryResult || !tableInfo) {
    return (
      <div className="flex items-center justify-center h-full text-navy-500">
        No data
      </div>
    );
  }

  // For query results with no rows
  if (queryResult.rows.length === 0) {
    return (
      <div
        className="flex flex-col items-center justify-center text-navy-500 py-8"
        data-testid="select-empty-results"
      >
        <svg
          className="w-12 h-12 mb-2 text-navy-300"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
          />
        </svg>
        <p className="text-sm">Query executed successfully</p>
        <p className="text-xs text-navy-400">No rows returned</p>
      </div>
    );
  }

  return (
    <DataGrid
      tableInfo={tableInfo}
      data={data}
      isReadOnly={true} // Query results are always read-only
      height={height}
    />
  );
});

/** Display an affected rows message */
const AffectedRowsDisplay = memo(function AffectedRowsDisplay({
  result,
}: {
  result: StatementResult;
}) {
  const count = result.rowsAffected ?? 0;
  const typeLabel =
    result.type === 'insert'
      ? 'inserted'
      : result.type === 'update'
        ? 'updated'
        : result.type === 'delete'
          ? 'deleted'
          : 'affected';

  return (
    <div
      className="flex flex-col items-center justify-center py-8 text-navy-700"
      data-testid={`${result.type}-result`}
    >
      <svg
        className="w-12 h-12 mb-2 text-green-500"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
      <p className="text-lg font-medium" data-testid="affected-rows-message">
        {count} row{count !== 1 ? 's' : ''} {typeLabel}
      </p>
      {result.executionTime !== undefined && (
        <p className="text-sm text-navy-500" data-testid="execution-time">
          Executed in {formatExecutionTime(result.executionTime)}
        </p>
      )}
    </div>
  );
});

/** Display a DDL success message */
const DdlSuccessDisplay = memo(function DdlSuccessDisplay({
  result,
}: {
  result: StatementResult;
}) {
  return (
    <div
      className="flex flex-col items-center justify-center py-8 text-navy-700"
      data-testid="ddl-result"
    >
      <svg
        className="w-12 h-12 mb-2 text-green-500"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
      <p className="text-lg font-medium" data-testid="ddl-success-message">
        Statement executed successfully
      </p>
      {result.executionTime !== undefined && (
        <p className="text-sm text-navy-500" data-testid="execution-time">
          Executed in {formatExecutionTime(result.executionTime)}
        </p>
      )}
    </div>
  );
});

/** Display an error message */
const ErrorDisplay = memo(function ErrorDisplay({
  result,
}: {
  result: StatementResult;
}) {
  const error = result.error;
  if (!error) return null;

  return (
    <div
      className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-lg m-4"
      role="alert"
      data-testid="error-result"
    >
      <svg
        className="w-6 h-6 text-red-600 shrink-0 mt-0.5"
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
      <div className="flex-1">
        <p className="font-medium text-red-800">
          Error
          {error.line !== undefined && (
            <span className="text-red-600"> at line {error.line}</span>
          )}
          {error.column !== undefined && (
            <span className="text-red-600">, column {error.column}</span>
          )}
        </p>
        <p className="text-red-700 mt-1" data-testid="error-message">
          {error.message}
        </p>
      </div>
    </div>
  );
});

// =============================================================================
// Status Bar Component
// =============================================================================

interface StatusBarProps {
  result: StatementResult;
  totalExecutionTime?: number;
  showTotalTime?: boolean;
}

const StatusBar = memo(function StatusBar({
  result,
  totalExecutionTime,
  showTotalTime,
}: StatusBarProps) {
  const queryResult = result.result;

  return (
    <div
      className="flex items-center gap-4 px-3 py-1.5 text-xs text-navy-600 bg-navy-50 border-b border-navy-200"
      data-testid="results-status-bar"
    >
      {/* Row count for SELECT */}
      {result.type === 'select' && queryResult && (
        <span data-testid="row-count">
          {queryResult.rows.length} row{queryResult.rows.length !== 1 ? 's' : ''}
          {queryResult.hasMore && '+'}
        </span>
      )}

      {/* Column count for SELECT */}
      {result.type === 'select' && queryResult && (
        <span data-testid="column-count">
          {queryResult.columns.length} column{queryResult.columns.length !== 1 ? 's' : ''}
        </span>
      )}

      {/* Affected rows for DML */}
      {(result.type === 'insert' || result.type === 'update' || result.type === 'delete') && (
        <span data-testid="affected-rows-status">
          {result.rowsAffected ?? 0} row{(result.rowsAffected ?? 0) !== 1 ? 's' : ''} affected
        </span>
      )}

      <div className="flex-1" />

      {/* Execution time */}
      {result.executionTime !== undefined && (
        <span data-testid="execution-time-status">
          Executed in {formatExecutionTime(result.executionTime)}
        </span>
      )}

      {/* Total time if multiple results */}
      {showTotalTime && totalExecutionTime !== undefined && (
        <span className="text-navy-400" data-testid="total-execution-time">
          (Total: {formatExecutionTime(totalExecutionTime)})
        </span>
      )}
    </div>
  );
});

// =============================================================================
// Tab Bar Component
// =============================================================================

interface TabBarProps {
  results: StatementResult[];
  activeIndex: number;
  onTabChange: (index: number) => void;
}

const TabBar = memo(function TabBar({
  results,
  activeIndex,
  onTabChange,
}: TabBarProps) {
  return (
    <div
      className="flex items-center gap-1 px-2 py-1 bg-navy-100 border-b border-navy-200 overflow-x-auto"
      role="tablist"
      data-testid="results-tab-bar"
    >
      {results.map((result, index) => {
        const isActive = index === activeIndex;
        const hasError = result.error !== undefined;

        return (
          <button
            key={index}
            role="tab"
            aria-selected={isActive}
            onClick={() => onTabChange(index)}
            className={`px-3 py-1 text-sm rounded transition-colors whitespace-nowrap ${
              isActive
                ? 'bg-white text-navy-900 shadow-sm'
                : 'text-navy-600 hover:bg-navy-200'
            } ${hasError ? 'text-red-600' : ''}`}
            data-testid={`result-tab-${index}`}
          >
            {getTabLabel(result, index)}
            {result.type === 'select' && result.result && (
              <span className="ml-1 text-xs text-navy-400">
                ({result.result.rows.length})
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
});

// =============================================================================
// Main Component
// =============================================================================

export const SqlResultsDisplay = memo(function SqlResultsDisplay({
  results,
  totalExecutionTime,
  height = 300,
  className = '',
}: SqlResultsDisplayProps) {
  const [activeTabIndex, setActiveTabIndex] = useState(0);

  // Reset active tab when results change
  const handleTabChange = useCallback((index: number) => {
    setActiveTabIndex(index);
  }, []);

  // No results
  if (results.length === 0) {
    return null;
  }

  // Single result - no tabs needed
  if (results.length === 1) {
    const result = results[0];
    const statusBarHeight = 28;
    const contentHeight = height - statusBarHeight;

    return (
      <div className={`flex flex-col ${className}`} style={{ height }} data-testid="sql-results-display">
        <StatusBar result={result} />
        <div className="flex-1 overflow-auto">
          {result.error ? (
            <ErrorDisplay result={result} />
          ) : result.type === 'select' ? (
            <SelectResultDisplay
              result={result}
              height={contentHeight}
            />
          ) : result.type === 'insert' || result.type === 'update' || result.type === 'delete' ? (
            <AffectedRowsDisplay result={result} />
          ) : (
            <DdlSuccessDisplay result={result} />
          )}
        </div>
      </div>
    );
  }

  // Multiple results - show tabs
  const tabBarHeight = 36;
  const statusBarHeight = 28;
  const contentHeight = height - tabBarHeight - statusBarHeight;
  const activeResult = results[activeTabIndex] ?? results[0];

  return (
    <div className={`flex flex-col ${className}`} style={{ height }} data-testid="sql-results-display">
      <TabBar
        results={results}
        activeIndex={activeTabIndex}
        onTabChange={handleTabChange}
      />
      <StatusBar
        result={activeResult}
        totalExecutionTime={totalExecutionTime}
        showTotalTime={results.length > 1}
      />
      <div className="flex-1 overflow-auto" role="tabpanel">
        {activeResult.error ? (
          <ErrorDisplay result={activeResult} />
        ) : activeResult.type === 'select' ? (
          <SelectResultDisplay
            result={activeResult}
            height={contentHeight}
          />
        ) : activeResult.type === 'insert' ||
          activeResult.type === 'update' ||
          activeResult.type === 'delete' ? (
          <AffectedRowsDisplay result={activeResult} />
        ) : (
          <DdlSuccessDisplay result={activeResult} />
        )}
      </div>
    </div>
  );
});

export default SqlResultsDisplay;
