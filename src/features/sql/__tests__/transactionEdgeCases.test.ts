/**
 * Tests for transaction edge case handling per PRD:
 * - BEGIN without COMMIT: auto-rollback with warning
 * - COMMIT without BEGIN: show SQLite error, stop execution
 * - Clear transaction state on errors
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DatabaseEngine, ExecResult } from '../../../core/engine/db-engine';
import type { QueryResult } from '../../../types';
import {
  createTransactionTracker,
  executeWithTransactionTracking,
  type TransactionTracker,
} from '../transactionTracker';

describe('Transaction Edge Cases', () => {
  let mockEngine: DatabaseEngine;
  let execCalls: string[];
  let tracker: TransactionTracker;

  const mockExecResult: ExecResult = {
    rowsAffected: 0,
    lastInsertId: 0,
  };

  const mockQueryResult: QueryResult = {
    columns: ['result'],
    columnTypes: ['INTEGER'],
    rows: [[1]],
    rowsAffected: 0,
  };

  beforeEach(() => {
    execCalls = [];
    // Simple mock that records calls and returns success by default
    // Tests that need error behavior configure the mock themselves
    mockEngine = {
      exec: vi.fn().mockImplementation((sql: string) => {
        execCalls.push(sql);
        return Promise.resolve(mockExecResult);
      }),
      query: vi.fn().mockResolvedValue(mockQueryResult),
    } as unknown as DatabaseEngine;

    tracker = createTransactionTracker();
  });

  describe('Transaction Tracker State', () => {
    it('starts with no active transaction', () => {
      expect(tracker.isInTransaction()).toBe(false);
      expect(tracker.getDepth()).toBe(0);
    });

    it('tracks BEGIN as starting a transaction', () => {
      tracker.handleStatement('BEGIN');
      expect(tracker.isInTransaction()).toBe(true);
      expect(tracker.getDepth()).toBe(1);
    });

    it('tracks BEGIN TRANSACTION variant', () => {
      tracker.handleStatement('BEGIN TRANSACTION');
      expect(tracker.isInTransaction()).toBe(true);
    });

    it('tracks COMMIT as ending a transaction', () => {
      tracker.handleStatement('BEGIN');
      tracker.handleStatement('COMMIT');
      expect(tracker.isInTransaction()).toBe(false);
      expect(tracker.getDepth()).toBe(0);
    });

    it('tracks ROLLBACK as ending a transaction', () => {
      tracker.handleStatement('BEGIN');
      tracker.handleStatement('ROLLBACK');
      expect(tracker.isInTransaction()).toBe(false);
    });

    it('handles nested SAVEPOINTs', () => {
      tracker.handleStatement('BEGIN');
      tracker.handleStatement('SAVEPOINT sp1');
      expect(tracker.getDepth()).toBe(2);
      tracker.handleStatement('RELEASE sp1');
      expect(tracker.getDepth()).toBe(1);
      expect(tracker.isInTransaction()).toBe(true);
    });

    it('clears state on reset', () => {
      tracker.handleStatement('BEGIN');
      tracker.handleStatement('SAVEPOINT sp1');
      tracker.reset();
      expect(tracker.isInTransaction()).toBe(false);
      expect(tracker.getDepth()).toBe(0);
    });
  });

  describe('BEGIN without COMMIT (orphan transaction)', () => {
    it('detects orphan BEGIN when execution ends with active transaction', async () => {
      const result = await executeWithTransactionTracking(
        mockEngine,
        'BEGIN; INSERT INTO t VALUES (1)',
        tracker
      );

      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0].type).toBe('orphan_begin');
      expect(result.warnings[0].message).toContain('auto-rollback');
    });

    it('auto-rolls back orphan transaction', async () => {
      await executeWithTransactionTracking(
        mockEngine,
        'BEGIN; INSERT INTO t VALUES (1)',
        tracker
      );

      expect(execCalls).toContain('ROLLBACK');
    });

    it('clears transaction state after orphan rollback', async () => {
      await executeWithTransactionTracking(
        mockEngine,
        'BEGIN; INSERT INTO t VALUES (1)',
        tracker
      );

      expect(tracker.isInTransaction()).toBe(false);
    });

    it('does not warn when BEGIN is followed by COMMIT', async () => {
      const result = await executeWithTransactionTracking(
        mockEngine,
        'BEGIN; INSERT INTO t VALUES (1); COMMIT',
        tracker
      );

      expect(result.warnings.filter(w => w.type === 'orphan_begin')).toHaveLength(0);
    });

    it('does not warn when BEGIN is followed by ROLLBACK', async () => {
      const result = await executeWithTransactionTracking(
        mockEngine,
        'BEGIN; INSERT INTO t VALUES (1); ROLLBACK',
        tracker
      );

      expect(result.warnings.filter(w => w.type === 'orphan_begin')).toHaveLength(0);
    });
  });

  describe('COMMIT without BEGIN', () => {
    it('propagates SQLite error when COMMIT is issued without active transaction', async () => {
      // Configure mock to fail on COMMIT without transaction (as SQLite does)
      mockEngine.exec = vi.fn().mockImplementation((sql: string) => {
        execCalls.push(sql);
        const normalized = sql.trim().toUpperCase();
        if (normalized === 'COMMIT' || normalized.startsWith('COMMIT ')) {
          return Promise.reject(new Error('cannot commit - no transaction is active'));
        }
        return Promise.resolve(mockExecResult);
      });

      await expect(
        executeWithTransactionTracking(mockEngine, 'COMMIT', tracker)
      ).rejects.toThrow('cannot commit - no transaction is active');
    });

    it('stops execution after COMMIT without BEGIN fails', async () => {
      // First statement is orphan COMMIT (fails), second should not run
      mockEngine.exec = vi.fn().mockImplementation((sql: string) => {
        execCalls.push(sql);
        const normalized = sql.trim().toUpperCase();
        if (normalized === 'COMMIT' || normalized.startsWith('COMMIT ')) {
          return Promise.reject(new Error('cannot commit - no transaction is active'));
        }
        return Promise.resolve(mockExecResult);
      });

      try {
        await executeWithTransactionTracking(
          mockEngine,
          'COMMIT; INSERT INTO t VALUES (1)',
          tracker
        );
      } catch {
        // Expected
      }

      // Only COMMIT should have been called, not INSERT
      expect(execCalls.some(c => c.trim().toUpperCase().startsWith('COMMIT'))).toBe(true);
      expect(execCalls.some(c => c.includes('INSERT'))).toBe(false);
    });

    it('transaction tracker state unchanged after COMMIT without BEGIN fails', async () => {
      mockEngine.exec = vi.fn().mockImplementation((sql: string) => {
        execCalls.push(sql);
        const normalized = sql.trim().toUpperCase();
        if (normalized === 'COMMIT' || normalized.startsWith('COMMIT ')) {
          return Promise.reject(new Error('cannot commit - no transaction is active'));
        }
        return Promise.resolve(mockExecResult);
      });

      expect(tracker.isInTransaction()).toBe(false);

      try {
        await executeWithTransactionTracking(mockEngine, 'COMMIT', tracker);
      } catch {
        // Expected
      }

      // State should still be not in transaction (was already false)
      expect(tracker.isInTransaction()).toBe(false);
    });
  });

  describe('Error propagation and execution halting', () => {
    it('propagates errors from the database engine', async () => {
      // Configure mock to fail on specific INSERT statement
      mockEngine.exec = vi.fn().mockImplementation((sql: string) => {
        execCalls.push(sql);
        if (sql.includes('fail_table')) {
          return Promise.reject(new Error('simulated database error'));
        }
        return Promise.resolve(mockExecResult);
      });

      await expect(
        executeWithTransactionTracking(mockEngine, 'INSERT INTO fail_table VALUES (1)', tracker)
      ).rejects.toThrow('simulated database error');
    });

    it('stops execution after first error (no subsequent statements run)', async () => {
      // First statement fails, second should not run
      mockEngine.exec = vi.fn().mockImplementation((sql: string) => {
        execCalls.push(sql);
        if (sql.includes('first_table')) {
          return Promise.reject(new Error('first statement failed'));
        }
        return Promise.resolve(mockExecResult);
      });

      try {
        await executeWithTransactionTracking(
          mockEngine,
          'INSERT INTO first_table VALUES (1); INSERT INTO second_table VALUES (1)',
          tracker
        );
      } catch {
        // Expected
      }

      // Only first_table insert should have been called, not second_table
      expect(execCalls.some(c => c.includes('first_table'))).toBe(true);
      expect(execCalls.some(c => c.includes('second_table'))).toBe(false);
    });

    it('clears transaction state when error occurs during transaction', async () => {
      mockEngine.exec = vi.fn().mockImplementation((sql: string) => {
        execCalls.push(sql);
        if (sql.includes('fail_table')) {
          return Promise.reject(new Error('statement failed'));
        }
        return Promise.resolve(mockExecResult);
      });

      try {
        await executeWithTransactionTracking(
          mockEngine,
          'BEGIN; INSERT INTO fail_table VALUES (1)',
          tracker
        );
      } catch {
        // Expected
      }

      // Transaction state should be cleared
      expect(tracker.isInTransaction()).toBe(false);
      // ROLLBACK should have been issued
      expect(execCalls).toContain('ROLLBACK');
    });
  });

  describe('Clear transaction state on errors', () => {
    it('clears transaction state when statement fails', async () => {
      mockEngine.exec = vi.fn().mockImplementation((sql: string) => {
        execCalls.push(sql);
        const normalized = sql.trim().toUpperCase();
        if (normalized.startsWith('INSERT')) {
          return Promise.reject(new Error('UNIQUE constraint failed'));
        }
        return Promise.resolve(mockExecResult);
      });

      tracker.handleStatement('BEGIN');
      expect(tracker.isInTransaction()).toBe(true);

      try {
        await executeWithTransactionTracking(mockEngine, 'INSERT INTO t VALUES (1)', tracker);
      } catch {
        // Expected
      }

      // Transaction state should be cleared after error
      expect(tracker.isInTransaction()).toBe(false);
    });

    it('issues ROLLBACK on error within explicit transaction', async () => {
      mockEngine.exec = vi.fn().mockImplementation((sql: string) => {
        execCalls.push(sql);
        if (sql.trim().toUpperCase().startsWith('INSERT')) {
          return Promise.reject(new Error('constraint failed'));
        }
        return Promise.resolve(mockExecResult);
      });

      try {
        await executeWithTransactionTracking(
          mockEngine,
          'BEGIN; INSERT INTO t VALUES (1)',
          tracker
        );
      } catch {
        // Expected
      }

      expect(execCalls).toContain('ROLLBACK');
      expect(tracker.isInTransaction()).toBe(false);
    });
  });

  describe('Session-level transaction tracking', () => {
    it('maintains transaction state across multiple execute calls', async () => {
      // First call starts transaction (disable auto-rollback for session mode)
      await executeWithTransactionTracking(mockEngine, 'BEGIN', tracker, { autoRollbackOrphan: false });
      expect(tracker.isInTransaction()).toBe(true);

      // Second call inserts within transaction
      await executeWithTransactionTracking(mockEngine, 'INSERT INTO t VALUES (1)', tracker, { autoRollbackOrphan: false });
      expect(tracker.isInTransaction()).toBe(true);

      // Third call commits
      await executeWithTransactionTracking(mockEngine, 'COMMIT', tracker, { autoRollbackOrphan: false });
      expect(tracker.isInTransaction()).toBe(false);
    });

    it('warns about orphan transaction on session end', () => {
      tracker.handleStatement('BEGIN');

      const warnings = tracker.checkForOrphanTransaction();

      expect(warnings).toHaveLength(1);
      expect(warnings[0].type).toBe('orphan_begin');
    });
  });
});
