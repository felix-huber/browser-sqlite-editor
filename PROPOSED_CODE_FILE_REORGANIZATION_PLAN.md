# Proposed Code File Reorganization Plan

## Scope & Constraints
- **Scope:** `src/**` (plus tests that import moved files).
- **Goal:** Make the codebase easier to navigate by grouping code by **functionality** and **shared utilities**, without deep nesting.
- **Constraints:**  
  - No file deletions without approval (already handled).  
  - No auto-codemods; all changes will be manual.  
  - Minimize churn: start with "no-brainer" moves and utility consolidation.

---

## Current Structure (Quick Map)
- `src/App.tsx`, `src/main.tsx` - app entry + orchestration
- `src/components/*` - UI by feature (`grid`, `sql`, `designer`, `erd`, `query-builder`, `import`, `export`, `sidebar`, `settings`, `welcome`) + `common` + `layout`
- `src/lib/*` - core utilities, DB/DDL/SQL helpers, import/export logic, engine
- `src/store/*` - Zustand state + async actions
- `src/worker/*` - worker runtime, registry, file import, query pagination, locks
- `src/types/*` - centralized type definitions
- `src/hooks/*` - reusable hooks

---

## Problems Observed (Why Reorg Is Worth It)
1. **Duplicate helpers scattered across UI files**
   - `formatBytes` appears in **Welcome**, **StatusBar**, **SettingsPanel**, **DropZone**, **ProgressBar**, **QuotaExceededModal**.
   - `escapeIdentifier` appears in **lib/import.ts**, **lib/export.ts**, **designer/DDLDiffPreview**, **components/export/ExportDialog**.
   - `escapeLike` is duplicated in **grid/useDataGrid.ts** and **lib/sql-escape.ts**.
   - `isMac` is duplicated in **Welcome**, **OpenDatabaseButton**, **useKeyboardShortcuts**.
   - `formatExecutionTime` is duplicated in **SqlResultsDisplay**, **SqlPreviewPanel**, **SqlEditorPanel**.

2. **Very large files blend multiple responsibilities**
   - `src/components/grid/DataGrid.tsx` (~1900 LOC) mixes UI, editing, dialogs, keyboard, selection, inline validation.
   - `src/lib/rebuild.ts` (~1460 LOC) mixes plan, execute, verify, helpers.
   - `src/worker/index.ts` (~870 LOC) mixes protocol, request routing, DB export/import, schema, registry, locking.
   - `src/types/index.ts` (~900 LOC) mixes worker protocol + schema + UI state + helpers.

3. **`src/lib` is a "misc bucket"**
   - Domain logic (engine, schema, rebuild) and UI-oriented helpers (formatting) coexist.
   - Import/export and SQL/DDL utilities are interleaved; not obvious where to look for logic.

---

## Proposed Reorganization (Phase 1 - No-Brainer, Minimal Churn)
This phase keeps the **feature/component layout** intact and focuses on **utilities + types**:

### 1) Introduce `src/lib/format/` and `src/lib/platform/`
**Goal:** eliminate duplicated formatting/platform helpers.

**New files:**
- `src/lib/format/bytes.ts`  
  - `formatBytes(bytes: number): string`
- `src/lib/format/time.ts`  
  - `formatExecutionTime(ms: number): string`  
  - `formatRelativeTime(iso: string): string`
- `src/lib/platform/keyboard.ts`  
  - `isMac(): boolean`  
  - `formatShortcut(...)` (if helpful)

**Moves/Updates:**
- Replace local `formatBytes` in:
  - `src/components/welcome/ImportProgress.tsx`
  - `src/components/layout/StatusBar.tsx`
  - `src/components/settings/SettingsPanel.tsx`
  - `src/components/common/DropZone.tsx`
  - `src/components/common/ProgressBar.tsx`
  - `src/components/common/QuotaExceededModal.tsx`
- Replace local `formatExecutionTime` and `formatRelativeTime`:
  - `src/components/sql/SqlEditorPanel.tsx`
  - `src/components/sql/QueryHistoryDropdown.tsx`
  - `src/components/sql/SqlResultsDisplay.tsx`
  - `src/components/query-builder/SqlPreviewPanel.tsx`
- Replace local `isMac`:
  - `src/components/welcome/Welcome.tsx`
  - `src/components/layout/OpenDatabaseButton.tsx`
  - Keep canonical version in `src/hooks/useKeyboardShortcuts.ts` or move it to `src/lib/platform/keyboard.ts`

**Why this helps:**  
Single source of truth for display and platform logic; fewer inconsistencies; simpler maintenance.

### 2) Consolidate SQL escaping helpers under `src/lib/sql/`
**Goal:** avoid multiple SQL-escaping implementations.

**Proposed layout:**
- `src/lib/sql/escape.ts`  
  - `escapeIdentifier`, `escapeLike`, `getEscapeClause`

**Moves/Updates:**
- Move/merge logic from:
  - `src/lib/import.ts` (`escapeIdentifier`)
  - `src/lib/export.ts` (`escapeIdentifier`)
  - `src/components/designer/DDLDiffPreview.tsx` (`escapeIdentifier`)
  - `src/components/export/ExportDialog.tsx` (`escapeIdentifier`)
  - `src/components/grid/useDataGrid.ts` (`escapeLike`)
- Update imports in all above files + tests:
  - `src/lib/__tests__/import.test.ts`
  - `src/components/grid/__tests__/useDataGrid.test.ts`
  - `src/components/sql/__tests__/SqlResultsDisplay.test.tsx`

**Why this helps:**  
SQL escaping is security-adjacent; duplication increases risk of inconsistent behavior.

### 3) Split `src/types/index.ts` into domain-scoped modules
**Goal:** make type discovery easier and avoid edit collisions.

**Proposed split:**
- `src/types/worker.ts` - worker protocol (`WorkerRequest`, `WorkerResponse`, `WorkerErrorCode`, etc.)
- `src/types/schema.ts` - schema info (`TableInfo`, `ColumnInfo`, `IndexInfo`, etc.)
- `src/types/store.ts` - store state types
- `src/types/query.ts` - query/result types (`QueryResult`, `QueryRow`, etc.)
- `src/types/ui.ts` - UI-specific types
- `src/types/index.ts` - re-export barrel

**Required updates:**  
Adjust imports across `src/store`, `src/worker`, `src/components/*` to use new type paths (or keep barrel).

---

## Phase 2 - Targeted File Splits (Optional but High-Value)
These reduce cognitive load without changing architecture.

### A) `src/components/grid/DataGrid.tsx` (~1900 LOC)
**Proposed split:**
- `DataGrid.tsx` - orchestration only
- `GridToolbar.tsx`
- `GridTable.tsx` / `GridBody.tsx`
- `GridCell.tsx` / `GridCellEditor.tsx`
- `GridDialogs.tsx` (AddRow/DeleteRows dialogs wiring)
- `GridEmptyState.tsx`

**Rationale:** isolates UI from mutation logic and reduces edit conflicts.

### B) `src/lib/rebuild.ts` (~1460 LOC)
**Proposed split:**
- `rebuild/plan.ts` - diff + plan creation
- `rebuild/execute.ts` - transaction & copy logic
- `rebuild/verify.ts` - integrity checks + compile checks
- `rebuild/types.ts` - types & enums
- `rebuild/index.ts` - public API re-exports

**Rationale:** easier to reason about rebuild stages; simplifies testing.

### C) `src/worker/index.ts` (~870 LOC)
**Proposed split:**
- `worker/handlers/query.ts`
- `worker/handlers/schema.ts`
- `worker/handlers/import-export.ts`
- `worker/handlers/registry.ts`
- `worker/handlers/locks.ts`
- `worker/index.ts` becomes routing + shared response helpers

**Rationale:** keeps worker protocol readable; isolates side-effects.

---

## Phase 3 - Optional Feature-First UI Layout
If you want clearer feature boundaries:

```
src/
  features/
    grid/
    sql/
    designer/
    erd/
    query-builder/
    import-export/
    sidebar/
    settings/
    welcome/
  shared/
    components/ (common + layout)
    hooks/
    utils/ (format, sql, platform)
    types/
```

**Trade-offs:** larger change, many imports updated; only do after Phase 1/2 stabilize.

---

## File Merge / Consolidation Candidates
- **`escapeIdentifier`** implementations -> single `src/lib/sql/escape.ts`
- **`formatBytes`** implementations -> single `src/lib/format/bytes.ts`
- **`formatExecutionTime`** implementations -> single `src/lib/format/time.ts`
- **`isMac`** implementations -> single `src/lib/platform/keyboard.ts`
- **`escapeLike`** duplication -> use `src/lib/sql/escape.ts` in grid

---

## Migration Notes (Imports to Update)
Below is a non-exhaustive list of **call-sites** that must be updated when Phase 1 is implemented:

- `formatBytes` call-sites:
  - `src/components/welcome/ImportProgress.tsx`
  - `src/components/layout/StatusBar.tsx`
  - `src/components/settings/SettingsPanel.tsx`
  - `src/components/common/DropZone.tsx`
  - `src/components/common/ProgressBar.tsx`
  - `src/components/common/QuotaExceededModal.tsx`

- `formatExecutionTime` call-sites:
  - `src/components/sql/SqlEditorPanel.tsx`
  - `src/components/sql/SqlResultsDisplay.tsx`
  - `src/components/query-builder/SqlPreviewPanel.tsx`

- `formatRelativeTime` call-sites:
  - `src/components/sql/QueryHistoryDropdown.tsx`

- `escapeIdentifier` call-sites:
  - `src/lib/import.ts`
  - `src/lib/export.ts`
  - `src/components/designer/DDLDiffPreview.tsx`
  - `src/components/export/ExportDialog.tsx`

- `escapeLike` call-sites:
  - `src/components/grid/useDataGrid.ts`

- `isMac` call-sites:
  - `src/components/welcome/Welcome.tsx`
  - `src/components/layout/OpenDatabaseButton.tsx`
  - `src/hooks/useKeyboardShortcuts.ts`

---

## Rationale Summary (Why This Layout Is More Intuitive)
- **Functionality-first navigation:** utilities live where engineers expect them (`lib/format`, `lib/sql`, `lib/platform`).
- **Less duplication:** shared helpers stop drifting across UI layers.
- **Smaller files:** easier to review, lower merge conflicts.
- **Stable imports:** Phase 1 avoids big component moves; Phase 2/3 are optional.

---

## Proposed Rollout (Safe Steps)
1. **Phase 1 only:** add new helper modules + replace imports. Run `npm test` + `npm run test:e2e`.
2. **Phase 2:** split huge files (grid, rebuild, worker). Update tests.
3. **Phase 3 (optional):** move features into `src/features/`.

---

## Tests / Verification After Reorg
- `npm run lint`
- `npm run typecheck`
- `npm test -- --run`
- `npm run test:e2e`
- Spot-check: create DB, import DB, run SQL, open ERD, export data.

