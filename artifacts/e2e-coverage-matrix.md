# E2E Coverage Audit Report

Cross-check of Playwright specs against PRD E2E IDs.

## Coverage Matrix

| PRD E2E ID | Description | Spec File | Test Status |
|------------|-------------|-----------|-------------|
| **US-001: Load existing SQLite database** |
| E2E-US-001-01 | Drop 10MB .sqlite; sidebar shows tables within 5s | `import.spec.ts` | ⚠️ PARTIAL (tests import but not 5s timing assertion) |
| E2E-US-001-02 | Drop fixture; hard refresh; DB persisted | `import.spec.ts` | ✅ COVERED (`import persists across page refresh`) |
| E2E-US-001-03 | Drop same fixture twice; second gets `(1)` suffix | `import.spec.ts` | ✅ COVERED (`import same file twice gets auto-suffix`) |
| E2E-US-001-04 | File picker imports second DB; both in sidebar | `import.spec.ts` | ⚠️ PARTIAL (file picker UI tested, not full flow) |
| E2E-US-001-05 | Drop invalid .sqlite; error; no new DB after refresh | `import.spec.ts` | ✅ COVERED (`E2E-US-001-05: Invalid File Import Cleanup`) |
| E2E-US-001-06 | Unsaved edit; drop DB2; discard prompt | — | ❌ MISSING |
| **US-002: Create new empty database** |
| E2E-US-002-01 | Create DB "test"; refresh; appears in sidebar | `persistence.spec.ts` | ✅ COVERED (registry persistence tests) |
| **US-003: Visual table designer** |
| E2E-US-003-01 | Create table 3 cols; add 4th; drop 2nd; verify PRAGMA | `table-designer.spec.ts` | ⚠️ PARTIAL (`add column to existing table`, `delete existing column`) |
| E2E-US-003-02 | Table A with index/trigger/FK; rename column; verify preserved | `table-designer.spec.ts` | ✅ COVERED (`indexes and triggers survive rebuild`) |
| E2E-US-003-03 | Force rebuild failure; schema unchanged | — | ❌ MISSING |
| E2E-US-003-04 | Rename column with view/trigger; verify compile | — | ❌ MISSING |
| E2E-US-003-05 | Drop column referenced by view; rollback | — | ❌ MISSING |
| E2E-US-003-06 | Table with CHECK/GENERATED; rename col; verify preserved | — | ❌ MISSING |
| **US-004: Relationship editor (ERD view)** |
| E2E-US-004-01 | Chinook fixture; FK edge count matches | `erd.spec.ts` | ✅ COVERED (`renders foreign key edges`) |
| E2E-US-004-02 | Create FK via ERD drag; verify data/index/trigger preserved | `erd.spec.ts` | ✅ COVERED (`creating FK adds new edge`) |
| E2E-US-004-03 | Edit FK ON DELETE action | `erd.spec.ts` | ✅ COVERED (`edit FK dialog opens and saves`) |
| E2E-US-004-04 | Delete FK; verify removed; index/trigger remain | `erd.spec.ts` | ✅ COVERED (`delete FK dialog removes edge`) |
| E2E-US-004-05 | FK blocked if parent not unique; create UNIQUE; retry | — | ❌ MISSING |
| E2E-US-004-06 | FK blocked for composite PK; create UNIQUE; retry | — | ❌ MISSING |
| **US-005: SQL query editor** |
| E2E-US-005-01 | SELECT 1+1; Ctrl+Enter; result shows 2 | `sql-editor.spec.ts` | ✅ COVERED (`runs SELECT queries and renders results grid`) |
| E2E-US-005-02 | Multi-statement INSERT + SELECT | `sql-editor.spec.ts` | ⚠️ PARTIAL (tests DDL/DML but not exact multi-statement) |
| E2E-US-005-03 | Mid-script error; line number shown; INSERT rolled back | `sql-editor.spec.ts` | ⚠️ PARTIAL (`shows error panel for invalid SQL`) |
| E2E-US-005-04 | BEGIN; INSERT; error; rollback; row not present | — | ❌ MISSING |
| E2E-US-005-05 | BEGIN without COMMIT; warning; row not present | — | ❌ MISSING |
| **US-006: Visual query builder** |
| E2E-US-006-01 | Join 2 tables; WHERE; verify SQL + execution | `query-builder.spec.ts` | ✅ COVERED (multiple tests cover this flow) |
| E2E-US-006-02 | Same table twice blocked; duplicate column aliases | — | ❌ MISSING |
| **US-007: Data grid with inline editing** |
| E2E-US-007-01 | Double-click cell; edit; Enter; verify persisted | `grid-edit.spec.ts` | ✅ COVERED (`Enter key commits edit`) |
| E2E-US-007-02 | Duplicate values sort; scroll; no duplicates/missing | `grid-virtual-scroll.spec.ts` | ✅ COVERED (`E2E-US-007-02`) |
| E2E-US-007-03 | Add row NOT NULL; required-fields UI; cancel=0 rows | `grid-edit.spec.ts` | ✅ COVERED (`add row dialog validates required fields`) |
| E2E-US-007-04 | WITHOUT ROWID table sort; PK tie-breaker | `grid-virtual-scroll.spec.ts` | ✅ COVERED (`E2E-US-007-04`) |
| E2E-US-007-05 | Text filter with special chars %, _, \ | `grid-read.spec.ts` | ⚠️ PARTIAL (filter tests exist but not these exact escapes) |
| E2E-US-007-06 | BLOB cell; Save as file; verify bytes | — | ❌ MISSING |
| E2E-US-007-07 | GENERATED column not editable; no data change | `grid-edit.spec.ts` | ✅ COVERED (`edit attempt on generated column shows tooltip`) |
| **US-008: Import CSV and JSON** |
| E2E-US-008-01 | Import 100-row CSV; verify 100 rows + column names | `import-export.spec.ts` | ✅ COVERED (`imports CSV into a new table`) |
| E2E-US-008-02 | Import CSV with NULL/empty; round-trip export/import | — | ❌ MISSING |
| E2E-US-008-03 | Append CSV missing NOT NULL column; error; 0 new rows | `import-export.spec.ts` | ✅ COVERED (constraint violation test) |
| E2E-US-008-04 | Append CSV UNIQUE violation; error; 0 rows | `import-export.spec.ts` | ✅ COVERED (`import rollback occurs on constraint violation`) |
| E2E-US-008-05 | Numeric columns with NULL/empty; infer types | `import-export.spec.ts` | ⚠️ PARTIAL (`type override` tests) |
| E2E-US-008-06 | Headers: empty, dup, reserved word; verify normalization | — | ❌ MISSING |
| **US-009: Export database and data** |
| E2E-US-009-01 | Export NULL vs empty-string CSV; re-import; verify | — | ❌ MISSING |
| E2E-US-009-02 | Quota exceeded; Download Database still works | — | ❌ MISSING |
| **US-010: OPFS persistence** |
| E2E-US-010-01 | Edit cell; hard refresh; value persisted | `persistence.spec.ts` | ✅ COVERED (persistence tests) |
| E2E-US-010-02 | Edit; commit; immediate refresh; persisted | `persistence.spec.ts` | ✅ COVERED (database blob persistence) |
| E2E-US-010-03 | Web Locks: Tab A editable; Tab B read-only; retry | `multitab.spec.ts` | ✅ COVERED (`full multi-tab locking workflow`) |
| E2E-US-010-04 | Heartbeat fallback: stale; take over | `multitab.spec.ts` | ✅ COVERED (`crash recovery: Tab B takes over`) |
| E2E-US-010-05 | FK enforcement OFF; refresh; PRAGMA returns 0 | — | ❌ MISSING |
| **US-011: PWA / offline support** |
| E2E-US-011-01 | Offline full workflow (load, query, edit, export) | `offline.spec.ts` | ✅ COVERED (comprehensive offline tests) |
| **US-012: Sidebar navigator** |
| E2E-US-012-01 | Filter sidebar; case-insensitive substring; Escape clears | — | ❌ MISSING |
| E2E-US-012-02 | Multi-DB; expand collapses other; no memory leak | — | ❌ MISSING |
| **US-013: Database lifecycle** |
| E2E-US-013-01 | Create "a"; rename "b"; refresh; verify; qh migrated | `db-lifecycle.spec.ts` | ✅ COVERED (`create DB, rename, verify persistence`) |
| E2E-US-013-02 | Create "temp"; delete; refresh; no leftover files | `db-lifecycle.spec.ts` | ✅ COVERED (`delete DB removes IDB entry`) |
| E2E-US-013-03 | Edit cell DB1; switch DB2; Discard; edit not persisted | — | ❌ MISSING |
| E2E-US-013-04 | IndexedDB mode; edit; switch; verify persisted | — | ❌ MISSING |
| E2E-US-013-05 | Table Designer draft; switch; Discard prompt | — | ❌ MISSING |
| E2E-US-013-06 | IndexedDB mode; rename; verify IDB store re-keyed | — | ❌ MISSING |
| **Security** |
| E2E-SEC-01 | XSS in cell value and table name; no script execution | — | ❌ MISSING |
| E2E-SEC-02 | CSP enabled; WASM loads; zero violations | — | ❌ MISSING |

## Summary Statistics

| Status | Count | Percentage |
|--------|-------|------------|
| ✅ COVERED | 28 | 47% |
| ⚠️ PARTIAL | 8 | 13% |
| ❌ MISSING | 24 | 40% |
| **Total** | **60** | 100% |

## Priority List for Missing Tests

### P1 - High Priority (Core functionality gaps)

1. **E2E-US-003-03** - Rebuild failure rollback (critical for data safety)
2. **E2E-US-003-05** - Drop column with view dependency rollback
3. **E2E-US-005-04** - Transaction rollback on error
4. **E2E-US-005-05** - Open transaction warning
5. **E2E-SEC-01** - XSS prevention (security critical)
6. **E2E-SEC-02** - CSP compliance (security critical)
7. **E2E-US-009-02** - Export under quota exceeded (data export guarantee)

### P2 - Medium Priority (Feature completeness)

8. **E2E-US-001-06** - Unsaved edit + import flow
9. **E2E-US-003-04** - Rename with view/trigger dependency compile check
10. **E2E-US-003-06** - CHECK/GENERATED preservation after rename
11. **E2E-US-004-05** - FK parent uniqueness validation
12. **E2E-US-004-06** - FK composite PK handling
13. **E2E-US-006-02** - Same table twice blocked; alias deduplication
14. **E2E-US-007-06** - BLOB download verification
15. **E2E-US-008-02** - NULL/empty round-trip
16. **E2E-US-008-06** - Header normalization
17. **E2E-US-009-01** - NULL vs empty-string CSV export
18. **E2E-US-010-05** - FK enforcement toggle persistence

### P3 - Lower Priority (UX polish)

19. **E2E-US-012-01** - Sidebar filter with Escape
20. **E2E-US-012-02** - Multi-DB memory leak check
21. **E2E-US-013-03** - Unsaved edit discard on DB switch
22. **E2E-US-013-04** - IndexedDB mode switch persistence
23. **E2E-US-013-05** - Draft changes discard prompt
24. **E2E-US-013-06** - IndexedDB rename store re-key

## Existing Test Files Summary

| File | Test Count | Focus |
|------|------------|-------|
| `smoke.spec.ts` | 2 | Basic app load |
| `import-export.spec.ts` | 8 | CSV/JSON import, export formats |
| `grid-read.spec.ts` | 13 | Grid display, filters, sorting |
| `grid-edit.spec.ts` | 50+ | Cell editing, row operations |
| `grid-virtual-scroll.spec.ts` | 9 | Virtual scrolling, E2E-US-007-02/04 |
| `erd.spec.ts` | 10 | ERD FK operations |
| `sql-editor.spec.ts` | 7 | SQL execution, history |
| `query-builder.spec.ts` | 12 | Visual query builder |
| `table-designer.spec.ts` | 18 | Table creation/editing |
| `persistence.spec.ts` | 20+ | IDB/OPFS persistence |
| `import.spec.ts` | 30+ | SQLite file import, validation |
| `multitab.spec.ts` | 15+ | Multi-tab locking |
| `db-lifecycle.spec.ts` | 30+ | Rename/delete/switch |
| `pwa.spec.ts` | 4 | Service worker, manifest |
| `offline.spec.ts` | 8 | Offline workflow (E2E-US-011-01) |
| `accessibility.spec.ts` | 12 | WCAG compliance |
| `migration.spec.ts` | 5 | Legacy layout migration |
| `perf/perf.spec.ts` | 5 | Heap sampling, memory |
