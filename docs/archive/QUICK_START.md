# Quick Start Guide
*Get oriented quickly*

## I Need To...

### Add a Task from a Discussion
→ Open **[TASKS.md](./TASKS.md)** and add it under "Active Tasks"

### Sync the Master Design Document from Google Doc
→ Follow the workflow in **[VERSION_HISTORY.md](./VERSION_HISTORY.md)**
1. Download Google Doc as markdown
2. Archive old version: `mv docs/design/MASTER_DESIGN_DOCUMENT.md docs/design/archived/MASTER_DESIGN_DOCUMENT_v1.0_[DATE].md`
3. Place new markdown in `docs/design/MASTER_DESIGN_DOCUMENT.md`
4. Review team comments, add tasks to TASKS.md
5. Update VERSION_HISTORY.md

### Find a Specific Document
→ Check **[DOCUMENTATION_INDEX.md](./DOCUMENTATION_INDEX.md)** - it explains what each document is

### See What Needs Review
→ Check **[STATUS.md](./STATUS.md)** for priority review queue

### Request Team Review
→ Use **[TEAM_EMAIL_DRAFT_METRICS_REVIEW.md](./workflows/TEAM_EMAIL_DRAFT_METRICS_REVIEW.md)** as template

### Generate Mockups
→ Use prompts in **[AI_MOCKUP_PROMPTS.md](./mockups/AI_MOCKUP_PROMPTS.md)** or **[HTML_MOCKUP_PROMPTS.md](./mockups/HTML_MOCKUP_PROMPTS.md)**

---

## File Locations

```
docs/
├── TASKS.md                    ← Your personal task tracker
├── STATUS.md                   ← Overall documentation status
├── VERSION_HISTORY.md          ← MDD version tracking
├── DOCUMENTATION_INDEX.md      ← What each doc is
├── README.md                   ← Overview
│
├── design/
│   ├── MASTER_DESIGN_DOCUMENT.md  ← Main spec (needs sync from Google Doc)
│   ├── DESIGN_DOCUMENT.md         ← Legacy reference
│   └── archived/                  ← Old versions go here
│
├── proposals/
│   └── PROPOSAL_Area_4.4_Format_Specs.md
│
├── workflows/
│   ├── REVIEW_GUIDE.md
│   ├── TEAM_EMAIL_DRAFT_METRICS_REVIEW.md
│   ├── ADDITIONAL_FEATURES.md
│   └── SOLUTION_PARAMETERS.md
│
└── mockups/
    ├── AI_MOCKUP_PROMPTS.md
    └── HTML_MOCKUP_PROMPTS.md
```

---

## Current Priority Tasks

1. ⚠️ **Sync MDD from Google Doc** (see VERSION_HISTORY.md)
2. Review team comments in Google Doc
3. Send metrics review email (use TEAM_EMAIL_DRAFT_METRICS_REVIEW.md)

---

*See [DOCUMENTATION_INDEX.md](./DOCUMENTATION_INDEX.md) for detailed descriptions*
