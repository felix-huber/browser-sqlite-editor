/**
 * Main-thread client for communicating with the SQLite database worker
 *
 * Provides a Promise-based API for sending requests to the worker
 * and receiving typed responses with proper error handling.
 */

import type {
  WorkerRequest,
  WorkerResponse,
  WorkerErrorCode,
  TableDefinitionInput,
  AlterTableActionInput,
  ColumnRenameInput,
  SchemaModificationErrorInfo,
  QueryResult,
  SchemaInfo,
  TableInfo,
  ForeignKeyInfo,
  DatabaseRegistry,
  StorageMode,
} from '../../types';
import type { TransactionWarning } from '../../features/sql/transactionTracker';

// =============================================================================
// Error Types
// =============================================================================

/**
 * Error thrown when a worker request fails
 */
export class WorkerError extends Error {
  constructor(
    message: string,
    public readonly code: WorkerErrorCode = 'UNKNOWN'
  ) {
    super(message);
    this.name = 'WorkerError';
  }
}

/**
 * Error thrown when a request times out
 */
export class WorkerTimeoutError extends WorkerError {
  constructor(message = 'Worker request timed out') {
    super(message, 'UNKNOWN');
    this.name = 'WorkerTimeoutError';
  }
}

/**
 * Error thrown when the worker crashes or terminates unexpectedly
 */
export class WorkerCrashError extends WorkerError {
  constructor(message = 'Worker terminated unexpectedly') {
    super(message, 'UNKNOWN');
    this.name = 'WorkerCrashError';
  }
}

// =============================================================================
// Message Types (Internal)
// =============================================================================

/**
 * Extended request with correlation ID for response matching
 */
interface TaggedRequest {
  id: number;
  request: WorkerRequest;
}

/**
 * Extended response with correlation ID
 */
type TaggedResponse = WorkerResponse & { id?: number };

/**
 * Pending request tracking
 */
interface PendingRequest<T> {
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
  requestType: WorkerRequest['type'];
}

// =============================================================================
// Worker Client
// =============================================================================

/**
 * Configuration options for WorkerClient
 */
export interface WorkerClientOptions {
  /** Default timeout for requests in milliseconds (default: 30000) */
  timeout?: number;
  /** Worker instance (optional, for testing) */
  worker?: Worker;
}

/**
 * Client for communicating with the database worker
 *
 * Manages request/response correlation, timeouts, and error handling.
 */
export class WorkerClient {
  private worker: Worker | null = null;
  private nextRequestId = 1;
  private pendingRequests = new Map<number, PendingRequest<unknown>>();
  private defaultTimeout: number;
  private isTerminated = false;

  constructor(options: WorkerClientOptions = {}) {
    this.defaultTimeout = options.timeout ?? 30000;

    if (options.worker) {
      this.worker = options.worker;
      this.setupEventListeners();
    }
  }

  /**
   * Initialize the worker client with a worker instance
   */
  init(worker: Worker): void {
    if (this.worker) {
      this.terminate();
    }
    this.worker = worker;
    this.isTerminated = false;
    this.setupEventListeners();
  }

  /**
   * Check if the worker is initialized and ready
   */
  isReady(): boolean {
    return this.worker !== null && !this.isTerminated;
  }

  /**
   * Set up event listeners for the worker
   */
  private setupEventListeners(): void {
    if (!this.worker) return;

    this.worker.onmessage = (event: MessageEvent<TaggedResponse>) => {
      this.handleMessage(event.data);
    };

    this.worker.onmessageerror = () => {
      this.handleMessageError();
    };

    this.worker.onerror = (event: ErrorEvent) => {
      this.handleError(event);
    };
  }

  /**
   * Handle incoming messages from the worker
   */
  private handleMessage(response: TaggedResponse): void {
    const id = response.id;

    // Broadcast messages (no id) are events like 'storageFull' or 'persistenceDegraded'
    if (id === undefined) {
      // These are broadcast events, not responses to requests
      // They can be handled via a separate event listener pattern if needed
      return;
    }

    const pending = this.pendingRequests.get(id);
    if (!pending) {
      // Response for unknown request (already timed out or canceled)
      return;
    }

    clearTimeout(pending.timeoutId);
    this.pendingRequests.delete(id);

    // Handle the response based on type
    if (response.type === 'error') {
      pending.reject(new WorkerError(response.message, response.code));
    } else {
      pending.resolve(response);
    }
  }

  /**
   * Handle worker errors
   */
  private handleError(event: ErrorEvent): void {
    if (this.isTerminated) return;

    this.isTerminated = true;
    // Reject all pending requests
    const error = new WorkerCrashError(event.message || 'Worker error');
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timeoutId);
      this.pendingRequests.delete(id);
      pending.reject(error);
    }

    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }

  /**
   * Handle worker message serialization errors
   */
  private handleMessageError(): void {
    if (this.isTerminated) return;

    this.isTerminated = true;
    const error = new WorkerCrashError('Worker message error');
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timeoutId);
      this.pendingRequests.delete(id);
      pending.reject(error);
    }

    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }

  /**
   * Send a request to the worker and wait for a response
   */
  async request<T extends WorkerResponse>(
    req: WorkerRequest,
    timeout?: number
  ): Promise<T> {
    if (!this.worker || this.isTerminated) {
      throw new WorkerError('Worker not initialized');
    }

    const id = this.nextRequestId++;
    const timeoutMs = timeout ?? this.defaultTimeout;

    return new Promise<T>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(id);
        try {
          this.worker?.postMessage({ id: 0, request: { type: 'cancel' } });
        } catch {
          // Best-effort cancel
        }
        reject(new WorkerTimeoutError(`Worker request timed out: ${req.type}`));
      }, timeoutMs);

      this.pendingRequests.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timeoutId,
        requestType: req.type,
      });

      const taggedRequest: TaggedRequest = { id, request: req };
      try {
        this.worker!.postMessage(taggedRequest);
      } catch (err) {
        clearTimeout(timeoutId);
        this.pendingRequests.delete(id);
        const error =
          err instanceof Error ? err : new WorkerError(`Worker request failed: ${String(err)}`);
        reject(error);
      }
    });
  }

  // =============================================================================
  // High-Level API Methods
  // =============================================================================

  /**
   * Execute a SELECT query and return results
   */
  async query(
    sql: string,
    params?: unknown[],
    options?: { limit?: number; offset?: number }
  ): Promise<QueryResult & { transactionWarnings?: TransactionWarning[] }> {
    const response = await this.request<{
      type: 'queryResult';
      result: QueryResult;
      transactionWarnings?: TransactionWarning[];
    }>({
      type: 'query',
      sql,
      params,
      limit: options?.limit,
      offset: options?.offset,
    });
    return {
      ...response.result,
      transactionWarnings: response.transactionWarnings,
    };
  }

  /**
   * Execute an INSERT/UPDATE/DELETE/DDL statement
   * @param skipAutoRollback If true, disables auto-rollback of orphan transactions.
   *                         Used for programmatic transactions spanning multiple calls.
   */
  async exec(
    sql: string,
    params?: unknown[],
    options?: { skipAutoRollback?: boolean }
  ): Promise<{ rowsAffected?: number; transactionWarnings?: TransactionWarning[] }> {
    const response = await this.request<{
      type: 'success';
      data?: {
        rowsAffected?: number;
        transactionWarnings?: TransactionWarning[];
      };
    }>({
      type: 'exec',
      sql,
      params,
      skipAutoRollback: options?.skipAutoRollback,
    });
    const data = response.data;
    return {
      rowsAffected: data?.rowsAffected,
      transactionWarnings: data?.transactionWarnings,
    };
  }

  /**
   * Helper for schema modification requests that return schemaModificationResult
   */
  private async requestSchemaModification(req: WorkerRequest): Promise<void> {
    const response = await this.request<{
      type: 'schemaModificationResult';
      success: boolean;
      error?: SchemaModificationErrorInfo;
    }>(req);

    if (!response.success) {
      const message = response.error?.message ?? 'Schema modification failed';
      const code = response.error?.code ?? 'UNKNOWN';
      throw new WorkerError(message, code);
    }
  }

  /**
   * Get the schema for the current database
   */
  async getSchema(): Promise<SchemaInfo> {
    const response = await this.request<{ type: 'schemaResult'; schema: SchemaInfo }>({
      type: 'schema',
    });
    return response.schema;
  }

  /**
   * Get detailed info about a table
   */
  async getTableInfo(table: string): Promise<TableInfo> {
    const response = await this.request<{ type: 'tableInfoResult'; tableInfo: TableInfo }>({
      type: 'tableInfo',
      table,
    });
    return response.tableInfo;
  }

  /**
   * Get all foreign keys in the database
   */
  async getForeignKeys(): Promise<ForeignKeyInfo[]> {
    const response = await this.request<{ type: 'foreignKeysResult'; foreignKeys: ForeignKeyInfo[] }>({
      type: 'foreignKeys',
    });
    return response.foreignKeys;
  }

  /**
   * Get the database registry
   */
  async getRegistry(): Promise<DatabaseRegistry> {
    const response = await this.request<{ type: 'registryResult'; registry: DatabaseRegistry }>({
      type: 'getRegistry',
    });
    return response.registry;
  }

  /**
   * Open a database by name
   */
  async openDb(
    name: string,
    options?: { readOnly?: boolean }
  ): Promise<{ isWriter: boolean }> {
    const request: WorkerRequest = {
      type: 'open',
      dbName: name,
      ...(options?.readOnly !== undefined ? { readOnly: options.readOnly } : {}),
    };
    const response = await this.request<{ type: 'lockStatus'; isWriter: boolean }>(request);
    return { isWriter: response.isWriter };
  }

  /**
   * Close the current database
   */
  async closeDb(): Promise<void> {
    await this.request<{ type: 'success' }>({ type: 'close' });
  }

  /**
   * Create a new database
   */
  async createDb(name: string): Promise<void> {
    await this.request<{ type: 'success' }>({ type: 'createDb', name });
  }

  /**
   * Delete a database
   */
  async deleteDb(name: string): Promise<void> {
    await this.request<{ type: 'success' }>({ type: 'deleteDb', name });
  }

  /**
   * Rename a database
   */
  async renameDb(oldName: string, newName: string): Promise<void> {
    await this.request<{ type: 'success' }>({ type: 'renameDb', oldName, newName });
  }

  /**
   * Get the size of a database in bytes
   */
  async getDbSize(dbName: string): Promise<{ sizeBytes: number; storageMode: 'opfs' | 'idb' }> {
    const response = await this.request<{ type: 'dbSizeResult'; sizeBytes: number; storageMode: 'opfs' | 'idb' }>({
      type: 'getDbSize',
      dbName,
    });
    return { sizeBytes: response.sizeBytes, storageMode: response.storageMode };
  }

  /**
   * Acquire write lock for a database
   */
  async acquireLock(dbName: string): Promise<{ isWriter: boolean; holderStale?: boolean }> {
    const response = await this.request<{ type: 'lockStatus'; isWriter: boolean; holderStale?: boolean }>({
      type: 'acquireLock',
      dbName,
    });
    return { isWriter: response.isWriter, holderStale: response.holderStale };
  }

  /**
   * Release the current write lock
   */
  async releaseLock(): Promise<void> {
    await this.request<{ type: 'success' }>({ type: 'releaseLock' });
  }

  /**
   * Check lock status for a database
   */
  async checkLock(dbName: string): Promise<{ isWriter: boolean; holderStale?: boolean }> {
    const response = await this.request<{ type: 'lockStatus'; isWriter: boolean; holderStale?: boolean }>({
      type: 'checkLock',
      dbName,
    });
    return { isWriter: response.isWriter, holderStale: response.holderStale };
  }

  /**
   * Cancel a running query
   */
  async cancel(): Promise<void> {
    await this.request<{ type: 'success' }>({ type: 'cancel' });
  }

  /**
   * Ping the worker to check if it's alive
   */
  async ping(): Promise<void> {
    await this.request<{ type: 'pong' }>({ type: 'ping' });
  }

  /**
   * Flush pending snapshot (for IndexedDB mode)
   */
  async flushSnapshot(): Promise<void> {
    await this.request<{ type: 'success' }>({ type: 'flushSnapshot' });
  }

  /**
   * Import a file into the database
   */
  async importFile(
    file: File,
    nameHint: string
  ): Promise<{ dbId: string; dbName: string; storageType: StorageMode; fileSize: number }> {
    const response = await this.request<{
      type: 'success';
      data?: { dbId: string; dbName: string; storageType: StorageMode; fileSize: number };
    }>({ type: 'import', file, nameHint });

    if (!response.data) {
      throw new WorkerError('Import completed without result data');
    }

    return response.data;
  }

  /**
   * Export a database to a file
   */
  async exportDb(dbName: string): Promise<Blob> {
    const response = await this.request<{ type: 'success'; data: Blob }>({
      type: 'export',
      dbName,
    });
    if (!response.data) {
      throw new WorkerError('Export failed: no data returned', 'UNKNOWN');
    }
    return response.data;
  }

  /**
   * Create a table
   */
  async createTable(def: TableDefinitionInput, isReadOnly = false): Promise<void> {
    await this.requestSchemaModification({ type: 'createTable', def, isReadOnly });
  }

  /**
   * Alter an existing table
   */
  async alterTable(
    table: string,
    action: AlterTableActionInput,
    isReadOnly = false
  ): Promise<void> {
    await this.requestSchemaModification({ type: 'alterTable', table, action, isReadOnly });
  }

  /**
   * Drop a table
   */
  async dropTable(table: string, isReadOnly = false): Promise<void> {
    await this.requestSchemaModification({ type: 'dropTable', table, isReadOnly });
  }

  /**
   * Drop a column
   */
  async dropColumn(table: string, column: string, isReadOnly = false): Promise<void> {
    await this.requestSchemaModification({ type: 'dropColumn', table, column, isReadOnly });
  }

  /**
   * Rebuild a table with a new schema
   */
  async rebuildTable(
    payload: {
      table: string;
      newCreateSql: string;
      newColumns: string[];
      columnRenames?: ColumnRenameInput[];
    },
    isReadOnly = false
  ): Promise<void> {
    await this.requestSchemaModification({
      type: 'rebuildTable',
      table: payload.table,
      newCreateSql: payload.newCreateSql,
      newColumns: payload.newColumns,
      columnRenames: payload.columnRenames,
      isReadOnly,
    });
  }

  /**
   * Terminate the worker and reject all pending requests
   */
  terminate(): void {
    if (this.isTerminated) return;

    this.isTerminated = true;

    // Reject all pending requests
    const error = new WorkerCrashError('Worker terminated');
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timeoutId);
      this.pendingRequests.delete(id);
      pending.reject(error);
    }

    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }

  /**
   * Get the number of pending requests (for testing/debugging)
   */
  getPendingCount(): number {
    return this.pendingRequests.size;
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let clientInstance: WorkerClient | null = null;

/**
 * Get the singleton WorkerClient instance
 */
export function getWorkerClient(): WorkerClient {
  if (!clientInstance) {
    clientInstance = new WorkerClient();
  }
  return clientInstance;
}
