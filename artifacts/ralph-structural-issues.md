# Ralph Structural Issues Log

Tracking structural issues observed during ralph.sh execution that may need code/prompt fixes.

**Last Verified:** 2026-02-01 (against scripts/ralph.sh current state)

---

## Quick Reference: Major Fixes (2026-02-01)

These are the critical fixes that resolved Claude CLI execution issues:

### 1. Claude CLI Backgrounding Fix (Issue 32)
**File:** `scripts/ralph.sh` line 1478
```bash
# BEFORE (broken):
cmd="${CLAUDE_CMD:-claude -p --dangerously-skip-permissions}"

# AFTER (fixed):
cmd="${CLAUDE_CMD:-claude -p --dangerously-skip-permissions --no-session-persistence}"
```
**Why:** `--no-session-persistence` prevents CLI from backgrounding when stdout/stderr redirected.

### 2. stdin Blocking Fix (Issue 33)
**File:** `scripts/ralph.sh` lines 1419, 1421
```bash
# BEFORE (broken):
"$timeout_cmd" ... "${cmd[@]}" > "$tmp_output" 2>&1

# AFTER (fixed):
"$timeout_cmd" ... "${cmd[@]}" < /dev/null > "$tmp_output" 2>&1
```
**Why:** `< /dev/null` provides immediate EOF, preventing CLI from waiting for input.

### 3. Output Capture Fix (Issue 29)
**File:** `scripts/ralph.sh` line 1426
```bash
# Added after command execution:
sync 2>/dev/null || true
```
**Why:** Ensures file buffers are flushed before ralph attempts to read output.

---

## Implementation Status Summary

| Issue | Status | Notes |
|-------|--------|-------|
| **15**: log_warn/log_error stderr | ✅ IMPLEMENTED | Lines 155-156: `>&2` added |
| **16**: Lighthouse CI PWA | N/A | Not a ralph.sh issue (CI workflow config) |
| **17**: Multiple Claude instances | 🟡 PARTIAL | Lock file prevents multiple ralph instances; no per-task PID tracking |
| **18**: get_task_by_id JSON | ✅ IMPLEMENTED | Lines 2030-2045: Pattern 14 fix with `jq '.[0]'` |
| **19**: Multiple Ralph processes | ✅ IMPLEMENTED | Lines 50-89: Full lock file mechanism |
| **20**: PTY buffering | ✅ IMPLEMENTED | Lines 1358-1386: Direct file redirection |
| **21**: xargs quote stripping | ✅ IMPLEMENTED | Lines 1229-1231: Pure bash whitespace trim |
| **22**: E2E vs Vitest --grep | ✅ IMPLEMENTED | Line 1243: `[[ "$cmd" != *"e2e"* ]]` check |
| **23**: OPFS/SQLite CI | N/A | Not a ralph.sh issue (E2E test infrastructure) |
| **24**: Bead missing Verification field | 🔴 STRUCTURAL | Beads MUST have `Verification:` section or ralph loops infinitely |
| **25**: Stale IN_PROGRESS beads | 🔴 STRUCTURAL | Ralph loops on beads stuck as in_progress; need manual reset |
| **26**: Full E2E at end of ralph | 🟡 RECOMMENDED | Suggested improvement for regression catching |
| **27**: Complex E2E beads timeout | 🔴 STRUCTURAL | Complex stress tests timeout before producing output |
| **28**: Too many Claude instances | 🔴 STRUCTURAL | Resource contention causes hangs |
| **29**: Output capture failure | ✅ FIXED | Lines 1419, 1421, 1426: stdin redirect + sync |
| **30**: False timeout reports | ✅ FIXED | Lines 1419, 1421, 1478: Proper sync + flag fixes |
| **31**: Resource contention | 🔴 STRUCTURAL | Related to Issue 28 |
| **32**: Claude CLI backgrounding | ✅ FIXED | Line 1478: `--no-session-persistence` flag |
| **33**: stdin blocking | ✅ FIXED | Lines 1419, 1421: `< /dev/null` redirect |

---

## Detailed Issue Status

### Issue 15: log_warn/log_error Corrupt JSON Output
- **Symptom**: Ralph stopped after jq parse errors during `br ready` parsing
- **Root Cause**: `log_warn` and `log_error` output to stdout instead of stderr, corrupting JSON
- **Status**: ✅ IMPLEMENTED
- **Code Location**: ralph.sh lines 155-156
- **Verified Code**:
  ```bash
  log_warn() { echo -e "${YELLOW}[WARN]${NC} $1" >&2; }
  log_error() { echo -e "${RED}[ERROR]${NC} $1" >&2; }
  ```

### Issue 16: Lighthouse CI Config Mismatch (PWA)
- **Symptom**: Lighthouse job fails with exit code 1
- **Root Cause**: lighthouserc.js requires PWA assertions but app may not have full PWA support
- **Status**: N/A (Not a ralph.sh issue)
- **Note**: This is a CI workflow configuration issue, not ralph.sh code. Reported as fixed via preset change.

### Issue 17: Multiple Claude Instances for Same Task
- **Symptom**: Multiple timeout processes running simultaneously
- **Status**: 🟡 PARTIAL
- **What's Implemented**: Lock file mechanism (Issue 19) prevents multiple ralph.sh instances
- **What's NOT Implemented**: No explicit PID tracking/cleanup within single ralph run
- **Analysis**: Within a single ralph run, tool execution is sequential via `_exec_with_timeout()` (line 1358). The observed multiple processes were likely from multiple ralph instances competing before lock was added.

### Issue 18: get_task_by_id() JSON Corruption
- **Symptom**: Potential JSON escape sequence corruption / Pattern 14 array handling
- **Original Proposal**: Use temp files with `build_task_json_from_bead_file()` and `jq '.[0]'`
- **Status**: ✅ IMPLEMENTED (Pattern 14 fix applied)
- **Code Location**: ralph.sh lines 2030-2045
- **Actual Code** (verified 2026-01-31):
  ```bash
  get_task_by_id() {
    local task_id="$1"
    if [[ "$USE_BEADS" == "true" ]]; then
      local bead_json
      bead_json=$(br show "$task_id" --json 2>/dev/null || echo "")
      if [[ -z "$bead_json" || "$bead_json" == "null" ]]; then
        echo ""
        return
      fi
      # Handle both array and object responses (Pattern 14 fix)
      bead_json=$(jq 'if type == "array" then .[0] else . end' <<< "$bead_json")
      build_task_json_from_bead "$bead_json"
    else
      jq -r --arg id "$task_id" '.tasks[] | select(.id == $id)' "$TASK_GRAPH"
    fi
  }
  ```
- **Notes**:
  - Uses variable capture (not temp files) - this is acceptable
  - **NOW uses `jq '.[0]'` via Pattern 14 fix** at line 2040
  - Handles both array and object responses from `br show`
  - No `build_task_json_from_bead_file` function exists (only `build_task_json_from_bead`)
  - The implementation is correct and addresses the JSON handling concern

### Issue 19: Multiple Ralph Processes Competing
- **Symptom**: Multiple ralph.sh processes running simultaneously, competing for tasks
- **Status**: ✅ IMPLEMENTED
- **Code Location**: ralph.sh lines 50-89
- **Verified Implementation**:
  - Lock file variable: `RALPH_LOCK="$PROJECT_ROOT/.ralph.lock"` (line 51)
  - Pre-parse `--override-lock` before acquiring (lines 54-62)
  - `cleanup_lock()` function removes lock on exit (line 64)
  - `handle_signal()` for INT/TERM (line 65)
  - `acquire_lock()` function with:
    - Existing lock check (line 67)
    - Override support via `--override-lock <pid>` (lines 72-73)
    - PID validity check with `kill -0` (line 74)
    - Stale lock auto-cleanup (lines 81-83)
  - Trap on EXIT, INT, TERM signals (lines 86-87)
  - Lock acquired at startup (line 89)

### Issue 20: PTY Buffering Prevents Output Capture
- **Symptom**: Claude CLI output isn't flushing through `timeout | tee` pipeline
- **Status**: ✅ IMPLEMENTED (and later enhanced by Issues 29, 32, 33)
- **Code Location**: ralph.sh lines 1402-1438 (`_exec_with_timeout` function)
- **Note**: The original fix (direct file redirection instead of `| tee`) is still in place. The function was further enhanced in 2026-02-01 with additional fixes:
  - Issue 29: Added `sync` after command execution
  - Issue 32: Added `--no-session-persistence` to claude command
  - Issue 33: Added `< /dev/null` stdin redirect
- **See**: Issue 33 for the complete current implementation of `_exec_with_timeout()`

### Issue 21: xargs Strips Quotes in Verification Commands
- **Symptom**: `--grep 'E2E|FOO'` becomes `--grep E2E|FOO`, shell interprets `|` as pipe
- **Status**: ✅ IMPLEMENTED
- **Code Location**: ralph.sh lines 1229-1231
- **Verified Code**:
  ```bash
  # Trim whitespace without xargs (xargs strips quotes - Issue 21)
  cmd="${cmd#"${cmd%%[![:space:]]*}"}"
  cmd="${cmd%"${cmd##*[![:space:]]}"}"
  ```

### Issue 22: E2E Tests Incorrectly Get Vitest --grep to -t Conversion
- **Symptom**: Playwright E2E tests have `--grep` converted to `-t` (Vitest syntax)
- **Status**: ✅ IMPLEMENTED
- **Code Location**: ralph.sh line 1243
- **Verified Code**:
  ```bash
  # Fix common test framework CLI syntax errors (Pattern 7)
  # Vitest uses -t not --grep for test filtering
  # BUT: Skip for E2E tests - Playwright uses --grep correctly (Issue 22)
  if [[ "$cmd" != *"e2e"* ]] && [[ "$cmd" == *"npm"*"test"*"--grep"* ]] && [[ -f "package.json" ]] && grep -q '"vitest"' package.json 2>/dev/null; then
    local fixed_cmd="${cmd//--grep/-t}"
    log_warn "Auto-fixing Vitest syntax: --grep -> -t"
    cmd="$fixed_cmd"
  fi
  ```

### Issue 23: OPFS/SQLite Fails for table-designer in CI (E2E Shard 2)
- **Symptom**: sqlite3_open_v2 fails for all table-designer tests in CI
- **Status**: N/A (Not a ralph.sh issue)
- **Note**: This is a CI/E2E test infrastructure issue, not ralph.sh code

---

## Previously Fixed Patterns (Reference)

| Pattern | Description | Fix Applied | Status |
|---------|-------------|-------------|--------|
| Pattern 6 | Non-command text in Verification (parentheses) | Updated bead descriptions | Fixed |
| Pattern 7 | Wrong Vitest CLI syntax (`--grep` vs `-t`) | Updated prompts + Issue 22 guard | Fixed |
| Pattern 8 | Bead description caching | Added `refresh_task_verification()` | Fixed |
| Pattern 14 | `br show --json` returns array not object | Fixed in both `get_next_task_beads` (line 2023) and `get_task_by_id` (line 2040) | Fixed |

---

## Session History: 2026-02-01

### Major Fixes Applied This Session

| Fix | Lines Modified | Description |
|-----|----------------|-------------|
| stdin redirect | 1419, 1421 | Added `< /dev/null` to prevent CLI blocking |
| `--no-session-persistence` | 1478 | Force synchronous Claude CLI execution |
| sync after exec | 1426 | Ensure file buffers flushed before read |
| Empty file check | 1430-1434 | Explicit `-s` check with warning |
| TMPDIR fix | 1505-1507 | Use `$TMPDIR` instead of hardcoded `/tmp` |

### Issues Resolved

- **Issue 29** (output capture): Fixed by sync + TMPDIR + empty file check
- **Issue 30** (false timeouts): Fixed by Issues 32 + 33
- **Issue 32** (CLI backgrounding): Fixed by `--no-session-persistence` flag
- **Issue 33** (stdin blocking): Fixed by `< /dev/null` redirect

### Previous Session: 2026-01-31

#### Progress Snapshot
- **Start**: 36/56 beads (64%) at session 1 start
- **Current**: 46/56 beads done (82%), ralph running
- **Remaining**: 10 beads
- **Last Update**: 2026-01-31 22:30

#### CI Progress
- E2E shard 1: PASSING
- E2E shard 2: Still failing (runs 21550466852, 21550845001)
  - Error: `sqlite3_open_v2` fails for all table-designer tests
  - Also: `[DatabaseRegistry] Failed to migrate registry: SyntaxError: Unexpected end of JSON input`
- Lighthouse: PASSING (after .cjs rename)
- Build/Perf: PASSING

#### Beads Completed (New Ralph Run)
| Iteration | Bead | Task | Time |
|-----------|------|------|------|
| 1 | bd-4z7 | P2-07: Database export quota-exceeded handling | 19:08 |
| 2 | bd-3mp | P3-03: Prefer native ALTER TABLE | 19:19 |
| 3 | bd-u9l | P3-04: DDL diff preview enhancement | 19:32 |
| 4 | bd-1xx | P4-03: ERD DDL diff preview | 19:42 |
| 5 | bd-22t | P6-03: sqlite3_stmt_readonly check | 19:52 |
| 6 | bd-9kc | US-006: Query builder result column aliases | 20:00 |
| 7 | bd-rqg | P4-05: ERD draft state tracking | 20:27 |

---

## Notes

- Pattern 14 fix (`jq '.[0]'`) is now applied in BOTH `get_next_task_beads` (line 2023) AND `get_task_by_id` (line 2040). Both functions handle array-or-object responses correctly.
- Issue 18 is now IMPLEMENTED. The fix uses `jq 'if type == "array" then .[0] else . end'` to handle both response formats from `br show`.

---

## Issue 24: Bead Missing Verification Field (CRITICAL)

- **Symptom**: Ralph loops infinitely, burning through iterations with error:
  ```
  [ERROR] Task bd-XXX missing verification/backpressure.
  [ERROR] Add task verification, set RALPH_DEFAULT_VERIFY, or use --default-verify.
  [WARN] Marked beads task as blocked (failed)
  ```
- **Root Cause**: Beads created without a `Verification:` section in description
- **Status**: 🔴 STRUCTURAL - Requires bead creation discipline
- **Impact**: Ralph burns iterations (observed 30+ wasted iterations in one session)
- **Fix**: ALL beads MUST include a Verification section:
  ```
  Verification:
  - <command to verify success, e.g., npm run build && npm test>
  ```
- **Prevention**: When creating beads via `br create`, ALWAYS include:
  ```bash
  br create "Title" --description "Description...

  Verification:
  - npm run lint
  - npm run typecheck
  - npm test

  Acceptance: <criteria>"
  ```
- **Affected Beads (2026-01-31)**: bd-3fq, bd-29u (both fixed by adding Verification section)

---

## Issue 25: Stale IN_PROGRESS Beads Cause Infinite Loop

- **Symptom**: Ralph picks up a bead that's already IN_PROGRESS, can't work on it, moves to next iteration, picks it up again
- **Root Cause**: Bead stuck in IN_PROGRESS state from previous failed/aborted ralph run
- **Status**: 🔴 STRUCTURAL - Needs detection/auto-reset logic
- **Impact**: Ralph loops indefinitely on the same stuck bead
- **Workaround**: Manually reset stuck beads:
  ```bash
  br update bd-XXX --status open
  ```
- **Proposed Fix for ralph.sh**: Add stale IN_PROGRESS detection:
  ```bash
  # Check if bead has been in_progress for >30 min without activity
  # If so, reset to open status before picking up
  ```
- **Related**: ralph.sh should mark beads as "blocked" or "failed" instead of leaving them in_progress when verification fails

---

## Issue 26: Full E2E Suite Should Run at End of Ralph

- **Symptom**: Bead-specific E2E tests pass but full suite may have regressions
- **Root Cause**: Each bead only runs targeted `--grep 'E2E-US-XXX'` tests
- **Status**: 🟡 RECOMMENDED IMPROVEMENT
- **Impact**: Regressions may only be caught after push to CI
- **Recommendation**: Add final full E2E run before ralph completes:
  ```bash
  # At end of ralph run (after all beads complete):
  log_info "Running full E2E regression suite..."
  npm run test:e2e
  if [[ $? -ne 0 ]]; then
    log_error "Full E2E suite failed - investigate before pushing"
    exit 1
  fi
  ```
- **Trade-offs**:
  - Per-bead E2E: Fast (~30s), focused on new functionality
  - Full E2E: Slow (~5-10 min), catches all regressions
  - Hybrid (recommended): Per-bead during development, full suite at end
- **Current Behavior**: Full E2E only runs on GitHub CI after push

---

## Issue 27: Complex E2E Beads Timeout Before Claude Produces Output

- **Symptom**: bd-8se and similar complex stress-test beads timeout with exit code 143 before producing any output
- **Root Cause**: Claude CLI may be hanging during context loading or the bead task is too complex to implement in one shot
- **Status**: 🔴 STRUCTURAL - Affects complex E2E test beads
- **Impact**: Beads loop indefinitely without progress
- **Affected Beads**:
  - bd-8se: "Sidebar multi-DB switching stress" (switch DBs 20x with memory trend check)
- **Workaround**: Break complex beads into simpler sub-tasks or implement manually
- **Proposed Fix**:
  1. Add heartbeat detection - if no output for X minutes, timeout
  2. Break complex stress tests into smaller focused tests
  3. Add progress indicators in bead prompts

---

## Issue 28: Too Many Claude Instances Cause Resource Contention

- **Symptom**: Ralph spawns claude but it produces no output - hangs indefinitely
- **Root Cause**: 30+ claude instances running simultaneously, consuming 80%+ CPU
- **Status**: 🔴 STRUCTURAL - Resource contention blocks new claude instances
- **Impact**: New claude instances can't start properly; ralph loops with no progress
- **Diagnosis**:
  ```bash
  ps aux | grep "claude" | grep -v grep | wc -l  # Check count
  ps aux | grep "claude" | awk '{sum+=$3} END {print sum"%"}'  # Check CPU
  ```
- **Workaround**: Kill stale claude instances before running ralph:
  ```bash
  # Kill old/idle claude instances (be careful!)
  pkill -9 -f "claude" 2>/dev/null  # Nuclear option
  ```
- **Proposed Fix for ralph.sh**:
  1. Check claude instance count before spawning
  2. If too many instances, wait or kill oldest idle ones
  3. Add instance limit (e.g., max 5 concurrent claude instances)

---

## Issue 29: Ralph Not Capturing Claude Output from Tmp File ✅ FIXED

- **Symptom**: Claude completes task (tmp file has `TASK_COMPLETE`) but ralph shows no output
- **Root Cause**: Multiple issues - file buffering, missing sync, and macOS temp directory handling
- **Status**: ✅ FIXED (2026-02-01)
- **Evidence**:
  - Tmp file `/var/folders/.../T/tmp.9jNNyB5elT` contains full claude output with TASK_COMPLETE
  - bd-2as.log shows no output after "--- output ---"
  - Bead stuck as IN_PROGRESS despite task being done
- **Impact**: Completed work is lost; bead loops infinitely
- **Diagnosis**:
  ```bash
  # Check if tmp files have claude output
  cat /var/folders/s3/*/T/tmp.* 2>/dev/null | grep -l "TASK_COMPLETE"
  ```

### Fix Applied (ralph.sh lines 1419-1438)

**Change 1 - Added sync after command execution (line 1426):**
```bash
# Ensure file buffers are flushed after potential timeout/kill
sync 2>/dev/null || true
```

**Change 2 - Added explicit empty file check (lines 1430-1434):**
```bash
if [[ -s "$tmp_output" ]]; then
  cat "$tmp_output" >> "$log_file"
else
  echo "[WARNING] Command produced no output (tmp file empty)" >> "$log_file"
fi
```

**Change 3 - Changed from hardcoded /tmp to $TMPDIR (lines 1505-1507):**
```bash
# Check both Linux (/tmp) and macOS (/var/folders) temp locations
local tmpdir="${TMPDIR:-/tmp}"
find "$tmpdir" -maxdepth 1 -name 'tmp.*' -mmin -5 -exec grep -l "TASK_COMPLETE" {} \; 2>/dev/null >> "$log_file" || true
```

**Verification:**
```bash
# Run ralph and check output is captured
./scripts/ralph.sh --beads 1
# Check log files show actual claude output
cat /tmp/ralph_*/bd-*.log | grep -c "TASK_COMPLETE"
```

---

## Issue 30: False Timeout Reports - Immediate Process Termination ✅ FIXED

- **Symptom**: Ralph reports "Tool timed out after 45 minutes (exit code 143)" but process dies within seconds
- **Root Cause**: Claude CLI backgrounding requests when stdout/stderr redirected + missing stdin handling
- **Status**: ✅ FIXED (2026-02-01)
- **Evidence** (2026-02-01):
  - bd-758 iterations 1-5 all "timed out" within 30 seconds each
  - Log timestamps show rapid succession of failures
  - Actual tests (E2E-US-013-04, E2E-US-013-06) pass when run manually
  - The claude instance completes work but gets killed before ralph reads output
- **Impact**:
  - Misleading logs make debugging harder
  - Beads loop infinitely despite work being complete
  - Resource waste from repeated attempts
- **Diagnosis**:
  ```bash
  # Check timestamps to see if "45 minute" timeouts are actually fast
  grep -E "(Spawning|timed out)" /tmp/ralph_full_run.log | tail -20

  # Verify tests actually pass
  npm run test:e2e -- --grep 'E2E-US-XXX'
  ```

### Root Cause Analysis

The "false timeout" was actually caused by Claude CLI backgrounding its work when it detected:
1. stdout/stderr redirected to files (not a TTY)
2. stdin not explicitly closed

When backgrounded, the CLI returns immediately with just a task ID, causing the timeout wrapper to kill the "completed" process (exit 143).

### Fixes Applied

See Issue 32 (Claude CLI backgrounding) and Issue 33 (stdin blocking) for the actual code changes that resolved this.

**Verification:**
```bash
# Run ralph and confirm no more false timeouts
./scripts/ralph.sh --beads 5
grep "timed out" /tmp/ralph_*/bd-*.log  # Should show actual timeouts only
```

---

## Issue 31: Resource Contention Causes Immediate Claude Death

- **Symptom**: New claude instances for ralph die immediately (exit 137/143)
- **Root Cause**: Too many concurrent claude instances competing for resources
- **Status**: 🔴 STRUCTURAL - Related to Issue 28
- **Evidence** (2026-02-01):
  - 22 claude instances running simultaneously
  - Total CPU: 112%+ across all instances
  - Top instances using 97.5% and 64.5% CPU each
  - New instances spawned by ralph get killed immediately
- **Impact**: Ralph cannot complete any beads until resources are freed
- **Workaround**:
  ```bash
  # Check resource usage before running ralph
  ps aux | grep claude | wc -l
  ps aux | grep claude | awk '{sum+=$3} END {print sum"%"}'

  # If too many instances, kill non-essential ones
  # (Be careful - identify which are from ralph vs interactive sessions)
  ```
- **Proposed Fix for ralph.sh**:
  1. Check claude instance count before spawning
  2. If count > threshold (e.g., 10), wait or warn
  3. Track PID of spawned claude instance
  4. Clean up orphaned instances from previous ralph runs

---

## Issue 32: Claude CLI Backgrounding Requests (MAJOR FIX) ✅ FIXED

- **Symptom**: Claude CLI returns immediately with task ID instead of executing synchronously
- **Root Cause**: When stdout/stderr are redirected to files, Claude CLI detects non-TTY and backgrounds the request
- **Status**: ✅ FIXED (2026-02-01)
- **Discovery**: This was the root cause behind Issues 29 and 30
- **Impact**:
  - Ralph's timeout kills the "completed" process before work actually starts
  - False exit code 143 (SIGTERM) reported as timeout
  - Beads loop infinitely with no actual work done

### Fix Applied (ralph.sh line 1478)

**Before:**
```bash
cmd="${CLAUDE_CMD:-claude -p --dangerously-skip-permissions}"
```

**After:**
```bash
cmd="${CLAUDE_CMD:-claude -p --dangerously-skip-permissions --no-session-persistence}"
```

### Why This Works

The `--no-session-persistence` flag:
1. Disables Claude CLI's session persistence feature
2. Forces synchronous execution regardless of TTY detection
3. Ensures output is written directly to stdout/stderr
4. Prevents backgrounding of requests

### Verification

```bash
# Test that claude executes synchronously
echo "hello" | claude -p --no-session-persistence "say hi"
# Should wait and produce output, not return immediately

# Run ralph and confirm beads complete
./scripts/ralph.sh --beads 1
# Check log shows actual claude output, not just task ID
```

---

## Issue 33: stdin Blocking Causes CLI to Wait (MAJOR FIX) ✅ FIXED

- **Symptom**: Claude CLI hangs waiting for input even with `-p` (print mode)
- **Root Cause**: stdin not redirected, causing CLI to poll for additional input
- **Status**: ✅ FIXED (2026-02-01)
- **Discovery**: Identified alongside Issue 32 as contributing to false timeouts
- **Impact**:
  - CLI waits indefinitely for stdin EOF
  - Process appears hung but is actually waiting
  - Timeout kills process before work completes

### Fix Applied (ralph.sh lines 1419 and 1421)

**Before:**
```bash
if [[ -n "$timeout_cmd" ]]; then
  "$timeout_cmd" --kill-after=30s "${STALL_MINUTES}m" "${cmd[@]}" > "$tmp_output" 2>&1
else
  "${cmd[@]}" > "$tmp_output" 2>&1
fi
```

**After:**
```bash
if [[ -n "$timeout_cmd" ]]; then
  "$timeout_cmd" --kill-after=30s "${STALL_MINUTES}m" "${cmd[@]}" < /dev/null > "$tmp_output" 2>&1
else
  "${cmd[@]}" < /dev/null > "$tmp_output" 2>&1
fi
```

### Why This Works

The `< /dev/null` redirect:
1. Provides immediate EOF on stdin
2. Prevents CLI from waiting for user input
3. Signals to the CLI that input is complete
4. Combined with `--no-session-persistence`, ensures fully synchronous execution

### Full Function After Both Fixes (lines 1402-1438)

```bash
_exec_with_timeout() {
  local tmp_output="$1"
  local log_file="$2"
  shift 2
  local cmd=("$@")

  # Detect timeout command
  local timeout_cmd=""
  if command -v timeout >/dev/null 2>&1; then
    timeout_cmd="timeout"
  elif command -v gtimeout >/dev/null 2>&1; then
    timeout_cmd="gtimeout"
  fi

  # Execute with direct file redirection (avoids PTY buffering issues)
  # Output goes to tmp_output, which is later copied to log_file
  if [[ -n "$timeout_cmd" ]]; then
    "$timeout_cmd" --kill-after=30s "${STALL_MINUTES}m" "${cmd[@]}" < /dev/null > "$tmp_output" 2>&1
  else
    "${cmd[@]}" < /dev/null > "$tmp_output" 2>&1
  fi
  _EXEC_RC=$?

  # Ensure file buffers are flushed after potential timeout/kill
  sync 2>/dev/null || true

  # Append to log file if specified (with explicit error handling)
  if [[ -n "$log_file" ]]; then
    if [[ -s "$tmp_output" ]]; then
      cat "$tmp_output" >> "$log_file"
    else
      echo "[WARNING] Command produced no output (tmp file empty)" >> "$log_file"
    fi
  fi

  # Note: Output is returned via the file, not stdout - caller reads tmp_output
}
```

### Verification

```bash
# Confirm stdin is closed immediately
strace -e read timeout 10 claude -p --no-session-persistence "test" < /dev/null 2>&1 | grep "read(0"
# Should show immediate read of empty stdin, no blocking

# Run ralph and verify completion
./scripts/ralph.sh --beads 3
# All beads should complete without false timeouts
```
