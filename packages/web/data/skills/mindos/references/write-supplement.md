# MindOS Write & Workflow Supplement

<!-- Always injected alongside SKILL.md by route.ts for every request. -->
<!-- For read-only lookups, Q&A, and summarization this context is also available. -->

---

## NEVER do (write-path specific)

- **NEVER use `mindos_write_file` as your first move.** Writing without reading first means replacing content you haven't seen. Even when you "know" the file's content, read it — your assumption may be stale.
- **NEVER create a Mind Space with `mindos_create_file`.** That only creates a plain directory — no README, no INSTRUCTION scaffolding. A Space missing its governance files is broken from birth. Use `mindos_create_space`.
- **NEVER write immediately after bootstrap.** Bootstrap gives you the top-level structure; it does NOT tell you whether a local `INSTRUCTION.md` near your target overrides the root rules. Read local governance before touching anything.
- **NEVER execute multi-file writes without first showing the routing table.** Even when destinations seem obvious — the user's mental model diverges from yours more often than intuition suggests. Show the table, wait for confirmation.
- **NEVER use `mindos_append_to_file` on structured files.** Blind appending ignores section order. If the file has headings, required fields, or schema constraints, use `insert_after_heading` or `update_section` to land content in the right place.

---

## Write tool selection

| Intent | Best tool | Avoid |
|--------|-----------|-------|
| Small text edit | `mindos_update_section` / `mindos_update_lines` / `mindos_insert_after_heading` | `mindos_write_file` for small changes |
| Append to end | `mindos_append_to_file` | Rewriting entire file to add a line |
| Full file replacement | `mindos_write_file` | Using this when a section edit suffices |
| New file | `mindos_create_file` | Creates parent dirs but does NOT scaffold Space files |
| New Mind Space (zone + README + INSTRUCTION) | `mindos_create_space` | The only way to create a Space. `create_file` creates plain folders |
| Rename a Space directory | `mindos_rename_space` | `rename_file` (files only; does not rename folders) |
| Add CSV row | `mindos_append_csv` (validates header) | Manual string append without header check |
| Check impact before rename | `mindos_get_backlinks` | Renaming without checking references |
| Inspect recent changes | `mindos_get_recent` | Guessing what changed recently |
| Recover old version | `mindos_get_file_at_version` | Asking user to recall what was there |

**Fallback:** Line/section tools unavailable → read + constrained `mindos_write_file` (simulate minimal edit).

---

## Startup protocol

Run this before executing any write path:

1. **Bootstrap** — `mindos_bootstrap` (preferred) or manually read root `INSTRUCTION.md` + `README.md`.
2. **Discover structure**
   - Only need top-level zones? → `mindos_list_spaces` (lighter; includes README blurbs)
   - Need a specific file path? → confirm zone with `mindos_list_spaces`, then `mindos_list_files` inside that zone
   - Know keywords? → fire 2-4 parallel `mindos_search_notes` covering CN/EN variants and abbreviations
   - **Never assume top-level directory names** — the user's KB may use Chinese, pinyin, or unconventional hierarchy
3. **Load local governance** — Read `README.md` / `INSTRUCTION.md` near the target path. Local conventions override global assumptions.
4. **Match existing SOP** — If the task is procedural: scan tree for a procedure-holding directory (names like `Workflows/`, `SOPs/`, `流程/` are hints — don't assume). Search by keywords + `<!-- keywords: -->` metadata. If found, read and follow. If execution diverges, propose updating the SOP after.
5. **Pre-write checks** — Confirm: target path exists or should be created; location is under a subdirectory (not root); current content is read; edit scope is minimal; backlink impact assessed for path changes.
6. **Execute edits.**

If context is missing, continue with best effort and state assumptions.

---

## Execution patterns

| Pattern | When | Key steps |
|---------|------|-----------|
| **Single-file edit** | One clear target file | Startup → read target + local conventions → minimal edit → verify → summarize |
| **Multi-file routing** | Unstructured input, multiple destinations | Parse into semantic units → routing table → confirm → edit → summarize |
| **Conversation retrospective** | Distill / capture session | Confirm scope → extract decisions/pitfalls/actions → route → trace changes |
| **SOP execution** | Repeatable procedure | Read SOP fully → execute stepwise → update stale sections → propose SOP update if diverged |
| **Structural change** | Rename / move / delete | `get_backlinks` → impact report → confirm → execute → update refs → sync READMEs |
| **CSV append** | Add row to a table | Read header → validate fields → `mindos_append_csv` |
| **Cross-agent handoff** | Continue another agent's work | Read task state + decisions → continue without re-discovery → write back progress |
| **Periodic review** | Summarize recent changes | `get_recent`/`get_history` → read changed files → structured summary |
| **Handoff doc** | Create a briefing | Read sources → synthesize (background, decisions, status, open items) → place in project dir |

---

## Detailed execution steps

### Single-file edit
Search → read target + read 1-2 sibling files for local conventions → apply minimal edit (prefer `update_section` / `update_lines` / `insert_after_heading` over full rewrite) → verify heading/style match → summarize what changed.

### Multi-file routing
Parse unstructured input into discrete semantic units → for each unit: search 2-4 keyword variants to find best-fit file → **present routing table** (content snippet → target file → insertion point) → wait for user confirmation → execute edits one file at a time → summarize all changes with file paths.

### Conversation retrospective
Confirm scope (which session? which topics?) → extract: decisions made, rationale, pitfalls encountered, next actions → for each artifact, find the best existing file via search → route each to the right place → append a one-line change trace per file touched.

### SOP execution
Read the full SOP before starting (never skim) → execute step by step, checking off as you go → if a step is stale or diverges from current KB state, note it → after completion, propose a targeted SOP update for any diverged steps.
**Creating a new SOP** → first read [references/sop-template.md](./references/sop-template.md) for required structure.

### Structural changes
`get_backlinks` on the path being changed → present impact report (N files will need updates) → wait for confirmation → execute rename/move/delete → update every backlink → sync affected `README.md` files.

### Handoff / cross-agent continuation
Read the handoff document or last agent's progress notes → identify: current state, decisions already made, open items → continue from that state without re-running discovery already done → write progress back to the same handoff doc when done.

---

## Post-task hooks

After **write tasks** (not simple single-file edits or read-only), scan this table. If a condition matches, make a one-line proposal. At most 1 proposal; pick highest priority. Check `.mindos/user-preferences.md` suppression section first. Skip all if user asked for quiet mode.

| Hook | Priority | Condition |
|------|----------|-----------|
| Experience capture | high | Debugging, troubleshooting, or took multiple rounds |
| Consistency sync | high | Edited file A which has backlinks (check `get_backlinks`) |
| SOP drift | medium | Followed an SOP but execution diverged from its steps |
| Linked update | medium | Changed a CSV/TODO status and related docs exist |
| Structure classification | medium | Created a file in a temporary location or inbox |
| Pattern extraction | low | 3+ structurally similar operations this session |
| Conversation retrospective | low | Session >10 turns with decisions or trade-offs |

If a hook triggers → read [references/post-task-hooks.md](./references/post-task-hooks.md) for the propose format and any user-defined hooks. If nothing matches, end quietly — do not read the file.

## Preference capture

When the user expresses a standing preference ("don't do X", "always put Y in Z"), read [references/preference-capture.md](./references/preference-capture.md) and follow the confirm-then-write flow to `.mindos/user-preferences.md`.
**Do NOT read** preference-capture unless the user actually expressed a preference to persist.

## SOP authoring

When creating or rewriting a workflow SOP, **MANDATORY — read [references/sop-template.md](./references/sop-template.md)** for required structure (prerequisites, steps with branches, exit conditions, pitfall log).
**Do NOT read** sop-template for SOP execution (only for SOP creation/editing).
