# Agents — Oracle Swarm Extension

This extension provides 4 specialized agents that complement Compound Engineering's 27 agents.

**CRITICAL**: Read ALL sections before starting any work!

---

## CORE PRINCIPLES (Karpathy-Inspired — ALL AGENTS MUST FOLLOW)

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
You may NOT delete files without explicit permission. Even files you created. Ask first, always.

### Rule 2: No File Proliferation
NEVER create `file_v2.js`, `file_improved.js`, `file_enhanced.js`, etc. Revise existing files in place.

### Rule 3: No Automated Code Transforms  
NEVER run scripts that process/change code files. Make changes manually. Use subagents in parallel for many simple changes.

---

## Note for Codex/GPT-5.2 (READ THIS!)

If you are Codex or GPT-5.2 (or any non-Claude agent): another agent may have made changes since you last saw the code. Before assuming your mental model is correct:

```bash
git status              # See uncommitted changes
git log --oneline -5    # See recent commits
```

**Re-read any files you plan to modify.** This prevents overwriting another agent's work.

### Using Skills in Codex

This extension's skills work in both Claude Code and Codex (same SKILL.md format).

**One-time setup:**
```bash
./scripts/setup_codex_skills.sh   # Creates symlinks in .codex/skills/
```

**Start Codex with skills:**
```bash
codex --enable skills
```

**Invoke skills with `$` prefix:**
```
$oracle-integration     # Run Oracle review
$artifact-workflow      # Artifact chain management
$frontend-design        # UI work
```

### ⚠️ Check Existing Oracle State FIRST

**Before running any Oracle command, check what already exists:**

```bash
ls -la artifacts/06-oracle/<kind>/ 2>/dev/null
cat artifacts/06-oracle/<kind>/convergence-history.json 2>/dev/null
```

| Situation | Action |
|-----------|--------|
| Already converged (0 blockers, ≤2 majors) | Done — no action needed |
| Unapplied feedback exists | Apply feedback first |
| No Oracle output | Run Oracle |

### Long-Running Oracle Processes (CRITICAL for Codex)

Oracle CLI commands take **60-90 minutes** to complete. This is normal.

**DO NOT:**
- ❌ Interrupt or timeout Oracle processes
- ❌ Assume "no output" means stuck
- ❌ Kill processes after 5-10 minutes

**DO:**
- ✅ Wait patiently (GPT-5.2 Pro "thinking" takes 30+ minutes)
- ✅ Monitor with: `pgrep -fl oracle`
- ✅ Watch logs: `tail -f artifacts/06-oracle/*/oracle-*.log`

---

## ITERATION REQUIREMENTS (Doodlestein Methodology)

> "Planning tokens are a lot fewer and cheaper than implementation tokens."

**Time Distribution**: 85% planning, 15% implementation

| Phase | Iterations Required | Convergence Criteria |
|-------|--------------------|-----------------------|
| Plan review | 4-5 passes | Suggestions become incremental |
| Beads review | 6-9 passes | No more changes |
| Fresh eyes code review | Until stable | No bugs found |
| Oracle review | Until converged | 0 new blockers/majors |

---

## Key Prompts (Use These Verbatim!)

### Before Any Work (Agent Init)

```
First read ALL of the AGENTS.md file and README.md file super carefully
and understand ALL of both!

Then use your code investigation agent mode to fully understand the code,
and technical architecture and purpose of the project.

When you're not sure what to do next, use the bv tool (or br ready)
to prioritize the best beads to work on next; pick the next one that you
can usefully work on and get started.

Use ultrathink.
```

### Before Starting a Task (Goal Transformation)

Transform the task into a verifiable goal:

```
Before implementing, I'll transform this task into a verifiable goal:

Task: [original task description]
Verifiable Goal: [test/check that proves completion]
Plan:
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

### Fresh Eyes (AFTER EVERY TASK!)

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

→ **Keep running this until no bugs are found!**

### Beads Review (OPTIONAL - for extra polish)

**NOTE:** This is optional for fully autonomous execution. Skip and go straight to Ralph.
Ralph has self-healing that catches issues during execution.

```
Reread AGENTS.md so it's still fresh in your mind.

Check over each bead super carefully-- are you sure it makes sense?
Is it optimal? Could we change anything to make the system work better?

For each bead, verify:
1. Is the success criteria verifiable? (Can we write a test for it?)
2. Is the scope surgical? (Only touches what's necessary?)
3. Is it the simplest approach? (Would a senior say it's overcomplicated?)

DO NOT OVERSIMPLIFY THINGS! DO NOT LOSE ANY FEATURES OR FUNCTIONALITY!
```

**If running manually:** Run 6-9 times until no changes are made.

### Cross-Agent Review

```
Ok can you now turn your attention to reviewing the code written by
your fellow agents and checking for any issues, bugs, errors, problems,
inefficiencies, security problems, reliability issues, etc.

For each issue found, ask:
1. Does every changed line trace to the original request?
2. Would a senior engineer say this is overcomplicated?
3. Were any unrelated "improvements" made?

Don't restrict yourself to the latest commits, cast a wider net and go
super deep! Use ultrathink.
```

### Bug Hunt (Random Exploration)

```
I want you to sort of randomly explore the code files in this project,
choosing code files to deeply investigate and understand and trace their
functionality and execution flows through the related code files.

Once you understand the purpose of the code in the larger context,
do a super careful check with "fresh eyes" to find any obvious bugs,
problems, errors, issues, silly mistakes, etc.

Be sure to comply with ALL rules in AGENTS.md. Use ultrathink.
```

See `skills/phase-transitions/SKILL.md` for the complete prompt library.

---

## Agent Definitions

### oracle-coordinator

**Role**: Orchestrates multi-lens Oracle review runs.

**When to use**:
- Automated Oracle workflows (e.g., `/combined-lfg`)
- When running multiple lenses in sequence
- When tracking Oracle output across phases

**Capabilities**:
- Generates Oracle CLI commands for each lens
- Monitors for output file creation
- Normalizes outputs to issues.json
- Summarizes findings by severity/category
- Tracks unresolved blockers across phases
- **Iterates until convergence (0 new issues)**

**Prompt**:
```
You are the Oracle Coordinator. Your job is to run GPT-5.2 Pro review loops via the Oracle CLI (browser mode only).

Before acting, state your assumptions explicitly. If uncertain about the review scope, ask.

Generate commands, wait for outputs, and normalize results.

CRITICAL: Keep running Oracle until issues converge to zero. Do not stop after a single pass!
```

---

### artifact-validator

**Role**: Validates artifact completeness and ordering.

**When to use**:
- Before phase transitions (e.g., before coding)
- When user asks "what's next?" or "where am I?"
- After Oracle reviews to check blocker status

**Capabilities**:
- Checks artifact existence and completeness
- Validates required sections in each artifact
- Reports unresolved Oracle blockers
- **Checks Oracle convergence status**
- **Detects UI-heavy projects and requires /ui before /plan**
- Suggests next action based on workflow state

**UI Detection Rule**: If the PRD or UX spec mentions terms like "grid", "canvas", "drag", "panel", "visual", "editor", "designer", "workspace", or "dashboard" — require `/ui` before `/plan`. Do NOT skip to `/plan` for UI-heavy applications.

**Prompt**:
```
You are the Artifact Validator. Your job is to ensure the artifact chain is complete and properly ordered.

Check for missing artifacts, incomplete sections, and unresolved blockers.

CRITICAL: Do not approve phase transitions until Oracle reviews have CONVERGED (0 new blockers/majors).

CRITICAL: For UI-heavy projects (data grids, canvas editors, visual builders, dashboards), 
the /ui phase is REQUIRED, not optional. Check if artifacts/05-design/ is empty — if so, 
recommend /ui before /plan.

If anything is unclear about what "complete" means for an artifact, stop and ask.
```

---

### design-synthesizer

**Role**: Synthesizes tasteboard into keystone and variants.

**When to use**:
- During `/ui` command execution
- When generating HTML prototypes from design references
- When creating variant explorations

**Capabilities**:
- Extracts design principles from tasteboard
- Generates keystone HTML with realistic content
- Creates 6-12 variant HTML files
- Builds design manifest for gallery

**Prompt**:
```
You are the Design Synthesizer. Your job is to transform design references (tasteboard) into production-quality HTML prototypes.

Apply Simplicity First: minimum CSS that achieves the design. No speculative animations or "flexibility."

Apply Surgical Changes: if modifying an existing keystone, only change what's requested.

You create a keystone screen and multiple variants exploring different directions.
```

---

### release-planner

**Role**: Generates release plans from verification results.

**When to use**:
- During `/ship` command execution
- When creating rollout/rollback strategies
- When documenting release readiness

**Capabilities**:
- Reads verification report (artifact 07)
- Generates rollout steps with checkpoints
- Creates monitoring and alerting requirements
- Documents rollback procedures
- Prepares customer communications

**Prompt**:
```
You are the Release Planner. Your job is to create comprehensive release plans with rollout steps, monitoring, and rollback procedures.

Apply Goal-Driven Execution: each rollout step should have a verifiable checkpoint.

You ensure releases are safe and reversible.
```

---

## Agent Roles in Multi-Agent Execution

| Agent Type | Best For | Role |
|------------|----------|------|
| Claude Code (CC) | Frontend/UI, complex reasoning, architecture | Nuanced implementation |
| Codex (COD) | Backend/API, fast iteration, refactoring | Fast iteration |
| Gemini (GMI) | Code review ONLY | Quality gate |
| GPT-5.2 Pro | Heavy document reviews (PRD, UX, Plan) | Oracle reviews |

### Ralph Agent Assignment (DEFAULT: Smart Routing)

By default, `./scripts/ralph.sh` routes tasks intelligently:
- **Backend tasks** (core, engine, api, data, worker, db) → **Codex** (fast)
- **Frontend tasks** (ui, components, design, css, styles) → **Claude Code** (nuanced)
- **Heavy doc reviews** (PRD, UX, Plan) → **GPT-5.2 Pro** via `/oracle` command

### Multi-Agent Collaboration Rules

1. **Reserve files** before editing (avoid conflicts)
2. **Never overwrite** other agents' changes
3. **Communicate** via agent mail or git commits
4. **Mark beads** when starting (`in_progress`) and completing (`closed`)
5. **Surgical changes only** — don't "improve" other agents' code

---

## Agent Interaction with Compound Engineering

| Oracle Swarm Agent | Works With | Phase |
|--------------------|------------|-------|
| oracle-coordinator | (standalone) | All phases |
| artifact-validator | (standalone) | Phase transitions |
| design-synthesizer | frontend-design skill | UI exploration |
| release-planner | (standalone) | Ship phase |

### Handoff Points

1. **Pre-code**: `artifact-validator` confirms plan is ready AND Oracle has converged → Compound Engineering takes over for `/workflows:work`

2. **Post-code**: Compound Engineering's `/workflows:review` completes → `oracle-coordinator` runs external GPT-5.2 Pro review (iterate until converged!)

3. **Ship**: `release-planner` generates release plan after gates pass

---

## The Key Insight

> "Measure twice, cut once!" → **"Check your beads N times, implement once!"**

Planning and reviewing in "plan space" is:
- 100x cheaper (fewer tokens)
- 10x faster (no build/test cycles)  
- Much higher quality (easier to reason about)

**DO NOT SKIP ITERATIONS. The extra planning time pays massive dividends during implementation.**

---

## Landing the Plane (Session Completion)

When ending a work session, complete ALL steps. Work is NOT complete until git push succeeds.

1. **File issues** for remaining work (`br create ...`)
2. **Run quality gates** if code changed
3. **Update issue status** (`br close ...`)
4. **PUSH TO REMOTE** (MANDATORY):
   ```bash
   git pull --rebase
   br sync --flush-only
   git add .beads/ && git commit -m "Update beads"
   git push
   ```
5. **Verify** `git status` shows "up to date with origin"
6. **Hand off** context for next session

**NEVER stop before pushing — that leaves work stranded locally.**

---

## Quick Tool Reference

### ast-grep vs ripgrep
- **ast-grep**: Refactors, codemods, pattern enforcement (structure matters)
- **ripgrep (rg)**: Find text, TODOs, pre-filter files (speed matters)
- **Combine**: `rg -l 'pattern' | xargs ast-grep run -p 'pattern'`

### UBS (Ultimate Bug Scanner)
```bash
ubs --diff .  # Before every commit. Exit 0 = safe.
```

### Devin Review
```bash
./scripts/devin_review.sh  # Before every merge. Fix SEVERE bugs.
```

---

## How to Know These Guidelines Are Working

✅ Fewer unnecessary changes in diffs
✅ Fewer rewrites due to overcomplication
✅ Clarifying questions come BEFORE implementation, not after mistakes
✅ Clean, minimal PRs with every line traceable to requirements
✅ No drive-by refactoring or "improvements"
✅ Oracle reviews converge faster (fewer iterations needed)
✅ Cross-agent conflicts reduced (surgical changes don't collide)

---

## Tradeoff Note

These guidelines bias toward **caution over speed**. For trivial tasks (simple typo fixes, obvious one-liners), use judgment.

The goal is reducing costly mistakes on non-trivial work, not slowing down simple tasks.

See `CLAUDE.md` for full documentation.
