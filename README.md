# Oracle Swarm Extension for Compound Engineering

**Extends Compound Engineering with GPT-5.2 Pro review loops, artifact-driven workflows, UI exploration, and release management.**

## ⚠️ CRITICAL: Iteration Requirements (Doodlestein Methodology)

> "Planning tokens are a lot fewer and cheaper than implementation tokens."
> — Jeffrey Emanuel (@doodlestein)

**This extension implements iterative review methodology. Do NOT skip iterations!**

| Phase | Iterations Required | Stop Condition |
|-------|--------------------|-----------------------|
| Plan review (GPT Pro) | 4-5 passes | Suggestions become incremental |
| Beads review | 6-9 passes | No more changes |
| Fresh eyes code review | 2-3+ passes | No bugs found |
| Oracle review | Until converged | 0 new blockers/majors |

**85% Planning, 15% Implementation** — This is THE key insight.

```
┌─────────────────────────────────────────────────────────────────┐
│  COMPOUND ENGINEERING          +    ORACLE SWARM EXTENSION      │
├─────────────────────────────────────────────────────────────────┤
│  /workflows:plan                    /brief (problem definition) │
│  /workflows:work                    /prd (requirements)         │
│  /workflows:review (13 agents)      /ux (flows + states)        │
│  /workflows:compound                /ui (tasteboard + variants) │
│  /lfg                               /oracle (GPT-5.2 Pro loops) │
│  /deepen-plan                       /artifact-tasks             │
│                                     /review (iteration loops)   │
│                                     /gates (verification)       │
│                                     /ship (release plan)        │
│                                     /retro (learnings)          │
└─────────────────────────────────────────────────────────────────┘
```

---

## What This Extension Adds

### 🔮 Oracle Integration (GPT-5.2 Pro Review Loops)

Run **32 specialized review lenses** across 4 phases:
- **8 lenses**: product, ux, architecture, security, performance, tests, simplicity, ops
- **4 phases**: PRD, UX, PLAN, CODE

```bash
# Example: Review your PRD with all 8 lenses
/oracle prd

# Claude prints the command; you run it manually:
./scripts/oracle_lens_pack.sh prd artifacts/01-prd.md artifacts/00-brief.md

# CRITICAL: Re-run until convergence (0 new issues)!
```

### 🔄 Iterative Review Loops (NEW!)

Run Doodlestein-style iteration loops:

```bash
# Beads review (run 6-9 times until stable)
/review beads

# Fresh eyes code review (after each task)
/review code

# Bug hunt (random code exploration)
/review bugs

# UI/UX polish
/review ux
```

### 🤖 Ralph with Fresh Eyes

Ralph now supports `--fresh-eyes` flag for post-task review:

```bash
# Run with automatic fresh-eyes review after each task
./scripts/ralph.sh --fresh-eyes 50

# Or use beads_rust for task tracking
./scripts/ralph.sh --beads --fresh-eyes 50
```

### 📋 Artifact-Driven Workflow

Explicit artifact chain with versioned outputs:
```
artifacts/
├── 00-brief.md           # Problem + constraints
├── 01-prd.md             # Requirements + acceptance criteria
├── 02-ux.md              # Flows + state matrices
├── 03-plan.md            # Architecture + task seeds
├── 04-task-graph.json    # Compiled tasks with dependencies
├── 05-design/            # UI exploration outputs
│   ├── tasteboard.md
│   ├── keystone.html
│   ├── variants/
│   └── manifest.json
├── 06-oracle/            # Review outputs by phase
│   ├── prd/issues.json
│   ├── ux/issues.json
│   ├── plan/issues.json
│   └── code/issues.json
├── 07-verification.md    # Gate results
├── 08-release.md         # Rollout plan
└── 09-retro.md           # Learnings
```

### 🎨 UI Exploration Tools

- **Tasteboard**: Capture visual references, principles, inspirations
- **Keystone**: Generate primary screen HTML
- **Variants**: Create 6-12 design alternatives
- **Design Gallery**: Side-by-side variant comparison
- **Task Board**: Kanban view of task graph (`/board`)

### 🚀 Release Management

- `/gates` — Run verification checks, generate report
- `/ship` — Create release plan with rollout/rollback
- `/retro` — Capture learnings, update templates/prompts

### 🤖 Ralph Autonomous Execution

**Ralph** is an autonomous AI agent loop based on [Geoffrey Huntley's Ralph pattern](https://ghuntley.com/ralph/). It executes tasks from your task graph with fresh Claude Code context each iteration.

```bash
# Run Ralph with 50 iterations max
./scripts/ralph.sh 50
```

How it works:
1. **Fresh context each iteration** - Spawns new Claude Code instance
2. **Picks next ready task** - Respects dependencies
3. **Implements the task** - Using verification requirements
4. **Commits if passing** - Updates git history
5. **Logs learnings** - Appends to `progress.txt`
6. **Repeats** - Until all tasks complete

Perfect for overnight builds:
```bash
./scripts/ralph.sh 100 > ralph.log 2>&1 &
# Close laptop, come back to working code
```

See [`.claude/commands/ralph.md`](.claude/commands/ralph.md) for full documentation.

---

## Installation

### Quick Start

```bash
# 1. Create your project directory
mkdir my-project && cd my-project
git init

# 2. Extract the extension (extracts directly to current directory)
unzip oracle-swarm-extension.zip

# 3. Verify commands are available
ls .claude/commands/
# Should show: brief.md, prd.md, ux.md, plan.md, oracle.md, etc.

# 4. Install Oracle CLI (for GPT-5.2 Pro reviews)
npm install -g @steipete/oracle

# 5. Install beads_rust (recommended for task tracking)
cargo install --git https://github.com/Dicklesworthstone/beads_rust.git

# 6. Start Claude Code
claude --dangerously-skip-permissions

# 7. Use the commands!
/brief
```

### Global Installation (All Projects)

To make commands available in ALL projects (not just this one):

```bash
mkdir -p ~/.claude/commands
cp .claude/commands/*.md ~/.claude/commands/
```

### Directory Structure

After extraction, your project will have:

```
my-project/
├── .claude/
│   └── commands/          # Slash commands (/brief, /prd, etc.)
├── .beads/                # Task tracking (beads_rust)
├── artifacts/             # Generated artifacts (00-brief.md, etc.)
├── prompts/               # Review lens prompts (for Oracle)
├── scripts/               # Automation (ralph.sh, oracle_lens_pack.sh)
├── skills/                # Claude Code skills
├── templates/             # Artifact templates
├── tools/                 # HTML tools (tasteboard, design-gallery)
├── CLAUDE.md              # Claude Code instructions (READ THIS!)
├── AGENTS.md              # Agent methodology & iteration requirements
└── README.md
```

---

## Requirements

- **Claude Code** (for slash commands + swarm tools)
- **Compound Engineering Plugin** (base dependency)
- **Node.js 18+** (for scripts)
- **Oracle CLI**: `npm install -g @steipete/oracle`
- **Browser session** logged into ChatGPT (set to GPT-5.2 Pro)

Optional:
- `jq` (for issue count summaries in shell scripts)
- `tmux` (for durable swarm backends)
- iTerm2 (macOS, for visible panes)

---

## Quick Start

### New Project (With Iterations!)

```bash
# 1. Initialize artifacts
/brief

# 2. Generate PRD from brief
/prd

# 3. Review PRD with GPT-5.2 Pro
/oracle prd
# ⚠️ REPEAT until 0 new blockers! (Usually 2-3 passes)

# 4. Generate UX spec
/ux

# 5. Review UX
/oracle ux
# ⚠️ REPEAT until converged!

# 6. UI exploration (REQUIRED for UI-heavy projects!)
# Run /ui if your project has: data grids, canvas editors, visual builders, dashboards
/ui

# 7. Generate implementation plan
/plan
# For highest quality: use multi-model planning (see skills/phase-transitions/SKILL.md)
# Iterate 4-5 times with ChatGPT Pro Extended Thinking

# 8. Review plan
/oracle plan
# ⚠️ REPEAT until converged!

# 9. Compile task graph + create beads
/artifact-tasks
# Choose beads_rust for autonomous execution

# 10. Review beads (CRITICAL!)
/review beads
# ⚠️ RUN 6-9 TIMES until no more changes!

# 11. Execute tasks with fresh-eyes review
./scripts/ralph.sh --beads --fresh-eyes 50
# Each task gets "fresh eyes" review after completion

# 12. Review code with both CE agents + Oracle
/workflows:review
/oracle code
# ⚠️ REPEAT until converged!

# 12. Run verification gates
/gates

# 13. Create release plan
/ship

# 14. Capture learnings
/retro
```

### Existing Project (Add Oracle Reviews)

```bash
# Add oracle review to any existing workflow
/oracle plan   # Review your current plan with GPT-5.2 Pro

# Or run specific lenses
./scripts/oracle_single_lens.sh plan architecture artifacts/03-plan.md
```

---

## Commands Reference

| Command | Phase | Description |
|---------|-------|-------------|
| `/brief` | Planning | Create/refine problem brief (artifact 00) |
| `/prd` | Planning | Generate PRD from brief (artifact 01) |
| `/ux` | Planning | Generate UX spec from PRD (artifact 02) |
| `/ui` | Design | Tasteboard + keystone + variants (artifact 05) |
| `/plan` | Planning | Generate implementation plan (artifact 03) |
| `/oracle <kind>` | Review | Run GPT-5.2 Pro review lenses |
| `/artifact-tasks` | Execution | Compile task graph + create CC tasks |
| `/swarm-status` | Execution | Check swarm health and progress |
| `/gates` | Verification | Run lint/build/test, generate report |
| `/ship` | Release | Create rollout/rollback plan |
| `/retro` | Learning | Capture learnings, update templates |
| `/combined-lfg` | All | Full workflow: plan → oracle → work → review → ship |

---

## Skills Reference

### oracle-integration

Provides Oracle CLI wrapper and structured issue normalization.

```
skill: oracle-integration
```

Triggers: "oracle review", "gpt-5 review", "external review", "multi-model"

### artifact-workflow

Manages the artifact chain, ensures correct ordering, validates completeness.

```
skill: artifact-workflow
```

Triggers: "artifact", "workflow status", "what's next", "phase check"

### ui-exploration

Guides UI design exploration: tasteboard → keystone → variants → manifest.

```
skill: ui-exploration
```

Triggers: "tasteboard", "design exploration", "ui variants", "keystone"

---

## Agents Reference

| Agent | Role | When to Use |
|-------|------|-------------|
| `oracle-coordinator` | Orchestrates multi-lens Oracle runs | Automated oracle workflows |
| `artifact-validator` | Checks artifact completeness and ordering | Before phase transitions |
| `design-synthesizer` | Synthesizes tasteboard into keystone | UI exploration phase |
| `release-planner` | Generates release plans from verification | Ship phase |

---

## Configuration

### CLAUDE.md Addition

Add to your project's `CLAUDE.md`:

```markdown
## Oracle Swarm Extension

This project uses artifact-driven workflow with Oracle GPT-5.2 Pro reviews.

### Non-negotiables
1. **Browser Oracle only**: Never use Oracle API mode. Instruct human to run CLI manually.
2. **Artifacts first**: Update PRD/UX/PLAN before touching code.
3. **Task graph is truth**: Work tracked via compiled task graph with dependencies.

### Manual Oracle Rule
When workflow requires Oracle:
- Print exact CLI command to run
- Tell human where output will be written
- STOP until output file exists

### Artifact Chain
00-brief → 01-prd → [oracle] → 02-ux → [oracle] → 05-design → 03-plan → [oracle] → 04-task-graph → [code] → 06-oracle/code → 07-verification → 08-release → 09-retro
```

### Environment Variables

```bash
# Swarm backend (optional)
export CLAUDE_CODE_SPAWN_BACKEND=tmux  # or iterm2

# Oracle defaults (optional)
export ORACLE_BROWSER_THINKING_TIME=heavy
export ORACLE_MODEL_STRATEGY=current
```

---

## Scripts Reference

| Script | Purpose |
|--------|---------|
| `oracle_lens_pack.sh` | Run all 8 lenses for a phase |
| `oracle_single_lens.sh` | Run one specific lens |
| `oracle_browser_run.sh` | Low-level Oracle CLI wrapper |
| `normalize_oracle_output.js` | Convert Oracle markdown to issues.json |
| `compile_task_graph.js` | Compile plan seeds + issues into task graph |
| `design_manifest_build.js` | Build manifest.json from variants |
| `swarm_status.js` | Report swarm health and progress |
| `gate_pack.sh` | Run verification gates |

---

## Prompts (Review Lenses)

Each phase (PRD, UX, PLAN, CODE) has 8 specialized review lenses:

| Lens | Focus |
|------|-------|
| `product` | Goals, acceptance criteria, scope |
| `ux` | Flows, states, accessibility |
| `architecture` | Components, boundaries, data model |
| `security` | Injection, privilege, supply chain |
| `performance` | Hot paths, N+1, caching |
| `tests` | Coverage, verification gaps |
| `simplicity` | YAGNI, over-engineering |
| `ops` | Rollout, monitoring, rollback |

---

## Integration with Compound Engineering

This extension is designed to work alongside Compound Engineering:

```
┌─────────────── Pre-Code (Oracle Swarm) ───────────────┐
│ /brief → /prd → /oracle prd → /ux → /oracle ux       │
│ → /ui → /plan → /oracle plan → /artifact-tasks       │
└──────────────────────────┬────────────────────────────┘
                           ▼
┌─────────────── Code-Time (Compound Engineering) ──────┐
│ /slfg (swarm spawn) → /workflows:work                │
│ → /workflows:review (13 parallel agents)             │
└──────────────────────────┬────────────────────────────┘
                           ▼
┌─────────────── Post-Code (Oracle Swarm) ──────────────┐
│ /oracle code → /gates → /ship → /retro               │
└───────────────────────────────────────────────────────┘
```

---

## Key Prompts (Doodlestein Methodology)

These are the exact prompts that produce high-quality results. Use them verbatim!

### Plan Review (ChatGPT Pro)
```
Carefully review this entire plan for me and come up with your best
revisions in terms of better architecture, new features, changed features,
etc. to make it better, more robust/reliable, more performant, more
compelling/useful, etc.

For each proposed change, give me your detailed analysis and
rationale/justification for why it would make the project better along
with the git-diff style changes relative to the original markdown plan.
```

### Beads Review (Run 6-9 times!)
```
Reread AGENTS.md so it's still fresh in your mind.

Check over each bead super carefully-- are you sure it makes sense?
Is it optimal? Could we change anything to make the system work better?

DO NOT OVERSIMPLIFY THINGS! DO NOT LOSE ANY FEATURES OR FUNCTIONALITY!
```

### Fresh Eyes (After Each Task)
```
Great, now I want you to carefully read over all of the new code you
just wrote and other existing code you just modified with "fresh eyes"
looking super carefully for any obvious bugs, errors, problems, issues,
confusion, etc.

Carefully fix anything you uncover. Use ultrathink.
```

### Bug Hunt (Random Exploration)
```
I want you to sort of randomly explore the code files in this project,
choosing code files to deeply investigate and understand and trace their
functionality and execution flows through the related code files.

Once you understand the purpose of the code, do a super careful check
with "fresh eyes" to find any obvious bugs, problems, errors, issues,
silly mistakes, etc. and then systematically correct them.
```

For the complete prompt library, see `skills/phase-transitions/SKILL.md`.

---

## License

MIT — do what you want, just don't pretend you wrote the universe.
