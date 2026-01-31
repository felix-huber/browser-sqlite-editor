/**
 * ERDView
 *
 * Loads schema/foreign keys from the worker and renders ERDCanvas with
 * persisted layout and FK edit/delete/create operations.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ERDCanvas, type TableNode, type RelationshipEdge, type ExistingFKInfo } from './ERDCanvas';
import { getWorkerClient } from '../../core/worker/client';
import { useDatabaseStore, useIsReadOnly, refreshSchema } from '../../store';
import {
  createEmptyLayout,
  loadLayout,
  pruneRemovedNodes,
  saveLayout,
  updateNodePosition,
} from '../../core/erd/erd-layout';
import {
  columnInfoToDefinition,
  createTable as generateCreateTableSql,
  foreignKeyInfoToConstraint,
  groupForeignKeyInfos,
  type ColumnDefinition,
} from '../../core/db/ddl';
import type { ForeignKeyEdgeData } from './ForeignKeyEdge';
import { applyGeneratedExpressions } from '../../core/db/generated-columns';
import type { ForeignKeyInfo, TableInfo } from '../../types';
import { useERDDraftState } from './hooks/useERDDraftState';

export interface ERDViewProps {
  /** Callback to open table designer */
  onOpenDesigner?: (tableName: string) => void;
  /** Callback when dirty state changes */
  onDirtyChange?: (dirty: boolean) => void;
}

interface ToastMessage {
  type: 'error' | 'success' | 'warning';
  text: string;
}

function getDefaultPosition(index: number): { x: number; y: number } {
  const col = index % 4;
  const row = Math.floor(index / 4);
  return { x: 40 + col * 260, y: 40 + row * 220 };
}

function isStrictTable(createSql: string): boolean {
  return /\bSTRICT\b/i.test(createSql);
}

function buildTableDefinition(
  tableInfo: TableInfo
): { columns: ColumnDefinition[]; primaryKey?: string[]; strict: boolean } {
  const pkColumns = tableInfo.columns
    .filter((col) => col.pk > 0)
    .sort((a, b) => a.pk - b.pk)
    .map((col) => col.name);
  const useTablePk = pkColumns.length > 1;

  let columns = tableInfo.columns.map((col) => columnInfoToDefinition(col));
  if (useTablePk) {
    columns = columns.map((col) => ({ ...col, primaryKey: undefined }));
  }

  columns = applyGeneratedExpressions(columns, tableInfo.createSql);

  return {
    columns,
    primaryKey: useTablePk ? pkColumns : undefined,
    strict: isStrictTable(tableInfo.createSql),
  };
}

export function ERDView({ onOpenDesigner, onDirtyChange }: ERDViewProps) {
  const client = useMemo(() => getWorkerClient(), []);
  const activeDbId = useDatabaseStore((state) => state.activeDbId);
  const isReadOnly = useIsReadOnly();

  const [nodes, setNodes] = useState<TableNode[]>([]);
  const [edges, setEdges] = useState<RelationshipEdge[]>([]);
  const [existingFKs, setExistingFKs] = useState<ExistingFKInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [canvasKey, setCanvasKey] = useState(0);

  // Draft state tracking for unsaved changes prompt
  const {
    isDirty,
    setFKDialogDirty,
    setPositionsDirty,
    setPendingFKCreation,
  } = useERDDraftState({ onDirtyChange });

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  const buildEdges = useCallback(
    (foreignKeys: ForeignKeyInfo[], tableInfos: Map<string, TableInfo>): RelationshipEdge[] => {
      const edges: RelationshipEdge[] = [];

      const uniqueSingleColumns = new Map<string, Set<string>>();
      const singlePkColumns = new Map<string, string | null>();

      for (const [name, info] of tableInfos.entries()) {
        const uniqueCols = new Set<string>();
        for (const idx of info.indexes) {
          if (idx.unique && idx.columns.length === 1) {
            uniqueCols.add(idx.columns[0]);
          }
        }
        const pkColumns = info.columns.filter((col) => col.pk > 0);
        const singlePk = pkColumns.length === 1 ? pkColumns[0].name : null;
        singlePkColumns.set(name, singlePk);
        uniqueSingleColumns.set(name, uniqueCols);
      }

      // Group FKs by (childTable, constraintId) to handle composite FKs
      const groupedByTable = new Map<string, Map<number, ForeignKeyInfo[]>>();
      for (const fk of foreignKeys) {
        let tableGroup = groupedByTable.get(fk.childTable);
        if (!tableGroup) {
          tableGroup = new Map();
          groupedByTable.set(fk.childTable, tableGroup);
        }
        const existing = tableGroup.get(fk.id) ?? [];
        existing.push(fk);
        tableGroup.set(fk.id, existing);
      }

      // Create one edge per constraint (grouping composite FK columns)
      for (const [childTable, constraintGroups] of groupedByTable) {
        for (const [constraintId, fkGroup] of constraintGroups) {
          const childInfo = tableInfos.get(childTable);
          const parentTable = fkGroup[0].parentTable;
          const parentInfo = tableInfos.get(parentTable);
          if (!childInfo || !parentInfo) continue;

          const isComposite = fkGroup.length > 1;
          const childColumns = fkGroup.map((fk) => fk.childColumn);
          const parentColumns = fkGroup.map((fk) => fk.parentColumn);

          // Check if any FK column is nullable (optional relationship)
          const isOptional = fkGroup.some((fk) => {
            const childCol = childInfo.columns.find((c) => c.name === fk.childColumn);
            return childCol ? !childCol.notnull : false;
          });

          // For cardinality: check if all child columns form a unique constraint
          const uniqueCols = uniqueSingleColumns.get(childTable) ?? new Set();
          const singlePk = singlePkColumns.get(childTable);
          // Single-column: check if unique
          // Composite: for simplicity, default to one-to-many (determining composite uniqueness is complex)
          const isUnique = !isComposite && (
            uniqueCols.has(childColumns[0]) ||
            (singlePk !== null && singlePk === childColumns[0])
          );

          // Edge ID: for composite FKs, use constraintId; for single, use column names
          const edgeId = isComposite
            ? `fk-${childTable}-composite-${constraintId}-${parentTable}`
            : `fk-${childTable}-${childColumns[0]}-${parentTable}-${parentColumns[0]}`;

          // Source/target handles: use first column for positioning
          const sourceHandle = `${childColumns[0]}-source`;
          const targetHandle = `${parentColumns[0]}-target`;

          const edgeData: ForeignKeyEdgeData = {
            childTable,
            childColumns,
            parentTable,
            parentColumns,
            onDelete: fkGroup[0].onDelete,
            onUpdate: fkGroup[0].onUpdate,
            cardinality: isUnique ? 'one-to-one' : 'one-to-many',
            isOptional,
            isComposite,
          };

          edges.push({
            id: edgeId,
            type: 'fkEdge',
            source: childTable,
            target: parentTable,
            sourceHandle,
            targetHandle,
            data: edgeData,
          });
        }
      }

      return edges;
    },
    []
  );

  const loadData = useCallback(async () => {
    if (!activeDbId) return;
    setLoading(true);
    setError(null);

    try {
      const schema = await client.getSchema();
      const tableNames = [...schema.tables, ...schema.views];

      const infos = await Promise.all(tableNames.map((name) => client.getTableInfo(name)));
      const infoMap = new Map<string, TableInfo>();
      infos.forEach((info) => infoMap.set(info.name, info));

      const foreignKeys = await client.getForeignKeys();

      const layoutResult = await loadLayout(activeDbId);
      let layout = layoutResult.ok ? layoutResult.layout : createEmptyLayout();
      layout = pruneRemovedNodes(layout, tableNames);

      const childFkColumns = new Map<string, Set<string>>();
      for (const fk of foreignKeys) {
        const set = childFkColumns.get(fk.childTable) ?? new Set<string>();
        set.add(fk.childColumn);
        childFkColumns.set(fk.childTable, set);
      }

      const uniqueColumns = new Map<string, Set<string>>();
      for (const info of infos) {
        const uniqueCols = new Set<string>();
        for (const idx of info.indexes) {
          if (idx.unique && idx.columns.length === 1) {
            uniqueCols.add(idx.columns[0]);
          }
        }
        uniqueColumns.set(info.name, uniqueCols);
      }

      const nextNodes: TableNode[] = infos.map((info, index) => {
        const position = layout.nodes[info.name]
          ? { x: layout.nodes[info.name].x, y: layout.nodes[info.name].y }
          : getDefaultPosition(index);

        const fkSet = childFkColumns.get(info.name) ?? new Set();
        const uniqSet = uniqueColumns.get(info.name) ?? new Set();
        const columns = info.columns
          .filter((col) => !col.hidden)
          .map((col) => ({
            name: col.name,
            type: col.type || 'TEXT',
            isPrimaryKey: col.pk > 0,
            isForeignKey: fkSet.has(col.name),
            isUnique: uniqSet.has(col.name) || col.pk > 0,
            isNotNull: col.notnull,
            generated: col.generated,
          }));

        return {
          id: info.name,
          type: 'tableNode',
          position,
          data: {
            label: info.name,
            isView: info.isView,
            isReadOnly: isReadOnly || info.isView,
            columns,
          },
        };
      });

      let layoutUpdated = false;
      let updatedLayout = layout;
      for (const node of nextNodes) {
        if (!layout.nodes[node.id]) {
          updatedLayout = updateNodePosition(updatedLayout, node.id, node.position);
          layoutUpdated = true;
        }
      }

      if (layoutUpdated) {
        void saveLayout(activeDbId, updatedLayout);
      }

      setNodes(nextNodes);
      setEdges(buildEdges(foreignKeys, infoMap));
      setExistingFKs(
        foreignKeys.map((fk) => ({
          childTable: fk.childTable,
          childColumn: fk.childColumn,
          parentTable: fk.parentTable,
          parentColumn: fk.parentColumn,
        }))
      );
      setCanvasKey((value) => value + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load ERD');
      setNodes([]);
      setEdges([]);
      setExistingFKs([]);
    } finally {
      setLoading(false);
    }
  }, [activeDbId, buildEdges, client, isReadOnly]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleNodesChange = useCallback(
    async (updatedNodes: TableNode[]) => {
      if (!activeDbId) return;
      const layoutResult = await loadLayout(activeDbId);
      let layout = layoutResult.ok ? layoutResult.layout : createEmptyLayout();
      let changed = false;

      for (const node of updatedNodes) {
        const existing = layout.nodes[node.id];
        if (!existing || existing.x !== node.position.x || existing.y !== node.position.y) {
          layout = updateNodePosition(layout, node.id, node.position);
          changed = true;
        }
      }

      if (changed) {
        await saveLayout(activeDbId, layout);
        // Clear positions dirty after successful save
        setPositionsDirty(false);
      }
    },
    [activeDbId, setPositionsDirty]
  );

  const rebuildTableWithForeignKeys = useCallback(
    async (
      childTable: string,
      updatedForeignKeys: ForeignKeyInfo[]
    ): Promise<boolean> => {
      try {
        const tableInfo = await client.getTableInfo(childTable);
        const groups = groupForeignKeyInfos(updatedForeignKeys);
        const constraints = Array.from(groups.values()).map((infos) =>
          foreignKeyInfoToConstraint(infos)
        );

        const { columns, primaryKey, strict } = buildTableDefinition(tableInfo);

        const createSql = generateCreateTableSql({
          name: tableInfo.name,
          columns,
          primaryKey,
          foreignKeys: constraints,
          withoutRowid: tableInfo.withoutRowid,
          strict,
        });

        await client.rebuildTable(
          {
            table: tableInfo.name,
            newCreateSql: createSql,
            newColumns: columns.map((col) => col.name),
          },
          isReadOnly
        );

        await refreshSchema();
        await loadData();
        return true;
      } catch (err) {
        setToast({
          type: 'error',
          text: err instanceof Error ? err.message : 'Failed to rebuild table',
        });
        return false;
      }
    },
    [client, isReadOnly, loadData]
  );

  const handleCreateFK = useCallback(
    async (
      childTable: string,
      childColumn: string,
      parentTable: string,
      parentColumn: string,
      onDelete: ForeignKeyInfo['onDelete'],
      onUpdate: ForeignKeyInfo['onUpdate']
    ): Promise<boolean> => {
      const allFks = await client.getForeignKeys();
      const childFks = allFks.filter((fk) => fk.childTable === childTable);
      childFks.push({
        id: Date.now(),
        childTable,
        childColumn,
        parentTable,
        parentColumn,
        onDelete,
        onUpdate,
        match: 'NONE',
      });

      return rebuildTableWithForeignKeys(childTable, childFks);
    },
    [client, rebuildTableWithForeignKeys]
  );

  const handleEditFK = useCallback(
    async (
      childTable: string,
      childColumn: string,
      parentTable: string,
      parentColumn: string,
      onDelete: ForeignKeyInfo['onDelete'],
      onUpdate: ForeignKeyInfo['onUpdate']
    ): Promise<boolean> => {
      const allFks = await client.getForeignKeys();
      const childFks = allFks.filter((fk) => fk.childTable === childTable);

      const updated = childFks.filter(
        (fk) =>
          !(
            fk.childColumn.toLowerCase() === childColumn.toLowerCase() &&
            fk.parentTable.toLowerCase() === parentTable.toLowerCase() &&
            fk.parentColumn.toLowerCase() === parentColumn.toLowerCase()
          )
      );

      updated.push({
        id: Date.now(),
        childTable,
        childColumn,
        parentTable,
        parentColumn,
        onDelete,
        onUpdate,
        match: 'NONE',
      });

      return rebuildTableWithForeignKeys(childTable, updated);
    },
    [client, rebuildTableWithForeignKeys]
  );

  const handleDeleteFK = useCallback(
    async (
      childTable: string,
      childColumn: string,
      parentTable: string,
      parentColumn: string
    ): Promise<boolean> => {
      const allFks = await client.getForeignKeys();
      const childFks = allFks.filter((fk) => fk.childTable === childTable);

      const updated = childFks.filter(
        (fk) =>
          !(
            fk.childColumn.toLowerCase() === childColumn.toLowerCase() &&
            fk.parentTable.toLowerCase() === parentTable.toLowerCase() &&
            fk.parentColumn.toLowerCase() === parentColumn.toLowerCase()
          )
      );

      return rebuildTableWithForeignKeys(childTable, updated);
    },
    [client, rebuildTableWithForeignKeys]
  );

  if (!activeDbId) {
    return (
      <div className="flex-1 flex items-center justify-center text-navy-500">
        Open a database to view the ERD.
      </div>
    );
  }

  return (
    <div className="relative h-full" data-testid="erd-view">
      {error && (
        <div className="px-4 py-2 text-sm text-red-700 bg-red-50 border-b border-red-200" data-testid="erd-error">
          {error}
        </div>
      )}

      {toast && (
        <div
          className={`absolute top-4 right-4 z-20 px-4 py-2 rounded-lg shadow-lg text-sm font-medium ${
            toast.type === 'error'
              ? 'bg-red-600 text-white'
              : toast.type === 'warning'
              ? 'bg-amber-500 text-white'
              : 'bg-emerald-600 text-white'
          }`}
          data-testid={`erd-toast-${toast.type}`}
        >
          {toast.text}
        </div>
      )}

      {loading ? (
        <div className="flex-1 h-full flex items-center justify-center">
          <div className="text-sm text-navy-500">Loading ERD…</div>
        </div>
      ) : (
        <ERDCanvas
          key={`${activeDbId}-${canvasKey}`}
          initialNodes={nodes}
          initialEdges={edges}
          isReadOnly={isReadOnly}
          existingFKs={existingFKs}
          onNodesChange={handleNodesChange}
          onCreateFK={handleCreateFK}
          onEditFK={handleEditFK}
          onDeleteFK={handleDeleteFK}
          onShowInDesigner={onOpenDesigner}
          onShowToast={(message, type) => setToast({ type, text: message })}
          onFKDialogDirtyChange={setFKDialogDirty}
          onPositionsDirtyChange={setPositionsDirty}
          onPendingFKCreationChange={setPendingFKCreation}
          isDirty={isDirty}
        />
      )}
    </div>
  );
}

export default ERDView;
