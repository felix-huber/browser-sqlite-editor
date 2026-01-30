import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import type { QueryHistoryItem } from '../../types';
import { formatRelativeTime } from '../../shared/format/time';

/**
 * Truncate query for display (first 50 chars)
 */
function truncateForDisplay(sql: string): string {
  const normalized = sql.replace(/\s+/g, ' ').trim();
  if (normalized.length <= 50) {
    return normalized;
  }
  return normalized.slice(0, 47) + '...';
}

export interface QueryHistoryDropdownProps {
  /** Query history items */
  history: QueryHistoryItem[];
  /** Callback when an item is selected */
  onSelect: (item: QueryHistoryItem) => void;
  /** Callback when an item is deleted */
  onDelete?: (index: number) => void;
  /** Callback to clear all history */
  onClear?: () => void;
}

/**
 * Query history dropdown with search, delete, and clear functionality.
 */
export function QueryHistoryDropdown({
  history,
  onSelect,
  onDelete,
  onClear,
}: QueryHistoryDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setSearchQuery('');
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Focus search input when dropdown opens
  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [isOpen]);

  // Filter history based on search query
  const filteredHistory = useMemo(() => {
    if (!searchQuery.trim()) {
      return history;
    }
    const query = searchQuery.toLowerCase();
    return history.filter((item) => item.sql.toLowerCase().includes(query));
  }, [history, searchQuery]);

  const handleToggle = useCallback(() => {
    setIsOpen((prev) => !prev);
    if (isOpen) {
      setSearchQuery('');
    }
  }, [isOpen]);

  const handleSelect = useCallback(
    (item: QueryHistoryItem) => {
      onSelect(item);
      setIsOpen(false);
      setSearchQuery('');
    },
    [onSelect]
  );

  const handleDelete = useCallback(
    (e: React.MouseEvent, index: number) => {
      e.stopPropagation();
      onDelete?.(index);
    },
    [onDelete]
  );

  const handleClear = useCallback(() => {
    onClear?.();
    setIsOpen(false);
    setSearchQuery('');
  }, [onClear]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
        setSearchQuery('');
      }
    },
    []
  );

  if (history.length === 0) {
    return null;
  }

  return (
    <div className="relative" ref={dropdownRef} onKeyDown={handleKeyDown}>
      <button
        onClick={handleToggle}
        className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-navy-700 bg-white border border-navy-300 rounded hover:bg-navy-50 transition-colors"
        data-testid="history-button"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        History
        <svg
          className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {isOpen && (
        <div
          className="absolute right-0 mt-1 w-96 bg-white border border-navy-200 rounded-lg shadow-lg z-20"
          data-testid="history-dropdown"
          role="listbox"
        >
          {/* Search input */}
          <div className="p-2 border-b border-navy-200">
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search history..."
              className="w-full px-3 py-1.5 text-sm border border-navy-300 rounded focus:outline-none focus:ring-2 focus:ring-navy-500 focus:border-transparent"
              data-testid="history-search"
            />
          </div>

          {/* History items */}
          <div className="max-h-64 overflow-auto" data-testid="history-list">
            {filteredHistory.length === 0 ? (
              <div
                className="px-3 py-4 text-center text-sm text-navy-500"
                data-testid="history-empty"
              >
                {searchQuery ? 'No matching queries found' : 'No history yet'}
              </div>
            ) : (
              filteredHistory.map((item, index) => {
                // Find the original index for deletion
                const originalIndex = history.indexOf(item);
                return (
                  <div
                    key={`${item.executedAt}-${index}`}
                    className="group flex items-start gap-2 px-3 py-2 hover:bg-navy-50 border-b border-navy-100 last:border-b-0 cursor-pointer"
                    onClick={() => handleSelect(item)}
                    data-testid={`history-item-${index}`}
                    role="option"
                    title={item.sql}
                  >
                    <div className="flex-1 min-w-0">
                      <div
                        className="font-mono text-sm text-navy-900 truncate"
                        data-testid={`history-item-query-${index}`}
                      >
                        {truncateForDisplay(item.sql)}
                      </div>
                      <div
                        className="text-xs text-navy-500 mt-0.5"
                        data-testid={`history-item-time-${index}`}
                      >
                        {formatRelativeTime(item.executedAt)}
                      </div>
                    </div>
                    {onDelete && (
                      <button
                        onClick={(e) => handleDelete(e, originalIndex)}
                        className="opacity-0 group-hover:opacity-100 p-1 text-navy-400 hover:text-red-600 transition-opacity"
                        data-testid={`history-delete-${index}`}
                        title="Delete from history"
                        aria-label="Delete from history"
                      >
                        <svg
                          className="w-4 h-4"
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
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Clear all button */}
          {onClear && history.length > 0 && (
            <div className="p-2 border-t border-navy-200">
              <button
                onClick={handleClear}
                className="w-full px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 rounded transition-colors"
                data-testid="history-clear"
              >
                Clear History
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default QueryHistoryDropdown;
