<p align="center">
  <img src="assets/logo-square.svg" alt="MindOS" width="100" />
</p>

<h1 align="center">MindOS</h1>

<p align="center">
  <strong>Human Thinks Here, Agent Acts There.</strong>
</p>

<p align="center">
  <a href="README.md">English</a> | <a href="README_zh.md">中文</a>
</p>

<p align="center">
  <a href="https://tianfuwang.tech/MindOS"><img src="https://img.shields.io/badge/Website-MindOS-0ea5e9.svg?style=for-the-badge" alt="Website"></a>
  <a href="https://www.npmjs.com/package/@geminilight/mindos"><img src="https://img.shields.io/npm/v/@geminilight/mindos.svg?style=for-the-badge&color=f59e0b" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/@geminilight/mindos"><img src="https://img.shields.io/npm/dw/@geminilight/mindos.svg?style=for-the-badge&color=10b981" alt="npm downloads"></a>
  <a href="#wechat"><img src="https://img.shields.io/badge/WeChat-Group-07C160.svg?style=for-the-badge&logo=wechat&logoColor=white" alt="WeChat"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-6366f1.svg?style=for-the-badge" alt="MIT License"></a>
</p>

MindOS is a **Human-AI Collaborative Mind System**—a local-first knowledge base that ensures your notes, workflows, and personal context are both human-readable and directly executable by Agents. **Share your brain with every AI — auditable, correctable, and more YOU with every use.**

---

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/images/demo-flow-dark.png" />
    <source media="(prefers-color-scheme: light)" srcset="assets/images/demo-flow-light.png" />
    <img src="assets/images/demo-flow-light.png" alt="MindOS: From Idea to Execution to Review" width="960" />
  </picture>
</p>

> [!IMPORTANT]
> **⭐ One-click install:** Send this to your Agent (Claude Code, Cursor, etc.) to set up everything automatically:
> ```
> Help me install MindOS from https://github.com/GeminiLight/MindOS with MCP and Skills. Use English template.
> ```
>
> **✨ Try it now:** After installation, give these a try:
> ```
> Read my MindOS knowledge base, see what's inside, then help me write my self-introduction into Profile.
> ```
> ```
> Help me distill the experience from this conversation into MindOS as a reusable SOP.
> ```
> ```
> Help me execute the XXX SOP from MindOS.
> ```

## 🧠 Human-AI Shared Mind

> No more fragmented memory, no more black-box behavior, no more lost experience.

**1. Global Sync — Breaking Memory Silos**

Each Agent keeps its own memory — switching tools means manually hauling context. **MindOS lets all Agents share one knowledge base via MCP and Skills — record once, reuse everywhere.**

**2. Transparent & Controllable — No More Black Boxes**

What did your Agent remember? Is it even correct? You have no way to know. **MindOS saves every read/write as local plain text — humans can audit, correct, and delete in the GUI.**

**3. Symbiotic Evolution — Experience Flows Back as Instructions**

All that experience from your conversations — gone the moment you close the window. **MindOS auto-distills conversation experience into Skills/SOPs. Notes are instructions. The knowledge base gets better with use.**

> **Foundation:** Local-first by default — all data stays in local plain text for privacy, ownership, and speed.

## ✨ Features

**For Humans**

- **GUI Workbench**: browse, edit, search notes with unified search + AI entry (`⌘K` / `⌘/`), designed for human-AI co-creation.
- **Built-in Agent Assistant**: converse with the knowledge base in context; edits seamlessly capture human-curated knowledge.
- **Plugin Extensions**: multiple built-in renderer plugins — TODO Board, CSV Views, Wiki Graph, Timeline, Agent Inspector, and more.

**For Agents**

- **MCP Server + Skills**: stdio + HTTP dual transport, full-lineup Agent compatible (OpenClaw, Claude Code, Cursor, etc.). Zero-config access.
- **Structured Templates**: pre-set directory structures for Profiles, Workflows, Configurations, etc., to jumpstart personal context.
- **Agent-Ready Docs**: everyday notes naturally double as high-quality executable Agent commands — no format conversion needed, write and dispatch.

**Infrastructure**

- **Security**: Bearer Token auth, path sandboxing, INSTRUCTION.md write-protection, atomic writes.
- **Knowledge Graph**: dynamically parses and visualizes inter-file references and dependencies.
- **Backlinks View**: displays all files that reference the current file, helping you understand how a note fits into the knowledge network.
- **Git Time Machine**: Git auto-sync (commit/push/pull), records every edit by both humans and Agents. One-click rollback, cross-device sync.
- **Desktop App**: native macOS/Windows/Linux app with system tray, auto-start, and local process management.

<details>
<summary><strong>Coming Soon</strong></summary>

- [ ] ACP (Agent Communication Protocol): connect external Agents (e.g., Claude Code, Cursor) and turn the knowledge base into a multi-Agent collaboration hub
- [ ] Deep RAG integration: retrieval-augmented generation grounded in your knowledge base for more accurate, context-aware AI responses
- [ ] Agent Inspector: render Agent operation logs as a filterable timeline to audit every tool call in detail

</details>

---

## 🚀 Getting Started

> [!IMPORTANT]
> **Quick Start with Agent:** Paste this prompt into any MCP-capable Agent (Claude Code, Cursor, etc.) to install automatically, then skip to [Step 3](#3-inject-your-personal-mind-with-mindos-agent):
> ```
> Help me install MindOS from https://github.com/GeminiLight/MindOS with MCP and Skills. Use English template.
> ```

> Already have a knowledge base? Skip to [Step 4](#4-make-any-agent-ready-mcp--skills) to configure MCP + Skills.

### 1. Install

**Option A: npm (recommended)**

```bash
npm install -g @geminilight/mindos@latest
```

**Option B: Clone from source**

```bash
git clone https://github.com/GeminiLight/MindOS
cd MindOS
npm install
npm link   # registers the `mindos` command globally
```

### 2. Interactive Setup

```bash
mindos onboard
```

The setup wizard guides you through knowledge base path, template, ports, auth, AI provider, and start mode — all with sensible defaults. Config is saved to `~/.mindos/config.json`. See **[docs/en/configuration.md](docs/en/configuration.md)** for all fields.

> [!TIP]
> Choose "Background service" during onboard for auto-start on boot. Run `mindos update` anytime to upgrade.

Open the Web UI in your browser:

```bash
mindos open
```

### 3. Inject Your Personal Mind with MindOS Agent

1. Open the built-in MindOS Agent chat panel in the GUI.
2. Upload your resume or any personal/project material.
3. Send this prompt: `Help me sync this information into my MindOS knowledge base.`

<p align="center">
  <img src="assets/images/gui-sync-cv.png" alt="Sync CV Example" width="800" />
</p>

### 4. Make Any Agent Ready (MCP + Skills)

**MCP** (connection) — one command to auto-install:

```bash
mindos mcp install        # interactive
mindos mcp install -g -y  # one-shot, global scope
```

**Skills** (workflow) — install one based on your language:

```bash
npx skills add https://github.com/GeminiLight/MindOS --skill mindos -g -y      # English
npx skills add https://github.com/GeminiLight/MindOS --skill mindos-zh -g -y   # Chinese
```

> For remote access, manual JSON config, and common pitfalls, see **[docs/en/supported-agents.md](docs/en/supported-agents.md)**.

## ⚙️ How It Works

```mermaid
graph LR
    H["👤 Human<br/><sub>thinks · reviews · evolves</sub>"]
    M[("📚 MindOS")]
    A["🤖 Agent<br/><sub>executes · retrospects · extracts SOPs</sub>"]
    EXT["🌐 All Agents"]

    H -- "ideas & feedback" --> M
    M -- "context & insights" --> H
    M -- "instructions & context" --> A
    A -- "results & SOPs" --> M
    M -. "via MCP" .-> EXT

    style H fill:#f59e0b,stroke:#d97706,color:#fff,stroke-width:2px
    style M fill:#10b981,stroke:#059669,color:#fff,stroke-width:2px
    style A fill:#6366f1,stroke:#4f46e5,color:#fff,stroke-width:2px
    style EXT fill:#64748b,stroke:#475569,color:#fff,stroke-dasharray:5 5
```

> **Both sides evolve.** Humans gain new insights from accumulated knowledge; Agents extract SOPs and get smarter. MindOS sits at the center — the shared second brain that grows with every interaction.

---

## 🤝 Supported Agents

> Full list with MCP config paths and manual setup: **[docs/en/supported-agents.md](docs/en/supported-agents.md)**

| Agent | MCP | Skills |
|:------|:---:|:------:|
| MindOS Agent | ✅ | ✅ |
| OpenClaw | ✅ | ✅ |
| Claude Desktop / Code | ✅ | ✅ |
| CodeBuddy | ✅ | ✅ |
| Cursor | ✅ | ✅ |
| Windsurf | ✅ | ✅ |
| Cline | ✅ | ✅ |
| Trae | ✅ | ✅ |
| Gemini CLI | ✅ | ✅ |
| GitHub Copilot | ✅ | ✅ |
| iFlow | ✅ | ✅ |

---

<details>
<summary><strong>📁 Project Structure</strong></summary>

```bash
MindOS/
├── app/              # Next.js 16 Frontend — Browse, edit, and interact with AI
├── mcp/              # MCP Server — HTTP adapter that maps tools to App API
├── skills/           # MindOS Skills (`mindos`, `mindos-zh`) — Workflow guides for Agents
├── templates/        # Preset templates (`en/`, `zh/`, `empty/`) — copied to knowledge base on onboard
├── bin/              # CLI entry point (`mindos onboard`, `mindos start`, `mindos open`, `mindos sync`, `mindos token`)
├── scripts/          # Setup wizard and helper scripts
└── README.md

~/.mindos/            # User data directory (outside project, never committed)
├── config.json       # All configuration (AI keys, port, auth token, sync settings)
├── sync-state.json   # Sync state (last sync time, conflicts)
└── mind/             # Your private knowledge base (default: ~/MindOS/mind, customizable on onboard)
```

</details>

## ⌨️ CLI Commands

> Full command reference: **[docs/en/cli-commands.md](docs/en/cli-commands.md)**

| Command | Description |
| :--- | :--- |
| `mindos onboard` | Interactive setup (config, template, start mode) |
| `mindos start` | Start app + MCP server (foreground) |
| `mindos start --daemon` | Start as background OS service |
| `mindos open` | Open Web UI in browser |
| `mindos mcp install` | Auto-install MCP config into your Agent |
| `mindos sync init` | Setup Git remote sync |
| `mindos update` | Update to latest version |
| `mindos doctor` | Health check |

**Keyboard shortcuts:** `⌘K` Search · `⌘/` AI Assistant · `E` Edit · `⌘S` Save · `Esc` Close

---

## 💬 Community <a name="wechat"></a>

Join our WeChat group for early access, feedback, and AI workflow discussions:

<p align="center">
  <img src="assets/images/wechat-qr.png" alt="WeChat Group QR Code" width="200" />
</p>

> Scan the QR code or add WeChat **wtfly2018** to be invited.

---

## 👥 Contributors

<a href="https://github.com/GeminiLight"><img src="https://github.com/GeminiLight.png" width="60" style="border-radius:50%" alt="GeminiLight" /></a>
<a href="https://github.com/yeahjack"><img src="https://github.com/yeahjack.png" width="60" style="border-radius:50%" alt="yeahjack" /></a>

---

## 📄 License

MIT © GeminiLight
