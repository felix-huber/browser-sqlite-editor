/**
 * TableView Component
 *
 * Displays table or view data using the DataGrid, with real CRUD operations
 * backed by the worker. Uses virtual scrolling with windowed SQL fetching
 * for efficient rendering of large datasets.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DataGrid, type AddRowResult, type DeleteRowsResult } from '../grid';
import { ExportDialog } from '../export/ExportDialog';
import type { DDLTableInfo } from '../../core/io/export';
import {
  type DataRow,
  type CellValue,
  type SortState,
  type FilterState,
  generateOrderByClause,
  generateWhereClause,
} from '../grid/useDataGrid';
import { GridSkeleton } from '../../shared/components/GridSkeleton';
import { getWorkerClient } from '../../core/worker/client';
import { quoteIdentifier } from '../../core/db/ddl';
import {
  buildUpdateStatement,
  buildDeleteStatement,
  extractPrimaryKeyFromRow,
  hasUsableIdentifier,
  type PrimaryKeyValue,
} from '../../worker/row-update';
import { generateTieBreakerColumns } from '../../core/sql/query-builder';
import type { TableInfo } from '../../types';

/** Number of rows to fetch per batch */
const BATCH_SIZE = 500;

export interface TableViewProps {
  /** Table name to display */
  tableName: string;
  /** Optional view name (read-only) */
  viewName?: string;
  /** Whether database is read-only */
  isReadOnly?: boolean;
  /** Callback when edit mode changes (for unsaved prompt) */
  onEditStateChange?: (isEditing: boolean) => void;
  /** Provide grid edit actions to allow save/discard from prompts */
  onEditActionsChange?: (actions: import('../grid/DataGrid').GridEditActions | null) => void;
  /** Callback to open SQL editor */
  onOpenSql?: (sql: string) => void;
}

interface TableDataState {
  rows: DataRow[];
  rowKeys: PrimaryKeyValue[];
}

function getDisplayColumns(tableInfo: TableInfo | null): string[] {
  if (!tableInfo) return [];
  return tableInfo.columns
    .filter((col) => !col.hidden)
    .map((col) => col.name);
}

/**
 * Determine if ORDER BY is exactly on rowid (for keyset pagination).
 * This is true only when sorting by a single column that is effectively rowid:
 * - Column named "rowid" (case-insensitive)
 * - INTEGER PRIMARY KEY column (which aliases rowid)
 */
function isOrderByRowid(sortState: SortState, tableInfo: TableInfo): boolean {
  if (sortState.length !== 1) return false;

  const sortCol = sortState[0].column.toLowerCase();

  // Direct rowid sort
  if (sortCol === 'rowid') return true;

  // INTEGER PRIMARY KEY alias rowid (only for non-WITHOUT ROWID tables)
  if (tableInfo.withoutRowid) return false;

  const col = tableInfo.columns.find((c) => c.name.toLowerCase() === sortCol);
  if (!col) return false;

  // INTEGER PRIMARY KEY is an alias for rowid
  return col.pk === 1 && col.type.toUpperCase() === 'INTEGER';
}

/**
 * Generate ORDER BY clause with tie-breaker columns for stable ordering.
 */
function generateOrderByWithTieBreaker(
  sortState: SortState,
  tableInfo: TableInfo
): string {
  const tieBreakerCols = generateTieBreakerColumns(tableInfo);

  if (sortState.length === 0) {
    // Default order: use tie-breaker columns (rowid for regular tables, PK for WITHOUT ROWID)
    if (tieBreakerCols.length === 0) return '';
    return tieBreakerCols.map((col) => `${col} ASC`).join(', ');
  }

  // User's sort columns
  const sortParts = sortState.map(({ column, direction }) => {
    const escapedColumn = quoteIdentifier(column);
    return `${escapedColumn} ${direction.toUpperCase()}`;
  });

  // Add tie-breaker columns that aren't already in the sort
  const sortColNames = new Set(sortState.map((s) => s.column.toLowerCase()));

  for (const col of tieBreakerCols) {
    // Extract column name from quoted identifier (e.g., '"key"' -> 'key')
    const unquotedCol = col.startsWith('"') && col.endsWith('"')
      ? col.slice(1, -1).replace(/""/g, '"')
      : col;

    // Skip if already in sort, unless it's the bare 'rowid' keyword
    if (col !== 'rowid' && sortColNames.has(unquotedCol.toLowerCase())) {
      continue;
    }
    if (col === 'rowid' && sortColNames.has('rowid')) {
      continue;
    }

    // Add tie-breaker with ASC direction
    sortParts.push(`${col} ASC`);
  }

  return sortParts.join(', ');
}

export function TableView({
  tableName,
  viewName,
  isReadOnly = false,
  onEditStateChange,
  onEditActionsChange,
  onOpenSql,
}: TableViewProps) {
  const client = useMemo(() => getWorkerClient(), []);
  const [tableInfo, setTableInfo] = useState<TableInfo | null>(null);
  const [dataState, setDataState] = useState<TableDataState>({ rows: [], rowKeys: [] });
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortState, setSortState] = useState<SortState>([]);
  const [filterState, setFilterState] = useState<FilterState>([]);
  const [hasForeignKeys, setHasForeignKeys] = useState(false);
  const [totalRows, setTotalRows] = useState<number | null>(null);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exportColumns, setExportColumns] = useState<string[]>([]);
  const [exportRows, setExportRows] = useState<unknown[][]>([]);
  const [exportTableInfo, setExportTableInfo] = useState<DDLTableInfo | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportLoading, setExportLoading] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<{ scrollToTop: () => void } | null>(null);
  const [gridHeight, setGridHeight] = useState(400);
  const loadTokenRef = useRef(0);
  const dataStateRef = useRef(dataState);
  dataStateRef.current = dataState;

  const objectName = viewName ?? tableName;

  useEffect(() => {
    return () => {
      onEditActionsChange?.(null);
    };
  }, [onEditActionsChange]);

  // Track container height for DataGrid virtualization
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const updateHeight = () => {
      setGridHeight(el.clientHeight);
    };

    updateHeight();

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(updateHeight);
      observer.observe(el);
    } else {
      window.addEventListener('resize', updateHeight);
    }

    return () => {
      if (observer) {
        observer.disconnect();
      } else {
        window.removeEventListener('resize', updateHeight);
      }
    };
  }, []);

  const fetchForeignKeys = useCallback(async () => {
    try {
      const fks = await client.getForeignKeys();
      const lower = objectName.toLowerCase();
      const hasFk = fks.some(
        (fk) =>
          fk.childTable.toLowerCase() === lower ||
          fk.parentTable.toLowerCase() === lower
      );
      setHasForeignKeys(hasFk);
    } catch {
      setHasForeignKeys(false);
    }
  }, [client, objectName]);

  const fetchTableInfo = useCallback(async () => {
    const token = ++loadTokenRef.current;
    setLoading(true);
    setError(null);

    try {
      const info = await client.getTableInfo(objectName);
      if (token !== loadTokenRef.current) return;
      setTableInfo(info);
      await fetchForeignKeys();
    } catch (err) {
      if (token !== loadTokenRef.current) return;
      setError(err instanceof Error ? err.message : 'Failed to load table');
      setTableInfo(null);
    } finally {
      if (token === loadTokenRef.current) {
        setLoading(false);
      }
    }
  }, [client, objectName, fetchForeignKeys]);

  const fetchRowCount = useCallback(async () => {
    if (!tableInfo) return;
    try {
      const where = generateWhereClause(filterState);
      const sql = `SELECT COUNT(*) as count FROM ${quoteIdentifier(tableInfo.name)} ${where.sql}`;
      const result = await client.query(sql, where.params);
      const count = Number(result.rows[0]?.[0] ?? 0);
      setTotalRows(Number.isFinite(count) ? count : null);
    } catch {
      setTotalRows(null);
    }
  }, [client, tableInfo, filterState]);

  /**
   * Fetch data using windowed SQL fetching.
   * Uses LIMIT/OFFSET by default with tie-breaker columns for stable ordering.
   * Uses keyset pagination only when ORDER BY is exactly rowid.
   */
  const fetchData = useCallback(async (append = false) => {
    if (!tableInfo) return;
    const token = ++loadTokenRef.current;

    if (append) {
      setLoadingMore(true);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      const visibleColumns = getDisplayColumns(tableInfo);
      const escapedColumns = visibleColumns.map((col) => quoteIdentifier(col));
      const selectColumns = tableInfo.withoutRowid
        ? escapedColumns
        : [`rowid AS "__rowid__"`, ...escapedColumns];

      const where = generateWhereClause(filterState);
      const orderBy = generateOrderByWithTieBreaker(sortState, tableInfo);

      const currentData = dataStateRef.current;
      const currentOffset = append ? currentData.rows.length : 0;

      // Decide between keyset and LIMIT/OFFSET pagination
      let sql: string;
      let params: unknown[];

      if (!append && isOrderByRowid(sortState, tableInfo) && !tableInfo.withoutRowid) {
        // Keyset pagination for rowid-only sort (initial load only)
        const baseSql = `SELECT ${selectColumns.join(', ')} FROM ${quoteIdentifier(tableInfo.name)}`;
        const orderClause = orderBy ? `ORDER BY ${orderBy}` : '';
        sql = `${baseSql} ${where.sql} ${orderClause} LIMIT ?`;
        params = [...where.params, BATCH_SIZE];
      } else if (append && isOrderByRowid(sortState, tableInfo) && !tableInfo.withoutRowid && currentData.rows.length > 0) {
        // Keyset pagination for appending - use last rowid
        const lastRowid = currentData.rowKeys[currentData.rowKeys.length - 1];
        if (lastRowid?.type === 'rowid') {
          const baseSql = `SELECT ${selectColumns.join(', ')} FROM ${quoteIdentifier(tableInfo.name)}`;
          const direction = sortState[0]?.direction ?? 'asc';
          const comparator = direction === 'asc' ? '>' : '<';
          const whereClause = where.sql
            ? `${where.sql} AND rowid ${comparator} ?`
            : `WHERE rowid ${comparator} ?`;
          const orderClause = orderBy ? `ORDER BY ${orderBy}` : '';
          sql = `${baseSql} ${whereClause} ${orderClause} LIMIT ?`;
          params = [...where.params, lastRowid.rowid, BATCH_SIZE];
        } else {
          // Fallback to LIMIT/OFFSET
          const baseSql = `SELECT ${selectColumns.join(', ')} FROM ${quoteIdentifier(tableInfo.name)}`;
          const orderClause = orderBy ? `ORDER BY ${orderBy}` : '';
          sql = `${baseSql} ${where.sql} ${orderClause} LIMIT ? OFFSET ?`;
          params = [...where.params, BATCH_SIZE, currentOffset];
        }
      } else {
        // Default: LIMIT/OFFSET with tie-breaker
        const baseSql = `SELECT ${selectColumns.join(', ')} FROM ${quoteIdentifier(tableInfo.name)}`;
        const orderClause = orderBy ? `ORDER BY ${orderBy}` : '';
        sql = `${baseSql} ${where.sql} ${orderClause} LIMIT ? OFFSET ?`;
        params = [...where.params, BATCH_SIZE, currentOffset];
      }

      const result = await client.query(sql, params);
      if (token !== loadTokenRef.current) return;

      const newRows: DataRow[] = [];
      const newRowKeys: PrimaryKeyValue[] = [];

      result.rows.forEach((row) => {
        const rowObj: DataRow = {};
        result.columns.forEach((colName, idx) => {
          rowObj[colName] = row[idx] as CellValue;
        });

        const rowidValue = (rowObj['__rowid__'] as number | bigint | undefined);
        newRowKeys.push(extractPrimaryKeyFromRow(tableInfo, rowObj, rowidValue));
        newRows.push(rowObj);
      });

      if (append) {
        setDataState((prev) => ({
          rows: [...prev.rows, ...newRows],
          rowKeys: [...prev.rowKeys, ...newRowKeys],
        }));
      } else {
        setDataState({ rows: newRows, rowKeys: newRowKeys });
      }
    } catch (err) {
      if (token !== loadTokenRef.current) return;
      const message = err instanceof Error ? err.message : 'Failed to load data';
      setError(message);
      if (!append) {
        setDataState({ rows: [], rowKeys: [] });
      }
    } finally {
      if (token === loadTokenRef.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [client, tableInfo, filterState, sortState]);

  // Load more data for infinite scroll
  const handleLoadMore = useCallback(() => {
    if (loadingMore || loading) return;
    if (totalRows !== null && dataStateRef.current.rows.length >= totalRows) return;
    void fetchData(true);
  }, [fetchData, loadingMore, loading, totalRows]);

  useEffect(() => {
    void fetchTableInfo();
  }, [fetchTableInfo]);

  // Reset data when table changes
  useEffect(() => {
    setDataState({ rows: [], rowKeys: [] });
  }, [objectName]);

  useEffect(() => {
    if (!tableInfo) return;
    void fetchRowCount();
    void fetchData(false);
  }, [tableInfo, fetchRowCount, fetchData]);

  // Reset scroll position and reload data when sort/filter changes
  const handleSortChange = useCallback((newSortState: SortState) => {
    setSortState(newSortState);
    setDataState({ rows: [], rowKeys: [] });
    scrollRef.current?.scrollToTop();
  }, []);

  const handleFilterChange = useCallback((newFilterState: FilterState) => {
    setFilterState(newFilterState);
    setDataState({ rows: [], rowKeys: [] });
    scrollRef.current?.scrollToTop();
  }, []);

  const handleRefresh = useCallback(async () => {
    setDataState({ rows: [], rowKeys: [] });
    await fetchTableInfo();
    if (tableInfo) {
      await fetchRowCount();
      await fetchData(false);
    }
  }, [fetchTableInfo, fetchRowCount, fetchData, tableInfo]);

  const handleOpenExport = useCallback(async () => {
    if (!tableInfo) return;
    setExportError(null);
    setExportLoading(true);
    try {
      const visible = getDisplayColumns(tableInfo);
      const escapedColumns = visible.map((col) => quoteIdentifier(col));
      const where = generateWhereClause(filterState);
      const orderBy = generateOrderByClause(sortState);
      const baseSql = `SELECT ${escapedColumns.join(', ')} FROM ${quoteIdentifier(tableInfo.name)}`;
      const orderClause = orderBy ? `ORDER BY ${orderBy}` : '';
      const sql = `${baseSql} ${where.sql} ${orderClause}`;
      const result = await client.query(sql, where.params);
      setExportColumns(result.columns);
      setExportRows(result.rows);
      const ddlInfo: DDLTableInfo = {
        name: tableInfo.name,
        withoutRowid: tableInfo.withoutRowid,
        columns: tableInfo.columns.map((col) => ({
          name: col.name,
          type: col.type,
          notNull: col.notnull,
          defaultValue: col.dfltValue,
          primaryKey: col.pk,
        })),
      };
      setExportTableInfo(ddlInfo);
      setExportDialogOpen(true);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Failed to export table');
    } finally {
      setExportLoading(false);
    }
  }, [client, tableInfo, filterState, sortState]);

  const handleCellEdit = useCallback(
    async (rowIndex: number, columnName: string, newValue: CellValue): Promise<boolean> => {
      if (!tableInfo) return false;
      const row = dataState.rows[rowIndex];
      const primaryKey = dataState.rowKeys[rowIndex];
      if (!row || !primaryKey) return false;

      try {
        const stmt = buildUpdateStatement({
          tableName: tableInfo.name,
          columnName,
          newValue,
          primaryKey,
          tableInfo,
        });
        await client.exec(stmt.sql, stmt.params);
        // Refresh current view - reload all current data to maintain consistency
        setDataState({ rows: [], rowKeys: [] });
        await fetchData(false);
        return true;
      } catch (err) {
        console.error('Failed to update cell:', err);
        return false;
      }
    },
    [client, tableInfo, dataState, fetchData]
  );

  const handleAddRow = useCallback(
    async (values?: Record<string, unknown>): Promise<AddRowResult> => {
      if (!tableInfo) return { success: false, error: 'Table not loaded' };

      try {
        if (!values) {
          const hasGeneratedColumns = tableInfo.columns.some((col) => col.generated !== null);
          if (hasGeneratedColumns) {
            return { success: false, needsForm: true };
          }

          try {
            await client.exec(`INSERT INTO ${quoteIdentifier(tableInfo.name)} DEFAULT VALUES`);
            setDataState({ rows: [], rowKeys: [] });
            await fetchData(false);
            return { success: true };
          } catch (err) {
            const requiredColumns = tableInfo.columns.filter(
              (col) => col.generated === null && col.notnull && col.dfltValue === null
            );
            if (requiredColumns.length > 0) {
              return { success: false, needsForm: true };
            }
            return {
              success: false,
              error: err instanceof Error ? err.message : 'Failed to add row',
            };
          }
        }

        const columns = Object.keys(values);
        if (columns.length === 0) {
          await client.exec(`INSERT INTO ${quoteIdentifier(tableInfo.name)} DEFAULT VALUES`);
          setDataState({ rows: [], rowKeys: [] });
          await fetchData(false);
          return { success: true };
        }

        const placeholders = columns.map(() => '?').join(', ');
        const sql = `INSERT INTO ${quoteIdentifier(tableInfo.name)} (${columns
          .map((col) => quoteIdentifier(col))
          .join(', ')}) VALUES (${placeholders})`;
        const params = columns.map((col) => values[col] ?? null);
        await client.exec(sql, params);
        setDataState({ rows: [], rowKeys: [] });
        await fetchData(false);
        return { success: true };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : 'Failed to add row',
        };
      }
    },
    [client, tableInfo, fetchData]
  );

  const handleDeleteRows = useCallback(
    async (rowIndices: number[]): Promise<DeleteRowsResult> => {
      if (!tableInfo) return { success: false, error: 'Table not loaded' };
      if (rowIndices.length === 0) return { success: true, deletedCount: 0 };

      try {
        await client.exec('BEGIN');
        let deleted = 0;
        for (const rowIndex of rowIndices) {
          const pk = dataState.rowKeys[rowIndex];
          if (!pk) continue;
          const stmt = buildDeleteStatement(tableInfo.name, pk);
          await client.exec(stmt.sql, stmt.params);
          deleted += 1;
        }
        await client.exec('COMMIT');
        setDataState({ rows: [], rowKeys: [] });
        await fetchData(false);
        return { success: true, deletedCount: deleted };
      } catch (err) {
        try {
          await client.exec('ROLLBACK');
        } catch {
          // ignore rollback failure
        }
        return {
          success: false,
          error: err instanceof Error ? err.message : 'Failed to delete rows',
        };
      }
    },
    [client, tableInfo, dataState, fetchData]
  );

  // Check if table has a usable identifier for row edits
  const canIdentifyRows = tableInfo ? hasUsableIdentifier(tableInfo) : true;
  const effectiveReadOnly = isReadOnly || tableInfo?.isView || tableInfo?.isVirtual || !canIdentifyRows;

  const visibleColumns = useMemo(() => getDisplayColumns(tableInfo), [tableInfo]);

  const rowCountLabel = totalRows !== null ? `${totalRows} rows` : `${dataState.rows.length} rows`;
  const loadedInfo = totalRows !== null && dataState.rows.length < totalRows
    ? `Loaded ${dataState.rows.length} of ${totalRows}`
    : null;

  // Determine read-only reason for banner
  const readOnlyReason = !canIdentifyRows
    ? 'No usable row identifier'
    : tableInfo?.isView
      ? 'View'
      : tableInfo?.isVirtual
        ? 'Virtual table'
        : isReadOnly
          ? 'Read-only database'
          : null;

  return (
    <div className="flex flex-col h-full" data-testid="table-view">
      <div className="h-10 bg-white border-b border-navy-200 flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-navy-700" data-testid="table-title">
            {objectName}
          </span>
          <span className="text-xs text-navy-500" data-testid="table-row-count">
            {rowCountLabel}
          </span>
          {loadedInfo && (
            <span className="text-xs text-navy-400" data-testid="table-loaded-info">
              {loadedInfo}
            </span>
          )}
          {effectiveReadOnly && readOnlyReason && (
            <span
              className="text-xs text-amber-600"
              data-testid="table-readonly"
              title={readOnlyReason}
            >
              Read-only{readOnlyReason ? ` (${readOnlyReason})` : ''}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleRefresh}
            className="px-2 py-1 text-xs font-medium text-navy-600 hover:bg-navy-100 rounded transition-colors"
            data-testid="table-refresh-button"
          >
            Refresh
          </button>
          <button
            onClick={handleOpenExport}
            className="px-2 py-1 text-xs font-medium text-navy-600 hover:bg-navy-100 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            data-testid="table-export-button"
            disabled={exportLoading || !tableInfo}
          >
            {exportLoading ? 'Exporting…' : 'Export'}
          </button>
          {onOpenSql && (
            <button
              onClick={() =>
                onOpenSql(
                  `SELECT ${visibleColumns.map((col) => quoteIdentifier(col)).join(', ')} FROM ${quoteIdentifier(objectName)} LIMIT 100;`
                )
              }
              className="px-2 py-1 text-xs font-medium text-navy-600 hover:bg-navy-100 rounded transition-colors"
              data-testid="table-open-sql-button"
            >
              Open in SQL
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="px-4 py-2 text-sm text-red-700 bg-red-50 border-b border-red-200" data-testid="table-error">
          {error}
        </div>
      )}
      {exportError && (
        <div className="px-4 py-2 text-sm text-red-700 bg-red-50 border-b border-red-200" data-testid="export-error">
          {exportError}
        </div>
      )}

      <div ref={containerRef} className="flex-1 overflow-hidden">
        {loading && dataState.rows.length === 0 ? (
          <GridSkeleton rowCount={8} columnCount={Math.max(visibleColumns.length, 4)} height={gridHeight} />
        ) : (
          <div className="relative" style={{ height: gridHeight }}>
            <DataGrid
              tableInfo={tableInfo}
              data={dataState.rows}
              height={gridHeight}
              isReadOnly={effectiveReadOnly}
              sortState={sortState}
              onSortChange={handleSortChange}
              filterState={filterState}
              onFilterChange={handleFilterChange}
              onCellEdit={handleCellEdit}
              onEditStateChange={onEditStateChange}
              onEditActionsChange={onEditActionsChange}
              onAddRow={tableInfo ? handleAddRow : undefined}
              onDeleteRows={tableInfo ? handleDeleteRows : undefined}
              hasForeignKeys={hasForeignKeys}
              totalRowsAvailable={totalRows ?? undefined}
              onLoadMore={handleLoadMore}
              isLoadingMore={loadingMore}
              scrollRef={scrollRef}
            />
            {(loading || loadingMore) && dataState.rows.length > 0 && (
              <div className="absolute bottom-0 left-0 right-0 h-8 bg-white/80 flex items-center justify-center text-sm text-gray-600">
                Loading more…
              </div>
            )}
          </div>
        )}
      </div>

      <ExportDialog
        isOpen={exportDialogOpen}
        onClose={() => setExportDialogOpen(false)}
        tableName={tableInfo?.name ?? objectName}
        columns={exportColumns}
        rows={exportRows}
        tableInfo={exportTableInfo ?? undefined}
      />
    </div>
  );
}

export default TableView;
