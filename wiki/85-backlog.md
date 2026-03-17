<!-- Last verified: 2026-03-15 | Current stage: P1 -->

# Backlog

> 临时 bug、技术债、改进想法。解决后移除或转入对应 stage 文件。

## Bug

- [x] **`mindos update` 端口硬编码**：重启后健康检查轮询 `localhost:3000`，但用户实际端口可能不是 3000，导致"did not come back up in time"误报。修复：直接从 config 文件读 `port` 字段；顺带将 `waitForHttp` 探测路径从 `/` 改为 `/api/health` — v0.5.2
- [x] **进程生命周期 7-bug 链**：stop/restart 模块连环 bug（PID 不完整、端口清理跳过、env 继承覆盖、config 新旧端口不分、lsof 环境差异、ss 子串误匹配、health 被 auth 拦截）。详见 `wiki/81-postmortem-process-lifecycle.md` — v0.5.7
- [x] **Onboard check-port 自回环误报端口占用**：`http://localhost:3013/setup` 配置端口时，3013 被报为"已被占用"。原因：server-to-self HTTP 回环在 Next.js 单线程模式下超时。修复：从 `req.nextUrl.port` 直接判断 self，跳过网络自检。详见 `wiki/80-known-pitfalls.md`

## 技术债

- [x] **P1：硬编码状态色 → CSS 变量**：定义 `--success`/`--error` 变量后全局替换 `#7aad80` → `var(--success)`、`#c85050` → `var(--error)`、`text-red-400/500` → `text-error`、`#ef4444` → `var(--error)`、`rgba(239,68,68,...)` → `rgba(200,80,80,...)`。涉及 15 文件。二轮补充：`text-green-500` / `bg-green-500` → `text-success` / `bg-success`（SyncStatusBar、SettingsModal、SyncTab、McpTab、KnowledgeTab），`accent-amber-500` → `accentColor: var(--amber)`（McpTab ×4）
- [x] **P2：`prefers-reduced-motion` 支持**：在 `globals.css` 添加 `@media (prefers-reduced-motion: reduce)` 将 `animation-duration` / `transition-duration` 置为 `0.01ms`
- [x] **P3：Focus ring 统一**：`--ring` 改为 `var(--amber)`，所有自定义 input 从 `focus:` 迁移到 `focus-visible:`，FileTree 蓝色 focus 改为 amber ring。涉及 7 文件
- [ ] 模板内容待优化（中英双语）
- [x] SearchModal / AskModal 添加 `role="dialog"` + `aria-modal="true"`（无障碍）— 已完成（三个 modal 均已有）
- [ ] 13 个 renderer 插件文件仍使用 inline `fontFamily`，待迁移到 `.font-display`
- [x] **SetupWizard 硬编码色值清理**：10+ 处 `#22c55e` → `var(--success)`、`#f59e0b` → `var(--amber)`；与 P1 治理同类问题
- [x] **SetupWizard `.catch(() => {})` 静默吞错**：9 处空 catch 改为 `console.warn('[SetupWizard] ...')` 输出上下文（init fetch ×3, checkPort, agent install, skill install, retryAgent, autocomplete, check-path, restart）
- [x] **i18n 清理 `kbPathExists` 废弃 key**：EN/ZH 各一处，已被 `kbPathHasFiles` 替代
- [x] **`copyToken` setState 内副作用**：改为直接读 `state.authToken` 执行 clipboard 写入，deps 加 `[state.authToken]`
- [x] **Checkbox accent 色值统一**：`accent-amber-500`（Tailwind `#f59e0b`）→ `accentColor: var(--amber)`（`#c8873a`），与设计系统一致
- [x] **`#131210` → `--amber-foreground` 全局治理**：新增 `--amber-foreground` CSS 变量（light/dark 均为 `#131210`），注册到 `@theme inline`，全局 15 个文件 22 处 `#131210` 硬编码替换为 `var(--amber-foreground)`。涉及 SetupWizard、SettingsModal、AskModal、McpTab、SyncTab、MessageList、login、not-found、ViewPageClient、ConfigRenderer、SummaryRenderer、WorkflowRenderer、GraphRenderer、BoardView、ConfigPanel、globals.css
- [x] **SetupWizard 文件拆分**：~1400 行拆为 `app/components/setup/` 目录下 10 个文件（types.ts, constants.tsx, StepKB, StepAI, StepPorts, StepSecurity, StepAgents, StepReview, StepDots, index.tsx），原文件改为 re-export

## 改进想法

- [x] **增加更多 Agent 支持**：当前 `MCP_AGENTS` 16 个（claude-code, cursor, windsurf, cline, trae, gemini-cli, openclaw, codebuddy, iflow-cli, kimi-cli, opencode, pi, augment, qwen-code, trae-cn, roo），`npx skills` 支持 40 个。改动文件：`app/lib/mcp-agents.ts`（主定义）+ `app/app/api/mcp/install-skill/route.ts`（Skill 安装常量）。完整 agent 清单见 `wiki/refs/npx-skills-mechanism.md`

- [x] **GUI RestartBlock 健康检查**：polling 判断条件从 `d.service === 'mindos'`（依赖响应体）改为 `r.status < 500`（只看状态码），与 CLI `waitForHttp` 逻辑一致，不受响应结构变更影响 — v0.5.2

- [ ] **Onboarding — API Key 连通性验证**：Step 2 填写 API Key 后失焦自动测试（`max_tokens: 1`），显示 ✔/✘ badge 但不阻断继续；CLI 同步；Skip 模式不触发

- [x] **Onboarding — 非空目录模板选择**：非空目录 onboard 时，后端 silent-skip 模板无反馈。修复：前端显示跳过/合并选项，默认跳过；后端放宽 guard 依赖 copyRecursive skip-existing 保护；导航按钮 submitting 期间 disabled — v0.5.9

- ❌ **Onboarding — 原生文件夹选择器（Web 不做，桌面端要做）**：浏览器 `showDirectoryPicker()` 返回的是内存句柄（`FileSystemDirectoryHandle`），规范层面无 `.path` 属性，无法获取服务器上的真实路径。Web 模式下路径补全（SPEC-OB-16）是最接近的替代方案。**桌面端**（Electron）列为必做：用 `dialog.showOpenDialog` 实现原生文件夹选择，直接返回真实路径。

- [ ] 局域网自动发现 (mDNS/Bonjour) — 手机/平板自动连
- [ ] 首页 Plugins 更好的展示方式
- [ ] Skill 工作流引导优化（持续）
- [ ] 登录页添加产品标语（`t.app.tagline`），给初次访问者提供上下文
- [ ] 目录视图卡片可按内容类型调整大小（文件夹 vs 单文件密度优化）
- [ ] 文件视图 topbar 增加文件图标前缀，与侧边栏保持一致
- [x] 文件视图增加文档内搜索（⌘F 高亮跳转）— v0.4.0 FindInPage
- [ ] CLI 增加 per-command `--help`（`mindos start --help` 显示子命令选项）
- [ ] CLI 增加 `mindos status` 命令（一览服务状态、端口、同步状态）
- [ ] 首次使用引导流程：检测新模板 → 展示知识库结构 → 引导 AI 提问 → 引导配置 Sync
- [ ] **Onboarding 端口分离**：Setup wizard 使用固定临时端口（如 5000）启动，用户配置的端口独立写入 config，完成后按 config 端口重启正式服务。当前行为：onboard 和正式服务共用同一端口，改端口后必须 restart，体验割裂

## 待验证

- [ ] Windows WSL 下 daemon (systemd) 是否稳定
- [ ] Git sync 在大知识库 (>1000 文件) 下的性能
- [ ] 多 Mind 实例（~/MindOS 下多个大脑，如团队/个人）— 当前用子目录满足，等团队版(P2)或用户反馈再决策
