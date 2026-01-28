/**
 * Sidebar Navigator Component
 *
 * Main sidebar displaying database list with expand/collapse tree.
 * Features:
 * - Database list from store
 * - Search filter
 * - Expand/collapse DB to show tables, views, indexes
 * - Active state highlighting
 * - Lazy schema loading on expand
 */

import { useState, useCallback, useMemo } from 'react';
import { useDatabases, useDatabaseStore } from '../../store';
import { DBTree } from './DBTree';

export interface SidebarProps {
  /** Whether the sidebar is collapsed */
  collapsed?: boolean;
  /** Callback when a table is selected */
  onSelectTable?: (dbName: string, tableName: string) => void;
  /** Callback when a view is selected */
  onSelectView?: (dbName: string, viewName: string) => void;
  /** Callback when an index is selected */
  onSelectIndex?: (dbName: string, indexName: string) => void;
}

export function Sidebar({
  collapsed = false,
  onSelectTable,
  onSelectView,
  onSelectIndex,
}: SidebarProps) {
  const databases = useDatabases();
  const activeDbId = useDatabaseStore((state) => state.activeDbId);
  const [searchFilter, setSearchFilter] = useState('');
  const [expandedDbs, setExpandedDbs] = useState<Set<string>>(new Set());

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
            type="text"
            placeholder="Search..."
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-sm bg-navy-50 border border-navy-200 rounded focus:outline-none focus:ring-2 focus:ring-navy-600 focus:border-transparent"
            data-testid="search-input"
            aria-label="Search databases and tables"
          />
        </div>
      </div>

      {/* Tree View */}
      <nav
        className="flex-1 overflow-y-auto p-2"
        aria-label="Database navigator"
      >
        {filteredDatabases.length === 0 ? (
          <EmptyState hasFilter={!!searchFilter.trim()} />
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
}

function EmptyState({ hasFilter }: EmptyStateProps) {
  return (
    <div
      className="text-sm text-navy-500 p-3 text-center"
      data-testid="empty-state"
    >
      {hasFilter ? 'No matching results' : 'No databases'}
    </div>
  );
}

export default Sidebar;
