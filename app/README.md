# MindOS

A personal knowledge OS — browse, edit, and query your second brain directly in the browser.

Built with Next.js 15 App Router, runs entirely on your local machine with direct filesystem access. No database, no cloud sync.

## Features

- **File browser** — sidebar file tree with collapsible directories, grid/list directory view
- **Markdown rendering** — GFM tables, syntax highlighting, copy button on code blocks
- **CSV viewer** — sortable table with sticky header
- **Inline editor** — CodeMirror 6, `E` to edit, `⌘S` to save, `Esc` to cancel
- **Full-text search** — `⌘K` overlay with fuzzy search and snippet preview
- **Table of Contents** — floating TOC panel for Markdown headings, collapsible
- **AI Ask** — `⌘/` to ask questions answered from your knowledge base (streaming LLM, file attachment via `@`-mention)
- **Dark / light mode** — follows system preference, togglable
- **File management** — create, rename, delete files from sidebar
- **Mobile support** — responsive layout with top navbar and drawer sidebar

## Quick Start

```bash
cd app
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MIND_ROOT` | `/data/home/geminitwang/code/MindOS/my-mind` | Absolute path to your knowledge base directory |
| `AI_PROVIDER` | `anthropic` | `anthropic` or `openai` |
| `ANTHROPIC_API_KEY` | — | Required when `AI_PROVIDER=anthropic` |
| `ANTHROPIC_MODEL` | `claude-sonnet-4-6` | Anthropic model ID |
| `OPENAI_API_KEY` | — | Required when `AI_PROVIDER=openai` |
| `OPENAI_BASE_URL` | — | Optional: custom base URL (e.g. a proxy) |
| `OPENAI_MODEL` | `gpt-4o-mini` | OpenAI model ID |

Create a `.env.local` in `app/`:

```env
MIND_ROOT=/path/to/your/notes
AI_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...
```

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `⌘K` | Open search |
| `⌘/` | Open Ask AI |
| `E` | Enter edit mode (when viewing a file) |
| `⌘S` | Save |
| `Esc` | Cancel edit / close modal |
| `@` | Attach file in Ask AI input |

## Production

```bash
npm run build
pm2 start npm --name mindos -- start
```

## Tech Stack

Next.js 15 · TypeScript · Tailwind CSS · CodeMirror 6 · react-markdown · Vercel AI SDK
