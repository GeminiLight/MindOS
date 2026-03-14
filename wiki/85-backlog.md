<!-- Last verified: 2026-03-15 | Current stage: P1 -->

# Backlog

> 临时 bug、技术债、改进想法。解决后移除或转入对应 stage 文件。

## Bug

- [x] **`mindos update` 端口硬编码**：重启后健康检查轮询 `localhost:3000`，但用户实际端口可能不是 3000，导致"did not come back up in time"误报。修复：直接从 config 文件读 `port` 字段；顺带将 `waitForHttp` 探测路径从 `/` 改为 `/api/health` — v0.5.2

## 技术债

- [ ] 模板内容待优化（中英双语）
- [ ] SearchModal / AskModal 添加 `role="dialog"` + `aria-modal="true"`（无障碍）
- [ ] 13 个 renderer 插件文件仍使用 inline `fontFamily`，待迁移到 `.font-display`

## 改进想法

- [x] **GUI RestartBlock 健康检查**：polling 判断条件从 `d.service === 'mindos'`（依赖响应体）改为 `r.status < 500`（只看状态码），与 CLI `waitForHttp` 逻辑一致，不受响应结构变更影响 — v0.5.2

- [ ] **Onboarding — API Key 连通性验证**：Step 2 填写 API Key 后失焦自动测试（`max_tokens: 1`），显示 ✔/✘ badge 但不阻断继续；CLI 同步；Skip 模式不触发

- ❌ **Onboarding — 原生文件夹选择器（Web 不做，桌面端要做）**：浏览器 `showDirectoryPicker()` 返回的是内存句柄（`FileSystemDirectoryHandle`），规范层面无 `.path` 属性，无法获取服务器上的真实路径。Web 模式下路径补全（SPEC-OB-16）是最接近的替代方案。**桌面端**（Electron）列为必做：用 `dialog.showOpenDialog` 实现原生文件夹选择，直接返回真实路径。

- [ ] 局域网自动发现 (mDNS/Bonjour) — 手机/平板自动连
- [ ] 首页 Plugins 更好的展示方式
- [ ] Skill 工作流引导优化（持续）
- [ ] 登录页添加产品标语（`t.app.tagline`），给初次访问者提供上下文
- [ ] 目录视图卡片可按内容类型调整大小（文件夹 vs 单文件密度优化）
- [ ] 文件视图 topbar 增加文件图标前缀，与侧边栏保持一致
- [x] 文件视图增加文档内搜索（⌘F 高亮跳转）— v0.4.0 FindInPage
- [ ] CLI 增加 per-command `--help`（`mindos start --help` 显示子命令选项）
- [ ] CLI 增加 `mindos status` 命令（一览服务状态、端口、同步状态）
- [ ] 首次使用引导流程：检测新模板 → 展示知识库结构 → 引导 AI 提问 → 引导配置 Sync

## 待验证

- [ ] Windows WSL 下 daemon (systemd) 是否稳定
- [ ] Git sync 在大知识库 (>1000 文件) 下的性能
- [ ] 多 Mind 实例（~/MindOS 下多个大脑，如团队/个人）— 当前用子目录满足，等团队版(P2)或用户反馈再决策
