# Review Guide: How to Review This Document

## Purpose of This Review Guide

This document is large and serves multiple functions. Not all sections require the same level of review from all readers.

This Review Guide exists to:

- Direct reviewers to the sections where their expertise is most needed
- Clarify the type of feedback requested
- Reduce unnecessary review effort
- Ensure that high-priority sections are validated first, before secondary refinement

> **Note:** Reviewers are not expected to read this document end-to-end unless explicitly noted below.

---

## High-Priority Review Areas (Read First)

The following sections are **implementation-critical**. These sections define system behavior, decision logic, metrics, reports, and data requirements. Feedback on these sections should be prioritized.

| Section | Title |
|---------|-------|
| 4.3 | Core Components and Decision Logic |
| 4.4 | User Interactions and Scenario Exploration |
| 4.5 | Reports and Decision Outputs |
| 4.6 | Metrics Definitions and Calculations |
| 4.11 | Data Layer Registry and Asset Inventory |

Once these sections are validated and stabilized, the remaining sections can be reviewed for completeness and clarity.

---

## Role-Based Review Assignments

### Amy (PI / Scientific Oversight)

**Primary focus areas:**

- Sections 4.3, 4.4, 4.5, 4.6
- Summary tables of metrics
- Report structure and decision outputs

**Review focus:**

- Are the decision-support components aligned with real conservation decision-making needs?
- Do the metrics meaningfully support trade-off evaluation?
- Are the reports sufficient for institutional and policy-facing use?
- Are any critical factors, assumptions, or decision signals missing?

**Secondary review:**

- Remaining sections can be reviewed after high-priority sections are validated.
- Detailed data-layer verification may be delegated to data or GIS specialists as appropriate.

---

### Science and Domain Experts (Conservation, Modeling, Policy)

**Primary focus areas:**

- Sections 4.3, 4.4, 4.6, and relevant portions of 4.5

**Requested feedback:**

- Verify that the listed metrics are correct, complete, and decision-relevant
- Confirm that metric definitions and formulas are scientifically valid
- Identify missing metrics or incorrect formulations
- Flag metrics that may be misleading or redundant

**When reviewing metrics:**

- Assume metrics will be displayed primarily in the right-hand sidebar and in reports
- Focus on *what* is being calculated, not *how* it is visually presented

---

### Data, GIS, and Backend Contributors

**Primary focus areas:**

- Sections 4.6 and 4.11

**Requested feedback:**

- Verify that required input layers exist or can be obtained
- Confirm data sources, coverage, and update status
- Identify gaps where:
  - Data is missing
  - Data is outdated
  - Data assumptions are unclear
- Flag metrics that cannot currently be computed with known data assets

> This review is intended to surface feasibility issues early, before implementation.

---

## Sections Not Requiring Active Review

The following sections are included to document stakeholder requests, transparency requirements, and compliance needs. **Active review is not requested** unless errors or contradictions are noticed.

- User experience requirements
- Transparency and documentation requirements
- Stakeholder requirements and verification matrices
- Narrative background and justification sections

These sections exist for traceability and accountability and should not be treated as design debates.

---

## Guidance on Providing Feedback

To keep feedback actionable and useful, reviewers are asked to:

- **Reference specific section numbers**
- **Focus on:**
  - Missing requirements
  - Incorrect assumptions
  - Unclear or infeasible definitions
- **Avoid feedback on:**
  - Visual styling
  - Minor wording issues that do not affect meaning
  - Hypothetical future features not in scope

**Where possible:**

- Propose corrections directly (e.g., corrected formulas or clearer definitions)
- Note uncertainty explicitly if a concern depends on data availability or institutional constraints

---

## Note on Illustrative UI Mockups

This document includes AI-generated illustrative component mockups (e.g., sidebar layouts and component structure).

**These mockups are:**

- Intended to clarify conceptual layout and information grouping
- *Not* intended to define final UI design, styling, or visual expectations

**Feedback should focus on:**

- Whether the right information is being presented
- Whether component groupings make sense conceptually

**Feedback should not focus on** visual polish or exact layout details.
