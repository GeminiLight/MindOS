# SOP file template (MindOS knowledge base)

Use when **distilling experience into a new SOP** or normalizing an existing workflow doc. Place the file under whichever directory in the KB holds procedures (often names like `Workflows/`, `SOPs/`, `流程/` — infer from bootstrap tree, do not assume a fixed English folder name).

## Required structure

```markdown
# SOP: {Title}
<!-- keywords: {3-5 trigger keywords, English and Chinese} -->
<!-- last-used: {ISO date} -->
<!-- created: {ISO date} -->
<!-- requires-mcp: {comma-separated, e.g. mindos — or "none" if KB-only read/write via other means} -->
<!-- requires-kb-skills: {optional — paths or names of SKILL.md / instructions the agent must follow, or "none"} -->

## Prerequisites

**Before starting**, list what must already be true. If something is missing, **stop or take the degradation branch** (do not assume).

| Kind | What to record |
|------|----------------|
| **MCP / tools** | Which servers or tool families are required (e.g. `mindos`, browser, git). If the workflow only uses MindOS file APIs, say `mindos` or as appropriate. |
| **Agent skills** | KB-resident or host skills the executor must have loaded or be able to read (e.g. `skills/foo/SKILL.md`, or “follow root INSTRUCTION.md §X”). |
| **Environment** | CLI installed, network, API keys, logged-in state, OS constraints. |
| **KB state** | Files, directories, or tables that must exist first; optional “seed” notes. |

If there are **no** special dependencies, write explicitly: **None — MindOS MCP (or equivalent) only.**

## Applicable Scenarios

When to use this SOP. Trigger conditions, audience, and **non-goals** (what this SOP deliberately does not cover).

## Inputs and outputs (optional but recommended)

- **Inputs**: what the user or agent must supply (paths, decisions, raw text).
- **Outputs**: artifacts produced (files created/updated, messages to user).

## Steps

Each step includes:
1. **Action** — concrete operation
2. **Branch** — if X do A, if Y do B (mark "none" if no branching)
3. **Failure handling** — what can go wrong and how to respond

## Exit Conditions

When is the task complete. When to abort or escalate.

## Pitfall Log

Known edge cases and lessons learned. Append new entries each time the SOP is executed and a new issue is encountered.
```

## Metadata (HTML comments)

| Tag | Purpose |
|-----|---------|
| **`keywords`** | SOP recall via `mindos_search_notes` + parallel variants. English and Chinese. |
| **`last-used`** | Set to today’s date whenever the SOP is followed. |
| **`created`** | Set once at creation time. |
| **`requires-mcp`** | Quick machine/human scan: required MCP servers (or `none`). |
| **`requires-kb-skills`** | Optional: KB skill paths or “none”. |

Optional, when useful:

- **`<!-- related: path/to/other-sop.md -->`** — supersedes, depends-on, or paired workflows.
- **`<!-- owner: @handle or name -->`** — who curates this SOP.
- **`<!-- review-by: YYYY-MM -->`** — reminder to revalidate after product/tool changes.

## Authoring tips

- **Prerequisites vs scenarios**: *Prerequisites* = hard requirements before step 1; *Applicable scenarios* = when the workflow is the right choice among others.
- **Degradation path**: if MCP or a skill is missing, add a **Branch** in step 1 (“if tool unavailable → tell user to enable X / use manual checklist Y”).
- **Stable keywords**: avoid one-off typos in `keywords`; include synonyms you actually search for.
- **Link related SOPs** in Prerequisites or a short “See also” line under Applicable scenarios to avoid duplicate drift.
