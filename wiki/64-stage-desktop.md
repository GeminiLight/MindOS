<!-- Last verified: 2026-03-22 | Current stage: 规划 -->

# Stage 14 — 桌面安装包 (Desktop Installer)

## 功能汇总

| # | 功能 | 状态 | 备注 |
|---|------|------|------|
| 14A | 自包含运行包 | 📋 | 内嵌 Node.js binary + standalone 目录 |
| 14B | 平台安装包 | 📋 | macOS .dmg / Windows .msi / Linux .AppImage |
| 14C | 系统托盘 + 原生窗口 | 📋 | Tauri v2 shell，嵌入 Web UI |
| 14D | 自动更新 | 📋 | Tauri updater，检查 GitHub Releases |

---

## 现状分析

### 当前安装流程

```
目标用户想使用 MindOS：
  1. 安装 Node.js 18+（不知道 Node 是什么）
  2. 打开终端（不知道终端在哪）
  3. npm install -g @geminilight/mindos（npm 是什么？）
  4. mindos onboard（配置 API key、端口、模板）
  5. mindos gateway install（注册 daemon）
  6. 打开浏览器访问 localhost:3000
```

### 核心问题

| 问题 | 影响 |
|------|------|
| 必须预装 Node.js | 90% 非开发者用户直接劝退 |
| 终端操作门槛 | "不会用终端的用户也能用"——P2 的核心目标 |
| 没有应用图标 | 用户找不到"MindOS 在哪" |
| 无系统托盘 | 不知道服务是否在运行，不知道怎么停 |
| 更新靠手动 npm update | 非技术用户不会操作 |

### MindOS 架构特殊性

MindOS 不是纯前端 SPA，而是 **本地 Web 服务器 + 浏览器 UI** 的混合架构：

```
┌─────────────────────────────────┐
│ Next.js 16 Server (port 3000)   │  ← 需要 Node.js 运行时
│ MCP HTTP Server (port 8787)     │  ← 需要 Node.js 运行时
│ CLI + daemon 管理                │  ← 需要 Node.js 运行时
│ 文件系统操作 (fs/path)           │  ← 需要 Node.js API
└─────────────────────────────────┘
         ↕ HTTP
┌─────────────────────────────────┐
│ 浏览器 / Webview / PWA          │  ← 纯前端渲染
└─────────────────────────────────┘
```

这意味着桌面方案**必须捆绑 Node.js 运行时**，而不能像纯前端 App 一样只用 Webview。

---

## 技术方案选型

### 候选方案对比

| 方案 | 包体积 | 复杂度 | 原生体验 | Node.js 兼容 | 适合 MindOS？ |
|------|--------|--------|---------|-------------|-------------|
| **Electron** | ~150MB | 低 | 中 | ✅ 内置 | ❌ 过重，与"轻量"理念矛盾 |
| **Tauri v2 + sidecar** | ~15-30MB | 中 | 高 | ✅ sidecar 捆绑 | ✅ **推荐** |
| **pkg** (Vercel) | ~50MB | 低 | 无 | ✅ 编译 | ❌ 已停止维护 |
| **Node.js SEA** | ~40MB | 中 | 无 | ✅ 内置 | ⚠️ 仅 CLI，无 GUI shell |
| **纯安装脚本** (.pkg/.msi) | ~30MB | 中 | 低 | 需检测/安装 | ⚠️ 降级方案 |

### 推荐：分阶段实施

```
Phase 1 (14A+14B): 先做"能装能用"
  → 内嵌 Node.js binary + Next.js standalone 目录
  → 平台安装包（.dmg/.msi/.AppImage）
  → 安装后双击图标 = 启动服务 + 打开浏览器
  → 零终端操作
  → 更新：启动时检查 + Web UI 横幅提示手动下载

Phase 2 (14C+14D): 再做"原生体验"
  → Tauri v2 shell 包裹 Web UI
  → 系统托盘控制（启动/停止/打开 UI）
  → 内置自动更新（Tauri updater）
  → 14A 产物降级为 CLI-only 分发（开发者/服务器场景）
```

---

## 14A: 自包含运行包（内嵌 Node.js）

### 用户场景

用户下载一个压缩包，解压后双击运行，无需安装 Node.js。

### 设计决策

| 决策点 | 选择 | 原因 | 放弃的方案 |
|--------|------|------|-----------|
| 打包方式 | **内嵌 Node.js binary + standalone 目录** | Next.js standalone 输出是多文件结构（server.js + node_modules/ + static/），SEA 只能打单文件 blob，无法直接装下整个目录 | Node.js SEA（仅支持单 JS 文件，不支持目录结构）/ `pkg`（已停止维护）/ `nexe`（社区不活跃） |
| 包含内容 | Node.js binary + Next.js standalone + MCP + CLI + 模板 | 全功能自包含 | 仅 CLI（用户还需手动 build） |
| 目标平台 | macOS (arm64 + x64) / Windows (x64) / Linux (x64) | 覆盖主流平台 | 32-bit（不值得维护） |
| Next.js 产物 | `next build` 的 standalone output | standalone 模式输出自包含 server.js + 精简 node_modules | 运行时 build（太慢且需 devDeps） |
| 远期优化 | esbuild/ncc bundle server.js → SEA 单文件 | 减少文件数，但需验证 Next.js bundle 兼容性 | 当前不做，作为 backlog |

### 为什么不用 Node.js SEA

Node.js SEA（Node 22）只支持将**单个 JS 文件**注入二进制 blob。Next.js standalone 输出是 `server.js` + `node_modules/`（精简子集）+ `.next/static/`（前端资源）等**大量文件和目录**，无法塞进一个 SEA blob。

理论上可以用 `@vercel/ncc` 或 `esbuild` 将 server.js + 依赖 bundle 成单文件后再 SEA，但 Next.js server 内部大量使用动态 require 和运行时文件读取，bundle 兼容性未验证。作为远期优化放入 backlog。

### Next.js standalone 模式

需要在 `next.config.ts` 中启用：

```typescript
// app/next.config.ts
const nextConfig = {
  output: 'standalone',  // 关键：输出自包含 server
  // ... existing config
};
```

standalone 模式会在 `.next/standalone/` 下生成一个 `server.js`，只依赖 `node_modules` 的精简子集（~30MB vs 完整 node_modules ~200MB）。

### 构建流程

```
1. 下载目标平台 Node.js binary (node-v22-{platform}-{arch})
2. next build (output: standalone)
3. 收集产物到 dist/{platform}/:
   - node (Node.js binary)
   - .next/standalone/server.js + node_modules 子集
   - .next/static/ (前端静态资源)
   - bin/ (CLI 模块)
   - mcp/ (MCP server)
   - skills/ + templates/ (知识库模板)
   - mindos.sh / mindos.bat (启动脚本，调用 ./node server.js)
4. 压缩为 .tar.gz (macOS/Linux) / .zip (Windows)
5. 签名 (codesign / signtool)
```

### 预期产物大小

| 组件 | 大小 |
|------|------|
| Node.js binary | ~35MB |
| Next.js standalone | ~25MB |
| MCP server | ~2MB |
| CLI + lib | ~1MB |
| 静态资源 + 模板 | ~5MB |
| **总计（压缩前）** | **~68MB** |
| **压缩后估计** | **~25-30MB** |

### 受影响文件

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `app/next.config.ts` | 修改 | 添加 `output: 'standalone'` |
| `scripts/build-desktop.js` | 新增 | 下载 Node.js + 收集产物 + 打包 |
| `desktop/launcher.sh` | 新增 | macOS/Linux 启动脚本 |
| `desktop/launcher.bat` | 新增 | Windows 启动脚本 |
| `package.json` | 修改 | 添加 `build:desktop` 脚本 |

---

## 14B: 平台安装包

### 用户场景

用户从官网下载 `.dmg`（Mac）/ `.msi`（Windows）/ `.AppImage`（Linux），双击安装，桌面出现 MindOS 图标。

### 设计决策

| 决策点 | 选择 | 原因 | 放弃的方案 |
|--------|------|------|-----------|
| 打包工具 | macOS: `create-dmg` / Win: NSIS / Linux: `appimagetool`（Phase 1）→ Tauri build（Phase 2 接管） | Phase 1 无 Tauri，需独立工具；Phase 2 Tauri 自带 installer 生成 | `electron-builder`（依赖 Electron 生态，不用 Electron 则不适用）/ 手写 pkgbuild / WiX（工作量大） |
| macOS 格式 | `.dmg` (拖拽安装) | macOS 用户最熟悉 | `.pkg`（过重、权限复杂） |
| Windows 格式 | `.msi` + NSIS `.exe` 双出 | .msi 企业部署友好，.exe 用户友好 | 仅 .msi（个人用户不习惯） |
| Linux 格式 | `.AppImage` | 无需 root，跨发行版 | `.deb`+`.rpm`（维护两套） |
| 安装位置 | macOS: `/Applications/MindOS.app` / Win: `%LOCALAPPDATA%\MindOS` | 用户空间，不需 admin 权限 | `/usr/local`（需 sudo） |
| 数据目录 | 不变：`~/.mindos/` + 用户选择的 MIND_ROOT | 与 npm 版完全兼容 | 打包在 app bundle 内（不可移植） |

### macOS .dmg 内容

```
MindOS.dmg
├── MindOS.app/
│   ├── Contents/
│   │   ├── MacOS/
│   │   │   └── launcher         # 启动脚本（调用 Resources/node 启动服务）
│   │   ├── Resources/
│   │   │   ├── node             # Node.js binary
│   │   │   ├── standalone/      # Next.js standalone (server.js + node_modules)
│   │   │   ├── static/          # .next/static 前端资源
│   │   │   ├── mcp/             # MCP server
│   │   │   ├── bin/             # CLI 模块
│   │   │   ├── templates/       # 知识库模板
│   │   │   └── icon.icns
│   │   └── Info.plist
└── Applications → /Applications (symlink)
```

### Windows .msi 安装流程

```
1. 运行 MindOS-Setup.exe / MindOS.msi
2. 选择安装目录（默认 %LOCALAPPDATA%\MindOS）
3. 安装完成 → 创建桌面快捷方式 + 开始菜单项
4. 首次启动 → 打开浏览器 → Onboard 引导页
5. 可选：注册 Windows 服务（或开机启动项）
```

### 首次启动流程（所有平台）

```
双击 MindOS 图标
    │
    ├── 检测 ~/.mindos/config.json 是否存在
    │   ├── 存在 → 直接启动服务 → 打开浏览器
    │   └── 不存在 → 启动服务 → 打开浏览器 → 显示 Onboard 引导页
    │
    ├── 启动 Next.js server (port 3000)
    ├── 启动 MCP HTTP server (port 8787)
    └── 打开默认浏览器 http://localhost:3000
```

### daemon 管理变化

| 平台 | npm 版 (当前) | 桌面版 Phase 1 | 桌面版 Phase 2 (Tauri) |
|------|-------------|---------------|----------------------|
| macOS | launchd plist | launchd plist（复用现有） | **Tauri 进程管理** + Login Item |
| Windows | 开机启动注册表 `Run` 键 | 开机启动注册表 `Run` 键（复用） | **Tauri 进程管理** + Login Item |
| Linux | systemd user service | systemd user service（复用） | **Tauri 进程管理** + `.desktop` 自启 |

> **Phase 2 上线后，14A 的自包含运行包降级为 CLI-only 分发**（给开发者 / 服务器场景用），桌面版完全由 Tauri 接管，避免维护两套入口。

### 与 npm 版共存

桌面版和 npm 版**共享同一个数据目录** (`~/.mindos/` + MIND_ROOT)，但不能同时运行：

```
启动时检测端口占用
    ├── 3000 端口空闲 → 正常启动
    └── 3000 端口被占 → 检测是否是 MindOS 进程
        ├── 是 → 提示"MindOS 已在运行"→ 直接打开浏览器
        └── 否 → 提示端口冲突，建议修改端口
```

### 卸载流程

| 平台 | 卸载方式 | 清理项 |
|------|---------|--------|
| macOS | 拖 MindOS.app 到废纸篓 | app bundle 删除；`~/.mindos/` 和 MIND_ROOT **不删除**（保留用户数据） |
| Windows | 控制面板 → 卸载 MindOS | 移除安装目录 + 开始菜单 + 桌面快捷方式 + 注册表 Run 键；**不删** `%USERPROFILE%\.mindos\` |
| Linux | 删除 .AppImage 文件 | 移除 `.desktop` 文件 + systemd service；**不删** `~/.mindos/` |

> **原则：卸载不清理用户数据**。`~/.mindos/` 和 MIND_ROOT 包含用户的知识库、配置、API key，必须保留。可在卸载对话框中提供"同时删除数据"复选框（默认不勾选）。

### 14B 受影响文件
| `desktop/tauri.conf.json` | 新增 | Tauri 配置（14C 阶段使用） |
| `desktop/icons/` | 新增 | 各平台图标 (.icns/.ico/.png) |
| `scripts/build-installer.js` | 新增 | 跨平台安装包构建脚本 |
| `package.json` | 修改 | 添加 `build:mac` / `build:win` / `build:linux` 脚本 |
| `.github/workflows/build-desktop.yml` | 新增 | CI: 多平台构建 + GitHub Releases 发布 |

---

## 14C: 系统托盘 + 原生窗口 (Tauri v2)

### 用户场景

MindOS 像 Notion/Obsidian 一样有自己的窗口和系统托盘图标，用户可以通过托盘控制服务状态。

### 设计决策

| 决策点 | 选择 | 原因 | 放弃的方案 |
|--------|------|------|-----------|
| 原生壳 | Tauri v2 | 包体积小（~3MB shell），原生 Webview，Rust 安全 | Electron（150MB+）/ Neutralino（生态小） |
| Webview | 系统自带 | macOS: WebKit / Win: WebView2 / Linux: WebKitGTK | 内嵌 Chromium（Electron 方案） |
| Node.js 运行 | Tauri sidecar | Tauri v2 原生支持 sidecar 进程管理 | 嵌入 V8（复杂度过高） |
| IPC | Tauri events + HTTP | 托盘命令通过 Tauri event 传给 sidecar | 自定义 socket |

### 架构

```
┌──────────────────────────────────────────────┐
│ Tauri v2 Shell (Rust, ~3MB)                  │
│ ┌──────────────┐  ┌───────────────────────┐  │
│ │ 系统托盘      │  │ 原生窗口 (Webview)     │  │
│ │ • 启动/停止   │  │ 加载 localhost:3000    │  │
│ │ • 打开 UI    │  │ (或 Tauri asset 协议)  │  │
│ │ • 设置       │  │                       │  │
│ │ • 退出       │  └───────────────────────┘  │
│ └──────────────┘                              │
│         │ Tauri sidecar                       │
│         ▼                                     │
│ ┌──────────────────────────────────────────┐  │
│ │ Node.js sidecar                          │  │
│ │ • Next.js server (:3000)                 │  │
│ │ • MCP HTTP server (:8787)                │  │
│ │ • File watcher (Git sync)                │  │
│ └──────────────────────────────────────────┘  │
└──────────────────────────────────────────────┘
```

### 系统托盘菜单

```
┌─────────────────────────┐
│ 🧠 MindOS               │
│ ────────────────────────│
│ ● 运行中 (localhost:3000)│
│ ────────────────────────│
│ 打开 MindOS              │
│ 在浏览器中打开            │
│ ────────────────────────│
│ 启动 / 停止服务           │
│ 查看日志                 │
│ ────────────────────────│
│ 偏好设置...              │
│ 检查更新...              │
│ ────────────────────────│
│ 退出 MindOS              │
└─────────────────────────┘
```

### 窗口行为

| 行为 | 说明 |
|------|------|
| 关闭窗口 | 隐藏窗口，服务继续在托盘运行（macOS 标准行为） |
| 托盘"打开" | 显示窗口 / 恢复到前台 |
| "在浏览器中打开" | `open http://localhost:3000`（用户可在外部浏览器使用） |
| 退出 | 停止 Node.js sidecar → 退出应用 |
| 开机启动 | 注册为 Login Item（macOS）/ Run 注册表（Windows） |

### 受影响文件

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `desktop/src-tauri/` | 新增 | Tauri Rust 源码 |
| `desktop/src-tauri/src/main.rs` | 新增 | 主进程：托盘、窗口管理、sidecar 控制 |
| `desktop/src-tauri/tauri.conf.json` | 新增 | Tauri 配置：窗口、安全策略、sidecar 声明 |
| `desktop/src-tauri/Cargo.toml` | 新增 | Rust 依赖 |
| `desktop/src-tauri/icons/` | 新增 | 托盘 + 应用图标 |

---

## 14D: 自动更新

### 用户场景

MindOS 后台检查新版本，通知用户更新，一键完成，无需命令行。

### Phase 1 更新方案（无 Tauri）

14D 的 Tauri updater 依赖 14C，但 Phase 1（14A+14B）先发布时也需要更新能力：

```
应用启动时
    → fetch https://api.github.com/repos/{owner}/{repo}/releases/latest
    → 比较 semver
    ├── 无新版本 → 静默
    └── 有新版本 → Web UI 顶部横幅:
        "MindOS v0.3.1 可用 [前往下载]"
        → 点击跳转 GitHub Releases 页面
        → 用户手动下载新安装包覆盖安装
```

简单但有效，工作量极小（仅 API route + UI 横幅）。Phase 2 上线 Tauri updater 后替代。

### Phase 2 更新方案（Tauri updater）

#### 设计决策

| 决策点 | 选择 | 原因 | 放弃的方案 |
|--------|------|------|-----------|
| 更新机制 | Tauri updater plugin | 原生集成，签名验证，增量更新 | Electron autoUpdater / Sparkle / 手动下载 |
| 更新源 | GitHub Releases | 免费托管，CI 自动发布 | 自建 CDN（成本高） |
| 检查频率 | 启动时 + 每 24 小时 | 平衡及时性和网络消耗 | 每次打开（过于频繁） |
| 更新策略 | 提示 + 用户确认 | 尊重用户控制权 | 静默更新（可能打断工作） |
| 签名 | Ed25519 (Tauri 默认) | 防止篡改 | RSA / 无签名 |

### 更新流程

```
应用启动 / 24h 定时检查
    │
    ├── 请求 GitHub API: latest release
    │   https://api.github.com/repos/{owner}/{repo}/releases/latest
    │
    ├── 比较版本号 (semver)
    │   ├── 无新版本 → 静默（不打扰用户）
    │   └── 有新版本 → 系统通知 / 托盘气泡
    │       "MindOS v0.3.1 可用，是否更新？"
    │       ├── 稍后 → 24h 后再提醒
    │       └── 立即更新
    │           ├── 下载差异包
    │           ├── 验证签名
    │           ├── 停止 Node.js sidecar
    │           ├── 替换文件
    │           ├── 重启应用
    │           └── 完成通知
    │
    └── 无网络 → 静默跳过
```

### 受影响文件

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `desktop/src-tauri/tauri.conf.json` | 修改 | 添加 updater 配置（endpoint、pubkey） |
| `desktop/src-tauri/src/main.rs` | 修改 | 更新检查 + 通知逻辑 |
| `.github/workflows/build-desktop.yml` | 修改 | Release 构建添加签名步骤 |
| `desktop/keys/` | 新增 | Ed25519 公钥（私钥存 GitHub Secrets） |

---

## 代码签名

### 为什么必须签名

| 平台 | 不签名的后果 |
|------|-------------|
| macOS | Gatekeeper 阻止运行，用户看到"无法验证开发者" |
| Windows | SmartScreen 警告"未知发布者"，用户需多次确认 |
| Linux | 无强制要求，但签名提升信任 |

### 签名方案

| 平台 | 证书 | 成本 | 说明 |
|------|------|------|------|
| macOS | Apple Developer ID | $99/年 | `codesign` + `notarytool` 公证 |
| Windows | EV Code Signing Certificate | $200-400/年 | 消除 SmartScreen 警告需 EV 证书 |
| Linux | GPG 签名 | 免费 | `.sig` 文件供用户验证 |

### 降级策略（初期无签名）

```
macOS: 用户需右键 → 打开 → 确认
       或 xattr -d com.apple.quarantine MindOS.app
       → 在下载页面给出明确说明

Windows: 用户需点击"更多信息" → "仍要运行"
         → 同样在下载页面给出说明

→ 积累一定用户量后再购买证书
```

---

## 配置项

| 配置 | 默认值 | 说明 |
|------|--------|------|
| `desktop.autoStart` | `true` | 开机自动启动 |
| `desktop.minimizeToTray` | `true` | 关闭窗口时最小化到托盘 |
| `desktop.checkUpdate` | `true` | 自动检查更新 |
| `desktop.updateChannel` | `stable` | 更新通道：`stable` / `beta` |

---

## CI/CD 构建流程

```yaml
# .github/workflows/build-desktop.yml
trigger: push tag v*.*.*

jobs:
  build-macos:
    runs-on: macos-latest
    steps:
      - next build (standalone)
      - tauri build --target aarch64-apple-darwin
      - tauri build --target x86_64-apple-darwin
      - codesign + notarize (if cert available)
      - upload: MindOS-{version}-arm64.dmg, MindOS-{version}-x64.dmg

  build-windows:
    runs-on: windows-latest
    steps:
      - next build (standalone)
      - tauri build --target x86_64-pc-windows-msvc
      - signtool (if cert available)
      - upload: MindOS-{version}-x64.msi, MindOS-Setup-{version}.exe

  build-linux:
    runs-on: ubuntu-latest
    steps:
      - next build (standalone)
      - tauri build --target x86_64-unknown-linux-gnu
      - upload: MindOS-{version}-x86_64.AppImage

  release:
    needs: [build-macos, build-windows, build-linux]
    steps:
      - create GitHub Release
      - attach all artifacts
      - generate update manifest (latest.json)
```

---

## 实施顺序

```
14A (SEA 打包 + standalone, 2-3 天)
    → 14B (平台安装包, 3-4 天)
        → 14C (Tauri shell + 托盘, 4-5 天)
            → 14D (自动更新, 2-3 天)
```

**14A+14B 总计：~5-7 天**（先达成"能装能用"）
**14C+14D 总计：~6-8 天**（再达成"原生体验"）
**全部：~11-15 天**

---

## 风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| Node.js SEA 对 Next.js standalone 支持不完善 | 14A 方案不可行 | ~~已规避：主方案改为内嵌 Node.js binary + 目录，不依赖 SEA~~ |
| Tauri v2 sidecar 对长运行 Node.js 进程管理有 bug | 14C 不稳定 | 独立进程 + PID 文件管理（复用现有 daemon 逻辑） |
| macOS 公证要求严格（Hardened Runtime 限制） | .dmg 无法分发 | 临时：引导用户手动允许；长期：购买 Developer ID |
| Windows Defender/SmartScreen 拦截 | 用户安装体验差 | EV 签名 或 提交给 Microsoft 审查 |
| 包体积过大 (>100MB) | 下载慢，用户流失 | `next build` standalone 精简 + 压缩 + 分平台优化 |
| 与 npm 版 daemon 冲突 | 端口争用 | 启动前检测已有 MindOS 进程 |
| Webview 兼容性（Tauri Phase 2） | 渲染差异 | macOS WebKit / Windows WebView2 / Linux WebKitGTK 行为不一致。MindOS 前端用 TipTap + CodeMirror + 复杂 CSS，需在三端 Webview 逐一测试。Windows WebView2 需 Edge Runtime（Win10 旧版本可能缺失，Tauri 自动下载但增加首次启动时间）。Linux WebKitGTK 跨发行版版本差异大。**降级方案：** 始终保留"在浏览器中打开"选项，Webview 不可用时回退到外部浏览器 |

---

## 遗留项 / Backlog

- **便携版 (Portable)**：提供 `.zip` 解压即用版本（特别是 Windows），不修改注册表、不创建快捷方式，适合 U 盘携带或企业受限环境。工作量极小——就是 14A 产物不走 installer 直接压缩
- Node.js SEA 单文件优化：验证 `@vercel/ncc` bundle Next.js server 后注入 SEA 的可行性
- Universal Binary (macOS arm64 + x64 单文件) vs 分架构发布
- Windows ARM64 支持（Surface Pro X 等）
- Linux Flatpak / Snap 格式（应用商店分发）
- 增量更新（只下载变化的文件，减少更新体积）
- 崩溃报告收集（opt-in，Sentry 或自建）
- 安装包内嵌 Onboard 向导（替代浏览器版）
