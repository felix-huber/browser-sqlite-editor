# SQLocal - Local SQLite Browser Editor

Offline SQLite editor in your browser. Visual table designer, ERD diagrams, SQL editor with autocomplete. No server needed.

**100% browser-based, powered by WASM. Private. Open source.**

[![Build](https://github.com/felix-huber/browser-sqlite-editor/actions/workflows/ci.yml/badge.svg)](https://github.com/felix-huber/browser-sqlite-editor/actions/workflows/ci.yml)
[![E2E Tests](https://github.com/felix-huber/browser-sqlite-editor/actions/workflows/ci.yml/badge.svg?branch=main&event=push)](https://github.com/felix-huber/browser-sqlite-editor/actions/workflows/ci.yml)
[![Lighthouse](https://github.com/felix-huber/browser-sqlite-editor/actions/workflows/ci.yml/badge.svg?branch=main&event=push)](https://github.com/felix-huber/browser-sqlite-editor/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![PWA](https://img.shields.io/badge/PWA-installable-blueviolet)](https://web.dev/progressive-web-apps/)

## Features

- **Visual Table Designer** - Create and modify tables with drag-and-drop column reordering
- **ERD Relationship Editor** - Visually connect foreign keys in an Access-style diagram
- **SQL Editor** - Syntax highlighting, autocomplete, and query history
- **Data Grid** - Virtual scrolling, inline editing, sorting, and filtering
- **Query Builder** - Build queries visually with JOIN support
- **Import/Export** - Load `.sqlite`/`.db` files, import CSV/JSON, export databases and query results
- **Offline Support** - PWA with service worker for full offline functionality
- **Zero Server** - Runs entirely in your browser with no backend required

![SQLocal Interface](docs/screenshots/main-interface.png)

## Installation

### PWA Install (Recommended)

1. Open the app in Chrome, Edge, or Firefox
2. Click the install icon in the address bar (or use the browser menu)
3. The app will install and can be launched from your desktop/apps

### From Source

```bash
git clone https://github.com/felix-huber/browser-sqlite-editor.git
cd browser-sqlite-editor
npm install
npm run dev
```

## Quick Start

### Create a New Database

1. Click **New Database** or press `Cmd/Ctrl+N`
2. Enter a name for your database
3. Start creating tables in the Table Designer

### Import an Existing SQLite File

1. Drag and drop a `.sqlite` or `.db` file onto the app
2. Or click **Open Database** (`Cmd/Ctrl+O`) to use the file picker
3. Your database will be loaded and persisted locally

### Run Queries

1. Select **SQL Editor** from the sidebar
2. Write your SQL query
3. Press `Cmd/Ctrl+Enter` to execute
4. View results in the data grid below

## Screenshots

| Data Grid | SQL Editor |
|-----------|------------|
| ![Data Grid](docs/screenshots/data-grid.png) | ![SQL Editor](docs/screenshots/sql-editor.png) |

| ERD Diagram | Table Designer |
|-------------|----------------|
| ![ERD](docs/screenshots/erd-diagram.png) | ![Table Designer](docs/screenshots/table-designer.png) |

| Query Builder |
|---------------|
| ![Query Builder](docs/screenshots/query-builder.png) |

## Keyboard Shortcuts

### Global

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl+O` | Open database file |
| `Cmd/Ctrl+N` | New database |
| `Cmd/Ctrl+S` | Save changes |
| `Cmd/Ctrl+W` | Close database |
| `Cmd/Ctrl+,` | Open settings |

### SQL Editor

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl+Enter` | Execute query |
| `Cmd/Ctrl+Shift+Enter` | Execute and explain |
| `Escape` | Cancel query |

### Data Grid

| Shortcut | Action |
|----------|--------|
| `Enter` | Edit selected cell |
| `Escape` | Cancel edit |
| `Delete/Backspace` | Clear cell or delete row |
| `Cmd/Ctrl+C` | Copy cell value |
| `Arrow keys` | Navigate cells |

## Browser Support

| Browser | Storage Mode | Notes |
|---------|--------------|-------|
| Chrome 86+ | OPFS | Full support with native file system |
| Edge 86+ | OPFS | Full support with native file system |
| Firefox 111+ | OPFS | Full support with native file system |
| Safari 15.2+ | IndexedDB | Fallback storage, slightly slower |

**OPFS (Origin Private File System)** provides the best performance with native file system access. Browsers without OPFS support automatically fall back to IndexedDB.

## Privacy

**All data stays in your browser.** SQLite Editor:

- Stores databases locally using OPFS or IndexedDB
- Makes no external network calls after initial load
- Collects no telemetry or analytics
- Requires no account or sign-up

Your data never leaves your device.

## Development

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Run tests
npm test

# Run E2E tests
npm run test:e2e

# Type check
npm run typecheck

# Lint
npm run lint

# Build for production
npm run build

# Preview production build
npm run preview

# Check bundle size
npm run size
```

### Tech Stack

- **React 18** + TypeScript
- **Tailwind CSS** for styling
- **wa-sqlite** (SQLite compiled to WebAssembly)
- **TanStack Table** + Virtual for data grid
- **CodeMirror 6** for SQL editor
- **React Flow** for ERD visualization
- **Vite** + PWA plugin

## License

MIT License - see [LICENSE](LICENSE) for details.
