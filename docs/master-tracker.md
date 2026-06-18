# Master Tracker

> **Purpose:** Single-page progress overview across all branches/phases.
> Each phase has its own table to minimize merge conflicts when parallel branches update different sections.

---

## My Open Items

| Item | Status | Notes |
|------|--------|-------|
| Upload updated MASTER_DESIGN_DOCUMENT to repo | 🟢 Done | Synced with Master Design Document (1).md; CSV as metrics source of truth. Ready for commit. |
| Provide updated Area 4.4 metrics | 🟢 Done | DISES Metrics - Finalized Metrics.csv (49 metrics) is source of truth; master doc aligned. |
| Upload prioritizr .zip (solutions + metrics) | ⚪ Not Started | Actual run output for loading solutions & calculating metrics |
| Discuss branch breakdown with AI | 🟢 Done | Pane-per-branch architecture with merge checkpoints |
| Create branch task trackers | 🟢 Done | 4 docs in `docs/branches/` |

---

## Working Pattern: Merge Checkpoints

All parallel branches are synchronized around **4 merge checkpoints**. At each checkpoint:

1. All three branches open PRs to `main`
2. Merge in sequence (conflicts should be near-zero due to file separation)
3. **Integration test:** verify cross-pane interactions work (signal wiring, data flow)
4. Fix integration issues (use `*-FIX-*` rows in branch docs)
5. Add any new signals to `AppStateService` if discovered during integration
6. Tag release (`v0.1`, `v0.2`, etc.)
7. Each branch rebases from `main` and begins next checkpoint

| Checkpoint | Name | Theme | Integration Test |
|------------|------|-------|-----------------|
| **CP1** | Skeleton | Empty panes render, panel switching works, basemap shows | Click left sidebar button → right panel changes mode |
| **CP2** | Solution Flow | Solution Finder → match → load on map → show metrics | Full discovery workflow with mock data |
| **CP3** | Regional Analysis | Click map → AOI Dashboard populates, layers toggle | Click department → see 35 metrics in sidebar |
| **CP4** | Comparison & Polish | Side-by-side, solution comparison, exports, demo-ready | Full demo flow in Spanish for Mesa Nacional |

### Checkpoint Alignment (which tasks merge together)

| Checkpoint | Branch 1 (Map) | Branch 2 (Controls) | Branch 3 (Analysis) |
|------------|----------------|---------------------|---------------------|
| **CP1** | MAP-01 to MAP-03 | SOL-01 to SOL-03 | ANL-01 to ANL-02 |
| **CP2** | MAP-05 to MAP-07 | SOL-05 to SOL-10 | ANL-04 to ANL-09 |
| **CP3** | MAP-09 to MAP-12 | SOL-12 to SOL-14 | ANL-11 to ANL-18 |
| **CP4** | MAP-14 to MAP-17 | SOL-16 to SOL-19 | ANL-20 to ANL-22 |

---

## Working Pattern: Idle Windows

When a branch finishes its checkpoint tasks before the others, use the idle Cursor window for (in priority order):

1. **Stretch tasks** (🔶) within the same checkpoint — labeled in each branch doc
2. **Design tasks** for the NEXT checkpoint — these produce `.md` files, not code, so there's no conflict risk and no waiting for Cursor to generate. You're thinking + writing.
3. **Overflow Pool** tasks (see below) — quality/infrastructure work any window can do
4. **Review + manual testing** of already-completed work

> **Key insight:** Design tasks ([Design] prefix) don't require Cursor to generate code. When Window 1 finishes coding and Windows 2/3 are still generating, use Window 1 to do design/planning work for future checkpoints. You're always either coding or planning ahead.

---

## Phase: Foundation

> Scaffolding, project structure, shared utilities — must complete before parallel branches begin.

| Branch Doc | Tasks | Status | Notes |
|------------|-------|--------|-------|
| [`docs/branches/foundation.md`](./branches/foundation.md) | 0/11 | ⚪ Not Started | Sequential. ~3-5 days. |

---

## Phase: Parallel Development

> Three branches, one per UI pane. Synchronized via merge checkpoints.
> Each branch = one Cursor window = one Git branch.

| Branch Doc | CP1 | CP2 | CP3 | CP4 | Notes |
|------------|-----|-----|-----|-----|-------|
| [`map-spatial.md`](./branches/map-spatial.md) | 0/3 | 0/3 | 0/4 | 0/4 | Center panel — ArcGIS map |
| [`solution-controls.md`](./branches/solution-controls.md) | 0/3 | 0/6 | 0/3 | 0/4 | Left sidebar + modals |
| [`analysis-dashboards.md`](./branches/analysis-dashboards.md) | 0/2 | 0/6 | 0/7 | 0/3 | Right sidebar — metrics |

---

## Overflow Pool

> Shared tasks for idle windows. Any branch/window can pick these up. They live in their own files/folders and don't conflict with branch work.

| ID | Status | Last Updated | Task Description | Notes |
|----|--------|-------------|------------------|-------|
| OVF-01 | ⚪ Not Started | — | Unit tests for shared UI primitives (stat-card, progress-bar, etc.) | `core/shared/**/*.spec.ts` |
| OVF-02 | ⚪ Not Started | — | i18n string completion — audit all visible text in es.json/en.json | Grep for hardcoded strings |
| OVF-03 | ⚪ Not Started | — | Accessibility pass — WCAG AA compliance for keyboard nav + screen readers | Focus management, aria labels |
| OVF-04 | ⚪ Not Started | — | Error handling + loading states across all API calls | Skeleton loaders, error boundaries |
| OVF-05 | ⚪ Not Started | — | Mock data enrichment — more realistic solutions/metrics/layers | Better demo experience for Mesa |
| OVF-06 | ⚪ Not Started | — | Responsive edge cases — test tablet + small laptop layouts | Sidebar collapse thresholds |
| OVF-07 | ⚪ Not Started | — | Performance profiling — identify slow renders or large bundles | Angular DevTools, Lighthouse |

---

## Design Decisions

Design tasks (`[Design]` prefix in branch docs) produce `.md` files in `docs/design-decisions/`. These are archived once their corresponding implementation tasks are complete.

| Design Doc | Produced By | Status | Archived? |
|-----------|-------------|--------|-----------|
| `solution-finder-ux.md` | SOL-05 | Not Started | — |
| `solution-overview-layout.md` | ANL-04 | Not Started | — |
| `map-solution-viz.md` | MAP-05 | Not Started | — |
| `map-aoi-interaction.md` | MAP-09 | Not Started | — |
| `aoi-dashboard-layout.md` | ANL-11 | Not Started | — |
| `map-comparison-layout.md` | MAP-14 | Not Started | — |
| `perspective-selection-ux.md` | SOL-18 | Not Started | — |

---

## Git Branch Model

```
main ──────────────────────────────────────────────────────────────────►
  │                    │              │              │              │
  └─ foundation ──► merge    CP1 merge      CP2 merge      CP3 merge ...
                       │         │              │              │
                       ├─ feat/map-spatial ─────────────────────────────►
                       ├─ feat/solution-controls ──────────────────────►
                       └─ feat/analysis-dashboards ────────────────────►
```

At each checkpoint: all three branches merge to `main`, integration test, fix, then rebase and continue.

---

## How This File Works

- **One table per phase.** Branches within a phase share a table. Different phases = different tables = no merge conflicts across phases.
- **Counts format:** `completed/total` (e.g., `3/5` means 3 of 5 tasks done). Stretch tasks not counted.
- **Branch Doc** links to the full task file in `docs/branches/`.
- **Design decisions** for each branch live in `docs/design-decisions/`.
- Design tasks produce design-decision docs; those docs refine implementation task details, then get archived.

---

*Last updated: March 3, 2026 — Branch breakdown complete. 4 branch docs created with merge checkpoint structure.*
