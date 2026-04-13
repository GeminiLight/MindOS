# NPM 包体积优化方案

> 创建时间：2026-03-21
> 当前版本：v0.5.26
> 当前状态：用户 `npm i -g @geminilight/mindos` 后 node_modules **905 MB**，452 packages

## 现状分析

### 包体积分层

| 分类 | 大小 | 占比 | 包含 |
|------|------|------|------|
| **Next.js + React** | 392 MB | 43% | next, @next, react, react-dom, @img |
| **pi-agent-core 生态** | 64 MB | 7% | @mariozechner, openai, @google, @mistralai, @aws-sdk, @smithy |
| **lucide-react** | 46 MB | 5% | 1500+ icon SVG，项目实际用 91 个 |
| **Rich Editor** | 15 MB | 2% | tiptap (11 packages) + codemirror (5 packages) |
| **Markdown 渲染** | 15 MB | 2% | react-markdown, rehype-*, remark-gfm, highlight.js |
| **其他** | ~373 MB | 41% | 间接依赖、native bindings 等 |

### npm 包本身

- 压缩：427 KB
- 解压：1.5 MB
- 文件数：408

包本身很小，问题在 **安装后的 node_modules**。

## 优化方案

### P0: 立即可做

~~#### 1. 移除 pi-agent-core / pi-ai（-64 MB）~~

**❌ 不可移除。** `app/api/ask/route.ts` 直接 import `Agent` from `@mariozechner/pi-agent-core`，这是 Ask AI 的核心 Agent runtime（tool-calling loop、streaming、context management）。间接依赖（openai、@google、@mistralai 等 64MB）是 pi-agent-core 的 multi-provider 支持，无法剥离。

**现状**：pi-agent-core 是不可减的固定成本。

**收益**：-64 MB node_modules

#### 2. lucide-react 换 @lucide/lab 或 barrel-file 优化（-40 MB）

**现状**：lucide-react 全量 46 MB（1500+ icons），项目用 91 个。npm install 时全量下载，Next.js build 时 tree-shake 掉未用的，但下载体积不变。

**方案 A**：改用 `lucide-react/dynamicIconImports` 按需加载（零改动成本，但 build 时才生效，install 体积不变）

**方案 B**：创建 `lib/icons.ts` barrel file，只 re-export 用到的 91 个 icon。配合 `next.config.ts` 的 `optimizePackageImports` 减少 build 体积。但 npm install 体积仍不变。

**方案 C（推荐）**：等 lucide-react 出 sub-path exports（roadmap 中），或评估 `@iconify/react`（按需下载 SVG，install 只有 ~2MB）。

**结论**：install 体积无法通过 tree-shaking 减少。除非换图标库，否则 46 MB 是固定成本。暂搁置。

### P1: 中期优化（预计 -200 MB）

#### 3. Next.js standalone output + build 后删 node_modules（-1.1 GB 磁盘）

**实测数据**（v0.5.26）：

| | 当前 | standalone |
|---|---|---|
| node_modules | **1.2 GB** | **82 MB** |
| 运行时总大小 | 1.2 GB | **91 MB** |
| 缩减 | — | **93%** |

**原理**：`output: 'standalone'` 让 Next.js 在 build 时用 `@vercel/nft` trace 出运行时真正需要的文件，复制到 `.next/standalone/node_modules`（82MB）。build 完成后原始 `node_modules`（1.2GB）可以删除。

**用户端流程变化**：
```
首次 mindos start：
  npm install → next build (standalone) → rm -rf node_modules → 启动 server.js
  磁盘：1.2GB 临时下载 → build → 删除 → 最终仅 91MB

后续启动：
  直接 node .next/standalone/server.js（秒级）
```

**改动清单**：
1. `next.config.ts`：加 `output: 'standalone'`
2. `serverExternalPackages`：移除已删除的 `pdf-parse`/`pdfjs-dist`
3. `bin/cli.js` start 命令：build 后删 node_modules，用 `server.js` 启动
4. `bin/cli.js` dev 命令：保留原流程（dev 需要完整 node_modules）
5. build stamp 逻辑：standalone 产物存在则跳过重复 build

**风险**：
- `mindos dev` 仍需完整 node_modules（开发模式不走 standalone）
- standalone 产物与 Node.js 版本绑定（native bindings），跨大版本升级需 rebuild
- 插件系统（renderers）如果有动态 import 路径，需确认 nft 能 trace 到

#### 4. 延迟安装 app 依赖

**现状**：`mindos onboard` 时立即 `npm install` 全部 app 依赖。

**方案**：将 `npm install` 推迟到 `mindos start` 首次运行时，`onboard` 只写配置。用户体感：onboard 秒完，首次 start 等一次。

**收益**：改善 onboard 体验（用户先看到成功再等安装）。总下载量不变。

### P2: 长期优化

#### 5. 拆包：@geminilight/mindos-cli + @geminilight/mindos-app

**现状**：单包包含 CLI + App + MCP + Skills + Templates，所有用户安装全部。

**方案**：
- `@geminilight/mindos`（CLI only，<1 MB）：cli.js + 配置管理
- `@geminilight/mindos-app`（按需安装）：Next.js app，仅在 `mindos start` 时检查并安装
- `@geminilight/mindos-mcp`（可选）：MCP server standalone

**收益**：`npm i -g @geminilight/mindos` 秒完（<1 MB），实际 app 安装推迟到使用时。

#### 6. Docker / 预构建二进制

提供 `docker pull` 或 `npx @geminilight/mindos` 一键 docker compose 方案，零依赖安装。

## 推荐执行顺序

| 优先级 | 方案 | 预计收益 | 工作量 |
|--------|------|----------|--------|
| ~~立即~~ | ~~移除 pi-agent-core~~ | ❌ 不可移除（Ask AI 核心依赖） | — |
| **短期** | 延迟安装到首次 start | 更好的 onboard 体感 | 2 hr |
| **中期** | standalone output | -800 MB + 跳过 build | 1 day |
| **长期** | 拆包 cli + app | 秒级全局安装 | 3 days |

## 当前各版本体积追踪

| 版本 | npm 包 | 安装后 node_modules | 备注 |
|------|--------|---------------------|------|
| v0.5.23 | 424 KB | ~1.1 GB | 含 pdf-parse (152 MB) |
| v0.5.26 | 427 KB | 905 MB | 移除 pdf-parse/pdfjs-dist |
