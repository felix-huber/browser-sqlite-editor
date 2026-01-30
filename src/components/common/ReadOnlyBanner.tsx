import { useDatabaseStore, useLockHolder, useIsReadOnly, openDb } from '../../store';
import { getLockManager } from '../../worker/web-locks';
import { useState, useEffect, useCallback } from 'react';

/**
 * Stale detection threshold in milliseconds
 * Lock is considered stale if no heartbeat for this duration
 */
const STALE_THRESHOLD_MS = 10000;

/**
 * Polling interval for stale detection
 */
const STALE_CHECK_INTERVAL_MS = 1000;

/**
 * Props for ReadOnlyBanner
 */
export interface ReadOnlyBannerProps {
  /** Optional: Override stale threshold for testing */
  staleThresholdMs?: number;
}

/**
 * Banner shown when database is in read-only mode due to another tab holding the write lock.
 *
 * Features:
 * - Yellow warning banner fixed below header
 * - Shows lock holder info when available
 * - Retry button to re-attempt lock acquisition
 * - Take Over button when lock is stale (>10s no heartbeat)
 */
export function ReadOnlyBanner({ staleThresholdMs = STALE_THRESHOLD_MS }: ReadOnlyBannerProps = {}) {
  const isReadOnly = useIsReadOnly();
  const lockHolder = useLockHolder();
  const activeDbId = useDatabaseStore((state) => state.activeDbId);
  const [isStale, setIsStale] = useState(false);
  const [lockHolderInfo, setLockHolderInfo] = useState<string | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);
  const [isTakingOver, setIsTakingOver] = useState(false);

  // Check for stale locks periodically
  useEffect(() => {
    if (!isReadOnly || !activeDbId) {
      setIsStale(false);
      setLockHolderInfo(null);
      return;
    }

    const checkStale = async () => {
      const lockManager = getLockManager();
      const status = await lockManager.queryLockStatus(activeDbId);

      if (!status.isLocked && !status.isStale) {
        // Lock released and no stale signal.
        setIsStale(false);
        setLockHolderInfo(null);
        return;
      }

      setLockHolderInfo(status.holderId);

      if (status.isStale) {
        setIsStale(true);
        return;
      }

      if (status.acquiredAt) {
        const timeSinceHeartbeat = Date.now() - status.acquiredAt;
        setIsStale(timeSinceHeartbeat > staleThresholdMs);
      } else {
        // Web Locks mode - no staleness available
        setIsStale(false);
      }
    };

    // Initial check
    checkStale();

    // Periodic checks
    const interval = setInterval(checkStale, STALE_CHECK_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [isReadOnly, activeDbId, staleThresholdMs]);

  /**
   * Retry acquiring the lock
   */
  const handleRetry = useCallback(async () => {
    if (!activeDbId || isRetrying) return;

    setIsRetrying(true);
    try {
      // Re-open the database, which will attempt to acquire the lock
      await openDb(activeDbId);
    } catch (error) {
      console.error('[ReadOnlyBanner] Retry failed:', error);
    } finally {
      setIsRetrying(false);
    }
  }, [activeDbId, isRetrying]);

  /**
   * Force take over the lock (only when stale)
   */
  const handleTakeOver = useCallback(async () => {
    if (!activeDbId || !isStale || isTakingOver) return;

    setIsTakingOver(true);
    try {
      // For heartbeat-based locks, acquiring when stale will "steal" the lock
      // Re-open the database, which will attempt to acquire the lock
      await openDb(activeDbId);
    } catch (error) {
      console.error('[ReadOnlyBanner] Take over failed:', error);
    } finally {
      setIsTakingOver(false);
    }
  }, [activeDbId, isStale, isTakingOver]);

  // Don't render if not read-only
  if (!isReadOnly) {
    return null;
  }

  // Format lock holder display
  const lockHolderDisplay = lockHolderInfo
    ? `Locked by Tab ${lockHolderInfo.substring(0, 8)}...`
    : lockHolder === 'other'
      ? 'Locked by another tab'
      : null;

  return (
    <div
      className="bg-amber-50 border-b border-amber-300 px-4 py-2 flex items-center justify-between gap-4"
      role="alert"
      aria-live="polite"
      data-testid="read-only-banner"
    >
      <div className="flex items-center gap-3">
        {/* Lock icon */}
        <svg
          className="w-5 h-5 text-amber-600 shrink-0"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
          />
        </svg>

        <div className="flex flex-col">
          <span className="text-sm font-medium text-gray-900">
            Database is read-only: another tab has the write lock
          </span>
          {lockHolderDisplay && (
            <span className="text-xs text-gray-600" data-testid="lock-holder-info">
              {lockHolderDisplay}
            </span>
          )}
          {isStale && (
            <span className="text-xs text-amber-700 font-medium" data-testid="stale-warning">
              Lock appears stale (no heartbeat)
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={handleRetry}
          disabled={isRetrying}
          className="px-3 py-1.5 bg-white border border-gray-300 text-gray-700 text-sm font-medium rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          data-testid="retry-button"
        >
          {isRetrying ? 'Retrying...' : 'Retry'}
        </button>

        {isStale && (
          <button
            onClick={handleTakeOver}
            disabled={isTakingOver}
            className="px-3 py-1.5 bg-amber-600 text-white text-sm font-medium rounded hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            data-testid="take-over-button"
          >
            {isTakingOver ? 'Taking over...' : 'Take Over'}
          </button>
        )}
      </div>
    </div>
  );
}

export default ReadOnlyBanner;
