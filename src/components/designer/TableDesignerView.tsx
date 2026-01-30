/**
 * TableDesignerView
 *
 * Wraps TableDesigner with worker-backed create/alter/rebuild operations
 * and an optional DDL diff preview panel.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { TableDesigner } from './TableDesigner';
import { DDLDiffPreview, analyzeChanges } from './DDLDiffPreview';
import { useTables, refreshSchema } from '../../store';
import { getWorkerClient } from '../../lib/worker-client';
import {
  createTable as generateCreateTableSql,
  foreignKeyInfoToConstraint,
  groupForeignKeyInfos,
  type ColumnDefinition,
  type ForeignKeyConstraint,
} from '../../lib/ddl';
import { applyGeneratedExpressions } from '../../lib/generated-columns';
import type { DesignerColumnDraft, ForeignKeyInfo, TableInfo } from '../../types';

export interface TableDesignerViewProps {
  /** Existing table name for edit mode (null for create mode) */
  tableName?: string;
  /** Whether database is read-only */
  isReadOnly?: boolean;
  /** Callback when a table should be opened after save */
  onOpenTable?: (tableName: string) => void;
  /** Callback when dirty state changes */
  onDirtyChange?: (dirty: boolean) => void;
}

function buildColumnDefinitions(
  drafts: DesignerColumnDraft[],
  existingCreateSql?: string
): { columns: ColumnDefinition[]; primaryKey?: string[] } {
  const pkColumns = drafts.filter((c) => c.isPrimaryKey).map((c) => c.name);
  const useTablePk = pkColumns.length > 1;

  const columns: ColumnDefinition[] = drafts.map((col) => ({
    name: col.name,
    type: col.type || 'TEXT',
    notNull: col.isNotNull || col.isPrimaryKey,
    unique: col.isUnique && !col.isPrimaryKey,
    defaultValue: col.defaultValue ?? undefined,
    primaryKey: !useTablePk && col.isPrimaryKey ? 1 : undefined,
    generatedType: col.generated ?? undefined,
    generatedAs: col.generatedExpression ?? undefined,
  }));

  const withGenerated = existingCreateSql
    ? applyGeneratedExpressions(columns, existingCreateSql)
    : columns;

  return { columns: withGenerated, primaryKey: useTablePk ? pkColumns : undefined };
}

function buildForeignKeyConstraints(
  tableName: string,
  foreignKeys: ForeignKeyInfo[],
  renameMap: Map<string, string>,
  removedColumns: Set<string>
): ForeignKeyConstraint[] {
  const groups = groupForeignKeyInfos(foreignKeys);
  const constraints: ForeignKeyConstraint[] = [];
  const tableNameLower = tableName.toLowerCase();

  for (const [, infos] of groups) {
    const childColumns = infos.map((info) => renameMap.get(info.childColumn) ?? info.childColumn);
    if (childColumns.some((col) => removedColumns.has(col.toLowerCase()))) {
      continue;
    }

    let refColumns = infos.map((info) => info.parentColumn);
    if (infos[0].parentTable.toLowerCase() === tableNameLower) {
      refColumns = refColumns.map((col) => renameMap.get(col) ?? col);
      if (refColumns.some((col) => removedColumns.has(col.toLowerCase()))) {
        continue;
      }
    }

    const constraint = foreignKeyInfoToConstraint(infos);
    constraints.push({
      ...constraint,
      columns: childColumns,
      refColumns,
    });
  }

  return constraints;
}

export function TableDesignerView({
  tableName,
  isReadOnly = false,
  onOpenTable,
  onDirtyChange,
}: TableDesignerViewProps) {
  const client = useMemo(() => getWorkerClient(), []);
  const tables = useTables();
  const [existingTable, setExistingTable] = useState<TableInfo | null>(null);
  const [existingForeignKeys, setExistingForeignKeys] = useState<ForeignKeyInfo[]>([]);
  const [draftTableName, setDraftTableName] = useState('');
  const [draftColumns, setDraftColumns] = useState<DesignerColumnDraft[]>([]);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [isApplying, setIsApplying] = useState(false);
  const [resetToken, setResetToken] = useState(0);

  const isEditing = Boolean(tableName);

  useEffect(() => {
    if (!tableName) {
      setExistingTable(null);
      setExistingForeignKeys([]);
      return;
    }

    let cancelled = false;
    const load = async () => {
      try {
        const [info, fks] = await Promise.all([
          client.getTableInfo(tableName),
          client.getForeignKeys(),
        ]);
        if (cancelled) return;
        setExistingTable(info);
        setExistingForeignKeys(fks.filter((fk) => fk.childTable === tableName));
      } catch (err) {
        if (cancelled) return;
        setExistingTable(null);
        setExistingForeignKeys([]);
        console.error('Failed to load table info:', err);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [client, tableName]);

  const handleDraftChange = useCallback((name: string, columns: DesignerColumnDraft[]) => {
    setDraftTableName(name);
    setDraftColumns(columns);
  }, []);

  const handleCreate = useCallback(
    async (name: string, columns: DesignerColumnDraft[]) => {
      setApplyError(null);
      setIsApplying(true);
      try {
        const { columns: columnDefs, primaryKey } = buildColumnDefinitions(columns);
        await client.createTable({
          name,
          columns: columnDefs.map((col) => ({
            name: col.name,
            type: col.type,
            notNull: col.notNull,
            unique: col.unique,
            defaultValue: col.defaultValue ?? null,
            primaryKey: col.primaryKey,
            generatedAs: col.generatedAs,
            generatedType: col.generatedType,
          })),
          primaryKey,
        }, isReadOnly);

        await refreshSchema();
        setResetToken((prev) => prev + 1);
        onDirtyChange?.(false);
        onOpenTable?.(name);
      } catch (err) {
        setApplyError(err instanceof Error ? err.message : 'Failed to create table');
      } finally {
        setIsApplying(false);
      }
    },
    [client, isReadOnly, onOpenTable]
  );

  const handleApplyChanges = useCallback(async (
    overrides?: { tableName?: string; columns?: DesignerColumnDraft[] }
  ) => {
    if (!existingTable) return;
    const nextTableName = overrides?.tableName ?? (draftTableName || existingTable.name);
    const nextColumns = overrides?.columns ?? draftColumns;
    const nextAnalysis = analyzeChanges(existingTable, nextColumns, nextTableName);
    if (!nextAnalysis) return;
    if (nextAnalysis.generatedColumnModifications.length > 0) {
      setApplyError(
        `Cannot modify generated columns: ${nextAnalysis.generatedColumnModifications.join(', ')}`
      );
      return;
    }

    setApplyError(null);
    setIsApplying(true);

    const currentName = existingTable.name;
    const nextName = nextTableName || existingTable.name;
    const tableRenamed = currentName.toLowerCase() !== nextName.toLowerCase();

    try {
      const onlyRename =
        tableRenamed &&
        nextAnalysis.columnsRemoved.length === 0 &&
        nextAnalysis.columnsRenamed.length === 0 &&
        nextAnalysis.typeChanges.length === 0 &&
        nextAnalysis.constraintChanges.length === 0 &&
        nextAnalysis.columnsToAdd.length === 0;

      if (onlyRename) {
        await client.alterTable(currentName, { type: 'renameTable', newName: nextName }, isReadOnly);
        await refreshSchema();
        setResetToken((prev) => prev + 1);
        onDirtyChange?.(false);
        onOpenTable?.(nextName);
        return;
      }

      if (nextAnalysis.changeType === 'add_columns' && !tableRenamed) {
        for (const col of nextAnalysis.columnsToAdd) {
          await client.alterTable(
            currentName,
            {
              type: 'addColumn',
              column: {
                name: col.name,
                type: col.type,
                notNull: col.isNotNull || col.isPrimaryKey,
                unique: col.isUnique,
                defaultValue: col.defaultValue ?? null,
                primaryKey: col.isPrimaryKey ? 1 : undefined,
                generatedAs: col.generatedExpression ?? undefined,
                generatedType: col.generated ?? undefined,
              },
            },
            isReadOnly
          );
        }
        await refreshSchema();
        setResetToken((prev) => prev + 1);
        onDirtyChange?.(false);
        onOpenTable?.(currentName);
        return;
      }

      const renameMap = new Map<string, string>(
        nextAnalysis.columnsRenamed.map((c) => [c.oldName, c.newName])
      );
      const removed = new Set(nextAnalysis.columnsRemoved.map((c) => c.toLowerCase()));

      const { columns: columnDefs, primaryKey } = buildColumnDefinitions(
        nextColumns,
        existingTable.createSql
      );

      const fkConstraints = buildForeignKeyConstraints(
        currentName,
        existingForeignKeys,
        renameMap,
        removed
      );

      const createSql = generateCreateTableSql({
        name: currentName,
        columns: columnDefs,
        primaryKey,
        foreignKeys: fkConstraints,
        withoutRowid: existingTable.withoutRowid,
      });

      await client.rebuildTable(
        {
          table: currentName,
          newCreateSql: createSql,
          newColumns: columnDefs.map((c) => c.name),
          columnRenames: nextAnalysis.columnsRenamed,
        },
        isReadOnly
      );

      if (tableRenamed) {
        await client.alterTable(currentName, { type: 'renameTable', newName: nextName }, isReadOnly);
      }

      await refreshSchema();
      setResetToken((prev) => prev + 1);
      onDirtyChange?.(false);
      onOpenTable?.(nextName);
    } catch (err) {
      setApplyError(err instanceof Error ? err.message : 'Failed to apply changes');
    } finally {
      setIsApplying(false);
    }
  }, [
    client,
    draftColumns,
    draftTableName,
    existingForeignKeys,
    existingTable,
    isReadOnly,
    onOpenTable,
  ]);

  return (
    <div className="flex flex-col h-full" data-testid="table-designer-view">
      {applyError && (
        <div className="px-4 py-2 text-sm text-red-700 bg-red-50 border-b border-red-200" data-testid="designer-error">
          {applyError}
        </div>
      )}

      <div className={`flex-1 flex ${isEditing ? 'overflow-hidden' : ''}`}>
        <div className={`${isEditing ? 'flex-[3]' : 'flex-1'} overflow-auto`}>
          <TableDesigner
            isReadOnly={isReadOnly}
            existingTable={existingTable}
            existingTableNames={tables}
            resetToken={resetToken}
            onSubmit={(name, columns) => {
              if (isEditing) {
                setDraftTableName(name);
                setDraftColumns(columns);
                void handleApplyChanges({ tableName: name, columns });
              } else {
                void handleCreate(name, columns);
              }
            }}
            onCancel={() => {
              setApplyError(null);
              if (isEditing && existingTable) {
                onOpenTable?.(existingTable.name);
              }
            }}
            onDirtyChange={onDirtyChange}
            onDraftChange={handleDraftChange}
          />
        </div>

        {isEditing && existingTable && (
          <div className="flex-[2] border-l border-navy-200 bg-navy-50 overflow-auto">
            <DDLDiffPreview
              existingTable={existingTable}
              columns={draftColumns}
              tableName={draftTableName || existingTable.name}
              isReadOnly={isReadOnly || isApplying}
              onApply={() => void handleApplyChanges()}
              onCancel={() => {
                if (existingTable) {
                  onOpenTable?.(existingTable.name);
                }
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export default TableDesignerView;
