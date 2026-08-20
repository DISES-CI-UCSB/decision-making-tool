---
name: create-verbal-review-item
description: Formats verbal/UI review notes, bugs, and improvements using Problem → Location → Fix. Use when the user asks to file verbal review tickets or log bugs/polish from a walkthrough. Write to Notion only if the user provides a Notion link or explicitly asks to create/update a Notion page. Do not use as the default template for greenfield feature specs where the work is purely additive scope with no defect narrative—use Goals/Scope/Acceptance or ask which format they want.
---

# Verbal-review items

Follow [task-tracking.mdc](mdc:.cursor/rules/task-tracking.mdc) for when Notion applies.

## When to use this skill

**Use** when the work is framed as something **wrong**, **confusing**, **inconsistent**, or **missing** (verbal review, bug, UX debt, pattern alignment).

**Do not assume** this template for net-new capability described only as "build X" unless the user wants verbal-review formatting.

## Description template

```markdown
## Problem

[What is wrong, unclear, or suboptimal? Why does it matter to the user (impact, heuristic, a11y)?]

## Location

* **UI:** [Panel, route, approximate control]
* **Code:** [Files, components, ids/classes if known]
* **Out of scope:** [What this item is not responsible for]

## Fix

[Concrete intended direction — bullets ok. Preferred approach first if multiple options.]

## Design / open questions

[Optional. Omit if unnecessary.]

## Related

* [Repo path or page the user linked] — [short note]
```

## Title rules

- **Plain imperative phrase** only (e.g. `Remove redundant back arrow from AOI dashboard header`).
- **No** legacy prefixes like `ANL-12:` or `SOL-05:`.

## Scope tags

Use area names from task-tracking (`analysis-dashboards`, `solution-finder`, `left-sidebar`, `map-spatial`, `foundation`, `aoi-dashboard`, `backend` as appropriate).

## Workflow

1. **Output:** Default to formatted markdown in the chat reply (or a repo doc if the user asked for one).
2. **Notion:** Only if the user pasted a Notion URL or asked to create/update a specific Notion page — then use Notion MCP on **that** target. Do not search Notion or pick a database on your own.
3. **Prioritize:** User blockers and a11y → higher urgency; pure polish → lower.

## Quality bar

Someone context-switching should quickly see:

1. What's the issue? (**Problem**)
2. Where in the app/repo? (**Location**)
3. What does "done" look like? (**Fix**)
