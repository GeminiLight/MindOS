# Product Proposal: MindOS

## Vision

A personal knowledge OS that lets you browse, edit, and query your second brain directly in the browser — fast, distraction-free, and designed for a power user who thinks in systems.

## Problem

- Markdown files and CSVs scattered across nested directories are hard to navigate
- No visual overview of the knowledge base structure
- Editing requires switching to an IDE or text editor
- No way to quickly search or query across notes
- Files feel isolated — no sense of connection between related ideas

## Target User

Yourself — someone who maintains a structured personal knowledge base across research, products, configurations, and growth, and wants a single interface to read, update, and converse with it.

## User Journey

| Scenario | Current Pain | Solution |
|----------|-------------|----------|
| Finding information | File tree + search, no context | ⌘K search with snippets + TOC for long files |
| Updating content | Edit → save, no history | Quick edit + last-modified tracking |
| Consuming knowledge | Linear reading, files feel isolated | Related files panel + bidirectional links |
| Adding new entries | Must open editor for CSV rows | Inline row append for CSV tables |
| Creating new files | Not possible in UI | New file via sidebar `+` button |
| Querying knowledge | Manually reading multiple files | AI Ask (⌘/) with file context |

## Features

### Shipped

- File tree sidebar with collapsible directories
- Markdown rendering with syntax highlighting
- CSV table rendering with column sort
- Inline editing with CodeMirror + auto-save
- Full-text search (⌘K)
- Mobile-responsive layout (drawer sidebar)
- New file creation — sidebar `+` button per directory
- File rename (double-click) and delete
- Recently modified — homepage shows last N edited files
- Table of Contents — floating TOC panel for Markdown headings (collapse/expand, active section tracking)
- Dark / light mode toggle (via Settings → Appearance)
- **Warm amber design system** — custom coal dark + amber accent theme, IBM Plex Sans / Lora / IBM Plex Mono typography
- **AI Ask** (⌘/) — streaming LLM answers grounded in knowledge base files
  - Supports file attachment via `@`-mention with chip UI
  - Priority context: attached files > current file > keyword search
  - Configurable provider: Anthropic or OpenAI-compatible (custom base URL)
  - Multi-turn conversation with message history
- Settings modal — AI provider config, appearance (font, width, theme, language), knowledge base root
- i18n — English / Chinese
- **Fine-grained file API** (`/api/file`) — line-level and semantic operations for MCP tool use
  - Line ops: `read_lines`, `insert_lines`, `update_lines`, `delete_lines`
  - Semantic ops: `append_to_file`, `insert_after_heading`, `update_section`
- **MCP Server** — 15 tools exposing the knowledge base to AI agents
  - CRUD: `list_files`, `read_file`, `write_file`, `create_file`, `delete_file`
  - Discovery: `search_notes`, `get_recent`
  - CSV: `append_csv`
  - Line-level: `read_lines`, `insert_lines`, `update_lines`, `delete_lines`
  - Semantic: `append_to_file`, `insert_after_heading`, `update_section`

### P1 — Next

- **CSV quick-append** — add a new row directly from table view without entering raw edit mode
- **Reveal in tree** — scroll sidebar to active file on navigation
- **Related files** — bottom panel showing files that reference the current file

### P2 — Future

- **AI Agent mode** — spawn `claude-internal` subprocess for full tool use and multi-file reasoning
- **Tag / category view** — alternative to file tree, group by CSV Category or directory metadata
- **Image rendering** — serve local images referenced in Markdown with correct relative paths
- **Git history** — show last N commits touching the current file

## UX Principles

- **Speed first** — no skeleton screens, content loads immediately
- **Minimal chrome** — sidebar + content, nothing else competes for attention
- **Readable typography** — generous line height, max-width column, optimized for long-form reading
- **Keyboard-driven** — `⌘K` search, `E` edit, `Esc` cancel, `⌘S` save, `⌘/` ask AI, `⌘,` settings

## Non-Goals

- Multi-user collaboration
- Cloud sync
- WYSIWYG editor (plain Markdown is sufficient and more portable)
- Mobile editing (read-only on mobile is acceptable)
