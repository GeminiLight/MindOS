<!-- Last verified: 2026-04-28 | Current version: v1.0 -->

# 编码约定 (Conventions)

> Agent 写代码前参考此文件。

## 模块格式

- **ESM**：`package.json` 中 `"type": "module"`，全项目 `import/export`
- **packages/mindos/bin/ 下全部 `.js`**：CLI 不经过 TypeScript 编译，直接 Node.js ESM 运行；根目录不再保留 `bin/` 源码入口
- **packages/web/、packages/desktop/、packages/mobile/ 和 packages/* 下 `.ts/.tsx`**：TypeScript，经过编译

## 库选择

| 用途 | 使用 | 不使用 | 原因 |
|------|------|--------|------|
| 前端框架 | Next.js 16 (App Router) | Pages Router | 服务端组件 + 流式渲染 |
| UI 组件 | shadcn/ui + Tailwind | MUI / Ant Design | 轻量，可定制 |
| 富文本编辑 | TipTap | ProseMirror 直接用 | 封装层更友好 |
| 源码编辑 | CodeMirror 6 | Monaco | 更轻量 |
| Agent SDK | pi-agent-core 0.60.0 | Vercel AI SDK / LangChain | Agent 执行循环 + TypeBox 工具定义，原生流式 |
| MCP SDK | `@modelcontextprotocol/sdk` | 自实现 | 标准协议 |
| 搜索 | Fuse.js | Lunr / ElasticSearch | 纯前端，零部署 |
| A2A 协议 | Google A2A Protocol | 自实现 RPC | 标准 Agent 间通信协议 |
| ACP 协议 | Agent Client Protocol | 直接进程调用 | 标准 Agent 客户端协议，31+ Agent 注册表 |

## 命名规范

| 对象 | 规范 | 示例 |
|------|------|------|
| React 组件 | PascalCase | `SettingsModal`, `CsvRenderer` |
| 文件名（组件） | PascalCase.tsx | `AiTab.tsx`, `BoardView.tsx` |
| 文件名（lib） | camelCase.ts | `settings.ts`, `fs.ts` |
| CLI 模块 | kebab-case.js | `mcp-install.js`, `mcp-spawn.js` |
| API Routes | kebab-case 目录 | `api/recent-files/route.ts` |
| CSS 类 | Tailwind utility | 不写自定义 CSS class |

## Git 提交

Conventional Commits：`feat:` / `fix:` / `refactor:` / `docs:` / `chore:`

提交后确认是否发版（`npm run release [patch|minor|major]`）。

## 组件拆分约定

当单文件超过 **500 行**，按以下顺序拆分：
1. `types.ts` — 类型和工具函数
2. `Primitives.tsx` — 共享 UI 原子组件
3. 按视图/Tab 独立文件
4. `index.ts` — barrel export

状态管理留在父组件，子组件纯 props。

## CLI 模块拆分约定

| 模块类型 | 放置位置 |
|---------|---------|
| 共享常量 | `packages/mindos/bin/lib/constants.js` |
| 命令路由 + 入口 | `packages/mindos/bin/cli.js`（仓库内依赖图根节点；npm 安装后是包内 `bin/cli.js`） |
| 按职责独立模块 | `packages/mindos/bin/lib/<name>.js` |
| `process.argv` | 只在 `cli.js` 和 `mcp-install.js` 中使用 |

循环依赖 → 合并到同一文件（如 systemd + launchd + gateway → `gateway.js`）。

## 测试目录约定

v1 使用 monorepo 后，测试按“归属边界”放置，不再把所有测试塞进一个目录。

| 位置 | 放什么 | 默认是否进 `pnpm test` |
|------|--------|------------------------|
| `packages/web/__tests__/` | Web App Router、API route、React 组件、Web 业务逻辑测试 | 是，通过 `turbo run test` |
| `packages/desktop/src/*.test.ts` | Desktop/Electron 专属逻辑，和源码 colocate | 是，通过 `turbo run test` |
| `packages/mobile/__tests__/` | Mobile/Expo 专属逻辑 | 是，通过 `turbo run test` |
| `packages/<domain>/<pkg>/src/*.test.ts` | package 内部单元测试，和源码 colocate | 是，通过 `turbo run test` |
| `tests/*.test.ts` | repo 级 contract：迁移、发布包、workflow、legacy cleanup | 是，通过 `pnpm run test:contracts` |
| `tests/unit/*.test.ts` | 根 CLI、packaging、跨 package 纯单元测试 | 是，通过 `pnpm run test:unit` |
| `tests/integration/*.test.ts` | 需要真实 Web/MCP 服务或网络端口的集成测试 | 否，手动 `pnpm run test:integration` |
| `tests/e2e/*.spec.ts` | Playwright 浏览器端到端测试 | 否，手动 `pnpm run test:e2e` |

判断规则：
- 测试只验证某个 workspace package 的内部行为，放在该 package 内，优先 colocate 到 `src/*.test.ts`。
- Package 测试文件名优先用行为或模块名，例如 `permission-rules.test.ts`、`space-manager.test.ts`。
- `index.test.ts` 不是禁用词：如果 package 只有 `src/index.ts` 一个源码模块，或测试明确是 public entrypoint contract，可以使用。多模块 package 不用泛名 `index.test.ts`，避免失败输出缺少上下文。
- 测试验证根 CLI、npm tarball、workflow、迁移边界，放在根 `tests/`。
- 需要启动真实服务、打开端口、依赖浏览器的测试不放进默认 `pnpm test`，避免 commit/release 被外部环境卡住。
- `.next/`、`_standalone/`、`.turbo/` 里的测试文件都是生成物或缓存，不是源码测试入口。

## Workspace package 依赖约定

App 的 `package.json` 只声明源码直接 import 的 `@mindos/*` workspace package，不能把 package 当“目录索引”或未来占位。间接依赖由对应 package 自己声明。

产品主包固定为 `packages/mindos`，包名 `@geminilight/mindos`。foundation / knowledge 已内聚到 `packages/mindos/src/*`，不再作为独立 workspace package。保留的低层 workspace package 必须位于 `packages/<domain>/<pkg>`，当前 domain 为：
- `retrieval`：search / vector / indexer / api，可选 adapter/service 域；核心 retrieval types、chunking、SearchEngine / VectorDatabase contracts 归 `@geminilight/mindos/retrieval`，MeiliSearch / LanceDB / Express / chokidar backend 不进 Web 直接依赖或主 runtime 闭包
- `protocols`：acp / mcp-server

当前 Web 直接依赖边界：
- `@mindos/acp`：ACP detection / registry / session / subprocess bridge
- `@geminilight/mindos`：产品 runtime facade，聚合 foundation / knowledge 能力，并声明 retrieval / protocols 归属边界

`@mindos/indexer` 不属于 Web 直接依赖；它是可选索引服务包，当前由 `@mindos/api` 索引链路使用。`packages/retrieval/*/src/types.ts` 不重新定义产品类型，只从 `@geminilight/mindos/retrieval` re-export。`packages/mindos/package.json.files` 是 npm 发布白名单，只包含 CLI/Web/MCP 运行时需要的 package 闭包，不等于 `pnpm-workspace.yaml` 的全量 workspace 清单。

长期方向参考 OpenCode：核心业务收敛到 `@geminilight/mindos` 的内部模块，协议/SDK/plugin 保持独立 package；不要继续为内部 util 或 Web-only singleton 创建细碎 package。

`packages/mindos/_standalone`、`packages/mindos/apps`、`packages/mindos/packages`、`packages/mindos/scripts`、`packages/mindos/assets`、`packages/mindos/skills`、`packages/mindos/templates` 是 product pack/publish staging output，不是源码。不要在这些目录里改代码；如果本地 `npm pack` 后留下 staging output，运行 `pnpm run clean:product-stage`。

## 禁止项

- 不使用 `any` 类型（用 `unknown` + 类型守卫）
- 不使用 `console.log` 做生产日志（CLI 中可用 ANSI 颜色函数）
- 不在 MCP 工具中直接操作 `INSTRUCTION.md`（写保护）
- 不在模块间通过全局状态隐式通信

## 样式约定

| 场景 | 做法 | 不做 |
|------|------|------|
| 显示字体（标题/标签） | `className="font-display"` | `style={{ fontFamily: "IBM Plex Mono..." }}` |
| 主题色按钮 | `bg-[var(--amber)] text-[#131210]` | `style={{ background: 'var(--amber)' }}` |
| 交互状态展开/折叠 | 按钮加 `aria-expanded={state}` | 仅视觉反馈无语义 |
| 动态消息（错误/成功） | `role="alert" aria-live="polite"` | 静默插入 DOM |
| 键盘焦点 | 依赖 `globals.css` 全局 `focus-visible` 规则 | 每个组件重复写 `focus:ring-*` |
| 时间戳显示 | `relativeTime(mtime, t.home.relativeTime)` + `suppressHydrationWarning` | `new Date().toLocaleDateString()` |
| CLI 输出语言 | 英文统一（全球用户） | 中英混合 |
