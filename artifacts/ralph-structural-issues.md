# Ralph Structural Issues Log

Tracking structural issues observed during ralph.sh execution that may need code/prompt fixes.

## Session: 2026-01-31

### Progress Snapshot
- **Start**: 36/56 beads (64%) at session 1 start
- **Current**: 41/56 beads done (73%), bd-9kc in progress
- **Remaining**: 15 beads (14 ready, 1 in progress)
- **Last Update**: 2026-01-31 19:53

### Beads Completed This Session (New Ralph Run)
| Iteration | Bead | Task | Time |
|-----------|------|------|------|
| 1 | bd-4z7 | P2-07: Database export quota-exceeded handling | 19:08 |
| 2 | bd-3mp | P3-03: Prefer native ALTER TABLE | 19:19 |
| 3 | bd-u9l | P3-04: DDL diff preview enhancement | 19:32 |
| 4 | bd-1xx | P4-03: ERD DDL diff preview | ✅ 19:42 |
| 5 | bd-22t | P6-03: sqlite3_stmt_readonly check | 19:52 |
| 6 | bd-9kc | US-006: Query builder result column aliases | in-progress |

### Previously Fixed Issues

| Pattern | Description | Fix Applied | Status |
|---------|-------------|-------------|--------|
| Pattern 6 | Non-command text in Verification (parentheses) | Updated bead descriptions | ✅ Fixed |
| Pattern 7 | Wrong Vitest CLI syntax (`--grep` vs `-t`) | Updated prompts | ✅ Fixed |
| Pattern 8 | Bead description caching | Added `refresh_task_verification()` | ✅ Fixed |
| Pattern 14 | `br show --json` returns array not object | Fixed `get_task_by_id` to use `jq '.[0]'` | ✅ Fixed |

### Observed Issues This Session

**Check 1 (19:40)**: No structural issues detected
- All 3 completed iterations passed verification
- bd-1xx currently in fresh-eyes review
- Test output shows expected ErrorBoundary test errors (intentional throws, not failures)
- All 3088 tests passing in build verification

**Check 2 (19:43)**: bd-1xx completed successfully
- 4 beads completed this session (bd-4z7, bd-3mp, bd-u9l, bd-1xx)
- No verification failures
- bd-22t (P6-03: sqlite3_stmt_readonly check) now in progress
- ETA shows ~16 min remaining at current pace

**Check 3 (19:53)**: bd-22t completed, bd-9kc starting
- 5 beads completed this session
- 41/56 done (73%)
- No structural issues detected
- All iterations passing verification on first attempt

---

## Issue Template

### Issue N: [Short Title]
- **Bead**: bd-XXX
- **Iteration**: N
- **Symptom**: What happened
- **Root Cause**: Why it happened
- **Proposed Fix**: How to fix structurally
- **Status**: 🔴 New / 🟡 Analyzing / 🟢 Fixed

---

## CI Status

| Run | Commit | Status | Notes |
|-----|--------|--------|-------|
| 21548992492 | bd-u9l state update | in_progress | - |
| 21548877403 | README URL fix | failure | E2E failures |
| 21548826360 | bd-3mp state update | in_progress | - |

### Known CI Issues
- ~~E2E tests using `channel: 'chrome'` but CI only has Chromium~~ (WRONG - not the actual issue)
- ~~Timeouts may be too short (5000ms)~~ (WRONG - not the actual issue)
- **ACTUAL ISSUE**: Unit test expects `data-testid="add-row-error"` element that doesn't exist
  - Test file: likely `src/features/grid/__tests__/AddRowDialog.test.tsx` or similar
  - E2E tests never run because unit tests fail first
  - CI agent (a0264c5) is working on this

---

## Monitoring Notes

- Subagent tasked with CI fixes (a249505)
- Ralph running with `--loop --max-tasks 20`
- Build verification currently passing
