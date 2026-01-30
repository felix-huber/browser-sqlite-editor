/**
 * Schema and rebuild handlers.
 */

import type { WorkerRequest, WorkerResponse, WorkerErrorCode } from '../../types';
import { getEngine } from '../../lib/db-engine';
import { getSchemaInfo, getTableInfo, getAllForeignKeys } from '../../lib/schema';
import {
  executeRebuildPlan,
  extractTableDependents,
  generateRebuildPlanWithColumnMapping,
  type SqliteMasterObject,
} from '../../lib/rebuild';
import {
  handleCreateTable,
  handleAlterTable,
  handleDropTable,
  handleDropColumn,
} from '../schema-modification';

export type PostResponse = (response: WorkerResponse, requestId?: number) => void;

function createQueryExecutor() {
  const engine = getEngine();
  return async (sql: string, params?: unknown[]) => {
    return engine.query(sql, params);
  };
}

export async function handleSchemaRequest(
  _request: Extract<WorkerRequest, { type: 'schema' }>,
  id: number,
  postResponse: PostResponse
): Promise<void> {
  try {
    const queryExecutor = createQueryExecutor();
    const schema = await getSchemaInfo(queryExecutor);
    postResponse({ type: 'schemaResult', schema }, id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    postResponse({
      type: 'error',
      message: `Failed to get schema: ${message}`,
      code: 'UNKNOWN',
    }, id);
  }
}

export async function handleTableInfoRequest(
  request: Extract<WorkerRequest, { type: 'tableInfo' }>,
  id: number,
  postResponse: PostResponse
): Promise<void> {
  try {
    const queryExecutor = createQueryExecutor();
    const tableInfo = await getTableInfo(queryExecutor, request.table);
    postResponse({ type: 'tableInfoResult', tableInfo }, id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code = message.includes('not found') ? 'NOT_FOUND' : 'UNKNOWN';
    postResponse({
      type: 'error',
      message: `Failed to get table info: ${message}`,
      code,
    }, id);
  }
}

export async function handleForeignKeysRequest(
  _request: Extract<WorkerRequest, { type: 'foreignKeys' }>,
  id: number,
  postResponse: PostResponse
): Promise<void> {
  try {
    const queryExecutor = createQueryExecutor();
    const foreignKeys = await getAllForeignKeys(queryExecutor);
    postResponse({ type: 'foreignKeysResult', foreignKeys }, id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    postResponse({
      type: 'error',
      message: `Failed to query foreign keys: ${message}`,
      code: 'UNKNOWN',
    }, id);
  }
}

export async function handleCreateTableRequest(
  request: Extract<WorkerRequest, { type: 'createTable' }>,
  id: number,
  postResponse: PostResponse
): Promise<void> {
  try {
    const queryExecutor = createQueryExecutor();
    const result = await handleCreateTable({
      def: request.def,
      query: queryExecutor,
      isReadOnly: request.isReadOnly,
    });

    postResponse({
      type: 'schemaModificationResult',
      success: result.success,
      error: result.error
        ? {
            code: result.error.code,
            message: result.error.message,
            details: result.error.details,
          }
        : undefined,
    }, id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    postResponse({
      type: 'schemaModificationResult',
      success: false,
      error: {
        code: 'UNKNOWN',
        message: `Create table failed: ${message}`,
      },
    }, id);
  }
}

export async function handleAlterTableRequest(
  request: Extract<WorkerRequest, { type: 'alterTable' }>,
  id: number,
  postResponse: PostResponse
): Promise<void> {
  try {
    const queryExecutor = createQueryExecutor();
    const result = await handleAlterTable({
      table: request.table,
      action: request.action,
      query: queryExecutor,
      isReadOnly: request.isReadOnly,
    });

    postResponse({
      type: 'schemaModificationResult',
      success: result.success,
      error: result.error
        ? {
            code: result.error.code,
            message: result.error.message,
            details: result.error.details,
          }
        : undefined,
    }, id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    postResponse({
      type: 'schemaModificationResult',
      success: false,
      error: {
        code: 'UNKNOWN',
        message: `Alter table failed: ${message}`,
      },
    }, id);
  }
}

export async function handleDropTableRequest(
  request: Extract<WorkerRequest, { type: 'dropTable' }>,
  id: number,
  postResponse: PostResponse
): Promise<void> {
  try {
    const queryExecutor = createQueryExecutor();
    const result = await handleDropTable({
      table: request.table,
      query: queryExecutor,
      isReadOnly: request.isReadOnly,
    });

    postResponse({
      type: 'schemaModificationResult',
      success: result.success,
      error: result.error
        ? {
            code: result.error.code,
            message: result.error.message,
            details: result.error.details,
          }
        : undefined,
    }, id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    postResponse({
      type: 'schemaModificationResult',
      success: false,
      error: {
        code: 'UNKNOWN',
        message: `Drop table failed: ${message}`,
      },
    }, id);
  }
}

export async function handleDropColumnRequest(
  request: Extract<WorkerRequest, { type: 'dropColumn' }>,
  id: number,
  postResponse: PostResponse
): Promise<void> {
  try {
    const queryExecutor = createQueryExecutor();
    const result = await handleDropColumn({
      table: request.table,
      column: request.column,
      query: queryExecutor,
      isReadOnly: request.isReadOnly,
    });

    postResponse({
      type: 'schemaModificationResult',
      success: result.success,
      error: result.error
        ? {
            code: result.error.code,
            message: result.error.message,
            details: result.error.details,
          }
        : undefined,
    }, id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    postResponse({
      type: 'schemaModificationResult',
      success: false,
      error: {
        code: 'UNKNOWN',
        message: `Drop column failed: ${message}`,
      },
    }, id);
  }
}

export async function handleRebuildTableRequest(
  request: Extract<WorkerRequest, { type: 'rebuildTable' }>,
  id: number,
  postResponse: PostResponse
): Promise<void> {
  try {
    if (request.isReadOnly) {
      postResponse({
        type: 'schemaModificationResult',
        success: false,
        error: {
          code: 'READ_ONLY',
          message: 'Cannot rebuild table in read-only mode',
        },
      }, id);
      return;
    }

    const engine = getEngine();
    if (!engine.isReady()) {
      throw new Error('No database open. Please open a database first.');
    }

    const queryExecutor = createQueryExecutor();
    const tableInfo = await getTableInfo(queryExecutor, request.table);

    const masterResult = await engine.query(
      `SELECT type, name, tbl_name, rootpage, sql FROM sqlite_master`
    );

    const masterRows: SqliteMasterObject[] = masterResult.rows.map((row) => ({
      type: row[0] as SqliteMasterObject['type'],
      name: row[1] as string,
      tblName: row[2] as string,
      rootpage: typeof row[3] === 'number' ? row[3] as number : 0,
      sql: (row[4] as string | null) ?? null,
    }));

    const allForeignKeys = await getAllForeignKeys(queryExecutor);
    const foreignKeyMap = new Map<string, typeof allForeignKeys[number][]>();
    for (const fk of allForeignKeys) {
      const list = foreignKeyMap.get(fk.childTable) ?? [];
      list.push(fk);
      foreignKeyMap.set(fk.childTable, list);
    }

    const dependents = extractTableDependents(request.table, masterRows, foreignKeyMap);
    const oldColumns = tableInfo.columns.map((col) => col.name);
    const newColumns = request.newColumns.length > 0 ? request.newColumns : oldColumns;
    const renameMap =
      request.columnRenames && request.columnRenames.length > 0
        ? new Map(request.columnRenames.map((c) => [c.oldName, c.newName]))
        : undefined;

    const plan = generateRebuildPlanWithColumnMapping(
      request.table,
      request.newCreateSql,
      dependents,
      oldColumns,
      newColumns,
      renameMap
    );

    const result = await executeRebuildPlan(engine, plan, {
      expectedColumns: newColumns,
    });

    if (!result.success) {
      const message = result.error ?? 'Table rebuild failed';
      const lowerMessage = message.toLowerCase();
      const code: WorkerErrorCode =
        lowerMessage.includes('foreign key') || lowerMessage.includes('constraint')
          ? 'CONSTRAINT_VIOLATION'
          : lowerMessage.includes('not found')
            ? 'NOT_FOUND'
            : 'UNKNOWN';

      postResponse({
        type: 'schemaModificationResult',
        success: false,
        error: {
          code,
          message,
          details: result.verificationFailures
            ? result.verificationFailures.map((failure) => failure.message).join('; ')
            : undefined,
        },
      }, id);
      return;
    }

    postResponse({ type: 'schemaModificationResult', success: true }, id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    postResponse({
      type: 'schemaModificationResult',
      success: false,
      error: {
        code: 'UNKNOWN',
        message: `Rebuild table failed: ${message}`,
      },
    }, id);
  }
}
