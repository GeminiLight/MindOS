# Task Spec: User Onboarding Journey

**Version**: v0.5.3
**Status**: All P1/P2 items complete ✅ — SPEC-OB-04 全部完成
**Scope**: GUI (SetupWizard) + CLI (scripts/setup.js)

---

## 目标

让用户在**首次使用**或**重新配置** MindOS 时，通过引导流程完成全部必要配置，最终直接进入知识库，无需手动修改配置文件。再次 onboard 时应读取已有配置作为默认值，智能判断哪些变更需要重启服务。

---

## GUI Onboarding（SetupWizard）

**入口**: `/setup` 页面，首次使用时自动跳转；再次配置通过 Settings 页入口或 `/setup?force=1`

**步骤总数**: 6 步

| Step | 标题 | 核心内容 |
|------|------|----------|
| 1 | Knowledge Base | 知识库路径 + 模板选择（en / zh / empty） |
| 2 | AI Provider | 卡片式选择：Anthropic / OpenAI / Skip |
| 3 | Ports | Web 端口 + MCP 端口，含实时可用性检测 |
| 4 | Security | Auth Token 生成/复制 + Web 密码（可选） |
| 5 | Agent Tools | 多选 MCP Agent 配置，含安装状态展示 |
| 6 | Review | 汇总确认，点击 Complete 完成 |

### Step 2 — AI Provider

- 三张卡片：Anthropic（Brain 图标）/ OpenAI（Zap 图标）/ Skip（SkipForward 图标）
- 选择 Skip：跳过 AI 配置，后续可在 Settings 补填
- 选择 Anthropic / OpenAI：展开 API Key + Model 输入框
- OpenAI 额外展示 Base URL（兼容第三方 API）

### Step 3 — Port Validation

- 进入此步时自动检测两个端口可用性
- 输入框失焦时触发检测（POST `/api/setup/check-port`）
- 端口被占用：显示警告 + 自动推荐下一个可用端口（suggestion 按钮）
- 点击 suggestion：自动填入并重新检测
- 两端口相同：显示冲突警告
- **Next 按钮条件**：两端口均 `available === true` 且无冲突才可点击

> ✅ 已改进（SPEC-OB-05）：默认值从 config 读取，自身端口显示 "Current port" 而非误报占用

API 实现（`app/app/api/setup/check-port/route.ts`）：
- TCP connect 探测，500ms timeout
- `ECONNREFUSED` = 端口空闲；其他错误 = 视为占用
- `findFreePort`: for 循环从 start 扫到 65535，返回 `null` 若全部占用

### Step 5 — Agent Tools

- 从 `/api/mcp/agents` 加载支持的 Agent 列表（9 个，含 platform 判断）
- 已安装的 Agent 默认勾选，未安装的显示 "Not installed" badge
- 支持 Transport 选择（stdio / http）和 Scope（global / project）
- 点击 Complete 后先保存配置，再执行 Agent 安装
- 安装过程中：每个 Agent 显示 "Installing..." spinner
- 安装完成：显示 ✔ 成功 / ✘ 失败（附错误信息）

### Complete 逻辑（当前实现）

```
POST /api/setup  →  restartNeeded = response.needsRestart（后端计算，覆盖 port/mcpPort/mindRoot/authToken/webPassword）
  └─ 失败 → 显示错误，停留页面
  └─ 成功 → 安装选中 Agent（如有）
              └─ 更新每个 Agent 状态
             if (restartNeeded) → 停留页面，显示 RestartBlock
             else → window.location.href = '/?welcome=1'  跳转知识库
```

> ✅ 已完成（SPEC-OB-04）：`needsRestart` 覆盖全部需要重启的字段；RestartBlock 含"Restart now"按钮调用 `POST /api/restart`，重启后 polling 新端口 `/api/health`（最多 10 次 × 800ms），就绪后跳转 `http://localhost:{newPort}/?welcome=1`

### 组件架构

所有 Step 组件定义在**模块级别**（非 SetupWizard 函数内部），通过 props 传入数据：

- `Step1` — KB 路径 + 模板
- `Step2` — AI Provider 卡片
- `Step3` — 端口检测（接收 `checkPort`, `setWebPortStatus` 等）
- `Step4Inner` — Security（有 `seed`/`showSeed` 本地 state，必须模块级）
- `Step5` — Agent Tools（接收 `agentStatuses` 等）
- `Step6` — Review
- `StepDots` — 步骤指示器
- `PortField` — 端口输入 + availability badge（复用组件）

渲染使用显式条件：`{step === N && <StepN .../>}` 而非动态组件 map，确保组件身份稳定。

---

## CLI Onboarding（scripts/setup.js）

**入口**: `mindos onboard`

**步骤总数**: 7 步（已与 GUI 对齐）

| Step | 标题 | 核心内容 |
|------|------|----------|
| 1 | Knowledge Base | 路径输入 + 模板选择（en / zh / empty / custom），支持 `~` 展开，检测已有目录 |
| 2 | AI Provider | 选择 Anthropic / OpenAI / Skip，填写 API Key |
| 3 | Ports | Web 端口 + MCP 端口，含可用性检测和冲突检测 |
| 4 | Auth Token | 随机生成，支持自定义 seed；再次 onboard 可保留原值 |
| 5 | Web Password | 可选，直接回车跳过；再次 onboard 可保留原值 |
| 6 | Start Mode | app / mcp / both |
| 7 | Agent Tools | 多选终端 UI，配置 MCP Agent（9 个） |

> ✅ 已改进（SPEC-OB-11）：Template 合并进 Step 1，AI Provider 提前至 Step 2，步骤总数缩减为 7 步，顺序与 GUI 对齐

### Step 3 — Port Validation（CLI）

- 逐个检测端口可用性（同 GUI 逻辑）
- `isPortInUse`: 500ms timeout + ECONNREFUSED 区分
- `findFreePort`: for 循环扫描，避免溢出
- 端口占用：提示并推荐 +1
- 端口相同：重新询问

### Step 8 — Agent Tools（CLI）

终端原生多选 UI（raw mode，无需额外依赖）：

```
Select agents to configure (Space=toggle, Enter=confirm):
  [ ] Claude Code   (installed)
  [x] Cursor        (installed)
  [ ] Windsurf      (not installed)
  [ ] Zed           (not installed)
```

- ↑↓ 移动，Space 选中，Enter 确认
- 已安装（config 文件存在）显示 `installed`，否则 `not installed`
- 安装完成后逐行展示结果：`✔ claude-code` / `✘ cursor (error msg)`
- 安装方式：写入 stdio MCP 配置到各 Agent 的 config 文件

#### 支持的 Agent（9 个，与 GUI 一致 — SPEC-OB-01b ✅）

| Key | 名称 | Global Config 路径 |
|-----|------|-------------------|
| claude-code | Claude Code | `~/.claude.json` |
| claude-desktop | Claude Desktop | platform-specific |
| cursor | Cursor | `~/.cursor/mcp.json` |
| windsurf | Windsurf | `~/.codeium/windsurf/mcp_config.json` |
| zed | Zed | `~/.config/zed/settings.json` |
| vscode | VS Code (Copilot) | `~/.vscode/mcp.json` |
| cline | Cline | `~/.vscode/cline_mcp_settings.json` |
| trae | Trae | platform-specific |
| gemini | Gemini CLI | `~/.gemini/settings.json` |

---

## 跨实现一致性

| 特性 | GUI | CLI |
|------|-----|-----|
| 端口检测逻辑 | `check-port` API route | `isPortInUse` in setup.js |
| ECONNREFUSED 处理 | ✅ | ✅ |
| 500ms timeout | ✅ | ✅ |
| 端口冲突检测 | ✅ | ✅ |
| findFreePort 溢出保护 | ✅ for-loop | ✅ for-loop |
| 端口默认值读取 config | ✅ GET /api/setup | ✅ resumeCfg |
| 自身端口 isSelf 识别 | ✅ /api/health 探测 | ✅ http.get 探测 |
| LLM 跳过 | ✅ Skip 卡片 | ✅ skip 选项 |
| Agent 多选 | ✅ checkbox UI | ✅ raw-mode terminal |
| Agent 列表完整性 | ✅ 9 个 | ✅ 9 个 |
| 每 Agent 安装状态 | ✅ live badge | ✅ 逐行输出 |
| 未安装提示 | ✅ "Not installed" badge | ✅ `(not installed)` 标注 |
| 完成后跳转 | `/?welcome=1` + WelcomeBanner | 输出启动命令提示 |
| 配置变更智能重启 | ✅ needsRestart → RestartBlock + polling 新端口 | ✅ isSelfPort → 询问重启或提示下次启动生效 |
| resume 机制 | ✅ mount 时读取 config 填充默认值 | ✅ resumeCfg 单次读取，各步骤复用 |
| 步骤顺序 | KB+Template→AI→Ports→Security→Agents→Review | KB+Template→AI→Ports→Auth→Password→StartMode→Agents |
| 路径自动补全 | ✅ `/api/setup/ls` + 下拉（SPEC-OB-16） | ❌ 无 |
| 跨平台路径默认值 | ✅ homeDir 真实路径（SPEC-OB-17） | ✅ os.homedir() 拼接 |

---

## 已知差异 / 后续优化点

1. ~~**MCP_AGENTS 内容不同步**：已解决（SPEC-OB-01b）~~ — CLI 现已包含 9 个 Agent
2. ~~**app 内两个 route 字典完全重复**：已解决（SPEC-OB-01a）~~ — 统一到 `app/lib/mcp-agents.ts`
3. **CLI 无 LLM 测试连通性**：GUI 目前也未做（已移至 backlog）
4. ~~**GUI Step 5 无跳过按钮**：已解决（SPEC-OB-03）~~ — 底部 "Skip — configure later" 链接
5. ~~**再次 onboard 时端口检测有 false positive**：已解决（SPEC-OB-05）~~
6. ~~**再次 onboard 时端口默认值为硬编码 3000/8787**：已解决（SPEC-OB-05 + SPEC-OB-13）~~
7. ~~**配置变更后无智能重启**：已解决（SPEC-OB-04）~~ — GUI: `needsRestart` + RestartBlock + polling 新端口；CLI: `isSelfPort` 检测 + 询问重启或提示下次启动生效
8. ~~**再次 onboard 没有入口**：已解决（SPEC-OB-06）~~ — Settings Knowledge 页签底部 "Reconfigure" 按钮 → `/setup?force=1`
9. ~~**模板选择无预览**：已解决（SPEC-OB-07）~~ — 每个模板卡片内展示目录树预览
10. ~~**知识库路径已存在时 GUI 无提示**：已解决（SPEC-OB-08）~~ — 橙色警告 + `POST /api/setup/check-path`
11. ~~**Auth Token 用途不清晰**：已解决（SPEC-OB-09）~~ — Step 4 "What is this?" 展开说明
12. ~~**Review 页 Agent 安装失败后可重复提交整个流程**：已解决（SPEC-OB-10）~~ — 单个 Agent Retry 按钮，Complete 后不可重触发
13. ~~**CLI 与 GUI 步骤顺序不一致**：已解决（SPEC-OB-11）~~ — CLI 缩减为 7 步，顺序与 GUI 对齐
14. ~~**完成后缺少"下一步"引导**：已解决（SPEC-OB-12）~~ — `/?welcome=1` + WelcomeBanner（含 MCP 设置、快捷入口）
15. ~~**`GET /api/setup` 不存在**：已解决（SPEC-OB-13）~~
16. ~~**`setupPending` 清除时机不明确**：已解决（SPEC-OB-14）~~ — Agent 安装失败不影响进入知识库，Review 页有说明文字
17. ~~**CLI 无 resume 机制**：已解决（SPEC-OB-15）~~ — `resumeCfg` 单次读取，各步骤显示当前值作为默认，回车保留

---

## Spec — 待实现需求

### 依赖关系

```
SPEC-OB-13（GET /api/setup）
  ├─ 被 SPEC-OB-05 依赖（端口默认值）
  └─ 被 SPEC-OB-04 依赖（新旧 config 对比）

SPEC-OB-01a（app 内合并 MCP_AGENTS）
  └─ 先于 SPEC-OB-01b 执行（确认最新字典后再同步 CLI）
```

---

### SPEC-OB-01a：合并 app 内重复的 MCP_AGENTS ✅

**优先级**: P1 ~~→ 已完成~~
**范围**: app only

**实现**
- 新建 `app/lib/mcp-agents.ts`，包含 `AgentDef` interface、`MCP_AGENTS`（9 个）、`detectInstalled`、`expandHome`
- `app/api/mcp/agents/route.ts` → import `{ MCP_AGENTS, detectInstalled }` from `@/lib/mcp-agents`
- `app/api/mcp/install/route.ts` → import `{ MCP_AGENTS, expandHome }` from `@/lib/mcp-agents`

**验收标准**
- [x] `app/lib/mcp-agents.ts` 包含完整 9 个 Agent 定义
- [x] 两个 route 不再内联 `MCP_AGENTS`，改为 import
- [x] `GET /api/mcp/agents` 和 `POST /api/mcp/install` 功能不变
- [x] TypeScript 无报错

---

### SPEC-OB-01b：同步 CLI 的 MCP_AGENTS 到最新版本 ✅

**优先级**: P1 ~~→ 已完成~~
**范围**: CLI（bin + scripts）
**依赖**: SPEC-OB-01a

**实现**
CLI 在实现时已包含 9 个 Agent 字典（与 app 一致）。此次统一来源：
- 新建 `bin/lib/mcp-agents.js` 作为 CLI 唯一来源
- `bin/lib/mcp-install.js` → import `{ MCP_AGENTS }` from `./mcp-agents.js`（删除内联定义）
- `scripts/setup.js` → import `{ MCP_AGENTS }` from `../bin/lib/mcp-agents.js`（删除 `MCP_AGENTS_SETUP`）

**验收标准**
- [x] `bin/lib/mcp-agents.js` 包含完整 9 个 Agent，含 `process.platform` 判断
- [x] `mindos mcp install` 可列出全部 9 个 Agent
- [x] `scripts/setup.js` Step 8 Agent 列表与 GUI 一致
- [x] `node --check` 无语法错误

---

### SPEC-OB-03：GUI Step 5 明确跳过入口 ✅

**优先级**: P3 ~~→ 已完成~~
**范围**: GUI Step 5

**实现**
Step 5 Agent 列表底部增加 `Skip — configure later` / `跳过 — 稍后配置` 次级链接，点击清空 `selectedAgents`。

**验收标准**
- [x] Step 5 底部显示 Skip 链接
- [x] 点击 Skip → selectedAgents 清空为空集合
- [x] 已选 Agent 时 Skip 链接仍可见（不影响已选项）

---

### SPEC-OB-04：配置变更后智能重启（GUI + CLI）✅

**优先级**: P2 ~~→ 已完成~~
**范围**: GUI SetupWizard `handleComplete` + CLI `finish()`

---

#### 背景与关键洞察

用户再次 onboard 修改配置后，部分变更需要重启服务才能生效。

**关键洞察**：GUI 能被访问，服务必然在跑（`POST /api/restart` 本质是当前进程 spawn 新进程后 `process.exit(0)`）。因此 GUI 侧**不需要判断服务是否在跑**，只需判断哪些配置变了。

CLI 侧有所不同：用户可能在首次使用（服务未跑），也可能在服务运行时重新 onboard。

---

#### 需要重启的配置项

| 配置项 | 原因 |
|--------|------|
| `port` / `mcpPort` | 服务监听端口变了，旧端口上的进程还在跑 |
| `mindRoot` | Next.js 服务器层读取路径，需重新加载 |
| `authToken` | middleware 每次请求从内存读取，需重启刷新 |
| `webPassword` | 同上 |

#### 不需要重启的配置项

| 配置项 | 原因 |
|--------|------|
| AI Provider / API Key / Model | `effectiveAiConfig()` 每次请求动态读取 config 文件 |
| `openaiBaseUrl` | 同上 |
| Agent MCP 配置 | 写入 Agent 自己的 config，与 MindOS 服务无关 |

---

#### GUI 实现

**后端**（`POST /api/setup` route）：

```typescript
// 首次 onboard 不触发重启（setupPending=true 或 mindRoot 为空）
const isFirstTime = current.setupPending === true || !current.mindRoot;
// 用实际写入 config 的值来比较，避免 undefined 导致误判
const resolvedAuthToken   = authToken   ?? current.authToken   ?? '';
const resolvedWebPassword = webPassword ?? '';
const needsRestart = !isFirstTime && (
  webPort             !== (current.port      ?? 3000) ||
  mcpPortNum          !== (current.mcpPort   ?? 8787) ||
  resolvedRoot        !== (current.mindRoot  || '')   ||
  resolvedAuthToken   !== (current.authToken   ?? '') ||
  resolvedWebPassword !== (current.webPassword ?? '')
);
return NextResponse.json({ ok: true, portChanged: webPort !== currentPort, needsRestart, newPort: webPort });
```

**前端** `handleComplete`：
```typescript
const restartNeeded = !!data.needsRestart;
if (restartNeeded) setNeedsRestart(true);
// ...Agent 安装后
if (restartNeeded) return;  // RestartBlock 接管
window.location.href = '/?welcome=1';
```

**RestartBlock**：
- 接收 `newPort: number` prop
- `POST /api/restart` 后，polling `http://localhost:{newPort}/api/health`（最多 10 次 × 800ms）
- `service === 'mindos'` 就绪后跳转 `http://localhost:{newPort}/?welcome=1`
- 10 次全失败时 fallback redirect（服务可能还在启动中）

---

#### CLI 实现

`scripts/setup.js`：

```js
// needsRestart 在 writeFileSync 后计算
const isResuming = Object.keys(resumeCfg).length > 0;
const needsRestart = isResuming && (
  config.port        !== (resumeCfg.port        ?? 3000) ||
  config.mcpPort     !== (resumeCfg.mcpPort     ?? 8787) ||
  config.mindRoot    !== (resumeCfg.mindRoot     ?? '')   ||
  config.authToken   !== (resumeCfg.authToken   ?? '')   ||
  config.webPassword !== (resumeCfg.webPassword ?? '')
);
finish(mindDir, config.startMode, config.mcpPort, config.authToken, installDaemon, needsRestart, resumeCfg.port ?? 3000);
```

`finish()` 新增重启分支：
```js
if (needsRestart) {
  const isRunning = await isSelfPort(oldPort);  // 复用已有函数
  if (isRunning) {
    // 服务在跑 → 询问立即重启
    write(c.yellow(t('restartRequired') + '\n'));
    const doRestart = await askYesNoDefault('restartNow');
    if (doRestart) execSync(`node cli.js start`, { stdio: 'inherit' });
    else write(c.dim(t('restartManual') + '\n'));
    return;
  } else {
    // 服务未跑 → 提示下次启动生效，fall through 到 Start now?
    write(c.dim(t('changesOnNextStart') + '\n'));
  }
}
// 原有 nextSteps + Start now? 流程不变
```

新增 i18n keys（`T` 对象）：
- `restartRequired`: `'Config changed. Service restart required.'` / `'配置已变更，需要重启服务。'`
- `restartNow`: `'Restart now?'` / `'立即重启？'`（`askYesNoDefault` key）
- `changesOnNextStart`: `'Changes will take effect on next start.'` / `'变更将在下次启动时生效。'`

---

#### 验收标准

**GUI**
- [x] `POST /api/setup` 返回 `needsRestart` 和 `newPort` 字段
- [x] 只改 AI Key/Model：完成后直接跳转，无重启提示
- [x] 改了 port/mcpPort/mindRoot/authToken/webPassword：显示 RestartBlock
- [x] RestartBlock "Restart now" → `POST /api/restart` → polling 新端口 → 跳转 `http://localhost:{newPort}/?welcome=1`
- [x] 首次 onboard（`setupPending=true` 或 `mindRoot` 为空）：完成后直接跳转，无重启提示

**CLI**
- [x] 首次 onboard：`finish()` 行为不变（打印 nextSteps + Start now?）
- [x] 再次 onboard 无变更：同上，无重启提示
- [x] 再次 onboard 有变更 + 服务在跑：提示重启，默认 Y
- [x] 再次 onboard 有变更 + 服务未跑：提示"下次启动生效"，询问 Start now?

**待实现（backlog）**
- [ ] CLI `--yes` flag：跳过所有确认，直接重启（若服务在跑）或启动（若未跑）
- [ ] CLI 变更摘要：重启前打印具体哪些字段发生了变化
- [ ] GUI polling 超时后显示"服务可能尚未就绪"提示

#### Unit Tests ✅

`tests/unit/setup-needs-restart.test.ts`（14 cases）：
- 首次 onboard 不触发（`setupPending=true`、`mindRoot=''`、`mindRoot=undefined`）
- 再次 onboard 无变更不触发（all fields same、仅改 AI Key）
- 各字段变更触发（port、mcpPort、mindRoot、authToken、webPassword）
- 边界条件（`authToken=undefined` 保留原值、`webPassword=undefined` 视为空、port/mcpPort 使用默认值、`authToken=undefined` current 为空）

---

### SPEC-OB-05：再次 onboard 的端口默认值与检测逻辑 ✅

**优先级**: P1 ~~→ 已完成~~
**范围**: GUI Step 3 + CLI Step 3

**实现**

**`GET /api/health`** — 新增轻量探针端点，返回 `{ ok: true, service: 'mindos' }`

**`POST /api/setup/check-port`** — 增加 `isSelf` 检测：
- TCP 探测到端口占用后，向 `http://127.0.0.1:{port}/api/health` 发 GET（800ms timeout）
- 响应 `service === 'mindos'` → 返回 `{ available: true, isSelf: true }`
- 否则 → 返回 `{ available: false, isSelf: false, suggestion }`

**GUI SetupWizard**：
- `PortStatus` 新增 `isSelf: boolean` 字段
- `PortField` 区分两种绿色 badge：`portAvailable`（空闲）vs `portSelf`（当前服务端口）
- i18n 新增 `portSelf: 'Current port'` / `'当前端口'`

**CLI `scripts/setup.js`**：
- 新增 `isSelfPort(port)` 通过 `http.get` 探测（避免 fetch 的依赖问题）
- `askPort` 默认值从 `~/.mindos/config.json` 读取（SPEC-OB-15 的部分实现）
- 自身端口可直接回车确认，不再触发 "port in use" 错误

**验收标准**
- [x] 再次 onboard 进入 Step 3，默认值为当前运行端口
- [x] 检测自身端口显示"Current port"而非"In use"
- [x] 检测其他服务占用的端口显示警告 + 推荐
- [x] 未改端口直接 Complete：不触发重启逻辑
- [x] CLI 同步：`isPortInUse` 检测时同样识别自身服务（通过 `/api/health` 探测）

---

### SPEC-OB-06：再次 onboard 的入口 ✅

**优先级**: P2 ~~→ 已完成~~
**范围**: GUI Settings 页 + `/setup` 路由

**实现**
- Settings Modal Knowledge 页签底部增加 "Reconfigure" 按钮（`RotateCcw` 图标），链接 `/setup?force=1`
- `app/setup/page.tsx` 接收 `searchParams.force === '1'`，跳过 `setupPending` 检查

**验收标准**
- [x] Settings 页有明确的重新配置入口
- [x] `/setup?force=1` 无论 `setupPending` 状态都能打开
- [x] 重新完成后仍正常跳转 `/`

---

### SPEC-OB-07：Step 1 模板选择预览 ✅

**优先级**: P3 ~~→ 已完成（早于本 spec 已实现）~~
**范围**: GUI Step 1

**实现**
`TEMPLATES` 数组中每个模板已包含 `dirs` 字段，选中时卡片内展示文件/目录列表预览，无需 API 调用。

**验收标准**
- [x] 三个模板均有文件树预览
- [x] 预览内容与实际创建结果一致

---

### SPEC-OB-08：知识库路径已存在时的 GUI 提示 ✅

**优先级**: P2 ~~→ 已完成~~
**范围**: GUI Step 1

**实现**
- 新增 `POST /api/setup/check-path` 路由，返回 `{ exists, empty, count }`
- Step 1 输入框 600ms debounce 调用，存在非空目录时显示橙色 `AlertTriangle` 警告

**验收标准**
- [x] 路径不存在或为空目录：无提示，正常继续
- [x] 路径存在且非空：显示橙色警告，Next 仍可点击
- [x] 新增 `POST /api/setup/check-path` 接口

---

### SPEC-OB-09：Auth Token 用途说明 ✅

**优先级**: P3 ~~→ 已完成~~
**范围**: GUI Step 4

**实现**
Step 4 Token 输入框下方增加"What is this?" / "这是什么？"可展开链接，展开后显示说明文字：
- EN: "Used for MCP connections and API clients. When configuring an Agent, this token is written automatically — no manual steps needed."
- ZH: "用于 MCP 连接和 API 客户端身份验证。配置 Agent 时会自动写入，无需手动填写。"

i18n 新增：`authTokenUsage`、`authTokenUsageWhat`（两种语言）。`Step4Inner` 新增 `showUsage` 本地 state。

**验收标准**
- [x] Step 4 有"What is this?"展开链接
- [x] 展开后显示 token 用途说明
- [x] 说明内容准确描述 token 的使用场景

---

### SPEC-OB-10：Agent 安装失败支持单个重试 ✅

**优先级**: P2 ~~→ 已完成~~
**范围**: GUI Review 页（Step 6）

**实现**
- `agentStatuses` state 追踪每个 Agent 安装状态（`pending / installing / ok / error`）
- Review 页失败 Agent 行显示 Retry 按钮，调用 `retryAgent(key)` callback
- `retryAgent` 只重新调用 `POST /api/mcp/install` 针对单个 Agent
- `completed` state：handleComplete 成功后设为 true，nav 按钮切换为 "Setup complete! →" 链接，不可重触发整个流程

**验收标准**
- [x] 安装失败的 Agent 显示 Retry 按钮
- [x] Retry 只重装失败的 Agent，不重新保存 config
- [x] Complete 提交后不可再次触发完整流程

---

### SPEC-OB-11：CLI 与 GUI 步骤顺序对齐 ✅

**优先级**: P2 ~~→ 已完成~~
**范围**: CLI scripts/setup.js

**实现**
- Template 合并进 Step 1（KB 路径确认后紧接模板选择）
- AI Provider 提前到 Step 2
- `TOTAL_STEPS = 7`，`stepTitles` 更新为 `['Knowledge Base', 'AI Provider', 'Ports', 'Auth Token', 'Web Password', 'Start Mode', 'Agent Tools']`
- `resumeCfg` 在 Step 1 顶部单次读取，后续各步复用，消除重复 `readFileSync`

**验收标准**
- [x] CLI 步骤顺序与 GUI 对齐（KB+Template→AI→Ports→Auth→Password→StartMode→Agents）
- [x] `TOTAL_STEPS` 和 `stepTitles` 更新
- [x] 所有步骤功能不受影响

---

### SPEC-OB-12：完成后 Welcome 引导 ✅

**优先级**: P2 ~~→ 已完成~~
**范围**: GUI 首页

**实现**
- `handleComplete` 成功后跳转 `/?welcome=1`
- 新建 `app/components/WelcomeBanner.tsx`：client component，检测 `?welcome=1` 参数后显示，同时用 `window.history.replaceState` 清除 URL 参数
- Banner 含三个快捷入口：Reconfigure（`/setup?force=1`）、Ask AI、MCP Settings（dispatch `⌘,` 键盘事件打开 Settings Modal）
- 关闭写入 localStorage，不再重复显示
- `HomeContent.tsx` 顶部挂载 `<WelcomeBanner />`

**验收标准**
- [x] 首次完成跳转带 `?welcome=1`
- [x] 首页显示 Welcome banner 含快捷入口
- [x] 关闭后不再显示（localStorage 记录）
- [x] 再次 onboard 完成后同样触发

---

### SPEC-OB-13：补充 `GET /api/setup` ✅

**优先级**: P1 ~~→ 已完成~~
**范围**: app API
**被依赖**: SPEC-OB-04、SPEC-OB-05、SPEC-OB-15

**实现**
- `app/app/api/setup/route.ts` 新增 `GET` handler
- 返回字段：`mindRoot`, `port`, `mcpPort`, `authToken`, `webPassword`, `provider`, `anthropicApiKey`（脱敏）, `anthropicModel`, `openaiApiKey`（脱敏）, `openaiModel`, `openaiBaseUrl`
- API Key 掩码：前 6 位 + `***`
- `readSettings()` 处理 config 不存在时返回默认值（port=3000, mcpPort=8787, mindRoot=~/MindOS）
- `SetupWizard` mount 时调用 `GET /api/setup` 填充所有表单默认值，仅在 `authToken` 为空时才调用 `/api/setup/generate-token`

**验收标准**
- [x] `GET /api/setup` 返回当前 config 脱敏数据
- [x] SetupWizard 初始化时读取并填充表单默认值
- [x] 首次 onboard（config 不存在）时返回默认值

---

### SPEC-OB-14：`setupPending` 两阶段清除 ✅

**优先级**: P2 ~~→ 已完成~~
**范围**: app API + GUI

**实现**
- `POST /api/setup` 保存 config 时立即 `setupPending: false`，与 Agent 安装解耦
- Review 页（Step 6）显示 `agentFailureNote` 说明文字："Agent 配置失败可稍后在 Settings → MCP 重试"
- 刷新后 `setupPending` 已清除，正常进入 `/`

**验收标准**
- [x] Agent 安装失败不影响进入知识库
- [x] Review 页有 Agent 独立说明文字
- [x] 刷新页面后不回到 setup

---

### SPEC-OB-15：CLI Resume 机制 ✅

**优先级**: P2 ~~→ 已完成~~
**范围**: CLI scripts/setup.js

**实现**
- Step 1 顶部单次读取 `~/.mindos/config.json` 存入 `resumeCfg`，后续所有步骤复用
- KB 路径默认值：`resumeCfg.mindRoot || resolve(HOME, 'MindOS', 'mind')`
- Auth Token：若已有 token，显示掩码 + "keep / regenerate" 提示
- Web Password：若已有密码，提示保留或重置
- AI Provider：读取 `resumeCfg.ai` 作为默认选项
- 端口：默认值读取 `resumeCfg.port / resumeCfg.mcpPort`

**验收标准**
- [x] 已有 config 时每步显示当前值作为默认
- [x] 直接回车保留原值
- [x] 首次 onboard（无 config）行为不变

---

### SPEC-OB-16：知识库路径自动补全 ✅

**优先级**: P3 ~~→ 已完成~~
**范围**: GUI Step 1（SetupWizard）

**背景**
浏览器无法访问服务器文件系统，无法提供原生目录选择器。但可以通过后端接口枚举真实目录，在输入框上实现路径下拉补全，让用户直观看到服务器上存在的目录。原生文件夹选择器（`showDirectoryPicker`）在 Web 模式下不可行（无法获取真实路径），已记录到 backlog，桌面端（Electron）列为必做。

**实现**
- 新增 `POST /api/setup/ls`：接收父目录路径，返回子目录列表（最多 20 条，按字母排序，过滤隐藏目录）
- `expandHome` 支持 `~/`、`~\`（Windows）、`~` 三种形式
- Step 1 输入框 300ms debounce，提取父目录调用 `/api/setup/ls`
- 下拉最多显示 8 条，键盘 ↑↓+Enter 导航，Escape/blur 收起
- `getParentDir` 支持 `/` 和 `\` 双分隔符（Windows 兼容）

**验收标准**
- [x] 新增 `POST /api/setup/ls` 接口，返回子目录列表
- [x] Step 1 路径输入框有下拉补全，300ms debounce
- [x] 键盘 ↑↓+Enter 可操作下拉列表
- [x] 目录不存在时不报错，下拉为空
- [x] 补全不影响现有的路径存在检测（check-path）逻辑

---

### SPEC-OB-17：跨平台路径默认值（Windows / macOS / Linux）

**优先级**: P3 ✅ 已完成
**范围**: `GET /api/setup` + GUI Step 1

**背景**
Windows 用户看到 `~/MindOS/mind` 会感到困惑，`~` 不是 Windows 的有效路径表示。需要返回真实的 home 路径，让所有平台用户看到实际有效的路径。

**方案**

`GET /api/setup` 新增两个字段：
- `homeDir`: `os.homedir()` 真实 home 路径（如 `C:\Users\Alice`、`/Users/alice`）
- `platform`: `process.platform`（`win32` / `darwin` / `linux`）
- `mindRoot` 默认值改为用平台路径分隔符拼接的真实路径

`POST /api/setup/ls` 的 `expandHome` 支持 `~\`（Windows 风格）

GUI Step 1：
- 接收 `homeDir` prop，用平台分隔符拼接真实 placeholder（如 `C:\Users\Alice\MindOS\mind`）
- `homeDir === '~'`（API 未返回前）退回显示 `kbPathDefault`
- 路径补全的父目录 fallback 使用 `homeDir` 而非硬编码 `~`

**验收标准**
- [x] `GET /api/setup` 返回 `homeDir` 和 `platform`
- [x] Windows 路径默认值使用 `\` 分隔符
- [x] Step 1 placeholder 显示真实 home 路径
- [x] `POST /api/setup/ls` 支持 `~\` 展开

---

### CLI UX 改进（随 SPEC-OB-04 一同完成）✅

**范围**: `scripts/setup.js`

#### 系统语言自动检测

新增 `detectSystemLang()` 函数，在 CLI 启动时自动检测系统语言：

```js
function detectSystemLang() {
  const vars = [process.env.LANG, process.env.LC_ALL, process.env.LC_MESSAGES, process.env.LANGUAGE]
    .filter(Boolean).join(' ').toLowerCase();
  if (vars.includes('zh')) return 'zh';
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale;
    if (locale.toLowerCase().startsWith('zh')) return 'zh';
  } catch {}
  return 'en';
}
let uiLang = detectSystemLang();
```

优先检查 env 变量（Linux/macOS/WSL），fallback 到 `Intl` API（Windows 兼容）。

#### 模式选择文案优化

- `modeOpts`: `['Continue here in terminal (CLI)', 'Open browser to set up (recommended)']`

#### langHint 单向提示

只显示"切换到另一语言"方向：
- 英文界面：`← → 切换中文    ↑ ↓ navigate    Enter confirm`
- 中文界面：`← → switch to English    ↑ ↓ 上下切换    Enter 确认`

#### Unit Tests ✅

`tests/unit/detect-system-lang.test.ts`（13 cases）：
- 中文环境检测（LANG/LC_ALL/LC_MESSAGES/LANGUAGE 各变量）
- 英文环境检测（en_US、en_GB、所有 env 为空）
- 优先级验证（env 变量优先于 Intl）
- 边界条件（C、POSIX、大写 ZH）
