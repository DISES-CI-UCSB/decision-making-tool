---
name: sync-notion-linear-dev-ready
description: Sync DISES dev-ready Notion work items into Linear for the Decision Making Tool project. Use when the user asks to sync Notion tasks, Linear-ticket dev-ready items, DISES work items, or prepare Linear issues from the DISES Work Item database.
---

# Sync Notion Linear Dev-Ready Items

## Targets

Notion database: `🧭 DISES Work Item`
- Database URL: `https://www.notion.so/2dc81d94c18e4921ad259f64885adbf8`
- Data source URL: `collection://2bd94bee-0d96-4a8c-a852-377b67922700`
- Cursor-ready view URL: `https://www.notion.so/2dc81d94c18e4921ad259f64885adbf8?v=e1e41fc65b6e45d6911d51143b0a66c9`

Linear project: `Decision Making Tool`
- Project URL: `https://linear.app/ucsb-spatial-center/project/decision-making-tool-645504b2136c`
- Project ID: `9f249268-5ae4-48e1-871d-7bca6ee1f511`
- Team: `UCSB Spatial Center`
- Team ID: `28a41b40-c2f3-4ba3-9ce8-9cb73d9f63ef`
- Team key: `UCS`

## Before Calling MCP Tools

Always read the relevant MCP tool descriptor before calling a tool. Use the Notion MCP for Notion search/fetch/query/update operations and the Linear MCP for project, issue, label, and status operations.

Common tools:
- Notion: `notion-fetch`, `notion-query-database-view`, `notion-update-page`
- Linear: `list_issues`, `save_issue`, `create_attachment`, `list_issue_labels`, `list_issue_statuses`

## Sync Responsibility

The job is not just to create Linear tickets. The job is to reconcile Notion and Linear so both systems agree.

When using this skill:
1. Look at what tickets are staged in Notion.
2. Look at what already exists in Linear.
3. Decide whether each Notion row should create a new Linear issue, link to an existing Linear issue, be skipped, or be blocked for user review.
4. Update Notion after successful Linear creation or matching with the created Linear ticket URL.
5. Return a clear sync report so the user can see what changed.

Do not leave Notion stale after creating or confidently matching a Linear issue.

## Which Notion Rows To Sync

Query the Cursor-ready view. Treat a row as syncable only when all of these are true:
- `Cursor ready` is `__YES__`
- `Destination` is `Linear`
- `Status` is `Ready for Linear`
- `Linear URL` is empty

Skip rows that are `Done`, `Archived`, already `In Linear`, or already have a `Linear URL`.

## Duplicate Detection

Never blindly create Linear issues.

For each Notion row:
1. Search Linear issues in project `9f249268-5ae4-48e1-871d-7bca6ee1f511`.
2. First search by the Notion row URL.
3. Then search by the exact `Work item` title.
4. If a likely match exists, update the Notion row with that Linear URL and set `Status` to `In Linear` instead of creating a duplicate.
5. If the match is ambiguous, report it as `blocked` and ask the user before changing anything.

Known overlap example: `Implement Solution Finder Step 2 / Step 3 order swap` is likely related to Linear issue `UCS-189`.

## Linear Issue Creation

Create issues with:
- `team`: `28a41b40-c2f3-4ba3-9ce8-9cb73d9f63ef`
- `project`: `9f249268-5ae4-48e1-871d-7bca6ee1f511`
- `state`: `Todo`
- `title`: Notion `Work item`
- `priority`: map Notion priority to Linear priority:
  - `High` -> `2`
  - `Medium` -> `3`
  - `Low` -> `4`
  - empty/unknown -> `0`

Use existing labels when they clearly apply:
- `solution-finder`
- `left-sidebar`
- `map-spatial`
- `analysis-dashboards`
- `foundation`
- `team-review`
- `discussion-required`
- `blocked-external`
- `Bug`
- `Improvement`
- `Feature`

Do not create new labels during sync unless the user explicitly asks.

## Description Template

Use this Linear description structure:

```markdown
## Problem

[Summarize the user-facing or project problem from AI interpretation, Quote / evidence, and Notes / next step.]

## Source Evidence

[Quote / evidence]

## Implementation Notes

[Notes / next step]

## Notion Source

[Notion row URL]

## Metadata

- Priority: [Notion Priority]
- Category: [Notion Category]
- Source: [Notion Source]
- People / source: [People / source]
- Related planning page: [Related planning page]
```

Keep descriptions concise. Preserve quoted evidence, but do not dump every Notion field if it repeats the same idea.

## Images And Screenshots

If a Notion work item contains screenshots, mockups, or other image attachments, carry them into Linear when possible.

Workflow:
1. Fetch the Notion page for the work item and inspect its content for image/file references.
2. If the image is available as a retrievable URL or file, download/read it and base64-encode the bytes.
3. After creating or matching the Linear issue, call Linear `create_attachment` with:
   - `issue`: Linear issue identifier, for example `UCS-123`
   - `base64Content`: base64-encoded image bytes
   - `filename`: a descriptive filename, for example `notion-screenshot-1.png`
   - `contentType`: the correct MIME type, for example `image/png`
   - `title`: short image title, when useful
4. Mention attached images in the sync report.

If the Notion image reference is private, expired, or not retrievable through available tools, do not block the entire ticket sync. Create or match the Linear issue, report the image as `blocked`, and ask the user for access or a downloadable file.

## Update Notion After Sync

After creating or confidently matching a Linear issue, update the Notion row:
- `Linear URL`: Linear issue URL
- `Status`: `In Linear`

Do not change `Cursor ready`, `Destination`, source fields, evidence, or notes unless the user explicitly asks.

## Sync Report

End with a concise report:
- `Created`: new Linear issues with Notion title and Linear key
- `Matched`: existing Linear issues linked back to Notion
- `Skipped`: rows already linked or not syncable
- `Blocked`: ambiguous matches or missing required fields

If no issues are created because matches already exist, say so clearly.
