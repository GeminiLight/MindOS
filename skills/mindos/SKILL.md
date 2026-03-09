---
name: mindos
description: >
  MindOS knowledge base operation guide. Use this Skill whenever interacting with
  the MindOS knowledge base — reading/writing notes, searching files, managing SOPs,
  maintaining Profiles, operating CSV data tables, executing workflows, or reviewing
  Agent outputs. Trigger when the user mentions "knowledge base", "notes", "MindOS",
  "my files", "SOP", "Profile", "jot this down", "organize my notes",
  "update the knowledge base", "search my notes", or any operation involving the
  my-mind/ directory. Even if the user doesn't explicitly mention MindOS, proactively
  use this Skill whenever the task involves personal knowledge management, file
  organization, workflow execution, or Agent collaboration context.
---

# MindOS Knowledge Base Operation Guide

MindOS is a **Human-AI Collaborative Mind System** — a local-first knowledge base that ensures your notes, workflows, and personal context are both human-readable and directly executable by AI Agents.

This Skill defines the complete protocol for you (the Agent) to operate within a MindOS knowledge base.

---

## Core Philosophy

**Human Thinks Here, Agent Acts There.**

Three pillars:
1. **Global Mind Sync** — Record once, reuse everywhere. Via MCP, any Agent connects zero-config to your Profile, SOPs, and experiences.
2. **Transparent & Controllable** — Every Agent retrieval, reflection, and action is distilled into local plain text. Humans hold absolute audit and correction rights.
3. **Symbiotic Evolution** — The Prompt-Driven recording paradigm turns everyday notes into Agent execution instructions. Humans and AI co-evolve in a single Shared Mind.

> **Foundation: Local-first.** All data stored locally as Markdown/CSV plain text — zero privacy concerns.

---

## Bootstrap Protocol

When entering the knowledge base, load context in this order:

1. **Read `INSTRUCTION.md`** — System rules (MUST)
2. **Read `README.md`** — Directory index and responsibility map (MUST)
3. Route to the target directory based on task type, read its `README.md` (SHOULD)
4. If the target directory has an `INSTRUCTION.md`, read its local rules (SHOULD)
5. Begin execution

Steps 1-2 are non-negotiable. Blind execution without context leads to rule violations.

---

## Knowledge Base Structure

```
my-mind/
├── INSTRUCTION.md          # System rules (source of truth)
├── README.md               # Root index — directory structure & responsibilities
├── TODO.md                 # Pending tasks (single source)
├── CHANGELOG.md            # Completed items (reverse chronological)
├── Profile/                # Identity, preferences, style, goals, connections
├── Configurations/         # Agent tool configs (MCP, Skills, Claude Code, etc.)
├── Workflows/              # SOPs & workflows (directly executable instruction docs)
├── Projects/               # Product projects (proposals, PRDs, competitive analysis)
├── Resources/              # Product library, AI Scholars, GitHub Projects
├── Research/               # Research materials & notes
└── Reference/              # Reference docs & templates
```

---

## Available Toolset (20 MCP Tools)

Use these tools to operate on the knowledge base:

### File Operations

| Tool | Purpose | When to Use |
|------|---------|-------------|
| `mindos_list_files` | File tree | Understand the full knowledge base, locate files |
| `mindos_read_file` | Read file (paginated) | Read any .md/.csv file |
| `mindos_write_file` | Overwrite file | Major rewrites (protected files blocked) |
| `mindos_create_file` | Create new file | New .md or .csv files |
| `mindos_delete_file` | Delete file | Remove unneeded files (protected files blocked) |
| `mindos_rename_file` | Rename file | In-place rename |
| `mindos_move_file` | Move file | Move file and report affected backlinks |

### Search & Discovery

| Tool | Purpose | When to Use |
|------|---------|-------------|
| `mindos_search_notes` | Full-text search | Filter by keyword, scope, type, date |
| `mindos_get_recent` | Recently modified | Understand recent work state |
| `mindos_get_backlinks` | Backlinks | Find all files referencing a given file |

### Version History

| Tool | Purpose | When to Use |
|------|---------|-------------|
| `mindos_get_history` | Git commit history | View a file's modification trail |
| `mindos_get_file_at_version` | Read historical version | Roll back to a specific Git commit |

### Precise Editing

| Tool | Purpose | When to Use |
|------|---------|-------------|
| `mindos_read_lines` | Read by line number | Locate exact lines before editing |
| `mindos_insert_lines` | Insert lines | Add content at a specific position |
| `mindos_update_lines` | Replace line range | Precisely replace specific lines |
| `mindos_append_to_file` | Append content | Add content to end of file |
| `mindos_insert_after_heading` | Insert after heading | Add content below a Markdown heading |
| `mindos_update_section` | Replace section | Replace an entire Markdown section |

### Data Table Operations

| Tool | Purpose | When to Use |
|------|---------|-------------|
| `mindos_append_csv` | Append CSV row | Add a new record to a data table |

### Bootstrap Context

| Tool | Purpose | When to Use |
|------|---------|-------------|
| `mindos_bootstrap` | Load startup context | Read INSTRUCTION.md + README.md in one call |

---

## Operating Rules

### Read-Before-Write Discipline

- **You MUST read before writing.** Never overwrite content based on assumptions. This is a hard rule.
- Read CSV headers before appending to ensure field alignment.
- Prefer precise editing tools (`insert_lines`, `update_section`) over unnecessary full-file overwrites.

### File Naming

| Type | Convention | Example |
|------|-----------|---------|
| Content files | emoji + Chinese name, English proper nouns kept | `👤 Identity.md` |
| Directories | English, capitalized | `Workflows/` |
| System files | ALL-CAPS English, no emoji | `README.md`, `TODO.md` |

### References & Sync

Files reference each other via relative paths:
```markdown
See `Profile/👤 Identity.md`
Details in `Workflows/Research/README.md`
```

**Must-sync operations** (structural changes):
- Add/delete/rename a top-level subdirectory → Update root `README.md`
- Delete/rename a file → Update all `README.md` files that reference it

**Should-sync operations** (content changes):
- Add a new file → Update the parent directory's `README.md`

### TODO & CHANGELOG

- `TODO.md`: Single source for pending tasks. Format: `- [ ] task description`
- `CHANGELOG.md`: Completed items in reverse chronological order. Migrate done items from TODO to CHANGELOG.

### Safety Boundaries

- Never delete files the user hasn't explicitly specified
- Never store secrets, tokens, or passwords in the knowledge base
- Confirm with the user before modifying `INSTRUCTION.md`
- Confirm before bulk deletions or directory restructuring

---

## Common Task Patterns

### Post-Conversation Knowledge Distillation

This is one of MindOS's most critical use cases. After a long conversation in another Agent (Cursor, Claude Desktop, Copilot, etc.), the user wants to distill insights back into the knowledge base. The key: don't just "record the conversation" — **extract, structure, and file it properly**.

**Scenario A: Summarize Learnings / Document Pitfalls**

User says something like "just spent two hours debugging, save my learnings" or "store this solution":

```
1. Ask the user to confirm the core content (key decisions, solutions, pitfalls)
2. mindos_search_notes — Check if related notes already exist
3. If found → mindos_read_file → understand existing structure
   → mindos_insert_after_heading or mindos_append_to_file — append, avoid duplication
4. If not → mindos_create_file — create in the appropriate directory
5. Content should be distilled into reusable patterns, not a conversation transcript
```

**Scenario B: Reverse-Update an SOP / Workflow**

User says something like "this SOP has some wrong steps, update it" or "I found a better process":

```
1. mindos_search_notes — Locate the SOP file
2. mindos_read_file — Read the full SOP content
3. Align with user on what needs changing (add steps? remove outdated ones? reorder?)
4. mindos_update_section — Precisely replace the changed sections
5. If the SOP references other files, verify those references still hold
```

**Scenario C: Extract Patterns from a Discussion**

User says something like "organize the methodology we just discussed into a doc":

```
1. Ask the user to provide or confirm key points (don't assume you know the full conversation)
2. mindos_search_notes — Check if there's an existing doc to extend
3. Structure the pattern as: Problem → Solution → When to Apply → Caveats
4. mindos_create_file or mindos_update_section — file into the right directory
```

**Scenario D: Cross-Agent Context Sync**

User says something like "I made some architecture decisions in Cursor, sync them to the knowledge base":

```
1. Ask the user to confirm the decision points (you can't read other Agents' history)
2. mindos_search_notes — Find the relevant project doc
3. mindos_read_file — Read current state
4. mindos_update_section or mindos_insert_after_heading — append the decisions
5. If changes span multiple files, update each and keep references consistent
```

> **Core principle: You weren't in that conversation.** When a user says "summarize what we just discussed," you must first ask them to confirm what to distill. Never pretend you have access to another Agent's conversation history. Ask proactively, extract precisely, archive structurally.

### Capture a New Idea

```
1. mindos_search_notes — Check if related notes exist
2. If found → mindos_read_file → mindos_insert_after_heading or mindos_append_to_file
3. If not → mindos_create_file in the appropriate directory
```

### Execute an SOP / Workflow

```
1. mindos_read_file — Read the SOP doc under Workflows/
2. Execute step by step, deposit results back into the knowledge base
3. mindos_update_section — Update execution status
4. If you discover the SOP has incorrect or suboptimal steps → reverse-update it (see Scenario B above)
```

### Record a New Product/Resource

```
1. mindos_read_file — Read the target CSV headers
2. Gather necessary information
3. mindos_append_csv — Append one row
```

### Update Profile

```
1. mindos_read_file — Read the current Profile file
2. mindos_update_section or mindos_insert_after_heading — Precise modification
```

### Organize & Review

```
1. mindos_get_recent — Check recently modified files
2. mindos_search_notes — Search for related content
3. mindos_get_backlinks — Understand a file's position in the knowledge network
```

---

## Markdown Style Guide

- Add emoji to section headings where appropriate
- Use code formatting for commands: code blocks for standalone commands, `` `inline` `` for mentions
- Keep content concise and execution-oriented, not explanatory
- Prefer lists over paragraphs, tables over lists (when comparing multiple dimensions)

## CSV Style Guide

- First row is the header, comma-separated
- Cells containing commas, quotes, or newlines must be double-quoted
- Appended rows must match the header's field order and count

---

## Extending the Knowledge Base

### Adding a New Domain (Top-Level Directory)

1. Create the directory
2. Create a `README.md` inside it with: one-line description, directory structure, usage guide, update rules
3. Update root `README.md`'s directory structure and responsibility map

### Ingesting External Resources

1. Read the target CSV's headers
2. Gather necessary information
3. Append one row to the CSV
4. Don't create new files unless the CSV doesn't exist (in which case, create it with headers first)
