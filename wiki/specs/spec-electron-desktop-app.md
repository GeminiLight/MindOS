# Spec: MindOS Electron Desktop App

## 目标

将 MindOS 封装为 Electron 桌面应用，提供原生窗口体验（系统托盘、开机自启、自动更新、全局快捷键），同时保持与 Web 版 100% 代码共享，不改动现有 Next.js + MCP 架构。

## 现状分析

### 当前架构

```
用户 → mindos start (CLI)
         ├── Next.js App (port 3456)  ← 浏览器访问
         └── MCP Server  (port 8781)  ← 外部 Agent 调用
```

- **优势**：进程独立、端口隔离、配置集中（`~/.mindos/config.json`）
- **问题**：
  1. 依赖浏览器 → 无系统托盘、无全局快捷键、无开机自启（需 launchd/systemd）
  2. 多进程管理靠 PID 文件 → 偶发残留进程
  3. 首次启动需 CLI `mindos start` → 非技术用户门槛高
  4. macOS/Linux daemon 安装分两套（launchd + systemd），维护成本高
  5. 无自动更新 → 用户手动 `npm update -g`

### Electron 解决什么

| 问题 | Electron 方案 |
|------|-------------|
| 浏览器依赖 | 内置 Chromium，独立窗口 |
| 系统集成 | 托盘图标、开机自启、原生通知、全局快捷键 |
| 进程管理 | main process 统一管理子进程生命周期 |
| 自动更新 | electron-updater → GitHub Releases |
| 跨平台 daemon | Electron 自身替代 launchd/systemd |
| 分发 | .dmg (macOS) / .exe (Windows) / .AppImage (Linux) |

## 数据流 / 状态流

### 进程架构

```
┌─ Electron Main Process ───────────────────────────────────┐
│                                                            │
│  ┌─ BrowserWindow ──────────────────────────────────────┐  │
│  │  loadURL('http://127.0.0.1:{webPort}')               │  │
│  │  ┌──────────────────────────────────────────────────┐ │  │
│  │  │  Next.js React App (与 Web 版完全相同)            │ │  │
│  │  │  API calls → http://127.0.0.1:{webPort}/api/*    │ │  │
│  │  └──────────────────────────────────────────────────┘ │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                            │
│  ┌─ Child Process: Next.js Server ──────────────────────┐  │
│  │  next start -p {webPort}                              │  │
│  │  ├── API Routes (/api/ask, /api/files, ...)          │  │
│  │  └── Sync Daemon (instrumentation.ts)                │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                            │
│  ┌─ Child Process: MCP Server ──────────────────────────┐  │
│  │  npx tsx src/index.ts                                 │  │
│  │  Port: {mcpPort}, Host: 0.0.0.0                      │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                            │
│  ┌─ Tray + IPC + Auto-Updater ──────────────────────────┐  │
│  │  System tray icon (running/stopped state)             │  │
│  │  Global shortcut: ⌘+Shift+M (toggle window)          │  │
│  │  electron-updater (GitHub Releases)                   │  │
│  └──────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────┘
```

### 启动流程

```
app.whenReady()
  │
  ├─ 1. 读取 ~/.mindos/config.json（端口、mindRoot、API keys）
  │     └─ 不存在 → 首次启动引导（Setup Wizard）
  │
  ├─ 2. 检测端口可用性
  │     ├─ webPort (默认 3456) 被占 → 自动递增
  │     └─ mcpPort (默认 8781) 被占 → 自动递增
  │
  ├─ 3. 检测 Next.js 构建
  │     ├─ app/.next/ 不存在 → 触发 build（显示 splash screen）
  │     └─ BUILD_STAMP != package.json version → rebuild
  │
  ├─ 4. spawn MCP Server (子进程)
  │     └─ env: { MCP_PORT, MCP_HOST, MINDOS_URL, AUTH_TOKEN }
  │
  ├─ 5. spawn Next.js Server (子进程)
  │     └─ env: { MINDOS_WEB_PORT, MIND_ROOT, NODE_ENV=production }
  │
  ├─ 6. 等待 /api/health 返回 200（轮询，最多 120s）
  │
  ├─ 7. 创建 BrowserWindow → loadURL
  │
  └─ 8. 创建 Tray + 注册全局快捷键
```

### 退出流程

```
用户关闭窗口 / app.quit()
  │
  ├─ 关窗口（非 macOS）→ 最小化到托盘（后台运行）
  ├─ macOS ⌘Q → 最小化到托盘
  ├─ 托盘菜单 Quit → 真正退出
  │
  └─ 真正退出：
       ├─ SIGTERM → Next.js 子进程
       ├─ SIGTERM → MCP 子进程
       ├─ 等待子进程退出（5s 超时后 SIGKILL）
       ├─ 保存窗口状态（位置、尺寸）到 config
       └─ app.exit(0)
```

### IPC 通信

```
Main Process                    Renderer (BrowserWindow)
     │                                │
     │  ← ipc: 'get-app-info'        │  // 版本号、平台
     │  → { version, platform }       │
     │                                │
     │  ← ipc: 'check-update'        │  // 手动检查更新
     │  → { available, version }      │
     │                                │
     │  → ipc: 'update-available'     │  // 推送更新通知
     │  → ipc: 'update-progress'      │  // 下载进度
     │  → ipc: 'update-ready'         │  // 可安装
     │                                │
     │  ← ipc: 'install-update'       │  // 用户确认安装
     │                                │
     │  → ipc: 'server-status'        │  // 服务状态变化
     │                                │
     │  ← ipc: 'open-mindroot'        │  // 用 Finder/Explorer 打开
     │  ← ipc: 'show-devtools'        │  // 开发调试
```

## 方案

### Phase 0: 项目结构

```
sop_note/
├── desktop/                          # 新增：Electron 层
│   ├── package.json                  # Electron + electron-builder 依赖
│   ├── tsconfig.json
│   ├── src/
│   │   ├── main.ts                   # Main process entry
│   │   ├── preload.ts                # Context bridge (安全 IPC)
│   │   ├── tray.ts                   # 系统托盘
│   │   ├── updater.ts                # 自动更新 (electron-updater)
│   │   ├── process-manager.ts        # 子进程生命周期管理
│   │   ├── port-finder.ts            # 端口检测 + 自动分配
│   │   ├── window-state.ts           # 窗口位置/尺寸持久化
│   │   ├── shortcuts.ts              # 全局快捷键注册
│   │   ├── splash.html               # 构建中 splash screen
│   │   └── icons/                    # 平台图标
│   │       ├── icon.icns             # macOS
│   │       ├── icon.ico              # Windows
│   │       └── icon.png              # Linux (512x512)
│   ├── electron-builder.yml          # 打包配置
│   └── scripts/
│       └── build-app.js              # 先 next build → 再 electron build
├── app/                              # 不改动
├── mcp/                              # 不改动
├── bin/                              # 不改动（CLI 继续独立可用）
└── package.json                      # 根 workspaces 新增 desktop
```

### Phase 1: Main Process (`desktop/src/main.ts`)

核心职责：管理窗口 + 管理子进程 + 桥接 IPC。

```typescript
// 关键设计决策

// 1. 不内嵌 Next.js 到 Electron renderer
//    原因：保持 Web 版和桌面版完全相同的运行方式
//    做法：spawn 独立 next start 进程，BrowserWindow loadURL

// 2. 用 app.getPath('userData') 存桌面特有配置
//    ~/.mindos/config.json → 共享配置（CLI 和桌面共用）
//    {userData}/window-state.json → 桌面专属（窗口位置）

// 3. 复用 bin/lib/ 的端口检测和配置加载逻辑
//    不重写，直接 require('../bin/lib/config.js')

// 4. 构建产物打包策略
//    app/.next/ 在 electron-builder 的 files 列表中
//    node_modules 由 electron-builder 自动 prune
```

### Phase 2: Process Manager (`desktop/src/process-manager.ts`)

```typescript
interface ProcessManagerOptions {
  webPort: number;
  mcpPort: number;
  mindRoot: string;
  authToken?: string;
  verbose?: boolean;
}

class ProcessManager {
  private webProcess: ChildProcess | null = null;
  private mcpProcess: ChildProcess | null = null;

  // 启动顺序：MCP → Next.js → 健康检查
  async start(opts: ProcessManagerOptions): Promise<void>;

  // 优雅关闭：SIGTERM → 5s timeout → SIGKILL
  async stop(): Promise<void>;

  // 重启（配置变更后）
  async restart(opts: ProcessManagerOptions): Promise<void>;

  // 健康检查轮询
  private async waitForReady(port: number, path: string, timeoutMs: number): Promise<boolean>;

  // 子进程崩溃自动重启（最多 3 次）
  private handleCrash(which: 'web' | 'mcp'): void;
}
```

**与 CLI 的关系**：

- `mindos start` (CLI) 和 Electron 的 ProcessManager 做同一件事
- 复用 `bin/lib/mcp-spawn.js` 的环境变量组装逻辑，但不直接调用（避免 stdio 冲突）
- 检测冲突：Electron 启动时检查 `~/.mindos/mindos.pid`，如有进程在运行 → 提示用户关闭或直接连接

### Phase 3: 系统托盘 (`desktop/src/tray.ts`)

```
macOS 菜单栏图标 / Windows 系统托盘：

  🟢 MindOS Running
  ─────────────────
  Open MindOS        ⌘+Shift+M
  ─────────────────
  MCP Server    ● Running (port 8781)
  Web Server    ● Running (port 3456)
  ─────────────────
  Open Knowledge Base in Finder
  Settings...
  Check for Updates...
  ─────────────────
  Restart Services
  Quit MindOS         ⌘Q
```

状态图标：
- 🟢 正常运行
- 🟡 启动中 / 构建中
- 🔴 服务异常

### Phase 4: 自动更新 (`desktop/src/updater.ts`)

使用 `electron-updater` + GitHub Releases：

```yaml
# electron-builder.yml
publish:
  provider: github
  owner: AIMindOS
  repo: mindos-desktop      # 独立仓库，或同一仓库不同 release
```

更新策略：
1. 每次启动检查更新（静默）
2. 有更新 → 托盘图标加角标 + 应用内通知（不弹窗打断）
3. 用户点击 "Install Update" → 下载 → 重启安装
4. **不自动安装**——用户是开发者，需要掌控感

### Phase 5: 打包与分发

#### electron-builder 配置

```yaml
# desktop/electron-builder.yml
appId: com.mindos.desktop
productName: MindOS
copyright: Copyright © 2026 MindOS

directories:
  buildResources: src/icons
  output: dist

# 打包文件：Electron 壳 + Next.js 构建产物 + MCP + bin
files:
  - "dist-electron/**/*"        # 编译后的 main/preload
  - "../app/.next/**/*"         # Next.js 构建产物
  - "../app/public/**/*"        # 静态资源
  - "../app/package.json"       # 依赖声明
  - "../app/node_modules/**/*"  # 运行时依赖（electron-builder prune）
  - "../mcp/src/**/*"           # MCP 源码
  - "../mcp/package.json"
  - "../mcp/node_modules/**/*"
  - "../bin/**/*"               # CLI 工具（可选，复用配置加载）
  - "../templates/**/*"         # 知识库模板
  - "../skills/**/*"            # 内置 Skill
  - "../scripts/**/*"           # 构建脚本

# 排除
files.filter:
  - "!**/node_modules/.cache"
  - "!**/.turbo"
  - "!**/test/**"
  - "!**/__tests__/**"

mac:
  category: public.app-category.productivity
  icon: src/icons/icon.icns
  target:
    - target: dmg
      arch: [x64, arm64]     # Intel + Apple Silicon
    - target: zip
      arch: [x64, arm64]
  hardenedRuntime: true
  entitlements: entitlements.plist
  entitlementsInherit: entitlements.plist

win:
  icon: src/icons/icon.ico
  target:
    - target: nsis
      arch: [x64, arm64]
  # 安装时选择 per-user（不需要 admin）
  nsis:
    oneClick: false
    perMachine: false
    allowToChangeInstallationDirectory: true

linux:
  icon: src/icons/icon.png
  target:
    - AppImage
    - deb
  category: Office
```

#### Node.js 运行时打包策略

**关键决策：内嵌 Node.js**

Electron 自带 Node.js（main process），但子进程需要独立的 Node.js 来运行 `next start` 和 MCP server。两个选择：

| 策略 | 包体增量 | 复杂度 | 用户依赖 |
|------|---------|--------|---------|
| **A: 使用 Electron 内置 Node** | 0 | 高（需 fork + env hack） | 无 |
| **B: 内嵌独立 Node.js** | +60-80MB | 低（正常 spawn） | 无 |
| **C: 依赖系统 Node.js** | 0 | 低 | 需用户安装 Node ≥20 |

**推荐 A → C fallback**：

1. 优先使用 Electron 的 `process.execPath` 作为 Node 运行时（`electron` 二进制本身可以执行 JS）
2. 对于 `next start`，需要验证 Electron 内置 Node 能否正常运行 Next.js server
3. 如果不行，检测系统 `node` → 找到则使用，找不到提示安装

```typescript
function getNodePath(): string {
  // 1. Electron 内置
  if (canRunNextWithElectronNode()) {
    return process.execPath;
  }
  // 2. 系统 Node.js
  const systemNode = which.sync('node', { nothrow: true });
  if (systemNode) return systemNode;
  // 3. 报错提示
  throw new Error('Node.js ≥20 required. Install from https://nodejs.org');
}
```

> **注意**：`process.execPath` 在 Electron 打包后指向 electron 二进制而非 node，直接用它 spawn `next start` 可能有兼容问题（Electron 的 Node 环境与标准 Node 有差异）。需要在 Phase 1 做验证，如果不兼容则回退到方案 C。

#### 预期包体

| 组件 | 大小 |
|------|------|
| Electron 框架 | ~120MB |
| Next.js 构建产物 | ~30MB |
| node_modules (pruned) | ~80MB |
| MCP server | ~5MB |
| 其他（模板、Skill、图标） | ~2MB |
| **总计（安装后）** | **~240MB** |
| **DMG/Installer** | **~90-120MB**（压缩后） |

### Phase 6: 与 CLI 共存

Electron 和 CLI 共享同一份配置和知识库：

```
~/.mindos/config.json     ← 两者共用
~/.mindos/mindos.pid      ← CLI 写入；Electron 检测冲突
~/MindOS/mind/            ← 知识库路径，两者共用
```

**冲突处理**：

```
Electron 启动
  │
  ├─ 检查 mindos.pid → 进程存活？
  │   ├─ 是 → 对话框：
  │   │       "MindOS CLI 正在运行（PID xxx, port 3456）"
  │   │       [连接到现有服务]  [关闭 CLI 并接管]
  │   │
  │   │   连接 → 不启动子进程，直接 loadURL 到已有端口
  │   │   接管 → kill 旧进程 → 自己启动
  │   │
  │   └─ 否（残留 PID）→ 清理 PID 文件 → 正常启动
  │
  └─ 无 PID → 正常启动
```

### Phase 7: 开发工作流

```json
// desktop/package.json
{
  "scripts": {
    "dev": "electron-vite dev",           // 开发模式（HMR main process）
    "build": "electron-vite build",       // 编译 TS → JS
    "pack": "electron-builder --dir",     // 打包但不生成安装器
    "dist": "electron-builder",           // 生成安装器
    "dist:mac": "electron-builder --mac",
    "dist:win": "electron-builder --win",
    "dist:linux": "electron-builder --linux",
    "release": "electron-builder --publish always"  // 发布到 GitHub
  }
}
```

开发时的热重载：
- **Next.js App**：照常 `cd app && npm run dev`（HMR）
- **Electron Main**：`electron-vite dev` 监听 main.ts 变更自动重启
- **两者联调**：Electron loadURL 指向 `http://localhost:3456`（dev 端口）

### Phase 8: 平台特定功能

#### macOS

- **深色标题栏**：`titleBarStyle: 'hiddenInset'` + `trafficLightPosition`
- **Dock 图标**：显示通知角标（有更新时）
- **Touch Bar**：暂不实现（使用率低）
- **Universal Binary**：支持 Intel + Apple Silicon

#### Windows

- **自定义标题栏**：保持原生（Windows 用户习惯）
- **Jump List**：右键任务栏 → 快速打开知识库、新建文件
- **开机自启**：`app.setLoginItemSettings({ openAtLogin: true })`

#### Linux

- **AppImage**：免安装运行
- **系统图标**：遵循 XDG 规范
- **Wayland**：Electron 30+ 默认支持

### 技术选型

| 依赖 | 版本 | 用途 |
|------|------|------|
| electron | ^33 | 运行时 |
| electron-builder | ^25 | 打包 + 签名 + 分发 |
| electron-updater | ^6 | 自动更新 |
| electron-vite | ^3 | 开发构建工具 |
| electron-store | ^10 | 窗口状态持久化 |

## 影响范围

### 新增文件

| 文件 | 说明 |
|------|------|
| `desktop/` 整个目录 | Electron 层（~10 个源文件） |
| `.github/workflows/build-desktop.yml` | CI：多平台构建 + Release |

### 修改文件

| 文件 | 改动 |
|------|------|
| `package.json` (root) | workspaces 新增 `desktop`，scripts 新增 `desktop:*` |
| `app/middleware.ts` | 允许 Electron WebView 的 Origin（`file://` 或 `app://`） |
| `.gitignore` | 新增 `desktop/dist/`, `desktop/dist-electron/` |

### 不改动

| 模块 | 原因 |
|------|------|
| `app/` (Next.js) | Electron 通过 loadURL 加载，零改动 |
| `mcp/` (MCP server) | 子进程方式运行，与之前一致 |
| `bin/` (CLI) | 继续独立可用，不耦合 Electron |
| `landing/` | 静态站，不涉及 |

### 与其他功能的关系

- **Walkthrough / Explore Gallery**（pending plan）：不受影响，它们是 Next.js 页面
- **PWA**：Electron 用户不需要 PWA，但 Web 用户可以并行使用
- **MCP 远程访问**：Electron 内的 MCP 仍然绑定 `0.0.0.0`，远程 Agent 照常连接

## 边界 case 与风险

### 边界 case

| # | 场景 | 处理 |
|---|------|------|
| 1 | CLI 和 Electron 同时运行 | 检测 PID 文件，提示"连接现有"或"接管" |
| 2 | 首次启动，需要 next build（3-5 分钟） | Splash screen 显示构建进度，托盘图标 🟡 |
| 3 | 子进程崩溃 | 自动重启最多 3 次，超过则通知用户手动排查 |
| 4 | 端口被占 | 自动递增（3456→3457→...），写入 config.json |
| 5 | 用户从 CLI 迁移到桌面端 | 共享 `~/.mindos/config.json`，零迁移成本 |
| 6 | macOS 关窗口 vs 退出 | ⌘W 隐藏窗口（后台运行），托盘 Quit 才真正退出 |
| 7 | 自动更新期间用户正在编辑 | 不自动安装，提示"有更新可用"，用户手动触发 |
| 8 | 知识库路径包含空格/中文 | 所有路径用引号包裹，spawn 的 cwd 用 `resolve()` |
| 9 | 系统无 Node.js（方案 C fallback） | 弹框引导安装，附 nodejs.org 链接 |
| 10 | Windows 安装路径含非 ASCII | electron-builder NSIS 默认处理，需验证 |

### 风险

| 风险 | 等级 | 缓解措施 |
|------|------|---------|
| Electron 内置 Node 运行 next start 不兼容 | 高 | Phase 1 首先验证，不兼容则回退方案 C |
| 包体过大（>150MB 安装器） | 中 | electron-builder 的 `asar` 压缩 + prune devDependencies |
| macOS 签名/公证成本 | 中 | 先用 ad-hoc 签名开发，正式发布再申请 Apple Developer |
| 自动更新 delta 太大 | 低 | electron-builder 支持 blockmap diff 更新 |
| Chromium 安全策略变更影响 loadURL localhost | 低 | 历史上未发生，Electron 团队持续维护 |

## 验收标准

### Phase 0-1: 基础可用

- [ ] `cd desktop && npm run dev` 启动 Electron 窗口，加载 `http://localhost:3456` 正常显示
- [ ] Next.js + MCP 子进程由 Electron main process 管理，`Activity Monitor` 可见
- [ ] 关闭窗口 → 子进程正确终止，无残留进程
- [ ] 窗口位置和尺寸在重启后恢复

### Phase 2-3: 系统集成

- [ ] 系统托盘图标显示，状态正确（🟢运行/🟡启动中/🔴异常）
- [ ] 托盘菜单所有项目可点击且功能正常
- [ ] 全局快捷键 `⌘+Shift+M` 切换窗口显示/隐藏
- [ ] macOS `⌘W` 隐藏窗口但不退出，`⌘Q` 最小化到托盘

### Phase 4: 自动更新

- [ ] 检测到新版本 → 应用内通知（非弹窗）
- [ ] 用户点击安装 → 下载 + 重启 + 更新完成
- [ ] 更新期间不打断用户当前操作

### Phase 5: 打包分发

- [ ] `npm run dist:mac` 生成 .dmg，可安装运行
- [ ] `npm run dist:win` 生成 .exe 安装器，可安装运行
- [ ] `npm run dist:linux` 生成 .AppImage，可运行
- [ ] 安装器大小 < 150MB

### Phase 6: 共存兼容

- [ ] Electron 检测到 CLI 运行 → 提示选择"连接"或"接管"
- [ ] CLI 用户升级到桌面端 → 配置和知识库无缝继承
- [ ] 桌面端和 CLI 可以交替使用（不同时运行）

### 全局

- [ ] `npx vitest run` 通过（不影响现有测试）
- [ ] `npx tsc --noEmit` 无新增 TS 错误
- [ ] 三平台（macOS/Windows/Linux）至少手动测试核心流程
- [ ] 开机自启可启用/禁用（Settings → General）

## 开发路线

| Phase | 内容 | 预估 |
|-------|------|------|
| 0 | 项目结构 + 依赖 + 开发工作流 | 1d |
| 1 | main.ts + process-manager + BrowserWindow | 2d |
| 2 | 系统托盘 + 全局快捷键 | 1d |
| 3 | 窗口状态持久化 + CLI 冲突检测 | 1d |
| 4 | 自动更新（electron-updater） | 1d |
| 5 | 打包配置 + CI workflow | 2d |
| 6 | 平台特定适配 + 测试 | 2d |
| **总计** | | **~10d** |

建议执行顺序：Phase 0 → 1 → 5（先能打包）→ 2 → 3 → 4 → 6
