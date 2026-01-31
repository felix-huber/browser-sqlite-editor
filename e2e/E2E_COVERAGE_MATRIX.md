# E2E Coverage Matrix

Cross-reference of PRD E2E scenario IDs against existing Playwright specs.

## Summary

| Category | PRD E2E IDs | Covered | Missing | Coverage % |
|----------|-------------|---------|---------|------------|
| US-001 (Load DB) | 6 | 1 | 5 | 17% |
| US-002 (Create DB) | 1 | 0 | 1 | 0% |
| US-003 (Table Designer) | 6 | 0 | 6 | 0% |
| US-004 (ERD) | 6 | 0 | 6 | 0% |
| US-005 (SQL Editor) | 5 | 0 | 5 | 0% |
| US-006 (Query Builder) | 2 | 0 | 2 | 0% |
| US-007 (Data Grid) | 7 | 2 | 5 | 29% |
| US-008 (Import CSV/JSON) | 6 | 0 | 6 | 0% |
| US-009 (Export) | 2 | 0 | 2 | 0% |
| US-010 (Persistence) | 5 | 0 | 5 | 0% |
| US-011 (PWA/Offline) | 1 | 1 | 0 | 100% |
| US-012 (Sidebar) | 2 | 1 | 1 | 50% |
| US-013 (DB Lifecycle) | 6 | 0 | 6 | 0% |
| SEC (Security) | 2 | 0 | 2 | 0% |
| **Total** | **57** | **5** | **52** | **9%** |

## Detailed Coverage

### US-001: Load Existing SQLite Database

| E2E ID | Description | Status | Spec File | Notes |
|--------|-------------|--------|-----------|-------|
| E2E-US-001-01 | Drop 10MB fixture; sidebar shows tables within 5s | ❌ Missing | - | Need fixture + timing assertion |
| E2E-US-001-02 | Drop fixture; hard refresh; DB persists | ❌ Missing | - | Persistence test needed |
| E2E-US-001-03 | Drop same fixture twice; second gets `(1)` suffix | ❌ Missing | - | Name collision test |
| E2E-US-001-04 | Toolbar file picker imports second DB | ❌ Missing | - | Multi-DB import test |
| E2E-US-001-05 | Drop invalid fixture; error modal; registry unchanged | ✅ Covered | `import.spec.ts:969` | Full implementation |
| E2E-US-001-06 | Unsaved edit prompt on drag-drop | ❌ Missing | - | Unsaved state interaction |

### US-002: Create New Empty Database

| E2E ID | Description | Status | Spec File | Notes |
|--------|-------------|--------|-----------|-------|
| E2E-US-002-01 | Create DB "test"; refresh; appears in sidebar | ❌ Missing | - | Basic create+persist test |

### US-003: Visual Table Designer

| E2E ID | Description | Status | Spec File | Notes |
|--------|-------------|--------|-----------|-------|
| E2E-US-003-01 | Create 3 cols, add 4th, drop 2nd; verify schema | ❌ Missing | - | table-designer.spec.ts has similar but not exact test |
| E2E-US-003-02 | Rename column with index/trigger/FK; verify preservation | ❌ Missing | - | Partial coverage in existing tests |
| E2E-US-003-03 | Force rebuild failure; verify rollback | ❌ Missing | - | Error case test |
| E2E-US-003-04 | Rename column; verify view/trigger compile | ❌ Missing | - | Dependency verification |
| E2E-US-003-05 | Drop column with view dependency; verify rollback | ❌ Missing | - | Dependency error test |
| E2E-US-003-06 | Rename column in table with CHECK/GENERATED | ❌ Missing | - | Advanced schema preservation |

### US-004: Relationship Editor (ERD)

| E2E ID | Description | Status | Spec File | Notes |
|--------|-------------|--------|-----------|-------|
| E2E-US-004-01 | Open Chinook; verify FK edge count matches pragma | ❌ Missing | - | Need Chinook fixture |
| E2E-US-004-02 | Create FK via drag; verify data/index/trigger preserved | ❌ Missing | - | erd.spec.ts has FK create but not full verification |
| E2E-US-004-03 | Edit FK ON DELETE action; verify pragma | ❌ Missing | - | erd.spec.ts has partial coverage |
| E2E-US-004-04 | Delete FK; verify removal and index/trigger remain | ❌ Missing | - | erd.spec.ts has delete but not preservation check |
| E2E-US-004-05 | Block FK on non-unique parent; offer UNIQUE action | ❌ Missing | - | Validation workflow |
| E2E-US-004-06 | Block FK on composite PK; offer UNIQUE action | ❌ Missing | - | Composite PK validation |

### US-005: SQL Query Editor

| E2E ID | Description | Status | Spec File | Notes |
|--------|-------------|--------|-----------|-------|
| E2E-US-005-01 | SELECT 1+1; verify result=2 | ❌ Missing | - | sql-editor.spec.ts has similar but not exact test |
| E2E-US-005-02 | Multi-statement INSERT+SELECT | ❌ Missing | - | Multi-statement test |
| E2E-US-005-03 | Mid-script error; verify rollback | ❌ Missing | - | Error handling test |
| E2E-US-005-04 | BEGIN; INSERT; error; verify rollback | ❌ Missing | - | Explicit transaction error |
| E2E-US-005-05 | BEGIN; INSERT; (no COMMIT); verify warning | ❌ Missing | - | Open transaction warning |

### US-006: Visual Query Builder

| E2E ID | Description | Status | Spec File | Notes |
|--------|-------------|--------|-----------|-------|
| E2E-US-006-01 | Join 2 tables, 3 cols, WHERE; verify exact SQL | ❌ Missing | - | query-builder.spec.ts has partial coverage |
| E2E-US-006-02 | Add same table twice blocked; duplicate col aliases | ❌ Missing | - | Self-join prevention |

### US-007: Data Grid with Inline Editing

| E2E ID | Description | Status | Spec File | Notes |
|--------|-------------|--------|-----------|-------|
| E2E-US-007-01 | Double-click cell, edit, Enter; verify persisted | ❌ Missing | - | grid-edit.spec.ts has similar tests |
| E2E-US-007-02 | Sort by duplicate values; verify no missing rows | ✅ Covered | `grid-virtual-scroll.spec.ts:217` | Full implementation |
| E2E-US-007-03 | Add row to NOT NULL table; required fields UI | ❌ Missing | - | grid-edit.spec.ts has partial coverage |
| E2E-US-007-04 | WITHOUT ROWID table sort; verify PK tiebreaker | ✅ Covered | `grid-virtual-scroll.spec.ts:273` | Full implementation |
| E2E-US-007-05 | Filter with wildcard chars; verify literal match | ❌ Missing | - | Filter escape test |
| E2E-US-007-06 | BLOB "Save as file"; verify content | ❌ Missing | - | grid-edit.spec.ts has menu test only |
| E2E-US-007-07 | Generated column not editable | ❌ Missing | - | grid-edit.spec.ts has partial coverage |

### US-008: Import CSV and JSON

| E2E ID | Description | Status | Spec File | Notes |
|--------|-------------|--------|-----------|-------|
| E2E-US-008-01 | Import 100-row CSV; verify count and headers | ❌ Missing | - | import-export.spec.ts has smaller test |
| E2E-US-008-02 | Import CSV with NULL/empty; verify round-trip | ❌ Missing | - | NULL/empty distinction |
| E2E-US-008-03 | Append to NOT NULL table missing column; verify error | ❌ Missing | - | Constraint error test |
| E2E-US-008-04 | Append causing UNIQUE violation; verify error | ❌ Missing | - | import-export.spec.ts has partial coverage |
| E2E-US-008-05 | Infer types from CSV with leading NULLs | ❌ Missing | - | Type inference test |
| E2E-US-008-06 | Header normalization; verify column naming | ❌ Missing | - | Header edge cases |

### US-009: Export Database and Data

| E2E ID | Description | Status | Spec File | Notes |
|--------|-------------|--------|-----------|-------|
| E2E-US-009-01 | Export CSV; verify NULL vs empty string encoding | ❌ Missing | - | import-export.spec.ts has export tests but not this specific check |
| E2E-US-009-02 | Export under quota exceeded; verify download works | ❌ Missing | - | Quota error handling |

### US-010: OPFS Persistence

| E2E ID | Description | Status | Spec File | Notes |
|--------|-------------|--------|-----------|-------|
| E2E-US-010-01 | Edit cell; hard refresh; verify persisted | ❌ Missing | - | persistence.spec.ts tests IDB layer, not full UI |
| E2E-US-010-02 | Edit+commit+immediate refresh; verify persisted | ❌ Missing | - | OPFS durability test |
| E2E-US-010-03 | Multi-tab: Tab B read-only; close Tab A; Tab B editable | ❌ Missing | - | multitab.spec.ts has similar but not exact test |
| E2E-US-010-04 | Heartbeat fallback; takeover after stale | ❌ Missing | - | multitab.spec.ts has locking tests |
| E2E-US-010-05 | Toggle FK enforcement OFF; verify pragma after refresh | ❌ Missing | - | FK setting persistence |

### US-011: PWA/Offline Support

| E2E ID | Description | Status | Spec File | Notes |
|--------|-------------|--------|-----------|-------|
| E2E-US-011-01 | Offline: load, query, edit, export all work | ✅ Covered | `offline.spec.ts:56` | Full implementation |

### US-012: Sidebar Navigator

| E2E ID | Description | Status | Spec File | Notes |
|--------|-------------|--------|-----------|-------|
| E2E-US-012-01 | Filter sidebar; case-insensitive match; Escape clears | ✅ Covered | `sidebar.spec.ts:64` | Full implementation |
| E2E-US-012-02 | Multi-DB switching; memory stability | ❌ Missing | - | Memory leak check |

### US-013: Database Lifecycle

| E2E ID | Description | Status | Spec File | Notes |
|--------|-------------|--------|-----------|-------|
| E2E-US-013-01 | Rename DB; verify persistence and query history migration | ❌ Missing | - | db-lifecycle.spec.ts has rename tests but not query history |
| E2E-US-013-02 | Delete DB; verify no leftover files | ❌ Missing | - | db-lifecycle.spec.ts has delete but not OPFS cleanup check |
| E2E-US-013-03 | Unsaved edit; switch DB; Discard; verify not persisted | ❌ Missing | - | Unsaved prompt test |
| E2E-US-013-04 | IDB fallback; edit+switch; verify persisted | ❌ Missing | - | IDB switch contract |
| E2E-US-013-05 | Table Designer draft; switch DB; Discard prompt | ❌ Missing | - | Draft state test |
| E2E-US-013-06 | IDB fallback; rename DB; verify IDB key changed | ❌ Missing | - | IDB rename test |

### Security Tests

| E2E ID | Description | Status | Spec File | Notes |
|--------|-------------|--------|-----------|-------|
| E2E-SEC-01 | XSS in cell/table name; verify escaped | ❌ Missing | - | Security test |
| E2E-SEC-02 | CSP enabled; full workflow; zero violations | ❌ Missing | - | CSP verification |

## Priority List for Missing Tests

### P0 - Critical (Core Functionality)

1. **E2E-US-002-01** - Create DB persistence (basic app function)
2. **E2E-US-007-01** - Cell edit persistence (core grid function)
3. **E2E-US-010-01** - Edit cell persistence (durability guarantee)
4. **E2E-US-010-02** - Immediate refresh durability (OPFS contract)

### P1 - High (Key Features)

5. **E2E-US-001-01** - Large file load (10MB fixture)
6. **E2E-US-001-02** - DB persistence after refresh
7. **E2E-US-001-03** - Name collision handling
8. **E2E-US-005-01** - Basic SQL execution
9. **E2E-US-005-03** - Error rollback
10. **E2E-US-008-01** - CSV import verification
11. **E2E-US-009-01** - NULL vs empty string export

### P2 - Medium (Feature Completeness)

12. **E2E-US-003-01** - Table designer column operations
13. **E2E-US-003-02** - Column rename preservations
14. **E2E-US-004-01** - ERD FK edge count (Chinook fixture)
15. **E2E-US-004-02** - FK create with preservation
16. **E2E-US-006-01** - Query builder deterministic SQL
17. **E2E-US-007-05** - Filter wildcard escape
18. **E2E-US-010-03** - Multi-tab read-only enforcement
19. **E2E-US-013-01** - Rename with query history migration
20. **E2E-SEC-01** - XSS prevention

### P3 - Low (Edge Cases)

21. **E2E-US-001-04** - Toolbar file picker
22. **E2E-US-001-06** - Unsaved edit on drag-drop
23. **E2E-US-003-03** through **E2E-US-003-06** - Advanced table designer
24. **E2E-US-004-03** through **E2E-US-004-06** - ERD edge cases
25. **E2E-US-005-04**, **E2E-US-005-05** - Transaction edge cases
26. **E2E-US-006-02** - Self-join prevention
27. **E2E-US-007-03**, **E2E-US-007-06**, **E2E-US-007-07** - Grid edge cases
28. **E2E-US-008-02** through **E2E-US-008-06** - Import edge cases
29. **E2E-US-009-02** - Quota exceeded export
30. **E2E-US-010-04**, **E2E-US-010-05** - Persistence edge cases
31. **E2E-US-012-02** - Memory stability
32. **E2E-US-013-02** through **E2E-US-013-06** - Lifecycle edge cases
33. **E2E-SEC-02** - CSP verification

## Existing Spec Files Analysis

| Spec File | PRD IDs Covered | Related Tests |
|-----------|-----------------|---------------|
| `smoke.spec.ts` | 0 | Basic app load tests |
| `accessibility.spec.ts` | 0 | A11y checks |
| `persistence.spec.ts` | 0 | IDB storage layer tests (not PRD-linked) |
| `import-export.spec.ts` | 0 | Import/export UI tests (partial PRD coverage) |
| `import.spec.ts` | 1 | E2E-US-001-05 |
| `grid-read.spec.ts` | 0 | Grid read operations |
| `grid-edit.spec.ts` | 0 | Grid edit operations (partial PRD coverage) |
| `grid-virtual-scroll.spec.ts` | 2 | E2E-US-007-02, E2E-US-007-04 |
| `erd.spec.ts` | 0 | ERD operations (partial PRD coverage) |
| `sql-editor.spec.ts` | 0 | SQL execution (partial PRD coverage) |
| `query-builder.spec.ts` | 0 | Query builder (partial PRD coverage) |
| `table-designer.spec.ts` | 0 | Table designer (partial PRD coverage) |
| `sidebar.spec.ts` | 1 | E2E-US-012-01 |
| `db-lifecycle.spec.ts` | 0 | DB lifecycle (partial PRD coverage) |
| `multitab.spec.ts` | 0 | Multi-tab locking (partial PRD coverage) |
| `offline.spec.ts` | 1 | E2E-US-011-01 |
| `pwa.spec.ts` | 0 | PWA manifest checks |
| `migration.spec.ts` | 0 | Schema migration tests |
| `perf/perf.spec.ts` | 0 | Performance tests |

## Recommendations

1. **Add PRD E2E ID comments** to existing tests that partially cover PRD scenarios
2. **Create fixtures**: 10MB SQLite file, Chinook database
3. **Prioritize P0 tests** - these are fundamental app guarantees
4. **Add security test suite** - E2E-SEC-01 and E2E-SEC-02 are important
5. **Consider test naming convention** - prefix tests with PRD ID for traceability
