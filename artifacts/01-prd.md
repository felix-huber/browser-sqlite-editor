# 01 — PRD: WASM SQLite Editor

## Introduction

A browser-based SQLite database editor inspired by Microsoft Access. Users can open, create, design, query, and edit SQLite databases entirely client-side using WebAssembly. The app runs as a PWA with no backend — all data stays in the browser via OPFS persistence.

The core differentiator is the **visual design surface**: a table designer with drag-and-drop columns, a relationship editor that renders foreign keys as connectable lines (like Access), and a visual query builder with join support. No existing browser-based tool offers this combination.

## Goals

- Provide a zero-install, browser-based SQLite editor that works offline
- Offer visual database design tools (table designer, ERD relationship editor, query builder) comparable to desktop tools like Access or DB Browser
- Support the full read/write lifecycle: create DB, design schema, enter data, query, export
- Handle databases up to 100MB **in OPFS mode (Chrome/Edge primary target)** within defined time/memory budgets (see Performance & Scale Targets); in **IndexedDB fallback mode**, support is best-effort with a **recommended max of 50MB** (warnings + no hard perf guarantees)
- Persist databases across sessions using OPFS with IndexedDB fallback

## User Stories

### US-001: Load an existing SQLite database
**Description:** As a developer, I want to open an existing `.sqlite` or `.db` file so that I can inspect and edit its contents.

**Acceptance Criteria:**
- [ ] Drag-and-drop a `.sqlite`/`.db` file onto the app to open it
- [ ] If a DB is already open, dropping a `.sqlite`/`.db` file first runs the **unsaved-edit check** (same rules as switching DBs in US-013). If the user cancels, the dropped file is not imported. If the user proceeds, the file is imported as an additional persisted DB and becomes the active DB.
- [ ] File picker button (available on the Welcome screen and in the main workspace toolbar) as an alternative to drag-and-drop
- [ ] File is loaded into wa-sqlite WASM engine and schema is parsed
- [ ] Opened file is automatically imported into OPFS as a persisted database, named after the filename (e.g., `chinook.sqlite` → persisted as "chinook"). Original file on disk is never modified.
- [ ] If a database with the same name already exists, auto-suffix with `(1)`, `(2)`, etc.
- [ ] All tables, views, and indexes appear in a sidebar navigator
- [ ] Files up to 100MB load within 60 seconds on baseline environment (show progress indicator for >5MB). Import uses `File.stream()` (ReadableStream) to read the file in 1MB chunks and writes each chunk to the OPFS file via SyncAccessHandle — no full ArrayBuffer is ever allocated in JS heap. After streaming completes, the DB is opened from OPFS via the VFS. Peak JS heap from the import itself is bounded by the chunk size (~1MB), not the file size.
- [ ] Dropping unsupported file types (e.g., `.csv`, `.json`) on the app shows a toast error and does not create/modify any persisted database; CSV/JSON files are imported only via the Import flow (US-008)
- [ ] Invalid files (non-SQLite, corrupted, encrypted/SQLCipher) show a clear error message naming the problem (e.g., "Not a valid SQLite file", "File is encrypted — SQLCipher is not supported")
- [ ] If file open/import fails (invalid SQLite, corrupt, encrypted/SQLCipher), **no database is added to the sidebar/registry** and any partially-written OPFS/IndexedDB artifacts are cleaned up (no orphan `.sqlite` files or IDB entries)
- [ ] **Size warnings (storage-mode aware)**: In OPFS mode, files >100MB show a warning: "This database exceeds the 100MB target. Performance may be degraded." In IndexedDB fallback mode, files >50MB show: "Large databases may be slow in fallback storage mode." (The 100MB performance guarantees do not apply in IndexedDB mode.) Warnings appear on import, on DB open, and in the status bar when a DB grows past the threshold via edits/imports. Import always proceeds (not blocked).
- [ ] **E2E: E2E-US-001-01** — Drop a 10MB `.sqlite` fixture; sidebar shows all tables within 5s
- [ ] **E2E: E2E-US-001-02** — Drop fixture; hard refresh; DB still appears in sidebar with all data intact
- [ ] **E2E: E2E-US-001-03** — Drop same fixture twice; second import creates name with `(1)` suffix
- [ ] **E2E: E2E-US-001-04** — With an existing DB open, use the toolbar "Open Database" file picker to import a second fixture; verify both DBs appear in the sidebar registry and the newly imported DB becomes active
- [ ] **E2E: E2E-US-001-05** — Drop an invalid `.sqlite` fixture; verify error modal; verify no new DB appears in sidebar after dismiss + hard refresh (registry unchanged; no new OPFS file/IDB entry)
- [ ] **E2E: E2E-US-001-06** — With DB1 active and a cell edit in progress, drag-drop DB2 fixture onto the sidebar drop zone; verify unsaved prompt appears; choose Discard; verify DB2 imports and becomes active; verify DB1 edit was not persisted

### US-002: Create a new empty database
**Description:** As a developer, I want to create a new database from scratch so that I can design a schema and populate it.

**Acceptance Criteria:**
- [ ] "New Database" button creates an empty in-memory SQLite database
- [ ] User is prompted to name the database (see Database naming rules below)
- [ ] Database appears in the sidebar navigator
- [ ] Database is immediately persisted to OPFS
- [ ] **E2E: E2E-US-002-01** — Create DB named "test"; refresh page; "test" appears in sidebar

**Database naming rules:**
- Names must be 1–64 characters, trimmed of leading/trailing whitespace.
- Allowed characters: alphanumeric, spaces, hyphens, underscores, dots, parentheses. No path separators or control characters.
- Names are case-preserving but collision-checked case-insensitively (i.e., "MyDB" and "mydb" cannot coexist).
- Empty or invalid names show inline validation error. Duplicate names are auto-suffixed with `(1)`, `(2)`, etc. on import, or blocked with error on manual create/rename.
- Rename (via sidebar context menu) follows the same rules. Renaming updates the OPFS storage key, all metadata references (ERD layout positions), and per-DB localStorage data (query history key `qh:<old>` → `qh:<new>`).

### US-003: Visual table designer
**Description:** As a developer, I want to design tables visually — adding columns, setting types, and reordering — without writing DDL.

**Acceptance Criteria:**
- [ ] "New Table" action opens a table designer panel
- [ ] Add columns with name, type, and constraints (PK, NOT NULL, UNIQUE, DEFAULT). The type field is freeform text (persisted verbatim into DDL) with a dropdown helper offering common affinity types (INTEGER, TEXT, REAL, BLOB, NUMERIC). Users may type any SQLite-valid declared type (e.g., "VARCHAR(255)", "DATETIME", "BOOLEAN", "DECIMAL(10,2)"). For existing tables, the designer always displays the exact declared type string from `PRAGMA table_info` — never coerced to the affinity enum. The affinity dropdown highlights the matching affinity for informational purposes only.
- [ ] Drag-and-drop to reorder columns (UI display order only; does not change physical column order in SQLite). Display order is not persisted — it resets to physical order when the designer is reopened. This is a v1 simplification; persistent column ordering may be added later.
- [ ] Edit existing table structure with the following v1 scope:
  - **Supported**: Add new column, rename column (via table rebuild), drop column (via table rebuild)
  - **Not supported in v1**: Change column type, change constraints on existing columns
- [ ] All destructive operations (drop column, drop table) require explicit confirmation dialog
- [ ] Table rebuild operations preserve all data, indexes, foreign keys, and triggers; on failure the database remains in last-known-good state (transactional rollback)
- [ ] **Schema feature preservation (rebuild guardrails)**: The rebuild engine parses the original `CREATE TABLE` SQL from `sqlite_master` and reproduces it with the requested modification, preserving all table-level features including: CHECK constraints, composite PK/UNIQUE, COLLATE clauses, GENERATED columns, STRICT, WITHOUT ROWID, AUTOINCREMENT, DEFAULT expressions, and ON CONFLICT clauses. If the rebuild engine encounters a construct it cannot safely reproduce (determined by a two-tier post-rebuild check: (1) structural verification via PRAGMAs — `table_info`, `index_list`, `foreign_key_list` — which are authoritative for schema properties; (2) best-effort textual comparison of `sqlite_master` SQL after whitespace normalization and identifier-quote normalization, checking that key clauses like CHECK, GENERATED, STRICT, WITHOUT ROWID are present), the transaction is rolled back and the user sees: "This table uses schema features that cannot be safely modified via the visual designer. Use the SQL editor instead." This guardrail ensures no silent feature loss.
- [ ] **Prefer native ALTER TABLE**: Use SQLite-native `ALTER TABLE RENAME COLUMN` and `ALTER TABLE DROP COLUMN` when available (SQLite >= 3.45). These correctly propagate renames to indexes, triggers, and views. Reserve full table rebuild only for operations SQLite cannot handle natively (e.g., FK modifications via ERD).
- [ ] **Dependency handling on rebuild**: The rebuild engine uses a two-phase approach: (1) **Pre-flight (best-effort)**: Scan `sqlite_master` SQL text for references to the target table/column to generate a user-facing dependency warning. This is informational — it may miss obfuscated references (quoted identifiers, different casing, comments). (2) **Post-rebuild verification (authoritative)**: After the rebuild completes within the transaction, compile-check ALL user-defined SQL objects from `sqlite_master` (views, triggers) by running `sqlite3_prepare_v2` on each. If any object fails to compile, the entire transaction is rolled back and the user sees a dependency error listing the broken objects with their SQL. This catch-all approach is robust regardless of naming conventions.
- [ ] If dropping a column that is referenced by an index, FK, trigger, or view, show a dependency warning listing all affected objects before confirmation. **Dependency discovery layers**: (1) Indexes/FKs: authoritative via `PRAGMA index_info` / `PRAGMA foreign_key_list` (exact column match). (2) Views/triggers: best-effort pre-flight via `sqlite_master` SQL text scan, authoritative via post-rebuild compile-check (see dependency handling above).
- [ ] Preview the generated DDL diff before applying. The diff shows: (a) original `CREATE TABLE` SQL, (b) proposed `CREATE TABLE` SQL, (c) any indexes/triggers/FKs that will be dropped and recreated as part of a rebuild, and (d) a net-effect summary (e.g., "Rename column a → a1; 2 indexes recreated"). The same diff component and format is shared between the table designer and ERD FK editor.
- [ ] Apply creates/alters the table in the database
- [ ] **E2E: E2E-US-003-01** — Create table with 3 columns; add a 4th column; drop the 2nd column; verify schema via `PRAGMA table_info` matches expected output
- [ ] **E2E: E2E-US-003-02** — Create table A with an index, a trigger, and a FK from table B. Rename a column in A. Verify: row count unchanged, `sqlite_master` still contains the trigger, `PRAGMA foreign_key_list` on B still shows FK to A, `PRAGMA index_list/index_info` on A still match expected
- [ ] **E2E: E2E-US-003-03** — Force a rebuild failure (e.g., NOT NULL violation during copy). Verify schema and data are identical to pre-operation state
- [ ] **E2E: E2E-US-003-04** — Create table t(a INT, b INT); create view v AS SELECT a FROM t; create trigger trg AFTER INSERT ON t BEGIN SELECT a; END; rename column a→a1 via designer (native ALTER). Verify: INSERT into t succeeds, SELECT * FROM v returns a1 values, sqlite_master definitions for v/trg compile successfully via EXPLAIN.
- [ ] **E2E: E2E-US-003-05** — Create table t(a INT, b INT) with view v referencing column b; drop column b via designer. Verify: rebuild is rolled back with dependency error listing view v; schema unchanged.
- [ ] **E2E: E2E-US-003-06** — Create table with CHECK constraint and GENERATED column via SQL. Rename a column (not involved in CHECK/GENERATED) via designer. Verify: post-operation `sqlite_master.sql` still contains the CHECK and GENERATED clauses verbatim; data intact.

### US-004: Relationship editor (ERD view)
**Description:** As a developer, I want to visually see and create foreign key relationships between tables, similar to Access's relationship view.

**Acceptance Criteria:**
- [ ] Canvas/SVG view (React Flow) showing all tables as boxes with column lists
- [ ] Existing foreign keys rendered as lines connecting columns
- [ ] Drag from one column to another to create a new FK relationship
- [ ] Right-click a relationship line to edit or delete it
- [ ] Tables are draggable to arrange the layout
- [ ] Layout positions persist across sessions (stored in OPFS metadata per database, see ERD metadata schema below)
- [ ] **E2E: E2E-US-004-01** — Open Chinook fixture DB; compute expected FK constraint count by iterating all tables from `sqlite_master WHERE type='table'` and counting distinct `id` values from `pragma_foreign_key_list(<table>)` for each (each `id` = one FK constraint, which may have multiple column rows for composite FKs). Each FK constraint renders as one ERD edge (composite FKs show a multi-column label). Assert rendered ERD edge count equals expected total. Verify at least one known FK (e.g., `Invoice.CustomerId → Customer.CustomerId`) appears as a labeled edge.

**Foreign key support (v1 scope):**
- **Supported FK shapes**: Single-column FKs only. Composite FKs are rendered read-only (lines shown, but cannot be created/edited via drag).
- **Self-referencing FKs**: Rendered as a looped line on the same table box.
- **Multiple FKs between same table pair**: Each rendered as a distinct line with label.
- **ON DELETE/UPDATE actions**: Configurable via FK creation dialog (RESTRICT, NO ACTION, CASCADE, SET NULL). Defaults to NO ACTION.
- **DEFERRABLE**: Not supported in v1 UI (uses SQLite default).
- **FK enforcement**: `PRAGMA foreign_keys = ON` is set by default. A toggle in settings allows disabling it (per-DB, persisted in `registry.json` as `fkEnforced`; applied on DB open via `PRAGMA foreign_keys`). UI shows enforcement status in the ERD toolbar.

**ERD metadata schema:**
- Stored as a JSON file in OPFS alongside the database file: `<db-name>.erd.json`
- Schema version field (`"v": 1`) enables future migration. Unknown keys are preserved (forward-compatible).
- Contents: `{ "v": 1, "tables": { "<table>": { "x": number, "y": number } } }`
- On schema change (table rename/drop), metadata keys are updated/removed accordingly.
- If metadata file is missing or corrupt, positions are auto-laid out (no error).

- **FK mutation mechanics**: SQLite does not support adding/removing FK constraints via ALTER TABLE. All FK create/edit/delete operations in the ERD are applied via table rebuild of the child table, using the same rebuild engine as the table designer (US-003). The rebuild preserves all data, indexes, triggers, and other FKs; on failure, the transaction is rolled back. The ERD UI shows a DDL diff preview before applying, identical to the table designer flow.
- **FK parent column validation (v1 single-column FKs)**: Before creating a FK, the app validates that the referenced parent column is unique **on that single column** (single-column PRIMARY KEY or a UNIQUE index whose key columns are exactly `[parent_col]`). Composite PK/UNIQUE does **not** qualify for a v1 single-column FK. If not unique, FK creation is blocked with: "Referenced column must be a single-column PRIMARY KEY or have a UNIQUE index on that column." The dialog offers a one-click action to create a UNIQUE index on the parent column (with DDL preview) before retrying.
- **E2E: E2E-US-004-05** — Create parent P(a INT) with no PK/UNIQUE; child C(p_a INT). Attempt FK C.p_a → P.a via ERD. Verify blocked. Create UNIQUE index on P(a) via offered action. Retry. Verify FK created and `PRAGMA foreign_key_list(C)` shows it.
- **E2E: E2E-US-004-06** — Create parent P(a INT, b INT, PRIMARY KEY(a,b)); child C(p_a INT). Attempt FK C.p_a → P.a via ERD. Verify blocked (composite PK is not unique on `a`). Create UNIQUE index on P(a) via offered action. Retry. Verify FK created and `PRAGMA foreign_key_list(C)` shows it.
- **FK creation with existing data violations**: When creating a FK via drag-and-drop on tables that already contain data, the app validates referential integrity before applying. NULL child FK values are treated as non-violations (matching SQLite FK semantics). Validation uses a NULL-safe anti-join pattern: (1) sample query: `SELECT child.* FROM child LEFT JOIN parent ON child.fk_col = parent.pk_col WHERE child.fk_col IS NOT NULL AND parent.pk_col IS NULL LIMIT 10`, (2) count query with the same predicate for total. This avoids the `NOT IN` + NULL pitfall where NULLs in the parent column cause the subquery to return no violations. For large tables, a progress indicator with cancel is shown. If violations exist, the FK creation is blocked and an error dialog lists up to 10 sample violating rows with a total violation count. The user must fix data before retrying. FK is never created in a state where enforcement would immediately fail.
- **E2E: E2E-US-004-02** — Create tables A (parent) and B (child) with an index and trigger on B; add rows; create FK B.a_id → A.id via ERD drag. Verify: data preserved, index/trigger still exist in `sqlite_master`, `PRAGMA foreign_key_list(B)` shows FK.
- **E2E: E2E-US-004-03** — Edit FK ON DELETE action via ERD (change to CASCADE). Verify `PRAGMA foreign_key_list(B)` reflects updated action.
- **E2E: E2E-US-004-04** — Delete FK via ERD. Verify `PRAGMA foreign_key_list(B)` no longer shows it; index and trigger on B remain.

### US-005: SQL query editor
**Description:** As a developer, I want to write and execute SQL queries with syntax highlighting and see results in a table.

**Acceptance Criteria:**
- [ ] Code editor with SQLite syntax highlighting (CodeMirror 6)
- [ ] Execute button (and Ctrl/Cmd+Enter shortcut)
- [ ] SELECT results displayed in a scrollable data grid
- [ ] Row count shown
- [ ] INSERT/UPDATE/DELETE show affected row count
- [ ] Errors displayed inline with statement index and computed starting line number (derived by counting newlines before the prepared statement's byte offset in the input). Best-effort column position is extracted from SQLite's "near ..." hint when available.
- [ ] Query history (last 50 queries) accessible via dropdown
- [ ] **E2E: E2E-US-005-01** — Type `SELECT 1+1`; press Ctrl+Enter; result grid shows value `2`
- [ ] **E2E: E2E-US-005-02** — Paste multi-statement script: `INSERT INTO t(x) VALUES (1); SELECT count(*) FROM t;` — verify INSERT affected-row count shown and SELECT result grid renders
- [ ] **E2E: E2E-US-005-03** — Paste script with mid-script error: `INSERT INTO t(x) VALUES (2); SELECT * FROM nonexistent;` — verify error with line number shown and INSERT is rolled back (count unchanged)

**SQL execution semantics (v1):**
- **Multi-statement support**: The editor splits input using wa-sqlite's built-in multi-statement execution (`sqlite3_prepare_v2` loop), which handles semicolons inside string literals, comments (`--`, `/* */`), and quoted identifiers correctly. Statements execute sequentially within an implicit transaction.
- **Transaction policy**: If no explicit BEGIN/COMMIT is present, the entire script is wrapped in a single transaction. On any error, execution **stops immediately** (no subsequent statements run), the transaction is rolled back, and the error is displayed. If the user provides explicit transaction control (BEGIN/COMMIT), those are respected as-is; on error, execution still stops immediately and the app issues ROLLBACK to clean up.
- **Result display**: The last SELECT result set is shown in the grid with virtual scrolling. Results are fetched in pages of 1,000 rows; the grid initially loads the first 10,000 rows and fetches more on scroll. A "Cancel" button stops fetching/execution for long-running queries. The summary line shows fetched count and indicates if more rows are available (e.g., "Showing 10,000 of 200,000+ rows"). Affected-row counts for DML statements are shown in a summary line above the grid (e.g., "Statement 1: 1 row inserted. Statement 2: 5 rows returned.").
- **Destructive DDL**: DROP TABLE/DROP INDEX executed via the SQL editor do not show a confirmation dialog (the editor is a power-user tool). The transactional rollback on error provides the safety net.
- **Explicit transaction edge cases**:
  - `BEGIN` without `COMMIT`: If the script ends with an open transaction, the app auto-rolls back and shows a warning: "Script ended with an open transaction — changes were rolled back. Add COMMIT to persist."
  - Error after explicit `BEGIN`: The app issues `ROLLBACK` and reports the error. The connection is never left in a dangling transaction state.
  - `COMMIT` without `BEGIN`: SQLite returns "cannot commit — no transaction is active"; the error is displayed and execution stops (consistent with the stop-on-error policy).
  - `SAVEPOINT` / `RELEASE` / `ROLLBACK TO`: Supported — passed through to SQLite as-is. No special handling.
- **E2E: E2E-US-005-04** — `BEGIN; INSERT INTO t(x) VALUES (99); SELECT * FROM nonexistent;` — verify error shown, transaction rolled back, row with 99 not present.
- **E2E: E2E-US-005-05** — `BEGIN; INSERT INTO t(x) VALUES (99);` (no COMMIT) — verify warning about open transaction, row not present.

### US-006: Visual query builder
**Description:** As a developer, I want to build queries visually by selecting tables, columns, and joins without writing SQL.

**Acceptance Criteria:**
- [ ] Select tables from a list to add to the query canvas
- [ ] Check columns to include in SELECT
- [ ] Drag between columns to define JOINs (INNER, LEFT, RIGHT). RIGHT JOIN is supported because the bundled SQLite version includes it (we target SQLite >= 3.45 for ALTER TABLE reasons; RIGHT JOIN has been available since 3.39).
- [ ] Add WHERE conditions via form inputs
- [ ] Add ORDER BY and LIMIT
- [ ] Live SQL preview updates as the query is built
- [ ] "Run" executes the generated query and shows results
- [ ] **E2E: E2E-US-006-01** — Add two tables, join on FK column, check 3 columns, add WHERE; verify generated SQL matches exact expected string + parameter list (deterministic output) and executes without error
- [ ] **E2E: E2E-US-006-02** — Attempt to add the same table twice; verify UI blocks with an inline error (no self-joins in v1). Select two columns with the same name from different tables; verify generated SQL includes deterministic `AS` aliases and result headers are unique.

**v1 scope (explicit):**
- **Supported**: SELECT, JOIN (INNER, LEFT, RIGHT), WHERE, ORDER BY, LIMIT
- **Not supported in v1**: GROUP BY, HAVING, aggregate functions, subqueries, UNION, CTEs, **self-joins / multiple instances of the same table (no table aliasing in v1)**
- UI does not expose controls for unsupported features; no hidden affordances

**Query builder WHERE semantics (v1):**
- **Operators**: `=`, `!=`, `<`, `<=`, `>`, `>=`, `LIKE` (contains), `STARTS WITH` (→ `LIKE 'val%'`), `IS NULL`, `IS NOT NULL`. User `%` and `_` input is escaped using backslash as the escape character; generated SQL includes `ESCAPE '\'` clause. The escape character itself (`\`) is escaped as `\\`.
- **Value typing**: User picks type per condition (text/number/null). All user-supplied values (text and numeric) are parameterized (`?` placeholders), never interpolated. NULL is structural (`IS NULL` / `IS NOT NULL`), not a parameter.
- **Grouping**: All conditions are ANDed in v1. No OR grouping or nested conditions.
- **Join conditions**: Equality joins only (`a.col = b.col`) via drag between columns. Column names are always double-quoted in generated SQL to avoid reserved-word collisions.
- **Table instances**: A given table may appear at most once on the canvas in v1 (no self-join / alias UI). Attempting to add a table that is already present shows an inline error and does not change the builder state.
- **Result column labels**: To avoid duplicate headers when different tables share a column name (e.g., `id`), the generated SELECT list uses deterministic aliases: `"Table"."Column" AS "Table.Column"` for every selected column.
- **SQL output**: Deterministic — given the same builder state, the generated SQL + parameter list is identical. E2E tests assert exact SQL strings.

### US-007: Data grid with inline editing
**Description:** As a developer, I want to browse table data in a spreadsheet-like grid and edit cells inline.

**Acceptance Criteria:**
- [ ] Click a table in the sidebar to open its data grid
- [ ] Columns are sortable (click header to cycle ASC → DESC → default). Default order is stable (rowid order for rowid tables; PRIMARY KEY order for WITHOUT ROWID tables).
- [ ] Column filters: text (case-insensitive via `WHERE lower(<col>) LIKE lower(?) ESCAPE '\'` contains match — deterministic regardless of `PRAGMA case_sensitive_like`; `%`, `_`, and `\` in user input are escaped with backslash — same escaping rules as the query builder), numeric range (inclusive bounds), NULL/NOT NULL tri-state toggle. All filters generate SQL WHERE clauses (see SQL-backed requirement below).
- [ ] Double-click a cell to edit its value; Enter to save, Escape to cancel
- [ ] Add new row via button at the bottom: attempt `INSERT INTO <table> DEFAULT VALUES` first; if it fails due to NOT NULL columns with no DEFAULT, show a required-fields UI and only INSERT once required values are provided (no partial row committed)
- [ ] Delete rows via selection + delete button (with confirmation)
- [ ] Copy a cell value via right-click context menu → "Copy" (copies the displayed cell value to the clipboard)
- [ ] BLOB cells are read-only and rendered as `[BLOB, N bytes]` placeholders; right-click provides "Save BLOB as file" which downloads the raw bytes
- [ ] **Generated columns** (VIRTUAL/STORED) are displayed but read-only in the grid: they never enter edit mode, and attempted edits show a tooltip/toast explaining they cannot be edited (no UPDATE is executed)
- [ ] Virtual scrolling (via TanStack Virtual) for tables with >1000 rows. No pagination — virtualization is the v1 approach to meet the 100k-row 60fps scroll target.
- [ ] Sorting and filtering are SQL-backed: sort generates `ORDER BY`, filters generate `WHERE` clauses, windowed fetching uses `LIMIT/OFFSET` by default (or keyset pagination via `WHERE rowid > ? ORDER BY rowid LIMIT ?` when sorting by rowid only). Keyset is enabled only when `ORDER BY` is exactly `rowid` (guaranteed unique and NOT NULL).
  - Rowid tables: for non-rowid sorts, `LIMIT/OFFSET` uses a deterministic tie-breaker `ORDER BY <sort_col>, rowid` to prevent duplicate/missing rows across fetch boundaries.
  - WITHOUT ROWID tables: for all sorts, `LIMIT/OFFSET` uses a deterministic tie-breaker `ORDER BY <sort_col>, <pk_col_1>, <pk_col_2>, ...` (PRIMARY KEY columns in PK order).
  No in-memory array operations on full result sets. JS heap does not grow linearly with total row count.
- [ ] **E2E: E2E-US-007-01** — Open a table, double-click cell, change value, press Enter; re-query the row and verify value persisted
- [ ] **E2E: E2E-US-007-02** — Create table t(x INT); insert rows with duplicate x values; sort by x; scroll through virtualized fetch; verify each rowid appears exactly once (no duplicates/missing across windows) and toggling sort back to default returns rowid order
- [ ] **E2E: E2E-US-007-03** — Create table t(a TEXT NOT NULL, b TEXT); click "Add row"; verify required-fields UI appears; cancel results in 0 new rows; submit with a="ok" inserts exactly one row
- [ ] **E2E: E2E-US-007-04** — Create table t(a INT, b INT, PRIMARY KEY(a,b)) WITHOUT ROWID; insert rows with duplicate `a` values; sort by `a`; scroll through virtualized fetch; verify each (a,b) PK pair appears exactly once (no duplicates/missing across windows) and toggling sort back to default returns PRIMARY KEY order
- [ ] **E2E: E2E-US-007-05** — Create table t(x TEXT); insert rows with values `A%b`, `A_b`, and `A\q`. In the grid, apply the text "contains" filter with inputs `%`, `_`, and `\` and verify matches are literal (no wildcard expansion) and case-insensitive.
- [ ] **E2E: E2E-US-007-06** — Create table t(b BLOB); insert one row with a known byte sequence; open grid; use "Save BLOB as file"; verify downloaded file size and bytes match the inserted BLOB
- [ ] **E2E: E2E-US-007-07** — Create table t(a INT, b INT GENERATED ALWAYS AS (a+1) STORED); insert row a=1; open grid; verify b shows 2 and is not editable; verify attempting to edit b does not change data

**Row identity strategy:**
- **For rowid tables (default)**: Always use `rowid` for UPDATE/DELETE targeting, regardless of whether an explicit PK exists. This avoids the SQLite quirk where composite PKs with NULL columns allow duplicate entries.
- **For WITHOUT ROWID tables**: Use the declared PRIMARY KEY columns (which are guaranteed NOT NULL in WITHOUT ROWID tables).
- **Tables with no usable identifier**: Grid opens in read-only mode with a banner: "This table has no usable row identifier. Editing is disabled." (This case should not occur in practice since all tables are either rowid or WITHOUT ROWID with a PK.)
- **Editing PK columns**: Allowed. The UPDATE uses the pre-edit rowid (or PK for WITHOUT ROWID) to target the row.
- **NULL display**: NULL values shown as italic gray "NULL" placeholder; distinct from empty string (shown as empty cell). Editing a cell and leaving it empty saves empty string; a "Set NULL" button/context menu option sets the value to NULL.
- **BLOB display**: BLOB cells shown as "[BLOB, N bytes]" read-only. Export via right-click > "Save BLOB as file".

### US-008: Import CSV and JSON
**Description:** As a data analyst, I want to import a CSV or JSON file into a new or existing table.

**Acceptance Criteria:**
- [ ] Import dialog accepts `.csv` and `.json` files
- [ ] Auto-detect column names from headers (CSV) or keys (JSON)
- [ ] Header normalization: imported column names are trimmed; empty headers are replaced with `column_1`, `column_2`, etc.; duplicate headers (case-insensitive) are auto-suffixed with `_1`, `_2`, etc.; names containing spaces, digits-first, or SQLite reserved words are double-quoted in generated DDL
- [ ] Auto-detect column types via sampling: inspect the first 100 non-NULL values per column. Precedence: if all values parse as integers (no leading zeros, no decimal point) → INTEGER; else if all parse as numbers → REAL; else → TEXT. Leading zeros (e.g., "001") force TEXT (preserves zip codes, IDs). Empty/NULL values are skipped during inference. The preview step shows detected types with a per-column dropdown override (INTEGER / REAL / TEXT) so users can correct before import.
- [ ] Preview first 10 rows before importing
- [ ] Option to import into new table (auto-named) or append to existing table
- [ ] When appending to existing table: columns are matched by name (case-insensitive). Extra columns in the import file are ignored with a warning. Missing columns use DEFAULT or NULL.
- [ ] Progress indicator for large files; cancel button stops import without partial data (transactional)
- [ ] **E2E: E2E-US-008-01** — Import a 100-row CSV with headers; verify table has 100 rows and column names match headers
- [ ] **E2E: E2E-US-008-02** — Import CSV with NULL and empty-string values; verify round-trip (export and re-import yields identical data)
- [ ] **E2E: E2E-US-008-06** — Import a CSV with headers: `""`, `"Name"`, `"name"`, `"select"`. Verify columns become `column_1`, `Name`, `name_1`, `select` and all are double-quoted in generated DDL where needed.
- [ ] **E2E: E2E-US-008-05** — Import a CSV where numeric columns start with NULL/empty rows and later contain values; verify inference samples the first 100 non-NULL values and infers: `"001"`-style values → TEXT, integers → INTEGER, decimals → REAL (validate via `PRAGMA table_info`)
- [ ] On import failure (constraint violation, type error), the error dialog shows: source file row number, column name, SQLite error message, and confirms 0 rows were committed (transactional rollback)
- [ ] **E2E: E2E-US-008-03** — Append CSV missing a NOT NULL column (no DEFAULT) into existing table; verify import fails with clear error and 0 new rows
- [ ] **E2E: E2E-US-008-04** — Append CSV causing UNIQUE violation; verify error identifies the offending value and commits 0 rows

**Data interchange rules (import):**
- **CSV**: UTF-8 encoding required. Files with a UTF-8 BOM are accepted (BOM is stripped silently). Non-UTF-8 files are rejected with error: "This file does not appear to be UTF-8 encoded. Please convert it to UTF-8 before importing." Delimiter auto-detected (comma, semicolon, tab) with manual override. Quoted fields and embedded newlines handled per RFC 4180. Empty unquoted fields → NULL; empty quoted fields (`""`) → empty string.
- **JSON**: Must be an array of flat objects (`[{...}, ...]`). Nested objects/arrays are rejected with error: "Nested structures are not supported; flatten your JSON before importing." Keys become column names. JSON `null` → SQL NULL.
- **BLOB**: Not importable via CSV/JSON in v1. BLOB columns are skipped during import with a warning. BLOB round-trip via CSV/JSON export+import is not supported — the export summary states how many BLOB fields were replaced with placeholders. The `__blob_base64__` marker in JSON export is informational only; v1 import does not parse it back into BLOB.

### US-009: Export database and data
**Description:** As a developer, I want to download the entire database as a `.sqlite` file, or export query results / tables as CSV or JSON.

**Acceptance Criteria:**
- [ ] "Download Database" button exports a transactionally consistent `.sqlite` file via SQLite's `VACUUM INTO` (or `sqlite3_backup` API), not a raw file copy. This ensures the export reflects a single point-in-time snapshot regardless of journal mode or in-flight operations.
- [ ] Quota exceeded contract: exports remain functional even when OPFS/IndexedDB persistence is full by using `sqlite3_backup` into an in-memory buffer + Blob download (no additional OPFS/IDB writes required).
- [ ] "Export Table" button on any table exports as CSV or JSON
- [ ] "Export Results" button on query results exports as CSV or JSON
- [ ] Progress indicator + cancel button for exports with >10k rows
- [ ] **E2E: E2E-US-009-01** — Create table with one TEXT column; insert one NULL row and one empty-string row; export CSV; assert NULL row is empty unquoted field, empty-string row is `""`; re-import into fresh table; verify via SQL one row IS NULL and one row = ''
- [ ] **E2E: E2E-US-009-02** — Force quota exceeded (test harness / injected storage failure); verify "Download Database" still triggers a download of a valid `.sqlite` snapshot

**Data interchange rules (export):**
- **CSV**: UTF-8 with BOM. Comma delimiter. RFC 4180 quoting (fields containing commas, quotes, or newlines are double-quoted). NULL → empty unquoted field. Empty string → quoted empty field (`""`). BLOB → `[BLOB]` placeholder with warning in export summary. **Formula injection protection**: Export dialog includes a toggle "Spreadsheet-safe export" (default ON) with tooltip: "Prefixes text values that could be interpreted as formulas. Numeric values are never modified. May affect lossless round-trip of text data." When enabled, only TEXT-typed cell values starting with `=`, `+`, `-`, `@`, `\t`, `\r` are prefixed with a single quote (`'`). INTEGER and REAL values are never modified (e.g., `-42` exports as `-42`). NULL is never modified. When disabled (labeled "Lossless export"), all values are exported raw.
- **JSON**: Array of objects. NULL → JSON `null`. Empty string → JSON `""`. BLOB → `{"__blob_base64__": "<base64>", "bytes": N}` object (clearly not a string, signals non-roundtrip). Pretty-printed with 2-space indent. Export summary includes count of BLOB fields replaced with placeholders and a warning: "BLOB fields are exported as base64 placeholders and cannot be re-imported in v1."

### US-010: OPFS persistence
**Description:** As a developer, I want my databases to persist across browser sessions without manual save/export.

**Acceptance Criteria:**
- [ ] Databases are auto-saved to OPFS after every write operation (see persistence contract below)
- [ ] On app load, previously opened/imported databases appear in the sidebar
- [ ] User can delete a persisted database (confirmation dialog; removes DB file, associated metadata files such as `.erd.json`, registry entry from OPFS/IndexedDB, and per-DB localStorage data such as query history `qh:<db-name>`; removes from sidebar)
- [ ] Fallback to IndexedDB when OPFS is not available (see Supported Browsers & Storage Modes)
- [ ] Storage usage indicator shown in settings
- [ ] **E2E: E2E-US-010-01** — Edit a cell; hard refresh; reopen DB; verify edited value persisted
- [ ] **E2E: E2E-US-010-02** — Edit a cell, commit (press Enter), immediately hard-refresh; verify value persisted (OPFS VFS direct mode: commit = durable, no timing dependency)
- [ ] **Multi-tab read-only enforcement**: If a DB is open for editing in another tab, opening it here must be read-only (UI disables all write entry points; SQL editor blocks non-readonly statements before execution).
- [ ] **Take over editing (heartbeat fallback only)**: When Web Locks are unavailable and the other tab heartbeat is stale (>10s), user can explicitly take over editing via confirmation; takeover attempts while heartbeat is fresh are disabled.
- [ ] **E2E: E2E-US-010-03** — (Web Locks available) Open DB in Tab A (editable). Open same DB in Tab B. Verify Tab B is read-only with banner, grid edits are disabled, and SQL editor blocks `CREATE TABLE ...`. Close Tab A; click "Retry" in Tab B; verify Tab B becomes editable.
- [ ] **E2E: E2E-US-010-04** — (Heartbeat fallback) Disable Web Locks; open DB in Tab A (editable) and Tab B (read-only). Verify "Take over editing" is disabled while heartbeat is fresh and becomes enabled after heartbeat is stale; confirm takeover → Tab B becomes editable and Tab A is forced into read-only (best-effort via BroadcastChannel).
- [ ] **E2E: E2E-US-010-05** — Toggle FK enforcement OFF for DB "chinook"; hard refresh; reopen "chinook"; verify `PRAGMA foreign_keys` returns 0 and registry.json shows `"fkEnforced": false`.

**Persistence architecture: OPFS VFS direct mode (primary)**

The database is opened directly on wa-sqlite's OPFS-backed VFS (`OPFSCoopSyncVFS` or equivalent). SQLite's own journaling and transaction semantics provide durability — writes are durable after each SQLite transaction commit. There is no separate "snapshot save" or "debounced copy" step in OPFS mode.

```
[User action] → [SQLite transaction COMMIT] → [durable on OPFS via VFS]
```

- **Durability guarantee**: After a successful SQLite COMMIT, data is persisted. No debounce timer, no flush-on-close race. The `beforeunload` handler is not needed for durability in OPFS mode (it is used only to warn about in-flight UI edits not yet committed to SQLite).
- **Import flow**: File → `File.stream()` (ReadableStream) → write chunks (1MB) to OPFS via SyncAccessHandle in the worker → open from OPFS via VFS. No full ArrayBuffer is allocated; peak heap from import is ~1MB (chunk size).
- **Status indicator**: Status bar shows "Saved" after each successful commit; "Unsaved" while a cell edit is in progress but not yet committed.

**Persistence: IndexedDB fallback mode**

When OPFS VFS is unavailable, the app falls back to a snapshot-based model:
- **Save strategy**: Debounced — saves are batched with a 500ms debounce after the last SQLite write. The full database is serialized via `sqlite3_serialize()` (returns a byte array of the in-memory DB) and stored as a Blob in IndexedDB. On load, the Blob is read back and restored via `sqlite3_deserialize()`. Peak memory during snapshot: ~1x DB size (the serialized byte array). For DBs approaching the 50MB fallback limit, this may briefly require ~100MB heap (DB + serialized copy); the 50MB warning helps users stay within safe bounds.
- **Status indicator (IndexedDB mode)**: Status bar shows "Unsaved" after a write, "Saving..." while the snapshot is being written to IndexedDB, and "Saved" only after the IndexedDB transaction commits. If a snapshot fails (e.g., serialization error), the status shows "Save failed — retrying..." and the app retries up to 3 times with exponential backoff (1s, 2s, 4s). After 3 failures, a blocking modal warns: "Unable to save. Export your database to avoid data loss." Writes continue to be accepted (data is in the in-memory SQLite instance) but the user is warned that persistence is degraded.
- **Flush on close**: On `beforeunload` and `visibilitychange` (hidden), any pending save is flushed. This is best-effort — data written within the last debounce window may be lost if the tab is force-killed. The UI warns: "IndexedDB mode: save-on-close is best-effort."
- **Atomicity**: Best-effort (IndexedDB transaction). No atomic rename available.

**Quota exceeded (both modes):** Detected by mapping storage errors: OPFS `DOMException` with name `QuotaExceededError`, SQLite IO errors from wa-sqlite VFS (`SQLITE_FULL` / `SQLITE_IOERR`), and IndexedDB `QuotaExceededError`. On detection, app shows a blocking modal (once per session per DB unless state changes): "Storage full. Export your database to free space." DB remains openable and readable. Export and delete operations remain functional. Export avoids OPFS/IDB writes by using an in-memory snapshot (`sqlite3_backup` → serialize → Blob download) when storage is full. Write operations are blocked at all entry points: data grid edits, table designer apply, ERD FK create/edit/delete, import, and SQL editor DML/DDL all show the quota error and refuse to execute. Multi-statement SQL scripts that hit quota mid-execution are rolled back atomically.

**Multi-tab policy**: Single-writer lock via Web Locks API. Second tab opening the same DB gets a read-only banner: "This database is open for editing in another tab." Closing the first tab releases the lock. **Read-only enforcement**: When in read-only mode (multi-tab or explicit), the SQLite connection is opened with `SQLITE_OPEN_READONLY` flag. All write entry points are disabled in the UI (grid edit, add/delete row, table designer apply, ERD FK create/edit/delete, import). In the SQL editor, each statement is pre-checked via `sqlite3_stmt_readonly()` after prepare; non-readonly statements (DML, DDL, write PRAGMAs like `PRAGMA user_version=...`) are blocked before execution with a toast: "Database is read-only." `SQLITE_OPEN_READONLY` serves as the hard backstop. The data grid, query editor (SELECT/read-only PRAGMAs), and export all remain functional.

### US-011: PWA / offline support
**Description:** As a developer, I want the app to work offline after the first visit and be installable as a PWA.

**Acceptance Criteria:**
- [ ] Service worker caches all app assets (including WASM binary, CodeMirror workers, fonts — no CDN/runtime fetches)
- [ ] App loads and functions fully without network after initial install
- [ ] Web app manifest with icon, name, standalone display mode
- [ ] "Install" prompt appears on supported browsers
- [ ] SW update checks are the only permitted network activity after initial load; all other requests are served from cache
- [ ] **E2E: E2E-US-011-01** — Load app online; set browser offline (intercept all requests); reload; open persisted DB; run SELECT query; edit cell; export CSV — all succeed. Assert zero failed network requests (SW update check may fire but is non-blocking and allowed to fail silently).

### US-012: Sidebar navigator
**Description:** As a developer, I want a sidebar that lists all open databases, their tables, views, and indexes for quick navigation.

**Acceptance Criteria:**
- [ ] Tree view: Database > Tables / Views / Indexes
- [ ] Click table to open data grid
- [ ] Right-click context menu: Open, Design, Rename, Drop
- [ ] Search/filter within the sidebar: case-insensitive **substring match** on table/view/index names within the **active DB** schema tree (non-active DBs remain name-only until activated)
- [ ] When filtering, matching groups auto-expand and the matched substring is highlighted; `Escape` clears the filter and restores the pre-filter expansion state
- [ ] **Multi-DB sidebar behavior**: Only one DB is loaded into wa-sqlite at a time (see Decision 17). Non-active DBs show their name only (collapsed, no schema tree). Expanding a non-active DB switches the active DB (closes the current one, opens the selected one). Schema metadata is not cached — it is read from SQLite on each DB open. A brief loading indicator appears during the switch. **IndexedDB switch contract**: In IndexedDB fallback mode, switching DBs flushes any pending debounced snapshot and awaits the IndexedDB transaction commit before disposing the in-memory SQLite instance. The UI shows "Saving..." and blocks the switch until complete. If the snapshot fails after 3 retries, the user is prompted: "Unable to save [DB name]. Switch anyway and lose unsaved changes, or cancel?"
- [ ] **E2E: E2E-US-012-01** — Open DB with tables/views/indexes; type filter text (mixed case); sidebar shows only matching nodes (tables/views/indexes) via case-insensitive substring match; press Escape clears filter and restores full tree
- [ ] **E2E: E2E-US-012-02** — Create DB1 (2 tables) and DB2 (3 tables). Verify sidebar lists both. Expand DB2; verify DB1 collapses to name-only and DB2 shows its 3 tables. Switch back to DB1; verify DB2 collapses. Repeat 20 times; verify no memory trend upward (worker handles released on close).

### US-013: Database lifecycle (rename / delete / switch)
**Description:** As a developer, I want to rename, delete, and switch between persisted databases safely so that I can manage multiple projects without losing data.

**Acceptance Criteria:**
- [ ] Rename DB: right-click DB name → "Rename" → inline input. Validation uses the Database naming rules (1–64 chars, allowed chars, case-insensitive collision check).
- [ ] Rename DB persists (storage-mode aware): In OPFS mode, renames the `.sqlite` file, associated `.erd.json` sidecar, and updates `registry.json` and per-DB query history key (`qh:<old>` → `qh:<new>`). In IndexedDB fallback mode, flushes pending snapshot, re-keys the `databases` store entry and the `metadata` store entry, updates the registry store, and migrates the query history key. On refresh, only the new name appears.
- [ ] Rename collision is blocked with inline error: "A database named '[name]' already exists."
- [ ] Delete DB: right-click DB name → "Delete" → confirmation dialog ("This cannot be undone"). On confirm, DB file + sidecars are removed, registry entry removed, and `qh:<db>` is deleted.
- [ ] Switch DB: selecting a different DB runs the unsaved-change check: if a cell edit is in progress → Save / Discard / Cancel; else if there are unapplied draft changes in the Table Designer, ERD FK dialog, or Query Builder → Discard draft changes / Cancel.
- [ ] IndexedDB fallback switch contract: after Save, the pending snapshot is flushed and awaited before disposing the in-memory instance. If snapshot fails after 3 retries, prompt: "Switch anyway and lose unsaved changes, or cancel?"
- [ ] **E2E: E2E-US-013-01** — Create DB "a"; rename to "b"; hard refresh; verify "b" exists and "a" does not; query history migrated (key `qh:b` contains previous entries).
- [ ] **E2E: E2E-US-013-02** — Create DB "temp"; delete it; hard refresh; verify it no longer appears and opening OPFS/IDB shows no leftover `.sqlite`/`.erd.json` for temp.
- [ ] **E2E: E2E-US-013-03** — With two DBs, start editing a cell in DB1; switch to DB2; choose Discard; verify DB1 edit not persisted.
- [ ] **E2E: E2E-US-013-04** — Force IndexedDB fallback mode; edit a cell; immediately switch DB; verify the edit is persisted after refresh (switch awaited snapshot).
- [ ] **E2E: E2E-US-013-05** — With two DBs, open the Table Designer with draft column additions in DB1; switch to DB2; verify the "Discard draft changes / Cancel" prompt appears; choose Discard; verify DB1 schema is unchanged.
- [ ] **E2E: E2E-US-013-06** — Force IndexedDB fallback mode; create DB "x"; rename to "y"; hard refresh; verify "y" exists, "x" does not, and IndexedDB `databases` store has entry keyed "y" (not "x").

## Functional Requirements

- FR-1: Load `.sqlite`/`.db` files via drag-and-drop or file picker into wa-sqlite WASM engine; auto-import into OPFS as a persisted database
- FR-2: Create new empty SQLite databases with user-provided name (validated per naming rules)
- FR-3: Display database schema (tables, views, indexes) in a sidebar tree navigator
- FR-4: Visual table designer: add/edit/remove/reorder columns with type and constraint selection, preview DDL diff, apply changes via transactional table rebuild with dependency analysis
- FR-5: ERD relationship editor: render tables as React Flow nodes, FK relationships as edges, drag-to-connect to create single-column FKs, drag tables to reposition
- FR-6: SQL query editor with CodeMirror 6 syntax highlighting, multi-statement execution (atomic transaction by default), result grid, error display with line numbers, and query history
- FR-7: Visual query builder: select tables, check columns, drag to define INNER/LEFT/RIGHT joins, add WHERE/ORDER BY/LIMIT, live SQL preview. No GROUP BY/HAVING/aggregates/subqueries in v1.
- FR-8: Data grid: sortable columns, column filters, inline cell editing (using rowid for rowid tables, PK for WITHOUT ROWID), add/delete rows, virtual scrolling for large tables
- FR-9: Import CSV (RFC 4180) and JSON (flat array-of-objects) with auto-detection of columns and types, preview, column-name matching for append, transactional import
- FR-10: Export full database as `.sqlite`, export tables/results as CSV (RFC 4180, UTF-8 BOM, lossless NULL/empty-string encoding) or JSON (array-of-objects)
- FR-11: Persist databases via OPFS VFS direct mode (transaction-level durability, no debounce); restore on app load; fallback to IndexedDB (snapshot-based, debounced 500ms); single-writer lock via Web Locks API
- FR-12: PWA with service worker (all assets bundled, no CDN fetches), web manifest, offline support, installable
- FR-13: All processing client-side — no network calls after initial load except SW update checks (non-blocking, fail silently offline)

## Non-Goals (Out of Scope)

- No server or backend of any kind
- No multi-user collaboration, sharing, or real-time sync
- No cloud storage (Google Drive, Dropbox, etc.)
- No trigger or stored procedure editor
- No Access-style form designer or report designer
- No database migration tooling
- No Git integration or version history
- No mobile-optimized layout (desktop-first)
- No spreadsheet-style multi-cell paste/fill-down in the data grid in v1 (single-cell edits only)
- No dark mode in v1 (light theme only)
- No SQLCipher / encrypted database support

## Supported Browsers & Storage Modes

### Browser support matrix

| Browser | Version | OPFS SyncAccessHandle | Status |
|---------|---------|----------------------|--------|
| Chrome / Edge | 120+ | Yes | **Fully supported** (primary target) |
| Firefox | 121+ | No (async only) | Supported with IndexedDB fallback |
| Safari | 17.4+ | Partial | Supported with IndexedDB fallback |
| Other | — | — | Not tested; best-effort |

### Storage mode decision tree

1. **Check**: Is `FileSystemSyncAccessHandle` available in a Web Worker?
   - **Yes** → Use OPFS sync mode via wa-sqlite VFS (full performance, transaction-level durability)
   - **No** → Fall back to IndexedDB via idb-keyval (snapshot-based persistence)

**Non-goal (v1):** OPFS async access handles (available in some Firefox/Safari builds) are intentionally skipped. wa-sqlite's VFS requires synchronous access handles; an async intermediate tier would require a custom VFS wrapper with SharedArrayBuffer/Atomics, adding complexity (cross-origin isolation headers, COOP/COEP deployment constraints) disproportionate to the benefit. This may be revisited in a future version.

### Fallback contract (IndexedDB mode)

When running in IndexedDB fallback mode:
- **Persistence**: Functional. Databases are stored as blobs in IndexedDB.
- **Atomicity**: Best-effort (IndexedDB transactions, but no atomic rename). Corruption risk is slightly higher; app warns on startup.
- **Max recommended DB size**: 50MB (vs 100MB in OPFS mode). Files >50MB show a warning: "Large databases may be slow in fallback storage mode."
- **Multi-tab**: Web Locks API used when available (in both OPFS and IndexedDB modes). When Web Locks are unavailable, enforce single-tab via a `localStorage` heartbeat (write timestamp every 2s; stale threshold: 10s to account for background-tab timer throttling). A hidden tab continues to be considered alive if its last heartbeat is within the threshold. The second tab opens in **read-only mode** with writes fully blocked. The UI shows: "This database is open for editing in another tab. Close the other tab to edit here." If the heartbeat expires (>10s stale), the waiting tab shows a **"Take over editing"** button requiring explicit user confirmation — it does not auto-acquire. `BroadcastChannel` is used (when available) to coordinate: the taking-over tab sends a "release" message, and the original tab (if still alive) downgrades to read-only.
- **Performance targets**: Load/save times may be 2–5x slower than OPFS mode. No hard perf guarantees in fallback.
- **Banner**: "Using IndexedDB fallback — some features may be slower. Use Chrome or Edge for best performance."

## Security & Trust Model

All data originates from untrusted local files (user-opened `.sqlite`, imported CSV/JSON). The app has no backend, but must still protect against DOM-based attacks:

- **HTML escaping**: All strings rendered in the DOM (cell values, table/column names, error messages, query history, import previews) are HTML-escaped. React's default JSX escaping covers most surfaces; `dangerouslySetInnerHTML` is never used.
- **Content Security Policy**: The app ships a strict CSP. In production, CSP is delivered as an HTTP response header (preferred for full directive support including `frame-ancestors`). For local development, a `<meta>` tag fallback is acceptable (note: `frame-ancestors` is ignored in `<meta>` tags).
  - `default-src 'self'`; `script-src 'self' 'wasm-unsafe-eval'` (required for WASM); `style-src 'self' 'unsafe-inline'` (Tailwind); `worker-src 'self' blob:` (bundler may emit blob URL workers); `connect-src 'self'`; `frame-ancestors 'none'` (header only); `object-src 'none'`.
  - No `eval()`, no inline scripts, no external resource loading.
  - **E2E: E2E-SEC-02** — Load the production build with CSP enabled; verify WASM loads, workers start, and zero CSP violations appear in the console during a full workflow (load DB, edit, import, export, ERD, query).
- **SQL generation safety**: The table designer and query builder use identifier quoting (`"column"`) for all generated DDL/DML. Cell edit values use parameterized queries (`?` placeholders), never string interpolation.
- **Worker isolation**: The wa-sqlite WASM engine runs in a dedicated Web Worker. The main thread communicates via structured-clone messages only.
- **E2E: E2E-SEC-01** — Seed a DB with a cell value `<img src=x onerror=alert(1)>` and a table name `<script>alert(2)</script>`; open in app; verify no script executes, UI renders escaped text, and no CSP violations are reported.

## Persistence & Storage Layout

### OPFS directory structure
```
/wasm-sqlite-editor/
  registry.json          ← DB registry (see below)
  databases/
    chinook.sqlite       ← DB file (extension always .sqlite)
    chinook.erd.json     ← ERD metadata sidecar
    mydb.sqlite
    mydb.erd.json
```

### Database registry (`registry.json`)
```json
{
  "v": 1,
  "databases": [
    { "name": "chinook", "file": "chinook.sqlite", "createdAt": "2025-01-15T10:30:00Z", "lastOpenedAt": "2025-01-20T14:00:00Z", "fkEnforced": true },
    { "name": "mydb", "file": "mydb.sqlite", "createdAt": "2025-01-18T09:00:00Z", "lastOpenedAt": "2025-01-18T09:00:00Z", "fkEnforced": true }
  ]
}
```
- **Timestamps**: ISO 8601 UTC strings (e.g., `"2025-01-15T10:30:00Z"`). `lastOpenedAt` updates each time the DB becomes the active DB.
- **Startup enumeration**: On app load, read `registry.json` to populate the sidebar. If the registry is missing or corrupt, rebuild it by scanning the `databases/` directory for `.sqlite` files (self-healing). Display names are derived from filenames (minus extension). **Case collision during self-heal**: If scanning finds two files that differ only by case (e.g., `MyDB.sqlite` and `mydb.sqlite`), keep the most recently modified file (via `handle.getFile().lastModified`; if timestamps are equal or unavailable, pick the lexicographically first filename) and auto-rename the other with a `(conflict)` suffix (e.g., `mydb (conflict).sqlite`). In IndexedDB mode, use the IDB entry's last-modified timestamp or key order as tie-breaker. Log the resolution to the console.
- **Rename**: Close the DB connection first (checkpoint any journal). Update the registry entry `name` and `file`, rename the `.sqlite` and `.erd.json` files in OPFS. Also rename any SQLite journal sidecar files (`-journal`, `-wal`, `-shm`) if present (should not exist in DELETE journal mode, but defensively handled). If rename partially fails, the next startup self-heal reconciles by re-scanning.
- **Delete**: Close the DB connection first. Remove the DB file, all associated sidecar files (`.erd.json`, `-journal`, `-wal`, `-shm`), and the registry entry. Self-heal on next startup garbage-collects orphaned sidecar and journal files.
- **Schema version**: `"v": 1`. Unknown keys are preserved (forward-compatible). Future migrations keyed by version number.

### IndexedDB storage layout
In IndexedDB fallback mode, the same logical structure is maintained:
- **Store `databases`**: Each entry keyed by DB name, value is a blob (serialized SQLite file).
- **Store `metadata`**: Each entry keyed by `<db-name>.erd`, value is JSON string.
- **Store `registry`**: Single entry with the registry JSON.
- **Rename**: Flush pending snapshot → create new entry in `databases` store with new key and same blob → create new entry in `metadata` store (`<new>.erd`) with same value → delete old entries → update `registry` store. If rename partially fails, self-heal on next startup reconciles by scanning store keys.
- Self-healing on corrupt/missing registry works identically (scan `databases` store keys).

### Query history storage
- **Scope**: Per-database, stored in localStorage under key `qh:<db-name>`.
- **Retention**: Last 50 queries per DB, FIFO eviction.
- **Persistence**: Survives page reload. A "Clear history" button in the query editor dropdown empties the list.
- **Privacy**: Local-only; never exported or synced.

## Design Considerations

- **Layout**: Three-panel layout — sidebar (schema navigator), main area (grid/editor/designer), bottom panel (query results/console)
- **Theme**: Light mode only in v1. Clean, professional — not playful.
- **ERD view**: React Flow (SVG). Tables as rounded rectangles with column lists. FK lines with arrow endpoints. Drag to pan, scroll to zoom.
- **Table designer**: Form-style panel. Each column is a row with inputs for name, type dropdown, constraint checkboxes. Drag handle for display reorder. Confirmation dialog for destructive changes. Dependency warning for columns referenced by indexes/FKs/triggers.
- **Data grid**: Spreadsheet feel. Fixed header row. Alternating row colors. Compact row height. Resizable columns. NULL shown as italic gray placeholder.
- **Query editor**: CodeMirror 6 for syntax highlighting. Split view: editor on top, results on bottom. Multi-statement results shown as summary + last SELECT grid.
- **Keyboard shortcuts**: Ctrl+Enter (run query), Ctrl+S (export/download database — since OPFS mode auto-persists, Ctrl+S triggers the "Download Database" export flow; the browser's default "Save Page" is prevented), Ctrl+N (new database), Escape (cancel edit)

## Technical Considerations

- **WASM engine**: wa-sqlite — native OPFS support, eliminates manual bridging for persistence. SQLite feature baseline: >= 3.45 (includes DROP COLUMN support, improved ALTER TABLE).
- **Framework**: React (TypeScript) — richer ecosystem for CodeMirror, drag-and-drop (dnd-kit), and grid components. Tailwind CSS for styling.
- **Build tool**: Vite
- **Grid**: TanStack Table for headless logic + custom Tailwind-styled renderer. Virtualization via TanStack Virtual.
- **Code editor**: CodeMirror 6 (lighter than Monaco, better tree-shaking, SQLite language support). All editor assets bundled — no CDN worker fetches.
- **ERD rendering**: React Flow (SVG-based, accessible, DOM event handling).
- **Drag-and-drop**: dnd-kit for table designer column reorder and ERD table positioning
- **OPFS**: Open database directly on wa-sqlite's OPFS-backed VFS (`OPFSCoopSyncVFS`) in a Web Worker. SQLite's own journaling provides durability on commit — no separate save/flush mechanism needed. Import uses chunked streaming into OPFS before opening. Single-writer lock via Web Locks API. Fall back to IndexedDB blob snapshots via idb-keyval when SyncAccessHandle is unavailable.
- **PWA**: Vite PWA plugin (vite-plugin-pwa) with Workbox. Precache all assets including WASM binary and editor workers.
- **State management**: Zustand for global state (open databases, active tab, sidebar state)
- **Testing**: Vitest for unit tests, Playwright for E2E (see E2E test IDs in user stories)
- **File parsing**: PapaParse for CSV (RFC 4180 compliant), native JSON.parse for JSON

## Performance & Scale Targets

- **Baseline environment**: Chrome 120+ on a mid-range laptop (e.g., 4-core, 8GB RAM, integrated GPU).
- **Load time**: User can load a 1MB `.sqlite` fixture and run `SELECT * FROM <table> LIMIT 100` within 10 seconds of cold first page load (no SW cache).
- **Large file load**: 100MB `.sqlite` fixture loads and persists to OPFS within 60 seconds on baseline environment. Progress indicator visible throughout. Peak JS heap must remain under 250MB (< 2.5x file size). Measured in CI via Chrome DevTools Protocol (CDP) heap sampling in Playwright/Chromium. Heap assertions are Chromium-only; Firefox/WebKit CI jobs run functional E2E without heap gates. All perf tests emit trace + JSON metric artifacts for regression triage.
- **"Crash" definition**: A tab reload, browser OOM kill, or main thread unresponsive for >10 seconds constitutes a crash. The 100MB target means zero crashes during load → persist → query workflow.
- **Virtual scrolling**: Data grid with 100k rows achieves median frame time < 16ms (60fps) during scroll, measured via `requestAnimationFrame` timing. Fixture: single table, 10 columns, 100k rows of mixed types.
- **Lighthouse**: PWA score >= 90, Performance score >= 80 (on baseline environment with 100ms simulated latency).
- **Measurement approach**: Repo includes fixture generator script (`scripts/generate-fixtures.ts`) and Playwright perf test suite. CI runs Lighthouse CI on each PR.

## Success Metrics

- User can load a 1MB `.sqlite` file and run a query within 10 seconds of cold first page load (Chrome 120+, mid-range laptop)
- Visual relationship editor correctly renders all FK connections from an imported database (verified via Chinook fixture, deterministic FK count query)
- Data grid handles 100k rows with < 16ms median frame time during scroll
- **OPFS mode (Chrome/Edge)**: Databases up to 100MB load and persist within 60s, peak heap < 250MB, zero crashes
- **IndexedDB fallback**: Databases up to 50MB remain functional (open/query/edit/export) with warnings for >50MB; no hard perf guarantees
- PWA installs and works fully offline (E2E: full workflow with network disabled)
- Lighthouse PWA score >= 90

## Decisions (Resolved)

1. **Framework**: React (TypeScript)
2. **WASM engine**: wa-sqlite (native OPFS support; SQLite >= 3.45 feature baseline)
3. **ERD library**: React Flow
4. **Query builder scope**: Simple — SELECT, JOIN (INNER, LEFT, RIGHT), WHERE, ORDER BY, LIMIT only. No subqueries, GROUP BY, HAVING, or aggregates in v1.
5. **Theming**: Light mode only in v1. No dark mode.
6. **Code editor**: CodeMirror 6 (all assets bundled, no CDN fetches)
7. **FK enforcement**: `PRAGMA foreign_keys = ON` by default, user-togglable
8. **Persistence**: OPFS VFS direct mode (transaction-level durability, no debounce/flush needed); IndexedDB fallback uses debounced snapshot saves. Single-writer lock via Web Locks API.
9. **Row identity**: rowid (for rowid tables) > PK (for WITHOUT ROWID tables) > read-only
10. **Data interchange**: CSV per RFC 4180 (UTF-8 BOM), lossless NULL (empty unquoted) vs empty string (quoted `""`). JSON as flat array-of-objects, NULL → `null`, empty string → `""`
11. **SQL execution**: Multi-statement with implicit atomic transaction; rollback on error
12. **File open semantics**: Import-to-OPFS (copy); original file never modified
13. **Database naming**: 1–64 chars, case-insensitive collision check, auto-suffix on import collision
14. **Encrypted DBs**: Not supported (SQLCipher out of scope for v1)
15. **Views in data grid**: Views open in read-only grid mode. Inline editing is disabled with a banner: "Views are read-only." INSTEAD OF triggers are not surfaced in the UI in v1.
16. **OPFS async access handles**: Not used in v1 (see Storage mode decision tree). IndexedDB fallback is simpler and sufficient for non-Chromium browsers.
17. **Journal mode**: `DELETE` journal mode in OPFS mode (simplest; no WAL/SHM sidecar files to manage). In IndexedDB fallback mode, journal mode is irrelevant (snapshots serialize the entire DB). This avoids the complexity of managing `-wal`/`-shm` files during rename/delete/self-heal.
18. **Memory model for open DBs**: Only one database is loaded into the wa-sqlite engine at a time. Other persisted DBs are listed in the sidebar but not loaded until selected. Switching DBs triggers an **unsaved-change check**: if there are in-progress UI edits not yet committed to SQLite (e.g., a cell being edited), the user is prompted with three options: (1) **Save** — commit the edit, then switch; (2) **Discard** — abandon the edit, then switch; (3) **Cancel** — stay on the current DB. If no cell edit is in progress but there are unapplied draft changes in the Table Designer, ERD FK dialog, or Query Builder, the user is prompted: (1) **Discard draft changes** — abandon drafts and switch; (2) **Cancel** — stay on the current DB. The same prompt applies to `beforeunload` (tab close). In IndexedDB fallback mode, after committing any pending edit, the debounced snapshot is flushed before disposing the in-memory instance (see IndexedDB switch contract in US-012).
