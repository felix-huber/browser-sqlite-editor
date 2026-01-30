# 04 - PRD Gap Plan (Implementation Delta)

## Summary
The core product surface exists (open/create DB, grid, SQL editor, table designer, ERD, query builder, import/export, persistence, PWA). However, multiple PRD requirements are only partially implemented or diverge from the spec (storage layout, streaming import, schema rebuild fidelity, ERD FK validation, grid data semantics, CSV/JSON interchange rules, and security/offline guarantees). This plan enumerates the remaining gaps and proposes a staged approach to close them.

## Gap Inventory (by PRD section)

### US-001: Load existing SQLite database
Confirmed gaps:
- OPFS import path and storage layout do not match the PRD spec (currently `/sqlite-editor` root; no `/databases/` subdir or `.erd.json` sidecar path).
- Import pipeline buffers full file in memory (`streamFileChunks` concatenates chunks) instead of streaming directly into OPFS with `SyncAccessHandle` and bounded heap usage.
- File-name preservation and naming rules differ (current filename sanitizes to lowercase + underscores; PRD requires case-preserving display name and suffixing on collision).
- Case-insensitive name collision handling is not enforced in registry; PRD requires it for import/rename.
- Size warnings and mode-specific thresholds (100MB OPFS, 50MB IDB) are not clearly enforced on import/open and in status bar.
- Error handling for invalid/unsupported files should guarantee cleanup of partially created OPFS/IDB artifacts.

### US-002: Create new database
Confirmed gaps:
- Database naming rules in code differ from PRD (length 255 vs 64, different allowed characters, no case-insensitive collision checks).
- Rename should migrate ERD layout sidecar and query history; query history migration exists, ERD sidecar does not (layout is stored in localStorage).

### US-003: Visual table designer
Confirmed gaps:
- Rebuild fidelity: table rebuild uses generated DDL from `ColumnDefinition` and does **not** preserve advanced schema features listed in PRD (CHECK, composite PK/UNIQUE, COLLATE, GENERATED, STRICT, WITHOUT ROWID, DEFAULT expressions, ON CONFLICT clauses).
- PRD-required guardrails (pre-flight dependency scan + post-rebuild compile verification for views/triggers) are only partially implemented (rebuild plan exists but the CREATE SQL used may already have dropped clauses).
- Prefer native ALTER TABLE (rename/drop) only when safe; current logic does not explicitly choose native alter when available for rename/drop in all cases.
- DDL diff preview should include original CREATE SQL, proposed CREATE SQL, and affected indexes/triggers summary; current preview focuses on column deltas and does not include full schema preservation or dependent objects.

### US-004: Relationship editor (ERD)
Confirmed gaps:
- Composite FK rendering: current edge creation is per-column and does not group composite FKs into a single edge with multi-column label. PRD requires composite FKs be rendered read-only.
- FK creation validation is incomplete:
  - Parent column uniqueness check allows composite PK columns; PRD requires single-column PK or unique index on that column only.
  - No data validation (anti-join check) before creating FK; PRD requires blocking creation if existing data violates referential integrity.
  - No one-click creation of UNIQUE index for parent column from the FK dialog.
- No DDL diff preview for FK create/edit/delete (PRD requires same diff component as table designer).
- ERD layout persistence uses localStorage (`erd-layout:`) instead of OPFS sidecar `<db>.erd.json` and does not update on rename/delete per PRD.

### US-005: SQL query editor
Confirmed gaps:
- Error line/column mapping uses SQLite error parsing only; PRD requires mapping via statement byte offset to compute line number reliably.
- Explicit transaction edge cases are not handled:
  - `BEGIN` without `COMMIT` should auto-rollback with warning.
  - `COMMIT` without `BEGIN` should surface the SQLite error and stop execution (currently generic).
- PRD requires `sqlite3_stmt_readonly()` checks per statement in read-only mode; current check is a string-based parser (safer to align with PRD).

### US-006: Visual query builder
Confirmed gaps:
- Result column labels: PRD requires deterministic aliases `"Table"."Column" AS "Table.Column"` to avoid duplicate column names; current SQL selects `alias.column` without renaming.
- WHERE semantics: PRD requires escaping `%`, `_`, `\` with `ESCAPE '\\'` and consistent param handling; ensure exact match to PRD's rules.

### US-007: Data grid with inline editing
Confirmed gaps:
- PRD requires virtual scrolling without pagination; current implementation paginates with LIMIT/OFFSET and uses Prev/Next.
- Stable ordering rules are missing:
  - Rowid tables need tie-breaker `ORDER BY <sort>, rowid`.
  - WITHOUT ROWID tables need tie-breaker on PK columns.
- Filter semantics do not match PRD:
  - Text filters should be case-insensitive using `lower(col) LIKE lower(?)` with ESCAPE; current SQL uses `LIKE` without `lower()`.
  - Numeric range and NULL toggle requirements are not implemented as described.

### US-008: Import CSV and JSON
Confirmed gaps:
- CSV header normalization does not match PRD:
  - PRD keeps spaces (with identifier quoting), auto-suffixes duplicates case-insensitively, and uses `column_N` for empties; current code replaces spaces with underscores and does not handle duplicates per spec.
- Type inference does not account for leading zeros (e.g., `"001"` must be TEXT); current logic treats these as integers.
- Empty quoted fields vs NULL are not preserved (PRD requires `""` => empty string, empty unquoted => NULL).
- CSV encoding validation for UTF-8 (reject non-UTF-8) is not implemented.
- JSON import should reject nested structures (partially done) and must not accept BLOB base64 placeholder; current import path allows base64 decoding into BLOBs.

### US-009: Export database and data
Confirmed gaps:
- CSV export must preserve NULL vs empty string (NULL => empty unquoted, empty string => ""); current export coerces `null` to empty string.
- CSV export must include formula-injection protection toggle (default ON); not implemented.
- JSON export format should use object form for BLOB placeholders; current format uses `base64:` string prefix.
- Export progress/cancel for large exports is missing.
- Quota-exceeded contract: export should succeed without OPFS/IDB writes by using in-memory backup; current export uses VACUUM INTO OPFS or reads OPFS file (may fail in quota-full scenarios).

### US-010: OPFS persistence
Confirmed gaps:
- Storage layout mismatches PRD (no `/databases/` subdir, no `<db>.erd.json` sidecars).
- Registry self-heal behavior (case-collision resolution) not implemented.
- Journal mode DELETE requirement not explicitly enforced (need to confirm current engine settings).
- Read-only enforcement uses UI guards; ensure SQLite connection is opened with `SQLITE_OPEN_READONLY` when needed (verify in engine open path).

### US-011: PWA / offline
Confirmed gaps:
- No explicit CSP enforcement documented or configured (PRD requires strict CSP header/meta).
- Offline guarantee: service worker runtime caching includes NetworkFirst for HTML and CacheFirst for CDN; verify no runtime network calls after first load and align with PRD requirement that only SW update checks are allowed.

### US-012: Sidebar navigator
Confirmed gaps:
- Filter behavior requirements (substring highlight, preserve expansion state on escape) should be verified; update if not matching PRD.
- IndexedDB switch contract (flush and block until commit) should be verified; if not, implement per PRD.

### US-013: Database lifecycle (rename/delete/switch)
Confirmed gaps:
- Rename/delete should update/remove ERD layout sidecar in OPFS; currently stored in localStorage.
- Switch should prompt for drafts in Table Designer / ERD / Query Builder (implemented for designer/query builder; ERD draft state not tracked).

### Security & Trust Model
Confirmed gaps:
- CSP not implemented (no meta tag or server header config).
- E2E-SEC tests are not present or not aligned with PRD criteria.

## Implementation Plan (No code changes yet)

### Phase 1 - Storage layout and naming compliance
1) Align OPFS layout with PRD: `/wasm-sqlite-editor/registry.json` and `/databases/*.sqlite` + `<db>.erd.json` sidecars. Update all registry/read/write/import/export paths accordingly.
2) Enforce PRD naming rules (1-64 chars, allowed characters list, case-insensitive collisions). Update validation, rename, import name suffixing, and registry lookups.
3) Implement registry self-heal (scan OPFS directory, handle case-collision resolution, clean orphaned sidecars).

### Phase 2 - Import/export correctness
1) SQLite file import: stream file to OPFS via `SyncAccessHandle` in 1MB chunks without full buffering; show size warnings; clean up on error.
2) CSV import: implement header normalization per PRD, duplicate handling, leading-zero detection, UTF-8 validation, and correct empty string vs NULL handling.
3) JSON import: enforce flat objects, reject nested structures, do not parse BLOB placeholder (show warning).
4) CSV export: implement NULL vs empty string encoding and formula-injection toggle; ensure BLOB placeholders and summary warnings.
5) JSON export: change BLOB placeholder format to object, include summary warning.
6) Database export: implement in-memory backup path for quota-exceeded; avoid OPFS writes when storage is full.

### Phase 3 - Table designer + rebuild fidelity
1) Generate new CREATE TABLE by parsing existing `sqlite_master.sql` and applying diff, preserving CHECK/STRICT/GENERATED/etc.
2) Implement rebuild guardrails: pre-flight dependency scan, post-rebuild compile-check for views/triggers, and rollback on failure.
3) Ensure native ALTER TABLE for rename/drop when safe; otherwise rebuild with dependency analysis.
4) Enhance DDL diff preview to show original and proposed CREATE TABLE SQL and dependent objects summary.

### Phase 4 - ERD feature parity
1) Composite FK support: group by constraint id, render as a single read-only edge with multi-column label.
2) Validation: enforce single-column uniqueness only; add "create unique index" action.
3) Pre-create data validation with anti-join + progress/cancel; block FK creation when violations exist.
4) Add DDL diff preview for FK create/edit/delete (shared component).
5) Move ERD layout persistence to OPFS sidecar and update on rename/delete.

### Phase 5 - Grid correctness and performance
1) Replace pagination with virtualized infinite scrolling backed by keyset pagination where applicable (rowid sort), and stable tie-breakers for non-rowid sorts.
2) Implement filter semantics per PRD (case-insensitive text, numeric range, NULL toggle) with deterministic SQL.
3) Ensure row identity strategy is applied for UPDATE/DELETE consistently for rowid/WITHOUT ROWID.

### Phase 6 - SQL editor semantics
1) Add statement offset to line/column mapping for errors.
2) Implement explicit transaction edge cases (auto-rollback + warnings).
3) Use `sqlite3_stmt_readonly()` in read-only mode to block write statements (in addition to current guards).

### Phase 7 - PWA and Security
1) Implement CSP (meta for dev; document header requirement for production).
2) Verify offline guarantee and remove/adjust runtime caching that violates PRD constraints.
3) Add PRD-specified security E2E tests (E2E-SEC-01/02).

### Phase 8 - E2E coverage alignment
1) Cross-check existing Playwright specs against PRD E2E IDs.
2) Add missing E2E scenarios for all PRD acceptance criteria not covered (US-003 through US-013 specifics, plus SEC tests).

## Notes / Assumptions
- Some PRD items may already be partially implemented; each phase should begin with a verification pass to avoid duplicating work.
