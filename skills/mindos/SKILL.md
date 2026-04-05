---
name: mindos
description: >
  Operate a MindOS knowledge base: update notes, search, organize files, execute SOPs/workflows,
  retrospective, append CSV, cross-agent handoff, route unstructured input to the right files,
  distill experience, sync related docs. 更新笔记, 搜索知识库, 整理, 执行SOP, 复盘, 追加CSV, 交接, 路由到文件, 提炼经验.
  Use when the task targets files inside the user's MindOS KB (mindRoot).
  NOT for editing app source, project docs, or paths outside the KB.
  Core concepts: Space, Instruction (INSTRUCTION.md), Skill (SKILL.md); notes can embody both.
  Trigger when user asks to: save or record a note, search their knowledge base, update or edit
  a file, organize notes, run a workflow or SOP, capture decisions from a session, append rows
  to a table or CSV, hand off context to another agent — or says "帮我记下来" / "搜一下我的笔记" /
  "更新知识库" / "整理文件" / "执行工作流".
---

# MindOS Skill

<!-- version: 2.0.0 — unified CLI + MCP skill -->

## Choose your execution mode

**If you can run bash commands** (Claude Code, Gemini CLI, Codex, pi-coding-agent) → use the **CLI column**.
**If you only have MCP tools** (`mindos_*`) → use the **MCP column**.
**Both available** → prefer CLI (lower token cost).

| Operation | CLI (bash) | MCP (tool call) |
|-----------|-----------|-----------------|
| Bootstrap context | `mindos file list` | `mindos_bootstrap` |
| List spaces | `mindos space list` | `mindos_list_spaces` |
| List files | `mindos file list [dir]` | `mindos_list_files` |
| Search | `mindos search "query"` | `mindos_search_notes(query)` ×2-4 variants |
| Read file | `mindos file read <path>` | `mindos_read_file(path)` |
| Read lines | `mindos file read <path> --lines 10:20` | `mindos_read_lines(path, start, end)` |
| Create file | `mindos file create <path> --content "..."` | `mindos_create_file(path, content)` |
| Overwrite file | `mindos file create <path> --content "..." --force` | `mindos_write_file(path, content)` |
| Edit section | *(read → edit → overwrite)* | `mindos_update_section(path, heading, content)` |
| Insert after heading | *(read → edit → overwrite)* | `mindos_insert_after_heading(path, heading, content)` |
| Append to file | `echo "text" >> <full-path>` | `mindos_append_to_file(path, content)` |
| Delete file | `mindos file delete <path>` | `mindos_delete_file(path)` |
| Rename/move | `mindos file rename <old> <new>` | `mindos_rename_file(path, newName)` |
| Move file | `mindos file move <from> <to>` | `mindos_move_file(path, destination)` |
| Create space | `mindos space create "name"` | `mindos_create_space(name)` |
| Backlinks | `mindos api GET /api/backlinks?path=<path>` | `mindos_get_backlinks(path)` |
| Git history | `mindos api GET /api/git?op=log&path=<path>` | `mindos_get_history(path)` |
| Append CSV row | *(read → append → overwrite)* | `mindos_append_csv(path, values)` |
| Raw API | `mindos api <METHOD> <path>` | *(use specific tools above)* |

### CLI setup (skip if using MCP)

```bash
# Install
npm install -g @geminilight/mindos

# Remote mode (MindOS on another machine)
mindos config set url http://<IP>:<PORT>
mindos config set authToken <token>
# Get token on server: mindos token
```

---

## Rules

1. **Bootstrap first** — list the KB tree to understand structure before searching or writing.
2. **Default to read-only.** Only write when the user explicitly asks to save, record, organize, or edit. Lookup / summarize / quote = no writes.
3. **Rule precedence** (highest wins): user's current-turn instruction → `.mindos/user-preferences.md` → nearest directory `INSTRUCTION.md` → root `INSTRUCTION.md` → this SKILL's defaults.
4. **Multi-file edits require a plan first.** Present the full change list; execute only after approval.
5. After create/delete/move/rename → **sync affected READMEs** automatically.
6. **Read before write.** Always read a file before overwriting it. Never write based on assumptions.

---

## NEVER do (hard-won pitfalls)

- **NEVER write to the KB root** unless explicitly told. Root is for governance files only. New content goes under the most fitting subdirectory.
- **NEVER assume directory names.** Infer from the actual bootstrap tree — the KB may use Chinese names or flat layout.
- **NEVER use full-file overwrite for a small edit.** Use `update_section` / `update_lines` (MCP) or surgical read-edit-write (CLI). Full rewrites destroy git diffs.
- **NEVER search with a single keyword.** Fire 2-4 parallel searches (synonyms, abbreviations, Chinese/English variants).
- **NEVER modify `INSTRUCTION.md` or `README.md` without confirmation.** Governance docs — treat as high-sensitivity.
- **NEVER create a file without checking siblings.** Read 1-2 files in the target directory to learn local style.
- **NEVER leave orphan references.** After rename/move, check backlinks and update every referring file.
- **NEVER skip routing confirmation for multi-file writes.** The user's mental model may differ from yours.

---

## MindOS concepts

- **Space** — Knowledge partitions organized the way you think. Agents follow the same structure.
- **Instruction** — A rules file (`INSTRUCTION.md`) all connected agents obey.
- **Skill** — Teaches agents how to read, write, and organize the KB.

Notes can embody both Instruction and Skill — they're just Markdown files in the tree.

---

## Decision tree

```
User request
  │
  ├─ Lookup / summarize / quote?
  │   └─ [Read-only]: search → read → answer with citations. No writes.
  │
  ├─ Save / record / update / organize specific content?
  │   ├─ Single file → [Single-file edit]
  │   └─ Multiple files or unclear → [Multi-file routing] — plan first
  │
  ├─ Structural change (rename / move / delete / reorganize)?
  │   └─ [Structural path] — check backlinks before and after
  │
  ├─ Procedural / repeatable task?
  │   └─ [SOP path] — find and follow existing SOP, or create one
  │
  ├─ Retrospective / distill / handoff?
  │   └─ [Retrospective path]
  │
  └─ Ambiguous?
      └─ ASK. Propose 2-3 specific options based on KB state.
```

---

## Judgment heuristics

**Save intent boundary:**
- "帮我记下来" / "保存" = write
- "搜一下" / "总结" = read-only
- "整理一下" → ask: display only, or write back?

**File location uncertainty:**
- Can't decide in 5 seconds → use nearest existing directory, inform user
- "Just put it somewhere" → inbox, propose classification after

**Scope creep:**
- Input routes to >5 files → pause, confirm scope
- "Update all of these" spanning multiple topics → split into batches

**Citation:** KB-cited facts must include the file path.

---

## Post-task hooks

After write tasks (not simple reads), scan this table. At most 1 proposal; highest priority wins. Check `.mindos/user-preferences.md` suppression first.

| Hook | Priority | Condition |
|------|----------|-----------|
| Experience capture | high | Debugging, troubleshooting, or multi-round work |
| Consistency sync | high | Edited file with backlinks |
| SOP drift | medium | Followed SOP but diverged |
| Linked update | medium | Changed CSV/TODO status with related docs |
| Structure classification | medium | Created file in inbox/temp location |
| Pattern extraction | low | 3+ similar operations this session |

If a hook triggers → read [references/post-task-hooks.md](./references/post-task-hooks.md).

## Preference capture

When user expresses a standing preference → read [references/preference-capture.md](./references/preference-capture.md) and follow confirm-then-write flow.

## SOP authoring

When creating/rewriting an SOP → read [references/sop-template.md](./references/sop-template.md).

---

## Error handling (CLI)

```bash
"command not found: mindos"  → npm install -g @geminilight/mindos
"Mind root not configured"   → mindos onboard
"401 Unauthorized"           → Check AUTH_TOKEN: mindos token (on server)
"ECONNREFUSED"               → Start server: mindos start
```
