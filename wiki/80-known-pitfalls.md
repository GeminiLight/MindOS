<!-- Last verified: 2026-04-28 | Current stage: v1 release-candidate -->

# 踩坑记录 (Known Pitfalls)

## Cross-platform path safety

### Shared path safety 不能只按当前 OS 判断路径语义（2026-05-10）

**症状**：在 macOS/Linux 上调用 `resolveSafe(root, filePath)` 时，`C:/Users/Ada/secret.md`、`C:\Users\Ada\secret.md` 或 `\\server\share\secret.md` 这类 Windows absolute path 会被当成 root 内的相对路径；`..\secret.md` 也会被当成普通文件名，而不是 Windows 语义下的目录穿越。

**根因**：`path.isAbsolute()` 只使用当前宿主 OS 的路径规则。POSIX 宿主不会识别 Windows drive path / UNC path；同时 `path.join()` 不会把反斜杠当成 POSIX 分隔符。

**修复**：共享安全入口先用 `normalizePath()` 把反斜杠规范成 `/`，并同时用 `path.isAbsolute()` 与 `path.win32.isAbsolute()` 拒绝 POSIX、Windows drive 和 UNC absolute path，再基于规范化后的相对路径做 root containment 校验。

**防回归**：`packages/mindos/src/foundation/security/path-safety.test.ts` 覆盖 Windows absolute path 在 POSIX host 也必须拒绝、`..\secret.md` 必须被视为 traversal、`Projects\note.md` 仍能解析为 root 内安全路径。

### CLI file/space 命令也要使用跨平台路径语义（2026-05-10）

**症状**：`mindos file create 'C:/Users/Ada/secret.md'` 或 `mindos space mkdir '..\outside'` 在 POSIX host 上会被当成知识库内路径；`Projects\note.md` / `Projects\Area` 也会创建成带反斜杠的文件名，而不是跨平台一致的子路径。

**根因**：CLI 命令直接用 Node 当前 OS 的 `path.resolve(root, input)` 判断边界，和共享 `resolveSafe()` 一样没有识别 Windows drive / UNC absolute path，也没有在 containment 前把 `\` 视为路径分隔符。

**修复**：CLI 命令统一走 `packages/mindos/bin/lib/safe-path.js` 的 `resolveInsideRoot()`，先规范化反斜杠，再拒绝 POSIX/Windows absolute path 与跨平台 parent traversal。`file` 读写、`space` 读取/创建/重命名/init 都通过该入口解析用户路径。

**防回归**：`tests/unit/cli-file-safe-path.test.ts` 与 `tests/unit/cli-space-safe-path.test.ts` 通过真实 CLI subprocess 覆盖 Windows absolute path、反斜杠 traversal、以及安全反斜杠子路径规范化。

### Bootstrap target_dir 也要拒绝 Windows absolute path（2026-05-10）

**症状**：`/api/bootstrap?target_dir=C:/Users/Ada` 在 POSIX host 上不会返回 400，而是被当成普通知识库相对目录读取，导致跨平台路径语义不一致。

**根因**：Bootstrap route 只用当前 OS 的 `path.isAbsolute()` 和完整 `..` segment 校验；POSIX host 不会把 Windows drive path 当成 absolute path。

**修复**：`target_dir` 同时用 `path.win32.isAbsolute()` 校验，并拒绝反斜杠输入。Bootstrap 内部路径固定使用知识库相对 POSIX-style `/`。

**防回归**：`packages/mindos/src/server.test.ts` 覆盖 `target_dir=C:/Users/Ada` 与 `target_dir=C:\Users\Ada`；`packages/web/__tests__/api/bootstrap.test.ts` 覆盖 Web route 返回 400。

### Desktop runtime tar extraction 必须防 zip-slip（2026-05-10）

**症状**：Windows fallback 的纯 JS `extractTarGzJs()` 会把 archive entry name 直接 `path.join(destDir, entryName)`，恶意 tarball 里的 `../evil.txt` 可以写出 runtime extraction 目录。

**根因**：系统 `tar` 通常会处理 traversal 风险，但 Windows fallback 是自写 parser，必须自己做 entry containment。只做 long-path 兼容而不校验 entry path 会形成 zip-slip。

**修复**：解析 entry 前先把反斜杠规范成 `/`，拒绝 POSIX/Windows absolute path 和完整 `..` segment，再用 `path.relative(destDir, entryPath)` 确认目标仍在 extraction root 内，最后才加 Windows long-path 前缀。

**防回归**：`packages/desktop/src/core-updater-tar.test.ts` 构造 `../evil.txt` tar entry，要求 extractor reject 且 extraction root 外没有落盘文件。

### Bun single-binary runtime extraction 也不能依赖系统 tar（2026-05-12）

**症状**：Bun 单二进制首次运行时会把内嵌 `runtime.tar.gz` 解到 `~/.mindos/runtime-cache`。如果生成入口直接调用 `tar -xzf`，runtime archive 的 entry path 会被交给外部工具处理，安全语义和 Desktop runtime updater 不一致，Windows/精简环境还会依赖系统 tar 是否可用。

**修复**：`scripts/build-bun-binary.mjs` 生成的入口改为 `extractTarGzSafe()`，用 Node/Bun 内置 `gunzipSync` 解析 tar，并在写入前拒绝 POSIX/Windows absolute path、drive prefix 和完整 `..` segment，再用 `relative(root, target)` 做 containment 校验；fallback runtime 中的 symlink 只在目标仍位于 extraction root 内时保留。

**防回归**：`tests/bun-single-binary-contract.test.ts` 要求入口包含 `resolveTarEntryPath()` / `resolveTarSymlinkTarget()` 且不能重新出现 `spawnSync("tar", ["-xzf", tempArchive`。

### Tar parser 不要把 global PAX header 当成下一个 entry path（2026-05-12）

**症状**：自写 tar parser 同时处理 PAX local header (`x`) 和 global header (`g`) 时，如果把 `g` 里的 `path=` 缓存成下一个 entry name，会让 global metadata 意外改写后续文件路径。真实 Node/runtime 包通常使用 local PAX path，但 parser 语义不应混淆两者。

**修复**：所有安全 tar 解压入口只从 `typeflag === 'x'` 的 local PAX header 读取 `path`，`typeflag === 'g'` 只跳过数据块。

**防回归**：`packages/desktop/src/core-updater-tar.test.ts` 和相关 tar contract 覆盖 PAX long path；后续新增 parser 时遵循同一 `x`/`g` 分离规则。

### Onboard 自定义模板 tarball 必须安全解压（2026-05-12）

**症状**：`mindos onboard` 的 custom/GitHub template 会下载远端 tarball。如果直接调用系统 `tar -xzf`，模板包的路径安全完全依赖外部 tar 实现，和产品自己的 path containment 规则不一致。

**修复**：`scripts/setup.js` 的 `downloadAndExtract()` 改为 `extractTarGzSafe()`，用内置 gzip+tar parser 解压，只写入 extraction root 内的 regular file/directory，拒绝 absolute path、Windows drive prefix 和 `..` segment。

**防回归**：`tests/unit/cli-setup-subprocess.test.ts` 要求 setup 模板解压不再调用 `tar -xzf`，并保留 `resolveTarEntryPath()` containment helper。

### Desktop 私有 Node.js bootstrap 不要把 tarball 交给系统 tar（2026-05-12）

**症状**：Desktop 在用户机器没有可用 Node.js 时，会下载 Node.js tarball 并解压到 `~/.mindos/node`。如果直接调用系统 `tar xzf --strip-components=1`，路径 containment 和可执行位处理都依赖外部 tar 实现。

**修复**：`packages/desktop/src/node-bootstrap.ts` 改为 `extractTarGzSafe(tmpFile, NODE_DIR, 1)`，本地解析 tar.gz，先拒绝 absolute path、Windows drive prefix 和 `..` segment，再做 strip-components，并保留 regular file 的 Unix mode 与 root 内 symlink，确保 `node`/`npm`/`npx` 可执行。Desktop 打包脚本 `packages/desktop/scripts/prepare-mindos-runtime.mjs` 同步使用同一安全解压策略，Windows zip 分支改用 PowerShell `Expand-Archive -LiteralPath`。打包后的全局 symlink 清理会跳过 `resources/mindos-runtime/node`，避免把官方 `npm`/`npx` launcher 删掉。

**防回归**：`packages/desktop/src/node-bootstrap.test.ts` 要求 Node bootstrap 不再调用 `spawnAsync('tar', ...)`，并保留 `resolveTarEntryPath()` containment helper；`tests/desktop-release-contract.test.ts` 覆盖 Desktop runtime prepare 脚本不能回退到系统 tar，且 Windows zip 解压必须使用 `-LiteralPath`。

### Desktop Windows Node.js zip 解压不能用过短超时（2026-06-07）

**症状**：`Build Desktop` workflow 中 Windows x64 在 `Prepare bundled runtime` 阶段失败，日志停在 `Downloading Node.js 22.16.0 (win32-x64)...` 后报 `Failed to extract Node.js zip`。Windows ARM64、macOS、Linux 可以通过，因为 x64 zip 更大，`Expand-Archive` 在 GitHub Windows runner 上可能超过 60 秒。

**根因**：`packages/desktop/scripts/prepare-mindos-runtime.mjs` 的 Windows zip 分支只给 `powershell.exe Expand-Archive` 60 秒超时，并且失败日志没有输出 `status` / `signal` / `error`，导致真实原因被折叠成泛化的解压失败。

**修复**：Windows zip 解压超时提升为命名常量 `NODE_ZIP_EXTRACT_TIMEOUT_MS = 300000`，失败时输出 spawn 的 `status`、`signal` 和 `error`，确保 CI 慢 runner 不会误杀正常解压，后续失败也能直接定位。

**防回归**：`tests/desktop-release-contract.test.ts` 覆盖 Desktop runtime prepare 的 zip 解压必须使用 5 分钟超时和 `formatSpawnFailure(zipResult)` 诊断。

### Desktop 端口耗尽提示不要建议用户管道 kill（2026-05-12）

**症状**：Desktop 本地启动时如果默认端口窗口都被占用，错误提示会建议用户运行 `lsof -ti:<port> | xargs kill`。这会把“定位占用者”和“终止进程”混在一起，容易误杀非 MindOS 服务。

**修复**：端口耗尽提示改成只展示查询命令：Unix 使用 `lsof -nP -iTCP:<port> -sTCP:LISTEN`，Windows 保留 `netstat -ano | findstr :<port>`；用户需要关闭哪个程序由 UI 文案明确说明。

**防回归**：`packages/desktop/src/main-subprocess-contract.test.ts` 禁止 Desktop main 重新出现 `| xargs kill` 提示。

### 本地 release smoke 必须检查 npm 主入口和 MCP bundle（2026-05-12）

**症状**：`scripts/release.sh` 的本地 tarball smoke 检查 `dist/foundation.js`，但 `packages/mindos/package.json` 的 `main`/`exports["."]` 指向 `dist/index.js`，GitHub 发布后校验也检查 `dist/index.js` 和 `dist/protocols/mcp-server/index.cjs`。本地 release 可能放过真正 npm 入口或 MCP bundle 缺失。

**修复**：本地 release smoke 改为检查 `bin/mindos-shim.cjs`、`dist/index.js`、`dist/protocols/acp/index.js`、`dist/protocols/mcp-server/index.cjs`，与发布 workflow 对齐。

**防回归**：`tests/platform-runtime-package-contract.test.ts` 同时检查 GitHub workflow 和 `scripts/release.sh` 的关键文件清单。

## v1 Monorepo Migration

### v1 迁移后不要再把顶层 `app/` / `apps/` / `desktop/` / `mobile/` 当源码入口

**症状**：顶层 legacy source roots 删除后，如果运行时代码仍从 `projectRoot/app/...` 查找 skills 或 Agent extensions，会造成 dev、npm 包和 Desktop runtime 行为不一致。

**根因**：v1 迁移时先复制目录再切入口，旧路径容易残留在 tests、docs、hooks 和动态路径解析里；单纯删除目录不足以证明运行时自洽。

**规则**：
- 源码入口固定为 `packages/web/`、`packages/desktop/`、`packages/mobile/`、`packages/mindos/src/protocols/acp/`、`packages/mindos/src/protocols/mcp-server/`
- `packages/web/data/skills/` 是 Web 内置 skill copy；`skills/` 是项目级 source-of-truth copy
- Desktop 新打包产物使用 `packages/web/` + `dist/protocols/mcp-server/index.cjs`，不再生成顶层 `app/` + `mcp/` 兼容布局
- `packages/mindos/_standalone`、`packages/mindos/packages`、`packages/mindos/scripts` 等是 pack/publish staging output，不是源码；不要在那里修 bug

**验证**：`pnpm exec vitest run tests/legacy-cleanup-contract.test.ts`，发布前再跑真实 `npm pack` tarball smoke。

### MCP source path 迁移后不要再改顶层 `mcp/` 或旧 `packages/protocols/`

**症状**：v1 迁移后如果继续在顶层 `mcp/` 修 MCP，会出现"本地修了但发布包 / CLI / Desktop 没变化"的假修复。

**根因**：MCP 源码和新 Desktop runtime source of truth 已迁入 `packages/mindos/src/protocols/mcp-server/`。顶层 `mcp/` 与旧 `packages/protocols/mcp-server/` 只可能来自旧安装包或旧缓存，不能作为新版本入口。

**规则**：
- MCP 源码只改 `packages/mindos/src/protocols/mcp-server/index.ts`
- 构建用 `pnpm --filter @geminilight/mindos build`
- CLI 通过 `packages/mindos/bin/lib/mcp-build.js` 读取 `dist/protocols/mcp-server/index.cjs`
- Desktop runtime prepare 直接复制为 `dist/protocols/mcp-server/index.cjs`

**验证**：`pnpm exec vitest run tests/mcp-package-migration-contract.test.ts`，并确认 npm tarball 包含 `dist/protocols/mcp-server/index.cjs`。

### Standalone health 通过不代表 Web 首页可渲染

**症状**：npm 包安装后 `mindos --version`、`/api/health` 都正常，但打开 Web 首页返回 500；或首页能渲染，但浏览器 console 里有后台资源 500。

**根因**：Next standalone tracing 可能漏掉被 `serverExternalPackages` 外置包在 server render 或浏览器触发的 server action/API 中才 import 的依赖。例如 `@mariozechner/pi-ai` 需要 `@sinclair/typebox` / `partial-json`，`@mariozechner/pi-coding-agent` 需要 `chalk`，但 health route 不会触发这些模块。

**规则**：
- `scripts/verify-standalone.mjs` 必须同时请求 `/api/health` 和 `/`
- 外置 runtime 包需要的依赖必须是 `packages/web/package.json` 的显式 runtime dependency
- `scripts/prepare-standalone.mjs` 要把这些 runtime dependency 复制进 standalone `node_modules`，再 stage 到 `packages/mindos/_standalone/__node_modules`

**验证**：发布前用全新 `/tmp` 安装 tarball，真实运行 `mindos start`，确认首页 `/` 返回 200；再用真实浏览器/Playwright 打开首页，要求无 4xx/5xx responses、无 console error，并用 token 调 `/api/files` / `/api/file` / `/api/search`。

### Capture AI organize 不能只测 SSE，要验证工具真实落盘（2026-05-16）

**症状**：暂存台 AI 整理的 `/api/ask mode=organize` 返回 200，SSE 里也有 `tool_start`，但知识库没有新增/更新文件；进一步看 stream 才发现 `list_files` / `create_file` 返回 `Tool ... not found`。

**根因**：Web runtime 从 `@geminilight/mindos/session` 读取构建后的 `dist/session.js`。只改 `packages/mindos/src/session/index.ts` 而没有重建产品包时，Next 仍使用旧 dist；同时仅依赖 Pi extension 加载 KB tools 容易出现“模型被 prompt 引导调用工具，但 AgentSession active registry 没有这些工具”的假可用。

**修复**：创建 Pi AgentSession 时把按 mode 过滤后的 `requestTools` 作为 `customTools` 注入，确保 chat/organize/agent 的 KB tools 进入 active tool registry；修改 `packages/mindos/src` 后必须跑 `pnpm --filter @geminilight/mindos build` 更新 dist。

**验证**：除了前端 hook/component 测试，还要用临时 `HOME` + 临时 `mindRoot` 跑真实 `/api/ask mode=organize` smoke：上传一段带唯一 marker 的内容，要求 AI 在子目录创建 Markdown 文件，最后用 `find` / `rg` 验证目标文件和 marker 真实落盘，且 SSE 中 `create_file` 的 `tool_end.isError` 为 `false`。

### OpenAI-compatible 自定义 baseUrl 的 organize 要优先走 non-streaming tools path（2026-06-08）

**症状**：Capture / Inbox Review 点击后，`/api/ask mode=organize` 返回 `200 text/event-stream`，模型文本里声称“Created `Inbox/...md`”，但 SSE 没有 `tool_start` / `tool_end`，知识库也没有真实文件落盘。

**根因**：某些 OpenAI-compatible 代理端点在 Pi Agent streaming 路径下不会返回结构化 tool call，而是把类似 `<create_file ... />` 的工具意图当普通文本输出。前端只看到正常文本流，用户会误以为整理成功。

**规则**：`mode=organize` 且 provider 为 `openai`、存在自定义 `baseUrl` 时，默认使用 non-streaming compatibility path，让 OpenAI `tool_calls` 由 MindOS fallback 执行并产出 `tool_start` / `tool_end`。Chat 模式不要强制切换，避免影响普通对话流式体验。

**验证**：`packages/web/__tests__/agent/ask-compat.test.ts` 覆盖 compat 选择；真实 smoke 要求 `/api/ask mode=organize` 返回 `status: Using compatibility mode (non-streaming)...`，随后出现 `tool_start create_file`、`tool_end isError:false`，并用唯一 marker 验证文件真实创建后清理。

### Pi AgentSession 不再拥有 newSession，历史要在创建前写入 SessionManager（2026-06-07）

**症状**：Inbox Review / AI organize 调用 `/api/ask mode=organize` 后返回 500，前端显示 `AI provider/server failed (500). o.newSession is not a function`。

**根因**：`@earendil-works/pi-coding-agent` 0.78.x 已把 `newSession()` 移到 `AgentSessionRuntime`，普通 `createAgentSession()` 返回的 `AgentSession` 不再暴露 `newSession()`。MindOS 产品 runtime 仍按旧 SDK 形状先创建 session，再调用 `session.newSession({ setup })` 注入历史，导致 server 初始化阶段直接抛错。

**规则**：通过 `createAgentSession()` 嵌入 Pi SDK 时，不要要求 `AgentSession` 具备 session replacement API。需要注入历史时，先创建 `SessionManager`，再把 `convertToLlm()` 得到的历史消息用 `sessionManager.appendMessage()` 写入，最后把这个 session manager 传给 `createAgentSession()`。

**验证**：`packages/mindos/src/session.test.ts` 必须覆盖 mock `AgentSession` 没有 `newSession` 时仍能初始化；修改 `packages/mindos/src/session/index.ts` 后必须跑 `pnpm --filter @geminilight/mindos build` 更新 dist，再跑 Web Inbox organize 相关测试。

### 前端 AI 可用性检查必须跟随 Settings 新 provider 结构（2026-06-06）

**症状**：Settings 里已经配置 active provider 和 API key，但 Inbox Agent 仍提示 `Configure an AI API key before running the Inbox Agent. Capture still works without AI.`；创建 Space 或文件树转 Space 的 AI 初始化入口也可能误判没有 AI。

**根因**：旧前端检查继续读取 `ai.provider` 和 `ai.providers[provider].apiKey`，而当前 Settings payload 已迁移为 `ai.activeProvider` + `ai.providers[]`，并且还需要考虑 `envOverrides` 与本地 provider fallback。`/api/ask` 后端能用真实 settings 运行，但前端在调用前提前拦截。

**规则**：前端只要判断 `/api/ask` 是否可运行，就复用 `packages/web/lib/settings-ai-client.ts` 的 `isAiConfiguredForAsk()`；不要在组件或 hook 里重新写 provider/key 解析逻辑。

**验证**：`packages/web/__tests__/lib/space-ai-init.test.ts` 覆盖 active provider array 与 env fallback；`packages/web/__tests__/hooks/useInboxOrganizeController.test.tsx` 覆盖 Inbox Agent 在 Settings 已配置时必须继续读取文件并调用 `aiOrganize.start()`，不能弹缺 key toast。

### Restore from environment 不能清空 Settings provider 列表（2026-06-08）

**症状**：Settings 里点击 `Restore from environment` 后，AI provider 配置看起来被环境变量锁死，用户无法继续手动覆盖配置。

**根因**：旧 restore 逻辑把 `ai.activeProvider` 和 `ai.providers` 整体重置为空数组。后端运行时可以从 env fallback，但设置页展示的是保存配置；provider 列表被清空后，UI 不再有稳定的可编辑 provider entry。

**规则**：restore 只清理确实有环境变量 fallback 的字段，例如对应 provider 的 API key；provider entry、model、baseUrl 和手动可编辑状态必须保留。`AI_PROVIDER` 只用于切换到已存在的 matching provider entry，不创建空配置。

**验证**：`packages/web/__tests__/settings/ai-env-restore.test.ts` 覆盖 restore 后 provider 列表仍存在、env-backed API key 被清空、非 env-backed provider 不受影响。

### 内置 skill 的 references 必须随 packaged skill 一起发布（2026-06-08）

**症状**：正常安装 MindOS 后，MindOS skill 在创建 SOP 时读不到 `references/sop-template.md`；本地手动补文件后可用，但下一次更新可能再次丢失。

**根因**：`skills/mindos/SKILL.md` 是 source-of-truth，`packages/web/data/skills/mindos/SKILL.md` 是 runtime packaged copy；之前只同步了 `SKILL.md` 和部分 reference，漏掉了 SOP、post-task hooks、preference capture、knowledge health 等被 SKILL.md 直接引用的文件。中文版 source skill 也引用了 `references/knowledge-health.md`，但源码目录缺文件。

**规则**：凡是 `skills/mindos*/SKILL.md` 里以 `references/*.md` 形式引用的文件，source skill 和 `packages/web/data/skills/*` packaged copy 都必须存在且内容一致。不要只补某一个报错文件，否则会留下同类运行时断链。

**验证**：`packages/web/__tests__/lib/mindos-copy-alignment.test.ts` 检查 `mindos` / `mindos-zh` 的 SKILL.md 与所有引用 reference 文件在 packaged copy 中存在且内容一致。

### Route-controlled 左侧 panel 离开时也要恢复目标 panel（2026-06-07）

**症状**：从 Inbox (`/capture`) 切回 Wiki 或其它页面后，主内容已经变成目标页面，但左侧 panel 仍显示 Inbox，用户感觉“再也点不回去”。

**根因**：Inbox route 会用 effect 把 `activePanel` 强制对齐为 `capture`。如果用户在 `/capture` 的 RSC transition 还没完全提交时点击 Wiki，`setActivePanel('files')` 会先执行，但旧的 `/capture` 对齐 effect 随后又把 panel 改回 `capture`；目标 route 提交后没有对应恢复逻辑。

**规则**：route-controlled panel 不能只处理进入 route，也要处理离开 route 后的 stale panel recovery。恢复逻辑只修正明显不合法的 stale state（例如 files/agents/explore/echo route 上仍是 `capture`），不要破坏用户在 Wiki 手动关闭 Files 或打开 Search panel 的行为。

**验证**：`packages/web/__tests__/lib/navigation-panel.test.ts` 覆盖 `/capture -> /wiki`、`/agents`、`/explore`、`/echo` 的 stale capture recovery；浏览器验证从 `/capture` 点击 Wiki 后，URL 为 `/wiki` 且左侧不再显示 Inbox panel。

### v1 workspace 构建不能在 `packages/web` 内直接跑 npm install

**症状**：根目录 `pnpm build` 在 `@geminilight/mindos` 的 web build 阶段失败，错误类似 `Unsupported URL Type "workspace:"`。

**根因**：v1 的 Web 包使用 `workspace:*` 依赖指向 monorepo 内的 `@geminilight/mindos`。如果构建脚本进入 `packages/web` 后执行 `npm install --no-workspaces`，npm 会把 workspace protocol 当作普通包解析并失败。

**规则**：
- 只要检测到根目录 `pnpm-workspace.yaml` 且 `packages/web/package.json` 存在 `workspace:` 依赖，就必须在 monorepo 根目录执行 `pnpm install --no-frozen-lockfile`
- dependency health check 只检查 Web 的直接关键依赖，例如 `next`、`react`、`react-dom`
- 不要要求 pnpm 的传递依赖出现在 `packages/web/node_modules` 顶层；它们通常在 `.pnpm` store 内

**验证**：`pnpm exec vitest run tests/unit/cli-build.test.ts`，再跑根目录 `pnpm build`。

### Desktop runtime 打包不能依赖 `fs.cpSync({ dereference: true })` 处理 pnpm symlink tree

**症状**：`pnpm --filter @mindos/desktop dist:mac-zip` 在 prepare runtime 阶段失败，常见报错包括复制 `@huggingface/transformers`、scoped package 或 broken symlink 时 `ENOENT`。

**根因**：pnpm 的 `node_modules` 大量使用 symlink。Node 的 `fs.cpSync(..., { dereference: true })` 在复杂 scoped package、fallback `app/node_modules`、以及 broken symlink 场景下行为不够稳定，容易在 Desktop runtime materialize 阶段留下未展开或不可复制的路径。

**规则**：
- Desktop runtime prepare 必须显式 materialize symlink：先 `realpath`，再递归复制真实目录或文件
- 替换 symlink 时使用 `unlink`，不要用 recursive remove 误处理目标路径
- Electron Desktop 包当前不需要 native rebuild；如果生产依赖仍然是纯 JS，保持 `npmRebuild: false`，避免 electron-builder 扫到 dev-only pnpm optional symlink

**验证**：`pnpm exec vitest run packages/desktop/src/prepare-mindos-bundle.test.ts packages/desktop/src/runtime-health-contract.test.ts`，再跑 `pnpm --filter @mindos/desktop dist:mac-zip`。

### 本地 embedding runtime 不应默认打进 Desktop 包（2026-05-10）

**症状**：Desktop 安装体积异常膨胀，或 `mindos-runtime` 中出现 `@huggingface/transformers`、`onnxruntime-node`、`onnxruntime-web`。

**根因**：本地 embedding 的 HuggingFace/ONNX runtime 是可选能力，不是启动 MindOS、API embedding、搜索 UI、MCP runtime 的必需依赖。把它放进默认 Desktop bundle 会让所有用户承担额外下载和安装体积。

**规则**：
- 默认 Desktop/npm runtime 不内置 HuggingFace/ONNX 本地 embedding runtime
- 用户选择本地 embedding 并点击下载时，再安装到 `~/.mindos/local-embedding-runtime`
- 只有显式设置 `MINDOS_BUNDLE_LOCAL_EMBEDDING_RUNTIME=1` 才允许把 optional runtime 打进包
- `prepare-mindos-bundle` 必须在复制 Next runtime deps 后再递归补齐 package dependency closure；否则 postcss/react-dom/styled-jsx 这类后引入包会缺 transitive deps

**验证**：`pnpm --filter @mindos/desktop test -- prepare-mindos-bundle`、`pnpm --filter @mindos/web exec vitest run __tests__/core/embedding-provider.test.ts`、`pnpm run test:contracts`，再跑 `node scripts/verify-desktop-runtime.mjs --runtime-root packages/desktop/resources/mindos-runtime`。

### 测试不要假设本机默认端口空闲

**症状**：单测在某些机器上超时或走进真实服务复用路径，例如默认 Web 端口 `3456` 或 MCP 端口 `8781` 已经被本地 dev server 占用。

**根因**：迁移后 CLI/Desktop tests 更接近真实启动逻辑。如果测试沿用用户 HOME 或默认端口，就会被当前机器状态污染，导致 CI 和本地结果不一致。

**规则**：
- CLI 测试需要使用临时 `HOME`，并写入隔离的 `.mindos/config.json`
- ProcessManager / Desktop host 测试使用高位测试端口，不要复用产品默认端口
- 断言启动逻辑时优先 mock/spawn test fixture，不依赖本机是否已有 MindOS 进程

**验证**：`pnpm exec vitest run tests/unit/cli-update-root.test.ts packages/desktop/src/process-manager-hostname.test.ts`。

### Expo mobile export 需要显式声明 pnpm 下的运行时依赖和资源

**症状**：`expo export` 报 `Unable to resolve "@babel/runtime/helpers/interopRequireDefault"`，或导出过程中提示缺少 `assets/favicon.png`。

**根因**：pnpm 不保证未声明的 transitive dependency 能从 mobile 包解析到；Expo Web/All 平台导出还会读取 `react-dom`、`react-native-web` 和 app icon/favicon/splash 资源。

**规则**：
- `packages/mobile/package.json` 必须显式声明 `@babel/runtime`
- 需要支持 `expo export --platform all` 时，必须声明 `react-dom` 和 `react-native-web`
- `packages/mobile/assets/` 至少包含 `icon.png`、`adaptive-icon.png`、`splash.png`、`favicon.png`

**验证**：`pnpm --filter @mindos/mobile typecheck`、`pnpm --filter @mindos/mobile test`、`pnpm --filter @mindos/mobile exec expo export --platform all --output-dir dist`。

## Git / 双仓同步

### Git 同步失败不能被吞掉，也不能打崩后台同步（2026-05-11）

**症状**：点击 Sync Now 后 UI 显示成功，但实际 `git commit` / `git push` 已失败；或者后台文件监听触发自动提交时，抛出的 Git 错误可能变成未处理异常。

**根因**：手动同步和后台同步复用同一个提交/推送函数，但这两个调用方的错误语义不同。手动同步需要把失败抛到 API/UI，后台同步需要把失败写进 `sync-state.json` 并等待下一轮重试。

**规则**：
- `manualSync()` 必须在 commit / push 失败时抛错，让 `/api/sync` 返回明确错误
- 后台 watcher 调用自动提交时必须 catch，只保留 `lastError`，不能让 daemon 崩掉
- 所有长耗时 Git 操作必须设置 timeout，避免 UI 一直卡住
- UI 错误提示不要 3 秒自动消失；用户需要时间复制错误和按提示修复

**验证**：`pnpm exec vitest run tests/unit/cli-sync.test.ts` 覆盖 commit 失败会抛错并写入 `sync-state.json`；`pnpm --filter @geminilight/mindos test -- --runInBand src/server.test.ts` 覆盖配置损坏时仍可 reset。

### 公开仓 tag push 与 workflow_dispatch 不要双触发同一个发布

**症状**：`npm run release` 后公开仓出现两个 `publish-npm` run；一个成功发布 npm，另一个因为同一版本已存在而失败。

**根因**：`sync-to-mindos.yml` 使用 PAT 把 `vX.Y.Z` tag 推到公开仓时，公开仓的 `publish-npm.yml` 会被 tag push 自动触发。如果 sync workflow 同时再调用 `publish-npm.yml/dispatches`，同一版本会被发布两次。

**规则**：
- `vX.Y.Z`：只靠公开仓 tag push 自动触发 `publish-npm.yml` / `publish-runtime.yml`
- `desktop-vX.Y.Z`：因为 desktop workflow 不监听 tag push，才由 `sync-to-mindos.yml` 显式 dispatch `build-desktop.yml`
- `clipper-vX.Y.Z`：只靠公开仓 tag push 自动触发 `publish-clipper.yml`

**验证**：`pnpm exec vitest run tests/workflow-migration-contract.test.ts`，确认 `sync-to-mindos.yml` 不包含 `publish-npm.yml/dispatches`。

### 绝对禁止手动 push/merge public repo（2026-03-31 实际事故）

**症状**：mindos-dev 丢失 219 个文件（`.claude-internal/`、`startup/`、私有 wiki 等）。

**根因**：手动 `git push public main` 把 dev 完整历史推到 public repo，然后 `git merge public/main` 回来。public repo 只有 sync 子集，Git 认为 public 端"删除"了 dev-only 文件，merge 时同步删除。

**规则**：
- **永远不要** `git push public main` 或 `git merge public/main`
- 只通过 `sync-to-mindos.yml` CI 单向同步 dev → public
- 唯一允许直接推 public 的是 tag：`git push public v0.6.27`（仅 tag，不推 branch）
- 如果 public 有外部 PR，在 GitHub 上合并后让 CI 回流，不要手动 merge

**恢复方式**：`git reset --hard <merge前的commit>` + `git push origin main --force-with-lease`

## Agent / LLM API

### "创建此文件"按钮无法点击（2026-04-20）

**症状**：用户访问不存在的文件（如 `笔记/國 AI/Untitled.md`）时，页面显示"文件未找到"提示和"创建此文件"按钮，但点击按钮无响应。

**根因**：`app/view/[...path]/not-found.tsx:33-36` 调用了错误的 API 端点：
- 错误：`PUT /api/files`（不存在）
- 正确：`POST /api/file` + `op: 'create_file'`

**修复**：
1. 修改 API 端点从 `/api/files` 到 `/api/file`
2. 修改 HTTP 方法从 `PUT` 到 `POST`
3. 添加 `op: 'create_file'` 参数
4. 改进错误处理：记录错误日志而非静默失败

**技术细节**：
- `/api/files` (GET) 用于列出所有文件
- `/api/file` (POST) 用于文件操作，需要 `op` 参数指定操作类型
- 可用的 `op` 值：`create_file`, `save_file`, `delete_file`, `rename_file`, `move_file` 等

**规则**：
- 所有文件操作必须通过 `POST /api/file` + `op` 参数
- 不要静默吞掉错误，至少记录到 console 便于调试
- API 调用失败时应给用户明确的反馈

**测试**：手动测试访问不存在的文件路径，验证"创建此文件"按钮可正常工作。

### Hugging Face 模型下载失败（中国大陆网络）（2026-04-20）

**症状**：用户在设置页面启用本地嵌入搜索并点击"下载模型"后，一直显示 "Download failed. Check your network connection and try again."。

**根因**：中国大陆网络无法直接访问 `huggingface.co` 和 `cdn-lfs.huggingface.co`，导致 `@huggingface/transformers` 下载模型时超时（75 秒+）。

**修复**：
1. 代码自动配置 `hf-mirror.com` 镜像源（中国大陆可访问）
2. 支持通过 `HF_ENDPOINT` 环境变量自定义镜像源
3. UI 提示用户可切换到 API 模式（使用硅基流动等国内服务）

**使用方式**：

方案 1（推荐）：代码已自动配置镜像，无需手动操作，直接点击"下载模型"即可。

方案 2：自定义镜像源
```bash
# 设置环境变量后启动
export HF_ENDPOINT=https://hf-mirror.com
npm run dev

# 或 Desktop 用户
export HF_ENDPOINT=https://hf-mirror.com
open /Applications/MindOS.app
```

方案 3：使用 API 模式
- 在设置页面切换到"API"模式
- 选择"SiliconFlow"（免费，中国大陆可用）
- 填写 API Key（在 https://siliconflow.cn 注册获取）

**技术细节**：
- `embedding-provider.ts:173-177` 检测到未设置 `HF_ENDPOINT` 且 `env.remoteHost` 为空时，自动配置 `https://hf-mirror.com`
- 重试逻辑：最多 3 次尝试（初始 + 2 次重试），指数退避（1s, 2s）
- 超时保护：单次下载最长 5 分钟
- 错误分类：区分网络错误（可重试）和非网络错误（不重试）

**规则**：
- 本地模型下载失败时，优先引导用户切换到 API 模式，而非反复重试
- 镜像源配置应尊重用户的 `HF_ENDPOINT` 环境变量，不要强制覆盖
- UI 错误提示应包含具体的解决方案，而非仅显示"网络错误"

**测试**：`__tests__/core/embedding-provider.test.ts` 覆盖镜像配置、重试逻辑、错误分类等场景。

### Agent 超时配置不足导致慢速 API 场景失败（2026-04-20）

**症状**：用户使用慢速 API（自建 Ollama、海外 API、高延迟网络）或复杂工具链时，Agent 回复在 120 秒后超时，前端显示 "Agent execution timeout after 120 seconds"。

**根因**：`app/api/ask/route.ts` 中 `AGENT_TIMEOUT_MS` 和 `ACP_AGENT_TIMEOUT_MS` 硬编码为 120 秒，对于以下场景不够用：
- 自建 Ollama 模型推理慢（CPU 推理、大模型）
- 海外 API 高延迟（跨国网络、代理）
- 复杂工具链（多步工具调用、大文件处理）
- 用户自定义 Agent 执行耗时任务

**修复**：
1. 将默认超时从 120s 提升到 600s（10 分钟）
2. 支持通过 `MINDOS_AGENT_TIMEOUT_MS` 环境变量自定义
3. 同时应用于 MindOS Agent 和 ACP Agent 路径

**使用方式**：
```bash
# 设置 20 分钟超时
MINDOS_AGENT_TIMEOUT_MS=1200000 npm run dev

# Desktop 用户可在启动前设置环境变量
export MINDOS_AGENT_TIMEOUT_MS=1200000
```

**规则**：
- 默认 600s 适配大部分场景，极端慢速场景通过环境变量调整
- 不要在代码中硬编码超时值，始终支持环境变量覆盖
- 超时错误信息应包含实际超时时间，便于用户诊断

### 背景预热请求不要绑在"面板隐藏"清理上（2026-04-11）

**症状**：像 Search 这类后台预热请求，如果在面板关闭时直接取消并阻止状态更新，下一次重新打开面板可能一直停留在 `warming` 或再也不重试。

**根因**：很多面板是“隐藏但仍挂载”，不是完全 unmount。把 background prewarm 的完成回调绑到 `active=false` 的 cleanup 上，会把一次正常的后台完成误判成“应该丢弃的结果”。同时若文件内容变化后不重置 prewarm 状态，会导致预热状态与真实索引生命周期脱节。

**规则**：
- 背景预热的完成回调要区分“组件卸载”和“面板隐藏”
- 只在真正 unmount 时阻止状态更新，不要因为 `active=false` 就丢结果
- 任何依赖缓存的 warmState，都要在 `files-changed` 等失效事件发生时重置


### pdfjs-dist 在 Next.js standalone 构建下找不到模块（2026-04-11，更新 2026-04-11）

**症状**：用户在 Chatbot 上传 PDF 时报错 `Cannot find module 'pdfjs-dist/legacy/build/pdf.mjs'`，require stack 指向 `.next/standalone/…/extract-pdf.cjs`。dev 模式正常，standalone（Desktop/npm 全局）模式才出问题。

**根因**：`extract-pdf.cjs` 是通过 `execFileSync('node', [scriptPath, …])` 在子进程中运行的，不经过 Next.js 打包。`next.config.ts` 的 `outputFileTracingIncludes` 虽然把脚本文件拷贝到 `.next/standalone/scripts/`，但 `pdfjs-dist` 不在 `serverExternalPackages` 列表，所以 **`node_modules/pdfjs-dist/` 不会被拷贝到 standalone**。子进程 `require('pdfjs-dist/…')` 时找不到模块。

**二次复发根因**（2026-04-11）：主 `app/next.config.ts` 修复后，**Desktop runtime 副本**（`desktop/resources/mindos-runtime/app/next.config.ts`）和 **npm 包副本**（`_standalone/next.config.ts`）未同步更新 `serverExternalPackages`。用户通过 Desktop 安装的 runtime 使用过期配置构建，standalone 仍然缺少 `pdfjs-dist`。

**修复**：
1. 将 `pdfjs-dist` 加入 `serverExternalPackages` 列表
2. **同时更新所有 `next.config.ts` 副本**：`app/`、`_standalone/`、`desktop/resources/mindos-runtime/app/`
3. 同步 `extract-pdf.cjs` 脚本到所有副本

**规则**：
1. 任何被 spawn 的 `.cjs`/`.mjs` 脚本若直接 `require()`/`import()` npm 包，该包必须加入 `serverExternalPackages`
2. **`next.config.ts` 改动必须同步到三处副本**：`app/`、`_standalone/`、`desktop/resources/mindos-runtime/app/`
3. `extract-pdf.cjs` 等运行时脚本改动必须同步到 `desktop/resources/mindos-runtime/app/scripts/`

**测试**：`__tests__/scripts/extract-pdf-runtime.test.ts` 直接 spawn `extract-pdf.cjs` 验证 pdfjs-dist 加载成功。

**三次复发根因**（2026-04-11）：用户已更新到最新 Desktop，但 `~/.mindos/runtime/` 缓存的旧 runtime 版本 **高于** 新 bundled runtime 版本。`cleanupOnBoot()` 只在 `bundled >= cached` 时才删除缓存，所以用户继续使用缺少 `pdfjs-dist` 的旧 runtime。`analyzeMindOsLayout()` 不检查具体依赖是否存在，只检查 `server.js`，无法拦截这类不完整的 runtime。

**用户自救（cached runtime 问题）**：
```bash
# macOS / Linux
rm -rf ~/.mindos/runtime

# Windows (PowerShell)
Remove-Item -Recurse -Force "$env:USERPROFILE\.mindos\runtime"
```
重启 Desktop 后会自动使用新 bundled runtime。

**四次复发根因**（2026-04-20）：用户下载的 Desktop 应用本身的 **bundled runtime 缺少 `pdfjs-dist`**（构建于 v0.6.80 之前）。错误路径指向 `/Applications/MindOS.app/Contents/Resources/mindos-runtime/app/scripts/extract-pdf.cjs`，说明问题在 bundled runtime，不是 cached runtime。

**用户自救（bundled runtime 问题）**：
```bash
# 方案 1：删除旧的 bundled runtime，强制使用全局 npm 安装
rm -rf /Applications/MindOS.app/Contents/Resources/mindos-runtime

# 方案 2：安装最新的全局 MindOS（>= v0.6.80）
npm install -g @geminilight/mindos@latest

# 方案 3：下载最新的 Desktop 版本（>= desktop-v0.1.13）
# 从 https://github.com/GeminiLight/MindOS/releases 下载最新的 desktop-v* 版本
```

**根本解决**：确保 Desktop 发布流程始终使用最新的 `main` 分支代码构建，不要使用旧的 tag 或 commit。GitHub Actions workflow 应该从 `main` checkout，而不是从 tag checkout。

**最终修复**（2026-04-11）：
1. `desktop/src/core-updater.ts` 在 `cleanupOnBoot()` 中先检查 cached runtime 完整性；若缺少 `extract-pdf.cjs` / `pdfjs-dist` 关键文件，则**无条件删除** `~/.mindos/runtime/`
2. `desktop/src/mindos-runtime-layout.ts` 的 `analyzeMindOsLayout()` / `isBundledRuntimeIntact()` 统一校验 standalone 关键文件，避免坏 runtime 被当作 runnable
3. `scripts/build-runtime-archive.sh` 与 Desktop 内置 runtime archive 脚本增加 `pdfjs-dist` 自检，打包阶段直接 fail fast
4. `desktop/scripts/prepare-mindos-bundle.mjs` 在 prepare 阶段校验 standalone 关键文件，防止坏 runtime 被打进安装包
5. 将 runtime 健康标准收敛到 `desktop/runtime-health-contract.json`，让 Desktop 运行时判定、prepare、自检统一消费同一份 contract，未来更换 PDF 库只需改一处

**发布链路澄清**（2026-04-11）：
- Desktop 用户安装包走 `.github/workflows/build-desktop.yml` 平台矩阵：在对应 runner 上先执行 `next build --webpack`，再执行 `desktop/scripts/prepare-mindos-runtime.mjs`，把 freshly built runtime 打进安装包。
- 因此，**Desktop 用户拿到的不是历史 cache 产物**，而是当前 workflow 现场构建并校验过的 bundled runtime。
- `scripts/build-runtime-archive.sh` 的 bash-only 限制只影响 `publish-runtime.yml` 这条 **Linux CI 发布链路**，不影响 Desktop 用户在 macOS / Windows / Linux 上运行最新健康版本。

**发布规则**：修复上线时需要同时发新的 Core patch 版本和新的 Desktop 版本；仅发 npm 或仅发 Desktop 都可能留下旧缓存继续生效。

**五次复发根因**（2026-06-04）：产品包迁到 main package + platform runtime 后，CLI 的 `hasPrebuiltStandalone()` 只检查 `_standalone/server.js`、版本 stamp、manifest 和首页 bundle，不检查 document extractor runtime。结果是 `_standalone` 缺少 `scripts/extract-pdf.cjs`、`scripts/extract-docx.cjs`、`__node_modules/pdfjs-dist/legacy/build/{pdf.mjs,pdf.worker.mjs}`、`__node_modules/mammoth/` 或 `__node_modules/word-extractor/` 时，CLI 仍会跳过重建并信任坏 runtime，用户上传 PDF 才看到 `Cannot find module 'pdfjs-dist/legacy/build/pdf.mjs'`，上传 Word 也可能遇到同类模块缺失。同时 `scripts/prepare-standalone.mjs` 曾把 `_standalone/scripts/` 当作 dev payload 删除，会让 spawned extractor 入口本身丢失。

**五次修复规则**：
1. `hasPrebuiltStandalone()` 必须把 document extractor runtime 文件纳入可用性判断；缺任一文件时返回 false，触发 fallback build / dependency repair。
2. `prepare-standalone.mjs` 必须保留 `_standalone/scripts/`，并在打包阶段 fail-fast 校验 `extract-pdf.cjs` / `extract-docx.cjs` 及其 parser packages。
3. child-process extractor 依赖不能只相信 Next trace；需要通过 runtime dependency seed 补齐 `pdfjs-dist`、`mammoth`、`word-extractor`，并在 Desktop runtime health contract 中同步登记。

**六次复发根因**（2026-06-05）：平台包 / static Web 启动路径改为 Product Server 后，`/api/extract-pdf` 和 `/api/extract-docx` 仍只存在于 Next.js route 中。`mindos start` 一旦因为 `static-web/index.html` 命中 `useProductServer()`，上传 PDF/DOCX 的请求就不再进入 Next route；Product Server 没有对应 handler 时返回 404，或在 runtime 不完整时仍可能表现为 `pdfjs-dist` 找不到。同时 `needsBuild()` 只要看到 static Web 或 matching `_standalone` stamp 就短路，也会信任缺 document extractor runtime 的坏产物。

**六次修复规则**：
1. `/api/extract-pdf` / `/api/extract-docx` 必须由 `@geminilight/mindos/server` 拥有，Web route 只做 adapter。
2. Product Server 的 document extractor handler 继续 spawn `extract-pdf.cjs` / `extract-docx.cjs`，但必须从 `runtimeRoot/_standalone/scripts/`、`runtimeRoot/packages/web/scripts/`、`$MINDOS_PROJECT_ROOT/packages/web/scripts/` 和 dev cwd fallback 中解析脚本。
3. Product Server spawn extractor 时必须补 `NODE_PATH`，覆盖 `_standalone/node_modules`、`_standalone/__node_modules` 和 `packages/web/node_modules`，否则 publishable `__node_modules` layout 下仍会找不到 `pdfjs-dist` / `mammoth` / `word-extractor`。
4. `needsBuild()` 和 Product Server 启动判断不能只看 static Web；static Web 必须搭配完整 document extractor runtime，缺失时 fallback build / Next path 不能被跳过。

### Vitest `vi.mock()` 工厂会被提升，引用顶层变量会直接炸掉 (2026-04-11)

**症状**：测试文件能过 TypeScript，但执行时直接报 `[vitest] There was an error when mocking a module`，并提示 `Cannot access 'xxx' before initialization`。

**根因**：`vi.mock()` 工厂会在模块顶层被 hoist；如果工厂里引用了测试文件里后定义的变量/类（即使肉眼看起来在前面），运行时仍会进入 TDZ。

**规则**：
- 需要在 mock 工厂里复用的 `fn` / class，优先放进 `vi.hoisted(() => ...)`
- 或把 mock 所需的最小 class/对象直接定义在工厂内部
- 不要在 `vi.mock()` 工厂中捕获普通顶层变量

**修复**：Quick Capture 测试改为 `vi.hoisted()` 托管 `getFileContent` / `saveFile` / `ApiError`，再由 mock 工厂引用。

### Plain JS CLI 直接 import app/*.ts 会在运行时炸掉 (2026-04-10)

**症状**：`node packages/mindos/bin/cli.js channel --help` 或其他 bin 命令在启动阶段直接报 `ERR_MODULE_NOT_FOUND` / `Unexpected token`，指向 `packages/web/lib/**.ts`。

**根因**：CLI 运行在原生 Node ESM 下，`packages/mindos/bin/*.js` 不经过 Next / tsx / ts-node 装载链；直接从 plain JS CLI import TypeScript 源文件会在运行时失败。

**规则**：
- `packages/mindos/bin/` 层优先保持纯 JS，可直接做文件 I/O、参数解析、轻量校验。
- 复杂 TypeScript 业务逻辑通过 app 内 API route / 子进程边界调用，不要从 `bin/*.js` 直接 import `app/**/*.ts`。
- 若 CLI 与 app 需要共享规则，优先抽数据常量或协议边界，避免共享需要 TS loader 的实现文件。

**修复**：本次 `mindos channel` 采用 `packages/mindos/bin/lib/channel-config.js` + `/api/channels/verify` 的分层方式：CLI 负责配置和 UX，Web app 负责真实凭证校验。


### DefaultResourceLoader.systemPromptOverride 闭包缓存陷阱 (2026-04-10)

**症状**：修改 `systemPrompt` 变量后追加内容（如 `<available_skills>` XML），但 LLM 始终看不到追加的内容。

**根因**：`systemPromptOverride: () => systemPrompt` 是闭包，但 `reload()` 调用时只执行一次并缓存结果到 `this.systemPrompt`。后续 `_rebuildSystemPrompt()` 调用 `getSystemPrompt()` 读取的是缓存值，不会重新执行闭包。

**修复**：在修改 `systemPrompt` 后再调用一次 `resourceLoader.reload()` 刷新缓存。

**规则**：凡是 `DefaultResourceLoader` 的 `*Override` 回调，都只在 `reload()` 时执行一次。如果需要动态修改 override 的返回值，必须在修改后重新调用 `reload()`。

### Non-streaming API fallback message format mismatch (2026-04-07)

**症状**：用户配置非官方 LLM API 代理（例：`https://api.ikuncode.cc/v1`），启用 non-streaming 模式后报错或返回错误内容。MindOS 内部 runNonStreamingFallback() 函数无法正确调用第三方 API。

**根因**：runNonStreamingFallback() 在将消息传递给 OpenAI 兼容 API 时，直接使用 pi-ai 格式的消息对象，而非 OpenAI 标准格式：
- pi-ai assistant message: `{ content: [{ type: 'text', text: '...' }, { type: 'toolCall', ... }] }`
- OpenAI format: `{ content: 'text', tool_calls: [{ id, type, function: { name, arguments } }] }`
- pi-ai toolResult: `{ toolCallId, content: [{ type: 'text', text: '...' }] }`
- OpenAI format: `{ tool_call_id, content: 'text' }`

rootcause: app/api/ask/route.ts:143 直接传递 llmHistoryMessages（pi-ai Message[]）给 runNonStreamingFallback()，未经格式转换。

**修复**：（app/api/ask/route.ts:408-477）
1. 新增 `piMessagesToOpenAI()` 函数，完整映射 pi-ai → OpenAI 消息格式
2. 在 runNonStreamingFallback() 入口调用该转换函数
3. 保证所有用户场景可用：文本、工具调用、工具结果、复杂对话历史

**验收标准**：
- ✅ 非流式纯文本提示
- ✅ 含工具调用的多轮对话
- ✅ 非官方 OpenAI 兼容代理（ikuncode、本地 llama.cpp 等）
- ✅ 所有消息类型（user/assistant/tool/system）



### 首次本地模式白屏（无/空 config + 未进 /setup）
- **现象：** 选「本地模式」后主窗口全白；`~/.mindos/config.json` 不存在，或存在但为空/坏 JSON/缺 `desktopMode`
- **原因：** 旧逻辑用 `isFirstRun && !existsSync` 决定是否打开 `/setup?force=1`；`saveDesktopMode` 只写了 `desktopMode` 未设 `setupPending`，与 Next 侧 `readSettings` 不一致；若 `config.json` 已存在但无效，会跳过模式选择并直接加载 `/`，易与空知识库/首启状态叠加为白屏
- **解决：** `needsDesktopModeSelectAtLaunch()` 覆盖空/坏文件；首次选本地且尚无 `mindRoot` 时写入 `setupPending: true`；`resolveLocalMindOsBrowseUrl()` 在 **`setupPending` 或配置里尚无 `mindRoot`/`sopRoot`** 时打开 `/setup?force=1`（与 Next `readSettings` 的 `mindRoot ?? sopRoot` 一致）；**重启服务 / 更新后恢复** 用 `loadURL(resolve…)` 代替裸 `reload()`，避免仍停在白屏页

### Next 生产进程绑定机器 hostname，`127.0.0.1` 健康检查永远超时
- **现象：** Desktop 或 `verify-standalone` 等不到 `/api/health`，但本机 `curl http://$(hostname):PORT/api/health` 有响应
- **原因：** Next 默认把监听地址设成 **系统 hostname**，未监听 loopback
- **解决：** Desktop `ProcessManager` 与 CLI `mindos start` 默认绑定 `127.0.0.1`，不要默认暴露到 `0.0.0.0`。需要局域网访问时，在设置页「安全」打开 `allowNetworkAccess`，重启后才绑定 `0.0.0.0`；高级部署仍可用 `MINDOS_WEB_HOST` 显式覆盖。

### Web 进程启动即崩溃，`waitForReady` 傻等 120 秒才报超时
- **现象：** Desktop 首次安装后报 "MindOS web server did not start within 120 seconds on port 3456"，但实际 Web 进程在数秒内就已崩溃退出
- **原因：** `waitForReady()` 只轮询 HTTP `/api/health`，**不检测子进程是否已死亡**。即使 Web 进程在第 1 秒就崩了（Gatekeeper 拦截、native 模块不兼容、.next 损坏等），也要等满 120 秒超时才返回错误
- **解决：** `waitForReady()` 同时监听 `webProcess.exit` 事件，进程死亡后给 crash handler 5 秒重试窗口（最多 3 次），若仍无法存活则立即终止等待、抛出包含 stderr 日志的错误信息。同时为 `spawn()` 添加 `error` 事件监听防止 ENOENT 导致 Electron 崩溃

### macOS Gatekeeper 隔离属性静默杀死下载的 Node.js 二进制
- **现象：** Desktop 下载私有 Node.js 到 `~/.mindos/node/` 后，spawn 的 Web/MCP 进程被 macOS 立即 SIGKILL，无任何错误输出
- **原因：** `downloadNode()` 通过 HTTPS 下载并解压 Node.js tar.gz，解压后文件带有 `com.apple.quarantine` 扩展属性；macOS Gatekeeper 对未签名的受隔离可执行文件执行静默拦截
- **解决：** `node-bootstrap.ts` 在 `chmodSync(nodeBin, 0o755)` 后，对 macOS 额外执行 `xattr -dr com.apple.quarantine` 清除整个 Node 目录的隔离标记

### `prepare-mindos-runtime` 把 `.next/dev` 打进安装包 → 体积暴涨
- **现象：** Desktop 内置 `mindos-runtime/app` 数百 MB，其中 `.next/dev` 占大头
- **原因：** Turbopack/开发会话会在 `app/.next/dev` 留下缓存；整目录拷贝 `app/.next` 时会一并带上
- **解决：** `copyAppForBundledRuntime` 排除 `.next/dev`（与 `.next/cache` 同理）；生产启动走 `standalone/server.js`，不依赖该目录

### `mindos.pid` 误判「CLI 已在跑」→ `ERR_CONNECTION_REFUSED` 白屏
- **现象：** 主窗口 `did-fail-load -102`；`http://127.0.0.1:3456/` 拒绝连接；删 `config.json` 仍白屏；可能伴随 `Bundled MindOS CLI not found (mindos-runtime/bin/cli.js)`
- **原因：** (1) `checkCliConflict()` 仅 `kill(pid,0)` 即假定 MindOS Web 已在 `config.port ?? 3456` 上监听，**未探测 `/api/health`**，陈旧 PID 或无关进程占位会导致假阳性；(2) `prepare-mindos-runtime` 未拷贝仓库 `bin/`，打包内缺少 `mindos-runtime/bin/cli.js`

### Core 更新下载在 Windows 上失败（ENOENT / All URLs failed）【已修复 v0.6.57】
- **现象：** Windows 用户点"更新"→ "All download URLs failed" 或 "ENOENT: no such file or directory, open 'C:\Users\...\runtime-download.tar.gz'"；重试也无法成功
- **根因：** (1) Windows 文件锁定：第一次下载失败后 `TARBALL_PATH` 可能无法被立即删除，重试时部分覆写导致状态混乱；(2) 错误信息丢失：所有 URL 失败时只返回泛泛的 "All URLs failed"，未记录具体错误（超时/404/DNS 等），难以诊断
- **解决：** (1) 下载前清理 tarball 时添加重试逻辑（最多 3 次，每次间隔 100ms）；(2) 在 `downloadFile()` 中用 `lastErr` 变量追踪最后错误，返回具体信息如 "All URLs failed: timeout"；(3) 增强日志，记录每次删除/重试的尝试
- **Ref:** `wiki/specs/spec-core-updater-bugfix.md`
- **解决：** 冲突分支在 `loadURL` 前 `verifyMindOsWebListening`（短重试）；`prepare-mindos-runtime` 在存在时拷贝 `bin/`；用户可手动删 `~/.mindos/mindos.pid` 后重开（仍建议用新版本逻辑自动回落到起本地服务）

### macOS：用户拖拽删除 .app 后残留进程、端口、PID 文件导致重装异常
- **现象：** 重装后端口跳到 3457、launchd daemon 无限重试、.next 构建缓存损坏、MCP 客户端配置失效
- **原因：** macOS 无卸载 hook；拖垃圾桶不触发任何清理。孤立的 Next.js/MCP 进程持续占端口；`desktop-children.pid`/`mindos.pid` 残留；launchd `com.mindos.app` 的 `KeepAlive.SuccessfulExit=false` 导致无限重启
- **解决：** `healPreviousInstallation()` 在每次 Desktop 启动时静默运行——停 launchd daemon、清理双 PID 文件（Desktop + CLI）、port-based fallback kill、等待端口释放（5s）、验证私有 Node.js 版本、验证 .next 构建缓存。端口偏移时自动更新 MCP 客户端配置。用户无感知。[spec](./specs/spec-desktop-reinstall-healing.md)

### 知识库路径配置在危险目录导致数据丢失风险【v0.6.77 修复】
- **现象：** 用户将知识库配置到安装目录（如 `D:\Program Files\MindOS\data`）、Electron userData（`%APPDATA%\MindOS`）、或系统管理目录（`~/.mindos/runtime`）后，重装/更新/卸载时知识库被清除
- **根因：** 
  1. Setup Wizard 没有验证 `mindRoot` 路径的安全性
  2. NSIS 卸载器执行 `RMDir /r $INSTDIR` 删除整个安装目录；Core Updater 会清理 `~/.mindos/runtime`
  3. 用户如果恰好把知识库放在安装目录子目录，则会跟着被删
- **解决（两层防护）：**
  - **第一层**（通用黑名单）：新增 `validateMindRootPath()` 函数（`app/api/setup/path-utils.ts`），拦截已知危险路径：Windows `%APPDATA%`/`Program Files` 等、macOS `.app` bundle、Linux `/opt/mindos` 等、跨平台 `~/.mindos/`
  - **第二层**（精确拦截）：Desktop 通过 `MINDOS_INSTALL_DIR` env 传递**真实安装目录**给 Web 进程，setup 校验时**拒绝用户把知识库设到安装目录或其子目录**（包括自定义安装到 D 盘等情况）
- **用户体验：** Setup Wizard 显示红色警告框，禁用 Next 按钮直到用户选择安全路径
- **测试：** `app/__tests__/api/setup-path-utils.test.ts`（26 条测试） + `desktop/src/process-manager-hostname.test.ts`（MINDOS_INSTALL_DIR 注入测试）
- **重装/更新安全性（已审计）：**
  - ✅ `~/.mindos/config.json`（含 mindRoot）不会因重装/更新/卸载而被删除
  - ✅ NSIS 卸载器只删 `$APPDATA\MindOS`（Electron 缓存），不涉及主目录
  - ✅ 核心热更新仅删 `~/.mindos/runtime/`，config.json 有白名单保护
  - ✅ 更新后系统自动恢复现有 mindRoot，无须重新配置
- **规则：** 用户知识库应放在 `~/MindOS/mind`（默认）、`~/Documents/` 或其他用户数据目录

### macOS：`file://…/app.asar` 内嵌页面 `ERR_FAILED`（connect / splash）
- **现象：** `did-fail-load` 指向 `…/app.asar/src/connect.html` 等；模式选择或远程连接窗口打不开
- **原因：** 部分环境下 Chromium 对 asar 内 `file://` 主文档或子资源加载不稳定
- **解决：** `electron-builder` `asarUnpack` 列出 `src/connect.html`、`src/splash.html`、`dist-electron/renderer/connect-renderer.js`、`dist-electron/preload/**`；运行时 `resolvePreferUnpacked()` 优先使用 `app.asar.unpacked` 下同路径；**connect / 模式选择页**用特权 scheme `mindos-connect://bundle/...` + `protocol.handle` + `net.fetch` 提供内容（避免 `file://` 仍 `ERR_FAILED`）；对应窗口 `webPreferences.sandbox: false`

### 内置 `mindos-runtime/mcp/node_modules` 在另一平台打包 → esbuild 报错

### SSH 隧道孤儿进程占端口
- **现象：** Desktop 崩溃或被 SIGKILL 后，SSH 隧道子进程继续运行。下次启动远程模式时端口被孤儿进程占用
- **原因：** `before-quit` cleanup 未能执行（崩溃时不触发 quit 事件），SSH 子进程是 detached 的不会随父进程退出
- **解决：** `SshTunnel.start()` 将子进程 PID 写入 `~/.mindos/ssh-tunnel.pid`；`stop()` 和 `exit` 事件清理 PID 文件；`main.ts` 启动时调用 `cleanupOrphanedSshTunnel()` 检查并杀掉残留进程

### `.next` 目录存在但构建不完整 → Web 连续崩溃 3 次
- **现象：** Desktop 启动报 "Could not find a production build in the '.next' directory"，Web 进程连崩 3 次后显示 "MindOS Service Crashed"
- **原因：** `analyzeMindOsLayout()` 和 `main.ts` 的 build 检查仅用 `existsSync('.next')` 判断是否需要构建。但 `.next` 目录可能因中断的构建、空目录或 npm 包残留而存在却不含有效产物（无 `BUILD_ID`、无 `standalone/server.js`）。`next start` 会因找不到 build ID 直接退出
- **解决：** 新增 `isNextBuildValid()` 检查 `.next/BUILD_ID` 或 `.next/standalone/server.js` 是否存在；`analyzeMindOsLayout` 和 `main.ts` 的 build 门控均改为调用 `isNextBuildValid()` 而非裸 `existsSync('.next')`；不完整构建会触发自动重建流程

### 重装/升级后旧 `.next` 导致 Web 连崩 3 次
- **现象：** 重装 MindOS Desktop 或 npm 升级后，Desktop 启动弹 "MindOS Service Crashed — Web 服务连续崩溃 3 次"
- **原因：** `isNextBuildValid()` 只检查 BUILD_ID/standalone 文件是否存在，不检查版本。重装后旧 `.next` 产物仍在，BUILD_ID 存在 → 跳过构建 → 新版源码 + 旧版 .next → 不兼容 → crash 3 次
- **解决：** 新增 `isNextBuildCurrent(appDir, projectRoot)` 严格检查：build 存在 + `.mindos-build-version` 版本标记匹配 `package.json` version。main.ts 启动前门控改用此函数。版本不匹配或无标记 → 自动触发重建。crash 对话框改为附带 stderr 最后 5 行帮助诊断
- **文件：** `desktop/src/mindos-runtime-layout.ts`, `desktop/src/main.ts`, `desktop/src/process-manager.ts`

### Web 连崩 3 次的运行时防御体系
- **背景：** 即使启动前检查通过，运行时仍可能因 OOM、端口冲突、磁盘满等原因连续 crash。原有的 crash 对话框只说"请检查 Node.js 环境"，用户无法自助定位
- **防御 1 — Crash 日志持久化：** `ProcessManager.logCrash()` 每次 crash 写入 `~/.mindos/crash.log`（时间戳 + exit code + signal + 最后 20 行 stderr），日志自动截断到 ~100KB
- **防御 2 — 多因诊断对话框：** crash 对话框根据 exit code 和 stderr 自动判断原因并给出针对性提示：
  - exit code 137/9 → "内存不足 (OOM)，尝试关闭其他应用"
  - stderr 含 ENOSPC → "磁盘空间不足，请清理磁盘"
  - stderr 含 EADDRINUSE → "端口被占用，请关闭占用端口的程序"
  - stderr 含 MODULE_NOT_FOUND → "构建产物过期，请运行 mindos start 重新编译"
  - 其他 → 通用提示 + 指向 `~/.mindos/crash.log`
- **防御 3 — 加长 respawn 间隔：** 从 1s/3s 改为 2s/5s，给 Web 进程更多恢复时间；`waitForPortOrFallback` 从 3s 改为 10s，减少 TCP TIME_WAIT 导致的连续 EADDRINUSE
- **文件：** `desktop/src/process-manager.ts`（logCrash + 延迟调整）, `desktop/src/main.ts`（诊断逻辑）

### 内置 `mindos-runtime/mcp/node_modules` 在另一平台打包 → esbuild 报错
- **现象：** Desktop 本地模式或 `mindos` CLI 起 MCP 时：`@esbuild/linux-x64` present but this platform needs `@esbuild/darwin-arm64`（或 win/linux 交叉）
- **原因：** `prepare-mindos-runtime` 在 Linux CI 上 `npm ci`，把当前平台的可选原生包装进 zip；Mac/Win 用户解压后二进制不匹配
- **解决：** `prepare` 在 `mcp/` 写入 `.mindos-npm-ci-platform`（如 `linux-x64`）；`ProcessManager.start()` 调用 `ensureBundledMcpNodeModules()`：与 `process.platform-arch` 不一致（或启发式发现错误 `@esbuild/*`）时删掉 `mcp/node_modules` 并在本机再跑 `npm ci --omit=dev`（用 Desktop 自带的 Node）；根本方案也可改为在目标 OS 上执行 `prepare-mindos-runtime`

### Desktop 模式下 Settings → Update 执行 npm update 无效
- **现象：** 用户在 Desktop 点「Update」，npm 更新了全局包，但 App 内置的 `mindos-runtime` 不变，重启后版本未升
- **原因：** Desktop 走 bundled standalone runtime（只读 `.app` 内），npm install 写到另一个路径；且 `process.cwd()` 在 standalone 下指向 `.next/standalone/`，CLI 路径也不对
- **解决：** `UpdateTab` 检测 `window.mindos`（Electron preload bridge），存在时走 `electron-updater`（IPC `check-update` / `install-update`），不走 npm API；浏览器/CLI 模式保持原有 npm 更新。CI 的 `build-desktop.yml` 用 `--publish always` 让 electron-builder 自动生成 `latest-mac.yml` 等描述文件并上传 GitHub Release，electron-updater 才能正常工作

### Desktop electron-updater 三个缺陷
- **现象 1：** `install-update` IPC handler 出错后渲染端停在 'downloading' 转圈状态，无错误提示
- **原因：** handler 内 catch 调用 `dialog.showErrorBox()` 但没有 re-throw，IPC 返回成功，渲染端 `handleInstall` 的 catch 永远不触发
- **现象 2：** 「Restart Now」按钮点击后若失败，无任何反馈（unhandled promise rejection）
- **原因：** `onClick={() => bridge.installUpdate()}` 没有 `.catch()`，错误被静默吞掉
- **现象 3：** 点「Restart Now」时虽然 update 已下载完成，仍会重新调用 `downloadUpdate()` 再走一遍下载
- **原因：** `install-update` handler 无条件调用 `downloadUpdate()` + `quitAndInstall()`，不判断是否已下载
- **解决：** ① 移除 handler 内 try-catch 让错误自然传播到渲染端处理；② 渲染端「Restart Now」按钮加 async/catch 错误处理；③ 用 `isDownloaded` 标志跳过已完成的下载。测试见 `app/__tests__/settings/update-tab-desktop.test.tsx`

### CLI/Web 更新 buildIfNeeded 失败导致服务不可恢复
- **现象：** 用户在 Web UI 点「Update」，npm 安装成功但 `next build` 失败（OOM/磁盘满），旧服务已被杀死，新服务未启动，浏览器卡在"正在重启"5 分钟后超时，用户必须手动 `mindos start`
- **原因：** `bin/cli.js` update 命令的 daemon 和 non-daemon 两条路径中，`buildIfNeeded()` 没有 try-catch。`stopMindos()` 已杀旧进程后若 build 抛异常，整个 update 进程崩溃，不会走到 Stage 4 (restart)
- **解决：** 三个 `buildIfNeeded()` 调用全部加 try-catch；catch 后仍然继续启动服务（`mindos start` 有自己的 build-on-startup 逻辑，可以重试）；失败信息写入 `update-status.json`，浏览器能立即显示具体错误而非等 5 分钟超时

### "假更新"：更新后服务仍运行旧版本代码（2026-04-06 修复）
- **现象：** Web UI 点「Update」，进度条走完提示成功，但页面功能/内容仍是旧版本。`/api/update-check` 报新版本号，但实际代码行为不变
- **原因（三重叠加）：**
  1. **环境变量泄漏**：`/api/update/route.ts` 和 `update.js` spawn 新进程时只删了 5 个特定 env var（`MINDOS_WEB_PORT` 等），遗漏了 `MINDOS_PROJECT_ROOT`、`MINDOS_CLI_PATH` 等关键路径变量。新进程继承旧路径 → 从旧安装目录读代码
  2. **孤儿进程**：`stopMindos()` 发 SIGTERM 后不等待确认，Next.js worker 进程忽略 SIGTERM 继续占端口。新进程无法绑定或被路由到旧 worker
  3. **就绪检查不验证版本**：`waitForHttp()` 只检查 `/api/health` 返回 HTTP 200，不验证是否是新版本。旧 worker 响应 health check → 误判更新成功
- **解决（四层防御）：**
  1. **`bin/lib/clean-env.js`**：新建通用 helper，遍历删除所有 `MINDOS_*`/`MIND_*` 前缀 + `AUTH_TOKEN`/`WEB_PASSWORD`/`NODE_OPTIONS`。`update.js`、`/api/update/route.ts`、`/api/restart/route.ts` 统一使用
  2. **`bin/lib/stop.js` SIGKILL fallback**：SIGTERM 后等 2s（`Atomics.wait` 跨平台），检查进程是否存活 → 仍活则 SIGKILL。`killTree()` 和 `killByPort()` 均增加此逻辑
  3. **`bin/lib/gateway.js` 版本感知就绪检查**：`waitForHttp()` 新增 `expectedVersion` 参数。health check 通过后，额外查 `/api/update-check` 确认 `current === expectedVersion`。版本不匹配视为旧进程，继续等待
  4. **端口释放双重确认**：`update.js` 停止旧进程后，端口"空闲"后再等 1s 复查，避免 TCP TIME_WAIT 闪烁假阴性。超时则 force-kill
- **反思**：
  - `childEnv` 清理应该用"白名单"（只保留需要的）或"黑前缀"（删所有自定义前缀），而非"黑名单"（逐个删）。黑名单永远跟不上新增变量
  - `waitForHttp` 从一开始就应该验证版本，不应假设"HTTP 200 = 新版本就绪"
  - 进程清理必须有 SIGKILL 后备，SIGTERM 不保证进程响应
- **文件：** `bin/lib/clean-env.js`（新建）, `bin/lib/stop.js`, `bin/lib/gateway.js`, `bin/commands/update.js`, `app/app/api/update/route.ts`, `app/app/api/restart/route.ts`

### Diff 仅做插件入口，用户看不到全局变化
- **现象：** 只有打开 `Agent-Diff.md` 才能看到差异；普通编辑流里不知道哪里变了、何时变了
- **原因：** Diff 依赖 renderer + markdown fenced block（`agent-diff`），缺少主程序级事件流和全局未读提醒
- **解决：** 升级为主程序能力：统一写入 `.mindos/change-log.json`，提供 `/api/changes`（summary/list/mark_seen）、全局提醒条与 `/changes` 下钻视图；Diff 插件仅作兼容，不再是主入口

### Ask 对话执行中输入被禁用，无法提前草拟下一步
- **现象：** Agent 正在执行时，输入框不可编辑；用户只能等待执行结束后再输入下一步
- **原因：** `AskContent` 在 `isLoading` 时给 input/textarea 加了 `disabled`，把“发送中”与“不可输入”错误耦合
- **解决：** 执行中仍允许输入；仅阻止并发 submit，不阻断草拟。并在 footer 提示“可先输入下一步”，降低等待焦虑并提升连续操作体验

### 移动端 Chat 重试不能丢附件上下文（2026-04-10）
- **现象：** 用户给消息附加知识库文件后发送失败，点 Retry 只重发文本，不再带附件路径，导致 AI 第二次看到的上下文和第一次不一致
- **原因：** `useChat` 只记录 `lastFailedMessage`，没有同时记录 `lastFailedAttachments`；UI 层在发送开始后会清空附件 chips，更放大了这个问题
- **解决：** `useChat` 同时持久化 `lastFailedAttachments` 并在 `retry()` 时一并传回 `send()`；发送链路里不要假设“重试只需要文本”

## CLI

### npm 全局安装缺 node_modules
- **现象：** `mindos mcp -g -y` → `ERR_MODULE_NOT_FOUND`
- **原因：** npm global install 不包含 devDependencies 和被 `.npmignore`/`files` 排除的目录
- **解决：** `spawnMcp()` 改为使用正确路径 + MCP 命令加 first-run auto-install (`ensureAppDeps()`)

### MCP CLI 命令路由 4-bug 链
- **现象：** 一个 `ERR_MODULE_NOT_FOUND` 背后串联 4 个 bug
- **Bug 链：** (1) node_modules 缺失 → (2) `process.argv[3]` 是 `-g` 不是 `install`，路由到 MCP server → (3) `-y` 跳过了 agent 选择（应强制弹出）→ (4) args 解析起始位置基于 sub 不同而不同
- **教训：** 用户报一个症状，沿调用链至少查 3 层

### JSDoc / 块注释里出现字面量 `/*` → `.js` 整文件解析失败
- **现象：** 如 `mindos onboard` 报 `SyntaxError: Unexpected token ')'`，栈指向含「JSONC、注释」说明的注释行
- **原因：** `/** … /* … */` 中内层 `/*` 会提前结束块注释，后续代码裸露
- **解决：** 注释说明里避免未转义的 `/*` 序列（改用「块注释」「slash-star」等文字描述）

### cleanNextDir() 必须清理完整 .next
- **现象：** 构建缓存导致 stale artifact 错误
- **解决：** 清理整个 `.next` 目录，不做选择性清理

### `mindos ask` 旧版发送 `{ question }` 格式，API 不识别
- **现象：** `mindos ask "xxx"` 无响应或报错（API 返回 SSE 但 CLI 尝试 `res.json()` 解析）
- **原因：** API `/api/ask` 期望 `{ messages: [{role:'user',content:'...'}], mode:'chat'|'agent' }` 格式，旧版 CLI 发送的 `{ question }` 不被识别，且无 SSE 流式处理
- **解决：** CLI `ask` 和 `agent` 命令已改用正确的 `messages` 数组格式 + SSE 流式读取
- **教训：** CLI 与 API 的 contract 必须同步演进；API 签名变更后需检查所有调用方

### npx next 会拉全局缓存版本导致 Web UI 崩溃
- **现象：** `mindos start` 后 Web UI 立即崩溃，报 `TypeError: Cannot read properties of undefined (reading 'map')`
- **原因：** `npx next start` 不保证用本地 `node_modules` 的版本。如果用户全局 npx 缓存里有更高版本的 Next.js（如 16.2.0），而 build 产物是本地 16.1.6 编译的，版本不匹配导致运行时崩溃
- **解决：** `bin/cli.js` 中定义 `NEXT_BIN = resolve(ROOT, 'app', 'node_modules', '.bin', 'next')`，所有调用直接用绝对路径，彻底绕开 npx/npm exec 的解析逻辑
- **注意：** `npm exec -- next` 和 `npx next` 在 npm 7+ 中本质是同一个东西（npx 是 npm exec 的别名），解析逻辑相同，都不可靠。直接引用 `.bin/next` 是唯一确定的方式
- **防护：** 无自动化测试可覆盖此问题（依赖用户环境），靠此记录防止回归

## 前端

### dangerouslySetInnerHTML 渲染 AI / Markdown 输出前必须先转义原文（2026-05-10）

- **现象：** Timeline、Summary、Skill detail 这类轻量 Markdown renderer 先做 Markdown 替换，再直接 `dangerouslySetInnerHTML`，如果原文包含 `<script>`、`<img onerror>` 或 `javascript:` 链接，会把不可信内容带入 DOM。
- **根因：** 这些 renderer 不是通用 Markdown 引擎，也没有 sanitizer；正则替换只处理少数 Markdown 语法，不会自动转义普通 HTML 或校验链接协议。
- **解决：** 统一在 Markdown 替换前对原始文本做 `escapeHtml()`；属性值用 `escapeAttribute()`；链接 href 走 `safeHref()` 白名单（`http(s)`、`mailto`、站内路径和 hash），不合规则降级为 `#`。
- **Browser Extension 例外注意：** popup 里的目录名来自 MindOS API，必须用 `textContent` + `createElementNS` 组装图标，不能为了 SVG 图标方便把 `${childName}` 插进 `innerHTML`。
- **Desktop 例外注意：** Electron connect 窗口展示 build/install stderr 时，保留 `<small>` 样式也必须用 DOM 节点 + `textContent`，不要把 stderr 拼进 `innerHTML`。
- **Tauri 例外注意：** Tauri connection timeout / retry UI 也要用 `replaceChildren()` + `textContent` + `addEventListener()`，不要用 `innerHTML` 拼按钮或写 `onclick=`。
- **Obsidian 兼容层注意：** community plugin 传入的 ribbon icon 参数是插件输入，只能当 icon name / text token 处理，不能直接 `innerHTML`。
- **规则：** 新增 `dangerouslySetInnerHTML` 必须满足二选一：输入来自可信静态模板，或先经过明确的 escape/sanitize helper，并补一条包含 HTML 注入和危险链接的回归测试。
- **验证：** `packages/web/__tests__/renderers/generated-html-safety.test.ts` 覆盖 Summary、Timeline 和 Skill detail 的 HTML 转义与危险链接降级；`packages/web/__tests__/obsidian-compat/component-plugin.test.ts` 覆盖 plugin ribbon icon 输入；`tests/browser-extension-popup-safety.test.ts`、`tests/desktop-connect-renderer-safety.test.ts`、`tests/desktop-tauri-connect-safety.test.ts` 覆盖 app-specific DOM 渲染回归。

### 渠道详情页若只展示配置表单，用户会误解为“聊天页”或“不知道下一步做什么”
- **现象：** 用户点击 Feishu / Telegram 这类 Channel 后，会问“我能在这里聊天吗？”“这个页面到底是干嘛的？”
- **原因：** 页面只展示凭证表单和 test send，缺少用途说明、运行状态、最近活动，无法建立“消息投递渠道”的正确心智模型
- **解决：** Channel detail 首屏必须先回答 3 个问题：**这是干嘛的、它在不在工作、我下一步做什么**。具体做法：
  1. 顶部增加 `How it works` / 用途说明，明确“不是聊天收件箱”
  2. 增加 `Status summary`，展示最近活动、最近成功/失败、能力摘要
  3. 增加 `Recent activity`，让用户知道系统真的在工作
  4. 把凭证维护下沉到 `Settings`，不要让配置表单成为页面主角

### 飞书 webhook 协议层不要手搓，优先交给官方 SDK（2026-04-11）
- **现象：** 业务代码里手写 challenge 返回、verification token 比较、payload 解密和验签，导致逻辑重复、可测但偏离官方集成模式
- **原因：** 把协议层和业务层混在一起了；官方 `@larksuiteoapi/node-sdk` 已提供 `EventDispatcher`、`generateChallenge`、decrypt 和验签能力
- **规则：** Feishu 集成优先分两层：
  1. **SDK 接入层**：challenge / 验签 / decrypt / event dispatch
  2. **MindOS 业务层**：@mention 过滤、标准化、会话历史、Agent 编排、回复发送
- **修复：** 将 `/api/im/webhook/feishu` 改为委托 `app/lib/im/feishu-dispatcher.ts`，保留 `app/lib/im/webhook/feishu.ts` 作为业务层
- **补充：** 本地验证时优先用飞书 **Long Connection**。MindOS 现在同时支持 `webhook` 和 `long_connection` 两种 transport；本地开发若还选 webhook，通常会误以为“功能坏了”，本质上只是缺公网可达地址。
- **文件参考：** `app/components/agents/AgentsContentChannelDetail.tsx`, `app/lib/im/platforms.ts`, `app/lib/im/activity.ts`

### Secret 输入框不能用占位符回写真实值（2026-04-11）
- **现象：** 用户打开已配置的 secret 字段（如 Feishu Encrypt Key / Verification Token），输入框里若显示 `••••••••` 之类的占位符，点击保存后可能把占位符本身写回配置文件
- **原因：** 前端把“已隐藏的展示占位符”当成真实值保存在 state 中，提交时又原样发送给 API
- **解决：** secret 字段默认保持空值；UI 只通过 placeholder / hint 表示“已保存值存在”；提交时只有用户真的输入了新值才发送，空值必须走 `undefined` 保持后端原值
- **文件参考：** `app/components/agents/AgentsContentChannelDetail.tsx`, `app/app/api/im/config/route.ts`

### Emoji Hydration Mismatch（Twemoji 浏览器扩展）
- **现象：** SSR 渲染的 emoji 文本（如 `🎯`、`🚀`）在客户端被 Twemoji 等浏览器扩展替换为 `<img>` 元素，触发 React hydration error：`Hydration failed because the server rendered text didn't match the client`
- **原因：** 浏览器扩展在 React hydration 之前修改 DOM，将 emoji 文本节点替换为 `<img src="...twemoji...">`，导致 SSR HTML 与客户端 DOM 不一致
- **已踩坑位置：** HomeContent.tsx Space 卡片描述（v1）、DiscoverPanel.tsx Section icon（v2）、UseCaseCard.tsx emoji icon
- **解决：** 所有包含 emoji 的 `<span>` 必须加 `suppressHydrationWarning`
- **规则：** 凡是 JSX 中直接渲染 emoji 字符的元素，**一律加 `suppressHydrationWarning`**。新增 emoji 渲染时必须检查此规则，不要等报错再修
- **检查方法：** `grep -rn 'emoji\|📝\|🎯\|🚀\|👤\|📥\|🔄\|🔁\|💡\|🤝\|🛡️\|🧩\|⚡\|🧠\|🕐' --include='*.tsx' | grep -v suppressHydrationWarning`

### AI `<thinking>` 标签泄露给终端用户 ✅ 已解决
- **现象：** AI Organize 完成后，Modal 里直接显示了 AI 内部推理过程 `<thinking>The user wants me to read the uploaded PDF file...`
- **原因：** `useAiOrganize` 的 `consumeOrganizeStream` 把所有 `text_delta` 事件无差别拼入 `summary`。当模型未开启 extended thinking（Anthropic `thinking_delta` 事件）而是在 text 中直接输出 `<thinking>` XML 标签时，原始推理过程被当作用户可见文本
- **解决：** 新增 `stripThinkingTags()` 函数，在 stream 消费结束后清洗 `<thinking>...</thinking>` 块和未闭合的 trailing tag；"无更改"状态下不再展示 summary（AI 的技术描述对用户无价值）
- **规则：** 任何面向终端用户的 AI 输出展示，都必须过滤 `<thinking>`、`<reasoning>`、`<scratchpad>` 等模型内部标签。不能直接 `.slice(0, 300)` 截断展示
- **文件：** `app/hooks/useAiOrganize.ts`、`app/components/ImportModal.tsx`

### Modal 标题在 error 状态下仍显示 "完成" ✅ 已解决
- **现象：** AI Organize 失败时，Modal 标题显示"整理完成"但内容显示"整理失败" + 错误信息，矛盾混淆用户
- **原因：** `isOrganizeReview` 状态在 success 和 error 时都为 true，标题只按 step 判断（`organizeReviewTitle`），未区分 `aiOrganize.phase` 是 `'done'` 还是 `'error'`
- **解决：** 标题逻辑增加 phase 判断：`phase === 'error'` 时显示 `organizeErrorTitle`（"整理失败"），否则显示 `organizeReviewTitle`（"整理完成"）；同时移除 body 中重复的错误标签
- **规则：** 当同一个 UI step 同时承载 success 和 error 两种状态时，所有展示元素（标题、图标、描述）都必须根据实际状态分支渲染，不能只用一套文案
- **文件：** `app/components/ImportModal.tsx`、`app/lib/i18n-en.ts`、`app/lib/i18n-zh.ts`

### AI Organize 撤销生命周期与 Modal 耦合 ✅ 已解决
- **现象：** 用户点 "View file" 后 Modal 关闭，撤销机会丢失；update 操作无法撤销；用户浏览文件期间 3 分钟后无法再撤销
- **原因：** 撤销状态（`useAiOrganize` hook）声明在 `ImportModal` 组件内部，Modal 关闭即销毁状态。update 文件无快照存储
- **解决：** 将 `useAiOrganize` 提升到 `SidebarLayout` 级别，新增独立 `OrganizeToast` 组件。update 操作在 `tool_start` SSE 事件时异步抓取文件快照（`captureSnapshot`）。Toast 独立于 Modal 存在，3 分钟自动消失但用户交互会重置计时器
- **规则：** 跨生命周期的状态（如撤销数据）不能绑定在可能随时卸载的组件（Modal/Popover）中。应提升到持久化容器或全局 store
- **文件：** `app/hooks/useAiOrganize.ts`、`app/components/OrganizeToast.tsx`、`app/components/SidebarLayout.tsx`

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
  3. `SidebarLayout.tsx` 通过 `/api/tree-version` 轮询触发 `router.refresh()`，并广播 `mindos:files-changed`
- **注意：** `export const dynamic = 'force-dynamic'` 只对 page/route 有效，对 layout.tsx 无效
- **规则：** 凡是新增文件写操作的 API route，必须调用 `revalidatePath('/', 'layout')` 来通知 layout 刷新 file tree

### Sidebar 按钮既当“面板开关”又当“内容路由”会导致状态漂移
- **现象：** 点击 Activity Bar 的 `Agents` 后，左侧面板状态与内容路由不同步，出现按钮高亮但打开了旧 panel，或进入内容页却仍保留右侧详情 dock
- **原因：** 同一个入口同时承担两种语义（toggle panel + navigate route），并且共享 `activePanel` 状态
- **解决：** `Agents` 入口统一语义为“内容路由”到 `/agents`，面板逻辑降级为兼容层；高亮与路由联动（`pathname.startsWith('/agents')`）
- **规则：** 一个导航入口只做一种语义。若迁移过程中保留旧实现，必须显式定义兼容期和退场时间线

### Agents Dashboard 在技能规模增大时的信息过载
- **现象：** Skills 页在技能数量增长后（例如 >100），首屏同时展示分组与全量条目，用户很难快速定位目标
- **原因：** 缺少检索和维度过滤，兼容矩阵默认展开会进一步放大认知负担
- **解决：** 引入 `search + source filter + matrix accordion` 组合：先筛选再展开矩阵；矩阵默认折叠，仅在需要时展开
- **规则：** Dashboard 中高密度数据默认“渐进披露”而非“首屏全量渲染”；优先提供过滤入口，再提供明细视图

### Agents Sidebar Hub 行为与 Content 信息架构不一致
- **现象：** Sidebar 里的 `MCP/Skills` 看起来像一级导航，但点击后分别跳到 Settings 或面板内滚动，用户难以形成稳定心智模型
- **原因：** Hub 行为同时承担“导航”和“局部动作”，入口语义不统一
- **解决：** Hub 三行统一改为内容页深链：`/agents`、`/agents?tab=mcp`、`/agents?tab=skills`；局部动作保留在具体页面内部
- **规则：** 当某行 UI 呈现为导航样式（icon + title + chevron）时，必须跳转到与标题同名的信息架构层级，不应偷偷执行异质动作

### Skills 矩阵被误解为“可按 Agent 单独开关”
- **现象：** 用户看到 `Skill x Agent` 矩阵后，预期可在单元格级别独立启停；实际切换仍是全局 skill 开关
- **原因：** 当前数据模型只有 `SkillInfo.enabled`（全局），不存在 per-agent assignment 字段
- **解决：** 在 P1.7 将矩阵定位为“兼容与覆盖视图”，只提供 Agent 聚焦与状态展示；可编辑动作保留在全局 skill 级。若要单元格编辑，需先扩展后端模型与 API
- **规则：** UI 能力必须与数据模型能力严格对齐。展示矩阵不代表支持矩阵级写操作；没有后端语义支撑时，只做可视化不可做误导性交互

### MCP 管理只做单行操作，导致多 Agent 恢复效率低
- **现象：** 当多个 Agent 同时异常（如 detected/notFound），用户需要逐行点击 reconnect，恢复流程慢且反馈分散
- **原因：** 旧 MCP 页面缺少批量动作与执行摘要，只提供单 Agent 级别操作
- **解决：** 在 P1.8 增加“筛选结果批量重连 + 成功/失败摘要”，并引入传输筛选和风险队列，形成“定位 -> 批量修复 -> 验证”的单页闭环
- **规则：** 多 Agent 管理页必须提供批量恢复能力；没有批量动作时，至少要有可复制执行计划与统一反馈，避免用户手工重复点击

### Agents Sidebar 行项同时承担“开抽屉”和“进内容页”会造成路径分叉
- **现象：** 用户在 Sidebar 点击 Agent 后，有时进入右侧详情抽屉，有时进入 Content 路由，导致“详情到底在哪看”认知混乱
- **原因：** 同一个 UI 行项绑定了两种导航语义（局部抽屉状态 + URL 路由）
- **解决：** 在 P1.9 将 Agent 行点击统一为 `/agents/[agentKey]` 路由；右侧抽屉保留兼容代码但不再作为主入口
- **规则：** 同一层级导航项只能有一个主语义。若信息是“完整详情”，必须放在可回退、可分享、可刷新的内容路由中

### 把进程级统计误当成 Agent 原生运行统计
- **现象：** 在 Agents 页面把 `/api/monitoring` 的 token/request 累计直接当作单个 Agent 的 usage，导致“某个 Agent 高活跃”结论失真
- **原因：** `metrics.ts` 是 MindOS 进程级聚合，不等于 `~/.claude`、`~/.codex` 等 Agent 隐藏目录里的原生会话/usage 证据
- **解决：** 明确拆两层信号：进程级指标继续走 `/api/monitoring`；Agent 级运行迹象通过隐藏目录扫描信号（conversation/usage/last activity）展示
- **规则：** 任何 Agent 级可视化必须标注数据来源层级（MindOS runtime vs Agent hidden folder），避免混用口径

### Agent Detail 只展示 enabled skills，导致“信息量几乎为零”
- **现象：** 详情页只列出启用技能，禁用技能/来源/编辑入口全部不可见；用户误判为“没有配置”
- **原因：** UI 直接使用 `skills.filter(enabled)`，把“状态维度”当成“数据集维度”，丢失全量配置上下文
- **解决：** 详情页改为全量 skills 视图（搜索 + source 过滤 + 启停 + user skill 编辑），并补充 MCP 管理区（scope/transport 应用、snippet 复制、刷新）
- **规则：** 管理页默认应展示“全量配置 + 状态标签”，而不是先裁剪后展示；状态属于筛选器，不属于数据源定义

### Agent 详情使用全局 catalog 冒充“该 Agent 已安装项”
- **现象：** 页面显示了 skill 管理控件，但用户仍看不出某个 Agent 在其隐藏目录里到底安装了哪些 skills、配置了哪些 MCP servers
- **原因：** 数据源来自全局 `/api/skills` 与 `mindos` 单条安装检测，缺少对 agent 原生目录与配置文件的全量扫描结果
- **解决：** `/api/mcp/agents` 增加 `configuredMcpServers` 与 `installedSkillNames`（含来源路径），详情页单独展示“agent native installed”区块并提供空态/数量反馈
- **规则：** “已安装/已配置”必须来自 agent 原生配置扫描；“可用 catalog”仅作管理参考，不能替代真实安装态

### Agents 页面只有局部指标，切 tab 后丢失全局状态
- **现象：** 用户在 MCP/Skills/Detail 间切换时，需要反复重新判断“现在整体健康度如何”，容易漏掉风险项
- **原因：** 指标只散落在各区块，没有稳定的全局摘要层，信息架构停留在“平面卡片堆叠”
- **解决：** 在 `/agents` 顶部增加统一 Workspace Pulse（connected/detected/notFound/risk/enabled skills），各子页再补筛选摘要和健康条，形成“摘要→操作→明细”三层结构
- **规则：** 多 Agent 控制台必须始终保留全局状态入口；tab 内区块只承载局部操作，不应承担全局态心智负担

## MCP

### 删除文件的入口不一致——部分走回收站、部分硬删 ✅ 已解决
- **现象：** Web UI 删除文件进回收站可恢复，但 MCP `mindos_delete_file` 和 AI Agent `delete_file` 工具做永久硬删除，数据无法恢复
- **原因：** Tier 1 Trash 功能实现时只改了 Server Actions（Web UI 入口），漏了 API route `POST /api/file` 的 `delete_file` op 和 Agent tools
- **解决：** API route 和 Agent tools 的 `delete_file` 统一改为调用 `moveToTrashFile()`，返回 `trashId`。MCP 工具描述同步更新
- **规则：** 同一语义操作（如"删除"）的所有入口必须走同一实现路径。新增入口时全局搜索同操作的其他入口，确认行为一致
- **文件：** `app/app/api/file/route.ts`、`app/lib/agent/tools.ts`、`mcp/src/index.ts`

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
- **解决：** `model.ts` 检测 `hasCustomBase` 时设保守 compat（`supportsStore: false, supportsDeveloperRole: false, supportsUsageInStreaming: false`），但 **不覆盖 `maxTokensField`** —— 交给 pi-ai 根据 URL 自动检测（默认 `max_completion_tokens`）
- **规则：** 自定义 OpenAI 代理默认走最保守兼容配置，但 `maxTokensField` 由 pi-ai 框架自动检测，禁止手动覆盖
- **文件：** `app/lib/agent/model.ts`

### API Key 测试通过但聊天失败（test-key / chat 代码路径分叉）
- **现象：** Settings 页 Test Key 显示 ✅ 成功，但实际发消息时返回 "AI 未返回响应"
- **原因：** `test-key` API 曾用独立的 `fetch()` 实现（直接调 provider HTTP API），而聊天走 `pi-ai.complete()` + `getModelConfig()`。两条路径的 model 构造、compat flags、base URL 解析、认证方式全部不同。测试时用对了参数不代表聊天也对
- **解决：** `test-key/route.ts` 完全重写为使用 `pi-ai.complete()` + `getModelConfig(overrides)`，与聊天路径 100% 共享 model 构造逻辑。新增 `ModelConfigOverrides` 接口允许临时传入未保存的 apiKey/model/baseUrl
- **规则：** API 连通性测试必须与实际功能调用走同一代码路径。测试接口不能自建 HTTP 调用
- **文件：** `app/app/api/settings/test-key/route.ts`、`app/lib/agent/model.ts`

### Multi-Provider 配置：新增 Provider 必须注册到 PROVIDER_PRESETS
- **现象：** 新增 AI Provider 后 UI 不显示、测试/聊天不工作
- **原因：** 所有 Provider 的 UI/UX 元数据（name、defaultModel、signupUrl、supportsThinking、category 等）集中在 `PROVIDER_PRESETS`。技术细节（baseUrl、API 协议、env 变量映射、compat flags）则委托给 pi-ai 框架
- **规则：** 新增 Provider 步骤：(1) `providers.ts` 添加 `ProviderId` union + `PROVIDER_PRESETS` entry（仅 UI 元数据） (2) 确认该 provider 在 pi-ai 的 `getModels()` 注册表中存在（若不存在，如 DeepSeek，需设 `piProviderOverride` + `fixedBaseUrl`） (3) 设置正确的 `category`（primary/secondary/advanced） (4) 若 pi-ai 的 `getEnvApiKey()` 不覆盖该 provider，在 `EXTRA_ENV_KEYS` 中补充
- **文件：** `app/lib/agent/providers.ts`

### gpt-5.4 等新模型拒绝 max_tokens 参数（禁止重复造轮子）
- **现象：** gpt-5.4 配合中转站使用时，连接测试返回"测试失败"，聊天也无法工作
- **原因：** gpt-5.4/o1/o3 系列模型要求使用 `max_completion_tokens` 而非 `max_tokens`。我们曾在 `model.ts` 中强制覆盖 `maxTokensField: 'max_tokens'`，但 pi-ai 框架已内置基于 URL 的自动检测逻辑（默认 `max_completion_tokens`），我们的覆盖反而破坏了它。同时还曾为此构建了非流式回退路径（~150 行），但实际上所有现代代理都支持流式
- **解决：** (1) model.ts 删除 `maxTokensField` 覆盖，完全交给 pi-ai 自动检测 (2) test-key 的 OpenAI 测试请求不发 token 限制参数 (3) 删除整个非流式回退路径（`directNonStreamingCall`、`handleNonStreaming`、`streamingBlacklist`），完全复用 pi-ai 流式路径 (4) 删除 `useStreaming` 配置项和 UI 中的 streaming 检测逻辑
- **规则：** 禁止在 model.ts compat 中覆盖 `maxTokensField`（pi-ai 已处理）。禁止自建非流式回退（所有代理都支持流式）。test-key 只做连通性 + 工具兼容性测试，不测流式
- **文件：** `app/lib/agent/model.ts`, `app/app/api/settings/test-key/route.ts`, `app/app/api/ask/route.ts`

### pi-ai openai-completions vs openai-responses — 代理 API 选择
- **现象：** 配了 OpenAI 兼容代理，Agent 请求 `/responses` 端点被 403 拒绝
- **原因：** pi-ai 默认用 `openai-responses` API（请求 `/responses`），多数代理只支持 `/chat/completions`
- **解决：** `model.ts` 检测 `hasCustomBase` 时默认用 `openai-completions`（对应 `/chat/completions`）
- **规则：** 有自定义 baseUrl → `openai-completions`；无 baseUrl（直连 OpenAI）→ `openai-responses`
- **文件：** `app/lib/agent/model.ts`

### piProviderOverride 导致 API Key 查找不命中（#23）
- **现象：** 用户配置 DeepSeek/Ollama/zai-cn 后，对话报错 "No API key found for openai"
- **原因：** `ask/route.ts` 调用 `authStorage.setRuntimeApiKey(provider, apiKey)` 时 `provider` 是 MindOS ProviderId（如 `"deepseek"`），但 pi-coding-agent 内部通过 `model.provider` 查找 API key，而 `model.provider` = `toPiProvider(provider)`（如 `"openai"`）。存储和查找使用了不同的 key
- **解决：** 改为 `authStorage.setRuntimeApiKey(toPiProvider(provider), requestApiKey)`，确保存储 key 与查找 key 一致
- **规则：** 所有传给 `pi-coding-agent` / `pi-ai` 的 provider 标识符必须经过 `toPiProvider()` 转换。MindOS ProviderId 仅用于 UI 层和 settings 层
- **文件：** `app/app/api/ask/route.ts`

### Provider override 传协议 ID 时误读 activeProvider（#24）
- **现象：** Settings 页 Test Key 可通过，但聊天实际走错 provider，常见表现是自定义 OpenAI 兼容网关返回 `please auth first`、`auth first`，或者请求落到了当前 active provider 的模型/鉴权配置上
- **原因：** `getModelConfig()` 把 `ProviderId`（如 `"openai"`）传给 `effectiveAiConfig()`，但后者原本只把参数当作 provider entry ID（`p_*`）查找。查找失败后会退回 `activeProvider` / 默认 provider，导致显式传入的 `apiKey`、`model`、`baseUrl` 与最终选中的 provider 不一致
- **解决：** `effectiveAiConfig()` 同时支持 entry ID 和 protocol ID；`getModelConfig()` 明确保留 `options.provider` 作为最终 provider，不再被回退配置覆盖
- **规则：** provider 解析层必须区分“配置项 ID（p_*）”与“协议 ID（openai/anthropic/...）”；接受两种输入时，禁止静默回退到 active provider
- **文件：** `app/lib/settings.ts`、`app/lib/agent/model.ts`

### ACP sendAndWait 不感知进程死亡 — 30 秒盲等（#23，已通过 SDK 迁移彻底修复）
- **现象：** 用户选择未安装的 ACP agent（如 Auggie），等待 30 秒后报错 "ACP Agent Error: ACP RPC timeout after 30000ms for method: initialize"
- **原因：** 手写的 `sendAndWait()` 发送 JSON-RPC 后仅靠 `setTimeout` 等待响应，不监听进程 `close`/`error` 事件
- **解决：** 迁移至 `@agentclientprotocol/sdk`，SDK 的 `ClientSideConnection` 自动将流关闭事件传播为 Promise rejection，消除了手写 JSON-RPC 解析/调度的整类 bug
- **规则：** 协议层优先使用官方 SDK 而非手写实现。手写 JSON-RPC 解析/调度曾导致 5 类 bug（sessionId 丢失、streaming 格式不匹配、同步 prompt 无文本、进程死亡盲等、modes 解析错误）
- **文件：** v1 后为 `packages/mindos/src/protocols/acp/subprocess.ts`, `packages/mindos/src/protocols/acp/session.ts`

### ACP waitForTerminalExit 竞态条件（#24）
- **现象：** 如果终端子进程在 `exitCode !== null` 检查和 `.on('exit')` 监听之间退出，Promise 永远挂起
- **原因：** Node.js 的 `exit` 事件已触发后不会重发，附加监听器后再也收不到
- **解决：** 在附加 `.on('exit')` 后再次检查 `exitCode`，覆盖竞态窗口
- **规则：** 任何 "先检查状态 → 再挂监听器" 的模式都必须在监听器挂上后重新检查状态
- **文件：** v1 后为 `packages/mindos/src/protocols/acp/subprocess.ts`

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

### Settings 半迁移配置：activeProvider 仍是协议值导致 AI 配置项整块消失（#25）
- **现象：** 设置页里 OpenAI / Gemini 等按钮看起来被选中了，但标题仍显示“未选择”，下面的 API Key / Base URL / Model 配置项完全不出现
- **原因：** 某些用户本地 `config.json` 已迁到 `ai.providers: Provider[]` 新格式，但 `ai.activeProvider` 仍保留旧协议值（如 `"openai"`、`"google"`）而不是 provider entry id（`p_*`）。`ProviderSelect` 用这个值仍会高亮协议按钮，但 `AiTab` 用 `providers.find(p => p.id === activeProvider)` 查当前项时查不到，于是整块配置区不渲染
- **解决：** `readSettings()` 在读取数组格式 providers 时增加 `normalizeActiveProvider()`：若 `activeProvider` 是协议值，则映射到首个匹配的 provider entry id；若指向缺失条目，则回退到第一个 provider
- **规则：** 配置迁移不能只迁“数据结构”，还要归一化主键字段。凡是 `active*` / `selected*` / `current*` 这类引用字段，都必须校验是否仍指向有效实体
- **文件：** `app/lib/settings.ts`

### Settings Provider 选择器隐藏未配置服务商，导致选完后难以切换（#26）
- **现象：** 用户在 Settings → AI 里选过一个 provider 后，只看到已保存的 provider chip 和 Add 按钮，Anthropic / OpenAI / Gemini 等未配置服务商入口消失；跳过 AI 后首次进 Settings 点击内置 provider，还可能把 `activeProvider` 写成 `"openai"` 这类协议值，导致配置区不出现
- **原因：** 设置页把“选择 provider 协议”和“选择已有 provider 配置项”混在同一个控件中；有任何 `ai.providers[]` 后，`ProviderSelect` 只渲染已有 entry。`AiTab` 的 `onChange` 又只浅写 `activeProvider`，没有像 onboarding 那样 find-or-create provider entry
- **解决：** Settings 里选择协议时必须先查找同协议 entry，不存在则按 preset 创建 `p_*` provider entry，再把 `activeProvider` 指向 entry id；`ProviderSelect` 在已有配置时仍显示未配置的 provider 模板；`handleSettingsPost()` 写入前再次归一化 `activeProvider`
- **规则：** UI 层永远不要把裸协议 ID 持久化为 `ai.activeProvider`。所有 provider 切换入口都应复用 find-or-create 语义；服务端写入仍要校验 active 引用是否指向有效实体
- **文件：** `packages/web/components/settings/AiTab.tsx`、`packages/web/components/shared/ProviderSelect.tsx`、`packages/web/components/settings/provider-settings.ts`、`packages/mindos/src/server/handlers/settings.ts`

## 架构 & 设计模式

### 插件兼容 / runtime 层的假绿陷阱（2026-04-10）
- **现象：** 插件 compat 骨架测试初看通过，但一补集成测试就暴露出 3 类问题：`../` 路径穿越、`onload()` 异步未等待、`.plugins/` 私有文件混入用户 vault 文件列表
- **原因：** 纯骨架实现容易只验证 happy path；如果没有更贴近用户流的集成测试，很多问题会“假绿”——尤其是 async 生命周期、路径边界、私有目录隔离这三类
- **解决：** compat/runtime 层默认做三件事：
  1. 所有文件路径统一走 `resolveSafe()`
  2. 生命周期 `load()/unload()` 设计为 async，并在 loader 中 `await`
  3. 文件扫描显式排除私有运行时目录（如 `.plugins/`）
- **规则：** 任何“宿主适配层 / 插件 runtime / loader”类模块，测试必须至少覆盖：
  - 正常加载
  - 异步生命周期
  - 路径逃逸
  - 私有目录污染
  - 配置损坏而非缺失
  - 设置 DSL 只收集声明，不要假装已经接到真实宿主 UI

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

### Windows 安装包首次启动耗时 5-6 分钟（2026-04-14，已修复）

**症状**：Windows 用户通过 `npm install -g @geminilight/mindos` 安装后，首次运行 `mindos start` 需要等待 5-6 分钟才能启动成功。

**根因**：npm 包缺少预构建的 `_standalone/` 目录，导致用户首次启动时需要经历三个耗时的构建步骤：
1. **npm install 73 个依赖**（2-3 分钟，Windows NTFS 文件系统比 Unix 慢 20%）
2. **next build 编译**（1.5-2 分钟，可能因堆内存不足而 OOM）
3. **postcss 嵌套依赖安装**（0.5-1.5 分钟，Windows 上 npm install 慢 50-100%）

**为什么 `_standalone/` 缺失**：
- `prepack` 脚本中的 `next build --webpack` 因堆内存不足而 OOM
- OOM 导致构建失败，`_standalone/` 目录未生成
- npm 发布时 `_standalone/` 不存在，用户下载的包缺少预构建产物

**调用链**：
```
npm install -g @geminilight/mindos（下载的包缺少 _standalone/）
  → mindos start（首次启动）
    → bin/commands/start.js 检测到缺少 .next/BUILD_ID
      → npm install（73 个依赖，2-3 分钟）
        → postinstall: fix-postcss-deps.cjs
          → npm install --install-strategy=nested（0.5-1.5 分钟）
      → next build --webpack（1.5-2 分钟）
        → ❌ 可能 OOM（默认堆内存不足）
```

**修复**：
1. **防止 OOM**：在 `prepack`、`build`、`start` 命令中添加 `NODE_OPTIONS="--max-old-space-size=8192"`，确保 next build 有足够堆内存
2. **优化 postcss 安装**：`scripts/fix-postcss-deps.cjs` 改为 symlink/copy 兼容依赖（picocolors、source-map-js）从 app node_modules，只用 npm install 安装不兼容的 nanoid@3，减少安装时间 50-70%
3. **确保 _standalone/ 进入 npm 包**：
   - `.npmignore` 添加 `!_standalone/` 否定规则
   - `package.json` 添加 `files` 字段显式声明包含 `_standalone/`

**优化效果**：
- **有 _standalone/**：0 秒（直接使用预构建，无需等待）
- **无 _standalone/**：5-6 分钟 → 2-3 分钟（通过 OOM 修复 + postcss 优化）

**为什么 Windows 特别慢**：
1. **NTFS 文件系统**：小文件操作比 ext4/APFS 慢 20-30%
2. **npm 并发解压**：Windows 文件锁机制导致竞争条件更频繁
3. **postcss 嵌套安装**：Windows 上 npm install 慢 50-100%

**教训**：
- 构建脚本必须有足够的堆内存，否则 OOM 会导致产物缺失
- npm 包应该包含预构建产物，避免用户侧首次启动时长时间等待
- Windows 平台的文件系统性能差异需要特别优化
- 使用 `npm pack` + 解压验证关键文件是否存在，不要只依赖本地测试

**验证方式**：
```bash
npm pack
tar -tzf geminilight-mindos-*.tgz | grep "_standalone/server.js"
```

**文件**：
- `package.json:42`（prepack 添加 NODE_OPTIONS）
- `bin/commands/build.js:24-26`（build 添加 NODE_OPTIONS）
- `bin/commands/start.js:239-241`（start 添加 NODE_OPTIONS）
- `scripts/fix-postcss-deps.cjs:17-66`（优化 postcss 依赖安装）
- `.npmignore:17`（添加 !_standalone/）
- `package.json:29-40`（添加 files 字段）

**相关 commit**：
- `0c3d0f3f` - fix: resolve Windows installation taking 5-6 minutes
- `7911ea3c` - fix: ensure _standalone/ is included in npm package

### Desktop APP 首次启动耗时 5-6 分钟（2026-04-21，已诊断）

**症状**：Windows 用户安装 MindOS Desktop APP 后，首次启动需要等待 5-6 分钟，显示"Installing MindOS (first time, ~1-2 min)..."但实际耗时远超预期。

**根因**：Desktop APP 的 bundled runtime 不完整（只有 README.md），首次启动时需要执行 `npm install -g @geminilight/mindos@latest` 下载和安装完整的 MindOS 包。

**调用链**：
```
Desktop 首次启动
  → main.ts:357 resolveLocalMindOsProjectRoot()
    → 检测到 bundled runtime 不可运行（只有 README）
    → needsInstallFallback = true
  → main.ts:382 installMindosWithPrivateNode()
    → node-bootstrap.ts:291 npm install -g @geminilight/mindos@latest
      → 从 npm registry 下载完整包（约 50MB）
      → npm install 安装依赖（73 个包，2-3 分钟）
        → 如果包缺少 _standalone/，触发 next build（1.5-2 分钟）
          → postcss postinstall（0.5-1.5 分钟）
      → 总耗时：5-6 分钟
```

**为什么 bundled runtime 不完整**：
- `desktop/package.json` 中的 `dist:win` 命令直接调用 `electron-builder`，**没有**先运行 `prepare-mindos-runtime`
- 只有 `dist:with-bundled` 和 CI 构建（`.github/workflows/build-desktop.yml:118`）才会打包完整的 runtime
- 如果开发者本地使用 `npm run dist:win` 构建，会打包一个空的 runtime

**CI 构建是否正确**：
- ✅ CI 配置正确：`.github/workflows/build-desktop.yml:115-118` 有 `npm run prepare-mindos-runtime`
- ✅ 通过 CI 构建的安装包应该包含完整的 bundled runtime（app/.next、mcp/、node/ 等）
- ⚠️ 如果用户报告安装慢，可能是使用了本地构建的安装包（未执行 prepare-mindos-runtime）

**两个场景的区别**：
1. **npm 包安装慢**（`npm install -g @geminilight/mindos`）：
   - 根因：npm 包缺少 `_standalone/` 目录
   - 修复：commit `0c3d0f3f` 和 `7911ea3c`（已包含在 v0.7.0+）
   - 状态：✅ 已修复

2. **Desktop APP 安装慢**（Windows 安装包）：
   - 根因：bundled runtime 不完整，首次启动触发 `npm install -g`
   - 如果 npm 包也缺少 `_standalone/`，会叠加 npm 包的问题
   - 修复：确保使用 CI 构建的安装包（包含完整 bundled runtime）
   - 状态：✅ CI 配置正确，通过 GitHub Release 分发的安装包应该没问题

**验证方式**：
```bash
# 检查 Desktop 安装包是否包含完整 runtime
# macOS
cd /Applications/MindOS.app/Contents/Resources/mindos-runtime
ls -lh app/.next/standalone/server.js  # 应该存在
ls -lh node/bin/node                    # 应该存在

# Windows
cd "C:\Program Files\MindOS\resources\mindos-runtime"
dir app\.next\standalone\server.js      # 应该存在
dir node\node.exe                       # 应该存在
```

**解决方案**：
1. **用户侧**：从 GitHub Release 下载官方构建的安装包（通过 CI 构建，包含完整 runtime）
2. **开发者侧**：本地构建时使用 `npm run dist:with-bundled` 而不是 `npm run dist:win`
3. **长期方案**：修改 `dist:win`/`dist:mac`/`dist:linux` 命令，自动执行 `prepare-mindos-runtime`

**教训**：
- Desktop 打包命令应该默认包含 runtime 准备步骤，避免开发者忘记
- 本地构建和 CI 构建的差异需要明确文档说明
- 首次启动的超时提示应该更准确（"~1-2 min" vs 实际 5-6 分钟）

**文件**：
- `desktop/package.json:18-20`（dist:win/mac/linux 命令）
- `desktop/package.json:24`（dist:with-bundled 命令，包含 prepare-mindos-runtime）
- `desktop/scripts/prepare-mindos-runtime.mjs`（runtime 打包脚本）
- `.github/workflows/build-desktop.yml:115-118`（CI 中的 prepare-mindos-runtime）
- `desktop/src/main.ts:357-399`（runtime 解析和安装逻辑）
- `desktop/src/node-bootstrap.ts:277-338`（installMindosWithPrivateNode 实现）

**相关 commit**：
- `0c3d0f3f` - fix: resolve Windows installation taking 5-6 minutes（npm 包问题）
- `7911ea3c` - fix: ensure _standalone/ is included in npm package（npm 包问题）
- Desktop bundled runtime 问题：需要确保使用 CI 构建或 `dist:with-bundled` 命令

**版本信息**：
- npm 包问题修复：v0.7.0+（包含 commit `0c3d0f3f`）
- Desktop 最新版本：v0.5.52（desktop-v0.5.52）
- Desktop v0.3.12 不包含 npm 包修复（commit `0c3d0f3f` 在 v0.3.12 之后）

---

## Desktop / Tauri

### Tauri spike 图标加载失败（2026-04-21）

**症状**：运行 `npm run tauri dev` 时报错 "Failed to load window icon"。

**根因**：
- `tauri.conf.json` 引用了不存在的 `icons/icon.icns` 文件
- macOS 需要 .icns 格式，但只有 .png 和 .ico

**修复**：
1. 从配置中移除不存在的图标引用
2. 使用 `sips` 或 `iconutil` 生成 .icns 文件：
   ```bash
   # macOS
   sips -s format icns icon.png --out icon.icns

   # 或使用 iconutil（需要先创建 iconset）
   mkdir icon.iconset
   sips -z 16 16 icon.png --out icon.iconset/icon_16x16.png
   sips -z 32 32 icon.png --out icon.iconset/icon_16x16@2x.png
   # ... 其他尺寸
   iconutil -c icns icon.iconset
   ```

**规则**：
- Tauri 配置中引用的所有文件必须存在
- 不同平台需要不同格式：macOS (.icns), Windows (.ico), Linux (.png)
- 使用 `expect()` 而非 `unwrap()` 提供更好的错误信息

**文件**：
- `packages/desktop-tauri/src-tauri/tauri.conf.json:15-20`
- `packages/desktop-tauri/src-tauri/src/main.rs:42-46`

---

### Windows onboard 失败：mcp/src/ 被 .npmignore 排除（2026-04-20）

**症状**：Windows 用户通过 `npm install -g @geminilight/mindos` 安装后，运行 `mindos onboard` 报错：
```
X [ERROR] Could not resolve "src/index.ts"
Error: Command failed: esbuild.exe src/index.ts --bundle ...
```

**根因**：`.npmignore` 第 23 行排除了 `mcp/src/`，导致 npm 包中没有 MCP 源码。用户安装后如果触发 MCP 重建（`needsMcpBuild()` 检测到源文件更新或首次运行），`npm run build` 会因找不到 `src/index.ts` 而失败。

**调用链**：
```
mindos onboard
  → scripts/setup.js:969 spawn('mindos start')
    → bin/lib/mcp-build.js:56 ensureMcpBundle()
      → bin/lib/mcp-build.js:69 run('npm run build', MCP_DIR)
        → mcp/package.json:7 "npx esbuild src/index.ts ..."
          → esbuild 报错: Could not resolve "src/index.ts"
```

**为什么本地开发没发现**：
- 本地开发时 `mcp/src/` 存在
- `prepack` 脚本在发布前会构建 `mcp/dist/index.cjs`
- 但用户环境如果触发重建（如检测到源文件更新），就会失败

**修复**：
1. 删除 `.npmignore` 中的 `mcp/src/` 排除规则（允许源码进入 npm 包，增加约 36KB）
2. `bin/lib/mcp-build.js` 添加防御性检查：如果 `mcp/src/` 不存在且 `dist/index.cjs` 存在，跳过重建直接使用预构建 bundle

**教训**：
- `.npmignore` 排除源码前，确认没有构建脚本依赖它
- 对于需要用户侧重建的模块（如 MCP），源码应该包含在 npm 包中
- 本地测试无法覆盖 npm 全局安装场景，需要 `npm pack` + 模拟全局安装验证

**文件**：`.npmignore`、`bin/lib/mcp-build.js`

### Skill 安装 process.cwd() 路径错误
- **现象：** GUI Setup Wizard 安装 Skill 提示失败，CLI 正常
- **原因：** API route 用 `path.resolve(process.cwd(), 'skills')` 定位 skills 目录，但 Next.js 的 `process.cwd()` 是 `app/`，解析到 `app/skills/`（不存在）。CLI 用 `__dirname` 相对定位所以没问题
- **解决：** 改为 GitHub 源优先（`npx skills add GeminiLight/MindOS --skill mindos`），本地路径作为离线 fallback（搜索 `packages/web/data/skills/` 和 `skills/`）
- **教训：** Next.js API route 里 `process.cwd()` 不等于项目根目录，定位文件用 GitHub 源或 `__dirname` 相对路径，不要依赖 cwd
- **文件：** `packages/web/app/api/mcp/install-skill/route.ts`、`scripts/setup.js`

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
- **原因：** 发布包 `package.json` 的 `files` 字段缺少排除项：`assets/images/`（1.2MB 截图）、`mcp/package-lock.json`（58kB）、`app/package-lock.json`（560kB）
- **`app/package-lock.json` 处理：** 原本 `depsHash()` 读 lock 文件做 hash，导致不能排除。改为读 `app/package.json`（几 KB）做 hash——依赖增删改时 package.json 一定变，精度足够
- **教训：** npm 官方建议**不要发布 lock 文件**，lock 只对根项目有意义。如有 build 脚本依赖 lock 文件，应改为依赖 package.json 或预算 hash 写入小文件
- **文件：** v1 后为 `packages/mindos/package.json`, `packages/mindos/bin/lib/build.js`

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

### instrumentation 不要 auto-start Feishu / PI runtime（2026-06-05）
- **现象：** `settings?tab=sync` 等普通页面在 dev server 中返回 `ERR_EMPTY_RESPONSE`，日志出现 `Cannot find module 'node:fs'` / `node:os` / `node:path`，import trace 指向 `instrumentation.ts -> feishu-ws-client -> webhook/feishu -> agent/headless -> pi-coding-agent-runtime`。
- **根因：** `instrumentation.ts` 是普通页面启动路径的一部分。把 Feishu long connection auto-start 放在这里，会让 Next 在普通页面渲染前编译 PI/headless agent runtime；这条链包含 Next dev bundler 难以处理的 Node 内置模块和 PI package 边界。另一个放大因素是旧 `.next` 产物会继续保留已删除的 `autoStartFeishuWSIfNeeded` chunk，源码修了但 dev 仍跑旧 instrumentation。
- **解决：** `instrumentation.ts` 不导入 `feishu-ws-client`，Feishu 长连接只通过 `/api/im/feishu/long-connection` 显式 start/stop；修这类 startup 边界后清理 `packages/web/.next` 并重启 dev server。
- **防回归：** `packages/web/__tests__/instrumentation-boundary.test.ts` 断言 `instrumentation.ts` 不包含 `feishu-ws-client` / `autoStartFeishuWSIfNeeded`；浏览器验证普通页面必须返回 200，而不是只看 Next `Ready`。

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

### Git Sync 状态必须以用户下一步为主，不要泄露 remote credential
- **现象：** Git remote 可能包含 HTTPS token；如果 API/UI 原样显示 `remote`，截图或排查日志会泄露凭证。禁用 auto-sync 后若只返回 `{ enabled:false }`，设置页会误判为首次未配置，用户无法自然重新启用。`autoPull()` 把非冲突 pull 失败当作冲突处理时，还可能生成空的 `auto-sync: resolved conflicts` commit。
- **解决：** `/api/sync` 和 CLI status 返回前统一脱敏 HTTPS username/password；disabled 但已有仓库时返回 `configured:true` 和仓库元数据；冲突优先级高于 `lastError`，因为用户下一步应先解决冲突；`autoPull()` 只有检测到 unmerged files 才进入冲突 fallback，禁止 `--allow-empty`；`initSync()` 在首次 pull/push 成功后才写 `sync.enabled=true`。
- **防回归：** `packages/web/__tests__/settings/sync-tab-ux.test.tsx` 覆盖 paused 状态、status load failure、conflict preview/resolve 失败；`packages/web/__tests__/core/sync-status.test.ts` 覆盖 conflicts 优先级；`tests/unit/cli-sync.test.ts` 覆盖 branch 生效、invalid branch、remote 脱敏和禁止 `--allow-empty`；`packages/mindos/src/server.test.ts` 覆盖 Product Server remote 脱敏和 conflict strategy 校验。

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
- **原因：** 旧版 `mcp/package.json` 的 `@types/node` 写成了 `^25.4.0`，但 npm 上该包最新大版本对应 Node 22。开发机有缓存 `node_modules` 所以不触发安装，新机器首次 `npm install` 找不到匹配版本
- **解决：** 改为 `^22`，与实际 Node 版本对齐
- **规则：** `@types/node` 的大版本号 = Node.js 大版本号（如 Node 22 → `@types/node@^22`）。写 devDependencies 时不要凭感觉写版本号，先 `npm view @types/node versions` 确认存在
- **文件：** v1 后曾为 `packages/protocols/mcp-server/package.json`；协议内聚后为 `packages/mindos/package.json`

### @modelcontextprotocol/sdk 版本范围过宽导致 express transport 缺失
- **现象：** 新环境 / 缓存旧版本时，`npm install` 安装到 <1.25.0 的 SDK 版本，运行时 `import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js"` 报 `MODULE_NOT_FOUND`
- **原因：** 旧版 `mcp/package.json` 声明 `"@modelcontextprotocol/sdk": "^1.6.1"`，但 `server/express.js` 直到 **1.25.0** 才加入 SDK（1.6.1 ~ 1.24.x 共 19 个大版本都没有该文件）。开发机有 lockfile 锁定 1.27.1 所以不触发
- **触发条件：** lockfile 丢失 / 新环境首次 install / `--prefer-offline` 命中旧缓存版本
- **解决：** 版本范围从 `^1.6.1` 改为 `^1.25.0`，确保最低安装到有 express.js 的版本
- **规则：** 代码 import 了某个子路径（如 `sdk/server/express.js`），`package.json` 的版本范围**下界**必须 ≥ 该子路径首次出现的版本。用 `npm pack @pkg@x.y.z --dry-run | grep filename` 验证
- **文件：** v1 后曾为 `packages/protocols/mcp-server/package.json`；协议内聚后为 `packages/mindos/package.json`

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

### MCP 依赖缺失 → ERR_MODULE_NOT_FOUND 崩溃循环（已根治）
- **现象：** `[MindOS:mcp]` 报 `ERR_MODULE_NOT_FOUND: Cannot find package '@modelcontextprotocol/sdk'`
- **原因：** npm 包排除了 `mcp/node_modules`（含跨平台原生二进制），需要运行时动态安装。多个启动路径（CLI / Desktop / API restart）的安装逻辑不一致，漏装时即崩溃
- **v0.6.4 方案：** 三层防御（postinstall + 运行时安装）——治标不治本，仍依赖网络 + npm 可用
- **v0.6.6 根治：** esbuild 预编译 MCP → 单文件 `mcp/dist/index.cjs`（1.1MB），直接 `node dist/index.cjs` 运行。彻底消除 `node_modules`、`tsx`、跨平台原生依赖、运行时安装逻辑
- **删除的文件：** `scripts/postinstall.js`、`desktop/src/ensure-mcp-native-deps.ts`（及其测试）
- **规则：** MCP 服务器应始终以预编译 bundle 形态发布。v1 后修改 `packages/mindos/src/protocols/mcp-server/`，用 `pnpm --filter @geminilight/mindos build` 重新打包。`npm pack` / `npm publish` 会通过 `prepack` 钩子自动触发构建

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

### ACP 检测与启动不能各自重新猜 PATH（2026-04-11）
- **现象：** macOS 桌面端里 ACP 面板显示 Gemini / CodeBuddy / Claude 已安装，但点击任意 Agent 都报 `ACP Agent Error: initialize failed: write EPIPE`
- **原因：** 检测阶段会用目录兜底或 shell PATH 解析判断“已安装”，但启动阶段 `spawn()` 仍然直接执行裸命令（如 `gemini` / `codebuddy` / `npx`）。GUI 进程拿到的 PATH 往往比终端短，导致子进程启动即退出，随后 `initialize` 写 stdin 时触发 `EPIPE`
- **解决：** 检测与启动必须复用同一套“运行时解析到的可执行路径”。优先使用用户 override 的绝对路径；否则先在当前环境 `which/where`，再回退到 login shell `command -v` 解析绝对路径；只有“检测到存在”且“启动命令可解析”时才视为 installed。目录存在但没有可执行命令，只能算 detected，不能算 runnable
- **规则：** 对桌面端/GUI 进程，**installed = runnable**。不要让“目录兜底检测成功”与“spawn 裸命令启动成功”使用两套不同标准
- **文件：** v1 后为 `packages/mindos/src/protocols/acp/detect-local.ts`、`packages/mindos/src/protocols/acp/subprocess.ts`

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

## Ask AI / @ Mention

### @ mention 零结果时 submit 被锁死
- **现象：** 输入 `@nonexistent` 后无匹配，但发送按钮变灰不可用；用户只能手动删除 `@` 才能继续
- **原因：** `useMention.updateMentionFromInput` 设置了 `mentionQuery`（非 null）但 `mentionResults` 为空 → submit guard `mention.mentionQuery !== null` 锁死
- **解决：** 当过滤结果为空时立即 `resetMention()`，不锁 submit
- **规则：** 下拉式 mention/autocomplete 在零匹配时必须回归普通输入模式

### @ mention 文件列表不刷新（新增/删除文件搜不到）
- **现象：** 创建新文件后 `@` 搜索找不到新文件
- **原因：** `useMention` 仅 mount 时 `fetch('/api/files')` 一次，后续文件变更不触发 refetch
- **解决：** 监听 `window.dispatchEvent(new Event('mindos:files-changed'))`，自动 refetch
- **规则：** 涉及"列表跟踪实体变更"的 hook，必须有重刷机制（事件/轮询/invalidation）

### navigateMention 空结果产生负索引
- **现象：** 零匹配状态按 ↓ 键后 `mentionIndex` 变为 -1（`length - 1 = -1`）
- **解决：** `navigateMention` 在 `mentionResults.length === 0` 时直接 return

### /api/files 异常响应导致 mention crash
- **现象：** API 返回非数组（如 `{ error: ... }`）时 `allFiles.filter` 抛 TypeError
- **解决：** `safeFetchFiles` 检查 `r.ok`、`Array.isArray(data)` 双重防御

### `mindos mcp` stdio 模式因端口冲突 EADDRINUSE 崩溃
- **现象：** `mindos start` 运行中（占用 3456 + 8781），MCP 客户端（Claude Code 等）调用 `mindos mcp` 报 EADDRINUSE
- **原因：** `bin/cli.js` 的 `mcp` 命令处理器未设置 `MCP_TRANSPORT`，MCP server 默认 `"http"` → 尝试绑定已被占用的 8781 端口
- **解决：** `mindos mcp` 默认 `MCP_TRANSPORT=stdio`（HTTP 模式由 `mindos start` → `spawnMcp()` 处理）；同时所有 HTTP 场景显式设置 `MCP_TRANSPORT=http` 消除隐式依赖
- **规则：** 进程间 transport 类型必须显式声明，不能依赖接收端默认值——尤其当同一入口可能被不同上下文调用时

### `/api/mcp/restart` 与 Desktop ProcessManager 竞争导致 EADDRINUSE
- **现象：** 用户在 Desktop 中点击"重启 MCP"，MCP 进程被 kill 后连续崩溃 3 次
- **原因：** `/api/mcp/restart` 路由杀死 MCP 后自行 spawn 新 MCP，但 Desktop 的 ProcessManager crash handler 也在 MCP exit 事件后重新 spawn，两个 MCP 进程争抢同一端口
- **解决：** Desktop 的 spawnWeb 设置 `MINDOS_MANAGED=1` 环境变量；API 路由检测到此标志时只 kill 不 spawn，让 ProcessManager crash handler 独自负责重启
- **规则：** 当子进程由父进程管理器托管时，其他组件不应绕过管理器自行重启子进程——通过环境变量/标志声明托管关系

### `/api/mcp/restart` bundle 路径必须跟随 MCP 内聚到产品包 (2026-05-10)
- **现象：** 在 Web/产品 server 中点击"重启 MCP"会返回 `MCP bundle not found — reinstall @geminilight/mindos`，即使产品包已经构建过 MCP bundle。
- **原因：** v1 后 MCP 源码和 bundle 已内聚到 `packages/mindos/src/protocols/mcp-server` / `packages/mindos/dist/protocols/mcp-server/index.cjs`，但 Product Server 的 `handleMcpRestartPost()` 仍按旧 workspace package 路径 `packages/protocols/mcp-server/dist/index.cjs` 查找。
- **解决：** handler 先按 monorepo root 解析 `packages/mindos/dist/protocols/mcp-server/index.cjs`，再支持 npm/runtime package root 下的 `dist/protocols/mcp-server/index.cjs`。测试同时覆盖两种 `projectRoot` 输入。
- **规则：** 迁移 package 边界时，除 CLI build helper 外，Web/Product Server process-control handler 也必须同步改路径；不能只靠 publish contract 覆盖发布清单。

### `monitoring/route.ts` MCP 端口默认值 3457（应为 8781）
- **现象：** 监控 API 返回错误的 MCP 端口号
- **原因：** 读取 `MCP_PORT` 环境变量（MCP 进程内部使用），而 Web 进程中该变量未设置，fallback 硬编码为 3457（错误值）
- **解决：** 优先读 `MINDOS_MCP_PORT`，再 fallback `MCP_PORT`，最终 fallback `8781`
- **规则：** Web 进程内端口配置统一使用 `MINDOS_*` 前缀环境变量；`MCP_PORT` 仅在 MCP 进程内部使用

### `bin/lib/stop.js` pkill 模式未覆盖 esbuild 产物路径
- **现象：** 当 lsof/ss 不可用时，`mindos stop` 无法清理以 `mcp/dist/index.cjs` 启动的 MCP 进程
- **原因：** pkill 模式只匹配旧路径 `mcp/src/index`，不匹配新的 `mcp/dist/index`
- **解决：** 将 pkill 模式改为 `mcp/(src/index|dist/index)`，覆盖新旧两种路径
- **规则：** 进程清理逻辑必须跟随进程启动方式同步更新

### Setup Wizard MCP 端口误报"已被占用"（自我占用）
- **现象：** Desktop/CLI 首次安装时，Setup Wizard Step 3 显示 "Port 8781 is already in use"，但占用者是自己的 MCP
- **原因双重：**
  1. `check-port` API 的 `isSelfPort()` 依赖 HTTP 探测 `/api/health`，但 MCP 在旧版本可能不响应此端点
  2. 首次安装时 `loadConfig()` 无 config.json → `MINDOS_MCP_PORT` 环境变量未设置 → Web 进程不知道 MCP 使用的是哪个端口
- **解决双重：**
  1. `check-port` 新增 `MINDOS_MCP_PORT` env 快速路径，确定性判断自身端口（不依赖 HTTP 探测）
  2. `bin/cli.js` 的 `start`/`dev` 命令在 `loadConfig()` 后补设默认值，确保 env 始终传播到子进程
- **规则：** 进程间端口信息必须通过环境变量确定性传递，不能依赖"探测自己的服务"这种非确定性方式

## 构建优化 / Bundle Size

### Desktop 内置 runtime 过期导致 mcp/node_modules 73MB 冗余
- **现象：** `desktop/resources/mindos-runtime/mcp/node_modules/` 占 73MB，但 v0.6.6 已改为 esbuild 预编译（`mcp/dist/index.cjs` 仅 1.2MB）
- **原因：** `prepare-mindos-runtime.mjs` 脚本逻辑正确（先 copyTree → 再 rmSync node_modules → 复制 dist/index.cjs），但**脚本未被重新运行**，runtime 目录仍是旧版产物
- **解决：** 每次发版 Desktop 前必须重跑 `pnpm --filter @mindos/desktop run prepare-mindos-runtime`
- **验证：** 重跑后 runtime 从 198MB 降至 134MB（-64MB），mcp/node_modules 不存在，mcp/dist/index.cjs 1.2MB
- **规则：** Desktop 发版 checklist 必须包含 prepare-mindos-runtime 步骤，不能复用旧产物

### Turbopack standalone 不尊重 serverExternalPackages（Next.js 16.1.x 已知问题）
- **现象：** `serverExternalPackages` 新增的包仍被复制到 `.next/standalone/node_modules/`，standalone 体积不变
- **原因：** Turbopack 16.1.x 中 `serverExternalPackages` 仅控制"是否内联打包进 JS bundle"，但**不影响 standalone trace**——被标记的包仍会被复制到 standalone/node_modules。[GitHub discussion #88842](https://github.com/vercel/next.js/discussions/88842)
- **验证（已确认）：**
  - 在 `serverExternalPackages` 中加入 `koffi`/`sharp`/`typescript` 等 6 个包后 Turbopack build，standalone 体积**不变**（200MB），koffi 87MB、@img 33MB、typescript 20MB 仍在
  - 用 `next build --webpack` 构建，koffi 被正确排除（standalone 降至 110MB），但 @img/typescript 仍被保留（Next.js runtime 依赖）
- **已解决：** 生产构建已切换到 `next build --webpack`，v1 dev 入口也固定为 `next dev --webpack`，避免 pnpm workspace 下 Turbopack root/symlink 解析问题。standalone 从 200MB 降至 115MB（-85MB），koffi 87MB 被正确排除，verify-standalone 通过
- **注意：** `optimizePackageImports: ['lucide-react']` 也已验证为冗余——Turbopack 16.1.6 已内置 lucide-react 优化，有无此配置构建产物**完全一致**（static 4.3M, server 22M）
- **教训：** 配置改动必须做 before/after 对比验证。不能信赖文档描述或 agent 推断，要用 `du -sh` 实测

### PDF 上传走 file.text() 导致 AI Organize 收到二进制垃圾
- **现象：** 上传 PDF 文件后选择 AI Organize，AI 始终返回"没有更改"
- **原因：** `useFileImport` 统一用 `file.text()` 读取所有文件类型。PDF 是二进制格式，`.text()` 返回乱码，AI 无法理解内容
- **解决：** PDF 文件改用 `/api/extract-pdf` 提取纯文本（该 API 早已存在，但未集成到上传流程）
- **教训：** 新功能复用现有代码路径时，必须检查路径是否覆盖所有文件类型

### 大文件上传导致 "Failed to fetch"（请求体过大）
- **现象：** 上传文件后选择 AI Organize，报 "整理失败 - Failed to fetch"
- **原因：** 客户端将完整文件内容（最大 5MB）嵌入 JSON 请求体发送至 `/api/ask`。Next.js/HTTP 层有隐式请求体大小限制，超出时直接断开连接，浏览器报 `TypeError: Failed to fetch`
- **根因链：** 服务端 `truncate()` 限制每文件 20k 字符，但截断发生在请求体解析之后——如果请求体本身超限，route handler 根本不会执行
- **解决：** 在客户端发送前先截断文件内容到 20k 字符（`CLIENT_TRUNCATE_CHARS`），与服务端限制对齐。同时修复了 `AskContent.tsx`（常规对话）的同一模式
- **教训：** 服务端截断不能替代客户端截断。如果请求体过大导致连接被拒，服务端代码根本不会执行

### btoa() + reduce() 对大文件 base64 编码效率极差
- **现象：** 大 PDF 文件 base64 编码极慢或导致浏览器卡死
- **原因：** `new Uint8Array(buf).reduce((s, b) => s + String.fromCharCode(b), '')` 每次迭代都创建新字符串，对 5MB+ 文件产生海量中间对象
- **解决：** 改用 `FileReader.readAsDataURL()` 让浏览器原生处理 base64 编码
- **注意：** `useFileUpload.ts`（常规对话）使用分块 `String.fromCharCode(...chunk)` 方式，性能可接受无需修改

### AI Organize 工具事件被服务端 SSE 序列化静默丢失
- **现象：** AI 实际修改了文件（通知显示"4 条内容变更"），但 Organize 弹窗显示"没有做任何更改"
- **原因（三层）：**
  1. 服务端 `send()` 函数将 `tool_start` 事件的完整 `args`（含 20KB+ 文件内容）通过 `JSON.stringify` 序列化。如果序列化失败（非序列化值、极端编码），`catch {}` 静默吞掉错误，`tool_start` 事件不发送
  2. 没有 `tool_start` 事件，客户端无法匹配后续的 `tool_end` 事件，`changes[]` 保持空数组
  3. "no changes" 视图隐藏了 AI 的文字输出（summary），用户完全看不到 AI 做了什么
- **解决：**
  1. 新增 `sanitizeToolArgs()` — 发送 SSE 前将大字段（content/text）替换为 `[N chars]` 占位符，客户端只需 path 信息
  2. `send()` 的 catch 块增加 TypeError 日志，不再完全静默
  3. `FILE_WRITE_TOOLS` 扩展：增加 `delete_file`/`rename_file`/`move_file`/`append_csv` 四个遗漏的写操作工具
  4. "no changes" 视图现在显示 AI 的文字总结 + toolCallCount 诊断信息
  5. 组织中进度区域改为实时活动流：展示 AI 文字流、当前工具调用、已完成文件列表
- **教训：** `catch {}` 是 bug 温床。SSE 事件只传递进度信息，不需要传完整文件内容。写操作工具集必须与服务端 `WRITE_TOOLS` 保持同步

### AI Organize "no changes" 与 "N 个操作" 文案自相矛盾
- **现象：** 弹窗同时显示"没有做任何更改"和"AI 执行了 7 个操作"，并附带 AI 的工作总结。三条信息互相矛盾
- **原因：** `changes[]`（跟踪到的文件写入）和 `toolCallCount`（所有工具调用，含读操作）是两个独立指标。当 AI 执行了大量读操作但写操作未被 SSE 捕获时，两个指标不一致。另外 AI 的原始 Markdown 总结（##、表格、emoji）直接以纯文本 dump 给用户
- **解决：**
  1. 拆分为两个 UX 状态：有 summary 时以 AI 总结为主体（不显示"没有更改"），无 summary 时才显示"已是最新状态"
  2. `organizeToolCallsInfo` 改为中性文案："共 N 步分析 · 请查看知识库确认"（不暗示写操作）
  3. 新增 `cleanSummaryForDisplay()` 清洗 AI Markdown：去掉 ## heading、折叠多余空行、截断 500 字符
  4. "has changes" 分支的 summary 也使用同一清洗函数
- **教训：** 给用户看的文案不能基于内部技术指标的简单映射。`toolCallCount` 包含读写所有操作，不能用"执行了 N 个操作"暗示"改了 N 个文件"

### Desktop CI: macOS codesign 卡死（手动 keychain 权限问题）
- **现象：** CI macOS runner 上 `Package (mac)` 步骤卡在 `codesign` 调用超过 55 分钟，永不返回
- **原因：** 手动创建的临时 keychain（`Import Apple certificate` step）跨 step 传递到 `electron-builder` 时，`codesign` 无法静默访问私钥，弹出隐藏的密码授权对话框。headless CI 无人操作，进程永久挂起
- **根因链：** `security create-keychain` → `security import` → `security set-key-partition-list`（权限不完整）→ 新 step 中 `electron-builder` 调用 `codesign` → 系统弹隐藏授权框 → 卡死
- **解决：** 删掉整个 `Import Apple certificate` 步骤，改用 `CSC_LINK`（base64 证书）+ `CSC_KEY_PASSWORD` 环境变量传给 electron-builder。electron-builder 在同一进程内自动创建临时 keychain、导入证书、正确设置权限、签名、清理，不会弹框
- **规则：** macOS CI 签名永远不要手动管理 keychain，让 electron-builder 通过 `CSC_LINK` 自行管理。手动 keychain 脚本的权限配置极易出错且难以调试

### Desktop CI: macOS keychain 创建失败 + Windows EPERM glob error（历史，已被上条取代）
- **现象：**
  - macOS: `security: SecKeychainCreate /tmp/keychain.XXXXXX: A keychain with the same name already exists.`
  - Windows: `glob error [Error: EPERM: operation not permitted, scandir 'C:\Users\runneradmin\Application Data']`
- **原因：**
  - macOS: `mktemp` 创建了临时文件，`security create-keychain` 在同一路径失败（文件已存在）。CI runner 镜像更新后行为变化
  - Windows: `C:\Users\runneradmin\Application Data` 是 NTFS 旧版 junction point（指向 AppData\Roaming），权限受限。webpack `next build` 期间 `@vercel/nft` 文件追踪扫描到此路径触发 EPERM
- **解决：**
  - macOS: ~~改用确定性路径~~ → 已彻底删掉手动 keychain 脚本，改用 `CSC_LINK`
  - Windows: 在 build 前增加 `Fix Windows NTFS junctions` step + `outputFileTracingExcludes` 排除 AppData
- **教训：** CI workflow 必须防御 runner 镜像更新带来的环境差异

### Desktop CI: electron-builder 公证流程 5 个陷阱（已全部修复）
- **现象：** macOS CI 公证步骤各种失败模式：Package 阶段提前公证失败、公证成功误判、ZIP 公证报错、超时、参数展开错误
- **5 个问题及修复：**
  1. **Package 步骤缺少 `ELECTRON_BUILDER_SKIP_NOTARIZE=true`** — electron-builder 在 `notarize: false` 配置外仍可能自动公证。加上环境变量双重保险
  2. **`notarize_file` 管道退出码 bug** — `cmd | tee log` 的 `if` 判断的是 `tee` 的退出码（永远 0），不是 `notarytool` 的。改为直接 `tee` + `grep "status: Accepted"` 判断
  3. **ZIP 不能公证** — Apple notarytool 只接受 DMG/PKG/APP，ZIP 会报 `Asset type not supported`。公证循环改为只遍历 `*.dmg`
  4. **`--timeout 30m` 不够** — 新注册 Apple Developer 账号首次公证可能等数小时。改为 `--timeout 2h`
  5. **`AUTH_ARGS` 字符串展开有 word-splitting 风险** — 改为 bash 数组 `AUTH_ARGS=(...)` + `"${AUTH_ARGS[@]}"`
- **规则：** shell 管道中判断退出码要用 `$PIPESTATUS` 或拆开写。Apple 公证超时要留足余量。环境变量和配置文件双重防御

### Desktop CI: Windows webpack EPERM（系统保护目录不可删除）
- **现象：** Windows CI 上 `next build --webpack` 报 `EPERM: operation not permitted, scandir 'C:\Users\runneradmin\AppData\Local\Microsoft\Windows\INetCache\Content.IE5'`
- **原因：** webpack compile 阶段的 glob 扫描 `USERPROFILE` 下的所有目录，碰到 OS 保护目录（INetCache、WindowsApps、History 等）返回 EPERM。`Remove-Item -Force` 对这些目录无效（OS 保护）。`outputFileTracingExcludes` 也无效（只影响 trace 阶段不影响 compile 阶段）
- **解决：** 将 `USERPROFILE`/`HOME`/`APPDATA`/`LOCALAPPDATA` 全部重定向到 `$GITHUB_WORKSPACE/.home`（干净目录）。webpack glob 永远碰不到真实的系统保护路径
- **规则：** Windows CI 上 webpack 问题不要逐个删系统目录（打地鼠），直接重定向 HOME 一劳永逸

### Desktop CI: CDN 上传失败阻塞 GitHub Release
- **现象：** finalize job 中 Cloudflare R2 上传报 `NoSuchBucket`，Alibaba OSS 安装 ossutil 报 `Permission denied`，导致整个 finalize 失败，GitHub Release 无法发布
- **原因（双重）：**
  1. `if: env.X != ''` 在 step 级别的 `if:` 中引用的是 step 的 env block（还没求值），无法正确跳过
  2. `if: secrets.X != ''` 不合法——GitHub Actions 不允许在 `if:` 条件中直接引用 `secrets` context
- **解决：** 改为 shell 内检查 `if [ -z "$VAR" ]; then exit 0; fi` + `continue-on-error: true`。CDN 上传失败不阻塞 release
- **规则：** GitHub Actions 中跳过可选步骤，不要用 `if: env.X` 或 `if: secrets.X`，用 shell 内判空 + `continue-on-error`

### Ask AI 自动重连：localStorage 同步时机
- **现象：** 首次打开 App 时 AskContent 从 localStorage 读取 reconnectRetries，但用户尚未打开过 Settings 页 → localStorage 中无值 → fallback 为默认 3
- **规则：** localStorage 作为 "热缓存" 供 AskContent 即时读取，Settings 首次加载时同步写入。首次使用默认值 3 是安全的 fallback

### Desktop 子进程孤儿管理：stdin pipe 模式（VS Code 标准做法）
- **现象：** Electron 崩溃 / SIGKILL 时子进程（Next.js、MCP）成为孤儿，PID 文件方案存在 PID 复用风险且依赖下次启动时清理
- **解决：** spawn 子进程时 `stdio[0]` 从 `'ignore'` 改为 `'pipe'`。父进程死亡 → OS 关闭管道写端 → 子进程 stdin 收到 EOF → 自动退出
  - **MCP server**：HTTP 模式下内置 stdin 监听（`!process.stdin.isTTY` 判断），先 `httpServer.close()` 再延迟 1s 退出
  - **Web server**：通过 `node --require ~/.mindos/stdin-watchdog.cjs` 注入，延迟 500ms 退出
  - **PID 文件**保留为二级安全网
- **注意事项：**
  - 父进程侧需 `proc.stdin?.on('error', () => {})` 防止子进程退出后 EPIPE 崩溃
  - MCP stdio 传输模式 stdin 已被 MCP 协议使用，不能加 watchdog（通过 `MCP_TRANSPORT === 'http'` 条件隔离）
  - CLI 启动的 MCP 用 `stdio: 'inherit'`，`isTTY === true`，不受影响
- **规则：** 管理子进程生命周期优先用 stdin pipe 而非 PID 文件——零轮询、零文件 IO、管道断开即感知

### Desktop 本地模式：bundled runtime 不完整时显示 "Install CLI"
- **现象：** 打包后的 Desktop 点击"本地模式"，如果 `resources/mindos-runtime/` 存在但未构建（缺 `app/.next`），会 fallthrough 到 npm 全局检查 → 返回 `not-installed` → 显示"安装 MindOS CLI"按钮，用户困惑
- **根因：** `checkMindosStatus` handler 在 bundled 检测失败后没有区分 packaged/dev 模式，直接 fallthrough 到 npm 检查路径。另外 `existsSync` 在 `connect-window.ts` 中未被 import（latent bug）
- **解决：** 新增 `bundled-incomplete` 状态；packaged 模式下 bundled runtime 是唯一路径，不再 fallthrough；区分"有源码可构建"（`installed-not-built`）和"结构损坏需重装"（`bundled-incomplete`）
- **规则：** packaged 模式的运行时检测不应 fallthrough 到 npm 全局安装路径——两者是完全不同的分发模式

### 🔴 CI: 私有文件泄露到公开仓库（安全事故）
- **严重等级：** 🔴 Critical — 私有内容泄露到公开仓库
- **现象：** GeminiLight/MindOS (public repo) 包含大量不应公开的文件：`marketing/`、`.claude/`、`.claude-internal/`、`BUGS.md`、`TODO.md`、`TASKS.md`、`experience.md`、`knowledge.md`、`note.md`、`user-feedback.md`、`HUMAN-INSIGHTS.md`、`SKILL_BAD_CASES.md`、`my-skills/`、`startup/` 等私有内容
- **根因：** sync workflow 用 rsync 白名单同步指定目录，但只能防止「新增同步」，无法清理「白名单建立之前已被推到 public repo 的文件」。rsync `--delete` 只在被 rsync 的目录内删除多余文件，不会碰 rsync 范围之外的已有文件。同时 `sync-to-mindos.yml`、`ci.yml` 等 private-only workflow 也因同样原因残留在 public repo
- **解决：**
  1. **Clean slate 策略**：clone public repo 后、rsync 之前，`find /tmp/mindos -mindepth 1 -maxdepth 1 ! -name '.git' -exec rm -rf {} +` 清空所有内容（保留 `.git`），确保只有显式 rsync/cp 的内容存在
  2. 为 `landing/` subtree split 和 gh-pages deploy 添加 `[ -d landing ]` 前置检查
  3. 显式 `rm -f` 删除 excluded workflow 文件
- **规则：**
  - **private → public 同步必须用 clean slate（白名单模式），禁止 blacklist（排除模式）**。排除列表只防增不防存，一旦遗漏就是安全事故
  - 每次修改 sync workflow 时，必须检查：「如果 public repo 已有不该有的文件，这次 sync 是否会删除它们？」
  - 定期审计 public repo 内容：`gh api repos/GeminiLight/MindOS/contents/ --jq '.[].name'`

### Desktop CI: DMG 损坏 —「此电脑不能读取你连接的磁盘」
- **严重等级：** 🔴 Critical — 用户无法安装 Desktop
- **现象：** 用户从 GitHub Release 下载 DMG 后，macOS 弹出「此电脑不能读取你连接的磁盘」，DMG 无法挂载
- **根因（双重）：**
  1. **electron-builder.yml 显式写了 `arch: [arm64, x64]`**：导致 CI 的 `--arm64`/`--x64` flag 失效，每个 job 构建两个架构的 DMG。arm64 和 x64 job 并发上传同名文件到同一 Release，后者覆盖前者
  2. **ARM64 runner 上 `hdiutil create -fs APFS` 间歇性失败**：`macos-latest` 是 ARM64 runner，HFS+ 不可用，只能用 APFS。`hdiutil create -format UDRW -fs APFS` 偶发 exit code 1，electron-builder 重试 5 次后 swallow 错误，仍上传损坏 DMG
  3. **附带：Release 上是未公证 DMG**：`--publish always` 在 Package 步骤上传 DMG，Notarize/Staple 修改本地文件但不重新上传
- **解决：**
  1. **移除 electron-builder.yml 中 mac/win target 的 `arch` 数组**：让 CI workflow 的 `--arm64`/`--x64` flag 单独控制架构，每个 job 只构建一个架构
  2. **Staple 后重新上传公证 DMG**：新增 `Re-upload notarized DMGs to release` 步骤，用 `gh release delete-asset` + `gh release upload` 替换 Release 上的 DMG 为公证版本
- **规则：**
  - **electron-builder 多架构构建必须在 CI matrix 层控制（`--arch` flag），禁止在 electron-builder.yml 的 `target.arch` 中列出多个架构**。配置文件中的 `arch` 数组会覆盖 CLI flag，导致每个 job 构建所有架构
  - **macOS `--publish always` 上传的是公证前版本**。如果使用独立公证流程（而非 electron-builder 内置公证），必须在公证+装订后重新上传
  - `hdiutil create -fs APFS` 在 ARM64 runner 上不稳定，electron-builder 会 swallow 错误继续上传损坏文件。通过每 job 只构建一个架构来避免「损坏文件覆盖正常文件」的竞态

---

## UI / 前端交互

### TOC 展开时内容和目录之间出现大片空白（2026-04-05）

- **症状：** 宽屏（≥1280px）下查看有 TOC 的 Markdown 文件，内容区和右侧 TOC 之间出现 200-300px 空白，内容明显偏左
- **根因：** `.content-width`（`max-width: 780px` + `margin: auto` 居中）上叠加了 `.toc-aware`（`margin-right: 220px`）。`margin-right` 被固定为 220px 后，`margin-left: auto` 吃掉所有剩余空间，内容被推到最左边，中间形成大空白
- **本质：** 在 `margin: auto` 居中的元素上直接加 `margin-right` 固定值会破坏居中——`auto` 只剩一侧生效
- **解决：** 将 TOC 偏移从内容元素的 `margin-right` 移到 `#main-content` 的 `padding-right`（通过 CSS 变量 `--toc-extra-right`）。`padding` 缩窄容器可用宽度后，内层 `.content-width` 的 `margin: auto` 仍在缩窄后的空间里正确居中
- **文件：** `globals.css`（CSS 变量定义）、`SidebarLayout.tsx`（inline style 加入 `--toc-extra-right`）、`ViewPageClient.tsx`（移除 `toc-aware` class）
- **规则：** 需要给 `margin: auto` 居中的元素避让 fixed 面板时，偏移加在**父容器的 padding** 上，不要加在元素自身的 margin 上

### 按钮/链接：可视点击区域 ≠ 实际点击目标

- **现象：** 用户看到一个有背景色、圆角、padding 的按钮（视觉上是一个清晰的盒子），但只有当鼠标移到文字或图标上时才能点击，背景区域无反应
- **根因（三种常见模式）：**
  1. **`<Link><span className="...bg-...rounded-lg...">` 反向嵌套**：Link 是透明的点击目标，所有视觉样式（bg、border、px/py）都在内部 span 上。用户看到的是 span 的边界，但期望整个 Link 包括 span 之外的 padding 也能点击。例：
     ```tsx
     // ❌ 错误：Link 无样式，span 有所有视觉样式
     <Link href="..."><span className="px-3 py-2 rounded-lg border bg-muted">{icon} {text}</span></Link>
     
     // ✅ 正确：样式应该在 Link 上
     <Link href="..." className="px-3 py-2 rounded-lg border bg-muted hover:bg-muted/80 transition-colors">{icon} {text}</Link>
     ```
  
  2. **文本-only 链接，无 box 反馈**：某些链接只在文字上实现 `hover:text-foreground` 或 `hover:underline`，没有 box 样式。用户可能不知道这是可点击的区域。例：
     ```tsx
     // ❌ 难以发现
     <Link href="..." className="hover:text-foreground">Breadcrumb</Link>
     
     // ✅ 清晰的点击目标
     <Link href="..." className="px-2 py-0.5 rounded-md hover:bg-muted/50">Breadcrumb</Link>
     ```
  
  3. **按钮内部图标无明确 hover 反馈**：某些按钮（如删除/关闭）的内部 icon 只有文本颜色变化，没有背景反馈。使用户难以辨别是否是单独的可点击元素。例：
     ```tsx
     // ❌ 删除按钮视觉不清晰
     <button className="text-muted-foreground hover:text-foreground">
       <X size={10} />
     </button>
     
     // ✅ 明确的按钮反馈
     <button className="p-1 rounded hover:bg-error/10 hover:text-error">
       <X size={10} />
     </button>
     ```

  4. **Icon button 只靠 `p-1/p-1.5` 撑开**：在 header、breadcrumb、Chat action bar 这种密集区域，`p-1` 会让实际命中框接近 icon 本身；用户快速划过时会感觉只有图标或下半部分能点。Tooltip 如果还有较长 hover delay，会进一步放大“没有反馈”的错觉。

- **设计规则：**
  - **规则 1：可视包装元素 = 点击目标元素**
    - 如果 `<Link>` 或 `<button>` 有 padding、border、bg-color、rounded 样式，它们应该直接应用到该元素上，NOT 内部嵌套的 span
    - 内部 span 应该只用于排列内容（gap、alignment），不添加新的 padding/border
  
  - **规则 2：确保点击 feedback 覆盖整个可视区域**
    - `hover:` 和 `focus-visible:` 样式应该作用在可点击元素上，使用户看到整个区域都是可交互的
    - 对于 pill/badge/chip 组件，避免在容器内放置独立按钮；如必须，确保按钮有明显的 visual boundaries（如 `p-1 rounded hover:bg-X`）
    - 高频 icon button 用固定命中框（如 `inline-flex h-7 w-7` 或 `h-8 w-8`），不要只依赖 padding；inactive segmented button 也必须有 `hover:bg-*`，不能只改文字色
    - Tooltip 的显示延迟应保持短（约 100-150ms），并在 pointer leave / unmount 时清理 timer，避免快速扫过工具栏时出现滞后 tooltip
  
  - **规则 3：检查清单**
    ```
    对每个看起来像按钮的 UI 元素，问以下问题：
    1. 可视盒子（背景色/border/圆角）在哪个元素上？
    2. onClick/href 在哪个元素上？
    3. 两者是同一个元素吗？如果不是，为什么？
    4. hover/focus-visible 样式是否覆盖整个可视区域？
    5. icon-only 按钮是否至少有明确的 h/w 命中框？
    6. tooltip 是否会在快速移动时滞后或残留？
    ```

- **已修复的案例：**
  - `HomeContent.tsx` FeatureChip（P1）：Link 现在直接应用样式，不再嵌套 span
  - `Breadcrumb.tsx` 导航链接（P2）：添加了 box 样式 `px-2 py-0.5 rounded-md`
  - `FileChip.tsx` 删除按钮（P2）：增加 `p-1 rounded hover:bg-muted` 使其视觉清晰
  - `Breadcrumb.tsx` / `ViewPageClient.tsx` / Chat action buttons（2026-05-13）：icon button 统一为 `h-7/w-7` 或 `h-8/w-8` 命中框，Markdown 模式切换补齐 hover 背景，`ActionTooltip` 默认延迟降到 140ms

- **预防策略：**
  - Code review：检查所有 `<Link>` 和 `<button>` 是否直接应用了 visual styles（px/py/bg/border/rounded）
  - 设计系统文档：记录标准按钮/链接模式
  - Visual QA：进行 "click everywhere" 测试，确保看到的区域都能点击
  - 回归测试：`packages/web/__tests__/components/icon-button-hit-area.test.ts` 覆盖 header、breadcrumb、Chat action 与 tooltip delay 的基础约束

### 静默吞掉错误 — `.catch(() => {})` 导致用户无反馈

- **严重等级：** 🔴 Critical — 操作失败时用户毫不知情
- **现象：** 用户点"复制"按钮后以为已复制，实际 clipboard API 失败了；文件扫描/API 调用悄悄失败，数据不正确但无任何提示
- **根因：** 代码中大量使用 `.catch(() => {})` 或 `catch {}` 空处理，Promise rejection 被完全吞掉
- **涉及组件（12 处）：**
  - `HelpContent.tsx:62` — 复制帮助内容失败
  - `setup/index.tsx:153` — 复制 auth token 失败（用户可能输错值）
  - `HomeContent.tsx:232` — 扫描示例文件失败
  - `settings/UpdateTab.tsx:108` — 获取版本信息失败
  - `settings/KnowledgeTab.tsx:200` — 扫描示例文件失败
  - `panels/DiscoverPanel.tsx:88` — 获取插件文件列表失败
  - `panels/PluginsPanel.tsx:88` — 获取插件路径失败
  - `walkthrough/WalkthroughProvider.tsx:209,233` — 引导状态读写失败
  - `GuideCard.tsx:127,138` — 引导卡片状态读写失败
  - `renderers/summary/SummaryRenderer.tsx:114` — 获取摘要数据失败
- **设计规则：**
  ```tsx
  // ❌ 永远不要这样写
  fetchData().catch(() => {});

  // ✅ 至少要 console.error + 设置错误状态
  fetchData().catch((err) => {
    console.error('[组件名] 操作描述失败:', err);
    // 视情况选择一种反馈方式：
    // 1. 设置 error state 显示 inline 错误信息
    setError('操作失败，请重试');
    // 2. 或使用全局 toast
    toast.error('操作失败');
  });

  // ✅ 对于"允许失败"的非关键操作（如预加载），至少保留日志
  prefetchData().catch((err) => console.warn('[prefetch]', err));
  ```
- **判断标准：** 如果操作失败会导致用户看到错误数据、功能不可用、或误以为成功 → **必须**有用户可见的错误反馈。只有纯优化/预加载类操作允许静默失败（但仍需 console.warn）。

### 异步操作缺少加载态 — 用户点击后 UI "冻住"

- **严重等级：** 🔴 Critical — 用户不知道操作是否在执行
- **现象：** 用户点击按钮后什么都没发生（没有 spinner、没有文字变化、没有禁用状态），几秒后突然数据变了。用户可能会重复点击。
- **根因：** `onClick` 调用 async 函数，但没有设置中间 loading 状态
- **涉及组件（8 处）：**
  - `CsvView.tsx:164-199` — 单元格编辑、删除行、添加行 → 保存时无反馈
  - `ImportModal.tsx:340-380` — AI organize + 文件导入 → 无进度提示
  - `settings/SyncTab.tsx:180+` — 连接远程/同步 → 无 "连接中..."
  - `echo/EchoInsightCollapsible.tsx:450+` — 生成 insight → 按钮禁用但无 spinner
  - `panels/DiscoverPanel.tsx:82-87` — 加载插件列表 → 无骨架屏
- **设计规则：**
  ```tsx
  // ❌ 裸调 async — 用户无感知
  const handleSave = async () => {
    await saveAction(data);
  };

  // ✅ 标准异步操作模板
  const [saving, setSaving] = useState(false);
  const handleSave = async () => {
    setSaving(true);
    try {
      await saveAction(data);
    } catch (err) {
      console.error('Save failed:', err);
      // 用户反馈
    } finally {
      setSaving(false);
    }
  };

  // JSX:
  <button disabled={saving}>
    {saving ? <><Loader2 className="animate-spin" size={12} /> 保存中...</> : '保存'}
  </button>
  ```
- **时间阈值：**
  - `< 200ms`：无需特殊处理（用户感知为即时）
  - `200ms ~ 1s`：按钮 disabled + 文字变化（"保存中..."）
  - `> 1s`：需要 spinner 或进度条
  - `> 3s`：考虑 toast 提示 + 允许取消

### 截断文本无 tooltip — 用户看不到完整内容

- **严重等级：** 🟡 Medium — 信息丢失但功能未坏
- **现象：** 长文件名、插件描述、路径被截断（`...`），鼠标移上去没有任何提示
- **根因：** 使用了 `truncate` / `line-clamp-*` CSS 但未添加 `title` 属性
- **涉及组件（18 处）：**
  - `panels/PanelNavRow.tsx:23` — 导航行标题
  - `panels/DiscoverPanel.tsx:35,173` — 插件名/用例名
  - `panels/AgentsPanelAgentDetail.tsx:145,159` — Agent 名称
  - `explore/UseCaseCard.tsx:34,43` — 用例标题和描述
  - `panels/SearchPanel.tsx:156,159` — 搜索结果文件路径和片段
  - `SearchModal.tsx:290,293` — 搜索弹窗结果
  - `ask/SlashCommandPopover.tsx:115` — 斜杠命令描述
  - `ask/MentionPopover.tsx:96,100` — @提及文件路径
  - `Backlinks.tsx:79` — 反向链接预览
  - `Breadcrumb.tsx:34` — 面包屑路径
  - `DirView.tsx:113,167` — 目录/文件名
- **设计规则：**
  ```tsx
  // ❌ 截断但无提示
  <span className="truncate">{fileName}</span>
  <p className="line-clamp-2">{description}</p>

  // ✅ 截断 + title 属性（浏览器原生 tooltip）
  <span className="truncate" title={fileName}>{fileName}</span>
  <p className="line-clamp-2" title={description}>{description}</p>
  ```
- **Code review 规则：** 每次看到 `truncate` 或 `line-clamp-*`，立即检查同元素或父元素是否有 `title` 属性。没有就加。

### 禁用按钮无说明 — 用户不知道为什么点不了

- **严重等级：** 🟡 Medium — 用户困惑但非阻塞
- **现象：** 按钮灰色不可点击，鼠标移上去无任何提示告诉用户"为什么"或"怎么才能用"
- **涉及组件（10 处）：**
  - `ImportModal.tsx:178,185` — 归档/摘要按钮（原因：无选中文件 / 整理中）
  - `OnboardingView.tsx:213` — 模板选择按钮
  - `CreateSpaceModal.tsx:142` — AI 切换（原因：AI 未配置）
  - `settings/SyncTab.tsx:295` — 连接按钮（原因：URL 未填）
  - `ask/AskContent.tsx:567` — 发送按钮（原因：@提及/命令输入中）
  - `settings/KnowledgeTab.tsx:303` — 重置 token 按钮（原因：正在重置）
  - `echo/EchoInsightCollapsible.tsx:319,328` — 生成按钮（原因：AI 未就绪）
  - `setup/StepDots.tsx:85` — 步骤点（原因：未完成前序步骤）
  - `settings/AiTab.tsx:286` — 获取模型按钮（原因：需要 API key）
  - `renderers/workflow/WorkflowRenderer.tsx:445` — 运行按钮（原因：依赖未满足）
- **设计规则：**
  ```tsx
  // ❌ 禁用但不解释
  <button disabled={!apiKey}>获取模型</button>

  // ✅ 始终用 title 解释 disabled 原因
  <button
    disabled={!apiKey}
    title={!apiKey ? '请先填写 API Key' : undefined}
  >
    获取模型
  </button>
  ```
- **文案模板：**
  - 缺少前置条件：`"请先{完成前置操作}"`
  - 正在执行中：`"{操作}中..."`
  - 功能不可用：`"{功能}需要{条件}"`

### onClick 非按钮元素缺少 cursor-pointer

- **严重等级：** 🟢 Low — 可发现性降低但功能正常
- **现象：** 鼠标移到可点击的 `<div>` 或 `<span>` 上，光标仍是默认箭头，用户不知道可以点击
- **涉及组件（2 处需修）：**
  - `DirView.tsx:210` — 文件行 `<div>` 有 onClick 但无 cursor-pointer
  - `ask/ToolCallBlock.tsx:150+` — 可展开的工具调用区块
- **设计规则：** 任何非 `<button>` / `<a>` / `<Link>` 元素如果有 `onClick`，必须加 `cursor-pointer`。更好的做法是直接用语义正确的 `<button>` 元素。

### backdrop-filter 创建 containing block 导致 fixed dropdown 错位 (2026-04-10)

**症状**：`ModelInput` 组件在 `ProviderModal` 内使用时，下拉列表位置错误（飘到页面顶部或被遮挡）。

**根因**：CSS `backdrop-filter: blur()` 会创建新的 containing block，导致 `position: fixed` 的子元素相对于该 containing block 定位，而非 viewport。`modal-backdrop` 和 `overlay-backdrop` CSS class 都包含 `backdrop-filter`。

**规则**：
- 如果 modal 内部有使用 `position: fixed` 的下拉组件（如 `ModelInput`、`CustomSelect`、`DirPicker`），**禁止**在该 modal 的 backdrop 上使用 `backdrop-filter`
- `ProviderModal` 必须保持 `bg-black/40`（无 blur），不能换成 `modal-backdrop` 或 `overlay-backdrop`
- 新增 modal 时，先检查内部是否有 fixed-positioned dropdown 组件

### UI/UX 批量审计发现的系统性问题 (2026-04-10)

**审计范围**：全站 45 个 .tsx 文件

**系统性问题及修复**：
1. **Editor.tsx 使用 Zinc/Blue 冷色调**（10 处硬编码 hex）→ 全部改为 CSS var tokens（`--background`、`--amber`、`--card` 等）
2. **focus: 与 focus-visible: 混用**（11 处）→ 输入框保留 `focus:outline-none` 去除原生轮廓，ring 改为 `focus-visible:ring-*` 仅在键盘导航时显示
3. **z-[9999] 滥用**（5 处）→ 改为 z-50，符合项目 z-index 五层约束
4. **Modal backdrop 不统一**（7 处）→ 核心 modal 用 `modal-backdrop`，轻量 dialog/overlay 用 `overlay-backdrop`
5. **amber-500 Tailwind class**（9 处）→ 改为 `var(--amber)` token，确保 dark mode 正确
6. **text-white 硬编码**（8 处）→ 改为 `text-[var(--amber-foreground)]` 或 `text-destructive-foreground`
7. **重复 hardcoded hex (#8ab4d8/#c8a0d8)**（6 处跨 3 个文件）→ 新增 `--tool-read`/`--tool-search` CSS 变量
8. **HomeContent tab 缺少 ARIA**→ 添加 `role="tablist"`/`role="tab"`/`aria-selected`/`role="tabpanel"`

**关键教训**：
- `focus:outline-none` 和 `focus-visible:ring-*` 是互补关系，不是替代关系。前者去除 mouse-click 时的原生轮廓，后者在 keyboard 时显示自定义 ring
- 批量查找替换 `focus:` → `focus-visible:` 时，必须保留 `focus:outline-none`
- 任何含 `backdrop-filter` 的元素都会成为 containing block，影响子元素 `position: fixed`

### KeyboardEvent.key 在快捷键中可能是大写 (2026-05-10)

**症状**：`Ctrl+F` / `Cmd+F` 触发浏览器 keydown 时，Chromium/Playwright 可能上报 `e.key === 'F'`，代码只判断 `e.key === 'f'` 会导致应用内查找栏打不开；`Ctrl+S` 同理可能跳过保存逻辑。

**规则**：处理字母快捷键时先 `const key = e.key.toLowerCase()`，后续用 `key === 'f'` / `key === 's'` 判断；非字母键（如 `Escape`、`Enter`）保持原始 key 判断。

**防回归**：`packages/web/__tests__/components/view-page-find-shortcut.test.ts` 检查 `ViewPageClient` 对字母快捷键统一 lowercase。

## Agent 重试 / Retry

### backend sleep() 未传 AbortSignal → 客户端断开仍浪费 LLM 配额（2026-04-01）

- **症状：** 用户关闭对话窗口后，后端仍在 sleep 等待，睡醒后再次发起 LLM API 调用，浪费 token 配额
- **根因：** `route.ts` 的 retry 循环调用 `sleep(delayMs)` 没有透传 `req.signal`，无法感知 HTTP 请求已被客户端取消
- **解决：** 改为 `sleep(delayMs, req.signal)`；`sleep()` 内部已支持 AbortSignal，会提前 reject 并中止重试
- **规则：** 任何在 HTTP handler 内的 `sleep()` 调用都必须传入 `req.signal`，防止僵尸重试

### retry loop off-by-one: `attempt < MAX_RETRIES` 正确，`attempt <= MAX_RETRIES` 多跑一次

- **含义：** 当 `attempt == MAX_RETRIES`（最后一次），`canRetry = false` → 直接 throw，避免第 4 次尝试
- **助记：** 试了 MAX_RETRIES 次 → 放弃。`attempt < MAX_RETRIES` 保证只有前 N-1 次才会 sleep+retry

## 性能 / Performance

### useCallback 依赖不稳定 → 输入框打字卡顿（2026-03-25）

- **症状：** AskContent 输入框打字有明显延迟/卡顿
- **根因：** `handleInputChange`、`handleSubmit`、`handleInputKeyDown` 等核心回调的依赖数组包含了 `mention`、`slash`、`session`、`input` 等不稳定引用，导致每次击键都重建所有回调，触发整棵子树 re-render
- **解决：** 用 `useRef` 持有不稳定值的最新引用（`mentionRef`、`slashRef`、`sessionRef`、`inputValueRef` 等），回调内通过 `.current` 读取，依赖数组清空或仅保留真正需要的 prop
- **附加优化：** `syncTextareaToContent` 中将 `getComputedStyle` 结果缓存到 `WeakMap`，避免每次击键触发 style recalc + forced reflow
- **规则：** 高频回调（onChange/onKeyDown）的 `useCallback` 依赖中禁止放入 hook 返回的对象（如 `useMention()`、`useSlashCommand()`），它们每次 render 都是新引用

### useMention 文件过滤在大型知识库下的性能隐患（待修复）

- **文件：** `app/hooks/useMention.ts` — `updateMentionFromInput` (L56-68)
- **现状：** 每次触发 `@` 提及搜索时，对 `allFiles` 数组做 `.map().filter().sort().slice()`，全量遍历 + 排序。80ms debounce 缓解了频率，但在大型知识库（>1000 文件）下每次仍是 O(N log N)
- **触发路径：** 用户在输入框输入 `@` 后每次击键 → 80ms debounce → `updateMentionFromInput` → 全量 map/filter/sort
- **可能的优化方案（按复杂度递增）：**
  1. **提前剪枝**：`filter` 先于 `map`——先 `includes(q)` 粗筛掉不匹配项，只对命中项计算 score + sort。减少排序规模
  2. **预建索引**：在 `allFiles` 变化时（`setAllFiles` 后）预建文件名索引（Map<lowerName, path>），搜索时直接查索引而非遍历
  3. **前缀树 / Trie**：对文件名建 trie，`startsWith` 查询 O(k) 而非 O(N)
  4. **Web Worker**：将过滤/排序逻辑移到 Worker 线程，主线程不阻塞。适合 >5000 文件的场景
  5. **服务端搜索**：将搜索请求发到 `/api/files?q=xxx`，服务端用 SQLite FTS 或内存索引处理，客户端只存结果
- **推荐**：先做方案 1（零成本改动），再评估是否需要方案 2。方案 4/5 仅在用户反馈确实有大型 KB 时再做
- **当前风险等级：** 低（80ms debounce + slice(0,30) 已足够应付 500-1000 文件规模）

### CLI `utils.js` 反模式 — 已修复（2026-04-05）

- **问题：** `bin/lib/utils.js` 是典型反模式（generic utility），包含不相关的函数（`run`, `npmInstall`, `expandHome`, `parseJsonc`），`expandHome` 还在 `agent.js` 和 `mcp-agents.js` 中各有一份重复定义
- **解决：** 拆分为领域命名模块 `shell.js`、`path-expand.js`、`jsonc.js`，删除所有重复定义。所有消费者统一从新模块导入
- **规则：** 禁止创建 `utils.js` / `helpers.js` / `common.js`。每个模块必须按领域命名

### CLI `cli.js` 1466 行巨石文件 — 已修复（2026-04-05）

- **问题：** `bin/cli.js` 包含 19 个内联命令实现（1466 行），只有 7 个命令模块化；加新命令需在巨石文件中编辑，维护成本高
- **解决：** 将全部 19 个命令提取为 `bin/commands/*.js` 模块，`cli.js` 仅保留 134 行的路由 + help 生成。命令自动注册（`modules` 数组 + `meta.aliases` 支持别名）
- **规则：** 新增 CLI 命令必须在 `bin/commands/` 下创建独立文件，导出 `{ meta, run }`

### `stopSyncDaemon()` 是同步函数但被 `.catch()` 调用（2026-04-05）

- **问题：** `stopSyncDaemon()` 返回 `undefined`，在 `process.on('exit')` 中被 `stopSyncDaemon().catch(...)` 调用 → `undefined.catch()` 抛 TypeError，导致 `clearPids()` 不执行
- **解决：** 改为 `try { stopSyncDaemon(); } catch {}`
- **规则：** 调用函数前检查其签名，同步函数不能用 `.catch()`

### CLI `--help` 不安全 — 执行命令而非显示帮助（2026-04-05）

- **问题：** `mindos build --help`、`mindos start --help` 等只有 6/24 个命令自行处理 `--help`，其余 18 个命令在 `--help` 时仍然执行实际操作（如触发构建、启动服务）
- **解决：** 在 `cli.js` 路由层集中拦截 `--help`。路由发现 `hasHelp && resolvedCmd` 时，调用 `showCommandHelp()` 并 `process.exit(0)`，不分发到 `run()`。同时支持 `mindos help <cmd>` 和 `mindos --help <cmd>` 两种形式
- **auto-help：** 无自定义 `printHelp` 的命令由 `printCommandHelp(meta)` 自动生成帮助页（展示 USAGE、flags、examples、aliases）
- **规则：** 命令模块不再需要自行检查 `flags.help`——路由层统一处理。新增命令只需在 `meta` 中填写 `flags` 和 `examples`

### `isTTY` 从常量改为函数 — 调用方必须加 `()`（2026-04-05）

- **问题：** `colors.js` 导出 `isTTY` 从布尔常量改为函数，用于支持延迟求值。`skill-check.js` 中 `if (!isTTY)` 变为 `if (!function)` → 永远 false
- **解决：** 所有消费方改为 `isTTY()` 调用
- **规则：** 导出签名变更时，grep 所有消费方逐一确认

### CLI 跨平台 17 处问题（2026-04-06）

- **问题：** CLI 工具链大量 Unix-only 假设，Windows 用户几乎无法使用：`stop.js` 依赖 lsof/pkill/ss；`cli-shim.js` 向 `.cmd` 写入 shell 脚本；`file.js`/`space.js` 路径沙箱用 `root + '/'` 前缀匹配（Windows 反斜杠不匹配）；`doctor.js` 用 `:` 分割 PATH（Windows 是 `;`）；`update.js`/`gateway.js` 用 `which`/`readlink -f`；`mcp-agents.js` Cline/Roo/Copilot 配置路径缺少 `%APPDATA%` 分支
- **解决：** 系统性修复 17 个文件：
  - `stop.js`: Windows 用 `netstat -ano` + `taskkill /PID /T /F`；Unix 保持 lsof/ss
  - `cli-shim.js`: Windows 写真正的 `.cmd` batch 脚本 + PowerShell profile PATH 注入
  - `file.js`/`space.js`: 用 `path.relative()` + `..` 前缀检查替代 `startsWith(root + '/')`
  - `doctor.js`: 用 `path.delimiter` 分割 PATH
  - `update.js`/`gateway.js`: 用 `where`(win) / `which`(unix) + `fs.realpathSync` 替代 shell `readlink`/`realpath`
  - `update.js`: `rm -rf` → `fs.rmSync()`
  - `mcp-agents.js`: 添加 `win32` 分支使用 `%APPDATA%\Code\...` 路径
  - `setup.js`: 识别 Windows 驱动器路径 `C:\`；`command -v` → `where`(win)
  - `path-expand.js`: 支持 `~\` 和 bare `~`
  - `jsonc.js`/`config.js`: 添加 UTF-8 BOM 剥离
  - `open.js`: Windows `start "" "url"` 避免参数误解析
  - `logs.js`: 用 Node fs API 实现 tail（替代 Unix `tail` 命令）
  - `port.js`/`build.js`/`doctor.js`: 错误提示区分平台（lsof vs netstat）
- **规则：** 新增 shell 命令前先问"Windows cmd.exe 支持吗？"；路径比较用 `path.relative()`，不用字符串拼接

### MCP Agent CLI 检测不要用 shell 字符串 (2026-05-10)

- **问题：** MCP Agent presence detection 用 ``execSync(`which ${cmd}`)`` / ``execSync(`where ${cmd}`)`` 拼 shell 字符串。虽然内置 `presenceCli` 当前是静态值，但这条路径会把命令查找绑定到 shell 解析规则，Windows / 空格 / 特殊字符都更脆弱，也会给未来自定义 agent 留下注入风险。
- **解决：** Web 侧 `detectAgentPresence()`、产品 server handler 的默认 `commandExists()`、CLI `packages/mindos/bin/lib/mcp-agents.js` 都改成 `execFileSync(process.platform === 'win32' ? 'where' : 'which', [cmd])`，用 argv 传参。
- **规则：** 只要是"查一个命令是否存在"，用 `execFileSync(bin, [arg])` 或 `spawn/execFile`，不要用 shell 字符串拼 `which/where`。

### CLI update 查找 `mindos` binary 不要拼 `which mindos` (2026-05-10)

- **问题：** `packages/mindos/bin/commands/update.js` 的 `getUpdatedRoot()` 用 `execSync('which mindos')` / `execSync('where mindos')` 查找更新后的全局安装路径，属于同一类 shell 字符串命令查找问题。
- **解决：** 改为 `execFileSync(process.platform === 'win32' ? 'where' : 'which', ['mindos'], ...)`，并在 `tests/unit/cli-update-root.test.ts` 加 source contract，避免回退到 shell 字符串。
- **规则：** CLI 里即使命令名是静态字符串，查 PATH 也必须走 argv；`execSync('which ...')` / `execSync('where ...')` 不允许新增。

### gateway service 查找 `mindos` binary 不要拼 shell 字符串 (2026-05-10)

- **问题：** `packages/mindos/bin/lib/gateway.js` 的 `getCurrentCliPath()` 仍用 `execSync('which mindos')` / `execSync('where mindos')` 解析 service 启动入口。`mindos gateway install` 运行在更新、daemon、GUI/终端 PATH 不一致等场景时，这类 shell 字符串会复用旧的脆弱命令查找逻辑。
- **解决：** 改为 `execFileSync(process.platform === 'win32' ? 'where' : 'which', ['mindos'], ...)`，逐个检查返回候选并继续跳过 `~/.mindos/bin` shim。
- **规则：** daemon/service 安装脚本也必须遵守"命令查找走 argv"规则；不能因为命令名固定就回退到 shell 字符串。

### gateway service 管理命令不要拼 systemctl/launchctl 字符串 (2026-05-10)

- **问题：** `packages/mindos/bin/lib/gateway.js` 的 systemd/launchd 分支仍用 `execSync('systemctl ...')`、``execSync(`launchctl ... ${LAUNCHD_PLIST}`)``、``execSync(`tail -f ${LOG_PATH}`)``。daemon 安装/启停路径直接处理用户 home、plist 路径和日志路径，shell 解析会让空格、引号、`$` 等路径字符变成启动失败或误诊断。
- **解决：** `id`、`systemctl`、`journalctl`、`launchctl`、`tail` 全部改成 `execFileSync(command, args)`；`gui/<uid>/...`、`LAUNCHD_PLIST`、`LOG_PATH` 都作为独立 argv 参数传入。
- **防回归：** `tests/unit/cli-gateway.test.ts` 禁止 `gateway.js` 重新引入 `execSync(`，并断言 systemctl/journalctl/launchctl/tail 的关键调用保留 argv 形式。

### `mindos open` 不要把端口拼进浏览器启动 shell 字符串 (2026-05-10)

- **问题：** `packages/mindos/bin/commands/open.js` 从 `MINDOS_WEB_PORT` 直接拼 URL，再用 `execSync(\`start ...\`)` / `execSync(\`${cmd} ...\`)` 启动浏览器。端口配置异常时会生成坏 URL；Windows `start` 还会重新进入 shell 解析。
- **解决：** 端口先规范为 `1..65535` 的整数，否则回退 `3456`；macOS/Linux/WSL/Windows 启动浏览器均改为 `execFileSync(command, args)`。
- **规则：** CLI 里任何来自 env/config 的端口都要先做 TCP 端口范围校验；打开浏览器也走 argv，不拼 shell 字符串。

### Product Server 重启 MCP 时不要用 Unix-only 端口 kill 管道 (2026-05-10)

- **问题：** `packages/mindos/src/server/handlers/mcp-restart.ts` 仍用 `lsof -ti :${port} | xargs kill -9`，Windows 下无法工作，也会把端口和命令管道重新交给 shell。
- **解决：** 端口占用检测拆成可测的 argv 调用：Windows 解析 `netstat -ano` 的 LISTENING 行；Unix 先 `lsof -ti :PORT`，再用 `ss -tlnp` fallback，并在 `ss` 输出中继续按目标端口过滤。
- **规则：** 产品运行时的进程控制不能假设 Unix 工具链；涉及端口的 kill/restart 逻辑必须覆盖 Windows 路径和 fallback 输出过滤。

### CLI stop/restart 端口清理不要拼 lsof/taskkill/pkill shell 字符串 (2026-05-10)

- **问题：** `packages/mindos/bin/lib/stop.js` 用 `execSync(\`lsof -ti :${port} 2>/dev/null\`)`、`execSync(\`taskkill /PID ${pid} /T /F\`)`、`pkill ... || true` 做清理。端口来自 config/extraPorts，PID 来自系统输出，重新进入 shell 没必要且容易跨平台出错。
- **解决：** 改为 `execFileSync(command, args)`：`netstat -ano`、`lsof -ti :port`、`ss -tlnp`、`taskkill /PID <pid> /T /F`、`pkill -f <pattern>` 都保留结构化 argv。
- **规则：** CLI stop/restart 的 cleanup 是最后防线，必须比启动路径更保守；重定向、管道、`|| true` 都用 stdio/catch 表达，不写进命令字符串。

### `mindos doctor` 健康检查不要通过 shell 探测 npm/daemon (2026-05-10)

- **问题：** `packages/mindos/bin/commands/doctor.js` 用 `execSync('npm --version')`、`execSync('systemctl ...')`、`execSync(\`launchctl print gui/${uid}/...\`)` 做诊断。doctor 是用户排障入口，shell 探测本身失败会制造误导性的诊断结果。
- **解决：** npm、systemctl、id、launchctl 全部改成 `execFileSync(command, args)`；launchctl 的 `gui/<uid>/...` 作为单个 argv 参数传入。
- **规则：** doctor/update 这类诊断命令尤其不能依赖 shell 解析；诊断失败应该反映真实环境问题，而不是命令字符串解析问题。

### `mindos update` 安装和 daemon 状态探测不要通过 shell (2026-05-10)

- **问题：** `packages/mindos/bin/commands/update.js` 仍用 `execSync('npm install -g ...')`、`execSync('systemctl ...')`、`execSync('id -u')`、`execSync(\`launchctl print ...\`)`。update 同时处理全局安装、daemon 探测和 GUI 触发重启，一旦 shell 解析被 PATH、Windows `.cmd` shim 或路径特殊字符影响，用户会卡在“已更新但仍运行旧版本”的排障路径里。
- **解决：** npm install 和 daemon 探测全部改成 argv 调用；Windows 下 npm 通过 `process.execPath + npm-cli.js` 运行，避免直接执行 `.cmd` shell shim。
- **防回归：** `tests/unit/cli-update-root.test.ts` 断言 update 命令源码不再包含 `execSync(`，并用 fake npm 记录 argv，确认全局安装参数是 `install -g @geminilight/mindos@latest`。

### `mindos uninstall` 不要通过 shell 执行全局 npm 卸载 (2026-05-10)

- **问题：** `packages/mindos/bin/commands/uninstall.js` 在所有确认流程完成后用 `execSync('npm uninstall -g ...')`。这是卸载流程的最后一步，测试环境也会真正触发全局 npm，既慢又依赖本机 shell/PATH 行为。
- **解决：** 抽出 `bin/lib/npm-invocation.js`，update/uninstall 共用 `resolveNpmInvocation(args)`；Unix 保持 PATH 解析，Windows 用 `process.execPath + npm-cli.js` 避免 `.cmd` shim。
- **防回归：** `tests/unit/cli-uninstall.test.ts` 默认注入 fake npm，记录 argv 并断言卸载参数是 `uninstall -g @geminilight/mindos`，同时 source contract 禁止 `execSync(` 回流。

### `mindos start --daemon` 通知不要拼 osascript/notify-send shell 字符串 (2026-05-10)

- **问题：** daemon 启动完成后，`packages/mindos/bin/commands/start.js` 用 `execSync(\`osascript ... ${webPort}\`)` / `execSync(\`notify-send ... ${webPort}\`)` 发系统通知。端口来自配置/环境，通知本身是 best-effort，不应因为 shell 解析问题影响启动路径。
- **解决：** macOS `osascript` 和 Linux `notify-send` 都改为 `execFileSync(command, args)`；失败继续静默忽略。
- **防回归：** `tests/unit/cli-start-host.test.ts` 增加 source contract，禁止 start 命令重新引入 `execSync(`。

### build dependency probe 不要用 `npm --version` shell 字符串 (2026-05-10)

- **问题：** `packages/mindos/bin/lib/build.js` 的依赖安装前置检查用 `execSync('npm --version')` / `execSync('pnpm --version')`。虽然参数固定，但会把 PATH 解析和参数解析交给 shell，和其他 CLI 入口的 argv 规则不一致。
- **解决：** 改为 `execFileSync(command, ['--version'])`，`command` 只在 `npm` / `pnpm` 两个静态值之间选择。
- **防回归：** `tests/unit/cli-build.test.ts` 增加 source contract，并断言 workspace install 分支调用 `execFileSync('pnpm', ['--version'], ...)`。

### CLI 继承 stdio 的长任务也不要通过 shell 字符串执行 (2026-05-10)

- **问题：** `packages/mindos/bin/lib/shell.js` 这个共享 helper 仍用 `execSync(command, { stdio: 'inherit' })`，导致 `mindos build/dev/start/update/onboard/mcp` 把 Next、setup、MCP bundle、npm install 等命令拼成 shell 字符串。参数里一旦出现空格、引号或来自用户传入的额外 Next 参数，就会重新进入 shell 解析；Windows 下 `.cmd` / 路径解析也更脆弱。
- **解决：** 增加 `execInheritedFile(command, args, cwd, envPatch)` 和 `execNpmInherited(args, cwd, envPatch)`，所有 CLI 长任务用结构化 argv；Next 改为 `process.execPath + node_modules/next/dist/bin/next`，避免直接执行 `.bin/next` shim；npm 继续复用 `resolveNpmInvocation()`，Windows 下通过 `npm-cli.js` 执行。
- **防回归：** `tests/unit/cli-shell-subprocess.test.ts` 禁止 `shell.js` 回退到 `execSync(`，并覆盖 `npmInstall()` 的 prefer-offline fallback argv；`tests/unit/cli-build.test.ts` 和 `tests/unit/mcp-build.test.ts` 断言 build/MCP 分支继续传 argv。

### CLI 手动修复提示里的路径也要 quote (2026-05-10)

- **问题：** `npmInstall()` 和 `ensureAppDeps()` 失败后打印 `cd ${path} && ...` 手动修复命令。虽然真正执行已经是 argv-safe，但用户目录 / checkout 路径只要含空格或单引号，复制这条 fallback 命令就会失败；Windows 跨盘符路径也需要 `cd /d`。
- **解决：** 在 `packages/mindos/bin/lib/shell.js` 增加 `formatManualCdCommand()`，Unix 用 POSIX 单引号转义，Windows 用 `cd /d "..."`；`build.js` 的 pnpm / npm 依赖修复提示都复用该 helper。
- **防回归：** `tests/unit/cli-shell-subprocess.test.ts` 覆盖含空格和单引号的路径、Windows `cd /d` 提示，以及 npm fallback 的实际输出；`tests/unit/cli-build.test.ts` 禁止 build.js 回退到裸 `cd ${ROOT}` / `cd ${appDir}`。

### Windows `.cmd` helper 只能在明确需要时进 shell (2026-05-10)

- **问题：** `mindos feishu-ws` 选择了 `node_modules/.bin/tsx.cmd`，但 `spawn()` 默认 `shell: false`。Windows 下 `.cmd` shim 不是可直接执行的 PE 文件，长连接调试命令可能在启动前就报 spawn 失败。
- **解决：** 保持 Unix 走直接 argv spawn，仅 Windows Feishu helper 设置 `shell: process.platform === 'win32'`，限定在 `.cmd` shim 这一条路径。
- **防回归：** `tests/unit/cli-dev-webpack.test.ts` 断言 Feishu long connection 继续从 Web app 的本地 `.bin/tsx(.cmd)` 启动，并在 Windows 分支启用 shell。

### npm CLI shim 的 Windows batch `set` 值也要转义 (2026-05-10)

- **问题：** Desktop shim 已经转义 `%` / `^` / `!`，但 npm CLI 的 `packages/mindos/bin/lib/cli-shim.js` 仍把 `CLI_PATH` 原样写入 `set "CLI=..."`。如果安装路径包含 `%TEMP%`、`^` 或 `!`，batch 解析会把路径展开或截断，导致 `mindos.cmd` 找不到真正的 CLI。
- **解决：** 在 npm CLI shim 侧也导出并复用 `escapeCmdSetValue()`，写入 `set` 值前按 batch 规则转义 `^`、`%`、`!`。
- **防回归：** `tests/unit/cli-shim.test.ts` mock Windows home / platform，生成 `mindos.cmd` 后断言含特殊字符的 `CLI_PATH` 被写成字面量。

### npm CLI shim 的 Windows PATH 要写 User registry (2026-05-10)

- **问题：** npm CLI 的 `appendPathWindows()` 只写 `Documents/WindowsPowerShell/Microsoft.PowerShell_profile.ps1`。这对 `cmd.exe`、PowerShell 7、IDE/Agent 新进程都不可靠，导致 `mindos start` 后 `mindos` 命令仍可能不在 PATH。
- **解决：** 和 Desktop shim 对齐：优先用 `powershell.exe -NoProfile` 调用 `[Environment]::SetEnvironmentVariable('Path', ..., 'User')` 更新用户 PATH；如果 PowerShell/registry 更新失败，再降级写 profile snippet。
- **防回归：** `tests/unit/cli-shim.test.ts` mock Windows 平台和 `child_process.execFileSync`，断言 `ensureCliShim()` 会读取并写入 User PATH registry，而不是只依赖 profile 文件。

### setup.js 首次配置流程也不要拼 shell 字符串 (2026-05-10)

- **问题：** 根目录 `scripts/setup.js` 是 `mindos onboard` 的源码，但 `packages/mindos/scripts/` 是忽略的打包副本；修首次配置问题时必须改根目录源码。该脚本历史上用 shell 字符串执行 tar、npx skills、open/xdg-open/cmd.exe、`command -v`、`npm link`、`node cli.js start/restart`，路径和 URL 一旦含空格/引号就容易解析错，Windows 的 npx/npm `.cmd` shim 也不能直接交给 `execFile`。
- **解决：** `scripts/setup.js` 统一改为 `execFileSync(command, args)`；npx/npm 走 `resolveNpxInvocation()` / `resolveNpmInvocation()`，Windows 下通过 `npx-cli.js` / `npm-cli.js` 执行；浏览器启动在 Windows/WSL 用 `cmd.exe /c start "" <url>` 的 argv 形式。
- **防回归：** `tests/unit/cli-setup-subprocess.test.ts` 读取根目录 `scripts/setup.js`，禁止回退到 `execSync(`；`tests/unit/npm-invocation.test.ts` 覆盖 Windows npx CLI 解析。

### ACP Windows taskkill 不要拼 shell 字符串 (2026-05-10)

- **问题：** `packages/mindos/src/protocols/acp/subprocess.ts` 的 `killAgent()` 在 Windows 分支用 ``execSync(`taskkill /PID ${pid} /T /F`)``。PID 来自子进程对象，但仍会把进程控制交给 shell 解析，和 CLI stop/update 的 argv 安全规则不一致。
- **解决：** 改为 `execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' })`，保留 Windows 进程树终止语义，同时避免 shell 字符串。
- **防回归：** `packages/mindos/src/protocols/acp/subprocess.test.ts` 覆盖 Windows killAgent 行为，并禁止 subprocess 源码重新出现 `execSync(` / `taskkill /PID ${pid}`。

### ACP terminal/create 不要无条件 `shell: true` (2026-05-10)

- **问题：** ACP `terminal/create` 会接收 agent 传入的 `command` + `args`。如果直接 `spawn(params.command, params.args, { shell: true })`，Unix 下 `node && rm ...` 这类命令名会被 shell 解释，Windows / 空格路径也会继承 shell quoting 不确定性。
- **解决：** 新增 `resolveTerminalSpawn()`：先用现有 `resolveCommandPathSync()` 解析可执行路径，默认 `shell: false`；只有 Windows `.cmd` / `.bat` launcher 才启用 shell 兼容。
- **防回归：** `packages/mindos/src/protocols/acp/subprocess.test.ts` 覆盖 Unix 解析、shell metacharacter 命令名、Windows `.cmd` launcher，并禁止 `createTerminal` 回退到 `shell: true`。

### Desktop 启动清理 launchd/systemd 不要走 shell (2026-05-10)

- **问题：** `packages/desktop/src/main.ts` 的历史 CLI daemon 清理用 `execAsync('launchctl ...')`、`execAsync('pkill -f "...")`、`execAsync('systemctl ... 2>/dev/null || true')`。这些路径在 Desktop 启动修复阶段执行，失败会影响用户从旧 daemon / 旧端口占用里恢复；`gui/$(id -u)` 和 `pkill -f` 字符串也会重新进入 shell。
- **解决：** 把 Desktop main 里的清理命令统一到 `execFileAsync(command, args)`；launchd 先用 `id -u` argv 取 uid，再把 `gui/<uid>/com.mindos.app` 作为单个参数传给 `launchctl`；systemd inactive 用异常分支表达，不再用 shell 重定向和 `|| true`。
- **防回归：** `packages/desktop/src/main-subprocess-contract.test.ts` 禁止 Desktop main 重新引入 cleanup shell 字符串，并断言 launchctl/pkill/systemctl 的关键调用保持 argv 形式。

### Desktop 端口/PID 清理不要拼 lsof/ss/fuser/ps 字符串 (2026-05-10)

- **问题：** `packages/desktop/src/process-manager.ts` 的 orphan/端口恢复路径用 `execAsync(\`lsof -ti:${port}\`)`、`execAsync(\`ss -tlnp sport = :${port}\`)`、`execAsync(\`fuser ${port}/tcp 2>&1\`)`、`execAsync(\`ps -p ${pid} -o comm=\`)`。这些值虽来自 number，但属于 Desktop 启动恢复最后防线，不应依赖 shell、重定向或平台 shell 语法。
- **解决：** 统一使用 module-scope `execFileAsync(command, args)`；`lsof`、`ss`、`fuser`、`wmic`、`ps` 都传结构化参数。`fuser` 保留 stdout+stderr 解析，因为不同实现会把 PID 写到不同流。
- **防回归：** `packages/desktop/src/process-manager-subprocess-contract.test.ts` 禁止 process-manager 回退到 `execAsync` / shell 字符串，并断言关键 port/PID probes 使用 argv 调用。

### Desktop 私有 Node 的 macOS quarantine 清理不能拼 shell 路径 (2026-05-10)

- **问题：** `packages/desktop/src/node-bootstrap.ts` 下载私有 Node 后用 `execSync(\`xattr ... "${NODE_DIR}"\`)` 清理 quarantine。用户 home / app support 路径如果包含引号、`$` 等字符，会重新进入 shell 解析。
- **解决：** 抽出 `removeMacQuarantineAttribute()`，用 `execFileSync('xattr', ['-dr', 'com.apple.quarantine', nodeDir])`；测试覆盖带引号和 `$` 的路径。
- **规则：** Desktop 启动/修复流程里的系统工具调用也必须走 argv；即使路径通常来自系统目录，也按用户可控路径处理。

### Desktop 私有 Node bootstrap 不要让所有 Windows spawn 进 shell (2026-05-10)

- **问题：** `node-bootstrap.ts` 为了执行 Windows `npm.cmd`，把 `spawnAsync()`、`npm install`、`npm root -g` 都设成 Windows 下 `shell: true`。这样 PowerShell `.exe`、未来其他 `.exe` 工具或带特殊字符的路径都会额外经过 shell 解析。
- **解决：** 增加 `needsWindowsShell(command)`，仅 `.cmd` / `.bat` launcher 启用 shell；`powershell.exe`、Unix `tar`、其他 `.exe` 继续 argv spawn。
- **防回归：** `packages/desktop/src/node-bootstrap.test.ts` 禁止源码重新出现 blanket Windows shell，并断言 `spawnAsync()` / npm 调用都走 `needsWindowsShell(...)`。

### Desktop 生成 Windows `.cmd` shim 时要转义 `%` / `^` / `!` (2026-05-10)

- **问题：** `packages/desktop/src/install-cli-shim.ts` 生成 `mindos.cmd` 时只转义 delayed expansion 的 `!`。如果用户 home 或 runtime 路径包含 `%TEMP%` 这类百分号片段，batch 文件会在 `set "CLI=..."` 前先做环境变量展开；`^` 也会被当作转义符。
- **解决：** 抽出 `escapeCmdSetValue()`，写入 batch `set` 值前依次转义 `^`、`%`、`!`，确保路径按字面量进入变量。
- **防回归：** `packages/desktop/src/install-cli-shim.test.ts` 覆盖 `%`、`^`、`!` 混合路径，避免只修 delayed expansion 而漏掉 batch 百分号展开。

### Settings 入口不能只打开 modal 而缺少 `/settings` 页面路由 (2026-05-10)

- **问题：** Command palette、空状态和部分帮助文案会导航到 `/settings`，但 App Router 没有 `app/settings/page.tsx`，用户从这些入口会看到 404，而不是设置界面。
- **解决：** 增加 `/settings` 页面，复用 `SettingsContent` 的 `panel` variant，并支持 `?tab=` 初始化 tab；setup 未完成时保持和其他页面一致跳转 `/setup`。
- **防回归：** `packages/web/__tests__/settings/settings-page-route.test.ts` 断言 `/settings` route 存在，并继续渲染共享 SettingsContent。

### Command palette 内部导航必须指向真实 App Router 页面 (2026-05-10)

- **问题：** SearchModal 的 Discover command 仍然 `router.push('/discover')`，但实际页面已经是 `/explore`。用户用 command palette 进入发现页时会落到 404。
- **解决：** 将 Discover command 导航改为 `/explore`，保持文案不变但指向现有页面。
- **防回归：** `packages/web/__tests__/components/search-modal-route.test.ts` 禁止 SearchModal 重新引入 `/discover`，并断言使用 `/explore`。

### Desktop SSH 隧道探测不要把 ssh 路径和 host 拼进 shell (2026-05-10)

- **问题：** `packages/desktop/src/ssh-tunnel.ts` 用 `execAsync("ssh ... ${host}")`、`execAsync(\`ssh-add "${resolvedKey}"\`)`、`execSync(\`"${candidate}" -V\`)` 探测 SSH。Windows 安装路径、key 路径或 host 名含空格/引号时容易解析错，也扩大了 shell 注入面。
- **解决：** 增加 `resolveSshCommandForPlatform()`，所有 SSH/ssh-add/sc/ps 探测改为 `execFile` / `execFileSync` argv；`SshTunnel.start()` 直接 spawn 解析后的 `.exe`/`ssh`，不再给 Windows 开 shell。
- **规则：** Desktop remote mode 的 host、key path、工具路径都按用户输入处理；子进程调用必须走 argv，Windows `.exe` 不需要 `shell: true`。

### Product Server 安装 Skill 不要把 npx 命令拼成 shell 字符串 (2026-05-10)

- **问题：** `packages/mindos/src/server/handlers/mcp-install-skill.ts` 生成 `npx skills add ...` 字符串后用 `execSync(cmd)` 执行。source、agent 名或本地路径一旦包含空格/引号，会重新进入 shell 解析，也扩大注入面。
- **解决：** 保留 `cmd` 作为 UI 展示字符串，但实际执行改为 argv 调用；默认优先用 `process.execPath` 运行 npm 的 `npx-cli.js`，避免 Windows `.cmd` shell shim。
- **规则：** API/CLI 返回给前端看的命令字符串不能直接作为执行入口；执行入口必须保留结构化 command + args。Windows 下不要把 `.cmd` / `.bat` 当作 `execFile` 目标。

### Client SDK 启动 MindOS server 不要让所有 Windows 命令进 shell (2026-05-10)

- **问题：** `createMindosServer()` 为了兼容 Windows `mindos.cmd`，直接 `spawn(command, args, { shell: process.platform === 'win32' })`。这会让用户传入的 `command` 重新进入 shell 解析，`mindos && calc` 这类 command 名会从“找不到可执行文件”变成 shell 表达式。
- **解决：** 新增 `resolveMindosServerSpawn()`：Windows 下先用 `where <command>` 找到实际 launcher，只有 `.cmd` / `.bat` 启用 shell；`.exe` 和未解析命令保持 `shell: false`。Unix 继续直接 argv spawn。
- **防回归：** `packages/mindos/src/client.test.ts` 覆盖 Windows `.cmd`、Windows `.exe`、未解析 metacharacter command 三类路径。

### Product Server sync git metadata 不要用 `execSync('git ...')` (2026-05-10)

- **问题：** `packages/mindos/src/server/handlers/sync.ts` 的默认 metadata path 用 `execSync('git remote ...')`、`execSync('git rev-list ...')`。命令当前是静态字符串，但这会让后续改动很容易把 branch/remote 参数拼回 shell。
- **解决：** 抽出 `runGit(cwd, args)`，所有 git metadata 查询都用 `execFileSync('git', args, ...)`，stderr 走 stdio 配置而不是 shell 重定向。
- **规则：** Product Server 只要调用 git，都保持 `command + args` 结构；不要把“现在没有用户输入”当作可以用 shell 字符串的理由。

### PostCSS dependency repair script 不要用 `npm install ...` shell 字符串 (2026-05-10)

- **问题：** `scripts/fix-postcss-deps.cjs` 的 postinstall 修复路径用 `execSync('npm install --no-save --install-strategy=nested')`。这虽然是固定命令，但会把 npm shim / PATH 解析交给 shell，Windows `.cmd` launcher 和路径特殊字符行为都不稳定。
- **解决：** 抽出 `resolveNpmInvocation()` + `runNpmInstall()`，Unix 下保持 `npm` argv 调用，Windows 下通过 `process.execPath + npm-cli.js` 执行 npm，避免直接执行 `.cmd` shell shim。
- **防回归：** `tests/unit/fix-postcss-deps-subprocess.test.ts` 禁止脚本重新出现 `execSync(`，并断言 npm install 继续通过 `execFileSync(invocation.command, invocation.args, ...)` 执行。

### Web sync-config git metadata 不要复制 shell 版实现 (2026-05-10)

- **问题：** `packages/web/lib/sync-config.ts` 仍保留 `execSync('git remote get-url origin')`、`execSync('git rev-parse --abbrev-ref HEAD')`、`execSync('git rev-list --count @{u}..HEAD')`。这和 product server sync handler 已修复的 shell probe 是同一类问题，容易出现双份实现不一致。
- **解决：** Web sync config 的 git metadata probe 也改成 `execFileSync('git', args, ...)`，和 product server 保持同一安全模式。
- **防回归：** `packages/web/__tests__/lib/sync-config-subprocess.test.ts` 增加 source contract，禁止 Web sync-config 回退到 `execSync(` 或单字符串 git 命令。

### VS Code 系 MCP Agent Windows 配置路径不能落到 `~/.config` (2026-05-10)

- **问题：** `github-copilot`、`cline`、`roo`、`trae-cn` 的 MCP global config 只区分 macOS 和 Linux；Windows 下会落到 `~/.config/...`，导致安装成功但写到目标 Agent 不会读取的位置。
- **解决：** 在 `packages/web/lib/mcp-agents.ts` 增加平台路径 helper：Windows 使用 `%APPDATA%`（fallback 到 `~/AppData/Roaming`），VS Code 系写到 `%APPDATA%/Code/User/...`，Trae CN 写到 `%APPDATA%/Trae CN/User/mcp.json`。
- **规则：** Agent registry 里凡是 `Library/Application Support` / `.config` 这类 app data 路径，都必须显式包含 `win32` 分支；不要让 Windows 走 Linux fallback。

### ACP Agent presenceDirs 要支持 Windows `%APPDATA%` (2026-05-10)

- **问题：** ACP `cline` descriptor 的 `presenceDirs` 只包含 macOS `~/Library/Application Support/...` 和 Linux `~/.config/...`。Windows 用户安装 VS Code 扩展后，检测逻辑不会探测 `%APPDATA%/Code/User/globalStorage/...`，导致本地 Agent 状态误判。
- **解决：** 在 `packages/mindos/src/protocols/acp/agent-descriptors.ts` 为 Cline 增加 `%APPDATA%/Code/User/globalStorage/saoudrizwan.claude-dev/`，并让 `detect-local.ts` 的 `expandHome()` 同时展开 `%ENVVAR%` token。由于 Web 通过 `@geminilight/mindos/protocols/acp` 的 `dist` export 使用该逻辑，改完 source 后必须重新 build 产品包。
- **规则：** ACP/MCP Agent descriptor 中出现 VS Code / AppData 风格路径时，必须同时覆盖 macOS、Linux、Windows，并给 `%APPDATA%` 展开加测试；不要只测当前开发机平台。

### Product Server 默认不能丢 MCP Agent Registry (2026-05-11)

**症状**：桌面版或产品 runtime 页面显示 “No agents detected”，但用户机器上实际存在 `~/.claude`、`~/.codex`、`~/.cursor` 等 Agent 目录，CLI/ACP 独立检测也能发现本机 agents。

**根因**：Next route 会显式把 Web 侧 `MCP_AGENTS` 注入 `/api/mcp/agents` handler，但 `createDefaultMindosHttpServices()` 没有默认 `mcpAgents`。桌面/产品 runtime 走产品 HTTP server 时，handler 收到空 registry，无法扫描任何本机 agent。

**修复**：在 `packages/mindos/src/server/mcp-agent-registry.ts` 提供产品 runtime 自有默认 registry，并让 `createDefaultMindosHttpServices()` 默认注入；产品 handler 同时补齐 JSON/JSONC/TOML/YAML 的 `mindos` 安装态与 configured server 扫描。

**防回归**：`packages/mindos/src/server.test.ts` 覆盖默认产品服务必须返回 26 个 agents，并能在无 CLI PATH 的情况下仅凭本机隐藏目录/config 文件检测 Claude Code 与 Codex。

### Turbopack dev cache 与 webpack build cache 混用导致每请求 compile 7-8s（2026-04-05）

- **症状：** 历史 `next dev`（Turbopack）每个请求 compile 7-8s，`/api/tree-version`（9 行代码）也要 15s 完成；view 页面 render 60-100s；3s 轮询不断积压，页面完全点不动
- **根因：** `npm run build`（走 `next build --webpack`）向 `.next/cache/webpack/` 写入 490MB production cache，同时覆盖 `.next/cache/.tsbuildinfo` 等共享元数据。再次启动 Turbopack dev 时，Turbopack 检测到元数据与自身缓存不一致 → 整体 invalidate → 每个请求重新编译全部依赖链
- **表现特征：** `.next` 总大小 2.8GB（turbopack dev cache 650MB + webpack production cache 490MB + 其他碎片）；连续多天开发不重启会逐步恶化
- **解决：** `rm -rf .next` + 重启 dev server。冷启动首轮 100-300ms，缓存热后回到个位数 ms
- **预防：** v1 dev 已固定为 webpack；如手动试验 Turbopack，先清理 `packages/web/.next`
- **注意：** 仅影响 dev mode。Production build 所有 route 预编译，不存在 compile 阶段

### Settings 关闭时 API Key 丢失（debounce 800ms + unmount race）（2026-04-06）

- **现象：** 用户在 Settings UI 填写 API Key 后关闭面板/Modal，Key 未持久化到 config.json
- **根因：** `SettingsContent` 使用 800ms debounce 自动保存。`SettingsModal` 在 `!open` 时 `return null`，导致组件 unmount → `useEffect` cleanup 清除 pending 的保存 timer → `doSave` 永远不会触发
- **解决：** 增加两个 flush 机制：(1) `visible` 变 false 时立即 `doSave` (panel variant)；(2) 组件 unmount 时 fire-and-forget `apiFetch` POST (modal variant)
- **规则：** 有 debounce + 可被关闭/卸载的组件 → 必须在关闭/卸载路径上 flush pending 操作

### Agent 读取 PDF 返回乱码（readFile 未做 PDF 文本提取）（2026-04-06）

- **现象：** MCP `mindos_read_file` 对 PDF 文件返回二进制乱码，Agent 无法理解内容
- **根因：** `readFile` (fs-ops.ts) 对所有文件统一使用 `readFileSync(path, 'utf-8')`，PDF 是二进制格式。`extractPdfText` 函数仅接入了搜索索引，未接入 Agent 读取路径
- **解决：** 在 `getFileContent` (fs.ts) 中检测 `.pdf` 扩展名，调用 `extractPdfText` 提取文本后返回。提取 PDF 处理函数到 `pdf-text.ts` 共享模块，搜索索引同步使用
- **规则：** 新文件类型支持需检查所有读取路径（搜索索引、Agent 读取、Web UI 预览、导入/上传），不能只接入一条路径

### gateway / MCP / start 三个 daemon 模式 bug（2026-04-07）

**Bug 1: `getCurrentCliPath()` 把 shell shim 当 JS 交给 node**

- **现象：** `mindos gateway install` 生成的 plist/systemd unit 把 `~/.mindos/bin/mindos`（shell shim）作为 ExecStart 参数传给 `node`，node 报语法错误
- **根因：** `start.js` 在 PATH 开头注入 `~/.mindos/bin/`，`getCurrentCliPath()` 调用 `which mindos` 找到 shim（不是 symlink，`realpathSync` 不会跟踪），直接返回
- **解决：** `getCurrentCliPath()` 和 `getUpdatedRoot()` 跳过 `dirname === resolve(MINDOS_DIR, 'bin')` 的路径
- **同类：** `update.js:getUpdatedRoot()` 同一模式，一并修复
- **规则：** `which` 结果可能是 shell wrapper，不能盲目传给 `node`；比较 dirname 排除已知 shim 目录

**Bug 2: MCP HTTP 模式 launchd 下 stdin EOF 立即退出**

- **现象：** launchd 启动的 MCP HTTP server 启动后立即关闭，日志显示 "Parent process exited (stdin closed)"
- **根因：** launchd 将 stdin 设为 `/dev/null`（EOF on read），`mcp/src/index.ts` 的 `!process.stdin.isTTY` 条件为 true，`stdin.resume()` 后立即收到 `'end'` 事件 → 误判为父进程退出
- **解决：** 增加 `!launchedByDaemon` 守卫（检查 `LAUNCHED_BY_LAUNCHD` / `INVOCATION_ID` 环境变量）
- **规则：** stdin 监听用于 Desktop pipe 模式的孤儿清理；daemon 模式 stdin 是 `/dev/null`，不能作为父进程存活信号

**Bug 3: `startMode=daemon` + launchd 导致递归 daemon 安装**

- **现象：** launchd 通过 plist 执行 `mindos start`，`isDaemonMode()` 返回 true → 进入 daemon 分支 → 再次调用 `gateway install` → `launchctl bootout` 杀掉自己 → `KeepAlive` 重新拉起 → 无限循环
- **根因：** `launchedByDaemon` 检查位于 `isDaemon` 分支之后（line 215），无法阻止 line 62 的 `isDaemon = isDaemonMode()` 进入 daemon 安装路径
- **解决：** 将 `launchedByDaemon` 提前到 `isDaemon` 计算之前：`const isDaemon = !launchedByDaemon && (Boolean(flags.daemon) || isDaemonMode())`
- **规则：** 环境检测守卫必须在分支决策之前；daemon 管理器启动的进程不应再次尝试安装自己

### 对话附件文件（@ mention）在 organize 模式下丢失 + 全模式读取失败静默吞错

- **严重等级：** 🟠 High — 用户看到附件图标但 AI 说读不到文件
- **现象：** 对话框中使用 `@` 或点选知识库文件后，UI 显示附件标签，但 AI 回复"无法读取文件内容"
- **根因 1（organize 模式）：** `route.ts` organize 分支遗漏了 `attachedFiles` 读取循环，chat/agent 模式都有但 organize 没有
- **根因 2（全模式）：** `getFileContent()` 的 catch 块使用 `catch {}` 静默吞掉所有错误，文件读取失败时无任何日志
- **根因 3（Ollama 等本地模型）：** 系统提示词可能超出本地模型的实际 context window，Ollama 会静默截断输入，导致附件内容丢失
- **解决：**
  1. organize 模式添加 `attachedFiles` 读取循环（与 chat/agent 一致）
  2. 所有模式的 catch 块改为 `catch (err) { console.warn(...) }` 记录失败详情
  3. 添加 systemPrompt 尺寸日志便于诊断 context truncation
- **文件：** `app/app/api/ask/route.ts`
- **规则：** 不要用空 `catch {}` 吞掉可能有用的错误信息；三路分支（organize/chat/agent）修改时要对齐检查

### 首条消息自我介绍抢答任务 + 上传附件处理中被静默排除

- **严重等级：** 🟠 High — 用户明明发了具体任务，AI 却先念模板式自我介绍；刚上传的附录文件也可能没进上下文
- **现象 1：** 新对话第一条消息如果同时包含问候 + 具体任务，AI 按 system prompt 先自我介绍，导致回复机械、偏题
- **现象 2：** 用户刚上传 PDF 等附录文件就立刻发送，UI 显示附件 chip，但请求里把 `status === 'loading'` 的附件过滤掉，模型拿不到文件内容
- **根因 1：** `prompt.ts` 把“新对话第一条消息”也当成自我介绍触发条件，范围过宽
- **根因 2：** `useAskChat.ts` 发送请求时直接过滤 loading 附件，但未阻止提交，也没有明确提示用户等待处理完成
- **解决：**
  1. 自我介绍只在**纯问候 / 纯身份询问**时触发；同一条消息里有具体任务就直接做事
  2. 发送前检测 loading 附件；若仍在处理中，则禁用发送并显示明确提示，避免“看起来已附加，实际没进 context”
- **文件：** `app/lib/agent/prompt.ts`、`app/hooks/useAskChat.ts`、`app/components/ask/AskContent.tsx`
- **规则：** “首条消息”不是有效的意图信号；凡是会被注入 prompt 的上下文素材，只要尚未准备好，就不能静默跳过，必须阻止提交或显式告知

### 只改 prompt 不改 UI/skill，导致 MindOS 身份文案分裂

- **严重等级：** 🟡 Medium — 用户在不同入口看到不同的人格和命名，信任感被稀释
- **现象：** 聊天行为里已经不再自称“第二大脑操作员”，但 Ask 标题、默认 Agent 名称、Onboarding、Skill 描述仍沿用旧表述或 `MindOS Agent`
- **根因：** 身份文案分散在共享 prompt、i18n、默认 Agent 常量、skills/ 与 packages/web/data/skills/ 多份副本里，只改一层会留下半套体验
- **解决：**
  1. 先定义统一原则：产品名 `MindOS`，描述语 `local knowledge assistant / 本地知识助手`
  2. 关键用户可见 surfaces 同步更新：prompt、默认 Agent 名称、Onboarding、Help、Channels、skills/
  3. 对 `skills/` 与 `packages/web/data/skills/` 建一致性测试，避免再次漂移
- **文件：** `packages/web/lib/agent/prompt.ts`、`packages/web/lib/ask-agent.ts`、`packages/web/lib/i18n/modules/*`、`skills/mindos*`、`packages/web/data/skills/mindos*`
- **规则：** 只要是"产品身份 / 默认助手命名"这类跨入口文案，就不能局部修补；必须把 source-of-truth 与所有用户可见关键 surface 一起对齐

### ACP killAllAgents/reapStaleSessions 在迭代中修改 Map (2026-04-13)

**症状**：ACP 会话清理时偶发跳过部分进程清理，或者 reapStaleSessions 遗留僵尸 session。

**根因**：
1. `killAllAgents()` 遍历 `processes.values()` 时调用 `killAgent()` → `processes.delete(id)`，在迭代中修改 Map。JavaScript Map 迭代在 delete 后会跳过后续条目。
2. `reapStaleSessions()` 同样在 `for...of sessions` 循环中调用 `closeSession()` → `sessions.delete(id)`。

**修复**：两处都改为先收集要处理的 ID/value 快照，再在循环外处理。

**规则**：不要在 `for...of Map/Set` 循环内调用 delete/set 修改正在迭代的集合。先收集到数组再处理。

**文件**：v1 后为 `packages/mindos/src/protocols/acp/subprocess.ts`、`packages/mindos/src/protocols/acp/session.ts`；旧 Desktop runtime 副本只代表历史安装包。

### useAskChat submit 依赖数组缺少 modelOverride (2026-04-13)

**症状**：用户在 Ask 面板切换 model override 后发送消息，请求仍使用切换前的 model。

**根因**：`useAskChat.submit` 的 `useCallback` 依赖数组包含 `providerOverride` 但遗漏了 `modelOverride`，导致闭包使用旧值。

**修复**：将 `modelOverride` 加入 `useCallback` 依赖数组。

**规则**：`useCallback` 体内引用的所有外部变量都必须列入依赖数组。使用 ESLint `exhaustive-deps` 规则自动检查。

**文件**：`app/hooks/useAskChat.ts`

### ACP npx wrapper 网络不可达时错误信息不明确 (2026-04-13)

**症状**：在中国等网络受限环境中，Claude Code ACP 启动失败，错误信息只显示 "initialize failed" 或 "exited before initialization"，没有提示具体原因。

**根因**：Claude Code 的 ACP 实现依赖 `npx --yes @agentclientprotocol/claude-agent-acp` 下载第三方 wrapper 包。在 npm registry 不可达时，npx 超时或连接被拒。`diagnoseInitFailure()` 没有针对 npm 网络错误的诊断分支。

**修复**：在 `diagnoseInitFailure()` 中增加对 `npm ERR!`、`ERR_SOCKET_TIMEOUT`、`ETIMEDOUT`、`ECONNREFUSED` 等网络错误的专门诊断，明确告知用户检查网络连接和 npm proxy 设置。

**文件**：v1 后为 `packages/mindos/src/protocols/acp/session.ts`

### trash.ts 路径遍历漏洞 — moveToTrash 未使用 resolveSafe (2026-04-13)

**严重等级：** 🔴 HIGH — 安全漏洞

**症状**：恶意构造的 filePath (如 `../../etc/passwd`) 可以将 mindRoot 外的文件移入回收站，造成文件丢失。

**根因**：`moveToTrash()` 使用 `path.join(mindRoot, filePath)` 拼接路径，没有调用 `resolveSafe()` 做路径边界校验。`restoreFromTrash` 的恢复目标路径同样缺少校验。

**修复**：所有 trash 操作的路径都改用 `resolveSafe(mindRoot, filePath)` 代替 `path.join`。

**规则**：任何接受用户提供路径的文件操作函数都必须通过 `resolveSafe()` 校验。直接 `path.join(root, userInput)` 是路径遍历漏洞。

**文件**：`app/lib/core/trash.ts`

### A2A read_file 路由丢失空格文件名 / 误判连续点 (2026-05-10)

**严重等级：** 🟡 MEDIUM — 用户无法读取合法文件 / 路径安全误判

**症状**：外部 A2A Agent 请求 `read the file at Project Notes.md` 时，路由只读取到 `Notes.md`；请求 `notes/v1..draft.md` 这类合法文件名时被当成路径遍历拒绝。

**根因**：`task-handler.ts` 的 read 路由用 `[^\s]+` 二次提取路径，天然截断带空格文件名；路径 sanitizer 用 `p.includes('..')` 做子串判断，既误拒绝合法文件名，又没有按跨平台路径段处理 `\`。

**修复**：read 路由复用整条命令的捕获组，支持带空格的 `.md/.csv` 路径；sanitizer 先把 Windows `\` 归一化为 `/`，再逐段拒绝 `.` / `..` / 空段 / Windows 盘符。

**规则**：路径遍历判断必须按 path segment 做，不能用 `includes('..')`；用户可见文件名解析不能用不支持空格的 token regex。

**文件**：`packages/web/lib/a2a/task-handler.ts`

### stream-consumer.ts tool_end 丢失工具结果 (2026-04-13)

**严重等级：** 🟡 MEDIUM — 数据丢失

**症状**：网络抖动导致 `tool_start` 事件丢失时，对应的 `tool_end` 被静默忽略，用户看不到工具执行结果。

**根因**：`tool_end` 处理器只从 Map 查找已有 ToolCallPart (`toolCalls.get(id)`)，不存在时静默跳过。而 `findOrCreateToolCall()` 函数本可按需创建。

**修复**：`tool_end` 改用 `findOrCreateToolCall()` 代替 `toolCalls.get()`，并增加 toolCallId 空值守卫。

**规则**：SSE 流解析必须对事件乱序/丢失保持容错。不能假设事件严格按序到达。

**文件**：`app/lib/agent/stream-consumer.ts`

### fs-ops.ts deleteFile TOCTOU 竞态 (2026-04-13)

**严重等级：** 🟡 LOW — 单用户环境下极少触发

**症状**：`existsSync` 检查和 `unlinkSync` 之间文件被删除，抛出未包装的 ENOENT 错误。

**根因**：检查-然后-操作 (TOCTOU) 模式。正确做法是直接执行操作并捕获 ENOENT。

**修复**：去掉 `existsSync` 前置检查，直接 `unlinkSync` 并 catch ENOENT 转为 MindOSError。

**规则**：文件删除/重命名操作不要用 existsSync 前置检查，直接操作并 catch 特定错误码。

**文件**：`app/lib/core/fs-ops.ts`

### npm 包 standalone 缺少路由 → /wiki 500 错误（2026-04-14）

**症状**：用户通过 `npm install -g @geminilight/mindos` 安装后，访问 `/wiki` 返回 500 错误。

**根因**：npm 发布流程问题导致 `_standalone` 目录不完整：
1. 0.7.0 完全缺少 `_standalone` 目录（手动发布绕过 CI）
2. 0.6.75 有 `_standalone` 但缺少 `/wiki/page.js` 路由（standalone 构建不完整）
3. 0.6.76–0.6.82 的 CI 全部因版本号冲突 403 失败

`runtime-health-contract.json` 只检查 `server.js` 和 `.next/server` 目录存在，不检查具体路由文件，所以不完整的构建通过了验证。

**修复**：
1. 在 `runtime-health-contract.json` 中添加 `critical-routes` feature，检查关键页面路由
2. 在 `prepare-standalone.mjs` 中添加关键路由存在性验证
3. 在 `bin/lib/build.js` 的 `hasPrebuiltStandalone()` 中增加 `page.js` 存在性检查

**规则**：
- **永远通过 CI 发布** npm 包，不要手动 `npm publish`
- 添加新页面路由时，同步更新 `scripts/prepare-standalone.mjs` 的 `criticalRoutes` 数组（它现在动态读 manifest，所以列表只是备注）
- 发版后执行冒烟验证（见 AGENTS.md）

**长期防御**（见下面 "npm 发布流程安全加固"）：
1. CI 中添加 `verify-standalone.mjs` 烟雾测试（实际启动 server 验证 /api/health）
2. 加 git pre-push hook 防止意外手动发布
3. 自动化验证 npm 包内 _standalone 的完整性

**文件**：`desktop/runtime-health-contract.json`, `scripts/prepare-standalone.mjs`, `bin/lib/build.js`

## npm 发布流程安全加固（长期方案）

### 问题回顾

/wiki 500 bug 的根本原因是发布流程有 **4 层漏洞**：

1. **静态检查不完整**：`prepare-standalone.mjs` 只硬编码检查 5 个关键路由，新增路由容易遗漏
   - 修复：改为动态读 `app-paths-manifest.json` 逐条验证 ✅ 已做

2. **没有烟雾测试**：`verify-standalone.mjs` 脚本存在但 CI 没有调用
   - 修复：在 `publish-npm.yml` 中 add `node scripts/verify-standalone.mjs` step

3. **没有防手动发布机制**：用户可以在本地运行 `npm publish` 绕过 CI，导致 0.7.0 这样的残缺包
   - 修复：git pre-push hook + `.npmrc` 配置 + 文档

4. **版本号冲突检测缺失**：0.6.76–0.6.82 的 CI 全部因 403 失败但无告警
   - 修复：CI 中添加发布前版本号检查 step

### 方案 A：CI 中添加烟雾测试（立即可做）

```bash
# 在 publish-npm.yml 的 "Build standalone package" 之后插入：
- name: Smoke test standalone
  run: node scripts/verify-standalone.mjs
```

这会：
- 实际启动 Next.js server
- 检查 /api/health 端点是否响应
- 捕获任何 MODULE_NOT_FOUND 或路由 500 错误
- 如果失败，CI 停止发布

### 方案 B：防止手动发布（git hook）

创建 `.github/hooks/pre-push`：

```bash
#!/bin/bash
# Prevent accidental `npm publish` — only publish via CI workflows
if [[ $(git rev-parse --abbrev-ref HEAD) != "main" ]]; then
  exit 0
fi

# Check if someone is trying to publish (has .npmrc changes or ran npm publish)
if git status --porcelain | grep -q ".npmrc\|npm-debug.log"; then
  echo "❌ Looks like a local npm publish attempt"
  echo "ℹ️  Always publish via git tag: git tag v0.6.x && git push origin v0.6.x"
  echo "📖 See wiki/82-release-process.md"
  exit 1
fi
exit 0
```

在 CODEBUDDY.md 中文档化：
```markdown
## 发版流程

1. 确保所有 tests 通过
2. 更新 CHANGELOG.md
3. 创建 tag：git tag v0.6.x
4. 推送 tag：git push origin v0.6.x
5. 等待 CI 发布完成（.github/workflows/publish-npm.yml）

❌ **禁止**：本地运行 `npm publish`
```

### 方案 C：发布前版本号检查（CI step）

在 `publish-npm.yml` 的 "Publish to npm" 之前插入：

```yaml
- name: Check for version conflict
  run: |
    VERSION=$(node -p "require('./package.json').version")
    npm view "@geminilight/mindos@${VERSION}" version 2>/dev/null
    if [ $? -eq 0 ]; then
      echo "❌ Version ${VERSION} already published!"
      echo "   Update version in package.json to a higher number"
      exit 1
    fi
    echo "✅ Version ${VERSION} is available"
```

### 方案 D：npm 包内容验证（post-publish）

在 "Publish to npm" 之后添加：

```yaml
- name: Verify published package
  run: |
    VERSION=$(node -p "require('./package.json').version")
    cd /tmp && rm -rf mindos-pkg-verify && mkdir mindos-pkg-verify && cd mindos-pkg-verify
    npm pack "@geminilight/mindos@${VERSION}" --silent
    tar -tzf *.tgz | grep -q "_standalone/.next/server/app-paths-manifest.json" || {
      echo "❌ Published package missing _standalone manifest!"
      exit 1
    }
    tar -tzf *.tgz | grep -q "_standalone/.next/server/app/page.js" || {
      echo "❌ Published package missing home page.js!"
      exit 1
    }
    echo "✅ Package integrity verified"
```

### 全景对比：修复前后

| 检查点 | 修复前 | 修复后 |
|--------|--------|--------|
| 构建时 manifest 验证 | ❌ 硬编码 5 路由 | ✅ 动态逐条验证 |
| 烟雾测试（实启动） | ❌ 脚本存在但未用 | ✅ CI 调用 verify |
| 防手动发布 | ❌ 无 | ✅ git hook + 文档 |
| 版本号冲突检查 | ❌ 无 | ✅ CI 检查 |
| 发布后完整性验证 | ❌ 无 | ✅ CI 验证包内容 |

### 实施优先级

**L1（立即做）**：
1. Add `verify-standalone.mjs` call to CI（1 行代码）
2. Update `prepare-standalone.mjs` 到动态 manifest 验证（已做 ✅）

**L2（本周）**：
1. Add version conflict check to CI
2. Add npm 包完整性验证到 CI

**L3（下周）**：
1. 添加 git pre-push hook
2. 更新 CODEBUDDY.md release 文档

**文件**：`.github/workflows/publish-npm.yml`, `.github/hooks/pre-push`（新创建）, `CODEBUDDY.md`（文档部分）
**文件**：`.github/workflows/publish-npm.yml`, `.github/hooks/pre-push`（新创建）, `CODEBUDDY.md`（文档部分）

## Desktop / Electron

### Windows 下 ACP (Claude Code/Codex) 调用失败（2026-04-21）

**症状**：Windows 用户在 Chatbot 中使用 ACP 功能时，子进程无法正常启动或终止，导致 Agent 执行失败。

**根因**：历史 `app/lib/acp/subprocess.ts` 中的进程管理逻辑存在 3 个 Windows 兼容性问题；v1 后对应源码为 `packages/mindos/src/protocols/acp/subprocess.ts`：

1. **负 PID 杀进程（Unix-only）**：
   - `killAgent()` 使用 `process.kill(-pid)` 杀进程组
   - Windows 不支持负 PID，会抛出 `EINVAL` 错误

2. **detached + shell:false 配置冲突**：
   - `spawnAndConnect()` 使用 `detached: true, shell: false`
   - Windows 下 detached 进程需要 `shell: true` 才能正常工作

3. **缺少 Windows 特定的进程树终止逻辑**：
   - Unix 使用负 PID 杀进程组，Windows 需要 `taskkill /T` 递归杀子进程

**修复**：

```typescript
// killAgent() - 添加 Windows 分支
if (process.platform === 'win32') {
  // Windows: use taskkill to kill process tree
  try {
    execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
  } catch (err) {
    // Process may already be dead
  }
} else {
  // Unix: kill process group with negative PID
  try {
    process.kill(-pid, 'SIGTERM');
    setTimeout(() => {
      try { process.kill(-pid, 'SIGKILL'); } catch {}
    }, 3000);
  } catch (err) {
    // Process may already be dead
  }
}

// spawnAcpAgent() - 修复 detached 配置
const proc = spawn(cmd, args, {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: mergedEnv,
  // Windows: detached requires shell:true to create new process group
  // Unix: detached with shell:false creates new process group
  shell: process.platform === 'win32',
  detached: true,
  ...(options?.cwd ? { cwd: options.cwd } : {}),
});
```

**技术细节**：
- Windows 进程模型不支持 Unix 的进程组概念（负 PID）
- `detached: true` 在 Windows 下需要 `shell: true` 才能创建独立进程
- `taskkill /T` 递归终止进程树，`/F` 强制终止

**参考**：
- `bin/lib/stop.js` 的 `killTree()` 函数（正确实现）
- Node.js 文档：child_process.spawn options.detached

**规则**：
- 所有进程管理代码必须考虑 Windows 兼容性
- 使用 `process.platform === 'win32'` 分支处理平台差异
- 优先参考 bin/lib/stop.js 的成熟实现

**测试**：
- Mac: `pnpm --filter @mindos/web exec vitest run __tests__/acp/` (131 tests passed ✅)
- Windows: 需要在 Windows 环境实际测试 ACP 功能

## 性能优化

### FileTree 过滤未缓存导致不必要的重新计算（2026-04-21）

**症状**：文件树展开/折叠时有轻微卡顿，尤其是文件数量较多（100+ 个）时。

**根因**：`app/components/FileTree.tsx:610-613` 每次渲染都重新执行过滤逻辑：
```typescript
const filtered = showHidden ? nodes : filterHiddenNodes(nodes, isRoot);
const visibleNodes = isRoot
  ? filtered.filter(n => !(n.type === 'directory' && n.name === 'Inbox'))
  : filtered;
```
- 即使 `nodes`、`showHidden`、`isRoot` 没有变化，也会重新过滤
- `filterHiddenNodes()` 是递归函数，对大型文件树开销较大
- 每次父组件重新渲染（如状态更新）都会触发过滤

**修复**：使用 `useMemo` 缓存过滤结果：
```typescript
const visibleNodes = useMemo(() => {
  const filtered = showHidden ? nodes : filterHiddenNodes(nodes, isRoot);
  return isRoot
    ? filtered.filter(n => !(n.type === 'directory' && n.name === 'Inbox'))
    : filtered;
}, [nodes, showHidden, isRoot]);
```

**技术细节**：
- `useMemo` 只在依赖项（`nodes`、`showHidden`、`isRoot`）变化时重新计算
- 减少不必要的递归遍历和数组过滤操作
- 对于 100+ 文件的文件树，减少约 30-50% 的计算开销

**规则**：
- 对于计算开销较大的操作（递归、大数组过滤、排序），使用 `useMemo` 缓存结果
- 依赖项应该是最小集合，避免过度缓存
- 对于简单计算（<10ms），不需要 `useMemo`（过度优化）

**测试**：所有现有测试通过（1933 tests），无功能回归。

## CI / Release

### 根 type-check 只跑到少数 package，主要客户端漏检（2026-05-10）

**症状**：`pnpm run type-check` 显示成功，但输出里实际只跑了 `@geminilight/mindos`、`@mindos/search`、`@mindos/vector` 等少数包；Web、Desktop、Mobile、Browser Extension、Examples、retrieval API/Indexer 没有进入根质量门。

**根因**：根脚本执行 `turbo run type-check`，但多个 package 只声明了 `typecheck` 或没有 type-check 脚本。Turbo 只会运行同名任务，命名不一致会静默跳过。

**修复**：
- 所有有 `tsconfig.json` 且属于 workspace 的 TS package 都声明 `"type-check": "tsc --noEmit"`
- 对已有外部 workflow 仍使用 `typecheck` 的包，保留 `typecheck` 兼容别名
- Browser Extension 直接 import `turndown`，必须声明 `@types/turndown`，否则纳入 type-check 后会暴露 TS7016
- `examples/basic-usage.ts` 也必须进入 type-check，避免示例继续引用已迁移/改名的 product API

**防回归**：`tests/test-architecture-contract.test.ts` 检查 workspace TS package 的 `type-check` 脚本，`pnpm run type-check` 应至少覆盖 11 个真实 TS package。

### Package lint 脚本不能依赖隐式 ESLint 安装（2026-05-10）

**症状**：`pnpm run lint` 在部分 package 中直接报 `eslint: command not found`，而 Web package 即使能启动 lint，也会被历史 `any`、unused vars 和 React compiler 规则 backlog 阻塞。

**根因**：
- `@mindos/mobile`、`@mindos/search`、`@mindos/vector` 声明了 `lint` 脚本，但 workspace 根目录没有共享 ESLint 依赖和 flat config
- ESLint 9 不再自动使用旧式隐式配置；没有 `eslint.config.mjs` 时，package lint 脚本会因为环境不同而表现不一致
- Web lint backlog 很大，直接把所有历史问题设为 error 会让根质量门长期不可用

**修复**：
- 根目录声明共享 `eslint`、`@eslint/js`、`typescript-eslint`、`eslint-plugin-react-hooks` 和 `globals`
- 根目录提供 `eslint.config.mjs`，让非 Web package 的 lint 脚本在同一套规则下执行
- Web 保留 Next/TypeScript/React lint，但将已有大批量历史问题先降为 warning；后续清理时逐条恢复为 error

**防回归**：`tests/test-architecture-contract.test.ts` 检查共享 ESLint 依赖和根 `eslint.config.mjs`。`pnpm run lint` 必须能完整跑完，warning 视为待清理 backlog。

### Package 专属 ESLint config 不能依赖根 devDependencies（2026-05-10）

**症状**：在 workspace 根目录可以跑 `pnpm --filter @mindos/web lint`，但如果只安装 Web package 的依赖或做 pruned workspace，`packages/web/eslint.config.mjs` 可能因为找不到直接 import 的插件而启动失败。

**根因**：Web 的 ESLint config 直接 `import eslint-plugin-react-hooks`，但 `packages/web/package.json` 没有声明该 devDependency，只是碰巧从根目录依赖解析到了它。

**修复**：直接被 `packages/web/eslint.config.mjs` import 的 bare package 必须出现在 `packages/web` 的 `dependencies` 或 `devDependencies` 中；不能依赖根 package 的提升结果。

**防回归**：`tests/package-architecture-contract.test.ts` 解析 Web ESLint config 的 bare imports，并断言它们都在 `packages/web/package.json` 中声明。

### npm scripts 里的 `${VAR:-default}` 会破坏 Windows 启动（2026-05-10）

**症状**：`@mindos/web` 的 `dev` / `start` 脚本在 macOS/Linux 正常，但 Windows npm/cmd 不支持 POSIX 参数展开，`-p ${MINDOS_WEB_PORT:-3456}` 会把字面量传给 Next.js 或直接解析失败。

**根因**：package scripts 是跨平台入口，不能依赖 Bash 语法。即使 `pnpm --filter @mindos/web dev` 在当前机器通过，也不代表 Windows 用户能启动。

**修复**：端口默认值与校验放到 Node launcher（`packages/web/scripts/next-with-port.mjs`）里，用 `spawn(process.execPath, [nextBin, ...args])` 调本地 Next.js CLI。`dev` 保留 `--webpack`，`start` 只传 `-p <port>`。

**防回归**：`packages/web/__tests__/next-config-warning.test.ts` 检查 `dev` / `start` 不再包含 POSIX `${VAR:-default}`，并直接验证 launcher 的默认端口、合法端口和非法端口 fallback。

### 浏览器扩展打包不能依赖系统 zip 命令（2026-05-10）

**症状**：`pnpm --filter @mindos/browser-extension run package` 在 macOS/Linux 有 `zip` 时正常，但 Windows 或精简 CI 镜像可能没有 `zip`，导致 Web Clipper 本地打包失败。

**根因**：package script 使用 `cd extension && zip -r ...`，既依赖外部 CLI，也把打包逻辑拆在 workflow 和本地脚本两处。

**修复**：用 `packages/browser-extension/scripts/package-extension.mjs` 基于 `archiver` 生成 zip；workflow 也调用同一个脚本。`clean` 脚本改成 Node 版 `clean-extension.mjs`，避免 `rm -rf`。

**防回归**：`tests/workflow-migration-contract.test.ts` 断言 Browser Extension package/workflow 不再包含 `zip -r` 或 `rm -rf`，并要求 `archiver` 和 Node package 脚本存在。

### 根 clean 脚本不要直接写 `rm -rf node_modules`（2026-05-10）

**症状**：`pnpm run clean` 在 macOS/Linux 正常，但 Windows cmd/PowerShell 没有 `rm -rf`，导致开发者想清理 workspace 时第一步就失败。

**根因**：根 package script 是所有平台共享入口，不能把 POSIX 删除命令写进脚本尾部。

**修复**：改成 `node scripts/remove-node-modules.mjs`，脚本用 `fs.rmSync(..., { recursive: true, force: true })` 删除根 `node_modules/`。

**防回归**：`tests/workflow-migration-contract.test.ts` 检查根 `clean` 脚本不再包含 `rm -rf`，并要求 Node 清理脚本存在。

### Desktop Node 探测不要把可执行路径拼进 shell 字符串（2026-05-10）

**症状**：Desktop 在查找全局 `@geminilight/mindos` 时会从已发现的 Node 路径推导 `npm` 路径，再执行 `npm root -g`。如果路径来自用户环境或缓存，含空格、引号、`&`、`$()` 等字符时，shell 字符串可能解析错误；更坏情况下会形成命令注入面。

**根因**：`node-detect.ts` 用 `exec()` / `promisify(exec)` 执行 `which node`、login shell fallback、`"${npmBin}" root -g`、`npm root -g`。其中 `npmBin` 是运行时推导值，不应该进入 shell 拼接。

**修复**：改为 module-scope `execFileAsync(command, args)` helper，`which/where`、login shell、`npm root -g` 都传结构化 argv。Windows 的 `.cmd/.bat` npm shim 只能经 `cmd.exe` 启动时，集中做最小 quoting，并拒绝带双引号的非法参数。

**防回归**：`packages/desktop/src/node-detect.test.ts` 增加 source contract，禁止 `node-detect.ts` 重新出现 `exec` import、`promisify(exec)` 和 `npmBin` / login shell 的字符串插值命令。

### SSH_ASKPASS 临时脚本不要用 `echo` 输出密钥口令（2026-05-10）

**症状**：Desktop Remote 模式用 `ssh-add` 加载带口令私钥时，若 passphrase 以 `-n` 开头或包含反斜杠转义，不同 `/bin/sh` 的 `echo` 实现可能把内容当选项或转义处理，导致实际传给 `ssh-add` 的口令被改写。

**根因**：`ssh-tunnel.ts` 生成的 Unix askpass 脚本使用 `echo '<passphrase>'`。POSIX 对 `echo -n` 和反斜杠行为不做强一致保证，不能用于逐字节输出敏感字符串。

**修复**：抽出 `buildUnixAskpassScript()`，用 `printf '%s\n' <single-quoted-passphrase>` 输出口令；单引号仍按 POSIX 规则转义。

**防回归**：`packages/desktop/src/ssh-tunnel.test.ts` 执行生成的 askpass 脚本，覆盖 `-n`、反斜杠和单引号组合，断言输出和原始 passphrase 完全一致。

### Desktop 卸载残留清理脚本必须覆盖 Windows（2026-05-10）

**症状**：macOS/Linux 会生成 `~/.mindos/uninstall.sh`，但 Windows 之前直接 `return`，导致用户删除 Desktop 后没有同等的残留清理入口；CLI shim、私有 Node、PATH 注入和状态文件都可能留在 `%USERPROFILE%\.mindos`。

**根因**：`install-cli-shim.ts` 只实现了 Unix cleanup script，Windows 分支停留在 `TODO: uninstall.bat`。跨平台 Desktop 功能不能只给 Unix 留后路。

**修复**：新增 `buildWindowsUninstallScript()`，生成 `uninstall.bat`：停止记录的 MindOS 进程、删除私有 runtime/CLI shim、从用户 PATH 移除 `.mindos\bin`、清理 Desktop 状态和 Electron app data，但不删除知识库。

**防回归**：`packages/desktop/src/install-cli-shim.test.ts` 断言 Windows cleanup script 包含 `taskkill`、`mindos.cmd`、PATH registry 更新和自删除逻辑，并确认没有删除 `%USERPROFILE%\MindOS\mind`。

### Desktop 下载超时必须主动中断底层请求（2026-05-10）

**症状**：Desktop 首次启动下载私有 Node.js 时，官方源 30s 超时后会切到 mirror。但旧实现只是 reject Promise，没有销毁仍在进行的 HTTPS request / response / file stream，慢速官方源可能继续写同一个临时 archive，和 mirror 下载互相竞争，导致解压失败或得到损坏文件。

**根因**：`node-bootstrap.ts` 的 `downloadFile()` 只在拿到 response 的部分错误路径销毁 response；整体 timeout 触发时没有保存 active request/file stream 句柄，无法取消底层 I/O。

**修复**：在 `downloadFile()` 中跟踪 active `ClientRequest`、`IncomingMessage` 和 `WriteStream`；任一失败或 timeout 都统一清理 timer/progress interval，并 destroy 当前网络与文件流。成功完成时只清理 timer，不中断已完成流。

**防回归**：`packages/desktop/src/node-bootstrap.test.ts` mock `https.get` 并用 fake timers 触发整体 timeout，断言 active request 会被 `destroy()`，避免 fallback 下载与旧请求并发写入同一 temp 文件。

### Desktop Core updater fallback 必须清理当前下载 attempt（2026-05-10）

**症状**：Core runtime 更新下载多个 URL fallback 时，如果某个 URL 在已经开始响应后 timeout，旧 attempt 可能还持有 response / file stream；此时立即尝试下一个 URL 会让两个 attempt 竞争写入同一个 tarball。

**根因**：`core-updater.ts` 的 `downloadFile()` 对 request timeout 只调用 `req.destroy()` 并马上 `tryNext()`，没有统一销毁 active response / write stream，也没有移除当前 attempt 的 abort listener。旧 request 后续触发的 error 还可能误伤新的 attempt。

**修复**：为每个 attempt 跟踪 active request、response、write stream 和 abort handler；timeout / HTTP fallback / redirect / abort / stream error 都先清理当前 attempt，再继续或失败；旧 attempt 的异步事件通过 request/file/response 身份检查忽略。

**防回归**：`packages/desktop/src/core-updater.test.ts` mock `https.get`，模拟响应已开始后的 request timeout，断言 request 和 response 都被 destroy，避免 fallback 并发写同一 runtime tarball。

### Hook / Component 不要在 render 阶段读写 ref.current（2026-05-10）

**症状**：React compiler lint 报 `react-hooks/refs`，典型位置是 hook / component 为了避免事件回调 stale closure，在组件 render 阶段直接执行 `someRef.current = value`，用 `someRef.current` 初始化 state，或在 JSX handler 中直接调用会读写 ref 的 callback。

**根因**：ref 适合在事件、effect 或 layout effect 中读写；render 阶段写 ref 会绕开 React 的渲染模型，未来 React compiler 优化时可能导致不可预期行为。

**修复**：
- 对需要给鼠标/键盘事件读取的最新值，用 `useLayoutEffect` 同步到 ref，保证用户交互前已经更新
- 不要为了消除依赖数组而在 render 中写 callback ref；优先让 effect 明确依赖最新 callback
- 如果 ref 只是缓存初始化快照，先用 lazy `useState` 读取外部存储，再用这个普通 state 值初始化 ref 和其他 state，避免在 render 阶段读取 `ref.current`
- JSX handler 需要触发会读写 ref 的异步流程时，先进入普通 state / event callback，再由 effect 或事件路径调用该 ref-owning 函数，避免 compiler 把它视为 render 读 ref

**防回归**：`packages/web/__tests__/hooks/useResizeDrag-lint.test.ts`、`packages/web/__tests__/renderers/useRendererState-lint.test.ts`、`packages/web/__tests__/lib/LocaleStoreInit-lint.test.ts`、`packages/web/__tests__/hooks/acp-hooks-lint.test.ts`、`packages/web/__tests__/hooks/hook-ref-lint.test.ts`、`packages/web/__tests__/components/find-in-page-lint.test.ts`、`packages/web/__tests__/ask/provider-model-capsule-lint.test.ts`、`packages/web/__tests__/ask/ask-content-lint.test.ts` 和 `packages/web/__tests__/components/ref-cleanup-lint.test.ts` 用 ESLint JSON 输出断言关键启动/render hook/component 不再出现 `react-hooks/refs` warning。

### Desktop CLI refresh 文案要跟随 PATH 实际结果（2026-05-10）

**症状**：Windows Desktop 手动刷新 CLI shim 时，底层已经会尝试写入 User PATH registry，但成功对话框仍提示用户“手动把目录加入 PATH”。用户会误以为自动修复没有发生，重复修改系统环境变量。

**根因**：`ensureMindosCliShim()` 只返回 `{ ok }`，`refreshMindosCliAndNotify()` 无法区分“PATH 已自动追加”和“只刷新了 shim 文件”，所以 Windows 分支一直展示旧的手动指引。

**修复**：`ensureMindosCliShim()` 返回 `pathAppended`，成功弹窗由 `buildRefreshCliSuccessDialog()` 统一生成：PATH 已追加时明确提示“已加入 user PATH，请新开终端”；未追加时才提示手动添加 fallback。

**防回归**：`packages/desktop/src/install-cli-shim.test.ts` 覆盖 Windows `pathAppended=true` 的成功对话框，断言不会再提示 “add this folder”。

### CLI doctor 的 PATH 激活提示要区分 Windows registry 与 Unix rc（2026-05-10）

**症状**：Windows 上 `mindos doctor` 触发 CLI shim / PATH 修复后，仍提示 “PATH injected into shell rc files”。实际修复路径已经是 User PATH registry，不是 `.zshrc` / `.bashrc`。

**根因**：doctor 命令复用了 Unix 文案，未按 `process.platform` 区分 PATH 注入机制。跨平台修复完成后，用户提示也要同步，否则会误导 Windows 用户去找不存在的 shell rc 文件。

**修复**：抽出 `formatShimActivationWarning()`，Windows 返回 “added to your user PATH”，Unix 保留 shell rc 文案。

**防回归**：`tests/unit/cli-smoke.test.ts` 直接覆盖 Windows / Darwin 两种提示，确保 Windows 文案不再包含 `shell rc`。

### CLI doctor fallback 要检查 Windows 的 mindos.cmd（2026-05-10）

**症状**：如果 `mindos doctor` 在 CLI shim 修复分支里捕获异常，fallback 只检查 `~/.mindos/bin/mindos`。Windows 实际 shim 是 `mindos.cmd`，因此已有 shim 但 PATH 不可见时不会给用户任何修复提示。

**根因**：跨平台 shim 文件名在 `cli-shim.js` 已经区分，但 doctor fallback 仍硬编码 Unix 可执行名。

**修复**：抽出 `getShimExecutablePath()`，Windows 返回 `mindos.cmd`，Unix 返回 `mindos`；fallback 提示也按平台给出 User PATH 或 shell config 修复方式。

**防回归**：`tests/unit/cli-smoke.test.ts` 覆盖 Windows / Darwin 的 shim 可执行路径后缀。

### CLI shim PATH 检测必须按平台归一化（2026-05-10）

**症状**：Windows 上 `~/.mindos/bin` 已在 PATH，但目录大小写不同或测试环境 mock `win32` 平台时，`mindos doctor` 仍可能提示 shim 不在 PATH，并重复触发修复路径。

**根因**：doctor 和 `cli-shim.js` 各自实现 PATH 检测；`isShimInPath()` 用当前 Node 的 `path.delimiter` 和精确字符串比较，未按 Windows 的分号分隔、大小写不敏感规则归一化。

**修复**：PATH 检测集中到 `isShimInPath()`；该 helper 按 `os.platform()` 选择分隔符，比较前 trim、去尾部分隔符，并在 Windows 上转小写。doctor 不再维护独立检测逻辑。

**防回归**：`tests/unit/cli-shim.test.ts` mock Windows 平台，用大小写不同的 shim 目录和 `;` 分隔 PATH 验证 `isShimInPath()`。

### Web 子进程不要用裸 `node` 命令（2026-05-10）

**症状**：Desktop / packaged runtime 中上传 PDF 或 Word 文件时，提取接口可能失败，原因不是文件解析错误，而是 GUI 进程 PATH 很短，`execFileSync('node', ...)` 找不到 Node。

**根因**：`/api/extract-pdf`、`/api/extract-docx` 和 `lib/core/pdf-text.ts` 直接依赖 PATH 查找 `node`。Desktop 启动 Web runtime 时已经会传入 `MINDOS_NODE_BIN`，但提取子进程没有使用它。

**修复**：新增 `getNodeExecutor()`，优先用 `MINDOS_NODE_BIN`，否则用当前 `process.execPath`；所有文档提取子进程都通过该 helper 启动 Node，不再依赖 PATH。

**防回归**：`packages/web/__tests__/core/node-executor.test.ts` 覆盖 helper 行为，`packages/web/__tests__/api/extract-subprocess.test.ts` 扫描提取入口，禁止重新出现 `execFileSync('node', ...)`。

### ACP 安装不要在 Windows 直接执行 npm.cmd（2026-05-10）

**症状**：Windows 上从 Web/ACP 控制面安装 Agent 包时，`execFile('npm', ['install', ...])` 可能因为 npm 是 `.cmd` shim 而启动失败；Desktop/Web runtime 的 PATH 也可能和终端不一致。

**根因**：ACP install handler 直接执行裸 `npm`，没有复用 CLI update/uninstall 已经采用的 Windows shell-free npm 解析策略。

**修复**：为 ACP handler 增加 `resolveNpmInvocation()`；Windows 下定位 `npm-cli.js` 后用当前 Node 执行，Unix 保留 PATH 查找。

**防回归**：`packages/mindos/src/server.test.ts` 覆盖 Windows 解析为 `node.exe npm-cli.js install ...`，并确认非 Windows 仍保持 `npm` PATH 行为。

### 可复用文件遍历 helper 必须自己做 root 边界校验（2026-05-10）

**症状**：ZIP 导出入口虽然在 route 层拦截了 `..` 和绝对路径，但底层 `collectExportFiles(mindRoot, dirPath)` 直接 `path.join(mindRoot, dirPath)` 后递归遍历。其他调用方若直接复用该 helper，传入 `../outside` 会读取 MIND_ROOT 外的目录。

**根因**：安全校验放在单个 API route，而不是放在实际执行文件系统遍历的 core helper。route-level 校验容易遗漏 Windows 绝对路径、反斜杠路径或未来新增调用方。

**修复**：`collectExportFiles()` 先调用共享 `resolveSafe()`，再检查目录是否存在并递归遍历。

**防回归**：`packages/web/__tests__/core/export.test.ts` 创建 MIND_ROOT 外的 sibling 目录，确认 traversal 在目录存在性检查前被拒绝。

### 路径边界检查不要拼 `root + '/'`（2026-05-10）

**症状**：Sync 配置里保存的 `mindRoot` 如果带尾部斜杠，`isPathWithinMindRoot(root + '/', 'notes/todo.md')` 会把正常子文件误判成 root 外路径；Windows 上硬编码 `/` 还会和 `\` 分隔符不一致。

**根因**：路径边界检查直接比较字符串前缀 `normalizedPath.startsWith(mindRoot + '/')`，没有先规范化 root，也没有使用平台对应的相对路径判断。

**修复**：使用 `resolve(root)` + `resolve(root, filePath)` + `relative(root, target)`，只要 relative 不是 `..` 开头且不是绝对路径就视为 root 内。

**防回归**：`packages/web/__tests__/lib/sync-config-path.test.ts` 覆盖尾斜杠 root 的正常子路径和 traversal 拦截。

### 自定义 Agent 路径校验要覆盖编辑入口和 Windows 分隔符（2026-05-10）

**症状**：Windows 上新建自定义 Agent 时 `C:\Users\Ada\.qclaw\` 可以通过校验，但编辑同一个 Agent 的 `baseDir` 会返回 `baseDir must be an absolute path`。

**根因**：create 入口有 Windows drive-letter 特判，PUT/edit 入口仍只接受 `~/` 或 `/`；其他 detect/copy 入口也各自手写路径判断，行为不一致。

**修复**：抽出共享路径输入判断，统一接受 `~/`、`~\`、Unix 绝对路径，以及 Windows 下的 drive-letter/UNC 绝对路径；路径拼接 helper 同时识别 `/` 和 `\` 尾部分隔符。

**防回归**：`packages/mindos/src/server.test.ts` 在 `win32` 平台 mock 下覆盖自定义 Agent 编辑 Windows `baseDir`。

### Web 侧自定义 Agent helper 也要跟产品 handler 同步（2026-05-10）

**症状**：产品 server handler 已支持 Windows 自定义 Agent 路径后，`packages/web/lib/custom-agents.ts` 仍会把 `C:\Users\Ada\.agent\` 变成 `C:\Users\Ada\.agent\/`，并拒绝 `~\.agent\` 这种 Windows 用户会输入的 home-relative 路径。`/api/mcp/agents` 仍复用这个 Web helper 扫描自定义 Agent skills。

**根因**：Web helper 是历史遗留的重复实现，路径默认值、skillDir 拼接、detectBaseDir 和 validateCustomAgentInput 没有跟 `@geminilight/mindos/server` 里的修复同步。

**修复**：Web helper 复用同样的尾部分隔符判断和 path segment 拼接；`expandHome()` 同时支持 `~/` 和 `~\`。

**防回归**：`tests/unit/custom-agents.test.ts` 覆盖 Windows 尾反斜杠默认值与 `~\` 输入；`packages/web/__tests__/core/mcp-agents-windows-paths.test.ts` 覆盖 `~\` expansion。

### 产品 MCP handler 的 home expansion 也要支持 Windows `~\`（2026-05-10）

**症状**：自定义 Agent 保存了 `~\.agent\mcp.json` 这类 Windows 风格 home-relative 路径后，产品 runtime 的 MCP 安装/卸载和 Agent discovery 会把它当成普通相对路径，导致找不到实际配置文件，或把配置写到错误位置。

**根因**：`packages/mindos/src/server/handlers/mcp-install.ts` 和 `mcp-agents.ts` 各自有一份 `expandHome()`，都只识别 `~/`，没有跟 custom-agent handler 的 `~\` 修复同步。

**修复**：两个产品 MCP handler 的 `expandHome()` 同时识别 `~/` 和 `~\`。

**防回归**：`packages/mindos/src/server.test.ts` 覆盖 Windows 风格 home-relative MCP config 的卸载和 custom Agent discovery。

### ACP 本地检测的 override / presence path 也要支持 Windows `~\`（2026-05-10）

**症状**：Windows 用户把 ACP Agent override command 或 presence directory 配成 `~\Tools\agent.exe`、`~\.codex\` 时，本地检测会当成普通路径，导致已安装 Agent 显示为未安装。

**根因**：`packages/mindos/src/protocols/acp/detect-local.ts` 的 `expandHome()` 只处理 `~` 和 `~/`，但 `isPathLikeCommand()` 又会把带反斜杠的 command 识别为 path-like，最后 lookup 不走 PATH，也不正确展开 home。

**修复**：ACP local detection 的 home expansion 同时支持 `~/` 和 `~\`，并用 `path.resolve()` 组合 home 与剩余路径。

**防回归**：`packages/mindos/src/protocols/acp/detect-local.test.ts` 覆盖 Windows 风格 home-relative direct command 和 presence directory。

### 共享 root containment 不要手写 `startsWith(root + path.sep)`（2026-05-10）

**症状**：调用 `assertWithinRoot('/test/root/file.txt', '/test/root/')` 或 `isWithinRoot(..., '/test/root/')` 时会被误判为 outside root。部分调用方会先 normalize root 避开，但共享 helper 本身暴露这个坑。

**根因**：`packages/mindos/src/foundation/security/index.ts` 用字符串拼接 `root + path.sep` 做边界判断；root 自带尾部分隔符时变成双分隔符，跨平台和直接调用都容易出现 false negative。

**修复**：root containment 统一走 `path.resolve()` + `path.relative()`，只允许 relative 为空、非 `..` 开头且非绝对路径的目标。

**防回归**：`packages/mindos/src/foundation/security/path-safety.test.ts` 覆盖尾斜杠 root 正常子路径和 sibling prefix 拒绝。

### API route 不要用 `includes('..')` 代替 safe resolver（2026-05-10）

**症状**：导出合法文件 `notes..md` 会直接返回 400 `Invalid path`，用户无法下载文件名里包含连续点号的笔记。

**根因**：`packages/web/app/api/export/route.ts` 在 route 层用 `filePath.includes('..')` 做粗粒度拦截，误伤合法文件名；真正的 traversal 其实已经由 `resolveSafe()` / `collectExportFiles()` 处理。

**修复**：route 层只提前拒绝 POSIX/Windows 绝对路径；相对路径交给 core safe resolver 判断，避免重复且过宽的字符串规则。

**防回归**：`packages/web/__tests__/api/export.test.ts` 覆盖 `notes..md` 正常导出与 `../secret.md` traversal 拦截。

### 自定义 Agent 目标路径不要用 `includes('..')` 判断 traversal（2026-05-10）

**症状**：给自定义 Agent 复制 Skill 时，合法目录名如 `target..skills` 会返回 400 `Invalid target path`，导致用户无法使用包含连续点号的 agent skills 目录。

**根因**：`handleAgentCopySkillPost()` 用 `targetPath.includes('..')` 判断路径穿越，误把文件夹名中的普通点号当成父目录段。该接口本来允许用户选择任意绝对目标目录，因此需要区分 `..` 路径段和普通文件名字符。

**修复**：把 target path 校验改为按 POSIX/Windows 分隔符拆分，仅拒绝完整的 `..` segment；继续要求目标路径是绝对路径或 home-relative 路径。

**防回归**：`packages/mindos/src/server.test.ts` 覆盖 `target..skills` 正常复制，以及显式 `parent/../target-skills` 仍返回 400。

### Desktop runtime path containment 不要用点号 substring 判断（2026-05-10）

**症状**：用户 home 目录或测试临时目录名包含连续点号（如 `mindos..desktop-home-*`）时，Desktop updater 的合法 runtime 路径会报 `SECURITY: Path traversal detected`。

**根因**：`validateRuntimePath()` 同时用 `targetPath.includes('..')` 和 `relative.includes('..')` 判断路径穿越，误伤普通目录名。路径是否越界应由 resolved path 与 `.mindos` root 的相对关系决定，不能用整串 substring。

**修复**：只拒绝完整的 `..` 路径段；目录边界统一用 `path.relative(root, target)` 判断 `..` / absolute relative path。

**防回归**：`packages/desktop/src/safe-paths.test.ts` 覆盖连续点号 home 目录下的合法 runtime path，以及 `.mindos-other` sibling 目录必须被拒绝。

### Sync 冲突路径 containment 不要用 `startsWith('..')`（2026-05-10）

**症状**：Git sync 冲突预览/解决合法文件 `..notes/note.md` 会返回 400 `Invalid file path`，虽然文件仍在 `mindRoot` 内。

**根因**：Web 与 product server 各有一份 `isPathWithinMindRoot()`，都用 `relative(root, target).startsWith('..')` 判断越界，误把 `..notes` 这种普通目录名当成父目录穿越。

**修复**：相对路径 containment 只拒绝 `rel === '..'`、`rel.startsWith('..' + path.sep)` 或 `path.isAbsolute(rel)`；不要拒绝普通文件名里的连续点号。

**防回归**：`packages/web/__tests__/lib/sync-config-path.test.ts` 覆盖 `..notes/todo.md`；`packages/mindos/src/server.test.ts` 覆盖 product sync conflict preview 读取 `..notes/note.md`。

### 共享 root containment 也要允许普通 `..name` 路径段（2026-05-10）

**症状**：`resolveSafe(root, '..notes/file.txt')` 会抛 `Access denied: path outside root`，虽然目标文件实际仍在 root 内。

**根因**：`@mindos/security` 的 `isPathWithinRoot()` 用 `relative.startsWith('..')` 判断越界，和 sync 路径 bug 一样误伤普通文件名。这个 helper 是共享安全边界，误判会扩散到多个文件/API 能力。

**修复**：共享 containment 只拒绝完整父目录段：`rel === '..'`、`rel.startsWith('..' + path.sep)` 或 absolute relative path。

**防回归**：`packages/mindos/src/foundation/security/path-safety.test.ts` 覆盖 `assertWithinRoot()`、`isWithinRoot()`、`resolveSafe()` 对 `..notes/file.txt` 的允许行为。

### Route/core 相对目录校验不要误伤 `..Name`（2026-05-10）

**症状**：Bootstrap `target_dir=..Notes` 会返回 400 `invalid target_dir`；Web 创建嵌套 Space 时，父目录 `..Parent` 会报 `Invalid parent path`。

**根因**：route/core 层把 `includes('..')` 当成 traversal 校验，误把普通相对目录名里的连续点号当成父目录段。底层 safe resolver 已经能区分父目录段，route 层不应该使用整串 substring。

**修复**：改为按 `/` / `\` 分隔符拆分，只拒绝完整 `..` segment；继续拒绝绝对路径、Windows 反斜杠 parent path 和真实 `../` traversal。

**防回归**：`packages/mindos/src/server.test.ts` 覆盖 bootstrap `target_dir=..Notes` 与 `../secret`；`packages/web/__tests__/core/create-space.test.ts` 覆盖 `..Parent` 嵌套 Space 与 `../Parent` traversal。

### Draft 文件名校验不要拒绝普通连续点号（2026-05-10）

**症状**：新建 draft 保存为 `meeting..notes` 会在前端报 `File name contains invalid characters`，无法创建合法文件名。

**根因**：`ViewPageClient` 用 `trimmed.includes('..')` 防 path traversal，但 draft 输入本身是单文件名；这种 substring 校验误伤了普通连续点号。

**修复**：文件名仍禁止 `/`、`\` 和系统非法字符；traversal 校验改成只拒绝完整 `..` path segment，允许 `meeting..notes` 这类普通名称。

**防回归**：`packages/web/__tests__/components/view-page-draft-name.test.tsx` 通过 jsdom 覆盖 draft 保存 `meeting..notes` 会调用 `createDraftAction('meeting..notes.md', '')`。

### Space 名称校验不要拒绝普通连续点号（2026-05-10）

**症状**：`SpaceManager.createSpace('Research..2026')` 返回 `VALIDATION_ERROR`，虽然这是合法的单段目录名。

**根因**：Space 名称已经禁止 `/`、`\`、`.`、`..` 和绝对路径，但额外的 `trimmed.includes('..')` 把普通连续点号误判成 traversal。

**修复**：保留单段路径约束，只拒绝精确的 `.` / `..`，不拒绝名称内部的连续点号。

**防回归**：`packages/mindos/src/knowledge/spaces/space-manager.test.ts` 覆盖 `Research..2026` 可以创建，同时既有 unsafe name case 继续覆盖 `../evil`、nested path 和 absolute path。

### 服务器生命周期测试不要绑定固定端口（2026-05-10）

**症状**：`@mindos/api` 的 lifecycle 测试直接监听 `localhost:3000`，在本机或 CI 已有服务占用该端口时会出现不稳定失败。

**根因**：测试验证的是 `ApiServer.start()/stop()` 生命周期，不需要固定端口；固定端口把外部环境状态引入了单元测试。

**修复**：生命周期测试使用 `port: 0` 让 OS 分配空闲端口，保留 start/stop 与日志断言。

**防回归**：`packages/retrieval/api/src/server.test.ts` 的 Server Lifecycle case 固定使用 `config.port = 0`，避免和开发服务器或其他测试进程抢端口。

### API server start 必须处理 listen error（2026-05-10）

**症状**：当配置端口已被占用时，`ApiServer.start()` 不会返回失败 `Result`，调用方可能一直等待；底层 server 的 `error` 事件也可能变成未捕获异常。

**根因**：`start()` 只在 `listen` 成功 callback 中 resolve，没有监听 HTTP server 的 `error` 事件。

**修复**：`start()` 同时监听 `listening` 与 `error`：成功时返回 `ok`，失败时清理 `this.server` 并返回 `INTERNAL_ERROR`。

**防回归**：`packages/retrieval/api/src/server.test.ts` 用临时 TCP server 占用 OS 分配端口，确认 `ApiServer.start()` 返回 `INTERNAL_ERROR` 且不会触发 uncaught exception。

### Skill copy 校验不要把安全的连续点当成路径穿越（2026-05-10）

**症状**：Agent skill copy handler 会拒绝 `agent..skill` 这类合法 skill 目录名，返回 `Invalid skill name`，即使目录名没有 `/` 或 `\`，无法发生路径分段穿越。

**根因**：`handleAgentCopySkillPost()` 用 `skillName.includes('..')` 做路径安全校验，误把普通单段目录名中的连续点当成父目录段。

**修复**：skill name 只拒绝真实危险单段：`.`、`..`、含 `/` 或含 `\`；target path 仍用按分隔符拆分的 `hasParentDirectorySegment()` 拦截实际 `..` 段。

**防回归**：`packages/mindos/src/server.test.ts` 覆盖 `agent..skill` 可以从 skill root copy 到目标目录，同时保留 `../mindos` 和 target path 中真实 `..` 段的拒绝用例。

### MCP HTTP server listen error 必须走显式错误路径（2026-05-10）

**症状**：显式以 HTTP transport 启动 `mindos mcp`，且 MCP 端口已被占用时，Node 会输出 `Unhandled 'error' event` 和堆栈，用户看不到可执行的修复建议。

**根因**：`httpServer.listen()` 只注册了成功 callback，没有注册 `error` listener。端口占用等启动失败会作为 server `error` 事件抛出，而不是进入 `main().catch()`。

**修复**：把 HTTP server 启动包装成 `listenHttpServer()` promise，同时监听 `listening` 和 `error`；`EADDRINUSE` 输出明确的端口占用提示和 `MINDOS_MCP_PORT` 迁移建议。

**防回归**：`tests/unit/cli-mcp-stdio-default.test.ts` 用临时 TCP server 占用动态端口，确认显式 HTTP transport 会非零退出、输出 `MCP HTTP port ... is already in use`，且不再出现 `Unhandled 'error' event`。

### 时间边界测试必须固定 Date.now（2026-05-10）

**症状**：`DailyEcho Storage > cleanupOldReports() > should keep reports at boundary (30 days ago)` 在全量 web 测试中偶发失败，刚创建的“正好 30 天前”报告被 cleanup 删除。

**根因**：测试用一次 `Date.now()` 生成 boundary report，`cleanup()` 内部再调用一次 `Date.now()` 计算 cutoff。两次调用相差几毫秒，导致“正好 30 天前”的 report 实际变成 cutoff 之前。

**修复**：边界测试必须用 fake clock 或 `vi.spyOn(Date, 'now')` 固定时间；不要用多个真实时钟调用验证精确毫秒边界。

**防回归**：`packages/web/__tests__/lib/daily-echo-storage.test.ts` 固定 `Date.now()` 后再构造 30 天边界 report，避免全量 gate 因调度延迟随机失败。

### npm package name 校验不要拒绝中间连续点（2026-05-10）

**症状**：ACP install handler 会拒绝 `agent..plugin` 这类 npm 包名，返回 `Invalid package name`，即使 npm package name 规则只禁止以 `.` 开头等情况，并不禁止名称中间出现连续点。

**根因**：`isValidNpmPackageName()` 在 regex 之外额外使用 `value.includes('..')`，把路径穿越语义套到了 npm 包名上。实际危险输入已经由首字符、slash scope 结构、backslash 和 URL-friendly 字符规则拦截。

**修复**：移除 `includes('..')`，保留长度、反斜杠和 npm 包名结构校验。

**防回归**：`packages/mindos/src/server.test.ts` 覆盖 `agent..plugin` 能进入 ACP install flow，同时 `../bad` 仍然返回 `Invalid package name`。

### 删除风险评估不要把 `..name` 当成系统路径（2026-05-10）

**症状**：Desktop 与产品 CLI 的 `assessDeletionRisk()` 会把 `.mindos/..cache/runtime` 这种仍在配置目录内的路径标记为 `isSystemPath: true`，误报为系统路径风险。

**根因**：风险评估用 `path.relative(configDir, filePath).startsWith('..')` 判断越界，和其他 containment bug 一样误伤 `..cache` 这类普通目录名。

**修复**：用 `path.relative(path.resolve(root), path.resolve(target))` 判断 containment，只把 `..`、`../...` 或 absolute relative path 视为越界。

**防回归**：`packages/desktop/src/safe-rm.test.ts` 与 `tests/unit/cli-safe-rm.test.ts` 覆盖 `.mindos/..cache/runtime` 不算系统路径，以及 `.mindos-other/runtime` sibling 仍算系统路径。

### Desktop updater 路径白名单要覆盖 getRuntimePaths 全量输出（2026-05-10）

**症状**：Desktop updater 下载运行时后，`getRuntimePaths()` 生成的 `tarballPath` 是 `~/.mindos/runtime-download.tar.gz`，但 `validateRuntimePath()` 会报 `SECURITY: Subdirectory not whitelisted: runtime-download.tar.gz`。

**根因**：安全校验只白名单了 runtime 目录和 `config.json` 等少数顶层项，新增/已有的顶层 runtime artifact 没有和 `getRuntimePaths()` 的返回值做一致性测试。

**修复**：把 `runtime-download.tar.gz` 纳入 updater 可管理顶层项；新增测试确保 `getRuntimePaths()` 返回的每个路径都能通过 `validateRuntimePath()`。

**防回归**：`packages/desktop/src/safe-paths.test.ts` 覆盖 Desktop runtime 路径生成器与 validator 的自一致性。

### Web 全量测试中的动态 import smoke test 要给足超时预算（2026-05-10）

**症状**：`@mindos/web` 全量 Vitest 并发执行时，`__tests__/core/request-scoped-tools.test.ts` 偶发在默认 5s 超时。单独运行约 0.7s 通过，但与多个 ESLint 合约测试、Next build 后续测试并发时，动态 import `@/lib/agent/tools` 会被 CPU/transform 竞争拖慢。

**根因**：这个测试验证的是工具注册 contract，不是性能 SLA；默认 5s 超时在全量 gate 高负载下过紧，导致无产品回归的 push 被阻断。

**修复**：只给该 contract test 设置 15s 超时，保留行为断言不变。

**防回归**：pre-push `turbo run test` 会覆盖 `@mindos/web` 全量测试，避免该 smoke contract 在高负载下继续随机失败。

### MCP install 生成 TOML/YAML 时必须转义配置值（2026-05-10）

**症状**：通过 CLI 或产品 API 安装 MCP HTTP 配置时，如果 URL、Authorization token、命令参数或 header key 含有 `"`、换行、`.` 等特殊字符，生成的 TOML/YAML 会语法损坏，甚至把一个 server 名错误拆成多层 key。

**根因**：`buildTomlEntry()` / `buildYamlEntry()` 用字符串插值直接拼接 quoted value 和 mapping key，没有统一转义，也没有区分 TOML bare key 与 quoted key。

**修复**：TOML/YAML 的值统一走 JSON-style quoted string；非 bare key 统一加引号。TOML table path 对 `sectionKey` 仍按点分层，但把 server name 和 env/header key 作为独立 key 格式化。

**防回归**：`tests/unit/cli-mcp-install-toml.test.ts`、`tests/unit/cli-mcp-install-yaml.test.ts` 和 `packages/mindos/src/server.test.ts` 覆盖含引号、换行和点号 key 的生成结果。

### Windows SSH_ASKPASS 不能用 batch echo 拼接密钥口令（2026-05-10）

**症状**：Desktop Remote mode 在 Windows 上给 `ssh-add` 提供 passphrase 时，如果口令含 `&`、`|`、`<`、`>`、`"`、`^`、`%`、`!` 等 cmd metachar，临时 askpass `.bat` 可能输出错误口令或被 `cmd.exe` 解释成额外语法。

**根因**：Windows 分支用 `echo ${escaped}` 生成 askpass 脚本。batch escaping 很难覆盖所有组合，且 `echo` 本身有 option/状态语义。

**修复**：Windows askpass 脚本只运行 `powershell.exe -EncodedCommand ...`，passphrase 用 UTF-8 base64 放进 encoded PowerShell command，由 PowerShell 解码后直接写 stdout，避免交给 batch 解析。

**防回归**：`packages/desktop/src/ssh-tunnel.test.ts` 覆盖含 batch metachar 的 passphrase，确认脚本不包含 raw passphrase 或 `echo <passphrase>`，并能从 encoded command 还原原始口令。

### Desktop Node bootstrap 下载重定向要解析相对 Location（2026-05-10）

**症状**：Desktop 首次启动需要下载私有 Node.js runtime 时，如果 CDN / mirror 返回 `Location: /path/to/archive` 这类相对重定向，下载流程会把 `/path/to/archive` 直接传给 `https.get()`，后续请求缺少协议和 host。

**根因**：`downloadFile()` follow redirect 时直接使用 `res.headers.location`，没有按当前请求 URL 解析 relative URL。

**修复**：用 `new URL(location, reqUrl).toString()` 生成下一跳 URL，保留绝对 redirect 行为，同时支持根相对和路径相对 redirect。

**防回归**：`packages/desktop/src/node-bootstrap.test.ts` 模拟 `302 Location: /mirrors/node.tar.gz`，确认第二次请求是 `https://node.example/mirrors/node.tar.gz`。

### Sync conflict 路径校验必须复用 resolveSafe（2026-05-10）

**症状**：`/api/sync` 的 `conflict-preview` / `resolve-conflict` 在 POSIX 主机上会接受 `..\\outside.md`，返回空 preview 或继续处理；这和文件 API / CLI 已经修复的 backslash traversal 规则不一致。

**根因**：sync handler 自己用 `path.resolve()` + `path.relative()` 做 containment，且只按当前平台的 `path.sep` 判断 `..`。在 POSIX 上反斜杠不是分隔符，Windows 风格 traversal 没有被拦截。

**修复**：sync conflict 路径解析统一走 `resolveSafe()`，让 backslash normalization、Windows absolute path 和 root containment 逻辑与全局安全模块一致。

**防回归**：`packages/mindos/src/server.test.ts` 覆盖 `conflict-preview` 对 `..\\outside.md` 返回 `Invalid file path`，同时保留 `..notes/note.md` 这类合法单段 dotted 目录。

### Web sync-config 路径校验也要处理 Windows 分隔符（2026-05-10）

**症状**：`packages/web/lib/sync-config.ts` 的 `isPathWithinMindRoot()` 在 POSIX 主机上会接受 `..\\outside.md`，因为反斜杠被当作普通文件名字符。

**根因**：该 helper 自己使用 `path.resolve()` + `path.relative()`，但只按当前平台的 `path.sep` 判断父目录前缀。Web 层虽然最终多通过 product server 执行操作，但这个 helper 被 CLI/Web 共用，不能留下跨平台语义差异。

**修复**：校验前把反斜杠规范化为 `/`，并拒绝 POSIX absolute、Windows absolute 和 UNC absolute path，再做 root containment。

**防回归**：`packages/web/__tests__/lib/sync-config-path.test.ts` 覆盖 `..\\outside.md` 在 POSIX host 上必须返回 `false`，同时保留 `..notes/todo.md` 这种合法单段 dotted 目录。

### Web 目录 helper 不能绕过 resolveSafe（2026-05-10）

**症状**：`/view/[...path]` 这类目录视图调用 `isDirectory()`、`getDirEntries()`、`getSpacePreview()` 时，`../sibling-dir` 可以让 Web 层探测或列出 `MIND_ROOT` 同级目录。文件读取已经走 `resolveSafe()`，但目录 helper 仍使用直接 `path.resolve(path.join(...))`。

**根因**：目录 helper 把非法路径当作普通目录查询，并在 UI 层用空数组/null 处理读取失败；解析失败和路径越界没有统一进入安全模块。

**修复**：三个目录 helper 统一先走 `resolveSafe()`。非法路径沿用原有 UI fallback：`isDirectory=false`、`getDirEntries=[]`、`getSpacePreview=null`。

**防回归**：`packages/web/__tests__/core/fs-public-paths.test.ts` 创建 `MIND_ROOT` 同级目录，用相对 traversal 验证目录探测、列表和 space preview 都不会泄露。

### Server Action 路径 containment 禁止字符串 startsWith（2026-05-10）

**症状**：`revertSpaceInitAction()` 使用 `path.resolve(mindRoot, spacePath)` 后再 `absDir.startsWith(mindRoot)` 判断越界。若 `MIND_ROOT=/tmp/root`，输入 `../root-outside` 会解析到 `/tmp/root-outside`，字符串前缀仍匹配，导致 README/INSTRUCTION scaffold 写到 vault 外。

**根因**：字符串前缀不是路径 containment。它无法区分真实子路径和同名前缀 sibling，也无法统一处理 Windows 分隔符、绝对路径和 traversal。

**修复**：server action 内所有用户传入的 vault 相对路径先走 `resolveSafe()`，禁止自行实现 containment。

**防回归**：`packages/web/__tests__/actions/revert-space-init-path.test.ts` 创建 `MIND_ROOT` 同名前缀 sibling 目录，验证 `revertSpaceInitAction()` 不返回 success，也不会在 sibling 写 scaffold 文件。

### UI create-file action 的 fileName 必须是单段文件名（2026-05-10）

**症状**：`createFileAction(dirPath, fileName)` 把 `fileName` 当成纯文件名显示给用户输入，但没有拒绝 `/` 或 `\\`。在选中 `Selected/` 时输入 `../evil.md` 会组合成 `Selected/../evil.md`，最终在 vault 根目录创建文件，绕过用户选择的目标目录。

**根因**：action 层混淆了“目录路径”和“文件名”两个字段；底层 `resolveSafe()` 只保证不出 vault，不保证新文件仍在所选目录。

**修复**：action 层先校验 `fileName` 不包含路径分隔符，再拼接 `dirPath/finalName`。

**防回归**：`packages/web/__tests__/actions/revert-space-init-path.test.ts` 覆盖 `createFileAction('Selected', '../evil.md')` 必须失败，且不会在 vault 根目录创建 `evil.md`。

### resolveSafe 必须拒绝 Windows drive-relative 路径（2026-05-10）

**症状**：`resolveSafe(root, 'C:secret.md')` 在 POSIX host 上会被当成普通相对路径接受。虽然它不是 `C:\secret.md` 这种 Windows absolute path，但在 Windows 语义里属于 drive-relative / drive-prefixed 输入，不是跨平台稳定的 vault 相对路径。

**根因**：安全检查只覆盖了 `path.isAbsolute()`、`path.win32.isAbsolute()` 和 traversal。`path.win32.isAbsolute('C:secret.md')` 返回 false，导致 drive-prefix 输入漏过校验。

**修复**：共享 security resolver 在 normalized 前后都拒绝 `/^[A-Za-z]:/`，所有 Web wrapper、server handler、CLI helper 统一继承该行为。

**防回归**：`packages/mindos/src/foundation/security/path-safety.test.ts` 覆盖 `C:secret.md` 和 `d:Projects/note.md`，要求即使在 POSIX host 上也必须抛错。

### Desktop tar entry 也必须拒绝 Windows drive-relative 路径（2026-05-10）

**症状**：Windows runtime updater 的 JS tar extractor 已拒绝 `../evil`、`/absolute` 和 `C:\absolute`，但在 POSIX host 上会把 `C:evil.txt` 当成普通文件名写入目标目录。

**根因**：tar entry containment helper 和共享 `resolveSafe()` 有相同遗漏：`path.win32.isAbsolute('C:evil.txt')` 返回 false，不能覆盖 drive-relative / drive-prefixed 输入。

**修复**：`resolveTarEntryPath()` 在原始 entry name 和 normalized entry name 上都拒绝 `/^[A-Za-z]:/`，避免跨平台 tar entry 语义分歧。

**防回归**：`packages/desktop/src/core-updater-tar.test.ts` 构造 `C:evil.txt` tar entry，要求 extractor 抛出 `outside extraction directory`，且不会写入目标目录。

### Obsidian Vault shim 不能跟随指向 vault 外的 symlink（2026-05-10）

**症状**：`.plugins` 之外的 Obsidian compatibility `Vault.getFiles()` 用 `fs.statSync()` 递归目录。若 vault 内有 `linked-outside -> /tmp/outside` 这种 symlink，插件看到的文件列表会包含 `linked-outside/secret.md`，`getFileByPath()` 也会返回可读文件对象。

**根因**：`resolveSafe()` 只做词法路径 containment，不能阻止真实文件系统 symlink 把已解析的 vault 内路径跳到 vault 外；同时 `statSync()` 会跟随 symlink。

**修复**：Vault shim 递归时改用 `lstatSync()` 并跳过 symlink；直接读取/查找已存在路径时校验 `realpath` 仍在 `mindRoot` 的真实路径内。

**防回归**：`packages/web/__tests__/obsidian-compat/vault.test.ts` 构造指向 vault 外的目录 symlink，验证 `getFiles()` 不暴露外部文件，`getFileByPath()` 返回 null。

### 核心文件读写不能只依赖词法路径 containment（2026-05-10）

**症状**：文件读写入口虽然调用了 `resolveSafe()`，但如果知识库内存在 `linked-outside -> /tmp/outside`，`linked-outside/secret.md` 会在词法上落在 root 内，实际读写却跟随 symlink 到 root 外。更隐蔽的是 `linked-outside/new.md` 这类目标文件还不存在的写入，也会通过已存在的 symlink 父目录落到 root 外。

**根因**：`resolveSafe()` 只保证字符串路径没有 traversal / absolute path；它不知道文件系统 realpath。写入新文件时只检查目标是否存在也不够，必须检查最近的已存在父路径是否仍真实位于 root 内。

**修复**：共享安全层新增 `resolveExistingSafe()`，对目标或最近已存在父路径做 `realpath` containment 校验；Product Server 文件操作、raw file、runtime read/stat、Web core fs-ops/lines/pdf 分支统一使用该入口。

**防回归**：`packages/mindos/src/foundation/security/path-safety.test.ts`、`packages/mindos/src/server.test.ts`、`packages/web/__tests__/core/fs-ops.test.ts`、`packages/web/__tests__/core/lines.test.ts` 覆盖 symlink escape 的读、写、新建和 raw file 场景。

### Web 目录 helper 和元数据日志也要做 realpath containment（2026-05-10）

**症状**：`isDirectory()`、`getDirEntries()`、`getSpacePreview()`、tree start directory、Space scaffold、`.mindos/change-log.json`、`.mindos/agent-audit-log.json` 这类入口不是普通文件内容读写，但同样会触碰用户 vault 内路径。若目录或 `.mindos` 是指向 root 外的 symlink，可能列出外部目录或把日志写到外部位置。

**根因**：这些 helper 容易被当成“内部路径”而直接 `path.join()` / `fs.statSync()`；但 vault 是用户可写目录，内部目录名本身也不能被信任。

**修复**：Web 目录 helper、tree 显式 start directory、Space scaffold/create-space、content change log、agent audit log 统一在访问前做 `resolveExistingSafe()` 或等价 realpath containment。

**防回归**：`packages/web/__tests__/core/fs-public-paths.test.ts`、`packages/web/__tests__/core/tree.test.ts`、`packages/web/__tests__/core/tree-async.test.ts`、`packages/web/__tests__/core/space-scaffold.test.ts`、`packages/web/__tests__/core/create-space.test.ts`、`packages/web/__tests__/core/content-changes.test.ts`、`packages/web/__tests__/core/agent-audit-log.test.ts` 覆盖 symlinked directory / `.mindos` 场景。

### Inbox 目录是用户可控路径，不能假设固定子目录安全（2026-05-10）

**症状**：Inbox 捕获区用 `path.resolve(mindRoot, 'Inbox')` 作为固定内部目录。若用户 vault 里 `Inbox` 是指向 root 外的 symlink，保存捕获文件、列出 Inbox、归档到 `.processed` 都可能访问 root 外目录。

**根因**：固定目录名不等于可信目录。只要目录位于用户可写 vault 内，就必须和普通用户路径一样做 realpath containment。

**修复**：Product Server 与 Web core 的 Inbox ensure/list/save/archive/delete/processed-list 入口统一通过 `resolveExistingSafe()` 校验 `Inbox` 或 `Inbox/.processed`。

**防回归**：`packages/mindos/src/server.test.ts` 覆盖 Product Inbox symlink 拒绝；`packages/web/__tests__/core/inbox.test.ts` 覆盖 Web Inbox ensure/list/archive symlink 拒绝。

### Trash 恢复/删除入口必须同时校验原路径和 trashId（2026-05-10）

**症状**：Web trash 模块把 `filePath` 通过 `resolveSafe()` 后移动到 sibling `.trash`，仍可能跟随 vault 内 symlink 删除 root 外文件；恢复时若 metadata 的 `originalPath` 指向 symlink 父目录，也可能把 trash 内容恢复到 root 外。`trashId` 若包含路径分隔符，还可能绕出 `.trash` / `.trash-meta` 目录。

**根因**：Trash 既处理用户文件路径，也处理持久化 metadata 里的路径和 URL/动作传入的 `trashId`。这三类值都不能只做词法拼接。

**修复**：Trash 文件源路径、恢复目标、copy 目标统一使用 `resolveExistingSafe()`；所有 `trashId` 必须是单段 id，禁止 `/`、`\`、空值和 basename 不一致。

**防回归**：`packages/web/__tests__/core/trash.test.ts` 覆盖 symlink 删除、symlink 恢复和 trashId traversal。

### Product knowledge audit 不能假设 `.mindos` 元数据目录可信（2026-05-10）

**症状**：`@geminilight/mindos` 的 knowledge audit 独立于 Web core 实现，也会读写 `.mindos/change-log.json`、`.mindos/agent-audit-log.json` 和 legacy `Agent-Diff.md` / `.agent-log.json`。若 `.mindos` 是指向 root 外的 symlink，agent activity / change log 写入可能落到 root 外。

**根因**：共享 product 层接受 `IFileSystem`，早期只做 `path.join(mindRoot, ...)`。即使 Web core 已修，同名 product audit 实现仍需独立校验。

**修复**：当 `mindRoot` 是真实本地目录时，knowledge audit 所有 metadata/legacy 路径统一走 `resolveExistingSafe()`；in-memory test FS 继续使用原来的虚拟路径。

**防回归**：`packages/mindos/src/knowledge/audit/audit-log.test.ts` 使用 `LocalFileSystem` 覆盖 symlinked `.mindos` 拒绝写入。

### Web 直接文件助手不能只在 API 层防 symlink（2026-05-10）

**症状**：CSV 行追加、目录导出这类 core helper 会直接调用 `appendFileSync`、`readFileSync`、`readdirSync`。如果只用 `resolveSafe()` 做词法检查，vault 内的 symlink parent 可以让追加或导出访问 root 外文件。

**根因**：API handler 或上层 workflow 的校验不能替代 core helper 的边界检查；任何直接触碰真实文件系统的 helper 都必须自己校验 nearest existing path 的 realpath。

**修复**：CSV append 与 export collect 入口改用 `resolveExistingSafe()`，先拒绝 symlink 指向 root 外的入口再读写/遍历。

**防回归**：`packages/web/__tests__/core/csv.test.ts` 覆盖 symlink parent append 拒绝；`packages/web/__tests__/core/export.test.ts` 覆盖 symlink export root 拒绝。

### Product Server handler 也要独立做 realpath containment（2026-05-10）

**症状**：Product Server 的静态 artifact、上传冲突检查、space 描述读取、legacy `.agent-log.json` 写入不经过 Web core helper。若这些 handler 继续使用 `resolveSafe()` 或 `path.join(mindRoot, ...)` 后直接 `readFileSync` / `writeFileSync`，symlinked static asset、space README 或 `.mindos` 元数据目录会访问 root 外文件。

**根因**：monorepo 里 Web 和 Product Server 有两套运行入口。修 Web helper 不会自动保护 npm CLI / MCP HTTP / static runtime handler。

**修复**：Product Server handler 中会直接触碰真实文件系统的入口改为 `resolveExistingSafe()`；space 文件计数跳过 symlink；legacy audit metadata 写入先校验 `.mindos` realpath。

**防回归**：`packages/mindos/src/server.test.ts` 覆盖 symlinked README 不泄露描述、conflict check 拒绝 symlink space、legacy audit 拒绝 symlinked `.mindos`、static artifact 拒绝 symlink asset。

### Import / organize / search 后台路径和前台文件操作一样危险（2026-05-10）

**症状**：文件导入会根据 `targetSpace` 创建父目录并写入文件；导入后的 organize 会自动更新 README；搜索索引会单独解析 PDF。若这些后台入口只用 `resolveSafe()`，symlinked target space 或 PDF 文件可以让后台任务写入、读取或索引 root 外内容。

**根因**：后台 workflow 常被当作“内部调用”，但输入仍来自用户路径或从文件树事件传入。只要最终触碰真实文件系统，就必须在该 helper 内做 realpath containment。

**修复**：import unique path、organize README/related-file 读取、search index PDF 解析统一改用 `resolveExistingSafe()`。

**防回归**：`packages/web/__tests__/api/file-import.test.ts` 覆盖 symlinked target space 导入拒绝；`packages/web/__tests__/core/organize.test.ts` 覆盖 symlinked README 不写外部；`packages/web/__tests__/core/search-index.test.ts` 覆盖 symlinked PDF 不进入增量索引。

### 底层文件系统 wrapper 和 server action 不能只做词法隔离（2026-05-10）

**症状**：`RootedFileSystem`、Space 初始化回滚、Space overview、compile、git helper、二进制 view 检查都可能在不同入口直接触碰本地文件。如果只检查 `../` / 绝对路径，symlinked space 仍会把写入、读取或存在性判断带到 root 外。

**根因**：越底层的 wrapper 越容易被多个运行入口复用；一旦这里只做 lexical containment，上层很难逐个补齐。

**修复**：真实本地 root 存在时，`RootedFileSystem` 改用 `resolveExistingSafe()`；Space init revert、compile、git helper、binary view existence、Product Server space overview 改用 realpath containment。虚拟/in-memory root 继续保留原有词法路径行为。

**防回归**：`packages/mindos/src/knowledge/storage/rooted.test.ts` 覆盖 LocalFileSystem symlink parent 写入拒绝；`packages/web/__tests__/actions/revert-space-init-path.test.ts` 覆盖 symlinked space 回滚拒绝；`packages/mindos/src/server.test.ts` 覆盖 Product Server space overview symlink 拒绝。

### Sync conflict / gitignore 文件操作不能信任冲突路径（2026-05-10）

**症状**：sync handler 会读取/写入 `.gitignore`，也会读取 `file` 与 `file.sync-conflict` 来预览或解决冲突。若 `.gitignore` 或冲突文件父目录是 symlink，sync 操作可能覆盖 root 外文件。

**根因**：sync 的文件路径来自持久化 conflict state 或请求 payload，不是 git 自身的可信输出；保存 `.gitignore` 也会跟随同名 symlink。

**修复**：sync `.gitignore` 和 conflict path 统一通过 `resolveExistingSafe()`；symlink escape 在 preview/resolve 中视为 invalid path，在 `.gitignore` 保存中返回 403。

**防回归**：`packages/mindos/src/server.test.ts` 覆盖 symlinked `.gitignore` 保存拒绝、symlinked conflict preview/resolve 拒绝且不修改外部文件。

### Workflows / search / lint / Obsidian shim 也会绕过主文件 API（2026-05-10）

**症状**：workflow 创建直接写 `.mindos/workflows`，搜索和 lint 会在排序/过滤阶段 `stat` 文件，Obsidian compatibility shim 会直接读 markdown 或 stat 文件。如果这些路径绕开 core fs helper，symlinked metadata 目录或文件会造成外部读写/元数据泄露。

**根因**：这些模块是“辅助体验”入口，不一定走 `/api/file` 或 `fs-ops` 的统一读写路径。

**修复**：workflow 目录、workflow 模板、search mtime 过滤、index freshness check、lint stat、homepage existence check、recent-file mtime、Obsidian metadata/vault stat 全部改为 `resolveExistingSafe()`。

**防回归**：`packages/mindos/src/server.test.ts` 覆盖 symlinked `.mindos` 下 workflow 创建拒绝；现有 search-index / vault / lint 相关测试继续覆盖正常路径和类型检查。

### User skill 目录是可写入口，不能跟随 `.skills` symlink（2026-05-10）

**症状**：Product skills handler 会在 `mindRoot/.skills/<name>/SKILL.md` 创建、更新、删除用户 skill。若 `.skills` 是指向 root 外的 symlink，skill 写入会落到外部目录；列表也可能暴露外部 skill。

**根因**：`.skills` 看起来像内部目录，但位于用户知识库内，仍然是用户可控路径。

**修复**：`mindos-user` skill root 若自身是 symlink 则不参与列表；create/update/delete 前通过 `resolveExistingSafe(mindRoot, '.skills')` 校验。mindRoot 首次不存在时保留原有创建行为。

**防回归**：`packages/mindos/src/server.test.ts` 覆盖 symlinked `.skills` 不列出外部 skill，且 create 返回 403、不写外部目录。

### Obsidian `.plugins` 导入和状态文件也不能跟随 symlink（2026-05-10）

**症状**：Obsidian compatibility 的 plugin import / loader / manager 会扫描、复制、读取和写入 `mindRoot/.plugins`。若 `.plugins` 指向 root 外，导入插件、读取 manifest/main.js、写 `.plugin-manager.json` 都可能触碰外部目录。

**根因**：兼容层绕过主文件 API，且 `.plugins` 是用户 vault 内目录，不能当成可信内部目录。

**修复**：plugin loader、Obsidian import target、manager state/main.js 读取统一通过 `resolveExistingSafe()`；扫描时跳过 symlink plugin directory。

**防回归**：`packages/web/__tests__/obsidian-compat/obsidian-import.test.ts` 覆盖 symlinked target `.plugins` 导入拒绝；`packages/web/__tests__/obsidian-compat/plugin-manager.test.ts` 覆盖 symlinked `.plugins` 不发现外部 plugin、不写外部 state。

### CLI daemon / stop 逻辑不能假设路径简单，也不能广泛杀进程（2026-05-10）

**症状**：`mindos start --daemon` 写 systemd / launchd 配置时，如果 Node、CLI、HOME 或 log 路径里有空格、`&`、`<`、`%` 等字符，daemon 配置可能解析失败或生成非法 plist。`mindos stop` 在 PID 和端口兜底都失败时，如果用全局 `node.exe` 或宽泛 `next start|next dev` 匹配，会误杀用户其它 Node / Next 项目。

**根因**：daemon 配置文件不是 shell 字符串，systemd 和 plist 都有自己的转义规则；进程清理兜底也必须证明目标属于 MindOS，不能用“端口没查到就杀常见进程名”的策略。

**修复**：systemd unit / launchd plist 生成统一走可测 builder，并按目标格式转义；stop 兜底只匹配 MindOS CLI、MCP bundle、Web app 路径，Windows 不再做全局 `node.exe` 清理。sync 配置写入同批修复首次运行时父目录不存在和 BOM config 读取问题。

**防回归**：`tests/unit/cli-gateway.test.ts` 覆盖 systemd 路径和 plist XML 转义；`tests/unit/stop-restart.test.ts` 覆盖 stop 不再使用宽泛杀进程；`tests/unit/cli-sync.test.ts` 覆盖 sync 首次写配置和 BOM config 读取。

### Desktop orphan cleanup 不能只按 `node` / `next` 进程名杀进程（2026-05-10）

**症状**：Desktop 启动时会清理上次异常退出留下的 child PID，也会在端口被占用时尝试清理占用者。若 PID 文件过期且 PID 被系统复用，或端口刚好被用户其它 Node / Next 项目占用，只校验进程名包含 `node` / `next` 会误杀无关进程。

**根因**：PID 和端口都只能说明“可能相关”，不能证明进程属于 MindOS。Desktop 的清理动作必须进一步检查命令行是否来自 `.mindos/runtime`、`mindos-runtime`、`@geminilight/mindos`、MindOS Web standalone 或 MCP bundle。

**修复**：`ProcessManager.killIfNodeProcess` 改为读取命令行归属；Windows 用 PowerShell / wmic 取 `CommandLine`，Unix 用 `ps -o args=`，只有 `isMindosOwnedCommandLine()` 通过时才发送 SIGTERM。

**防回归**：`packages/desktop/src/process-manager-subprocess-contract.test.ts` 覆盖无关 Node / Next 命令行不被视为 MindOS，Desktop runtime / MCP / npm CLI 路径才允许清理。

### Desktop uninstall 脚本也不能无条件信任 PID 文件（2026-05-10）

**症状**：Desktop 写出的 `~/.mindos/uninstall.sh` / `uninstall.bat` 会读取 `mindos.pid`、`desktop-children.pid`、`ssh-tunnel.pid` 并清理残留进程。如果这些 PID 文件过期，PID 可能已被系统复用，卸载脚本会误杀用户其它进程。

**根因**：安装后残留清理脚本是独立文件，不会自动继承 `ProcessManager.killIfNodeProcess` 的运行时保护；脚本自身也必须校验命令行归属。

**修复**：Windows uninstall 通过 PowerShell `Get-CimInstance Win32_Process` 读取 `CommandLine` 后再 `taskkill`；Unix uninstall 通过 `ps -p "$pid" -o args=` 和 `is_mindos_cmd()` 判断。只有 `.mindos/runtime`、`mindos-runtime`、`@geminilight/mindos`、Web standalone 或 MCP bundle 路径才允许清理。

**防回归**：`packages/desktop/src/install-cli-shim.test.ts` 覆盖 Windows / Unix uninstall 脚本必须先检查命令行，且仍不触碰知识库。

### 本地 CLI `file` / `space` 命令也必须做 realpath containment（2026-05-10）

**症状**：`mindos file create/read`、`mindos space mkdir` 等本地 CLI 命令绕过 Web/Product Server handler，直接使用 `bin/lib/safe-path.js` 解析知识库路径。如果该 helper 只做 `..` / 绝对路径的词法检查，`mindRoot/Linked -> /outside` 这类 symlink parent 会让 CLI 写到 root 外；symlinked file 也会让 `file read` 读出外部内容。

**根因**：CLI command 是另一套文件入口，不能假设 Web 层的 `resolveExistingSafe()` 已覆盖。凡是会触碰真实文件系统的本地入口，都需要校验 nearest existing path 的 realpath 仍在 root realpath 内。

**修复**：`packages/mindos/bin/lib/safe-path.js` 在词法 containment 之后，对 nearest existing path 执行 `realpathSync` containment。新文件创建会校验已存在父目录，已有文件读取会校验目标本身。

**防回归**：`tests/unit/cli-file-safe-path.test.ts` 覆盖 symlink parent 写入拒绝、symlink file 读取拒绝；`tests/unit/cli-space-safe-path.test.ts` 覆盖 symlink parent 目录创建拒绝。

### CLI 启动迁移和同步备份也不能绕过 safe path helper（2026-05-10）

**症状**：`mindos start` 会把旧版 `user-rules.md` / `user-skill-rules.md` 迁移到 `.mindos/user-preferences.md`；`mindos init-skills` 会初始化同一文件；sync 初始化会维护 `.gitignore`，冲突时会写 `<file>.sync-conflict`。如果这些路径直接 `resolve(mindRoot, ...)`，`.mindos` 或 `.gitignore` symlink 指向 root 外时可能把文件写到外部目录，损坏用户不期望被 MindOS 管理的位置。

**根因**：这些不是常规 `file` / `space` 命令，但同样会写知识库目录。只要是基于 `mindRoot` 组合出的文件写入，都必须走同一套 realpath containment，而不是把“系统文件路径”当成可信内部路径。

**修复**：`start` 的偏好迁移、`init-skills` 的偏好初始化、sync `.gitignore` 和 conflict backup path 都改用 `resolveInsideRoot()`。发现 unsafe path 时跳过 best-effort migration 或显式拒绝初始化；冲突备份路径异常时只标记 `noBackup`，不写 root 外。

**防回归**：`tests/unit/cli-start-host.test.ts` 覆盖 `.mindos` symlink 时启动迁移不会写外部目录；`tests/unit/cli-init-skills-safe-path.test.ts` 覆盖 init-skills 拒绝 symlinked `.mindos`；`tests/unit/cli-sync.test.ts` 覆盖 conflict backup path 拒绝 `../` 越界，也覆盖 symlinked `.gitignore` 不会被写穿。

### 卸载命令不能信任相对 mindRoot（2026-05-10）

**症状**：`mindos uninstall` 会在三重确认后删除配置中的 knowledge base。若配置被错误写成 `.`、`relative/notes` 或 `~other/notes` 这类非明确绝对路径，卸载流程可能把当前工作目录或其它非预期位置当作知识库。

**根因**：卸载是高风险破坏性操作，不能只因为路径存在就进入删除确认。配置层通常写绝对路径，但卸载层仍必须对损坏配置做最后防线。

**修复**：新增 `normalizeUninstallMindRoot()`，只接受原生绝对路径或 `~/...` / `~\...` home-relative 路径；拒绝裸 `~`、`~user` 和所有相对路径。

**防回归**：`tests/unit/cli-uninstall.test.ts` 覆盖相对路径和 `~other` 被规范化为 `null`，同时保留 `~/MyNotes` 的原有行为。

### Setup 路径检查不能把相对路径当作知识库候选（2026-05-10）

**症状**：Onboarding / Settings 的路径检查接口如果收到 `relative-notes` 或 `.`，会按服务进程 cwd 去检查或列目录。这会误导用户把相对路径当作可用知识库位置，也可能把开发/运行目录的子目录暴露给目录选择 UI。

**根因**：`expandSetupPathHome()` 只负责展开 `~`，不会证明结果是绝对路径；`validateMindRootPath()` 原来只过滤已知危险目录，没有先校验路径形态。

**修复**：`validateMindRootPath()` 现在要求路径是 POSIX absolute 或 Windows absolute；`handleSetupListDirectories()` 对非绝对路径直接返回空列表。Windows 风格的 `D:/...` 仍可被跨平台 validator 正确识别为 absolute，保留现有 Desktop install-dir 判断。

**防回归**：`packages/mindos/src/server.test.ts` 覆盖相对路径 check/list 行为，并通过 Windows-style absolute path 既有用例保留跨平台 validator 行为。

### Config dot-path 不能允许原型污染 key（2026-05-10）

**症状**：`mindos config set <key> <value>` / `unset <key>` 支持 dot notation。如果允许 `__proto__.polluted`、`constructor.x` 或 `ai..provider` 这类 key，可能造成运行中对象原型被污染，或写出用户无法理解的异常配置结构。另一个相邻坑是把 `Infinity` / `1e309` 当 number 写入 JSON，`JSON.stringify` 会把非有限数字变成 `null`。

**根因**：配置命令把用户输入的 key 直接 `split('.')` 后逐层创建对象，没有先校验 key segment。

**修复**：新增 config key path 校验，拒绝空 segment 和 `__proto__` / `prototype` / `constructor`；数值 coercion 只接受 finite number，非有限数字保持为字符串。

**防回归**：`tests/unit/cli-config-command.test.ts` 覆盖危险 key set 被拒绝、配置文件不变、unset 空 segment 被拒绝，以及 `Infinity` 不会被写成 JSON `null`。

### MCP direct-tools 的 server key 也要防原型污染（2026-05-10）

**症状**：Settings 里调整 MCP server 的 direct tool exposure 时，接口接收 `{ server, directTools }`。如果 `server` 是 `__proto__` / `constructor` 这类特殊 key，底层配置更新可能拿到对象原型而不是普通 server entry。

**根因**：即使 UI 只会传真实 server name，API handler 仍是信任边界。所有被当作 object key 使用的用户输入都要做 unsafe key 过滤。

**修复**：`handleMcpDirectToolsPost()` trim server name，并拒绝空字符串、`__proto__`、`prototype`、`constructor`；更新和响应都使用规范化后的 server name。

**防回归**：`packages/mindos/src/server.test.ts` 覆盖 unsafe server name 返回 400，且不会调用更新服务或污染对象原型。

### Custom Agent key / MCP config path 也要防原型污染（2026-05-10）

**症状**：自定义 Agent 的 `key`、`configKey`、`globalNestedKey` 最终会进入 Agent registry、MCP install JSON 容器或 dot-path 读写。如果允许 `__proto__` / `constructor` 这类 key，安装和检测链路可能读取或写入对象原型；如果允许 `~/../...`，路径展示和后续写入语义也会变得不可预测。

**根因**：自定义 Agent 是用户可配置入口，不能沿用内置 Agent descriptor 的信任边界。MCP install/detect 读取 JSON 配置时也不能用普通 `obj[key]` 访问来自配置的 key。

**修复**：Custom Agent 创建/更新统一校验 agent key、dot-path key、format/transport 和绝对路径；MCP install/detect 对 nested path 与 agent config key 使用 reserved-key guard，并只读取 own property。

**防回归**：`packages/mindos/src/server.test.ts` 覆盖 unsafe custom agent key、unsafe nested config path、unsafe MCP install key；`tests/unit/custom-agents.test.ts` 覆盖 web helper 对 parent segment 和 unsafe key 的拒绝。

### MCP skill install 的 agent 参数不能直接透传（2026-05-10）

**症状**：`/api/mcp/install-skill` 会把请求里的 agent name 传给 `npx skills add -a <agent>`。即使底层使用 `execFileSync()` 而不是 shell 字符串，`--help`、`__proto__` 或空白值这类 agent name 仍可能被下游 CLI 当成选项、特殊 key 或脏配置。

**根因**：argv-safe 只解决 shell injection，不等于业务参数可信。凡是被转交给另一个 CLI 的用户输入，都要先按目标参数语义校验。

**修复**：安装 MindOS skill 前先校验 agent name 只能是安全标识符，拒绝 prototype sentinel 和以 `-` 开头的值；registry 里解析出的 `skillAgentName` 也要二次校验。

**防回归**：`packages/mindos/src/server.test.ts` 覆盖非法 agent name 不会调用 `runCommand()`。

### Settings skillPaths.custom 要按脏配置处理（2026-05-10）

**症状**：Settings API 如果把非数组或混有非字符串的 `skillPaths.custom` 写进 config，Product runtime 枚举 skill roots 时会对非字符串调用 `.trim()`，轻则加入异常 root，重则 runtime 崩溃。

**根因**：settings 是持久化信任边界，不能假设 UI 一定只写合法 shape；runtime 读取配置时也要按可能被用户手改过的 JSON 处理。

**修复**：Settings 写入时只保留字符串 custom skill path；runtime 枚举时再次确认 `custom` 是数组并跳过非字符串项。

**防回归**：`packages/mindos/src/server.test.ts` 覆盖 settings write 的 custom path 过滤，以及 runtime 对混合类型 custom paths 的容错。

### ACP agentId / env key 是 settings 信任边界（2026-05-10）

**症状**：ACP config API 接收 `{ agentId, config }` 后把 `agentId` 写进 `settings.acpAgents[agentId]`；session/install/registry 路径也会把 agentId 传给协议层。如果允许 `__proto__`、`--help` 或空白值，可能污染 settings 对象、误触下游参数语义，或让脏配置进入 ACP detection。

**根因**：ACP registry 中的 agent id 是可信 descriptor，但 API 请求里的 agentId 不是。env override key 同样会被写入对象，不能直接复制用户传入的 key。

**修复**：ACP config/install/registry/session 入口统一校验 agentId；读取已有 `acpAgents` 时也重新 sanitize；override env 只保留合法环境变量名并拒绝 prototype sentinel。

**防回归**：`packages/mindos/src/server.test.ts` 覆盖 unsafe ACP config agentId、install agentId、registry query 和 session create 都必须拒绝，且 env 里的 unsafe key 不会保留。

### A2A discovery URL 不能只检查非空字符串（2026-05-10）

**症状**：A2A discovery API 接收 `{ url }` 后直接交给 discovery service。如果允许 `file://...`、带用户名密码的 URL 或超长字符串，可能造成下游 fetch/日志/缓存行为不可预测，也会让用户以为本地文件或 credential URL 是支持的 discovery target。

**根因**：远端 Agent discovery 是网络边界，必须先按 URL 语义校验；“是字符串”不足以表达可发现的 A2A endpoint。

**修复**：`handleA2aDiscoverPost()` trim URL，只允许 `http:` / `https:`，拒绝 credentials、空 hostname 和过长 URL，再传给 discovery service。

**防回归**：`packages/mindos/src/server.test.ts` 覆盖 `file://` 和带 credentials 的 URL 都返回 400，合法 `http://agent` 仍可发现。

### Workflow SSE error event 不要被 JSON parse fallback 吞掉（2026-05-10）

**症状**：Workflow YAML 运行步骤时，如果 `/api/ask` 返回 `data:{"type":"error","message":"..."}`，步骤没有进入失败态，用户只看到空输出或假成功。

**根因**：SSE 行解析把 `JSON.parse()` 和业务事件处理放在同一个 `try/catch` 中。处理 `error` event 时主动 `throw` 的异常被同一个 catch 捕获，然后当成“不是合法 JSON，尝试 legacy 格式”处理掉了。

**修复**：先单独 parse SSE JSON；parse 失败才进入 legacy fallback。业务事件处理在 parse 成功后执行，`error` event 会真正 throw 给 `WorkflowRunner`。

**防回归**：`packages/web/__tests__/renderers/workflow-yaml-execution.test.ts` 覆盖 streamed error event 必须 reject。

### Summary renderer 不能把 MindOS SSE JSON 当普通文本（2026-05-10）

**症状**：近期文件 Summary 生成调用 `/api/ask` 后，如果后端返回 MindOS SSE（如 `data:{"type":"text_delta","delta":"..."}`），摘要区域会显示原始 JSON 行；如果返回 `type:error`，错误也会被当成普通文本拼进 summary。

**根因**：SummaryRenderer 只解析旧 Vercel `0:"..."` text stream，并把非 `0:` / `d:` / `e:` 的行当 plain text fallback。MindOS SSE 的 `data:` 行没有先按事件解析。

**修复**：抽出 `appendSummaryStreamChunk()`，先解析 MindOS SSE 的 `text_delta` / `thinking_delta` / `error`，parse 失败才忽略；保留旧 `0:"..."` 和 plain text fallback。

**防回归**：`packages/web/__tests__/renderers/generated-html-safety.test.ts` 覆盖 summary SSE 不渲染 raw JSON，且 error event 会 throw。

### Space AI init 不能只 drain stream 就标记 done（2026-05-10）

**症状**：新建 Space 后触发 AI 初始化 README/INSTRUCTION 时，如果 `/api/ask` stream 返回 `data:{"type":"error","message":"..."}`，前端仍会派发 `mindos:ai-init` 的 `state: done`，toast 显示成功但文件没有按预期生成。

**根因**：`triggerSpaceAiInit()` 只读取 stream 到结束，没有解析 MindOS SSE 事件；HTTP 200 + stream 结束被误认为业务成功。

**修复**：新增 `consumeSpaceAiInitStream()`，drain stream 时解析 `type:error` 并抛错；只有没有 stream error 才派发 `done` 和 `mindos:files-changed`。

**防回归**：`packages/web/__tests__/lib/space-ai-init.test.ts` 覆盖 error event 必须 reject、正常 done/malformed non-error line 可继续 drain。

### 前端 SSE 消费必须处理跨 chunk 行边界（2026-05-10）

**症状**：Workflow YAML 或 Summary 生成偶发丢字、空输出，或把半截 SSE JSON 当普通文本。这通常只在网络把 `data:{"type":"text_delta"...}` 拆成两个 chunk 时出现，本地快路径不容易复现。

**根因**：部分前端消费者直接对每个 `reader.read()` chunk 做 `raw.split('\n')`，没有保存最后一个未完成行。SSE 的一行不是 chunk 边界，必须用 buffer 拼到完整换行后再 parse。

**修复**：Workflow YAML 和 Summary renderer 的 stream loop 都加入 line buffer；读完后也处理剩余 buffer。

**防回归**：`packages/web/__tests__/renderers/workflow-yaml-execution.test.ts` 覆盖 `text_delta` SSE 行被拆成两个 chunk 时仍能输出完整文本；summary renderer 保留同一 buffer 处理模式并由 summary SSE 解析测试覆盖事件格式。

### 前端 SSE 消费也要处理无尾换行的最后一行（2026-05-10）

**症状**：Ask 消息或 AI organize 偶发丢失最后一段文本，尤其是代理/浏览器把最后一个 `data:...` chunk 直接结束、没有附带尾随 `\n` 时。

**根因**：部分消费者已经有跨 chunk `buffer`，但遇到 `reader.read()` 的 `done=true` 就直接 break，没有再 parse buffer 里剩下的最后一行。

**修复**：`consumeUIMessageStream()` 与 `consumeOrganizeStream()` 在 stream done 时，如果 buffer 非空，会按同一 SSE line 逻辑处理最后一行后再退出。

**防回归**：`packages/web/__tests__/agent/stream-consumer-status.test.ts` 覆盖无尾换行 `text_delta`；`packages/web/__tests__/hooks/useAiOrganize.test.ts` 覆盖无尾换行 organize summary。

### A2A agent-card 端点也属于远端输入（2026-05-10）

**症状**：A2A discovery 的用户输入 URL 已经做了 server-side 校验，但前端 A2A client 仍会直接信任远端 agent-card 里的 `supportedInterfaces[].url`，把 `file://`、带用户名密码的 URL 或畸形 endpoint 缓存成后续 JSON-RPC 目标。

**根因**：发现入口和 agent-card endpoint 是两条不同的信任边界。只校验用户提交的 discovery URL 不够；agent-card 本身来自远端服务，里面声明的 JSON-RPC URL 也必须重新校验。

**修复**：`discoverAgent()` 先规范化 discovery base URL，只允许无凭据的 `http`/`https`；解析 agent-card 时只接受第一个合法的 `JSONRPC` endpoint，非法 endpoint 不进入 registry。

**防回归**：`packages/web/__tests__/a2a/client.test.ts` 覆盖非 HTTP discovery URL、credentialed discovery URL、非 HTTP JSON-RPC endpoint、credentialed endpoint，以及跳过非法 endpoint 后使用第一个合法 endpoint。

### A2A RPC result 不能直接 type cast 成 task（2026-05-10）

**症状**：远端 A2A agent 如果返回 `{ result: { id: "..." } }` 这类缺少 `status.state` 的 JSON-RPC 响应，`delegateTask()` 会先把 delegation history 标为 completed，后续 UI/工具读取 `task.status.state` 时才报错。

**根因**：JSON-RPC 成功只代表 transport 成功，不代表 `result` 符合 A2A task contract。`response.result as A2ATask` 会绕过运行时校验，把远端 malformed payload 当作可信对象。

**修复**：`delegateTask()` 和 `checkRemoteTaskStatus()` 在返回前校验 task 形状：必须有 string `id`、对象 `status`、合法 `status.state`。不合法时抛 `Invalid A2A task response`，delegation history 记录为 failed。

**防回归**：`packages/web/__tests__/a2a/client.test.ts` 覆盖 delegate/status malformed result；`packages/web/__tests__/a2a/delegation-history.test.ts` 覆盖 malformed result 不会被记成 completed。

### Orchestration plan 不能执行空 subtask（2026-05-10）

**症状**：空请求或预分解结果里混入空字符串时，orchestrator 会创建空 description 的 subtask；`executePlan()` 在没有任何 subtask 或所有 subtask 未分配时早退，部分失败路径没有设置 `completedAt`。

**根因**：`decompose()` 在 trim 前就 slice/map，没有过滤 trim 后为空的 description；`executePlan()` 的早退失败路径没有统一完成态收尾。

**修复**：`decompose()` 先 trim 并过滤空 subtask，再限制最多 10 个；`executePlan()` 对空 plan 返回 `No subtasks to execute.`，所有早退失败路径都设置 `completedAt`。

**防回归**：`packages/web/__tests__/a2a/orchestrator.test.ts` 覆盖空请求、空 provided subtasks、空计划执行、无 agent 早退时的 `completedAt`。

### 浏览器 storage 缓存必须验证 shape 并容忍写入失败（2026-05-10）

**症状**：用户浏览器里的 `sessionStorage` / `localStorage` 被旧版本、手动调试或隐私模式污染时，ACP agent 列表、detection 缓存或 renderer 开关可能在组件初始化时变成非数组对象，后续 `.map()` / `.length` 直接崩溃；Safari private mode 或 quota 满时，renderer 开关写入也可能抛错。

**根因**：前端缓存是跨版本、用户可改的输入，不能只 `JSON.parse` 后按 TypeScript 类型使用；storage 写入也不是可靠 IO。

**修复**：ACP registry/detection cache 读取时先验证顶层对象、数组字段和 timestamp；renderer disabled IDs 只接受非空字符串数组；renderer 开关写入 localStorage 失败时保留当前 session 的内存状态而不让 UI 崩。

**防回归**：`packages/web/__tests__/hooks/acp-storage-cache.test.ts` 覆盖 corrupted JSON 和 malformed shape；`packages/web/__tests__/renderers/renderer-registry-storage.test.ts` 覆盖 corrupted disabled renderer storage、非法 ID 过滤和 quota 写入失败。

### localStorage 里的业务对象不能直接 merge 或当数组用（2026-05-10）

**症状**：AI organize history 或 Daily Echo 配置如果被旧版本/手动调试写坏，`loadHistory()` 可能返回对象，随后 `appendEntry()` 调用 `.unshift()` 崩溃；Daily Echo 会把 `enabled: "yes"`、`scheduleTime: "99:99"` 这类错误类型 merge 进运行时配置。

**根因**：浏览器持久化数据跨版本存在，类型不受 TypeScript 保护。解析成功不等于 shape 合法；直接 spread 或直接当数组使用会把坏缓存扩散到 UI。

**修复**：`organize-history` 增加 `normalizeHistoryEntries()`，只保留合法 entry/file/status/source；Daily Echo 配置增加 `normalizeDailyEchoConfig()`，逐字段接受合法值并从 `DEFAULT_DAILY_ECHO_CONFIG` 回退。

**防回归**：`packages/web/__tests__/lib/organize-history-storage.test.ts` 覆盖非数组缓存、malformed entry 过滤、坏缓存 append；`packages/web/__tests__/lib/daily-echo-config-storage.test.ts` 覆盖坏 JSON、非法字段类型、合法覆盖和保存前 normalize。

### HTTP body 解析错误不能统一返回 500（2026-05-10）

**症状**：Product HTTP server 收到 malformed JSON 或超过限制的请求体时，顶层 catch 会统一返回 500。前端和 API 调用方会看到“服务器错误”，但实际是客户端请求格式或大小问题。

**根因**：`readJsonBody()` 用普通 `Error` 表示 body 解析失败，`handleRequest()` 无法区分业务异常、JSON 格式错误和 payload too large。

**修复**：新增 `HttpBodyError` 携带 HTTP status；invalid JSON 返回 400，body too large 返回 413。超过限制后停止积累 chunk 并继续 drain 请求，避免重复 reject。

**防回归**：`packages/mindos/src/server.test.ts` 的 `returns client errors for invalid HTTP JSON bodies` 覆盖 400 invalid JSON 和 413 oversized body。

### Workflow 名称不能直接拼进 YAML title（2026-05-10）

**症状**：创建 workflow 时如果名称包含换行，例如 `Bad\nsteps:\n- id: injected`，服务端会把它直接替换到 `title: {TITLE}`，生成的 `.flow.yaml` 被注入额外字段或步骤；极端文件名也可能落到平台文件系统错误。

**根因**：同一个用户输入同时用于文件名和 YAML 内容，没有分开做 filename sanitize 与 YAML scalar escaping。

**修复**：workflow 创建先把显示标题压成单行，再生成安全文件名；写入 YAML 时使用单引号 scalar，并按 YAML 规则把 `'` 转成 `''`。

**防回归**：`packages/mindos/src/server.test.ts` 的 `escapes workflow titles and sanitizes workflow filenames` 覆盖换行注入、单引号转义、空安全文件名拒绝。

### 归档目录也要做 symlink realpath 校验（2026-05-10）

**症状**：Inbox 归档文件时会把文件移动到 `Inbox/.processed/<timestamp>_name`。如果 `.processed` 已经被替换成指向 mindRoot 外部的 symlink，直接 `join(inboxDir, '.processed')` 后 `renameSync()` 会把文件移出知识库边界。

**根因**：只校验了 `Inbox` 和源文件路径，没有对归档目标目录及目标文件做 `resolveExistingSafe()` realpath 校验。新建目录和移动目标同样是写边界。

**修复**：Product Server 与 Web core 两份 `archiveFromInbox()` 都对 `Inbox/.processed` 和最终 archived path 使用 `resolveExistingSafe()`；`.processed` 是外部 symlink 时直接拒绝，不移动源文件。

**防回归**：`packages/mindos/src/server.test.ts` 的 `rejects inbox archive when .processed is a symlink outside mindRoot` 与 `packages/web/__tests__/core/inbox.test.ts` 的 `.processed` symlink 用例覆盖两条运行时路径。

### Trash 目录是 sibling 时也不能信任已有 symlink（2026-05-10）

**症状**：删除文件会移动到 `dirname(mindRoot)/.trash` 并写 `dirname(mindRoot)/.trash-meta`。如果这些 sibling 目录已被替换成指向外部位置的 symlink，删除操作会把用户文件移到不可控目录。

**根因**：Trash 不在 mindRoot 内，不能用 `resolveExistingSafe(mindRoot, ...)`，但仍要验证 sibling 目录的 realpath 没有逃出 mindRoot 的父目录。

**修复**：Product Server `moveToTrash()` 与 Web core trash 都通过 `resolveSafeSiblingDir()` 校验 `.trash` / `.trash-meta`：目标名必须是 leaf；已有目标不能是 symlink，且 realpath 必须仍在 mindRoot 父目录下。

**防回归**：`packages/mindos/src/server.test.ts` 覆盖 Product Server delete 遇到 symlinked `.trash` 时返回 403；`packages/web/__tests__/core/trash.test.ts` 覆盖 Web core `moveToTrash()` 不移动源文件、不写外部目录。

### 知识库相对路径输出必须统一用 POSIX 分隔符（2026-05-10）

**症状**：部分 Web core 操作返回知识库相对路径时用 `path.join()` 组装。Windows 下会返回 `Folder\\note.md`，但路由、索引、前端链接和大多数 API 都按 `Folder/note.md` 处理。

**根因**：文件系统绝对路径可以用 Node `path`，但知识库内部相对路径是跨平台协议值，应使用 `path.posix` 或显式 `/`。

**修复**：`restoreAsCopy()` 生成 copy path 时改用 `path.posix.join()`，并把 fs-ops 测试里的返回值断言改成 POSIX 字符串，避免 Windows 上测试期望跟着平台漂移。

**防回归**：`packages/web/__tests__/core/trash.test.ts` 覆盖 nested restore copy 返回 `Folder/note (copy 2).md`；`packages/web/__tests__/core/fs-ops.test.ts` 覆盖 rename 返回 POSIX path。

### Product Server 写操作不要回显原始请求路径（2026-05-10）

**症状**：客户端用 Windows 风格路径调用 `move_file` 时，底层 `resolveSafe()` 会正确写到 `Archive/moved.md`，但响应体和 `changeEvent` 仍回显原始 `Archive\\moved.md`。前端路由、索引刷新、审计事件和跨 Agent 调用会收到同一文件的两种路径写法。

**根因**：handler 在文件系统层已经拿到了安全绝对路径，但返回值直接使用请求里的 `path` / `to_path`。请求参数是输入，不应该作为知识库协议路径输出。

**修复**：Product Server file handler 对 save/create/append/delete/rename/move/create space/rename space、行级编辑、heading/section 编辑和 CSV append 的成功响应和 changeEvent 路径，统一从已校验绝对路径反算 mindRoot 相对路径，并替换为 `/` 分隔符。

**防回归**：`packages/mindos/src/server.test.ts` 的 `returns POSIX knowledge paths after Product Server file moves` 覆盖反斜杠输入下的响应路径、`beforePath`、`afterPath`；`returns POSIX knowledge paths after Product Server content edits` 覆盖内容编辑和 CSV append 的响应路径。

### 跨平台路径校验要拒绝 Windows 无效文件名（2026-05-10）

**症状**：macOS/Linux 上可以创建 `CON.md`、`bad:name.md`、`note.md.` 或带控制字符的文件名，但这些路径在 Windows 上是保留设备名或非法段名。跨平台同步后会出现创建失败、无法打开、索引路径不可还原等问题。

**根因**：路径安全层只处理 traversal、绝对路径和 symlink realpath，没有把知识库路径当成跨平台协议值校验。导入文件名清洗也只替换了部分符号，漏掉控制字符、尾随点/空格和 Windows 保留名。

**修复**：`@geminilight/mindos` 的 `resolveSafe()` 在所有平台拒绝 Windows 无效 path segment；Web 导入和 Product Inbox 的 `sanitizeFileName()` 会把保留名加 `_` 前缀，并去掉尾随点/空格、替换控制字符。

**防回归**：`packages/mindos/src/foundation/security/path-safety.test.ts` 覆盖底层拒绝规则；`packages/web/__tests__/core/file-convert.test.ts` 覆盖导入文件名清洗。

### base64 上传必须严格校验，不能让损坏文件静默落盘（2026-05-10）

**症状**：`Buffer.from(content, 'base64')` 会宽松解码。用户上传非法 base64 的 PDF/文本时，API 可能仍返回成功并创建一个损坏文件，后续打开、解析、索引都会表现成随机失败。

**根因**：Web import 与 Product Inbox 都直接调用 Node 的 base64 decoder，没有先校验字符集、padding 和长度结构。

**修复**：两条导入路径都先移除空白并用严格 base64 正则校验；非法内容返回 `Invalid base64 content`，不写文件。

**防回归**：`packages/web/__tests__/api/file-import.test.ts` 覆盖非法 base64 上传不创建文件；`packages/mindos/src/server.test.ts` 的 Inbox 用例覆盖 Product Server 路径。

### read-native skill 只能读取已登记 skill root（2026-05-10）

**症状**：`POST /api/skills` 的 `read-native` 接收客户端传入的 `sourcePath`。如果直接用 `resolve(sourcePath, name, 'SKILL.md')` 读取，攻击者或误用的前端状态可以读取任意本地目录下同名 `SKILL.md`。

**根因**：`name` 做了 skill-name 正则校验，但 `sourcePath` 没有限制到服务器已登记的 `skillRoots`。

**修复**：`read-native` 现在要求 `sourcePath` 的 resolved path 必须等于 `services.skillRoots` 中的一个 root path，否则返回 `Invalid sourcePath`。

**防回归**：`packages/mindos/src/server.test.ts` 的 skill runtime 用例同时覆盖已登记 builtin root 可读、未登记外部 root 被拒绝。

### skills 读操作不要被 user .skills 写目录校验阻断（2026-05-10）

**症状**：`POST /api/skills` 过去在进入 switch 前统一解析 `{mindRoot}/.skills`。如果用户的 `.skills` 被错误替换成外部 symlink，连读取 builtin skill 这种只读操作也会返回 `Access denied`。

**根因**：写路径校验放在所有 action 的公共前置流程里，扩大了失败影响范围。

**修复**：只在 `create` / `update` / `delete` 这类真正写 user skill 目录的分支解析并校验 `.skills`；`read` / `read-native` / `toggle` / `record-install` 不依赖该目录。

**防回归**：`packages/mindos/src/server.test.ts` 的 symlinked user skill directory 用例覆盖 builtin skill 仍可读取，同时 create 仍因 symlinked `.skills` 被拒绝。

### Desktop runtime 解包不要按平台分叉安全策略（2026-05-12）

**症状**：Desktop Core Updater 过去在 macOS/Linux 上调用系统 `tar xzf`，只有 Windows 使用 JS extractor。这样 traversal entry、Windows drive-relative entry、GNU long path 等安全/兼容策略在不同平台不一致。

**根因**：为规避 Windows bsdtar 长路径问题新增了 JS extractor，但平台入口仍让非 Windows 绕过了 JS extractor 的路径校验。

**修复**：`extractTarGz()` 在所有平台统一走安全 JS extractor；系统 `tar` 不再参与 Desktop runtime 更新解包。

**防回归**：`packages/desktop/src/core-updater-tar.test.ts` 覆盖平台 extraction entrypoint 对 traversal tar entry 的拒绝，同时保留 GNU LongLink、pax、深层 node_modules、空文件和 drive-relative 路径测试。

### Desktop 停止子进程不能只重复发送 SIGTERM（2026-05-12）

**症状**：Desktop 退出或重启时，如果 Web/MCP 子进程忽略 `SIGTERM`，旧逻辑在 5 秒超时后调用默认 `proc.kill()`，实际仍可能只是再次发送 `SIGTERM`。端口随后仍被旧进程占用，导致重启 fallback 到新端口，或下次启动误判为已有服务。

**根因**：`ChildProcess.killed` 只表示信号已发送，不表示进程已退出；超时后的 force-kill 需要升级到平台强制终止，而不能复用默认信号。

**修复**：`ProcessManager.stop()` 改为共享 `terminateChildProcess()`：先发 `SIGTERM`，未收到 `exit` 时 macOS/Linux 升级到 `SIGKILL`，Windows 继续走 `TerminateProcess` 语义的默认 kill。PID 文件和端口清理在确认命令行属于 MindOS 后也会等待短暂退出窗口，再升级强制终止。

**防回归**：`packages/desktop/src/process-manager-subprocess-contract.test.ts` 覆盖子进程不退出时会从 `SIGTERM` 升级到强制终止；crash handler 测试继续覆盖停止/重启相关竞态。

### Desktop 复用已有 Web 服务前必须校验 health payload（2026-05-12）

**症状**：`mindos.pid` 里的 PID 只要仍然 alive，Desktop 会探测配置端口的 `/api/health`。如果该端口被其他本地服务占用，并且也返回 HTTP 200，旧逻辑会误认为 MindOS CLI 正在运行，直接加载错误服务。

**根因**：探测只看 `res.ok`，没有校验 MindOS Web health body。`/api/health` 是公开接口，很多本地服务都可能存在同名路径。

**修复**：Desktop 的 `verifyMindOsWebHealth()` 现在要求 JSON payload 同时满足 `ok === true` 和 `service === 'mindos'`，否则视为不可复用并启动自己的本地 runtime。

**防回归**：`packages/desktop/src/mindos-web-health.test.ts` 覆盖非 MindOS health endpoint 和非 JSON 响应都会返回 false。

### Web 端重启轮询不要只看 /api/health 的 HTTP 200（2026-05-12）

**症状**：设置页修改 Web 端口、setup wizard 重启跳转、更新 overlay 等待服务恢复时，前端轮询 `/api/health` 后只看 HTTP 成功状态。如果目标端口被其他本地服务占用且也返回 200，用户可能被重定向到错误服务，或更新 overlay 误判服务已恢复。

**根因**：前端与 Desktop 主进程的 health 判断不一致，没有统一校验 MindOS health payload。

**修复**：新增 `packages/web/lib/mindos-health.ts`，统一要求 health JSON 满足 `ok === true` 且 `service === 'mindos'`。WebPortSection、StepReview 和 UpdateOverlay 都使用该 helper。

**防回归**：`packages/web/__tests__/lib/mindos-health.test.ts` 覆盖有效 MindOS payload、非 MindOS 服务 payload、非 ok payload 和空值。

### Desktop 内部 ready/recovery 也不能只看 health HTTP 200（2026-05-12）

**症状**：即使启动路径已经校验 mindos.pid 指向的 Web 服务，ProcessManager 等待 Web/MCP ready 和更新恢复 overlay 过去仍只看 `/api/health` 是否返回 200。若端口被其他本地服务占用，Desktop 可能误判服务 ready 或恢复完成，随后加载错误页面。

**根因**：启动复用、子进程 ready、崩溃恢复三条路径的 health 语义不一致；部分路径仍用原始 HTTP status。

**修复**：ProcessManager 的 Web ready、MCP 复用检查，以及 main 进程更新恢复轮询都复用 `verifyMindOsWebHealth()`，要求 payload 为 `{ ok: true, service: 'mindos' }`。

**防回归**：`packages/desktop/src/process-manager-subprocess-contract.test.ts` 和 `packages/desktop/src/main-subprocess-contract.test.ts` 禁止这些路径回退到原始 HTTP 200 判断。

### Remote 连接恢复监控必须复用 MindOS health 语义（2026-05-12）

**症状**：Remote mode 断线后，`ConnectionMonitor` 过去直接请求远端 `/api/health`，只要 HTTP 200 就触发 `onRestored()`。如果远端地址被其他服务占用，Desktop 会误报连接已恢复，用户继续停留在不可用的远程会话。

**根因**：初次连接的 `testConnection()` 已校验 `{ ok: true, service: 'mindos' }`，但持续监控路径绕过了该 SDK，导致初连和恢复判断不一致。

**修复**：`ConnectionMonitor` 改为复用 `testConnection()`，只有 `status === 'online'` 才恢复连接；非 MindOS health payload 继续按断线处理。

**防回归**：`packages/desktop/src/connection-monitor.test.ts` 覆盖先断线、再收到非 MindOS 200 health 不恢复、最后收到 MindOS health 才恢复。

### Product Server rename_space 也必须走统一路径校验（2026-05-12）

**症状**：`rename_file` 会通过 `resolveSafe()` 校验新路径，但 `rename_space` 过去只检查新名字不含 `/` 或 `\\`。在 macOS/Linux 上可以把 Space 改成 `CON`、`bad:name`、尾随空格/点等 Windows 无效名字，之后同步到 Windows 或跨平台打开时失败。

**根因**：Space rename 手写 `join(dirname(oldAbs), newName)`，绕过了 foundation security 的跨平台 segment 校验。

**修复**：`rename_space` 现在根据旧的 POSIX knowledge path 生成新相对路径，并通过 `resolveSafe()` 得到目标绝对路径，同时校验目标仍在同一父目录。

**防回归**：`packages/mindos/src/server.test.ts` 的 unsafe rename leaf names 用例覆盖 `CON` 和 `bad:name` 这类 Windows 无效 Space 名。

### MCP restart 按端口清理前必须确认进程属于 MindOS MCP（2026-05-12）

**症状**：`POST /api/mcp/restart` 会查找占用 MCP 端口的 PID 并 kill。过去只按端口匹配，若用户配置的 MCP 端口被其他本地服务占用，restart 可能误杀无关进程。

**根因**：Product Server 的 MCP restart handler 没有复用 Desktop ProcessManager 的“先查命令行 ownership，再 kill”安全策略。

**修复**：`findMcpProcessIdsByPort()` 现在会读取候选 PID 命令行，只保留命令行指向 MindOS MCP bundle（`dist/protocols/mcp-server/index.cjs`）的进程。无法读取命令行或不匹配时不 kill。Windows 命令行读取优先用 PowerShell `Get-CimInstance`，再 fallback 到 `wmic`，避免新 Windows 缺少 `wmic` 时无法重启。

**防回归**：`packages/mindos/src/server.test.ts` 覆盖 Windows/Unix 端口 PID 解析后按命令行过滤、PowerShell + wmic fallback 入口，以及非 MindOS 进程占用端口时不会返回为可 kill PID。

### CLI stop 的端口 fallback 也不能误杀非 MindOS 服务（2026-05-12）

**症状**：`mindos stop` 在没有 PID 文件或存在 Next worker 孤儿进程时会按 Web/MCP 端口清理。过去只要进程监听配置端口就 kill；如果用户把端口配置成已有服务，或配置文件陈旧，可能误杀无关本地服务。

**根因**：CLI `killByPort()` 只做端口匹配，没有读取候选 PID 的命令行确认 ownership。

**修复**：CLI `killByPort()` 现在先用 `ps` / PowerShell `Get-CimInstance` / `wmic` 读取命令行，只杀 `.mindos/runtime`、`@geminilight/mindos`、MindOS Web standalone 或 MCP bundle 相关进程。

**防回归**：`tests/unit/stop-restart.test.ts` 覆盖 stop.js 必须调用 ownership 过滤，以及 MindOS/非 MindOS 命令行的匹配结果。

### Desktop 端口耗尽 fallback 必须等待 orphan cleanup 完成（2026-05-12）

**症状**：启动时如果默认端口范围被旧进程占用，fallback 会调用 `ProcessManager.cleanupOrphanedChildren()` 后立刻再次 `findAvailablePort()`。清理尚未完成时重试仍会失败，用户看到“端口均被占用”，但实际稍等一会端口就释放了。

**根因**：异步 cleanup 没有 `await`。在 cleanup 需要等待 `SIGTERM` 或升级强杀时，这个竞态更明显。

**修复**：端口耗尽 fallback 在重试端口发现前 `await ProcessManager.cleanupOrphanedChildren()`。

**防回归**：`packages/desktop/src/main-subprocess-contract.test.ts` 覆盖 main 启动 fallback 必须等待 orphan cleanup。

### Static Web snapshot 必须隔离到 standalone 依赖闭包（2026-05-12）

**症状**：`prepare-static-web` 需要临时启动 Next standalone server 渲染静态页面。如果子进程继承了会影响 Node 解析的环境变量，或 standalone trace 漏掉 Next 内部相对依赖，脚本可能从 workspace 的 pnpm `node_modules` 解析 Next 文件，出现 `Cannot find module './cpu-profile'` 这类非确定性失败。

**根因**：snapshot 渲染阶段过去直接继承 `process.env`，且启动前没有验证 `next`、`next/dist/server/lib/start-server` 和它的内部依赖是否都来自 `.next/standalone/node_modules`。

**修复**：`prepare-static-web` 启动前用 `createRequire(webStandaloneServer)` 校验 Next 运行时依赖都解析到 `.next/standalone` 内，并为子进程构造最小环境，只透传 PATH 和临时目录等必要变量。

**防回归**：`tests/static-web-artifact-contract.test.ts` 覆盖 static snapshot 脚本必须包含 standalone closure 校验和隔离环境，避免重新回到全量继承 `process.env`。

### Rail 导航防连点不能吞掉跨目标切换（2026-06-07）

**症状**：用户点击 Inbox 后，马上点击 Wiki/Agents/Explore 等 rail 入口没有反应，看起来像 Inbox 的 sidebar 和 content 一直占住页面，无法切回其他工作台。

**根因**：Activity Bar 曾经把所有 rail 按钮共用同一个 300ms debounce。第一次点击 Inbox 后，下一次点击即使目标不同也会被直接忽略，导致 `onSpacesClick` / `onAgentsClick` 等导航 handler 没有执行。

**修复**：rail debounce 必须按目标 key 区分，只抑制同一个目标的重复点击，不抑制 Inbox → Files、Inbox → Agents 这类跨目标切换。

**防回归**：`packages/web/__tests__/settings/activity-bar-rail-navigation.test.tsx` 覆盖 Inbox 后立即点 Files 和 Agents 都必须触发目标导航。

### Rail / Sidebar 路由归属必须集中在 navigation-panel（2026-06-08）

**症状**：Rail、SidebarLayout 和测试各自手写 `/capture`、`/agents`、`/wiki` 等路径判断后，容易出现三类漂移：`/agents-old` 被误判成 Agents；同一 rail link 连点绕过 `preventDefault()` 导致路径变化；`/settings`、`/trash` 继承上一个 workbench panel，像是旧 sidebar 仍占住页面。

**根因**：route highlight、left panel open state、route-controlled recovery、rail click decision 混在组件里实现，且 link fallback / debounce 属于 ActivityBar 私有逻辑，测试只模拟了一部分 SidebarLayout 分支。

**规则**：
1. 路由到 panel 的映射只放在 `packages/web/lib/navigation-panel.ts`，用 segment-boundary 判断（`/agents` 或 `/agents/*`），不要在组件里写裸 `startsWith('/agents')`。
2. route-owned rail click 用 `getRailPanelClickDecision()`；同一路由内点击要按 helper 返回值决定是否 `preventDefault()`，避免 `/capture#queue` 被点击 rail 后剥掉 hash。
3. `/settings`、`/trash` 这类 full-page utility route 要显式标为 neutral route，清理 stale workbench panel，但保留 Search / Workflows 这类临时 utility panel。
4. Rail 里的 `href` 项是导航 link，用 `aria-current="page"`；只有无 `href` 的真实 toggle button 才用 `aria-pressed`。`aria-current` 只能表示当前 URL 所在页面，不能拿来表示 pending/optimistic 的 rail 高亮。
5. Legacy route 只映射真实存在的页面；例如当前只保留 `/inbox/history` → `/capture/history`，不要把不存在的 `/inbox` 或 `/inbox/history/*` 误判成 Capture。
6. 旧兼容 helper 不要偷换语义；`recoverStaleCapturePanel()` 只处理 Capture 遗留状态，通用 route panel 恢复必须显式使用 `recoverStaleRoutePanel()`。
7. Route-derived panel 不要继承本地旧 panel 的 maximized 状态；`activeLeftPanel !== lp.activePanel` 时，宽度、`maximized` 和 `#main-content` padding 都必须使用同一套 effective 派生状态。
8. Catch-all route 不等于 base route；`/view/[...path]` 只应匹配 `/view/*`，不要把不存在的 `/view` 当成 Files 内容页。

**防回归**：`packages/web/__tests__/lib/navigation-panel.test.ts` 覆盖 segment-boundary、`/view` base route、neutral route、legacy inbox 精确匹配、legacy wrapper scope、route recovery、route-derived panel 不继承 stale maximize、rail click decision；`packages/web/__tests__/settings/activity-bar-rail-navigation.test.tsx` 覆盖 same-target debounce 不能绕过 `preventDefault()`、ActivityBar 默认 route click 也走统一 helper、`aria-current` 与视觉 active 分离，以及 sync popover trigger 的 aria 关系。

### Dev 轮询端点不能触发重型重建（2026-06-08）

**症状**：本地 dev 版打开页面或切换 rail destination 时体感卡顿，日志里 `/api/tree-version`、`/api/mcp/status`、`/api/changes` 等全局轮询端点和页面 cold compile 叠在一起。尤其是 `/api/tree-version` 名义上是轻量版本检查，却可能在 cache TTL 过期时触发 `tree.cache.build`。

**根因**：轮询端点为了返回版本号调用了 `getTreeVersion()`；该函数在 `_cache` 为空或过期时会重建完整文件树、统计文件签名，并可能让每 5s 的客户端 poll 变成周期性整树扫描。另一个放大因素是 Web 侧从 `@geminilight/mindos` 根入口 re-export foundation security API，dev 编译会反复打印 `Attempted import error`，拖慢 cold compile。

**规则**：
1. `/api/tree-version` 只能调用 `peekTreeVersion()` 这种只读计数器，不得调用会 rebuild cache 的函数。
2. 页面真正需要文件树时再通过 `getFileTree()` / cache-aware 读路径重建；写操作和 watcher 负责 bump `_treeVersion`。
3. Web 到产品主包的导入要走明确 public boundary，例如 `@geminilight/mindos/foundation`，不要从根入口间接 re-export 低层 API。
4. ActivityBar 这类全局 chrome 在 dev 环境不要 mount 后立即 prefetch 额外 route；否则会主动制造额外 cold compile 压力。

**防回归**：`packages/web/__tests__/api/tree-version.test.ts` 明确让旧 `getTreeVersion()` 抛错，验证 `/api/tree-version` 只调用 `peekTreeVersion()`；`packages/web` typecheck 覆盖 `@geminilight/mindos/foundation` 子入口导出。

### AI Provider 旧格式必须归一到 `p_*` entry（2026-06-09）

**症状**：设置面板里用户选过某个 provider 后，后续可能出现选中状态和可编辑表单脱节：列表里看起来选了某个协议，但 `AiTab` 找不到对应 `p_*` provider entry，导致配置区为空、无法继续修改，或旧 active provider 被错误迁移成默认 OpenAI。

**根因**：旧配置里 active provider 可能存在两个字段名：`ai.provider` 或 `ai.activeProvider`。迁移逻辑只看 `ai.provider`，并且会跳过空配置的 provider dict entry；当用户选中的是一个空的旧 provider（例如刚选择 Anthropic 但还没填 key）时，它没有被迁移成新 `p_*` entry。

**规则**：
1. Settings UI 内部只把 `ai.activeProvider` 当成 provider entry id（`p_*`），不要把协议 id 当成可编辑 entry。
2. 旧格式迁移必须优先识别 `ai.activeProvider`，其次才是 `ai.provider`。
3. 即使旧 provider 配置为空，只要它是当前 active provider，也必须迁移成一个可编辑 entry，并填上默认 model/baseUrl。
4. Product Server 的 `/api/settings` GET/POST handler 也要做归一化，不能只依赖外层 HTTP service 或 Web 侧 `readSettings()` 迁移。

**防回归**：`packages/web/__tests__/settings/custom-endpoints.test.ts` 覆盖空 legacy active provider 仍迁移为可编辑 entry；`packages/mindos/src/server.test.ts` 覆盖 settings GET 把 legacy `activeProvider: 'anthropic'` 归一成 `p_anthropic`。

### Git Sync 写入口必须共用跨进程锁（2026-06-09）

**症状**：`mindos dev` / `mindos start` / Next instrumentation / 用户手动 `sync now` 可能在不同 Node 进程中同时启动 Git Sync。进程内 `activeWatcher` 只能防当前进程，挡不住另一个 daemon、CLI 子进程或 Product API 同时 `git pull`、`git add`、`git commit`、`git push`，也挡不住 conflict resolve 中途被后台 auto-commit 抢走。

**根因**：之前只有 watcher 级别的内存 guard，没有跨进程互斥；手动同步还可能先 pull、释放锁、再 commit，让 daemon 插在中间。Product Server 的 `.gitignore-save`、`resolve-conflict`、`reset` 虽然不直接执行 Git，也会改工作树或 `sync-state.json`，必须和 Git 写操作互斥。

**规则**：
1. 所有会写 Git repo、conflict 文件、`.gitignore` 或 sync state 的入口必须使用同一个目录锁：`~/.mindos/sync-locks/<mindRootHash>.lock`。
2. 锁 owner 必须写 `pid`、`hostname`、`operation`、`mindRoot`、`startedAt`、`token`；release 必须校验 token，不能删除后来的新 owner。
3. dead pid lock 可以自动清理；活 pid 的老锁不能被短阈值误删，只能在 hard-stale 后恢复。
4. `manualSync()` 必须一把 `manual-sync` 锁覆盖 `autoPullUnlocked()` + `autoCommitAndPushUnlocked()`，不能分别拿 pull/commit 两把锁。
5. daemon 后台操作拿不到锁要跳过本轮，不要写 `lastError` 把 UI 弄红；用户/API 操作遇到锁用稳定 `SYNC_LOCKED`，HTTP 映射为 423。
6. API `init` 传 token 给 CLI 时走 `MINDOS_SYNC_TOKEN` env override，不要把 token 放进 argv。

**防回归**：`tests/unit/cli-sync.test.ts` 覆盖锁释放、旧 owner 不能误删新锁、dead pid stale recovery、manual sync 单锁覆盖；`packages/mindos/src/server.test.ts` 覆盖 direct sync file operations 遇锁 423 且不改文件/state、CLI `SYNC_LOCKED` 映射 423、init token 不进 argv。

### Platform runtime 包不能暴露和主包同名的 `mindos` bin（2026-06-06）

**症状**：`npm run release` 的 package smoke 阶段安装主包 tarball 与当前平台 tarball 后，`node_modules/.bin/mindos` 不存在，报错 `'mindos' binary not found after install`。主包 `bin/mindos-shim.cjs` 和平台包 `bin/mindos` 文件实际都存在。

**根因**：主包和平台 optional runtime 包都在 `package.json.bin` 里声明了同名 `mindos`。npm 10 同时安装两个本地 tarball 时不会稳定创建这个 bin link，导致发布前 smoke 失败。另一个隐蔽点是 release smoke 发生在版本 bump 之前；如果主包 `optionalDependencies` 还是当前已发布版本，npm 会从 registry 拉旧平台包，干扰本地 tarball 验证。

**修复**：平台包只作为 runtime payload，保留 `bin/mindos` 文件供主包 shim 定位和执行，但平台包 `package.json` 不再暴露顶层 `bin` 字段。CLI 入口统一由 `@geminilight/mindos` 的 `bin/mindos-shim.cjs` 暴露。release smoke 安装本地平台 tarball 和主 tarball 时使用 `--omit=optional`，并显式 `npm rebuild --bin-links`，避免 registry 旧 optional 包影响 pre-bump 验证。

**防回归**：`tests/platform-runtime-package-contract.test.ts` 覆盖 `scripts/build-platform-packages.mjs` 不得重新写入平台包 `bin` 字段，并覆盖 release smoke 必须隔离 optional registry 包。

### Desktop/runtime archive 不能只信 Next standalone trace（2026-06-06）

**症状**：`Build Desktop` workflow 在所有平台的 `Verify bundled runtime` 步骤失败，报 `missing runtime file: packages/web/.next/standalone/node_modules/@sinclair/typebox/package.json`。同一版本的 npm 本地 package smoke 能过，因为 npm `_standalone` 路径另有显式 runtime dependency seed。

**根因**：Next standalone trace 不一定会把外部 agent/runtime 包的业务依赖完整追进去。之前只有 `scripts/prepare-standalone.mjs` 会显式补 `@sinclair/typebox` 等 seed；Desktop 的 `prepare-mindos-runtime.mjs` 和 `scripts/build-runtime-archive.sh` 走另一条打包路径，导致 Desktop/runtime-latest 和 npm runtime 闭包漂移。

**修复**：在 `packages/desktop/scripts/prepare-mindos-bundle.mjs` 维护 Desktop/runtime 共用的 `RUNTIME_DEPENDENCY_SEEDS`，`prepare-mindos-runtime.mjs` 和 `build-runtime-archive.sh` 都必须先调用 `materializeStandaloneAssets(..., { runtimeDependencySeeds: RUNTIME_DEPENDENCY_SEEDS })`，再拷贝/发布 runtime。

**防回归**：`packages/desktop/src/prepare-mindos-bundle.test.ts` 覆盖 seed 缺失时要从 app `node_modules` 补进 standalone；`tests/desktop-release-contract.test.ts` 和 `tests/runtime-manifest-contract.test.ts` 覆盖 Desktop 与 runtime archive 发布路径必须接入 seed。

### pi-ai 不能被 Next server bundle（2026-06-06）

**症状**：Desktop packaged smoke 在 macOS arm64 / Linux 失败，日志出现 `Cannot find module 'node:fs'` / `node:os` / `node:path`，stack 指向 `.next/server/chunks/*.js`。本地 `next build` 的 `Collecting page data` 阶段也会打印同样错误，但 build 仍返回 0。

**根因**：`@earendil-works/pi-ai` 内部会在运行时探测 `import('node:fs')` / `node:os` / `node:path`。如果 Next webpack 把它 bundle 进 server chunk，这些动态 import 会被改写成 context stub，page-data 和 Desktop smoke 启动时就会抛 `MODULE_NOT_FOUND`。

**修复**：`packages/web/next.config.ts` 把 `@earendil-works/pi-ai` 加入 `serverExternalPackages`，让 Node 原生处理 `node:*` import；同时 `scripts/prepare-standalone.mjs`、`packages/desktop/scripts/prepare-mindos-bundle.mjs` 和 `scripts/verify-desktop-runtime.mjs` 必须显式 seed/验证 `@earendil-works/pi-ai` 进入 standalone runtime。

**防回归**：`packages/web/__tests__/next-config-warning.test.ts` 覆盖只 externalize `pi-ai`，Ask/headless/settings/compile 入口不能顶层 import PI runtime；`tests/desktop-release-contract.test.ts` 和 `tests/package-publish-contract.test.ts` 覆盖 npm/Desktop packaging seed。

### Monorepo 迁移后 workflow 仍引用旧顶层目录（2026-04-27）

**症状**：GitHub Actions 在发版或构建 Desktop/Mobile 时直接失败，常见报错是 `cd app: No such file or directory`、`cd mcp: No such file or directory`、`cd desktop: No such file or directory`。

**根因**：源码已经迁移到 pnpm workspace：
- Web: `packages/web`
- Desktop: `packages/desktop`
- Mobile: `packages/mobile`
- MCP: `packages/mindos/src/protocols/mcp-server`

但 workflow、public sync 白名单或专项测试仍引用旧的 `app/`、`mcp/`、`desktop/`、`mobile/` 顶层目录。

**修复**：
- workflow 安装依赖统一使用根目录 `pnpm install --frozen-lockfile`
- workspace 构建用 `pnpm --filter <package> run <script>`
- npm standalone 校验使用 `_standalone/__next` / `_standalone/__node_modules`
- `.syncinclude` 同步 `packages/`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`、`turbo.json` 等 v1 源码和 workspace 元数据；不要重新加入 `apps/`
- Desktop tag dispatch 必须传 `inputs.tag`，否则安装包版本可能与 release tag 不一致

**防回归**：`tests/workflow-migration-contract.test.ts` 会扫描 workflow 和 `.syncinclude`，禁止旧目录引用重新进入发布链路。

### Browser Extension 也是 app，不要放回顶层目录（2026-04-27）

**症状**：Web Clipper 发布 workflow 找不到目录，或 public sync 额外维护 `browser-extension/` 顶层白名单。

**根因**：v1 monorepo 已经从 `apps/*` + `packages/*` 双根迁到 OpenCode-style `packages/*` 单根。浏览器扩展如果留在根目录，会成为 `.syncinclude`、README 链接、publish workflow 的例外路径。

**规则**：
- Web Clipper 源码固定在 `packages/browser-extension/`
- 构建用 `pnpm --filter @mindos/browser-extension run build`
- `publish-clipper.yml` 只引用 `packages/browser-extension`
- `.syncinclude` 不单独列顶层 `browser-extension`，由 `packages/` 覆盖

**验证**：`pnpm exec vitest run tests/workflow-migration-contract.test.ts`。

### NPM 平台包创建权限不能阻断主包发布（2026-06-07）

**症状**：`Publish to npm` workflow 在 `Publish platform packages to npm` 阶段失败，日志显示 `404 Not Found - PUT https://registry.npmjs.org/@geminilight%2fmindos-darwin-arm64`，npm registry 上 `@geminilight/mindos` 仍停在旧版本。

**根因**：`@geminilight/mindos-*` 平台包是新的 scoped package 名称。GitHub `NPM_TOKEN` 可能有发布已有 `@geminilight/mindos` 主包的权限，但没有在 scope 下创建新 package 的权限。把平台包发布放在主包发布之前，会导致主包也发不出去。

**修复**：主包 `bin/mindos-shim.cjs` 在找不到平台 optional package 时，会从 `runtime-latest/latest.json` 下载 runtime archive，校验 size / sha256 后安全解压到 `~/.mindos/runtime-cache/<version>` 并复用缓存。`publish-npm.yml` 先发布主包并设 `latest`，平台包发布改为 best-effort。

**防回归**：`tests/unit/mindos-shim-runtime-fallback.test.ts` 覆盖平台包缺失时的 runtime 下载与离线缓存复用；`tests/platform-runtime-package-contract.test.ts` 覆盖 publish workflow 不再让平台包发布失败阻断主包。

### Tauri Desktop spike 也是 app，不要放回顶层目录（2026-04-27）

**症状**：Tauri spike 留在顶层 `desktop-tauri/` 时，workspace、npm ignore、文档和后续 CI 都要为它维护例外路径。

**根因**：v1 monorepo 已经迁到 OpenCode-style `packages/*` 单根；Tauri spike 是一个完整应用（Vite 前端 + `src-tauri/` Rust 壳），不属于根目录工具脚本。

**修复**：
- 源码固定在 `packages/desktop-tauri/`
- npm tarball 通过 `.npmignore` 排除 `packages/desktop-tauri/`
- `tauri.conf.json` 的 `beforeDevCommand` / `beforeBuildCommand` 使用 `pnpm run dev:web` / `pnpm run build:web`，避免 `dev -> tauri dev -> npm run dev` 递归

**验证**：`pnpm exec vitest run tests/workflow-migration-contract.test.ts`。
