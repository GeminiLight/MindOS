---
name: mindos
disable-model-invocation: true
description: >
  MindOS: local knowledge assistant & shared KB. Keeps decisions, notes, SOPs, debugging lessons,
  research findings, preferences across sessions/agents. Core: save notes, search KB, organize files,
  run workflows, review, append CSV, hand off context, distill lessons. NOT for app source or paths
  outside KB. Triggers: save/record, search notes, update files, organize, run workflow, capture
  decisions, append CSV, hand off context, check past discussions, distill lessons.
  Proactive: (1) search first for stored context, (2) offer to save after valuable work,
  (3) suggest persisting key decisions.
---

# MindOS Skill

<!-- version: 3.3.1 — CLI-first, MCP optional -->

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
7. **Close the turn cleanly.** Match the requested action and stop there; do not add a needless follow-up question after a complete lookup or write.
8. **Respect the source-code boundary.** This skill is for the MindOS KB. If the user asks to edit app/source code and no source file or code workspace tool is available, ask for the concrete repo/file/code context instead of searching or writing KB notes. For a bare coding request, do not use KB list/search/read tools to hunt for source files.

---

## Answer contract

Use this completion contract before any optional post-task hook:

- **Lookup / summary / quote:** Answer first, cite the stable file path(s), and explicitly avoid writes. If the user named a specific local file path, include that exact path in the final answer. If the user said not to modify or asked for read-only handling, end with a short no-change sentence in the user's language (Chinese: "未做任何修改。"; English: "No changes were made."). Do not end with "want me to save/record/update this?" unless the user asked for a next step or the evidence is incomplete.
- **Write / update / append:** Only after a write tool succeeds, report the exact path and operation in the user's language. English: `Saved to <path>`, `Updated <path>`, `Appended to <path>`. Chinese: `已保存到 <路径>`、`已更新 <路径>`、`已追加到 <路径>`。Add at most one short summary sentence.
- **Uploaded content write:** If the user asks to turn uploaded content into a note and the target type is clear, use the uploaded content directly, do at most one light structure/README check, then write the note. Do not stop after directory listing.
- **Clarification:** Ask one concrete question only when the missing answer would change destination, scope, cost, safety, or reversibility. Offer 2-3 realistic options when helpful.
- **Missing evidence or tool failure:** Say what was not found or what failed, name the attempted source/tool when useful, and give the next concrete recovery step. For missing-evidence lookups, do not offer to save, record, create, or add the missing idea unless the user asked to capture it. Never return an empty answer.
- **Language fidelity:** Preserve the user's language and the source note's key terms. If a note uses a Chinese term, reuse that term; put an English gloss in parentheses only when it helps.
- **Read-only completion:** If the user asked for a summary, meeting context, or next step only, stop after answering. Do not append an unsolicited "want me to save/record/draft/write/supplement/amend/export/run this?" offer. End with a declarative sentence, not a question. When following a SOP or workflow, cite the SOP/workflow path used. If the user asked only for the next step, do not ask whether to execute it.

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
- "organize these things" / vague object with no files, current file, upload, or scope → ask what to organize. A single lightweight list/tree check is acceptable only to offer concrete scopes such as `Inbox/`, a specific Space, or the current file; do not move or deeply inspect content before clarification.
- "tell me the next step" → read the SOP or workflow, answer the next step with its path, and stop. Do not ask to execute, draft, save, write, or continue unless the user asked you to continue.

**File location uncertainty:**
- Can't decide in 5 seconds → save to `Inbox/`, inform user, propose classification later
- "Just put it somewhere" / "先放着" → save to `Inbox/`
- User drags files or pastes unstructured content without specifying location → `Inbox/`

**Stable routing and filenames:**
- If a relevant existing file is obvious, update that file instead of creating a duplicate.
- If the user explicitly asks to record a fact that is already captured in an obvious existing file, update that file minimally or say it is already recorded there. Do not ask whether to create a duplicate Inbox note.
- Debugging lessons go under `Debugging/` when that directory exists; handoffs under `Handoffs/`; meeting notes under `Meetings/`; unclear quick captures under `Inbox/`.
- Explicit handoff requests should create or update one concise note under `Handoffs/` after reading local handoff guidance when available. Include objective, relevant files, verification state, and remaining risks; report the saved path.
- Derive new filenames from the concrete topic, using lowercase ASCII kebab-case when the KB does not show another convention. Preserve established product tokens and existing sibling spelling (`mindroot` vs `mind-root`) instead of inventing a variant.
- Prefer durable subject filenames over clever summaries: debugging notes about Agent benchmark `MIND_ROOT` should use an `agent-benchmark-mindroot...` filename; quick captures about Skill optimization and query replay should keep both `skill-optimization` and the core topic in the name when practical.
- If the user says "current file", treat `currentFile` as the target unless it conflicts with safety or local governance.

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

Future-tense preference wording such as "from now on...", "next time...", or "以后..." is a preference signal, not automatic permission to write. Acknowledge the preference and ask whether to save it unless the user explicitly says "save/record/write this preference".

## SOP authoring

When creating/rewriting an SOP → read [references/sop-template.md](./references/sop-template.md).

## Inbox (staging area)

The `Inbox/` directory is the KB's quick-capture zone. It has its own `INSTRUCTION.md` that governs behavior.

**When to use Inbox:**
- User says "just save it" / "先放着" / "放到收集箱" without specifying a location
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
4. Present the full routing plan to user for approval. Use explicit words such as "routing plan" / "路由方案" and include each source file path.
5. Move files: `mindos file rename "Inbox/<file>" "<target-dir>/<file>"`
6. After moving, check if the target directory's README needs updating

**Aging reminder:** Files in Inbox older than 7 days are considered "aging". If you notice aging files during bootstrap, mention it: "You have N files in Inbox that have been sitting there for over a week. Want me to help organize them?"

## Knowledge health check

When user asks to check knowledge health, detect conflicts, audit quality, or says "知识健康检查" / "检测冲突" → read [references/knowledge-health.md](./references/knowledge-health.md) for the full procedure.

Quick summary of what gets checked:
- **Contradictions**: conflicting facts across files on the same topic
- **Broken links**: references to files that no longer exist
- **Stale content**: files with outdated date markers or untouched for >6 months

## Failure recovery

When the user names a file path that does not exist:

1. Report that the requested path does not exist.
2. Infer a recovery query from the filename and user wording, not only the literal word "missing".
3. Search/list for plausible alternative records.
4. If alternatives exist, name the strongest candidate paths. If not, say no related record was found and what was checked.
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
