# MindOS App

Next.js 16 (App Router) web application — browse, edit, and query your knowledge base in the browser.

Runs entirely on your local machine with direct filesystem access. No database, no cloud sync.

## Quick Start

**Normal usage** — run via the MindOS CLI (config auto-loaded from `~/.mindos/config.json`):

```bash
mindos dev      # or: mindos start
```

**Development / contributing** — run the app directly (requires env vars to be set manually):

```bash
npm install
MIND_ROOT=~/MindOS ANTHROPIC_API_KEY=sk-ant-... npm run dev
# Or copy .env.local.example to app/.env.local and fill in values
```

Open [http://localhost:3456](http://localhost:3456).

## Features

- **File browser** — sidebar file tree with collapsible directories, grid/list directory view
- **Markdown rendering** — GFM tables, syntax highlighting, copy button on code blocks
- **CSV viewer** — sortable, filterable table with virtual scrolling
- **JSON viewer** — syntax-highlighted, collapsible tree
- **Inline editor** — CodeMirror 6 + Tiptap WYSIWYG, `E` to edit, `⌘S` to save, `Esc` to cancel
- **Full-text search** — `⌘K` overlay with Fuse.js fuzzy search and snippet preview
- **Table of Contents** — floating TOC panel for Markdown headings
- **AI Agent** — `⌘/` to chat with an AI agent that can read/search your knowledge base, attach files via `@`-mention, upload local PDFs
- **Knowledge graph** — interactive node graph of backlinks between files
- **Backlinks** — related files panel shown at the bottom of each page
- **Dark / light mode** — follows system preference, togglable, with customizable prose font and content width
- **File management** — create, rename, delete files and directories from sidebar
- **Plugin renderers** — extensible file viewers (TODO, Kanban, Diff, Summary, Workflow, etc.)
- **Mobile support** — responsive layout with top navbar and drawer sidebar
- **i18n** — English and Chinese locale support

## Environment Variables

Copy `.env.local.example` to `.env.local`:

| Variable | Default | Description |
|----------|---------|-------------|
| `MIND_ROOT` | `./my-mind` | Path to your knowledge base directory |
| `MINDOS_WEB_PORT` | `3456` | Dev/production server port |
| `AI_PROVIDER` | `anthropic` | `anthropic` or `openai` |
| `ANTHROPIC_API_KEY` | — | Required when `AI_PROVIDER=anthropic` |
| `ANTHROPIC_MODEL` | `claude-sonnet-4-6` | Anthropic model ID |
| `OPENAI_API_KEY` | — | Required when `AI_PROVIDER=openai` |
| `OPENAI_BASE_URL` | — | Optional: custom base URL for proxy or compatible API |
| `OPENAI_MODEL` | `gpt-5.4` | OpenAI model ID |
| `AUTH_TOKEN` | — | Optional: bearer token auth for all `/api/*` endpoints |

## Architecture

```
Request → middleware.ts (auth) → API route → lib/fs.ts (cache + mindRoot) → lib/core/* (pure fs) → filesystem
```

- **`lib/core/`** — Pure business logic, no framework dependency. Security, fs-ops, search, lines, csv, git, backlinks.
- **`lib/fs.ts`** — App-level wrapper: injects `mindRoot`, manages in-memory cache, exposes Fuse.js fuzzy search.
- **`lib/agent/`** — AI agent system prompt, knowledge base tools (9 tools), model config.
- **`lib/api.ts`** — Typed `apiFetch()` wrapper with error handling and timeout.
- **`middleware.ts`** — Optional bearer token auth gate.

## API Routes

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/files` | List all file paths |
| GET | `/api/file?path=...` | Read file content |
| GET | `/api/file?path=...&op=read_lines` | Read file as line array |
| POST | `/api/file` | File operations: `save_file`, `create_file`, `delete_file`, `rename_file`, `move_file`, `insert_lines`, `update_lines`, `append_to_file`, `insert_after_heading`, `update_section`, `append_csv` |
| GET | `/api/search?q=...` | Full-text fuzzy search |
| GET | `/api/recent-files?limit=...` | Recently modified files |
| GET | `/api/backlinks?path=...` | Find files that reference a given path |
| GET | `/api/bootstrap?target_dir=...` | Load startup context (INSTRUCTION, README, CONFIG) |
| GET | `/api/git?op=...` | Git operations: `is_repo`, `history`, `show` |
| GET | `/api/graph` | Knowledge graph (nodes + edges) |
| POST | `/api/ask` | AI agent streaming (SSE) |
| GET/POST | `/api/ask-sessions` | Chat session persistence |
| POST | `/api/extract-pdf` | PDF text extraction |
| GET/POST | `/api/settings` | User preferences |

## Project Structure

```
app/
├── app/                    # Next.js App Router
│   ├── layout.tsx          # Root layout (fonts, providers, sidebar)
│   ├── page.tsx            # Home page (recently modified files)
│   ├── view/[...path]/     # Dynamic file/directory viewer
│   └── api/                # 12 API route groups (see table above)
├── components/             # React components
│   ├── ask/                # AI chat sub-components
│   ├── renderers/          # 10+ pluggable file renderers
│   ├── ui/                 # Shared UI primitives (shadcn/ui)
│   └── *.tsx               # Page-level components
├── hooks/                  # Custom React hooks
│   ├── useAskSession.ts    # Chat session management
│   ├── useFileUpload.ts    # File upload + PDF extraction
│   └── useMention.ts       # @-mention autocomplete
├── lib/
│   ├── core/               # Pure business logic (10 modules)
│   │   ├── security.ts     # Path validation, write protection
│   │   ├── fs-ops.ts       # CRUD: read, write, create, delete, rename, move
│   │   ├── lines.ts        # Line-level operations
│   │   ├── search.ts       # Literal string search
│   │   ├── csv.ts          # CSV row append
│   │   ├── backlinks.ts    # Wikilink/markdown link backlink detection
│   │   ├── git.ts          # Git log, show, repo detection
│   │   ├── tree.ts         # File tree builder
│   │   └── types.ts        # Shared type definitions (source of truth)
│   ├── agent/              # AI agent system prompt + 9 tools
│   ├── renderers/          # Renderer plugin registry
│   ├── fs.ts               # App-level fs wrapper (cache, mindRoot, Fuse.js search)
│   ├── api.ts              # Typed fetch wrapper (apiFetch)
│   ├── types.ts            # App types (re-exports core types + app-specific)
│   ├── settings.ts         # Server settings (AI config, mindRoot)
│   ├── i18n.ts             # Locale strings (en/zh)
│   └── utils.ts            # Path encoding, helpers
├── __tests__/              # Unit + API tests (vitest)
│   ├── core/               # Core logic tests (7 files)
│   └── api/                # API route tests (7 files)
├── scripts/
│   └── extract-pdf.cjs     # Standalone PDF extractor
├── middleware.ts            # Optional bearer token auth
└── .env.local.example      # Environment variable template
```

## Testing

```bash
npx vitest run          # run all tests
npx vitest --watch      # watch mode
```

## Production

```bash
npm run build
npm start
```

## Tech Stack

Next.js 16 · React 19 · TypeScript · Tailwind CSS 4 · CodeMirror 6 · Tiptap · Fuse.js · react-markdown · Vercel AI SDK · shadcn/ui · pdfjs-dist
