# MindOS 开发日志 — 2026-03-12

## 本次完成的主要改动

---

### 1. MCP HTTP Transport 支持

- `mcp/src/index.ts`：默认传输模式从 `stdio` 改为 `http`（Streamable HTTP）
- 新增 `MCP_TRANSPORT`、`MCP_HOST`、`MCP_PORT`、`MCP_ENDPOINT` 配置项
- `mindos mcp` 默认启动 HTTP 服务（端口 8787），无需额外参数
- stdio 模式需显式设置：`MCP_TRANSPORT=stdio mindos mcp`

---

### 2. MCP Server 随 App 自动启动

- `bin/cli.js`：新增 `spawnMcp()` 函数，用 `spawn` 以子进程方式启动 MCP server
- `mindos start` 和 `mindos dev` 现在会同时启动 App + MCP server
- `mindos mcp` 保留，用于单独启动 MCP server

---

### 3. MCP 端口配置化

- `scripts/setup.js`：新增 `mcpPort` 写入 `~/.mindos/config.json`，默认 8787
- `bin/cli.js`：`loadConfig()` 读取 `config.mcpPort` → `MINDOS_MCP_PORT` → `MCP_PORT`
- `app/lib/settings.ts`：`ServerSettings` 新增 `mcpPort?` 字段

---

### 4. AI Provider 多配置支持

**新的 `~/.mindos/config.json` 结构：**

```json
{
  "ai": {
    "provider": "anthropic",
    "providers": {
      "anthropic": { "apiKey": "sk-ant-...", "model": "claude-sonnet-4-6" },
      "openai":    { "apiKey": "sk-...", "model": "gpt-5.4", "baseUrl": "" }
    }
  }
}
```

- 多个 provider 可同时配置，切换只需改 `ai.provider`，无需重新填 API Key
- `baseUrl` 只有 `openai` 有，`anthropic` 不需要
- 旧的 flat format 自动 migrate（`migrateAi()` 函数）

**涉及文件：**
- `app/lib/settings.ts`：新类型 `ProviderConfig` / `AiConfig`，`migrateAi()` 兼容旧格式
- `app/components/settings/types.ts`：`AiSettings` 对应新结构
- `app/app/api/settings/route.ts`：GET/POST 适配新结构，分 provider mask key
- `app/components/settings/AiTab.tsx`：`patchProvider()` 只更新当前 provider
- `app/components/SettingsModal.tsx`：`restoreFromEnv` 用新结构
- `scripts/setup.js`：写入新结构，保留另一个 provider 的已有配置
- `bin/cli.js`：`loadConfig()` 支持新/旧两种格式读取 key
- `app/__tests__/setup.ts`：mock 更新为新 `providers` dict 格式

---

### 5. Setup 流程优化（`mindos onboard`）

- 去掉 `Web port` 和 `MCP port` 问题（默认 3000/8787，不让用户配）
- 去掉 `Startup mode` 问题（默认 `start`，普通用户不需要选）
- `Auth token` 问题移到 AI 配置之前
- `finish()` 输出的 MCP 配置自动带上 `Authorization` header（如果设了 token）

---

### 6. 默认模型更新

- OpenAI 默认模型从 `gpt-4o-mini` 全局更新为 `gpt-5.4`
- 涉及：`README.md`、`README_zh.md`、`scripts/setup.js`、`app/lib/settings.ts`、`app/components/settings/AiTab.tsx`、`app/README.md`、`.env.local.example`、`app/__tests__/setup.ts`

---

### 7. README 中英文更新

**MCP 配置章节重构：**
- 方式 A：本机（stdio 在前 + URL 备选）
- 方式 B：远程 URL（跨设备）
- 说明 MCP 随 `mindos start/dev` 自动启动，无需额外命令
- MCP 端口默认 8787，可通过 `mindos onboard` 修改

**Config Reference 更新：**
- 展示完整 JSON 结构示例
- 字段名更新为 `ai.providers.anthropic.*` / `ai.providers.openai.*`
- 加入 `mcpPort` 字段说明
- 去掉 `startMode` 字段

**Setup 步骤列表更新：**
- 顺序：知识库路径 → 模板语言 → Auth token → AI Provider + Key
- 去掉 port 和 startup mode

**其他：**
- 首次安装改为 `npm install -g mindos@latest`
- Run 章节：`mindos start` 为主，加注"app + MCP 同时启动"
- Common Pitfalls：去掉过时的 `MCP_HOST` 条目

---

### 8. 其他 Bug 修复

- `mcp/README.md`：全面重写，补全环境变量表、更新集成示例
- `mcp/src/index.ts` header 注释：stdio/HTTP 顺序对调，HTTP 标为默认
- `scripts/setup.js`：删除未使用的冗余变量 `const startMode`

---

---

### 9. Web UI 登录密码保护

**新字段 `webPassword`（独立于 `authToken`）：**

- `authToken` = 保护 `/api/*` 和 MCP，供 Agent / MCP 客户端使用（Bearer token）
- `webPassword` = 保护浏览器 UI，设置后访问 `localhost:3000` 需先登录
- 两者完全独立，可只设其中一个，也可都设

**实现方式：**
- `app/middleware.ts`：扩展 matcher 覆盖页面路由，`WEB_PASSWORD` 未设则跳过，设了则检查 `mindos-session` cookie
- Cookie 值为 `SHA-256(WEB_PASSWORD)`，用 `crypto.subtle`（Edge runtime 兼容），有效期 7 天
- `app/app/api/auth/route.ts`：POST 验证密码并 Set-Cookie，DELETE 清除（logout）
- `app/app/login/page.tsx`：风格与 MindOS 一致的登录页（amber 按钮、IBM Plex Mono 标题）
- `app/app/layout.tsx`：通过 middleware 注入的 `x-pathname` header 检测 `/login`，跳过 `SidebarLayout`
- `middleware` 变为 `async` 后，测试需要 `await middleware(...)`

**`scripts/setup.js` 新增 `webPassPrompt` 问题，写入 config。**

---

### 10. 本地开发 `mindos` 命令注册

- clone 源码后 `npm install` 不会自动注册全局命令
- 需要在项目根目录执行 `npm link` 才能使用 `mindos` 命令
- README Option B 已补充此步骤

---

### 11. 用户升级指引

- 老版本：clone 仓库 → 分别 `npm install` → `app/.env.local` 配置 → `cd app && npm run dev`
- 新版本：`npm install -g mindos@latest` → `~/.mindos/config.json` → `mindos start`
- 升级 Prompt 放在 `scripts/upgrade-prompt.md`，引导 Agent 自动完成：读取旧 `.env.local` → 转换格式写入新 config → 启动验证

---

## 关键设计决策

| 决策 | 原因 |
|------|------|
| MCP HTTP 为默认模式 | 更通用，本机和远程都能用，且随 app 自动启动 |
| MCP 随 app 自动启动 | 用户只需一个命令，降低使用门槛 |
| 多 provider 字典结构 | 切换 provider 不用重新填 key，体验更好 |
| 去掉 setup 中的 port/startup mode 问题 | 普通用户不需要关心这些细节，减少摩擦 |
| `baseUrl` 只有 openai 有 | Anthropic 官方无自定义 endpoint 需求 |
| `webPassword` 与 `authToken` 分离 | 两种访问场景（浏览器用户 vs Agent）需求不同，不应共用同一凭据 |
| Cookie 值用 SHA-256 而非明文 | 不把原始密码存入 cookie，且无需数据库，重启后仍有效 |
| middleware 变为 async | Edge runtime 中 `crypto.subtle.digest` 是 async API，必须 await |
| AI 不可用只提示不做连通性检测 | Anthropic/OpenAI 无免费 ping 接口，验证必须消耗 token，提示足够 |
| `AiConfig.providers` 字段改为必填 | `migrateAi()` 保证输出完整，消费方无需 `??` / cast，类型与运行时一致 |

---

## 第二阶段改动（2026-03-12 下午）

### 12. sessions.json 迁移到 ~/.mindos

- `app/app/api/ask-sessions/route.ts`：`STORE_PATH` 从 `app/data/ask-sessions.json` 改为 `~/.mindos/sessions.json`
- 好处：用户数据统一在 `~/.mindos/`，不混入项目目录，npm 包升级不影响历史会话

---

### 13. Next.js 16 middleware → proxy 重命名

- Next.js 16 废弃 `middleware.ts`，改用 `proxy.ts`，导出函数名从 `middleware` 改为 `proxy`
- `app/middleware.ts` → `app/proxy.ts`，`export async function middleware` → `export async function proxy`
- 测试文件 import 改为 `import { proxy as middleware } from '@/proxy'`（别名保持测试内部命名不变）

---

### 14. TypeScript 严格类型修复

**根本原因：** `AiConfig.providers` 里 `anthropic?` / `openai?` 是可选字段，fallback `?? {}` 导致类型为 `ProviderConfig | {}`，访问字段时 TS 报错。

**修法：** 把 `providers.anthropic` / `.openai` 改为必填，在 `migrateAi()` 里用 `parseProvider()` helper 做严格防御——逐字段校验类型，非法值（null、数字、空字符串）用 DEFAULTS 填充。消费方直接访问，无需任何 cast。

```typescript
function parseProvider(raw: unknown, defaults: ProviderConfig): ProviderConfig {
  return {
    apiKey: str(raw, 'apiKey', defaults.apiKey),
    model:  str(raw, 'model',  defaults.model),
    ...
  };
}
```

---

### 15. AI API Key 未配置提示

- `AiTab.tsx`：检测当前 provider 的 apiKey 为空且无 env override 时，底部显示红色警告
- `i18n.ts`：新增 `noApiKey` 中英文文案
- 不做连通性测试（需消耗 token），静态提示足够

---

## 第三阶段改动（2026-03-12 晚）

### 16. proxy.ts x-pathname header 注入修复

**问题：** `proxy.ts` 的 `next()` helper 用 `res.headers.set('x-pathname', ...)` 设置响应 header，但 `headers()` from `next/headers` 读的是**请求** header，导致 `RootLayout` 里 `isLoginPage` 永远是 `false`，登录页也会渲染 SidebarLayout。

**修法：** 改用 `NextResponse.next({ request: { headers: newHeaders } })` 注入到转发请求的 header 中。

```typescript
function next(): NextResponse {
  const newHeaders = new Headers(req.headers);
  newHeaders.set('x-pathname', pathname);
  return NextResponse.next({ request: { headers: newHeaders } });
}
```

---

### 17. API 保护与 webPassword session 打通

**问题：** 用户通过外部 IP 访问时，浏览器 fetch `/api/settings` 的 `Sec-Fetch-Site` 不一定是 `same-origin`（如登录后 redirect），导致被 `AUTH_TOKEN` 拦截返回 401，Settings 页面报"Failed to load settings"。

**修法：** 在 API 保护逻辑里增加 JWT cookie 检查——持有合法 `webPassword` session 的用户直接放行，无需 Bearer token。

```typescript
if (webPassword) {
  const token = req.cookies.get(COOKIE_NAME)?.value ?? '';
  if (token && await verifyJwt(token, webPassword)) return NextResponse.next();
}
```

---

### 18. Settings GUI 新增 webPassword 和 authToken 管理

**webPassword（Knowledge Base tab）：**
- 密码输入框，已设置显示 `••••••••`，点击清空可改新密码
- Show/Hide 切换明文
- 保存后写入 `~/.mindos/config.json`

**authToken（Knowledge Base tab → Security section）：**
- 显示 masked token（首尾各 4 位可见，中间 `••••`）
- 一键复制按钮
- 显示 MCP URL（localhost + 机器 IP 两个版本）
- Regenerate：调 `POST /api/settings/reset-token` 生成新 token，新 token 明文展示一次并提示"copy now"
- Clear：清除 token（API 变为开放）

**新增接口：**
- `GET /api/settings`：返回 `authToken`（masked）、`mcpPort`、`webPassword`（masked）
- `POST /api/settings/reset-token`：生成新 token，写入 config，返回明文新 token

**涉及文件：**
- `app/components/settings/types.ts`：`SettingsData` 加 `webPassword`、`authToken`、`mcpPort`
- `app/components/settings/KnowledgeTab.tsx`：新增 Security section
- `app/lib/settings.ts`：`readSettings` / `writeSettings` 支持 `webPassword`、`authToken`、`mcpPort`
- `app/app/api/settings/route.ts`：GET/POST 适配新字段
- `app/app/api/settings/reset-token/route.ts`：新建，生成 token
- `app/lib/i18n.ts`：新增 `webPassword`、`authToken` 相关文案

---

### 19. 启动信息展示优化

- `printStartupInfo`：Web UI 和 MCP 地址各展示两行（localhost + 机器 IP）
- `mindos start --daemon` 安装完 service 后也调用 `printStartupInfo`，展示完整 MCP 配置再退出

---

### 20. daemon 启动验证

**问题：** `systemctl start` 成功只代表 systemd 接受了请求，不代表进程真正运行。`--install-daemon` 之前不验证，用户无感知失败。

**修法：** `systemd.start()` / `launchd.start()` 里加 `waitForService()`——启动后轮询最多 10 秒检查 `is-active`，失败则打出最近 30 行日志并 `process.exit(1)`。

```javascript
async function waitForService(check, { retries = 10, intervalMs = 1000 } = {}) {
  for (let i = 0; i < retries; i++) {
    if (check()) return true;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return check();
}
```

---

### 21. onboard --install-daemon 流程修复

**问题：** `setup.js` 完全不读 `process.argv`，不知道自己被 `--install-daemon` 调用；`cli.js` 里的 daemon 安装逻辑在 `run(setup.js)` 之后才执行，但 setup.js 在前台启动了 server，永远不会返回。

**修法：**
- `cli.js` 把 `--install-daemon` flag 透传给 `setup.js`
- `setup.js` 读 `process.argv`，`finish()` 接收 `installDaemon` 参数
- `installDaemon=true` 时 `finish()` 调 `mindos start --daemon`（非阻塞），而不是 `mindos start`（阻塞前台）

---

### 22. 全局包 Turbopack build 修复（最终方案）

**问题：** 根 `package.json` 有 `"workspaces": ["app", "mcp"]`，Turbopack 把 `mindos/` 识别为 monorepo root，把 project dir 推断为 `mindos/app/app`（路径多一层），找不到 `next/package.json`，build 失败。

**第一次尝试（§22 原始）：** 去掉 `workspaces`——但导致本地开发需要 cd 进各子目录分别 `npm install`，体验变差。

**最终修法（恢复 workspaces + 正确隔离安装）：**
1. **恢复 `workspaces: ["app", "mcp"]`**——本地开发体验不变
2. **`ensureAppDeps()` 加 `--no-workspaces` flag**：
   ```javascript
   run('npm install --prefer-offline --no-workspaces', resolve(ROOT, 'app'));
   ```
   关键：`--no-workspaces` 阻止 npm 把依赖 hoist 到 monorepo root，强制安装到 `app/node_modules/`，Turbopack 能从 `app/` 目录正确找到 `next/package.json`
3. **`mindos dev` 也加 `ensureAppDeps()`**——之前只有 `start` 和 `build` 有，`dev` 漏了

**为什么 `turbopack.root` 不够：** Turbopack 在读取 `next.config.ts` 之前就做了 workspace root 推断；且如果 `app/node_modules` 为空，config 本身读取就会失败。必须保证 `app/node_modules/next` 存在，`turbopack.root` 才能生效。

**测试验证：**
- 删除 `app/node_modules` 模拟全局安装 → `mindos build` 自动 install + build 成功
- `npm ls next` 确认本地 workspaces 解析正常
- vitest 134 tests 全通过

---

### 23. .next/lock 残留修复

- `bin/cli.js` 加 `clearBuildLock()`：build 前删除 `app/.next/lock`，防止上次被中断的 build 留下的锁文件阻塞新 build

---

### 24. MCP SDK 1.27.1 breaking change 修复

**问题：** `@modelcontextprotocol/sdk` 1.27.1 修改了 `StreamableHTTPServerTransport.handleRequest()` 的签名——需要把已经被 `express.json()` 解析好的 body 作为第 3 个参数传入（否则 SDK 无法再从已消费的请求流中读取 body，导致 `Parse error: Invalid JSON`）。

**修法：** `mcp/src/index.ts` 中把 `transport.handleRequest(req, res)` 改为 `transport.handleRequest(req, res, req.body)`：

```typescript
expressApp.all(MCP_ENDPOINT, async (req, res) => {
  // Pass pre-parsed body: express.json() already parsed it, SDK >= 1.7 expects it as 3rd arg
  await transport.handleRequest(req, res, req.body);
});
```

**验证（测试结果）：**
- `initialize` → HTTP 200，返回 `protocolVersion: "2024-11-05"` + `capabilities: {tools: {listChanged: true}}`
- `tools/list` → 20 个工具全部注册正确
- `tools/call (mindos_list_files)` → 成功返回知识库文件列表
- AUTH_TOKEN 保护正常（MCP endpoint 要求 `Authorization: Bearer <token>`）

---

---

## 第四阶段改动（2026-03-12）

### 25. 首次进 GUI 无侧边栏 / AskFab 不显示

**根因：** `isLoginPage` 在 Server Component（`layout.tsx`）里通过 `x-pathname` header 判断。登录成功后 `router.replace('/')` 是客户端导航，layout 不重新 SSR，`isLoginPage` 仍为登录时的 `true`，导致 `SidebarLayout` 整个不渲染。刷新后触发完整 SSR 才恢复正常。

**修法：** 新建 `components/ShellLayout.tsx`（client component），用 `usePathname()` 实时判断路径，替换 layout 里的静态 header 判断：

```tsx
// ShellLayout.tsx
'use client';
export default function ShellLayout({ fileTree, children }) {
  const pathname = usePathname();
  if (pathname === '/login') return <>{children}</>;
  return <SidebarLayout fileTree={fileTree}>{children}</SidebarLayout>;
}
```

`layout.tsx` 改为同步函数，去掉 `headers()` import，直接用 `<ShellLayout>`。

---

### 26. 默认打开 .md 文件显示 graph 视图

**根因：** `mindos-use-raw` localStorage 为空时默认 `true`（显示 renderer），新用户首次访问 .md 文件直接走 GraphRenderer。

**修法：** `ViewPageClient.tsx` 中把默认值从 `true` 改为 `false`（显示 markdown）。

---

### 27. 全局 hydration flash 修复

**根因：** 多个组件用 `useState(default) + useEffect(localStorage)` 模式，server snapshot 与 client snapshot 不同，导致首次渲染用错误默认值，hydration 后 flash 到正确值。最严重的是 `LocaleContext`，影响全局所有翻译文本。

**统一修法：** 将所有 `useState + useEffect` 读 localStorage 的模式改为 `useSyncExternalStore`，server snapshot 返回安全默认值，client snapshot 直接读 localStorage，彻底消除 flash。

| 文件 | 问题 | 修法 |
|------|------|------|
| `lib/LocaleContext.tsx` | 中文用户全局 UI 闪 English→中文 | `useSyncExternalStore` + `mindos-locale-change` 事件 |
| `components/ThemeToggle.tsx` | 亮色用户图标闪 Sun→Moon | `useSyncExternalStore` + `mindos-theme-change` 事件 |
| `components/DirView.tsx` | 列表偏好用户目录页闪 grid→list | `useSyncExternalStore` + `mindos-dir-view-change` 事件 |
| `components/SettingsModal.tsx` | modal 打开时 font/width/dark 闪默认值 | `useState(() => localStorage.get...)` 惰性初始化 |
| `components/settings/KnowledgeTab.tsx` | MCP URL 闪 localhost→真实 origin | `useSyncExternalStore` 读 `window.location` |

**设计原则：**
- `useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot)` — server 返回安全默认，client 读真实值，React 不报 hydration error
- 自定义 `window.dispatchEvent(new Event('mindos-xxx-change'))` 作为跨组件同步机制，取代 context re-render
- `SettingsModal` 是纯 client component（用户交互后才渲染），用惰性初始化函数即可，无需 `useSyncExternalStore`

---

### 关键设计决策补充

| 决策 | 原因 |
|------|------|
| webPassword JWT session 同时放行 API 请求 | 已登录用户不应被 AUTH_TOKEN 拦截，两层保护独立但不互斥 |
| authToken 在 GUI 里 masked 展示（首尾可见）| 方便核对，又不完全暴露；Regenerate 后明文展示一次 |
| workspaces 保留 + ensureAppDeps --no-workspaces | workspaces 保证本地开发体验；--no-workspaces 保证全局安装时 next 装到 app/node_modules 而非被 hoist |
| daemon 启动后轮询验证 | systemctl start 返回不代表进程健康，轮询 is-active 才能真正确认 |
| MCP handleRequest 传 req.body | SDK 1.27.1+ express.json() 已消费流，必须透传 parsed body |
| isLoginPage 改用 usePathname | Server Component header 判断不随客户端导航更新；client hook 实时反映路径 |
| useSyncExternalStore 替代 useState+useEffect | server/client snapshot 分离，彻底消除 localStorage 读取的 hydration flash |
