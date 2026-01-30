/**
 * QueryBuilderView
 *
 * Integrates the visual query builder with worker-backed schema/SQL execution.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  QueryBuilder,
  OrderByBuilder,
  WhereBuilder,
  LimitControl,
  SqlPreviewPanel,
  generateSql,
  type JoinConfig,
  type TableBoxNodeType,
  type TableBoxColumnData,
  type JoinEdgeType,
  type SortCondition,
  type WhereCondition,
  type WhereBuilderColumn,
  type AvailableColumn,
} from './';
import { getWorkerClient } from '../../lib/worker-client';
import { openDb, useActiveDb, useTables } from '../../store';
import { quoteIdentifier } from '../../lib/ddl';
import type { TableInfo } from '../../types';

export interface QueryBuilderViewProps {
  /** Whether database is read-only */
  isReadOnly?: boolean;
  /** Callback to open SQL editor */
  onOpenSql?: (sql: string) => void;
  /** Callback when dirty state changes */
  onDirtyChange?: (dirty: boolean) => void;
}

export function QueryBuilderView({
  isReadOnly = false,
  onOpenSql,
  onDirtyChange,
}: QueryBuilderViewProps) {
  const client = useMemo(() => getWorkerClient(), []);
  const activeDb = useActiveDb();
  const tables = useTables();
  const [tableColumns, setTableColumns] = useState<Record<string, TableBoxColumnData[]>>({});
  const [tableInfoMap, setTableInfoMap] = useState<Record<string, TableInfo>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [nodes, setNodes] = useState<TableBoxNodeType[]>([]);
  const [joins, setJoins] = useState<JoinConfig[]>([]);
  const [whereConditions, setWhereConditions] = useState<WhereCondition[]>([]);
  const [whereLogic, setWhereLogic] = useState<'AND' | 'OR'>('AND');
  const [sortConditions, setSortConditions] = useState<SortCondition[]>([]);
  const [limit, setLimit] = useState<number | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const hasInitializedRef = useRef(false);

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  const markDirty = useCallback(() => {
    setIsDirty(true);
  }, []);

  const markClean = useCallback(() => {
    setIsDirty(false);
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (!activeDb || tables.length === 0) {
      setTableColumns({});
      setTableInfoMap({});
      return;
    }

    const load = async (attempt = 0) => {
      setLoading(true);
      setError(null);
      try {
        const infos = await Promise.all(tables.map((name) => client.getTableInfo(name)));
        if (cancelled) return;

        const columnsMap: Record<string, TableBoxColumnData[]> = {};
        const infoMap: Record<string, TableInfo> = {};

        for (const info of infos) {
          infoMap[info.name] = info;
          columnsMap[info.name] = info.columns
            .filter((col) => !col.hidden)
            .map((col) => ({
              name: col.name,
              type: col.type || 'TEXT',
              isPrimaryKey: col.pk > 0,
              generated: col.generated,
            }));
        }

        setTableColumns(columnsMap);
        setTableInfoMap(infoMap);
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : 'Failed to load schema';
        if (message.includes('No database open') && attempt < 1) {
          try {
            await openDb(activeDb.name);
            if (cancelled) return;
            await load(attempt + 1);
            return;
          } catch (openErr) {
            const openMessage =
              openErr instanceof Error ? openErr.message : 'Failed to open database';
            setError(openMessage);
            setTableColumns({});
            setTableInfoMap({});
            return;
          }
        }
        setError(message);
        setTableColumns({});
        setTableInfoMap({});
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [activeDb, client, tables]);

  const availableColumns = useMemo<AvailableColumn[]>(() => {
    const cols: AvailableColumn[] = [];

    for (const node of nodes) {
      const info = tableInfoMap[node.data.tableName];
      const columns = info?.columns ?? [];
      for (const col of columns) {
        if (col.hidden) continue;
        cols.push({
          value: `${node.data.alias}.${quoteIdentifier(col.name)}`,
          label: `${node.data.alias}.${col.name} (${node.data.tableName})`,
        });
      }
    }

    return cols;
  }, [nodes, tableInfoMap]);

  const whereColumns = useMemo<WhereBuilderColumn[]>(() => {
    const cols: WhereBuilderColumn[] = [];

    for (const node of nodes) {
      const info = tableInfoMap[node.data.tableName];
      const columns = info?.columns ?? [];
      for (const col of columns) {
        if (col.hidden) continue;
        cols.push({
          name: `${node.data.alias}.${quoteIdentifier(col.name)}`,
          type: col.type || 'TEXT',
          nullable: !col.notnull,
        });
      }
    }

    return cols;
  }, [nodes, tableInfoMap]);

  const sqlResult = useMemo(() => {
    return generateSql({
      tableNodes: nodes,
      joins,
      whereConditions,
      whereLogic,
      sortConditions,
      limit,
    });
  }, [nodes, joins, whereConditions, whereLogic, sortConditions, limit]);

  const previewSql = sqlResult.isValid ? sqlResult.sql : '';
  const previewParams = sqlResult.isValid ? sqlResult.params : [];

  const handleStateChange = useCallback(
    (nextNodes: TableBoxNodeType[], _nextEdges: JoinEdgeType[]) => {
      setNodes(nextNodes);
      if (!hasInitializedRef.current) {
        hasInitializedRef.current = true;
        return;
      }
      if (nodes.length === 0 && nextNodes.length === 0) {
        return;
      }
      markDirty();
    },
    [markDirty, nodes]
  );

  const handleJoinsChange = useCallback(
    (nextJoins: JoinConfig[]) => {
      setJoins(nextJoins);
      if (joins.length === 0 && nextJoins.length === 0) {
        return;
      }
      markDirty();
    },
    [joins, markDirty]
  );

  const handleWhereChange = useCallback(
    (nextConditions: WhereCondition[]) => {
      setWhereConditions(nextConditions);
      if (whereConditions.length === 0 && nextConditions.length === 0) {
        return;
      }
      markDirty();
    },
    [markDirty, whereConditions]
  );

  const handleWhereLogicChange = useCallback(
    (nextLogic: 'AND' | 'OR') => {
      if (nextLogic === whereLogic) {
        return;
      }
      setWhereLogic(nextLogic);
      markDirty();
    },
    [markDirty, whereLogic]
  );

  const handleSortChange = useCallback(
    (nextSort: SortCondition[]) => {
      setSortConditions(nextSort);
      if (sortConditions.length === 0 && nextSort.length === 0) {
        return;
      }
      markDirty();
    },
    [markDirty, sortConditions]
  );

  const handleLimitChange = useCallback(
    (nextLimit: number | null) => {
      if (nextLimit === limit) {
        return;
      }
      setLimit(nextLimit);
      markDirty();
    },
    [limit, markDirty]
  );

  const handleExecute = useCallback(
    async (sql: string, params?: unknown[]) => {
      const result = await client.query(sql, params);
      markClean();
      return result;
    },
    [client, markClean]
  );

  const handleOpenInEditor = useCallback(
    (sql: string) => {
      markClean();
      onDirtyChange?.(false);
      onOpenSql?.(sql);
    },
    [markClean, onDirtyChange, onOpenSql]
  );

  return (
    <div className="flex flex-col h-full" data-testid="query-builder-view">
      {error && (
        <div className="px-4 py-2 text-sm text-red-700 bg-red-50 border-b border-red-200" data-testid="query-builder-error">
          {error}
        </div>
      )}

      <div className="flex-1 min-h-0 flex">
        <div className="flex-[3] min-w-0">
          <QueryBuilder
            tables={tables}
            tableColumns={tableColumns}
            onTablesChange={() => markDirty()}
            onJoinsChange={handleJoinsChange}
            onStateChange={handleStateChange}
          />
        </div>

        <div className="flex-[2] min-w-[320px] border-l border-navy-200 bg-white flex flex-col">
          <div className="p-4 border-b border-navy-200">
            <h3 className="text-sm font-semibold text-navy-700">Filters</h3>
          </div>
          <div className="flex-1 overflow-auto p-4 space-y-6">
            <WhereBuilder
              columns={whereColumns}
              conditions={whereConditions}
              logic={whereLogic}
              onConditionsChange={handleWhereChange}
              onLogicChange={handleWhereLogicChange}
            />

            <OrderByBuilder
              sortConditions={sortConditions}
              onSortConditionsChange={handleSortChange}
              availableColumns={availableColumns}
            />

            <LimitControl limit={limit} onLimitChange={handleLimitChange} />
          </div>
        </div>
      </div>

      <div className="border-t border-navy-200 bg-white">
        {!sqlResult.isValid && (
          <div className="px-4 py-2 text-sm text-amber-700 bg-amber-50 border-b border-amber-200" data-testid="query-builder-warning">
            {sqlResult.validationMessage ?? 'Add tables and columns to generate SQL'}
          </div>
        )}
        <SqlPreviewPanel
          sql={previewSql}
          params={previewParams}
          onExecute={handleExecute}
          onOpenInEditor={handleOpenInEditor}
          onCancel={() => client.cancel()}
          isReadOnly={isReadOnly}
          isGenerating={loading}
          height={320}
        />
      </div>
    </div>
  );
}

export default QueryBuilderView;
