# Spec: 标准化远程连接流程（Remote Connect Flow）

## 目标

为 Capacitor 移动端和 Electron 远程模式提供统一的连接配置基础设施（服务器发现 → 认证 → 进入应用），同时增强现有 Web 端的登录体验。

## 现状分析

### 当前认证架构（双层模型）

```
                    ┌─ Web UI 保护 ─────────────────────┐
                    │  WEB_PASSWORD → JWT cookie (7 天)  │
                    │  /login 页面 → POST /api/auth      │
                    └───────────────────────────────────┘

                    ┌─ API 保护 ────────────────────────┐
                    │  AUTH_TOKEN → Bearer header         │
                    │  same-origin 浏览器请求豁免          │
                    └───────────────────────────────────┘
```

### 问题

1. **Capacitor/Electron 没有连接入口**：原生壳需要一个"输入服务器地址"的本地 UI，但没有可复用的连接逻辑
2. **`/login` 缺少服务器状态**：密码页不显示服务器版本和连接状态，用户不知道服务是否在线
3. **`/api/health` 返回信息太少**：只有 `{ ok: true, service: 'mindos' }`，客户端无法做智能判断
4. **无 CORS 支持**：Capacitor/Electron 做跨域 health check 会被拦截
5. **没有连接记忆**：用户每次手动输入地址，无"最近连接"

### 关键架构约束

**`/connect` 不能是 Next.js 服务端页面**，原因：

- 鸡生蛋：要访问 `/connect` 需要已知服务器地址，但 `/connect` 的目的就是配置地址
- 跨域：从服务器 A 的页面 fetch 服务器 B 的 `/api/health` 会被浏览器 CORS 拦截
- 不必要：浏览器用户在地址栏输入 URL 就是"连接"，不需要额外页面

**连接配置 UI 属于客户端本地页面**（Capacitor bundled HTML / Electron 本地窗口），不属于 Next.js App。

## 数据流 / 状态流

### 三类客户端的连接流程

```
┌─ 浏览器用户（手机 / 桌面）──────────────────────────┐
│                                                      │
│  地址栏输入 http://192.168.1.100:3456               │
│    │                                                 │
│    ├─ 无密码 → 直接进入应用                            │
│    └─ 有密码 → proxy.ts 重定向到 /login               │
│         └─ /login（增强版）：                          │
│             ├─ 显示服务器状态（版本、在线状态）          │
│             ├─ 输入密码 → POST /api/auth              │
│             └─ 成功 → JWT cookie → 进入应用           │
│                                                      │
│  ※ 不需要 /connect 页面                              │
└──────────────────────────────────────────────────────┘

┌─ Capacitor App（iOS / Android）──────────────────────┐
│                                                      │
│  App 启动 → 加载 bundled connect.html（本地页面）     │
│    │                                                 │
│    ├─ 有保存的连接？                                  │
│    │   ├─ 有 → 静默 health check                     │
│    │   │   ├─ 在线 + cookie 有效 → WebView 跳转      │
│    │   │   ├─ 在线 + cookie 过期 → 显示密码输入       │
│    │   │   └─ 离线 → 显示"服务器不可达"               │
│    │   └─ 无 → 显示连接配置表单                       │
│    │                                                 │
│    ├─ 输入地址 → testConnection() → /api/health      │
│    │   （Capacitor WebView 无 CORS 限制）             │
│    │                                                 │
│    ├─ 输入密码 → POST {address}/api/auth              │
│    │   （需要服务器返回 CORS headers）                 │
│    │                                                 │
│    └─ 成功 → 保存连接 → WebView.loadURL(address)     │
│                                                      │
│  连接配置页是 App 内 bundled 的本地 HTML              │
│  不是 Next.js 页面                                    │
└──────────────────────────────────────────────────────┘

┌─ Electron 远程模式 ─────────────────────────────────┐
│                                                      │
│  与 Capacitor 相同逻辑，但 UI 在 Electron 本地窗口    │
│  BrowserWindow 加载本地 connect.html                  │
│  连接成功后 → loadURL(address) 切换到远程服务器        │
│                                                      │
└──────────────────────────────────────────────────────┘
```

### 模块分层

```
┌─ Layer 1: 服务端增强（本 spec 范围）────────────────┐
│                                                      │
│  /api/health     增强返回 version + authRequired     │
│                  + CORS headers（供客户端跨域调用）    │
│                                                      │
│  /api/auth       CORS headers（POST 跨域登录）       │
│                                                      │
│  /login          增强 UI：显示服务器状态 + 版本        │
│                                                      │
└──────────────────────────────────────────────────────┘

┌─ Layer 2: 共享连接 SDK（本 spec 范围）──────────────┐
│                                                      │
│  lib/connection.ts    纯 TypeScript，零 DOM 依赖     │
│    ├── testConnection(address) → HealthCheckResult   │
│    ├── normalizeAddress(input) → string              │
│    └── types: SavedConnection, HealthCheckResult     │
│                                                      │
│  lib/connection-store.ts    localStorage CRUD        │
│    ├── getConnections() → SavedConnection[]          │
│    ├── saveConnection(conn)                          │
│    ├── removeConnection(address)                     │
│    └── getActiveConnection() / setActiveConnection() │
│                                                      │
│  ※ 可被 Capacitor / Electron / 浏览器 import        │
└──────────────────────────────────────────────────────┘

┌─ Layer 3: 客户端 UI（后续 spec 范围）───────────────┐
│                                                      │
│  Capacitor:  bundled connect.html + React 组件       │
│  Electron:   本地 BrowserWindow + React 组件          │
│                                                      │
│  ※ 本 spec 不实现，只提供 Layer 1 + 2 基础设施      │
└──────────────────────────────────────────────────────┘
```

## 方案

### Part A: `/api/health` 增强

```typescript
// 现在
{ ok: true, service: 'mindos' }

// 改为
{
  ok: true,
  service: 'mindos',
  version: '0.5.28',          // 来自 package.json
  authRequired: boolean,      // WEB_PASSWORD 是否设置
}
```

CORS headers（只在 `/api/health` 和 `/api/auth` 上）：

```typescript
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',          // 任意来源（health 是公开信息）
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Credentials': 'true',
};
```

**为什么 CORS `*` 是安全的**：
- `/api/health` 只返回公开信息（版本号、是否需密码），无敏感数据
- `/api/auth` 虽然接受密码，但需要正确密码才返回 cookie；CORS 只是允许发请求，不降低安全性
- 其他 API 不加 CORS headers，保持现有安全模型

需要处理 **OPTIONS preflight**：

```typescript
// health/route.ts
export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

// auth/route.ts
export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
```

### Part B: `/login` 增强

在现有密码输入之上，增加服务器状态显示：

```
┌──────────────────────────────────────────┐
│                                          │
│        ∞  MindOS                         │
│        You think here, Agents act there. │
│                                          │
│   ┌─ Server Status ───────────────────┐  │
│   │  ✓ Online · v0.5.28              │  │  ← 新增
│   └───────────────────────────────────┘  │
│                                          │
│   Password                               │
│   ┌──────────────────────────────────┐   │
│   │ ••••••••                     👁  │   │
│   └──────────────────────────────────┘   │
│                                          │
│   ┌──────────────────────────────────┐   │
│   │           🔒 Sign in             │   │
│   └──────────────────────────────────┘   │
│                                          │
│   💡 Set password in Settings on the     │  ← 新增
│      host machine.                       │
│                                          │
└──────────────────────────────────────────┘
```

实现：`/login` 页面 mount 时调用 `/api/health`，显示版本号。这是 same-origin 调用，无 CORS 问题。

### Part C: 共享连接 SDK

#### `lib/connection.ts`

```typescript
/** 健康检查结果 */
export interface HealthCheckResult {
  status: 'online' | 'offline' | 'not-mindos' | 'error';
  version?: string;
  authRequired?: boolean;
  error?: string;
}

/** 保存的连接记录 */
export interface SavedConnection {
  address: string;              // http://192.168.1.100:3456
  label?: string;               // 用户自定义标签
  lastConnected: string;        // ISO 8601
  authMethod: 'password' | 'token';
}

/**
 * 规范化服务器地址
 * - 去尾部 /
 * - 补 http:// 前缀
 * - 不改动 https://
 */
export function normalizeAddress(input: string): string;

/**
 * 测试连接：GET {address}/api/health
 * 5 秒超时
 */
export async function testConnection(address: string): Promise<HealthCheckResult>;
```

**零依赖、零 DOM**——纯 TypeScript，可在 Node.js（Electron main process）、浏览器（Capacitor WebView）、或 Next.js 中使用。

#### `lib/connection-store.ts`

```typescript
import type { SavedConnection } from './connection';

const STORAGE_KEY = 'mindos:connections';
const ACTIVE_KEY = 'mindos:activeConnection';
const MAX_CONNECTIONS = 5;

/** 读取所有保存的连接（按 lastConnected 降序） */
export function getConnections(): SavedConnection[];

/** 保存/更新连接（地址相同则更新时间戳） */
export function saveConnection(conn: SavedConnection): void;

/** 删除 */
export function removeConnection(address: string): void;

/** 当前活跃连接 */
export function getActiveConnection(): string | null;
export function setActiveConnection(address: string): void;
```

依赖 `localStorage`——浏览器和 Capacitor WebView 都有；Electron renderer 也有。Electron main process 不用这个（用 `electron-store` 或文件）。

### Part D: proxy.ts CORS 放行

`/api/health` 和 `/api/auth` 已在 proxy.ts 白名单中（health 无需认证，auth 自己处理认证）。不需要改 proxy.ts。

但需要确认：Capacitor WebView 发跨域 POST `/api/auth` 时，浏览器会先发 OPTIONS preflight。当前 Next.js 没有处理 OPTIONS → 返回 405。需要在 `auth/route.ts` 加 OPTIONS handler。

### 文件清单

#### 新增文件

| 文件 | 说明 |
|------|------|
| `app/lib/connection.ts` | 连接 SDK：testConnection + normalizeAddress + types |
| `app/lib/connection-store.ts` | localStorage CRUD：最近连接管理 |

#### 修改文件

| 文件 | 改动 |
|------|------|
| `app/app/api/health/route.ts` | 返回 version + authRequired + CORS headers + OPTIONS handler |
| `app/app/api/auth/route.ts` | CORS headers + OPTIONS handler |
| `app/app/login/page.tsx` | 新增 server status 显示（调 /api/health） |
| `app/lib/i18n-en.ts` | login section 新增 serverOnline / serverVersion / hint 等 key |
| `app/lib/i18n-zh.ts` | 对应中文 |

#### 不改动

| 模块 | 原因 |
|------|------|
| `proxy.ts` | `/api/health` 和 `/api/auth` 已在白名单，无需改 |
| MCP server | 不涉及 |
| CLI | 不涉及 |

## 影响范围

### 对后续 Phase 的关系

| Phase | 使用什么 |
|-------|---------|
| **Capacitor App** | import `connection.ts` + `connection-store.ts`，在 bundled 本地页面中使用 |
| **Electron 远程模式** | 同上，在 Electron 本地窗口中使用 |
| **Electron 本地模式** | 不用连接 SDK——自己 spawn 服务 |
| **PWA** | 不用连接 SDK——用户在浏览器地址栏输入 URL |
| **浏览器远程用户** | 受益于增强的 `/login`（显示版本 + 状态） |

### 不做什么（明确排除）

1. **不新增 `/connect` Next.js 页面**——架构上不成立（鸡生蛋 + CORS）
2. **不做多服务器管理 UI**——那是 Capacitor/Electron 本地 UI 的事，不属于服务端
3. **不改认证模型**——双层认证（WEB_PASSWORD + AUTH_TOKEN）保持不变
4. **不给所有 API 加 CORS**——只有 `/api/health` 和 `/api/auth` 需要，其他保持 same-origin only

## 边界 case 与风险

| # | 场景 | 处理 |
|---|------|------|
| 1 | 地址没有 `http://` 前缀 | `normalizeAddress()` 自动补 `http://` |
| 2 | 地址有尾部斜杠 | 去除尾部 `/` |
| 3 | 服务器在线但不是 MindOS | `/api/health` 返回的 JSON 没有 `service: 'mindos'` → 返回 `not-mindos` |
| 4 | health check 超时（网络差） | 5 秒 AbortController 超时 → 返回 `offline` |
| 5 | IPv6 地址 `[::1]:3456` | `normalizeAddress()` 保留 `[]` 格式 |
| 6 | HTTPS 反向代理 | 保留 `https://` 前缀，不强制改成 `http://` |
| 7 | CORS preflight 被防火墙拦截 | health 加了 OPTIONS handler；如果网络层拦截，testConnection 返回 `offline`，用户排查网络 |
| 8 | localStorage 被清除 | 最近连接列表丢失 → 重新输入地址（不影响认证） |
| 9 | `/api/health` CORS `*` 暴露版本号 | 版本号不敏感；health 端点本就公开（proxy.ts 白名单） |
| 10 | Capacitor WKWebView cookie 行为不同 | `@capacitor/cookies` 插件处理（Capacitor phase 解决） |

### 风险

| 风险 | 等级 | 缓解 |
|------|------|------|
| CORS `*` 被利用做服务发现（扫描内网 MindOS 实例） | 低 | 只暴露版本号和是否需密码，无敏感信息；attacker 已知地址才能调用 |
| `/api/auth` CORS 允许跨域登录尝试 | 低 | 密码验证逻辑不变，CORS 只是允许浏览器发请求，不降低安全性；未来可加 rate limit |
| `login` 显示版本号 → 版本嗅探 | 低 | MindOS 是开源项目，版本号本身不构成安全风险 |

## 验收标准

### `/api/health` 增强

- [ ] GET `/api/health` 返回 `{ ok, service, version, authRequired }`
- [ ] `version` 与 `package.json` 一致
- [ ] `authRequired` 正确反映 `WEB_PASSWORD` 是否设置
- [ ] 响应包含 CORS headers（`Access-Control-Allow-Origin: *`）
- [ ] OPTIONS `/api/health` 返回 204 + CORS headers

### `/api/auth` CORS

- [ ] OPTIONS `/api/auth` 返回 204 + CORS headers
- [ ] POST `/api/auth` 响应包含 CORS headers
- [ ] 认证逻辑不变（正确密码 → 200 + cookie，错误密码 → 401）

### `/login` 增强

- [ ] 页面加载时调用 `/api/health`，显示"✓ Online · vX.X.X"
- [ ] health check 失败 → 显示"⚠ Server unreachable"
- [ ] 显示引导文案："Set password in Settings on the host machine"
- [ ] 现有密码登录流程不受影响

### 连接 SDK

- [ ] `testConnection('http://localhost:3456')` 返回 `{ status: 'online', version: '...', authRequired: ... }`
- [ ] `testConnection('http://invalid:9999')` 返回 `{ status: 'offline', error: '...' }`
- [ ] `testConnection('http://google.com')` 返回 `{ status: 'not-mindos' }`
- [ ] `normalizeAddress('192.168.1.100:3456')` 返回 `'http://192.168.1.100:3456'`
- [ ] `normalizeAddress('https://example.com/')` 返回 `'https://example.com'`

### 连接存储

- [ ] `saveConnection()` 写入 localStorage
- [ ] `getConnections()` 按 lastConnected 降序
- [ ] 超过 5 个 → 自动淘汰最旧的
- [ ] `removeConnection()` 删除指定地址

### i18n

- [ ] login 新增文案有 en + zh 翻译
- [ ] 切换语言后显示正确

### 兼容性

- [ ] 本地访问 `localhost:3456` → 不受影响
- [ ] 现有 Agent Bearer token 认证 → 不受影响
- [ ] proxy.ts 不变
