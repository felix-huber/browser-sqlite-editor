#!/usr/bin/env node
/**
 * Swarm Status Reporter
 * Reports on Claude Code teams, teammates, and task progress.
 *
 * Usage:
 *   node scripts/swarm_status.js
 *   node scripts/swarm_status.js --team <team-name>
 *   node scripts/swarm_status.js --verbose
 */
const fs = require("fs");
const path = require("path");
const os = require("os");

// Claude Code paths
const CLAUDE_DIR = path.join(os.homedir(), ".claude");
const TEAMS_DIR = path.join(CLAUDE_DIR, "teams");
const TASKS_DIR = path.join(CLAUDE_DIR, "tasks");

function arg(name) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return null;
  const val = process.argv[idx + 1];
  // Don't treat the next flag as a value
  if (!val || val.startsWith("-")) return null;
  return val;
}

function flag(name) {
  return process.argv.includes(name);
}

function readJsonSafe(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function getTeams() {
  if (!fs.existsSync(TEAMS_DIR)) return [];
  
  return fs.readdirSync(TEAMS_DIR)
    .filter(d => {
      const configPath = path.join(TEAMS_DIR, d, "config.json");
      return fs.existsSync(configPath);
    })
    .map(d => {
      const config = readJsonSafe(path.join(TEAMS_DIR, d, "config.json"));
      return { name: d, config };
    })
    .filter(t => t.config);
}

function getTeamTasks(teamName) {
  const taskDir = path.join(TASKS_DIR, teamName);
  if (!fs.existsSync(taskDir)) return [];
  
  return fs.readdirSync(taskDir)
    .filter(f => f.endsWith(".json"))
    .map(f => {
      const task = readJsonSafe(path.join(taskDir, f));
      return task;
    })
    .filter(Boolean)
    .sort((a, b) => {
      // Handle numeric and string IDs
      const idA = Number(a.id);
      const idB = Number(b.id);
      if (Number.isFinite(idA) && Number.isFinite(idB)) return idA - idB;
      return String(a.id ?? "").localeCompare(String(b.id ?? ""));
    });
}

function getInboxMessages(teamName, agentName) {
  const inboxPath = path.join(TEAMS_DIR, teamName, "inboxes", `${agentName}.json`);
  if (!fs.existsSync(inboxPath)) return [];
  
  const inbox = readJsonSafe(inboxPath);
  return Array.isArray(inbox) ? inbox : [];
}

function formatDuration(ms) {
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3600000) return `${Math.round(ms / 60000)}m`;
  return `${Math.round(ms / 3600000)}h`;
}

function statusIcon(status) {
  switch (status) {
    case "completed": return "✅";
    case "in_progress": return "🔄";
    case "pending": return "⏳";
    case "blocked": return "🚫";
    case "failed": return "❌";
    default: return "❓";
  }
}

function printTeamStatus(team, verbose = false) {
  const { name, config } = team;
  const members = config.members || [];
  const tasks = getTeamTasks(name);
  
  console.log("");
  console.log(`╔${"═".repeat(60)}╗`);
  console.log(`║ Team: ${name.padEnd(52)} ║`);
  console.log(`╠${"═".repeat(60)}╣`);
  
  // Members
  console.log(`║ Members: ${members.length.toString().padEnd(50)} ║`);
  for (const member of members) {
    const isLeader = member.agentId === config.leadAgentId;
    const role = isLeader ? "(leader)" : "";
    const color = member.color ? `[${member.color}]` : "";
    console.log(`║   ${isLeader ? "👑" : "👤"} ${member.name} ${role} ${color}`.padEnd(61) + "║");
    
    if (verbose) {
      const messages = getInboxMessages(name, member.name);
      if (messages.length > 0) {
        const last = messages[messages.length - 1];
        const ts = last?.timestamp ?? last?.createdAt ?? last?.ts;
        if (typeof ts === "number") {
          console.log(`║      Last message: ${formatDuration(Date.now() - ts)} ago`.padEnd(61) + "║");
        }
      }
    }
  }
  
  // Task summary - handle both explicit "blocked" status and inferred blocked
  const byStatus = {
    completed: tasks.filter(t => t.status === "completed"),
    in_progress: tasks.filter(t => t.status === "in_progress"),
    blocked: tasks.filter(t => t.status === "blocked" || (t.status === "pending" && (t.blockedBy?.length ?? 0) > 0)),
    pending: tasks.filter(t => t.status === "pending" && !(t.blockedBy?.length ?? 0)),
    failed: tasks.filter(t => t.status === "failed")
  };
  
  console.log(`╠${"═".repeat(60)}╣`);
  console.log(`║ Tasks: ${tasks.length} total`.padEnd(61) + "║");
  console.log(`║   ✅ Completed:   ${byStatus.completed.length}`.padEnd(61) + "║");
  console.log(`║   🔄 In Progress: ${byStatus.in_progress.length}`.padEnd(61) + "║");
  console.log(`║   ⏳ Pending:     ${byStatus.pending.length}`.padEnd(61) + "║");
  console.log(`║   🚫 Blocked:     ${byStatus.blocked.length}`.padEnd(61) + "║");
  console.log(`║   ❌ Failed:      ${byStatus.failed.length}`.padEnd(61) + "║");
  
  // Progress bar
  const pct = tasks.length > 0 ? Math.round((byStatus.completed.length / tasks.length) * 100) : 0;
  const filled = Math.round(pct / 5);
  const bar = "█".repeat(filled) + "░".repeat(20 - filled);
  console.log(`║                                                            ║`);
  console.log(`║ Progress: [${bar}] ${pct}%`.padEnd(61) + "║");
  
  // Blocked tasks detail
  if (byStatus.blocked.length > 0) {
    console.log(`╠${"═".repeat(60)}╣`);
    console.log(`║ Blocked Tasks:`.padEnd(61) + "║");
    for (const task of byStatus.blocked.slice(0, 5)) {
      const blockers = task.blockedBy?.join(", ") || "unknown";
      console.log(`║   #${task.id} "${task.subject?.slice(0, 30)}..."`.padEnd(61) + "║");
      console.log(`║      → blocked by: ${blockers}`.padEnd(61) + "║");
    }
    if (byStatus.blocked.length > 5) {
      console.log(`║   ... and ${byStatus.blocked.length - 5} more`.padEnd(61) + "║");
    }
  }
  
  // In progress detail (verbose)
  if (verbose && byStatus.in_progress.length > 0) {
    console.log(`╠${"═".repeat(60)}╣`);
    console.log(`║ In Progress:`.padEnd(61) + "║");
    for (const task of byStatus.in_progress) {
      const owner = task.owner || "unassigned";
      const duration = task.startedAt ? formatDuration(Date.now() - task.startedAt) : "?";
      console.log(`║   #${task.id} "${task.subject?.slice(0, 25)}..."`.padEnd(61) + "║");
      console.log(`║      owner: ${owner}, duration: ${duration}`.padEnd(61) + "║");
    }
  }
  
  // Warnings
  const warnings = [];
  
  // Check for stuck tasks (in_progress > 30min)
  for (const task of byStatus.in_progress) {
    if (task.startedAt && Date.now() - task.startedAt > 30 * 60 * 1000) {
      warnings.push(`Task #${task.id} has been in_progress for ${formatDuration(Date.now() - task.startedAt)}`);
    }
  }
  
  // Check for unassigned ready tasks
  const unassigned = byStatus.pending.filter(t => !t.owner);
  if (unassigned.length > 0) {
    warnings.push(`${unassigned.length} pending tasks have no owner`);
  }
  
  if (warnings.length > 0) {
    console.log(`╠${"═".repeat(60)}╣`);
    console.log(`║ ⚠️  Warnings:`.padEnd(61) + "║");
    for (const w of warnings) {
      console.log(`║   - ${w}`.padEnd(61) + "║");
    }
  }
  
  console.log(`╚${"═".repeat(60)}╝`);
}

function main() {
  const specificTeam = arg("--team") || arg("-t");
  const verbose = flag("--verbose") || flag("-v");
  
  console.log("╔═══════════════════════════════════════════════════════════════╗");
  console.log("║                       SWARM STATUS                            ║");
  console.log("╚═══════════════════════════════════════════════════════════════╝");
  
  const teams = getTeams();
  
  if (teams.length === 0) {
    console.log("");
    console.log("No teams found.");
    console.log(`Teams directory: ${TEAMS_DIR}`);
    console.log("");
    console.log("To create a team, use Claude Code's TeammateTool:");
    console.log('  TeammateTool spawnTeam { team_name: "my-project", description: "..." }');
    return;
  }
  
  console.log(`Found ${teams.length} team(s)`);
  
  if (specificTeam) {
    const team = teams.find(t => t.name === specificTeam);
    if (!team) {
      console.log(`Team not found: ${specificTeam}`);
      console.log(`Available teams: ${teams.map(t => t.name).join(", ")}`);
      return;
    }
    printTeamStatus(team, verbose);
  } else {
    for (const team of teams) {
      printTeamStatus(team, verbose);
    }
  }
}

main();
