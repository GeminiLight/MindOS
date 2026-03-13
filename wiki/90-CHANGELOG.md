<!-- Last verified: 2026-03-14 | Current stage: P1 -->

# 变更日志 (CHANGELOG)

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
