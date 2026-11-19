# Task Tracker
*Personal tasks and action items from discussions*

This document tracks tasks, action items, and follow-ups from team discussions, design reviews, and planning sessions.

---

## How to Use This Tracker

- **Add tasks** as they come up in discussions
- **Mark complete** when done
- **Reference documents** using relative paths (e.g., `[MDD Area 4.4](../design/MASTER_DESIGN_DOCUMENT.md#area-44)`)
- **Link to discussions** if you have notes elsewhere

---

## Active Tasks

### Documentation & Design

- [ ] **Sync Master Design Document from Google Doc**
  - Current MDD is out of date
  - New version in Google Doc with team comments
  - Action: Download as markdown, review changes, update archived version
  - Related: See [VERSION_HISTORY.md](./VERSION_HISTORY.md)

- [ ] **Review team comments in Google Doc**
  - Team is adding comments to new Google Doc version
  - Action: Review comments, address feedback, update tasks as needed
  - Priority: High

- [ ] **Archive old MASTER_DESIGN_DOCUMENT.md**
  - Keep old version for reference
  - Action: Move to `docs/design/archived/` with date stamp
  - Status: Pending sync from Google Doc

### Metrics Review

- [ ] **Send metrics review email to team**
  - Use [TEAM_EMAIL_DRAFT_METRICS_REVIEW.md](./workflows/TEAM_EMAIL_DRAFT_METRICS_REVIEW.md) as template
  - Customize dates and links
  - Focus on Area 4.4 metrics (MASTER_DESIGN_DOCUMENT.md)

- [ ] **Review PROPOSAL_Area_4.4_Format_Specs.md**
  - Proposal to add format specifications to metrics tables
  - Decision needed: Option 1 (simple) vs Option 2 (detailed)
  - Related: [PROPOSAL_Area_4.4_Format_Specs.md](../proposals/PROPOSAL_Area_4.4_Format_Specs.md)

### Open Questions (from ADDITIONAL_FEATURES.md)

- [ ] **Answer: What statistics for "About this Solution" popup?**
  - Question from ADDITIONAL_FEATURES.md Section 1.2.A
  - Needed for: Public user experience
  - Related: [ADDITIONAL_FEATURES.md](./workflows/ADDITIONAL_FEATURES.md)

- [ ] **Answer: Comparison complexity for public users**
  - Is "Difference Map" too complex? Should we use simple "Swipe" tool?
  - Related: [ADDITIONAL_FEATURES.md](./workflows/ADDITIONAL_FEATURES.md)

- [ ] **Answer: Tier 2 feature definitions**
  - What specific features should be reserved for Tier 2 users?
  - Related: [ADDITIONAL_FEATURES.md](./workflows/ADDITIONAL_FEATURES.md)

- [ ] **Answer: Report specifics**
  - Territorial Planning Report: What data points?
  - Connectivity Report: Pre-calculated layer or derived?
  - Related: [ADDITIONAL_FEATURES.md](./workflows/ADDITIONAL_FEATURES.md)

---

## Completed Tasks

- [x] **Organize markdown documentation files**
  - Created docs/ folder structure
  - Created DOCUMENTATION_INDEX.md
  - Created STATUS.md
  - Moved files to appropriate subfolders
  - Date: February 2, 2026

- [x] **Create task tracker**
  - Set up TASKS.md for tracking action items
  - Date: February 2, 2026

---

## Future / Backlog

### When Ready for Development

- [ ] **Verify SOLUTION_PARAMETERS.md against current datasets**
  - Ensure parameter catalog matches actual data files
  - Needed before building Solution Finder UI

- [ ] **Create development plan from MASTER_DESIGN_DOCUMENT.md**
  - Break down Part 4 (Functional Specifications) into implementation tasks
  - Prioritize by user tier and dependencies

### Documentation Improvements

- [ ] **Create component specification templates**
  - Standardize how we document new components
  - Based on MASTER_DESIGN_DOCUMENT.md structure

- [ ] **Document Google Doc → Markdown sync workflow**
  - Create guide for syncing updates
  - Include versioning strategy

---

## Notes from Discussions

### [Date] - Discussion Topic
- **Attendees:** 
- **Key Points:**
  - Point 1
  - Point 2
- **Action Items:**
  - [ ] Task 1
  - [ ] Task 2
- **Follow-up:** 

---

## Task Categories

Use these categories to organize tasks:

- 📋 **Documentation** - Writing, updating, organizing docs
- 🔍 **Review** - Reviewing documents, proposals, code
- 💬 **Discussion** - Questions to discuss with team
- 🎨 **Design** - Design decisions, mockups, UI/UX
- 🔧 **Development** - Coding tasks (future)
- 📊 **Data** - Data verification, parameter catalogs
- 📧 **Communication** - Emails, team updates

---

*Add tasks as they come up. Mark complete when done. Archive completed tasks monthly.*
