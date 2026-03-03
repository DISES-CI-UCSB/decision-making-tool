# Design Documentation

This directory contains all design documentation, planning documents, and task tracking for the Conservation Decision Support Tool refactor.

## Quick Start

1. **New to the project?** Start with [DOCUMENTATION_INDEX.md](./DOCUMENTATION_INDEX.md) to understand what each document is.
2. **Need to review something?** Check [STATUS.md](./STATUS.md) to see what needs attention.
3. **Building a feature?** Start with [MASTER_DESIGN_DOCUMENT.md](../MASTER_DESIGN_DOCUMENT.md) as your source of truth.

## Structure

```
docs/
├── DOCUMENTATION_INDEX.md  ← Start here: explains what each document is
├── STATUS.md                ← Track what's been reviewed, what's next
├── README.md                ← This file
│
├── design/                  ← Core design documents (future organization)
├── proposals/               ← Enhancement proposals (future organization)
├── workflows/               ← Process documents (future organization)
└── mockups/                 ← Mockup generation prompts (future organization)
```

**Note:** Currently, all markdown files are at the repository root level for easy discovery. The `docs/` subfolders are created but empty - move files here when ready to organize.

## Key Documents

### The Source of Truth
- **[MASTER_DESIGN_DOCUMENT.md](./design/MASTER_DESIGN_DOCUMENT.md)** - Complete application specification
- **[VERSION_HISTORY.md](./VERSION_HISTORY.md)** - Track versions and sync from Google Doc

### Task Management
- **[TASKS.md](./TASKS.md)** - Personal task tracker for action items
- **[STATUS.md](./STATUS.md)** - Overall documentation status

### For Reviewers
- **[REVIEW_GUIDE.md](./workflows/REVIEW_GUIDE.md)** - How to review the Master Design Document
- **[TEAM_EMAIL_DRAFT_METRICS_REVIEW.md](./workflows/TEAM_EMAIL_DRAFT_METRICS_REVIEW.md)** - Email template for requesting reviews

### For Development
- **[ADDITIONAL_FEATURES.md](./workflows/ADDITIONAL_FEATURES.md)** - Gap analysis and feature specs
- **[SOLUTION_PARAMETERS.md](./workflows/SOLUTION_PARAMETERS.md)** - Catalog of solution finder inputs

### For Mockups
- **[AI_MOCKUP_PROMPTS.md](./mockups/AI_MOCKUP_PROMPTS.md)** - Prompts for AI image generation
- **[HTML_MOCKUP_PROMPTS.md](./mockups/HTML_MOCKUP_PROMPTS.md)** - Prompts for HTML mockup generation

## Workflow

This repository serves as the **single source of truth** for design documentation. The workflow:

1. **Design questions** → Documented in markdown files in this repo
2. **Different chat windows** → Use different models, reference repo docs
3. **Task management** → Track in STATUS.md, reference specific documents
4. **Code changes** → Reference design docs, update docs as needed

## Contributing

When adding new documentation:

1. Create markdown file at root level (or in appropriate `docs/` subfolder)
2. Update [DOCUMENTATION_INDEX.md](./DOCUMENTATION_INDEX.md) with description
3. Update [STATUS.md](./STATUS.md) with review status
4. Reference related documents using relative paths

---

*See [DOCUMENTATION_INDEX.md](./DOCUMENTATION_INDEX.md) for detailed descriptions of each document.*
