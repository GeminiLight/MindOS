<!-- Last verified: 2026-04-04 | Current version: v0.6 -->

# API Reference

> MindOS 提供 51 个 API 端点，覆盖文件操作、AI 对话、Agent 协作、系统管理等。
> 所有端点要求 Bearer Token 认证（浏览器同源请求免认证）。

---

## 文件操作

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/file` | GET | 读取文件内容。参数：`?path=` |
| `/api/file` | PUT | 更新文件内容。Body：`{ path, content }` |
| `/api/file` | DELETE | 删除文件（移入回收站）。参数：`?path=` |
| `/api/file` | POST | 文件操作（create/rename/move）。Body：`{ action, ... }` |
| `/api/file/import` | POST | 文件导入（支持 AI Organize）。multipart/form-data |
| `/api/files` | GET | 文件树。返回 `FileNode[]` |
| `/api/recent-files` | GET | 最近修改文件列表 |
| `/api/tree-version` | GET | 文件树版本号（用于客户端缓存失效） |
| `/api/backlinks` | GET | 反向链接查询。参数：`?path=` |
| `/api/search` | GET | 全文搜索。参数：`?q=` |
| `/api/graph` | GET | Wiki 知识图谱数据（nodes + edges） |
| `/api/export` | POST | 导出文件/目录（MD/HTML/ZIP） |
| `/api/extract-pdf` | POST | PDF 文本提取 |
| `/api/changes` | GET | 变更事件追踪（summary/list/mark_seen） |
| `/api/git` | GET | Git 操作（history/show） |

## AI 对话

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/ask` | POST | AI 对话（SSE 流式）。Body：`{ messages, sessionId, currentFile, attachedFiles, mode }` |
| `/api/ask-sessions` | GET/DELETE | 会话历史管理 |
| `/api/bootstrap` | GET | Agent 上下文引导加载（INSTRUCTION + CONFIG + README） |
| `/api/skills` | GET/POST | Skills 列表与 CRUD |
| `/api/agent-activity` | POST | Agent 活动日志记录 |

## A2A Protocol (Agent-to-Agent 通信)

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/a2a` | POST | A2A JSON-RPC 入口（SendMessage / GetTask / CancelTask） |
| `/api/a2a/agents` | GET | 列出已知 A2A Agent |
| `/api/a2a/discover` | GET/POST | 发现远程 A2A Agent |
| `/api/a2a/delegations` | POST | 任务委派 |

## ACP Protocol (Agent Client Protocol)

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/acp/registry` | GET | ACP Agent 注册表（31+ Agent） |
| `/api/acp/detect` | POST | 检测本地 ACP Agent |
| `/api/acp/install` | POST | 安装 ACP Agent |
| `/api/acp/config` | POST | ACP Agent 配置 |
| `/api/acp/session` | POST | ACP Session 创建与管理 |

## MCP 管理

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/mcp/status` | GET | MCP Server 运行状态 |
| `/api/mcp/restart` | POST | 重启 MCP Server |
| `/api/mcp/agents` | GET | MCP Agent 列表（含连接状态、已安装 Skill/MCP） |
| `/api/mcp/install` | POST | 安装 MCP 配置到 Agent |
| `/api/mcp/install-skill` | POST | 安装 Skill 到 Agent |

## Settings & 系统

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/settings` | GET/PUT/PATCH | 应用设置读写 |
| `/api/settings/list-models` | GET | 可用 AI 模型列表 |
| `/api/settings/test-key` | POST | API Key 连通性测试 |
| `/api/settings/reset-token` | POST | 重置 Auth Token |
| `/api/monitoring` | GET | 性能监控数据（系统/应用/知识库/MCP 指标） |
| `/api/health` | GET | 健康检查 |
| `/api/restart` | POST | 重启服务 |
| `/api/update-check` | GET | 检查更新 |
| `/api/update` | POST | 触发更新 |
| `/api/update-status` | GET | 更新进度 |
| `/api/uninstall` | POST | 卸载清理 |

## Setup

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/setup` | GET/POST/PATCH | 安装向导状态管理 |
| `/api/setup/ls` | GET | 列出目录内容 |
| `/api/setup/check-path` | POST | 验证知识库路径 |
| `/api/setup/check-port` | POST | 检查端口可用性 |
| `/api/setup/generate-token` | POST | 生成 Auth Token |

## Sync & Git

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/sync` | POST | Git 同步操作 |
| `/api/git` | GET | Git 历史与版本查看 |
| `/api/changes` | GET/POST | 变更事件追踪 |

## Other

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/auth` | POST | Token 认证 |
| `/api/init` | GET | 初始化状态检查 |
| `/api/workflows` | GET/POST/DELETE | 工作流定义 CRUD |

---

## 详细文档

### GET /api/monitoring

Performance monitoring data. Polled every 5s by the Settings > Monitoring tab.

**Response:**

```json
{
  "system": {
    "uptimeMs": 123456,
    "memory": { "heapUsed": 52428800, "heapTotal": 67108864, "rss": 104857600 },
    "nodeVersion": "v22.x.x"
  },
  "application": {
    "agentRequests": 42,
    "toolExecutions": 156,
    "totalTokens": 12500,
    "avgResponseTimeMs": 850,
    "errors": 2
  },
  "knowledgeBase": {
    "root": "/path/to/my-mind",
    "fileCount": 127,
    "totalSizeBytes": 524288
  },
  "mcp": {
    "running": true,
    "port": 8781
  }
}
```

**Notes:**
- KB stats are cached (30s TTL) to avoid expensive disk scans
- Metrics come from `MetricsCollector` singleton (AIP-002)

---

### GET /api/changes

Content change tracking for the Activity panel.

**Operations:**

| op | Method | Params | Response |
|----|--------|--------|----------|
| `summary` | GET | — | `{ unseenCount, lastEventAt }` |
| `list` | GET | `?path=`, `?source=user\|agent\|system`, `?event_op=`, `?q=`, `?limit=50` | `{ events: [...] }` |
| `mark_seen` | POST | `{ "op": "mark_seen" }` | `{ ok: true }` |

**Event object:**

```json
{
  "id": "uuid",
  "path": "Space/note.md",
  "op": "file_created",
  "source": "user",
  "timestamp": "2026-03-30T00:00:00.000Z"
}
```

**Source types:** `user` (UI action), `agent` (AI tool call), `system` (auto-sync, scaffold)

---

### Gateway (systemd / launchd)

CLI command: `mindos gateway install|uninstall|status|logs`

**Platform detection:**
- macOS: launchd (`~/Library/LaunchAgents/com.mindos.plist`)
- Linux: systemd user service (`~/.config/systemd/user/mindos.service`)

**What `gateway install` does:**
1. Generates platform-specific service config
2. Points to current `mindos start --daemon` entrypoint
3. Enables auto-start on login
4. Starts the service immediately

**What `gateway uninstall` does:**
1. Stops the service
2. Disables auto-start
3. Removes service config file

**Log access:**
- `mindos gateway logs` — tails `~/.mindos/mindos.log`
- `mindos gateway status` — checks if service is running

**Log rotation:**
- Auto-rotates when `mindos.log` > 2MB
- Keeps 1 backup (`.old`), max ~4MB total

---

## See Also

- [20-system-architecture.md](./20-system-architecture.md) — 系统架构总览
- [25-agent-architecture.md](./25-agent-architecture.md) — Agent 工具体系
