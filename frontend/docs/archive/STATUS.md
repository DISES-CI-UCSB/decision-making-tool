# Documentation Status Tracker
*What's Been Created, What Needs Review, What's Next*

This document tracks the status of all design documentation and helps prioritize review and refinement tasks.

---

## 📊 Overall Status

**Last Updated:** February 2, 2026

**Total Documents:** 9 markdown files

**Organization Status:** ✅ Files organized into docs/ subfolders

---

## ✅ Completed Documents

### Core Design Documents

#### MASTER_DESIGN_DOCUMENT.md
- **Status:** ⚠️ **OUT OF DATE** - New version in Google Doc
- **Location:** `docs/design/MASTER_DESIGN_DOCUMENT.md`
- **Size:** Very large (~165k characters)
- **Contents:** Complete specification covering Parts 1-5
- **Version Status:**
  - Current markdown: Version 1.0 (outdated)
  - Google Doc: Version 2.0 (active, team adding comments)
  - See [VERSION_HISTORY.md](./VERSION_HISTORY.md) for sync workflow
- **Review Status:**
  - [ ] Part 1: Product Vision - Needs review
  - [ ] Part 2: User Personas - Needs review
  - [ ] Part 3: Workflows - Needs review
  - [ ] Part 4: Functional Specs - **HIGH PRIORITY** (Area 4.4 metrics)
  - [ ] Part 5: Data Dictionary - Needs review
- **Next Steps:**
  - **URGENT:** Sync from Google Doc (download as markdown)
  - Archive current version to `docs/design/archived/`
  - Review team comments in Google Doc
  - Prioritize Area 4.4 metrics review (see TEAM_EMAIL_DRAFT_METRICS_REVIEW.md)
  - Use REVIEW_GUIDE.md to direct reviewers
- **Related:** PROPOSAL_Area_4.4_Format_Specs.md proposes enhancements

---

### Supporting Documents

#### REVIEW_GUIDE.md
- **Status:** ✅ Complete
- **Purpose:** Navigation guide for reviewers
- **Action Required:** None - ready to use

#### AI_MOCKUP_PROMPTS.md
- **Status:** ✅ Complete
- **Purpose:** Prompts for AI image generation
- **Action Required:** None - ready to use

#### HTML_MOCKUP_PROMPTS.md
- **Status:** ✅ Complete
- **Purpose:** Prompts for HTML mockup generation
- **Action Required:** None - ready to use

#### SOLUTION_PARAMETERS.md
- **Status:** ✅ Complete
- **Purpose:** Catalog of solution finder inputs
- **Action Required:** Verify against current datasets

---

## 📋 Draft Documents (Need Completion/Review)

#### PROPOSAL_Area_4.4_Format_Specs.md
- **Status:** 📋 Draft Proposal
- **Purpose:** Proposes adding format specifications to metrics tables
- **Action Required:**
  - [ ] Review proposal with design team
  - [ ] Decide: Option 1 (simple column) vs Option 2 (separate tables)
  - [ ] If approved, implement in MASTER_DESIGN_DOCUMENT.md
- **Related:** Enhances MASTER_DESIGN_DOCUMENT.md Area 4.4

#### TEAM_EMAIL_DRAFT_METRICS_REVIEW.md
- **Status:** 📋 Draft Email Template
- **Purpose:** Template for requesting metrics review
- **Action Required:**
  - [ ] Customize dates and links
  - [ ] Send to team when ready for Area 4.4 review
- **Related:** MASTER_DESIGN_DOCUMENT.md Area 4.4

#### ADDITIONAL_FEATURES.md
- **Status:** 📋 Draft - Contains Open Questions
- **Purpose:** Gap analysis and feature specifications
- **Action Required:**
  - [ ] Review all 🚩 sections requiring team feedback
  - [ ] Answer questions about:
    - Specific statistics for "About this Solution" popup
    - Comparison complexity for public users
    - Tier 2 feature definitions
    - Report specifics (Territorial Planning, Connectivity)
- **Related:** Complements MASTER_DESIGN_DOCUMENT.md

---

## 🔄 Legacy/Reference Documents

#### DESIGN_DOCUMENT.md
- **Status:** 📚 Reference Only
- **Purpose:** Legacy "Where To Work" project documentation
- **Action Required:** None - keep for reference, not actively maintained

---

## 🎯 Priority Review Queue

### High Priority (Blocking Progress)

1. **Sync Master Design Document from Google Doc** ⚠️ URGENT
   - **Why:** Current markdown is out of date, team is working in Google Doc
   - **Action:** Download Google Doc as markdown, archive old version, update markdown file
   - **Timeline:** ASAP - before starting new work
   - **Dependencies:** None
   - **See:** [VERSION_HISTORY.md](./VERSION_HISTORY.md) for sync workflow

2. **Area 4.4 Metrics Review** (MASTER_DESIGN_DOCUMENT.md)
   - **Why:** Metrics are foundational building blocks
   - **Action:** Use TEAM_EMAIL_DRAFT_METRICS_REVIEW.md to request review
   - **Timeline:** Before implementation begins
   - **Dependencies:** Sync MDD from Google Doc first

2. **Open Questions in ADDITIONAL_FEATURES.md**
   - **Why:** Contains design decisions needed for implementation
   - **Action:** Review all 🚩 sections, get team answers
   - **Timeline:** Before building affected components
   - **Dependencies:** None

### Medium Priority (Important but Not Blocking)

3. **PROPOSAL_Area_4.4_Format_Specs.md Review**
   - **Why:** Enhances clarity for designers/developers
   - **Action:** Review proposal, decide on approach
   - **Timeline:** Can be done in parallel with metrics review
   - **Dependencies:** None

4. **SOLUTION_PARAMETERS.md Verification**
   - **Why:** Ensure parameter catalog matches current datasets
   - **Action:** Verify against actual data files
   - **Timeline:** Before building Solution Finder UI
   - **Dependencies:** Access to current datasets

### Low Priority (Nice to Have)

5. **Document Organization**
   - **Why:** Better discoverability and structure
   - **Action:** Move files to `docs/` subfolders
   - **Timeline:** Anytime
   - **Dependencies:** None

---

## 📝 Notes & Decisions Log

### Decisions Made
- [x] Decision: Organize docs into `docs/` subfolders (design, proposals, workflows, mockups)
- [x] Decision: Google Doc is source of truth for Master Design Document (team collaboration)
- [x] Decision: Markdown is synced periodically from Google Doc
- [x] Decision: Archive old markdown versions for reference
- [ ] Decision: Use MASTER_DESIGN_DOCUMENT.md as single source of truth (after sync)
- [ ] Decision: Two-phase metrics review approach (include/exclude, then calculations)

### Open Questions
- [ ] Should we organize files into `docs/` subfolders now or later?
- [ ] Who should review which sections? (See REVIEW_GUIDE.md)
- [ ] What's the timeline for metrics review completion?

### Patterns Established
- ✅ All design docs live in repo (source of truth)
- ✅ Proposals follow PROPOSAL_Area_4.4_Format_Specs.md format
- ✅ Mockup prompts reference MASTER_DESIGN_DOCUMENT.md
- ✅ Review requests use structured templates

---

## 🔗 Related Resources

- **DOCUMENTATION_INDEX.md** - Explains what each document is
- **REVIEW_GUIDE.md** - How to review the Master Design Document
- **.gitignore** - Make sure docs are tracked (not ignored)

---

## 💡 Tips for Using This Status Tracker

1. **Update after each review session** - Mark sections as reviewed
2. **Link to specific sections** - Use section numbers from documents
3. **Track dependencies** - Note what blocks what
4. **Set deadlines** - Add target dates for high-priority items
5. **Archive completed items** - Move to "Completed" section when done

---

*This is a living document - update as work progresses*
