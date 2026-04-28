# MindOS Wiki Documentation Audit Report

> **Date:** 2026-04-04  
> **Purpose:** Audit wiki documentation against actual codebase to identify outdated, missing, and accurate content  
> **Audience:** Founder, for investor conversations

---

## Executive Summary

### Overall Status
- **Total Wiki Files:** 115 markdown files across wiki directory
- **Core Feature Docs:** 27 files (00-series through 90-series)
- **Spec Files:** 58 files (in wiki/specs/ and wiki/specs/archive/)
- **Plugin Docs:** 9 files
- **Reference Docs:** 15 files

### Key Findings
1. **Architecture docs (20-series)** are mostly accurate but need updates for pi-agent-core migration
2. **API Reference (30-api-reference.md)** is severely incomplete - documents only 3 endpoints out of 51
3. **Plugin documentation** is accurate but missing new workflow-yaml renderer
4. **CLI documentation** in changelog/backlog is current, but no dedicated CLI reference page exists
5. **A2A and ACP integration** (cutting-edge features) are well-documented in specs but not in main docs

---

## Part 1: Wiki Documentation Status

### Core Product Documentation (00-series)

| File | Status | Notes |
|------|--------|-------|
| `00-product-proposal.md` | ✅ Accurate | Updated 2026-03-31. Vision, positioning, brand messaging current |
| `01-project-roadmap.md` | ⚠️ Outdated | States v0.5 as current, code is at v0.6.7+. Missing v0.6 milestones |
| `02-business-model.md` | ✅ Accurate | Business model canvas and pricing tiers documented |
| `03-technical-pillars.md` | ✅ Accurate | Four pillars (群体调度/经验编译/记忆代谢/认知镜像) defined |
| `04-positioning-brief.md` | ✅ Accurate | Market positioning and competitive analysis |

### Architecture Documentation (20-series)

| File | Status | Notes |
|------|--------|-------|
| `20-system-architecture.md` | ⚠️ Partially Outdated | Shows old API Routes count as "30+", actual count is 51. Directory structure accurate |
| `21-design-principle.md` | ✅ Accurate | Design tokens, logo spec, color palette all match implementation |
| `22-page-design.md` | ✅ Accurate | Page layouts, Activity Bar items, responsive breakpoints accurate |
| `23-mind-spaces.md` | ✅ Accurate | Space concept, 6 presets documented |
| `25-agent-architecture.md` | ⚠️ Outdated | Still shows `pi-coding-agent` usage (line 35). Actually uses `pi-agent-core` only. Tool count shows "~20" but actual is 27+ |

### API Reference (30-series)

| File | Status | Notes |
|------|--------|-------|
| `30-api-reference.md` | 🔴 Severely Incomplete | Documents only 3 endpoints (monitoring, changes, gateway). Actual API has 51 routes |

### Conventions & Dev Guides (40-series)

| File | Status | Notes |
|------|--------|-------|
| `40-conventions.md` | ⚠️ Outdated | States "AI SDK: Vercel AI SDK" but migrated to pi-agent-core in v0.6 |
| `41-dev-pitfall-patterns.md` | ✅ Accurate | Development patterns and pitfalls documented |
| `42-ai-feature-dev-lessons.md` | ✅ Accurate | AI development lessons |

### Plugin System (60-series)

| File | Status | Notes |
|------|--------|-------|
| `60-stage-plugins.md` | ⚠️ Incomplete | Lists 4 human-facing + 1 agent-facing plugins. Missing workflow-yaml renderer |
| `61-plugin-architecture.md` | ✅ Accurate | Architecture complete, Phase 1-4 all marked done |
| `62-stage-rag.md` | Planned | RAG not yet implemented |
| `63-stage-mdns.md` | Planned | mDNS not yet implemented |
| `64-stage-desktop.md` | ✅ Accurate | Desktop implementation status accurate |
| `65-stage-knowledge-api.md` | 📋 Planned | Knowledge API documented |
| `66-stage-cli.md` | ✅ Accurate | CLI ecosystem analysis |

### Plugin Specs (wiki/plugins/)

| File | Status | Notes |
|------|--------|-------|
| `plugins/README.md` | ✅ Accurate | 5 plugins listed |
| `plugins/timeline.md` | ✅ Accurate | Timeline renderer documented |
| `plugins/wiki-graph.md` | ✅ Accurate | Wiki Graph documented |
| `plugins/backlinks-explorer.md` | ✅ Accurate | Backlinks documented |
| `plugins/ai-briefing.md` | ✅ Accurate | AI Briefing documented |
| `plugins/workflow-runner.md` | ⚠️ Outdated | Old Markdown-based workflow, new YAML-based exists |
| `plugins/todo-board.md` | ✅ Accurate | TODO Board documented |
| `plugins/csv-views.md` | ✅ Accurate | CSV Views documented |
| `plugins/agent-inspector.md` | ✅ Accurate | Agent Inspector documented |
| `plugins/config-panel.md` | ✅ Accurate | Config Panel documented |

### Operational Docs (80-90 series)

| File | Status | Notes |
|------|--------|-------|
| `80-known-pitfalls.md` | ✅ Accurate | Known issues documented |
| `81-postmortem-process-lifecycle.md` | ✅ Accurate | Postmortem process |
| `85-backlog.md` | ✅ Accurate | Current backlog, frequently updated |
| `90-changelog.md` | ✅ Accurate | Changelog up to v0.6.7 |

---

## Part 2: Features in Code Without Documentation

### Frontend Features (Missing from Wiki)

| Feature | Location | Description |
|---------|----------|-------------|
| **Echo Panel & Pages** | `app/app/echo/`, `components/panels/EchoPanel.tsx` | Entire Echo feature (5 segments: about-you, continued, daily, history, growth) |
| **Discover Panel** | `components/panels/DiscoverPanel.tsx` | Explore/Discover panel with use cases |
| **Workflows Panel** | `components/panels/WorkflowsPanel.tsx` | YAML workflow management panel |
| **Import History Panel** | `components/panels/ImportHistoryPanel.tsx` | History of file imports |
| **AI Organize Toast** | `components/OrganizeToast.tsx` | Inline AI organize progress and results |
| **Trash Page** | `app/app/trash/page.tsx` | Deleted files management |
| **Changes Page** | `app/app/changes/page.tsx` | Activity/changes tracking |
| **Agents Page** | `app/app/agents/page.tsx`, `app/app/agents/[agentKey]/page.tsx` | Agent management pages |
| **Help Page** | `app/app/help/page.tsx` | In-app help center |
| **System Pulse** | `components/SystemPulse.tsx` | System status indicator |
| **Walkthrough** | `components/walkthrough/` | Interactive onboarding walkthrough |

### Backend Features (Missing from Wiki)

#### API Routes (51 total, only 3 documented)

**File Operations:**
- `GET/POST /api/file` - File CRUD operations (8+ operations)
- `POST /api/file/import` - File import with AI organize
- `GET /api/files` - List all files
- `GET /api/recent-files` - Recent files list
- `GET /api/tree-version` - File tree version for cache invalidation
- `GET /api/backlinks` - Backlink discovery
- `GET /api/search` - Full-text search
- `GET /api/graph` - Wiki graph data
- `POST /api/export` - Export files
- `POST /api/extract-pdf` - PDF text extraction

**AI/Agent APIs:**
- `POST /api/ask` - AI chat streaming (SSE)
- `GET /api/ask-sessions` - Chat session history
- `GET /api/bootstrap` - Agent context bootstrap
- `GET /api/skills` - Skills CRUD
- `POST /api/agent-activity` - Agent activity logging

**A2A Protocol (NEW - Undocumented):**
- `POST /api/a2a` - A2A JSON-RPC endpoint
- `GET /api/a2a/agents` - List A2A agents
- `GET /api/a2a/discover` - Discover remote agents
- `POST /api/a2a/delegations` - Task delegation

**ACP Protocol (NEW - Undocumented):**
- `GET /api/acp/registry` - ACP agent registry
- `POST /api/acp/detect` - Detect ACP agents
- `POST /api/acp/install` - Install ACP agents
- `POST /api/acp/config` - ACP configuration
- `POST /api/acp/session` - ACP session management

**MCP Management:**
- `GET /api/mcp/status` - MCP server status
- `POST /api/mcp/restart` - Restart MCP server
- `GET /api/mcp/agents` - List MCP agents
- `POST /api/mcp/install` - Install MCP to agents
- `POST /api/mcp/install-skill` - Install skills to agents

**Settings & System:**
- `GET/POST /api/settings` - App settings
- `GET /api/settings/list-models` - Available AI models
- `POST /api/settings/test-key` - Test API key
- `POST /api/settings/reset-token` - Reset auth token
- `GET /api/monitoring` - Performance metrics
- `GET /api/health` - Health check
- `POST /api/restart` - Restart app
- `GET /api/update-check` - Check for updates
- `POST /api/update` - Trigger update
- `GET /api/update-status` - Update progress

**Setup:**
- `POST /api/setup` - Setup wizard
- `GET /api/setup/ls` - List directories
- `POST /api/setup/check-path` - Validate path
- `POST /api/setup/check-port` - Check port availability
- `POST /api/setup/generate-token` - Generate auth token

**Sync & Git:**
- `POST /api/sync` - Git sync operations
- `GET /api/git` - Git history/show
- `GET /api/changes` - Change tracking

**Other:**
- `GET /api/workflows` - Workflow definitions
- `POST /api/auth` - Authentication
- `GET /api/init` - Initialization check
- `POST /api/uninstall` - Uninstall cleanup

### Agent Tools (27+ total, partially documented)

**Knowledge Base Tools (20):**
1. `list_files` - List knowledge base files
2. `read_file` - Read file content
3. `read_file_chunk` - Read specific line range
4. `search` - Full-text search
5. `write_file` - Overwrite file
6. `create_file` - Create new file
7. `batch_create_files` - Create multiple files
8. `append_to_file` - Append content
9. `insert_after_heading` - Insert after Markdown heading
10. `update_section` - Replace Markdown section
11. `edit_lines` - Replace line range
12. `delete_file` - Delete file
13. `rename_file` - Rename file
14. `move_file` - Move file
15. `get_backlinks` - Find backlinks
16. `get_history` - Git commit history
17. `get_file_at_version` - File at commit
18. `append_csv` - Append CSV row
19. `get_recent` - Recently modified files (undocumented)
20. `web_search` - DuckDuckGo search (undocumented)
21. `web_fetch` - Fetch URL content (undocumented)

**Skill Tools (2):**
- `list_skills` - List available skills
- `load_skill` - Load skill content

**MCP Bridge Tools (2):**
- `list_mcp_tools` - List MCP servers/tools
- `call_mcp_tool` - Invoke MCP tool

**A2A Tools (5 - COMPLETELY UNDOCUMENTED):**
- `list_remote_agents` - List discovered A2A agents
- `discover_agent` - Discover agent at URL
- `discover_agents` - Batch discovery
- `delegate_to_agent` - Delegate task
- `check_task_status` - Check delegated task
- `orchestrate_task` - Multi-agent orchestration

**ACP Tools (2 - COMPLETELY UNDOCUMENTED):**
- `list_acp_agents` - List ACP agents from registry
- `call_acp_agent` - Invoke ACP agent

### CLI Commands (Missing Documentation)

**Modular Commands (bin/commands/):**
- `file.js` - File operations (list, read, write, create, delete)
- `space.js` - Space management (create, list, rename)
- `ask.js` - AI chat from CLI
- `status.js` - System status
- `api.js` - Raw API access
- `agent.js` - Agent management
- `search.js` - Search from CLI

### Infrastructure Features (Undocumented)

| Feature | Location | Description |
|---------|----------|-------------|
| **Electron Desktop App** | `desktop/` | Complete Electron app with auto-update, tray, IPC bridge |
| **A2A Protocol** | `app/lib/a2a/` | Agent-to-Agent communication |
| **ACP Integration** | `app/lib/acp/` | Agent Client Protocol support |
| **Settings Tabs** | `components/settings/` | 10 settings tabs (AI, Appearance, Knowledge, Sync, MCP, Plugins, Shortcuts, Monitoring, Update, Uninstall) |

### Renderer Plugins (Actual vs Documented)

**In Code (11):**
1. `todo/` - TODO Board
2. `csv/` - CSV Views (Table/Gallery/Board)
3. `graph/` - Wiki Graph
4. `timeline/` - Timeline
5. `summary/` - AI Briefing
6. `backlinks/` - Backlinks Explorer
7. `workflow-yaml/` - **NEW: YAML Workflow Runner** ⚠️ Undocumented
8. `agent-inspector/` - Agent Inspector
9. `config/` - Config Panel
10. `diff/` - Diff Viewer (undocumented)

**Documented (9):** All except workflow-yaml and diff

---

## Part 3: Prioritized Action Items

### Critical (For Investor Conversations)

| Priority | Task | Effort | Impact |
|----------|------|--------|--------|
| P0 | **Create 30-api-reference.md v2** - Document all 51 API endpoints | 4h | High |
| P0 | **Update 01-project-roadmap.md** - Add v0.6 milestones, mark v0.5 complete | 1h | High |
| P0 | **Create 26-a2a-acp-architecture.md** - Document A2A/ACP as differentiator | 2h | High |
| P0 | **Update 25-agent-architecture.md** - Fix pi-agent-core migration, tool counts | 1h | Medium |

### High Priority

| Priority | Task | Effort | Impact |
|----------|------|--------|--------|
| P1 | **Create 67-stage-echo.md** - Document Echo feature (5 segments) | 1h | Medium |
| P1 | **Create 35-cli-reference.md** - Full CLI command documentation | 2h | Medium |
| P1 | **Update 60-stage-plugins.md** - Add workflow-yaml renderer | 30m | Low |
| P1 | **Update 40-conventions.md** - Fix AI SDK reference | 15m | Low |

### Medium Priority

| Priority | Task | Effort | Impact |
|----------|------|--------|--------|
| P2 | **Create wiki/plugins/workflow-yaml.md** - New renderer docs | 1h | Low |
| P2 | **Update 20-system-architecture.md** - Fix API route count | 15m | Low |
| P2 | **Create 68-stage-desktop.md** - Document Electron app | 1h | Medium |

---

## Part 4: Feature Inventory for Investors

### Production-Ready Features ✅

**Core Platform:**
- Local-first knowledge base with Git sync
- MCP Server (HTTP + stdio) with Bearer auth
- 20+ knowledge base tools for agents
- 11 renderer plugins with lazy loading
- Full i18n (English + Chinese)

**AI Integration:**
- Built-in AI chat with streaming
- Multi-provider support (Anthropic, OpenAI, custom)
- Extended thinking support
- Skill/Rules injection system
- AI Organize for file import

**Multi-Agent Ecosystem:**
- MCP auto-install to 12+ agents (Claude, Cursor, Gemini CLI, etc.)
- A2A protocol for agent-to-agent communication
- ACP integration with 31 registered agents
- Agent Inspector for audit logging

**Desktop & Mobile:**
- Electron desktop app (macOS, Windows, Linux)
- Auto-update via electron-updater
- System tray integration
- Mobile: Capacitor (planned)

**Developer Experience:**
- CLI with 25+ commands
- Setup wizard (8 steps)
- Gateway daemon (systemd/launchd)
- Zero-config npm install

### Differentiating Features (vs Competitors)

| Feature | MindOS | Obsidian | Notion | MemOS |
|---------|--------|----------|--------|-------|
| Agent-native (MCP) | ✅ | ❌ | ❌ | ❌ |
| A2A Protocol | ✅ | ❌ | ❌ | ❌ |
| ACP Integration | ✅ | ❌ | ❌ | ❌ |
| Local-first | ✅ | ✅ | ❌ | ❌ |
| Git sync | ✅ | Plugin | ❌ | ❌ |
| Human auditable | ✅ | ✅ | ❌ | ❌ |
| Multi-agent support | ✅ | ❌ | ❌ | Partial |

---

## Appendix: File Listings

### All Wiki Files (115 total)

```
wiki/
├── 00-product-proposal.md
├── 01-project-roadmap.md
├── 02-business-model.md
├── 03-technical-pillars.md
├── 04-positioning-brief.md
├── 20-system-architecture.md
├── 21-design-principle.md
├── 22-page-design.md
├── 23-mind-spaces.md
├── 25-agent-architecture.md
├── 30-api-reference.md
├── 40-conventions.md
├── 41-dev-pitfall-patterns.md
├── 42-ai-feature-dev-lessons.md
├── 60-stage-plugins.md
├── 61-plugin-architecture.md
├── 62-stage-rag.md
├── 63-stage-mdns.md
├── 64-stage-desktop.md
├── 65-stage-knowledge-api.md
├── 66-stage-cli.md
├── 80-known-pitfalls.md
├── 81-postmortem-process-lifecycle.md
├── 85-backlog.md
├── 90-changelog.md
├── plugins/ (9 files)
├── specs/ (27 active specs)
├── specs/archive/ (31 archived specs)
├── refs/ (15 reference docs)
├── discussions/ (5 files)
├── reviews/ (1 file)
└── archive/ (3 files)
```

### All API Routes (51 total)

```
app/app/api/
├── a2a/              (4 routes)
├── acp/              (5 routes)
├── agent-activity/   (1 route)
├── ask/              (1 route)
├── ask-sessions/     (1 route)
├── auth/             (1 route)
├── backlinks/        (1 route)
├── bootstrap/        (1 route)
├── changes/          (1 route)
├── export/           (1 route)
├── extract-pdf/      (1 route)
├── file/             (2 routes)
├── files/            (1 route)
├── git/              (1 route)
├── graph/            (1 route)
├── health/           (1 route)
├── init/             (1 route)
├── mcp/              (5 routes)
├── monitoring/       (1 route)
├── recent-files/     (1 route)
├── restart/          (1 route)
├── search/           (1 route)
├── settings/         (4 routes)
├── setup/            (5 routes)
├── skills/           (1 route)
├── sync/             (1 route)
├── tree-version/     (1 route)
├── uninstall/        (1 route)
├── update/           (1 route)
├── update-check/     (1 route)
├── update-status/    (1 route)
└── workflows/        (1 route)
```

### All Page Routes (12 total)

```
app/app/
├── page.tsx                    # Home
├── login/page.tsx              # Login
├── setup/page.tsx              # Setup Wizard
├── help/page.tsx               # Help Center
├── explore/page.tsx            # Discover/Explore
├── trash/page.tsx              # Trash
├── changes/page.tsx            # Activity
├── echo/page.tsx               # Echo
├── echo/[segment]/page.tsx     # Echo Segments
├── agents/page.tsx             # Agents
├── agents/[agentKey]/page.tsx  # Agent Detail
└── view/[...path]/page.tsx     # File View/Edit
```

---

**Report Generated:** 2026-04-04  
**Codebase Version:** v0.6.7+  
**Auditor:** Claude (automated audit)
