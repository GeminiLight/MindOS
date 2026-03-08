# System Architecture: MindOS

## Tech Stack

| Layer | Choice | Reason |
|-------|--------|--------|
| Framework | Next.js 16 (App Router, Turbopack) | Server Components, Server Actions, streaming — no separate backend needed |
| Language | TypeScript | Type safety across filesystem ops and API boundaries |
| Styling | Tailwind CSS | Rapid iteration, consistent design system |
| Markdown | `react-markdown` + `rehype-highlight` + `remark-gfm` | Battle-tested, extensible pipeline |
| CSV | `papaparse` | Lightweight, handles edge cases |
| Search | `fuse.js` | Client-side fuzzy search, zero-latency results |
| Editor | `@codemirror/view` + `@codemirror/lang-markdown` | Lightweight, keyboard-friendly, Markdown-aware |
| AI | `@ai-sdk/anthropic` / `@ai-sdk/openai` | Unified streaming interface, provider-agnostic |
| Icons | `lucide-react` | Consistent, tree-shakeable |
| Deployment | PM2 + Node.js | Direct filesystem access, no abstraction layers |

## Project Structure

```
app/                         # Next.js project root
├── app/                     # App Router
│   ├── layout.tsx           # Root layout — sidebar + main
│   ├── page.tsx             # Homepage — recently modified files
│   ├── view/[...path]/
│   │   ├── page.tsx         # Server Component — reads file, defines save action
│   │   └── ViewPageClient.tsx  # Client Component — view/edit mode, breadcrumb
│   └── api/
│       ├── ask/route.ts     # POST /api/ask — streaming LLM with file context
│       ├── file/route.ts    # GET+POST /api/file — line-level & semantic file ops
│       └── settings/route.ts  # GET/POST /api/settings — AI config + sopRoot
├── components/
│   ├── Sidebar.tsx          # Fixed desktop sidebar + mobile drawer
│   ├── FileTree.tsx         # Recursive file tree with collapse/expand, rename, delete
│   ├── DirView.tsx          # Directory listing (grid/list view)
│   ├── MarkdownView.tsx     # Rendered Markdown + copy button on code blocks
│   ├── CsvView.tsx          # Table with sort
│   ├── Editor.tsx           # CodeMirror 6 editor (dynamically imported)
│   ├── EditorWrapper.tsx    # SSR-safe dynamic import wrapper
│   ├── SearchModal.tsx      # ⌘K overlay — debounced fuse.js search
│   ├── AskModal.tsx         # ⌘/ overlay — streaming AI chat with file attachment
│   ├── SettingsModal.tsx    # ⌘, overlay — AI config, appearance, knowledge base root
│   ├── TableOfContents.tsx  # Floating TOC for Markdown headings (github-slugger)
│   ├── HomeContent.tsx      # Homepage client component
│   ├── ThemeToggle.tsx      # Dark/light toggle (now also in Settings → Appearance)
│   └── SidebarLayout.tsx   # Layout wrapper for collapsed sidebar state
├── lib/
│   ├── fs.ts                # getFileTree, getFileContent, saveFileContent, searchFiles
│   │                        # + readLines, insertLines, updateLines, deleteLines
│   │                        # + appendToFile, insertAfterHeading, updateSection
│   ├── settings.ts          # readSettings, writeSettings, effectiveAiConfig, effectiveSopRoot
│   ├── actions.ts           # Server Actions: createFile, deleteFile, renameFile
│   ├── i18n.ts              # en/zh message bundles (as const)
│   ├── LocaleContext.tsx    # React context for locale + t()
│   └── types.ts             # FileNode, SearchResult
├── wiki/                    # Product docs (this directory)
├── .env.local               # AI_PROVIDER, OPENAI_API_KEY, OPENAI_BASE_URL, MIND_ROOT
├── .mindos-settings.json    # User settings (gitignored)
├── package.json
└── next.config.ts

mcp/                         # MCP Server (standalone Node.js process)
├── src/index.ts             # 15 MCP tools (CRUD + search + line ops + semantic ops)
├── dist/                    # Compiled output
└── package.json
```

## Key Design Decisions

### Filesystem Access
- All reads/writes via Next.js **Server Actions** and **Route Handlers** — no separate API backend
- `MIND_ROOT` env var points to the knowledge base directory
- Settings file (`.mindos-settings.json`) takes priority over `MIND_ROOT` for `sopRoot` — user can override env var from UI
- Writes use atomic temp-file swap (`write → rename`) to prevent data loss
- File tree excludes: `.git`, `node_modules`, `app`, `.next`

### Fine-grained File API (`/api/file`)
Designed primarily for MCP tool use — agents need surgical edits without reading/rewriting the whole file.

```
GET  /api/file?path=<rel>&op=read_file|read_lines

POST /api/file
Body: { op, path, ...params }

Ops:
  save_file           { content }
  append_to_file      { content }
  insert_lines        { after_index, lines[] }
  update_lines        { start, end, lines[] }
  delete_lines        { start, end }
  insert_after_heading { heading, content }
  update_section      { heading, content }
```

Two layers:
- **Line-level** (`read_lines`, `insert_lines`, `update_lines`, `delete_lines`) — works uniformly on both `.md` and `.csv`
- **Semantic** (`append_to_file`, `insert_after_heading`, `update_section`) — heading-aware, implemented directly (not wrappers around line ops) for clarity

### MCP Server
Separate process (`mcp/`) running on stdio transport. Uses the same logic as `lib/fs.ts` but with its own inline implementations. Exposes 15 tools to Claude/agent clients:

| Category | Tools |
|----------|-------|
| CRUD | `list_files`, `read_file`, `write_file`, `create_file`, `delete_file` |
| Discovery | `search_notes`, `get_recent` |
| CSV | `append_csv` |
| Line-level | `read_lines`, `insert_lines`, `update_lines`, `delete_lines` |
| Semantic | `append_to_file`, `insert_after_heading`, `update_section` |

### Settings Priority
```
env var (AI keys/provider) > .mindos-settings.json > defaults
.mindos-settings.json sopRoot > MIND_ROOT env var > hardcoded default
```

The asymmetry is intentional: AI credentials should be locked via env in production, while the knowledge base root is user-configurable.

### Routing
- URL mirrors file path: `/view/Configurations/Agents/🤖%20Agent%20常用MCP.md`
- `encodeURIComponent` per segment handles emoji, spaces, Chinese characters

### Search
- Server Action walks file tree on request, builds fuse.js index
- Index covers file path + full content
- Results include matched snippet with surrounding context

### AI Ask
```
POST /api/ask
Body: { messages: Message[], currentFile?: string, attachedFiles?: string[] }
Stream: plain text chunks (toTextStreamResponse)
```

- Priority context: attached files > current file > keyword search (top 3)
- File content truncated at 20k chars to avoid token overflow
- `@ai-sdk/openai` or `@ai-sdk/anthropic` selected via `effectiveAiConfig()`
- **Important**: must use `.chat(model)` on `@ai-sdk/openai@3.x` — default `.completions()` calls `/v1/responses` (Responses API), not `/v1/chat/completions`
- File attachment via `@`-mention in AskModal → chips displayed → paths sent as `attachedFiles`

### Rendering Pipeline
- `.md` → `react-markdown` → GFM tables, syntax highlight, copy button
- `.csv` → `papaparse` → sortable `<table>` with sticky header
- Other text → `<pre>` block

### i18n
- `messages` object in `lib/i18n.ts` typed as `as const` — full type inference for all string keys
- `LocaleContext` provides `{ locale, setLocale, t }` to all client components
- Language persisted to `localStorage`; switching live-updates without reload

### Mobile Strategy
- `md:` breakpoint divides desktop (fixed sidebar) from mobile (top navbar + drawer)
- Drawer closes on file navigation via `onNavigate` callback
- Edit mode available on all screen sizes; TOC hidden on mobile

## Deployment

```bash
# Development
cd app && npm run dev          # localhost:3000

# Production
npm run build
pm2 start npm --name mindos -- start
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MIND_ROOT` | `../../` | Path to the knowledge base directory (overridable from Settings UI) |
| `AI_PROVIDER` | `anthropic` | `anthropic` or `openai` |
| `ANTHROPIC_API_KEY` | — | Anthropic API key |
| `ANTHROPIC_MODEL` | `claude-sonnet-4-6` | Model name |
| `OPENAI_API_KEY` | — | OpenAI / compatible API key |
| `OPENAI_MODEL` | `gpt-4o-mini` | Model name |
| `OPENAI_BASE_URL` | — | Optional base URL for proxy / OpenAI-compatible APIs |
| `PORT` | `3000` | Server port |

## Future: Agent Mode for AI Ask (P2)

Replace the simple HTTP LLM call with a `claude-internal` subprocess, turning Ask into a full Agent capable of Skill calls, MCP tool use, and multi-file reasoning.

### Architecture

```
AskModal (client)
  → POST /api/ask-agent (Next.js Route Handler)
      → spawn('claude-internal', ['-p', prompt, '--output-format', 'stream-json', '--no-interactive'])
          cwd: MIND_ROOT (knowledge base directory, where CLAUDE.md lives)
      → parse stdout stream-json events
      → filter { type: 'assistant', message.content[].type: 'text' }
      → pipe text chunks back as SSE
```

### Two-mode UI

| Mode | Trigger | Backend |
|------|---------|---------|
| Quick | default | HTTP LLM call (`/api/ask`) |
| Agent | toggle button or `/agent` prefix | `claude-internal` subprocess (`/api/ask-agent`) |

### Constraints

- `claude-internal` and Next.js must run on the same machine — satisfied in current PM2 setup
- Agent mode is slower (subprocess boot ~1s) but gains full tool use
- Security: subprocess inherits server-side env and filesystem access (same trust boundary)
