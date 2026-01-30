/**
 * FK Create Dialog
 *
 * This file re-exports FKValidationDialog as FKCreateDialog for consistency
 * with the component naming conventions. The FKValidationDialog component
 * handles both validation and creation of foreign keys.
 *
 * This wrapper will be enhanced by bd-2y1 (P4-04) to add:
 * - ON DELETE/UPDATE action configuration
 * - DDL preview integration
 * - Integration with useFKValidation hook
 */

export {
  FKValidationDialog as FKCreateDialog,
  type FKValidationDialogProps as FKCreateDialogProps,
  type PendingFKInfo,
  type ValidationError,
  type ValidationErrorType,
  validateForeignKey,
} from './FKValidationDialog'

export type { ParentColumnValidation, DataIntegrityResult } from './FKValidation'
