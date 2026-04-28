# OpenCode Desktop 架构与体积调研（2026-04-21）

## 结论先说

- OpenCode 的桌面方案本质上是：**Web UI 复用 + 桌面壳 + 本地 runtime / sidecar**。
- 但它当前仓库里其实有两套桌面实现：
  - `packages/desktop`：**Tauri v2**
  - `packages/desktop-electron`：**Electron**
- 如果对比的是 OpenCode 当前主推下载的 `opencode-desktop-*.dmg`，那基本是在看 **Tauri 版**，所以体积会明显更小。
- MindOS 当前桌面包明显更大，核心原因不是“我们写得差”，而是**我们打进安装包的东西更多**：
  - Electron 壳
  - 完整的 MindOS runtime
  - 内置 Node.js
  - Next.js standalone 服务端产物
  - MCP bundle
  - `templates/`、`skills/`、`bin/`、`scripts/` 等离线运行所需文件

## 我查了哪些信息

### OpenCode（官方公开信息）

- GitHub 仓库：`anomalyco/opencode`
- 发布资产：GitHub Releases latest
- Tauri 包配置：`packages/desktop/package.json`
- Tauri prepare 脚本：`packages/desktop/scripts/prepare.ts`
- Tauri 生产配置：`packages/desktop/src-tauri/tauri.prod.conf.json`
- Electron 包配置：`packages/desktop-electron/package.json`
- Electron builder 配置：`packages/desktop-electron/electron-builder.config.ts`
- Electron prebuild 脚本：`packages/desktop-electron/scripts/prebuild.ts`
- Node 构建脚本：`packages/opencode/script/build-node.ts`

### MindOS（本仓库）

- `desktop/package.json`
- `desktop/README.md`
- `desktop/electron-builder.yml`
- `desktop/scripts/prepare-mindos-runtime.mjs`
- `desktop/scripts/prepare-mindos-bundle.mjs`
- `scripts/build-runtime-archive.sh`
- `desktop/src/core-updater.ts`

## OpenCode 到底怎么做 Desktop

### 1. 它不是纯原生桌面 UI

OpenCode 的 UI 仍然主要是 Web 技术栈复用，而不是为 macOS / Windows 单独写原生界面。

### 2. 它有两套桌面壳

#### Tauri 线

- `packages/desktop/package.json` 依赖 `@tauri-apps/api`
- `packages/desktop/src-tauri/tauri.prod.conf.json` 配置了 Tauri bundle 和 updater
- `packages/desktop/scripts/prepare.ts` 会把 `opencode-cli` 二进制准备成 sidecar

这条线的特点是：**壳很薄**，主要依赖 Tauri + 系统 WebView，再带一个 sidecar CLI。

#### Electron 线

- `packages/desktop-electron/package.json` 使用 `electron-vite`、`electron-builder`
- `packages/desktop-electron/electron-builder.config.ts` 负责打包
- `packages/desktop-electron/scripts/prebuild.ts` 会先构建 Node 侧产物
- `packages/opencode/script/build-node.ts` 把 `src/node.ts` 构建到 `dist/node`

这条线更像常见的 Electron app：UI + Node 逻辑一起打进包里。

## 体积对比（按 2026-04-21 当天 GitHub Releases latest）

### OpenCode latest `v1.14.19`

#### Tauri 桌面包

- `opencode-desktop-darwin-aarch64.dmg`：**46.8 MB**
- `opencode-desktop-darwin-x64.dmg`：**49.5 MB**

#### Electron 桌面包

- `opencode-electron-mac-arm64.dmg`：**132.2 MB**
- `opencode-electron-mac-x64.dmg`：**138.9 MB**

### MindOS latest `desktop-v0.3.12`

- `MindOS-0.3.12-arm64.dmg`：**170.7 MB**
- `MindOS-0.3.12.dmg`：**178.2 MB**
- `MindOS-Setup-0.3.12.exe`：**135.0 MB**
- `mindos-desktop_0.3.12_amd64.deb`：**119.8 MB**

## 为什么会产生“OpenCode 很小、我们很大”的观感

## 关键点 1：你大概率拿 Tauri 的 OpenCode 和 Electron 的 MindOS 在比

这是最重要的前提。

OpenCode 对外现在最显眼的 `opencode-desktop-*` 资产是 **Tauri 版**，而 MindOS 当前发的是 **Electron 版**。  
这两个技术壳的基础体积就不在一个量级：

- **Tauri**：借系统 WebView，壳更薄
- **Electron**：自带 Chromium + Node，壳更厚

所以如果拿 `46.8 MB` 的 `opencode-desktop-darwin-aarch64.dmg` 对比 `170.7 MB` 的 `MindOS-0.3.12-arm64.dmg`，差距会非常显眼。

但如果看 OpenCode 的 **Electron 版**，它也不是“小得离谱”：

- OpenCode Electron mac arm64：**132.2 MB**
- MindOS Electron mac arm64：**170.7 MB**

这样看，差距大约就是 **38.5 MB**，而不是一眼看上去的 120MB+。

## 关键点 2：MindOS 安装包里塞了完整 runtime

这是 MindOS 比 OpenCode Electron 还大的核心原因。

`desktop/electron-builder.yml` 里配置了：

- `extraResources`
  - `from: resources/mindos-runtime`
  - `to: mindos-runtime`

这意味着打包时会把一个完整的 `mindos-runtime/` 放进应用。

`desktop/README.md` 也明确写了：

- 安装包会把构建好的 MindOS 打进 `Resources/mindos-runtime`
- 离线时也能启动本地模式

所以我们不是只发一个桌面壳，而是在发一个**可离线工作的完整本地系统**。

## 关键点 3：MindOS 还内置了 Node.js

`desktop/scripts/prepare-mindos-runtime.mjs` 里有一段明确逻辑：

- 下载并解压平台对应的 `Node.js 22.16.0`
- 放进 `mindos-runtime/node/`
- 目的是让 Desktop 在用户机器**没有系统 Node.js** 的情况下也能启动

脚本里还写了注释：

- 通过裁剪，把 Node bundle 从大约 `~80MB` 降到 `~40MB`（未压缩）

这不是全部都会等比体现在最终 DMG 上，但它毫无疑问是桌面包体积的大头之一。

## 关键点 4：MindOS 打进去的是 Next.js standalone 运行时，不只是静态页面

`desktop/scripts/prepare-mindos-runtime.mjs` 和 `desktop/scripts/prepare-mindos-bundle.mjs` 显示，MindOS 打包时会复制：

- `app/.next/standalone`
- `app/.next/static`
- `app/public`
- `app/data/skills`

这意味着桌面版内置的是一个**完整的 Next.js 服务端运行时**，而不是单纯几张静态 HTML 页面。

再加上：

- `mcp/dist/index.cjs`
- `bin/`
- `templates/`
- `scripts/`

整个 bundle 的目标其实是“离线可启动、可跑 MCP、可跑本地知识工作流”，而不是“只展示 UI”。

## 关键点 5：MindOS 自己就把 runtime archive 定位成 30-40MB

`scripts/build-runtime-archive.sh` 顶部直接写了：

- 输出 `mindos-runtime-{VERSION}.tar.gz`
- 预期体积：**约 30-40MB**

这还只是 **runtime archive 本身**，没有算 Electron 壳。

所以从系统设计上，MindOS 当前桌面安装包就是：

```text
Electron 壳
+ bundled runtime archive 的内容
+ bundled Node.js
+ 本地服务 / MCP / 模板 / skills
```

它天然就会比“薄壳 + sidecar 二进制”的方案更重。

## 更准确的对比方式

如果用更公平的口径看：

### 对比 A：主打下载项

- OpenCode Tauri mac arm64：**46.8 MB**
- MindOS Electron mac arm64：**170.7 MB**

这个差距主要来自：

1. Tauri vs Electron
2. OpenCode 薄壳 vs MindOS bundled runtime

### 对比 B：Electron 对 Electron

- OpenCode Electron mac arm64：**132.2 MB**
- MindOS Electron mac arm64：**170.7 MB**

这个差距主要来自：

1. MindOS 内置完整 runtime
2. MindOS 额外内置 Node.js
3. MindOS 的 Next standalone + MCP + templates + skills 一起进包

## 我们现在换成 OpenCode 那套会更好吗

### 可以学的部分

- **壳更薄，核心能力下沉**
  - 桌面只管窗口、系统集成、更新
  - runtime 单独负责知识库、MCP、Agent、文件系统

- **把核心更新和壳更新解耦**
  - 你们已经有 `desktop/src/core-updater.ts`
  - 这方向是对的，应该继续强化，而不是再往桌面壳里塞更多东西

- **尽量让“离线全量 bundle”变成可选，而不是默认**

### 不建议直接照搬的部分

- **不要现在同时维护 Electron + Tauri 双线**
  - 这会显著增加维护面
  - 对现在的 MindOS 来说，收益不一定大于复杂度

## 如果想把 MindOS 桌面包做小，最有效的几个方向

## 方案 1：把“内置完整 runtime”改成按需下载

这是最直接的减重手段。

当前默认是：

- 安装包自带完整 `mindos-runtime`
- 离线可直接启动

如果改成：

- 安装包只带桌面壳
- 首次启动时下载 runtime
- 或者安装后后台拉取 runtime

优点：

- 安装包会立刻明显变小
- runtime 可以独立热更新

代价：

- 首次启动更慢
- 离线首装体验变差
- 失败重试、版本兼容、断点续传都要补齐

## 方案 2：提供双发行轨

例如：

- `MindOS Lite`：只有桌面壳，首次下载 runtime
- `MindOS Full`：带完整离线 runtime

这样可以把“下载小”和“离线可用”两种诉求分开，而不是让一个安装包承担全部目标。

## 方案 3：继续瘦身 bundled runtime

当前脚本已经做了一些裁剪，但还可以继续审：

- `templates/` 是否全部必须进包
- `scripts/` 是否必须全部进包
- `skills/` 是否可拆成首启同步
- `app/public` 和 `static` 是否有大资源可压缩
- Next standalone 是否还能进一步剥离 dev 残留

这类优化通常是“中等收益，持续积累”。

## 方案 4：长期评估 Tauri，而不是立刻迁移

如果你们未来明确把桌面版定位成：

- 更轻的本地控制台
- UI 为主，runtime 走独立 sidecar
- 系统集成需求不强依赖 Electron 生态

那可以单独做一轮 Tauri 可行性评估。

但在没有明确迁移窗口前，不建议边维护现有 Electron，边平行起一条 Tauri 正式线。

## 我的判断

- MindOS 现在“大”，主要不是因为打包失误，而是因为**产品决策上选择了“离线完整可运行”**。
- OpenCode 现在“看起来小”，主要是因为用户最容易看到的是 **Tauri 版**，而不是它的 Electron 版。
- 如果你们想把安装包做小，真正要改的不是某个压缩参数，而是这道产品题：

```text
桌面安装包默认应该提供“离线完整能力”，
还是默认提供“轻壳 + 首次下载 runtime”？
```

这是体积、首启速度、可靠性、离线能力、更新复杂度之间的权衡点。

## 对当前 MindOS 的建议

### 短期

- 继续保留 Electron 单线
- 明确区分：
  - 桌面壳版本
  - bundled runtime 版本
  - 远端 runtime-latest 版本
- 先把 runtime 更新链做稳

### 中期

- 做一次 `mindos-runtime` 目录级体积审计
- 找出最大目录和可延迟下载内容
- 评估 `Lite / Full` 双发行模式

### 长期

- 如果“轻壳 + sidecar”成为主方向，再评估 Tauri
- 前提是先把 runtime 边界收得足够清晰

## 一句话总结

MindOS 桌面包更大，不是单纯因为 Electron，而是因为它当前发的其实是 **Electron 壳 + 完整离线 MindOS 系统**。  
OpenCode 小，主要是 **Tauri 主发版更薄**；它的 Electron 版其实也并不算小。

## MindOS 可以用 Tauri 吗

可以，**技术上可行**。但更准确的说法是：

```text
MindOS 可以迁到 Tauri，
但更适合走“新建一条轻壳试验线 / 逐步下沉 runtime”的路线，
不适合直接把当前 Electron 桌面端整仓硬迁。
```

## 为什么说“技术上可行”

Tauri v2 官方能力里，MindOS 现在最关键的几类桌面能力基本都有对应方案：

- **子进程 / sidecar**
  - 官方 Shell plugin 支持 spawn child processes
  - 官方也有 “Node.js as a sidecar” 指南
- **更新**
  - 官方 Updater plugin 支持静态 JSON 或动态更新源
- **深链**
  - 官方 Deep Link plugin 支持桌面 schemes
- **单实例**
  - 官方 Single Instance plugin 支持把第二次启动聚焦到已有窗口
- **通知**
  - 官方 Notification plugin 可用
- **Tray**
  - Tauri v2 本身支持 tray / menu 能力
- **自定义协议**
  - Tauri 支持 `register_uri_scheme_protocol`

换句话说，MindOS 不是因为“缺少某个致命 API”而完全不能上 Tauri。

## 为什么又不建议立刻硬迁

因为 MindOS 当前桌面端并不是一个很薄的 Electron app，而是一个已经长出自己“桌面操作系统层”的应用。

从 `desktop/src` 的现状看，Electron 依赖面已经比较广：

- `desktop/src/main.ts`
  - `BrowserWindow`
  - `ipcMain`
  - `shell`
  - tray / menu / protocol 相关集成
- `desktop/src/preload.ts`
  - `contextBridge`
  - `ipcRenderer`
- `desktop/src/updater.ts`
  - `electron-updater`
- `desktop/src/window-state.ts`
  - `electron-store`
- `desktop/src/tray.ts`
  - `Tray`
  - `Menu`
  - `BrowserWindow`
- `desktop/src/shortcuts.ts`
  - `globalShortcut`
- `desktop/src/mindos-connect-protocol.ts`
  - `protocol.handle`
- `desktop/src/connect-window.ts`
  - 多窗口
  - 本地协议页
  - `safeStorage`
- `desktop/src/install-cli-shim.ts`
  - 安装 CLI shim
  - 修改 shell rc
  - 通知 / dialog

这意味着你们并不是“只有一个窗口 + 一个前端页面 + 一个 sidecar”。

## 迁到 Tauri 时，哪些部分会比较顺

### 1. 主窗口壳

如果只是：

- 打开主窗口
- 加载前端页面
- 调 sidecar runtime

这部分迁移相对直接。

### 2. runtime / sidecar 模式

MindOS 的系统模型本来就适合：

- Tauri 做壳
- `mindos-runtime` 做本地核心

这个方向和 OpenCode Tauri 主发版很像。

### 3. 更新链

你们现在已经把“桌面壳更新”和“核心 runtime 更新”拆开了。  
这和 Tauri 的思路并不冲突，反而更适合继续保留：

- Tauri updater 更新壳
- 你们自己的 `core-updater` 更新 runtime

## 迁到 Tauri 时，哪些部分会比较痛

### 1. Electron IPC / preload 全都要重写

现在的桌面端通信模型明显是 Electron 风格：

- `preload.ts` 通过 `contextBridge` 暴露 API
- renderer 走 `ipcRenderer.invoke`
- main 走 `ipcMain.handle`

迁到 Tauri 后，要换成：

- command / invoke
- event
- capability / permission model

这不是“改几个 import”能完成的。

### 2. 自定义协议和多窗口逻辑要重新验证

你们现在有：

- `mindos-connect` 自定义协议
- splash window
- connect window
- main window

Tauri 支持 custom protocol 和多窗口，但平台差异、origin 行为和注册时机都要重新验证。  
官方文档还明确提醒：**custom protocol 的 origin 在不同平台上并不完全一样**。

### 3. Tray / 菜单 / 快捷键 / 安装行为要逐项补齐

这些在 Electron 里都比较成熟。  
Tauri 也能做，但迁移时会出现很多“不是做不到，而是要重新做一遍”的工程工作。

### 4. Rust 成为新的桌面基础设施层

一旦走 Tauri，团队就要接受：

- 桌面壳基础设施会有 Rust 代码
- 打包、签名、插件、能力权限也会带 Rust 配置

如果目标只是“安装包小一点”，那这笔迁移成本未必划算。

## 对 MindOS 最现实的判断

### 可以用 Tauri，但前提是桌面壳要先“变薄”

如果你们先做这些事：

- 把桌面端专有业务继续下沉到 `mindos-runtime`
- 减少 renderer 对 Electron IPC 的直接依赖面
- 收敛窗口、协议、安装、更新的边界

那未来切 Tauri 会越来越容易。

### 反过来，如果现在立刻迁

大概率会发生：

- 包体积问题还没完全解决
- 桌面端稳定性风险上升
- 还要花很多时间重建 Electron 现有能力

也就是说，**会同时吃迁移成本和存量复杂度成本**。

## 我建议的路线

### 推荐路线：Tauri Spike，而不是正式迁移

做一个 `desktop-tauri-spike/` 或 `packages/desktop-tauri/` 原型，只验证 5 件事：

1. Tauri 壳能否稳定启动现有 Web UI
2. 能否拉起 `mindos-runtime` / `mindos-cli` sidecar
3. 多窗口是否能覆盖 `main + splash + connect`
4. 自定义协议 / deep link 是否能替代当前 `mindos-connect`
5. 壳更新 + runtime 更新能否双轨共存

如果这 5 件事成立，再决定是否进入正式迁移。

### 不推荐路线：直接替换现有 Electron 桌面端

因为当前 Electron 桌面端已经不是“薄壳 demo”，而是一套有历史包袱、也有现成稳定性的产品层。

## 最终结论

- **能用 Tauri吗？** 可以。
- **现在该不该直接迁？** 我不建议。
- **最合理的动作？** 先做一个轻量 Tauri spike，验证“薄壳 + sidecar runtime”是否真的适合 MindOS。

一句话说：

```text
Tauri 对 MindOS 是一个值得认真评估的未来方向，
但它更像“下一代桌面壳方案”，
不是现在立刻替换现有 Electron 的低风险改动。
```
