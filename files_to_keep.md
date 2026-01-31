# Files Audit for wasm-sqlite-editor

**Purpose:** Categorize all project files for cleanup before publishing.

**Date:** 2026-01-31

---

## Summary

This project contains two distinct layers:
1. **The actual SQLite Editor app** - A browser-based SQLite database editor (React + WASM)
2. **App-builder scaffolding** - An "Oracle Swarm" workflow system used to build the app with Claude/Codex agents

The scaffolding is extensive (scripts, prompts, skills, templates, artifacts, beads tracking) and should be removed before publishing the app as an open-source project.

---

## KEEP - Core App Files

These are essential for the wasm-sqlite-editor application to build and run.

### Source Code
| Path | Description |
|------|-------------|
| `src/` | Main application source code |
| `src/App.tsx` | Main React application component |
| `src/main.tsx` | Application entry point |
| `src/index.css` | Global styles |
| `src/vite-env.d.ts` | Vite type definitions |
| `src/core/` | Core business logic (db, engine, io, erd, rebuild, sql, worker) |
| `src/features/` | Feature modules (grid, sql, designer, erd, query-builder, import, export, sidebar, settings, welcome, table, database) |
| `src/shared/` | Shared components, hooks, layout, format utilities, platform helpers |
| `src/store/` | Zustand state management |
| `src/types/` | TypeScript type definitions |
| `src/worker/` | Web Worker for SQLite operations |
| `src/__mocks__/` | Test mocks |
| `src/setupTests.ts` | Test setup configuration |

### E2E Tests
| Path | Description |
|------|-------------|
| `e2e/*.spec.ts` | End-to-end test files |
| `e2e/fixtures/` | Test fixtures |
| `e2e/helpers/` | Test helpers |
| `e2e/E2E_COVERAGE_MATRIX.md` | E2E coverage documentation |

### Public Assets
| Path | Description |
|------|-------------|
| `public/manifest.json` | PWA manifest |
| `public/icons/` | PWA icons (favicon, apple-touch-icon, 192x192, 512x512) |
| `public/offline.html` | Offline fallback page |
| `public/offline.js` | Offline fallback script |
| `public/sakila.db` | Sample SQLite database (optional - consider removing for smaller bundle) |

### Entry Point
| Path | Description |
|------|-------------|
| `index.html` | HTML entry point |

---

## KEEP - Essential Configuration

These configuration files are required for development, building, and testing.

### Build & Dev Config
| Path | Description |
|------|-------------|
| `package.json` | Node.js package manifest |
| `package-lock.json` | Dependency lock file |
| `vite.config.ts` | Vite bundler configuration |
| `vitest.config.ts` | Vitest test runner config |
| `tsconfig.json` | TypeScript configuration |
| `tailwind.config.js` | Tailwind CSS configuration |
| `postcss.config.js` | PostCSS configuration |
| `eslint.config.js` | ESLint configuration |
| `playwright.config.ts` | Playwright E2E test config |
| `lighthouserc.cjs` | Lighthouse CI configuration |

### Project Files
| Path | Description |
|------|-------------|
| `LICENSE` | MIT license |
| `README.md` | Project documentation |
| `.gitignore` | Git ignore patterns |

### CI/CD
| Path | Description |
|------|-------------|
| `.github/workflows/ci.yml` | GitHub Actions CI workflow |

---

## REVIEW - May Remove

These files may be useful for the project but could be removed or moved.

### Documentation (docs/)
| Path | Recommendation | Reason |
|------|----------------|--------|
| `docs/deployment.md` | KEEP | Deployment instructions |
| `docs/screenshots/` | KEEP | Used in README.md |
| `docs/AGENT_EVALUATION.md` | REMOVE | Scaffolding-related |
| `docs/BEADS_SETUP.md` | REMOVE | Scaffolding-related |
| `docs/CODEX_CONFIG.md` | REMOVE | Scaffolding-related |
| `docs/MULTI_AGENT_COORDINATION.md` | REMOVE | Scaffolding-related |
| `docs/PATTERNS_FROM_JDRHYNE.md` | REMOVE | Scaffolding-related |
| `docs/TASK_GRAPH_SCHEMA.md` | REMOVE | Scaffolding-related |
| `docs/USER_JOURNEYS_E2E.md` | REVIEW | Could be useful for contributors |
| `docs/WORKER_CLIENT_PATTERNS.md` | REVIEW | Useful architecture docs |

### Performance Tests
| Path | Recommendation | Reason |
|------|----------------|--------|
| `e2e/perf/` | REVIEW | Performance regression suite - useful but adds complexity |
| `e2e/perf/results/` | REMOVE | Already in .gitignore, regenerated |

### Sample Database
| Path | Recommendation | Reason |
|------|----------------|--------|
| `public/sakila.db` | REVIEW | 5.8MB sample database. Consider removing for lighter bundle, or moving to releases/downloads |

---

## REMOVE - Scaffolding/Tooling

These directories and files are from the "Oracle Swarm" app-builder framework and are NOT needed for the wasm-sqlite-editor application.

### Entire Directories to Remove
| Path | Description |
|------|-------------|
| `.claude/` | Claude Code configuration and tasks |
| `scripts/` | Scaffolding automation scripts (ralph.sh, oracle_converge.sh, etc.) |
| `prompts/` | AI prompt templates for development workflow |
| `skills/` | Claude/Codex skill definitions |
| `templates/` | Artifact templates (BRIEF, PRD, UX, PLAN, etc.) |
| `tools/` | Design tooling (tasteboard, design-gallery, task-board) |
| `artifacts/` | Generated development artifacts (PRD, UX spec, plans, Oracle reviews) |
| `.beads/` | Beads task tracking system (already in .gitignore) |

### Scripts Directory Contents (18 files, ~230KB)
All are scaffolding scripts:
- `ralph.sh` (3,832 lines) - Main task execution orchestrator
- `oracle_converge.sh` - GPT-5.2 Pro review orchestration
- `oracle_browser_run.sh`, `oracle_lens_pack.sh`, `oracle_single_lens.sh` - Oracle helpers
- `compile_task_graph.js`, `generate_beads_setup.js` - Task graph generation
- `check_blockers.js`, `check_blockers.sh` - Blocker detection
- `swarm_status.js` - Swarm health reporting
- `gate_pack.sh`, `run_e2e_happy_paths.sh` - Build/test gates
- `gather_missing_context.sh`, `gather_task_context.sh` - Context gathering
- `normalize_oracle_output.js` - Oracle output processing
- `design_manifest_build.js` - Design manifest generation
- `setup_codex_skills.sh` - Codex integration

### Root Level Files to Remove
| Path | Description |
|------|-------------|
| `CLAUDE.md` | Claude Code instructions (large, scaffolding) |
| `AGENTS.md` | Agent role definitions (scaffolding) |
| `called_strict_approach.md` | Workflow documentation (scaffolding) |
| `close_gaps.md` | Gap closure workflow (scaffolding) |
| `PROPOSED_CODE_FILE_REORGANIZATION_PLAN.md` | Internal planning document |
| `.ralph-task-tracking.json` | Ralph task tracking state (already in .gitignore) |
| `.ralph.lock` | Ralph lock file |

---

## REMOVE - Temporary/Generated

These are generated during development/testing and should not be committed.

### Generated Directories (already in .gitignore)
| Path | Status | Description |
|------|--------|-------------|
| `dist/` | In .gitignore | Build output |
| `coverage/` | In .gitignore | Test coverage reports |
| `playwright-report/` | In .gitignore | Playwright test reports |
| `test-results/` | In .gitignore | Test result artifacts |
| `node_modules/` | In .gitignore | Dependencies |

### Generated Files (already in .gitignore)
| Path | Status | Description |
|------|--------|-------------|
| `progress.txt` | In .gitignore | Ralph progress log |
| `learnings.md` | In .gitignore | Ralph learnings (regenerated) |
| `.ralph-task-tracking.json` | In .gitignore | Task tracking state |
| `.beads/` | In .gitignore | Beads database |
| `e2e/perf/results/` | In .gitignore | Performance test results |

### System Files
| Path | Description |
|------|-------------|
| `.DS_Store` (various) | macOS system files |

---

## Recommended Cleanup Actions

### Before Publishing

1. **Remove scaffolding directories:**
   ```bash
   rm -rf scripts/ prompts/ skills/ templates/ tools/ artifacts/ .claude/ .beads/
   ```

2. **Remove scaffolding root files:**
   ```bash
   rm -f CLAUDE.md AGENTS.md called_strict_approach.md close_gaps.md PROPOSED_CODE_FILE_REORGANIZATION_PLAN.md .ralph-task-tracking.json .ralph.lock progress.txt learnings.md
   ```

3. **Clean up docs/:**
   ```bash
   rm -f docs/AGENT_EVALUATION.md docs/BEADS_SETUP.md docs/CODEX_CONFIG.md docs/MULTI_AGENT_COORDINATION.md docs/PATTERNS_FROM_JDRHYNE.md docs/TASK_GRAPH_SCHEMA.md
   ```

4. **Clean generated/temp files:**
   ```bash
   rm -rf dist/ coverage/ playwright-report/ test-results/
   find . -name ".DS_Store" -delete
   ```

5. **Update .gitignore** - Remove entries that are no longer relevant after cleanup:
   - Remove `.beads/` section
   - Remove `progress.txt`, `learnings.md`, `.ralph-task-tracking.json`

6. **Consider `public/sakila.db`** - 5.8MB sample database. Options:
   - Keep it for demo purposes
   - Move to GitHub Releases as a downloadable asset
   - Remove and link to external source

### Files to Keep After Cleanup

```
wasm-sqlite-editor/
  .github/
    workflows/
      ci.yml
  docs/
    deployment.md
    screenshots/
      *.png
  e2e/
    *.spec.ts
    fixtures/
    helpers/
    E2E_COVERAGE_MATRIX.md
  public/
    icons/
    manifest.json
    offline.html
    offline.js
    sakila.db (optional)
  src/
    __mocks__/
    core/
    features/
    shared/
    store/
    types/
    worker/
    App.tsx
    main.tsx
    index.css
    setupTests.ts
    vite-env.d.ts
  .gitignore
  eslint.config.js
  index.html
  LICENSE
  lighthouserc.cjs
  package-lock.json
  package.json
  playwright.config.ts
  postcss.config.js
  README.md
  tailwind.config.js
  tsconfig.json
  vite.config.ts
  vitest.config.ts
```

---

## File Counts

| Category | Count | Size |
|----------|-------|------|
| Core app files (src/) | ~180 files | ~1.5 MB |
| E2E tests (e2e/) | ~25 files | ~350 KB |
| Scaffolding (scripts/, prompts/, skills/, templates/, tools/) | ~50 files | ~350 KB |
| Artifacts (artifacts/) | ~17 files | ~300 KB |
| Config files | ~12 files | ~15 KB |

---

## Notes

- The `.gitignore` already excludes most generated files, but several scaffolding directories/files are tracked
- The `docs/` directory has a mix of useful app documentation and scaffolding docs
- The `e2e/perf/` directory is useful but could be considered advanced/optional
- Consider creating a separate branch or tag preserving the scaffolding for reference before removal
