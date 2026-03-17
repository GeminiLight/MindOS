<!-- Task spec — 两个小 feature，实现后删除此文件 -->

# Task Spec: GUI 自动更新提示 + Sync 初始化交互优化

---

## Feature 1: GUI 自动更新提示

### 目标

联网时 Web UI 自动检查 npm 最新版本，有新版本时在界面顶部弹出更新横幅。

### 当前状态

- 更新只能通过 CLI `mindos update` 执行（`npm install -g @geminilight/mindos@latest` + 重启 daemon）
- Web UI 完全不知道有没有新版本
- 非技术用户不会主动跑 `mindos update`

### 实现方案

#### 1. 后端 API: `GET /api/update-check`

```typescript
// app/app/api/update-check/route.ts
import { NextResponse } from 'next/server';
import { gt } from 'semver';
import { readFileSync } from 'fs';
import { join } from 'path';

// 读 package.json 获取版本（不依赖 process.env.npm_package_version，
// 因为 daemon 模式下该环境变量不存在）
const pkg = JSON.parse(readFileSync(join(__dirname, '../../../../package.json'), 'utf-8'));
const current = pkg.version;

// npm registry 源：优先使用用户配置的镜像，降级到官方源
const REGISTRIES = [
  'https://registry.npmmirror.com/@geminilight/mindos/latest',   // 国内镜像
  'https://registry.npmjs.org/@geminilight/mindos/latest',       // 官方
];

export async function GET() {
  let latest = current;

  for (const url of REGISTRIES) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(3000),    // 3 秒超时
        next: { revalidate: 300 },            // 5 分钟 ISR 缓存
      });
      if (res.ok) {
        const data = await res.json();
        latest = data.version;
        break;                                 // 成功即停，不试下一个源
      }
    } catch {
      continue;                                // 超时/网络错误 → 试下一个源
    }
  }

  return NextResponse.json({
    current,
    latest,
    hasUpdate: gt(latest, current),
  });
}
```

**关键细节：**
- **版本号获取：** 从 `package.json` 直接读取，不用 `process.env.npm_package_version`（daemon 模式下该环境变量不存在）
- **semver 比较：** 直接用 `semver` 包（项目已间接依赖），不自己写
- **双源降级：** 先试 npmmirror（国内用户快），失败再试 npmjs.org，每个源 3 秒超时
- **缓存：** Next.js ISR 5 分钟缓存，同一个 5 分钟窗口内多次请求不重复查 registry
- **无需认证：** 版本信息非敏感，同源请求即可

#### 2. 前端组件: `UpdateBanner`

```
┌──────────────────────────────────────────────────────────┐
│ 🆕 MindOS v0.2.1 可用（当前 v0.1.9）                      │
│ 终端运行 `mindos update` 或 [查看更新说明]              [×] │
└──────────────────────────────────────────────────────────┘
```

**触发与显示逻辑：**

```typescript
// UpdateBanner.tsx
useEffect(() => {
  const timer = setTimeout(async () => {
    try {
      const { hasUpdate, latest, current } = await apiFetch('/api/update-check');
      if (!hasUpdate) return;

      const dismissed = localStorage.getItem('mindos_update_dismissed');
      if (latest === dismissed) return;   // 用户已关闭过该版本

      setUpdateInfo({ latest, current });
    } catch {
      // 网络错误、API 失败 → 静默，不显示
    }
  }, 3000);   // 页面加载 3 秒后检查，不阻塞首屏
  return () => clearTimeout(timer);
}, []);

const handleDismiss = () => {
  localStorage.setItem('mindos_update_dismissed', updateInfo.latest);
  setUpdateInfo(null);
};
// v0.2.1 被 × 后不再弹；v0.2.2 发布时 dismissed 值过期，重新弹出
```

**行为：**
- **"×" 关闭：** 将 `latest` 版本号存入 `localStorage.mindos_update_dismissed`，该版本永不再弹
- **新版本发布：** dismissed 存的是旧版本号 → latest !== dismissed → 重新显示
- **无网络 / 请求失败：** 静默，不显示任何内容

#### 3. 受影响文件

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `app/app/api/update-check/route.ts` | 新增 | 版本检查 API（双源 + 3s 超时） |
| `app/components/UpdateBanner.tsx` | 新增 | 更新提示横幅（按版本号记忆关闭状态） |
| `app/app/layout.tsx` | 修改 | 挂载 `<UpdateBanner />` |

#### 4. 工作量

**~0.5 天**

---

## Feature 2: Sync 初始化交互优化

### 目标

Sync 未配置时，SyncTab 的空状态从"显示终端命令"改为"输入框 + 按钮"直接在 GUI 完成配置，零终端操作。

### 当前状态

SyncTab 空状态展示 3 步文字说明 + `mindos sync init` 命令复制按钮，用户仍需：
1. 打开终端
2. 粘贴命令
3. 在终端交互式输入 Git Remote URL
4. 回到 GUI 看效果

### 实现方案

#### 1. 后端 API: `POST /api/sync` (扩展 action)

现有 `/api/sync` 已支持 `action: 'now' | 'on' | 'off'`，新增：

```typescript
// action: 'init'
POST /api/sync
{
  "action": "init",
  "remote": "https://github.com/user/my-mind.git",
  "branch": "main"       // 可选，默认 main
}

→ 200
{ "success": true, "message": "Sync initialized" }

→ 400
{ "error": "Invalid remote URL" }
{ "error": "Remote not reachable — check URL and credentials" }
{ "error": "Sync already configured" }
```

**后端逻辑：**

```
收到 init 请求
    │
    ├── 1. 校验 remote URL 格式（HTTPS 或 SSH）
    │
    ├── 2. 检测 MIND_ROOT 是否已有 .git
    │   ├── 无 → git init + git add . + git commit -m "Initial commit"
    │   └── 有 → 跳过
    │
    ├── 3. git remote add origin {url}（已有则 set-url）
    │
    ├── 4. git fetch origin（验证连通性，3 秒超时）
    │   └── 失败 → 返回 400 "Remote not reachable"
    │
    ├── 5. 判断 remote 是否已有内容
    │   ├── remote 有 main → git pull --rebase origin main
    │   └── remote 为空  → git push -u origin main
    │
    ├── 6. 写入 sync config → 启动 auto-sync watcher
    │
    └── 返回 200
```

**实现方式：** API route 通过 `child_process.execFile` 调用 `mindos sync init --remote {url} --branch {branch} --non-interactive`，而不是直接 import `bin/lib/sync.js`（避免 CLI 模块和 Next.js 进程之间的路径解析、进程上下文不一致问题）。需要给 `bin/lib/sync.js` 的 init 流程加 `--non-interactive` flag，跳过 readline 交互，从参数接收 remote/branch。

#### 2. 前端组件: 改造 `SyncEmptyState`

**Before（当前）：**
```
┌─ Cross-device Sync ────────────────────────┐
│ 📝 Setup                                    │
│ ① Create a private Git repo...              │
│ ② Run this command: [mindos sync init] 📋   │
│ ③ Follow the prompts...                     │
└─────────────────────────────────────────────┘
```

**After（改造后）：**
```
┌─ Cross-device Sync ──────────────────────────┐
│                                               │
│ 🔗 Git Remote URL                             │
│ ┌───────────────────────────────────────────┐ │
│ │ https://github.com/user/my-mind.git       │ │
│ └───────────────────────────────────────────┘ │
│ ⚠ SSH URLs (git@...) require SSH key          │
│   configured on this machine.                 │
│   HTTPS with token recommended.               │
│                                               │
│ 🔑 Access Token (for private repos)           │
│ ┌───────────────────────────────────────────┐ │
│ │ ghp_xxxxxxxxxxxx              (optional)  │ │
│ └───────────────────────────────────────────┘ │
│ ℹ GitHub: Settings → Developer settings       │
│   → Personal access tokens → repo scope       │
│                                               │
│ Branch: [main      ▾]                         │
│                                               │
│ [Connect & Start Sync]                        │
│                                               │
│ ✓ Auto-commit on save                         │
│ ✓ Auto-pull from remote                       │
│ ✓ Conflict detection                          │
│ ✓ Works across devices                        │
└───────────────────────────────────────────────┘
```

**交互流程：**
1. 用户粘贴 Git Remote URL
2. 如果是 HTTPS 私有仓库 → 可选填写 Access Token（自动编入 URL：`https://{token}@github.com/...`）
3. 如果是 SSH URL → 提示 "SSH URLs require SSH key configured on this machine"
4. 可选修改 branch（默认 `main`）
5. 点击 "Connect & Start Sync"
6. 按钮变为 loading 状态：`Connecting...`
7. 成功 → 自动刷新 SyncTab 状态（切换到 active 视图）
8. 失败 → 按钮下方显示红色错误信息

**Token 安全：**
- Token 编入 URL 后存入 git remote config（`git remote set-url`），不额外持久化
- Token 输入框 `type="password"` 默认遮掩
- Settings UI 的 Remote 显示中，token 部分显示为 `https://***@github.com/...`

#### 3. URL 校验

前端即时校验（输入时 debounce 300ms）：

| URL 格式 | 校验规则 | Token 输入框 |
|----------|---------|-------------|
| `https://github.com/user/repo.git` | 合法 HTTPS | 显示（可选） |
| `https://gitlab.com/user/repo.git` | 合法 HTTPS | 显示（可选） |
| `git@github.com:user/repo.git` | 合法 SSH | 隐藏 + 显示 SSH 提示 |
| `ftp://...` | 不合法 | — |
| 空 | 按钮 disabled | — |

不合法 → 输入框红色边框 + 提示 "Invalid Git URL"
按钮 disabled 直到 URL 合法

#### 4. 受影响文件

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `app/components/settings/SyncTab.tsx` | 修改 | 重写 `SyncEmptyState` 为表单交互（URL 输入 + Token + Branch + Connect 按钮） |
| `app/app/api/sync/route.ts` | 修改 | POST handler 增加 `action: 'init'`，通过 `execFile` 调用 CLI |
| `bin/lib/sync.js` | 修改 | init 流程支持 `--non-interactive --remote {url} --branch {branch}` 参数 |

#### 5. 工作量

**~1.5 天**（比原估多 0.5 天：Token 输入框 + SSH/HTTPS 分支处理 + CLI non-interactive flag）

---

## 总工作量

| Feature | 工作量 |
|---------|--------|
| GUI 自动更新提示 | ~0.5 天 |
| Sync 初始化 GUI 化 | ~1.5 天 |
| **总计** | **~2 天** |
