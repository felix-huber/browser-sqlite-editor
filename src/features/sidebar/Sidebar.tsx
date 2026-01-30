/**
 * Sidebar Navigator Component
 *
 * Main sidebar displaying database list with expand/collapse tree.
 * Features:
 * - Database list from store
 * - Search filter with debounce (150ms)
 * - Expand/collapse DB to show tables, views, indexes
 * - Active state highlighting
 * - Lazy schema loading on expand
 * - Match highlighting in search results
 */

import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useDatabases, useDatabaseStore } from '../../store';
import { DBTree } from './DBTree';

const areSetsEqual = (left: Set<string>, right: Set<string>): boolean => {
  if (left.size !== right.size) {
    return false;
  }
  for (const value of left) {
    if (!right.has(value)) {
      return false;
    }
  }
  return true;
};

export interface SidebarProps {
  /** Whether the sidebar is collapsed */
  collapsed?: boolean;
  /** Callback when a database is selected */
  onOpenDatabase?: (dbName: string) => Promise<boolean> | boolean | void;
  /** Callback when a table is selected */
  onSelectTable?: (dbName: string, tableName: string) => void;
  /** Callback when a view is selected */
  onSelectView?: (dbName: string, viewName: string) => void;
  /** Callback when an index is selected */
  onSelectIndex?: (dbName: string, indexName: string) => void;
}

export function Sidebar({
  collapsed = false,
  onOpenDatabase,
  onSelectTable,
  onSelectView,
  onSelectIndex,
}: SidebarProps) {
  const databases = useDatabases();
  const activeDbId = useDatabaseStore((state) => state.activeDbId);
  const [searchInput, setSearchInput] = useState('');
  const [debouncedFilter, setDebouncedFilter] = useState('');
  const [expandedDbs, setExpandedDbs] = useState<Set<string>>(new Set());
  const searchInputRef = useRef<HTMLInputElement>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounce search filter (150ms delay, min 2 chars)
  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      // Only apply filter if 2+ chars or empty
      if (searchInput.trim().length >= 2 || searchInput.trim().length === 0) {
        setDebouncedFilter(searchInput);
      }
    }, 150);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [searchInput]);

  // Use debounced filter for actual filtering
  const searchFilter = debouncedFilter;

  // Track whether search filter was active in previous render
  const prevSearchFilterRef = useRef('');
  // Track expansion state before search started
  const savedExpandedDbsRef = useRef<Set<string> | null>(null);

  // Auto-expand all databases when search is active, restore when cleared
  useEffect(() => {
    const hadFilter = prevSearchFilterRef.current.trim().length > 0;
    const hasFilter = searchFilter.trim().length > 0;
    const allDbNames = new Set(databases.map((db) => db.name));
    const expandedMatchesAll = areSetsEqual(expandedDbs, allDbNames);

    if (hasFilter && !hadFilter) {
      // Search is starting, save current expansion state and auto-expand all
      savedExpandedDbsRef.current = new Set(expandedDbs);
      if (!expandedMatchesAll) {
        setExpandedDbs(allDbNames);
      }
    } else if (!hasFilter && hadFilter && savedExpandedDbsRef.current !== null) {
      // Search is ending, restore previous expansion state
      const savedExpanded = savedExpandedDbsRef.current;
      savedExpandedDbsRef.current = null;
      if (!areSetsEqual(expandedDbs, savedExpanded)) {
        setExpandedDbs(new Set(savedExpanded));
      }
    } else if (hasFilter) {
      // Search is active and databases changed, keep all expanded
      if (!expandedMatchesAll) {
        setExpandedDbs(allDbNames);
      }
    }

    prevSearchFilterRef.current = searchFilter;
  }, [searchFilter, databases, expandedDbs]);

  // Filter databases by search
  const filteredDatabases = useMemo(() => {
    if (!searchFilter.trim()) {
      return databases;
    }
    const lowerFilter = searchFilter.toLowerCase();
    return databases.filter((db) =>
      db.name.toLowerCase().includes(lowerFilter)
    );
  }, [databases, searchFilter]);

  // Toggle database expansion
  const handleToggleExpand = useCallback((dbName: string) => {
    setExpandedDbs((prev) => {
      const next = new Set(prev);
      if (next.has(dbName)) {
        next.delete(dbName);
      } else {
        next.add(dbName);
      }
      return next;
    });
  }, []);

  // Handle table selection
  const handleSelectTable = useCallback(
    (dbName: string, tableName: string) => {
      onSelectTable?.(dbName, tableName);
    },
    [onSelectTable]
  );

  // Handle view selection
  const handleSelectView = useCallback(
    (dbName: string, viewName: string) => {
      onSelectView?.(dbName, viewName);
    },
    [onSelectView]
  );

  // Handle index selection
  const handleSelectIndex = useCallback(
    (dbName: string, indexName: string) => {
      onSelectIndex?.(dbName, indexName);
    },
    [onSelectIndex]
  );

  // Clear search
  const clearSearch = useCallback(() => {
    setSearchInput('');
    setDebouncedFilter('');
    searchInputRef.current?.focus();
  }, []);

  // Handle escape key to clear search
  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        clearSearch();
      }
    },
    [clearSearch]
  );

  if (collapsed) {
    return null;
  }

  return (
    <aside
      className="w-60 bg-white border-r border-navy-200 flex flex-col shrink-0"
      data-testid="sidebar"
    >
      {/* Search */}
      <div className="p-3 border-b border-navy-200">
        <div className="relative">
          <svg
            className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-navy-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Search tables, views..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            className={`w-full pl-8 py-1.5 text-sm bg-navy-50 border border-navy-200 rounded focus:outline-none focus:ring-2 focus:ring-navy-600 focus:border-transparent ${
              searchInput ? 'pr-8' : 'pr-3'
            }`}
            data-testid="search-input"
            aria-label="Search databases and tables"
          />
          {searchInput && (
            <button
              type="button"
              onClick={clearSearch}
              className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-navy-400 hover:text-navy-600 focus:outline-none"
              aria-label="Clear search"
              data-testid="clear-search-button"
            >
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
      </div>

      {/* Tree View */}
      <nav
        className="flex-1 overflow-y-auto p-2"
        aria-label="Database navigator"
      >
        {filteredDatabases.length === 0 ? (
          <EmptyState
            hasFilter={!!searchFilter.trim()}
            filterText={searchFilter.trim()}
            onClearSearch={clearSearch}
          />
        ) : (
          <ul className="space-y-1" role="tree" aria-label="Databases">
            {filteredDatabases.map((db) => (
              <DBTree
                key={db.name}
                database={db}
                isExpanded={expandedDbs.has(db.name)}
                isActive={db.name === activeDbId}
                searchFilter={searchFilter}
                onToggleExpand={() => handleToggleExpand(db.name)}
                onOpenDatabase={onOpenDatabase}
                onSelectTable={(tableName) =>
                  handleSelectTable(db.name, tableName)
                }
                onSelectView={(viewName) => handleSelectView(db.name, viewName)}
                onSelectIndex={(indexName) =>
                  handleSelectIndex(db.name, indexName)
                }
              />
            ))}
          </ul>
        )}
      </nav>
    </aside>
  );
}

interface EmptyStateProps {
  hasFilter: boolean;
  filterText?: string;
  onClearSearch?: () => void;
}

function EmptyState({ hasFilter, filterText, onClearSearch }: EmptyStateProps) {
  return (
    <div
      className="text-sm text-navy-500 p-3 text-center"
      data-testid="empty-state"
    >
      {hasFilter ? (
        <div className="space-y-2">
          <p>
            No matches for "<span className="font-medium">{filterText}</span>"
          </p>
          {onClearSearch && (
            <button
              type="button"
              onClick={onClearSearch}
              className="text-navy-600 hover:text-navy-800 underline text-xs"
              data-testid="empty-state-clear-button"
            >
              Clear search
            </button>
          )}
        </div>
      ) : (
        'No databases'
      )}
    </div>
  );
}

export default Sidebar;
