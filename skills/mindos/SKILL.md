---
name: mindos
description: >
  MindOS knowledge base operation guide, only for agent tasks on files inside the MindOS knowledge base.
  Explains core concepts: Space (partitions by how you think), Instruction (agent-wide rules, often in INSTRUCTION.md),
  Skill (how agents read/write/organize the KB via SKILL.md packages). Notes can embody Instructions and Skills.
  Trigger only when the target files are inside the MindOS knowledge base directory.
  Typical requests: "update notes", "search knowledge base", "organize files", "execute SOP",
  "review with our standards", "handoff to another agent", "sync decisions", "append CSV",
  "retrospective", "distill this conversation", "capture key learnings", "update related docs adaptively",
  "route this to the right files", "update everything related", "sync this across my knowledge base".
  Do NOT trigger when: the target is a local code repository file (e.g. /code/xxx/wiki/*.md),
  the user provides an absolute path that is not under MindOS mindRoot,
  or the task involves modifying project source code or project documentation.
---

# MindOS Skill

Execute the user's task following the rules below.
User personalization rules (`user-skill-rules.md`) are included in bootstrap
context automatically when present. User rules override default rules on conflict.

---

<!-- version: 1.2.0 -->
# MindOS Operating Rules

## MindOS concepts

Shared vocabulary for the knowledge base and connected agents:

- **Space** — Knowledge partitions organized the way you think. You decide the structure, and AI agents follow it to read, write, and manage automatically.
- **Instruction** — A rules file that all AI agents obey. You write the boundaries once, and every agent connected to your knowledge base follows them.
- **Skill** — Teaches agents how to operate your knowledge base — reading, writing, organizing. Agents don't guess; they follow the skills you've installed.

**Notes as Instruction and Skill** — Instructions and Skills are usually expressed as Markdown in your tree (e.g. root or directory `INSTRUCTION.md`, `SKILL.md` under a skill folder). A note is not only free-form text: it can be the governance layer agents must follow (Instruction) or a procedure package agents load to execute (Skill).

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
- Use `mindos_list_spaces` (top-level zones + README blurbs), `mindos_list_files`, and targeted `mindos_search_notes` as needed.
- Do not assume fixed top-level directory names.

3. Load local guidance around target paths.
- Read nearby `README.md` / `INSTRUCTION.md` when present.
- Follow local conventions over global assumptions.

4. Match existing SOPs.
- If the task is procedural (multi-step, repeatable, or matches a known workflow category):
  search Workflows/ directory with `mindos_search_notes(scope: "Workflows/")` using task keywords.
- If a matching SOP is found, read it and follow its steps (adapting as needed).
- If the SOP's steps diverge from actual execution, propose updating the SOP after task completion.

5. Execute edits.

If required context is missing, continue with best effort and state assumptions explicitly.

## Dynamic Structure Rules

- Do not hardcode a canonical directory tree.
- Infer conventions from neighboring files before creating or rewriting content.
- Mirror existing local patterns for naming, heading structure, CSV schema, and references.
- For new files, follow sibling style rather than inventing a new standard.
- **Never create files or directories in the root directory unless the user explicitly requests it.** The root is reserved for top-level governance files (README, INSTRUCTION, CONFIG). New content should be placed under the most semantically appropriate existing subdirectory. Reason from the directory tree in context to find the right home.
- When creating a new file or directory, always determine the best parent directory first by reviewing the existing structure. If no existing directory is a clear fit, propose 1-2 candidate locations and ask the user before creating.
- **After any file create/delete/move/rename, always sync affected README files.** READMEs serve as directory indexes and navigation entry points. Any operation that changes a directory's contents must trigger an automatic check and update of the README in that directory and its parent directory.

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
- `mindos_list_spaces`: Top-level Mind Spaces with README blurbs (lighter than full tree).
- `mindos_search_notes`: Locate relevant files by keyword/scope/type/date. **When searching, always issue multiple parallel searches with different keywords upfront** — synonyms, abbreviations, English/Chinese variants, and broader/narrower terms. A single keyword is fragile; casting a wider net on the first try avoids wasted rounds.
- `mindos_get_recent`: Inspect latest activity.
- `mindos_get_backlinks`: Assess impact before rename/move/delete.

### Read and write

- `mindos_read_file`: Read file content.
- `mindos_write_file`: Use only for true full replacement.
- `mindos_create_file`: Create `.md`/`.csv` files.
- `mindos_create_space`: Create a Mind Space (directory + README + INSTRUCTION scaffold). Prefer over `create_file` when adding a new cognitive zone.
- `mindos_rename_space`: Rename a Space folder (directory). Do not use `rename_file` for folders.
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
- If `mindos_search_notes` returns no results, do not give up. The directory tree loaded at bootstrap is already in your context. Escalate progressively:
  1. Review the directory structure already in context. Reason about which directories and files are likely relevant based on naming, hierarchy, and topic proximity.
  2. Read the most promising candidate files directly to confirm relevance.
  3. If candidates are unclear, use `mindos_list_files` on a specific subdirectory for finer-grained structure.
  4. Try alternative search terms (synonyms, broader/narrower keywords, English/Chinese variants) as a parallel strategy.

## Safety Rules

- By default, treat root `INSTRUCTION.md`, root `README.md`, and any directory-level `INSTRUCTION.md` governance docs as high-sensitivity; ask for confirmation before modifying them.
- Ask before high-impact actions (bulk deletion, large-scale rename/move, broad directory restructuring, cross-file mass rewrites).
- **When an operation will touch multiple files, always present the full change plan to the user first.** List each target file, what will change, and why. Wait for approval before executing.
- Never store secrets, tokens, or passwords.
- Never delete or rewrite outside user intent.

## Quality Gates

Before finishing any operation, verify:

1. Result directly answers user intent.
2. Updated content matches local style and structure.
3. References/links remain valid after structural edits.
4. No sensitive information was introduced.
5. Summary to user is specific enough for quick audit.

## Preference Capture

### When to capture
The user expresses a preference correction (e.g., "don't do X", "next time remember to...", "this should go in... not in...").

### Confirm-then-write flow
1. **First occurrence of a new preference**: propose the rule and target file before writing.
   - "Record this preference to `user-skill-rules.md`? Rule: _{summary}_"
   - Write only after user confirms.
2. **Repeated confirmation on similar category**: after the user confirms the same category of preference 3+ times, auto-write future rules in that category without asking. Add an `auto-confirm: true` flag to the category header in `user-skill-rules.md`.
3. **User explicitly grants blanket permission** (e.g., "just record preferences directly"): set a top-level `auto-confirm-all: true` flag and skip confirmation for all future captures.

### File location
- Target: `user-skill-rules.md` in the knowledge base root (read by `mindos_bootstrap` automatically).
- If the file does not exist, create it with the template below on first confirmed write.

### File template
```markdown
# User Skill Rules
<!-- auto-confirm-all: false -->

## Preferences
<!-- Group by category. Mark auto-confirm: true on categories confirmed 3+ times. -->

## Suppressed Hooks
<!-- List post-task hooks the user has opted out of. -->
```

### Rule format
Each rule is a bullet under its category:
```markdown
### {Category}
<!-- auto-confirm: false -->
- {Rule description} — _{date captured}_
```

---

# Execution Patterns

Select the matching pattern below. All patterns share a common discipline: search -> read -> minimal edit -> verify -> summarize.

## Core Patterns (high-frequency)

### Capture or update notes
Search -> read target + local rules -> apply minimal edit -> keep references consistent.

### Context-aware question answering
Reason from directory tree -> read relevant files -> answer grounded in stored content with file citations -> if info is missing, say so explicitly.

### Structure-aware multi-file routing
For unstructured inputs (meeting notes, braindumps, chat exports) that belong in multiple places:
1. Parse input into semantic units (facts, decisions, action items, ideas).
2. For each unit, search + read candidate destination files.
3. **Present routing plan to user for approval** (table: what -> which file -> where).
4. Apply minimal edits. Create new files only when no existing file fits.
5. Summarize all changes for audit.

### Conversation retrospective
1. Confirm scope with user.
2. Extract reusable artifacts: decisions, rationale, pitfalls, next actions.
3. Route each to the best existing file (or create near related docs).
4. Add trace note of what changed and why. Ask user when routing confidence is low.

## Structural Change Patterns (always apply after file create/delete/move/rename)

- **Rename/move**: `get_backlinks` -> report impact -> confirm -> execute -> update all references -> verify no orphans.
- **Auto-sync READMEs**: After any structural change, update README in affected directories + parent directories to reflect current contents. This is automatic.

## Reference Patterns (use when task matches)

| Pattern | Key steps |
|---------|-----------|
| CSV operations | Read header -> validate fields -> append row |
| TODO/task management | Locate list -> read format -> minimal edit preserving conventions |
| SOP/workflow execution | Read doc fully -> execute stepwise -> update only affected section |
| Cross-agent handoff | Read task state + decisions -> continue without re-discovery -> write back progress |
| Knowledge conflict resolution | Multi-term search for old info -> list all affected files -> present change plan -> update after approval |
| Distill experience into SOP | Extract procedure → generalize → create under Workflows/ using the **SOP template** (see below) with keywords metadata, scenarios, branching steps, exit conditions, and pitfalls |
| Periodic review/summary | `get_recent`/`get_history` -> read changed files -> categorize -> structured summary |
| Handoff document synthesis | Identify sources -> read -> synthesize (background, decisions, status, open items) -> place in project dir |
| Relationship management | Extract updates from notes -> update contact records -> generate next-step strategy |
| Information collection | Locate sources -> read outreach docs -> personalize per target -> write back outcomes |
| Project bootstrap | Read preference/stack docs -> scaffold aligned with standards -> record decisions |
| Code review | Read review standards -> check naming/security/performance -> output actionable findings |
| Distill cross-agent discussion | Confirm decisions with user -> structure as problem/decision/rationale/next-actions -> minimal write-back |

### SOP Template

When creating a new SOP via "Distill experience into SOP", the file **must** follow this structure:

```markdown
# SOP: {Title}
<!-- keywords: {3-5 trigger keywords, English and Chinese} -->
<!-- last-used: {ISO date} -->
<!-- created: {ISO date} -->

## Applicable Scenarios
When to use this SOP. List trigger conditions and prerequisites.

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

Metadata rules:
- `keywords` — used by SOP recall search in Startup Protocol step 4. Include both English and Chinese terms.
- `last-used` — update to today's date each time the SOP is followed.
- `created` — set once at creation time.

## Interaction Rules

- **When a request is ambiguous or too broad (e.g., "help me organize things"), always ask for clarification before acting.** Propose specific options based on what you see in the knowledge base (recent changes, directory structure), but do not start reorganizing or rewriting without understanding the user's intent and scope.
- When presenting search results or options, prioritize brevity and relevance. Show the most likely match first.
- When answering questions from stored knowledge, always cite the source file path so the user can verify.

---

# Post-Task Hooks

After completing a task, check the conditions below. If one matches, make a one-line proposal to the user. If none match, end quietly.

## Discipline

1. Do not propose after simple operations (rename, append one line, read-only queries).
2. At most 1 proposal per task — pick the highest priority match.
3. One sentence + specific target file/path. Only expand if the user says yes.
4. Check user-skill-rules.md suppression section first — skip any suppressed hook.

## Default Hooks

### Experience capture (priority: high)
- Condition: task involved debugging, troubleshooting, or took multiple rounds to resolve.
- Propose: "Record this experience to {related experience file}?"
- Format: problem -> cause -> solution -> rule

### Consistency sync (priority: high)
- Condition: edited file A, and A is referenced by other files (check via `get_backlinks`).
- Propose: "{B} references what you just changed — sync it?"

### Linked update (priority: medium)
- Condition: changed a CSV/TODO item status, and related docs exist.
- Propose: "Sync the corresponding info in {related doc}?"

### Structure classification (priority: medium)
- Condition: created a new file in a temporary location or inbox.
- Propose: "Move this to {recommended directory}?"

### Pattern extraction (priority: low)
- Condition: 3+ structurally similar operations in the current session.
- Propose: "This operation repeated multiple times — create an SOP?"

### SOP drift (priority: medium)
- Condition: task was executed following an existing SOP, but actual steps diverged from documented steps.
- Propose: "Execution diverged from {SOP file} — update the SOP?"
- Action: update divergent steps, append new pitfalls, set `<!-- last-used: -->` to today.

### Conversation retrospective (priority: low)
- Condition: session >10 turns and involved decisions, trade-offs, or lessons.
- Propose: "This conversation had some decisions worth capturing — do a retrospective?"

## User-defined Hooks

<!-- Add your own hooks below, following the same format. -->
<!-- Example:
### Weekly report material (priority: medium)
- Condition: updated a Project-related file.
- Propose: "Record this change in the weekly report?"
-->
