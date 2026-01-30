# Onboarding: PRD Gap Closure Task

**Task ID:** gap-closure-2025
**Created:** 2026-01-30
**Purpose:** Turn `artifacts/04-prd-gap-plan.md` into a proper spec with unit tests, then create beads for implementation.

---

## 1. Project Overview

**WASM SQLite Editor** is a browser-based SQLite database editor inspired by Microsoft Access. It runs entirely client-side using WebAssembly with the following key features:

- Load/create SQLite databases
- Visual table designer (add/edit/remove columns)
- ERD view with FK relationship editing
- SQL query editor with syntax highlighting
- Visual query builder (SELECT, JOIN, WHERE, ORDER BY, LIMIT)
- Data grid with inline editing
- CSV/JSON import/export
- OPFS persistence (with IndexedDB fallback)
- PWA offline support

**Tech Stack:**
- React 18 + TypeScript
- Vite (build)
- wa-sqlite (WASM SQLite engine)
- CodeMirror 6 (SQL editor)
- React Flow (ERD)
- TanStack Table + Virtual (data grid)
- Zustand (state management)
- Tailwind CSS
- Vitest (unit tests) + Playwright (E2E)

---

## 2. Architecture Summary

```
┌─────────────────────────────────────────────────────────────────┐
│                     Main Thread (React)                         │
│  ┌─────────┐  ┌───────────┐  ┌──────────┐  ┌────────────────┐  │
│  │  App.tsx │  │  Features │  │  Store   │  │ WorkerClient   │  │
│  │(routing) │  │(UI comps) │  │(Zustand) │  │(IPC interface) │  │
│  └────┬─────┘  └─────┬─────┘  └────┬─────┘  └───────┬────────┘  │
│       │              │             │                │           │
└───────┼──────────────┼─────────────┼────────────────┼───────────┘
        │              │             │                │
        │              │             │     postMessage (structured clone)
        │              │             │                │
┌───────┼──────────────┼─────────────┼────────────────┼───────────┐
│       │              │             │                │           │
│       │  ┌───────────┴─────────────┴────────────────▼────────┐  │
│       │  │                    Web Worker                     │  │
│       │  │  ┌──────────────┐  ┌──────────────┐  ┌─────────┐  │  │
│       │  │  │ DatabaseEngine│  │DB Registry   │  │Handlers │  │  │
│       │  │  │ (wa-sqlite)   │  │(CRUD+self-heal)│ │(query/ │  │  │
│       │  │  └──────┬────────┘  └───────┬──────┘  │schema/  │  │  │
│       │  │         │                   │         │import)  │  │  │
│       │  │         ▼                   ▼         └────┬────┘  │  │
│       │  │  ┌──────────────────────────────────────────▼────┐ │  │
│       │  │  │              VFS Layer (OPFS/IDB)             │ │  │
│       │  │  └───────────────────────────────────────────────┘ │  │
│       │  └────────────────────────────────────────────────────┘  │
│                          Worker Thread                           │
└──────────────────────────────────────────────────────────────────┘
```

### Key Directories

| Path | Purpose |
|------|---------|
| `src/App.tsx` | Main application component, view routing |
| `src/core/` | Business logic (db, engine, io, rebuild, sql, erd, worker) |
| `src/features/` | UI feature components (sidebar, designer, erd, grid, query-builder, sql, import, export) |
| `src/worker/` | Web Worker code (handlers, registry, storage) |
| `src/store/` | Zustand state management |
| `src/types/` | TypeScript interfaces |
| `e2e/` | Playwright E2E tests |

### Core Modules

| Module | Purpose | Key Files |
|--------|---------|-----------|
| `core/db/` | Schema introspection, DDL generation | `schema.ts`, `ddl.ts`, `fk-query.ts`, `db-name.ts` |
| `core/engine/` | wa-sqlite wrapper, VFS initialization | `db-engine.ts`, `opfs-vfs.ts` |
| `core/io/` | Import/export logic | `import.ts`, `export.ts`, `csv.ts`, `json.ts` |
| `core/rebuild/` | Table restructuring (12-step rebuild) | `plan.ts`, `execute.ts`, `extract.ts`, `verify.ts` |
| `core/sql/` | Query building, history | `query-builder.ts`, `history.ts`, `multi-exec.ts` |
| `core/erd/` | ERD layout persistence | `erd-layout.ts` |
| `core/worker/` | Worker client | `client.ts` |

---

## 3. Gap Plan Summary

The gap plan (`artifacts/04-prd-gap-plan.md`) identifies 8 phases of work:

### Phase 1: Storage Layout & Naming Compliance
**Current State:**
- OPFS uses `/sqlite-editor/` root (PRD: `/wasm-sqlite-editor/databases/`)
- ERD layout stored in localStorage (`erd-layout:`) not OPFS sidecar
- Database naming allows 255 chars (PRD: 64), case-insensitive collision not enforced on import

**Key Files:**
- `src/worker/db-registry.ts` - OPFS_DIR = '/sqlite-editor'
- `src/core/erd/erd-layout.ts` - Uses localStorage

### Phase 2: Import/Export Correctness
**Current State:**
- SQLite import buffers full file in memory (`streamFileChunks` concatenates)
- CSV header normalization replaces spaces with underscores (PRD: keep spaces, quote)
- Leading zeros treated as integers (PRD: TEXT)
- Empty quoted vs unquoted NULL handling differs from PRD
- CSV export doesn't preserve NULL vs empty string distinction
- No formula injection protection toggle

**Key Files:**
- `src/core/io/csv.ts` - `normalizeHeader()` line 35-46
- `src/core/io/csv.ts` - `inferColumnType()` line 54-85 (no leading zero check)
- `src/core/io/import.ts` - Import logic
- `src/core/io/export.ts` - Export logic

### Phase 3: Table Designer + Rebuild Fidelity
**Current State:**
- Rebuild generates DDL from `ColumnDefinition`, doesn't preserve CHECK/STRICT/GENERATED/etc
- Post-rebuild compile-check for views/triggers only partially implemented
- Native ALTER TABLE preference not explicit

**Key Files:**
- `src/core/rebuild/plan.ts` - Rebuild plan generation
- `src/core/rebuild/execute.ts` - Rebuild execution
- `src/core/rebuild/extract.ts` - Schema extraction
- `src/core/rebuild/verify.ts` - Post-rebuild verification

### Phase 4: ERD Feature Parity
**Current State:**
- Composite FKs rendered per-column, not grouped
- FK validation allows composite PK columns (PRD: single-column only)
- No anti-join data validation before FK creation
- No DDL diff preview for FK operations
- Layout in localStorage, not OPFS sidecar

**Key Files:**
- `src/features/erd/ERDCanvas.tsx`
- `src/features/erd/FKEditDialog.tsx`
- `src/features/erd/FKValidationDialog.tsx`
- `src/core/erd/erd-layout.ts`

### Phase 5: Grid Correctness & Performance
**Current State:**
- Uses pagination (LIMIT/OFFSET + Prev/Next) not virtual scrolling
- Missing stable ordering tie-breakers
- Filter uses `LIKE` without `lower()` for case-insensitivity

**Key Files:**
- `src/features/grid/DataGrid.tsx`
- `src/worker/query-pagination.ts`

### Phase 6: SQL Editor Semantics
**Current State:**
- Error line mapping uses SQLite parsing only, not byte offset
- Explicit transaction edge cases not fully handled
- Read-only mode uses string-based parser, not `sqlite3_stmt_readonly()`

**Key Files:**
- `src/features/sql/SqlEditorPanel.tsx`
- `src/core/sql/multi-exec.ts`

### Phase 7: PWA & Security
**Current State:**
- CSP not implemented
- Offline guarantee needs verification

**Key Files:**
- `vite.config.ts` (PWA config)
- `index.html` (CSP meta)

### Phase 8: E2E Coverage Alignment
**Current State:**
- Many PRD E2E IDs not covered
- Security E2E tests (E2E-SEC-01/02) missing

**Key Files:**
- `e2e/*.spec.ts`

---

## 4. Specific Implementation Gaps by File

### `src/worker/db-registry.ts`
| Line | Gap | PRD Requirement |
|------|-----|-----------------|
| 27 | `OPFS_DIR = '/sqlite-editor'` | Should be `/wasm-sqlite-editor` |
| - | No `/databases/` subdir | PRD: `/wasm-sqlite-editor/databases/*.sqlite` |
| - | Max name length 255 | PRD: 64 chars |
| - | No case-insensitive collision on import suffix | PRD: import must suffix collisions case-insensitively |

### `src/core/io/csv.ts`
| Line | Gap | PRD Requirement |
|------|-----|-----------------|
| 42 | `name = name.replace(/\s+/g, '_')` | PRD: keep spaces, use identifier quoting |
| 54-85 | `inferColumnType()` doesn't check leading zeros | PRD: `"001"` must be TEXT |
| 188-206 | Empty handling | PRD: unquoted empty = NULL, quoted `""` = empty string |

### `src/core/io/import.ts`
| Line | Gap | PRD Requirement |
|------|-----|-----------------|
| - | No UTF-8 validation | PRD: reject non-UTF-8 CSV |
| - | No duplicate header suffix | PRD: case-insensitive `_1`, `_2` suffix |

### `src/core/io/export.ts`
| Gap | PRD Requirement |
|-----|-----------------|
| No NULL vs empty string distinction | PRD: NULL = unquoted empty, empty string = `""` |
| No formula injection toggle | PRD: default ON, prefix `=+−@\t\r` with `'` |

### `src/core/erd/erd-layout.ts`
| Line | Gap | PRD Requirement |
|------|-----|-----------------|
| 12 | `STORAGE_PREFIX = 'erd-layout:'` | PRD: OPFS sidecar `<db>.erd.json` |
| - | Uses localStorage | PRD: OPFS sidecar |

### `src/core/rebuild/plan.ts`
| Gap | PRD Requirement |
|-----|-----------------|
| Rebuild generates new DDL | PRD: parse original CREATE TABLE, modify, preserve advanced features |
| No explicit native ALTER check | PRD: prefer native ALTER TABLE RENAME COLUMN / DROP COLUMN when safe |

### `src/features/erd/ERDCanvas.tsx`
| Gap | PRD Requirement |
|-----|-----------------|
| Composite FKs rendered per-column | PRD: single edge with multi-column label, read-only |
| No anti-join validation | PRD: block FK if existing data violates integrity |

### Grid (`src/features/grid/`)
| Gap | PRD Requirement |
|-----|-----------------|
| Pagination not virtual scroll | PRD: virtual scrolling, no pagination |
| No tie-breaker for stable sort | PRD: `ORDER BY <col>, rowid` |
| Filter `LIKE` without `lower()` | PRD: `lower(col) LIKE lower(?)` |

---

## 5. Test Coverage Status

### Unit Tests (17 core tests)
All core modules have unit tests in `src/core/__tests__/`:
- `csv-parser.test.ts`, `db-engine.test.ts`, `db-name.test.ts`, `ddl.test.ts`
- `erd-layout.test.ts`, `export.test.ts`, `fk-query.test.ts`, `history.test.ts`
- `import.test.ts`, `json.test.ts`, `multi-exec.test.ts`, `query-builder.test.ts`
- `rebuild.test.ts`, `schema.test.ts`, `sql-escape.test.ts`, `worker-client.test.ts`

### E2E Tests (15 spec files)
- `smoke.spec.ts`, `db-lifecycle.spec.ts`, `table-designer.spec.ts`
- `grid-read.spec.ts`, `grid-edit.spec.ts`, `sql-editor.spec.ts`
- `query-builder.spec.ts`, `erd.spec.ts`, `import.spec.ts`
- `import-export.spec.ts`, `persistence.spec.ts`, `multitab.spec.ts`
- `accessibility.spec.ts`, `pwa.spec.ts`, `perf/perf.spec.ts`

### Missing Tests (per PRD E2E IDs)
- E2E-SEC-01, E2E-SEC-02 (security tests)
- Many gap-specific behaviors not covered

---

## 6. Workflow for Gap Closure

Per `close_gaps.md`, the workflow is:

1. **Turn Gap Plan into Beads**
   - Each gap becomes one or more beads
   - Include acceptance criteria, TDD test specs, verification commands

2. **Beads Review Loop** (6-9 passes)
   - Use Doodlestein beads review prompt
   - Iterate until no changes remain

3. **Run Strict Auto Loop**
   ```bash
   ./scripts/strict_ralph.sh --loop --beads --tool claude --review-tool claude
   ```

4. **Verification + E2E**
   ```bash
   ./scripts/gate_pack.sh
   ```

---

## 7. Phase Priority Recommendation

Based on impact and dependencies:

1. **Phase 1: Storage Layout** - Foundation for other work
2. **Phase 2: Import/Export** - High user impact, well-isolated
3. **Phase 4: ERD** - User-visible, builds on Phase 1 (sidecar storage)
4. **Phase 3: Table Designer** - Complex, needs careful testing
5. **Phase 5: Grid** - Large change (pagination → virtual scroll)
6. **Phase 6: SQL Editor** - Lower priority, mostly edge cases
7. **Phase 7: PWA/Security** - CSP, offline verification
8. **Phase 8: E2E Coverage** - Should run throughout

---

## 8. Key Commands

```bash
# Development
npm run dev                    # Start dev server

# Quality gates
npm run lint                   # ESLint
npm run typecheck              # TypeScript
npm test                       # Vitest unit tests
npm run test:e2e               # Playwright E2E

# Build
npm run build                  # Production build
npm run preview                # Preview production build

# Beads (if installed)
br init                        # Initialize beads
br ready --json                # List ready beads
br update <id> --status in_progress
br close <id> --reason "Done"
```

---

## 9. Workflow: Gap Plan → Oracle Review → Beads

Since the app is mostly developed and we're closing gaps (not building from scratch), the workflow is:

### Step 1: Oracle Review the Gap Plan (Optional but Recommended)

The gap plan (`artifacts/04-prd-gap-plan.md`) can be refined via Oracle to ensure each gap is properly specified with acceptance criteria and test specs.

```bash
# Run Oracle review on the gap plan
./scripts/oracle_converge.sh plan artifacts/04-prd-gap-plan.md artifacts/01-prd.md
```

This will:
- Review each gap against the PRD
- Add missing acceptance criteria
- Suggest test cases for each gap
- Identify any inconsistencies

**Note:** You mentioned skipping UX, so we go directly from gap plan to beads.

### Step 2: Transform Gap Plan → Beads

Use this prompt (adapted from phase-transitions skill):

```
OK so now read ALL of artifacts/04-prd-gap-plan.md and artifacts/01-prd.md.

For EACH gap in the gap plan, create beads with:

1. **Clear acceptance criteria** (from PRD where applicable)
2. **TDD test specs** (unit tests AND E2E tests)
3. **Verification commands** (npm test, npm run lint, npm run typecheck)
4. **Files to modify** (be specific)
5. **Implementation notes** (any gotchas from the PRD)

The beads should be organized by phase (1-8 from the gap plan).
Each bead should be 1-4 hours of work maximum.
Split large gaps into multiple beads.

Include comprehensive unit tests and e2e test scripts with detailed logging
so we can be sure everything is working perfectly after implementation.

Remember to ONLY use the `br` tool to create and modify the beads
and add the dependencies. Use ultrathink.
```

### Step 3: Beads Review Loop (6-9 passes - CRITICAL!)

Run this prompt 6-9 times until no changes are made:

```
Reread CLAUDE.md so it's still fresh in your mind.

Check over each bead super carefully-- are you sure it makes sense?
Is it optimal? Could we change anything to make the system work better
for users? If so, revise the beads.

It's a lot easier and faster to operate in "plan space" before we start
implementing these things!

DO NOT OVERSIMPLIFY THINGS! DO NOT LOSE ANY FEATURES OR FUNCTIONALITY!

Also, make sure that as part of these beads, we include comprehensive
unit tests and e2e test scripts with great, detailed logging so we can
be sure that everything is working perfectly after implementation.

Remember to ONLY use the `br` tool to create and modify the beads and
to add the dependencies to beads. Use ultrathink.
```

**Track iterations in `.beads/review-iterations.md`**

### Step 4: Execute Strict Auto Loop

Once beads are stable:

```bash
./scripts/strict_ralph.sh --loop --beads --tool claude --review-tool claude
```

Or manually work through beads:

```bash
br ready --json                    # Find next bead
br update <id> --status in_progress  # Start work
# ... do the work ...
br close <id> --reason "Done"       # Complete
```

### Step 5: Verification

After each phase:

```bash
npm run lint
npm run typecheck
npm test
npm run test:e2e
```

---

## 10. Bead Template Reference

For each gap, create a bead like:

```
Subject: [Phase]-[Number]: [Short title]

Description:
## Gap (from PRD Gap Plan)
[Copy the gap description]

## PRD Requirement
[Quote the exact PRD requirement]

## Acceptance Criteria
- [ ] [Criterion 1]
- [ ] [Criterion 2]
- [ ] [Criterion 3]

## Implementation Notes
- [Any gotchas or considerations]

## Files to Modify
- `src/path/to/file.ts`
- `src/path/to/other.ts`

## Tests to Add
### Unit Tests (`src/core/__tests__/xxx.test.ts`)
- [ ] Test case 1: [description]
- [ ] Test case 2: [description]

### E2E Tests (`e2e/xxx.spec.ts`)
- [ ] E2E-XXX-01: [description]
- [ ] E2E-XXX-02: [description]

## Verification Commands
```bash
npm run lint
npm run typecheck
npm test -- --run xxx
npm run test:e2e -- xxx.spec.ts
```

## Dependencies
- Blocked by: [bead IDs]
- Blocks: [bead IDs]
```

---

## 11. Reference Documents

| Document | Path | Purpose |
|----------|------|---------|
| PRD | `artifacts/01-prd.md` | Full product requirements |
| UX Spec | `artifacts/02-ux.md` | UX specifications |
| Plan | `artifacts/03-plan.md` | Implementation plan |
| Gap Plan | `artifacts/04-prd-gap-plan.md` | Gap inventory (this task) |
| Close Gaps Guide | `close_gaps.md` | Workflow guide |
| CLAUDE.md | `CLAUDE.md` | Project instructions |
| Phase Transitions | `skills/phase-transitions/SKILL.md` | Review prompts |
| Review Loops | `skills/review-loops/SKILL.md` | Doodlestein methodology |
| Artifact Workflow | `skills/artifact-workflow/SKILL.md` | Workflow status |
| Oracle Integration | `skills/oracle-integration/SKILL.md` | GPT-5.2 Pro reviews |
