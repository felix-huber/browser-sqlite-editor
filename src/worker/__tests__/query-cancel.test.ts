/**
 * Unit tests for query cancellation module
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  registerQuery,
  requestCancellation,
  isCancellationRequested,
  isQueryActive,
  getCurrentRequestId,
  setDefaultAutoTimeout,
  getDefaultAutoTimeout,
  clearAllQueries,
  getActiveQueryCount,
  progressHandlerCallback,
  isInterruptError,
  mapInterruptError,
  SQLITE_INTERRUPT,
} from '../query-cancel';

describe('Query Cancellation - Registration', () => {
  beforeEach(() => {
    clearAllQueries();
    setDefaultAutoTimeout(0);
  });

  it('should register a query and mark it as active', () => {
    const cleanup = registerQuery('req-1');

    expect(isQueryActive('req-1')).toBe(true);
    expect(getCurrentRequestId()).toBe('req-1');
    expect(getActiveQueryCount()).toBe(1);

    cleanup();
  });

  it('should cleanup query on returned cleanup function call', () => {
    const cleanup = registerQuery('req-1');

    expect(isQueryActive('req-1')).toBe(true);

    cleanup();

    expect(isQueryActive('req-1')).toBe(false);
    expect(getCurrentRequestId()).toBeNull();
    expect(getActiveQueryCount()).toBe(0);
  });

  it('should handle multiple concurrent queries', () => {
    const cleanup1 = registerQuery('req-1');
    const cleanup2 = registerQuery('req-2');

    expect(isQueryActive('req-1')).toBe(true);
    expect(isQueryActive('req-2')).toBe(true);
    expect(getCurrentRequestId()).toBe('req-2'); // Most recent
    expect(getActiveQueryCount()).toBe(2);

    cleanup1();

    expect(isQueryActive('req-1')).toBe(false);
    expect(isQueryActive('req-2')).toBe(true);
    expect(getActiveQueryCount()).toBe(1);

    cleanup2();

    expect(getActiveQueryCount()).toBe(0);
  });
});

describe('Query Cancellation - Cancel Requests', () => {
  beforeEach(() => {
    clearAllQueries();
    setDefaultAutoTimeout(0);
  });

  it('should request cancellation by requestId', async () => {
    const cleanup = registerQuery('req-1');

    expect(isCancellationRequested('req-1')).toBe(false);

    await requestCancellation('req-1');

    expect(isCancellationRequested('req-1')).toBe(true);

    cleanup();
  });

  it('should cancel current query when no requestId provided', async () => {
    const cleanup = registerQuery('req-1');

    expect(isCancellationRequested()).toBe(false);

    await requestCancellation();

    expect(isCancellationRequested()).toBe(true);
    expect(isCancellationRequested('req-1')).toBe(true);

    cleanup();
  });

  it('should be a no-op when canceling non-existent requestId', async () => {
    const cleanup = registerQuery('req-1');

    // Should not throw
    await expect(requestCancellation('req-999')).resolves.toBeUndefined();

    // Original query should not be affected
    expect(isCancellationRequested('req-1')).toBe(false);

    cleanup();
  });

  it('should be a no-op when no queries are active', async () => {
    // Should not throw
    await expect(requestCancellation()).resolves.toBeUndefined();
    await expect(requestCancellation('any-id')).resolves.toBeUndefined();
  });

  it('should be a no-op when canceling already-completed query', async () => {
    const cleanup = registerQuery('req-1');
    cleanup(); // Query completed

    // Should not throw
    await expect(requestCancellation('req-1')).resolves.toBeUndefined();
  });

  it('should cancel specific query when multiple are active', async () => {
    const cleanup1 = registerQuery('req-1');
    const cleanup2 = registerQuery('req-2');

    await requestCancellation('req-1');

    expect(isCancellationRequested('req-1')).toBe(true);
    expect(isCancellationRequested('req-2')).toBe(false);

    cleanup1();
    cleanup2();
  });
});

describe('Query Cancellation - Auto-Timeout', () => {
  beforeEach(() => {
    clearAllQueries();
    setDefaultAutoTimeout(0);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should auto-cancel after timeout expires', () => {
    setDefaultAutoTimeout(1000);
    const cleanup = registerQuery('req-1');

    expect(isCancellationRequested('req-1')).toBe(false);

    vi.advanceTimersByTime(999);
    expect(isCancellationRequested('req-1')).toBe(false);

    vi.advanceTimersByTime(2);
    expect(isCancellationRequested('req-1')).toBe(true);

    cleanup();
  });

  it('should use per-query timeout over default', () => {
    setDefaultAutoTimeout(5000);
    const cleanup = registerQuery('req-1', 100);

    vi.advanceTimersByTime(50);
    expect(isCancellationRequested('req-1')).toBe(false);

    vi.advanceTimersByTime(51);
    expect(isCancellationRequested('req-1')).toBe(true);

    cleanup();
  });

  it('should not auto-cancel when timeout is 0', () => {
    setDefaultAutoTimeout(0);
    const cleanup = registerQuery('req-1');

    vi.advanceTimersByTime(1000000);
    expect(isCancellationRequested('req-1')).toBe(false);

    cleanup();
  });

  it('should get and set default auto-timeout', () => {
    expect(getDefaultAutoTimeout()).toBe(0);

    setDefaultAutoTimeout(5000);
    expect(getDefaultAutoTimeout()).toBe(5000);

    setDefaultAutoTimeout(-100); // Should clamp to 0
    expect(getDefaultAutoTimeout()).toBe(0);
  });
});

describe('Query Cancellation - Progress Handler', () => {
  beforeEach(() => {
    clearAllQueries();
    setDefaultAutoTimeout(0);
  });

  it('should return 0 when no cancellation requested', () => {
    const cleanup = registerQuery('req-1');

    expect(progressHandlerCallback()).toBe(0);

    cleanup();
  });

  it('should return 1 when cancellation requested', async () => {
    const cleanup = registerQuery('req-1');

    await requestCancellation('req-1');

    expect(progressHandlerCallback()).toBe(1);

    cleanup();
  });

  it('should return 0 when no query is active', () => {
    expect(progressHandlerCallback()).toBe(0);
  });
});

describe('Query Cancellation - Error Mapping', () => {
  it('should identify SQLITE_INTERRUPT error code', () => {
    expect(SQLITE_INTERRUPT).toBe(9);
    expect(isInterruptError(9)).toBe(true);
    expect(isInterruptError(0)).toBe(false);
    expect(isInterruptError(1)).toBe(false);
    expect(isInterruptError(19)).toBe(false); // SQLITE_CONSTRAINT
  });

  it('should map SQLITE_INTERRUPT to CANCELED code', () => {
    expect(mapInterruptError(9)).toBe('CANCELED');
    expect(mapInterruptError(0)).toBeUndefined();
    expect(mapInterruptError(1)).toBeUndefined();
  });
});

describe('Query Cancellation - Timing Requirements', () => {
  beforeEach(() => {
    clearAllQueries();
    setDefaultAutoTimeout(0);
  });

  it('should handle rapid registration and cancellation', async () => {
    for (let i = 0; i < 100; i++) {
      const cleanup = registerQuery(`req-${i}`);
      await requestCancellation(`req-${i}`);
      expect(isCancellationRequested(`req-${i}`)).toBe(true);
      cleanup();
    }

    expect(getActiveQueryCount()).toBe(0);
  });

  it('should handle duplicate cancellation requests gracefully', async () => {
    const cleanup = registerQuery('req-1');

    await requestCancellation('req-1');
    await requestCancellation('req-1');
    await requestCancellation('req-1');

    expect(isCancellationRequested('req-1')).toBe(true);

    cleanup();
  });
});
