/**
 * Grid Components
 *
 * TanStack Table + Virtual based data grid for SQLite data display
 */

export {
  useDataGrid,
  createColumnDefs,
  generatePaginationClause,
  generatePaginatedQuery,
  generateOrderByClause,
  escapeLike,
  generateFilterClause,
  generateWhereClause,
  getColumnTypeCategory,
  ROW_HEIGHT,
  DEFAULT_PAGE_SIZE,
  type DataRow,
  type CellValue,
  type PaginationState,
  type SortDirection,
  type ColumnSort,
  type SortState,
  type TextFilterOperator,
  type NumericFilterOperator,
  type NullFilterOperator,
  type FilterOperator,
  type ColumnFilter,
  type FilterState,
  type UseDataGridOptions,
  type UseDataGridResult,
} from './useDataGrid';

export {
  useGridVirtualizer,
  calculateVisibleRange,
  type UseGridVirtualizerOptions,
  type UseGridVirtualizerResult,
} from './useGridVirtualizer';

export { DataGrid, type DataGridProps } from './DataGrid';
