# Spec: MindOS Electron Desktop App

> **定位**：Phase 1。包含本地模式 + 远程模式 + 连接基础设施。独立可交付。

## 目标

将 MindOS 封装为 Electron 桌面应用，支持两种模式：
- **本地模式**：在用户本机 spawn Next.js + MCP 服务（替代 CLI）
- **远程模式**：连接部署在服务器上的 MindOS 实例

提供原生窗口体验（系统托盘、开机自启、自动更新、全局快捷键），保持与 Web 版 100% 代码共享，不改动现有 Next.js + MCP 架构。

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
  4. macOS/Linux daemon 两套维护（launchd + systemd）
  5. 无自动更新 → 用户手动 `npm update -g`
  6. 远程部署用户只能用浏览器，无桌面级体验

### 用户部署场景

| 场景 | 占比 | 需求 |
|------|------|------|
| 本地笔记本/台式机 | ~60% | Electron spawn 本地服务 |
| 云服务器/NAS | ~30% | Electron 连接远程 MindOS |
| 办公室服务器 + 家里连接 | ~10% | 多服务器切换 |

## 数据流 / 状态流

### 进程架构（本地模式）

```
┌─ Electron Main Process ───────────────────────────────────┐
│                                                            │
│  ┌─ BrowserWindow ──────────────────────────────────────┐  │
│  │  loadURL('http://127.0.0.1:{webPort}')               │  │
│  │  Next.js React App (与 Web 版完全相同)                 │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                            │
│  ┌─ Child: Next.js Server (port {webPort}) ─────────────┐  │
│  │  API Routes + Sync Daemon                             │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                            │
│  ┌─ Child: MCP Server (port {mcpPort}) ─────────────────┐  │
│  │  20 tools, host 0.0.0.0                               │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                            │
│  Tray + IPC + Auto-Updater + Shortcuts                     │
└────────────────────────────────────────────────────────────┘
```

### 进程架构（远程模式）

```
┌─ Electron Main Process ───────────────────────────────────┐
│                                                            │
│  ┌─ BrowserWindow ──────────────────────────────────────┐  │
│  │  loadURL('http://192.168.1.100:3456')               │  │
│  │  远程 MindOS 的 Next.js UI（与浏览器访问相同）         │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                            │
│  无子进程（服务在远程）                                      │
│                                                            │
│  Tray + IPC + Auto-Updater + Shortcuts                     │
│  + Connection Monitor（断线检测 + 自动重连）                │
└────────────────────────────────────────────────────────────┘
```

### 启动流程

```
app.whenReady()
  │
  ├─ 1. 读取 ~/.mindos/config.json
  │     └─ 不存在 → 首次启动引导
  │
  ├─ 2. 判断运行模式
  │     ├─ config.desktopMode = 'local' → 本地模式流程
  │     ├─ config.desktopMode = 'remote' → 远程模式流程
  │     └─ 无 desktopMode → 首次选择
  │         ┌─────────────────────────────────────┐
  │         │  How would you like to use MindOS?   │
  │         │                                      │
  │         │  ⚡ Local                             │
  │         │     Run on this machine              │
  │         │                                      │
  │         │  🌐 Remote                           │
  │         │     Connect to a MindOS server       │
  │         └─────────────────────────────────────┘
  │
  ├─ [本地模式]
  │   ├─ 3a. 检测 CLI 冲突（mindos.pid）
  │   │   ├─ 进程存活 → [连接到现有] / [关闭并接管]
  │   │   └─ 无/残留 → 继续
  │   ├─ 4a. 检测端口 → 被占则自动递增
  │   ├─ 5a. 检测 Next.js 构建 → 无则 build（splash screen）
  │   ├─ 6a. spawn MCP + Next.js 子进程
  │   ├─ 7a. 等待 /api/health 200（最多 120s）
  │   └─ 8a. BrowserWindow → loadURL('http://127.0.0.1:{port}')
  │
  ├─ [远程模式]
  │   ├─ 3b. 有保存的 activeConnection？
  │   │   ├─ 有 → 静默 testConnection(address)
  │   │   │   ├─ online → loadURL(address)
  │   │   │   └─ offline → 显示连接窗口
  │   │   └─ 无 → 显示连接窗口
  │   ├─ 4b. 连接窗口：地址 + 测试 + 密码 + 连接
  │   └─ 5b. 成功 → BrowserWindow → loadURL(remoteAddress)
  │
  └─ 9. 创建 Tray + 注册全局快捷键
```

### 远程模式连接窗口

```
┌──────────────────────────────────────────────────────┐
│                                                      │
│        ∞  MindOS                                     │
│        Connect to your server                        │
│                                                      │
│  ┌── Recent Servers ──────────────────────────────┐  │
│  │  🟢 Home NAS                                   │  │
│  │     192.168.1.100:3456 · 2 hours ago           │  │
│  │                                    [Connect]   │  │
│  │                                                │  │
│  │  ⚪ Cloud Server                               │  │
│  │     mindos.example.com:3456 · 1 day ago        │  │
│  │                                    [Connect]   │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
│  ── or connect to a new server ──                    │
│                                                      │
│  Server Address                                      │
│  ┌────────────────────────────────────────────────┐  │
│  │ http://                                        │  │
│  └────────────────────────────────────────────────┘  │
│                           [Test Connection]          │
│                                                      │
│  ✓ Online · MindOS v0.5.28 · Password required      │
│                                                      │
│  Password                                            │
│  ┌────────────────────────────────────────────────┐  │
│  │ ••••••••                                   👁  │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
│  ┌────────────────────────────────────────────────┐  │
│  │                 🔗 Connect                     │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
│  💡 Find your server address and password in         │
│     MindOS Settings on the host machine.             │
│                                                      │
│  ┌────────────────────────────────────────────────┐  │
│  │  ← Switch to Local mode                       │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
└──────────────────────────────────────────────────────┘
```

### 退出流程

```
用户关闭窗口 / app.quit()
  │
  ├─ 关窗口 → 最小化到托盘（后台运行）
  ├─ macOS ⌘Q → 最小化到托盘
  ├─ 托盘菜单 Quit → 真正退出
  │
  └─ 真正退出：
       ├─ [本地] SIGTERM → 子进程（5s 超时后 SIGKILL）
       ├─ [远程] 无子进程需清理
       ├─ 保存窗口状态到 userData
       └─ app.exit(0)
```

### IPC 通信

```
Main Process                    Renderer (BrowserWindow)
     │                                │
     │  ← 'get-app-info'             │  版本号、平台、模式
     │  → { version, platform, mode } │
     │                                │
     │  ← 'check-update'             │  手动检查更新
     │  → ipc: 'update-available'     │  推送更新
     │  → ipc: 'update-progress'      │  下载进度
     │  ← 'install-update'           │  确认安装
     │                                │
     │  → 'server-status'            │  [本地] 服务状态变化
     │  → 'connection-lost'          │  [远程] 连接断开
     │  → 'connection-restored'      │  [远程] 连接恢复
     │                                │
     │  ← 'open-mindroot'            │  [本地] Finder 打开知识库
     │  ← 'switch-mode'              │  切换本地/远程
     │  ← 'disconnect'               │  [远程] 断开当前连接
```

## 方案

### 项目结构

```
sop_note/
├── desktop/                          # Electron 层
│   ├── package.json
│   ├── tsconfig.json
│   ├── electron-builder.yml
│   ├── src/
│   │   ├── main.ts                   # Main process entry
│   │   ├── preload.ts                # Context bridge
│   │   ├── tray.ts                   # 系统托盘（模式感知）
│   │   ├── updater.ts                # 自动更新
│   │   ├── process-manager.ts        # [本地] 子进程管理
│   │   ├── port-finder.ts            # [本地] 端口检测
│   │   ├── connect-window.ts         # [远程] 连接配置窗口
│   │   ├── connection-monitor.ts     # [远程] 断线检测 + 自动重连
│   │   ├── window-state.ts           # 窗口状态持久化
│   │   ├── shortcuts.ts              # 全局快捷键
│   │   ├── splash.html               # 构建中 splash screen
│   │   └── icons/
│   │       ├── icon.icns / icon.ico / icon.png
│   └── scripts/
│       └── build-app.js
├── shared/                           # 跨平台连接 SDK
│   ├── connection.ts                 # testConnection + normalizeAddress
│   ├── connection-store.ts           # 存储抽象层（可插拔后端）
│   └── tsconfig.json
├── app/                              # 不改动（除 CORS 增强）
├── mcp/                              # 不改动
├── bin/                              # 不改动
└── package.json                      # workspaces: desktop, shared
```

### Part A: 服务端增强（为远程模式铺路）

#### `/api/health` 增强

```typescript
// 现在: { ok: true, service: 'mindos' }
// 改为:
{
  ok: true,
  service: 'mindos',
  version: '0.5.28',          // package.json
  authRequired: boolean,      // WEB_PASSWORD 是否设置
}
```

CORS headers（只在 health 和 auth 上）：

```typescript
// /api/health — 公开信息，用 * 即可
const HEALTH_CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// /api/auth — 需要 Set-Cookie，必须动态 Origin
function getAuthCors(req: NextRequest) {
  const origin = req.headers.get('origin') ?? '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Credentials': 'true',
  };
}
```

> **为什么分开**：CORS 规范不允许 `Origin: *` 和 `Credentials: true` 同时存在。health 不设 cookie 用 `*`；auth 设 cookie 用动态 Origin echo。

OPTIONS preflight handler：

```typescript
// health/route.ts + auth/route.ts 各加一个
export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
```

#### `/login` 增强

mount 时 `fetch('/api/health')` → 显示 "✓ Online · v0.5.28"。same-origin 调用，无 CORS 问题。新增引导文案。

### Part B: 共享连接 SDK (`shared/`)

#### `shared/connection.ts`

```typescript
export interface HealthCheckResult {
  status: 'online' | 'offline' | 'not-mindos' | 'error';
  version?: string;
  authRequired?: boolean;
  error?: string;
}

export interface SavedConnection {
  address: string;              // http://192.168.1.100:3456
  label?: string;               // 用户自定义
  lastConnected: string;        // ISO 8601
  authMethod: 'password' | 'token';
}

/** 规范化地址：去尾 /，补 http:// */
export function normalizeAddress(input: string): string {
  let addr = input.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//.test(addr)) addr = `http://${addr}`;
  return addr;
}

/** 测试连接，5s 超时 */
export async function testConnection(address: string): Promise<HealthCheckResult> {
  const url = normalizeAddress(address);
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(`${url}/api/health`, { signal: ctrl.signal, cache: 'no-store' });
    clearTimeout(timer);
    if (!res.ok) return { status: 'error', error: `HTTP ${res.status}` };
    const data = await res.json();
    if (data.ok !== true || data.service !== 'mindos') return { status: 'not-mindos' };
    return { status: 'online', version: data.version, authRequired: data.authRequired };
  } catch (err) {
    const msg = err instanceof DOMException && err.name === 'AbortError'
      ? 'Connection timed out' : 'Connection refused';
    return { status: 'offline', error: msg };
  }
}
```

零依赖、零 DOM——只用 `fetch`（浏览器、Node 22+、Electron、Capacitor 都有）。

#### `shared/connection-store.ts`

```typescript
/** 可插拔存储后端 */
export interface ConnectionStorage {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export const browserStorage: ConnectionStorage = { /* localStorage */ };
// Electron main process 注入 electron-store 实现

export function createConnectionStore(storage: ConnectionStorage) {
  return {
    getConnections(): SavedConnection[] { /* 按 lastConnected 降序 */ },
    saveConnection(conn: SavedConnection): void { /* 最多 5 个 */ },
    removeConnection(address: string): void { /* ... */ },
    getActiveConnection(): string | null { /* ... */ },
    setActiveConnection(address: string): void { /* ... */ },
  };
}
```

### Part C: Electron 本地模式

#### Process Manager

```typescript
class ProcessManager extends EventEmitter {
  private webProcess: ChildProcess | null = null;
  private mcpProcess: ChildProcess | null = null;

  async start(opts: { webPort, mcpPort, mindRoot, authToken?, verbose? }): Promise<void>;
  async stop(): Promise<void>;       // SIGTERM → 5s → SIGKILL
  async restart(opts): Promise<void>;
  private async waitForReady(port, path, timeoutMs): Promise<boolean>;
  private handleCrash(which: 'web' | 'mcp'): void; // 最多 3 次

  // Events: 'ready' | 'error' | 'crash' | 'status-change'
}
```

复用 `bin/lib/config.js` 配置加载 + `bin/lib/mcp-spawn.js` 环境变量组装。

CLI 冲突检测：检查 `~/.mindos/mindos.pid` → [连接现有] / [接管]。

#### Node.js 运行时

```typescript
function getNodePath(): string {
  // 优先系统 node（用户是开发者，99% 已安装）
  const systemNode = which.sync('node', { nothrow: true });
  if (systemNode) return systemNode;
  throw new Error('Node.js ≥20 required');
}
```

> MindOS 目标用户是开发者，依赖系统 Node 合理，且包体减少 60-80MB。

### Part D: Electron 远程模式

#### 连接窗口 (`connect-window.ts`)

加载本地 HTML 页面，内嵌 React 组件（从 `shared/` import），提供：
- 服务器地址输入 + 测试连接
- 最近连接列表（electron-store 持久化）
- 密码输入
- 模式切换入口

连接成功后 `resolve(address)`，main.ts 用 `mainWindow.loadURL(address)` 跳转。

#### 断线检测 (`connection-monitor.ts`)

```typescript
class ConnectionMonitor {
  private interval: NodeJS.Timeout | null = null;

  /** 每 30s ping /api/health */
  start(address: string, onLost: () => void, onRestored: () => void): void;
  stop(): void;
}
```

断线时：
1. IPC 通知 renderer → 显示 "Connection lost" banner
2. 自动重试（1s, 3s, 10s, 30s 间隔递增）
3. 恢复后自动刷新页面

#### 配置扩展

`~/.mindos/config.json` 新增：

```json
{
  "desktopMode": "local",                    // "local" | "remote"
  "remoteConnections": [                     // 远程模式最近连接
    { "address": "http://...", "label": "..." }
  ],
  "remoteActiveConnection": "http://..."     // 远程模式上次连接
}
```

### Part E: 系统托盘（模式感知）

```
本地模式：                           远程模式：
  🟢 MindOS Running                   🟢 MindOS Connected
  ─────────────                        ─────────────
  Open MindOS      ⌘+Shift+M          Open MindOS      ⌘+Shift+M
  ─────────────                        ─────────────
  Web    ● port 3456                   Server  192.168.1.100:3456
  MCP    ● port 8781                   ─────────────
  ─────────────                        Switch Server...
  Open KB in Finder                    Disconnect
  Restart Services                     ─────────────
  ─────────────                        Switch to Local
  Switch to Remote                     ─────────────
  ─────────────
  Settings · Updates · Quit            Settings · Updates · Quit
```

### Part F: 自动更新

```yaml
# electron-builder.yml
publish:
  provider: github
  owner: AIMindOS
  repo: mindos-desktop
```

策略：启动时静默检查 → 托盘角标通知 → 用户手动安装。不自动安装。

### Part G: 打包与分发

```yaml
# desktop/electron-builder.yml
appId: com.mindos.desktop
productName: MindOS

files:
  - "dist-electron/**/*"
  - "../app/.next/**/*"
  - "../app/public/**/*"
  - "../app/package.json"
  - "../app/node_modules/**/*"
  - "../mcp/src/**/*"
  - "../mcp/package.json"
  - "../mcp/node_modules/**/*"
  - "../shared/**/*"
  - "../bin/**/*"
  - "../templates/**/*"
  - "../skills/**/*"
  - "../scripts/**/*"
  - "!**/node_modules/.cache"
  - "!**/__tests__/**"

mac:
  category: public.app-category.productivity
  icon: src/icons/icon.icns
  target:
    - target: dmg
      arch: [x64, arm64]
    - target: zip
      arch: [x64, arm64]
  hardenedRuntime: true

win:
  icon: src/icons/icon.ico
  target:
    - target: nsis
      arch: [x64, arm64]
  nsis: { oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true }

linux:
  icon: src/icons/icon.png
  target: [AppImage, deb]
  category: Office
```

预期包体：

| 组件 | 大小 |
|------|------|
| Electron 框架 | ~120MB |
| Next.js 构建产物 | ~30MB |
| node_modules (pruned) | ~80MB |
| MCP + bin + shared + templates | ~10MB |
| **安装后** | **~240MB** |
| **DMG/Installer** | **~90-120MB** |

### Part H: 平台特定

| 平台 | 适配 |
|------|------|
| macOS | `titleBarStyle: 'hiddenInset'`，Dock 角标，Universal Binary |
| Windows | 原生标题栏，Jump List，开机自启 |
| Linux | AppImage，XDG 图标，Wayland |

### 技术选型

| 依赖 | 版本 | 用途 |
|------|------|------|
| electron | ^33 | 运行时 |
| electron-builder | ^25 | 打包 + 签名 + 分发 |
| electron-updater | ^6 | 自动更新 |
| electron-vite | ^3 | 开发构建工具 |
| electron-store | ^10 | 窗口状态 + 远程连接持久化 |

### 开发工作流

```json
{
  "dev": "electron-vite dev",
  "build": "electron-vite build",
  "dist:mac": "electron-builder --mac",
  "dist:win": "electron-builder --win",
  "dist:linux": "electron-builder --linux"
}
```

联调：Electron loadURL localhost，Next.js `npm run dev`（HMR）。
远程模式联调：另一台机器跑 `mindos start`，Electron 连接其 IP。

## 影响范围

### 新增

| 文件/目录 | 说明 |
|-----------|------|
| `desktop/` | Electron 层（~12 个源文件） |
| `shared/` | 连接 SDK（3 个文件） |
| `.github/workflows/build-desktop.yml` | CI 多平台构建 |

### 修改

| 文件 | 改动 |
|------|------|
| `app/app/api/health/route.ts` | +version +authRequired +CORS +OPTIONS |
| `app/app/api/auth/route.ts` | +CORS headers +OPTIONS |
| `app/app/login/page.tsx` | +server status 显示 +引导文案 |
| `app/lib/i18n-en.ts` | login 新增 ~5 个 key |
| `app/lib/i18n-zh.ts` | 对应中文 |
| `package.json` (root) | workspaces 新增 desktop, shared |
| `.gitignore` | desktop/dist/, desktop/dist-electron/ |

### 不改动

| 模块 | 原因 |
|------|------|
| `app/` (除上述 3 文件) | loadURL 加载，零改动 |
| `proxy.ts` | health/auth 已在白名单；本地模式是 same-origin |
| `mcp/` | 子进程运行，不变 |
| `bin/` (CLI) | 继续独立可用 |

### 与 Phase 2（Capacitor）的关系

Phase 2 直接复用：
- `shared/connection.ts` + `connection-store.ts`（import 即用）
- `/api/health` CORS + `/api/auth` CORS（已就绪）
- `/login` 增强（远程浏览器用户已受益）

Phase 2 只需新增 `mobile/` 目录（Capacitor 项目），零服务端改动。

## 边界 case 与风险

| # | 场景 | 处理 |
|---|------|------|
| 1 | [本地] CLI 和 Electron 同时运行 | PID 检测 → [连接现有] / [接管] |
| 2 | [本地] 首次需 next build | Splash screen + 托盘 🟡 |
| 3 | [本地] 子进程崩溃 | 重启最多 3 次，间隔 1s/3s/10s |
| 4 | [本地] 端口被占 | 自动递增 |
| 5 | [本地] 系统无 Node.js | 弹框引导安装 |
| 6 | [远程] 服务器断线 | ConnectionMonitor 检测 → banner 提示 → 自动重连 |
| 7 | [远程] 服务器重启换端口 | 重连失败 → 回到连接窗口 |
| 8 | [远程] 密码错误 | 显示"密码错误"，不跳转 |
| 9 | [远程] 服务器非 MindOS | testConnection 返回 not-mindos → 提示 |
| 10 | [远程] CORS preflight 被防火墙拦截 | testConnection 返回 offline，用户排查网络 |
| 11 | 模式切换 | 托盘 "Switch to Remote/Local" → 重启流程 |
| 12 | macOS ⌘W vs ⌘Q | ⌘W 隐藏（后台），托盘 Quit 才真退 |
| 13 | 更新期间编辑 | 不自动安装 |
| 14 | 路径含空格/中文 | resolve() |
| 15 | CORS `*` + credentials | health 用 `*`，auth 用动态 Origin echo |

### 风险

| 风险 | 等级 | 缓解 |
|------|------|------|
| Electron 内置 Node 跑 next start 不兼容 | 高 | Day 1 验证，不兼容用系统 Node |
| 包体 >150MB | 中 | asar 压缩 + prune |
| macOS 签名/公证 | 中 | 先 ad-hoc，正式发布再申请 |
| 远程模式 cookie 跨域被 Safari ITP 拦截 | 中 | Electron 用自己的 Chromium，不受 Safari 影响 |
| CORS 开放被利用做内网扫描 | 低 | 只暴露版本号 + 是否需密码 |

## 验收标准

### 本地模式

- [ ] `cd desktop && npm run dev` 启动，加载 localhost 正常显示
- [ ] Next.js + MCP 子进程由 main process 管理
- [ ] 关窗口 → 子进程正确终止
- [ ] 窗口位置/尺寸重启后恢复
- [ ] 检测到 CLI 运行 → [连接] / [接管]
- [ ] CLI 迁移 → 配置和知识库无缝继承

### 远程模式

- [ ] 首次启动 → 模式选择对话框
- [ ] 选 Remote → 连接窗口 → 输入地址 → 测试 → 密码 → 进入
- [ ] 最近连接列表正确，可一键重连
- [ ] 服务器断线 → banner 提示 + 自动重连
- [ ] 服务器恢复 → 自动刷新
- [ ] 从跨域 Electron 窗口 fetch /api/health 成功（CORS）
- [ ] 跨域 POST /api/auth + Set-Cookie 正常工作

### 系统集成

- [ ] 托盘图标正确（🟢/🟡/🔴），菜单根据模式切换
- [ ] 全局快捷键 ⌘+Shift+M
- [ ] macOS ⌘W 隐藏不退出
- [ ] 模式切换可用（托盘 / Settings）

### 打包

- [ ] `dist:mac` → .dmg 可用
- [ ] `dist:win` → .exe 可用
- [ ] `dist:linux` → .AppImage 可用
- [ ] 安装器 < 150MB

### 服务端增强

- [ ] GET /api/health 返回 version + authRequired + CORS
- [ ] OPTIONS /api/health 返回 204
- [ ] OPTIONS /api/auth 返回 204 + CORS
- [ ] /login 显示 "✓ Online · vX.X.X"
- [ ] 现有认证流程不受影响

### 连接 SDK

- [ ] testConnection 三种状态正确（online/offline/not-mindos）
- [ ] normalizeAddress 处理无协议、尾斜杠、IPv6
- [ ] 连接存储 CRUD + 5 个上限

### 全局

- [ ] vitest 通过
- [ ] tsc --noEmit 无新增错误
- [ ] 三平台手动测试核心流程
- [ ] 开机自启可启用/禁用
- [ ] 自动更新可用

## 开发路线（~10d）

| 步骤 | 内容 | 预估 |
|------|------|------|
| 1 | 项目结构 + 依赖 + **验证 Node.js 兼容性** | 1d |
| 2 | main.ts + process-manager + BrowserWindow（本地模式可用） | 2d |
| 3 | 服务端增强（health CORS + auth CORS + login）+ shared/ SDK | 1d |
| 4 | 连接窗口 + 断线检测（远程模式可用） | 1.5d |
| 5 | 打包配置 + CI workflow | 1.5d |
| 6 | 系统托盘 + 快捷键 + 窗口状态 + 自动更新 | 1.5d |
| 7 | 平台适配 + 测试 | 1.5d |

执行顺序：1 → 2（本地先跑通）→ 3 → 4（远程跑通）→ 5（先能打包）→ 6 → 7
