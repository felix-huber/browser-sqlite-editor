# Proposed Code File Reorganization Plan (Revision 2)
Date: 2026-01-30
Scope: `src/**` (plus tests that import moved files)

---

## Execution Decisions (Applied)
- Keep `src/App.tsx` and `src/main.tsx` at the root (no `src/app/` wrapper).
- Keep `src/types/` at the root for shared typing across UI/core/worker.
- Keep `src/worker/` at the root to avoid Vite worker path churn.
- Execute Phase 1 + Phase 2 now; leave Phase 3 as optional.

## How This Plan Was Built
- I scanned **all files under `src/`** (`.ts`, `.tsx`, `.css`, `.d.ts`) to build an inventory, size profile, and import map.
- I then grouped modules by **functional responsibility** and **runtime boundary** (UI vs. core logic vs. worker runtime).
- This plan focuses on **low-risk, no‑brainer moves first**, with optional deeper refactors as follow‑ups.

---

## Goals & Constraints
**Goals**
1. Make it obvious where feature code lives (Grid, SQL, ERD, Query Builder, Designer, Import/Export, etc.).
2. Separate UI, core logic, and worker runtime in a way that matches the app’s runtime architecture.
3. Minimize nesting and churn; aim for small, safe moves that are easy to review.
4. Avoid “misc bucket” folders (currently `lib/`) by grouping by domain.

**Constraints**
- No file deletions without permission.
- No auto‑codemods; all changes manual.
- Keep folder nesting shallow (1–2 levels max).
- Preserve Vite worker build behavior (worker entry path must stay valid).

---

## Current Structure Snapshot (High‑Level)
Top‑level counts (from full scan):
- `src/components/*`: **128** files (feature UI + shared UI mixed)
- `src/lib/*`: **45** files (engine, SQL, import/export, rebuild, utils mixed)
- `src/worker/*`: **24** files (runtime, storage, registry, handlers)
- `src/types/*`: already split by domain (good)
- `src/hooks/*`: 7 files
- `src/store/*`: Zustand store + tests

Largest files (over ~700 LOC):
- `src/worker/db-registry.ts` (~1424)
- `src/App.tsx` (~1099)
- `src/components/grid/DataGrid.tsx` (~1179)
- `src/components/designer/DDLDiffPreview.tsx` (~853)
- `src/components/import/ImportDialog.tsx` (~849)
- `src/worker/file-import.ts` (~859)
- `src/worker/schema-modification.ts` (~695)
- `src/components/erd/ERDCanvas.tsx` (~703)

Key structural issues observed
- **UI features live under `components/`**, but feature boundaries are not obvious from the top level.
- **`lib/` contains unrelated domains** (engine, SQL, I/O, rebuild, formatting, platform utils).
- Worker runtime and main‑thread worker client are split across `src/worker/*` and `src/lib/worker-client.ts`.

---

## Proposed Target Structure (Shallow, Feature‑First)

### Phase 1 (No‑Brainer, Minimal Churn): Move UI features to `src/features/` and shared UI to `src/shared/`
This is purely organizational. It does **not** change runtime behavior.

```
src/
  App.tsx
  main.tsx
  setupTests.ts
  index.css

  features/
    grid/
    table/
    sql/
    designer/
    erd/
    query-builder/
    import/
    export/
    welcome/
    sidebar/
    settings/

  shared/
    components/      # formerly components/common
    layout/          # formerly components/layout
    hooks/           # formerly hooks

  lib/               # unchanged in Phase 1 (see Phase 2)
  worker/            # unchanged in Phase 1
  store/             # unchanged in Phase 1
  types/             # unchanged in Phase 1
```

**Rationale**
- The UI is the most visible surface area; putting each feature in its own folder matches the app’s tabs and mental model.
- Keeping `App.tsx` and `main.tsx` at the root avoids extra nesting and reduces initial churn.
- `shared/` makes it explicit what’s reused across features.

### Phase 1 File Moves (UI only)
| Current Path | New Path |
|---|---|
| `src/components/grid/*` | `src/features/grid/*` |
| `src/components/table/*` | `src/features/table/*` |
| `src/components/sql/*` | `src/features/sql/*` |
| `src/components/designer/*` | `src/features/designer/*` |
| `src/components/erd/*` | `src/features/erd/*` |
| `src/components/query-builder/*` | `src/features/query-builder/*` |
| `src/components/import/*` | `src/features/import/*` |
| `src/components/export/*` | `src/features/export/*` |
| `src/components/welcome/*` | `src/features/welcome/*` |
| `src/components/sidebar/*` | `src/features/sidebar/*` |
| `src/components/settings/*` | `src/features/settings/*` |
| `src/components/common/*` | `src/shared/components/*` |
| `src/components/layout/*` | `src/shared/layout/*` |
| `src/hooks/*` | `src/shared/hooks/*` |

**Test files**
- Keep tests adjacent to their modules in the same folder (move with the feature).
- Example: `src/components/erd/__tests__/ERDCanvas.test.tsx` → `src/features/erd/__tests__/ERDCanvas.test.tsx`.

**Call‑site updates required (Phase 1)**
- `src/App.tsx`: update imports for all feature views/tabs.
- `src/shared/layout/AppShell.tsx` (currently `components/layout/AppShell.tsx`): update imports for sidebar, status bar, etc.
- Feature‑to‑feature imports (e.g., TableView importing Grid) must be updated to new feature paths.
- Any `index.ts` barrels move with their feature and must be referenced by new paths.

---

## Phase 2 (Core Logic Reorganization): Replace `lib/` with `core/` domain folders
This is the most impactful change and should be done **after** Phase 1 stabilizes.

### Proposed `core/` layout
```
src/
  core/
    db/               # schema, ddl, db-name, generated-columns, fk-query
    sql/              # sql escape, query-builder, multi-exec
    io/               # import/export, csv/json helpers
    engine/           # db-engine, opfs-vfs
    rebuild/          # rebuild/ (plan, execute, verify, utils)
    erd/              # erd-layout (if only used by ERD)
    worker/           # worker-client (main-thread bridge)
```

### Phase 2 File Moves (core logic)
| Current Path | New Path | Rationale |
|---|---|---|
| `src/lib/db-engine.ts` | `src/core/engine/db-engine.ts` | Engine runtime belongs to `core/engine`.
| `src/lib/opfs-vfs.ts` | `src/core/engine/opfs-vfs.ts` | Storage engine implementation.
| `src/lib/schema.ts` | `src/core/db/schema.ts` | DB schema access.
| `src/lib/ddl.ts` | `src/core/db/ddl.ts` | Schema definitions/DDL helpers.
| `src/lib/db-name.ts` | `src/core/db/db-name.ts` | DB naming rules.
| `src/lib/generated-columns.ts` | `src/core/db/generated-columns.ts` | Schema logic.
| `src/lib/fk-query.ts` | `src/core/db/fk-query.ts` | FK discovery.
| `src/lib/sql/escape.ts` | `src/core/sql/escape.ts` | SQL escaping centralization.
| `src/lib/sql-escape.ts` | `src/core/sql/escape-legacy.ts` (temporary) | Keep as re‑export until removed.
| `src/lib/query-builder.ts` | `src/core/sql/query-builder.ts` | SQL generation logic.
| `src/lib/multi-exec.ts` | `src/core/sql/multi-exec.ts` | SQL execution helper.
| `src/lib/import.ts` | `src/core/io/import.ts` | File IO domain.
| `src/lib/export.ts` | `src/core/io/export.ts` | File IO domain.
| `src/lib/csv.ts` | `src/core/io/csv.ts` | IO helpers.
| `src/lib/json.ts` | `src/core/io/json.ts` | IO helpers.
| `src/lib/history.ts` | `src/core/sql/history.ts` | Query history belongs to SQL domain.
| `src/lib/erd-layout.ts` | `src/core/erd/erd-layout.ts` | ERD geometry logic.
| `src/lib/rebuild/*` | `src/core/rebuild/*` | Rebuild is a domain.
| `src/lib/rebuild.ts` | `src/core/rebuild/index.ts` | Public API re‑export.
| `src/lib/worker-client.ts` | `src/core/worker/client.ts` | Main-thread bridge to worker.
| `src/lib/format/*` | `src/core/format/*` or `src/shared/format/*` | Pure presentation helpers used by UI.
| `src/lib/platform/keyboard.ts` | `src/shared/platform/keyboard.ts` | UI/platform logic.

**Rationale**
- `core/` isolates non‑UI logic; reduces “search noise.”
- IO, SQL, DB, engine, and rebuild each have a clear home.
- Worker client bridge is part of core; runtime worker stays in `src/worker/`.

**Call‑site updates required (Phase 2)**
- All imports from `src/lib/*` must be updated to `src/core/*` (or `src/shared/*` for UI helpers).
- Any `new Worker(new URL(...))` call needs to retain the correct path if worker files move (see optional Phase 3 below).

---

## Phase 3 (Optional): Move worker runtime under a data/ or core/ namespace
**Optional only** because it risks build tooling churn.

### Option A (lowest risk): Keep `src/worker/` as‑is
- No path changes required.

### Option B (cleaner structure): `src/core/worker-runtime/`
```
src/
  core/
    worker-runtime/
      index.ts
      handlers/
      ...
```
**Change required:** update the worker entry URL in the main thread (likely in `core/worker/client.ts` or wherever Worker is instantiated).

---

## Suggested File Consolidations (Small & Safe)
- **`src/lib/sql-escape.ts`** duplicates `src/lib/sql/escape.ts`.
  - Plan: keep a temporary re‑export in `escape-legacy.ts` and update all imports to the canonical file.
- **Query builder SQL helpers** are split between `src/components/query-builder/generateSql.ts` and `src/lib/query-builder.ts`.
  - Plan: consolidate SQL generation into `core/sql/query-builder.ts` and keep UI helpers in `features/query-builder/`.

---

## Suggested File Splits (Large Files)
These are **not required** for Phase 1/2, but strongly recommended for readability.

1. `src/App.tsx` (~1099 LOC)
   - Split into `app/routes.tsx`, `app/AppShell.tsx` (if not already), and `app/AppProviders.tsx`.
   - Rationale: App is currently doing routing, layout, state bridging, and feature wiring.

2. `src/worker/db-registry.ts` (~1424 LOC)
   - Split by concern: `registry/index.ts`, `registry/opfs.ts`, `registry/idb.ts`, `registry/migrations.ts`, `registry/locks.ts`.
   - Rationale: registry currently mixes persistence, locking, and migration logic.

3. `src/components/designer/DDLDiffPreview.tsx` (~853 LOC)
   - Split into `DiffRenderer`, `DiffToolbar`, `DiffSummary`, `DiffLine`.
   - Rationale: UI + rendering logic too interleaved.

4. `src/components/import/ImportDialog.tsx` (~849 LOC)
   - Split into `ImportDialog`, `ImportSourcePicker`, `ImportMapping`, `ImportProgress`.
   - Rationale: too many modes and state transitions.

5. `src/worker/file-import.ts` (~859 LOC)
   - Split into `file-import/index.ts`, `file-import/csv.ts`, `file-import/sqlite.ts`, `file-import/json.ts`.

6. `src/components/erd/ERDCanvas.tsx` (~703 LOC)
   - Split into `Canvas`, `MiniMap`, `Toolbar`, `LayoutEngine`.

---

## Detailed Import Update Checklist (Phase 1)
**Expected to change:**
- `src/App.tsx`
  - All feature imports → `src/features/*`
- `src/shared/layout/AppShell.tsx` (after move)
  - Sidebar, StatusBar, OpenDatabaseButton paths → `src/features/sidebar`, `src/shared/layout`
- `src/features/table/TableView.tsx`
  - Grid imports → `src/features/grid`
- `src/features/query-builder/QueryBuilderView.tsx`
  - Query builder component paths within feature folder
- `src/features/erd/ERDView.tsx`
  - ERD internal imports in same folder
- Any `index.ts` barrels in feature folders
  - Update export paths to new file locations

**Tests:**
- Update test imports to new paths for each moved file.
- Ensure Vitest path aliases (if any) are updated if used.

---

## Rollout Plan (Safe, Incremental)
1. **Phase 1 (UI only):** move one feature folder at a time (Grid → SQL → Designer → ERD → Query Builder → Import/Export → Table → Welcome/Sidebar/Settings).
2. Update imports and run `npm run lint` + `npm run typecheck` after each feature.
3. Run `npm run test:e2e` only after the full move to reduce iteration time.
4. **Phase 2 (core logic):** move `lib/` into `core/` by domain; update imports; run full test suite.
5. **Phase 3 (optional):** worker runtime relocation only if we accept build tooling adjustments.

---

## Why This Structure Is Optimal (Short Justification)
- **Feature-first UI layout** mirrors the app’s actual UX tabs and workflows, so new engineers can “guess” the correct folder.
- **Core vs. UI** separation matches the runtime boundary: React UI ↔ worker client ↔ worker runtime.
- **Shallow nesting** keeps paths readable and makes IDE navigation fast.
- **Incremental phases** minimize the risk of breaking the app and make review manageable.

---

## Open Questions / Decisions Needed Before Execution
1. Do you want `App.tsx` and `main.tsx` moved into `src/app/`, or keep them at root?
2. Should `src/types/` move under `src/shared/types/`, or stay at the top level?
3. Are we OK keeping `src/worker/` at the root to avoid Vite worker path churn?

---

## Summary
This plan proposes **small, safe, and obvious** folder moves first (UI → `features/`, shared UI → `shared/`), then a structured cleanup of `lib/` into `core/` by domain. It keeps nesting shallow and emphasizes clarity and predictability for new contributors. All import updates are called out, and each phase can be tested independently.
