<!-- Last verified: 2026-03-22 | Current stage: P1 -->

# Backlog

> 临时 bug、技术债、改进想法。解决后移除或转入对应 stage 文件。

## Bug

- [x] **Agent 框架迁移 Vercel AI SDK → pi-agent-core** — 完成 6 阶段迁移（Phase 0-5）。Spec v2 所有 6 个设计缺陷已修复。涉及 7 文件改写 + 完整 SSE 协议重定义。详见 `wiki/specs/migrate-to-pi-agent.md` — v0.6.0

## 技术债

> 按优先级排序（高 → 低）。已完成项折叠在末尾。

- [x] **测试文件适配 pi-agent-core**：`__tests__/core/context.test.ts` 和 `__tests__/core/tools.test.ts` 已适配 `AgentMessage` + 新 `compactMessages` 签名。511 tests passing.
- [x] **App 端 skill-rules.md 注入**：route.ts 从用户知识库 `.agents/skills/{name}/` 读取 `skill-rules.md` + `user-rules.md` 并注入 system prompt。支持中英文切换、空文件跳过、截断标志。详见 `wiki/specs/spec-app-skill-rules-injection.md`
- [x] **AIP-001 统一错误处理**：`MindOSError` 类 + 12 个 `ErrorCodes` + `apiError()`。core/ 13 处 throw 已迁移，API 统一返回 `{ ok, error: { code, message } }` 格式
- [x] **AIP-002 性能监控面板**：`MetricsCollector` 单例 + `GET /api/monitoring` + Settings Monitoring tab（系统/应用/知识库/MCP 指标，5s 轮询）
- [x] **AIP-003 增量搜索索引**：倒排索引 + CJK bigram 分词，搜索候选集缩减后精确匹配。索引与 invalidateCache 联动自动失效

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

### 🔴 高优先（下一批做）

- [x] **Desktop：MindOS 运行时择优（代码层）** — `pickMindOsRuntime` + `resolveLocalMindOsProjectRoot` 接入 `startLocalMode`；`config`/`MINDOS_RUNTIME_ROOT`/`MINDOS_DEV_BUNDLED_ROOT`；Desktop `npm test` 覆盖 pick+layout。内置 `extraResources` 产物与三平台冒烟仍待办。[spec](./specs/spec-desktop-bundled-mindos.md)
- [x] **Desktop：内置运行时 Next standalone + 精简 prepare** — `app/next.config` `output: 'standalone'`；`prepare-mindos-bundle.mjs` 合并 static/public、拷贝 app 时去掉 `node_modules` / `.next/cache` / `.next/dev`。[spec](./specs/spec-desktop-standalone-runtime.md)
- [ ] **Electron Desktop App（Phase 1）** — 本地+远程双模式桌面端，含共享连接 SDK、服务端 CORS 增强、系统托盘/快捷键/自动更新。[spec](./specs/spec-electron-desktop-app.md)
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
- [x] **I3：API Key 连通性验证** — Settings AI Tab 已有 Test 按钮（`/api/settings/test-key`），支持 Anthropic/OpenAI，返回延迟和错误分类
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
- [x] **Ask 输入不中断（执行中可草拟）** — 修复 Agent 执行期间输入框被禁用：允许边执行边输入，提交仍串行；新增“可先输入下一步”提示与 jsdom 回归测试。测试：`app/__tests__/ask/ask-content-input-during-run.test.tsx`

### 🟡 中优先

- [x] **MCP `mindos_create_space` + `mindos_rename_space`** — App：`createSpaceFilesystem`、`renameSpaceDirectory`、`/api/file` op；MCP 仅转发。见 `wiki/specs/spec-mcp-space-tools.md`
- [ ] **I4：CLI per-command `--help`** — `mindos start --help` 显示子命令选项。与 I1 一起做，CLI 专业度提升
- [x] **I5：首次使用引导流程** — GuideCard 替换 WelcomeBanner，3 任务卡片（探索 KB / AI 对话 / 配置同步）+ 交互式完成追踪 + C2→C4 渐进推荐 + 后端 guideState 持久化 + Settings 恢复入口。[spec](./specs/spec-first-use-guide.md)
- [x] **I13：Space 体验增强** — 新建一级目录自动生成 INSTRUCTION.md + README.md（Agent bootstrap 不再降级）+ 首页 "Recently Active" 按 Space 分组展示 + "All Spaces" 导航行。[spec](./specs/spec-space-auto-scaffolding.md)
- [x] **I14：新建心智空间** — 首页 Spaces grid 末尾 "+" 卡片，inline 表单输入名称+描述，一键创建 Space（目录 + INSTRUCTION.md + README.md）。复用 createFile + scaffoldIfNewSpace。[spec](./specs/spec-create-space.md)
- [x] **I17：Space-Aware Sidebar** — 文件树空间感知：含 INSTRUCTION.md 的目录用 Layers 图标 + amber 色 + 左边框标识为空间；隐藏系统文件（INSTRUCTION.md/README.md）；空间展开时上方显示 Rules+About 预览卡片（可滚动）；右键菜单支持 Edit Rules/Rename/Delete Space；双击空间不触发重命名。[spec](./specs/spec-space-aware-sidebar.md)
- [x] **Diff 主程序化（JSON 变更中心）** — Diff 不再依赖 `Agent-Diff.md` 插件入口；新增 `.mindos/change-log.json` 结构化事件流、`/api/changes`（summary/list/mark_seen）、全局变化提醒条与 `/changes` 下钻视图（可展开 line diff）。[spec](./specs/spec-diff-core-change-center.md)
- [x] **I6：首页 Plugins 展示优化** — 卡片展示 description + tags，消除 RENDERER_ENTRY / PLUGIN_ENTRY_FILES 重复映射，不可用 plugin 点击提示创建引导，补齐 3 个漏注册 renderer（backlinks/workflow/diff）
- [x] **I6.5：Skill 管理面板改进** — 分组显示（Custom/Built-in）+ 搜索过滤 + 全文查看（read API）+ 内联编辑 + 预填模板创建（General/Tool-use/Workflow）+ Markdown 渲染。解决"不知道给新 agent 提供什么信息"的 pain point
- [x] **I7：文件视图 topbar 文件图标** — Breadcrumb 组件已有 `FileTypeIcon`（.csv → Table，.md → FileText，目录 → Folder）
- [x] **I8：Skill 渐进式加载** — ✅ 完成：v4 架构（2 文件），CLI 自动迁移 + App 端 skill-rules 注入。[spec](./specs/progressive-skill-loading.md)

### 🟢 低优先（等需求驱动）

- [ ] **Toast/Snackbar 系统** — Copy 反馈各组件自管 `setCopied`（5+ 处重复）。引入 Sonner 或自建全局 Toast provider，统一操作反馈出口。**触发条件**：需要 undo 操作（如删除文件撤销）或批量操作结果反馈时。工作量 ~1-2h
- [ ] **⌘K Command Palette 扩展** — 当前只搜文件。可扩展为：快捷操作（Toggle dark mode / Restart walkthrough / Go to /explore）+ Skill 开关 + 最近 AI 对话。**触发条件**：用户反馈"操作路径长"或"找不到功能"时。工作量 ~3-4h
- [ ] **Zustand/Jotai 替代 Context 嵌套** — 当前 4 层 Provider（Locale → Walkthrough → Mcp → SidebarLayout），Context 变化导致子树 re-render。已用 `useMemo` 缓解，当前无感知性能问题。**触发条件**：profiler 显示 Context re-render 是瓶颈，或 Provider 层数超过 6 层时。工作量 ~4-6h
- [ ] **i18n 按模块拆分** — `i18n-en.ts` 712 行 / `i18n-zh.ts` 737 行，全部翻译在单一 `as const` 对象中。类型系统保证 key 一致性。**触发条件**：加第 3 种语言，或单文件超过 1000 行时。工作量 ~2-3h
- [ ] **I11：局域网自动发现 (mDNS/Bonjour)** — 手机/平板自动连。P2 桌面端阶段再做更合适，[详情](./63-stage-mdns.md)

### 已完成 / 不做

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
