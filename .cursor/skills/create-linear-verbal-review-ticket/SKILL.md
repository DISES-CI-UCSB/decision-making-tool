---
name: create-linear-verbal-review-ticket
description: Creates Linear issues using the Problem → Location → Fix structure for verbal/UI review, bugs, and improvements. Use when the user asks to file verbal review tickets, create Linear issues from a UI walkthrough, log bugs or polish items, or wants tickets formatted for fast context-switching. Do not use as the default template for greenfield feature specs where the work is purely additive scope with no defect narrative—use a lighter Goals/Scope/Acceptance format or ask the user which template to use.
---

# Create Linear verbal-review-style tickets

## When to use this skill

**Use** the sections below when the work is framed as:

- Something **wrong**, **confusing**, **inconsistent**, or **missing** in the current product (verbal review, bug, UX debt, refactor to align patterns).

**Do not assume** this template for **net-new capability** issues where the user is describing *only* "build X" with no problem statement—unless they say they want verbal-review formatting. For those, prefer:

- **Goals** / **Scope** / **Acceptance criteria** / **Out of scope**, or ask: *"Use Problem/Location/Fix or a feature-style spec?"*

## Description template (paste into Linear)

```markdown
## Problem

[What is wrong, unclear, or suboptimal? Why does it matter to the user (impact, heuristic, a11y)?]

## Location

* **UI:** [Panel, route, approximate control — e.g. Right sidebar → AOI tab → section header]
* **Code:** [Files, components, ids/classes if known — e.g. `panel-switcher.html` `#aoi-dashboard-back-btn`]
* **Out of scope:** [What this ticket is not responsible for]

## Fix

[Concrete intended direction — bullets ok. If multiple approaches, list the preferred one first.]

## Design / open questions

[Optional. Product/design sign-off, copy, metric definitions, or UX tradeoffs that block implementation. Omit if unnecessary.]

## Related

* `UCS-###` — [short note]
```

## Title rules

- **Plain imperative phrase** only (e.g. `Remove redundant back arrow from AOI dashboard header`).
- **No** manual prefixes like `ANL-12:` or `SOL-05:` — Linear already assigns **`UCS-###`**.

## Labels (Decision Making Tool)

Follow [linear-workflow.mdc](mdc:.cursor/rules/linear-workflow.mdc):

| Always consider | Meaning |
|-----------------|--------|
| `verbal-review` | User flagged during live review or transcription of review notes |
| Branch label | `analysis-dashboards`, `solution-controls`, `map-spatial`, `foundation` as appropriate |
| `aoi-dashboard` | AOI right-sidebar panel only (often with `analysis-dashboards`) |
| Type | `Bug`, `Improvement`, or `Feature` as appropriate |

**Do not** add a `frontend` label — UI work is the **default**. Add **`backend`** only when the work is server/API/pipeline, not the Angular app.

## Workflow

1. **De-dupe:** `list_issues` / `get_issue` for related work; link in **Related** instead of spawning duplicates.
2. **Prioritize:** Urgent user blockers and a11y/readability → higher priority; pure polish → medium/low.
3. **Create:** Linear MCP `save_issue` with `team` **UCSB Spatial Center**, `project` **Decision Making Tool**, description from template, labels as above.

## Quality bar

Each ticket should let someone context-switching between chats answer **fast**:

1. What’s the issue? (**Problem**)
2. Where do I click / open in the repo? (**Location**)
3. What does “done” look like? (**Fix** + optional **Design / open questions**)
