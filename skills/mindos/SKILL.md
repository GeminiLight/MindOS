---
name: mindos
description: >
  MindOS knowledge base operation guide, only for agent tasks on files inside the MindOS knowledge base (mindRoot path).
  Trigger only when the target files are inside the MindOS knowledge base directory.
  Typical requests: "update notes", "search knowledge base", "organize files", "execute SOP",
  "review with our standards", "handoff to another agent", "sync decisions", "append CSV",
  "retrospective", "distill this conversation", "capture key learnings", "update related docs adaptively",
  "route this to the right files", "update everything related", "sync this across my knowledge base".
  Do NOT trigger when: the target is a local code repository file (e.g. /code/xxx/wiki/*.md),
  the user provides an absolute path that is not under MindOS mindRoot,
  or the task involves modifying project source code or project documentation.
---

# MindOS Knowledge Base Operation Guide

Use this skill to operate safely and consistently in a MindOS-style local knowledge base.

## Core Principles

- Treat repository state as source of truth.
- **The directory tree loaded at bootstrap is a first-class semantic asset.** Directory names, file names, and their hierarchy encode what the user has stored and how they organize their thinking. Always reason from this structure before resorting to search — it often tells you where content lives without any tool call.
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
- **Never create files or directories in the root directory unless the user explicitly requests it.** The root is reserved for top-level governance files (README, INSTRUCTION, CONFIG). New content should be placed under the most semantically appropriate existing subdirectory. Reason from the directory tree in context to find the right home.
- When creating a new file or directory, always determine the best parent directory first by reviewing the existing structure. If no existing directory is a clear fit, propose 1-2 candidate locations and ask the user before creating.
- **After any file create/delete/move/rename, always sync affected README files.** READMEs serve as directory indexes and navigation entry points. Any operation that changes a directory's contents (creating, deleting, moving, or renaming files or subdirectories) must trigger an automatic check and update of the README in that directory and its parent directory, so they accurately reflect the current structure. This requires no user prompting — it is basic structural consistency discipline.

## Pre-Write Checklist

Before any non-trivial write, confirm all checks:

1. Target file/path is confirmed and exists or should be created.
2. **Target location is under an appropriate subdirectory, not the root.** If unsure which directory fits best, propose candidates and ask the user.
3. Current content has been read, or absence is explicitly confirmed.
4. Local governance docs near the target path are considered.
5. Edit scope is minimal and aligned with user intent.
6. Reference/backlink impact is evaluated for path changes.

## Tool Selection Guide

### Discovery

- `mindos_bootstrap`: Load startup context.
- `mindos_list_files`: Inspect file tree.
- `mindos_search_notes`: Locate relevant files by keyword/scope/type/date. **When searching, always issue multiple parallel searches with different keywords upfront** — synonyms, abbreviations, English/Chinese variants, and broader/narrower terms. A single keyword is fragile; casting a wider net on the first try avoids wasted rounds.
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
- If `mindos_search_notes` returns no results, do not give up. The directory tree loaded at bootstrap is already in your context — directory names, file names, and their hierarchy are semantically rich and often enough to infer where content lives. Escalate progressively:
  1. Review the directory structure already in context. Reason about which directories and files are likely relevant based on naming, hierarchy, and topic proximity.
  2. Read the most promising candidate files directly to confirm relevance.
  3. If candidates are unclear, use `mindos_list_files` on a specific subdirectory for finer-grained structure not captured at bootstrap.
  4. Try alternative search terms (synonyms, broader/narrower keywords, English/Chinese variants) as a parallel strategy.

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

### Structure-aware multi-file routing

A single unstructured input (chat export, meeting notes, voice transcript, braindump) often contains information that belongs in multiple places. MindOS knows the full directory tree and inter-document relationships from bootstrap, so it can decompose the input and route each piece to the right file — in one pass, without the user manually specifying destinations.

1. Load structure context via `mindos_bootstrap` and `mindos_list_files` to understand the full knowledge topology.
2. Parse the input into distinct semantic units (facts, decisions, ideas, action items, relationship updates, new concepts).
3. For each unit, search and read candidate destination files to find the best match by topic, scope, and existing structure.
4. **Before writing, present the routing plan to the user for approval.** Show a clear summary table: what will be written, to which file, at which location. Only proceed after user confirms.
5. Apply minimal edits to each target file at the correct location (section, heading, or line level). Create new files only when no existing file is a reasonable fit.
6. If routing confidence is low for any unit, present candidate destinations and ask the user to choose.
7. After all writes, summarize what changed and where, so the user can audit the full update in one glance.

This pattern is what makes MindOS fundamentally different from document-per-document tools: the structural prior means one input triggers coordinated updates across the knowledge base, and nothing falls through the cracks because the agent sees the whole graph.

### Knowledge conflict resolution

When a decision, preference, or fact changes (e.g., "we switched from Redis to Memcached"), all documents referencing the old information must be updated consistently.

1. Search the entire knowledge base for references to the outdated information (use multiple search terms, including abbreviations and variants).
2. List all affected files and the specific lines/sections that reference the old decision.
3. Present the full change plan to the user: which files, what will change, and why.
4. After approval, update each file with minimal targeted edits.
5. Verify no inconsistent references remain after the update.

### Distill experience into new SOP

When the user has just completed a complex task and wants to capture the process for reuse, create a structured, reusable workflow document — not just a one-time record.

1. Extract the procedure, decision points, prerequisites, and common pitfalls from the user's description.
2. Generalize: remove one-off specifics, keep the reusable pattern.
3. Find the appropriate location under Workflows/ or a similar directory. Check for existing SOP templates or sibling format.
4. Create the SOP with clear sections: prerequisites, step-by-step procedure, troubleshooting/pitfalls, and references to related docs.
5. Link the new SOP from relevant index files if applicable.

### Periodic review and summary

When the user asks for a weekly review, monthly recap, or progress summary:

1. Use `mindos_get_recent` and/or `mindos_get_history` to identify files changed in the relevant time window.
2. Read changed files to understand what happened.
3. Categorize changes by area (projects, profile, workflows, etc.).
4. Produce a structured summary: key decisions made, progress on active projects, open items, and things that need attention.
5. Offer to write the summary back as a review note if the user wants to keep it.

### Context-aware question answering

When the user asks a question about themselves, their projects, preferences, or stored knowledge:

1. Reason from the directory tree to identify which files likely contain the answer.
2. Read the relevant files — do not guess or assume from general knowledge.
3. Answer grounded in actual stored content, citing source files.
4. If the information is incomplete or missing, say so explicitly rather than fabricating.

### TODO and task list management

When the user wants to add, complete, or modify tasks:

1. Locate the TODO file or task list (search or navigate from directory structure).
2. Read current content to understand existing format (checkboxes, priorities, categories).
3. Make minimal targeted edits: mark items, add items, or update status.
4. Preserve all other existing content and formatting.
5. Follow the existing format conventions exactly — do not introduce a new task format.

### Handoff document synthesis

When the user needs to create a handoff or briefing document for someone else (new team member, collaborator, manager):

1. Identify all relevant source files across the knowledge base for the topic (project docs, decisions, status, tech stack, open items).
2. Read each source file to extract the relevant information.
3. Synthesize into a single coherent handoff document with sections: background, key decisions and rationale, current status, open items, and further reading (with links to source files).
4. Place the handoff document in the appropriate project directory, not the root.

### Structural rename and move

When renaming or moving files/directories:

1. Use `mindos_get_backlinks` to find all files referencing the target path.
2. Report the full impact scope to the user: how many files, which ones, what references.
3. Ask for confirmation before proceeding.
4. Execute the rename/move.
5. Update all broken references in affected files.
6. Verify no orphaned links remain.

### Auto-sync READMEs after directory changes

After any operation that affects directory structure (creating, deleting, moving, or renaming files or subdirectories):

1. Identify affected directories: the directory where the file was (source), the directory where it now is (destination), and their parent directories.
2. Read the README in each affected directory (if one exists).
3. Update file listings, indexes, and navigation in each README to accurately reflect the current directory contents.
4. If the README contains file descriptions or links, update paths and names accordingly.
5. If a directory has no README but sibling directories generally do, consider creating one for the new directory.

This step is an automatic follow-up to all structural change operations — it does not require a separate user request.

## Interaction Rules

- **When a request is ambiguous or too broad (e.g., "help me organize things"), always ask for clarification before acting.** Propose specific options based on what you see in the knowledge base (recent changes, directory structure), but do not start reorganizing or rewriting without understanding the user's intent and scope.
- When presenting search results or options, prioritize brevity and relevance. Show the most likely match first.
- When answering questions from stored knowledge, always cite the source file path so the user can verify.

## Safety Rules

- By default, treat root `INSTRUCTION.md`, root `README.md`, and any directory-level `INSTRUCTION.md` governance docs as high-sensitivity; ask for confirmation before modifying them.
- Ask before editing high-sensitivity governance files.
- Ask before high-impact actions.
- High-impact actions include bulk deletion, large-scale rename/move, broad directory restructuring, and cross-file mass rewrites.
- **When an operation will touch multiple files, always present the full change plan to the user first.** List each target file, what will change, and why. Wait for approval before executing. This is non-negotiable — users must be able to see and control multi-file updates before they happen.
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
