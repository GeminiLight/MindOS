# MindOS

[中文版](README_zh.md)

**The OS where humans think and agents act.**

MindOS is a local-first knowledge base with a browser UI, an MCP server for Agent access, and a structured template to organize your notes, workflows, and personal context in a way that both humans and AI Agents can read and execute.

> No database. No cloud sync. Runs entirely on your machine.

---

## ✨ Features

- **Browser UI** — browse, edit, and search your notes at `localhost:3000`
- **MCP Server** — expose your knowledge base as MCP tools so any Agent can read, write, and search your notes
- **Structured template** — opinionated directory layout for Profile, Workflows, Configurations, and more
- **AI Ask** — `⌘/` to chat with your knowledge base (streaming, file attachment via `@`)
- **Full-text search** — `⌘K` fuzzy search with snippet preview
- **Markdown + CSV** — GFM rendering, sortable CSV viewer, CodeMirror editor

---

## 🚀 Quick Start

```bash
# 1. Clone
git clone https://github.com/geminilight/mind_os
cd mind_os

# 2. Initialize your knowledge base from template
cp -r template/ my-mind/

# 3. Configure
cp app/.env.example app/.env.local
# Edit MIND_ROOT to point to your my-mind/ directory

# 4. Start the app
cd app && npm install && npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## 📁 Project Structure

```
mind_os/
├── app/              # Next.js frontend — browse, edit, search your notes
├── mcp/              # MCP Server — Agent tools for your knowledge base
├── template/         # Starter template — copy to my-mind/ to get started
├── my-mind/          # Your private knowledge base (gitignored)
├── SERVICES.md       # Technical services reference
└── README.md
```

---

## 🔌 MCP Server

Register the MindOS MCP server so any Agent can access your knowledge base:

```json
{
  "mcpServers": {
    "mindos": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/mind_os/mcp/dist/index.js"],
      "env": {
        "MIND_ROOT": "/path/to/mind_os/my-mind"
      }
    }
  }
}
```

Available tools: `mindos_list_files`, `mindos_read_file`, `mindos_write_file`, `mindos_create_file`, `mindos_delete_file`, `mindos_search_notes`, `mindos_get_recent`, `mindos_append_csv`

Build the server:

```bash
cd mcp && npm install && npm run build
```

---

## ⚙️ Environment Variables

Create `app/.env.local`:

```env
MIND_ROOT=/path/to/mind_os/my-mind
AI_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-sonnet-4-6
```

| Variable | Default | Description |
|----------|---------|-------------|
| `MIND_ROOT` | — | Absolute path to your knowledge base |
| `AI_PROVIDER` | `anthropic` | `anthropic` or `openai` |
| `ANTHROPIC_API_KEY` | — | Required for Anthropic |
| `OPENAI_API_KEY` | — | Required for OpenAI |

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `⌘K` | Search |
| `⌘/` | Ask AI |
| `E` | Edit file |
| `⌘S` | Save |
| `Esc` | Cancel / close |

---

## 🛠️ Tech Stack

Next.js 15 · TypeScript · Tailwind CSS · CodeMirror 6 · Vercel AI SDK · MCP SDK

---

## License

MIT
