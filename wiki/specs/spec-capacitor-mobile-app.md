# Spec: Capacitor 移动端

> **定位**：Phase 2。依赖 Phase 1（Electron）已完成的服务端 CORS 增强和共享连接 SDK。零服务端改动。

## 目标

用 Capacitor 将 MindOS 包装为 iOS/Android 原生 App，让用户从手机连接到远程 MindOS 服务器。核心体验：打开 App → 连接服务器 → 使用 MindOS（查笔记、AI 对话、搜索）。

## 现状分析

Phase 1（Electron）已完成：
- ✅ `/api/health` 增强（version + authRequired + CORS）
- ✅ `/api/auth` CORS + OPTIONS preflight
- ✅ `shared/connection.ts`（testConnection、normalizeAddress）
- ✅ `shared/connection-store.ts`（可插拔存储）
- ✅ `/login` 增强（server status 显示）

移动端只需：**客户端壳 + 连接 UI + 平台适配**。

## 数据流 / 状态流

### App 启动流程

```
App 启动
  │
  ├─ 有保存的 activeConnection？
  │   ├─ 有 → 静默 testConnection(address)
  │   │   ├─ online + cookie 有效 → 加载远程 MindOS UI
  │   │   ├─ online + cookie 过期 → 密码输入（地址已填充）
  │   │   └─ offline → 连接页 + "服务器不可达"提示
  │   └─ 无 → 显示连接页
  │
  ├─ 连接页（复用 shared/ 的 ConnectPage 组件逻辑）
  │   ├─ 最近连接列表
  │   ├─ 新地址输入 + [测试连接]
  │   │   └─ testConnection() → /api/health
  │   ├─ authRequired → 密码输入
  │   └─ [连接] → POST /api/auth → cookie → 保存
  │
  └─ 连接成功 → window.location.href = remoteAddress
     → 进入 MindOS Next.js UI（远程服务器渲染）
```

### 页面切换

```
本地页面（Capacitor bundled）           远程页面（MindOS 服务器）
┌──────────────────────┐              ┌──────────────────────┐
│  连接配置页            │              │  MindOS UI            │
│  ├── 最近连接          │  ─────────>  │  ├── 文件浏览          │
│  ├── 地址输入          │  连接成功     │  ├── AI 对话           │
│  └── 密码             │              │  └── 搜索/设置         │
└──────────────────────┘              └──────────────────────┘
       Vite build                        Next.js SSR/CSR
       打包在 App 内                      从远程服务器加载
```

## 方案

### 项目结构

```
mobile/
├── package.json
├── capacitor.config.ts
├── vite.config.ts                  # Vite 构建本地页面
├── index.html                      # SPA 入口
├── src/
│   ├── main.tsx                    # React 入口
│   ├── App.tsx                     # 路由：connect ↔ connected
│   ├── connect/
│   │   ├── ConnectPage.tsx         # 主页面
│   │   ├── ServerInput.tsx         # 地址输入 + 测试连接
│   │   └── RecentServers.tsx       # 最近连接列表
│   ├── connected/
│   │   └── ConnectedView.tsx       # 连接成功后状态（可能只是 redirect）
│   └── lib/
│       └── store.ts                # createConnectionStore(browserStorage)
├── ios/                            # capacitor add ios
├── android/                        # capacitor add android
├── resources/
│   ├── icon.png                    # 1024x1024 App 图标
│   └── splash.png                  # 启动画面
└── tsconfig.json
```

### Capacitor 配置

```typescript
// capacitor.config.ts
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.mindos.mobile',
  appName: 'MindOS',
  webDir: 'dist',                   // Vite 构建输出
  // 不设 server.url — 初始加载 bundled 页面
  plugins: {
    SplashScreen: {
      launchAutoHide: false,        // 手动控制（连接后隐藏）
    },
    CapacitorCookies: {
      enabled: true,                // 原生 cookie 管理（绕过 WKWebView 限制）
    },
  },
  ios: {
    allowsLinkPreview: false,
    scrollEnabled: true,
  },
  android: {
    allowMixedContent: true,        // 允许 HTTP（局域网场景）
  },
};
```

### 连接成功后跳转

```typescript
// ConnectPage.tsx 核心逻辑
import { testConnection, normalizeAddress } from 'shared/connection';
import { createConnectionStore, browserStorage } from 'shared/connection-store';

const store = createConnectionStore(browserStorage);

async function handleConnect(address: string, password: string) {
  const url = normalizeAddress(address);

  // 1. 认证
  const res = await fetch(`${url}/api/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
    credentials: 'include',           // 让浏览器接收 Set-Cookie
  });

  if (!res.ok) throw new Error('Incorrect password');

  // 2. 保存连接
  store.saveConnection({
    address: url,
    lastConnected: new Date().toISOString(),
    authMethod: 'password',
  });
  store.setActiveConnection(url);

  // 3. 跳转到远程 MindOS
  window.location.href = url;
}
```

> **关键**：`window.location.href = url` 让 Capacitor WebView 导航到远程服务器。此后 WebView 里跑的就是远程的 Next.js App，和浏览器访问一样。

### 回到连接页

从远程 MindOS 回到连接页的方式：
1. **App 重启**——关闭 App 重新打开，如果之前 cookie 有效则自动重连
2. **手动断开**——MindOS Settings 里加一个"Disconnect"按钮（通过 IPC 或 URL scheme）
3. **Cookie 过期**——7 天后 proxy.ts 重定向到 /login，但不是连接页

简单方案：App 启动时检查 activeConnection，如果 testConnection 失败就回到连接页。不需要从远程 MindOS 内"回退"的复杂逻辑。

### 原生能力（逐步添加）

| 能力 | 插件 | 优先级 |
|------|------|--------|
| Cookie 管理 | `@capacitor/cookies` | P0（认证必须） |
| 状态栏适配 | `@capacitor/status-bar` | P0（安全区域） |
| 闪屏 | `@capacitor/splash-screen` | P1 |
| 推送通知 | `@capacitor/push-notifications` | P2（未来） |
| 生物识别 | `capacitor-native-biometric` | P2（未来） |
| 分享 | `@capacitor/share` | P2（未来） |

### i18n

连接页面的文案直接用 TypeScript 常量（不走 Next.js 的 i18n 系统，因为这是本地页面）：

```typescript
const i18n = {
  en: {
    title: 'Connect to MindOS',
    subtitle: 'Enter your server address',
    recentServers: 'Recent Servers',
    serverAddress: 'Server Address',
    testConnection: 'Test Connection',
    online: 'Online',
    offline: 'Cannot reach server',
    password: 'Password',
    connect: 'Connect',
    hint: 'Find your address in MindOS Settings on the host machine.',
    // ...
  },
  zh: { /* ... */ },
};
```

## 影响范围

### 新增

| 文件/目录 | 说明 |
|-----------|------|
| `mobile/` | 整个 Capacitor 项目 |

### 修改

| 文件 | 改动 |
|------|------|
| `package.json` (root) | workspaces 新增 `mobile` |
| `.gitignore` | 新增 `mobile/ios/`, `mobile/android/`, `mobile/dist/` |

### 不改动

- `app/` — 零改动（CORS 在 Phase 1 已就绪）
- `shared/` — 直接 import，不改
- `desktop/` — 不涉及
- `mcp/`, `bin/` — 不涉及

## 边界 case 与风险

| # | 场景 | 处理 |
|---|------|------|
| 1 | WKWebView cookie 行为不同于 Chrome | `@capacitor/cookies` 原生桥接 |
| 2 | Android HTTP 明文被拦截 | `allowMixedContent: true` + AndroidManifest `cleartextTrafficPermitted` |
| 3 | iOS App Store 审核（无内置内容） | 连接页是内置的；说明为 self-hosted 开发者工具 |
| 4 | 服务器断线（长时间不用） | App 恢复前台时 testConnection → 失败则回连接页 |
| 5 | 横竖屏切换 | MindOS Next.js UI 已有响应式设计 |
| 6 | 安全区域（刘海屏/打孔屏） | `viewport-fit=cover` + `env(safe-area-inset-*)` |
| 7 | 深色模式 | MindOS 已有 dark mode，WebView 自动继承 |
| 8 | 后台 7 天被系统清理 | 不影响——下次打开重新 testConnection |

### 风险

| 风险 | 等级 | 缓解 |
|------|------|------|
| iOS App Store 审核拒绝 | 中 | 内置连接页面有实际内容；README 说明 self-hosted |
| WebView 性能不足 | 低 | MindOS 移动端是阅读+搜索+轻编辑场景 |
| Capacitor 版本升级破坏兼容 | 低 | 锁定大版本，定期升级 |

## 验收标准

- [ ] iOS 模拟器：启动 → 连接页 → 输入地址 → 测试 → 密码 → 进入 MindOS
- [ ] Android 模拟器：同上
- [ ] 最近连接列表正确显示（最多 5 个）
- [ ] App 重启 → 自动连接上次服务器
- [ ] 服务器离线 → 显示错误 + 回到连接页
- [ ] HTTP 局域网地址可正常连接（不被系统安全策略拦截）
- [ ] 安全区域（刘海屏）正确适配
- [ ] 深色/浅色模式正确
- [ ] App 图标和启动画面正确显示
- [ ] 连接页 en + zh 双语

## 开发路线（~5d）

| 步骤 | 内容 | 预估 |
|------|------|------|
| 1 | 项目结构 + Vite 配置 + Capacitor init | 0.5d |
| 2 | 连接页面 UI（import shared/） | 1.5d |
| 3 | iOS 构建 + 模拟器测试 + 平台适配 | 1.5d |
| 4 | Android 构建 + 模拟器测试 + 平台适配 | 1d |
| 5 | 联调 + App Store 准备 | 0.5d |
