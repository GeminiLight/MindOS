<!-- Last verified: 2026-03-14 | Current stage: P1 -->

# 编码约定 (Conventions)

> Agent 写代码前参考此文件。

## 模块格式

- **ESM**：`package.json` 中 `"type": "module"`，全项目 `import/export`
- **bin/ 下全部 `.js`**：CLI 不经过 TypeScript 编译，直接 Node.js ESM 运行
- **app/ 和 mcp/ 下 `.ts/.tsx`**：TypeScript，经过编译

## 库选择

| 用途 | 使用 | 不使用 | 原因 |
|------|------|--------|------|
| 前端框架 | Next.js 16 (App Router) | Pages Router | 服务端组件 + 流式渲染 |
| UI 组件 | shadcn/ui + Tailwind | MUI / Ant Design | 轻量，可定制 |
| 富文本编辑 | TipTap | ProseMirror 直接用 | 封装层更友好 |
| 源码编辑 | CodeMirror 6 | Monaco | 更轻量 |
| AI SDK | Vercel AI SDK | LangChain | 原生流式，无重依赖 |
| MCP SDK | `@modelcontextprotocol/sdk` | 自实现 | 标准协议 |
| 搜索 | Fuse.js | Lunr / ElasticSearch | 纯前端，零部署 |

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
| 共享常量 | `bin/lib/constants.js` |
| 命令路由 + 入口 | `bin/cli.js`（依赖图根节点） |
| 按职责独立模块 | `bin/lib/<name>.js` |
| `process.argv` | 只在 `cli.js` 和 `mcp-install.js` 中使用 |

循环依赖 → 合并到同一文件（如 systemd + launchd + gateway → `gateway.js`）。

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
