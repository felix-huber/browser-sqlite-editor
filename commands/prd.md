# /prd — Generate the PRD (artifact 01)

## Goal
Generate `artifacts/01-prd.md` from the brief.

## Prerequisites
- `artifacts/00-brief.md` must exist

## Inputs
- `artifacts/00-brief.md`

## Output
- `artifacts/01-prd.md`

## Steps

### 1. Validate prerequisites
```bash
if [ ! -f artifacts/00-brief.md ]; then
  echo "Missing brief. Run /brief first."
  exit 1
fi
```

### 2. Read the brief
Load `artifacts/00-brief.md` and extract:
- One-liner
- Target users
- Must-haves
- Constraints

### 3. Generate PRD
Create `artifacts/01-prd.md` with this structure:

```markdown
# 01 — PRD (Product Requirements)

## Summary
- **What we are building**: (from one-liner)
- **Why now**: (from problem/pain)

## Goals
- …

## Non-goals
- …

## Users & Jobs-to-be-Done
### Persona A: (from target users)
- Job: …
- Pain: …
- Desired outcome: …

### Persona B: …

## User Stories (with Acceptance Criteria)

### Story 1: [User action]
As a [persona], I want to [action] so that [outcome].

**Acceptance Criteria**
- [ ] Given [context], when [action], then [result]
- [ ] Given [context], when [action], then [result]

**Edge Cases**
- What if [condition]? → [behavior]

### Story 2: …

## Functional Requirements
- FR1: …
- FR2: …

## UX Requirements (High Level)
- **Key screens**: …
- **Key flows**: …
- **Error states**: Must be explicit for every action.

## Data & Persistence
- What data is stored?
- Where? (local, server, both)
- Schema considerations?

## Security / Privacy
- Authentication requirements
- Authorization model
- Data sensitivity

## Observability
- **Events**: …
- **Metrics**: …
- **Logs**: …

## Rollout / Compatibility
- Feature flags needed?
- Migration plan?
- Backwards compatibility?

## Out of Scope
- …

## Open Questions
- …
```

### 4. Ensure quality
For each user story:
- Acceptance criteria are testable
- Edge cases are explicit
- No vague language ("should work", "handles errors")

### 5. Save
Write to `artifacts/01-prd.md`.

## Next step
Tell user: "PRD generated. Run `/oracle prd` to review with GPT-5.2 Pro."
