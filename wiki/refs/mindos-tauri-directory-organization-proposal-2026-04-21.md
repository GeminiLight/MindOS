# MindOS Tauri 版目录组织方案（参考 OpenCode，2026-04-21）

## 先说结论

如果 MindOS 要做 Tauri 版本，我不建议在现有目录上继续“边长边补”。  
更合适的方向是：

```text
把“产品壳”和“核心能力”彻底拆开：

- apps/   放各个入口壳
- packages/ 放可复用核心
- tooling/ 放构建与发布脚本
- wiki/ docs/ 继续放产品与工程文档
```

而且建议采用 **“Electron 保持现状 + 新开 Tauri spike 目录”** 的方式演进，而不是直接原地替换。

## OpenCode 仓库给我的启发

我看了 OpenCode 官方 repo `anomalyco/opencode` 的目录组织，和桌面相关的核心结构大致是这样：

### 顶层 packages

- `packages/opencode`
  - 核心 runtime / CLI / server / storage / business logic
- `packages/app`
  - Web app / 主 UI 入口
- `packages/ui`
  - 可复用 UI 组件和主题
- `packages/desktop`
  - Tauri 桌面壳
- `packages/desktop-electron`
  - Electron 桌面壳
- `packages/foundation/shared`
  - 共享逻辑
- `packages/sdk`
  - SDK

### 这套组织最重要的点

不是“它把所有东西都塞进 packages/”，而是它很清楚地区分了三层：

1. **核心产品逻辑**：`packages/opencode`
2. **前端 UI 层**：`packages/app`、`packages/ui`
3. **平台壳**：`packages/desktop`、`packages/desktop-electron`

也就是说：

```text
壳只是壳
核心是核心
UI 是 UI
```

这对 MindOS 很重要。

## MindOS 当前目录的主要问题

你现在的仓库已经能跑，但如果未来要同时支持 Web / Desktop(Electron) / Desktop(Tauri) / Mobile，会越来越吃力。  
主要有 4 个结构性问题。

### 1. `app/` 太像“全部东西都往里放”

当前 `app/` 既有：

- Next.js 页面和组件
- 大量业务逻辑
- 数据层
- 一部分桌面也要复用的逻辑
- AI / MCP / 协议相关 glue code

这会导致：

- Web 和 Desktop 的边界不清
- 想抽 Tauri 壳时，不知道哪些逻辑该复用、哪些逻辑绑定了 Next

### 2. `desktop/` 里有太多“产品逻辑 + 平台逻辑”混在一起

现在 `desktop/src` 里既有：

- 平台壳能力
  - tray
  - menu
  - updater
  - preload
  - protocol
- 也有偏产品基础设施的逻辑
  - runtime resolve
  - runtime pick
  - process manager
  - node bootstrap
  - health contract
  - connect flow

这会让未来 Tauri 迁移很难，因为这些逻辑不全是 Electron 专属，却长在 Electron 包里。

### 3. `mcp/`、`bin/`、`desktop/`、`app/` 之间是“能工作”，但不是“清晰分层”

比如现在的结构更像：

```text
app       -> 主 UI 与部分核心
mcp       -> MCP server
desktop   -> Electron 壳 + runtime orchestration
bin       -> CLI
```

这在单壳阶段没问题，但一旦你要多壳并存，就会暴露出：

- CLI 复用谁？
- Desktop runtime 到底属于谁？
- MCP 是独立产品层，还是 runtime 的一个 adapter？

### 4. 平台入口和核心能力还没完全分离

MindOS 的真正核心其实是：

- knowledge runtime
- local API / server
- MCP capability
- agent / workflow orchestration

但现在这些能力的承载目录还没有被清晰表达成一个“核心包”。

## 我建议的目标结构

## 总原则

用两层模型来收敛：

### 第一层：入口壳（apps）

每个入口只负责：

- UI 容器
- 平台集成
- 调核心 API

### 第二层：复用核心（packages）

所有真正长期稳定的能力放这里：

- runtime
- UI primitives
- shared types
- 协议层
- MCP adapter
- desktop-agnostic orchestration

## 推荐目录

```text
mindos/
├─ apps/
│  ├─ web/                     # 现在的 Next.js app
│  ├─ desktop-electron/        # 现有 Electron 壳
│  ├─ desktop-tauri/           # 新的 Tauri 壳（先 spike，后决定是否转正）
│  ├─ mobile/                  # React Native / Expo
│  └─ browser-extension/       # 浏览器扩展
│
├─ packages/
│  ├─ runtime/                 # MindOS 本地核心 runtime（最重要）
│  ├─ mcp-server/              # MCP 服务层
│  ├─ cli/                     # CLI 命令层
│  ├─ ui/                      # 设计系统 / 复用组件
│  ├─ web-shared/              # web + desktop 共用前端逻辑
│  ├─ desktop-core/            # 与 Electron/Tauri 无关的桌面共用逻辑
│  ├─ protocols/               # ACP / A2A / MCP / deep-link schema / IPC contract
│  ├─ knowledge/               # 知识库、文件系统、索引、模板相关核心逻辑
│  ├─ agent-core/              # Agent orchestration / skills / runtime adapter
│  ├─ config/                  # schema / env / defaults
│  └─ shared/                  # types / utils / constants
│
├─ tooling/
│  ├─ scripts/                 # 构建、发布、生成脚本
│  ├─ release/                 # release helpers
│  └─ ci/                      # CI helper scripts
│
├─ wiki/
├─ docs/
├─ assets/
└─ package.json
```

## 对应到你现在仓库的迁移映射

### 现有 `app/`

建议拆成：

- `packages/web/`
- `packages/ui/`
- `packages/web-shared/`
- `packages/agent-core/`
- `packages/knowledge/`
- `packages/foundation/shared/`

不是一次拆完，而是逐步把“不属于 Next app 的东西”往外搬。

### 现有 `desktop/`

建议拆成：

- `packages/desktop-electron/`
- `packages/desktop-core/`

其中：

#### 保留在 `packages/desktop-electron/` 的内容

- `main.ts`
- `preload.ts`
- `connect-preload.ts`
- `splash-preload.ts`
- `tray.ts`
- `app-menu.ts`
- `updater.ts`
- Electron 专属 builder / icons / entitlements

也就是：**凡是强绑定 Electron API 的，都留在壳里。**

#### 下沉到 `packages/desktop-core/` 的内容

- `process-manager.ts`
- `node-bootstrap.ts`
- `node-detect.ts`
- `mindos-runtime-layout.ts`
- `mindos-runtime-pick.ts`
- `mindos-runtime-resolve.ts`
- `port-finder.ts`
- `connection-sdk.ts`
- `connection-monitor.ts`
- `ssh-tunnel.ts`
- `safe-rm.ts`
- `safe-paths.ts`
- `telemetry.ts`

也就是：**只要理论上 Electron 和 Tauri 都可能用，就不该长在 Electron 包里。**

### 现有 `mcp/`

建议变成：

- `packages/protocols/mcp-server/`

因为它本质上是可复用产品能力，不是顶层并列应用。

### 现有 `bin/`

建议变成：

- `packages/mindos/bin/`（正式 CLI；不再保留独立 `packages/cli`）

CLI 应该是 runtime 的入口 adapter，不应该长期作为一个散落顶层的特殊目录。

### 现有 `mobile/`

建议迁到：

- `packages/mobile/`

### 现有 `browser-extension/`

建议迁到：

- `packages/browser-extension/`

## 为什么我建议加一个 `packages/runtime/`

这是整个目录设计里最重要的一点。

MindOS 最核心的长期资产，不是 Web，也不是 Electron，更不是 Tauri。  
真正的核心应该是一个独立表达出来的：

```text
packages/runtime
```

它负责：

- 启动本地服务
- 管理知识库根目录
- 提供内部 API
- 组织 MCP / agent / workflow
- 协调模板、技能、空间、配置

这样未来的关系会变成：

```text
web                -> 调 runtime
desktop-electron   -> 调 runtime
desktop-tauri      -> 调 runtime
cli                -> 调 runtime
mcp-server         -> 调 runtime
```

这才是最适合 MindOS 的形态。

## 为什么我建议加一个 `packages/desktop-core/`

因为你们有一大批逻辑，虽然今天放在 `desktop/`，但本质上并不是 Electron 专属：

- runtime 发现与选择
- 本地进程管理
- 端口管理
- 更新清单解释
- 健康检查
- SSH tunnel
- 本地环境检查

这些逻辑应该成为“桌面壳无关层”。

这样未来：

- Electron 壳能复用
- Tauri 壳也能复用

否则你做 Tauri 时会发现：明明只是换壳，却要把这批逻辑也再抄一遍。

## 我建议的 Tauri 版组织方式

## 不要这样做

```text
desktop/
  src/
  src-tauri/
```

直接在现有 Electron 目录里硬塞一个 `src-tauri/`，短期看最省事，长期会很乱：

- Electron 和 Tauri 的资源、构建、签名、更新全混在一起
- 哪些代码是公共的，哪些是壳专属，会越来越难判断

## 建议这样做

```text
apps/
  desktop-electron/
  desktop-tauri/
packages/
  desktop-core/
  runtime/
  ui/
  shared/
```

这和 OpenCode 的思路更接近，只是我建议你们再进一步，把 runtime 抽得更明确。

## `packages/desktop-tauri/` 推荐结构

```text
packages/desktop-tauri/
├─ src/                    # 前端入口（Tauri webview UI）
├─ src-tauri/
│  ├─ src/                 # Rust commands / setup
│  ├─ capabilities/
│  ├─ icons/
│  ├─ Cargo.toml
│  ├─ tauri.conf.json
│  └─ tauri.prod.conf.json
├─ package.json
├─ vite.config.ts
├─ index.html
└─ README.md
```

这个部分建议尽量只保留：

- Tauri commands
- 插件注册
- tray/menu/window setup
- 壳级更新逻辑

不要把业务和 runtime orchestration 再塞进去。

## 推荐的迁移步骤

## Phase 1：先重命名入口层，不动实现

先做最轻的结构重组：

- `app/` -> `packages/web/`
- `desktop/` -> `packages/desktop-electron/`
- `mobile/` -> `packages/mobile/`
- `browser-extension/` -> `packages/browser-extension/`
- `mcp/` -> `packages/protocols/mcp-server/`
- `bin/` -> `packages/mindos/bin/`
- `scripts/` -> `tooling/scripts/`

这一步的目标不是“完美分层”，而是先把“入口壳”和“复用层”的语义建立起来。

## Phase 2：抽出 `packages/foundation/shared`、`packages/ui`、`packages/desktop-core`

先搬最容易独立的：

- types
- schema
- constants
- shared utils
- design system / reusable components
- desktop runtime management

这一步完成后，Tauri 才真正有共用基础。

## Phase 3：抽出 `packages/runtime`

这是最重要、也最难的一步。

目标不是“一次把所有逻辑搬过去”，而是先让这些能力有新的归宿：

- local runtime startup
- runtime config
- knowledge root management
- internal service contracts

## Phase 4：新建 `packages/desktop-tauri/`

只做 spike，先别发正式版。

先接通：

- 主窗口
- runtime sidecar
- 基础 tray
- 基础 updater
- deep link

## Phase 5：决定是否双壳并存

如果 Tauri spike 成功，再决定：

- 是长期保留 Electron + Tauri
- 还是把 Electron 标成 legacy，逐步迁移

## 哪些事不要一起做

迁目录时，不要顺手一起做：

- 大规模状态管理重构
- 设计系统大改
- MCP 协议层重写
- runtime 更新机制重写

否则你最后会分不清：

- 是目录改坏了
- 还是架构改坏了
- 还是产品逻辑改坏了

## 最适合你现在的落地建议

如果只给一个最务实的方案，我建议这样：

### 现在先建立目标结构，但只动最少文件

```text
apps/
  web/
  desktop-electron/
  desktop-tauri-spike/
packages/
  desktop-core/
  mcp-server/
  cli/
  shared/
tooling/
  scripts/
```

### 然后只做两件实事

1. 从现有 `desktop/` 抽出 `desktop-core`
2. 新建一个最小 `desktop-tauri-spike`

这样你们马上就能回答一个真正关键的问题：

```text
MindOS 是不是已经足够“壳薄核心厚”，
以至于 Tauri 值得迁？
```

## 一句话总结

参考 OpenCode，MindOS 最值得学的不是“也建一个 `desktop/` 和 `desktop-electron/`”，  
而是要把结构收敛成：

```text
入口壳归入口壳
UI 归 UI
核心 runtime 归核心 runtime
```

对 MindOS 来说，最合理的目标结构不是“Electron 目录里再塞一个 Tauri”，而是：

```text
apps/*     = 各端入口
packages/* = 复用核心
tooling/*  = 构建发布
```

这才是后面 Web / Electron / Tauri / Mobile 同时存在时，还能持续演进的目录方式。
