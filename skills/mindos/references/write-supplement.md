# MindOS Write & Workflow Supplement

<!-- Read this when handling any write, organize, SOP, structural, or retrospective task. -->
<!-- Skip for read-only lookups, Q&A, and summarization. -->

---

## Startup protocol

Run this before executing any write path:

1. **Bootstrap** — `mindos_bootstrap` (preferred) or manually read root `INSTRUCTION.md` + `README.md`.
2. **Discover structure** — `mindos_list_spaces` (top-level zones + README blurbs) and/or `mindos_list_files` + targeted `mindos_search_notes`. Never assume top-level names.
3. **Load local governance** — Read `README.md` / `INSTRUCTION.md` near the target path. Local conventions override global assumptions.
4. **Match existing SOP** — If the task is procedural: scan tree for a procedure-holding directory (names like `Workflows/`, `SOPs/`, `流程/` are hints — don't assume). Search by keywords + `<!-- keywords: -->` metadata. If found, read and follow. If execution diverges, propose updating the SOP after.
5. **Pre-write checks** — Confirm: target path exists or should be created; location is under a subdirectory (not root); current content is read; edit scope is minimal; backlink impact assessed for path changes.
6. **Execute edits.**

If context is missing, continue with best effort and state assumptions.

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
**Creating a new SOP** → first read [sop-template.md](./sop-template.md) for required structure.

### Structural changes
`get_backlinks` on the path being changed → present impact report (N files will need updates) → wait for confirmation → execute rename/move/delete → update every backlink → sync affected `README.md` files.

### Handoff / cross-agent continuation
Read the handoff document or last agent's progress notes → identify: current state, decisions already made, open items → continue from that state without re-running discovery already done → write progress back to the same handoff doc when done.
