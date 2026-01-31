/**
 * Read-only mode authorizer for SQLite
 *
 * Uses SQLite's set_authorizer() to enforce read-only mode at the native level,
 * replacing string-based SQL parsing per PRD requirements.
 *
 * The authorizer callback is invoked by SQLite for each action during SQL parsing,
 * allowing us to deny write operations before they execute.
 */

import * as SQLite from '@journeyapps/wa-sqlite';

// SQLite authorizer return codes
const SQLITE_OK = 0;
const SQLITE_DENY = 1;

// Write operation action codes - these modify database state
const WRITE_OPERATIONS: Set<number> = new Set([
  SQLite.SQLITE_CREATE_INDEX,
  SQLite.SQLITE_CREATE_TABLE,
  SQLite.SQLITE_CREATE_TEMP_INDEX,
  SQLite.SQLITE_CREATE_TEMP_TABLE,
  SQLite.SQLITE_CREATE_TEMP_TRIGGER,
  SQLite.SQLITE_CREATE_TEMP_VIEW,
  SQLite.SQLITE_CREATE_TRIGGER,
  SQLite.SQLITE_CREATE_VIEW,
  SQLite.SQLITE_DELETE,
  SQLite.SQLITE_DROP_INDEX,
  SQLite.SQLITE_DROP_TABLE,
  SQLite.SQLITE_DROP_TEMP_INDEX,
  SQLite.SQLITE_DROP_TEMP_TABLE,
  SQLite.SQLITE_DROP_TEMP_TRIGGER,
  SQLite.SQLITE_DROP_TEMP_VIEW,
  SQLite.SQLITE_DROP_TRIGGER,
  SQLite.SQLITE_DROP_VIEW,
  SQLite.SQLITE_INSERT,
  SQLite.SQLITE_UPDATE,
  SQLite.SQLITE_ALTER_TABLE,
  SQLite.SQLITE_REINDEX,
  SQLite.SQLITE_CREATE_VTABLE,
  SQLite.SQLITE_DROP_VTABLE,
]);

/**
 * Check if an action code represents a write operation
 *
 * @param actionCode SQLite authorizer action code
 * @returns true if the action modifies the database
 */
export function isWriteOperation(actionCode: number): boolean {
  return WRITE_OPERATIONS.has(actionCode);
}

/**
 * Authorizer callback type matching SQLite's set_authorizer signature
 */
export type AuthorizerCallback = (
  userData: unknown,
  actionCode: number,
  param3: string | null,
  param4: string | null,
  param5: string | null,
  param6: string | null
) => number;

/**
 * Create a read-only authorizer callback
 *
 * Returns an authorizer function that denies all write operations.
 * When SQLite encounters SQLITE_DENY, it aborts the statement with
 * an "authorization denied" error.
 *
 * @returns Authorizer callback for use with set_authorizer
 */
export function createReadOnlyAuthorizer(): AuthorizerCallback {
  return (
    _userData: unknown,
    actionCode: number,
    _param3: string | null,
    _param4: string | null,
    _param5: string | null,
    _param6: string | null
  ): number => {
    if (isWriteOperation(actionCode)) {
      return SQLITE_DENY;
    }
    return SQLITE_OK;
  };
}
