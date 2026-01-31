# Ralph Structural Issues Log

Tracking structural issues observed during ralph.sh execution that may need code/prompt fixes.

## Session: 2026-01-31

### Progress Snapshot
- **Start**: 36/56 beads (64%) at session 1 start
- **Current**: 46/56 beads done (82%), ralph running
- **Remaining**: 10 beads
- **Last Update**: 2026-01-31 22:30

### CI Progress
- E2E shard 1: ✅ PASSING
- E2E shard 2: ❌ Still failing (runs 21550466852, 21550845001)
  - Error: `sqlite3_open_v2` fails for all table-designer tests
  - Also: `[DatabaseRegistry] Failed to migrate registry: SyntaxError: Unexpected end of JSON input`
- Lighthouse: ✅ PASSING (after .cjs rename)
- Build/Perf: ✅ PASSING

### Issue 23: OPFS/SQLite Fails for table-designer in CI (E2E Shard 2)
- **Discovered**: 2026-01-31 22:00
- **Root Cause**: Unknown - deeper than test fixture cleanup
  - Registry migration fails with JSON parse error
  - sqlite3_open_v2 fails for all table-designer tests
  - Previous tests (import, migration, multitab) all pass
- **Attempted Fixes**:
  1. `13a906a fix: use base playwright test for table-designer to avoid OPFS cleanup issues` - didn't help
- **Status**: 🔴 BLOCKING CI - agent a5b0055 investigating

### Issue 21: xargs Strips Quotes in Verification Commands
- **Discovered**: 2026-01-31 22:00
- **Root Cause**: `run_task_verification` uses `xargs` to trim whitespace (line 1271)
  - `cmd=$(echo "$cmd" | xargs)` removes quotes from patterns
  - Causes `--grep 'E2E|FOO'` to become `--grep E2E|FOO`
  - Shell interprets `|` as pipe, not regex OR
- **Fix Applied**: Replaced xargs with pure bash whitespace trimming:
  ```bash
  cmd="${cmd#"${cmd%%[![:space:]]*}"}"
  cmd="${cmd%"${cmd##*[![:space:]]}"}"
  ```
- **Status**: 🟢 Fixed

### Issue 22: E2E Tests Incorrectly Get Vitest --grep→-t Conversion
- **Discovered**: 2026-01-31 22:00
- **Root Cause**: Pattern 7 fix converts `--grep` to `-t` for all tests
  - Vitest uses `-t`, Playwright uses `--grep`
  - E2E tests use Playwright, so `--grep` should NOT be converted
- **Fix Applied**: Added condition to skip conversion for E2E:
  ```bash
  if [[ "$cmd" != *"e2e"* ]]
  ```
- **Status**: 🟢 Fixed

### Issue 20: PTY Buffering Prevents Output Capture
- **Discovered**: 2026-01-31 21:05
- **Root Cause**: **CONFIRMED** - Claude CLI output isn't flushing through `timeout | tee` pipeline
  ```bash
  # This produces empty log:
  timeout 1m claude -p "hello" 2>&1 | tee output.log

  # This works:
  timeout 1m claude -p "hello" > output.log 2>&1

  # This also works (with PTY):
  script -q output.log timeout 1m claude -p "hello"
  ```
- **Technical Cause**:
  - Claude CLI likely detects non-TTY and buffers output
  - Pipe to tee doesn't trigger flush
  - Output only appears after process exits
- **Proposed Fixes**:
  1. Replace `| tee` with direct redirection: `> "$log_file" 2>&1`
  2. Use `script` wrapper for PTY emulation
  3. Use `unbuffer` (from expect package): `unbuffer timeout ... | tee`
  4. Set `PYTHONUNBUFFERED=1` or similar if applicable
- **Impact**: All ralph spawns produce no visible output in logs
- **Status**: 🔴 BLOCKING - requires ralph.sh fix

### Beads Completed This Session (New Ralph Run)
| Iteration | Bead | Task | Time |
|-----------|------|------|------|
| 1 | bd-4z7 | P2-07: Database export quota-exceeded handling | 19:08 |
| 2 | bd-3mp | P3-03: Prefer native ALTER TABLE | 19:19 |
| 3 | bd-u9l | P3-04: DDL diff preview enhancement | 19:32 |
| 4 | bd-1xx | P4-03: ERD DDL diff preview | ✅ 19:42 |
| 5 | bd-22t | P6-03: sqlite3_stmt_readonly check | 19:52 |
| 6 | bd-9kc | US-006: Query builder result column aliases | 20:00 |
| 7 | bd-rqg | P4-05: ERD draft state tracking | ✅ 20:27 |

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

**Check 4 (20:03)**: RALPH STOPPED - JQ PARSE ERRORS
- bd-9kc completed successfully (42/56 = 75%)
- **ISSUE DETECTED**: Ralph exited during iteration 7 task selection
- jq parse errors: "Invalid numeric literal at line 1, column 2" (4x)
- Ralph process no longer running, lock file removed
- Likely cause: `br ready --json` returning unexpected format

---

## Issue Template

### Issue 15: log_warn/log_error Corrupt JSON Output
- **Bead**: (iteration 7 task selection)
- **Iteration**: 7
- **Symptom**: Ralph stopped after jq parse errors during `br ready` parsing
- **Root Cause**: **CONFIRMED** - `log_warn` and `log_error` in ralph.sh output to stdout instead of stderr. When `ensure_task_verification()` calls `log_warn` and then returns JSON via `printf`, the output becomes:
  ```
  [WARN] Task bd-rqg missing verification...
  { ... JSON ... }
  ```
  jq sees `[WARN]` and tries to parse it as JSON array, fails with "Invalid numeric literal"
- **Fix Applied**: Changed log_warn and log_error to output to stderr:
  ```bash
  log_warn() { echo -e "${YELLOW}[WARN]${NC} $1" >&2; }
  log_error() { echo -e "${RED}[ERROR]${NC} $1" >&2; }
  ```
- **Status**: 🟢 Fixed - Ralph now running successfully

### Issue 16: Lighthouse CI Config Mismatch (PWA)
- **CI Run**: 21549482704
- **Symptom**: Lighthouse job fails with exit code 1, no `.lighthouseci/` directory created
- **Root Cause**: lighthouserc.js requires PWA assertions (`service-worker`, `works-offline`) but:
  - No `dist/sw.js` service worker exists
  - App may not have full PWA implementation
- **Evidence**:
  ```
  X lighthouse in 2m14s
  ! No files were found with the provided path: .lighthouseci/
  X Process completed with exit code 1.
  ```
- **Proposed Fix**:
  1. Remove PWA assertions if app isn't PWA (`service-worker: 'off'`, `works-offline: 'off'`)
  2. Or implement actual PWA support with service worker
  3. Add `continue-on-error: true` to lighthouse job if it's informational only
- **Status**: 🔴 New - CI BLOCKING

### Issue 17: Multiple Claude Instances for Same Task
- **Observation**: 5 timeout processes for bd-rqg running simultaneously
- **Expected**: 1 process per task
- **Possible Causes**:
  1. ralph.sh spawning new instances without killing previous
  2. Cleanup on iteration completion not working
  3. Previous ralph instances not fully terminated
- **Impact**: Resource waste, potential race conditions
- **Proposed Fix**: Investigate ralph.sh process management, ensure task PIDs are tracked and cleaned up
- **Status**: 🟡 Analyzing

### Issue 18: get_task_by_id() JSON Corruption (Caught by Fresh Eyes)
- **Discovered During**: bd-rqg fresh eyes review pass 1
- **Symptom**: Potential JSON escape sequence corruption
- **Root Cause**: `get_task_by_id()` was using `build_task_json_from_bead()` which captures JSON to a bash variable, potentially corrupting escape sequences
- **Fix Applied**: Updated to use temp files with `build_task_json_from_bead_file()` for consistency
- **Status**: 🟢 Fixed (by autonomous agent during task execution)
- **Note**: This validates the fresh eyes review pattern - it catches structural issues!

### Issue 19: Multiple Ralph Processes Competing
- **Discovered**: 2026-01-31 20:37
- **Symptom**: Ralph logs "Spawning claude instance..." repeatedly, appears stuck
- **Root Cause**: **CONFIRMED** - 10 ralph.sh processes running simultaneously
  - Multiple ralph instances competing for same tasks
  - Each seeing bd-1jc as "ready" and trying to spawn
  - Output from multiple instances interleaving in log
- **Evidence**:
  - `pgrep -f "ralph.sh"` showed 10 PIDs
  - Log showed "ITERATION 2" appearing twice back-to-back
- **Fix Applied**: Killed all ralph processes with `pkill -f "ralph.sh"`
- **Prevention**:
  1. ralph.sh should use flock or lock file to prevent multiple instances
  2. Better cleanup when ralph exits
- **Status**: 🟢 Fixed (manual intervention)

---

## Issue Template (Original)

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
- Ralph **stopped** at iteration 7 due to jq parse errors
- 42/56 beads complete (75%)
- Needs restart or investigation of br ready output format
