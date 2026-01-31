# Blocked Beads Fix Plan

## Overview
17 beads blocked after strict_ralph run. This document outlines the multi-model fix strategy.

## Categories

### Category A: Simple Integration Fixes (Wire existing code)
These have code written but not connected to the application flow.

| Bead ID | Title | Issue | Fix Strategy |
|---------|-------|-------|--------------|
| bd-2eq | PRAGMA journal_mode=DELETE | `openDatabase()` in sqlite-engine.ts not called by registry.ts | Replace `engine.open()` with `openDatabase()` in handlers |
| bd-39f | Post-rebuild verification | Verification code exists but never executed | Wire verification call after rebuild operations |
| bd-po6 | Shared DDL diff preview | Component created but not used | Import and use shared component in consumers |
| bd-3ge | Shared SQL generation helpers | NULL handling missing, generateAlias unused | Wire helpers to actual SQL generation paths |

**Model Assignment:** Claude (direct implementation with precise instructions)

### Category B: Test Quality Fixes (Rewrite to test behavior)
Tests exist but don't actually validate the behavior.

| Bead ID | Title | Issue | Fix Strategy |
|---------|-------|-------|--------------|
| bd-b05 | Perf/memory regression harness | Tests bypass actual app import/export | Rewrite to use real import/export paths |
| bd-rqg | ERD draft state tracking | Tests are non-behavioral | Rewrite to test actual dirty state behavior |

**Model Assignment:** Claude with fresh-eyes review

### Category C: Complex Architectural (Need deep analysis)
Require understanding of architectural patterns before fixing.

| Bead ID | Title | Issue | Fix Strategy |
|---------|-------|-------|--------------|
| bd-149 | Virtual scrolling grid | Complex UI virtualization | Oracle analysis → Claude implementation |
| bd-qdl | FK creation validation | 3 failed attempts | Oracle deep dive on validation logic |
| bd-2c2 | Transaction edge case handling | UI wiring missing | Analyze transaction flow, then wire |

**Model Assignment:** Oracle (GPT-5.2) for analysis → Claude for implementation

### Category D: E2E/Coverage (Write missing tests)
Need to create E2E tests that validate the feature.

| Bead ID | Title | Issue | Fix Strategy |
|---------|-------|-------|--------------|
| bd-3l1 | E2E coverage audit | Missing E2E tests | Create comprehensive E2E test suite |
| bd-1fx | Offline guarantee verification | No offline E2E | Write offline workflow E2E test |
| bd-hws | CSP implementation | Mixed changes, needs clean impl | Clean CSP implementation with E2E |
| bd-3lz | Single-writer lock | Missing cross-tab E2E | Write multi-tab lock E2E |
| bd-3t7 | Size warnings | OPFS mode not tested | Write OPFS-specific E2E |

**Model Assignment:** Claude with E2E focus

### Category E: Edge Cases/Quota Handling
Specific edge case implementations.

| Bead ID | Title | Issue | Fix Strategy |
|---------|-------|-------|--------------|
| bd-6sr | JSON import flat-only | Enforcement not wired | Wire flat-only check |
| bd-4z7 | Database export quota-exceeded | Quota handling missing | Implement quota error handling |
| bd-22t | sqlite3_stmt_readonly check | Check not implemented | Add readonly statement check |

**Model Assignment:** Claude (focused implementation)

## Execution Order

### Phase 1: Quick Wins (Category A - Integration)
1. bd-2eq: PRAGMA wiring
2. bd-39f: Verification wiring
3. bd-3ge: SQL helper wiring

### Phase 2: Test Rewrites (Category B)
4. bd-b05: Perf harness fix
5. bd-rqg: ERD dirty state tests

### Phase 3: Complex with Oracle (Category C)
6. bd-149: Virtual scrolling (needs Oracle)
7. bd-qdl: FK validation (needs Oracle)
8. bd-2c2: Transaction wiring

### Phase 4: E2E Creation (Category D)
9. bd-3l1: E2E audit (unlocks 13 beads)
10. bd-hws: CSP with E2E
11. bd-1fx: Offline E2E

### Phase 5: Edge Cases (Category E)
12. bd-6sr, bd-4z7, bd-22t

## Multi-Model Workflow

```
For each bead:
1. GATHER: Task description + existing code + previous review feedback
2. ANALYZE: Send to appropriate model based on category
3. FIX: Implement with precise instructions
4. VALIDATE: Run through strict_ralph review
5. ITERATE: If fails, escalate to next model (Claude → Oracle)
```

## Status Tracking
- [ ] Phase 1 started
- [ ] Phase 2 started
- [ ] Phase 3 started
- [ ] Phase 4 started
- [ ] Phase 5 started
