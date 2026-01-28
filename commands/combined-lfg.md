# /combined-lfg — Full Integrated Workflow

## Goal
Run the complete workflow from brief to ship, integrating Oracle Swarm Extension with Compound Engineering.

## Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    COMBINED-LFG WORKFLOW                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  PHASE 1: PLANNING (Oracle Swarm Extension)                    │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ /brief → /prd → /oracle prd → /ux → /oracle ux         │   │
│  │ → /ui (optional) → /plan → /oracle plan                │   │
│  └─────────────────────────────────────────────────────────┘   │
│                            ↓                                    │
│  PHASE 2: TASK COMPILATION                                      │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ /artifact-tasks → task-graph.json → Claude Code tasks  │   │
│  └─────────────────────────────────────────────────────────┘   │
│                            ↓                                    │
│  PHASE 3: EXECUTION (choose one)                               │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Option A: ./scripts/ralph.sh (recommended)             │   │
│  │ Option B: /slfg → /workflows:work (Compound Eng)       │   │
│  └─────────────────────────────────────────────────────────┘   │
│                            ↓                                    │
│  PHASE 4: FINAL REVIEW (Oracle Swarm Extension)                │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ /oracle code → address issues                          │   │
│  └─────────────────────────────────────────────────────────┘   │
│                            ↓                                    │
│  PHASE 5: SHIP (Oracle Swarm Extension)                        │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ /gates → /ship → /retro                                │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Execution Mode

This command can run in two modes:

### Interactive Mode (Default)
Pauses at each Oracle step for human to run CLI command.

### Guided Mode
Prints full plan, then executes non-Oracle steps automatically.

## Steps

### Phase 1: Planning

#### Step 1.1: Brief
```
/brief
```
- Create `artifacts/00-brief.md`
- Interactive: help user fill in sections

#### Step 1.2: PRD
```
/prd
```
- Generate `artifacts/01-prd.md` from brief

#### Step 1.3: Oracle PRD Review
```
/oracle prd
```
**PAUSE**: Print command for human:
```bash
./scripts/oracle_lens_pack.sh prd artifacts/01-prd.md artifacts/00-brief.md
```
**WAIT** for `artifacts/06-oracle/prd/issues.json` to exist.
- Summarize issues
- Apply fixes to PRD
- If blockers: fix and re-run Oracle

#### Step 1.4: UX Spec
```
/ux
```
- Generate `artifacts/02-ux.md` from PRD

#### Step 1.5: Oracle UX Review
```
/oracle ux
```
**PAUSE**: Print command:
```bash
./scripts/oracle_lens_pack.sh ux artifacts/02-ux.md artifacts/01-prd.md
```
**WAIT** for `artifacts/06-oracle/ux/issues.json`.
- Summarize issues
- Apply fixes to UX spec

#### Step 1.6: UI Exploration (Optional)
Ask user:
> Do you want to explore UI direction with tasteboard? (y/n)

If yes:
```
/ui
```
- Guide through tasteboard
- Generate keystone + variants
- **PAUSE** for human review in design gallery

#### Step 1.7: Implementation Plan
```
/plan
```
- Generate `artifacts/03-plan.md` with task seeds

#### Step 1.8: Oracle Plan Review
```
/oracle plan
```
**PAUSE**: Print command:
```bash
./scripts/oracle_lens_pack.sh plan artifacts/03-plan.md artifacts/01-prd.md artifacts/02-ux.md
```
**WAIT** for `artifacts/06-oracle/plan/issues.json`.
- Summarize issues
- Apply fixes to plan
- If blockers: fix and re-run Oracle

---

### Phase 2: Task Compilation

#### Step 2.1: Compile Task Graph
```
/artifact-tasks
```
- Run `compile_task_graph.js`
- Create `artifacts/04-task-graph.json`
- Create Claude Code tasks with dependencies

Report:
```
Task graph compiled:
- Seed tasks: 12
- Oracle issues: 8
- Total tasks: 20
- Ready to start: 5 (no blockers)
```

---

### Phase 3: Execution (Compound Engineering)

#### Step 3.1: Spawn Swarm
Use Compound Engineering's swarm system:
```
/slfg
```

Or manually:
```
TeammateTool spawnTeam { team_name: "project-swarm", description: "..." }
```

Spawn teammates:
- `engine-worker`: Core engine tasks
- `ui-worker`: UI component tasks
- `test-worker`: Test tasks
- `io-worker`: I/O and integration tasks

#### Step 3.2: Execute Work
Let swarm work through tasks.

Monitor with:
```
/swarm-status
```

Or Compound Engineering's:
```
TaskList { team: "project-swarm" }
```

#### Step 3.3: Review with Compound Engineering
When code is ready:
```
/workflows:review
```
- 13 agents review in parallel
- security-sentinel, performance-oracle, etc.
- Apply findings

---

### Phase 4: Final Review

#### Step 4.1: Oracle Code Review
```
/oracle code
```
**PAUSE**: Print command:
```bash
./scripts/oracle_lens_pack.sh code <changed-files>
```

Or for specific files:
```bash
./scripts/oracle_lens_pack.sh code src/core/*.ts src/ui/*.tsx
```

**WAIT** for `artifacts/06-oracle/code/issues.json`.
- Review external perspective
- Apply fixes

---

### Phase 5: Ship

#### Step 5.1: Verification Gates
```
/gates
```
- Run lint, types, tests, build
- Generate `artifacts/07-verification.md`

If gates fail:
> Gates failed. Fix issues and re-run `/gates`.

#### Step 5.2: Release Plan
```
/ship
```
- Generate `artifacts/08-release.md`
- Include rollout steps, monitoring, rollback

#### Step 5.3: Retrospective
After shipping:
```
/retro
```
- Capture learnings
- Update templates and prompts
- Generate `artifacts/09-retro.md`

---

## Timing Estimates

| Phase | Estimated Time |
|-------|----------------|
| Planning (with Oracle) | 2-4 hours |
| Task Compilation | 15 minutes |
| Execution (swarm) | Varies by project |
| Final Review | 1-2 hours |
| Ship | 1 hour |
| **Total overhead** | ~5-8 hours |

## Customization

### Skip UI Exploration
```
/combined-lfg --skip-ui
```

### Skip Oracle Reviews (Not Recommended)
```
/combined-lfg --skip-oracle
```

### Specific Lenses Only
```
/combined-lfg --lenses security,performance,tests
```

## Interruption Recovery

If interrupted, check:
1. Which artifacts exist?
2. Which Oracle outputs exist?
3. Resume from the next missing step.

```bash
ls artifacts/
# See what exists, resume from there
```
