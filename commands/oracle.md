# /oracle — Run Browser Oracle (GPT-5.2 Pro Review)

## Rule
Oracle runs are ALWAYS executed manually by the human in a terminal.
Claude Code prints the command; the human runs it.

## Critical: Multiple Passes Required

**Oracle reviews should be run multiple times until issues stabilize.** The Doodlestein methodology shows that:
- First pass catches obvious issues
- Second pass catches issues introduced by fixes
- Third pass verifies stability (ideally 0 new issues)

**Convergence rule:** Keep running until `new_issues == 0` or `iterations >= 3`.

## Syntax
```
/oracle <kind>
```

Where `<kind>` is one of: `prd`, `ux`, `plan`, `code`

## Determine kind
If user wrote `/oracle prd|ux|plan|code`, use that kind.
Otherwise, ask which kind:

> Which artifact do you want to review?
> - `prd` — Review requirements (artifacts/01-prd.md)
> - `ux` — Review UX spec (artifacts/02-ux.md)
> - `plan` — Review implementation plan (artifacts/03-plan.md)
> - `code` — Review code changes (git diff or specific files)

## File sets by kind

| Kind | Primary File | Context Files |
|------|--------------|---------------|
| prd | artifacts/01-prd.md | artifacts/00-brief.md |
| ux | artifacts/02-ux.md | artifacts/01-prd.md |
| plan | artifacts/03-plan.md | artifacts/01-prd.md, artifacts/02-ux.md |
| code | (git diff or specified files) | artifacts/03-plan.md |

## Manual CLI command

### Full lens pack (recommended)
Print this command for the human to run:

```bash
./scripts/oracle_lens_pack.sh <kind> <files...>
```

Example for PRD:
```bash
./scripts/oracle_lens_pack.sh prd artifacts/01-prd.md artifacts/00-brief.md
```

Example for PLAN:
```bash
./scripts/oracle_lens_pack.sh plan artifacts/03-plan.md artifacts/01-prd.md artifacts/02-ux.md
```

Example for CODE:
```bash
# Review specific files
./scripts/oracle_lens_pack.sh code src/index.ts src/utils.ts

# Review changed files (generate list from git)
./scripts/oracle_lens_pack.sh code $(git diff --name-only HEAD~1)
```

### Single lens (optional)
If user wants a specific lens only:
```bash
./scripts/oracle_single_lens.sh <kind> <lens> <files...>
```

Example:
```bash
./scripts/oracle_single_lens.sh plan security artifacts/03-plan.md
```

## After the human runs it

### 1. Confirm output exists
Check for:
```
artifacts/06-oracle/<kind>/issues.json
```

### 2. Read and summarize issues
```bash
cat artifacts/06-oracle/<kind>/issues.json | jq '.issues | length'
```

Report:
- Total issues found
- Breakdown by severity (blocker, major, minor, nit)
- Breakdown by category (product, ux, arch, security, perf, tests, simplicity, ops)

### 3. Apply changes

**For PRD/UX/PLAN kinds:**
- Update the artifact directly based on issues
- Mark issues as addressed
- If blockers exist, fix them before proceeding

**For CODE kind:**
- Create tasks for each issue
- Or patch code directly if simple

### 4. MANDATORY: Re-run until convergence

After fixing issues, ALWAYS re-run Oracle:

```
╔═══════════════════════════════════════════════════════════════╗
║                    ORACLE CONVERGENCE                         ║
╠═══════════════════════════════════════════════════════════════╣
║  Pass 1: Found 8 issues → Fixed → Re-run                      ║
║  Pass 2: Found 3 issues → Fixed → Re-run                      ║
║  Pass 3: Found 0 issues → CONVERGED ✓                         ║
╚═══════════════════════════════════════════════════════════════╝
```

> I've addressed N issues. Running `/oracle <kind>` again to verify...
>
> If new issues found: repeat the cycle
> If no new issues: "Oracle review converged. Safe to proceed."

**Do NOT proceed to next phase until Oracle converges (0 new blockers/majors).**

## Fallback (if automation fails)

If the browser automation fails, instruct the human to use manual paste mode:

```bash
npx -y @steipete/oracle --render --copy \
  --engine browser \
  --browser-model-strategy current \
  --browser-thinking-time heavy \
  --prompt "$(cat prompts/<kind>/<lens>.txt)" \
  --file "<files...>"
```

Then:
1. Paste the rendered bundle into ChatGPT (set to GPT-5.2 Pro)
2. Copy the response
3. Save to: `artifacts/06-oracle/<kind>/<timestamp>_<lens>.md`
4. Run normalizer:
```bash
node scripts/normalize_oracle_output.js artifacts/06-oracle/<kind> artifacts/06-oracle/<kind>/issues.json
```

## Important notes

- **Browser mode only**: Oracle runs use your ChatGPT session, not API
- **Model must be GPT-5.2 Pro**: Remind user to check their ChatGPT model setting
- **8 lenses run sequentially**: The full pack takes ~5-10 minutes
- **Output is normalized**: Raw markdown → structured issues.json
- **Multiple passes are MANDATORY**: Run until convergence

## Do NOT
- Run Oracle via API mode (expensive, not the workflow)
- Skip waiting for output (the workflow depends on issues.json)
- Proceed to next phase if blockers exist
- Proceed after only ONE Oracle pass (must converge)
