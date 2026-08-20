---
name: notion-brain-dump-master-journal
description: >-
  Captures an unstructured brain dump into a Notion page the user specifies, or
  into the DISES Master Project Journal when they explicitly ask to log there.
  Use only when the user provides a Notion link, names a target page/database,
  or clearly requests a Work Journal / brain-dump entry in Notion. Do not invoke
  for a verbal dump with no Notion target.
disable-model-invocation: false
---

# Notion brain dump (opt-in)

**Do not run this skill** unless the user linked a Notion page, named where to write, or explicitly asked to add a brain dump to the DISES Work Journal / Master Project Journal.

Follow [task-tracking.mdc](mdc:.cursor/rules/task-tracking.mdc).

## Targets (do not guess)

If the user did **not** give a target, ask which Notion page to use — do not pick one automatically.

When they **do** ask for the DISES journal (and no other target):

- **Database (container):** [📝 Work Journal (DISES)](https://www.notion.so/80646effe80040f787ec85ac3660cd2c)
- **Data source:** `collection://187eecf1-5eb6-486f-91c8-a08cd2b30251` — **Master Project Journal**
- **Default filtered view (DISES):** [Work Journal (tagged DISES)](https://www.notion.so/80646effe80040f787ec85ac3660cd2c?v=9a528341de7a4f45aab57b1134e8fc44)

Always **`notion-fetch`** the user's linked page or database first if the schema might have changed.

Fetch MCP resource **`notion://docs/enhanced-markdown-spec`** before writing page body so syntax (especially to-dos) is correct.

## High-level to-dos (required in page body)

- Place **`## High-level to-dos`** above **Organized capture**.
- Use **Notion to-do blocks**: `- [ ] **Label:** one to two sentences.` All unchecked unless the user marked something done.
- One to-do per theme unless the user combined themes.

Do **not** use `1.` / `2.` ordered lists for this section.

## Workflow

1. **Confirm target:** User's Notion URL, named page, or explicit Work Journal request.
2. **Organize:** Group by theme (map layers, data, dashboard, infra, process). Keep implementation detail light unless provided.
3. **Notion MCP:** Create or update only on the confirmed target (`notion-create-pages`, `notion-update-page`, etc.).
4. **Properties** (when using Work Journal — use exact names from fetch):
   - **Title:** Short descriptive title (e.g. `Brain dump: map layers & SIRAP (May 2026)`).
   - **Entry type:** Usually `Verbal dump`; `Planning note` if mostly sequencing.
   - **Project tag:** **`DISES`** when applicable.
   - **Day:** Journal date from user context.
   - **Verbal dump:** User's raw dictation, lightly cleaned.
   - **AI summary:** 2–4 sentences on themes + sharpest risks.
   - **Next step:** One smallest concrete action.
5. **Page body:** **High-level to-dos**, then **Organized capture**, optional **Suggested sequencing** and **open questions**.

## After saving

Reply with the Notion page URL and a one-line summary of what was captured.
