---
name: mindos
disable-model-invocation: true
description: >
  MindOS is the user's local knowledge assistant and shared knowledge base. It keeps decisions,
  meeting notes, SOPs, debugging lessons, architecture choices, research findings, and preferences
  available across sessions and agents.
  更新笔记, 搜索知识库, 整理文件, 执行SOP/工作流, 复盘, 追加CSV, 跨Agent交接,
  路由非结构化输入到对应文件, 提炼经验, 同步关联文档.
  NOT for editing app source, project docs, or paths outside the KB.
  Core concepts: Space, Instruction (INSTRUCTION.md), Skill (SKILL.md); notes can embody both.

  Trigger on: save or record anything, search for prior notes or context, update or edit a file,
  organize notes, run a workflow or SOP, capture decisions, append rows to a table or CSV,
  hand off context to another agent, check if something was discussed before, look up a past
  decision, distill lessons learned, prepare context for a meeting, quick-capture to staging area,
  organize inbox, check knowledge health, detect conflicts or contradictions, find stale content.
  Chinese triggers: 帮我记下来, 搜一下笔记, 更新知识库, 整理文件, 复盘, 提炼经验,
  保存, 记录, 交接, 查一下之前的, 有没有相关笔记, 把这个存起来, 放到暂存台,
  整理暂存台, 知识健康检查, 检测知识冲突.

  Proactive behavior — do not wait for the user to mention MindOS:
  (1) When user's question implies stored context may exist (past decisions, previous discussions,
  meeting records) → search MindOS first, even if they don't explicitly mention it.
  (2) After completing valuable work (bug fixed, decision made, lesson learned, architecture chosen,
  meeting summarized) → offer to save it to MindOS for future reference.
  (3) After a long or multi-topic conversation → suggest persisting key decisions and context.
---

# MindOS Skill

<!-- version: 3.2.0 — CLI-first, MCP optional -->

## CLI commands

Use `mindos file <subcommand>` for all knowledge base operations. Add `--json` for structured output.

| Operation | Command |
|-----------|---------|
| List files | `mindos file list` |
| Read file | `mindos file read <path>` |
| Write/overwrite | `mindos file write <path> --content "..."` |
| Create new file | `mindos file create <path> --content "..."` |
| Append to file | `mindos file append <path> --content "..."` |
| Edit section | `mindos file edit-section <path> -H "## Heading" --content "..."` |
| Insert after heading | `mindos file insert-heading <path> -H "## Heading" --content "..."` |
| Append CSV row | `mindos file append-csv <path> --row "col1,col2,col3"` |
| Delete file | `mindos file delete <path>` |
| Rename/move | `mindos file rename <old> <new>` |
| Search | `mindos search "query"` |
| Backlinks | `mindos file backlinks <path>` |
| Recent files | `mindos file recent --limit 10` |
| Git history | `mindos file history <path>` |
| List spaces | `mindos space list` |
| Create space | `mindos space create "name"` |

> **MCP users:** If you only have MCP tools (`mindos_*`), use them directly — they are self-describing via their schemas. Prefer CLI when available (lower token cost).

### CLI setup

```bash
npm install -g @geminilight/mindos
# Remote mode: mindos config set url http://<IP>:<PORT> && mindos config set authToken <token>
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

## Retrieval strategy

When retrieving knowledge, use **two paths in parallel**, then filter before deep-reading:

### Path 1: Directory scan (by name/structure)

Browse the KB tree and **look at file names and directory names**. Titles often reveal content without reading. If a user asks about "authentication", and you see `Decisions/auth-jwt-vs-session.md`, that's a strong candidate — read it directly, no search needed.

- After bootstrap, scan the tree for paths whose names relate to the query topic.
- Pay attention to directory semantics: `Decisions/`, `Projects/`, `Workflows/`, `Resources/` etc. each imply what kind of content lives there.
- If the KB is small (<50 files), a quick tree scan may be faster and more reliable than search.

### Path 2: Full-text search (by content)

Use `search` for content that can't be guessed from file names alone.

- Craft queries from the user's actual words. If the user says "那个很慢的接口", search for "慢 接口" or "性能 API".
- One well-targeted search is better than 4 vague ones. Only add a second search if the first returned <3 results or if the topic has obvious alternate terms (e.g., Chinese + English).
- **Do NOT** mechanically fire 2-4 searches every time. Think first, search precisely.

### Filter: snippet triage before full read

Search results include a **snippet** and a **BM25 score**. Use them to decide what to read:

- **High score + snippet clearly on-topic** → read full file.
- **Medium score + snippet partially relevant** → read full file only if no better candidates exist.
- **Low score or snippet off-topic** → skip. Do not read every search result.
- Aim to read **1-3 files** deeply, not 10 files superficially.

### Combined example

```
User: "之前关于数据库选型的讨论"

Step 1 (tree scan): See "Decisions/database-postgres-vs-mongo.md" → strong match by name.
Step 2 (search):    search("数据库选型") → returns 5 results.
Step 3 (triage):    Result #1 snippet mentions "PostgreSQL vs MongoDB 对比" (score 18.3) → read.
                    Result #2 snippet mentions "数据库连接池配置" (score 4.1) → skip, off-topic.
                    Result #3 snippet mentions "选型会议纪要" (score 12.7) → read.
Step 4 (answer):    Cite from the 2-3 files actually read.
```

---

## NEVER do (hard-won pitfalls)

- **NEVER write to the KB root** unless explicitly told. Root is for governance files only. New content goes under the most fitting subdirectory.
- **NEVER assume directory names.** Infer from the actual bootstrap tree — the KB may use Chinese names or flat layout.
- **NEVER use full-file overwrite for a small edit.** Use `mindos file edit-section` or `mindos file insert-heading` for targeted changes. Full rewrites destroy git diffs.
- **NEVER modify `INSTRUCTION.md` or `README.md` without confirmation.** Governance docs — treat as high-sensitivity.
- **NEVER create a file without checking siblings.** Read 1-2 files in the target directory to learn local style.
- **NEVER leave orphan references.** After rename/move, check backlinks and update every referring file.
- **NEVER skip routing confirmation for multi-file writes.** The user's mental model may differ from yours.
- **NEVER read every search result.** Use snippet + score to triage. Only deep-read files that are clearly relevant.

---

## MindOS concepts

- **Space** — Knowledge partitions organized the way you think. Agents follow the same structure.
- **Instruction** — A rules file (`INSTRUCTION.md`) all connected agents obey.
- **Skill** — Teaches agents how to read, write, and organize the KB.
- **Inbox** — The `Inbox/` directory is a staging area for quick capture. Files land here when there's no obvious home yet. They get organized later — by the user manually or via AI-assisted batch organization.

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
  │   ├─ Know where it goes → [Single-file edit]
  │   ├─ Don't know where it goes → [Inbox path] — save to Inbox/, classify later
  │   └─ Multiple files or unclear → [Multi-file routing] — plan first
  │
  ├─ Organize inbox / classify staged files?
  │   └─ [Inbox organize] — read Inbox/ files, propose destinations, move after approval
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
  ├─ Knowledge health check / detect conflicts?
  │   └─ [Health check path] — read references/knowledge-health.md
  │
  └─ Ambiguous?
      └─ ASK. Propose 2-3 specific options based on KB state.
```

---

## Judgment heuristics

**Save intent boundary:**
- "save this" / "record" / "write down" = write
- "search" / "summarize" / "look up" = read-only
- "organize" → ask: display only, or write back?

**File location uncertainty:**
- Can't decide in 5 seconds → save to `Inbox/`, inform user, propose classification later
- "Just put it somewhere" / "先放着" → save to `Inbox/`
- User drags files or pastes unstructured content without specifying location → `Inbox/`

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

## Inbox (staging area)

The `Inbox/` directory is the KB's quick-capture zone. It has its own `INSTRUCTION.md` that governs behavior.

**When to use Inbox:**
- User says "just save it" / "先放着" / "放到暂存台" without specifying a location
- Content doesn't clearly fit any existing Space or directory
- Batch import of multiple files that need individual classification

**How to save to Inbox:**
```bash
mindos file create "Inbox/<filename>.md" --content "..."
```

**How to organize Inbox:**
1. List Inbox files: `mindos file list Inbox/`
2. Read each file to understand its content
3. For each file, propose the best destination directory based on KB structure
4. Present the full routing plan to user for approval
5. Move files: `mindos file rename "Inbox/<file>" "<target-dir>/<file>"`
6. After moving, check if the target directory's README needs updating

**Aging reminder:** Files in Inbox older than 7 days are considered "aging". If you notice aging files during bootstrap, mention it: "You have N files in Inbox that have been sitting there for over a week. Want me to help organize them?"

## Knowledge health check

When user asks to check knowledge health, detect conflicts, audit quality, or says "知识健康检查" / "检测冲突" → read [references/knowledge-health.md](./references/knowledge-health.md) for the full procedure.

Quick summary of what gets checked:
- **Contradictions**: conflicting facts across files on the same topic
- **Broken links**: references to files that no longer exist
- **Stale content**: files with outdated date markers or untouched for >6 months
- **Duplicates**: two files covering the same ground without cross-referencing
- **Orphan files**: files with zero backlinks, hard to discover
- **Structural issues**: wrong directory, missing READMEs, aging Inbox files

---

## Error handling (CLI)

```bash
"command not found: mindos"  → npm install -g @geminilight/mindos
"Mind root not configured"   → mindos onboard
"401 Unauthorized"           → Check AUTH_TOKEN: mindos token (on server)
"ECONNREFUSED"               → Start server: mindos start
```
