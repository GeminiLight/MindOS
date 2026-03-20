<!-- Last verified: 2026-03-20 | Current stage: P1 -->

# Backlog

> 临时 bug、技术债、改进想法。解决后移除或转入对应 stage 文件。

## Bug

- [x] **Agent 框架迁移 Vercel AI SDK → pi-agent-core** — 完成 6 阶段迁移（Phase 0-5）。Spec v2 所有 6 个设计缺陷已修复。涉及 7 文件改写 + 完整 SSE 协议重定义。详见 `wiki/specs/migrate-to-pi-agent.md` — v0.6.0

## 技术债

> 按优先级排序（高 → 低）。已完成项折叠在末尾。

- [x] **测试文件适配 pi-agent-core**：`__tests__/core/context.test.ts` 和 `__tests__/core/tools.test.ts` 已适配 `AgentMessage` + 新 `compactMessages` 签名。511 tests passing.
- [x] **App 端 skill-rules.md 注入**：route.ts 从用户知识库 `.agents/skills/{name}/` 读取 `skill-rules.md` + `user-rules.md` 并注入 system prompt。支持中英文切换、空文件跳过、截断标志。详见 `wiki/specs/spec-app-skill-rules-injection.md`
- [x] **AIP-001 统一错误处理**：`MindOSError` 类 + 12 个 `ErrorCodes` + `apiError()`。core/ 13 处 throw 已迁移，API 统一返回 `{ ok, error: { code, message } }` 格式
- [x] **AIP-002 性能监控面板**：`MetricsCollector` 单例 + `GET /api/monitoring` + Settings Monitoring tab（系统/应用/知识库/MCP 指标，5s 轮询）
- [x] **AIP-003 增量搜索索引**：倒排索引 + CJK bigram 分词，搜索候选集缩减后精确匹配。索引与 invalidateCache 联动自动失效

<details><summary>已完成 ✅ (18 项)</summary>

- [x] **默认端口从 3000/8787 改为 3456/8781** — 避免与 Next.js/Vite/Express（3000）和 Cloudflare Wrangler（8787）冲突。已有用户配置不受影响，仅改默认值
- [x] **日志文件自动轮转** — daemon 模式启动时检查 `~/.mindos/mindos.log`，超过 2MB 自动轮转为 `.old`，最多保留 1 个备份（上限 ~4MB）
- [x] **P1：硬编码状态色 → CSS 变量**：定义 `--success`/`--error` 变量后全局替换。涉及 15 文件
- [x] **P2：`prefers-reduced-motion` 支持**
- [x] **P3：Focus ring 统一**：`--ring` 改为 `var(--amber)`，涉及 7 文件
- [x] SearchModal / AskModal 添加 `role="dialog"` + `aria-modal="true"`
- [x] **renderer inline fontFamily 迁移** — renderers 目录已无 inline fontFamily；剩余 Editor.tsx（CodeMirror 必需）和 AppearanceTab（用户自定义）属合理用法
- [x] **模板内容优化（中英双语）** — 中英模板各 ~800 行，7 个分类目录 + README + INSTRUCTION + CONFIG 完整
- [x] **SetupWizard 硬编码色值清理**
- [x] **SetupWizard `.catch(() => {})` 静默吞错**：9 处空 catch 改为 `console.warn`
- [x] **i18n 清理 `kbPathExists` 废弃 key**
- [x] **`copyToken` setState 内副作用**
- [x] **Checkbox accent 色值统一**
- [x] **`#131210` → `--amber-foreground` 全局治理**：15 个文件 22 处
- [x] **SetupWizard 文件拆分**：~1400 行 → 10 个文件
- [x] **SetupWizard DRY + 可测试性重构**：提取 `buildAgentPayload` / `parseInstallResult` / `saveConfig` / `installAgents` / `installSkill`
- [x] **StepKB autocomplete 选中闪回**：`justSelectedRef` 修复
- [x] **StepReview retry disabled dead code**：移除不可达的 disabled guard

</details>

## 改进想法

> 按优先级排序。评估维度：用户感知影响 × 实施成本 × 当前阶段匹配度。

### 🔴 高优先（下一批做）

- [x] **I1：CLI `mindos status` 命令** — 已有 `mindos doctor` 覆盖此需求
- [x] **I2：登录页产品标语** — 已实现（`loginT.tagline` + `loginT.subtitle`）
- [x] **I3：API Key 连通性验证** — Settings AI Tab 已有 Test 按钮（`/api/settings/test-key`），支持 Anthropic/OpenAI，返回延迟和错误分类
- [x] **I3.5：`mindos uninstall` 命令** — 一条命令干净卸载（停进程 + 卸 daemon + 删配置 + 删知识库三重保护 + npm uninstall）— v0.5.15
- [x] **I12：Activity Bar + Panel 布局重构** — 左侧新增 48px Rail（Logo + Files/Search/AI + Settings/Sync），Sidebar 改为可切换 Panel。AI 对话/搜索/设置从 Modal 变为 Panel，不遮盖内容。移动端不变。[spec](./specs/spec-activity-bar-layout.md)

### 🟡 中优先

- [ ] **I4：CLI per-command `--help`** — `mindos start --help` 显示子命令选项。与 I1 一起做，CLI 专业度提升
- [ ] **I5：首次使用引导流程** — 检测新模板 → 展示知识库结构 → 引导 AI 提问 → 引导配置 Sync。激活率关键路径，但工作量较大
- [x] **I6：首页 Plugins 展示优化** — 卡片展示 description + tags，消除 RENDERER_ENTRY / PLUGIN_ENTRY_FILES 重复映射，不可用 plugin 点击提示创建引导，补齐 3 个漏注册 renderer（backlinks/workflow/diff）
- [x] **I6.5：Skill 管理面板改进** — 分组显示（Custom/Built-in）+ 搜索过滤 + 全文查看（read API）+ 内联编辑 + 预填模板创建（General/Tool-use/Workflow）+ Markdown 渲染。解决"不知道给新 agent 提供什么信息"的 pain point
- [x] **I7：文件视图 topbar 文件图标** — Breadcrumb 组件已有 `FileTypeIcon`（.csv → Table，.md → FileText，目录 → Folder）
- [x] **I8：Skill 渐进式加载** — ✅ 完成：v4 架构（2 文件），CLI 自动迁移 + App 端 skill-rules 注入。[spec](./specs/progressive-skill-loading.md)

### 🟢 低优先（等需求驱动）

- [x] **I9：Onboarding 端口分离** — Setup wizard 用临时端口（9100+），完成后按配置端口重启 — v0.5.4
- [x] **I10：目录视图卡片密度优化** — 文件夹 `p-3` + 22px 图标（紧凑），文件 `p-4` + 28px 图标（保持信息量）。Breadcrumb 增加 FileTypeIcon。FindInPage 阅读模式搜索
- [ ] **I11：局域网自动发现 (mDNS/Bonjour)** — 手机/平板自动连。P2 桌面端阶段再做更合适，[详情](./63-stage-mdns.md)

### 已完成 / 不做

- [x] **增加更多 Agent 支持** — 16 个 MCP Agent + `npx skills` 支持 40 个
- [x] **GUI RestartBlock 健康检查** — v0.5.2
- [x] **Onboarding 非空目录模板选择** — v0.5.9
- [x] 文件视图文档内搜索（⌘F）— v0.4.0 FindInPage
- ❌ **Onboarding 原生文件夹选择器** — Web 不做，桌面端再做

## 待验证

- [ ] Windows WSL 下 daemon (systemd) 是否稳定
- [ ] Git sync 在大知识库 (>1000 文件) 下的性能
- [ ] 多 Mind 实例（~/MindOS 下多个大脑，如团队/个人）— 当前用子目录满足，等团队版(P2)或用户反馈再决策
