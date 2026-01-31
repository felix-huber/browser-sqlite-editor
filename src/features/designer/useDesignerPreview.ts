/**
 * useDesignerPreview Hook
 *
 * Gathers all data needed for the DDL diff preview modal:
 * - Current vs proposed CREATE TABLE SQL
 * - Affected indexes and triggers (from table info)
 * - Dependent views (from pre-flight dependency scan)
 * - Net effect summary
 * - Validation state
 */

import { useMemo, useEffect, useState } from 'react';
import type { TableInfo, DesignerColumnDraft } from '../../types';
import type { SqliteMasterObject } from '../../core/rebuild/types';
import type { DependentObject } from '../../shared/components/DDLDiffPreview';
import {
  analyzeChanges,
  getAffectedObjects,
  validateChanges,
  type ChangeAnalysis,
  type AffectedObject,
  type ValidationResult,
} from './DDLDiffPreview';
import { escapeIdentifier } from '../../core/sql/escape';
import {
  scanDependenciesForTable,
  scanDependenciesForColumns,
  type DependencyScanResult,
} from '../../core/rebuild/dependency-scan';
import { getWorkerClient } from '../../core/worker/client';

// =============================================================================
// Types
// =============================================================================

export interface DesignerPreviewData {
  /** Original CREATE TABLE SQL (empty for new tables) */
  originalSql: string;
  /** Proposed CREATE TABLE SQL */
  proposedSql: string;
  /** Dependent objects (indexes, triggers, views) for SharedDDLDiffPreview */
  dependentObjects: DependentObject[];
  /** Net effect summary string */
  netEffectSummary: string;
  /** Affected objects with full details */
  affectedObjects: AffectedObject[];
  /** Dependent views from pre-flight scan */
  dependentViews: Array<{ name: string; sql: string }>;
  /** Dependent triggers from pre-flight scan */
  dependentTriggers: Array<{ name: string; sql: string }>;
  /** Change analysis result */
  analysis: ChangeAnalysis;
  /** Validation result */
  validation: ValidationResult;
  /** Whether data is still loading (dependency scan in progress) */
  isLoading: boolean;
  /** Error message if dependency scan failed */
  scanError: string | null;
}

export interface UseDesignerPreviewOptions {
  /** Existing table info (null for create mode) */
  existingTable: TableInfo | null;
  /** Current column drafts from designer */
  columns: DesignerColumnDraft[];
  /** New table name */
  tableName: string;
  /** Whether database is read-only */
  isReadOnly?: boolean;
}

// =============================================================================
// SQL Generation Helpers
// =============================================================================

function generateColumnDef(col: DesignerColumnDraft): string {
  let def = `${escapeIdentifier(col.name)} ${col.type}`;

  if (col.generated) {
    def = `${escapeIdentifier(col.name)} ${col.type} GENERATED ALWAYS AS (${col.generatedExpression || 'NULL'}) ${col.generated.toUpperCase()}`;
    return def;
  }

  if (col.isPrimaryKey) {
    def += ' PRIMARY KEY';
  }
  if (col.isNotNull && !col.isPrimaryKey) {
    def += ' NOT NULL';
  }
  if (col.isUnique && !col.isPrimaryKey) {
    def += ' UNIQUE';
  }
  if (col.defaultValue !== null && col.defaultValue !== undefined) {
    def += ` DEFAULT ${col.defaultValue}`;
  }

  return def;
}

function generateCreateTable(tableName: string, columns: DesignerColumnDraft[]): string {
  const colDefs = columns.map(generateColumnDef);
  return `CREATE TABLE ${escapeIdentifier(tableName)} (\n  ${colDefs.join(',\n  ')}\n);`;
}

// =============================================================================
// Hook Implementation
// =============================================================================

/**
 * Hook for gathering all DDL diff preview data.
 *
 * This hook:
 * 1. Computes change analysis between existing and proposed schema
 * 2. Generates SQL for original and proposed CREATE TABLE
 * 3. Gets affected indexes/triggers from table info
 * 4. Runs async pre-flight dependency scan for views/external triggers
 * 5. Builds net effect summary
 * 6. Validates changes
 */
export function useDesignerPreview({
  existingTable,
  columns,
  tableName,
  isReadOnly = false,
}: UseDesignerPreviewOptions): DesignerPreviewData {
  // Async state for dependency scan
  const [scanResult, setScanResult] = useState<DependencyScanResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  // Compute change analysis
  const analysis = useMemo(
    () => analyzeChanges(existingTable, columns, tableName),
    [existingTable, columns, tableName]
  );

  // Generate SQL
  const originalSql = existingTable?.createSql || '';
  const proposedSql = useMemo(
    () => generateCreateTable(tableName, columns),
    [tableName, columns]
  );

  // Get affected objects from table info (indexes, triggers)
  const affectedObjects = useMemo(
    () => (existingTable ? getAffectedObjects(existingTable, analysis.changeType) : []),
    [existingTable, analysis.changeType]
  );

  // Compute columns to scan (used in effect and memoized to avoid reruns)
  const columnsToScan = useMemo(() => {
    if (analysis.changeType === 'none') return [];
    return [
      ...analysis.columnsRemoved,
      ...analysis.columnsRenamed.map((r) => r.oldName),
      ...analysis.typeChanges.map((t) => t.name),
    ];
  }, [analysis.changeType, analysis.columnsRemoved, analysis.columnsRenamed, analysis.typeChanges]);

  // Run dependency scan when table or column changes are detected
  useEffect(() => {
    if (!existingTable || analysis.changeType === 'none') {
      setScanResult(null);
      setIsLoading(false);
      setScanError(null);
      return;
    }

    let cancelled = false;

    const runScan = async () => {
      setIsLoading(true);
      setScanError(null);

      try {
        const client = getWorkerClient();

        // Fetch sqlite_master data
        const result = await client.query(
          `SELECT type, name, tbl_name, rootpage, sql FROM sqlite_master WHERE type IN ('view', 'trigger')`
        );

        if (cancelled) return;

        // Convert query result to SqliteMasterObject array
        const masterRows: SqliteMasterObject[] = result.rows.map((row) => ({
          type: row[0] as 'view' | 'trigger',
          name: row[1] as string,
          tblName: row[2] as string,
          rootpage: row[3] as number,
          sql: row[4] as string | null,
        }));

        let scanResult: DependencyScanResult;
        if (columnsToScan.length > 0) {
          // Scan for specific column dependencies
          scanResult = scanDependenciesForColumns(
            existingTable.name,
            columnsToScan,
            masterRows
          );
        } else {
          // Scan for table-level dependencies only
          scanResult = scanDependenciesForTable(existingTable.name, masterRows);
        }

        if (cancelled) return;

        setScanResult(scanResult);
        setIsLoading(false);
      } catch (err) {
        if (cancelled) return;
        setScanError(err instanceof Error ? err.message : 'Dependency scan failed');
        setIsLoading(false);
      }
    };

    void runScan();

    return () => {
      cancelled = true;
    };
  }, [existingTable, analysis.changeType, columnsToScan]);

  // Build dependent objects list for SharedDDLDiffPreview
  const dependentObjects = useMemo((): DependentObject[] => {
    const objects: DependentObject[] = [];

    // Add indexes from affected objects
    for (const obj of affectedObjects) {
      objects.push({ type: obj.type, name: obj.name });
    }

    // Add views from scan result
    if (scanResult) {
      for (const view of scanResult.dependentViews) {
        objects.push({ type: 'view', name: view.name });
      }
      for (const trigger of scanResult.dependentTriggers) {
        // Only add triggers not already in affectedObjects
        if (!affectedObjects.some((o) => o.type === 'trigger' && o.name === trigger.name)) {
          objects.push({ type: 'trigger', name: trigger.name });
        }
      }
    }

    return objects;
  }, [affectedObjects, scanResult]);

  // Extract dependent views and triggers for detailed display
  const dependentViews = useMemo(
    () =>
      scanResult?.dependentViews.map((v) => ({ name: v.name, sql: v.sql })) || [],
    [scanResult]
  );

  const dependentTriggers = useMemo(
    () =>
      scanResult?.dependentTriggers.map((t) => ({ name: t.name, sql: t.sql })) || [],
    [scanResult]
  );

  // Build net effect summary
  const netEffectSummary = useMemo(() => {
    const parts: string[] = [];

    if (analysis.columnsToAdd.length > 0) {
      parts.push(`Add ${analysis.columnsToAdd.length} column(s)`);
    }
    if (analysis.columnsRemoved.length > 0) {
      parts.push(`Remove ${analysis.columnsRemoved.length} column(s)`);
    }
    if (analysis.columnsRenamed.length > 0) {
      parts.push(`Rename ${analysis.columnsRenamed.length} column(s)`);
    }
    if (analysis.typeChanges.length > 0) {
      parts.push(`${analysis.typeChanges.length} type change(s)`);
    }
    if (analysis.constraintChanges.length > 0) {
      parts.push(`${analysis.constraintChanges.length} constraint change(s)`);
    }

    const indexCount = affectedObjects.filter((o) => o.type === 'index').length;
    const triggerCount =
      affectedObjects.filter((o) => o.type === 'trigger').length +
      dependentTriggers.length;
    const viewCount = dependentViews.length;

    if (indexCount > 0) {
      parts.push(`${indexCount} index(es) will be recreated`);
    }
    if (triggerCount > 0) {
      parts.push(`${triggerCount} trigger(s) will be affected`);
    }
    if (viewCount > 0) {
      parts.push(`${viewCount} view(s) may be affected`);
    }

    return parts.length > 0 ? parts.join('; ') : 'No changes';
  }, [
    analysis.columnsToAdd.length,
    analysis.columnsRemoved.length,
    analysis.columnsRenamed.length,
    analysis.typeChanges.length,
    analysis.constraintChanges.length,
    affectedObjects,
    dependentViews.length,
    dependentTriggers.length,
  ]);

  // Validate changes
  const validation = useMemo(
    () => validateChanges(existingTable, columns, tableName, analysis, isReadOnly),
    [existingTable, columns, tableName, analysis, isReadOnly]
  );

  return {
    originalSql,
    proposedSql,
    dependentObjects,
    netEffectSummary,
    affectedObjects,
    dependentViews,
    dependentTriggers,
    analysis,
    validation,
    isLoading,
    scanError,
  };
}

export default useDesignerPreview;
