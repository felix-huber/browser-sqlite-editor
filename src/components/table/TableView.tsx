/**
 * TableView Component
 *
 * Displays table or view data using the DataGrid, with real CRUD operations
 * backed by the worker.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DataGrid, type AddRowResult, type DeleteRowsResult } from '../grid';
import { ExportDialog } from '../export/ExportDialog';
import type { DDLTableInfo } from '../../lib/export';
import {
  type DataRow,
  type CellValue,
  type SortState,
  type FilterState,
  generateOrderByClause,
  generateWhereClause,
} from '../grid/useDataGrid';
import { GridSkeleton } from '../common/GridSkeleton';
import { getWorkerClient } from '../../lib/worker-client';
import { quoteIdentifier } from '../../lib/ddl';
import {
  buildUpdateStatement,
  extractPrimaryKeyFromRow,
  type PrimaryKeyValue,
} from '../../worker/row-update';
import type { TableInfo } from '../../types';

const DEFAULT_PAGE_SIZE = 200;

export interface TableViewProps {
  /** Table name to display */
  tableName: string;
  /** Optional view name (read-only) */
  viewName?: string;
  /** Whether database is read-only */
  isReadOnly?: boolean;
  /** Callback when edit mode changes (for unsaved prompt) */
  onEditStateChange?: (isEditing: boolean) => void;
  /** Callback to open SQL editor */
  onOpenSql?: (sql: string) => void;
}

interface TableDataState {
  rows: DataRow[];
  rowKeys: PrimaryKeyValue[];
}

function buildDeleteStatement(
  tableName: string,
  primaryKey: PrimaryKeyValue
): { sql: string; params: unknown[] } {
  const escapedTable = quoteIdentifier(tableName);

  if (primaryKey.type === 'rowid') {
    return {
      sql: `DELETE FROM ${escapedTable} WHERE rowid = ?`,
      params: [primaryKey.rowid],
    };
  }

  const conditions: string[] = [];
  const params: unknown[] = [];

  primaryKey.columns.forEach((value, colName) => {
    const escapedCol = quoteIdentifier(colName);
    if (value === null) {
      conditions.push(`${escapedCol} IS NULL`);
    } else {
      conditions.push(`${escapedCol} = ?`);
      params.push(value);
    }
  });

  return {
    sql: `DELETE FROM ${escapedTable} WHERE ${conditions.join(' AND ')}`,
    params,
  };
}

function getDisplayColumns(tableInfo: TableInfo | null): string[] {
  if (!tableInfo) return [];
  return tableInfo.columns
    .filter((col) => !col.hidden)
    .map((col) => col.name);
}

export function TableView({
  tableName,
  viewName,
  isReadOnly = false,
  onEditStateChange,
  onOpenSql,
}: TableViewProps) {
  const client = useMemo(() => getWorkerClient(), []);
  const [tableInfo, setTableInfo] = useState<TableInfo | null>(null);
  const [dataState, setDataState] = useState<TableDataState>({ rows: [], rowKeys: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortState, setSortState] = useState<SortState>([]);
  const [filterState, setFilterState] = useState<FilterState>([]);
  const [hasForeignKeys, setHasForeignKeys] = useState(false);
  const [pageSize] = useState(DEFAULT_PAGE_SIZE);
  const [offset, setOffset] = useState(0);
  const [totalRows, setTotalRows] = useState<number | null>(null);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exportColumns, setExportColumns] = useState<string[]>([]);
  const [exportRows, setExportRows] = useState<unknown[][]>([]);
  const [exportTableInfo, setExportTableInfo] = useState<DDLTableInfo | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportLoading, setExportLoading] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const [gridHeight, setGridHeight] = useState(400);
  const loadTokenRef = useRef(0);

  const objectName = viewName ?? tableName;

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

  const fetchData = useCallback(async () => {
    if (!tableInfo) return;
    const token = ++loadTokenRef.current;
    setLoading(true);
    setError(null);

    try {
      const visibleColumns = getDisplayColumns(tableInfo);
      const escapedColumns = visibleColumns.map((col) => quoteIdentifier(col));
      const selectColumns = tableInfo.withoutRowid
        ? escapedColumns
        : [`rowid AS "__rowid__"`, ...escapedColumns];

      const where = generateWhereClause(filterState);
      const orderBy = generateOrderByClause(sortState);

      const baseSql = `SELECT ${selectColumns.join(', ')} FROM ${quoteIdentifier(tableInfo.name)}`;
      const orderClause = orderBy ? `ORDER BY ${orderBy}` : '';
      const sql = `${baseSql} ${where.sql} ${orderClause} LIMIT ? OFFSET ?`;
      const params = [...where.params, pageSize, offset];

      const result = await client.query(sql, params);
      if (token !== loadTokenRef.current) return;

      const rows: DataRow[] = [];
      const rowKeys: PrimaryKeyValue[] = [];

      result.rows.forEach((row) => {
        const rowObj: DataRow = {};
        result.columns.forEach((colName, idx) => {
          rowObj[colName] = row[idx] as CellValue;
        });

        const rowidValue = (rowObj['__rowid__'] as number | bigint | undefined);
        rowKeys.push(extractPrimaryKeyFromRow(tableInfo, rowObj, rowidValue));
        rows.push(rowObj);
      });

      setDataState({ rows, rowKeys });
    } catch (err) {
      if (token !== loadTokenRef.current) return;
      const message = err instanceof Error ? err.message : 'Failed to load data';
      setError(message);
      setDataState({ rows: [], rowKeys: [] });
    } finally {
      if (token === loadTokenRef.current) {
        setLoading(false);
      }
    }
  }, [client, tableInfo, filterState, sortState, pageSize, offset]);

  useEffect(() => {
    void fetchTableInfo();
  }, [fetchTableInfo]);

  useEffect(() => {
    setOffset(0);
  }, [objectName]);

  useEffect(() => {
    if (!tableInfo) return;
    void fetchRowCount();
    void fetchData();
  }, [tableInfo, fetchRowCount, fetchData]);

  const handleRefresh = useCallback(async () => {
    await fetchTableInfo();
    if (tableInfo) {
      await fetchRowCount();
      await fetchData();
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
        await fetchData();
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
          try {
            await client.exec(`INSERT INTO ${quoteIdentifier(tableInfo.name)} DEFAULT VALUES`);
            await fetchData();
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
          return { success: false, error: 'No values provided' };
        }

        const placeholders = columns.map(() => '?').join(', ');
        const sql = `INSERT INTO ${quoteIdentifier(tableInfo.name)} (${columns
          .map((col) => quoteIdentifier(col))
          .join(', ')}) VALUES (${placeholders})`;
        const params = columns.map((col) => values[col] ?? null);
        await client.exec(sql, params);
        await fetchData();
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
        await fetchData();
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

  const effectiveReadOnly = isReadOnly || tableInfo?.isView || tableInfo?.isVirtual;

  const visibleColumns = useMemo(() => getDisplayColumns(tableInfo), [tableInfo]);

  const rowCountLabel = totalRows !== null ? `${totalRows} rows` : `${dataState.rows.length} rows`;
  const canGoPrev = offset > 0;
  const canGoNext = totalRows !== null ? offset + pageSize < totalRows : dataState.rows.length === pageSize;
  const pageStart = totalRows !== null ? Math.min(offset + 1, totalRows) : offset + 1;
  const pageEnd = totalRows !== null ? Math.min(offset + dataState.rows.length, totalRows) : offset + dataState.rows.length;

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
          {totalRows !== null && (
            <span className="text-xs text-navy-400" data-testid="table-page-info">
              {pageStart}-{pageEnd} of {totalRows}
            </span>
          )}
          {effectiveReadOnly && (
            <span className="text-xs text-amber-600" data-testid="table-readonly">
              Read-only
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setOffset((prev) => Math.max(0, prev - pageSize))}
            className="px-2 py-1 text-xs font-medium text-navy-600 hover:bg-navy-100 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            data-testid="table-prev-page"
            disabled={!canGoPrev}
          >
            Prev
          </button>
          <button
            onClick={() => setOffset((prev) => prev + pageSize)}
            className="px-2 py-1 text-xs font-medium text-navy-600 hover:bg-navy-100 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            data-testid="table-next-page"
            disabled={!canGoNext}
          >
            Next
          </button>
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
        {loading ? (
          <GridSkeleton rowCount={8} columnCount={Math.max(visibleColumns.length, 4)} height={gridHeight} />
        ) : (
          <DataGrid
            tableInfo={tableInfo}
            data={dataState.rows}
            height={gridHeight}
            isReadOnly={effectiveReadOnly}
            sortState={sortState}
            onSortChange={setSortState}
            filterState={filterState}
            onFilterChange={(next) => {
              setFilterState(next);
              setOffset(0);
            }}
            onCellEdit={handleCellEdit}
            onEditStateChange={onEditStateChange}
            onAddRow={effectiveReadOnly ? undefined : handleAddRow}
            onDeleteRows={effectiveReadOnly ? undefined : handleDeleteRows}
            hasForeignKeys={hasForeignKeys}
          />
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
