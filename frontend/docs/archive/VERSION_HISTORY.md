# Master Design Document Version History
*Tracking changes and syncing from Google Doc*

The Master Design Document lives in Google Docs where the team collaborates. This file tracks versions and changes when synced to markdown.

---

## Versioning Strategy

**Source of Truth:** Google Doc (team collaboration happens here)

**Markdown Sync:** Periodically download Google Doc as markdown and update repository

**Archived Versions:** Keep old markdown versions in `docs/design/archived/` for reference

---

## Version Log

### Version 2.0 (Current in Google Doc)
- **Status:** 🔄 Active in Google Doc
- **Date:** [Date when Google Doc was last updated]
- **Changes:** Team is adding comments and making changes
- **Markdown File:** `docs/design/MASTER_DESIGN_DOCUMENT.md` (needs sync)
- **Notes:** 
  - Download from Google Doc as markdown
  - Review team comments
  - Update markdown file
  - Archive previous version

### Version 1.0 (Previous Markdown)
- **Status:** 📚 Archived
- **Date:** [Date of original creation]
- **File:** `docs/design/archived/MASTER_DESIGN_DOCUMENT_v1.0_[DATE].md`
- **Notes:** Original markdown version, now out of date

---

## Sync Workflow

### When to Sync

1. **After major team review sessions** - When significant comments/changes accumulate
2. **Before starting new work** - Ensure you're working from latest version
3. **Weekly/bi-weekly** - Regular sync to keep markdown current

### How to Sync

1. **Download from Google Doc:**
   - File → Download → Markdown (.md)
   - Save as `MASTER_DESIGN_DOCUMENT.md`

2. **Archive Previous Version:**
   ```bash
   # Move old version to archived folder
   mv docs/design/MASTER_DESIGN_DOCUMENT.md \
      docs/design/archived/MASTER_DESIGN_DOCUMENT_v[VERSION]_[DATE].md
   ```

3. **Update New Version:**
   - Place downloaded markdown in `docs/design/MASTER_DESIGN_DOCUMENT.md`
   - Review formatting (Google Doc → Markdown can be messy)
   - Fix any formatting issues
   - Update VERSION_HISTORY.md with new version entry

4. **Review Team Comments:**
   - Check Google Doc comments
   - Add tasks to [TASKS.md](./TASKS.md) for items needing follow-up
   - Address comments that are resolved

5. **Update Related Docs:**
   - If structure changed significantly, update:
     - [DOCUMENTATION_INDEX.md](./DOCUMENTATION_INDEX.md)
     - [STATUS.md](./STATUS.md)
     - [REVIEW_GUIDE.md](./workflows/REVIEW_GUIDE.md) (if section numbers changed)

---

## Formatting Notes

Google Doc → Markdown conversion can introduce issues:

- **Tables:** May need manual cleanup
- **Headers:** Check hierarchy (H1, H2, H3)
- **Lists:** Verify nesting and formatting
- **Code blocks:** May need syntax highlighting added
- **Links:** Check internal links still work
- **Images:** May need to be downloaded separately

**Tip:** Keep a checklist of common formatting issues to fix after each sync.

---

## Team Comments Tracking

When syncing, review Google Doc comments and:

1. **Resolved Comments:** 
   - Mark as addressed in Google Doc
   - Note resolution in this file if significant

2. **Open Comments:**
   - Add to [TASKS.md](./TASKS.md) if action needed
   - Note here if it's a discussion point

3. **Comment Summary:**
   - After each sync, note major discussion themes here

---

## Archive Structure

```
docs/design/archived/
├── MASTER_DESIGN_DOCUMENT_v1.0_2025-12-17.md
├── MASTER_DESIGN_DOCUMENT_v2.0_2026-02-02.md
└── ...
```

**Naming Convention:** `MASTER_DESIGN_DOCUMENT_v[VERSION]_[YYYY-MM-DD].md`

---

## Quick Reference

- **Current Google Doc:** [Link to Google Doc]
- **Current Markdown:** `docs/design/MASTER_DESIGN_DOCUMENT.md`
- **Last Synced:** [Date]
- **Next Sync Due:** [Date or "After next team review"]

---

*Update this file each time you sync from Google Doc*
