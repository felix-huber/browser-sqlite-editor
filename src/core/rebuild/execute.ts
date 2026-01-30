/**
 * Rebuild execution.
 */

import type { DatabaseEngine } from '../engine/db-engine';
import type { ForeignKeyInfo, ForeignKeyAction } from '../../types';
import type {
  RebuildPlan,
  RebuildExecutionResult,
  RebuildOperationType,
  RebuildVerificationOptions,
  VerificationFailure,
} from './types';
import { quoteIdentifier } from './utils';
import {
  hasSelfReferencialForeignKeys,
  verifyForeignKeyIntegrity,
  runPreCommitVerification,
  formatVerificationErrors,
} from './verify';

/**
 * Executes a rebuild plan transactionally with post-rebuild verification.
 *
 * The execution follows these steps:
 * 1. Disable foreign key enforcement
 * 2. Begin transaction
 * 3. Create temp table with new schema
 * 4. Copy data from original table
 * 5. Drop original table
 * 6. Rename temp table to original name
 * 7. Recreate indexes
 * 8. Recreate triggers
 * 9. Run FK check
 * 10. Run post-rebuild verification (views, triggers, schema)
 * 11. Commit (or rollback on any verification failure)
 * 12. Re-enable foreign keys
 *
 * @param engine Database engine to execute on
 * @param plan Rebuild plan to execute
 * @param verificationOptions Optional verification settings
 * @returns Execution result with success status, row counts, and any verification failures
 */
export async function executeRebuildPlan(
  engine: DatabaseEngine,
  plan: RebuildPlan,
  verificationOptions?: RebuildVerificationOptions
): Promise<RebuildExecutionResult> {
  const executedOperations: RebuildOperationType[] = [];
  let rowCountBefore = 0;
  let rowCountAfter = 0;
  let inTransaction = false;
  let fkWasEnabled = false;
  const verificationFailures: VerificationFailure[] = [];

  // Check for self-referential FK issues upfront
  // Get all FKs for this table to check for self-references
  let selfReferentialFkInfo: ForeignKeyInfo[] = [];
  try {
    const fkListResult = await engine.query(
      `PRAGMA foreign_key_list(${quoteIdentifier(plan.tableName)})`
    );
    // foreign_key_list returns: id, seq, table, from, to, on_update, on_delete, match
    selfReferentialFkInfo = fkListResult.rows
      .filter((row) => (row[2] as string).toLowerCase() === plan.tableName.toLowerCase())
      .map((row) => ({
        id: row[0] as number,
        childTable: plan.tableName,
        childColumn: row[3] as string,
        parentTable: row[2] as string,
        parentColumn: row[4] as string,
        onUpdate: row[5] as ForeignKeyAction,
        onDelete: row[6] as ForeignKeyAction,
        match: row[7] as string,
      }));
  } catch {
    // Table might not exist yet or other error - proceed anyway
  }

  const hasSelfRefFk = hasSelfReferencialForeignKeys(plan.tableName, selfReferentialFkInfo);

  try {
    // Get row count before rebuild for verification
    const countResult = await engine.query(
      `SELECT COUNT(*) as cnt FROM ${quoteIdentifier(plan.tableName)}`
    );
    rowCountBefore = countResult.rows[0]?.[0] as number ?? 0;

    // Check current FK state
    const fkResult = await engine.query('PRAGMA foreign_keys');
    fkWasEnabled = (fkResult.rows[0]?.[0] as number) === 1;

    // Execute each operation
    for (const op of plan.operations) {
      if (op.sql) {
        // Handle special operations
        if (op.type === 'begin_transaction') {
          await engine.exec(op.sql);
          inTransaction = true;
          executedOperations.push(op.type);
        } else if (op.type === 'commit_transaction') {
          // Before committing, run post-rebuild verification
          // This allows us to rollback if verification fails
          const preCommitFailures = await runPreCommitVerification(
            engine,
            plan,
            verificationOptions
          );

          if (preCommitFailures.length > 0) {
            verificationFailures.push(...preCommitFailures);
            throw new Error(
              `Post-rebuild verification failed: ${formatVerificationErrors(preCommitFailures)}`
            );
          }

          await engine.exec(op.sql);
          inTransaction = false;
          executedOperations.push(op.type);
        } else if (op.type === 'fk_check') {
          // FK check returns rows if there are violations
          const violations = await engine.query(op.sql);
          if (violations.rows.length > 0) {
            // For self-referential FKs, this might be expected during rebuild
            // But we still report it as an error
            const fkFailures = await verifyForeignKeyIntegrity(engine, plan.tableName);
            if (fkFailures.length > 0) {
              verificationFailures.push(...fkFailures);
              if (hasSelfRefFk) {
                throw new Error(
                  `Foreign key violations detected (table has self-referential FK): ${violations.rows.length} violation(s). ` +
                  `Self-referential FKs require special handling.`
                );
              }
              throw new Error(
                `Foreign key violations detected: ${violations.rows.length} violation(s)`
              );
            }
          }
          executedOperations.push(op.type);
        } else {
          // Regular SQL execution
          await engine.exec(op.sql);
          executedOperations.push(op.type);
        }
      }
    }

    // Get row count after rebuild for verification
    const countAfterResult = await engine.query(
      `SELECT COUNT(*) as cnt FROM ${quoteIdentifier(plan.tableName)}`
    );
    rowCountAfter = countAfterResult.rows[0]?.[0] as number ?? 0;

    return {
      success: true,
      rowCountBefore,
      rowCountAfter,
      executedOperations,
    };
  } catch (err) {
    // Rollback if in transaction
    if (inTransaction) {
      try {
        await engine.exec('ROLLBACK');
      } catch {
        // Ignore rollback errors - original error is more important
      }
    }

    // Re-enable foreign keys if they were enabled before
    if (fkWasEnabled) {
      try {
        await engine.exec('PRAGMA foreign_keys = ON');
      } catch {
        // Ignore - best effort
      }
    }

    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      rowCountBefore,
      rowCountAfter,
      executedOperations,
      error: message,
      verificationFailures: verificationFailures.length > 0 ? verificationFailures : undefined,
    };
  }
}
