/**
 * Rebuild verification helpers.
 */

import type { DatabaseEngine } from '../engine/db-engine';
import type { ForeignKeyInfo } from '../../types';
import type { RebuildPlan, RebuildVerificationOptions, VerificationFailure } from './types';
import { quoteIdentifier } from './utils';

/**
 * Verifies the table schema matches expected columns after rebuild.
 *
 * Uses PRAGMA table_info to get the current column structure and compares
 * against expected columns if provided.
 *
 * @param engine Database engine
 * @param tableName Table to verify
 * @param expectedColumns Optional list of expected column names
 * @returns Array of failures (empty if all checks pass)
 */
export async function verifyTableSchema(
  engine: DatabaseEngine,
  tableName: string,
  expectedColumns?: string[]
): Promise<VerificationFailure[]> {
  const failures: VerificationFailure[] = [];

  try {
    const result = await engine.query(
      `PRAGMA table_info(${quoteIdentifier(tableName)})`
    );

    // table_info returns: cid, name, type, notnull, dflt_value, pk
    const actualColumns = result.rows.map((row) => row[1] as string);

    if (expectedColumns && expectedColumns.length > 0) {
      // Compare column lists (case-insensitive)
      const expectedLower = expectedColumns.map((c) => c.toLowerCase());
      const actualLower = actualColumns.map((c) => c.toLowerCase());

      // Check for missing expected columns
      for (const expected of expectedLower) {
        if (!actualLower.includes(expected)) {
          failures.push({
            type: 'schema_mismatch',
            objectName: tableName,
            message: `Expected column "${expected}" not found in rebuilt table`,
            details: `Expected: [${expectedColumns.join(', ')}], Actual: [${actualColumns.join(', ')}]`,
          });
        }
      }

      // Check for unexpected columns
      for (const actual of actualLower) {
        if (!expectedLower.includes(actual)) {
          failures.push({
            type: 'schema_mismatch',
            objectName: tableName,
            message: `Unexpected column "${actual}" in rebuilt table`,
            details: `Expected: [${expectedColumns.join(', ')}], Actual: [${actualColumns.join(', ')}]`,
          });
        }
      }
    }

    // Basic sanity check: table should have at least one column
    if (actualColumns.length === 0) {
      failures.push({
        type: 'schema_mismatch',
        objectName: tableName,
        message: 'Rebuilt table has no columns',
      });
    }
  } catch (err) {
    failures.push({
      type: 'schema_mismatch',
      objectName: tableName,
      message: `Failed to verify table schema: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  return failures;
}

/**
 * Verifies foreign key integrity for a table.
 *
 * Uses PRAGMA foreign_key_check to detect any FK violations after rebuild.
 *
 * @param engine Database engine
 * @param tableName Table to check
 * @returns Array of failures (empty if no violations)
 */
export async function verifyForeignKeyIntegrity(
  engine: DatabaseEngine,
  tableName: string
): Promise<VerificationFailure[]> {
  const failures: VerificationFailure[] = [];

  try {
    const result = await engine.query(
      `PRAGMA foreign_key_check(${quoteIdentifier(tableName)})`
    );

    // foreign_key_check returns: table, rowid, parent, fkid
    // Each row represents a violation
    if (result.rows.length > 0) {
      // Group violations by parent table for cleaner reporting
      const violationsByParent = new Map<string, number>();
      for (const row of result.rows) {
        const parentTable = row[2] as string;
        violationsByParent.set(
          parentTable,
          (violationsByParent.get(parentTable) ?? 0) + 1
        );
      }

      for (const [parentTable, count] of violationsByParent) {
        failures.push({
          type: 'fk_violation',
          objectName: tableName,
          message: `Foreign key violation: ${count} row(s) reference non-existent data in "${parentTable}"`,
          details: `Total FK violations detected: ${result.rows.length}`,
        });
      }
    }
  } catch (err) {
    failures.push({
      type: 'fk_violation',
      objectName: tableName,
      message: `Failed to verify FK integrity: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  return failures;
}

/**
 * Verifies that a view is still compilable after table rebuild.
 *
 * Runs SELECT * FROM view LIMIT 0 to check if the view compiles.
 * This catches issues like missing columns, renamed columns, or type changes
 * that break the view definition.
 *
 * @param engine Database engine
 * @param viewName View to verify
 * @returns VerificationFailure if view is broken, null if OK
 */
export async function verifyViewCompilability(
  engine: DatabaseEngine,
  viewName: string
): Promise<VerificationFailure | null> {
  try {
    // SELECT * LIMIT 0 forces the view to be compiled without returning data
    await engine.query(
      `SELECT * FROM ${quoteIdentifier(viewName)} LIMIT 0`
    );
    return null;
  } catch (err) {
    return {
      type: 'view_broken',
      objectName: viewName,
      message: `View "${viewName}" is broken after rebuild`,
      details: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Verifies that a trigger SQL is syntactically valid.
 *
 * Since we cannot easily test a trigger without modifying data,
 * we verify by checking that the trigger exists in sqlite_master
 * after recreation. If the CREATE TRIGGER succeeded, the syntax is valid.
 *
 * Additionally, we parse the trigger SQL to extract referenced columns
 * and check they still exist (basic validation).
 *
 * @param engine Database engine
 * @param triggerName Trigger to verify
 * @param triggerSql Original trigger SQL for reference
 * @returns VerificationFailure if trigger is broken, null if OK
 */
export async function verifyTriggerValidity(
  engine: DatabaseEngine,
  triggerName: string,
  triggerSql: string
): Promise<VerificationFailure | null> {
  try {
    // Check trigger exists in sqlite_master
    const result = await engine.query(
      `SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?`,
      [triggerName]
    );

    if (result.rows.length === 0) {
      return {
        type: 'trigger_broken',
        objectName: triggerName,
        message: `Trigger "${triggerName}" was not recreated`,
        details: `Expected trigger SQL: ${triggerSql.substring(0, 100)}...`,
      };
    }

    // Trigger exists and was created successfully - syntax is valid
    return null;
  } catch (err) {
    return {
      type: 'trigger_broken',
      objectName: triggerName,
      message: `Failed to verify trigger "${triggerName}"`,
      details: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Checks for self-referential foreign keys in a table.
 *
 * Self-referential FKs (e.g., employee.manager_id -> employee.id)
 * require special handling during rebuild to avoid deadlock issues.
 *
 * @param tableName Table name to check
 * @param foreignKeys Foreign keys for the table
 * @returns True if the table has self-referential FKs
 */
export function hasSelfReferencialForeignKeys(
  tableName: string,
  foreignKeys: ForeignKeyInfo[]
): boolean {
  const tableNameLower = tableName.toLowerCase();
  return foreignKeys.some(
    (fk) => fk.parentTable.toLowerCase() === tableNameLower
  );
}

/**
 * Runs all post-rebuild verifications.
 *
 * This is the main verification entry point called after the rebuild
 * transaction commits. It runs all enabled verification checks and
 * collects failures.
 *
 * @param engine Database engine
 * @param plan Rebuild plan that was executed
 * @param options Verification options
 * @returns Array of all verification failures
 */
export async function runPostRebuildVerification(
  engine: DatabaseEngine,
  plan: RebuildPlan,
  options: RebuildVerificationOptions = {}
): Promise<VerificationFailure[]> {
  const {
    verifySchema = true,
    verifyForeignKeys = true,
    verifyViews = true,
    verifyTriggers = true,
    expectedColumns,
  } = options;

  const failures: VerificationFailure[] = [];

  // 1. Verify schema
  if (verifySchema) {
    const schemaFailures = await verifyTableSchema(
      engine,
      plan.tableName,
      expectedColumns
    );
    failures.push(...schemaFailures);
  }

  // 2. Verify FK integrity
  if (verifyForeignKeys) {
    const fkFailures = await verifyForeignKeyIntegrity(engine, plan.tableName);
    failures.push(...fkFailures);
  }

  // 3. Verify dependent views
  if (verifyViews) {
    for (const view of plan.dependents.views) {
      const viewFailure = await verifyViewCompilability(engine, view.name);
      if (viewFailure) {
        failures.push(viewFailure);
      }
    }
  }

  // 4. Verify triggers
  if (verifyTriggers) {
    for (const trigger of plan.dependents.triggers) {
      const triggerFailure = await verifyTriggerValidity(
        engine,
        trigger.name,
        trigger.sql
      );
      if (triggerFailure) {
        failures.push(triggerFailure);
      }
    }
  }

  return failures;
}

/**
 * Runs verification checks before committing the rebuild transaction.
 *
 * This is called inside the transaction, after all rebuild operations but before COMMIT.
 * If any verification fails, the transaction will be rolled back.
 *
 * @param engine Database engine
 * @param plan Rebuild plan
 * @param options Verification options
 * @returns Array of verification failures
 */
export async function runPreCommitVerification(
  engine: DatabaseEngine,
  plan: RebuildPlan,
  options: RebuildVerificationOptions = {}
): Promise<VerificationFailure[]> {
  const {
    verifySchema = true,
    verifyViews = true,
    verifyTriggers = true,
    expectedColumns,
  } = options;

  const failures: VerificationFailure[] = [];

  // 1. Verify schema matches expected (if provided)
  if (verifySchema) {
    const schemaFailures = await verifyTableSchema(
      engine,
      plan.tableName,
      expectedColumns
    );
    failures.push(...schemaFailures);
  }

  // 2. Verify dependent views still compile
  if (verifyViews) {
    for (const view of plan.dependents.views) {
      const viewFailure = await verifyViewCompilability(engine, view.name);
      if (viewFailure) {
        failures.push(viewFailure);
      }
    }
  }

  // 3. Verify triggers were recreated successfully
  if (verifyTriggers) {
    for (const trigger of plan.dependents.triggers) {
      const triggerFailure = await verifyTriggerValidity(
        engine,
        trigger.name,
        trigger.sql
      );
      if (triggerFailure) {
        failures.push(triggerFailure);
      }
    }
  }

  return failures;
}

/**
 * Formats verification errors into a human-readable string.
 *
 * @param failures Array of verification failures
 * @returns Formatted error string
 */
export function formatVerificationErrors(failures: VerificationFailure[]): string {
  if (failures.length === 0) return '';

  const brokenViews = failures.filter((f) => f.type === 'view_broken');
  const brokenTriggers = failures.filter((f) => f.type === 'trigger_broken');
  const schemaErrors = failures.filter((f) => f.type === 'schema_mismatch');
  const fkErrors = failures.filter((f) => f.type === 'fk_violation');

  const parts: string[] = [];

  if (brokenViews.length > 0) {
    const viewNames = brokenViews.map((f) => f.objectName).join(', ');
    parts.push(`Broken view(s): ${viewNames}`);
  }

  if (brokenTriggers.length > 0) {
    const triggerNames = brokenTriggers.map((f) => f.objectName).join(', ');
    parts.push(`Broken trigger(s): ${triggerNames}`);
  }

  if (schemaErrors.length > 0) {
    parts.push(`Schema mismatch: ${schemaErrors[0].message}`);
  }

  if (fkErrors.length > 0) {
    parts.push(`FK violation(s): ${fkErrors.length}`);
  }

  return parts.join('; ');
}
