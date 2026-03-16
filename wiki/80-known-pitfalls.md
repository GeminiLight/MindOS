<!-- Last verified: 2026-03-14 | Current stage: P1 -->

# 踩坑记录 (Known Pitfalls)

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

## 前端

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

### Google Fonts 不要随意删除
- **现象：** 以为 5 个字体太多想精简到 3 个，实际审计发现 15+ 文件引用了全部 5 个
- **解决：** 只删除未使用的 weight（如 IBM Plex Sans 的 300、IBM Plex Mono 的 500），不删整个字体
- **教训：** 精简前先全局 grep 确认引用

## MCP

### INSTRUCTION.md 写保护
- **现象：** Agent 通过 MCP 误修改了系统内核文件
- **解决：** `isRootProtected()` + `assertNotProtected()` 硬编码保护

### 字符截断
- **现象：** 大文件读取超过 LLM context
- **解决：** 单文件读取上限 25,000 字符 + `truncate()` 工具函数

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

### 免交互模式 (-y) 区分可跳过 vs 必须交互
- **现象：** `-y` 全局免交互跳过了 agent 选择（用户必须自己选）
- **解决：** `choose()` 加 `forcePrompt` 参数，必须交互的选项标记 `{ forcePrompt: true }`
