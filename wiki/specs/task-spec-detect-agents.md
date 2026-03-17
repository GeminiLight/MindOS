# Task Spec: Agent 真实安装检测

**Status**: Draft
**Scope**: `app/lib/mcp-agents.ts` + `bin/lib/mcp-agents.js` + API + GUI + CLI

---

## 背景

### 现状

`detectInstalled()` 检测的是 **MindOS MCP 是否已配置到该 agent 的 config 文件中**：

```typescript
// app/lib/mcp-agents.ts
if (servers?.mindos) return { installed: true };
```

它回答的问题是："我们有没有给这个 agent 写过 MindOS MCP 配置？"

### 问题

它**不回答**："用户机器上有没有装这个 agent？"

导致：
- **Setup Step 5**：展示 9 个 agent，全部显示 "not installed"（因为首次 setup 还没配过）。用户不知道哪些 agent 自己已经装了，得自己判断该勾哪些
- **Settings McpTab**：同样，首次看到的都是 "not installed"，无法区分 "agent 已安装但没配 MindOS MCP" 和 "agent 根本没装"
- **CLI Setup**：同上，`isAgentInstalled()` 只检查 MindOS config，无法预选用户已有的 agent

### 目标

新增 `detectAgentPresence()` 函数，检测 agent 本身是否存在于用户机器上，与现有 `detectInstalled()` 互补。

---

## 两个维度

| | Agent 未安装 | Agent 已安装 |
|---|---|---|
| **MindOS MCP 未配置** | 灰显，不可勾选 | 可勾选，推荐（高亮） |
| **MindOS MCP 已配置** | —（不可能） | ✅ 已配置 |

API 返回：
```typescript
interface AgentStatus {
  key: string;
  name: string;
  present: boolean;      // ← 新增：agent 是否安装在机器上
  installed: boolean;     // 已有：MindOS MCP 是否已配置
  // ... 其余字段不变
}
```

---

## 检测策略

每个 agent 的检测逻辑不同，按可靠性分三类：

### A. CLI 命令检测（`which` / PATH）

| Agent | 命令 | 检测方式 |
|-------|------|---------|
| Claude Code | `claude` | `which claude` |
| CodeBuddy | `claude-internal` | `which claude-internal` |
| Gemini CLI | `gemini` | `which gemini` |

```javascript
function hasCli(cmd) {
  try {
    execSync(`which ${cmd}`, { stdio: 'pipe' });
    return true;
  } catch { return false; }
}
// Windows: use `where` instead of `which`
```

### B. 配置/数据目录检测

| Agent | 检测路径 | 说明 |
|-------|---------|------|
| Cursor | `~/.cursor/` | Cursor 会创建此目录 |
| Windsurf | `~/.codeium/windsurf/` | Windsurf 数据目录 |
| Trae | `~/.trae/` | Trae 数据目录 |
| OpenClaw | `~/.openclaw/` | OpenClaw 数据目录 |
| Cline | VS Code globalStorage 下 `saoudrizwan.claude-dev/` | Cline 插件数据目录 |

```javascript
function hasDir(dirPath) {
  return fs.existsSync(expandHome(dirPath));
}
```

### C. 应用目录检测（补充）

| Agent | macOS | Linux |
|-------|-------|-------|
| Claude Desktop | `/Applications/Claude.app` 或 `~/Applications/Claude.app` | `~/.config/Claude/` |
| Cursor | `/Applications/Cursor.app` | 已有 `~/.cursor/` |

**优先用 B 类**（数据目录），因为跨平台一致。应用目录只在 B 类路径不存在时作为补充。

---

## 实现

### 1. 新增 `detectAgentPresence()` — 共享逻辑

**文件**: `app/lib/mcp-agents.ts`（App 侧）+ `bin/lib/mcp-agents.js`（CLI 侧）

```typescript
// 每个 agent 的检测配置
interface PresenceCheck {
  cli?: string;           // CLI 命令名（which 检测）
  dirs?: string[];        // 数据目录（任一存在即视为已安装）
  apps?: string[];        // macOS .app 路径（补充检测）
}

const PRESENCE_CHECKS: Record<string, PresenceCheck> = {
  'claude-code':    { cli: 'claude',           dirs: ['~/.claude/'] },
  'claude-desktop': { dirs: ['~/Library/Application Support/Claude/', '~/.config/Claude/'], apps: ['/Applications/Claude.app'] },
  'cursor':         { dirs: ['~/.cursor/'],    apps: ['/Applications/Cursor.app'] },
  'windsurf':       { dirs: ['~/.codeium/windsurf/'] },
  'cline':          { dirs: [
    '~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/',
    '~/.config/Code/User/globalStorage/saoudrizwan.claude-dev/',
    '~/.vscode/extensions/saoudrizwan.claude-dev-*/',  // glob
  ]},
  'trae':           { dirs: ['~/.trae/'] },
  'gemini-cli':     { cli: 'gemini',           dirs: ['~/.gemini/'] },
  'openclaw':       { cli: 'openclaw',         dirs: ['~/.openclaw/'] },
  'codebuddy':      { cli: 'claude-internal',  dirs: ['~/.claude-internal/'] },
};
```

```typescript
function detectAgentPresence(agentKey: string): boolean {
  const check = PRESENCE_CHECKS[agentKey];
  if (!check) return false;

  // 1. CLI check (fast)
  if (check.cli && hasCli(check.cli)) return true;

  // 2. Data directory check
  if (check.dirs?.some(d => hasDir(d))) return true;

  // 3. App bundle check (macOS only)
  if (check.apps?.some(a => fs.existsSync(a))) return true;

  return false;
}
```

### 2. 更新 API — `GET /api/mcp/agents`

**文件**: `app/app/api/mcp/agents/route.ts`

```diff
  const agents = Object.entries(MCP_AGENTS).map(([key, agent]) => {
    const status = detectInstalled(key);
+   const present = detectAgentPresence(key);
    return {
      key,
      name: agent.name,
+     present,           // agent 是否安装在机器上
      installed: status.installed,  // MindOS MCP 是否已配置
      // ...
    };
  });
```

### 3. 更新 GUI — SetupWizard Step 5

**文件**: `app/components/SetupWizard.tsx`

当前行为：
- 全部 agent 列出，`installed` 的预勾选
- 未 installed 的显示 "not installed"

新行为：
- `present && installed` → ✅ 已配置（绿色，预勾选）
- `present && !installed` → 可勾选，显示 "detected"（蓝色，推荐勾选）
- `!present && !installed` → 灰显，不可勾选，显示 "not found"
- 预勾选规则：`installed || present`（已有或检测到都默认勾上）

### 4. 更新 GUI — Settings McpTab

**文件**: `app/components/settings/McpTab.tsx`

- 在 agent 卡片中增加 `present` 标识
- `present && !installed` → 显示 "Install" 按钮（突出）
- `!present` → 显示 "Not found on this machine"（不可安装，但允许手动配置）

### 5. 更新 CLI — `scripts/setup.js`

在 `runMcpInstallStep()` 中：
- 增加 `detectAgentPresence()` 调用
- hint 改为三态：`installed`（MCP 已配） / `detected`（agent 在但没配 MCP） / `not found`
- 预选条件：`installed || present`
- `not found` 的 agent 仍可手动选（不禁止，但不预选）

---

## 边界情况

1. **WSL 环境**：Windows 应用装在宿主机，WSL 里检测不到 `.app`。靠 `~/.cursor/` 等目录检测可工作（VS Code Remote 会同步插件配置）
2. **Docker / 云开发机**：大多数 GUI agent 不存在，只有 CLI agent（claude, gemini）。正常——检测结果就是大部分 `present: false`
3. **多版本共存**：如 `claude` 和 `claude-internal` 同时存在，各自独立检测，互不影响
4. **Cline glob 路径**：`~/.vscode/extensions/saoudrizwan.claude-dev-*/` 需要 glob 匹配版本号后缀。用 `fs.readdirSync` + `startsWith` 实现
5. **检测性能**：`which` 和 `existsSync` 都很快（<5ms 量级），9 个 agent 串行检测也在 50ms 内。无需缓存

---

## 不做的事

- **不检测 agent 版本号**：只检测有/无，不关心版本
- **不安装 agent**：只检测，安装是用户自己的事
- **不禁止手动选择 not found 的 agent**：用户可能知道自己在做什么（如即将安装）
- **不做实时监听**：进入页面时检测一次，不 watch 文件系统变化

---

## 文件变更清单

| 操作 | 文件 | 说明 |
|------|------|------|
| 修改 | `app/lib/mcp-agents.ts` | 新增 `PRESENCE_CHECKS` + `detectAgentPresence()` |
| 修改 | `bin/lib/mcp-agents.js` | 同步新增（CLI 侧） |
| 修改 | `app/app/api/mcp/agents/route.ts` | 返回 `present` 字段 |
| 修改 | `app/components/SetupWizard.tsx` | Step 5 三态展示 + 智能预选 |
| 修改 | `app/components/settings/McpTab.tsx` | agent 卡片增加 present 标识 |
| 修改 | `scripts/setup.js` | CLI multi-select 增加 presence 检测 |
| 修改 | `app/lib/i18n.ts` | 新增 i18n key（detected, notFound） |
| 新增 | `app/__tests__/core/detect-agents.test.ts` | 单元测试 |

---

## 验证

1. `npm run build` 编译通过
2. 在已安装 Cursor 的机器上：Setup Step 5 显示 Cursor "detected"，预勾选
3. 在只有 claude CLI 的服务器上：只有 claude-code 显示 "detected"
4. 已配过 MindOS MCP 的 agent 显示 "installed"（优先级高于 "detected"）
5. Settings McpTab 中 present 状态正确展示
