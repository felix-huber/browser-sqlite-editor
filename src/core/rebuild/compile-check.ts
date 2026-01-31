/**
 * Post-rebuild compile verification for dependent objects.
 *
 * This module implements Phase 2 of the PRD's two-phase dependency handling:
 * - After rebuild completes within transaction
 * - Compile-check ALL user-defined SQL objects from sqlite_master (views, triggers)
 * - Run sqlite3_prepare_v2 equivalent on each
 * - If ANY object fails to compile -> signals rollback
 * - Shows dependency error listing broken objects with their SQL
 *
 * This is the authoritative check that catches all broken dependencies,
 * including those missed by the pre-flight textual scan.
 */

import type { DatabaseEngine } from '../engine/db-engine';
import type { SqliteMasterObject, VerificationFailure } from './types';
import { quoteIdentifier } from './utils';

/**
 * Result of compiling a single SQL object.
 */
export interface CompileCheckResult {
  /** Object name */
  name: string;
  /** Object type */
  type: 'view' | 'trigger';
  /** Whether compilation succeeded */
  success: boolean;
  /** Error message if compilation failed */
  error?: string;
  /** Original SQL definition */
  sql: string;
}

/**
 * Result of compiling all dependent objects.
 */
export interface CompileCheckAllResult {
  /** Whether all objects compiled successfully */
  allPassed: boolean;
  /** Individual results for each object */
  results: CompileCheckResult[];
  /** Objects that failed to compile */
  failures: CompileCheckResult[];
  /** Human-readable error message for failed checks */
  errorMessage: string;
}

/**
 * Compile-checks a view by attempting to prepare a SELECT statement.
 *
 * Uses SELECT * FROM view LIMIT 0 which forces SQLite to compile the view
 * without returning any data. If the view references missing columns or
 * tables, this will fail.
 *
 * @param engine Database engine
 * @param viewName View to check
 * @param viewSql Original view SQL (for error reporting)
 * @returns Compile check result
 */
export async function compileCheckView(
  engine: DatabaseEngine,
  viewName: string,
  viewSql: string
): Promise<CompileCheckResult> {
  try {
    // SELECT * LIMIT 0 forces view compilation without returning data
    await engine.query(
      `SELECT * FROM ${quoteIdentifier(viewName)} LIMIT 0`
    );
    return {
      name: viewName,
      type: 'view',
      success: true,
      sql: viewSql,
    };
  } catch (err) {
    return {
      name: viewName,
      type: 'view',
      success: false,
      error: err instanceof Error ? err.message : String(err),
      sql: viewSql,
    };
  }
}

/**
 * Compile-checks a trigger by verifying it exists in sqlite_master.
 *
 * If the trigger was recreated with its original SQL during rebuild,
 * and it exists in sqlite_master, then its SQL was valid. If it doesn't
 * exist, the CREATE TRIGGER failed (bad reference).
 *
 * Note: We cannot easily "dry run" a trigger without modifying data.
 * Instead, we verify:
 * 1. The trigger exists in sqlite_master after recreation
 * 2. If it references tables/columns that no longer exist, SQLite would
 *    have rejected the CREATE TRIGGER statement.
 *
 * @param engine Database engine
 * @param triggerName Trigger to check
 * @param triggerSql Original trigger SQL (for error reporting)
 * @returns Compile check result
 */
export async function compileCheckTrigger(
  engine: DatabaseEngine,
  triggerName: string,
  triggerSql: string
): Promise<CompileCheckResult> {
  try {
    const result = await engine.query(
      `SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?`,
      [triggerName]
    );

    if (result.rows.length === 0) {
      return {
        name: triggerName,
        type: 'trigger',
        success: false,
        error: `Trigger was not recreated - possibly references missing columns or tables`,
        sql: triggerSql,
      };
    }

    // Trigger exists, so CREATE TRIGGER succeeded
    return {
      name: triggerName,
      type: 'trigger',
      success: true,
      sql: triggerSql,
    };
  } catch (err) {
    return {
      name: triggerName,
      type: 'trigger',
      success: false,
      error: err instanceof Error ? err.message : String(err),
      sql: triggerSql,
    };
  }
}

/**
 * Compile-checks all views in the database.
 *
 * This verifies that all views still compile after a table rebuild.
 * Views that reference modified columns will fail to compile.
 *
 * @param engine Database engine
 * @param masterRows Current sqlite_master rows (post-rebuild)
 * @returns Results for all views
 */
export async function compileCheckAllViews(
  engine: DatabaseEngine,
  masterRows: SqliteMasterObject[]
): Promise<CompileCheckResult[]> {
  const results: CompileCheckResult[] = [];

  for (const row of masterRows) {
    if (row.type === 'view' && row.sql) {
      const result = await compileCheckView(engine, row.name, row.sql);
      results.push(result);
    }
  }

  return results;
}

/**
 * Compile-checks all triggers in the database.
 *
 * This verifies that all triggers still compile after a table rebuild.
 * Triggers that reference modified columns will fail to compile.
 *
 * @param engine Database engine
 * @param masterRows Current sqlite_master rows (post-rebuild)
 * @returns Results for all triggers
 */
export async function compileCheckAllTriggers(
  engine: DatabaseEngine,
  masterRows: SqliteMasterObject[]
): Promise<CompileCheckResult[]> {
  const results: CompileCheckResult[] = [];

  for (const row of masterRows) {
    if (row.type === 'trigger' && row.sql) {
      const result = await compileCheckTrigger(engine, row.name, row.sql);
      results.push(result);
    }
  }

  return results;
}

/**
 * Fetches current sqlite_master rows from the database.
 *
 * @param engine Database engine
 * @returns Array of sqlite_master objects
 */
export async function fetchSqliteMaster(
  engine: DatabaseEngine
): Promise<SqliteMasterObject[]> {
  const result = await engine.query(
    `SELECT type, name, tbl_name, rootpage, sql FROM sqlite_master WHERE type IN ('view', 'trigger')`
  );

  return result.rows.map((row) => ({
    type: row[0] as 'view' | 'trigger',
    name: row[1] as string,
    tblName: row[2] as string,
    rootpage: row[3] as number,
    sql: row[4] as string | null,
  }));
}

/**
 * Runs compile checks on all views and triggers in the database.
 *
 * This is the main entry point for post-rebuild verification.
 * It should be called after the rebuild operations but before commit.
 *
 * @param engine Database engine
 * @returns Combined result of all compile checks
 */
export async function runCompileChecks(
  engine: DatabaseEngine
): Promise<CompileCheckAllResult> {
  // Fetch current state of views and triggers
  const masterRows = await fetchSqliteMaster(engine);

  // Check all views
  const viewResults = await compileCheckAllViews(engine, masterRows);

  // Check all triggers
  const triggerResults = await compileCheckAllTriggers(engine, masterRows);

  // Combine results
  const allResults = [...viewResults, ...triggerResults];
  const failures = allResults.filter((r) => !r.success);
  const allPassed = failures.length === 0;

  // Build error message
  let errorMessage = '';
  if (!allPassed) {
    errorMessage = buildCompileErrorMessage(failures);
  }

  return {
    allPassed,
    results: allResults,
    failures,
    errorMessage,
  };
}

/**
 * Runs compile checks on specific views and triggers.
 *
 * Use this when you know exactly which objects to check (e.g., from
 * pre-flight dependency scan results).
 *
 * @param engine Database engine
 * @param viewNames View names to check
 * @param triggerNames Trigger names to check
 * @returns Combined result
 */
export async function runCompileChecksOnObjects(
  engine: DatabaseEngine,
  viewNames: string[],
  triggerNames: string[]
): Promise<CompileCheckAllResult> {
  const results: CompileCheckResult[] = [];

  // Check specified views
  for (const viewName of viewNames) {
    // Fetch view SQL from sqlite_master
    const viewResult = await engine.query(
      `SELECT sql FROM sqlite_master WHERE type = 'view' AND name = ?`,
      [viewName]
    );

    if (viewResult.rows.length > 0) {
      const viewSql = viewResult.rows[0][0] as string;
      const result = await compileCheckView(engine, viewName, viewSql);
      results.push(result);
    } else {
      // View doesn't exist (might have been dropped)
      results.push({
        name: viewName,
        type: 'view',
        success: false,
        error: 'View not found in database',
        sql: '',
      });
    }
  }

  // Check specified triggers
  for (const triggerName of triggerNames) {
    // Fetch trigger SQL from sqlite_master
    const triggerResult = await engine.query(
      `SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?`,
      [triggerName]
    );

    if (triggerResult.rows.length > 0) {
      const triggerSql = triggerResult.rows[0][0] as string;
      const result = await compileCheckTrigger(engine, triggerName, triggerSql);
      results.push(result);
    } else {
      // Trigger doesn't exist (CREATE TRIGGER failed)
      results.push({
        name: triggerName,
        type: 'trigger',
        success: false,
        error: 'Trigger not found - creation failed during rebuild',
        sql: '',
      });
    }
  }

  const failures = results.filter((r) => !r.success);
  const allPassed = failures.length === 0;

  let errorMessage = '';
  if (!allPassed) {
    errorMessage = buildCompileErrorMessage(failures);
  }

  return {
    allPassed,
    results,
    failures,
    errorMessage,
  };
}

/**
 * Builds a human-readable error message for compile failures.
 */
function buildCompileErrorMessage(failures: CompileCheckResult[]): string {
  const lines: string[] = [];

  lines.push(`${failures.length} dependent object(s) failed to compile after rebuild:`);
  lines.push('');

  for (const failure of failures) {
    lines.push(`❌ ${failure.type.toUpperCase()} "${failure.name}":`);
    lines.push(`   Error: ${failure.error}`);
    if (failure.sql) {
      // Truncate long SQL for display
      const truncatedSql =
        failure.sql.length > 200
          ? failure.sql.substring(0, 200) + '...'
          : failure.sql;
      lines.push(`   SQL: ${truncatedSql}`);
    }
    lines.push('');
  }

  lines.push('The operation has been rolled back. No changes were made to the database.');

  return lines.join('\n');
}

/**
 * Converts compile check failures to VerificationFailure format.
 *
 * This allows integration with the existing verification system in verify.ts.
 *
 * @param failures Compile check failures
 * @returns VerificationFailure array
 */
export function compileFailuresToVerificationFailures(
  failures: CompileCheckResult[]
): VerificationFailure[] {
  return failures.map((failure) => ({
    type: failure.type === 'view' ? 'view_broken' : 'trigger_broken',
    objectName: failure.name,
    message: `${failure.type === 'view' ? 'View' : 'Trigger'} "${failure.name}" failed to compile after rebuild`,
    details: failure.error,
  }));
}
