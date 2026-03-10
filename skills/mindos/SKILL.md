---
name: mindos
description: >
  MindOS knowledge base operation guide for agent tasks on local markdown/csv knowledge bases.
  Use proactively whenever work touches note files, SOP/workflow docs, profile/context docs,
  CSV tables, knowledge-base organization, cross-agent handoff, or decision sync through MindOS MCP tools.
  Trigger on requests like "update notes", "search knowledge base", "organize files", "execute SOP",
  "review with our standards", "handoff to another agent", "sync decisions", "append CSV",
  "retrospective", "distill this conversation", "capture key learnings", "update related docs adaptively",
  and generally any local knowledge-maintenance workflow even if the user does not explicitly mention MindOS.
---

# MindOS Knowledge Base Operation Guide

Use this skill to operate safely and consistently in a MindOS-style local knowledge base.

## Core Principles

- Treat repository state as source of truth.
- Read before write.
- Prefer minimal, precise edits.
- Keep changes auditable and easy to review.

## Startup Protocol

Run this sequence before substantive edits:

1. Load root guidance.
- Prefer `mindos_bootstrap`.
- If unavailable, read root `INSTRUCTION.md` and root `README.md` directly.

2. Discover current structure dynamically.
- Use `mindos_list_files` and targeted `mindos_search_notes`.
- Do not assume fixed top-level directory names.

3. Load local guidance around target paths.
- Read nearby `README.md` / `INSTRUCTION.md` when present.
- Follow local conventions over global assumptions.

4. Execute edits.

If required context is missing, continue with best effort and state assumptions explicitly.

## Dynamic Structure Rules

- Do not hardcode a canonical directory tree.
- Infer conventions from neighboring files before creating or rewriting content.
- Mirror existing local patterns for naming, heading structure, CSV schema, and references.
- For new files, follow sibling style rather than inventing a new standard.

## Pre-Write Checklist

Before any non-trivial write, confirm all checks:

1. Target file/path is confirmed and exists or should be created.
2. Current content has been read, or absence is explicitly confirmed.
3. Local governance docs near the target path are considered.
4. Edit scope is minimal and aligned with user intent.
5. Reference/backlink impact is evaluated for path changes.

## Tool Selection Guide

### Discovery

- `mindos_bootstrap`: Load startup context.
- `mindos_list_files`: Inspect file tree.
- `mindos_search_notes`: Locate relevant files by keyword/scope/type/date.
- `mindos_get_recent`: Inspect latest activity.
- `mindos_get_backlinks`: Assess impact before rename/move/delete.

### Read and write

- `mindos_read_file`: Read file content.
- `mindos_write_file`: Use only for true full replacement.
- `mindos_create_file`: Create `.md`/`.csv` files.
- `mindos_delete_file`: Delete only with explicit user intent.
- `mindos_rename_file`, `mindos_move_file`: Structural edits with follow-up reference checks.

### Precise editing

- `mindos_read_lines`: Locate exact lines.
- `mindos_insert_lines`: Insert at index.
- `mindos_update_lines`: Replace specific range.
- `mindos_append_to_file`: Append to end.
- `mindos_insert_after_heading`: Insert under heading.
- `mindos_update_section`: Replace one markdown section.

### History and tables

- `mindos_get_history`, `mindos_get_file_at_version`: Investigate/recover history.
- `mindos_append_csv`: Append validated row after header check.

## Fallback Rules

- If some `mindos_*` tools are unavailable, use equivalent available tools while preserving the same safety discipline.
- If `mindos_bootstrap` is unavailable, do manual startup reads.
- If line/section edit tools are unavailable, emulate minimal edits through read plus constrained rewrite.

## Execution Patterns

### Capture or update notes

1. Search existing docs.
2. Read target docs and local rules.
3. Apply minimal edit.
4. Keep references consistent when paths change.

### Distill cross-agent discussion

1. Ask user to confirm key decisions and conclusions.
2. Locate destination docs.
3. Structure content as problem, decision, rationale, caveats, next actions.
4. Write back with minimal invasive edits.

Never imply access to private history from other agent sessions.

### Conversation retrospective and adaptive updates

1. Ask the user to confirm retrospective objective and scope for this conversation.
2. Extract reusable artifacts: decisions, rationale, pitfalls, unresolved questions, and next actions.
3. Route each artifact to the most appropriate existing file by searching and reading candidate docs.
4. If a matching file exists, update minimally at section/line level; if not, create a well-scoped new file near related docs.
5. Keep references/backlinks consistent and add a short trace note of what changed and why.
6. If confidence in file routing is low, present 1-2 candidate destinations and ask user to choose before writing.

### Execute or update workflow/SOP docs

1. Read workflow doc fully.
2. Execute stepwise and record outcomes.
3. If outdated, update only affected section and include rationale.

### CSV operations

1. Read header.
2. Validate field order, count, and type.
3. Append one row.

### Information collection and outreach

1. Locate authoritative contact/list sources.
2. Read relevant outreach/execution workflow docs.
3. Generate personalized outputs per target using profile tags, domain, and tone.
4. Write outcomes and next actions back for traceability.

### Project bootstrap with personal/team standards

1. Read preference/context docs such as stack, style, and constraints.
2. Read startup/engineering workflow docs.
3. Produce initial scaffold/configuration aligned with those standards.
4. Record key decisions and setup status for future handoff.

### Standards-aligned code review

1. Read applicable review and engineering standards.
2. Review naming, error handling, performance, security, and maintainability.
3. Output actionable findings with concrete file-level suggestions.
4. Keep tone and structure consistent with team review style.

### Cross-agent handoff continuity

1. Treat the shared knowledge base as handoff contract.
2. Before continuing work, read task state, decisions, and pending items.
3. Continue without re-discovery and preserve conventions/rationale.
4. Write back progress so later sessions can resume immediately.

### Relationship and follow-up management

1. Extract factual updates, intent, and sentiment from user-provided conversation notes.
2. Update relationship/contact records in structured form.
3. Generate next-step strategy, todo items, and suggested follow-up timing.
4. Store updates in reusable format for future session continuity.

## Safety Rules

- By default, treat root `INSTRUCTION.md`, root `README.md`, and any directory-level `INSTRUCTION.md` governance docs as high-sensitivity; ask for confirmation before modifying them.
- Ask before editing high-sensitivity governance files.
- Ask before high-impact actions.
- High-impact actions include bulk deletion, large-scale rename/move, broad directory restructuring, and cross-file mass rewrites.
- Never store secrets, tokens, or passwords.
- Never delete or rewrite outside user intent.

## Continuous Evaluation Loop

For important workflows, run a fast iterate loop:

1. Define 2-3 representative prompts for the current task type.
2. Run the workflow with this skill guidance.
3. Check result quality against user intent, local conventions, and safety rules.
4. Identify the smallest instruction change that would prevent observed failure modes.
5. Re-run prompts and keep only changes that improve consistency without overfitting.

## Quality Gates

Before finishing, verify:

1. Result directly answers user intent.
2. Updated content matches local style and structure.
3. References/links remain valid after structural edits.
4. No sensitive information was introduced.
5. Summary to user is specific enough for quick audit.

## Style Rules

- Follow repository-local style.
- Keep language concise and execution-oriented.
- Preserve useful structure like headings, checklists, tables, and references.
