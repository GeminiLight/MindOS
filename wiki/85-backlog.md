<!-- Last verified: 2026-04-01 | Current stage: P1 -->

# Backlog

> 临时 bug、技术债、改进想法。解决后移除或转入对应 stage 文件。

## Bug

- [x] **Ask AI 输入框打字卡顿** — 核心回调依赖不稳定 hook 返回值导致每次击键重建回调 + 全子树 re-render。修复：ref 持有不稳定值 + 回调依赖清空 + `syncTextareaToContent` 缓存 `getComputedStyle`。附带重构：提取 `useAskChat` hook（~248 行 submit/retry 逻辑）、`AskHeader` 组件（React.memo）、`MessageList` 包裹 React.memo + memoize labels。AskContent 从 898 行降至 709 行。
- [x] **Agent 框架迁移 Vercel AI SDK → pi-agent-core** — 完成 6 阶段迁移（Phase 0-5）。Spec v2 所有 6 个设计缺陷已修复。涉及 7 文件改写 + 完整 SSE 协议重定义。详见 `wiki/specs/migrate-to-pi-agent.md` — v0.6.0
- [x] **A2A 协议 Phase 1** — Agent Card 发现端点 (`/.well-known/agent-card.json`) + JSON-RPC 端点 (`/api/a2a`)。支持 SendMessage / GetTask / CancelTask。5 个 KB 技能暴露。18 个测试覆盖。详见 `wiki/specs/spec-a2a-integration.md`

## 技术债

> 按优先级排序（高 → 低）。已完成项折叠在末尾。

- [x] **第三方 Skill 加载委托给 pi-coding-agent 框架** — 消除自建 `scanSkillDirs`/`list_skills` 轮子，复用框架 `loadSkills()` 发现第三方 skill 并生成 `<available_skills>` XML。核心 skill 保持直接注入。修复 AGENTS.md 重复注入（~2500 tokens/请求）。修复 `additionalSkillPaths` 遗漏 `~/.mindos/skills`。[spec](./specs/spec-delegate-skill-to-framework.md)
- [x] **CLI 架构重构：cli.js 模块化 + utils.js 拆分** — `bin/cli.js` 从 1466 行巨石文件瘦身为 134 行纯路由。19 个内联命令全部提取为 `bin/commands/*.js` 模块。`utils.js` 拆分为 `shell.js`/`path-expand.js`/`jsonc.js`。`expandHome` 3 处重复定义合并为单一来源。命令自动注册 + 别名支持
- [x] **CLI Help 系统改进** — `--help` 安全拦截（18 个命令不再因 `--help` 执行实际操作）。支持 `mindos help <cmd>` 和 `mindos --help <cmd>` 两种形式。全局帮助新增 USAGE / Learn More 段。17 个命令的 `meta` 补充 flags + examples，auto-help 自动生成。`isTTY` 改为函数以支持 `NO_COLOR` 延迟求值
- [x] **测试文件适配 pi-agent-core**：`__tests__/core/context.test.ts` 和 `__tests__/core/tools.test.ts` 已适配 `AgentMessage` + 新 `compactMessages` 签名。511 tests passing.
- [x] **App 端 skill-rules.md 注入**：route.ts 从用户知识库 `.agents/skills/{name}/` 读取 `skill-rules.md` + `user-rules.md` 并注入 system prompt。支持中英文切换、空文件跳过、截断标志。详见 `wiki/specs/spec-app-skill-rules-injection.md`
- [x] **AIP-001 统一错误处理**：`MindOSError` 类 + 12 个 `ErrorCodes` + `apiError()`。core/ 13 处 throw 已迁移，API 统一返回 `{ ok, error: { code, message } }` 格式
- [x] **AIP-002 性能监控面板**：`MetricsCollector` 单例 + `GET /api/monitoring` + Settings Monitoring tab（系统/应用/知识库/MCP 指标，5s 轮询）
- [x] **AIP-003 增量搜索索引**：倒排索引 + CJK bigram 分词，搜索候选集缩减后精确匹配。索引与 invalidateCache 联动自动失效
- [x] **Decouple Pi Naming**：`~/.mindos/pi-sessions/` → `sessions/`；skill 扫描仅保留 3 目录（移除 `.pi/skills/` 和 `~/.pi/agent/skills/`）；mcporter CLI 调用 stub 化，MindOS MCP 内置。[spec](./specs/spec-decouple-pi-naming.md)

<details><summary>已完成 ✅ (18 项)</summary>

- [x] **默认端口从 3000/8787 改为 3456/8781** — 避免与 Next.js/Vite/Express（3000）和 Cloudflare Wrangler（8787）冲突。已有用户配置不受影响，仅改默认值
- [x] **日志文件自动轮转** — daemon 模式启动时检查 `~/.mindos/mindos.log`，超过 2MB 自动轮转为 `.old`，最多保留 1 个备份（上限 ~4MB）
- [x] **P1：硬编码状态色 → CSS 变量**：定义 `--success`/`--error` 变量后全局替换。涉及 15 文件
- [x] **P2：`prefers-reduced-motion` 支持**
- [x] **P3：Focus ring 统一**：`--ring` 改为 `var(--amber)`，涉及 7 文件
- [x] SearchModal / AskModal 添加 `role="dialog"` + `aria-modal="true"`
- [x] **renderer inline fontFamily 迁移** — renderers 目录已无 inline fontFamily；剩余 Editor.tsx（CodeMirror 必需）和 AppearanceTab（用户自定义）属合理用法
- [x] **模板内容优化（中英双语）** — 中英模板各 ~800 行，7 个分类目录 + README + INSTRUCTION + CONFIG 完整
- [x] **SetupWizard 硬编码色值清理**
- [x] **SetupWizard `.catch(() => {})` 静默吞错**：9 处空 catch 改为 `console.warn`
- [x] **i18n 清理 `kbPathExists` 废弃 key**
- [x] **`copyToken` setState 内副作用**
- [x] **Checkbox accent 色值统一**
- [x] **`#131210` → `--amber-foreground` 全局治理**：15 个文件 22 处
- [x] **SetupWizard 文件拆分**：~1400 行 → 10 个文件
- [x] **SetupWizard DRY + 可测试性重构**：提取 `buildAgentPayload` / `parseInstallResult` / `saveConfig` / `installAgents` / `installSkill`
- [x] **StepKB autocomplete 选中闪回**：`justSelectedRef` 修复
- [x] **StepReview retry disabled dead code**：移除不可达的 disabled guard
- [x] **Echo 内容页 P0**：`/echo` → `/echo/about-you`、`/echo/[segment]` 白名单 404、`EchoPanel` 链至五 segment + 路径选中态、`SidebarLayout` 访问 `/echo/*` 时自动切 Echo 面板、`echoPages` i18n、事实层空态 + 可折见解区 + Daily/Growth localStorage + Ask 预填。见 `wiki/specs/spec-echo-content-pages.md`
- [x] **Echo 内容页视觉精修**：hero 卡片 + 琥珀竖线 / kicker、`EchoHero` + 事实卡图标与 `snapshotBadge`、`continued` dashed 空态、`PanelNavRow` 当前项左侧琥珀条与 `EchoCollapsibleInsight` 卡片化；`spec-echo-visual-polish.md` + i18n 键单测

</details>

## 改进想法

> 按优先级排序。评估维度：用户感知影响 × 实施成本 × 当前阶段匹配度。

### CLI 架构重构

> 2026-03-31 复盘发现。按 P1→P3 排序。

- [x] **P1: cli.js God File 拆分** — 新命令已在 `commands/` 目录（7 个文件）。老命令仍在 cli.js 但已统一参数接口，后续可逐步迁出
- [x] **P1: 统一参数解析** — 入口处单次 `parseArgs(process.argv.slice(2))`，所有命令通过 `cliArgs`/`cliFlags` 获取参数，`process.argv` 引用从 12 处降为 1 处
- [x] **P2: token 命令从 Agent 注册表自动生成** — 120+ 行手写 JSON → 50 行循环从 `MCP_AGENTS` 生成。自动显示已安装 Agent，每加新 Agent 无需改 token 命令
- [x] **P2: file.js 复用 core 模块** — 保持现状（CLI 离线命令独立实现），因 core 是 TypeScript 需编译，CLI 是纯 JS 零依赖。标记为 won't fix
- [x] **P2: 统一 exit code 规范** — `EXIT` 常量（OK=0, ERROR=1, ARGS=2, CONNECT=3, NOT_FOUND=4）定义在 `bin/lib/command.js`，所有 `commands/` 模块已迁移
- [x] **P3: --json 覆盖所有命令** — doctor/sync/config show/token 全部支持 `--json`，Agent 可对所有命令获取结构化输出
- [x] **CLI-first Agent 模式** — 新增 8 个 `mindos file` 子命令（write/append/edit-section/insert-heading/append-csv/backlinks/recent/history），Agent 可通过 CLI 完成全部 KB 操作无需 MCP server。Onboarding Step 7 新增 CLI/MCP 模式选择（CLI 默认选中）。修复 CLI 参数解析器对短标志取值和 dash 开头内容的处理。[spec](./specs/spec-cli-first-agent-mode.md)
- [x] **P1: `mindos agent` 语义重构** — `mindos agent` 从"管理 Agent"改为"Agent 模式执行任务"。任务执行（`mindos agent "整理笔记"`）与管理（`list`/`info`/`stats`）通过子命令区分。`mindos ask` 明确为 chat 模式（只读工具）。两个命令均改用 SSE 流式输出 + 正确的 `/api/ask` message 格式（修复旧 `{ question }` 格式不兼容问题）。新增 `bin/lib/sse-stream.js` 共享 SSE 客户端

### Inbox Quick Capture

- [x] **Inbox Space + Quick Drop + Homepage Section + Batch AI Organize** — 用户可将文件直接拖拽到窗口快速保存到 Inbox，首页显示 Inbox 文件列表，一键触发 AI 整理。核心模块 `lib/core/inbox.ts`（ensureInboxSpace / listInboxFiles / saveToInbox）+ API route `/api/inbox` + `InboxSection` UI + SidebarLayout Quick Drop。21 项测试全覆盖。红队审查修复 3 项：O(n²) base64 编码、文件大小限制、content 校验。FileTree 中 Inbox Space 使用专属图标。

### LLM Wiki 启发功能（Karpathy LLM Wiki Insights）

- [x] **Feature 3: Bootstrap 增强（Smart Index）** — `buildFileIndex` 生成目录树 + 文件数 + 深度限制，`/api/bootstrap` 增加 `file_index` 字段。[spec](./specs/spec-llm-wiki-spike.md)
- [x] **Feature 1: 查询回流（Save Insight）** — Ask 面板中 AI 回答气泡 hover 出现 Save 按钮，点击展开 inline 保存表单（路径/模式/预览），一键保存到知识库。Provider/Trigger 分离架构，13 个纯逻辑测试。红队修复 4 项。[spec](./specs/spec-save-insight.md)
- [x] Feature 2: 知识体检（KB Lint）— P1。核心静态分析模块 `lib/lint.ts`（findOrphans/findStaleFiles/findBrokenLinks/findEmptyFiles/computeHealthScore/runLint），API route `/api/lint`，Agent 工具 `lint`，MCP 工具 `mindos_lint`。28 个单元测试。二进制内容检测 + URL 解码链接解析。[spec](./specs/spec-kb-lint.md)
- [ ] Feature 4: 深度摄入（Ingest Ripple）— P2
- [ ] Feature 5: 知识编译（Space Overview）— P3

### 🔴 高优先（下一批做）

- [x] **清理生产代码 console.log** — `app/api/ask/route.ts`、`lib/agent/context.ts`、`lib/acp/subprocess.ts` 残留 `[ask]`/`[ACP]` debug 日志。已改为 `NODE_ENV === 'development'` 条件输出
- [x] **package.json 补齐 npm 元数据** — 已添加 `homepage`、`bugs` 字段
- [x] **根目录 CHANGELOG.md** — 已创建 symlink `CHANGELOG.md -> wiki/90-changelog.md`
- [x] **`.env.local.example` 默认端口过时** — 已从 3000 改为 3456

- [x] **Agent 重试/重连机制完善** — 修复后端 retry 两大缺陷：(1) ACP agent 路径零重试保护 → 补全 3 次指数退避循环 + session cleanup; (2) sleep() 未传 req.signal → 客户端断开时不再浪费 LLM 配额。3 个测试文件 (64 cases) 覆盖 isTransientError / isRetryableError / retryDelay / sleep / stream-consumer status 事件

- [x] **Inline AI Organize** — 上传文件选择「AI Organize」后不再弹出 ChatBot，改为在 ImportModal 内原地展示处理进度和结果，支持 review 和撤销。[spec](./specs/spec-inline-ai-organize.md)
- [x] **Inline AI Organize — error 标题修复** — AI Organize 失败时 Modal 标题从"整理完成"改为"整理失败"，消除 title/body 状态矛盾
- [x] **Save to KB — progressive disclosure 冲突策略** — 新增 `check_conflicts` API；无冲突时隐藏冲突选项；有冲突时琥珀色提示+可展开；路径预览用 SVG 图标替换 emoji；Cancel 按钮降权
- [x] **AI Organize — 进度感知优化** — 分阶段文案（连接/分析/阅读/思考/写入）、经过时间计时器、取消按钮。消除长时间处理的"卡死"感。[spec](./specs/spec-organize-progress-ux.md)
- [x] **AI Organize — 独立 Toast + 全类型撤销 + 操作历史** — Toast bar 独立于 ImportModal（3 分钟自动消失），支持 create 和 update 文件撤销（update 通过快照恢复），新增 Import History 面板记录所有导入操作

- [x] **Desktop：MindOS 运行时择优（代码层）** — `pickMindOsRuntime` + `resolveLocalMindOsProjectRoot` 接入 `startLocalMode`；`config`/`MINDOS_RUNTIME_ROOT`/`MINDOS_DEV_BUNDLED_ROOT`；Desktop `npm test` 覆盖 pick+layout。内置 `extraResources` 产物与三平台冒烟仍待办。[spec](./specs/spec-desktop-bundled-mindos.md)
- [x] **Desktop：重装静默修复（Boot-time Silent Healing）** — 用户删除 .app 后重装时，`healPreviousInstallation()` 自动清理：停 launchd daemon、清理双 PID 文件（Desktop + CLI）、port-based fallback kill、等待端口释放（5s）、验证私有 Node.js 版本、验证 .next 构建缓存完整性。端口偏移时自动更新 MCP 客户端配置。零 UI，用户无感知。[spec](./specs/spec-desktop-reinstall-healing.md)
- [x] **Desktop：内置运行时 Next standalone + 精简 prepare** — `app/next.config` `output: 'standalone'`；`prepare-mindos-bundle.mjs` 合并 static/public、拷贝 app 时去掉 `node_modules` / `.next/cache` / `.next/dev`。[spec](./specs/spec-desktop-standalone-runtime.md)
- [x] **Electron Desktop App（Phase 1）** — 本地+远程双模式桌面端，含系统托盘（模式感知）、自动更新（electron-updater）、IPC 安全桥接、窗口状态持久化、Node.js 自动检测/下载。CI 多平台构建（macOS arm64+x64/Windows/Linux）。30+ 源文件 + 198MB 内置运行时。[spec](./specs/spec-electron-desktop-app.md)
- [x] **Ask Panel Focus Mode + 宽度扩展** — 拖拽上限从 700px/45% 扩展到 1400px/92%，Maximize 改为 Focus Mode（统一用 width 定位，消除 left 定位跳变）。支持 Esc 退出 Focus，进入/退出平滑过渡。[spec](./specs/spec-ask-panel-focus-mode.md)
- [ ] **Capacitor 移动端（Phase 2）** — iOS/Android 原生壳，复用 Phase 1 连接 SDK。[spec](./specs/spec-capacitor-mobile-app.md)
- [x] **Help 页面** — `/help` 路由 + ActivityBar 底部 `?` 图标入口。6 个 section，前 4 个默认展开：
  - 什么是 MindOS（非技术版定位：你和 AI 共享同一个大脑）
  - 核心概念：Space → Instruction → Skill（从"知识在哪"→"怎么控制 AI"→"AI 怎么干活"）
  - 快速开始 3 步（浏览 → 对话 → 连接 Agent）
  - 在 AI Agent 中使用 MindOS（5 个场景卡片 + 可复制 prompt）
  - 快捷键速查
  - FAQ 7 条
  - **设计决策：** 核心概念选 Space/Instruction/Skill 而非 Plugin/AI Ask——Plugin 太窄（只是渲染），AI Ask 是功能入口不是概念。三者形成完整链路：结构层→控制层→执行层。"典型使用场景"不独立成 section，合并进"在 Agent 中使用"更连贯。
- [x] **I1：CLI `mindos status` 命令** — 已有 `mindos doctor` 覆盖此需求
- [x] **I2：登录页产品标语** — 已实现（`loginT.tagline` + `loginT.subtitle`）
- [x] **I3：API Key 连通性验证** — Settings AI Tab 已有 Test 按钮（`/api/settings/test-key`），支持 13 个 AI Provider（通过 `PROVIDER_PRESETS` 动态注册），使用 `pi-ai.complete()` 统一测试路径（与聊天完全一致），返回延迟和错误分类
- [x] **I28：Multi-Provider AI 支持** — 新增 `PROVIDER_PRESETS` 注册表（13 个 Provider：Anthropic/OpenAI/Google/Groq/xAI/OpenRouter/Mistral/DeepSeek/智谱/Kimi/Cerebras/MiniMax/HuggingFace），`settings.ts`/`model.ts` 重构为 provider-agnostic，`test-key` 改用 `pi-ai.complete()` 消除 "测试通过但聊天失败" bug，新增 `ProviderSelect` 组件用于 Onboarding 和 Settings 动态渲染
- [x] **I3.5：`mindos uninstall` 命令** — 一条命令干净卸载（停进程 + 卸 daemon + 删配置 + 删知识库三重保护 + npm uninstall）— v0.5.15
- [x] **I12：Activity Bar + Panel 布局重构** — 左侧新增 48px Rail（Logo + Files/Search/AI + Settings/Sync），Sidebar 改为可切换 Panel。AI 对话/搜索/设置从 Modal 变为 Panel，不遮盖内容。移动端不变。[spec](./specs/spec-activity-bar-layout.md)
- [x] **Agent Panel 统一体验重构 (Phase 1-3)** — 抽取 snippet 生成为 shared util，创建 McpProvider 共享数据层，AgentsPanel 展开显示 config snippet + Skills toggle 区，McpTab 消费共享 context 不再重复 fetch。[spec](./specs/spec-agent-panel-unify.md)
- [x] **UX Review 修复 Batch 1-4** — OnboardingView error state + AskFab 暗色模式 + 72→2 inline style 清理 + aria-hidden + --amber-subtle token。[spec](./specs/spec-ux-review-fixes-batch.md) [review](../review/ux-design-review-2026-03-22.md)
- [x] **架构 Review 修复** — mcp-snippets 单元测试 (11 cases) + RightAskPanel ErrorBoundary。[spec](./specs/spec-arch-review-fixes.md)
- [x] **Quick Fixes** — PluginsPanel `role="link"` 键盘可访问 + N+1 fetch 改为单次 `/api/files` + `--amber-dim` 对比度 0.12→0.18 + modal 遮罩 `.dark` 变体
- [x] **Settings → Restart Walkthrough** — General tab 新增"重新开始引导"按钮，PATCH `/api/setup` 重置 walkthroughStep + walkthroughDismissed
- [x] **SidebarLayout 拆 hooks** — 479→314 行，抽取 `useLeftPanel` (81 行) + `useAskPanel` (117 行)，15+ state 分离为 2 个独立 hook
- [x] **McpSkillsSection 拆子组件** — 595→359 行，抽取 `McpSkillRow` (145 行) + `McpSkillCreateForm` (178 行)
- [x] **补测试** — walkthrough-steps (4 cases) + explore-use-cases (7 cases) + i18n-new-keys (10 cases)，总计 50 文件 598 测试
- [x] **I15：Discover 探索面板** — Activity Bar 新增 Discover 入口（Compass 图标），面板含使用案例（9 个，点击触发 Ask AI）+ 插件市场/技能市场占位。[spec](./specs/spec-discover-panel.md)
- [x] **I16：Agents 面板 Hub 导航** — 顶部 Discover 同款大行导航（Overview / MCP & Skills / Skills / Usage & help / Agent insights 即将推出）+ 分隔线下列表；智能体行可展开查看路径、stdio|http、复制配置。[spec](./specs/spec-agents-panel-hub-nav.md)
- [x] **I18：Agents Content-First Dashboard（P1）** — Sidebar 点击 Agents 进入 `/agents` 内容页；新增 Overview/MCP/Skills 三段视图与 `/agents/[agentKey]` 详情页；ActivityBar 的 Agents 按钮改为内容导航并保留旧右侧 detail 兼容期；新增 agents content i18n 与测试。[spec](./specs/spec-agents-content-first-dashboard.md)
- [x] **I19：Agents Dashboard UX/UI Polish（P1.5）** — `/agents` 导航补齐 tab 语义（tablist/tab/tabpanel）；MCP 增加 Connection Graph（light）+ 健康表联动；Skills 增加搜索、来源过滤、按需兼容矩阵；保持 Content-first 路由与可访问性一致。[spec](./specs/spec-agents-content-dashboard-ux-polish.md)
- [x] **I20：Agents Sidebar MCP/Skills 深链到 Content Panel（P1.6）** — Sidebar 的 Hub 行为与 Content 页信息架构对齐：`Overview/MCP/Skills` 分别跳转 `/agents`、`/agents?tab=mcp`、`/agents?tab=skills`；MCP 内容页增加“搜索 + 状态筛选（All/Connected/Detected/Not found）”以提升多 Agent 管理效率。[spec](./specs/spec-agents-sidebar-mcp-skills-content-routing.md)
- [x] **I21：Agents Skills Workspace（P1.7）** — Skills 页升级为多维管理工作台：状态过滤（Enabled/Disabled/Needs Attention）、能力过滤、批量启停筛选结果、Agent 聚焦矩阵；MCP 管理视图补充筛选结果计数。并新增模型层测试覆盖正常/边界/错误路径。[spec](./specs/spec-agents-skills-workspace-multi-agent.md)
- [x] **I22：Agents MCP Control Plane（P1.8）** — MCP 页升级为统一管理工作台：新增传输筛选（All/stdio/http/other）、风险队列（MCP 停止/Detected 待配置/Not found）、筛选结果批量重连与执行反馈；补充模型层 + 页面渲染测试覆盖正常/边界/错误路径。[spec](./specs/spec-agents-mcp-control-plane-upgrade.md)
- [x] **I23：Agents Sidebar Agent Click 路由统一（P1.9）** — Sidebar 中点击任意 Agent 行统一跳转 `/agents/[agentKey]`，详情在 Content 展示（skill/mcp/usage/space reach），不再走右侧详情抽屉；面板行高亮改为路由驱动。[spec](./specs/spec-agents-sidebar-agent-open-content-detail.md)
- [x] **I24：Agents 统一配置与运行信号可视化（P2.0）** — `/api/mcp/agents` 增补 skill 模式与隐藏目录 runtime 信号（conversation/usage/last activity）；MCP/Skills 页新增多 Agent 配置可见性摘要，Agent 详情页新增 Runtime & Config Signals 区块。[spec](./specs/spec-agents-unified-multi-agent-config-visualization.md)
- [x] **I25：Agent Detail 全量 Skill/MCP 管理工作台（P2.1）** — `/agents/[agentKey]` 展示全部 skills（含 disabled）并支持搜索/来源过滤/启停；user skill 支持就地 read+edit+save；新增 MCP 管理区（scope/transport 应用、复制 snippet、刷新状态）实现“可见即可管”。[spec](./specs/spec-agent-detail-manage-all-skills-mcp.md)
- [x] **I26：Agent 原生已安装 Skill/MCP 扫描可视化（P2.2）** — `/api/mcp/agents` 新增按 agent 隐藏目录/配置文件扫描：`configuredMcpServers`、`installedSkillNames` 与来源路径；`/agents/[agentKey]` 展示真实安装列表与空态，避免仅显示全局 catalog 造成“信息量不足”。[spec](./specs/spec-agents-agent-native-installed-scan-visualization.md)
- [x] **I27：Agents 全页面 UI/UX Pro Max 刷新（P2.3）** — `/agents` 全部核心页新增 Workspace Pulse、MCP/Skills 筛选摘要与 Agent Detail 健康条，强化"摘要→操作→明细"层级，降低多 Agent 管理认知负担。[spec](./specs/spec-agents-ui-ux-pro-max-refresh.md)
- [x] **I28：File Tree 隐藏系统文件** — 默认隐藏 INSTRUCTION.md、README.md、CONFIG.json、CHANGELOG.md、TODO.md 从 File Tree，用户可通过 Settings → "Show Hidden Files" 恢复显示。右键 Space → "Edit Rules" 提供快速访问 INSTRUCTION。[spec](./specs/spec-hide-system-files-in-tree.md)
- [x] **I29：跨 Agent MCP/Skill 全量聚合与视觉升级（P2.4）** — 全局 MCP 页新增"全部已配置 MCP servers（跨 Agent）"chip 矩阵；Skills 页新增"全部已安装 skills（跨 Agent）"chip 矩阵；配置可见性/注册表/原生安装列表从纯文本升级为 dot indicator + chip 视觉；Agent Detail 的 native scan 从 bullet list 升级为可扫 chip 布局。
- [x] **Ask 输入不中断（执行中可草拟）** — 修复 Agent 执行期间输入框被禁用：允许边执行边输入，提交仍串行；新增“可先输入下一步”提示与 jsdom 回归测试。测试：`app/__tests__/ask/ask-content-input-during-run.test.tsx`
- [x] **Ask AI 自动重连** — 连接断开时自动重试（指数退避 1s/2s/4s...），可配置最大重试次数（Settings → AI → Agent Behavior → Auto Reconnect，默认 3 次）。非重试型错误（401/403/429/API Key 无效）直接显示不重试。重连中显示 WifiOff 图标 + 进度文案。21 个新测试。
- [x] **Multimodal 图片输入** — 粘贴/拖拽/上传图片到聊天，支持 Anthropic/OpenAI vision 模型自动选择，消息历史渲染图片。5 层实现：消息类型扩展 → 前端输入 → API 转换 → 模型选择 → 历史渲染。
- [x] **文件内容 Diff 可视化** — AI 修改文件后工具调用块内嵌 inline diff；`/changes` 页面支持展开 line diff；ViewPageClient 变更高亮。Core: `.mindos/change-log.json` + `/api/changes`。
- [x] **CI 公开仓同步安全加固** — `.syncinclude` 声明式白名单（SSOT）+ `parse-syncinclude.sh` 解析器 + pre-push hook 拦截 public branch push + CI workflow 从 .syncinclude 读取配置。默认私有，忘记白名单 = 安全。
- [x] **Ask AI 聊天框 UI/UX 修复** — Modal 输入框 textarea 化（多行+自适应高度）；Popover 改为 absolute 定位（消除布局跳动）；重连状态 Stop→Cancel 语义统一；移动端 footer hints 始终显示；空 assistant 占位消息不再被持久化。
- [x] **Tier 1：Favorites / 收藏夹** — Star 图标固定常用文件，首页 Pinned Files 区 + 文件树右键菜单 + 文件视图顶栏 Star。localStorage 存储，支持排序。Hook: `usePinnedFiles`。
- [x] **Tier 1：Trash / 回收站** — 删除走 `.mindos/.trash/`，30 天自动清理。`/trash` 页面含恢复/永久删除/冲突处理（覆盖/副本）。`listTrash` 自动 purge 过期项。Core: `lib/core/trash.ts`。
- [x] **Tier 1：Export / 导出** — 单文件 MD/HTML + 目录 ZIP 导出。`/api/export` 路由 + `ExportModal` 组件（格式选择/进度/完成/错误状态）。Core: `lib/core/export.ts`。
- [x] **Tier 1：Undo Toast + i18n 全面治理** — toast.ts 扩展 action button 支持（`toast.undo` API）；删除文件/目录/空间后 5s undo toast → `restoreFromTrash`；修复 22 处 hardcoded 英文字符串（TrashPageClient/ExportModal/FileTree/ViewPageClient/Toaster）；新增 `trash.cancel`/`justNow`/`minutesAgo` 等 14 个 i18n 键（EN+ZH）；focus-visible ring 合规。

- [x] **Chat/Agent 模式切换** — Ask 面板新增 Chat/Agent 模式切换。Chat 模式使用精简 system prompt (~250 tokens) + 8 个只读工具（list_files/read_file/read_file_chunk/search/get_recent/get_backlinks/web_search/web_fetch），跳过 SKILL.md/bootstrap INSTRUCTION/CONFIG，step 上限降至 8。Agent 模式保持不变。省 ~81% token overhead。ModeCapsule 组件 + localStorage 持久化。25 个新测试。[spec](./specs/spec-chat-agent-mode-toggle.md)

### 🟡 中优先

- [x] **减少 `as any` 类型断言** — ask/route.ts 定义 5 个 AgentEvent 子类型接口（消除 14 处 as any）；context.ts 提取 `asMsg()` 辅助函数（消除 12 处）
- [x] **API 路由统一输入校验** — bootstrap 路径遍历防护、recent-files/git parseInt 安全校验、export format 枚举白名单
- [x] **CI 增加 lint 步骤** — ci.yml 新增 eslint step（continue-on-error，不阻塞 CI）
- [x] **添加 CONTRIBUTING.md** — 包含开发环境、代码风格、测试要求、PR 流程
- [x] **公共 API 函数补 JSDoc** — lib/fs.ts 26 个导出函数补齐 JSDoc（@param/@returns/@throws）
- [x] **SyncStatusBar i18n 类型** — 移除 3 处不必要的 `(t as any)`，直接使用已有类型 `t.sidebar.sync`

- [x] **MCP `mindos_create_space` + `mindos_rename_space`** — App：`createSpaceFilesystem`、`renameSpaceDirectory`、`/api/file` op；MCP 仅转发。见 `wiki/specs/spec-mcp-space-tools.md`
- [x] **I4：CLI per-command `--help`** — 6 个知识库命令（agent/api/ask/file/search/space）已全部支持 `--help` / `-h` 标志；`bin/lib/command.js` 统一 `printCommandHelp` 框架；命令元数据（name/group/summary/usage/examples/flags）完整。CLI 专业度提升。
- [x] **I5：首次使用引导流程** — GuideCard 替换 WelcomeBanner，3 任务卡片（探索 KB / AI 对话 / 配置同步）+ 交互式完成追踪 + C2→C4 渐进推荐 + 后端 guideState 持久化 + Settings 恢复入口。[spec](./specs/spec-first-use-guide.md)
- [x] **I13：Space 体验增强** — 新建一级目录自动生成 INSTRUCTION.md + README.md（Agent bootstrap 不再降级）+ 首页 "Recently Active" 按 Space 分组展示 + "All Spaces" 导航行。[spec](./specs/spec-space-auto-scaffolding.md)
- [x] **I14：新建心智空间** — 首页 Spaces grid 末尾 "+" 卡片，inline 表单输入名称+描述，一键创建 Space（目录 + INSTRUCTION.md + README.md）。复用 createFile + scaffoldIfNewSpace。[spec](./specs/spec-create-space.md)
- [x] **I17：Space-Aware Sidebar** — 文件树空间感知：含 INSTRUCTION.md 的目录用 Layers 图标 + amber 色 + 左边框标识为空间；隐藏系统文件（INSTRUCTION.md/README.md）；空间展开时上方显示 Rules+About 预览卡片（可滚动）；右键菜单支持 Edit Rules/Rename/Delete Space；双击空间不触发重命名。[spec](./specs/spec-space-aware-sidebar.md)
- [x] **Diff 主程序化（JSON 变更中心）** — Diff 不再依赖 `Agent-Diff.md` 插件入口；新增 `.mindos/change-log.json` 结构化事件流、`/api/changes`（summary/list/mark_seen）、全局变化提醒条与 `/changes` 下钻视图（可展开 line diff）。[spec](./specs/spec-diff-core-change-center.md)
- [x] **TODO Board 内建化（非插件面板）** — TODO 渲染器升级为 app-builtin feature：保留 `core` 渲染能力与首页入口，同时从插件管理表层移除，语义与 CSV/Agent Inspector/Config Panel 保持一致。[spec](./specs/spec-todo-core-builtin.md)
- [x] **I6：首页 Plugins 展示优化** — 卡片展示 description + tags，消除 RENDERER_ENTRY / PLUGIN_ENTRY_FILES 重复映射，不可用 plugin 点击提示创建引导，补齐 3 个漏注册 renderer（backlinks/workflow/diff）
- [x] **I6.5：Skill 管理面板改进** — 分组显示（Custom/Built-in）+ 搜索过滤 + 全文查看（read API）+ 内联编辑 + 预填模板创建（General/Tool-use/Workflow）+ Markdown 渲染。解决"不知道给新 agent 提供什么信息"的 pain point
- [x] **I7：文件视图 topbar 文件图标** — Breadcrumb 组件已有 `FileTypeIcon`（.csv → Table，.md → FileText，目录 → Folder）
- [x] **I8：Skill 渐进式加载** — ✅ 完成：v4 架构（2 文件），CLI 自动迁移 + App 端 skill-rules 注入。[spec](./specs/progressive-skill-loading.md)

### UI 审计修复（2026-03-27）

> 来源：`wiki/reviews/ui-audit-2026-03-27.md`。[spec](./specs/spec-ui-audit-fixes-2026-03-27.md)

- [x] **P1：技能列表虚拟化** — `AgentsSkillsSection` BySkillView 已用 `react-virtuoso` 虚拟滚动（`<Virtuoso>` 组件 + flatItems + overscan=200 + viewport buffer）。仅渲染可见技能卡片 + 分组 headers，而非全量 DOM。搜索/筛选/分组/批量操作全部保留。AgentDetailContent 单 Agent 技能列表（通常 20-50 项）保持原生渲染。
- [x] **P2：琥珀色文字对比度不足** — 新增 `--amber-text` token，28 文件小字号文字改用加深色值，满足 WCAG AA 4.5:1
- [x] **P2：通知横幅持续显示** — 10s 后自动消失 + 新变更到达时重新显示
- [x] **P2：浮动按钮无 tooltip** — i18n title + aria-label（EN/ZH）
- [x] **P3：代理未找到页面空旷** — 增加排查提示 + 已连接代理建议列表
- [x] **Agent Inspector 身份追踪** — 审计日志记录操作来源 Agent（Claude Code / Cursor / Windsurf / MindOS Ask）。MCP clientInfo 端到端传递 + UI 徽标展示
- [x] **P3：帮助页面缺悬浮目录** — `/help` 长内容需添加浮动 TOC 或锚点跳转
- [x] **P3：Echo 侧边栏利用不足** — 5 项占 ~200px，添加最近活动或快捷统计
- [x] **P3：用例卡片截断不一致** — 验证已有 `line-clamp-2`，截断一致，无需修改
- [x] **P3：操作类型徽章无按类型着色** — create/import=绿, delete=红, rename/move=灰, update=默认

### 🟢 低优先（等需求驱动）

- [x] **Toast/Snackbar 系统** — 自建 `lib/toast.ts`（module-level store + useSyncExternalStore）+ `Toaster.tsx`。支持 success/error/info/copy + undo action button。已用于删除撤销、导出、收藏等反馈。
- [x] **⌘K Command Palette 扩展** — 已实现 5 个快捷操作：Settings / Restart Walkthrough / Toggle Dark Mode / Go to Agents / Go to Discover。缺 Skill 开关 + 最近 AI 对话（触发条件：用户反馈）。
- [x] **Zustand 替代 Context 嵌套** — McpContext/LocaleContext/WalkthroughContext 全部迁移为 Zustand store（selector-based 订阅）。Provider 嵌套从 4 层降至 0 层。MCP 30s 轮询不再导致全树 re-render。新增 `app/lib/stores/` 目录（mcp-store/locale-store/walkthrough-store + 3 个 Init 组件）。72 个消费端文件更新。1116 测试全过。
- [x] **ACP 检测性能优化** — `/api/acp/detect` 从 ~13 个独立子进程改为单次 shell 批量 `which`（1 个 exec 调用）。服务端/客户端缓存 TTL 从 5min 提升至 30min。首次检测从 2-5s 降至 <500ms，后续命中缓存零延迟。
- [x] **用户偏好文件迁移** — `user-skill-rules.md`（根目录）→ `.mindos/user-preferences.md`。语义更准确（preferences 而非 rules），路径归入 `.mindos/` 系统目录。CLI 启动时 4 级链式自动迁移覆盖所有历史位置。15+ 文件路径引用更新（API/CLI/SKILL.md EN+ZH/preference-capture/write-supplement）。
- [x] **首页 System Pulse** — 新增 `SystemPulse` 组件（Agent 连接状态 + MCP 状态 + 技能统计），自适应 3 种状态（0 Agent 引导 / 折叠摘要 / 展开详情），localStorage 持久折叠，i18n EN+ZH，focus-visible 合规。
- [x] **i18n 按模块拆分** — 8 个模块文件（common/navigation/ai-chat/knowledge/panels/settings/onboarding/features），总计 3347 行。`index.ts` 统一导入+导出，类型系统保证 key 一致性。支持未来第 3 种语言扩展无需改结构。
- [ ] **I11：局域网自动发现 (mDNS/Bonjour)** — 手机/平板自动连。P2 桌面端阶段再做更合适，[详情](./63-stage-mdns.md)

### 已完成 / 不做

- [x] **`/api/mcp/restart` 与 Desktop ProcessManager 竞争修复** — Desktop 设 `MINDOS_MANAGED=1`，API 路由据此跳过自行 spawn；修复 `monitoring` 路由端口默认值 3457→8781；`stop.js` pkill 覆盖 `dist/index.cjs` 路径。详见 `wiki/80-known-pitfalls.md`
- [x] **`mindos mcp` stdio EADDRINUSE 修复** — `mindos mcp` 默认 `MCP_TRANSPORT=stdio`，所有 HTTP 场景显式声明 `MCP_TRANSPORT=http`。详见 `wiki/80-known-pitfalls.md`
- [x] **I9：Onboarding 端口分离** — Setup wizard 用临时端口（9100+），完成后按配置端口重启 — v0.5.4
- [x] **I10：目录视图卡片密度优化** — 文件夹 `p-3` + 22px 图标（紧凑），文件 `p-4` + 28px 图标（保持信息量）。Breadcrumb 增加 FileTypeIcon。FindInPage 阅读模式搜索
- [x] **增加更多 Agent 支持** — 16 个 MCP Agent + `npx skills` 支持 40 个
- [x] **GUI RestartBlock 健康检查** — v0.5.2
- [x] **Onboarding 非空目录模板选择** — v0.5.9
- [x] 文件视图文档内搜索（⌘F）— v0.4.0 FindInPage
- ❌ **Onboarding 原生文件夹选择器** — Web 不做，桌面端再做

## 待验证

- [ ] Windows WSL 下 daemon (systemd) 是否稳定
- [ ] Git sync 在大知识库 (>1000 文件) 下的性能
- [ ] 多 Mind 实例（~/MindOS 下多个大脑，如团队/个人）— 当前用子目录满足，等团队版(P2)或用户反馈再决策

## UX 体验审计 (2026-03-31)

> 详细描述见 `wiki/80-known-pitfalls.md` — UI / 前端交互 章节

### 🔴 Critical（发布前）

- [x] **静默错误吞掉 × 12** — 所有 `.catch(() => {})` 替换为有用户反馈的错误处理 — ✅ DONE
  - HelpContent / setup / HomeContent / UpdateTab / KnowledgeTab / DiscoverPanel / PluginsPanel / WalkthroughProvider / GuideCard / SummaryRenderer
- [x] **缺少加载态 × 8** — async 操作添加 loading state + spinner/文字变化 — ✅ DONE
  - CsvView（单元格/行操作）已修复：saving state + spinner + disabled buttons
  - ImportModal / SyncTab / EchoInsightCollapsible 经审查已有 loading state，无需修改
  - DiscoverPanel 为非关键预加载，已有 console.warn 降级

### 🟡 High-Priority（下个迭代）

- [x] **截断文本无 tooltip × 22** — 所有 `truncate` / `line-clamp-*` 添加 `title` 属性 — ✅ DONE
  - PanelNavRow(2) / DiscoverPanel(2) / AgentsPanelAgentDetail(2) / UseCaseCard(2) / SearchPanel(3) / SearchModal(3) / SlashCommandPopover(1) / MentionPopover(2) / Backlinks(2) / Breadcrumb(1) / DirView(2)
- [x] **禁用按钮无说明 × 16** — 所有 `disabled` 按钮添加 `title` 解释原因 — ✅ DONE
  - ImportModal(3) / OnboardingView(1) / CreateSpaceModal(1) / SyncTab(2) / AskContent(1) / KnowledgeTab(2) / EchoInsightCollapsible(2) / StepDots(1) / AiTab(1) / WorkflowRenderer(2)

### 🟢 Nice-to-Have

- [x] **onClick div 无 cursor-pointer × 2** — DirView / ToolCallBlock — ✅ 经复查为误报：DirView 用 `<Link>`，ToolCallBlock 用 `<button>`，均自带 cursor:pointer
