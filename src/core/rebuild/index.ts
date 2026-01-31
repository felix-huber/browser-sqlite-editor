export * from './types';
export * from './extract';
export * from './plan';
export {
  verifyTableSchema,
  verifyForeignKeyIntegrity,
  verifyViewCompilability,
  verifyTriggerValidity,
  hasSelfReferencialForeignKeys,
  runPostRebuildVerification,
} from './verify';
export { executeRebuildPlan } from './execute';

// Pre-flight dependency scanning (Phase 1)
export {
  scanDependenciesForTable,
  scanDependenciesForColumn,
  scanDependenciesForColumns,
  formatDependencyScanForDisplay,
  type DependencyScanResult,
  type DependencyReference,
} from './dependency-scan';

// Post-rebuild compile checking (Phase 2)
export {
  compileCheckView,
  compileCheckTrigger,
  compileCheckAllViews,
  compileCheckAllTriggers,
  runCompileChecks,
  runCompileChecksOnObjects,
  compileFailuresToVerificationFailures,
  type CompileCheckResult,
  type CompileCheckAllResult,
} from './compile-check';
