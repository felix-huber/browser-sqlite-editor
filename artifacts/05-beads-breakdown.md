# Implementation Beads Breakdown

This document contains the atomic task breakdown for closing PRD gaps, derived from `artifacts/04-prd-gap-plan.md` and refined through 3 passes of Doodlestein review.

## Summary

- **Total beads:** 56
- **Ready (unblocked):** 25
- **Blocked:** 31
- **No dependency cycles**

## Execution Plan (Sprints, Estimates, Critical Path)

### Sizing Rule (non-negotiable)
- Each bead must be 1–4 hours of work. If it will take longer, split into child beads.
- Each bead must have a single primary verification step (unit or E2E) that can be run locally.
  - Verification must name the exact command and the test file/spec (e.g., `npm test -- foo.test.ts` or `npm run test:e2e -- --grep 'E2E-US-001-01'`).
  - Manual verification steps are allowed only as secondary checks.
  - For E2E reliability, any new UI surface covered by Playwright must include stable `data-testid` selectors.

### Sprint Plan (demoable increments)

**Sprint 1 (Phase 1): Storage correctness baseline**
- Demo: Existing DBs still load after upgrade (legacy→new layout), registry self-heal resolves collisions, ERD layout persists in OPFS, single-writer lock works across tabs.
- Beads: bd-2wt, bd-fec, bd-lx0, bd-33g, bd-2eq, bd-2am, bd-3lz
- Exit Gate: E2E-US-001-01/02/03, E2E-US-010-01

**Sprint 2 (Phase 2): Import/export correctness + robustness**
- Demo: Streaming import for large DBs, CSV/JSON round-trip rules, quota-exceeded export succeeds.
- Beads: bd-2de, bd-3t7, bd-25k, bd-ts6, bd-6sr, bd-3ae, bd-2kg, bd-4z7, bd-b05
- Exit Gate: E2E-US-002-01, E2E-US-009-01

**Sprint 3 (Phase 3–4): Schema safety + ERD parity**
- Demo: Table designer preserves advanced schema features; ERD FK create/edit/delete with validation + DDL diff preview.
- Beads: bd-po6, bd-1ig, bd-2gl, bd-1ok, bd-39f, bd-o24, bd-3mp, bd-u9l, bd-3vd, bd-qdl, bd-1xx, bd-2y1, bd-rqg
- Exit Gate: E2E-US-003-01/06, E2E-US-004-01/02/05/06

**Sprint 4 (Phase 5–6): Grid + SQL editor correctness**
- Demo: Virtual scrolling with stable ordering; SQL editor error mapping + transaction edge cases.
- Beads: bd-3ge, bd-149, bd-1xr, bd-3v0, bd-1x1, bd-zsh, bd-2c2, bd-22t, bd-9kc, bd-325
- Exit Gate: E2E-US-005-02/03/04/05, E2E-US-007-02/04/05

**Sprint 5 (Phase 7–8): Security/offline + E2E completion**
- Demo: CSP clean run, offline workflow passes, PRD E2E coverage at 100%.
- Beads: bd-hws, bd-1fx, bd-3u2, bd-3l1, bd-1jc, bd-2zh, bd-2v4, bd-1rm, bd-xki, bd-1he, bd-ljh, bd-3sd, bd-2lw, bd-8se, bd-2as, bd-758, bd-orj
- Exit Gate: E2E-US-011-01, E2E-SEC-01/02

### Rough Estimates (calendar days, assuming 6 focused hours/day)
- Sprint 1: 4–6 days
- Sprint 2: 5–8 days
- Sprint 3: 7–12 days
- Sprint 4: 5–8 days
- Sprint 5: 5–10 days

### Critical Path (must stay unblocked)
1. **P1-01** (bd-2wt: OPFS layout) →
2. **P1-06** (bd-2am: migration safety) →
3. **P1-07** (bd-3lz: single-writer lock) →
4. **P2-01** (bd-2de: stream import) →
5. **P2-08** (bd-3t7: size warnings on open/growth) →
6. **P2-00** (bd-b05: perf/memory harness) →
7. **P3-01** (bd-1ig→bd-2gl/bd-1ok→bd-39f: rebuild fidelity) →
8. **P3-02** (bd-o24: dependency scan) →
9. **P4-02/04/03** (bd-qdl/bd-2y1/bd-1xx: FK validation → dialog → preview) →
10. **P5-02 → P5-01** (bd-1xr → bd-149: stable ordering → virtual scroll) →
11. **P7-01/03** (bd-hws/bd-3u2: CSP + security E2E) →
12. **P8-01/02** (bd-3l1 + bd-1jc..bd-758: coverage audit + fill gaps)

## Dependency Graph Overview

Legend:
- `Dependencies: -> X (blocks)` means this bead is blocked until X is merged.
- `Dependents: <- Y (blocks)` should mirror a corresponding `Dependencies` entry in bead Y.

```
P1-01 (OPFS Layout) ─┬─> P1-02 (Naming Rules)
                     ├─> P1-03 (Self-Heal)
                     ├─> P1-04 (ERD Sidecar)
                     ├─> P1-05 (Journal Mode)
                     ├─> P1-06 (Migration Safety)
                     ├─> P1-07 (Single-Writer Lock)
                     └─> P2-01 (Stream Import)

P3-00 (Shared DDL) ──┬─> P3-04 (Designer Preview)
                     └─> P4-03 (ERD Preview)

P3-01 (Rebuild) ─────┬─> P3-02 (Dependency Scan) ─> P3-04
                     └─> P3-03 (Native ALTER)

P4-02 (FK Validation) ─> P4-04 (FK Dialog) ─> P4-03

P5-00 (SQL Helpers) ─┬─> P5-03 (Filters)
                     └─> US-006 (Query Builder)

P5-02 (Stable Order) ─> P5-01 (Virtual Scroll)

P8-01 (E2E Audit) ───┬─> P8-02a..P8-02m (bd-1jc..bd-758: Missing E2E)
P7-03 (Security E2E) ┘
```


---

## Phase 1 Beads

> ○ bd-2am · P1-06: Storage layout migration safety   [● P1 · OPEN]
> Owner: felixhuber · Type: task
> Created: 2026-01-30 · Updated: 2026-01-30
> Labels: migration, phase-1, storage
> 
> Migration safety for OPFS layout change per Oracle:
> - Keep read-compat path for legacy layout for one release
> - Old layout: /sqlite-editor/ (current implementation)
> - New layout: /wasm-sqlite-editor/databases/*.sqlite (PRD spec)
> - Make migration idempotent (safe to re-run)
> - Add regression fixture/E2E that starts from old layout
> 
> Migration logic:
> 1. On startup, check for /sqlite-editor/ directory
> 2. If found and /wasm-sqlite-editor/ does not exist, migrate all files
> 3. If both exist (interrupted migration), resume from where left off
> 4. After successful migration, do NOT delete old directory (keep for one release)
> 5. Read path checks both locations, preferring new
> 
> Acceptance Criteria:
> - Old layout DBs at /sqlite-editor/*.sqlite still load after upgrade
> - Migration can run multiple times safely (idempotent)
> - E2E tests old→new layout upgrade path
> - Old directory is preserved for rollback during one release cycle
> 
> Verification:
> - npm test
> - E2E with legacy fixture (DB at /sqlite-editor/test.sqlite)
> - E2E: Interrupt migration mid-way, resume, verify data intact
> 
> Files to modify:
> - src/worker/db-registry.ts (migration logic in init/loadAndHeal)
> 
> E2E fixture needed:
> - Create fixture with old layout structure (/sqlite-editor/registry.json + *.sqlite files)
> 
> Dependencies:
>   -> bd-2wt (blocks) - P1-01: Align OPFS layout with PRD

> ○ bd-3lz · P1-07: Single-writer lock + read-only open enforcement   [● P1 · OPEN]
> Owner: felixhuber · Type: task
> Created: 2026-01-30 · Updated: 2026-01-30
> Labels: US-010, phase-1, storage
>
> Implement Web Locks-based single-writer coordination and SQLITE_OPEN_READONLY flag enforcement at the engine/open layer (not just UI).
>
> PRD Reference: US-010
> Gap: Current implementation uses UI guards only; needs SQLite connection opened with SQLITE_OPEN_READONLY when another tab holds the write lock.
>
> Acceptance Criteria:
> - Web Lock acquired before opening database for write
> - Heartbeat mechanism for lock holder detection
> - SQLITE_OPEN_READONLY flag passed when write lock unavailable
> - Read-only UI indication when in read-only mode
> - Multi-tab E2E test verifying writer takeover
>
> Files to modify:
> - src/worker/sqlite-engine.ts
> - src/worker/db-manager.ts
> - src/features/database/database-context.tsx
>
> Verification:
> - npm run test -- --grep 'single-writer'
> - npm run test:e2e -- --grep 'multi-tab'
>
> Dependencies:
>   (none) — single-writer lock is engine-level and does not require OPFS path changes

> ○ bd-2eq · P1-05: Enforce PRAGMA journal_mode=DELETE   [● P1 · OPEN]
> Owner: felixhuber · Type: task
> Created: 2026-01-30 · Updated: 2026-01-30
> Labels: opfs, phase-1, storage
>
> Enforce OPFS-mode journal settings per PRD:
> - Set PRAGMA journal_mode=DELETE on open in OPFS mode
> - NOTE: Orphaned journal cleanup (-wal/-shm/-journal) is owned by bd-lx0 (registry self-heal) to avoid duplicated logic
> - Verify no WAL files appear after writes
>
> IndexedDB mode (per PRD):
> - Journal mode is irrelevant in IndexedDB fallback mode (snapshots serialize entire DB)
> - Skip PRAGMA journal_mode for IDB connections
>
> Acceptance Criteria:
> - PRAGMA journal_mode returns 'delete' after open (OPFS mode only)
> - No -wal or -shm files in OPFS after writes
> - IndexedDB mode skips journal_mode PRAGMA
>
> Verification:
> - npm test
> - Manual: check OPFS after writes via DevTools
> - E2E: Open DB, write, verify no WAL/SHM files
>
> Files to modify:
> - src/worker/sqlite-engine.ts (set PRAGMA journal_mode=DELETE for OPFS connections during open)
> - src/worker/db-registry.ts (verify no -wal/-shm artifacts exist after writes; do not implement cleanup here)
>
> Dependencies:
>   -> bd-2wt (blocks) - P1-01: Align OPFS layout with PRD

> ○ bd-33g · P1-04: ERD layout OPFS sidecar   [● P1 · OPEN]
> Owner: felixhuber · Type: task
> Created: 2026-01-30 · Updated: 2026-01-30
> Labels: erd, migration, phase-1, storage
> 
> Move ERD layout persistence to OPFS per PRD:
> - Change from localStorage 'erd-layout:' to OPFS sidecar
> - Store at /wasm-sqlite-editor/databases/<db>.erd.json
> - Update layout on rename/delete
> - Coordinate with db-registry for path handling
> 
> Migration from localStorage:
> - On first load, check for existing localStorage key 'erd-layout:<db>'
> - If found, migrate to OPFS sidecar and delete localStorage entry
> - One-time migration, idempotent
> 
> Corrupt file handling (per PRD):
> - If .erd.json is missing or corrupt, auto-layout positions (no error)
> - Log warning for corrupt files
> 
> Acceptance Criteria:
> - ERD layout persists to OPFS sidecar at /wasm-sqlite-editor/databases/<db>.erd.json
> - Rename DB updates sidecar filename
> - Delete DB removes sidecar
> - No localStorage usage for ERD after migration
> - Existing localStorage layouts are migrated on first access
> - Corrupt .erd.json files result in auto-layout (no error)
> 
> Verification:
> - npm test
> - E2E: Save ERD positions, hard refresh, verify restored
> - E2E: Create layout in localStorage, open ERD, verify migrated to OPFS
> 
> Files to modify:
> - src/core/erd/erd-layout.ts (switch from localStorage to OPFS)
> - src/worker/db-registry.ts (coordinate sidecar paths)
> 
> Dependencies:
>   -> bd-2wt (blocks) - P1-01: Align OPFS layout with PRD

> ○ bd-fec · P1-02: Enforce PRD naming rules   [● P1 · OPEN]
> Owner: felixhuber · Type: task
> Created: 2026-01-30 · Updated: 2026-01-30
> Labels: phase-1, storage, validation
>
> Implement PRD-compliant database naming:
> - Length 1-64 chars (not 255) per PRD
> - Case-insensitive collision detection
> - Allowed characters per PRD: alphanumeric, spaces, hyphens, underscores, dots, parentheses
> - No path separators or control characters
> - Trim leading/trailing whitespace before validation
> - Suffix on import collision (e.g., mydb(1), mydb(2))
> - Do NOT normalize case or replace spaces with underscores (display name is case-preserving per PRD)
>
> Acceptance Criteria:
> - Name validation rejects >64 chars
> - Name validation allows only PRD-specified characters
> - Leading/trailing whitespace is trimmed
> - Case is preserved exactly as entered/displayed ("My DB" stays "My DB"); only collision checks are case-insensitive
> - Spaces are preserved (no underscore substitution)
> - Case-insensitive collision check on create/rename/import
> - Import auto-suffixes on collision (e.g., mydb(1), mydb(2))
> - Empty or invalid names show inline validation error
>
> Verification:
> - npm test (db-name-validation.test.ts)
> - npm run lint
>
> Files to modify:
> - src/worker/db-registry.ts (validateDatabaseName function)
>
> Dependencies:
>   (none) — naming rules are storage-layout agnostic; integrate with bd-2wt paths after both land

> ○ bd-2wt · P1-01: Align OPFS layout with PRD   [● P1 · OPEN]
> Owner: felixhuber · Type: task
> Created: 2026-01-30 · Updated: 2026-01-30
> Labels: breaking, phase-1, storage
> 
> Update OPFS layout to match PRD spec:
> - Root directory: /wasm-sqlite-editor/ (currently /sqlite-editor/)
> - Registry at: /wasm-sqlite-editor/registry.json
> - Databases at: /wasm-sqlite-editor/databases/*.sqlite
> - ERD sidecars at: /wasm-sqlite-editor/databases/<db>.erd.json
> - Update all registry/read/write/import/export paths
> - All DB files use .sqlite extension (normalize on import if different)
> 
> Constants to update:
> - OPFS_DIR: '/sqlite-editor' → '/wasm-sqlite-editor'
> - Add DATABASES_SUBDIR: 'databases'
> - Update all path construction to use nested structure
> 
> Acceptance Criteria:
> - OPFS root is /wasm-sqlite-editor/
> - Registry at /wasm-sqlite-editor/registry.json
> - DBs stored in /wasm-sqlite-editor/databases/<name>.sqlite
> - ERD layouts at /wasm-sqlite-editor/databases/<name>.erd.json
> - Imported files normalized to .sqlite extension
> 
> Verification:
> - npm test
> - npm run lint
> - Manual: Check OPFS structure via DevTools after creating DB
> 
> Files to modify:
> - src/worker/db-registry.ts (OPFS_DIR constant + all path functions)
> 
> Note: This bead creates a BREAKING change - existing data will not be found.
> Migration handled by P1-06 (bd-2am) which depends on this bead.
> 
> Dependents:
>   <- bd-2am (blocks) - P1-06: Storage layout migration safety
>   <- bd-2eq (blocks) - P1-05: Enforce PRAGMA journal_mode=DELETE
>   <- bd-33g (blocks) - P1-04: ERD layout OPFS sidecar
>   <- bd-2de (blocks) - P2-01: Stream SQLite import via SyncAccessHandle
>   <- bd-lx0 (blocks) - P1-03: Registry self-heal
>   <- bd-3t7 (blocks) - P2-08: Size warnings on open + DB growth

> ○ bd-lx0 · P1-03: Registry self-heal   [● P1 · OPEN]
> Owner: felixhuber · Type: task
> Created: 2026-01-30 · Updated: 2026-01-30
> Labels: phase-1, robustness, storage
> 
> Implement registry self-heal behavior per PRD:
> - Scan OPFS directory for orphaned files (file exists, no registry entry)
> - Handle case-collision resolution per PRD:
>   - Keep most recently modified file (via handle.getFile().lastModified)
>   - Auto-rename other with (conflict) suffix (e.g., mydb (conflict).sqlite)
>   - Log resolution to console
> - Clean orphaned .erd.json sidecars (sidecar exists but no matching .sqlite)
> - Clean orphaned journal files (-wal, -shm, -journal)
> 
> Acceptance Criteria:
> - Registry detects and reports orphaned DB files
> - Case collisions resolved: keep most recent, rename other with (conflict)
> - Resolution logged to console
> - Orphaned .erd.json files are cleaned
> - Orphaned journal files are cleaned
> - Self-heal runs on app startup and after any file operation failure
> 
> Verification:
> - npm test (unit tests for collision scenarios)
> - npm run lint
> - E2E: Create two files differing only by case, verify conflict resolution
> 
> Files to modify:
> - src/worker/db-registry.ts (loadAndHeal method)
> 
> Dependencies:
>   -> bd-2wt (blocks) - P1-01: Align OPFS layout with PRD


---

## Phase 2 Beads

> ○ bd-b05 · P2-00: Perf/memory regression harness   [● P1 · OPEN]
> Owner: felixhuber · Type: task
> Created: 2026-01-30 · Updated: 2026-01-30
> Labels: performance, phase-2, testing
> 
> Add perf + memory regression harness per Oracle suggestion:
> - Playwright + CDP heap sampling for import/export
> - Wire into CI artifacts
> - Test with 10MB and 100MB fixtures
> - Fail CI if peak heap exceeds budget
> 
> Acceptance Criteria:
> - Import 100MB shows bounded heap (~1MB chunks)
> - Export large DB doesn't OOM
> - CI produces trace + metrics artifacts
> - Threshold violations fail the build
> 
> Verification:
> - npm run test:perf (create)
> - CI artifacts show memory traces
> 
> Files to modify:
> - e2e/perf/ (create)
> - playwright.config.ts
> - package.json (add perf script)

> ○ bd-3ae · P2-05: CSV export NULL vs empty string   [● P1 · OPEN]
> Owner: felixhuber · Type: task
> Created: 2026-01-30 · Updated: 2026-01-30
> Labels: csv, export, phase-2
> 
> Fix CSV export per PRD:
> - NULL => empty unquoted cell
> - Empty string => quoted ""
> - Add formula-injection protection toggle (default ON)
> - BLOB => placeholder with warning
> 
> Acceptance Criteria:
> - Export table with NULL and '' produces correct CSV
> - Formula-injection toggle in export dialog
> - BLOB cells show placeholder, summary shows warning
> 
> Verification:
> - npm test
> 
> Files to modify:
> - src/core/io/csv.ts or export.ts

> ○ bd-25k · P2-02: CSV header normalization per PRD   [● P1 · OPEN]
> Owner: felixhuber · Type: task
> Created: 2026-01-30 · Updated: 2026-01-30
> Labels: csv, import, phase-2
> 
> Fix CSV header normalization to match PRD:
> - Keep spaces (use identifier quoting), not replace with underscore
> - Auto-suffix duplicates case-insensitively (col, col_1, col_2)
> - Use column_N for empty headers
> - Reject non-UTF-8 files
> 
> Acceptance Criteria:
> - Header 'My Column' stays 'My Column' (quoted in SQL)
> - Duplicate 'name', 'Name' becomes 'name', 'Name_1'
> - Empty header becomes 'column_1', 'column_2'
> - Non-UTF-8 file shows error, not imported
> 
> Verification:
> - npm test (csv.test.ts)
> 
> Files to modify:
> - src/core/io/csv.ts:42

> ○ bd-2de · P2-01: Stream SQLite import via SyncAccessHandle   [● P1 · OPEN]
> Owner: felixhuber · Type: task
> Created: 2026-01-30 · Updated: 2026-01-30
> Labels: import, performance, phase-2
> 
> Implement streaming file import per PRD:
> - Stream file to OPFS via SyncAccessHandle in 1MB chunks
> - No full buffering in memory (current streamFileChunks concatenates)
> - Show size warnings (100MB OPFS, 50MB IDB thresholds)
> - Clean up partially created artifacts on error
> 
> Acceptance Criteria:
> - Import 200MB file with <50MB heap usage
> - Size warning shown at threshold
> - Failed imports leave no orphaned files
> 
> Verification:
> - npm test
> - Manual test: import large file, check memory profiler
> 
> Files to modify:
> - src/worker/db-registry.ts
> 
> Dependencies:
>   -> bd-2wt (blocks) - P1-01: Align OPFS layout with PRD

> ○ bd-3t7 · P2-08: Size warnings on open + DB growth   [● P1 · OPEN]
> Owner: felixhuber · Type: task
> Created: 2026-01-30 · Updated: 2026-01-30
> Labels: storage, ux, phase-2
>
> Implement PRD size warnings beyond import:
> - On DB open: if size exceeds threshold, show warning toast once per DB per session
> - In status bar: show persistent warning badge when DB exceeds threshold
> - On DB growth: re-check size after writes/imports; when crossing threshold, show warning + badge
>
> Thresholds (per PRD):
> - OPFS mode: warn when >100MB
> - IndexedDB fallback: warn when >50MB
>
> Acceptance Criteria:
> - Opening a >100MB DB in OPFS mode shows warning + status badge
> - Opening a >50MB DB in IndexedDB mode shows warning + status badge
> - When DB crosses threshold due to edits/import, warning is shown within 1 write cycle and badge appears
> - Warning is not re-shown repeatedly (once per DB per session unless storage mode changes)
>
> Verification:
> - npm test (size-warnings.test.ts)
> - npm run test:e2e -- --grep 'size warning'
>
> Files to modify:
> - src/worker/db-registry.ts (expose db byte size + storage mode)
> - src/features/database/database-context.tsx (toast + status badge wiring)
>
> Dependencies:
>   -> bd-2wt (blocks) - P1-01: Align OPFS layout with PRD

> ○ bd-4z7 · P2-07: Database export quota-exceeded handling   [● P2 · OPEN]
> Owner: felixhuber · Type: task
> Created: 2026-01-30 · Updated: 2026-01-30
> Labels: export, phase-2, robustness
> 
> Handle export when quota exceeded per PRD:
> - Use in-memory backup path when OPFS is full
> - Export should succeed without OPFS/IDB writes
> - Add progress/cancel for large exports
> - Clean up partial artifacts on failure
> 
> Acceptance Criteria:
> - Export succeeds when OPFS quota is 0
> - Progress bar shown for >10MB exports
> - Cancel button stops export
> - Partial exports on failure are cleaned up (no partial download triggered)
> 
> Verification:
> - Manual test with quota simulation
> - Unit test with mocked quota exceeded
> 
> Files to modify:
> - src/worker/db-registry.ts export paths

> ○ bd-2kg · P2-06: JSON export BLOB placeholder format   [● P2 · OPEN]
> Owner: felixhuber · Type: task
> Created: 2026-01-30 · Updated: 2026-01-30
> Labels: export, json, phase-2
> 
> Fix JSON export per PRD:
> - BLOB placeholder should be object format, not 'base64:' prefix
> - Include summary warning for BLOB columns
> 
> Acceptance Criteria:
> - BLOB exports as {"__blob_base64__": "<base64>", "bytes": N}
> - Summary warning shown when BLOBs present
> - Export function returns/tracks count of BLOB fields replaced
> 
> Verification:
> - npm test
> 
> Files to modify:
> - src/core/io/export.ts (exportToJSON function)

> ○ bd-6sr · P2-04: JSON import flat-only enforcement   [● P2 · OPEN]
> Owner: felixhuber · Type: task
> Created: 2026-01-30 · Updated: 2026-01-30
> Labels: import, json, phase-2
> 
> Enforce JSON import rules per PRD:
> - Line numbers in error messages for nested structures (current code uses 'index')
> - Do NOT parse BLOB base64 placeholder (show warning instead)
> 
> Note: Nested structure rejection already exists in json.ts, but error messages need line numbers.
> 
> Acceptance Criteria:
> - Nested object in value shows error with LINE number (not just index)
> - Nested array in value shows error with LINE number
> - BLOB placeholder string imports as TEXT with warning
> - Flat object with primitives imports successfully
> 
> Verification:
> - npm test
> 
> Files to modify:
> - src/core/io/json.ts

> ○ bd-ts6 · P2-03: CSV type inference with leading zeros   [● P2 · OPEN]
> Owner: felixhuber · Type: task
> Created: 2026-01-30 · Updated: 2026-01-30
> Labels: csv, import, phase-2
> 
> Fix type inference per PRD:
> - Values with leading zeros (e.g., '001') must be TEXT not INTEGER
> - Empty quoted field '' => empty string
> - Empty unquoted field => NULL
> 
> Acceptance Criteria:
> - '007' inferred as TEXT
> - CSV row: ,"" parses to [null, '']
> - Type inference tests pass
> 
> Verification:
> - npm test
> 
> Files to modify:
> - src/core/io/csv.ts


---

## Phase 3 Beads

> ○ bd-po6 · P3-00: Shared DDL diff preview component   [● P1 · OPEN]
> Owner: felixhuber · Type: task
> Created: 2026-01-30 · Updated: 2026-01-30
> Labels: phase-3, shared, ux
> 
> Build shared DDL diff preview component per Oracle/PRD:
> - Used by both Table Designer (P3-04) and ERD FK editor (P4-03)
> - Renders: original SQL, proposed SQL, dependent objects summary
> - Single implementation prevents divergence
> 
> Must show per PRD:
> (a) Original CREATE TABLE SQL
> (b) Proposed CREATE TABLE SQL  
> (c) Indexes/triggers/FKs that will be dropped and recreated
> (d) Net-effect summary (e.g., 'Rename column a → a1; 2 indexes recreated')
> 
> Acceptance Criteria:
> - Component accepts before/after SQL + deps list + net-effect summary
> - Renders unified diff format with syntax highlighting
> - Shows affected indexes, triggers, FKs in collapsible list
> - Net-effect summary shown prominently (e.g., 'Rename column a → a1; 2 indexes recreated')
> - Both designer and ERD use same component
> - Rollback failures shown in consistent format
> 
> Verification:
> - npm test (DDLDiffPreview.test.tsx)
> - Unit tests for: diff rendering, deps list rendering, net-effect summary formatting
> - Manual test: open in designer and ERD, verify identical appearance
> 
> Files to modify:
> - src/shared/components/DDLDiffPreview.tsx (create)
> - src/shared/components/DDLDiffPreview.test.tsx (create)
> 
> Dependents:
>   <- bd-1xx (blocks) - P4-03: ERD DDL diff preview
>   <- bd-u9l (blocks) - P3-04: DDL diff preview enhancement

> ○ bd-o24 · P3-02: Pre-flight dependency scan   [● P1 · OPEN]
> Owner: felixhuber · Type: task
> Created: 2026-01-30 · Updated: 2026-01-30
> Labels: phase-3, safety, table-designer
> 
> Implement rebuild guardrails per PRD with TWO-PHASE approach:
> 
> Phase 1 - Pre-flight (best-effort, informational):
> - Scan sqlite_master SQL text for references to target table/column
> - Generate user-facing dependency warning listing affected objects
> - May miss obfuscated references (quoted identifiers, different casing, comments)
> 
> Phase 2 - Post-rebuild verification (authoritative):
> - After rebuild completes within transaction
> - Compile-check ALL user-defined SQL objects from sqlite_master (views, triggers)
> - Run sqlite3_prepare_v2 on each
> - If ANY object fails to compile → rollback entire transaction
> - Show dependency error listing broken objects with their SQL
> 
> Acceptance Criteria:
> - Pre-flight: Rebuild warns about N dependent views/triggers before proceeding
> - Post-rebuild: Failed view/trigger recompile triggers rollback
> - User sees list of affected objects before confirmation
> - On compile failure: error lists broken objects with their SQL
> - Zero silent breakage of dependent objects
> 
> Verification:
> - npm test (rebuild.test.ts, dependency-scan.test.ts)
> - Test: view referencing column, rename column, verify view still compiles
> - Test: view referencing dropped column, verify rollback with error
> 
> Files to modify:
> - src/core/rebuild/plan.ts
> - src/core/rebuild/dependency-scan.ts (create)
> - src/core/rebuild/compile-check.ts (create)
> 
> Dependencies:
>   -> bd-39f (blocks) - P3-01d: Post-rebuild verification + guardrails
>
> Dependents:
>   <- bd-u9l (blocks) - P3-04: DDL diff preview enhancement

> ○ bd-1ig · P3-01a: DDL parser for CREATE TABLE (AST)   [● P1 · OPEN]
> Owner: felixhuber · Type: task
> Created: 2026-01-30 · Updated: 2026-01-30
> Labels: phase-3, schema, table-designer
>
> Build a minimal CREATE TABLE parser for the rebuild engine:
> - Parse sqlite_master.sql CREATE TABLE into an AST
> - Preserve table-level clauses needed by rebuild (CHECK, GENERATED, STRICT, WITHOUT ROWID, AUTOINCREMENT, DEFAULT expr, ON CONFLICT)
> - Provide a serializer that can round-trip without losing clauses (whitespace not preserved)
>
> Acceptance Criteria:
> - Given a CREATE TABLE containing CHECK + GENERATED + WITHOUT ROWID, parser+serializer round-trips and output still contains those clauses
> - Unit tests cover: CHECK, GENERATED, STRICT, WITHOUT ROWID, AUTOINCREMENT
>
> Verification:
> - npm test -- rebuild.ddl-parser.test.ts
>
> Files to modify:
> - src/core/rebuild/ddl-parser.ts (create)
> - src/core/rebuild/ddl-parser.test.ts (create)
>
> Dependencies:
>   (none)
>
> Dependents:
>   <- bd-2gl (blocks) - P3-01b: Apply column add/rename via AST patch
>   <- bd-1ok (blocks) - P3-01c: Apply column drop via AST patch + copy plan

> ○ bd-2gl · P3-01b: Apply column add/rename via AST patch   [● P1 · OPEN]
> Owner: felixhuber · Type: task
> Created: 2026-01-30 · Updated: 2026-01-30
> Labels: phase-3, schema, table-designer
>
> Implement AST patch operations:
> - Add column (schema-only; data copy handled by existing rebuild path)
> - Rename column (schema-only)
>
> Acceptance Criteria:
> - Add column does not remove CHECK/GENERATED/STRICT/WITHOUT ROWID clauses in the resulting CREATE TABLE SQL
> - Rename column does not remove CHECK/GENERATED/STRICT/WITHOUT ROWID clauses in the resulting CREATE TABLE SQL
>
> Verification:
> - npm test -- rebuild.ast-patch-add-rename.test.ts
>
> Files to modify:
> - src/core/rebuild/plan.ts
> - src/core/rebuild/ddl-parser.ts (from bd-1ig)
> - src/core/rebuild/ast-patch.ts (create)
> - src/core/rebuild/ast-patch.test.ts (create)
>
> Dependencies:
>   -> bd-1ig (blocks) - P3-01a: DDL parser for CREATE TABLE (AST)
>
> Dependents:
>   <- bd-39f (blocks) - P3-01d: Post-rebuild verification + guardrails

> ○ bd-1ok · P3-01c: Apply column drop via AST patch + copy plan   [● P1 · OPEN]
> Owner: felixhuber · Type: task
> Created: 2026-01-30 · Updated: 2026-01-30
> Labels: phase-3, schema, table-designer
>
> Implement AST patch for DROP COLUMN rebuild path:
> - Produce new CREATE TABLE SQL with dropped column removed
> - Produce INSERT INTO new_table(...) SELECT ... copy statement excluding dropped column
>
> Acceptance Criteria:
> - Dropping a column preserves table-level clauses (CHECK/GENERATED/STRICT/WITHOUT ROWID) in resulting CREATE TABLE SQL
> - Copy statement excludes dropped column and preserves remaining column order
>
> Verification:
> - npm test -- rebuild.ast-patch-drop.test.ts
>
> Files to modify:
> - src/core/rebuild/plan.ts
> - src/core/rebuild/ast-patch.ts (from bd-2gl)
>
> Dependencies:
>   -> bd-1ig (blocks) - P3-01a: DDL parser for CREATE TABLE (AST)
>
> Dependents:
>   <- bd-39f (blocks) - P3-01d: Post-rebuild verification + guardrails

> ○ bd-39f · P3-01d: Post-rebuild verification + guardrails   [● P1 · OPEN]
> Owner: felixhuber · Type: task
> Created: 2026-01-30 · Updated: 2026-01-30
> Labels: phase-3, schema, table-designer
>
> Add two-tier verification + rollback guardrail per PRD:
> 1. Structural verification via PRAGMAs (table_info, index_list, foreign_key_list)
> 2. Best-effort textual verification for presence of key clauses (CHECK, GENERATED, STRICT, WITHOUT ROWID)
> If verification fails, rollback and show the PRD error message directing to SQL editor.
>
> Acceptance Criteria:
> - Verification catches missing CHECK or GENERATED clause and triggers rollback
> - Unsupported constructs trigger rollback with message: 'This table uses schema features that cannot be safely modified via the visual designer. Use the SQL editor instead.'
>
> Verification:
> - npm test -- rebuild.verification.test.ts
>
> Files to modify:
> - src/core/rebuild/verification.ts (create)
> - src/core/rebuild/verification.test.ts (create)
>
> Dependencies:
>   -> bd-2gl (blocks) - P3-01b: Apply column add/rename via AST patch
>   -> bd-1ok (blocks) - P3-01c: Apply column drop via AST patch + copy plan
>
> Dependents:
>   <- bd-o24 (blocks) - P3-02: Pre-flight dependency scan
>   <- bd-3mp (blocks) - P3-03: Prefer native ALTER TABLE
>   <- bd-3mp (blocks) - P3-03: Prefer native ALTER TABLE

> ○ bd-u9l · P3-04: DDL diff preview enhancement   [● P2 · OPEN]
> Owner: felixhuber · Type: task
> Created: 2026-01-30 · Updated: 2026-01-30
> Labels: phase-3, table-designer, ux
> 
> Enhance DDL diff preview per PRD by integrating shared component:
> - Integrate DDLDiffPreview component from bd-po6
> - Pass data from table designer operations
> - Show original CREATE SQL
> - Show proposed CREATE SQL
> - Show affected indexes/triggers summary
> - Show dependent views that will be affected (from bd-o24 pre-flight scan)
> 
> Acceptance Criteria:
> - Preview modal shows before/after CREATE TABLE using shared DDLDiffPreview
> - List of affected indexes and triggers (collapsible)
> - Warning about dependent views (from dependency scan)
> - Net-effect summary visible
> - Confirm/Cancel buttons with keyboard shortcuts (Enter/Escape)
> 
> Verification:
> - Manual test + npm test
> - Test: column rename shows before/after diff
> - Test: column add with dependent index shows affected index
> 
> Files to modify:
> - src/features/designer/DesignerPreviewModal.tsx (create or modify)
> - src/features/designer/useDesignerPreview.ts (hook for gathering diff data)
> 
> Dependencies:
>   -> bd-po6 (blocks) - P3-00: Shared DDL diff preview component
>   -> bd-o24 (blocks) - P3-02: Pre-flight dependency scan

> ○ bd-3mp · P3-03: Prefer native ALTER TABLE   [● P2 · OPEN]
> Owner: felixhuber · Type: task
> Created: 2026-01-30 · Updated: 2026-01-30
> Labels: optimization, phase-3, table-designer
> 
> Use native ALTER TABLE when safe per PRD (SQLite >= 3.45):
> - Rename column: use ALTER TABLE RENAME COLUMN (correctly propagates to indexes/triggers/views)
> - Drop column: use ALTER TABLE DROP COLUMN when no dependencies
> - Only rebuild when necessary (type changes, FK modifications, dependent objects)
> 
> Decision logic:
> 1. Column rename → always use native ALTER (SQLite handles view/trigger updates)
> 2. Column drop → check if column is referenced by index/FK/trigger/view
>    - If no references → use native ALTER DROP COLUMN
>    - If references exist → use rebuild with dependency handling
> 3. Type change → always rebuild
> 4. FK modification → always rebuild (SQLite limitation)
> 
> Acceptance Criteria:
> - Column rename uses ALTER TABLE, not rebuild (verify via sqlite_master sql unchanged except column name)
> - Drop simple column uses ALTER TABLE (no rebuild step)
> - Rebuild only for type changes or when dependencies exist
> - FK operations always trigger rebuild path
> 
> Verification:
> - npm test
> - Test: rename column, verify single ALTER statement issued
> - Test: drop column with index referencing it, verify rebuild path used
> 
> Files to modify:
> - src/core/rebuild/plan.ts
> - src/core/rebuild/strategy.ts (create - encapsulates native vs rebuild decision)
> 
> Dependencies:
>   -> bd-39f (blocks) - P3-01d: Post-rebuild verification + guardrails


---

## Phase 4 Beads

> ○ bd-2y1 · P4-04: FK creation dialog with action configuration   [● P1 · OPEN]
> Owner: felixhuber · Type: task
> Created: 2026-01-30 · Updated: 2026-01-30
> Labels: erd, fk, phase-4
> 
> Implement FK creation dialog with ON DELETE/UPDATE action configuration per PRD:
> 
> From PRD US-004:
> - ON DELETE/UPDATE actions: Configurable via FK creation dialog (RESTRICT, NO ACTION, CASCADE, SET NULL)
> - Defaults to NO ACTION
> - DEFERRABLE not supported in v1 (uses SQLite default)
> 
> Dialog flow:
> 1. User drags from child column to parent column
> 2. Dialog opens with:
>    - Source table/column (read-only)
>    - Target table/column (read-only)
>    - ON DELETE dropdown: NO ACTION (default), RESTRICT, CASCADE, SET NULL
>    - ON UPDATE dropdown: NO ACTION (default), RESTRICT, CASCADE, SET NULL
>    - Validation status (from bd-qdl)
> 3. User clicks Create → shows DDL preview (bd-1xx) → confirms → executes
> 
> For FK edit (right-click → Edit):
> - Same dialog, pre-populated with current values
> - Shows diff of changes
> 
> Acceptance Criteria:
> - FK creation dialog shows ON DELETE/UPDATE dropdowns
> - Default is NO ACTION for both
> - All four actions available: NO ACTION, RESTRICT, CASCADE, SET NULL
> - SET DEFAULT not shown (requires DEFAULT which complicates UI)
> - FK edit uses same dialog with pre-populated values
> - E2E-US-004-03: Edit FK ON DELETE action, verify pragma reflects change
> 
> Verification:
> - npm test
> - Test: create FK with CASCADE ON DELETE, verify pragma
> - Test: edit FK to change ON DELETE, verify pragma updates
> 
> Files to modify:
> - src/features/erd/FKCreateDialog.tsx (create or enhance)
> - src/features/erd/hooks/useFKCreate.ts (create)
> 
> Dependencies:
>   -> bd-qdl (blocks) - P4-02: FK creation validation
> 
> Dependents:
>   <- bd-1xx (blocks) - P4-03: ERD DDL diff preview

> ○ bd-qdl · P4-02: FK creation validation   [● P1 · OPEN]
> Owner: felixhuber · Type: task
> Created: 2026-01-30 · Updated: 2026-01-30
> Labels: erd, phase-4, validation
> 
> Implement FK validation per PRD:
> 
> Parent column uniqueness check:
> - Parent column must have SINGLE-COLUMN UNIQUE or be SINGLE-COLUMN PK
> - Composite PK/UNIQUE does NOT qualify for v1 single-column FK
> - Error: 'Referenced column must be a single-column PRIMARY KEY or have a UNIQUE index on that column.'
> - One-click 'Create UNIQUE index' action from FK dialog (with DDL preview)
> 
> Existing data validation (NULL-safe anti-join):
> - Sample query: SELECT child.* FROM child LEFT JOIN parent ON child.fk_col = parent.pk_col WHERE child.fk_col IS NOT NULL AND parent.pk_col IS NULL LIMIT 10
> - Count query with same predicate for total violations
> - Progress indicator with cancel for large tables
> - If violations exist: block FK, show error with up to 10 sample rows + total count
> - FK never created in state where enforcement would fail
> 
> Acceptance Criteria:
> - FK to non-unique column shows error with 'Create Index' button
> - FK to composite PK column shows error (composite PK != single-column unique)
> - FK blocked if data violates integrity (shows row count + sample rows)
> - NULL child FK values treated as non-violations
> - Creating index from dialog enables FK creation
> - Progress indicator shown for tables > 10k rows
> 
> Verification:
> - npm test
> - E2E-US-004-05: FK to non-unique blocked, create index, retry works
> - E2E-US-004-06: FK to composite PK column blocked
> 
> Files to modify:
> - src/features/erd/FKValidation.ts (create)
> - src/features/erd/FKCreateDialog.tsx
> - src/features/erd/hooks/useFKValidation.ts (create)
> 
> Dependents:
>   <- bd-2y1 (blocks) - P4-04: FK creation dialog with action configuration

> ○ bd-3vd · P4-01: Composite FK single edge rendering   [● P1 · OPEN]
> Owner: felixhuber · Type: task
> Created: 2026-01-30 · Updated: 2026-01-30
> Labels: erd, fk, phase-4
> 
> Fix composite FK rendering per PRD:
> - Group FK columns by constraint ID (from PRAGMA foreign_key_list, 'id' column groups composite FK rows)
> - Render as single read-only edge per constraint ID
> - Multi-column label showing all FK columns
> 
> Grouping logic:
> - Query: PRAGMA foreign_key_list(table) returns rows with 'id' column
> - Same 'id' value = same FK constraint (composite)
> - Group rows by 'id', collect all column pairs
> 
> Label format for composite FK:
> - Single-column: 'child.col → parent.col'
> - Composite: '(a,b) → (x,y)' or 'child.(a,b) → parent.(x,y)'
> 
> Acceptance Criteria:
> - Composite FK (a,b) -> (x,y) shows as ONE edge (not two)
> - Edge label shows all column pairs in format '(a,b) → (x,y)'
> - Edge is read-only (no inline edit, no drag handles)
> - Single-column FKs render unchanged (one edge, editable)
> - E2E-US-004-01: Composite FKs count as one edge in total count
> 
> Verification:
> - npm test
> - Manual test with Chinook fixture (has composite FKs)
> - Test: create table with composite FK via SQL, verify single edge rendered
> 
> Files to modify:
> - src/features/erd/ForeignKeyEdge.tsx
> - src/features/erd/hooks/useForeignKeys.ts (grouping logic)

> ○ bd-rqg · P4-05: ERD draft state tracking   [● P2 · OPEN]
> Owner: felixhuber · Type: task
> Created: 2026-01-30 · Updated: 2026-01-30
> Labels: erd, lifecycle, phase-4
> 
> Track ERD draft state per PRD (aligns with US-013 Decision 18):
> - Switch database should prompt for unsaved ERD changes
> - Consistent with table designer and query builder behavior
> 
> Draft state includes:
> - Pending FK creation (drag started but not confirmed)
> - FK edit dialog with unsaved changes
> - Table position changes not yet persisted
> 
> Prompt flow (from PRD US-013):
> - If draft changes exist in ERD FK dialog: 'Discard draft changes / Cancel'
> - Same UX as table designer and query builder
> 
> Acceptance Criteria:
> - Unsaved ERD FK dialog changes prompt on DB switch
> - Unsaved table position changes prompt on DB switch
> - Draft indicator shown in ERD toolbar (e.g., dot indicator)
> - Matches designer/query builder prompt UX exactly
> - beforeunload also checks ERD draft state
> 
> Verification:
> - Manual test
> - Test: start FK creation, switch DB, verify prompt
> - Test: move table, switch DB, verify prompt for position changes
> 
> Files to modify:
> - src/features/erd/hooks/useERDDraftState.ts (create)
> - src/features/erd/ERDToolbar.tsx (add draft indicator)
> - src/stores/draftStore.ts (may need to extend for ERD)

> ○ bd-1xx · P4-03: ERD DDL diff preview   [● P2 · OPEN]
> Owner: felixhuber · Type: task
> Created: 2026-01-30 · Updated: 2026-01-30
> Labels: erd, phase-4, ux
> 
> Add DDL diff preview for FK operations per PRD:
> - Integrate shared DDLDiffPreview component from bd-po6
> - Show before/after for FK create/edit/delete
> - Include affected table DDL (child table is rebuilt for FK changes)
> 
> FK operations that need preview:
> - FK create: shows new FK clause added to child table CREATE
> - FK delete: shows FK clause removed from child table CREATE
> - ON DELETE/UPDATE action change: shows clause modification
> 
> Acceptance Criteria:
> - FK create shows diff preview before execution
> - FK delete shows diff preview
> - Preview reuses shared DDLDiffPreview component (same as table designer)
> - Shows rebuild warning (FK changes require child table rebuild)
> - Integrates with FK validation errors (bd-qdl)
> 
> Verification:
> - Manual test
> - Test: create FK, verify preview shows before/after child table DDL
> - Test: delete FK, verify preview shows FK clause removed
> 
> Files to modify:
> - src/features/erd/FKPreviewModal.tsx (create)
> - src/features/erd/hooks/useFKPreview.ts (create)
> 
> Dependencies:
>   -> bd-2y1 (blocks) - P4-04: FK creation dialog with action configuration
>   -> bd-po6 (blocks) - P3-00: Shared DDL diff preview component


---

## Phase 5 Beads

> ○ bd-3ge · P5-00: Shared SQL generation helpers   [● P1 · OPEN]
> Owner: felixhuber · Type: task
> Created: 2026-01-30 · Updated: 2026-01-30
> Labels: phase-5, shared, sql
> 
> Centralize SQL generation helpers per Oracle suggestion:
> - Identifier quoting helper (double-quote identifiers)
> - LIKE escaping with ESCAPE clause (%, _, \)
> - Deterministic column aliasing (Table.Column format)
> - Used by Grid filters AND Query Builder
> 
> Acceptance Criteria:
> - Single helper module for SQL string generation
> - quoteIdentifier() wraps names in double quotes, escapes embedded quotes
> - escapeLikePattern() escapes %, _, \ with backslash
> - generateAlias(table, column) returns 'Table.Column' format
> - Grid filters use shared escaping
> - Query Builder uses shared aliasing
> - Unit tests cover edge cases:
>   - Reserved words (SELECT, TABLE, etc.)
>   - Special chars in identifiers (spaces, quotes)
>   - Unicode identifiers
>   - Empty strings
>   - NULL handling
> 
> Verification:
> - npm test
> 
> Files to modify:
> - src/core/sql/helpers.ts (create)
> - src/features/grid/ (update to use)
> - src/features/query-builder/ (update to use)
> 
> Dependents:
>   <- bd-3v0 (blocks) - P5-03: Filter semantics per PRD
>   <- bd-9kc (blocks) - US-006: Query builder result column aliases

> ○ bd-1x1 · P5-04: Row identity strategy for UPDATE/DELETE   [● P1 · OPEN]
> Owner: felixhuber · Type: task
> Created: 2026-01-30 · Updated: 2026-01-30
> Labels: correctness, grid, phase-5
> 
> Ensure row identity for edits per PRD:
> - Rowid tables: use rowid for UPDATE/DELETE WHERE clause
> - WITHOUT ROWID tables: use PK columns for identity
> - Consistent behavior across grid operations
> 
> Acceptance Criteria:
> - Edit row in rowid table uses rowid in WHERE
> - Edit row in WITHOUT ROWID table uses PK columns
> - Delete operations use same identity strategy
> - Detection logic for WITHOUT ROWID (check sqlite_master.sql for WITHOUT ROWID)
> - Tables with no usable identifier open in read-only mode with banner
> 
> Verification:
> - npm test
> 
> Files to modify:
> - src/features/grid/
> - src/worker/row-update.ts

> ○ bd-3v0 · P5-03: Filter semantics per PRD   [● P1 · OPEN]
> Owner: felixhuber · Type: task
> Created: 2026-01-30 · Updated: 2026-01-30
> Labels: filters, grid, phase-5
> 
> Fix filter behavior per PRD:
> - Text: case-insensitive via lower(col) LIKE lower(?) with ESCAPE
> - Use shared SQL helpers for LIKE escaping (%, _, \)
> - Numeric range filter support (inclusive bounds)
> - NULL toggle (include/exclude NULLs via IS NULL / IS NOT NULL)
> 
> Acceptance Criteria:
> - Filter 'john' matches 'John', 'JOHN' (case-insensitive)
> - Numeric range [10, 20] filters rows where 10 <= col <= 20
> - NULL toggle includes/excludes NULL rows correctly
> - Special chars %, _, \ are escaped using backslash
> - Uses shared escaping helpers from P5-00
> 
> Verification:
> - npm test
> - E2E-US-007-05: literal filter test
> 
> Files to modify:
> - src/features/grid/
> 
> Dependencies:
>   -> bd-3ge (blocks) - P5-00: Shared SQL generation helpers

> ○ bd-1xr · P5-02: Stable ordering with tie-breakers   [● P1 · OPEN]
> Owner: felixhuber · Type: task
> Created: 2026-01-30 · Updated: 2026-01-30
> Labels: correctness, grid, phase-5
> 
> Implement stable ordering per PRD:
> - Rowid tables: ORDER BY <sort>, rowid
> - WITHOUT ROWID tables: ORDER BY <sort>, <PK columns>
> - Ensure consistent row order on refresh
> 
> Acceptance Criteria:
> - Duplicate values in sort column maintain stable order
> - WITHOUT ROWID tables use PK columns as tie-breaker
> - Rowid tables use rowid as tie-breaker
> - Detection logic to identify table type (rowid vs WITHOUT ROWID)
> - PK column order matches PRAGMA table_info pk field
> - Tests verify tie-breaker logic for both table types
> 
> Verification:
> - npm test
> 
> Files to modify:
> - src/core/sql/query-builder.ts
> 
> Dependents:
>   <- bd-149 (blocks) - P5-01: Virtual scrolling grid

> ○ bd-149 · P5-01: Virtual scrolling grid   [● P1 · OPEN]
> Owner: felixhuber · Type: task
> Created: 2026-01-30 · Updated: 2026-01-30
> Labels: grid, performance, phase-5
> 
> Replace Prev/Next pagination with virtual scrolling per PRD:
> - Virtualized scrolling + SQL windowed fetching
> - LIMIT/OFFSET is the default fetch strategy
> - Keyset pagination ONLY when ORDER BY is exactly rowid
> - Remove Prev/Next pagination buttons
> 
> Acceptance Criteria:
> - Grid renders 1M rows smoothly (virtualized)
> - Uses LIMIT/OFFSET for non-rowid sorts
> - Uses keyset only for ORDER BY rowid
> - Scroll position reset to top on filter/sort change
> - Row height is fixed (for virtualization calculation)
> - Uses TanStack Virtual for virtualization
> 
> Verification:
> - npm test
> - Manual test: load large table, scroll
> - E2E-US-007-02: duplicate values sort test
> - E2E-US-007-04: WITHOUT ROWID table test
> 
> Files to modify:
> - src/features/grid/
> 
> Dependencies:
>   -> bd-1xr (blocks) - P5-02: Stable ordering with tie-breakers


---

## Phase 6 Beads

> ○ bd-2c2 · P6-02: Transaction edge case handling   [● P1 · OPEN]
> Owner: felixhuber · Type: task
> Created: 2026-01-30 · Updated: 2026-01-30
> Labels: phase-6, safety, sql-editor
> 
> Handle transaction edge cases per PRD:
> - BEGIN without COMMIT: auto-rollback with warning
> - COMMIT without BEGIN: show SQLite error, stop execution
> - Clear transaction state on errors
> 
> Acceptance Criteria:
> - Orphan BEGIN shows rollback warning
> - COMMIT without BEGIN shows specific error
> - Transaction state tracked per session
> 
> Verification:
> - npm test
> 
> Files to modify:
> - src/features/sql/

> ○ bd-22t · P6-03: sqlite3_stmt_readonly check   [● P2 · OPEN]
> Owner: felixhuber · Type: task
> Created: 2026-01-30 · Updated: 2026-01-30
> Labels: phase-6, safety, sql-editor
> 
> Use SQLite readonly check per PRD:
> - Use sqlite3_stmt_readonly() for read-only mode
> - Replace string-based parser with native check
> 
> Acceptance Criteria:
> - Read-only mode blocks write statements
> - Uses native SQLite check, not regex
> - Error message explains read-only restriction
> 
> Verification:
> - npm test
> 
> Files to modify:
> - src/worker/index.ts (SQL execution entry point)

> ○ bd-zsh · P6-01: Error line/column mapping   [● P2 · OPEN]
> Owner: felixhuber · Type: task
> Created: 2026-01-30 · Updated: 2026-01-30
> Labels: phase-6, sql-editor, ux
> 
> Improve error positioning per PRD:
> - Use statement byte offset to compute line number
> - Map SQLite error to editor cursor position
> - Handle multi-byte UTF-8 characters correctly
> 
> Acceptance Criteria:
> - Syntax error on line 5 highlights line 5
> - Error message shows correct line:col
> - Works with multi-statement queries
> - Correctly counts newlines before the byte offset
> - UTF-8 aware: byte offset converted to character offset for editor
> 
> Verification:
> - npm test
> 
> Files to modify:
> - src/features/sql/


---

## Phase 7 Beads

> ○ bd-3u2 · P7-03: Security E2E tests   [● P1 · OPEN]
> Owner: felixhuber · Type: task
> Created: 2026-01-30 · Updated: 2026-01-30
> Labels: e2e, phase-7, security
> 
> Add PRD-specified security E2E tests:
> - E2E-SEC-01: XSS prevention test (cell value and table name with script tags)
> - E2E-SEC-02: CSP workflow test (full workflow with CSP enabled, no violations)
> 
> Acceptance Criteria:
> - E2E test for XSS: seed DB with `<img src=x onerror=alert(1)>` cell value and `<script>alert(2)</script>` table name; verify no script executes, UI shows escaped text
> - E2E test for CSP: production build with CSP enabled, run full workflow (load DB, edit, import, export, ERD, query), verify zero CSP violations in console
> - All SEC tests passing
> 
> Verification:
> - npm run test:e2e -- --grep 'E2E-SEC-01|E2E-SEC-02'
>
> Files to modify:
> - e2e/security.spec.ts (create)
>
> Dependencies:
>   -> bd-hws (blocks) - P7-01: CSP implementation

> ○ bd-hws · P7-01: CSP implementation   [● P1 · OPEN]
> Owner: felixhuber · Type: task
> Created: 2026-01-30 · Updated: 2026-01-30
> Labels: phase-7, pwa, security
> 
> Implement Content Security Policy per PRD:
> - Add CSP meta tag for dev
> - Document header requirement for production
> - Strict CSP blocking inline scripts
> 
> Acceptance Criteria:
> - CSP meta tag in index.html
> - script-src includes 'wasm-unsafe-eval' for WASM
> - worker-src includes 'self' and 'blob:' for workers
> - No inline script violations
> - Documentation for production header (frame-ancestors 'none')
> 
> Verification:
> - npm run build
> - Browser devtools shows CSP active
> - E2E-SEC-02: full workflow with CSP enabled
> 
> Files to modify:
> - index.html
> - docs/deployment.md (if exists)

> ○ bd-1fx · P7-02: Offline guarantee verification   [● P2 · OPEN]
> Owner: felixhuber · Type: task
> Created: 2026-01-30 · Updated: 2026-01-30
> Labels: offline, phase-7, pwa
> 
> Verify offline guarantee per PRD:
> - No runtime network calls after first load
> - Only SW update checks allowed
> - Audit NetworkFirst vs CacheFirst usage
> 
> Acceptance Criteria:
> - App works fully offline after first load
> - Network panel shows only SW update checks
> - CDN assets use CacheFirst
> - WASM binary, CodeMirror workers, fonts all precached
> - SW precache manifest includes all required assets
> 
> Verification:
> - Manual test: load, go offline, test all features
> - E2E-US-011-01: offline workflow test
> 
> Files to modify:
> - vite.config.ts (VitePWA config)


---

## Phase 8 Beads

> ○ bd-1jc · P8-02a: E2E fill — Table designer rebuild safety   [● P2 · OPEN]
> Owner: felixhuber · Type: task
> Created: 2026-01-30 · Updated: 2026-01-30
> Labels: e2e, phase-8, us-003
>
> Implement missing Table Designer E2E scenarios:
> - E2E-US-003-02 (preserve indexes/triggers/FKs on rename)
> - E2E-US-003-03 (forced rebuild failure rolls back)
>
> Acceptance Criteria:
> - Both E2E-US-003-02 and E2E-US-003-03 exist and pass in CI
>
> Verification:
> - npm run test:e2e -- --grep 'E2E-US-003-02|E2E-US-003-03'
>
> Files to modify:
> - e2e/designer.spec.ts (create or update)
>
> Dependencies:
>   -> bd-3l1 (blocks) - P8-01: E2E coverage audit

> ○ bd-2zh · P8-02b: E2E fill — Table designer dependency + schema features   [● P2 · OPEN]
> Owner: felixhuber · Type: task
> Created: 2026-01-30 · Updated: 2026-01-30
> Labels: e2e, phase-8, us-003
>
> Implement missing Table Designer E2E scenarios:
> - E2E-US-003-05 (drop referenced column rolls back with dependency error)
> - E2E-US-003-06 (CHECK + GENERATED preserved after rename)
>
> Acceptance Criteria:
> - Both E2E-US-003-05 and E2E-US-003-06 exist and pass in CI
>
> Verification:
> - npm run test:e2e -- --grep 'E2E-US-003-05|E2E-US-003-06'
>
> Files to modify:
> - e2e/designer.spec.ts (create or update)
>
> Dependencies:
>   -> bd-3l1 (blocks) - P8-01: E2E coverage audit

> ○ bd-2v4 · P8-02c: E2E fill — ERD FK create/edit/delete   [● P2 · OPEN]
> Owner: felixhuber · Type: task
> Created: 2026-01-30 · Updated: 2026-01-30
> Labels: e2e, phase-8, us-004
>
> Implement missing ERD E2E scenarios:
> - E2E-US-004-02 (FK create preserves data + index/trigger)
> - E2E-US-004-03 (edit ON DELETE action)
> - E2E-US-004-04 (delete FK preserves index/trigger)
>
> Acceptance Criteria:
> - E2E-US-004-02/03/04 exist and pass in CI
>
> Verification:
> - npm run test:e2e -- --grep 'E2E-US-004-02|E2E-US-004-03|E2E-US-004-04'
>
> Files to modify:
> - e2e/erd.spec.ts (create or update)
>
> Dependencies:
>   -> bd-3l1 (blocks) - P8-01: E2E coverage audit

> ○ bd-325 · P8-02d: E2E fill — SQL editor transactions   [● P2 · OPEN]
> Owner: felixhuber · Type: task
> Created: 2026-01-30 · Updated: 2026-01-30
> Labels: e2e, phase-8, us-005
>
> Implement missing SQL editor E2E scenarios:
> - E2E-US-005-02 (multi-statement script shows DML + SELECT)
> - E2E-US-005-03 (mid-script error rolls back)
> - E2E-US-005-04 (explicit BEGIN then error rolls back)
> - E2E-US-005-05 (BEGIN without COMMIT auto-rollback warning)
>
> Acceptance Criteria:
> - E2E-US-005-02/03/04/05 exist and pass in CI
>
> Verification:
> - npm run test:e2e -- --grep 'E2E-US-005-02|E2E-US-005-03|E2E-US-005-04|E2E-US-005-05'
>
> Files to modify:
> - e2e/sql-editor.spec.ts (create or update)
>
> Dependencies:
>   -> bd-zsh (blocks) - P6-01: Error line/column mapping
>   -> bd-2c2 (blocks) - P6-02: Transaction edge case handling

> ○ bd-1rm · P8-02e: E2E fill — Query builder deterministic output   [● P2 · OPEN]
> Owner: felixhuber · Type: task
> Created: 2026-01-30 · Updated: 2026-01-30
> Labels: e2e, phase-8, us-006
>
> Implement missing Query Builder E2E scenarios:
> - E2E-US-006-01 (deterministic SQL + params)
> - E2E-US-006-02 (block duplicate table; unique result headers)
>
> Acceptance Criteria:
> - E2E-US-006-01/02 exist and pass in CI
>
> Verification:
> - npm run test:e2e -- --grep 'E2E-US-006-01|E2E-US-006-02'
>
> Files to modify:
> - e2e/query-builder.spec.ts (create or update)
>
> Dependencies:
>   -> bd-3l1 (blocks) - P8-01: E2E coverage audit

> ○ bd-xki · P8-02f: E2E fill — Grid edits + BLOB/generated columns   [● P2 · OPEN]
> Owner: felixhuber · Type: task
> Created: 2026-01-30 · Updated: 2026-01-30
> Labels: e2e, phase-8, us-007
>
> Implement missing Grid E2E scenarios:
> - E2E-US-007-01 (cell edit persists)
> - E2E-US-007-03 (Add row required-fields UI)
> - E2E-US-007-06 (Save BLOB as file)
> - E2E-US-007-07 (generated columns read-only)
>
> Acceptance Criteria:
> - E2E-US-007-01/03/06/07 exist and pass in CI
>
> Verification:
> - npm run test:e2e -- --grep 'E2E-US-007-01|E2E-US-007-03|E2E-US-007-06|E2E-US-007-07'
>
> Files to modify:
> - e2e/grid.spec.ts (create or update)
>
> Dependencies:
>   -> bd-3l1 (blocks) - P8-01: E2E coverage audit

> ○ bd-1he · P8-02g: E2E fill — CSV/JSON import rules   [● P2 · OPEN]
> Owner: felixhuber · Type: task
> Created: 2026-01-30 · Updated: 2026-01-30
> Labels: e2e, phase-8, us-008
>
> Implement missing Import E2E scenarios:
> - E2E-US-008-01 (import 100-row CSV; column names match)
> - E2E-US-008-02 (NULL vs empty-string round-trip via export+re-import)
> - E2E-US-008-06 (header normalization: "", Name, name, select)
>
> Acceptance Criteria:
> - E2E-US-008-01/02/06 exist and pass in CI
>
> Verification:
> - npm run test:e2e -- --grep 'E2E-US-008-01|E2E-US-008-02|E2E-US-008-06'
>
> Files to modify:
> - e2e/import.spec.ts (create or update)
>
> Dependencies:
>   -> bd-3l1 (blocks) - P8-01: E2E coverage audit

> ○ bd-ljh · P8-02h: E2E fill — Import failure rollback messaging   [● P2 · OPEN]
> Owner: felixhuber · Type: task
> Created: 2026-01-30 · Updated: 2026-01-30
> Labels: e2e, phase-8, us-008
>
> Implement missing Import E2E scenarios:
> - E2E-US-008-03 (append missing NOT NULL column fails; 0 rows committed)
> - E2E-US-008-04 (append UNIQUE violation fails; 0 rows committed)
>
> Acceptance Criteria:
> - E2E-US-008-03/04 exist and pass in CI
>
> Verification:
> - npm run test:e2e -- --grep 'E2E-US-008-03|E2E-US-008-04'
>
> Files to modify:
> - e2e/import.spec.ts (create or update)
>
> Dependencies:
>   -> bd-3l1 (blocks) - P8-01: E2E coverage audit

> ○ bd-3sd · P8-02i: E2E fill — Export quota exceeded snapshot   [● P2 · OPEN]
> Owner: felixhuber · Type: task
> Created: 2026-01-30 · Updated: 2026-01-30
> Labels: e2e, phase-8, us-009
>
> Implement missing Export E2E scenario:
> - E2E-US-009-02 (quota exceeded → Download Database still downloads valid snapshot)
>
> Acceptance Criteria:
> - E2E-US-009-02 exists and passes in CI
>
> Verification:
> - npm run test:e2e -- --grep 'E2E-US-009-02'
>
> Files to modify:
> - e2e/export.spec.ts (create or update)
>
> Dependencies:
>   -> bd-3l1 (blocks) - P8-01: E2E coverage audit

> ○ bd-2lw · P8-02j: E2E fill — OPFS multi-tab lock   [● P2 · OPEN]
> Owner: felixhuber · Type: task
> Created: 2026-01-30 · Updated: 2026-01-30
> Labels: e2e, phase-8, us-010
>
> Implement missing OPFS persistence E2E scenario:
> - E2E-US-010-03 (Web Locks: second tab read-only; close writer; retry → editable)
>
> Acceptance Criteria:
> - E2E-US-010-03 exists and passes in CI
>
> Verification:
> - npm run test:e2e -- --grep 'E2E-US-010-03'
>
> Files to modify:
> - e2e/opfs-lock.spec.ts (create or update)
>
> Dependencies:
>   -> bd-3l1 (blocks) - P8-01: E2E coverage audit

> ○ bd-8se · P8-02k: E2E fill — Sidebar multi-DB switching stress   [● P2 · OPEN]
> Owner: felixhuber · Type: task
> Created: 2026-01-30 · Updated: 2026-01-30
> Labels: e2e, phase-8, us-012
>
> Implement missing Sidebar E2E scenario:
> - E2E-US-012-02 (switch DBs 20x; non-active collapsed; no memory trend upward)
>
> Acceptance Criteria:
> - E2E-US-012-02 exists and passes in CI (functional assertions; memory trend assertion can be Chromium-only)
>
> Verification:
> - npm run test:e2e -- --grep 'E2E-US-012-02'
>
> Files to modify:
> - e2e/sidebar.spec.ts (create or update)
>
> Dependencies:
>   -> bd-3l1 (blocks) - P8-01: E2E coverage audit

> ○ bd-2as · P8-02l: E2E fill — DB lifecycle rename/delete/switch   [● P2 · OPEN]
> Owner: felixhuber · Type: task
> Created: 2026-01-30 · Updated: 2026-01-30
> Labels: e2e, phase-8, us-013
>
> Implement missing DB lifecycle E2E scenarios:
> - E2E-US-013-01 (rename persists + query history migrated)
> - E2E-US-013-02 (delete removes .sqlite + .erd.json + registry entry)
> - E2E-US-013-03 (switch with in-progress cell edit prompts; discard → not persisted)
>
> Acceptance Criteria:
> - E2E-US-013-01/02/03 exist and pass in CI
>
> Verification:
> - npm run test:e2e -- --grep 'E2E-US-013-01|E2E-US-013-02|E2E-US-013-03'
>
> Files to modify:
> - e2e/lifecycle.spec.ts (create or update)
>
> Dependencies:
>   -> bd-3l1 (blocks) - P8-01: E2E coverage audit

> ○ bd-758 · P8-02m: E2E fill — IndexedDB fallback switch/rename   [● P2 · OPEN]
> Owner: felixhuber · Type: task
> Created: 2026-01-30 · Updated: 2026-01-30
> Labels: e2e, phase-8, us-013, idb
>
> Implement missing IndexedDB fallback E2E scenarios:
> - E2E-US-013-04 (IDB mode: edit then switch awaits snapshot; persisted after refresh)
> - E2E-US-013-06 (IDB mode: rename x→y; refresh; only y exists; IDB store keyed y)
>
> Acceptance Criteria:
> - E2E-US-013-04/06 exist and pass in CI (WebKit/Firefox optional; Chromium required)
>
> Verification:
> - npm run test:e2e -- --grep 'E2E-US-013-04|E2E-US-013-06'
>
> Files to modify:
> - e2e/lifecycle-idb.spec.ts (create or update)
>
> Dependencies:
>   -> bd-3l1 (blocks) - P8-01: E2E coverage audit

> ○ bd-3l1 · P8-01: E2E coverage audit   [● P2 · OPEN]
> Owner: felixhuber · Type: task
> Created: 2026-01-30 · Updated: 2026-01-30
> Labels: coverage, e2e, phase-8
> 
> Cross-check Playwright specs against PRD E2E IDs:
> - List all PRD E2E scenarios
> - Map to existing specs
> - Identify gaps
> 
> Acceptance Criteria:
> - Coverage matrix documented
> - All PRD E2E IDs mapped or marked missing
> - Priority list for missing tests
> 
> Verification:
> - Review coverage report
>
> Files to modify:
> - e2e/ (audit existing)
>
> Dependents:
>   <- bd-1jc..bd-758 (blocks) - P8-02a..P8-02m: E2E fill beads


---

## Non-Phase Beads (User Stories)

> ○ bd-9kc · US-006: Query builder result column aliases   [● P2 · OPEN]
> Owner: felixhuber · Type: task
> Created: 2026-01-30 · Updated: 2026-01-30
> Labels: query-builder, us-006, ux
> 
> Fix query builder column labels per PRD:
> - Use deterministic aliases: "Table"."Column" AS "Table.Column"
> - Use shared SQL helpers for aliasing and escaping
> - WHERE semantics: escape %, _, \ with ESCAPE '\\'
> 
> Acceptance Criteria:
> - Multi-table query has unique column aliases
> - Special chars in LIKE conditions are escaped via shared helpers
> - No duplicate column names in results
> - Column names are always double-quoted
> - Same table cannot be added twice (no self-joins in v1)
> 
> Verification:
> - npm test
> - E2E-US-006-01: deterministic SQL output test
> - E2E-US-006-02: duplicate column name test
> 
> Files to modify:
> - src/features/query-builder/
> 
> Dependencies:
>   -> bd-3ge (blocks) - P5-00: Shared SQL generation helpers

> ○ bd-orj · US-012: Sidebar filter behavior   [● P3 · OPEN]
> Owner: felixhuber · Type: task
> Created: 2026-01-30 · Updated: 2026-01-30
> Labels: sidebar, us-012, ux
> 
> Verify sidebar filter per PRD:
> - Substring highlight in results
> - Preserve expansion state on Escape
> - IndexedDB switch: flush and block until commit
> 
> Acceptance Criteria:
> - Filter highlights matching substring (case-insensitive)
> - Escape preserves tree expansion state
> - IDB switch shows loading until commit complete
> - Non-active DBs show name only (collapsed)
> - Switching DBs runs unsaved-change check
> 
> Verification:
> - Manual test
> - E2E-US-012-01: filter and Escape test
> 
> Files to modify:
> - src/features/sidebar/

