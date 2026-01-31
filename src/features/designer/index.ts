/**
 * Designer Components
 *
 * Components for creating and editing table schemas.
 */

export { TableDesigner, validateTableName, SQLITE_RESERVED_WORDS } from './TableDesigner';
export type { TableDesignerProps, TableNameValidation } from './TableDesigner';

export { ColumnRow, COMMON_COLUMN_TYPES, validateColumnName } from './ColumnRow';
export type { ColumnRowProps, ColumnNameValidation } from './ColumnRow';

export {
  DDLDiffPreview,
  analyzeChanges,
  generateDiff,
  generateRebuildPlan,
  getAffectedObjects,
  validateChanges,
} from './DDLDiffPreview';
export type {
  DDLDiffPreviewProps,
  DiffLine,
  AffectedObject,
  OperationStep,
  ValidationResult,
  ChangeAnalysis,
} from './DDLDiffPreview';

export { DesignerPreviewModal } from './DesignerPreviewModal';
export type { DesignerPreviewModalProps } from './DesignerPreviewModal';

export { useDesignerPreview } from './useDesignerPreview';
export type { DesignerPreviewData, UseDesignerPreviewOptions } from './useDesignerPreview';
