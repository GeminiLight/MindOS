<!-- Last verified: 2026-03-14 | Current stage: P1 -->

# 变更日志 (CHANGELOG)

## v0.5.4 — Skill 自动安装 + Onboard 端口分离 (2026-03-16)

### 新增
- **Skill 自动安装** — GUI/CLI onboarding 完成时自动安装对应语言的操作指南 Skill（`mindos` / `mindos-zh`），并写入 `disabledSkills` 禁用另一语言版本
- **Skill 安装 API** — `POST /api/mcp/install-skill`，执行 `npx skills add` 分发 Skill 到选定的 AI Agent
- **Settings Skill 语言切换** — MCP → Skills 区域新增语言切换按钮（EN / 中文）
- **新增 MCP Agent** — amp, codex, github-copilot, kimi-cli, opencode, warp

### 变更
- **Onboard 端口分离** — 首次 onboard 使用临时端口（9100+），不再占用用户配置的正式端口；re-onboard 复用已运行的服务
- **needsRestart 逻辑修正** — 首次 onboard 始终 restart（临时端口 → 正式端口），re-onboard 仅在配置变更时 restart
- Step 3 端口提示图标从 ⚠️ 改为 ℹ️，文案改为"完成配置后服务将以这些端口启动"

### 修复
- **isSelfPort 误判** — 设置 webPassword 后 `/api/health` 返回 401，旧逻辑未识别为 MindOS 服务，导致 re-onboard 误启新进程
- **CLI selectedTemplate 作用域错误** — 已有知识库时模板变量未赋值，Skill 安装始终用 `en`

---

## v0.4.0 — 插件架构重构 + CLI UX 增强 (2026-03-14)

### 新增
- **插件架构 4 阶段完成** — renderer 目录拆分 → manifest 自注册 → codegen auto-discovery → lazy loading
- **codegen 脚本** — `scripts/gen-renderer-index.js` 自动扫描 `manifest.ts` 生成 `index.ts`（142 行 → 23 行）
- **Lazy Loading** — 所有 10 个 renderer 改为 `React.lazy` + `Suspense`，按需加载
- **CLI 更新检查** — `start`/`dev`/`doctor` 启动时非阻塞检查 npm 最新版本，24h 缓存，`MINDOS_NO_UPDATE_CHECK=1` 可禁用
- **`--version` / `-v`** — 输出 `mindos/0.4.0 node/v22 linux-x64` 格式
- **`--help` / `-h`** — 全局帮助（exit 0）
- **`config unset <key>`** — 删除配置字段，支持 dot-notation
- **`config set` 类型推断** — `true`/`false`/`null`/空字符串/数字自动转换
- **`mindos sync` 子命令校验** — 未知子命令报错 + 显示可用列表
- **setup 配置确认** — `mindos onboard` 写入前展示配置摘要，Y/n 确认
- **统一 debug 模块** — `bin/lib/debug.js`，`MINDOS_DEBUG=1` 或 `--verbose` 启用
- **deps 增量检测** — `ensureAppDeps` 基于 `package-lock.json` hash 判断
- **MCP/Skills API** — `/api/mcp/*` + `/api/skills` 端点
- **FindInPage** — 文件视图内 `⌘F` 搜索高亮
- **UpdateBanner** — GUI 更新提示横幅

### 变更
- **新增 renderer = 新建目录 + manifest.ts**，零侵入已有文件
- 启动信息精简，移除冗长 MCP JSON block
- `pkill` 精确化，优先 `lsof -ti :PORT`
- `run()` exit code 透传
- NO_COLOR / FORCE_COLOR 遵循 CLI 标准

---

## v0.3.0 — CLI/GUI Setup 分离 + 浏览器引导 (2026-03-14)

### 新增
- **SyncStatusBar** — 侧栏底部常驻同步状态条（状态圆点 + 文字 + Sync Now 按钮）
- **SyncDot / MobileSyncDot** — 折叠侧栏和移动端的同步状态指示
- **Settings → Sync 空状态引导** — 未配置同步时展示 3 步设置教程 + 特性清单
- **Onboarding 同步提示** — 新用户引导页底部增加 `mindos sync init` 提示卡片
- **CLI onboard sync 步骤** — `mindos onboard` 完成后询问是否配置 Git 同步
- **`mindos doctor` sync 检查** — 健康检查新增第 8 项：同步状态诊断
- **启动时打印 sync 状态** — `mindos start/dev` 启动信息中展示同步状态行
- **同步恢复 toast** — 从 error/conflicts 恢复为 synced 时自动弹出提示
- **sync-status 测试** — 17 个测试覆盖 `timeAgo` 和 `getStatusLevel`
- **PWA 支持** — manifest.json、Service Worker、应用图标
- **`/api/init` 端点** — Onboarding 模板初始化 API
- i18n：新增 `sidebar.sync`、`settings.sync`、`onboarding.syncHint` 词条（en + zh）

### 变更
- `SyncTab` 导出 `SyncStatus` 接口和 `timeAgo()` 供 SyncStatusBar 复用
- `SyncTab` 冲突列表增加可点击文件链接 + 远程版本查看入口
- `SettingsModal` 支持 `initialTab` prop，侧栏点击可直接跳转 Sync tab
- `Sidebar` 集成 `useSyncStatus` 共享轮询 hook
- wiki/ 目录从自由命名重组为编号命名（00-xx）

### 修复
- `useTick` 回调变量名 `t` → `n`，避免与 `useLocale` 的 `t` 混淆
- `useSyncStatus` 的 `stop()` 补充 `intervalRef.current = undefined` 清理
- `mindos doctor` sync 检查增加 try/catch 防止 `getSyncStatus` 异常导致崩溃

---

## v0.2 — CLI 模块化 + 组件拆分 + Git 同步 (2026-03-14)

### 新增
- `mindos sync` — Git 自动同步（init/status/now/on/off/conflicts）
- `mindos open` — 一键浏览器打开 Web UI
- `mindos token` 增强 — 多 Agent 配置输出
- Settings → Sync Tab — Web UI 同步管理面板
- `/api/sync` REST API

### 变更
- `bin/cli.js` 从 1219 行拆分为 13 个 lib 模块 + 主入口 (~742 行)
- `CsvRenderer` 从 693 行拆分为 68 行 + 6 子文件
- `SettingsModal` 从 588 行拆分为 182 行 + 8 子文件
- `scripts/setup.js` 新增 Step 7 启动方式选择（daemon/foreground）

### 修复
- MCP CLI 4-bug 链修复（npm global install + 命令路由 + -y 交互 + args 解析）
- `.next` 清理改为完整目录清理，防 stale artifact

---

## v0.1.9 — 构建修复 (2026-03-14)

### 修复
- clean 整个 .next 目录防止 stale artifact 错误

---

## v0.1.8 — 营销素材 + CI (2026-03-13)

### 新增
- Landing Page 更新
- Marketing 素材
- CI workflow 优化

### 变更
- CLI 初步模块化拆分（bin/lib/ 结构建立）
