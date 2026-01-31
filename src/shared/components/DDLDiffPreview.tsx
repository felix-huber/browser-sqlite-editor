/**
 * DDLDiffPreview Component
 *
 * Shared component for previewing DDL changes with diff highlighting.
 * Used by both Table Designer (P3-04) and ERD FK editor (P4-03).
 *
 * Features:
 * - Side-by-side original and proposed SQL display
 * - Syntax highlighting for SQL keywords
 * - Diff highlighting (added/removed lines)
 * - Collapsible list of dependent objects (indexes, triggers, FKs)
 * - Net effect summary
 * - Rollback error display
 */

import { useState, useMemo, memo } from 'react';

// =============================================================================
// Types
// =============================================================================

export interface DependentObject {
  type: 'index' | 'trigger' | 'foreign_key' | 'view' | 'table';
  name: string;
}

export interface DDLDiffPreviewProps {
  originalSql: string;
  proposedSql: string;
  dependentObjects: DependentObject[];
  netEffectSummary: string;
  rollbackError?: string;
  className?: string;
}

interface DiffLine {
  text: string;
  type: 'added' | 'removed' | 'unchanged';
}

// =============================================================================
// Diff Algorithm (Myers-like LCS)
// =============================================================================

/**
 * Compute LCS (Longest Common Subsequence) using dynamic programming.
 * Returns an array of indices from `a` that are part of the LCS.
 */
function computeLCS(a: string[], b: string[]): number[] {
  const m = a.length;
  const n = b.length;

  // Build DP table
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to find LCS indices in `a`
  const lcsIndices: number[] = [];
  let i = m;
  let j = n;

  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      lcsIndices.unshift(i - 1);
      i--;
      j--;
    } else if (dp[i - 1][j] > dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }

  return lcsIndices;
}

function computeLineDiff(original: string, proposed: string): { original: DiffLine[]; proposed: DiffLine[] } {
  const originalLines = original.split('\n');
  const proposedLines = proposed.split('\n');

  // Find LCS to determine which lines are unchanged
  const lcsOriginalIndices = new Set(computeLCS(originalLines, proposedLines));

  // Also compute LCS from proposed's perspective to mark unchanged in proposed
  const lcsProposedIndices = new Set(computeLCS(proposedLines, originalLines));

  const originalDiff: DiffLine[] = originalLines.map((line, idx) => ({
    text: line,
    type: lcsOriginalIndices.has(idx) ? 'unchanged' : 'removed',
  }));

  const proposedDiff: DiffLine[] = proposedLines.map((line, idx) => ({
    text: line,
    type: lcsProposedIndices.has(idx) ? 'unchanged' : 'added',
  }));

  return { original: originalDiff, proposed: proposedDiff };
}

// =============================================================================
// SQL Syntax Highlighting
// =============================================================================

const SQL_KEYWORDS = [
  'CREATE', 'TABLE', 'INDEX', 'TRIGGER', 'VIEW', 'DROP', 'ALTER', 'ADD',
  'COLUMN', 'PRIMARY', 'KEY', 'FOREIGN', 'REFERENCES', 'UNIQUE', 'NOT',
  'NULL', 'DEFAULT', 'CHECK', 'CONSTRAINT', 'ON', 'DELETE', 'UPDATE',
  'CASCADE', 'SET', 'RESTRICT', 'NO', 'ACTION', 'INTEGER', 'TEXT', 'REAL',
  'BLOB', 'NUMERIC', 'BOOLEAN', 'AUTOINCREMENT', 'IF', 'EXISTS', 'AS',
  'SELECT', 'FROM', 'WHERE', 'INSERT', 'INTO', 'VALUES', 'BEGIN', 'END',
  'AFTER', 'BEFORE', 'FOR', 'EACH', 'ROW', 'WHEN', 'COLLATE', 'ASC', 'DESC',
];

const keywordPattern = new RegExp(`\\b(${SQL_KEYWORDS.join('|')})\\b`, 'gi');

function highlightSql(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match;
  let keyIndex = 0;

  const regex = new RegExp(keywordPattern);
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    parts.push(
      <span key={`kw-${keyIndex++}`} data-testid="sql-keyword" className="text-amber-400 font-bold">
        {match[0]}
      </span>
    );
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts;
}

// =============================================================================
// Helper Components
// =============================================================================

function WarningIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
      />
    </svg>
  );
}

function ChevronIcon({ expanded, className }: { expanded: boolean; className?: string }) {
  return (
    <svg
      className={`${className} transition-transform ${expanded ? 'rotate-90' : ''}`}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
    </svg>
  );
}

function DependentObjectIcon({ type }: { type: DependentObject['type'] }) {
  const iconClasses = 'w-4 h-4 text-amber-500';

  switch (type) {
    case 'view':
      return (
        <svg className={iconClasses} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
        </svg>
      );
    case 'trigger':
      return (
        <svg className={iconClasses} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
      );
    case 'index':
      return (
        <svg className={iconClasses} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
        </svg>
      );
    case 'foreign_key':
      return (
        <svg className={iconClasses} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
        </svg>
      );
    case 'table':
      return (
        <svg className={iconClasses} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
      );
    default:
      return null;
  }
}

function formatObjectType(type: DependentObject['type']): string {
  switch (type) {
    case 'foreign_key':
      return 'Foreign key';
    default:
      return type.charAt(0).toUpperCase() + type.slice(1);
  }
}

const DiffCodeBlock = memo(function DiffCodeBlock({
  lines,
  label,
  testId,
}: {
  lines: DiffLine[];
  label: string;
  testId: string;
}) {
  return (
    <div
      data-testid={testId}
      aria-label={`${label} SQL`}
      role="region"
      className="flex-1 min-w-0"
    >
      <div className="text-xs font-medium text-navy-400 uppercase tracking-wide mb-2">
        {label}
      </div>
      <pre className="bg-navy-900 rounded-lg p-4 overflow-x-auto text-sm">
        <code className="font-mono text-navy-100">
          {lines.map((line, index) => (
            <div
              key={index}
              data-diff-type={line.type}
              className={`${
                line.type === 'added'
                  ? 'bg-green-900/30 text-green-300'
                  : line.type === 'removed'
                  ? 'bg-red-900/30 text-red-300'
                  : ''
              }`}
            >
              <span className="select-none text-navy-500 mr-3 inline-block w-4 text-right">
                {line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '}
              </span>
              {highlightSql(line.text)}
            </div>
          ))}
        </code>
      </pre>
    </div>
  );
});

// =============================================================================
// Main Component
// =============================================================================

export const DDLDiffPreview = memo(function DDLDiffPreview({
  originalSql,
  proposedSql,
  dependentObjects,
  netEffectSummary,
  rollbackError,
  className = '',
}: DDLDiffPreviewProps) {
  const [depsExpanded, setDepsExpanded] = useState(true);

  const { original: originalDiff, proposed: proposedDiff } = useMemo(
    () => computeLineDiff(originalSql, proposedSql),
    [originalSql, proposedSql]
  );

  const hasChanges = originalSql !== proposedSql;
  const hasDependencies = dependentObjects.length > 0;

  return (
    <div data-testid="ddl-diff-preview" className={`space-y-4 ${className}`}>
      {/* Net Effect Summary */}
      <div
        data-testid="ddl-diff-summary"
        className="bg-navy-800 border border-navy-700 rounded-lg p-4"
      >
        <div className="text-xs font-medium text-navy-400 uppercase tracking-wide mb-1">
          Summary
        </div>
        {hasChanges ? (
          <div className="text-navy-100 whitespace-pre-line">
            {netEffectSummary || 'Schema changes detected'}
          </div>
        ) : (
          <div className="text-navy-400 italic">No changes</div>
        )}
      </div>

      {/* SQL Diff - Side by Side */}
      <div className="flex gap-4">
        <DiffCodeBlock
          lines={originalDiff}
          label="Original"
          testId="ddl-diff-original"
        />
        <DiffCodeBlock
          lines={proposedDiff}
          label="Proposed"
          testId="ddl-diff-proposed"
        />
      </div>

      {/* Dependent Objects */}
      {hasDependencies && (
        <div
          data-testid="ddl-diff-deps"
          className="bg-amber-900/20 border border-amber-700/50 rounded-lg overflow-hidden"
        >
          <button
            data-testid="ddl-diff-deps-toggle"
            onClick={() => setDepsExpanded(!depsExpanded)}
            className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-amber-900/30 transition-colors"
          >
            <ChevronIcon expanded={depsExpanded} className="w-4 h-4 text-amber-500" />
            <WarningIcon className="w-4 h-4 text-amber-500" />
            <span className="text-sm font-medium text-amber-300">
              {dependentObjects.length} object{dependentObjects.length !== 1 ? 's' : ''} will be dropped and recreated
            </span>
          </button>
          <div
            data-testid="ddl-diff-deps-list"
            className={`px-4 pb-3 space-y-2 ${depsExpanded ? '' : 'hidden'}`}
            style={{ display: depsExpanded ? undefined : 'none' }}
          >
            {dependentObjects.map((obj, index) => (
              <div
                key={`${obj.type}-${obj.name}-${index}`}
                className="flex items-center gap-2 text-sm text-amber-200 ml-6"
              >
                <DependentObjectIcon type={obj.type} />
                <span className="text-amber-400">{formatObjectType(obj.type)}:</span>
                <code className="px-1.5 py-0.5 bg-amber-900/50 rounded text-amber-100 font-mono text-xs">
                  {obj.name}
                </code>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Rollback Error */}
      {rollbackError && (
        <div
          data-testid="ddl-diff-rollback-error"
          className="bg-red-900/20 border border-red-700/50 rounded-lg p-4"
        >
          <div className="flex items-start gap-2">
            <svg
              className="w-5 h-5 text-red-500 shrink-0 mt-0.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <div>
              <div className="text-sm font-medium text-red-300">Rollback Failed</div>
              <div className="text-sm text-red-200 mt-1 font-mono">{rollbackError}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

export default DDLDiffPreview;
