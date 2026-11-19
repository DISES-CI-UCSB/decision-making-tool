# Documentation Index
*Your Source of Truth for Design Documentation*

This repository contains all design documentation, planning documents, and task tracking for the Conservation Decision Support Tool refactor. This index explains what each document is and how to use it.

---

## 📋 Quick Navigation

### Core Design Documents
- **[MASTER_DESIGN_DOCUMENT.md](./design/MASTER_DESIGN_DOCUMENT.md)** - The authoritative source of truth for all application requirements
- **[DESIGN_DOCUMENT.md](./design/DESIGN_DOCUMENT.md)** - Legacy document (Where To Work project reference)

### Proposals & Enhancements
- **[PROPOSAL_Area_4.4_Format_Specs.md](./proposals/PROPOSAL_Area_4.4_Format_Specs.md)** - Proposal to add format specifications to metrics tables

### Workflow & Process Documents
- **[REVIEW_GUIDE.md](./workflows/REVIEW_GUIDE.md)** - Guide for reviewers on how to review the Master Design Document
- **[TEAM_EMAIL_DRAFT_METRICS_REVIEW.md](./workflows/TEAM_EMAIL_DRAFT_METRICS_REVIEW.md)** - Draft email template for requesting metrics review from team
- **[ADDITIONAL_FEATURES.md](./workflows/ADDITIONAL_FEATURES.md)** - Gap analysis between current state and desired features
- **[SOLUTION_PARAMETERS.md](./workflows/SOLUTION_PARAMETERS.md)** - Comprehensive catalog of solution finder inputs (themes, weights, includes, excludes)

### Mockup Generation
- **[AI_MOCKUP_PROMPTS.md](../../development-artifacts/mockups/AI_MOCKUP_PROMPTS.md)** - Prompts for generating AI image mockups (Gemini, DALL-E, etc.)
- **[HTML_MOCKUP_PROMPTS.md](../../development-artifacts/mockups/HTML_MOCKUP_PROMPTS.md)** - Prompts for generating HTML/CSS mockups

### Task & Version Tracking
- **[TASKS.md](./TASKS.md)** - Personal task tracker for action items from discussions
- **[STATUS.md](./STATUS.md)** - Overall documentation status and review queue
- **[VERSION_HISTORY.md](./VERSION_HISTORY.md)** - Master Design Document version tracking and sync workflow

---

## 📚 Document Descriptions

### Core Design Documents

#### MASTER_DESIGN_DOCUMENT.md
**Purpose:** The single source of truth for all application requirements, specifications, and design decisions.

**Contents:**
- Part 1: Product Vision
- Part 2: User Personas & Access Levels (Tier 1/2/3)
- Part 3: Core User Workflows
- Part 4: Functional Specifications (UI components, metrics, reports)
- Part 5: Data Dictionary & Glossary

**When to Use:**
- Starting any new feature development
- Answering "what should this component do?" questions
- Validating requirements with stakeholders
- Onboarding new team members

**Status:** Active, being refined through team review

---

#### DESIGN_DOCUMENT.md
**Purpose:** Legacy reference document for the "Where To Work" project (Nature Conservancy of Canada).

**Status:** Reference only - not actively maintained for this project

---

### Proposals & Enhancements

#### PROPOSAL_Area_4.4_Format_Specs.md
**Purpose:** Proposes adding "Display Format" specifications to Area 4.4 metrics tables to clarify how metrics are rendered in different contexts (sidebar vs. report).

**Key Question:** Should we add format specification tables showing how each metric appears in sidebars vs. reports?

**Status:** Proposed - awaiting team review

**Related:** Enhances MASTER_DESIGN_DOCUMENT.md Area 4.4

---

### Workflow & Process Documents

#### REVIEW_GUIDE.md
**Purpose:** Helps reviewers navigate the large Master Design Document efficiently by directing them to sections relevant to their expertise.

**When to Use:**
- Before starting a review of the Master Design Document
- When assigning review tasks to team members
- To understand what type of feedback is needed

**Status:** Active reference document

---

#### TEAM_EMAIL_DRAFT_METRICS_REVIEW.md
**Purpose:** Draft email template for requesting team review of metrics (Area 4.4) using a two-phase approach:
1. Phase 1: Include/exclude decisions
2. Phase 2: Calculation formulas and data sources

**When to Use:**
- When ready to request metrics review from team
- As a template for similar review requests

**Status:** Draft - customize before sending

---

#### ADDITIONAL_FEATURES.md
**Purpose:** Gap analysis document outlining the delta between current application state and desired deliverable version.

**Contents:**
- Part 1: Feature Specification & User Experience (Team Review Required)
- Part 2: Technical Implementation & Developer Spec

**Key Sections:**
- Core pivot: "Pre-Calculated Exploration" model
- User flows by persona
- UI component specifications
- Technical architecture

**Status:** Active - contains questions requiring team feedback (marked with 🚩)

---

#### SOLUTION_PARAMETERS.md
**Purpose:** Comprehensive catalog of all inputs available for the Solution Finder UI.

**Contents:**
- Section I: Current Inventory (Themes, Weights, Includes, Excludes)
- Section II: Examples and Strategies (grouping strategies for handling thousands of layers)

**When to Use:**
- When building the Solution Finder component
- When adding new data layers
- When designing parameter grouping/aggregation strategies

**Status:** Active - reflects current dataset inventory

---

### Mockup Generation

#### AI_MOCKUP_PROMPTS.md
**Purpose:** Ready-to-use prompts for generating UI mockups using AI image generators (Gemini, DALL-E, Midjourney).

**Contents:**
- Tier 1 components (critical for stakeholder validation)
- Tier 2 components (important for development clarity)
- Best practices and tips

**When to Use:**
- When you need visual mockups for stakeholder demos
- When exploring UI concepts before implementation
- When creating design reference materials

**Status:** Active - prompts based on MASTER_DESIGN_DOCUMENT.md

---

#### HTML_MOCKUP_PROMPTS.md
**Purpose:** Detailed prompts for generating HTML/CSS mockups (for use with Gemini, Claude, GPT-4).

**Advantages over AI images:**
- Clean, readable text (no garbled AI text)
- Pixel-perfect layouts
- Interactive elements (buttons, tabs, hover states)
- Easy to iterate by editing code
- Can serve as starting point for actual implementation

**When to Use:**
- When you need interactive mockups for demos
- When you want code that can be refined into production
- When stakeholders need to see realistic UI behavior

**Status:** Active - comprehensive prompts for all major components

---

## 🗂️ Folder Structure

Documents are organized as follows:

```
docs/
├── design/
│   ├── MASTER_DESIGN_DOCUMENT.md (main spec)
│   ├── DESIGN_DOCUMENT.md (legacy reference)
│   └── archived/ (old versions)
├── proposals/
│   └── PROPOSAL_Area_4.4_Format_Specs.md
├── workflows/
│   ├── REVIEW_GUIDE.md
│   ├── TEAM_EMAIL_DRAFT_METRICS_REVIEW.md
│   ├── ADDITIONAL_FEATURES.md
│   └── SOLUTION_PARAMETERS.md
├── development-artifacts/mockups/
│   ├── AI_MOCKUP_PROMPTS.md
│   └── HTML_MOCKUP_PROMPTS.md
├── DOCUMENTATION_INDEX.md (this file)
├── STATUS.md
├── TASKS.md
└── VERSION_HISTORY.md
```

---

## 🔄 Workflow: Using These Documents

### For Planning & Design Tasks
1. Start with **[MASTER_DESIGN_DOCUMENT.md](./design/MASTER_DESIGN_DOCUMENT.md)** to understand requirements
2. Check **[ADDITIONAL_FEATURES.md](./workflows/ADDITIONAL_FEATURES.md)** for gap analysis and open questions
3. Review **[SOLUTION_PARAMETERS.md](./workflows/SOLUTION_PARAMETERS.md)** for available inputs/parameters
4. Use **[REVIEW_GUIDE.md](./workflows/REVIEW_GUIDE.md)** when requesting team feedback

### For Mockup Generation
1. Choose **[AI_MOCKUP_PROMPTS.md](../../development-artifacts/mockups/AI_MOCKUP_PROMPTS.md)** for quick visual concepts
2. Use **[HTML_MOCKUP_PROMPTS.md](../../development-artifacts/mockups/HTML_MOCKUP_PROMPTS.md)** for interactive, code-based mockups
3. Both reference **MASTER_DESIGN_DOCUMENT.md** for accuracy

### For Team Communication
1. Use **[TEAM_EMAIL_DRAFT_METRICS_REVIEW.md](./workflows/TEAM_EMAIL_DRAFT_METRICS_REVIEW.md)** as template for review requests
2. Reference **[REVIEW_GUIDE.md](./workflows/REVIEW_GUIDE.md)** to direct reviewers to relevant sections
3. Track proposals in **[PROPOSAL_Area_4.4_Format_Specs.md](./proposals/PROPOSAL_Area_4.4_Format_Specs.md)** format

### For Task Management
1. Add tasks to **[TASKS.md](./TASKS.md)** as they come up in discussions
2. Check **[STATUS.md](./STATUS.md)** for overall documentation status
3. Track MDD versions in **[VERSION_HISTORY.md](./VERSION_HISTORY.md)** when syncing from Google Doc

---

## 📝 Document Status Legend

- ✅ **Active** - Currently maintained and up-to-date
- 📋 **Draft** - In progress, needs review/completion
- 🔄 **Proposed** - Awaiting team decision/approval
- 📚 **Reference** - Historical/legacy, not actively maintained

---

## 🎯 Next Steps

1. **Review this index** - Does this organization make sense?
2. **Customize as needed** - Add/remove documents, update descriptions
3. **Create STATUS.md** - Track what's been reviewed, what needs attention
4. **Organize folders** - Move files to `docs/` subfolders when ready

---

*Last updated: February 2, 2026*
