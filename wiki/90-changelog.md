<!-- Last verified: 2026-03-27 | Current stage: P1 -->

# 变更日志 (CHANGELOG)

## Unreleased (after v0.6.7)

### 构建优化
- **生产构建切换到 webpack**：Turbopack 16.1.x 的 `serverExternalPackages` 不影响 standalone trace（[#88842](https://github.com/vercel/next.js/discussions/88842)），切换后 standalone 从 200MB 降至 110MB（-45%），koffi 87MB 被正确排除。dev 模式仍用 Turbopack
- **清理过期 mcp/node_modules**：Desktop runtime 中 73MB 的 mcp/node_modules 是 v0.6.6 esbuild 方案落地前的旧产物，重跑 prepare 脚本后替换为 1.2MB 的 dist/index.cjs
- **Desktop 安装包体积**：macOS arm64 zip 144MB → 129MB（-10%），runtime 层 198MB → 133MB（-33%）

### 修复
- **Setup Wizard MCP 端口误报**：首次安装时 check-port 错误报告 MCP 端口"已被占用"（实际是自己的进程）
- **MCP 端口竞争**：`/api/mcp/restart` 和 Desktop ProcessManager 同时操作 MCP 端口导致冲突
- **AI Organize "无更改" 误报**：PDF 上传走 `file.text()` 返回二进制乱码；AI 返回含 `<thinking>` 标签被误解析；prompt 未明确要求写入文件
- **CLI `--turbo` 参数冲突**：`mindos build --turbo` 会与硬编码的 `--webpack` 冲突，现已从 extra args 中过滤

### 新增
- **AI Organize 进度 UX**：ImportModal 内嵌进度展示（streaming 解析 + 实时文件列表），支持最小化后台运行
- **AI Organize 结果视图优化**：新增 `OrganizeNoChangesView` 组件 + `cleanSummaryForDisplay` 函数，解决"无更改"与"N 个操作"文案自相矛盾问题；服务端 `sanitizeToolArgs` 防止 SSE 序列化静默丢失

### 已知性能瓶颈
- **AI Organize 单文件上传耗时长**（30-60s）：根因是每次 organize 等同一次 5-10 轮 Agent 对话，每轮携带 30-50k tokens 上下文。主要耗时分布：LLM 多轮推理 70-90%、上下文装载 10-20%、session 初始化 1-3s、PDF 提取 1-2s。待优化方向：轻量模型专用通道、精简 organize 专用 prompt、减少 Agent 探索步数

## v0.6.0 — Agent 框架迁移 pi-agent-core + Skill 渐进式加载 v4 (2026-03-20)

### ⚠️ Breaking（内部）
- 移除 `@ai-sdk/anthropic`、`@ai-sdk/openai`、`ai` 三个依赖
- SSE 流格式从 AI SDK 私有协议切换为 MindOS 自定义 6 事件格式（`text_delta`、`thinking_delta`、`tool_start`、`tool_end`、`done`、`error`）
- `getModel()` → `getModelConfig()` 返回 `{ model, modelName, apiKey, provider }`

### 新增
- **Agent 框架迁移**：Vercel AI SDK → `@mariozechner/pi-agent-core@0.60.0` + `@mariozechner/pi-ai@0.60.0`
  - 15 个 tool 从 Zod + `tool()` 改写为 TypeBox + `AgentTool` 接口
  - 新增 `to-agent-messages.ts`：两层消息转换（Frontend → AgentMessage → pi-ai Message）
  - `transformContext` hook 封装三阶段上下文管理
  - `beforeToolCall` 写保护 + `afterToolCall` 日志
  - Loop 检测改为 `subscribe('turn_end')` + `steer()`
  - Step 限制通过 `abort()` 强制终止
  - Extended thinking 支持（`thinkingLevel`）
- **Skill 渐进式加载 v4**：4 文件 → 2 文件（`skill-rules.md` + `user-rules.md`），tool call 从 4-5 次降为 1 次
  - `mindos start` 自动迁移旧版文件

### 修复（Code Review 12 项）
- API key 闭包并发安全
- Loop 检测竞态条件
- Context compact API 失败 fallback 到 hard prune
- AgentEvent 类型安全（7 个类型守卫函数）
- 文件截断显式标志 + 警告
- OpenAI 自定义端点 API 变体配置

### 依赖变更
- 移除：`ai`、`@ai-sdk/anthropic`、`@ai-sdk/openai`
- 新增：`@mariozechner/pi-agent-core`、`@mariozechner/pi-ai`、`@sinclair/typebox`

---

## v0.5.15 — `mindos uninstall` + daemon 启动修复 + 等待 UX 优化 (2026-03-18)

### 新增
- **`mindos uninstall` 命令** — 一条命令干净卸载：停进程 → 卸 daemon → 可选删除配置目录 → 可选删除知识库（三重保护：确认 → 输入 YES → 密码验证）→ npm uninstall
- **uninstall 测试** — 13 个集成测试覆盖 abort、三重保护、config 读取时序回归、tilde 展开

### 修复
- **systemd daemon 启动失败** — `systemd.install()` 只做了 `enable`（创建开机自启 symlink）没有 `start`，导致 Linux 上 `mindos start --daemon` 永远超时。launchd 的 `bootstrap` 会自动启动，但 systemd 需要显式 `start`
- **readline 丢行** — 多个 `readline.createInterface` 实例在 piped stdin 下丢失 buffered 行。改为共享单个 rl + `line` 事件手动 buffer
- **子进程消耗 stdin** — `stopMindos`/`gateway` 的 `execSync` 用 `stdio: 'inherit'` 会让子进程（pkill/systemctl）抢占 stdin 数据。改为 `['ignore', 'inherit', 'inherit']`

### 变更
- **waitForHttp 进度提示** — 从点点点（`...........✔`）改为原地刷新的阶段提示 + 计时器：`⏳ Waiting for Web UI — building app (23s)`。三阶段：installing dependencies → building app → still building
- **waitForHttp 超时** — 默认 retries 从 120 降为 60（4 分钟 → 2 分钟）

---

## v0.5.14 — CLI 路径解析修复 + 空仓库同步支持 (2026-03-18)

### 修复
- **CLI 路径解析** — `sync/route.ts` 和 `restart/route.ts` 通过环境变量 `MINDOS_CLI_PATH` / `MINDOS_NODE_BIN` 解析 CLI 路径，Turbopack 下不再依赖 `process.cwd()` 动态解析。两个 route 统一 fallback 到 cwd 相对路径
- **空仓库 sync init** — `git ls-remote` 移除 `--exit-code`，首次同步到空 GitHub 仓库不再报错

### 变更
- `bin/cli.js` 的 `dev` 和 `start` 命令启动时设置 `MINDOS_CLI_PATH` / `MINDOS_NODE_BIN` 环境变量供子进程使用

### 致谢
- 感谢 [@yeahjack](https://github.com/yeahjack) 提交 [PR #1](https://github.com/GeminiLight/MindOS/pull/1)

---

## v0.5.12 — 默认端口变更 + 日志轮转 (未发版)

### 变更
- **默认端口** — Web 端口从 `3000` 改为 `3456`，MCP 端口从 `8787` 改为 `8781`，避免与 Next.js/Vite/Express 和 Cloudflare Wrangler 冲突。已有用户配置（`~/.mindos/config.json`）不受影响

### 新增
- **日志自动轮转** — daemon 模式（systemd/launchd）启动时，若 `~/.mindos/mindos.log` 超过 2MB 自动轮转为 `.old`，防止日志无限增长

---

## v0.5.9 — 非空目录 Onboard 优化 (2026-03-17)

### 新增
- **非空目录模板选择** — Onboarding 时检测到目录已有文件，显示 amber 提示框 + "跳过模板"（默认）/ "选择模板合并" 两个选项，避免静默跳过无反馈
- **导航守卫增强** — Setup 提交期间（`submitting` / `completed`），StepDots 步骤条和 Back 按钮同步禁用，防止用户中途跳走

### 变更
- **后端模板 guard 放宽** — `setup/route.ts` 移除 `dirEmpty` 条件，改由前端控制是否发送 template，后端依赖 `copyRecursive` skip-existing 保护
- **StepDots 组件** — 新增 `disabled` prop，支持 `disabled:cursor-not-allowed disabled:opacity-60` 视觉反馈

### 文档
- **开发洞察** — `wiki/41-dev-pitfall-patterns.md` 新增"状态变更的影响面追踪"章节（规则 6-8）
- **已知陷阱** — `wiki/80-known-pitfalls.md` 新增"变更质量 checklist"
- **Agent 协作规则** — `AGENTS.md` 新增"前端状态变更检查"条目

---

## v0.5.7 — Agent 自动检测 + README 优化 + Landing Page 刷新 (2026-03-17)

### 新增
- **Agent 自动检测** — 扫描已安装的 AI Agent，onboard 时自动预填 MCP 配置
- **WeChat 社区入口** — README 新增 Community section（二维码 + 加群引导），中英文同步
- **营销文档** — `marketing/user-growth.md` 增长飞轮策略（MCP 生态占位、搜索截流、开发者社区、被动分发）；`marketing/wechat-community.md` 微信内测群运营方案
- **MCP 请求日志** — MCP Server 新增请求日志中间件
- **project-wiki Skill 模板** — 新增 design-exploration、postmortem 模板，移除 human-insights
- **新增测试** — detect-agents、skill install、stop-restart、check-port、setup、middleware

### 变更
- **README badge 重构** — 新增 npm version（amber）+ WeChat（微信绿），去掉 DeepWiki，排序调整为 Website → npm → WeChat → License，颜色协调统一
- **Landing Page 刷新** — 内容和布局更新
- **Skill 自动安装增强** — 重试逻辑、校验、错误处理优化
- **Graceful stop** — 关停时等待进行中请求完成，额外健壮性改进
- **Restart API** — 增强错误处理
- **Renderer** — graph manifest 修复，codegen 脚本更新，新增 core flag

---

## v0.5.4 — Skill 自动安装 + Onboard 端口分离 (2026-03-16)

### 新增
- **Skill 自动安装** — GUI/CLI onboarding 完成时自动安装对应语言的操作指南 Skill（`mindos` / `mindos-zh`），并写入 `disabledSkills` 禁用另一语言版本
- **Skill 安装 API** — `POST /api/mcp/install-skill`，执行 `npx skills add` 分发 Skill 到选定的 AI Agent
- **Settings Skill 语言切换** — MCP → Skills 区域新增语言切换按钮（EN / 中文）
- **新增 MCP Agent** — amp, codex, github-copilot, kimi-cli, opencode, warp

### 变更
- **Onboard 端口分离** — 首次 onboard 使用临时端口（9100+），不再占用用户配置的正式端口；re-onboard 复用已运行的服务
- **needsRestart 逻辑修正** — 首次 onboard 始终 restart（临时端口 → 正式端口），re-onboard 仅在配置变更时 restart
- Step 3 端口提示图标从 ⚠️ 改为 ℹ️，文案改为"完成配置后服务将以这些端口启动"

### 修复
- **isSelfPort 误判** — 设置 webPassword 后 `/api/health` 返回 401，旧逻辑未识别为 MindOS 服务，导致 re-onboard 误启新进程
- **CLI selectedTemplate 作用域错误** — 已有知识库时模板变量未赋值，Skill 安装始终用 `en`

---

## v0.4.0 — 插件架构重构 + CLI UX 增强 (2026-03-14)

### 新增
- **插件架构 4 阶段完成** — renderer 目录拆分 → manifest 自注册 → codegen auto-discovery → lazy loading
- **codegen 脚本** — `scripts/gen-renderer-index.js` 自动扫描 `manifest.ts` 生成 `index.ts`（142 行 → 23 行）
- **Lazy Loading** — 所有 10 个 renderer 改为 `React.lazy` + `Suspense`，按需加载
- **CLI 更新检查** — `start`/`dev`/`doctor` 启动时非阻塞检查 npm 最新版本，24h 缓存，`MINDOS_NO_UPDATE_CHECK=1` 可禁用
- **`--version` / `-v`** — 输出 `mindos/0.4.0 node/v22 linux-x64` 格式
- **`--help` / `-h`** — 全局帮助（exit 0）
- **`config unset <key>`** — 删除配置字段，支持 dot-notation
- **`config set` 类型推断** — `true`/`false`/`null`/空字符串/数字自动转换
- **`mindos sync` 子命令校验** — 未知子命令报错 + 显示可用列表
- **setup 配置确认** — `mindos onboard` 写入前展示配置摘要，Y/n 确认
- **统一 debug 模块** — `bin/lib/debug.js`，`MINDOS_DEBUG=1` 或 `--verbose` 启用
- **deps 增量检测** — `ensureAppDeps` 基于 `package-lock.json` hash 判断
- **MCP/Skills API** — `/api/mcp/*` + `/api/skills` 端点
- **FindInPage** — 文件视图内 `⌘F` 搜索高亮
- **UpdateBanner** — GUI 更新提示横幅

### 变更
- **新增 renderer = 新建目录 + manifest.ts**，零侵入已有文件
- 启动信息精简，移除冗长 MCP JSON block
- `pkill` 精确化，优先 `lsof -ti :PORT`
- `run()` exit code 透传
- NO_COLOR / FORCE_COLOR 遵循 CLI 标准

---

## v0.3.0 — CLI/GUI Setup 分离 + 浏览器引导 (2026-03-14)

### 新增
- **SyncStatusBar** — 侧栏底部常驻同步状态条（状态圆点 + 文字 + Sync Now 按钮）
- **SyncDot / MobileSyncDot** — 折叠侧栏和移动端的同步状态指示
- **Settings → Sync 空状态引导** — 未配置同步时展示 3 步设置教程 + 特性清单
- **Onboarding 同步提示** — 新用户引导页底部增加 `mindos sync init` 提示卡片
- **CLI onboard sync 步骤** — `mindos onboard` 完成后询问是否配置 Git 同步
- **`mindos doctor` sync 检查** — 健康检查新增第 8 项：同步状态诊断
- **启动时打印 sync 状态** — `mindos start/dev` 启动信息中展示同步状态行
- **同步恢复 toast** — 从 error/conflicts 恢复为 synced 时自动弹出提示
- **sync-status 测试** — 17 个测试覆盖 `timeAgo` 和 `getStatusLevel`
- **PWA 支持** — manifest.json、Service Worker、应用图标
- **`/api/init` 端点** — Onboarding 模板初始化 API
- i18n：新增 `sidebar.sync`、`settings.sync`、`onboarding.syncHint` 词条（en + zh）

### 变更
- `SyncTab` 导出 `SyncStatus` 接口和 `timeAgo()` 供 SyncStatusBar 复用
- `SyncTab` 冲突列表增加可点击文件链接 + 远程版本查看入口
- `SettingsModal` 支持 `initialTab` prop，侧栏点击可直接跳转 Sync tab
- `Sidebar` 集成 `useSyncStatus` 共享轮询 hook
- wiki/ 目录从自由命名重组为编号命名（00-xx）

### 修复
- `useTick` 回调变量名 `t` → `n`，避免与 `useLocale` 的 `t` 混淆
- `useSyncStatus` 的 `stop()` 补充 `intervalRef.current = undefined` 清理
- `mindos doctor` sync 检查增加 try/catch 防止 `getSyncStatus` 异常导致崩溃

---

## v0.2 — CLI 模块化 + 组件拆分 + Git 同步 (2026-03-14)

### 新增
- `mindos sync` — Git 自动同步（init/status/now/on/off/conflicts）
- `mindos open` — 一键浏览器打开 Web UI
- `mindos token` 增强 — 多 Agent 配置输出
- Settings → Sync Tab — Web UI 同步管理面板
- `/api/sync` REST API

### 变更
- `bin/cli.js` 从 1219 行拆分为 13 个 lib 模块 + 主入口 (~742 行)
- `CsvRenderer` 从 693 行拆分为 68 行 + 6 子文件
- `SettingsModal` 从 588 行拆分为 182 行 + 8 子文件
- `scripts/setup.js` 新增 Step 7 启动方式选择（daemon/foreground）

### 修复
- MCP CLI 4-bug 链修复（npm global install + 命令路由 + -y 交互 + args 解析）
- `.next` 清理改为完整目录清理，防 stale artifact

---

## v0.1.9 — 构建修复 (2026-03-14)

### 修复
- clean 整个 .next 目录防止 stale artifact 错误

---

## v0.1.8 — 营销素材 + CI (2026-03-13)

### 新增
- Landing Page 更新
- Marketing 素材
- CI workflow 优化

### 变更
- CLI 初步模块化拆分（bin/lib/ 结构建立）
