#!/usr/bin/env bash
set -euo pipefail

# Ralph Loop for Oracle Swarm Extension
# Autonomous execution of task graph using fresh AI agent contexts.
#
# Based on Geoffrey Huntley's Ralph pattern and snarktank/ralph
# https://github.com/snarktank/ralph
#
# Supports multiple AI coding tools:
#   - Claude Code: claude -p --dangerously-skip-permissions
#   - Codex CLI: codex exec --yolo
#   - Smart routing (default): backend→Codex, UI→Claude
#
# Task sources:
#   - Default: artifacts/04-task-graph.json (Oracle Swarm format)
#   - Beads: Use `br ready` to get tasks from beads issue tracker
#
# Usage:
#   ./scripts/ralph.sh [options] [max_iterations]
#
# Options:
#   --tool <claude|codex|smart>  Select AI tool (default: smart)
#   --ask                        Ask which tool to use for each task
#   --backend-tool <tool>        Tool for backend tasks (default: codex)
#   --frontend-tool <tool>       Tool for frontend tasks (default: claude)
#   --beads                      Use beads_rust (br) for task management instead of task-graph.json
#
# CLI Flags Used:
#   Claude Code: claude -p --dangerously-skip-permissions "<prompt>"
#   Codex CLI:   codex exec --yolo "<prompt>"
#
# Examples:
#   ./scripts/ralph.sh 50                    # 50 iterations with Claude Code
#   ./scripts/ralph.sh --tool codex 50       # Use Codex for all tasks
#   ./scripts/ralph.sh --tool smart 50       # Smart routing by task type
#   ./scripts/ralph.sh --ask 50              # Ask for each task
#   ./scripts/ralph.sh --beads 50            # Use beads for task tracking

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TASK_GRAPH="$PROJECT_ROOT/artifacts/04-task-graph.json"
PROGRESS_FILE="$PROJECT_ROOT/progress.txt"
LEARNINGS_FILE="$PROJECT_ROOT/learnings.md"

# Defaults
MAX_ITERATIONS=20
TOOL="smart"           # smart = route by task type (codex for backend, claude for frontend)
ASK_MODE=false
BACKEND_TOOL="codex"   # Backend/core/api tasks → Codex (fast iteration)
FRONTEND_TOOL="claude" # Frontend/UI/design tasks → Claude Code (nuanced)
USE_BEADS=""  # Empty = auto-detect/interactive, "true" = beads, "false" = task-graph
FRESH_EYES="false"     # Set to "true" for post-task review
DEVIN_REVIEW="true"    # Run Devin AI code review on completion (free for public PRs)

# Self-healing (from task-orchestrator pattern)
SELF_HEAL="true"       # Auto-recover stuck tasks
STALL_THRESHOLD=20     # Minutes before considering a task stuck

# Auto-PR feature
AUTO_PR="true"         # Auto-create PRs when tasks complete (requires gh CLI)
PR_BASE_BRANCH="main"  # Base branch for PRs

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_tool() { echo -e "${CYAN}[TOOL]${NC} $1"; }

# Portable ISO timestamp (macOS `date` lacks -Iseconds)
iso_now() {
  if date -Iseconds >/dev/null 2>&1; then
    date -Iseconds
  else
    date -u "+%Y-%m-%dT%H:%M:%SZ"
  fi
}

# Parse arguments
parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --tool)
        if [[ -z "${2:-}" || "$2" == -* ]]; then
          log_error "--tool requires a value (claude, codex, or smart)"
          exit 1
        fi
        TOOL="$2"
        shift 2
        ;;
      --ask)
        ASK_MODE=true
        shift
        ;;
      --backend-tool)
        if [[ -z "${2:-}" || "$2" == -* ]]; then
          log_error "--backend-tool requires a value"
          exit 1
        fi
        BACKEND_TOOL="$2"
        shift 2
        ;;
      --frontend-tool)
        if [[ -z "${2:-}" || "$2" == -* ]]; then
          log_error "--frontend-tool requires a value"
          exit 1
        fi
        FRONTEND_TOOL="$2"
        shift 2
        ;;
      --beads)
        USE_BEADS="true"
        shift
        ;;
      --no-beads|--graph)
        USE_BEADS="false"
        shift
        ;;
      --fresh-eyes)
        FRESH_EYES="true"
        shift
        ;;
      --no-self-heal)
        SELF_HEAL="false"
        shift
        ;;
      --stall-threshold)
        if [[ -z "${2:-}" || "$2" == -* ]]; then
          log_error "--stall-threshold requires a value (minutes)"
          exit 1
        fi
        STALL_THRESHOLD="$2"
        shift 2
        ;;
      --auto-pr)
        AUTO_PR="true"
        shift
        ;;
      --no-auto-pr)
        AUTO_PR="false"
        shift
        ;;
      --pr-base)
        if [[ -z "${2:-}" || "$2" == -* ]]; then
          log_error "--pr-base requires a branch name"
          exit 1
        fi
        PR_BASE_BRANCH="$2"
        shift 2
        ;;
      --no-devin)
        DEVIN_REVIEW="false"
        shift
        ;;
      -h|--help)
        show_help
        exit 0
        ;;
      *)
        if [[ "$1" =~ ^[0-9]+$ ]]; then
          MAX_ITERATIONS="$1"
        elif [[ "$1" != -* ]]; then
          log_warn "Ignoring unknown argument: $1"
        fi
        shift
        ;;
    esac
  done
  
  # Validate tool value
  case "$TOOL" in
    claude|codex|smart) ;;
    *)
      log_error "Invalid tool: $TOOL (must be claude, codex, or smart)"
      exit 1
      ;;
  esac
}

show_help() {
  cat << 'EOF'
Ralph Loop - Autonomous AI Agent Execution

Usage: ./scripts/ralph.sh [options] [max_iterations]

Options:
  --tool <claude|codex|smart>  Select AI tool (default: smart)
                               smart  = Route by task type (RECOMMENDED)
                               claude = Claude Code CLI for all tasks
                               codex  = OpenAI Codex CLI for all tasks
  --ask                        Ask which tool to use for each task
  --backend-tool <tool>        Tool for backend/core tasks (default: codex)
  --frontend-tool <tool>       Tool for UI/frontend tasks (default: claude)
  --beads                      Use beads_rust (br) for task tracking
  --no-beads, --graph          Use task-graph.json (Oracle Swarm built-in)
  --fresh-eyes                 Run fresh-eyes code review after each task
  --no-self-heal               Disable auto-recovery of stuck tasks
  --stall-threshold <min>      Minutes before task is considered stuck (default: 20)
  --auto-pr                    Create PR after each completed task (default: on)
  --no-auto-pr                 Disable auto-PR creation
  --pr-base <branch>           Base branch for PRs (default: main)
  --no-devin                   Disable Devin AI code review
  -h, --help                   Show this help

Tool Routing (Doodlestein Methodology):
  By default (--tool smart), Ralph routes tasks by type:
  - Backend tasks (core, engine, api, data, worker, db) → Codex (fast iteration)
  - Frontend tasks (ui, components, design, css, styles) → Claude Code (nuanced)
  
  Heavy document reviews (PRD, UX, Plan) use GPT-5.2 Pro via /oracle command.

Task Source Selection:
  By default, Ralph will auto-detect available task sources:
  - If both beads (.beads/) and task-graph.json exist → interactive prompt
  - If only one exists → auto-select that source
  - Use --beads or --no-beads to skip interactive selection

Fresh Eyes Review (--fresh-eyes):
  Per Doodlestein methodology, after each task completion, Ralph will:
  1. Ask the agent to review the new code with "fresh eyes"
  2. Fix any bugs/issues found
  3. Repeat until no issues are found (max 3 passes)
  This adds time but catches bugs much earlier.

Self-Healing (enabled by default):
  Ralph monitors task execution and auto-recovers stuck tasks:
  - If a task runs longer than STALL_THRESHOLD minutes → reset and retry
  - Failed tasks are retried with different approach hints
  - Use --no-self-heal to disable

Auto-PR (enabled by default):
  After each completed task, Ralph will:
  1. Create a feature branch (task/<task-id>)
  2. Commit changes with descriptive message
  3. Create a PR against PR_BASE_BRANCH
  Requires gh CLI: brew install gh && gh auth login

Learnings Capture:
  Ralph records learnings from each task to learnings.md:
  - What worked well
  - Issues encountered
  - Patterns discovered
  Useful for improving future prompts and workflows.

CLI Flags Used (YOLO mode by default):
  Claude Code: claude -p --dangerously-skip-permissions "<prompt>"
  Codex CLI:   codex exec --yolo "<prompt>"

Environment Variables:
  CLAUDE_CMD       Custom Claude Code command
  CODEX_CMD        Custom Codex command
  FRESH_EYES       "true" to enable fresh-eyes review
  SELF_HEAL        "false" to disable self-healing
  STALL_THRESHOLD  Minutes before task is stuck (default: 20)
  AUTO_PR          "false" to disable auto-PR
  PR_BASE_BRANCH   Base branch for PRs (default: main)
  DEVIN_REVIEW     "false" to disable Devin review

Examples:
  ./scripts/ralph.sh 50                    # 50 iterations, smart routing (default)
  ./scripts/ralph.sh --beads 50            # Force beads_rust (br) for tasks
  ./scripts/ralph.sh --fresh-eyes 50       # Enable fresh-eyes review after each task
  ./scripts/ralph.sh --tool claude 50      # Use Claude Code for all tasks
  ./scripts/ralph.sh --tool codex 50       # Use Codex for all tasks
  ./scripts/ralph.sh --ask 50              # Interactive tool selection per task

Task Type Detection (for smart routing):
  Frontend: tags contain ui, components, frontend, design, css, styles
  Backend:  tags contain core, engine, api, backend, data, worker, db

Beads Integration (beads_rust):
  Install: cargo install --git https://github.com/Dicklesworthstone/beads_rust.git
  Commands used:
    - br ready --json     : Get tasks with no blockers
    - br close <id>       : Complete a task
    - br update <id>      : Update task status
    - br dep add <a> <b>  : Add dependency (a depends on b)

Task Graph Integration (Oracle Swarm):
  Generate: /artifact-tasks to compile from plan + Oracle issues
  Format:   artifacts/04-task-graph.json
EOF
}

# Check prerequisites
check_prerequisites() {
  local has_claude=false
  local has_codex=false
  
  # Check which tools are available
  if command -v claude &> /dev/null; then
    has_claude=true
  fi
  if command -v codex &> /dev/null; then
    has_codex=true
  fi
  
  # Check for selected tool
  case "$TOOL" in
    claude)
      if [[ "$has_claude" != "true" ]]; then
        log_error "Claude Code CLI not found. Install with: npm install -g @anthropic-ai/claude-code"
        exit 1
      fi
      ;;
    codex)
      if [[ "$has_codex" != "true" ]]; then
        log_error "Codex CLI not found. Install from: https://github.com/openai/codex"
        exit 1
      fi
      ;;
    smart)
      # For smart routing, we need at least one tool
      if [[ "$has_claude" != "true" && "$has_codex" != "true" ]]; then
        log_error "Smart routing requires at least one tool (claude or codex)"
        log_error "Install Claude Code: npm install -g @anthropic-ai/claude-code"
        log_error "Install Codex: https://github.com/openai/codex"
        exit 1
      fi
      
      # Warn about missing tools
      if [[ "$has_claude" != "true" ]]; then
        log_warn "Claude Code not found - will use codex for all tasks"
        FRONTEND_TOOL="codex"
      fi
      if [[ "$has_codex" != "true" ]]; then
        log_warn "Codex not found - will use claude for all tasks"
        BACKEND_TOOL="claude"
      fi
      ;;
  esac
  
  if ! command -v jq &> /dev/null; then
    log_error "jq not found. Install with: brew install jq (macOS) or apt install jq (Linux)"
    exit 1
  fi
  
  # Interactive task source selection (if not explicitly set)
  if [[ "$USE_BEADS" != "true" && "$USE_BEADS" != "false" ]]; then
    select_task_source
  fi
  
  # Check task source
  if [[ "$USE_BEADS" == "true" ]]; then
    # Beads mode - check for br CLI
    if ! command -v br &> /dev/null; then
      log_error "beads_rust CLI (br) not found."
      log_error "Install with: cargo install --git https://github.com/Dicklesworthstone/beads_rust.git"
      exit 1
    fi
    
    # Check if beads is initialized
    if [[ ! -d ".beads" ]]; then
      log_error "Beads not initialized in this project."
      log_error "Run: br init"
      exit 1
    fi
    
    log_info "Using beads_rust (br) for task management"
  else
    # Standard mode - check for task-graph.json
    if [[ ! -f "$TASK_GRAPH" ]]; then
      log_error "Task graph not found at: $TASK_GRAPH"
      log_error "Run /artifact-tasks first to compile the task graph."
      log_error "Or use --beads to use beads for task management."
      exit 1
    fi
  fi
  
  if ! git rev-parse --git-dir &> /dev/null; then
    log_error "Not a git repository. Initialize with: git init"
    exit 1
  fi
}

# Interactive task source selection
select_task_source() {
  local has_beads=false
  local has_graph=false
  
  # Check what's available
  [[ -d ".beads" ]] && command -v br &> /dev/null && has_beads=true
  [[ -f "$TASK_GRAPH" ]] && has_graph=true
  
  # If both are available, ask user
  if [[ "$has_beads" == "true" && "$has_graph" == "true" ]]; then
    echo ""
    echo "╔═══════════════════════════════════════════════════════════════╗"
    echo "║            SELECT TASK SOURCE                                 ║"
    echo "╠═══════════════════════════════════════════════════════════════╣"
    echo "║  Both task sources are available:                             ║"
    echo "║                                                               ║"
    echo "║  [1] beads_rust (br)                                          ║"
    echo "║      → .beads/ directory with dependency-aware tracking       ║"
    echo "║      → Commands: br ready, br close, br update                ║"
    echo "║                                                               ║"
    echo "║  [2] task-graph.json (Oracle Swarm built-in)                  ║"
    echo "║      → artifacts/04-task-graph.json                           ║"
    echo "║      → Compiled from plan + Oracle issues                     ║"
    echo "╚═══════════════════════════════════════════════════════════════╝"
    echo ""
    
    while true; do
      read -p "Choose task source [1/2] (or 'q' to quit): " choice
      case "$choice" in
        1|beads|br)
          USE_BEADS="true"
          log_info "Selected: beads_rust (br)"
          return
          ;;
        2|graph|json)
          USE_BEADS="false"
          log_info "Selected: task-graph.json"
          return
          ;;
        q|quit|exit)
          echo "Aborted."
          exit 0
          ;;
        *)
          echo "Please enter 1 or 2"
          ;;
      esac
    done
  elif [[ "$has_beads" == "true" ]]; then
    # Only beads available
    USE_BEADS="true"
    log_info "Auto-selected: beads_rust (br) - only available source"
  elif [[ "$has_graph" == "true" ]]; then
    # Only task-graph available  
    USE_BEADS="false"
    log_info "Auto-selected: task-graph.json - only available source"
  else
    # Neither available - show setup instructions
    echo ""
    echo "╔═══════════════════════════════════════════════════════════════╗"
    echo "║            NO TASK SOURCE FOUND                               ║"
    echo "╠═══════════════════════════════════════════════════════════════╣"
    echo "║  Choose one of these setup options:                           ║"
    echo "║                                                               ║"
    echo "║  Option A: Use beads_rust (br) for task tracking              ║"
    echo "║    1. cargo install --git https://github.com/                 ║"
    echo "║           Dicklesworthstone/beads_rust.git                    ║"
    echo "║    2. br init                                                 ║"
    echo "║    3. br create \"Task title\" -t task -p 1                     ║"
    echo "║    4. ./scripts/ralph.sh --beads                              ║"
    echo "║                                                               ║"
    echo "║  Option B: Use Oracle Swarm task-graph.json                   ║"
    echo "║    1. Create artifacts/03-plan.md with tasks                  ║"
    echo "║    2. Run /artifact-tasks to compile                          ║"
    echo "║    3. ./scripts/ralph.sh                                      ║"
    echo "╚═══════════════════════════════════════════════════════════════╝"
    exit 1
  fi
}

# Initialize progress file if needed
init_progress() {
  if [[ ! -f "$PROGRESS_FILE" ]]; then
    cat > "$PROGRESS_FILE" << 'EOF'
# Progress Log

This file tracks learnings across Ralph iterations.
Each iteration appends discoveries here for future context.

## Codebase Patterns
- (Patterns will be added as discovered)

## Gotchas
- (Gotchas will be added as discovered)

## Iteration Log
EOF
    log_info "Created progress.txt"
  fi
}

# Determine which tool to use for a task
get_tool_for_task() {
  local task_json="$1"
  local tags=$(echo "$task_json" | jq -r '(.tags // []) | map(ascii_downcase) | join(" ")')
  
  if [[ "$ASK_MODE" == "true" ]]; then
    local subject=$(echo "$task_json" | jq -r '.subject')
    echo "" >&2
    log_info "Task: $subject" >&2
    log_info "Tags: $tags" >&2
    echo -e "${CYAN}Which tool should handle this task?${NC}" >&2
    echo "  1) claude  - Claude Code" >&2
    echo "  2) codex   - OpenAI Codex" >&2
    echo -n "Choice [1/2]: " >&2
    read -r choice
    case "$choice" in
      2|codex) echo "codex" ;;
      *) echo "claude" ;;
    esac
    return
  fi
  
  if [[ "$TOOL" != "smart" ]]; then
    echo "$TOOL"
    return
  fi
  
  # Smart routing based on tags
  local frontend_tags="ui components frontend design css styles layout view"
  local backend_tags="core engine api backend data worker db database server"
  
  local is_frontend=false
  local is_backend=false
  
  for tag in $tags; do
    if [[ " $frontend_tags " =~ " $tag " ]]; then
      is_frontend=true
    fi
    if [[ " $backend_tags " =~ " $tag " ]]; then
      is_backend=true
    fi
  done
  
  # Decide based on detected type
  if [[ "$is_frontend" == "true" && "$is_backend" == "false" ]]; then
    echo "$FRONTEND_TOOL"
  elif [[ "$is_backend" == "true" && "$is_frontend" == "false" ]]; then
    echo "$BACKEND_TOOL"
  elif [[ "$is_frontend" == "true" && "$is_backend" == "true" ]]; then
    # Mixed - prefer frontend tool for UI safety
    echo "$FRONTEND_TOOL"
  else
    # Default to the configured frontend tool (respects availability check)
    echo "$FRONTEND_TOOL"
  fi
}

# Run a task with the specified tool
run_with_tool() {
  local tool="$1"
  local prompt="$2"
  local output=""
  
  log_tool "Using: $tool"
  
  case "$tool" in
    claude)
      # Claude Code CLI flags:
      #   -p / --print : Non-interactive mode, output to stdout
      #   --dangerously-skip-permissions : Skip all approval prompts (YOLO mode)
      # Customize via CLAUDE_CMD env var if needed
      local claude_cmd="${CLAUDE_CMD:-claude -p --dangerously-skip-permissions}"
      output=$($claude_cmd "$prompt" 2>&1 | tee /dev/stderr) || true
      ;;
    codex)
      # Codex CLI flags:
      #   exec / e : Non-interactive execution mode
      #   --yolo : Skip approvals and sandbox (alias for --dangerously-bypass-approvals-and-sandbox)
      #   Alternative: --full-auto (safer, keeps sandbox but auto-approves)
      # Customize via CODEX_CMD env var if needed
      local codex_cmd="${CODEX_CMD:-codex exec --yolo}"
      output=$($codex_cmd "$prompt" 2>&1 | tee /dev/stderr) || true
      ;;
    *)
      log_error "Unknown tool: $tool"
      return 1
      ;;
  esac
  
  echo "$output"
}

# Fresh Eyes Code Review (Doodlestein methodology)
# Run after each task completion to catch bugs early
# Keep running until no bugs are found
run_fresh_eyes_review() {
  local tool="$1"
  local max_review_passes=3
  local pass=1
  
  local review_prompt=$(cat <<'EOF'
Great, now I want you to carefully read over all of the new code you
just wrote and other existing code you just modified with "fresh eyes"
looking super carefully for any obvious bugs, errors, problems, issues,
confusion, etc.

Carefully fix anything you uncover.

If you find issues, fix them and output: <review>FOUND_ISSUES</review>
If everything looks good, output: <review>NO_ISSUES</review>
EOF
)
  
  while [[ $pass -le $max_review_passes ]]; do
    log_info "  Fresh eyes review pass $pass/$max_review_passes..."
    
    local review_output
    set +e
    review_output=$(run_with_tool "$tool" "$review_prompt" 2>&1)
    set -e
    
    if echo "$review_output" | grep -q "<review>NO_ISSUES</review>"; then
      log_success "  Fresh eyes review complete - no issues found"
      return 0
    elif echo "$review_output" | grep -q "<review>FOUND_ISSUES</review>"; then
      log_info "  Issues found and fixed, running another pass..."
      pass=$((pass + 1))
    else
      # No clear signal, assume done
      log_info "  Fresh eyes review complete (no clear signal)"
      return 0
    fi
  done
  
  log_warn "  Reached max review passes ($max_review_passes), continuing..."
}

# Get next pending task (respects dependencies)
get_next_task() {
  if [[ "$USE_BEADS" == "true" ]]; then
    get_next_task_beads
  else
    get_next_task_graph
  fi
}

# Get next task from task-graph.json
get_next_task_graph() {
  # Find first task where:
  # - status is "pending"
  # - all blockedBy tasks are "completed"
  jq -r '
    .tasks as $all |
    ($all | map(select(.status == "completed")) | map(.id)) as $completed |
    $all | map(select(
      .status == "pending" and
      ((.blockedBy // []) | all(. as $dep | $completed | index($dep)))
    )) | first // empty
  ' "$TASK_GRAPH"
}

# Get next task from beads (br ready)
get_next_task_beads() {
  # br ready --json returns tasks with no open blockers
  # Format: [{"id": "bd-a1b2", "title": "...", "priority": 1, "type": "task", ...}]
  local ready_tasks
  ready_tasks=$(br ready --json 2>/dev/null || echo "[]")
  
  if [[ "$ready_tasks" == "[]" || -z "$ready_tasks" ]]; then
    echo ""
    return
  fi
  
  # Get the first ready task and convert to our format
  echo "$ready_tasks" | jq -r '
    .[0] | {
      id: .id,
      subject: .title,
      description: (.description // ""),
      tags: ((.labels // []) | map(ascii_downcase)),
      priority: .priority,
      type: .type
    }
  '
}

# Get task by ID
get_task_by_id() {
  local task_id="$1"
  if [[ "$USE_BEADS" == "true" ]]; then
    br show "$task_id" --json 2>/dev/null | jq -r '{
      id: .id,
      subject: .title,
      description: (.description // ""),
      tags: ((.labels // []) | map(ascii_downcase))
    }'
  else
    jq -r --arg id "$task_id" '.tasks[] | select(.id == $id)' "$TASK_GRAPH"
  fi
}

# Mark task as completed
mark_task_completed() {
  local task_id="$1"
  if [[ "$USE_BEADS" == "true" ]]; then
    br close "$task_id" --reason "completed" 2>/dev/null || true
    log_success "Closed beads task $task_id"
  else
    local tmp=$(mktemp)
    jq --arg id "$task_id" '
      .tasks = [.tasks[] | if .id == $id then .status = "completed" else . end]
    ' "$TASK_GRAPH" > "$tmp" && mv "$tmp" "$TASK_GRAPH"
    log_success "Marked task $task_id as completed"
  fi
}

# Mark task as failed
mark_task_failed() {
  local task_id="$1"
  if [[ "$USE_BEADS" == "true" ]]; then
    br update "$task_id" --status blocked --comment "Failed during Ralph execution" 2>/dev/null || true
    log_warn "Marked beads task $task_id as blocked (failed)"
  else
    local tmp=$(mktemp)
    jq --arg id "$task_id" '
      .tasks = [.tasks[] | if .id == $id then .status = "failed" else . end]
    ' "$TASK_GRAPH" > "$tmp" && mv "$tmp" "$TASK_GRAPH"
    log_warn "Marked task $task_id as failed"
  fi
}

# Mark task as in_progress
mark_task_in_progress() {
  local task_id="$1"
  if [[ "$USE_BEADS" == "true" ]]; then
    br update "$task_id" --status in_progress 2>/dev/null || true
  else
    local tmp=$(mktemp)
    jq --arg id "$task_id" '
      .tasks = [.tasks[] | if .id == $id then .status = "in_progress" else . end]
    ' "$TASK_GRAPH" > "$tmp" && mv "$tmp" "$TASK_GRAPH"
  fi
}

# Track task start time for stall detection
# Uses a file for persistence across script restarts
TASK_TRACKING_FILE="$PROJECT_ROOT/.ralph-task-tracking.json"

# Initialize tracking file if needed
init_task_tracking() {
  if [[ ! -f "$TASK_TRACKING_FILE" ]]; then
    echo '{}' > "$TASK_TRACKING_FILE"
  fi
}

# Record when a task starts (persists to file)
record_task_start() {
  local task_id="$1"
  init_task_tracking
  local now=$(date +%s)
  local tmp=$(mktemp)
  jq --arg id "$task_id" --arg ts "$now" '.[$id] = ($ts | tonumber)' "$TASK_TRACKING_FILE" > "$tmp" && mv "$tmp" "$TASK_TRACKING_FILE"
}

# Clear task tracking (on completion or failure)
clear_task_tracking() {
  local task_id="$1"
  if [[ -f "$TASK_TRACKING_FILE" ]]; then
    local tmp=$(mktemp)
    jq --arg id "$task_id" 'del(.[$id])' "$TASK_TRACKING_FILE" > "$tmp" && mv "$tmp" "$TASK_TRACKING_FILE"
  fi
}

# Check if a task has stalled (exceeded STALL_THRESHOLD)
check_task_stalled() {
  local task_id="$1"
  init_task_tracking
  
  local start_time
  start_time=$(jq -r --arg id "$task_id" '.[$id] // 0' "$TASK_TRACKING_FILE" 2>/dev/null || echo "0")
  
  if [[ "$start_time" -eq 0 ]]; then
    return 1  # No start time recorded, not stalled
  fi
  
  local now=$(date +%s)
  local elapsed_minutes=$(( (now - start_time) / 60 ))
  
  if [[ "$elapsed_minutes" -ge "$STALL_THRESHOLD" ]]; then
    log_warn "Task $task_id has been tracked for $elapsed_minutes minutes (threshold: $STALL_THRESHOLD)"
    return 0  # Stalled
  fi
  
  return 1  # Not stalled
}

# Get all tracked task IDs
get_tracked_tasks() {
  init_task_tracking
  jq -r 'keys[]' "$TASK_TRACKING_FILE" 2>/dev/null || true
}

# Handle stalled task - reset and prepare for retry with hints
handle_stalled_task() {
  local task_id="$1"
  local attempt="${2:-1}"
  
  log_warn "Self-healing stalled task: $task_id (attempt $attempt)"
  
  # Reset task to pending
  if [[ "$USE_BEADS" == "true" ]]; then
    br update "$task_id" --status open --comment "Self-healed after stall (attempt $attempt)" 2>/dev/null || true
  else
    local tmp=$(mktemp)
    jq --arg id "$task_id" --arg attempt "$attempt" '
      .tasks = [.tasks[] | if .id == $id then .status = "pending" | .healAttempt = ($attempt | tonumber) else . end]
    ' "$TASK_GRAPH" > "$tmp" && mv "$tmp" "$TASK_GRAPH"
  fi
  
  # Clear the tracking
  clear_task_tracking "$task_id"
  
  # Log the self-heal event
  {
    echo ""
    echo "### Self-Heal Event - $(iso_now)"
    echo "- Task: $task_id"
    echo "- Reason: Stalled (exceeded ${STALL_THRESHOLD}m threshold)"
    echo "- Action: Reset to pending for retry"
    echo "- Attempt: $attempt"
  } >> "$PROGRESS_FILE"
}

# Create PR for completed task
create_auto_pr() {
  local task_id="$1"
  local subject="$2"
  
  if [[ "${AUTO_PR:-true}" != "true" ]]; then
    return 0
  fi
  
  # Check if gh CLI is available
  if ! command -v gh &>/dev/null; then
    log_warn "gh CLI not found - skipping auto-PR (install with: brew install gh)"
    return 0
  fi
  
  # Check if authenticated
  if ! gh auth status &>/dev/null; then
    log_warn "gh CLI not authenticated - skipping auto-PR (run: gh auth login)"
    return 0
  fi
  
  # Check if there are changes to commit
  if [[ -z "$(git status --porcelain)" ]]; then
    log_info "No changes to commit - skipping PR"
    return 0
  fi
  
  local branch_name="task/${task_id}"
  local safe_subject=$(echo "$subject" | tr -cd '[:alnum:] ._-' | cut -c1-50)
  
  log_info "Creating PR for task $task_id..."
  
  # First, stash any uncommitted changes
  git stash push -m "ralph-auto-pr-temp" 2>/dev/null || true
  
  # Switch to base branch and pull latest
  git checkout "${PR_BASE_BRANCH:-main}" 2>/dev/null || {
    log_warn "Could not switch to base branch ${PR_BASE_BRANCH:-main}"
    git stash pop 2>/dev/null || true
    return 1
  }
  git pull --ff-only 2>/dev/null || true
  
  # Create feature branch from base
  git checkout -b "$branch_name" 2>/dev/null || git checkout "$branch_name" 2>/dev/null || {
    log_warn "Could not create/switch to branch $branch_name"
    git stash pop 2>/dev/null || true
    return 1
  }
  
  # Apply stashed changes
  git stash pop 2>/dev/null || true
  
  # Stage and commit all changes
  git add -A
  git commit -m "feat($task_id): $safe_subject

Automated commit by Ralph autonomous execution loop.

Task ID: $task_id
Subject: $subject
Timestamp: $(iso_now)" || {
    log_warn "Nothing to commit"
    git checkout "${PR_BASE_BRANCH:-main}" 2>/dev/null || true
    return 0
  }
  
  # Push branch
  git push -u origin "$branch_name" 2>/dev/null || {
    log_warn "Could not push branch $branch_name"
    git checkout "${PR_BASE_BRANCH:-main}" 2>/dev/null || true
    return 1
  }
  
  # Create PR
  local pr_url
  pr_url=$(gh pr create \
    --base "${PR_BASE_BRANCH:-main}" \
    --head "$branch_name" \
    --title "feat($task_id): $safe_subject" \
    --body "## Task: $task_id

**Subject:** $subject

---

*Automated PR created by Ralph autonomous execution loop.*

### Checklist
- [ ] Code review
- [ ] Tests pass
- [ ] Ready to merge" 2>&1) || {
    log_warn "Could not create PR: $pr_url"
    git checkout "${PR_BASE_BRANCH:-main}" 2>/dev/null || true
    return 1
  }
  
  log_success "PR created: $pr_url"
  
  # Switch back to base branch
  git checkout "${PR_BASE_BRANCH:-main}" 2>/dev/null || true
  
  # Log to progress
  {
    echo "- PR: $pr_url"
  } >> "$PROGRESS_FILE"
  
  return 0
}

# Capture learnings from task execution
capture_learnings() {
  local task_id="$1"
  local subject="$2"
  local tool="$3"
  local output="$4"
  
  # Extract any learnings/notes from the output
  local learnings=""
  
  # Look for learning markers in output
  if echo "$output" | grep -q "LEARNING:\|NOTE:\|INSIGHT:\|TIP:"; then
    learnings=$(echo "$output" | grep -E "LEARNING:|NOTE:|INSIGHT:|TIP:" | head -10)
  fi
  
  # Record to learnings file
  {
    echo ""
    echo "## $(iso_now) - $task_id"
    echo ""
    echo "**Task:** $subject"
    echo ""
    echo "**Tool:** $tool"
    echo ""
    if [[ -n "$learnings" ]]; then
      echo "**Learnings:**"
      echo "$learnings"
      echo ""
    fi
    echo "**Patterns:**"
    echo "- Task type: $(echo "$subject" | grep -oE '\[[^]]*\]' | head -1 || echo 'general')"
    echo "- Completion: success"
    echo ""
    echo "---"
  } >> "$LEARNINGS_FILE"
}

# Count tasks by status
count_tasks() {
  local status="$1"
  if [[ "$USE_BEADS" == "true" ]]; then
    # Map our status to beads status
    local br_status="$status"
    case "$status" in
      pending) br_status="open" ;;
      completed) br_status="closed" ;;
      in_progress) br_status="in_progress" ;;
      failed) br_status="blocked" ;;
    esac
    br list --status "$br_status" --json 2>/dev/null | jq 'length' || echo "0"
  else
    jq --arg s "$status" '[.tasks[] | select(.status == $s)] | length' "$TASK_GRAPH"
  fi
}

# Generate prompt for AI tool
generate_prompt() {
  local task_json="$1"
  local task_id=$(echo "$task_json" | jq -r '.id')
  local subject=$(echo "$task_json" | jq -r '.subject')
  local description=$(echo "$task_json" | jq -r '.description // ""')
  local deliverable=$(echo "$task_json" | jq -r '.deliverable // ""')
  local allowed_paths=$(echo "$task_json" | jq -r '(.allowedPaths // []) | join(", ")')
  if [[ -z "$allowed_paths" ]]; then
    allowed_paths="(not specified — keep changes minimal and scoped)"
  fi
  local verification=$(echo "$task_json" | jq -r '(.verification // []) | join("\n- ")')
  if [[ -z "$verification" ]]; then
    verification="(not specified — add an appropriate verification step)"
  fi
  local setup=$(echo "$task_json" | jq -r '.setup // ""')
  local tags=$(echo "$task_json" | jq -r '(.tags // []) | join(", ")')
  
  # Commit instruction varies based on AUTO_PR setting
  local commit_instruction
  if [[ "${AUTO_PR:-true}" == "true" ]]; then
    commit_instruction="4. If all verifications pass, DO NOT commit. Leave changes uncommitted — Ralph will create a branch, commit, and open a PR automatically."
  else
    commit_instruction="4. If all verifications pass, commit your changes with message: \"feat($task_id): $subject\""
  fi
  
  cat << EOF
You are an autonomous coding agent working on task: $task_id

## Task
**$subject**

## Tags
$tags

## Description
$description

## Deliverable
$deliverable

## Allowed Paths
Only modify files in: $allowed_paths

## Setup (if needed)
$setup

## Verification / Acceptance Criteria
- $verification

## Instructions

1. Read progress.txt for context from previous iterations
2. Implement the task following the description
3. Run the verification commands to confirm success
$commit_instruction

## Critical Rules

- Only modify files in allowed paths
- Run ALL verification commands before marking complete
- If verification fails, fix the issue and retry
- If you cannot complete the task, explain why clearly

## Learnings (Optional)

If you discover something useful, output it with a marker:
- LEARNING: <what you learned>
- NOTE: <important observation>
- TIP: <helpful hint for future tasks>

## When Complete

If ALL verification commands pass:
Output exactly: <promise>TASK_COMPLETE</promise>

If you cannot complete the task:
Output exactly: <promise>TASK_FAILED</promise>
And explain why.
EOF
}

# Print status summary
print_status() {
  local completed=$(count_tasks "completed")
  local pending=$(count_tasks "pending")
  local in_progress=$(count_tasks "in_progress")
  local failed=$(count_tasks "failed")
  local total=0
  local pct=0
  local task_source="task-graph.json"
  
  if [[ "$USE_BEADS" == "true" ]]; then
    # For beads, total is sum of all statuses
    total=$((completed + pending + in_progress + failed))
    task_source="beads_rust (br)"
  else
    total=$(jq '.tasks | length' "$TASK_GRAPH" 2>/dev/null || echo "0")
  fi
  
  if [[ "$total" -gt 0 ]]; then
    pct=$((completed * 100 / total))
  fi
  
  echo ""
  echo "╔════════════════════════════════════════════════════╗"
  echo "║               RALPH STATUS                         ║"
  echo "╠════════════════════════════════════════════════════╣"
  printf "║  Completed:   %-5s   Pending:    %-5s            ║\n" "$completed" "$pending"
  printf "║  In Progress: %-5s   Failed:     %-5s            ║\n" "$in_progress" "$failed"
  printf "║  Total:       %-5s   Progress:   %3d%%             ║\n" "$total" "$pct"
  printf "║  Tool:        %-40s ║\n" "$TOOL"
  printf "║  Tasks:       %-40s ║\n" "$task_source"
  echo "╚════════════════════════════════════════════════════╝"
  echo ""
}

# Main loop
main() {
  parse_args "$@"
  check_prerequisites
  init_progress
  
  echo ""
  echo "╔════════════════════════════════════════════════════════════════╗"
  echo "║              RALPH LOOP - AUTONOMOUS EXECUTION                 ║"
  echo "║                                                                ║"
  echo "║  Based on Geoffrey Huntley's Ralph pattern                     ║"
  echo "║  Fresh context each iteration • Memory via git + progress.txt ║"
  echo "╚════════════════════════════════════════════════════════════════╝"
  echo ""
  log_info "Tool mode: $TOOL"
  if [[ "$TOOL" == "smart" ]]; then
    log_info "  Backend tasks  → $BACKEND_TOOL"
    log_info "  Frontend tasks → $FRONTEND_TOOL"
  fi
  if [[ "$USE_BEADS" == "true" ]]; then
    log_info "Task source: beads (br ready)"
  else
    log_info "Task source: $TASK_GRAPH"
  fi
  log_info "Max iterations: $MAX_ITERATIONS"
  
  print_status
  
  for ((i=1; i<=MAX_ITERATIONS; i++)); do
    echo ""
    log_info "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    log_info "ITERATION $i of $MAX_ITERATIONS"
    log_info "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    
    # SELF-HEAL: Check for stalled tasks and recover them
    if [[ "${SELF_HEAL:-true}" == "true" ]]; then
      while IFS= read -r stalled_task_id; do
        [[ -z "$stalled_task_id" ]] && continue
        if check_task_stalled "$stalled_task_id"; then
          # Get current heal attempt count
          local heal_attempt=1
          if [[ "$USE_BEADS" != "true" ]]; then
            heal_attempt=$(jq -r --arg id "$stalled_task_id" '.tasks[] | select(.id == $id) | .healAttempt // 0' "$TASK_GRAPH" 2>/dev/null || echo "0")
            heal_attempt=$((heal_attempt + 1))
          fi
          
          if [[ "$heal_attempt" -le 3 ]]; then
            handle_stalled_task "$stalled_task_id" "$heal_attempt"
          else
            log_error "Task $stalled_task_id has failed self-heal 3 times - marking as failed"
            mark_task_failed "$stalled_task_id"
            clear_task_tracking "$stalled_task_id"
          fi
        fi
      done < <(get_tracked_tasks)
    fi
    
    # Get next task
    local task_json=$(get_next_task)
    
    if [[ -z "$task_json" || "$task_json" == "null" ]]; then
      # Check if all done or all blocked
      local pending=$(count_tasks "pending")
      local completed=$(count_tasks "completed")
      
      if [[ "$pending" -eq 0 ]]; then
        echo ""
        log_success "╔════════════════════════════════════════════════════╗"
        log_success "║          🎉 ALL TASKS COMPLETED! 🎉                ║"
        log_success "╚════════════════════════════════════════════════════╝"
        print_status
        
        # Run Devin Review if enabled
        if [[ "${DEVIN_REVIEW:-true}" == "true" ]]; then
          echo ""
          log_info "Running Devin AI code review..."
          echo ""
          
          # Prefer CLI (npx devin-review) over web
          if command -v npx &> /dev/null; then
            log_info "Using Devin CLI (npx devin-review)..."
            set +e
            npx devin-review 2>&1 | head -50
            set -e
            echo ""
            log_success "Devin CLI review started. Check browser for results."
          else
            # Fallback to web
            local pr_number=""
            if command -v gh &> /dev/null; then
              pr_number=$(gh pr view --json number -q .number 2>/dev/null || echo "")
            fi
            
            if [[ -n "$pr_number" ]]; then
              local repo_info=$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || echo "")
              if [[ -n "$repo_info" ]]; then
                local devin_url="https://devin.ai/${repo_info}/pull/${pr_number}"
                log_info "Opening Devin Review: $devin_url"
                
                if command -v open &> /dev/null; then
                  open "$devin_url"
                elif command -v xdg-open &> /dev/null; then
                  xdg-open "$devin_url"
                fi
              fi
            fi
          fi
          
          echo ""
          echo "═══════════════════════════════════════════════════════════════"
          echo "  Fix any SEVERE bugs before merging."
          echo "  Run: ./scripts/devin_review.sh for detailed review."
          echo "═══════════════════════════════════════════════════════════════"
        fi
        
        echo "<promise>COMPLETE</promise>"
        exit 0
      else
        log_warn "All remaining tasks are blocked. Check dependencies."
        print_status
        exit 1
      fi
    fi
    
    local task_id=$(echo "$task_json" | jq -r '.id')
    local subject=$(echo "$task_json" | jq -r '.subject')
    local tags=$(echo "$task_json" | jq -r '(.tags // []) | join(", ")')
    
    log_info "Task: $task_id"
    log_info "Subject: $subject"
    log_info "Tags: $tags"
    
    # Determine which tool to use
    local selected_tool=$(get_tool_for_task "$task_json")
    
    # Mark as in progress and record start time for stall detection
    mark_task_in_progress "$task_id"
    record_task_start "$task_id"
    
    # Generate prompt
    local prompt=$(generate_prompt "$task_json")
    
    # Save prompt for debugging
    echo "$prompt" > "/tmp/ralph-prompt-$task_id.md"
    
    # Run with selected tool
    log_info "Spawning $selected_tool instance..."
    
    set +e
    OUTPUT=$(run_with_tool "$selected_tool" "$prompt")
    set -e
    
    # Check for completion signal
    if echo "$OUTPUT" | grep -q "<promise>TASK_COMPLETE</promise>"; then
      mark_task_completed "$task_id"
      
      # Clear stall tracking
      clear_task_tracking "$task_id"
      
      # Log to progress
      {
        echo ""
        echo "### Iteration $i - $(iso_now)"
        echo "- Task: $task_id - $subject"
        echo "- Tool: $selected_tool"
        echo "- Status: ✅ COMPLETED"
      } >> "$PROGRESS_FILE"
      
      log_success "Task completed!"
      
      # Capture learnings from task execution
      capture_learnings "$task_id" "$subject" "$selected_tool" "$OUTPUT"
      
      # FRESH EYES REVIEW (if enabled)
      # Per Doodlestein methodology: review code after each task until no bugs found
      if [[ "${FRESH_EYES:-false}" == "true" ]]; then
        log_info "Running fresh eyes code review..."
        run_fresh_eyes_review "$selected_tool"
      fi
      
      # AUTO-PR: Create PR for completed task
      if [[ "${AUTO_PR:-true}" == "true" ]]; then
        create_auto_pr "$task_id" "$subject"
      fi
      
    elif echo "$OUTPUT" | grep -q "<promise>TASK_FAILED</promise>"; then
      mark_task_failed "$task_id"
      
      # Clear stall tracking (task is no longer in-progress)
      clear_task_tracking "$task_id"
      
      # Log to progress
      {
        echo ""
        echo "### Iteration $i - $(iso_now)"
        echo "- Task: $task_id - $subject"
        echo "- Tool: $selected_tool"
        echo "- Status: ❌ FAILED"
      } >> "$PROGRESS_FILE"
      
      log_error "Task failed. See output above for details."
      
    else
      # No clear signal - assume incomplete, retry next iteration
      log_warn "No completion signal. Will retry if iterations remain."
      
      # Clear stall tracking (we're reverting status to pending/open)
      clear_task_tracking "$task_id"
      
      # Reset to pending/open for retry
      if [[ "$USE_BEADS" == "true" ]]; then
        br update "$task_id" --status open 2>/dev/null || true
      else
        local tmp=$(mktemp)
        jq --arg id "$task_id" '
          .tasks = [.tasks[] | if .id == $id then .status = "pending" else . end]
        ' "$TASK_GRAPH" > "$tmp" && mv "$tmp" "$TASK_GRAPH"
      fi
    fi
    
    print_status
    
    # Brief pause between iterations
    sleep 2
  done
  
  echo ""
  log_warn "Max iterations ($MAX_ITERATIONS) reached."
  print_status
  exit 1
}

main "$@"
