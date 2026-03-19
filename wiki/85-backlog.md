<!-- Last verified: 2026-03-18 | Current stage: P1 -->

# Backlog

> 临时 bug、技术债、改进想法。解决后移除或转入对应 stage 文件。

## Bug

- [x] **`mindos update` 端口硬编码**：重启后健康检查轮询 `localhost:3000`，但用户实际端口可能不是 3000，导致"did not come back up in time"误报。修复：直接从 config 文件读 `port` 字段；顺带将 `waitForHttp` 探测路径从 `/` 改为 `/api/health` — v0.5.2
- [x] **进程生命周期 7-bug 链**：stop/restart 模块连环 bug（PID 不完整、端口清理跳过、env 继承覆盖、config 新旧端口不分、lsof 环境差异、ss 子串误匹配、health 被 auth 拦截）。详见 `wiki/81-postmortem-process-lifecycle.md` — v0.5.7
- [x] **Onboard check-port 自回环误报端口占用**：`http://localhost:3013/setup` 配置端口时，3013 被报为"已被占用"。原因：server-to-self HTTP 回环在 Next.js 单线程模式下超时。修复：从 `req.nextUrl.port` 直接判断 self，跳过网络自检。详见 `wiki/80-known-pitfalls.md`
- [x] **云同步 P0 可靠性/安全 6 项修复**：O1 instrumentation.ts daemon 自启动 + O2 进程退出 flush + O3 push 失败重试 + O4 token 安全统一 + O5 .gitignore 自动创建 + bonus `now` action 冲突处理统一。详见 `wiki/specs/spec-kb-cloud-sync.md` 优化路线图 P0 节
- [x] **Git Sync 可靠性 4 项修复**：B1 credential approve 假成功 → 加 fill 验证 + fallback；B2 首次 push 无 upstream → `push -u origin HEAD`；B3 冲突文件写入失败标记 `noBackup`；B4 config/state 原子写入。详见 `wiki/specs/spec-sync-reliability.md`
- [x] **systemd daemon install 后不启动服务**：`systemctl --user enable` 只创建开机自启 symlink，不启动。launchd `bootstrap` 会自动启动，但 systemd 需要显式 `start`。导致 `mindos start --daemon` 在 Linux 上永远超时 — v0.5.15

## 技术债

> 按优先级排序（高 → 低）。已完成项折叠在末尾。

> 当前无未完成技术债 🎉

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

### 🟡 中优先

- [ ] **I4：CLI per-command `--help`** — `mindos start --help` 显示子命令选项。与 I1 一起做，CLI 专业度提升
- [ ] **I5：首次使用引导流程** — 检测新模板 → 展示知识库结构 → 引导 AI 提问 → 引导配置 Sync。激活率关键路径，但工作量较大
- [ ] **I6：首页 Plugins 更好的展示方式** — 当前插件列表平铺，缺乏分类和预览
- [x] **I6.5：Skill 管理面板改进** — 分组显示（Custom/Built-in）+ 搜索过滤 + 全文查看（read API）+ 内联编辑 + 预填模板创建（General/Tool-use/Workflow）+ Markdown 渲染。解决"不知道给新 agent 提供什么信息"的 pain point
- [x] **I7：文件视图 topbar 文件图标** — Breadcrumb 组件已有 `FileTypeIcon`（.csv → Table，.md → FileText，目录 → Folder）
- [ ] **I8：Skill 渐进式加载** — SKILL.md 瘦身为 loader（~30 行），规则文件存到知识库 `.agents/skills/`，支持热更新 + 用户个性化 + 主动智能 + 可演化学习。[spec](./specs/progressive-skill-loading.md)

### 🟢 低优先（等需求驱动）

- [ ] **I9：Onboarding 端口分离** — Setup wizard 用临时端口，完成后按配置端口重启。体验改善明显但改动范围大（CLI + GUI + 进程管理），当前 restart 方案可用
- [ ] **I10：目录视图卡片密度优化** — 文件夹 vs 单文件调整大小，等用户反馈
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
