<!-- Last verified: 2026-03-22 | Current stage: P1 -->

# 踩坑记录 (Known Pitfalls)

## Desktop / 打包

### 首次本地模式白屏（无/空 config + 未进 /setup）
- **现象：** 选「本地模式」后主窗口全白；`~/.mindos/config.json` 不存在，或存在但为空/坏 JSON/缺 `desktopMode`
- **原因：** 旧逻辑用 `isFirstRun && !existsSync` 决定是否打开 `/setup?force=1`；`saveDesktopMode` 只写了 `desktopMode` 未设 `setupPending`，与 Next 侧 `readSettings` 不一致；若 `config.json` 已存在但无效，会跳过模式选择并直接加载 `/`，易与空知识库/首启状态叠加为白屏
- **解决：** `needsDesktopModeSelectAtLaunch()` 覆盖空/坏文件；首次选本地且尚无 `mindRoot` 时写入 `setupPending: true`；`resolveLocalMindOsBrowseUrl()` 在 **`setupPending` 或配置里尚无 `mindRoot`/`sopRoot`** 时打开 `/setup?force=1`（与 Next `readSettings` 的 `mindRoot ?? sopRoot` 一致）；**重启服务 / 更新后恢复** 用 `loadURL(resolve…)` 代替裸 `reload()`，避免仍停在白屏页

### Next 生产进程绑定机器 hostname，`127.0.0.1` 健康检查永远超时
- **现象：** Desktop 或 `verify-standalone` 等不到 `/api/health`，但本机 `curl http://$(hostname):PORT/api/health` 有响应
- **原因：** Next 默认把监听地址设成 **系统 hostname**，未监听 loopback
- **解决：** 未显式设置 `HOSTNAME` 时，Desktop `ProcessManager` 与 CLI `mindos start`（`next start`）注入 `HOSTNAME=127.0.0.1`；需要对外监听时用户自行 export `HOSTNAME=0.0.0.0`

### `prepare-mindos-runtime` 把 `.next/dev` 打进安装包 → 体积暴涨
- **现象：** Desktop 内置 `mindos-runtime/app` 数百 MB，其中 `.next/dev` 占大头
- **原因：** Turbopack/开发会话会在 `app/.next/dev` 留下缓存；整目录拷贝 `app/.next` 时会一并带上
- **解决：** `copyAppForBundledRuntime` 排除 `.next/dev`（与 `.next/cache` 同理）；生产启动走 `standalone/server.js`，不依赖该目录

## CLI

### npm 全局安装缺 node_modules
- **现象：** `mindos mcp -g -y` → `ERR_MODULE_NOT_FOUND`
- **原因：** npm global install 不包含 devDependencies 和被 `.npmignore`/`files` 排除的目录
- **解决：** `spawnMcp()` 改为使用正确路径 + MCP 命令加 first-run auto-install (`ensureAppDeps()`)

### MCP CLI 命令路由 4-bug 链
- **现象：** 一个 `ERR_MODULE_NOT_FOUND` 背后串联 4 个 bug
- **Bug 链：** (1) node_modules 缺失 → (2) `process.argv[3]` 是 `-g` 不是 `install`，路由到 MCP server → (3) `-y` 跳过了 agent 选择（应强制弹出）→ (4) args 解析起始位置基于 sub 不同而不同
- **教训：** 用户报一个症状，沿调用链至少查 3 层

### cleanNextDir() 必须清理完整 .next
- **现象：** 构建缓存导致 stale artifact 错误
- **解决：** 清理整个 `.next` 目录，不做选择性清理

### npx next 会拉全局缓存版本导致 Web UI 崩溃
- **现象：** `mindos start` 后 Web UI 立即崩溃，报 `TypeError: Cannot read properties of undefined (reading 'map')`
- **原因：** `npx next start` 不保证用本地 `node_modules` 的版本。如果用户全局 npx 缓存里有更高版本的 Next.js（如 16.2.0），而 build 产物是本地 16.1.6 编译的，版本不匹配导致运行时崩溃
- **解决：** `bin/cli.js` 中定义 `NEXT_BIN = resolve(ROOT, 'app', 'node_modules', '.bin', 'next')`，所有调用直接用绝对路径，彻底绕开 npx/npm exec 的解析逻辑
- **注意：** `npm exec -- next` 和 `npx next` 在 npm 7+ 中本质是同一个东西（npx 是 npm exec 的别名），解析逻辑相同，都不可靠。直接引用 `.bin/next` 是唯一确定的方式
- **防护：** 无自动化测试可覆盖此问题（依赖用户环境），靠此记录防止回归

## 前端

### Emoji Hydration Mismatch（Twemoji 浏览器扩展）
- **现象：** SSR 渲染的 emoji 文本（如 `🎯`、`🚀`）在客户端被 Twemoji 等浏览器扩展替换为 `<img>` 元素，触发 React hydration error：`Hydration failed because the server rendered text didn't match the client`
- **原因：** 浏览器扩展在 React hydration 之前修改 DOM，将 emoji 文本节点替换为 `<img src="...twemoji...">`，导致 SSR HTML 与客户端 DOM 不一致
- **已踩坑位置：** HomeContent.tsx Space 卡片描述（v1）、DiscoverPanel.tsx Section icon（v2）、UseCaseCard.tsx emoji icon
- **解决：** 所有包含 emoji 的 `<span>` 必须加 `suppressHydrationWarning`
- **规则：** 凡是 JSX 中直接渲染 emoji 字符的元素，**一律加 `suppressHydrationWarning`**。新增 emoji 渲染时必须检查此规则，不要等报错再修
- **检查方法：** `grep -rn 'emoji\|📝\|🎯\|🚀\|👤\|📥\|🔄\|🔁\|💡\|🤝\|🛡️\|🧩\|⚡\|🧠\|🕐' --include='*.tsx' | grep -v suppressHydrationWarning`

### AskPanel/SettingsPanel 与 Modal 版本代码重复 ✅ 已解决
- **现象：** `panels/AskPanel.tsx` 与 `AskModal.tsx` 约 80% 逻辑重复
- **解决：** 提取 `ask/AskContent.tsx` 和 `settings/SettingsContent.tsx` 共享核心组件。AskModal/AskPanel、SettingsModal/SettingsPanel 各缩减为 ~20 行 thin wrapper。`variant: 'modal' | 'panel'` 控制差异（ESC handler、close 按钮、abort-on-close、尺寸微调）
- **规则：** 修改 Ask/Settings 逻辑时只改 Content 组件，wrapper 不含业务逻辑

### Logo SVG 组件重复 ✅ 已解决
- **现象：** Logo SVG 在多个文件中重复定义
- **解决：** 提取到 `components/Logo.tsx`，接收 `id`（gradient ID 唯一化）和 `className` props。ActivityBar 用 `id="rail"`，移动端 Header 用 `id="mobile"`，Drawer 用 `id="drawer"`

### 组件拆分时 import 路径
- **现象：** barrel export 后其他文件 import 路径需要更新
- **解决：** 拆分后全局 grep 旧 import 路径并替换

### encodePath vs encodeURIComponent
- **现象：** `not-found.tsx` 用 `encodeURIComponent()` 编码文件路径，导致 `/` 被编码为 `%2F`，路由 404
- **解决：** 使用 `encodePath()`（按 `/` 分割后逐段编码），不要用 `encodeURIComponent`
- **规则：** 凡是文件路径拼接到 URL 的场景，一律用 `encodePath()`

### 插件开关（raw/plugin toggle）全局污染
- **现象：** 在 `.agent-log.json` 上点击插件按钮切到 raw 视图 → 所有文件都变 raw（md 不显示 wiki graph，csv 不显示表格插件）
- **原因：** `mindos-use-raw` 在 localStorage 里存的是全局 boolean，一个文件切换影响所有文件
- **解决：** 统一为 `useRendererState` hook（`lib/renderers/useRendererState.ts`），per-file 持久化状态，key 格式 `mindos-renderer:{rendererId}:{filePath}`，CSV config 同步迁移
- **文件：** `app/app/view/[...path]/ViewPageClient.tsx`、`app/components/renderers/csv/CsvRenderer.tsx`

### useSyncExternalStore + JSON.parse 无限重渲染
- **现象：** `useSyncExternalStore` 的 `getSnapshot` 每次调用 `JSON.parse` 返回新对象引用 → `Object.is` 永远 false → 对象类型 state（如 CsvConfig）触发无限重渲染
- **原因：** 原始值（boolean、number）不受影响，但对象/数组每次 parse 产生新引用
- **解决：** `useRendererState` 内部用 `cacheRef` 缓存上次 raw string，只在值实际变化时重新 parse；`setState` 同步更新 cache 避免 stale ref
- **规则：** 凡是 `useSyncExternalStore` + localStorage 存对象，必须做 snapshot 缓存

### inline fontFamily 反模式
- **现象：** 8+ 组件用 `style={{ fontFamily: "IBM Plex Mono..." }}`，绕过 Next.js 字体优化
- **解决：** 统一用 `.font-display` 工具类（定义在 `globals.css`）
- **规则：** 新组件禁止 inline fontFamily，全部走 CSS class

### 硬编码状态色 — 用 CSS 变量管理
- **现象：** `#7aad80`（success）和 `#c85050`（error）在 20+ 文件中硬编码，暗色模式无法单独调整；`#ef4444`（Tailwind red-500）和 `#c85050` 两种红混用，视觉不一致
- **解决：** globals.css 定义 `--success` / `--error` 变量（:root + .dark），Tailwind `@theme inline` 注册 `--color-success` / `--color-error`。TSX 中 inline style 用 `var(--success)` / `var(--error)`，Tailwind class 用 `text-success` / `text-error`
- **规则：** 新增语义色值必须先在 globals.css 定义变量 + 文档化到 `03-design-principle.md`，禁止直接写 hex 值

### focus ring 用 focus-visible 而非 focus
- **现象：** 部分自定义 input 用 `focus:ring-1`，鼠标点击也触发 ring，视觉噪音
- **解决：** 统一改为 `focus-visible:ring-1 focus-visible:ring-ring`；`--ring` 变量改为 `var(--amber)` 与设计规范一致
- **规则：** 新组件的 focus 样式一律用 `focus-visible:` 前缀，不要用 `focus:`

### FileTree 蓝色 focus border 偏离设计系统
- **现象：** FileTree 的 rename/create input 用 `border-blue-500/60`，与全局 amber focus ring 不一致
- **解决：** 改为 `focus-visible:ring-1 focus-visible:ring-ring`（继承 amber）
- **规则：** 任何 focus 指示色都走 `ring-ring`（即 `--amber`），不要用 Tailwind 默认色

### Google Fonts 不要随意删除
- **现象：** 以为 5 个字体太多想精简到 3 个，实际审计发现 15+ 文件引用了全部 5 个
- **解决：** 只删除未使用的 weight（如 IBM Plex Sans 的 300、IBM Plex Mono 的 500），不删整个字体
- **教训：** 精简前先全局 grep 确认引用

### Sidebar 文件目录不更新（创建/删除/重命名后）
- **现象：** 在 sidebar 创建、删除、重命名文件后，文件树不更新；MCP agent 在后台操作文件后更不更新
- **原因：** 三层问题叠加：
  1. Next.js client-side Router Cache 默认 30s，`router.refresh()` 可能拿到 stale 的 RSC payload
  2. `/api/file` route（MCP 调用路径）的写操作没有调用 `revalidatePath('/', 'layout')`，服务端 router cache 不失效
  3. 没有任何客户端主动刷新机制（visibilitychange / 定时轮询），外部变更无法被感知
- **解决：**
  1. `next.config.ts` 加 `experimental.staleTimes.dynamic = 0`，禁用 dynamic 路由的客户端 router cache
  2. `/api/file` route 的 tree-changing ops（create/delete/rename/move）加 `revalidatePath('/', 'layout')`
  3. `Sidebar.tsx` 加 `visibilitychange` 监听 + 30s 定时 `router.refresh()`
- **注意：** `export const dynamic = 'force-dynamic'` 只对 page/route 有效，对 layout.tsx 无效
- **规则：** 凡是新增文件写操作的 API route，必须调用 `revalidatePath('/', 'layout')` 来通知 layout 刷新 file tree

## MCP

### JSONC 配置文件导致 Agent 安装失败
- **现象：** Cursor Agent 安装时报 `SyntaxError: Unexpected token '/', "// { // "... is not valid JSON`
- **原因：** Cursor、Windsurf、Cline 等 VS Code 系编辑器的 MCP 配置文件是 JSONC 格式（允许 `//` 单行注释和 `/* */` 块注释），但代码用 `JSON.parse()` 解析，遇到注释直接崩
- **影响范围：** 6 处读取 Agent 配置文件的位置（`mcp-agents.ts` 检测、`install/route.ts` GUI 安装、`mcp-install.js` CLI 安装 ×2、`setup.js` onboard ×2）
- **解决：** 新增 `parseJsonc()` 工具函数，用正则先剥离注释再 `JSON.parse()`。正则 `/"(?:\\"|[^"])*"|(\/\/.*$)/gm` 确保不误伤字符串内的 `//`
- **规则：** 凡是读取第三方编辑器配置文件的地方，一律用 `parseJsonc()` 而非 `JSON.parse()`。VS Code 生态的配置文件默认是 JSONC，不是严格 JSON
- **文件：** `app/lib/mcp-agents.ts`、`app/app/api/mcp/install/route.ts`、`bin/lib/mcp-install.js`、`bin/lib/utils.js`、`scripts/setup.js`

### Codex TOML 配置解析失败
- **现象：** 配置代理时 trae 和 Claude Code 正常工作，codex 报 `SyntaxError: Unexpected token 'm', "model = "g"... is not valid JSON`
- **原因：** codex 的配置文件是 TOML 格式（`~/.codex/config.toml`），但 `detectInstalled()` 函数对所有 agent 都使用 `JSON.parse()` 解析，导致 TOML 内容解析失败
- **解决：** 在 `detectInstalled()` 中增加 `agent.format === 'toml'` 的判断分支，使用逐行扫描方式解析 TOML 文件中的 MCP 服务器配置；新增 `parseTomlMcpEntry()` 辅助函数处理 TOML 格式
- **代码：** [app/lib/mcp-agents.ts](file:///data/home/geminitwang/code/mindos/app/lib/mcp-agents.ts)
- **规则：** 新增 agent 时必须考虑其配置文件格式（JSON/TOML/JSONC），所有解析逻辑需要按格式分别处理

### INSTRUCTION.md 写保护
- **现象：** Agent 通过 MCP 误修改了系统内核文件
- **解决：** `isRootProtected()` + `assertNotProtected()` 硬编码保护

### 搜索索引失效必须与文件缓存联动
- **现象：** 写操作后搜索结果过时（索引未失效）
- **规则：** 所有文件写操作都通过 `lib/fs.ts` 的 `invalidateCache()` 触发，该函数同时清除文件树缓存、Fuse.js 搜索缓存和 Core 倒排索引。新增写操作入口必须调用 `invalidateCache()`，不能只清部分缓存

### 字符截断
- **现象：** 大文件读取超过 LLM context
- **解决：** 单文件读取上限 25,000 字符 + `truncate()` 工具函数

## Agent (Ask Modal)

### 跳过 spec 直接写代码 — 流程违规
- **现象：** Phase 1（7 工具 + UIMessageStream）从 plan 直接跳到执行，跳过 spec + spec review
- **后果：** 没有验收标准就动手，连续多轮 code review 才逐步发现 React state mutation、setState 频率过高、多轮 tool 历史丢失等问题——本应在 spec 阶段就识别为边界条件
- **根因：** 把 roadmap plan（战略级）当成了 spec（执行级）。Plan 描述方向，spec 描述变更范围、文件清单、接口设计、验收标准
- **规则：** 每个 phase/任务执行前必须先写 spec（`wiki/specs/`），等用户确认后再动手。**Spec ≠ Plan**

### React state mutation — stream consumer 浅拷贝
- **现象：** `buildMessage()` 返回的 parts 与 mutable working copies 共享引用，后续 `part.text += delta` 篡改了已在 React state 中的对象
- **解决：** `buildMessage()` 深拷贝每个 part：TextPart 用 `{ type: 'text', text: p.text }`，ToolCallPart 用 `{ ...p }`（`input` 是替换而非修改，浅拷贝安全）
- **规则：** 任何流式更新组装对象传给 React setState 前，必须断开与 mutable 源的引用

### setState 频率过高 — 每条 SSE line 触发一次
- **现象：** 单次 `reader.read()` 可能包含多条 SSE line，每条都调用 `onUpdate(buildMessage())` 触发 React 重渲染
- **解决：** 用 `changed` flag，每个 `reader.read()` 批次只在循环结束后触发一次 `onUpdate`
- **规则：** 流式解析中 setState 应按 I/O 批次聚合，不按解析单元

### 多轮对话 tool 历史丢失
- **现象：** 前端发送 `Message[]`（`{role, content, parts?}`），但 AI SDK 的 `streamText()` 期望 `ModelMessage[]`，其中 tool calls 需拆为 assistant message + tool message。直接透传导致 AI 在后续轮次不知道之前执行了什么工具
- **解决：** 后端新增 `convertToModelMessages()` 转换函数：assistant parts 拆为 `{role: 'assistant', content: [TextPart, ToolCallPart]}`（不含 output）+ `{role: 'tool', content: [ToolResultPart]}`
- **规则：** 前端 Message 格式与 AI SDK ModelMessage 格式不同，跨边界传递时必须转换
- **文件：** `app/app/api/ask/route.ts`

### Abort 后只检查 content 不检查 parts
- **现象：** 用户中断时，代码只检查 `!content.trim()` 判断消息是否为空。但 UIMessageStream 下消息可能有 tool call parts 但空 text content
- **解决：** 改为 `const hasContent = last.content.trim() || (last.parts && last.parts.length > 0)`
- **规则：** UIMessageStream 后判断消息"是否有内容"必须同时检查 `content` 和 `parts`

### pi-agent-core 迁移：AgentEvent 类型不完整
- **现象：** `subscribe()` 回调的 `AgentEvent` 是 union type，但 `message_update` 等变体的子字段（如 `assistantMessageEvent`）没有在 TS 类型中导出
- **解决：** 写 type guard 函数（`isTextDeltaEvent()` 等），内部用 `as any` 访问，但使用侧完全类型安全。`as any` 只出现在 guard 内部，不扩散
- **规则：** 第三方库类型不完整时，用 type guard 隔离 `as any`，不要在业务逻辑中直接 cast

### pi-agent-core 迁移：compact 失败不能静默返回

### pi-ai `getModel()` 返回 undefined 而非 throw — Agent 静默无输出
- **现象：** Ask AI 发消息后无任何回复，前端提示 "No response from AI"。服务端日志只有 `Step 1/N` 无 text_delta
- **原因：** `piGetModel('openai', 'claude-sonnet-4-6')` 对不在 registry 中的模型名**返回 `undefined`**，不抛异常。`try { model = piGetModel(...) } catch { /* fallback */ }` 不会进 catch，`model` 变为 `undefined`。后续 `{ ...undefined, api: 'openai-completions' }` 产生残缺对象（缺 `id`/`baseUrl`/`name` 等），pi-ai 的 `detectCompat()` 对 `undefined.includes()` 报错，被 lazy load 的 catch 静默吞掉，agent-loop 收到 `stopReason: "error"` 但不 emit 任何 text 事件
- **解决：** `piGetModel()` 返回后检查 `if (!resolved) throw new Error('Model not in registry')`，强制走 fallback 手工构造 model 对象
- **规则：** 调用第三方库函数时，不要假设"失败一定 throw"。检查返回值是否为 `undefined`/`null`，防御性处理
- **文件：** `app/lib/agent/model.ts`

### pi-ai openai-completions compat 配置 — 自定义代理必须设 compat flags
- **现象：** 配了 OpenAI 兼容代理（baseUrl），Agent 请求到达代理但因参数不兼容返回空
- **原因：** pi-ai 的 `openai-completions` provider 默认启用 `store: false`、`developer` role、`max_completion_tokens`、`stream_options` 等，多数代理不支持
- **解决：** `model.ts` 检测 `hasCustomBase` 时自动设保守 compat：`supportsStore: false, supportsDeveloperRole: false, supportsUsageInStreaming: false, maxTokensField: 'max_tokens'`
- **规则：** 自定义 OpenAI 代理默认走最保守兼容配置。只有标准 `api.openai.com` 才用完整特性
- **文件：** `app/lib/agent/model.ts`

### pi-ai openai-completions vs openai-responses — 代理 API 选择
- **现象：** 配了 OpenAI 兼容代理，Agent 请求 `/responses` 端点被 403 拒绝
- **原因：** pi-ai 默认用 `openai-responses` API（请求 `/responses`），多数代理只支持 `/chat/completions`
- **解决：** `model.ts` 检测 `hasCustomBase` 时默认用 `openai-completions`（对应 `/chat/completions`）
- **规则：** 有自定义 baseUrl → `openai-completions`；无 baseUrl（直连 OpenAI）→ `openai-responses`
- **文件：** `app/lib/agent/model.ts`

### pi-agent-core 迁移：compact 失败不能静默返回
- **现象：** `compactMessages()` 调用 `complete()` 失败时直接返回未压缩的消息。如果上下文已超 70%，后续调用大概率超 token limit → 不可预测行为
- **解决：** 失败时 fallback 到 `hardPrune()`，pruning 也失败才 throw
- **规则：** 上下文管理的 error path 必须保证出口 token 数 ≤ limit。不能"原样返回"——原样可能就是超限的

### pi-agent-core 迁移：AssistantMessage.usage 字段结构变化
- **现象：** 构造历史 AssistantMessage 时 `usage` 字段需要包含 `totalTokens` 和 `cost` 子对象，否则 TS 报错
- **解决：** 补全所有必需字段：`{ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }`
- **规则：** 构造 pi-ai Message 对象时，即使是历史占位消息，也必须满足完整类型签名。用 `satisfies` 约束

### pi-agent-core 迁移：ToolCall 字段名与 AI SDK 不同
- **现象：** AI SDK 用 `toolCallId` / `toolName` / `input`，pi-agent-core 用 `id` / `name` / `arguments`
- **解决：** `toAgentMessages()` 中做字段映射（`type: 'toolCall', id: part.toolCallId, name: part.toolName, arguments: part.input`）
- **规则：** 跨 SDK 迁移时逐字段对比类型定义，不要假设字段名相同

## 进程生命周期

### stopMindos 只清理 config 端口，漏掉旧端口
- **现象：** GUI 改端口后 restart，旧 MCP 进程存活，新服务报 "Port already in use"
- **原因：** `stopMindos()` 从 config 文件读端口，但 config 在 `/api/setup` 时已写入新端口；旧进程实际运行在旧端口，port cleanup 打空
- **解决：** `stopMindos()` 新增 `opts.extraPorts`；`/api/restart` 通过 `MINDOS_OLD_*` env 传递旧端口；`cli.js restart` 对比新旧差异自动传入
- **教训：** 多步状态变更（config 写入 → 进程 stop → 进程 start）之间，数据来源必须区分"运行态"和"配置态"

### /api/restart 环境变量继承导致新端口不生效
- **现象：** GUI 改端口后 restart，服务仍在旧端口启动
- **原因：** `spawn` 传 `process.env` 给子进程，`loadConfig()` 的 `set()` 策略是"已有则不覆盖" → 旧 env 值屏蔽了 config 文件的新值
- **解决：** spawn 前删除 `MINDOS_WEB_PORT` 等 env vars，让子进程 `loadConfig()` 从文件读新值
- **教训：** 子进程继承父进程 env 时，如果有"配置加载跳过已有 env"逻辑，必须主动清理过时的 env vars

### PID 文件只记录主进程，工人进程残留
- **现象：** `mindos stop` 后端口仍被占用
- **原因：** `savePids()` 只存主进程 PID + MCP PID，Next.js 工人进程（独立 PID）不在文件中
- **解决：** (1) `killTree(-pid)` 杀整个进程组 (2) 端口清理 ALWAYS 运行，不因有 PID 文件就跳过
- **教训：** PID 文件不可靠（只是部分快照），必须有端口清理兜底

### lsof 环境差异 + ss 端口子串误匹配
- **现象：** `lsof -ti :PORT` 在某些环境返回 exit 1（权限问题）；`ss` 输出 `:3003` 误匹配 `:30030`
- **解决：** lsof 失败后 fallback 到 `ss -tlnp`；端口匹配用正则 `/:PORT(?!\d)/` 防子串
- **教训：** 系统工具的可用性不能假设统一，关键路径必须有 fallback

### restart 用固定 sleep 等端口释放不可靠
- **现象：** 1.5s sleep 后端口尚未释放，`assertPortFree` 失败
- **解决：** 改为 polling `isPortInUse()` + 15s deadline
- **教训：** 异步资源释放用轮询确认，不用固定 delay

### launchd KeepAlive=true 导致多种无限重启循环
- **现象：** (1) daemon 启动时端口未释放 → `assertPortFree` exit(1) → KeepAlive 立即重启 → 无限循环 (2) build 失败 → exit(1) → 立即重启 → 日志暴涨 (3) `mindos start --daemon` 的 install+start 同时执行，install(bootstrap+RunAtLoad) 已启动，start(kickstart -k) 杀进程导致端口冲突
- **原因：** `KeepAlive=true` 是无条件重启，任何 exit 立即重启，无间隔。与 `assertPortFree` 的 `process.exit(1)` 组合形成快速循环
- **解决：** 4 个改动：(1) plist 的 `KeepAlive` 改为 `<dict><key>SuccessfulExit</key><false/></dict>`（只在非正常退出时重启）+ `ThrottleInterval=5`（至少 5 秒间隔） (2) plist 注入 `LAUNCHED_BY_LAUNCHD=1` 环境变量，cli.js 在 daemon 模式下用 `waitForPortFree`（等 30s）替代 `assertPortFree`（立即退出） (3) `mindos start --daemon` 移除多余的 `runGatewayCommand('start')`（install 已通过 bootstrap+RunAtLoad 启动） (4) build 失败的无限重启被 ThrottleInterval 自然节流
- **教训：** launchd 的 `KeepAlive=true` 等效于"无条件无延迟重启"，任何可能失败的服务都不应使用。正确方式是 `SuccessfulExit=false`（等效 systemd 的 `Restart=on-failure`）+ `ThrottleInterval`
- **文件：** `bin/lib/gateway.js`、`bin/cli.js`

### update 命令 launchctl bootout 不等端口释放
- **现象：** `mindos update` 在 macOS 上 stop → install → start，新服务报 "Port already in use" 并无限循环重试
- **原因：** `launchctl bootout` 是异步的——发信号给进程但不等进程退出，端口在 bootout 返回后仍被旧进程占用。与 `systemctl --user stop`（同步等待）行为不同
- **解决：** `launchd.stop()` 改为 async，bootout 后 polling `isPortInUse()` 等端口释放（30 次 × 500ms = 15s deadline），超时则 fallback 到 `stopMindos()` 强制 kill
- **教训：** macOS launchctl 和 Linux systemctl 的 stop 语义不同，macOS 需要额外的端口释放等待
- **文件：** `bin/lib/gateway.js`

### onboard GUI 模式端口冲突 + env 不匹配
- **现象：** `mindos onboard` 选 GUI，旧 MindOS 半死（端口占着但 `/api/health` 无响应），新服务报 "Port already in use" 无限循环
- **原因（两个 bug）：** (1) `startGuiSetup()` 传 `env.PORT` 给 spawn 的 start 进程，但 `loadConfig()` 设的是 `MINDOS_WEB_PORT`，`PORT` 被忽略，临时端口白分配 (2) 端口被旧进程占着时直接换临时端口，不尝试清理旧进程
- **解决：** (1) spawn env 改传 `MINDOS_WEB_PORT` 而非 `PORT` (2) 端口被占时先调 `stopMindos()` 清理旧进程 + `waitForPortFree()` 等释放，失败才 fallback 到临时端口
- **教训：** env 变量名必须与消费侧严格匹配；端口冲突时优先清理而非回避
- **文件：** `scripts/setup.js`

### /api/health 被 middleware auth 拦截
- **现象：** re-onboard 时 `isSelfPort()` 调 `/api/health` 被 401 → 误报 "Port already in use"
- **原因：** server-to-self HTTP 请求没有 `Sec-Fetch-Site: same-origin` header，也没有 auth token
- **解决：** `proxy.ts` 豁免 `/api/health` 和 `/api/auth`
- **教训：** 健康检查端点必须无认证，否则内部自检会失败

### check-port 自回环 fetch 超时导致误报"端口占用"
- **现象：** 在 `http://localhost:3013/setup` 上 onboard 时，webPort 输入 3013 提示"已被占用"
- **原因：** `check-port` API 检测端口占用后，通过 `fetch('http://127.0.0.1:3013/api/health')` 回环请求自身判断 isSelf。Next.js 单线程模式下，当前请求未结束时发出的新请求被队列阻塞，800ms 超时 → `isSelfPort` 返回 false → 把自己的端口报为"已被占用"
- **解决：** 从 `req.nextUrl.port` 直接获取当前监听端口，检测相同端口时直接返回 `{available: true, isSelf: true}`，跳过网络自回环。HTTP 回环保留为后备逻辑
- **注意：** 只信任 `req.nextUrl.port`（实际监听的端口），不从 settings 读配置端口——settings 里是"配置值"不是"监听值"（首次 onboard 时 MCP 端口可能未启动，误标为 self 会掩盖真实冲突）
- **教训：** 服务端 self-detection 不要依赖网络自回环（可能死锁/超时），优先用进程内信息（request context）判断
- **文件：** `app/app/api/setup/check-port/route.ts`

### setup.js 与 port.js 的 isPortInUse timeout 行为不一致
- **现象：** `scripts/setup.js` 和 `bin/lib/port.js` 各有一份 `isPortInUse`，timeout 返回值相反
- **差异：** setup.js `sock.setTimeout → cleanup(true)` vs port.js `sock.setTimeout → cleanup(false)`
- **影响：** setup.js 在极端慢响应（localhost 几乎不触发）时误判端口被占，导致不必要地切换到临时端口
- **解决：** 统一为 `cleanup(false)`（localhost timeout = 无人监听 = 端口空闲）
- **教训：** 同一功能的两份实现必须行为一致，或者只保留一份、另一处 import 复用
- **文件：** `scripts/setup.js`、`bin/lib/port.js`

## 构建 / 部署

### Skill 安装 process.cwd() 路径错误
- **现象：** GUI Setup Wizard 安装 Skill 提示失败，CLI 正常
- **原因：** API route 用 `path.resolve(process.cwd(), 'skills')` 定位 skills 目录，但 Next.js 的 `process.cwd()` 是 `app/`，解析到 `app/skills/`（不存在）。CLI 用 `__dirname` 相对定位所以没问题
- **解决：** 改为 GitHub 源优先（`npx skills add GeminiLight/MindOS --skill mindos`），本地路径作为离线 fallback（搜索 `app/data/skills/` 和 `../skills/`）
- **教训：** Next.js API route 里 `process.cwd()` 不等于项目根目录，定位文件用 GitHub 源或 `__dirname` 相对路径，不要依赖 cwd
- **文件：** `app/api/mcp/install-skill/route.ts`、`scripts/setup.js`

### Skill 安装多 agent 逗号分隔无效
- **现象：** 选多个 agent 安装 Skill 时，`skills` CLI 报 "Invalid agents: claude-code,windsurf"
- **原因：** `buildCommand` 用 `agents.join(',')` 拼成 `-a claude-code,windsurf`，但 `skills` CLI 不支持逗号分隔，每个 agent 需要独立的 `-a` flag
- **解决：** 改为 `agents.map(a => \`-a ${a}\`).join(' ')`，生成 `-a claude-code -a windsurf`
- **教训：** CLI 工具的多值参数格式不要想当然，先用 `--help` 或实际测试确认
- **文件：** `app/api/mcp/install-skill/route.ts`、`scripts/setup.js`
- **现象：** 新增的顶层目录未被同步到公开仓
- **解决：** `.github/workflows/sync-to-mindos.yml` 中 rsync 目录列表需要手动维护

### npm install 后 next build 报 MODULE_NOT_FOUND
- **现象：** 全局安装后 `mindos start`，`npm install` 报 336 个 `TAR_ENTRY_ERROR ENOENT`，随后 `next build` 报 `Cannot find module '@next/env'`
- **原因：** npm 在深层全局路径下并发解压 tar 时存在竞争条件（目录未创建完，文件就写入），导致大量文件丢失。Node v23.9.0（非 LTS 奇数版本）加剧了此问题
- **解决：** `ensureAppDeps()` 新增安装后验证 + 自动重试：定义 `CRITICAL_DEPS`（next、@next/env、react、react-dom），安装后逐一检查 `package.json` 是否存在，缺失则删 `node_modules` 重新 `npm install`
- **教训：** `npm install` 报 `added N packages` 不代表所有文件完整解压，关键依赖必须验证
- **文件：** `bin/lib/build.js`

### 预编译 .next/ 进 npm 包 — 已评估放弃
- **动机：** `npm update` 后首次启动需 ~12s `next build`，想预编译消除等待
- **可行性结论：** 技术上可行（`next start` 不依赖硬编码路径，包体 9.9→15MB），但 **ROI 为负**
- **放弃原因：** (1) 12s 延迟只在版本更新后首次启动触发，频率极低 (2) 所有用户每次 `npm install` 都多下载 5MB，总成本远高于偶发的 12s (3) CI 必须耦合 `next build`，构建失败阻塞发版 (4) 非标准模式，Next.js 升级可能静默破坏 (5) CI 环境变量会 bake 进产物，用户端出诡异 bug
- **当前方案：** 已有 `Building MindOS (first run or new version detected)...` 提示，用户体感可接受，不做额外优化
- **评估日期：** 2026-03-17

### 免交互模式 (-y) 区分可跳过 vs 必须交互
- **现象：** `-y` 全局免交互跳过了 agent 选择（用户必须自己选）
- **解决：** `choose()` 加 `forcePrompt` 参数，必须交互的选项标记 `{ forcePrompt: true }`

### npm 包体积膨胀 — package.json files 排除项遗漏
- **现象：** npm 包从 ~480kB 膨胀到 1.8MB
- **原因：** `package.json` 的 `files` 字段缺少排除项：`assets/images/`（1.2MB 截图）、`mcp/package-lock.json`（58kB）、`app/package-lock.json`（560kB）
- **`app/package-lock.json` 处理：** 原本 `depsHash()` 读 lock 文件做 hash，导致不能排除。改为读 `app/package.json`（几 KB）做 hash——依赖增删改时 package.json 一定变，精度足够
- **教训：** npm 官方建议**不要发布 lock 文件**，lock 只对根项目有意义。如有 build 脚本依赖 lock 文件，应改为依赖 package.json 或预算 hash 写入小文件
- **文件：** `package.json`, `bin/lib/build.js`

## 变更质量 checklist（通用）

### 第三方库返回值必须做 null/undefined 检查（不能只 try-catch）
- **案例：** `pi-ai` 的 `getModel('openai', 'claude-sonnet-4-6')` 对未知模型返回 `undefined`，不抛异常。`try { model = getModel(...) } catch {}` 不进 catch，`model` 变成 `undefined`。后续 `{ ...undefined }` 产生残缺对象，5 层调用链后静默失败，用户只看到 "No response from AI"
- **排查耗时：** ~2 小时。从 API 连通性 → API variant → compat flags → Turbopack bundling → provider 注册 → lazy load → 最终定位到一行 `getModel` 返回值
- **规则：**
  1. 调用第三方库函数后，**同时检查异常和返回值**：`const result = lib.fn(); if (!result) throw new Error(...)`
  2. 对关键路径（LLM 调用、认证、配置加载），失败时必须有**用户可见的错误信息**，不能 resolve 空结果
  3. 引入或升级第三方依赖后，在 `npm run dev` 中做一次**端到端手动验证**（不只是跑单元测试），特别是涉及运行时动态行为的包
- **防御模式：**
  ```typescript
  // ❌ 只靠 try-catch
  try { model = getModel(provider, name); } catch { model = fallback(); }

  // ✅ try-catch + 返回值检查
  try {
    const resolved = getModel(provider, name);
    if (!resolved) throw new Error('not in registry');
    model = resolved;
  } catch { model = fallback(); }
  ```

### 静默失败链条的排查方法
- **现象：** 功能不工作但无报错，日志只有正常流程信息
- **排查步骤：**
  1. 在调用链**最外层**加事件全量打印（确认收到了哪些事件、缺了哪些）
  2. 在关键中间层加 `console.error`（特别是 `.catch` 块和 error event handler）
  3. 对第三方库，**直接 patch `node_modules` 加日志**比猜测快 10 倍——定位后再还原
  4. 不要假设"编译通过 = 运行正常"——Turbopack 编译产物的运行时行为可能与源码不同
- **教训：** 本次 bug 的 5 层静默链：`getModel → undefined` → `spread undefined → 残缺 model` → `detectCompat → .includes() throw` → `lazy load catch → error event` → `agent-loop error case → 空 message_end`。每一层都有"合理的"错误处理，但组合起来就是完全静默

### 加新 UI 分支前，检查旧 UI 是否需要移除
- **案例：** 非空目录新增提示框，但旧的 amber 警告行未移除，用户看到两条重复提示
- **规则：** 加条件分支时，grep 被替代的旧 UI 元素（同一 state 变量驱动的），确认移除或互斥

### 加条件分支后，验证所有状态的初始值
- **案例：** 非空目录条件分支依赖 `template === ''` 做默认跳过，但初始值是 `'en'`，用户不点跳过直接 Next 就合并了
- **规则：** 新分支如果改变了某状态的"期望默认值"，必须在分支生效时主动设置（不能依赖用户手动点击）

### 加禁用状态后，排查所有消费同一状态的 UI 入口
- **案例：** `submitting` 只禁用了 Complete 按钮，StepDots 和 Back 按钮漏了，用户可以在 saving 期间跳走
- **规则：** 加 disabled 逻辑时，grep 所有能触发 `setStep` / 导航的地方，逐一确认守卫

### setState updater 中不要做副作用
- **案例：** `setState(prev => { navigator.clipboard.writeText(prev.authToken); return prev })` — clipboard 写入是副作用，放在 state updater 里违反 React 纯函数约定（React 18 严格模式下 updater 可能执行两次）
- **解决：** 用 ref 或直接从 state 读值后在外层执行副作用
- **规则：** `setState(fn)` 的 fn 只做纯计算，不触发 I/O / DOM / 网络

### `.catch(() => {})` 静默吞错误
- **案例：** SetupWizard 初始化阶段 token 生成和 agent 加载的 3 处 `.catch(() => {})` 完全静默，导致后续状态异常时难以排查
- **规则：** 至少 `console.warn`，或设置 error state 给用户反馈。可以降级处理但不能完全无视

### autocomplete effect 在 programmatic setState 后重触发
- **案例：** StepKB `selectSuggestion()` 调用 `update('mindRoot', val)` → 触发 autocomplete `useEffect` → `setShowSuggestions(true)` → dropdown 闪回一帧
- **原因：** React state 变更无论来源（用户输入 / 代码调用）都会触发依赖该 state 的 effect
- **解决：** 用 `useRef` flag（`justSelectedRef`）标记"本次变更来自选中"，effect 开头检查并跳过
- **规则：** 当 programmatic setState 会触发不希望的 effect 时，用 ref flag 做一次性跳过，不要用 setTimeout 延迟（竞态不可控）

### disabled prop 对永远不可达的状态值做守卫（dead code）
- **案例：** StepReview retry button `disabled={st.state === 'installing'}`，但 `failedAgents` 的 filter 条件是 `v.state === 'error'`，`installing` 条目根本不会出现在列表中
- **规则：** 加 `disabled` 前先确认 guard 的状态值在当前渲染上下文中是否可达。不可达的 guard 是 dead code，增加阅读负担且暗示错误的心智模型

## 云同步 (Sync)

### Turbopack 无法解析动态 import() 路径变量
- **现象：** `instrumentation.ts` 用 `await import(syncModule)` 加载 sync.js，Next.js 16 (Turbopack) 启动时报 `Cannot find module as expression is too dynamic`
- **原因：** `/* webpackIgnore: true */` 注解只对 webpack 有效，Turbopack 不识别。Turbopack 在编译阶段尝试静态解析 `import(variable)` 表达式，变量路径无法解析
- **解决：** 改用 `createRequire()` + `require()` 绕过 bundler 静态分析：`const req = createRequire(syncModule); const { startSyncDaemon } = req(syncModule);`
- **规则：** 在 Next.js 16+ (Turbopack 默认) 中，动态加载外部 JS 模块（路径在运行时确定）不要用 `import()`，用 `module.createRequire()` 完全绕过 bundler
- **文件：** `app/instrumentation.ts`

### Turbopack 无法 bundle chokidar 等 native 模块
- **现象：** `instrumentation.ts` 直接 `import('../bin/lib/sync.js')` 会被 Turbopack 扫描，chokidar（含 native 绑定）解析失败
- **解决：** (1) `next.config.ts` 添加 `serverExternalPackages: ['chokidar']` (2) 用 `resolve()` 构造绝对路径 + `/* webpackIgnore: true */` 注解绕过 bundler
- **教训：** Next.js instrumentation.ts 中导入含 native 依赖的模块，必须同时做 serverExternalPackages 注册和 bundler ignore

### git credential approve 后再 chmod
- **现象：** `chmod 600 ~/.git-credentials` 在 `git credential approve` 之前执行，文件尚不存在，chmod 无效
- **解决：** 调整顺序：先 `git credential approve`（创建文件），再 `chmod 600`
- **教训：** 涉及文件权限的操作，确认文件已存在再执行

### git rev-list @{u}..HEAD 在无 upstream 时抛异常
- **现象：** 首次 `initSync` 后尚未设置 upstream tracking，`autoPull()` 末尾的 push 重试逻辑执行 `git rev-list --count @{u}..HEAD` 抛异常，错误写入 `sync-state.json`，UI 显示红色错误状态
- **解决：** catch 块改为静默忽略（`// No upstream tracking or push failed`），不写 `lastError`
- **教训：** Git 命令在仓库初始状态下的行为可能与成熟仓库不同（如无 upstream、无 commit 等），关键路径需处理这些边界

### sync.js 全量 execSync → execFileSync 迁移 + credential 静默吞错
- **现象（P0）：** `git config credential.helper` 和 `git credential approve` 失败被空 `catch {}` 吞掉，后续 `git ls-remote` 因无凭证失败报 "Remote not reachable"，用户无从排查是 credential 问题
- **现象（P1 注入）：** `remoteUrl` 和 `branch` 通过模板字符串插入 `execSync`，理论上可被 shell 注入
- **现象（P1 竞态）：** SIGTERM + SIGINT 同时触发 `gracefulShutdown` → `autoCommitAndPush` 跑两次 → git 并发写冲突
- **解决：**
  - credential catch 块记日志 + fallback 到 URL 内嵌 token
  - `ls-remote` 失败时从 `err.stderr` 提取具体错误信息
  - sync.js 全部 `execSync` 迁移至 `execFileSync` 参数数组（含 `gitExec` 改为接收数组）
  - `gracefulShutdown` 加 `shutdownInProgress` guard
- **教训：** (1) catch 空块是 P0 级反模式，至少 `console.error` (2) 即使命令是硬编码的，统一用 `execFileSync` 消除整个攻击面比逐行审计更可靠
- **文件：** `bin/lib/sync.js`

### route.ts exec() shell 注入 + context.ts Anthropic API 兼容
- **现象（P1）：** `app/api/sync/route.ts` 的 `runCli` 用 `exec()` 拼接 shell 字符串，用户输入可注入
- **现象（P1）：** `truncateToolOutputs` 未做 `trp.output` null guard，output 为 undefined 时 crash
- **现象（P2）：** `compactMessages` 产生连续 user 消息，Anthropic API 拒绝
- **现象（P2）：** `hardPrune` 裁剪后首条可能是 assistant，Anthropic 要求 user 开头
- **解决：**
  - `runCli` 改为 `execFile` + 参数数组
  - `trp.output` 加 null/type guard
  - compact 时检测 recentMessages 首条是否 user，是则合并（支持 string 和 array content）
  - hardPrune 跳过非 user 后加 fallback 注入 synthetic user 消息
- **教训：** Anthropic API 严格要求消息以 user 开头且无连续同 role 消息，所有裁剪/合并操作后都需校验
- **文件：** `app/app/api/sync/route.ts`、`app/lib/agent/context.ts`

## 依赖版本

### @types/node 版本号写了不存在的大版本
- **现象：** 新电脑首次 `mindos start`，MCP 依赖安装报 `npm error code ETARGET — No matching version found for @types/node@^25.4.0`
- **原因：** `mcp/package.json` 的 `@types/node` 写成了 `^25.4.0`，但 npm 上该包最新大版本对应 Node 22。开发机有缓存 `node_modules` 所以不触发安装，新机器首次 `npm install` 找不到匹配版本
- **解决：** 改为 `^22`，与实际 Node 版本对齐
- **规则：** `@types/node` 的大版本号 = Node.js 大版本号（如 Node 22 → `@types/node@^22`）。写 devDependencies 时不要凭感觉写版本号，先 `npm view @types/node versions` 确认存在
- **文件：** `mcp/package.json`

### @modelcontextprotocol/sdk 版本范围过宽导致 express transport 缺失
- **现象：** 新环境 / 缓存旧版本时，`npm install` 安装到 <1.25.0 的 SDK 版本，运行时 `import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js"` 报 `MODULE_NOT_FOUND`
- **原因：** `mcp/package.json` 声明 `"@modelcontextprotocol/sdk": "^1.6.1"`，但 `server/express.js` 直到 **1.25.0** 才加入 SDK（1.6.1 ~ 1.24.x 共 19 个大版本都没有该文件）。开发机有 lockfile 锁定 1.27.1 所以不触发
- **触发条件：** lockfile 丢失 / 新环境首次 install / `--prefer-offline` 命中旧缓存版本
- **解决：** 版本范围从 `^1.6.1` 改为 `^1.25.0`，确保最低安装到有 express.js 的版本
- **规则：** 代码 import 了某个子路径（如 `sdk/server/express.js`），`package.json` 的版本范围**下界**必须 ≥ 该子路径首次出现的版本。用 `npm pack @pkg@x.y.z --dry-run | grep filename` 验证
- **文件：** `mcp/package.json`、`mcp/package-lock.json`

### --prefer-offline 首次安装失败无回退
- **现象：** 新机器 `mindos start` 时 MCP 依赖安装失败，报 `npm error code ETARGET` 或 `No matching version found`
- **原因：** `mcp-spawn.js`、`cli.js`、`build.js` 三处用 `npm install --prefer-offline` 做首次安装，本地 npm 缓存中无所需版本的 packument 时直接报错退出，无在线回退
- **解决：** try `--prefer-offline` → catch 后回退到 `npm install`（不带 offline flag）。缓存命中时仍享受离线加速，缓存缺失时自动联网
- **规则：** `--prefer-offline` 仅作为优化手段，不能出现在唯一安装路径上。必须有在线回退
- **文件：** `bin/lib/mcp-spawn.js`、`bin/cli.js`、`bin/lib/build.js`

### next@16 内嵌 postcss 缺少嵌套依赖导致 build 失败
- **现象：** `npm install` 后 `next build` 报 `Module not found: Can't resolve 'source-map-js'`、`'nanoid/non-secure'`、`'picocolors'`
- **原因：** Next.js 16 内嵌 `postcss@8.4.31`（位于 `next/node_modules/postcss`），它依赖 `nanoid@^3`。但 app 顶层声明了 `nanoid@^5`（大版本不兼容），npm hoisting 把 v5 放在 `app/node_modules/nanoid`，postcss 从自身位置向上查找只能找到 v5——解析失败。`picocolors` 和 `source-map-js` 被 hoisting 到上层后，从 `next/node_modules/postcss/` 的解析路径也找不到
- **解决：** `app/package.json` 加 `postinstall` 脚本（`scripts/fix-postcss-deps.cjs`），检测 `next/node_modules/postcss/node_modules` 不存在时自动执行 `npm install --no-save --install-strategy=nested` 补装
- **教训：** 当项目依赖与框架内嵌依赖存在大版本冲突时，npm hoisting 可能导致嵌套包找不到自己的依赖。用 `npm ls <pkg>` 检查是否有 `extraneous` 标记
- **文件：** `app/package.json`、`scripts/fix-postcss-deps.cjs`

### npm install -g 后 ROOT 常量指向旧包路径
- **现象：** `mindos update` 执行 `npm install -g @geminilight/mindos@latest` 后，代码中模块加载时计算的 `ROOT`（`constants.js`）仍指向旧安装路径。新包的文件（`package.json`、`skills/`）在新路径下
- **影响：** 版本检测读旧 `package.json` → 永远显示 "Already on the latest version"；skill check 读旧 `skills/` → 永远无 mismatch
- **解决：** `getUpdatedRoot()` 通过 `which mindos` + `readlink -f` 解析新安装路径；所有 post-install 操作（版本检测、skill check、buildIfNeeded）统一使用 `updatedRoot` 而非 `ROOT`
- **规则：** `npm install -g` 后，所有读包内文件的操作必须用动态解析的路径，不能用模块加载时的静态 `ROOT`
- **文件：** `bin/cli.js`、`bin/lib/skill-check.js`

### GUI 更新在非 daemon 模式下不 restart
- **现象：** 用户通过 GUI Settings > Update 点击更新，前端一直卡在 "正在更新..."，4 分钟后超时
- **原因：** GUI 调用 `POST /api/update` → spawn `cli.js update`。`cli.js update` 只在检测到 systemd/launchd daemon 时才自动 restart。非 daemon 模式（用户手动 `mindos start`）走 else 分支，只打印 "Run `mindos start`" 然后退出。旧 Next.js 进程继续运行在旧代码上，前端 poll 的版本号永远不变
- **解决：** 非 daemon 分支新增端口检测（`isPortInUse`）。如果有实例在跑：`stopMindos()` → 等端口释放 → `buildIfNeeded(updatedRoot)` → spawn 新包的 `cli.js start` → `waitForHttp` 等服务就绪。无实例则保持原行为（只 build + 提示手动启动）
- **教训：** CLI 命令被 GUI spawn 时，不能假设用户会手动操作。所有被 API route spawn 的 CLI 命令必须自包含（检测 → 清理 → 执行 → 验证）
- **文件：** `bin/cli.js`、`app/app/api/update/route.ts`

## 架构 & 设计模式

### inline style 绕过设计系统
- **现象：** `style={{ color: 'var(--foreground)' }}` 在组件中大量使用，全局调色值时不受 Tailwind 影响
- **解决：** 批量替换为 Tailwind class（`text-foreground`、`bg-card`、`border-border` 等）。72→2 处
- **规则：** 优先用 Tailwind 语义 class > `text-[var(--xxx)]` arbitrary value > inline style。inline style 仅用于动态计算值（如条件渲染不同 background）或 CSS var() 带 fallback（Tailwind 不支持）
- **对照表：** `color: var(--foreground)` → `text-foreground` | `background: var(--card)` → `bg-card` | `borderColor: var(--border)` → `border-border` | `color: var(--amber)` → `text-[var(--amber)]`

### auto-rotating 内容不加 aria-live
- **现象：** 给自动轮播内容加 `aria-live="polite"` 导致屏幕阅读器每 3.5s 打断用户
- **规则：** WCAG 2.2.2 要求 auto-updating 内容可暂停。auto-rotating carousel 不应用 `aria-live`，除非提供暂停机制
- **文件：** `HomeContent.tsx` 建议轮播

### CSS var() + fallback 无法用 Tailwind arbitrary value
- **现象：** `bg-[var(--amber-subtle,rgba(200,135,30,0.08))]` 在 Tailwind 中解析出错
- **解决：** 在 globals.css 中定义 `--amber-subtle`（:root + .dark），然后用 `bg-[var(--amber-subtle)]`
- **规则：** 需要 CSS var + fallback 时，先在 globals.css 定义变量，再用 Tailwind arbitrary value 引用

### Context Provider 嵌套层数控制
- **现状：** 4 层（LocaleProvider → WalkthroughProvider → McpProvider → SidebarLayout）
- **规则：** ≤6 层可接受，超过时考虑 Zustand/Jotai 替代。当前用 `useMemo` 包裹 context value 缓解 re-render
- **监控：** 用 React DevTools Profiler 检查 Context 引起的不必要 re-render

### 大组件拆分阈值
- **规则：** 组件超 300 行 → 考虑拆子组件。超 500 行 → 必须拆。自定义 hook 超 100 行 → 考虑拆
- **案例：** SidebarLayout 479→314（拆出 useLeftPanel + useAskPanel）| McpSkillsSection 595→359（拆出 McpSkillRow + McpSkillCreateForm）
- **注意：** 拆分后主组件仍保留编排职责（orchestrator pattern），子组件通过 callback props 通信

## Electron / 桌面端

### SameSite=None 必须搭配 Secure
- **现象：** 跨域 auth cookie 被浏览器静默丢弃
- **原因：** Chrome 80+ 规范要求 `SameSite=None` 必须同时有 `Secure` 标志，但 HTTP 环境不能设 `Secure`
- **解决：** 跨域 + HTTPS 才用 `SameSite=None; Secure`，否则用 `SameSite=Lax`
- **规则：** 任何涉及跨域 cookie 的改动，必须测试 HTTP 和 HTTPS 两种场景

### CORS Origin Echo 必须配 Allowlist
- **现象：** 直接 echo 请求的 Origin header + `Allow-Credentials: true` = 任意站点可发凭据请求
- **解决：** 在 `/api/auth` 中维护 `ALLOWED_ORIGIN_PATTERNS` 正则数组，只有匹配的 Origin 才返回 CORS headers
- **规则：** 绝不 echo `*` + credentials；绝不无条件 echo origin + credentials

### Electron before-quit 不 await async handler
- **现象：** `app.on('before-quit', async () => { await cleanup() })` 中 cleanup 未完成进程就退出了
- **解决：** 用 `e.preventDefault()` 阻止退出，完成清理后手动 `app.exit(0)`
- **规则：** Electron 的 app 事件不 await promise，需要手动控制退出时序

### Electron 打包后 npx/npm 不在 PATH
- **现象：** 打包后 `exec('npm root -g')` / `exec('npm install ...')` 报 `/bin/sh: npm: command not found`
- **原因：** Electron 打包后 `process.env.PATH` 只有 `/usr/bin:/bin:/usr/sbin:/sbin`，不包含 `/usr/local/bin`、`/opt/homebrew/bin`、nvm/fnm 路径
- **解决：** (1) `node-detect.ts` 中 `enrichedPath()` 函数注入 `/usr/local/bin`、`/opt/homebrew/bin`、`~/.nvm/current/bin` 等常见路径 (2) 所有 `exec()` / `spawn()` 调用传入 `env: { PATH: enrichedPath(nodeBinDir) }` (3) `getMindosInstallPath()` 先用已知 node 路径旁边的 npm 执行 `npm root -g`，再扫描常见全局路径做兜底
- **规则：** Electron 打包应用中执行任何 shell 命令，必须手动构造 PATH，不能依赖 `process.env.PATH`
- **文件：** `desktop/src/node-detect.ts`、`desktop/src/connect-window.ts`

### Desktop 本地模式：`mindos.pid` 存活时绕过 Bundled/User 择优
- **现象：** 配置了 `mindosRuntimePolicy` 或内置 `mindos-runtime`，仍连上「旧」Web
- **原因：** `checkCliConflict()` 发现 `~/.mindos/mindos.pid` 对应进程仍存活时，`startLocalMode` **直接返回已有 URL**，不创建 `ProcessManager`，也不应用 `resolveLocalMindOsProjectRoot` 的结果
- **规则：** 排障时先看是否已有 `mindos start`/CLI 占用端口；与 spec `spec-desktop-bundled-mindos.md`「CLI 短路」一致

### Electron modal + hidden titlebar = macOS 死锁
- **现象：** `modal: true` + `parent: mainWindow`（`titleBarStyle: 'hidden'`）→ 主窗口交通灯不可点击，模态窗口关不掉
- **原因：** macOS 上 `titleBarStyle: 'hidden'` 的窗口交通灯在 webContents 区域内，被 modal 子窗口遮挡
- **解决：** 配置/连接窗口改为独立窗口（去掉 `parent`/`modal`），使用 `titleBarStyle: 'default'` 保证交通灯可用
- **规则：** Electron macOS 上永远不要把 modal 窗口挂载到 `titleBarStyle: 'hidden'` 的 parent 上

### Electron mainWindow 白框闪烁
- **现象：** 模式选择对话框背后出现一个大白框（空白主窗口）
- **原因：** `createWindow()` 在 URL 获取前执行，`ready-to-show` 事件让空窗口提前显示
- **解决：** 先完成模式选择 + URL 获取，最后才 `createWindow()` + `loadURL()` + `show()`
- **规则：** 主窗口延迟到有内容可显示时才创建

### 端口检测用 bind 而非 connect
- **现象：** TCP connect 方式检测端口，防火墙 drop 包导致 ETIMEDOUT 误判为"端口被占用"
- **解决：** 改用 `net.createServer().listen(port)` 尝试绑定，EADDRINUSE = 被占，成功绑定后 close = 空闲
- **规则：** 判断端口是否可用只用 bind 模式
