# Master Tracker

> **Purpose:** Single-page progress overview across all branches/phases.
> Each phase has its own table to minimize merge conflicts when parallel branches update different sections.

---

## My Open Items

| Item | Status | Notes |
|------|--------|-------|
| Upload updated MASTER_DESIGN_DOCUMENT to repo | ⚪ Not Started | New collaborator changes; replace current MDD |
| Provide updated Area 4.4 metrics | ⚪ Not Started | Needed before branching out work |
| Upload prioritizr .zip (solutions + metrics) | ⚪ Not Started | Actual run output for loading solutions & calculating metrics |
| Discuss branch breakdown with AI | ⚪ Not Started | Blocked until MDD + metrics are provided |

---

## Phase: Foundation

> Scaffolding, project structure, shared utilities — must complete before parallel branches begin.

| Branch Doc | Planning | Design | Implementation | Notes |
|------------|----------|--------|----------------|-------|
| `docs/branches/foundation.md` | 0/0 | 0/0 | 0/0 | Not yet created — awaiting MDD update |

---

## Phase: TBD — Parallel Branches

> Branches below will be defined once MDD is updated and branch breakdown is discussed.
> Each row = one branch that can run as an independent Cursor window / Git branch.

| Branch Doc | Planning | Design | Implementation | Notes |
|------------|----------|--------|----------------|-------|
| *(to be defined)* | — | — | — | Awaiting branch breakdown discussion |

---

## How This File Works

- **One table per phase.** Branches within a phase share a table. Different phases = different tables = no merge conflicts across phases.
- **Counts format:** `completed/total` (e.g., `3/5` means 3 of 5 tasks done).
- **Branch Doc** links to the full task file in `docs/branches/`.
- **Design decisions** for each branch live in `docs/design-decisions/branch-{name}/`.
- Planning tasks produce design-decision docs; those docs then refine implementation task details.

---

*Last updated: March 3, 2026*
