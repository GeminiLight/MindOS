# Spec: Agent Interoperability — MCP 安装全景

> MindOS 通过 MCP 协议与各 AI Coding Agent 互操作。本文档记录所有已支持和待支持 agent 的配置信息，以及安装/检测机制的实现。

## 涉及文件

| 文件 | 职责 |
|------|------|
| `app/lib/mcp-agents.ts` | Agent 定义注册表 + 安装检测 (`detectInstalled`) + 存在检测 (`detectAgentPresence`) |
| `app/app/api/mcp/agents/route.ts` | GET — 列出所有 agent 及其安装/存在状态 |
| `app/app/api/mcp/install/route.ts` | POST — 将 MindOS MCP 配置写入指定 agent 的配置文件 |
| `app/app/api/mcp/install-skill/route.ts` | POST — 向已安装的 agent 安装 skill |
| `app/components/setup/StepAgents.tsx` | Setup Wizard 第 5 步 — Agent 选择 UI |
| `app/components/setup/index.tsx` | Setup Wizard 主组件 — 调用安装 API |

## AgentDef 接口

```ts
export interface AgentDef {
  name: string;                             // 显示名
  project: string | null;                   // 项目级配置文件相对路径（null = 不支持）
  global: string;                           // 全局配置文件路径（~ 展开）
  key: string;                              // 配置中 MCP servers map 所在的顶层 key
  preferredTransport: 'stdio' | 'http';     // 默认传输方式
  presenceCli?: string;                     // CLI 二进制名（用于 which/where 检测）
  presenceDirs?: string[];                  // 存在检测目录（任一存在 → present）
  // ─── 扩展字段（新增 agent 可能需要）───
  format?: 'json' | 'toml';                // 配置文件格式（默认 json）
  globalNestedKey?: string;                 // 全局配置的嵌套路径（如 VS Code "mcp.servers"）
}
```

## 已支持 Agent（16 个）

所有已支持 agent 均为 JSON 格式、`mcpServers` key、stdio 传输。

| # | Key | 名称 | 全局配置 | 项目配置 | CLI | 检测目录 |
|---|-----|------|---------|---------|-----|---------|
| 1 | `claude-code` | Claude Code | `~/.claude.json` | `.mcp.json` | `claude` | `~/.claude/` |
| 2 | `codebuddy` | CodeBuddy | `~/.claude-internal/.claude.json` | — | `claude-internal` | `~/.claude-internal/` |
| 3 | `cursor` | Cursor | `~/.cursor/mcp.json` | `.cursor/mcp.json` | — | `~/.cursor/` |
| 4 | `windsurf` | Windsurf | `~/.codeium/windsurf/mcp_config.json` | — | — | `~/.codeium/windsurf/` |
| 5 | `cline` | Cline | `~/Library/.../saoudrizwan.claude-dev/.../cline_mcp_settings.json` | — | — | VS Code globalStorage |
| 6 | `roo` | Roo Code | `~/Library/.../rooveterinaryinc.roo-cline/.../mcp_settings.json` | `.roo/mcp.json` | — | VS Code globalStorage |
| 7 | `trae` | Trae | `~/.trae/mcp.json` | `.trae/mcp.json` | — | `~/.trae/` |
| 8 | `trae-cn` | Trae CN | `~/Library/Application Support/Trae CN/User/mcp.json` | `.trae/mcp.json` | `trae-cli` | App Support / .config |
| 9 | `gemini-cli` | Gemini CLI | `~/.gemini/settings.json` | `.gemini/settings.json` | `gemini` | `~/.gemini/` |
| 10 | `kimi-cli` | Kimi Code | `~/.kimi/mcp.json` | `.kimi/mcp.json` | `kimi` | `~/.kimi/` |
| 11 | `qwen-code` | Qwen Code | `~/.qwen/settings.json` | `.qwen/settings.json` | `qwen` | `~/.qwen/` |
| 12 | `openclaw` | OpenClaw | `~/.openclaw/mcp.json` | — | `openclaw` | `~/.openclaw/` |
| 13 | `opencode` | OpenCode | `~/.config/opencode/config.json` | — | `opencode` | `~/.config/opencode/` |
| 14 | `iflow-cli` | iFlow CLI | `~/.iflow/settings.json` | `.iflow/settings.json` | `iflow` | `~/.iflow/` |
| 15 | `pi` | Pi | `~/.pi/agent/mcp.json` | `.pi/settings.json` | `pi` | `~/.pi/` |
| 16 | `augment` | Augment | `~/.augment/settings.json` | `.augment/settings.json` | `auggie` | `~/.augment/` |

> 注：macOS 路径示例。Cline / Roo / Trae CN 在 Linux 下走 `~/.config/Code/User/globalStorage/...`

## 待新增 Agent（3 个）

### 1. Codex (OpenAI) — ⚠️ TOML 格式

| 项 | 值 |
|----|-----|
| Key | `codex` |
| 名称 | Codex |
| 厂商 | OpenAI |
| CLI | `codex`（`npm i -g @openai/codex`）|
| 数据目录 | `~/.codex/` |
| 全局配置 | `~/.codex/config.toml` |
| 项目配置 | `.codex/config.toml` |
| 格式 | **TOML**（唯一非 JSON 的 agent）|
| MCP key | `[mcp_servers]`（snake_case TOML 表）|
| Transport | stdio |

配置结构：
```toml
# stdio
[mcp_servers.mindos]
command = "mindos"
args = ["mcp"]

[mcp_servers.mindos.env]
MCP_TRANSPORT = "stdio"

# http
[mcp_servers.mindos]
type = "http"
url = "http://localhost:8781/mcp"

[mcp_servers.mindos.headers]
Authorization = "Bearer xxx"
```

### 2. Antigravity (Google) — 标准 JSON

| 项 | 值 |
|----|-----|
| Key | `antigravity` |
| 名称 | Antigravity |
| 厂商 | Google |
| CLI | `agy` |
| 数据目录 | `~/.gemini/antigravity/` |
| 全局配置 | `~/.gemini/antigravity/mcp_config.json` |
| 项目配置 | — |
| 格式 | JSON |
| MCP key | `mcpServers` |
| Transport | stdio |

与 Claude Code 结构完全一致，零适配。

### 3. VS Code (Copilot) — 嵌套 JSON + JSONC

| 项 | 值 |
|----|-----|
| Key | `vscode` |
| 名称 | VS Code |
| 厂商 | GitHub / Microsoft |
| CLI | —（VS Code 扩展，非独立 CLI）|
| 检测 | 检测 VS Code 用户目录 |
| 项目配置 | `.vscode/mcp.json`（key: `servers`）|
| 全局配置 | VS Code `settings.json`（key: `mcp` → `servers`）|
| 格式 | JSON（项目级）/ JSONC（全局级，含注释）|
| Transport | stdio |

> VS Code 1.98+ 原生支持 MCP。Copilot Agent Mode 使用此配置。命名 "VS Code" 而非 "Copilot"，因为 MCP 是 VS Code 平台能力。

全局路径（因 OS 而异）：
- macOS: `~/Library/Application Support/Code/User/settings.json`
- Linux: `~/.config/Code/User/settings.json`

项目级结构（顶层 key 是 `servers`）：
```json
{
  "servers": {
    "mindos": {
      "type": "stdio",
      "command": "mindos",
      "args": ["mcp"]
    }
  }
}
```

全局结构（嵌套在 `mcp` 下）：
```json
{
  "editor.fontSize": 14,
  "mcp": {
    "servers": {
      "mindos": {
        "type": "stdio",
        "command": "mindos",
        "args": ["mcp"]
      }
    }
  }
}
```

## 实现方案

### 1. AgentDef 扩展

新增 `format` 和 `globalNestedKey` 可选字段（见上方接口定义）。现有 16 个 agent 不需要这两个字段。

### 2. Agent 定义

```ts
'codex': {
  name: 'Codex',
  project: '.codex/config.toml',
  global: '~/.codex/config.toml',
  key: 'mcp_servers',
  format: 'toml',
  preferredTransport: 'stdio',
  presenceCli: 'codex',
  presenceDirs: ['~/.codex/'],
},
'antigravity': {
  name: 'Antigravity',
  project: null,
  global: '~/.gemini/antigravity/mcp_config.json',
  key: 'mcpServers',
  preferredTransport: 'stdio',
  presenceCli: 'agy',
  presenceDirs: ['~/.gemini/antigravity/'],
},
'github-copilot': {
  name: 'GitHub Copilot',
  project: '.vscode/mcp.json',
  global: process.platform === 'darwin'
    ? '~/Library/Application Support/Code/User/mcp.json'
    : '~/.config/Code/User/mcp.json',
  key: 'servers',
  preferredTransport: 'stdio',
  presenceDirs: [
    '~/Library/Application Support/Code/',
    '~/.config/Code/',
  ],
  presenceCli: 'code',
},
```

### 3. 写入逻辑适配（install/route.ts）

当前写入逻辑假设全部 JSON + 扁平 key。需要三路分支：

```ts
if (agent.format === 'toml') {
  upsertTomlMcpServer(absPath, 'mindos', entry);
} else if (isGlobal && agent.globalNestedKey) {
  upsertNestedJson(absPath, agent.globalNestedKey, 'mindos', entry);
} else {
  // 现有逻辑（JSON 扁平 key）— 不变
}
```

#### 3a. TOML 写入 — 逐行扫描

不引入 TOML 解析库。不能用正则 `[^\[]*` 匹配段内容——TOML 值如 `args = ["mcp"]` 包含字面 `[`，正则会提前断裂。改用逐行扫描：

```ts
function upsertTomlMcpServer(filePath: string, serverName: string, entry: Record<string, unknown>): void {
  let lines: string[] = [];
  if (fs.existsSync(filePath)) lines = fs.readFileSync(filePath, 'utf-8').split('\n');

  // 移除 [mcp_servers.<name>] 及其子表 [mcp_servers.<name>.*]
  const prefix = `[mcp_servers.${serverName}`;
  const filtered: string[] = [];
  let skipping = false;
  for (const line of lines) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith('[')) {
      skipping = trimmed.startsWith(prefix)
        && (trimmed[prefix.length] === ']' || trimmed[prefix.length] === '.');
    }
    if (!skipping) filtered.push(line);
  }
  while (filtered.length && filtered[filtered.length - 1].trim() === '') filtered.pop();

  // 追加新段
  const out: string[] = ['', `[mcp_servers.${serverName}]`];
  if (entry.type === 'stdio') {
    out.push(`command = "${entry.command ?? 'mindos'}"`);
    const args = entry.args as string[] | undefined;
    if (args?.length) out.push(`args = [${args.map(a => `"${a}"`).join(', ')}]`);
    const env = entry.env as Record<string, string> | undefined;
    if (env && Object.keys(env).length) {
      out.push('');
      out.push(`[mcp_servers.${serverName}.env]`);
      for (const [k, v] of Object.entries(env)) out.push(`${k} = "${v}"`);
    }
  } else {
    out.push(`type = "http"`);
    out.push(`url = "${entry.url}"`);
    const headers = entry.headers as Record<string, string> | undefined;
    if (headers) {
      out.push('');
      out.push(`[mcp_servers.${serverName}.headers]`);
      for (const [k, v] of Object.entries(headers)) out.push(`${k} = "${v}"`);
    }
  }

  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, [...filtered, ...out, ''].join('\n'), 'utf-8');
}
```

#### 3b. 嵌套 JSON 写入 — 含 JSONC strip

VS Code `settings.json` 是 JSONC（含 `//` `/* */` 注释），`JSON.parse()` 会报错。

```ts
/** Strip // and /* */ comments from JSONC. */
export function stripJsonComments(text: string): string {
  let result = text.replace(/\/\*[\s\S]*?\*\//g, '');
  result = result.replace(/^\s*\/\/.*$/gm, '');
  result = result.replace(/,\s*\/\/.*$/gm, ',');
  return result;
}

function upsertNestedJson(filePath: string, nestedKey: string, serverName: string, entry: Record<string, unknown>): void {
  let config: Record<string, unknown> = {};
  if (fs.existsSync(filePath)) config = JSON.parse(stripJsonComments(fs.readFileSync(filePath, 'utf-8')));

  const keys = nestedKey.split('.');
  let obj: Record<string, unknown> = config;
  for (const k of keys) {
    if (!obj[k] || typeof obj[k] !== 'object') obj[k] = {};
    obj = obj[k] as Record<string, unknown>;
  }
  obj[serverName] = entry;

  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}
```

写回后注释丢失（JSON.stringify 限制）。可接受——VS Code 自身 GUI 改设置也不保留注释。

### 4. 检测逻辑适配（mcp-agents.ts detectInstalled）

```ts
for (const [scope, cfgPath] of [['global', agent.global], ['project', agent.project]] as const) {
  if (!cfgPath) continue;
  const absPath = expandHome(cfgPath);
  if (!fs.existsSync(absPath)) continue;

  // TOML
  if (agent.format === 'toml') {
    const content = fs.readFileSync(absPath, 'utf-8');
    if (/^\[mcp_servers\.mindos[\].]/m.test(content)) {
      const isStdio = /^\s*command\s*=/m.test(content);
      return { installed: true, scope, transport: isStdio ? 'stdio' : 'http', configPath: cfgPath };
    }
    continue;
  }

  // JSON / JSONC
  try {
    const config = JSON.parse(stripJsonComments(fs.readFileSync(absPath, 'utf-8')));
    let servers: Record<string, unknown> | undefined;
    if (scope === 'global' && agent.globalNestedKey) {
      let obj: Record<string, unknown> = config;
      for (const k of agent.globalNestedKey.split('.')) {
        obj = (obj?.[k] ?? undefined) as Record<string, unknown>;
        if (!obj) break;
      }
      servers = obj;
    } else {
      servers = config[agent.key];
    }
    if (servers?.mindos) {
      const e = servers.mindos as Record<string, unknown>;
      return { installed: true, scope, transport: e.type === 'stdio' ? 'stdio' : e.url ? 'http' : 'unknown', configPath: cfgPath };
    }
  } catch { /* ignore */ }
}
```

`stripJsonComments` 定义在 `mcp-agents.ts` 中导出，`install/route.ts` 也 import。

## 变更文件清单

| 文件 | 改动 |
|------|------|
| `app/lib/mcp-agents.ts` | AgentDef 新增 `format?` / `globalNestedKey?` + 3 个 agent 定义 + `detectInstalled` 适配 + 导出 `stripJsonComments` |
| `app/app/api/mcp/install/route.ts` | 新增 `upsertTomlMcpServer` + `upsertNestedJson` + 写入三路分支 + import `stripJsonComments` |

## 不做的事

- **不引入 TOML 解析库**：逐行扫描 + 手动拼接够用
- **不改 `buildEntry()`**：stdio 已含 `type: 'stdio'`
- **不做 VS Code 扩展检测**：`code --list-extensions` 慢且需 PATH。目录检测足够
- **不支持 Windows**：VS Code Windows 路径用 `%APPDATA%`，当前项目不涉及

## 验收标准

1. Setup Wizard Agent 步骤列出全部 19 个 agent（已安装自动勾选）
2. 选中新 agent 后 Complete，配置文件正确写入：
   - Codex: `~/.codex/config.toml` 含 `[mcp_servers.mindos]` 段
   - Antigravity: `~/.gemini/antigravity/mcp_config.json` 含 `mcpServers.mindos`
   - VS Code 项目级: `.vscode/mcp.json` 含 `servers.mindos`
   - VS Code 全局: `settings.json` 含 `mcp.servers.mindos`（其余配置不丢失）
3. `detectInstalled()` 正确识别 JSON + TOML + 嵌套 JSON
4. 现有 16 个 agent 安装行为不变（回归）
5. TypeScript 编译无新增错误
