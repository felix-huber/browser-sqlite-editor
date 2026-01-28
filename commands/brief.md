# /brief — Create or refine the BRIEF (artifact 00)

## Goal
Create `artifacts/00-brief.md` as the seed document for this project.

## Prerequisites
None — this is the starting point.

## Steps

### 1. Scaffold check
If `artifacts/` directory doesn't exist:
```bash
mkdir -p artifacts/05-design/variants
mkdir -p artifacts/06-oracle/prd artifacts/06-oracle/ux artifacts/06-oracle/plan artifacts/06-oracle/code
```

### 2. Template check
If `artifacts/00-brief.md` doesn't exist, create it from template:

```markdown
# 00 — BRIEF

## One-liner
(What are we building in one sentence?)

## Target users
- Primary: …
- Secondary: …

## Problem / pain
(What specific pain does this solve? Be concrete.)

## Must-haves (v1)
- [ ] …
- [ ] …
- [ ] …

## Non-goals (v1)
- …
- …

## Constraints
- **Tech constraints**: …
- **Time constraints**: …
- **Legal/privacy/security**: …

## Success metrics
- **Leading indicators**: …
- **Lagging indicators**: …

## Notes / unknowns
- …

## References
- …
```

### 3. Interactive refinement
Help the user fill in each section:
- Ask clarifying questions
- Suggest concrete examples
- Push back on vague descriptions
- Ensure must-haves are measurable

### 4. Save
Write the completed brief to `artifacts/00-brief.md`.

## Do NOT
- Run Oracle at this stage (too early)
- Create tasks yet
- Generate PRD yet

## Next step
Tell user: "Brief complete. Run `/prd` to generate the PRD."
