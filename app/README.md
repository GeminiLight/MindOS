# MindOS

A personal knowledge OS — browse, edit, and query your second brain directly in the browser.

Built with Next.js 16 (App Router + Turbopack), runs entirely on your local machine with direct filesystem access. No database, no cloud sync.

## Features

- **File browser** — sidebar file tree with collapsible directories, grid/list directory view
- **Markdown rendering** — GFM tables, syntax highlighting, copy button on code blocks
- **CSV viewer** — sortable table with sticky header
- **JSON viewer** — syntax-highlighted, collapsible tree
- **Inline editor** — CodeMirror 6 + Tiptap WYSIWYG, `E` to edit, `⌘S` to save, `Esc` to cancel
- **Full-text search** — `⌘K` overlay with fuzzy search and snippet preview
- **Table of Contents** — floating TOC panel for Markdown headings
- **AI Agent** — `⌘/` to chat with an AI agent that can read/search your knowledge base, attach files via `@`-mention, upload local PDFs
- **Knowledge graph** — interactive node graph of backlinks between files
- **Backlinks** — related files panel shown at the bottom of each page
- **Dark / light mode** — follows system preference, togglable, with customizable prose font and content width
- **File management** — create, rename, delete files and directories from sidebar
- **Mobile support** — responsive layout with top navbar and drawer sidebar
- **i18n** — English and Chinese locale support

## Quick Start

```bash
cd app
cp .env.local.example .env.local   # edit with your settings
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Environment Variables

Copy `.env.local.example` to `.env.local` and fill in the values:

| Variable | Default | Description |
|----------|---------|-------------|
| `MIND_ROOT` | — | **Required.** Absolute path to your knowledge base directory |
| `MINDOS_WEB_PORT` | `3000` | Dev/production server port |
| `AI_PROVIDER` | `anthropic` | `anthropic` or `openai` |
| `ANTHROPIC_API_KEY` | — | Required when `AI_PROVIDER=anthropic` |
| `ANTHROPIC_MODEL` | `claude-sonnet-4-6` | Anthropic model ID |
| `OPENAI_API_KEY` | — | Required when `AI_PROVIDER=openai` |
| `OPENAI_BASE_URL` | — | Optional: custom base URL (e.g. a proxy) |
| `OPENAI_MODEL` | `gpt-4o-mini` | OpenAI model ID |
| `AUTH_TOKEN` | — | Optional: protect Next.js `/api/*` endpoints with bearer token auth. When set, requests must include `Authorization: Bearer <token>`. The MCP server also reads this variable for HTTP mode auth. Leave unset for open access (local use). Configured in `app/.env.local`. |

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `⌘K` | Open search |
| `⌘/` | Open AI Agent |
| `E` | Enter edit mode (when viewing a file) |
| `⌘S` | Save |
| `Esc` | Cancel edit / close modal |
| `@` | Attach knowledge base file in AI chat |

## Project Structure

```
app/
├── app/                    # Next.js App Router
│   ├── layout.tsx          # Root layout (fonts, providers, sidebar)
│   ├── page.tsx            # Home page (recently modified files)
│   ├── view/[...path]/     # Dynamic file/directory viewer
│   ├── error.tsx           # Error boundary page
│   └── api/                # API routes
│       ├── ask/            # AI agent streaming endpoint
│       ├── ask-sessions/   # Chat session persistence
│       ├── backlinks/      # Backlink resolver
│       ├── extract-pdf/    # PDF text extraction
│       ├── file/           # File CRUD operations
│       ├── files/          # File tree listing
│       ├── graph/          # Knowledge graph builder
│       ├── recent-files/   # Recently modified files
│       ├── search/         # Full-text search
│       └── settings/       # User preferences
├── components/             # React components
│   ├── ask/                # AI chat sub-components
│   ├── renderers/          # Pluggable file renderers
│   ├── ui/                 # Shared UI primitives
│   └── *.tsx               # Page-level components
├── hooks/                  # Custom React hooks
│   ├── useAskSession.ts    # Chat session management
│   ├── useFileUpload.ts    # File upload + PDF extraction
│   └── useMention.ts       # @-mention autocomplete
├── lib/                    # Shared utilities
│   ├── agent/              # AI agent system prompt + tools
│   ├── api.ts              # Typed fetch wrapper (ApiError)
│   ├── fs.ts               # Filesystem operations
│   ├── types.ts            # Shared TypeScript interfaces
│   ├── i18n.ts             # Locale strings (en/zh)
│   └── utils.ts            # Path encoding, helpers
├── scripts/
│   └── extract-pdf.cjs     # Standalone PDF extractor (runs outside Turbopack)
├── middleware.ts            # Optional bearer token auth
└── .env.local.example      # Environment variable template
```

## Production

```bash
npm run build
npm start                   # or use pm2:
pm2 start npm --name mindos -- start
```

## Tech Stack

Next.js 16 · React 19 · TypeScript · Tailwind CSS 4 · CodeMirror 6 · Tiptap · react-markdown · Vercel AI SDK · pdfjs-dist
