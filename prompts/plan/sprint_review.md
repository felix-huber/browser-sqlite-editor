# Sprint Review Prompt (Subagent Pattern)

Use this prompt to critically review a sprint plan before Oracle convergence.

---

## How to Use

### Option 1: Plan() Subagent (Recommended)

In Claude Code, use the Plan() tool:

```
Plan(Review sprint breakdown against quality criteria)
```

Then provide the sprint plan from `artifacts/03-plan.md`.

### Option 2: Fresh Claude Instance

Paste the review prompt below to a fresh Claude instance along with your sprint plan.

### Option 3: Opus Deep Review

For thorough review, paste to Claude Opus with extended thinking enabled.

---

## The Review Prompt

```
You are reviewing a sprint breakdown for a software project. Be critical and thorough.

## Quality Criteria

1. **Atomic Tasks**: Is every task an atomic, committable piece of work?
   - Should be completable in 1-4 hours
   - Should have clear verification (test, command, or observable result)
   - Should not require "and then also do X"

2. **Demoable Sprints**: Does every sprint result in demoable software?
   - Can you show something working after each sprint?
   - Is there visible progress, not just invisible infrastructure?
   - Can stakeholders verify the sprint is "done"?

3. **Architectural Timing**: Are foundational concerns addressed early?
   - Multi-tab/multi-process coordination → Sprint 2-3, not Sprint 12
   - Persistence layer decisions → Sprint 1-2
   - State management architecture → Sprint 1-2
   - Error handling patterns → Sprint 1-2

4. **Testing Strategy**: Is testing integrated, not deferred?
   - E2E test framework setup → Sprint 1
   - Tests written PER-SPRINT, not in a final "testing sprint"
   - Each task includes its verification method

5. **Sprint Focus**: Is each sprint focused on a single concern?
   - Bad: "Multi-Tab + Settings + Unsaved Prompt" (3 unrelated things)
   - Good: "Multi-Tab Coordination" (one focused goal)

6. **Completeness**: Are there missing tasks?
   - BLOB/binary data handling
   - Autocomplete/intellisense
   - JSON import (not just CSV)
   - Error states and edge cases
   - Loading states and skeletons
   - Keyboard shortcuts
   - Accessibility (a11y)

7. **Dependencies**: Are dependencies correct and minimal?
   - Would a task fail if its listed dependencies aren't done?
   - Are there unnecessary dependencies creating bottlenecks?
   - Can tasks be parallelized?

8. **Early Demo Risk**: Are Sprint 1-2 demoable?
   - Sprint 1 should have SOMETHING visible (even just a styled shell)
   - Invisible infrastructure = stakeholder anxiety
   - "Build runs, empty shell renders" is borderline acceptable

## Output Format

For each issue found, provide:

```
### Issue: [Title]

**Sprint/Task**: S[N]-T[M] or Sprint [N]
**Problem**: [What's wrong]
**Impact**: [Why it matters]
**Fix**: [Specific suggestion]
```

At the end, summarize:
- Critical issues (must fix)
- Important issues (should fix)
- Minor issues (nice to fix)
- What's done well (positive feedback)
```

---

## After Review

Apply the suggested improvements to `artifacts/03-plan.md`:

1. Move architectural tasks earlier
2. Add E2E setup to Sprint 1
3. Ensure Sprint 1-2 have visible demos
4. Split mixed-concern sprints
5. Add missing tasks with proper IDs
6. Fix dependency chains

**Iterate until the review finds no critical or important issues.**

Then proceed to Oracle convergence (`./scripts/oracle_converge.sh plan ...`).

---

## Example Issues This Catches

| Issue | Before | After |
|-------|--------|-------|
| Multi-tab too late | Sprint 12: Multi-Tab | Sprint 2-3: Persistence + Locking Architecture |
| E2E deferred | Sprint 14: E2E Tests | Sprint 1: E2E Setup, then per-sprint tests |
| Non-demoable sprint | Sprint 1: "Build runs" | Sprint 1: "Styled shell with placeholder UI" |
| Mixed concerns | Sprint 12: Locking + Settings | Sprint 12: Locking only, Sprint 13: Settings |
| Missing task | No BLOB handling | Sprint 6: BLOB cell renderer and editor |
