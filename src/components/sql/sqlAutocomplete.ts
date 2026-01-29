/**
 * Schema-aware SQL Autocomplete for CodeMirror 6
 *
 * Provides intelligent completions for:
 * - Table names (after FROM, JOIN, INTO, UPDATE, DELETE FROM)
 * - Column names (after SELECT, WHERE, ORDER BY, GROUP BY) with table context
 * - SQL keywords (SELECT, FROM, WHERE, JOIN, etc.)
 * - Generated column indicators in completion list
 */

import {
  autocompletion,
  Completion,
  CompletionContext,
  CompletionResult,
  CompletionSource,
} from '@codemirror/autocomplete';
import type { Extension } from '@codemirror/state';
import type { ColumnInfo } from '../../types';

// =============================================================================
// Types
// =============================================================================

/**
 * Schema information for autocomplete
 */
export interface AutocompleteSchema {
  /** Map of table names to their columns */
  tables: Map<string, ColumnInfo[]>;
  /** List of view names */
  views: string[];
}

/**
 * Options for the autocomplete extension
 */
export interface SqlAutocompleteOptions {
  /** Schema information (updated dynamically) */
  schema: AutocompleteSchema;
}

// =============================================================================
// SQL Keywords
// =============================================================================

/** SQL keywords for completion */
const SQL_KEYWORDS = [
  'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'BETWEEN',
  'LIKE', 'IS', 'NULL', 'TRUE', 'FALSE',
  'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE',
  'CREATE', 'TABLE', 'VIEW', 'INDEX', 'DROP', 'ALTER', 'ADD', 'COLUMN',
  'PRIMARY', 'KEY', 'FOREIGN', 'REFERENCES', 'UNIQUE', 'CHECK', 'DEFAULT',
  'ORDER', 'BY', 'ASC', 'DESC', 'LIMIT', 'OFFSET',
  'GROUP', 'HAVING', 'DISTINCT', 'AS', 'ON', 'USING',
  'INNER', 'LEFT', 'RIGHT', 'OUTER', 'CROSS', 'JOIN',
  'UNION', 'ALL', 'EXCEPT', 'INTERSECT',
  'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
  'CAST', 'COALESCE', 'NULLIF', 'IFNULL',
  'COUNT', 'SUM', 'AVG', 'MIN', 'MAX',
  'AUTOINCREMENT', 'WITHOUT', 'ROWID',
  'PRAGMA', 'EXPLAIN', 'ANALYZE', 'VACUUM', 'REINDEX',
  'BEGIN', 'TRANSACTION', 'COMMIT', 'ROLLBACK', 'SAVEPOINT',
  'TRIGGER', 'BEFORE', 'AFTER', 'INSTEAD', 'OF', 'FOR', 'EACH', 'ROW',
  'GENERATED', 'ALWAYS', 'STORED', 'VIRTUAL',
  'CONSTRAINT', 'CASCADE', 'RESTRICT', 'NO', 'ACTION',
  'GLOB', 'REGEXP', 'ESCAPE', 'COLLATE', 'NOCASE',
  'INTEGER', 'TEXT', 'REAL', 'BLOB', 'NUMERIC',
  'EXISTS', 'WITH', 'RECURSIVE',
];

/** Keywords that expect table names after them */
const TABLE_CONTEXT_KEYWORDS = ['FROM', 'JOIN', 'INTO', 'UPDATE', 'TABLE'];

/** Keywords that expect column names after them */
const COLUMN_CONTEXT_KEYWORDS = ['SELECT', 'WHERE', 'ORDER', 'GROUP', 'BY', 'HAVING', 'SET', 'ON'];

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get the word before the cursor position
 */
function getWordBefore(text: string, pos: number): string {
  let start = pos;
  while (start > 0 && /[\w_]/.test(text[start - 1])) {
    start--;
  }
  return text.slice(start, pos);
}

/**
 * Get the previous non-whitespace word in the text
 */
function getPreviousWord(text: string, pos: number): string {
  // Skip whitespace backwards
  let end = pos;
  while (end > 0 && /\s/.test(text[end - 1])) {
    end--;
  }
  // Find word start
  let start = end;
  while (start > 0 && /[\w_]/.test(text[start - 1])) {
    start--;
  }
  return text.slice(start, end).toUpperCase();
}

/**
 * Find all table names referenced in a SQL query (basic parsing)
 * Looks for table names after FROM, JOIN, UPDATE, INTO keywords
 */
function findReferencedTables(sql: string): string[] {
  const tables: string[] = [];

  // Patterns that precede table names
  const patterns = [
    /\bFROM\s+/gi,
    /\bJOIN\s+/gi,
    /\bINTO\s+/gi,
    /\bUPDATE\s+/gi,
  ];

  for (const pattern of patterns) {
    let match;
    // Reset lastIndex to 0 before each search
    const regex = new RegExp(pattern.source, pattern.flags);
    while ((match = regex.exec(sql)) !== null) {
      // Get the word after the keyword
      const afterKeyword = sql.slice(match.index + match[0].length);
      const tableMatch = afterKeyword.match(/^[\w_]+/);
      if (tableMatch) {
        tables.push(tableMatch[0]);
      }
    }
  }

  return [...new Set(tables)]; // Remove duplicates
}

/**
 * Check if the cursor is in a position expecting a table name
 */
function isTableContext(text: string, pos: number): boolean {
  const prevWord = getPreviousWord(text, pos);
  return TABLE_CONTEXT_KEYWORDS.includes(prevWord);
}

/**
 * Check if the cursor is in a position expecting a column name
 */
function isColumnContext(text: string, pos: number): boolean {
  const prevWord = getPreviousWord(text, pos);
  return COLUMN_CONTEXT_KEYWORDS.includes(prevWord);
}

/**
 * Score a completion match for ranking
 * Higher score = better match
 */
function scoreMatch(input: string, target: string): number {
  const inputLower = input.toLowerCase();
  const targetLower = target.toLowerCase();

  // Exact match (case-insensitive)
  if (inputLower === targetLower) return 1000;

  // Prefix match
  if (targetLower.startsWith(inputLower)) {
    return 500 + (inputLower.length / targetLower.length) * 100;
  }

  // Contains match
  if (targetLower.includes(inputLower)) {
    return 100 + (inputLower.length / targetLower.length) * 50;
  }

  // Fuzzy match (all chars appear in order)
  let j = 0;
  for (let i = 0; i < targetLower.length && j < inputLower.length; i++) {
    if (targetLower[i] === inputLower[j]) j++;
  }
  if (j === inputLower.length) {
    return 10 + (inputLower.length / targetLower.length) * 10;
  }

  return 0;
}

// =============================================================================
// Completion Source Factory
// =============================================================================

/**
 * Create a completion source for SQL with schema awareness
 */
export function createSqlCompletionSource(
  getSchema: () => AutocompleteSchema
): CompletionSource {
  return (context: CompletionContext): CompletionResult | null => {
    const { state, pos } = context;
    const textBefore = state.doc.sliceString(0, pos);
    const currentWord = getWordBefore(textBefore, pos);
    const wordStart = pos - currentWord.length;

    // Don't complete if no word is started and not explicitly requested
    if (currentWord.length === 0 && !context.explicit) {
      return null;
    }

    const schema = getSchema();
    const completions: Completion[] = [];

    // Determine context
    const inTableContext = isTableContext(textBefore, wordStart);
    const inColumnContext = isColumnContext(textBefore, wordStart);

    // Add table name completions
    if (inTableContext || (!inColumnContext && currentWord.length > 0)) {
      for (const tableName of schema.tables.keys()) {
        const score = scoreMatch(currentWord, tableName);
        if (score > 0 || currentWord.length === 0) {
          completions.push({
            label: tableName,
            type: 'class', // 'class' displays as table icon in default theme
            detail: 'table',
            boost: score / 1000,
          });
        }
      }

      // Add view names
      for (const viewName of schema.views) {
        const score = scoreMatch(currentWord, viewName);
        if (score > 0 || currentWord.length === 0) {
          completions.push({
            label: viewName,
            type: 'interface', // 'interface' for views
            detail: 'view',
            boost: score / 1000,
          });
        }
      }
    }

    // Add column name completions
    if (inColumnContext || (!inTableContext && currentWord.length > 0)) {
      // Find tables referenced in the query
      const referencedTables = findReferencedTables(textBefore);

      // If tables are referenced, show columns from those tables
      const tablesToUse =
        referencedTables.length > 0
          ? referencedTables
          : [...schema.tables.keys()];

      for (const tableName of tablesToUse) {
        const columns = schema.tables.get(tableName);
        if (!columns) continue;

        for (const column of columns) {
          const score = scoreMatch(currentWord, column.name);
          if (score > 0 || currentWord.length === 0) {
            // Build detail string
            let detail = column.type || 'column';
            if (column.generated) {
              detail = `${detail} (${column.generated})`;
            }
            if (column.pk > 0) {
              detail = `${detail} PK`;
            }

            // For multi-table queries, prefix with table name
            const label =
              referencedTables.length > 1
                ? `${tableName}.${column.name}`
                : column.name;

            completions.push({
              label,
              type: column.generated ? 'function' : 'property', // 'function' for generated cols
              detail,
              info: column.generated ? `Generated ${column.generated} column` : undefined,
              boost: score / 1000 + 0.1, // Slightly prefer columns over tables in column context
            });
          }
        }
      }
    }

    // Add SQL keyword completions (always available)
    for (const keyword of SQL_KEYWORDS) {
      const score = scoreMatch(currentWord, keyword);
      if (score > 0 || currentWord.length === 0) {
        completions.push({
          label: keyword,
          type: 'keyword',
          boost: (score / 1000) - 0.1, // Slightly lower priority than schema items
        });
      }
    }

    // Sort completions by boost (descending)
    completions.sort((a, b) => (b.boost ?? 0) - (a.boost ?? 0));

    // Limit to top 50 completions
    const limitedCompletions = completions.slice(0, 50);

    if (limitedCompletions.length === 0) {
      return null;
    }

    return {
      from: wordStart,
      options: limitedCompletions,
      validFor: /^[\w_]*$/,
    };
  };
}

// =============================================================================
// Extension Factory
// =============================================================================

/**
 * Create the SQL autocomplete extension for CodeMirror
 */
export function sqlAutocomplete(
  getSchema: () => AutocompleteSchema
): Extension {
  return autocompletion({
    override: [createSqlCompletionSource(getSchema)],
    activateOnTyping: true,
    maxRenderedOptions: 50,
    icons: true, // Show type icons
    addToOptions: [
      {
        // Add generated column indicator
        render: (completion) => {
          const span = document.createElement('span');
          span.className = 'cm-completionLabel';
          span.textContent = completion.label;

          // Add generated column indicator (generated columns use 'function' type and have stored/virtual in detail)
          if (completion.type === 'function' && (completion.detail?.includes('stored') || completion.detail?.includes('virtual'))) {
            const indicator = document.createElement('span');
            indicator.className = 'cm-completion-generated';
            indicator.textContent = ' ⚡';
            indicator.title = 'Generated column';
            indicator.setAttribute('data-testid', 'generated-column-indicator');
            span.appendChild(indicator);
          }

          return span;
        },
        position: 50, // After default label renderer
      },
    ],
  });
}

// =============================================================================
// Empty Schema Helper
// =============================================================================

/**
 * Create an empty schema for initialization
 */
export function createEmptySchema(): AutocompleteSchema {
  return {
    tables: new Map(),
    views: [],
  };
}
