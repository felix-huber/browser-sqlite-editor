# 00 — BRIEF

## One-liner
A browser-based SQLite database editor inspired by Microsoft Access, running entirely client-side via WASM.

## Target users
- Primary: Developers who need to quickly inspect, edit, and design SQLite databases
- Secondary: Data analysts who want a local, no-install DB tool for exploration

## Problem / pain
Existing SQLite tools are either desktop-only (DB Browser), require installation, or lack visual design features. There is no good browser-based tool that combines a visual table designer, relationship editor, and query builder — all running locally with zero server dependency.

## Must-haves (v1)
- [ ] Load existing `.sqlite`/`.db` files (drag-and-drop + file picker)
- [ ] Create new databases from scratch
- [ ] Visual table designer with drag-and-drop column reordering
- [ ] Relationship editor — visually connect foreign keys (Access-style ERD view)
- [ ] Query builder with visual join support
- [ ] SQL query editor with syntax highlighting and result display
- [ ] Data grid with inline cell editing, sorting, filtering
- [ ] Import CSV and JSON into tables
- [ ] Export database as `.sqlite` file download
- [ ] Export tables/query results as CSV and JSON
- [ ] Persist databases locally via OPFS (Origin Private File System)
- [ ] Offline support (PWA with service worker)

## Non-goals (v1)
- No server/backend component
- No multi-user collaboration or sharing
- No cloud storage integration
- No stored procedure or trigger editor
- No form designer (Access-style forms)
- No report designer
- No dark mode (v1 is light theme only)

## Constraints
- **Tech constraints**: TypeScript, React, Tailwind CSS, wa-sqlite (SQLite compiled to WASM with native OPFS support), OPFS for persistence
- **Time constraints**: None specified
- **Legal/privacy/security**: All data stays in-browser. No telemetry. No external network calls after initial load.

## Success metrics
- **Leading indicators**: User can load a `.sqlite` file and run a query within 10 seconds of first visit (cold cache, 1MB file, Chrome 120+ on mid-range laptop); visual relationship editor renders FK connections correctly
- **Lagging indicators**: Handles databases up to 100MB without crashing; PWA installs and works fully offline; Lighthouse PWA score >= 90

## Decisions (resolved from Notes/unknowns)
- **Framework**: React (TypeScript) — richer ecosystem for editor, DnD, grid components
- **WASM engine**: wa-sqlite (native OPFS support; SQLite >= 3.45 feature baseline)
- **ERD rendering**: React Flow (SVG-based, accessible, DOM event handling)
- **Grid**: TanStack Table + TanStack Virtual
- **Code editor**: CodeMirror 6

## References
- [wa-sqlite](https://github.com/nicholasgasior/nicholasgasior-wa-sqlite) — WASM SQLite with native OPFS support (v1 engine)
- [sql.js](https://github.com/sql-js/sql.js) — Considered alternative (no native OPFS)
- [Microsoft Access](https://www.microsoft.com/en-us/microsoft-365/access) — UI inspiration for relationship editor and table designer
- [DB Browser for SQLite](https://sqlitebrowser.org/) — Feature reference
- [OPFS API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system) — Browser persistence
