export type { CodeMirrorEditorProps, CodeMirrorEditorHandle, ErrorLocation } from './CodeMirrorEditor'
export {
  sqlAutocomplete,
  createSqlCompletionSource,
  createEmptySchema,
  type AutocompleteSchema,
} from './sqlAutocomplete'
export {
  byteOffsetToPosition,
  computeErrorPosition,
  splitStatementsWithSpans,
  extractNearToken,
  findTokenByteOffset,
  mapSqlErrorPosition,
  type Position,
  type StatementSpan,
} from './errorPosition'
export { SqlEditorPanel } from './SqlEditorPanel'
export type { SqlEditorPanelProps } from './SqlEditorPanel'
export { QueryHistoryDropdown } from './QueryHistoryDropdown'
export type { QueryHistoryDropdownProps } from './QueryHistoryDropdown'
export {
  SqlErrorPanel,
  parseLineNumber,
  classifyErrorType,
  generateSuggestion,
  parseError,
  type SqlErrorType,
  type ParsedSqlError,
  type SqlErrorPanelProps,
} from './SqlErrorPanel'
export {
  SqlResultsDisplay,
  classifyStatement,
  formatExecutionTime,
  type ResultType,
  type StatementResult,
  type SqlResultsDisplayProps,
} from './SqlResultsDisplay'
export {
  createTransactionTracker,
  executeWithTransactionTracking,
  type TransactionTracker,
  type TransactionWarning,
  type TransactionExecutionResult,
  type StatementExecutionResult,
} from './transactionTracker'
