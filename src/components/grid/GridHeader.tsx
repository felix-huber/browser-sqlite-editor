/**
 * Grid header and filter UI.
 */

import { memo, useEffect, useRef, useState } from 'react';
import {
  getColumnTypeCategory,
  type ColumnFilter,
  type NumericFilterOperator,
  type SortDirection,
  type TextFilterOperator,
} from './useDataGrid';

// =============================================================================
// Type Icons
// =============================================================================

const TYPE_ICONS: Record<string, string> = {
  INTEGER: '123',
  INT: '123',
  BIGINT: '123',
  SMALLINT: '123',
  TINYINT: '123',
  TEXT: 'Aa',
  VARCHAR: 'Aa',
  CHAR: 'Aa',
  CLOB: 'Aa',
  REAL: '1.2',
  FLOAT: '1.2',
  DOUBLE: '1.2',
  NUMERIC: '1.2',
  DECIMAL: '1.2',
  BLOB: '01',
  BOOLEAN: '✓',
  DATE: '📅',
  DATETIME: '📅',
  TIMESTAMP: '📅',
};

function getTypeIndicator(type: string): string {
  if (!type) return '?';
  const upperType = type.toUpperCase().split('(')[0].trim();
  return TYPE_ICONS[upperType] || '?';
}

function getTypeDisplayName(type: string): string {
  if (!type) return 'UNKNOWN';
  return type.toUpperCase();
}

// =============================================================================
// Filter Popover
// =============================================================================

interface FilterPopoverProps {
  columnName: string;
  columnType: string;
  currentFilter: ColumnFilter | null;
  onApplyFilter: (filter: ColumnFilter | null) => void;
  onClose: () => void;
}

const TEXT_OPERATORS: { value: TextFilterOperator; label: string }[] = [
  { value: 'contains', label: 'Contains' },
  { value: 'equals', label: 'Equals' },
  { value: 'starts_with', label: 'Starts with' },
  { value: 'ends_with', label: 'Ends with' },
  { value: 'is_empty', label: 'Is empty' },
  { value: 'is_not_empty', label: 'Is not empty' },
];

const NUMERIC_OPERATORS: { value: NumericFilterOperator; label: string }[] = [
  { value: 'eq', label: 'Equals' },
  { value: 'neq', label: 'Not equals' },
  { value: 'gt', label: 'Greater than' },
  { value: 'lt', label: 'Less than' },
  { value: 'gte', label: 'Greater or equal' },
  { value: 'lte', label: 'Less or equal' },
  { value: 'between', label: 'Between' },
];

const FilterPopover = memo(function FilterPopover({
  columnName,
  columnType,
  currentFilter,
  onApplyFilter,
  onClose,
}: FilterPopoverProps) {
  const typeCategory = getColumnTypeCategory(columnType);

  const [operator, setOperator] = useState<string>(() => {
    if (currentFilter) return currentFilter.operator;
    if (typeCategory === 'numeric') return 'eq';
    return 'contains';
  });
  const [value, setValue] = useState<string>(() => {
    if (currentFilter?.value !== undefined) return String(currentFilter.value);
    return '';
  });
  const [value2, setValue2] = useState<string>(() => {
    if (currentFilter?.value2 !== undefined) return String(currentFilter.value2);
    return '';
  });

  const needsValue = !['is_empty', 'is_not_empty', 'is_null', 'is_not_null'].includes(operator);
  const needsSecondValue = operator === 'between';

  const handleApply = () => {
    if (needsValue && !value.trim()) {
      return;
    }
    if (needsSecondValue && !value2.trim()) {
      return;
    }

    if (typeCategory === 'numeric' && needsValue) {
      const parsed = parseFloat(value);
      if (Number.isNaN(parsed)) {
        return;
      }
    }
    if (needsSecondValue) {
      const parsed2 = parseFloat(value2);
      if (Number.isNaN(parsed2)) {
        return;
      }
    }

    const filter: ColumnFilter = {
      column: columnName,
      operator: operator as ColumnFilter['operator'],
    };

    if (needsValue) {
      if (typeCategory === 'numeric') {
        filter.value = parseFloat(value);
      } else {
        filter.value = value;
      }
    }

    if (needsSecondValue) {
      filter.value2 = parseFloat(value2);
    }

    onApplyFilter(filter);
    onClose();
  };

  const handleClear = () => {
    onApplyFilter(null);
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleApply();
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  const handlePopoverClick = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  return (
    <div
      className="absolute top-full left-0 mt-1 bg-white border border-gray-300 rounded-md shadow-lg z-50 p-3 min-w-[200px]"
      onClick={handlePopoverClick}
      onKeyDown={handleKeyDown}
      data-testid={`filter-popover-${columnName}`}
    >
      <div className="text-xs font-semibold text-gray-600 mb-2">
        Filter: {columnName}
      </div>

      <div className="mb-2">
        <select
          className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
          value={operator}
          onChange={(e) => setOperator(e.target.value)}
          data-testid={`filter-operator-${columnName}`}
        >
          {typeCategory === 'numeric' ? (
            <>
              <optgroup label="Numeric">
                {NUMERIC_OPERATORS.map((op) => (
                  <option key={op.value} value={op.value}>
                    {op.label}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Null">
                <option value="is_null">Is NULL</option>
                <option value="is_not_null">Is not NULL</option>
              </optgroup>
            </>
          ) : (
            <>
              <optgroup label="Text">
                {TEXT_OPERATORS.map((op) => (
                  <option key={op.value} value={op.value}>
                    {op.label}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Null">
                <option value="is_null">Is NULL</option>
                <option value="is_not_null">Is not NULL</option>
              </optgroup>
            </>
          )}
        </select>
      </div>

      {needsValue && (
        <div className="mb-2">
          <input
            type={typeCategory === 'numeric' ? 'number' : 'text'}
            className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
            placeholder={typeCategory === 'numeric' ? 'Enter number...' : 'Enter text...'}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoFocus
            data-testid={`filter-value-${columnName}`}
          />
        </div>
      )}

      {needsSecondValue && (
        <div className="mb-2">
          <input
            type="number"
            className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
            placeholder="And..."
            value={value2}
            onChange={(e) => setValue2(e.target.value)}
            data-testid={`filter-value2-${columnName}`}
          />
        </div>
      )}

      <div className="flex gap-2">
        <button
          className="flex-1 px-2 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
          onClick={handleApply}
          data-testid={`filter-apply-${columnName}`}
        >
          Apply
        </button>
        {currentFilter && (
          <button
            className="flex-1 px-2 py-1 text-sm bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
            onClick={handleClear}
            data-testid={`filter-clear-${columnName}`}
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
});

// =============================================================================
// Column Header
// =============================================================================

export interface ColumnHeaderProps {
  name: string;
  type: string;
  isPrimaryKey: boolean;
  isGenerated: boolean;
  generatedType: 'stored' | 'virtual' | null;
  width: number;
  isResizing: boolean;
  onResizeStart: () => void;
  sortDirection: SortDirection | null;
  sortIndex: number | null;
  onSortClick: (addToSort: boolean) => void;
  currentFilter: ColumnFilter | null;
  onFilterChange: (filter: ColumnFilter | null) => void;
}

export const ColumnHeader = memo(function ColumnHeader({
  name,
  type,
  isPrimaryKey,
  isGenerated,
  generatedType,
  width,
  isResizing,
  onResizeStart,
  sortDirection,
  sortIndex,
  onSortClick,
  currentFilter,
  onFilterChange,
}: ColumnHeaderProps) {
  const [showFilter, setShowFilter] = useState(false);
  const headerRef = useRef<HTMLDivElement>(null);

  const handleClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.classList.contains('cursor-col-resize')) return;
    if (target.closest('[data-filter-icon]')) return;
    onSortClick(e.shiftKey);
  };

  const handleFilterClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowFilter(!showFilter);
  };

  useEffect(() => {
    if (!showFilter) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (headerRef.current && !headerRef.current.contains(e.target as Node)) {
        setShowFilter(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showFilter]);

  const hasActiveFilter = currentFilter !== null;

  return (
    <div
      ref={headerRef}
      className="relative flex items-center gap-1 px-2 h-full overflow-hidden cursor-pointer select-none hover:bg-gray-200"
      style={{ width }}
      onClick={handleClick}
      role="columnheader"
      aria-sort={sortDirection === 'asc' ? 'ascending' : sortDirection === 'desc' ? 'descending' : 'none'}
    >
      <span
        className="text-xs text-gray-500 font-mono flex-shrink-0"
        title={getTypeDisplayName(type)}
      >
        {getTypeIndicator(type)}
      </span>

      <span className="truncate font-medium" title={name}>
        {name}
      </span>

      {sortDirection && (
        <span
          className="text-blue-600 flex-shrink-0 font-bold text-sm"
          data-testid={`sort-indicator-${name}`}
          title={`Sorted ${sortDirection === 'asc' ? 'ascending' : 'descending'}${sortIndex ? ` (${sortIndex})` : ''}`}
        >
          {sortDirection === 'asc' ? '▲' : '▼'}
          {sortIndex && <sup className="text-xs">{sortIndex}</sup>}
        </span>
      )}

      <button
        data-filter-icon
        className={`flex-shrink-0 p-0.5 rounded hover:bg-gray-300 ${
          hasActiveFilter ? 'text-blue-600' : 'text-gray-400'
        }`}
        onClick={handleFilterClick}
        title={hasActiveFilter ? 'Filter active (click to edit)' : 'Add filter'}
        data-testid={`filter-icon-${name}`}
      >
        <svg
          className="w-3.5 h-3.5"
          fill={hasActiveFilter ? 'currentColor' : 'none'}
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"
          />
        </svg>
      </button>

      {isPrimaryKey && (
        <span className="text-amber-500 flex-shrink-0" title="Primary Key">
          🔑
        </span>
      )}

      {isGenerated && (
        <span
          className="text-blue-500 flex-shrink-0 cursor-help"
          title={`Generated column (${generatedType || 'unknown'})`}
        >
          ⚡
        </span>
      )}

      <div
        className={`absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-blue-500 ${
          isResizing ? 'bg-blue-500' : ''
        }`}
        onMouseDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onResizeStart();
        }}
        onTouchStart={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onResizeStart();
        }}
      />

      {showFilter && (
        <FilterPopover
          columnName={name}
          columnType={type}
          currentFilter={currentFilter}
          onApplyFilter={onFilterChange}
          onClose={() => setShowFilter(false)}
        />
      )}
    </div>
  );
});
