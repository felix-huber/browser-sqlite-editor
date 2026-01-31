# Proposal: Ralph Lint Error Handling Improvements

## Problem Observed

bd-3u2 (Security E2E tests) has been stuck for 4+ iterations because:
1. Pre-existing lint errors in unrelated files (offline.js, migration.spec.ts, etc.)
2. Implementer keeps saying TASK_COMPLETE but build verification fails on lint
3. Implementer doesn't know about or fix pre-existing issues
4. No git pull between iterations, so external fixes aren't picked up

## Root Cause

Ralph's current flow:
```
pick task → spawn implementer → verify build → fail on lint → retry same implementer
```

The implementer only sees its own task context, not the global lint state. When lint fails on files unrelated to the task, the implementer has no context to fix them.

## Proposed Solutions

### Option A: Pre-flight Lint Baseline (Recommended)

**Add to ralph.sh before spawning implementer:**

```bash
# Check for pre-existing lint errors
lint_output=$(npm run lint 2>&1 || true)
lint_errors=$(echo "$lint_output" | grep -c "error" || echo "0")

if [ "$lint_errors" -gt 0 ]; then
  # Save lint errors to file for implementer context
  echo "$lint_output" > .beads/logs/${task_id}-lint-baseline.txt

  # Add to implementer prompt context
  LINT_CONTEXT="
## Pre-existing Lint Errors

The codebase has $lint_errors lint errors that must be fixed before your task can complete:

$(echo "$lint_output" | head -50)

Fix these errors as part of your task, even if they're in files you didn't create.
Common fixes:
- Remove unused imports
- Add \`/* global window, document, navigator */\` for browser JS files
- Prefix unused variables with underscore (_varName)
"
fi
```

### Option B: Git Pull Between Iterations

**Add to ralph.sh at start of each iteration:**

```bash
# Sync with any external fixes before starting
git stash -q 2>/dev/null || true
git pull --rebase origin main 2>/dev/null || true
git stash pop -q 2>/dev/null || true
```

### Option C: Update task_prompt.md

**Add to prompts/ralph/task_prompt.md:**

```markdown
## Build Verification Requirements

Your task is NOT complete until ALL of these pass:
- npm run lint (0 errors)
- npm run typecheck (0 errors)
- npm run build (succeeds)
- npm run test (all pass)

**IMPORTANT:** If lint/typecheck fails on files you did NOT modify, you MUST
still fix them. Pre-existing issues block your task. Common quick fixes:

| Error | Fix |
|-------|-----|
| 'X' is defined but never used | Remove import or prefix with _ |
| 'window/document/navigator' is not defined | Add `/* global window, document, navigator */` at top |
| Unnecessary escape character | Remove the backslash |

Do NOT say TASK_COMPLETE if any verification step fails.
```

### Option D: Separate Lint Fixer Task

**Create a maintenance bead that runs first:**

Before processing any task, ralph could:
1. Run lint
2. If errors exist, spawn a quick "lint-fixer" agent
3. Commit fixes
4. Then proceed with actual task

## Recommendation

Implement **A + B + C** together:
- A: Gives implementer context about pre-existing issues
- B: Allows external fixes to be picked up
- C: Makes expectations explicit in the prompt

## Implementation Effort

| Option | Effort | Impact |
|--------|--------|--------|
| A | ~20 lines in ralph.sh | High - implementer gets context |
| B | ~5 lines in ralph.sh | Medium - picks up external fixes |
| C | ~15 lines in prompt | High - sets expectations |
| D | ~50 lines + new prompt | Low - adds complexity |

## Files to Modify

1. `scripts/ralph.sh` - Add pre-flight lint check and git pull
2. `prompts/ralph/task_prompt.md` - Add lint fix instructions
