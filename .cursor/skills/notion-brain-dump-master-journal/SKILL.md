---
name: notion-brain-dump-master-journal
description: >-
  Captures an unstructured project brain dump into the Notion Master Project
  Journal data source: creates a new row or updates an existing brain-dump row,
  sets Project tag DISES, and writes AI summary, Next step, Verbal dump, and
  organized page body. Use when the user says brain dump, verbal dump, ticket
  ideas dump, or wants to log scattered notes into the DISES work journal.
disable-model-invocation: false
---

# Notion brain dump → Master Project Journal (DISES)

## Targets (do not guess)

- **Database (container):** [📝 Work Journal (DISES)](https://www.notion.so/80646effe80040f787ec85ac3660cd2c)
- **Data source to create pages under:** `collection://187eecf1-5eb6-486f-91c8-a08cd2b30251` — title **Master Project Journal**
- **Default filtered view (DISES):** [Work Journal (tagged DISES)](https://www.notion.so/80646effe80040f787ec85ac3660cd2c?v=9a528341de7a4f45aab57b1134e8fc44)

Always **`notion-fetch`** the database or data source URL first if the schema or property names might have changed.

## Workflow

1. **Clarify intent:** One-off new entry vs updating an existing brain-dump page (user may link a page or name it, e.g. “Random Ticket Ideas Brain Dump”).
2. **Organize (high level):** Group bullets by theme (map layers, data, dashboard, infra, process). Keep implementation detail light unless the user provides it. Preserve nuance (risks, hypotheses) without over-committing to root cause.
3. **Notion MCP:**
   - **Create:** `notion-create-pages` with `parent`: `{ "type": "data_source_id", "data_source_id": "187eecf1-5eb6-486f-91c8-a08cd2b30251" }`.
   - **Update:** `notion-update-page` on the existing page UUID with `command: "update_properties"` and/or `replace_content` / `update_content` as appropriate.
4. **Properties (use exact names from fetch):**
   - **Title:** Short imperative or descriptive title (e.g. `Brain dump: map layers & SIRAP (May 2026)`).
   - **Entry type:** Usually `Verbal dump`; use `Planning note` if the user is mostly sequencing work.
   - **Project tag:** Include **`DISES`**. For `multi_select`, use JSON array string form per MCP tool expectations (e.g. `[\"DISES\"]` when the tool expects a stringified array—follow the fetched SQLite hints).
   - **Day:** Set `date:Day:start` to the journal date (user’s “today” from context), `date:Day:is_datetime`: `0`.
   - **Verbal dump:** Paste or lightly clean the user’s raw dictation; keep their wording where it matters.
   - **AI summary:** 2–4 sentences: themes + sharpest risks or decisions.
   - **Next step:** One smallest concrete action (e.g. “Trace X in manifest and confirm raster type”).
5. **Page body:** Do **not** duplicate the title as an H1. Use `replace_content` or `update_content` to add a short **Organized capture** section with headings, **Suggested sequencing** if helpful, and **open questions** if any.

## After saving

Reply with the Notion page URL and a one-line reminder of what was captured.
