/**
 * DBTree Component
 *
 * Expandable tree view for a single database showing:
 * - Database name with expand/collapse icon
 * - Tables section (on expand)
 * - Views section (on expand)
 * - Indexes section (on expand)
 *
 * Lazy loads schema when database is expanded.
 */

import { useState, useEffect, useCallback } from 'react';
import { useDatabaseStore } from '../../store';
import { TableItem, type SchemaItemType } from './TableItem';
import type { DatabaseEntry } from '../../types';

export interface DBTreeSchema {
  tables: string[];
  views: string[];
  indexes: string[];
}

export interface DBTreeProps {
  /** Database entry to display */
  database: DatabaseEntry;
  /** Whether the tree is expanded */
  isExpanded: boolean;
  /** Whether this is the active database */
  isActive: boolean;
  /** Current search filter */
  searchFilter?: string;
  /** Callback to toggle expansion */
  onToggleExpand: () => void;
  /** Callback when a table is selected */
  onSelectTable?: (tableName: string) => void;
  /** Callback when a view is selected */
  onSelectView?: (viewName: string) => void;
  /** Callback when an index is selected */
  onSelectIndex?: (indexName: string) => void;
  /** Optional schema override (for testing) */
  initialSchema?: DBTreeSchema | null;
}

export function DBTree({
  database,
  isExpanded,
  isActive,
  searchFilter = '',
  onToggleExpand,
  onSelectTable,
  onSelectView,
  onSelectIndex,
  initialSchema,
}: DBTreeProps) {
  const [schema, setSchema] = useState<DBTreeSchema | null>(initialSchema ?? null);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedItem, setSelectedItem] = useState<{
    type: SchemaItemType;
    name: string;
  } | null>(null);

  // Get schema from store when this is the active database
  const storeSchema = useDatabaseStore((state) =>
    state.activeDbId === database.name ? state.schema : null
  );

  // Load schema when expanded and this is the active database
  useEffect(() => {
    if (isExpanded && storeSchema && isActive) {
      setSchema({
        tables: storeSchema.tables,
        views: storeSchema.views,
        indexes: storeSchema.indexes,
      });
      setIsLoading(false);
    } else if (isExpanded && isActive && !storeSchema && !initialSchema) {
      setIsLoading(true);
    }
  }, [isExpanded, storeSchema, isActive, initialSchema]);

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onToggleExpand();
      }
    },
    [onToggleExpand]
  );

  // Handle item click
  const handleItemClick = useCallback(
    (type: SchemaItemType, name: string) => {
      setSelectedItem({ type, name });
      switch (type) {
        case 'table':
          onSelectTable?.(name);
          break;
        case 'view':
          onSelectView?.(name);
          break;
        case 'index':
          onSelectIndex?.(name);
          break;
      }
    },
    [onSelectTable, onSelectView, onSelectIndex]
  );

  // Filter schema items by search
  const filterItems = (items: string[]): string[] => {
    if (!searchFilter.trim()) return items;
    const lowerFilter = searchFilter.toLowerCase();
    return items.filter((item) => item.toLowerCase().includes(lowerFilter));
  };

  const filteredTables = schema ? filterItems(schema.tables) : [];
  const filteredViews = schema ? filterItems(schema.views) : [];
  const filteredIndexes = schema ? filterItems(schema.indexes) : [];

  return (
    <li role="treeitem" aria-expanded={isExpanded} data-testid={`db-tree-${database.name}`}>
      {/* Database Row */}
      <div
        className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer transition-colors ${
          isActive
            ? 'bg-navy-100 text-navy-900 font-medium'
            : 'hover:bg-navy-50 text-navy-700'
        }`}
        onClick={onToggleExpand}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        role="button"
        aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${database.name}`}
        data-testid={`db-row-${database.name}`}
      >
        {/* Expand/Collapse Icon */}
        <span
          className={`w-4 h-4 flex items-center justify-center transition-transform ${
            isExpanded ? 'rotate-90' : ''
          }`}
          aria-hidden="true"
        >
          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
              clipRule="evenodd"
            />
          </svg>
        </span>

        {/* Database Icon */}
        <span className="text-navy-500" aria-hidden="true">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4"
            />
          </svg>
        </span>

        {/* Database Name */}
        <span className="text-sm truncate flex-1" data-testid={`db-name-${database.name}`}>
          {database.name}
        </span>
      </div>

      {/* Expanded Content */}
      {isExpanded && (
        <ul
          className="ml-4 mt-1 space-y-0.5"
          role="group"
          aria-label={`${database.name} contents`}
          data-testid={`db-contents-${database.name}`}
        >
          {isLoading ? (
            <li className="px-2 py-1 text-xs text-navy-400" data-testid="loading-indicator">
              Loading schema...
            </li>
          ) : !schema ? (
            <li className="px-2 py-1 text-xs text-navy-400" data-testid="open-db-hint">
              Open database to view schema
            </li>
          ) : (
            <>
              {/* Tables Section */}
              {filteredTables.length > 0 && (
                <SchemaSection
                  title="Tables"
                  items={filteredTables}
                  type="table"
                  selectedItem={selectedItem}
                  searchFilter={searchFilter}
                  onItemClick={handleItemClick}
                />
              )}

              {/* Views Section */}
              {filteredViews.length > 0 && (
                <SchemaSection
                  title="Views"
                  items={filteredViews}
                  type="view"
                  selectedItem={selectedItem}
                  searchFilter={searchFilter}
                  onItemClick={handleItemClick}
                />
              )}

              {/* Indexes Section */}
              {filteredIndexes.length > 0 && (
                <SchemaSection
                  title="Indexes"
                  items={filteredIndexes}
                  type="index"
                  selectedItem={selectedItem}
                  searchFilter={searchFilter}
                  onItemClick={handleItemClick}
                />
              )}

              {/* Empty Schema */}
              {filteredTables.length === 0 &&
                filteredViews.length === 0 &&
                filteredIndexes.length === 0 && (
                  <li
                    className="px-2 py-1 text-xs text-navy-400"
                    data-testid="empty-schema"
                  >
                    {searchFilter.trim() ? 'No matching items' : 'Empty database'}
                  </li>
                )}
            </>
          )}
        </ul>
      )}
    </li>
  );
}

interface SchemaSectionProps {
  title: string;
  items: string[];
  type: SchemaItemType;
  selectedItem: { type: SchemaItemType; name: string } | null;
  searchFilter?: string;
  onItemClick: (type: SchemaItemType, name: string) => void;
}

function SchemaSection({
  title,
  items,
  type,
  selectedItem,
  searchFilter,
  onItemClick,
}: SchemaSectionProps) {
  // Proper pluralization for test IDs
  const sectionId = type === 'index' ? 'section-indexes' : `section-${type}s`;
  return (
    <li data-testid={sectionId}>
      <div className="px-2 py-1 text-xs font-medium text-navy-400 uppercase tracking-wider">
        {title}
      </div>
      <ul className="space-y-0.5">
        {items.map((item) => (
          <TableItem
            key={item}
            name={item}
            type={type}
            isSelected={
              selectedItem?.type === type && selectedItem?.name === item
            }
            searchFilter={searchFilter}
            onClick={() => onItemClick(type, item)}
          />
        ))}
      </ul>
    </li>
  );
}

export default DBTree;
