<p align="center">
  <img src="assets/logo-square.svg" alt="MindOS" width="80" />
  <br />
  <strong style="font-size: 1.5em;">MindOS</strong>
</p>

<p align="center">
  <strong>Human Thinks Here, Agent Acts There.</strong>
</p>

<p align="center">
  <a href="README.md">English</a> | <a href="README_zh.md">中文</a>
</p>

<p align="center">
  <a href="https://deepwiki.com/GeminiLight/MindOS"><img src="https://img.shields.io/badge/DeepWiki-MindOS-blue.svg?style=for-the-badge" alt="DeepWiki"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge" alt="MIT License"></a>
</p>

MindOS is a **Human-AI Collaborative Mind Platform**—a local-first knowledge base that ensures your notes, workflows, and personal context are both human-readable and directly executable by AI Agents. **Globally sync your mind for all agents: transparent, controllable, and evolving symbiotically.**

---

## Core Value: Human-AI Shared Mind

MindOS refactors the human-AI collaboration paradigm through three core pillars, enabling humans and AI to co-evolve within a single Shared Mind.

### 1. Global Mind Sync — Breaking Mind Silos
*   **Pain Point:** Traditional cloud notes are cumbersome to manage, hindered by API barriers, and have high capture friction, making it hard for Agents to access deep human context and real-time epiphanies.
*   **Evolution:** Record once, empower everywhere. MindOS provides an ultra-lightweight web capture entry and a built-in standard MCP Server. Any compatible Agent can seamlessly sync your Profile, SOPs, and experiences, enabling "plug-and-play" personal context and real-time mind alignment.

### 2. Transparent & Controllable — Eliminating Agent Black Boxes
*   **Pain Point:** Current AI assistant memories are locked in system black boxes. Humans cannot intuitively inspect or correct the Agent's intermediate reasoning, leading to uncontrolled hallucinations.
*   **Evolution:** Let Agents think in the light. Every Agent retrieval, reflection, and action is distilled directly into local plain text (Markdown/CSV) via MCP. Humans hold absolute audit, intervention, and mind-correction rights in the intuitive GUI workbench.

### 3. Symbiotic Evolution — Dynamic Instruction Flow
*   **Pain Point:** Traditional document management is deeply nested and hard to sync, failing to serve as an "execution engine" in complex human-AI collaborative tasks.
*   **Evolution:** Knowledge as Code. Through the Prompt-Native recording paradigm and reference-driven auto-sync, your daily notes naturally become high-quality Agent execution instructions. Humans and AI inspire each other and grow together in a single Shared Mind.

> **Foundational Pillar:** MindOS adheres to the **Local-first** principle. All data is stored locally as plain text, eliminating privacy concerns and ensuring absolute data sovereignty with ultimate read/write performance.

---

## Features

*   **Prompt-Native Document Style** — Advocates for a "mind-first" recording paradigm, providing restrictive writing templates that align with LLM reasoning logic, naturally transforming daily human notes into high-quality Agent execution instructions.
*   **Reference-Driven Synchronization** — Abandons traditional isolated task management by using @ references and bi-directional links between Markdown files to achieve automatic cross-file synchronization and flow of project status, task progress, and context.
*   **Human GUI Workbench** — Provides an intuitive and friendly interaction experience for browsing, editing, and searching notes, with a UI specifically designed for human-AI co-creation.
*   **Built-in Agent Assistant** — Use `⌘/` to converse with and manage the knowledge base within context. Agents manage files while editing seamlessly captures human-curated knowledge.
*   **MCP Server & Skills** — Exposes the knowledge base as a standard MCP toolset. Any Agent can connect with zero configuration, instantly gaining specialized skills to read, write, search, and execute local workflows.
*   **Structured Templates** — Pre-set directory structures for Profiles, Workflows, Configurations, etc., to jumpstart your personal context.
*   **Visual Knowledge Graph** — Dynamically parses and visualizes inter-file references and dependencies, making it easy to manage complex human-AI context networks.
*   **Time Machine & Git-backed** — Automatically records every read/write and edit history by both humans and Agents. Supports one-click rollback and visualizes the evolution of context and Agent reasoning trajectories.
*   **Flexible Plugin Extensions** — Supports custom view plugins for specific files or scenarios (e.g., TODO lists, Kanban task management), enabling highly elastic knowledge management.

---

## Quick Start

```bash
# 1. Clone the repository
git clone https://github.com/geminilight/mind-os
cd mind-os

# 2. Initialize your knowledge base from the template
cp -r template/ my-mind/

# 3. Configure environment variables
cp app/.env.example app/.env.local
# Edit MIND_ROOT to point to the absolute path of your my-mind/ directory

# 4. Start the application
cd app && npm install && npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to get started.

---

## MCP Server Integration Guide

Register the MindOS MCP Server in your Agent client (e.g., Claude Desktop) to allow the Agent to directly access and operate your local knowledge base:

```json
{
  "mcpServers": {
    "mindos": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/mind-os/mcp/dist/index.js"],
      "env": {
        "MIND_ROOT": "/path/to/mind-os/my-mind"
      }
    }
  }
}
```

**Underlying Toolset for Agents:**
`mindos_list_files`, `mindos_read_file`, `mindos_write_file`, `mindos_create_file`, `mindos_delete_file`, `mindos_search_notes`, `mindos_get_recent`, `mindos_append_csv`

**Build the Server:**
```bash
cd mcp && npm install && npm run build
```

---

## Project Structure

```bash
mind-os/
├── app/              # Next.js 15 Frontend — Browse, edit, and interact with AI
├── mcp/              # MCP Server Core — Standardized toolset for Agents
├── template/         # Knowledge base structure template — Copy to my-mind/
├── my-mind/          # Your private shared memory (Git-ignored for privacy)
├── SERVICES.md       # Technical and Service Architecture Overview
└── README.md
```

---

## Environment Settings

Configure in `app/.env.local`:

```env
MIND_ROOT=/path/to/mind-os/my-mind
AI_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...
# OPENAI_API_KEY=sk-proj-...
ANTHROPIC_MODEL=claude-3-7-sonnet-20250219
```

| Variable | Default | Description |
| :--- | :--- | :--- |
| `MIND_ROOT` | — | **Required**. Absolute path to the knowledge base root. |
| `AI_PROVIDER` | `anthropic` | Options: `anthropic` or `openai`. |
| `ANTHROPIC_API_KEY` | — | Required when Provider is `anthropic`. |
| `OPENAI_API_KEY` | — | Required when Provider is `openai`. |

---

## Keyboard Shortcuts

| Shortcut | Function |
| :--- | :--- |
| `⌘ + K` | Global Search |
| `⌘ + /` | Call AI Assistant / Sidebar |
| `E` | Press `E` in View mode to quickly enter Edit mode |
| `⌘ + S` | Save current edit |
| `Esc` | Cancel edit / Close dialog |

---

## License

MIT © GeminiLight
