# Claude Code Instructions — Oracle Swarm Extension

This extension adds artifact-driven workflows with GPT-5.2 Pro review loops to Compound Engineering.

## Working Style

- Be concise, skip obvious explanations
- Just make the fix, don't ask permission for small changes
- If something's unclear, make a reasonable assumption and note it
- **After starting/restarting the dev server**, always smoke test: wait for ready, curl the homepage, then agent-browser open key pages affected by recent changes

---

## CORE PRINCIPLES (Karpathy-Inspired)

### 1. Think Before Coding

Don't assume. Don't hide confusion. Surface tradeoffs.

**Before implementing:**
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them—don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- **If something is unclear, STOP. Name what's confusing. Ask.**

### 2. Simplicity First

Minimum code that solves the problem. Nothing speculative.

- No features beyond what was asked
- No abstractions for single-use code
- No "flexibility" or "configurability" that wasn't requested
- No error handling for impossible scenarios
- If you write 200 lines and it could be 50, rewrite it

**The test:** "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### 3. Surgical Changes

Touch only what you must. Clean up only your own mess.

**When editing existing code:**
- Don't "improve" adjacent code, comments, or formatting
- Don't refactor things that aren't broken
- Match existing style, even if you'd do it differently
- If you notice unrelated dead code, mention it—don't delete it

**When your changes create orphans:**
- Remove imports/variables/functions that YOUR changes made unused
- Don't remove pre-existing dead code unless asked

**The test:** Every changed line should trace directly to the user's request.

### 4. Goal-Driven Execution

Define success criteria. Loop until verified.

Transform tasks into verifiable goals:

| Instead of... | Transform to... |
|---------------|-----------------|
| "Add validation" | "Write tests for invalid inputs, then make them pass" |
| "Fix the bug" | "Write a test that reproduces it, then make it pass" |
| "Refactor X" | "Ensure tests pass before and after" |

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

## CRITICAL RULES

### Rule 1: Never Delete Files Without Permission
You may NOT delete files without explicit permission. Even files you created (test files, temp files). Ask first, always.

### Rule 2: No File Proliferation
AVOID uncontrolled proliferation of code files. If you want to change something or add a feature, you MUST revise the existing code file in place.

**NEVER create:**
- `file_v2.js`
- `file_improved.js`
- `file_enhanced.js`
- `file_unified.js`
- `file_new.js`

New files are reserved for GENUINELY NEW FUNCTIONALITY that makes zero sense to include in any existing file. It should be an INCREDIBLY high bar to ever create a new code file.

### Rule 3: No Automated Code Transforms
NEVER run a script that processes/changes code files in this repo. That sort of brittle, regex-based stuff is always a disaster. DO NOT BE LAZY. Make code changes manually, even when there are many instances to fix. If changes are many but simple, use several subagents in parallel.

---

## Non-negotiables

1. **Browser Oracle only**: Never use Oracle API mode. Always instruct the human to run CLI manually.
2. **Artifacts are truth**: The `artifacts/` directory is the source of truth. Update artifacts before touching code.
3. **No evidence = not done**: Every task completion must include commands run + outputs or screenshots.
4. **Task graph is truth**: Work is tracked via compiled task graph or beads with explicit dependencies.
5. **Clean shutdown**: For swarms, use requestShutdown → approvals → cleanup.
6. **ITERATE UNTIL CONVERGENCE**: Oracle reviews and self-reviews must run multiple times.

---

## ITERATION REQUIREMENTS (Doodlestein Methodology)

> "Planning tokens are 100x cheaper than fixing code bugs."

| Phase | Minimum Iterations | Convergence Criteria |
|-------|-------------------|----------------------|
| Plan review (Oracle) | 4-5 passes | Suggestions become incremental |
| Plan → Beads review | 6-9 passes | No more changes |
| Code review (Oracle) | Until converged | 0 new blockers/majors |
| Fresh eyes review | Until stable | No bugs found |

**DO NOT SKIP ITERATIONS.** See `skills/phase-transitions/SKILL.md` for detailed prompts.

---

## Fresh Eyes Review (AFTER EVERY TASK!)

After completing any task, run this prompt until it finds nothing:

```
Great, now I want you to carefully read over all of the new code you
just wrote and other existing code you just modified with "fresh eyes"
looking super carefully for any obvious bugs, errors, problems, issues,
confusion, etc.

**FIRST CHECK**: Would a senior engineer say this is overcomplicated? 
If yes, simplify it first.

**SECOND CHECK**: Does every changed line trace directly to the user's request?
If not, revert the unrelated changes.

Carefully fix anything you uncover. Use ultrathink.
```

---

## ast-grep vs ripgrep (Quick Guidance)

**Use ast-grep when structure matters.** It parses code and matches AST nodes, so results ignore comments/strings, understand syntax, and can safely rewrite code.

| When | Tool |
|------|------|
| Refactors/codemods (rename APIs, change imports) | ast-grep |
| Policy checks (enforce patterns across repo) | ast-grep |
| "How is X implemented?" | ast-grep or warp_grep |

**Use ripgrep when text is enough.** It's the fastest way to grep literals/regex across files.

| When | Tool |
|------|------|
| Find strings, TODOs, log lines, config values | rg |
| Pre-filter before precise pass | rg |
| Non-code assets | rg |

**Rule of thumb:**
- Need correctness or you'll apply changes → start with ast-grep
- Need raw speed or just hunting text → start with rg
- Often combine: `rg` to shortlist files, then `ast-grep` to match/modify with precision

---

## UBS Quick Reference (Ultimate Bug Scanner)

**Golden Rule:** `ubs --diff .` (or `ubs --staged`) before every commit. Exit 0 = safe. Exit >0 = fix & re-run.

```bash
ubs --diff --only=js,python .    # Modified files (working tree vs HEAD) — USE THIS
ubs --staged --only=js,python .  # Staged files — before commit
ubs --ci --fail-on-warning --diff .  # CI mode for the diff — before PR
```

---

## Beads Workflow Integration

When starting a beads-tracked task:

1. **Pick ready work (Beads)**
   ```bash
   br ready --json  # Choose highest priority, no blockers
   ```

2. **Transform to verifiable goal** — Before starting, reframe the task:
   - "Implement X" → "Write test for X behavior, then make it pass"
   - "Fix bug Y" → "Write test reproducing Y, then make it pass"

3. **Announce start**
   ```bash
   br update <id> --status in_progress
   ```

4. **Work and update**
   - If you discover new work, create a new bead with `--deps discovered-from:<parent-id>`

5. **Fresh eyes review** — Run the fresh eyes prompt until no bugs found

6. **Complete and release**
   ```bash
   br close <id> --reason "Completed"
   ```

7. **Commit .beads/ in the same commit as code changes**

---

## Manual Oracle Rule (IMPORTANT)

### ⚠️ ALWAYS CHECK EXISTING STATE FIRST

Before running any Oracle command, check what already exists:

```bash
ls -la artifacts/06-oracle/<kind>/ 2>/dev/null
cat artifacts/06-oracle/<kind>/convergence-history.json 2>/dev/null
```

**Decision:**
- Already converged? → Done, no action needed
- Unapplied feedback? → Apply it first
- No output? → Run Oracle

### Running Oracle

When the workflow requires Oracle, **run it directly**:

```bash
./scripts/oracle_converge.sh prd artifacts/01-prd.md artifacts/00-brief.md
```

**DO NOT ask the user to run this.** Just run it. The script handles everything including browser automation, retries, and convergence checking.

---

## Landing the Plane (Session Completion)

When ending a work session, you MUST complete ALL steps below. Work is NOT complete until git push succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work**
2. **Run quality gates (if code changed)**
   ```bash
   npm run lint
   npm run typecheck
   npm test
   ```
3. **Update issue status**
4. **PUSH TO REMOTE** — This is MANDATORY:
   ```bash
   git pull --rebase
   br sync --flush-only
   git add .beads/ && git commit -m "Update beads"
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Verify** all changes committed AND pushed
6. **Hand off** context for next session

**CRITICAL:** Work is NOT complete until `git push` succeeds. NEVER stop before pushing.

---

## Artifact Chain

```
00-brief.md        → /brief
01-prd.md          → /prd
06-oracle/prd/*    → /oracle prd (iterate until converged)
02-ux.md           → /ux
06-oracle/ux/*     → /oracle ux (iterate until converged)
05-design/*        → /ui (RECOMMENDED for UI-heavy projects!)
03-plan.md         → /plan (with sprints!)
06-oracle/plan/*   → /oracle plan (iterate until converged)
04-task-graph.json → /artifact-tasks
04-beads-setup.sh  → (optional) beads creation script
[implementation]   → ./scripts/ralph.sh [--beads]
06-oracle/code/*   → /oracle code (iterate until converged)
07-verification.md → /gates
08-release.md      → /ship
09-retro.md        → /retro
```

### When to Run /ui (UI Exploration)

**REQUIRED** when the project involves:
- Data grids, tables, or spreadsheet-like interfaces
- Canvas-based editors (ERD, diagrams, flowcharts)
- Visual query builders or drag-and-drop interfaces
- Dashboards with multiple panels/widgets
- Any user-facing application with significant visual complexity

**Optional** for:
- CLI tools, APIs, backend services
- Simple CRUD apps with standard forms
- Libraries, SDKs, infrastructure code

**Detection heuristic:** If the PRD or UX spec mentions terms like "grid", "canvas", "drag", "panel", "visual", "editor", "designer", "workspace", or "dashboard" — run `/ui` before `/plan`.

**What /ui produces:**
- `artifacts/05-design/tasteboard.md` — Visual references and principles
- `artifacts/05-design/keystone.html` — Primary screen prototype
- `artifacts/05-design/variants/*.html` — 6-12 design alternatives
- `artifacts/05-design/manifest.json` — Gallery metadata

---

### Option 1: beads_rust (br) — Recommended for Autonomous Execution

```bash
# Install
cargo install --git https://github.com/Dicklesworthstone/beads_rust.git

# Generate beads from task graph
node scripts/generate_beads_setup.js
bash artifacts/04-beads-setup.sh

# (Optional) Run beads review for extra polish - see skills/phase-transitions/SKILL.md
# For autonomous execution, skip directly to Ralph:

# Execute with smart routing
./scripts/ralph.sh --beads 50
```

### Option 2: task-graph.json — Built-in, No External Deps

```bash
node scripts/compile_task_graph.js
./scripts/ralph.sh 50
```

---

## Tool Routing (Doodlestein Methodology)

**Ralph uses smart routing by default:**

| Task Type | Tool | Why |
|-----------|------|-----|
| Backend (core, api, data, worker) | Codex | Fast iteration |
| Frontend (ui, components, design) | Claude Code | Nuanced implementation |
| Heavy doc reviews (PRD, UX, Plan) | GPT-5.2 Pro | Deep reasoning via /oracle |

---

## Commands Reference

| Command | Purpose |
|---------|---------|
| `/brief` | Create problem brief (artifact 00) |
| `/prd` | Generate PRD (artifact 01) |
| `/ux` | Generate UX spec (artifact 02) |
| `/ui` | UI exploration: tasteboard + keystone + variants |
| `/plan` | Generate implementation plan with SPRINTS (artifact 03) |
| `/oracle <kind>` | Run GPT-5.2 Pro review (prd/ux/plan/code) — iterate! |
| `/artifact-tasks` | Compile task graph from plan + issues |
| `/sprint` | Break spec into atomic sprint tasks |
| `/ralph` | Run autonomous execution loop |
| `/review <type>` | Run iterative review loops |
| `/swarm-status` | Report swarm health |
| `/gates` | Run verification checks |
| `/ship` | Create release plan |
| `/retro` | Capture learnings |
| `/combined-lfg` | Full integrated workflow |

---

## Skills Reference

| Skill | Purpose |
|-------|---------|
| `oracle-integration` | Oracle CLI wrapper and issue normalization |
| `artifact-workflow` | Artifact chain management and phase detection |
| `phase-transitions` | Transformation prompts between phases |
| `ui-exploration` | Tasteboard, keystone, variants workflow |
| `review-loops` | Iteration methodology |
| `parallel-execution` | Dependency rules, self-healing, status tracking |
| `frontend-design` | ASCII wireframes, oklch colors, animations |
| `devin-review` | Free AI code review integration |
| `agent-browser` | Browser automation patterns |

---

## Where Things Live

- Commands: `.claude/commands/`
- Skills: `skills/`
- Scripts: `scripts/`
- Prompts: `prompts/{prd,ux,plan,code,sprint,review,ralph}/`
- Templates: `templates/`
- Tools: `tools/` (tasteboard, design-gallery, task-board)
- Artifacts: `artifacts/` (generated during workflow)
- Docs: `docs/` (schema documentation, patterns)

---

## How to Know These Guidelines Are Working

✅ Fewer unnecessary changes in diffs
✅ Fewer rewrites due to overcomplication
✅ Clarifying questions come BEFORE implementation, not after mistakes
✅ Clean, minimal PRs with every line traceable to requirements
✅ Oracle reviews converge faster (fewer iterations needed)
