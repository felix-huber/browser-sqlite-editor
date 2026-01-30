/**
 * Grid row renderer.
 */

import { memo } from 'react';
import { EditableCell } from './GridCell';
import type { CellEditState, CellValue, DataGridRow } from './useDataGrid';

export interface GridRowProps {
  row: DataGridRow;
  style: React.CSSProperties;
  isSelected: boolean;
  isReadOnly: boolean;
  onToggleSelect: (event: React.MouseEvent) => void;
  columnWidths: Record<string, number>;
  editState: CellEditState | null;
  onCellDoubleClick: (rowIndex: number, columnName: string, e: React.MouseEvent) => void;
  onCellContextMenu: (rowIndex: number, columnName: string, cellValue: CellValue, e: React.MouseEvent) => void;
  onUpdateEditValue: (value: string) => void;
  onCommitEdit: () => Promise<boolean>;
  onCancelEdit: () => void;
  onMoveToNextCell: (rowIndex: number, columnName: string) => void;
  focusedCell?: { row: number; col: number } | null;
  onCellClick?: (rowIndex: number, colIndex: number, event: React.MouseEvent<HTMLDivElement>) => void;
  rowHeight: number;
  checkboxColumnWidth: number;
  defaultColumnWidth: number;
}

export const GridRow = memo(function GridRow({
  row,
  style,
  isSelected,
  isReadOnly,
  onToggleSelect,
  columnWidths,
  editState,
  onCellDoubleClick,
  onCellContextMenu,
  onUpdateEditValue,
  onCommitEdit,
  onCancelEdit,
  onMoveToNextCell,
  focusedCell,
  onCellClick,
  rowHeight,
  checkboxColumnWidth,
  defaultColumnWidth,
}: GridRowProps) {
  const isRowEditing = editState?.rowIndex === row.index;

  return (
    <div
      className={`flex items-center border-b border-gray-200 ${
        isSelected ? 'bg-blue-50' : row.index % 2 === 0 ? 'bg-white' : 'bg-gray-50'
      } hover:bg-blue-100`}
      style={style}
      data-row-index={row.index}
      role="row"
      aria-rowindex={row.index + 2}
      aria-selected={isSelected}
    >
      <div
        className="flex-shrink-0 flex items-center justify-center"
        style={{ width: checkboxColumnWidth, height: rowHeight }}
        role="gridcell"
        aria-colindex={1}
      >
        <input
          type="checkbox"
          checked={isSelected}
          onChange={(e) => onToggleSelect(e.nativeEvent as unknown as React.MouseEvent)}
          disabled={isReadOnly}
          className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
          data-testid={`row-checkbox-${row.index}`}
          aria-label={`Select row ${row.index + 1}`}
        />
      </div>

      {row.getVisibleCells().map((cell, colIndex) => {
        const width = columnWidths[cell.column.id] || defaultColumnWidth;
        const columnName = cell.column.id;
        const columnType = cell.column.columnDef.meta?.type || 'TEXT';
        const isCellEditing = isRowEditing && editState?.columnName === columnName;
        const isDirty = isCellEditing && editState?.isDirty;
        const cellValue = cell.getValue() as CellValue;
        const isFocused = focusedCell?.row === row.index && focusedCell?.col === colIndex;

        return (
          <div
            key={cell.id}
            className={`flex-shrink-0 px-2 overflow-hidden text-ellipsis whitespace-nowrap relative ${
              isDirty ? 'bg-yellow-50' : ''
            } ${isFocused ? 'outline outline-2 outline-blue-500 outline-offset-[-2px]' : ''}`}
            style={{ width, height: rowHeight, lineHeight: `${rowHeight}px` }}
            onDoubleClick={(e) => onCellDoubleClick(row.index, columnName, e)}
            onClick={(e) => onCellClick?.(row.index, colIndex, e)}
            onContextMenu={(e) => onCellContextMenu(row.index, columnName, cellValue, e)}
            data-testid={`cell-${row.index}-${columnName}`}
            role="gridcell"
            aria-colindex={colIndex + 2}
            tabIndex={isFocused ? 0 : -1}
          >
            <EditableCell
              value={cellValue}
              columnType={columnType}
              editState={editState}
              isEditing={isCellEditing}
              onUpdateValue={onUpdateEditValue}
              onCommit={onCommitEdit}
              onCancel={onCancelEdit}
              onMoveToNextCell={() => onMoveToNextCell(row.index, columnName)}
            />
          </div>
        );
      })}
    </div>
  );
});
