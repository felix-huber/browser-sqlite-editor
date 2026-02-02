/**
 * DDLDiffPreview Component
 *
 * Shows a side-by-side comparison of current vs new DDL when editing a table.
 * Highlights differences and lists affected objects (indexes, triggers, views).
 *
 * Features:
 * - Split view: "Current" SQL on left, "New" SQL on right
 * - Line-by-line diff highlighting (added = green, removed = red)
 * - Affected objects section (indexes, triggers, views to be recreated)
 * - Operation preview: simple ALTER TABLE or full rebuild plan
 * - Generated column modification warnings
 * - Apply button with validation gating
 */

import { useMemo } from 'react';
import type { TableInfo, DesignerColumnDraft } from '../../types';
import { escapeIdentifier } from '../../core/sql/escape';
import {
  DDLDiffPreview as SharedDDLDiffPreview,
  type DependentObject,
} from '../../shared/components/DDLDiffPreview';

// =============================================================================
// Types
// =============================================================================

export interface DDLDiffPreviewProps {
  /** The existing table info (null for create mode) */
  existingTable: TableInfo | null;
  /** Current column drafts from the designer */
  columns: DesignerColumnDraft[];
  /** New table name */
  tableName: string;
  /** Whether in read-only mode */
  isReadOnly?: boolean;
  /** Called when Apply is clicked */
  onApply?: () => void;
  /** Called when Cancel is clicked */
  onCancel?: () => void;
  /** Rollback error message to display */
  rollbackError?: string;
}

export interface DiffLine {
  /** The line content */
  content: string;
  /** Line type: added, removed, unchanged */
  type: 'added' | 'removed' | 'unchanged';
}

export interface AffectedObject {
  /** Object type */
  type: 'index' | 'trigger' | 'view';
  /** Object name */
  name: string;
  /** Action that will happen */
  action: 'drop_and_recreate' | 'warning_only';
  /** Original SQL (for recreating) */
  sql?: string | null;
}

export interface OperationStep {
  /** Step number (1-based) */
  step: number;
  /** SQL statement */
  sql: string;
  /** Description of what this step does */
  description: string;
}

export interface ValidationResult {
  /** Whether the changes are valid and can be applied */
  isValid: boolean;
  /** Warning messages (non-blocking) */
  warnings: string[];
  /** Error messages (blocking) */
  errors: string[];
  /** Whether there are any changes to apply */
  hasChanges: boolean;
}

// =============================================================================
// SQL Generation Helpers
// =============================================================================

/** Generate column definition SQL */
function generateColumnDef(col: DesignerColumnDraft): string {
  let def = `${escapeIdentifier(col.name)} ${col.type}`;

  // Generated columns have special syntax and cannot have regular constraints
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Generate CREATE TABLE statement */
function generateCreateTable(tableName: string, columns: DesignerColumnDraft[]): string {
  const colDefs = columns.map(generateColumnDef);
  return `CREATE TABLE ${escapeIdentifier(tableName)} (\n  ${colDefs.join(',\n  ')}\n);`;
}

/** Generate simple ALTER TABLE ADD COLUMN statement */
function generateAlterAddColumn(tableName: string, col: DesignerColumnDraft): string {
  return `ALTER TABLE ${escapeIdentifier(tableName)} ADD COLUMN ${generateColumnDef(col)};`;
}

// =============================================================================
// Change Detection
// =============================================================================

export interface ChangeAnalysis {
  /** Type of change needed */
  changeType: 'none' | 'add_columns' | 'rebuild';
  /** Columns to add (if changeType is 'add_columns') */
  columnsToAdd: DesignerColumnDraft[];
  /** Columns that were removed */
  columnsRemoved: string[];
  /** Columns that were renamed */
  columnsRenamed: Array<{ oldName: string; newName: string }>;
  /** Columns with type changes */
  typeChanges: Array<{ name: string; oldType: string; newType: string }>;
  /** Columns with constraint changes */
  constraintChanges: string[];
  /** Generated column modifications (blocked) */
  generatedColumnModifications: string[];
}

/**
 * Analyze changes between existing table and new columns
 */
export function analyzeChanges(
  existingTable: TableInfo | null,
  columns: DesignerColumnDraft[],
  newTableName: string
): ChangeAnalysis {
  // If no existing table (create mode), it's a simple create
  if (!existingTable) {
    return {
      changeType: 'none',
      columnsToAdd: [],
      columnsRemoved: [],
      columnsRenamed: [],
      typeChanges: [],
      constraintChanges: [],
      generatedColumnModifications: [],
    };
  }

  const result: ChangeAnalysis = {
    changeType: 'none',
    columnsToAdd: [],
    columnsRemoved: [],
    columnsRenamed: [],
    typeChanges: [],
    constraintChanges: [],
    generatedColumnModifications: [],
  };

  // Map existing columns by name
  const existingColMap = new Map(
    existingTable.columns.map((c) => [c.name.toLowerCase(), c])
  );

  // Map new columns by original name (for existing) or by name (for new)
  const newColByOriginalName = new Map<string, DesignerColumnDraft>();
  const newColNames = new Set<string>();

  for (const col of columns) {
    if (col.isExisting && col.originalName) {
      newColByOriginalName.set(col.originalName.toLowerCase(), col);
    }
    newColNames.add(col.name.toLowerCase());
  }

  // Check for removed columns
  for (const existingCol of existingTable.columns) {
    const lowerName = existingCol.name.toLowerCase();
    if (!newColByOriginalName.has(lowerName)) {
      result.columnsRemoved.push(existingCol.name);
    }
  }

  // Check each new column
  for (const col of columns) {
    if (!col.isExisting) {
      // This is a newly added column
      result.columnsToAdd.push(col);
      continue;
    }

    // Find the original column
    const originalCol = col.originalName
      ? existingColMap.get(col.originalName.toLowerCase())
      : null;

    if (!originalCol) continue;

    // Check for rename
    if (col.name.toLowerCase() !== col.originalName?.toLowerCase()) {
      result.columnsRenamed.push({
        oldName: col.originalName!,
        newName: col.name,
      });
    }

    // Check for type change
    if (col.type.toLowerCase() !== originalCol.type.toLowerCase()) {
      result.typeChanges.push({
        name: col.originalName!,
        oldType: originalCol.type,
        newType: col.type,
      });
    }

    // Check for constraint changes
    const pkChanged = col.isPrimaryKey !== (originalCol.pk > 0);
    const nnChanged = col.isNotNull !== originalCol.notnull;
    // Note: isUnique requires checking indexes, simplified here
    const defaultChanged = col.defaultValue !== originalCol.dfltValue;

    if (pkChanged || nnChanged || defaultChanged) {
      result.constraintChanges.push(col.originalName!);
    }

    // Check for generated column modification (blocked)
    if (originalCol.generated) {
      // Any modification to a generated column is blocked
      const typeChanged = col.type.toLowerCase() !== originalCol.type.toLowerCase();
      const nameChanged = col.name.toLowerCase() !== col.originalName?.toLowerCase();
      const genChanged = col.generated !== originalCol.generated;

      if (typeChanged || nameChanged || genChanged) {
        result.generatedColumnModifications.push(originalCol.name);
      }
    }
  }

  // Check for table rename
  const tableRenamed =
    existingTable.name.toLowerCase() !== newTableName.toLowerCase();

  // Determine change type
  if (
    result.columnsRemoved.length === 0 &&
    result.columnsRenamed.length === 0 &&
    result.typeChanges.length === 0 &&
    result.constraintChanges.length === 0 &&
    !tableRenamed &&
    result.generatedColumnModifications.length === 0
  ) {
    // Only new columns added (or no changes)
    if (result.columnsToAdd.length > 0) {
      // Check if we can use simple ALTER TABLE
      const canUseAlter = result.columnsToAdd.every((col) => {
        // SQLite ALTER TABLE ADD COLUMN has restrictions:
        // - Cannot have PRIMARY KEY (unless INTEGER PRIMARY KEY)
        // - Cannot have UNIQUE constraint
        // - DEFAULT must be constant (not expression)
        // - Cannot be generated
        if (col.isPrimaryKey && col.type.toUpperCase() !== 'INTEGER') return false;
        if (col.isUnique) return false;
        if (col.generated) return false;
        return true;
      });

      result.changeType = canUseAlter ? 'add_columns' : 'rebuild';
    } else {
      result.changeType = 'none';
    }
  } else {
    result.changeType = 'rebuild';
  }

  return result;
}

// =============================================================================
// Rebuild Plan Generation
// =============================================================================

/**
 * Generate the full rebuild plan for complex changes
 */
export function generateRebuildPlan(
  existingTable: TableInfo,
  columns: DesignerColumnDraft[],
  newTableName: string,
  _analysis: ChangeAnalysis
): OperationStep[] {
  const steps: OperationStep[] = [];
  const tempName = `_temp_${newTableName}_${Date.now()}`;
  const escapedOriginal = escapeIdentifier(existingTable.name);
  const escapedTemp = escapeIdentifier(tempName);
  const escapedNew = escapeIdentifier(newTableName);

  // Step 1: Create temp table with new schema
  steps.push({
    step: 1,
    sql: generateCreateTable(tempName, columns),
    description: 'Create temporary table with new schema',
  });

  // Step 2: Copy data from original to temp
  // Build column mapping for SELECT
  const selectColumns: string[] = [];
  const insertColumns: string[] = [];

  for (const col of columns) {
    if (col.generated) continue; // Skip generated columns in INSERT

    if (col.isExisting && col.originalName) {
      // Existing column - may have been renamed
      selectColumns.push(escapeIdentifier(col.originalName));
      insertColumns.push(escapeIdentifier(col.name));
    } else if (!col.isExisting) {
      // New column - use default value or NULL
      if (col.defaultValue !== null && col.defaultValue !== undefined) {
        selectColumns.push(col.defaultValue);
      } else if (col.isNotNull) {
        // Not null without default - use type-appropriate default
        const typeLower = col.type.toLowerCase();
        if (typeLower.includes('int')) {
          selectColumns.push('0');
        } else if (typeLower.includes('real') || typeLower.includes('float') || typeLower.includes('double')) {
          selectColumns.push('0.0');
        } else if (typeLower.includes('blob')) {
          selectColumns.push("X''");
        } else {
          selectColumns.push("''");
        }
      } else {
        selectColumns.push('NULL');
      }
      insertColumns.push(escapeIdentifier(col.name));
    }
  }

  if (selectColumns.length > 0) {
    steps.push({
      step: 2,
      sql: `INSERT INTO ${escapedTemp} (${insertColumns.join(', ')})\nSELECT ${selectColumns.join(', ')}\nFROM ${escapedOriginal};`,
      description: 'Copy data to temporary table',
    });
  }

  // Step 3: Drop original table
  steps.push({
    step: 3,
    sql: `DROP TABLE ${escapedOriginal};`,
    description: 'Drop original table',
  });

  // Step 4: Rename temp to final name
  steps.push({
    step: 4,
    sql: `ALTER TABLE ${escapedTemp} RENAME TO ${escapedNew};`,
    description: 'Rename temporary table to final name',
  });

  // Step 5+: Recreate indexes
  let stepNum = 5;
  for (const idx of existingTable.indexes) {
    if (idx.createSql) {
      // Replace old table name with new table name in the CREATE INDEX statement
      let indexSql = idx.createSql;
      if (existingTable.name !== newTableName) {
        // Simple replacement - may need more sophisticated parsing for complex cases
        const rawName = escapeRegExp(existingTable.name);
        const quotedName = escapeRegExp(escapeIdentifier(existingTable.name));
        indexSql = indexSql.replace(new RegExp(`\\b${rawName}\\b`, 'gi'), escapedNew);
        indexSql = indexSql.replace(new RegExp(quotedName, 'gi'), escapedNew);
      }
      steps.push({
        step: stepNum++,
        sql: indexSql,
        description: `Recreate index: ${idx.name}`,
      });
    }
  }

  return steps;
}

// =============================================================================
// Diff Generation
// =============================================================================

/**
 * Generate a simple line-by-line diff
 */
export function generateDiff(oldSql: string, newSql: string): DiffLine[] {
  const oldLines = oldSql.split('\n');
  const newLines = newSql.split('\n');
  const result: DiffLine[] = [];

  // Simple LCS-based diff
  const oldSet = new Set(oldLines);
  const newSet = new Set(newLines);

  // Build a combined view
  let oldIdx = 0;
  let newIdx = 0;

  while (oldIdx < oldLines.length || newIdx < newLines.length) {
    const oldLine = oldLines[oldIdx];
    const newLine = newLines[newIdx];

    if (oldIdx >= oldLines.length) {
      // Only new lines left
      result.push({ content: newLine, type: 'added' });
      newIdx++;
    } else if (newIdx >= newLines.length) {
      // Only old lines left
      result.push({ content: oldLine, type: 'removed' });
      oldIdx++;
    } else if (oldLine === newLine) {
      // Lines match
      result.push({ content: oldLine, type: 'unchanged' });
      oldIdx++;
      newIdx++;
    } else if (!newSet.has(oldLine) && !oldSet.has(newLine)) {
      // Both changed - show removed then added
      result.push({ content: oldLine, type: 'removed' });
      result.push({ content: newLine, type: 'added' });
      oldIdx++;
      newIdx++;
    } else if (!newSet.has(oldLine)) {
      // Old line was removed
      result.push({ content: oldLine, type: 'removed' });
      oldIdx++;
    } else {
      // New line was added
      result.push({ content: newLine, type: 'added' });
      newIdx++;
    }
  }

  return result;
}

// =============================================================================
// Affected Objects Detection
// =============================================================================

/**
 * Get list of affected objects (indexes, triggers, views)
 */
export function getAffectedObjects(
  existingTable: TableInfo,
  changeType: 'none' | 'add_columns' | 'rebuild'
): AffectedObject[] {
  const affected: AffectedObject[] = [];

  if (changeType !== 'rebuild') {
    return affected;
  }

  // Indexes will be dropped and recreated
  for (const idx of existingTable.indexes) {
    affected.push({
      type: 'index',
      name: idx.name,
      action: 'drop_and_recreate',
      sql: idx.createSql,
    });
  }

  // Note: We'd need to query sqlite_master for triggers and views
  // that reference this table. For now, we indicate this is a limitation.
  // In a real implementation, we'd pass this info from the worker.

  return affected;
}

// =============================================================================
// Validation
// =============================================================================

/**
 * Validate the changes and determine if Apply should be enabled
 */
export function validateChanges(
  existingTable: TableInfo | null,
  _columns: DesignerColumnDraft[],
  newTableName: string,
  analysis: ChangeAnalysis,
  isReadOnly: boolean
): ValidationResult {
  const warnings: string[] = [];
  const errors: string[] = [];

  // Check if read-only
  if (isReadOnly) {
    errors.push('Database is in read-only mode');
  }

  // Check for generated column modifications (blocked)
  if (analysis.generatedColumnModifications.length > 0) {
    for (const colName of analysis.generatedColumnModifications) {
      errors.push(
        `Generated column "${colName}" cannot be modified. Drop and recreate if needed.`
      );
    }
  }

  // Warnings for affected objects
  if (analysis.changeType === 'rebuild' && existingTable) {
    if (existingTable.indexes.length > 0) {
      warnings.push(
        `${existingTable.indexes.length} index(es) will be dropped and recreated`
      );
    }
    // Views warning (would need external data)
    warnings.push('Views referencing this table may need to be updated');
  }

  // Check if there are any changes
  const hasChanges = analysis.changeType !== 'none' ||
    (existingTable?.name.toLowerCase() !== newTableName.toLowerCase());

  return {
    isValid: errors.length === 0 && hasChanges,
    warnings,
    errors,
    hasChanges,
  };
}

// =============================================================================
// Component
// =============================================================================

export function DDLDiffPreview({
  existingTable,
  columns,
  tableName,
  isReadOnly = false,
  onApply,
  onCancel,
  rollbackError,
}: DDLDiffPreviewProps) {
  // Analyze changes
  const analysis = useMemo(
    () => analyzeChanges(existingTable, columns, tableName),
    [existingTable, columns, tableName]
  );

  // Generate SQL for display
  const { currentSql, newSql, operationSteps, validation, sharedDependentObjects, netEffectSummary } =
    useMemo(() => {
      const newSql = generateCreateTable(tableName, columns);
      const currentSql = existingTable?.createSql || '';

      // Generate operation steps based on change type
      let operationSteps: OperationStep[] = [];

      if (analysis.changeType === 'add_columns' && existingTable) {
        // Simple ALTER TABLE for each new column
        operationSteps = analysis.columnsToAdd.map((col, idx) => ({
          step: idx + 1,
          sql: generateAlterAddColumn(tableName, col),
          description: `Add column: ${col.name}`,
        }));
      } else if (analysis.changeType === 'rebuild' && existingTable) {
        // Full rebuild plan
        operationSteps = generateRebuildPlan(existingTable, columns, tableName, analysis);
      }

      // Get affected objects
      const affectedObjects = existingTable
        ? getAffectedObjects(existingTable, analysis.changeType)
        : [];

      // Convert to shared DependentObject format for SharedDDLDiffPreview
      const sharedDependentObjects: DependentObject[] = affectedObjects.map((obj) => ({
        type: obj.type,
        name: obj.name,
      }));

      // Generate net effect summary for SharedDDLDiffPreview
      const summaryParts: string[] = [];
      if (analysis.columnsToAdd.length > 0) {
        summaryParts.push(`Add ${analysis.columnsToAdd.length} column(s)`);
      }
      if (analysis.columnsRemoved.length > 0) {
        summaryParts.push(`Remove ${analysis.columnsRemoved.length} column(s)`);
      }
      if (analysis.columnsRenamed.length > 0) {
        summaryParts.push(`Rename ${analysis.columnsRenamed.length} column(s)`);
      }
      if (analysis.typeChanges.length > 0) {
        summaryParts.push(`${analysis.typeChanges.length} type change(s)`);
      }
      if (analysis.constraintChanges.length > 0) {
        summaryParts.push(`${analysis.constraintChanges.length} constraint change(s)`);
      }
      if (affectedObjects.length > 0) {
        summaryParts.push(`${affectedObjects.length} object(s) will be recreated`);
      }
      const netEffectSummary = summaryParts.length > 0 ? summaryParts.join('; ') : 'No changes';

      // Validate
      const validation = validateChanges(
        existingTable,
        columns,
        tableName,
        analysis,
        isReadOnly
      );

      return { currentSql, newSql, operationSteps, validation, sharedDependentObjects, netEffectSummary };
    }, [existingTable, columns, tableName, analysis, isReadOnly]);

  // If no existing table (create mode), show simplified view
  if (!existingTable) {
    return (
      <div className="flex flex-col h-full bg-gray-50" data-testid="ddl-diff-preview">
        <div className="px-4 py-3 border-b bg-white">
          <h3 className="text-sm font-semibold text-gray-900">SQL Preview</h3>
        </div>
        <div className="flex-1 min-h-0 overflow-auto p-4">
          <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
            <div className="px-3 py-2 bg-gray-50 border-b text-xs font-medium text-gray-600">
              CREATE TABLE Statement
            </div>
            <pre
              className="p-3 text-sm font-mono text-gray-800 whitespace-pre-wrap overflow-x-auto"
              data-testid="new-sql-preview"
            >
              {newSql}
            </pre>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-gray-50" data-testid="ddl-diff-preview">
      {/* Header */}
      <div className="px-4 py-3 border-b bg-white">
        <h3 className="text-sm font-semibold text-gray-900">DDL Changes Preview</h3>
        <p className="text-xs text-gray-500 mt-1">
          {analysis.changeType === 'none' && 'No structural changes detected'}
          {analysis.changeType === 'add_columns' && 'Simple column additions (ALTER TABLE)'}
          {analysis.changeType === 'rebuild' && 'Table rebuild required'}
        </p>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-4">
        {/* Use shared DDLDiffPreview for diff visualization */}
        <SharedDDLDiffPreview
          originalSql={currentSql}
          proposedSql={newSql}
          dependentObjects={sharedDependentObjects}
          netEffectSummary={netEffectSummary}
          rollbackError={rollbackError}
        />

        {/* Operation Preview */}
        {operationSteps.length > 0 && (
          <div
            className="rounded-lg border border-gray-200 bg-white overflow-hidden"
            data-testid="operation-preview"
          >
            <div className="px-3 py-2 bg-gray-50 border-b text-xs font-medium text-gray-600">
              Operation Plan ({operationSteps.length} step{operationSteps.length !== 1 ? 's' : ''})
            </div>
            <div className="p-3 space-y-3">
              {operationSteps.map((step) => (
                <div key={step.step} className="border-l-2 border-blue-300 pl-3">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="inline-flex items-center justify-center w-5 h-5 text-xs font-medium bg-blue-100 text-blue-700 rounded-full">
                      {step.step}
                    </span>
                    <span className="text-sm text-gray-600">{step.description}</span>
                  </div>
                  <pre
                    className="text-xs font-mono text-gray-700 bg-gray-50 rounded p-2 overflow-x-auto"
                    data-testid={`operation-step-${step.step}`}
                  >
                    {step.sql}
                  </pre>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Validation Messages */}
        {(validation.errors.length > 0 || validation.warnings.length > 0) && (
          <div className="space-y-2">
            {/* Errors */}
            {validation.errors.map((error, idx) => (
              <div
                key={`error-${idx}`}
                className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200"
                data-testid="validation-error"
              >
                <svg
                  className="w-5 h-5 text-red-500 shrink-0"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                    clipRule="evenodd"
                  />
                </svg>
                <span className="text-sm text-red-700">{error}</span>
              </div>
            ))}

            {/* Warnings */}
            {validation.warnings.map((warning, idx) => (
              <div
                key={`warning-${idx}`}
                className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200"
                data-testid="validation-warning"
              >
                <svg
                  className="w-5 h-5 text-amber-500 shrink-0"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                    clipRule="evenodd"
                  />
                </svg>
                <span className="text-sm text-amber-700">{warning}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer with Apply/Cancel buttons */}
      <div className="px-4 py-3 border-t bg-white flex justify-between items-center">
        <div className="text-sm text-gray-500">
          {!validation.hasChanges && (
            <span data-testid="no-changes-message">No changes to apply</span>
          )}
        </div>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-gray-700 font-medium rounded-lg border border-gray-300 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-400"
            data-testid="cancel-preview-button"
          >
            Back
          </button>
          <button
            type="button"
            onClick={onApply}
            disabled={!validation.isValid}
            title={
              !validation.isValid
                ? validation.errors.length > 0
                  ? validation.errors[0]
                  : 'No changes to apply'
                : 'Apply changes'
            }
            className={`px-4 py-2 font-medium rounded-lg focus:outline-none focus:ring-2 focus:ring-offset-2 transition-colors ${
              !validation.isValid
                ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                : 'bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-600'
            }`}
            data-testid="apply-button"
          >
            Apply Changes
          </button>
        </div>
      </div>
    </div>
  );
}

export default DDLDiffPreview;
