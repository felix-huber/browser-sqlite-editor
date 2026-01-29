# Onboarding: wasm-sqlite-editor

**Date:** 2026-01-29
**Task ID:** onboarding-2026-01-29

## Project Summary

**wasm-sqlite-editor** is a browser-based SQLite database editor inspired by Microsoft Access, running entirely client-side via WebAssembly. It provides visual tools for schema design, SQL editing, and data manipulation with zero server dependency.

**Version:** 1.1.1
**Lines of Code:** ~75,000+ TypeScript/TSX

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Language | TypeScript 5.6+ (strict mode) |
| Frontend | React 18.3 |
| Styling | Tailwind CSS 4.1 |
| Database | wa-sqlite (SQLite → WASM) |
| Data Grid | TanStack Table 8.20 + TanStack Virtual 3.11 |
| SQL Editor | CodeMirror 6 |
| ERD | React Flow 12.10 |
| State | Zustand 5.0 |
| Build | Vite 5.4 |
| Testing | Vitest 4.0 + Playwright 1.58 |
| PWA | vite-plugin-pwa 1.2 |

## Architecture Overview

### Main Components

```
Browser (Main Thread)           Web Worker
┌────────────────────┐         ┌─────────────────────┐
│ React UI           │ ◄──────►│ wa-sqlite Engine    │
│ Zustand Store      │ postMsg │ OPFS VFS            │
│ Components         │         │ IndexedDB Fallback  │
└────────────────────┘         │ Lock Manager        │
                               └─────────────────────┘
                                        │
                                        ▼
                               ┌─────────────────────┐
                               │ Persistent Storage  │
                               │ - OPFS (primary)    │
                               │ - IndexedDB (fallback)│
                               │ - localStorage      │
                               └─────────────────────┘
```

### Directory Structure

```
src/
├── App.tsx                    # Main application component
├── main.tsx                   # React entry point
├── components/
│   ├── common/                # Shared: dialogs, banners, dropzone
│   ├── layout/                # AppShell, StatusBar
│   ├── sidebar/               # DB tree navigation
│   ├── sql/                   # SQL editor with CodeMirror
│   ├── grid/                  # Data grid (TanStack)
│   ├── designer/              # Visual table designer
│   ├── erd/                   # ERD with React Flow
│   ├── query-builder/         # Visual query builder
│   ├── import/                # CSV/JSON import
│   ├── export/                # Export dialogs
│   ├── settings/              # Settings panel
│   └── welcome/               # Welcome/empty state
├── hooks/                     # Custom React hooks
├── lib/                       # Core business logic
│   ├── worker-client.ts       # Worker RPC client
│   ├── schema.ts              # Schema introspection
│   ├── ddl.ts                 # DDL generation
│   ├── rebuild.ts             # Table rebuild for ALTER
│   ├── csv.ts, json.ts        # Import/export
│   └── sql-escape.ts          # SQL escaping utilities
├── worker/                    # Web Worker
│   ├── index.ts               # Entry point + message handler
│   ├── db-registry.ts         # Database metadata
│   ├── idb-storage.ts         # IndexedDB persistence
│   ├── web-locks.ts           # Multi-tab coordination
│   └── query-*.ts             # Query handlers
├── store/                     # Zustand state store
└── types/                     # TypeScript interfaces (~900 lines)

e2e/                           # Playwright E2E tests (15 test files)
```

## Key Features

1. **Database Management**: Create, import (.sqlite/.db), export databases
2. **Visual Table Designer**: Drag-and-drop column editor
3. **ERD Editor**: Visual foreign key management with React Flow
4. **SQL Editor**: CodeMirror with syntax highlighting, autocomplete, history
5. **Data Grid**: Virtual scrolling (100k+ rows), inline editing
6. **Query Builder**: Visual SELECT builder with JOIN support
7. **Import/Export**: CSV/JSON import, multi-format export
8. **PWA**: Full offline support with service worker
9. **Multi-Tab**: Web Locks for single-writer coordination

## Worker Communication

**Pattern:** Correlation ID-based RPC

```typescript
// Main thread (worker-client.ts)
const result = await workerClient.query({ sql: 'SELECT * FROM users' });

// Worker receives message with correlationId
// Worker responds with same correlationId
```

**Key Message Types:**
- `open`, `close`, `exec`, `query`
- `schema`, `tableInfo`, `foreignKeys`
- `createTable`, `alterTable`, `dropTable`
- `import`, `export`
- `acquireLock`, `releaseLock`, `checkLock`

## Persistence Strategy

1. **OPFS (Primary)**: Chrome 86+, Edge 86+, Firefox 111+
   - Native file system access
   - Best performance

2. **IndexedDB (Fallback)**: Safari and older browsers
   - Snapshot + write log for durability
   - Slower but broader compatibility

3. **Registry**: JSON file tracking all databases
   - Stored in both OPFS and IndexedDB

## State Management (Zustand)

**Key State:**
- `databases`: Registry of all databases
- `activeDbId`: Currently open database
- `schema`: Tables, views, indexes for active DB
- `isReadOnly`: Lock state for multi-tab
- `persistenceStatus`: saved/unsaved/saving/error
- `storageFull`: Quota exceeded flag

## Testing Strategy

### Unit Tests (Vitest)
```bash
npm test              # Run all
npm run test:watch    # Watch mode
npm run test:coverage # Coverage report
```

### E2E Tests (Playwright)
```bash
npm run test:e2e         # Headless
npm run test:e2e:ui      # Interactive UI
npm run test:e2e:headed  # Visible browser
```

**15 E2E Test Files:**
- `smoke.spec.ts` - App loads
- `db-lifecycle.spec.ts` - Create/rename/delete
- `persistence.spec.ts` - Data survives refresh
- `multitab.spec.ts` - Lock coordination
- `grid-read.spec.ts` - Browse data
- `grid-edit.spec.ts` - Edit/add/delete rows
- `sql-editor.spec.ts` - Query execution
- `table-designer.spec.ts` - Schema design
- `erd.spec.ts` - FK management
- `query-builder.spec.ts` - Visual queries
- `import.spec.ts` - CSV/JSON import
- `import-export.spec.ts` - Round-trip
- `pwa.spec.ts` - Offline support
- `accessibility.spec.ts` - A11y checks
- `perf/perf.spec.ts` - Performance

## Development Commands

```bash
npm install           # Install dependencies
npm run dev           # Start dev server (localhost:5173)
npm run build         # Production build
npm run preview       # Test production build
npm run lint          # ESLint
npm run typecheck     # TypeScript check
npm run size          # Bundle size check
```

## Recent Git History

```
dbf62ae Improve E2E test reliability and update tooling
45c20ba Fix import progress messages to use broadcast instead of response
fbdf8a0 Fix worker-client communication by adding correlation IDs
9e0004b Bump version to 1.1.0
1d011c7 Fix app integration and add missing worker handlers
```

## Critical Rules from CLAUDE.md

1. **Never delete files without permission**
2. **No file proliferation** - Edit existing files, don't create `_v2`, `_improved` variants
3. **No automated code transforms** - Manual changes only
4. **Simplicity check** - Avoid over-engineering

## Browser Compatibility

| Browser | OPFS | IndexedDB | Web Locks |
|---------|------|-----------|-----------|
| Chrome 86+ | ✅ | ✅ | ✅ |
| Edge 86+ | ✅ | ✅ | ✅ |
| Firefox 111+ | ✅ | ✅ | ✅ |
| Safari 15.2+ | ❌ | ✅ | ⚠️ |

## Current Status

The project is at v1.1.1 with all major features implemented:
- ✅ Visual table designer
- ✅ ERD relationship editor
- ✅ SQL editor with history
- ✅ Data grid with virtual scrolling
- ✅ Query builder with JOINs
- ✅ CSV/JSON import/export
- ✅ PWA offline support
- ✅ Multi-tab coordination
- ✅ Comprehensive E2E tests

## Quality Gates

- TypeScript compiles without errors
- ESLint passes
- All unit tests pass
- All E2E tests pass
- Lighthouse PWA >= 90
- Bundle size limits:
  - Main JS: 100 KB (gzipped)
  - Total JS: 300 KB
  - Total CSS: 50 KB

## Next Steps for Current Session

User has requested:
1. Review E2E tests for debug output quality
2. Run E2E tests and fix issues until all pass

---

*This onboarding document can be reused for future sessions working on this project.*
