<!-- Last verified: 2026-06-12 | Current version: v1.1.8 -->

# 变更日志 (CHANGELOG)

## Unreleased

### Runtime / Agents

- **Pi thinking effort 与运行时升级**：Pi 依赖升级到 `0.81.1` 并迁移到 `ModelRuntime` / `Models` API；MindOS runtime 现在按具体模型暴露并执行 `off`、`minimal`、`low`、`medium`、`high`、`xhigh`、`max`，Chat composer 会按 provider/model 记忆选择并在模型能力变化时安全夹取。
- **Runtime 诊断面板可视化**：Agents / Agent 页新增 Runtime Diagnostics，直接展示 catalog、readiness、命令解析、能力矩阵与诊断缺口，方便排查 Codex、Claude Code、MindOS 与 ACP runtime 的兼容状态。
- **Artifacts / Preview 工作流可视化**：Agents / Agent 页新增 Artifacts / Preview 面板，统一展示 runtime artifact readiness、指针式 artifact 预览和 Agent 文件变更入口，方便从 ledger 跳到文件或变更审阅。
- **Agent runtime 基础能力收口**：新增 runtime catalog 与 readiness/capability matrix，统一展示本机 Codex、Claude Code、ACP 等 runtime 的安装、可用性和能力状态。
- **ACP 命令入口更完整**：ACP runtime 暴露的 `available_commands` 会进入 Ask SendBox 与命令面板，支持从 UI 直接触发 agent 提供的命令能力。
- **ACP 会话继承 MCP 上下文**：ACP session 现在会继承 MindOS MCP session 信息，减少跨 runtime 对话时上下文丢失和工具态不一致。
- **Artifact ledger 改为指针式记录**：runtime artifact 只记录 archive pointer 与 run 索引，不代存完整历史，为后续预览、文件变更面板和跨 runtime artifact 工作流打基础。
- **Extension manifest v0 解析**：新增 AionUI 风格 manifest/parser 基础，后续可把 `contributes` 转成真实扩展入口与安装前检查。
- **Runtime extension 预检与安装**：新增 product-owned `agent-runtimes/extensions` API，支持只读 preflight、显式确认安装、ACP adapter 安全写入与 catalog/surfaces 展示；manifest 中的 lifecycle、skill、assistant、MCP 等贡献仍只登记不执行、不复制。
- **ACP adapter output contract**：ACP adapter metadata 与 AionUI-style extension manifest 可声明 `outputKinds` / `outputCapabilities`，runtime catalog、adapter projection、artifact/readiness projection 会据此识别 diff、artifact、checkpoint、branch、PR 等可审阅输出；未声明的通用 ACP adapter 仍保持 text-only 并显示兼容缺口。
- **Runtime control plane backend primitives**：新增 `agent-runtimes/control-plane` API 与 `<mindRoot>/.mindos/runtime-control-plane.json`，提供 schedule registry、approval queue、wake/failure audit、team mailbox 和 task-board 的安全后端基座；当前只保存安全摘要和指针，不执行 cron、不自动批准权限、不做 UI。

### UI

- **标签栏微调**：相邻标签之间加入细分隔线（贴近激活标签一侧自动隐藏，由其自身边框分界）；新建（＋）与溢出（⌄N）按钮从整行垂直居中改为对齐标签中线，不再悬浮在标签上方。

### Skill 管理

- **GUI skill 操作真实传导到下游 Agent**：Settings 与 Agents 页的 per-agent 开关现在通过统一矩阵读写真实 skill 链接，支持 link / unlink / disable-native / enable-native，不再只更新 UI 状态或旧记账字段。
- **统一 skill × agent 事实源**：新增 `GET /api/skills/matrix`，以各 agent skill 目录中的链接/本体/停放状态作为唯一事实源；Settings、Agents by-skill、Agents by-agent 与 Agent 详情页消费同一数据模型。
- **跨平台链接与安全卸载**：创建链接时按 symlink → Windows junction → 标记副本 fallback；卸载只删除托管链接或 `.mindos-managed` 副本，拒删用户手放的真实目录。
- **Agent 自有技能可停用且可恢复**：agent 自有 skill 支持移入 `.mindos-disabled` 暂存并从矩阵恢复，避免“停用即消失”或误删 agent 原生文件。
- **Skill 矩阵读接口去副作用**：`GET /api/skills/matrix` 不再迁移或清空旧 `installedSkillAgents[]`，也不会在只读页面访问时改写下游 agent skill 目录；用户改过的 legacy copy 不再写 `.mindos-managed`，后续 unlink 会按用户自有目录拒删。
- **MCP 安装去副作用**：`/api/mcp/install` 不再隐式拷贝 skill 或写入旧 `installedSkillAgents` 记账，安装成功后的 skill 绑定统一走矩阵接口。
- **stdio MCP packaged runtime 修复**：打包运行时缺少协议构建脚本时不再强制 rebuild；构建提示改走 stderr，避免污染 JSON-RPC stdout。

## v1.1.8 (2026-06-12)

### 修复

- **`npx mindos start` 干净安装崩溃**：二进制平台包的嵌入 runtime 归档此前整体排除了 `_standalone`，丢失文档抽取运行时，导致 start 误入源码构建路径并崩溃（影响 1.1.7 全部二进制平台包）。现归档保留按依赖闭包裁剪后的抽取运行时，构建期断言防回归；打包 runtime 即使缺抽取运行时也只降级 PDF/DOCX 导入、不再尝试源码构建。
- **二进制安装 DOCX 导入一直失效**：Bun 编译二进制不解析外部 node_modules 的裸包名 require，mammoth 加载失败被报成「无法解析此 Word 文档」（影响全部历史二进制版本）。现打包时把 `extract-docx.cjs` 预打包成自包含单文件，DOCX/DOC 导入在二进制安装下恢复可用。
- **旧版 Mac 桌面壳标签栏错位 / 加号点不动**：桌面壳 ≤ v0.3.24 注入的 28px 拖拽带与新版 46px 标签栏行叠加，吞掉 tab strip 点击并把面板头画在标签上。Web 端检测到旧壳（无 `macTitlebarRow` 能力）时退回旧布局，新壳与浏览器不受影响。
- **点击 rail logo 误入回响页**：恢复 `/` 首页内容（不再跳转 echo）。

### UI

- **Rail 顺序调整**：回响（Echo）入口移到搜索下方（收集箱、Mind、搜索、回响、Agents）。

## v1.1.7 (2026-06-12)

### 性能（本次主线：perf-hardening）

- **首屏体积大幅瘦身**：highlight.js 与 react-markdown 移出首屏 bundle 按需加载；i18n 词典按模块拆分，中文资源只在中文环境下发，非中文用户不再下载整套双语文案。
- **启动更快**：CLI 子命令改为懒加载，`mindos --version/--help` 与冷启动不再加载全部命令实现；Desktop shim 准备工作延后到真正需要时执行。
- **大文件树不再卡顿**：FileTree 对大目录启用虚拟化渲染，面板拖拽时的重排开销显著降低。
- **对话流式渲染隔离**：Ask 页流式 token 更新被隔离在消息区，不再触发整页 re-render，长回复期间输入与侧栏保持流畅。
- **空闲时不再盲目轮询**：前端刷新改为事件驱动 + 严格的空闲轮询预算，后台标签页 / 无操作时几乎不发请求。
- **服务端热路径缓存**：目录树缓存、链接索引、monitoring 版本缓存；搜索索引改为写时失效 + 热路径缓存；变更/审计/会话日志改为可追加 JSONL，避免大 JSON 重写。
- **入口跳转更快**：`/` 等入口重定向由代理直接回 307，省掉一次完整页面渲染。

### Web / Desktop UI

- **标题栏行与窗口拖拽区重构**：mac 标题栏带改为 tab-row 几何布局（Phase 1/2），新增工作区 tab strip 与 `/chat/[sessionId]` 路由；根治 fixed titlebar 行遮挡下方按钮点击的问题。
- **并发对话**：聊天会话支持后台流式运行与历史指示，切走再切回不丢进度。

### 稳定性 / 安全

- **修复 git hook 环境下的高危行为**：hook 导出的 `GIT_DIR` 等变量可能让 MindOS 内部 spawn 的 git 操作错指向真实仓库（实际事故），现已在产品与测试两层全量剥离这些变量并加回归测试。
- **发布脚本加固**：standalone 验证支持服务端 307 跳转；修复 supertest 临时端口被本机其他进程劫持导致的偶发测试失败。

## v1.1.6 (2026-06-12)

### Agents / 本地助手

- **本地助手库**：assistants 从本地 registry 加载，助手库整理与 agents / inbox 工作流细化。
- **助手写入收口**：assistant 的文件写入统一经由 product server 路由，权限与审计口径一致。

### Web / Desktop

- **Rail 点击不再闪烁**：导航采用乐观 pending 状态，消除点击瞬间的闪烁。
- **Desktop 安装加固**：Windows / macOS / Linux 安装与升级行为加固（含 DESKTOP_HOME 拆分与 Rosetta smoke 验证）。
- **Standalone runtime 减重**：发布产物剔除嵌套 dev packages。
- **AI 设置页打磨**：设置 UI 细节优化；超大源码文件按模块拆分（工程健康）。

## v1.1.5 (2026-06-11)

### Runtime / Local Agents

- **Claude Code bridge 状态可见**：Claude Code runtime 现在区分 SDK bridge 与 CLI fallback，Ask Panel 会展示当前桥接方式，方便判断用户本机到底走的是 SDK 还是本地 CLI。
- **Codex 错误展示收敛**：Codex app-server / optional dependency / Node stack 失败会被压缩成用户可理解的短错误，不再把长堆栈直接塞进 runtime 下拉和对话流。
- **Agent runtime API 兼容增强**：`/api/agent-runtimes` 与 Product Server runtime health 增加 bridge metadata，并保留旧 dist/runtime 的兼容推断路径。

### Desktop / Runtime 发布

- **Desktop installer 加固**：Windows NSIS installer 增加旧进程/旧安装目录清理逻辑，Electron builder 明确引用安装脚本，减少升级残留导致的启动失败。
- **Desktop IPC 与导航安全增强**：主进程增加 trusted IPC / navigation guard，限制 renderer 与外部链接入口，降低 packaged app 中误触不可信地址的风险。
- **Node runtime 准备更稳**：Desktop runtime 准备流程补强 Node 下载、校验、私有 runtime 解析和 PATH 处理，发布 smoke 会输出更明确的诊断。
- **Runtime latest 发布顺序修复**：`runtime-latest` 先上传版本 tarball，再发布 `latest.json`，最后清理旧 tarball，避免客户端拿到指向缺失 asset 的 manifest。
- **公共仓同步增强**：dev → public sync 会同步版本 tag，并在公共仓触发 runtime/npm workflows；发布验证需分别检查 public runtime artifact 与 npm registry。

### Inbox / Web Clip

- **网页剪藏更健壮**：Inbox clip 对 HTML/PDF、HTTP 错误、解析失败和 Unicode 内容增加覆盖，失败时返回更稳定的错误语义。

### Settings

- **Embedding / Search 设置拆分**：Embedding Search card 抽出更清晰的状态和测试覆盖，降低设置页后续迭代时的回归风险。

### Git Sync / Settings

- **Paused 状态优先级修复**：暂停 auto-sync 后仍会显示冲突、错误、未知 upstream 状态和本地待上传改动，不再用单纯 Paused 卡片盖住真正需要处理的问题。
- **初始化进度语义修复**：首次配置 Git Sync 时隐藏进度不再伪装成取消；后端初始化仍在运行时，Settings 会显示后台进行中并阻止第二次 Connect。
- **恢复与保护增强**：`ssh://git@host/org/repo.git` 远程地址在 Settings、Product API、CLI 中都可用；`.gitignore` 保存会补回 `*.sync-conflict` / `INSTRUCTION.md`；冲突预览失败时仍可选择 Keep local。
- **状态入口细节修复**：`unpushed: "?"` 不再显示“已备份”，手动 Sync 后进入 unknown 也不再弹成功；窄屏 Sync Popover 会限制在 viewport 内。
- **`.gitignore` 同步边界修复**：保存排除规则后，已经被 Git tracking 但现在命中 ignore 的文件会从后续同步中移除，同时保留本机文件；`.gitignore` 自身会继续被 tracking，避免宽规则误删同步规则。
- **冲突解决上传更可信**：Settings 里 Keep local / Keep remote 只提交当前冲突文件，不会顺手上传无关 staged/dirty 文件；如果已有旧的未推送 commit，MindOS 会先本地解决并提示用户显式 Sync now，而不是偷偷推整条分支。

## v1.0.19 (2026-06-09)

### Git Sync / Settings

- **Reset / 重新配置语义修复**：`sync reset` 不再被残留 Git `origin` 误判为 paused/configured，Settings 会回到真正的重新配置入口；`sync off` 仍保留 paused 仓库元数据。
- **Reconfigure 失败回滚**：重新配置 remote 时，如果连接验证、远端 branch 校验或首轮同步失败，会恢复旧 `origin`（首次配置失败则移除临时 origin），避免用户看到“配置失败”后旧同步也被改坏。
- **同步状态可信度修复**：`unpushed` 现在同时统计未 push commits 和 dirty worktree files；冲突里选择 Keep remote、保存 `.gitignore` 等本地改动不会再假显示为已备份。
- **手动同步与 daemon 稳定性**：manual sync 遇到非冲突 pull 失败会保留并抛出错误，不再被后续 push 成功清掉；daemon 并发 start 去重，活 pid 持有的 sync lock 不会因为时间久被当成 stale 清理。
- **Sync init/auth 加固**：初始化时会补齐 repo-local Git identity，避免用户没配置全局 `user.name/user.email` 就无法自动提交；HTTPS remote 会先剥离 username/password，再通过 credential helper 存 token，helper 无法持久化时明确失败，不再把 token 写回 `.git/config`。
- **首次同步语义修复**：远端已有内容时，`sync init` 会先 pull，再提交/推送本地待同步文件，避免显示初始化成功但本地笔记其实没有上传。
- **后台 daemon 生命周期修复**：Settings/API 里的 init/on/off/reset/interval 更新会通知同进程 sync daemon；daemon 也会轮询配置，关闭同步后自动停掉 watcher/timer，停止时清理已排队的自动提交，interval 改动不再等重启才生效。
- **SSH 与状态文案修复**：SSH 预检不再靠默认 key 文件名误杀自定义 `~/.ssh/config`、硬件密钥或平台 agent；底栏/Popover 的中文相对时间和关闭提示改为完整 i18n。

## v1.0.18 (2026-06-09)

### Git Sync / Settings

- **Sync 设置状态机收口**：Settings、底栏、ActivityBar、Popover 和移动端 dot 统一识别 paused、stale、unknown、conflicts、locked 等状态；已配置但暂停的仓库不再像未配置一样消失，刷新失败时也不会继续显示“已备份”。
- **手动同步入口统一**：所有 Sync Now 入口共享同一个 in-flight 状态；同步后会刷新最终状态，若进入冲突、错误或 stale 状态，不再弹出误导性的成功提示。
- **冲突与 `.gitignore` 体验修复**：冲突 diff 在移动端上下排列，缺少远程备份时禁用 Keep remote 并解释原因；`.gitignore` 编辑器每次打开都会重新加载，加载失败时提供 Retry，避免基于旧内容继续保存。
- **CLI/API 状态一致**：CLI `mindos sync` 会保留 paused 仓库的 remote/branch 元数据并提示 `mindos sync on`；Product API 对 sync on/off 与 interval 更新也走同一把 sync 锁，`.gitignore` 读取只在文件不存在时返回空内容，symlink/越界访问返回明确错误。

## v1.0.17 (2026-06-09)

### 设置

- **AI Provider 可重新选择和编辑**：设置面板的 provider 选择统一到 `p_*` provider entry，保留未配置 provider 的可选入口；旧配置中的 `ai.activeProvider` / `ai.provider` 会归一成可编辑 provider entry，避免用户选中某个 provider 后配置区找不到对应项。
- **Provider legacy 清理**：移除旧的 provider modal/card 路径，保留 inline provider 编辑；空名称 autosave、协议切换、已有 provider 激活、环境变量恢复都增加了回归覆盖。
- **设置保存更稳**：设置面板关闭、快速切换、重新打开时会忽略过期 GET 响应，并串行 flush 最新设置，避免旧请求覆盖新选择。

### Git Sync

- **跨进程 Git Sync 锁**：所有 Git 写入、手动 Sync Now、初始化、daemon pull/commit、`.gitignore` 保存、冲突解决和 reset 都共用 `~/.mindos/sync-locks/<mindRootHash>.lock`，避免多个 daemon / CLI / API 同时操作同一个知识库 repo。
- **锁错误语义统一**：锁冲突返回稳定 `SYNC_LOCKED`，Product API 映射为 HTTP 423；后台 daemon 抢不到锁只跳过本轮，不再污染 UI 的 `lastError`。
- **安全细节补强**：sync init token 改为通过 `MINDOS_SYNC_TOKEN` 传给 CLI，不再出现在 argv；sync status 会脱敏 HTTPS remote 中的用户名/密码；初始化分支名会用 Git 校验并按用户指定分支创建/切换。
- **冲突处理更可控**：冲突状态优先于 lastError；冲突预览/解决支持明确 `file + strategy`；解决冲突前先走 diff/preview，避免误点直接覆盖。

### Runtime / Product Server

- **Product Server settings 兼容旧 provider payload**：`/api/settings` GET/POST 会把旧 providers dict 和 protocol activeProvider 归一化，确保静态 runtime、npm runtime 和 Web UI 的 provider 状态一致。
- **本地 runtime 相关清理**：补齐 auth、tree-version、frontmatter、SSE stream、agent runtime、ACP session/subprocess 等 Product Server/runtime 侧回归覆盖，减少静态 runtime 与 Web dev path 的漂移。

### 质量

- **设置测试覆盖扩大**：新增/更新 provider selection、settings save lifecycle、sync UX、MCP settings、knowledge token copy、update badge、auth/tree-version/frontmatter 等测试。
- **已知坑文档更新**：记录 AI Provider legacy migration 和 Git Sync 跨进程锁规则，后续改设置或 sync 时必须按这些 contract 自查。

## v0.6.82+ (未发布)

### 发布与打包

- **Desktop 默认不再内置本地 embedding runtime**：HuggingFace Transformers / ONNX runtime 改为用户首次选择本地 embedding 并点击下载时安装到 `~/.mindos/local-embedding-runtime`，默认 Desktop 包和 npm runtime 不再携带这些可选依赖。
- **Desktop runtime 发布门禁增强**：新增 runtime verifier 和 packaged app smoke，发版前检查 MCP bundle、Next standalone 依赖闭包、fatal error pattern，以及默认包内不得出现 optional HuggingFace/ONNX runtime。
- **Next standalone 依赖闭包修复**：`prepare-mindos-bundle` 在复制 Next runtime deps 后再递归补齐 transitive dependencies，避免 `postcss -> nanoid`、`react-dom -> scheduler` 等后引入依赖缺失。

### 架构

- **v1 package domain layout**：`packages/` 从平铺的 `packages/<pkg>` 收敛为 `packages/<domain>/<pkg>`，当前域为 `foundation`、`knowledge`、`retrieval`、`protocols`。包名和 import surface 保持稳定，目录结构更清楚地区分基础设施、知识库领域、检索能力和外部协议。
- **runtime-first 架构方向**：OpenCode 调研文档已更新为 MindOS 的演进原则：先做强 runtime，再让 Web/CLI/Desktop/Mobile 成为薄客户端，协议、SDK、插件能力按独立契约维护，避免为了目录美观拆出无主 package。
- **v1 package 完整度：ACP 核心迁移到 `packages/protocols/acp`**：Agent Client Protocol 的类型、注册表、Agent descriptor、安装探测、subprocess 生命周期和 session 管理已从 Web-local 代码抽成 workspace package。Web 侧仅保留 settings 注入、A2A bridge 和知识库工具适配。
- **发布清单补齐**：根 npm package 的 `prepack` 会先构建 `@mindos/acp`，`files` 精确包含 ACP/MCP 的运行时产物和必要源码，避免 ACP core 缺包；`packages/web/.npmignore` 也已补齐，Web tests、Vitest/ESLint config、tsbuildinfo、缓存和 nested `node_modules` 不再混入 tarball。
- **OpenCode 式 workspace 扁平化**：README、CLI docs、Supported Agents 和系统架构 Wiki 已按单一 `packages/` 源码根更新；Web/Desktop/Mobile/Browser Extension/CLI/Tauri spike 都是 `packages/*` sibling package，Agent 支持矩阵补齐 Hermes（YAML `mcp_servers`）。

### 修复

- **Inbox Agent 使用 Settings 默认模型**：修复 Settings 已配置 active provider/API key 时，Inbox Agent 仍误提示需要配置 API key 的问题；AI 可用性检查现在复用 Settings 新 provider 结构，支持 env fallback。
- **Inbox 切回 Wiki/其它页面不再卡住侧栏**：修复从 `/capture` 离开后左侧仍停留在 Inbox panel 的 route 状态竞态，切回 Wiki/Agents/Explore/Echo 时会恢复对应侧栏。
- **v1 发布自举修复**：`prepack` 不再删除 `packages/web/node_modules`，重复执行 `npm pack` 不会因为缺少 `next` 失败；Web 脚本解析、Skill 内置冲突检测、community plugin fixture 下载和 `mindos update` fallback build 路径已统一到 `packages/web`。

**跨模块 Bug 审计 (2026-04-13)**

- **🔴 安全：trash.ts 路径遍历**：`moveToTrash` / `restoreFromTrash` / `restoreAsCopy` 未使用 `resolveSafe()`，攻击者构造的 `../../` 路径可将 mindRoot 外的文件移入回收站。已改为 `resolveSafe()` 校验。Desktop runtime 副本同步修复。
- **🔴 数据丢失：stream-consumer tool_end 静默丢弃**：当网络抖动导致 `tool_start` SSE 事件丢失时，对应的 `tool_end` 被静默忽略，用户看不到工具执行结果。改为 `findOrCreateToolCall()` 按需创建。
- **🟡 竞态：killAllAgents / reapStaleSessions Map 迭代中删除**：迭代 `Map.values()` 时调用 `delete()` 导致跳过后续条目。改为先收集快照再迭代。
- **🟡 闭包：useAskChat modelOverride 未入依赖数组**：用户切换 model override 后发送消息，请求仍使用切换前的模型。
- **🟡 竞态：deleteFile TOCTOU**：`existsSync` 和 `unlinkSync` 之间文件可能被删除。改为直接 `unlinkSync` 并 catch `ENOENT`。
- **🟡 错误契约：convertToSpace 抛原始 fs 错误**：`writeFileSync` 失败时抛 `EACCES` / `ENOSPC` 而非 `MindOSError`。加 try-catch 包裹。
- **🟡 诊断：ACP npx 网络错误信息不明确**：中国等网络受限环境中 Claude Code ACP 启动失败，错误信息只显示 "initialize failed"。增加 npm 网络错误的专门诊断分支。

**跨平台路径标准化 (2026-04-13)**

- **🔴 Windows 路径断裂**：`tree.ts` 的 `path.relative()` 在 Windows 上返回 `\` 分隔路径，导致整个系统的 `FileNode.path` 在 Windows 上无法被 `split('/')` 正确分割。添加 `toPosix()` 函数在源头统一为 `/`。
- **🟡 路径分割**：`space-scaffold.ts`、`agent/tools.ts` 的 `split('/')` 改为 `split(/[/\\]/)` 兼容两种分隔符。
- **🟡 basename 提取**：`active-recall.ts`、`compile.ts` 的 `split('/').pop()` 改为 `path.basename()`。
- **🟡 返回路径**：`fs-ops.ts` 的 `renameFile` / `renameSpaceDirectory` 返回值加 `.replace(/\\/g, '/')`。
- **🟡 Windows symlink**：`web-search-config.ts` 的 `symlinkSync` 在 Windows 上需要管理员权限，增加 `copyFileSync` fallback。

### 性能优化

- **搜索正则缓存**：`countTermOccurrences` 每次搜索对每个文件 × 每个词都重新编译正则。改为缓存编译后的 RegExp（带 500 条上限防内存泄漏），搜索查询加速 ~15-30%。
- **文件列表比较**：`sameFileList` 从双排序 O(N log N) 改为 Set 查找 O(N)。
- **CSV 追加增量更新**：`appendCsvRow` 从全量 `invalidateCache()` 改为 `invalidateCacheForFile()`，避免每次 CSV 追加后重建整个搜索索引。

## 未发布 (v0.6.8 - v0.6.65)

> **注**：v0.6.8 ~ v0.6.65 的 58 个版本需要补充详细 changelog。当前文档涵盖关键改动，完整历史见 git tags。

### [v0.6.65] - 2026-04-10

**主要改动：**
- Save Session 功能完成（三种模式：Full / Digest / Organize）
- Daily Echo 改进（实时对齐分析、i18n 完整）
- IM 集成完成（8 个平台）
- Ask Panel UX 优化（Portal Popover、Session Switcher 增强）
- 架构审查完成（API 路由 65、工具 34、Component 189）
- CLI 命令扩展（24 个命令，bin/ 总 7,890 行代码）

## v0.6.7 (旧版本历史)

### 架构重构：巨型文件拆分

> 8 个 700+ 行组件/路由模块化拆分，新建 22 个专职模块。

**后端 API 路由：**
- **ask/route.ts** 1,524 → 1,050 行 (-31%)：提取 `sse/events`、`skill-resolver`、`non-streaming`、`file-context`、`request-utils` 5 个模块
- **file/route.ts** 451 → 159 行 (-65%)：提取 `file/handlers` 模块（read/write/rename/delete/list/create）
- **sync/route.ts** 295 → 233 行 (-21%)：提取 `sync-config` 辅助模块

**前端组件：**
- **TodoRenderer** 889 → 137 行 (-85%)：提取 `parse-todos.ts`（325 行纯逻辑）、`FilterBar.tsx`（106 行）、`SectionCard.tsx`（354 行）
- **AgentDetailContent** 1,188 → 741 行 (-38%)：提取 6 个子组件（Header/SkillSection/McpSection/SpaceSection/ConfigSection/SkillEditor）
- **UpdateTab** 868 → 357 行 (-59%)：提取 `DesktopUpdateCards.tsx`（DesktopCoreCard + DesktopShellCard）
- **McpTab** 713 → 293 行 (-59%)：提取 `McpConnectGuides.tsx`（ConnectCard + CliGuide + McpGuide）
- **AgentsPanelA2aTab** 746 → 297 行 (-60%)：提取 `AcpRegistrySection.tsx`（AcpRegistrySection + AcpAgentCard）
- **FileTree** 861 → 619 行 (-28%)：提取 `hidden-files.ts`（store）、`FileTreeContextMenus.tsx`（3 个菜单组件）、`useDirectoryDragDrop.ts`（hook）
- **SyncTab** 775 → 556 行 (-28%)：提取 `SyncEmptyState.tsx`（初始化向导）
- **AgentsSkillsSection** 869 → 655 行 (-25%)：提取 `AgentsSkillsByAgent.tsx`（ByAgentView + AgentCard）+ 导出 `SkillsSectionCopy` 类型
- **AskContent** 771 行保持不变（hook 编排型组件，拆分反增复杂度）

**新建共享模块：**
- `lib/stores/hidden-files.ts` — localStorage 隐藏文件 store + hook
- `lib/hooks/useDirectoryDragDrop.ts` — 文件拖放 state + 5 个 handler
- `lib/parsing/parse-todos.ts` — TODO 解析器、行操作、日期、样式、计数（纯函数）

### 构建优化
- **构建与开发入口切换到 webpack**：Turbopack 16.1.x 的 `serverExternalPackages` 不影响 standalone trace（[#88842](https://github.com/vercel/next.js/discussions/88842)），且 pnpm workspace 下 dev root/symlink 解析不稳定。生产 build 与 dev 入口统一走 webpack，standalone 从 200MB 降至 110MB（-45%），koffi 87MB 被正确排除。
- **清理过期 mcp/node_modules**：Desktop runtime 中 73MB 的 mcp/node_modules 是 v0.6.6 esbuild 方案落地前的旧产物，重跑 prepare 脚本后替换为 1.2MB 的 dist/index.cjs
- **Desktop 安装包体积**：macOS arm64 zip 144MB → 129MB（-10%），runtime 层 198MB → 133MB（-33%）

### 修复
- **Setup Wizard MCP 端口误报**：首次安装时 check-port 错误报告 MCP 端口"已被占用"（实际是自己的进程）
- **MCP 端口竞争**：`/api/mcp/restart` 和 Desktop ProcessManager 同时操作 MCP 端口导致冲突
- **AI Organize "无更改" 误报**：PDF 上传走 `file.text()` 返回二进制乱码；AI 返回含 `<thinking>` 标签被误解析；prompt 未明确要求写入文件
- **CLI `--turbo` 参数冲突**：`mindos build --turbo` 会与硬编码的 `--webpack` 冲突，现已从 extra args 中过滤

### 新增
- **AI Organize 进度 UX**：ImportModal 内嵌进度展示（streaming 解析 + 实时文件列表），支持最小化后台运行
- **AI Organize 结果视图优化**：新增 `OrganizeNoChangesView` 组件 + `cleanSummaryForDisplay` 函数，解决"无更改"与"N 个操作"文案自相矛盾问题；服务端 `sanitizeToolArgs` 防止 SSE 序列化静默丢失

### 已知性能瓶颈
- **AI Organize 单文件上传耗时长**（30-60s）：根因是每次 organize 等同一次 5-10 轮 Agent 对话，每轮携带 30-50k tokens 上下文。主要耗时分布：LLM 多轮推理 70-90%、上下文装载 10-20%、session 初始化 1-3s、PDF 提取 1-2s。待优化方向：轻量模型专用通道、精简 organize 专用 prompt、减少 Agent 探索步数

## v0.6.0 — Agent 框架迁移 pi-agent-core + Skill 渐进式加载 v4 (2026-03-20)

### ⚠️ Breaking（内部）
- 移除 `@ai-sdk/anthropic`、`@ai-sdk/openai`、`ai` 三个依赖
- SSE 流格式从 AI SDK 私有协议切换为 MindOS 自定义 6 事件格式（`text_delta`、`thinking_delta`、`tool_start`、`tool_end`、`done`、`error`）
- `getModel()` → `getModelConfig()` 返回 `{ model, modelName, apiKey, provider }`

### 新增
- **Agent 框架迁移**：Vercel AI SDK → `@mariozechner/pi-agent-core@0.60.0` + `@mariozechner/pi-ai@0.60.0`
  - 15 个 tool 从 Zod + `tool()` 改写为 TypeBox + `AgentTool` 接口
  - 新增 `to-agent-messages.ts`：两层消息转换（Frontend → AgentMessage → pi-ai Message）
  - `transformContext` hook 封装三阶段上下文管理
  - `beforeToolCall` 写保护 + `afterToolCall` 日志
  - Loop 检测改为 `subscribe('turn_end')` + `steer()`
  - Step 限制通过 `abort()` 强制终止
  - Extended thinking 支持（`thinkingLevel`）
- **Skill 渐进式加载 v4**：4 文件 → 2 文件（`skill-rules.md` + `user-rules.md`），tool call 从 4-5 次降为 1 次
  - `mindos start` 自动迁移旧版文件

### 修复（Code Review 12 项）
- API key 闭包并发安全
- Loop 检测竞态条件
- Context compact API 失败 fallback 到 hard prune
- AgentEvent 类型安全（7 个类型守卫函数）
- 文件截断显式标志 + 警告
- OpenAI 自定义端点 API 变体配置

### 依赖变更
- 移除：`ai`、`@ai-sdk/anthropic`、`@ai-sdk/openai`
- 新增：`@mariozechner/pi-agent-core`、`@mariozechner/pi-ai`、`@sinclair/typebox`

---

## v0.5.15 — `mindos uninstall` + daemon 启动修复 + 等待 UX 优化 (2026-03-18)

### 新增
- **`mindos uninstall` 命令** — 一条命令干净卸载：停进程 → 卸 daemon → 可选删除配置目录 → 可选删除知识库（三重保护：确认 → 输入 YES → 密码验证）→ npm uninstall
- **uninstall 测试** — 13 个集成测试覆盖 abort、三重保护、config 读取时序回归、tilde 展开

### 修复
- **systemd daemon 启动失败** — `systemd.install()` 只做了 `enable`（创建开机自启 symlink）没有 `start`，导致 Linux 上 `mindos start --daemon` 永远超时。launchd 的 `bootstrap` 会自动启动，但 systemd 需要显式 `start`
- **readline 丢行** — 多个 `readline.createInterface` 实例在 piped stdin 下丢失 buffered 行。改为共享单个 rl + `line` 事件手动 buffer
- **子进程消耗 stdin** — `stopMindos`/`gateway` 的 `execSync` 用 `stdio: 'inherit'` 会让子进程（pkill/systemctl）抢占 stdin 数据。改为 `['ignore', 'inherit', 'inherit']`

### 变更
- **waitForHttp 进度提示** — 从点点点（`...........✔`）改为原地刷新的阶段提示 + 计时器：`⏳ Waiting for Web UI — building app (23s)`。三阶段：installing dependencies → building app → still building
- **waitForHttp 超时** — 默认 retries 从 120 降为 60（4 分钟 → 2 分钟）

---

## v0.5.14 — CLI 路径解析修复 + 空仓库同步支持 (2026-03-18)

### 修复
- **CLI 路径解析** — `sync/route.ts` 和 `restart/route.ts` 通过环境变量 `MINDOS_CLI_PATH` / `MINDOS_NODE_BIN` 解析 CLI 路径，Turbopack 下不再依赖 `process.cwd()` 动态解析。两个 route 统一 fallback 到 cwd 相对路径
- **空仓库 sync init** — `git ls-remote` 移除 `--exit-code`，首次同步到空 GitHub 仓库不再报错

### 变更
- `bin/cli.js` 的 `dev` 和 `start` 命令启动时设置 `MINDOS_CLI_PATH` / `MINDOS_NODE_BIN` 环境变量供子进程使用

### 致谢
- 感谢 [@yeahjack](https://github.com/yeahjack) 提交 [PR #1](https://github.com/GeminiLight/MindOS/pull/1)

---

## v0.5.12 — 默认端口变更 + 日志轮转 (未发版)

### 变更
- **默认端口** — Web 端口从 `3000` 改为 `3456`，MCP 端口从 `8787` 改为 `8781`，避免与 Next.js/Vite/Express 和 Cloudflare Wrangler 冲突。已有用户配置（`~/.mindos/config.json`）不受影响

### 新增
- **日志自动轮转** — daemon 模式（systemd/launchd）启动时，若 `~/.mindos/mindos.log` 超过 2MB 自动轮转为 `.old`，防止日志无限增长

---

## v0.5.9 — 非空目录 Onboard 优化 (2026-03-17)

### 新增
- **非空目录模板选择** — Onboarding 时检测到目录已有文件，显示 amber 提示框 + "跳过模板"（默认）/ "选择模板合并" 两个选项，避免静默跳过无反馈
- **导航守卫增强** — Setup 提交期间（`submitting` / `completed`），StepDots 步骤条和 Back 按钮同步禁用，防止用户中途跳走

### 变更
- **后端模板 guard 放宽** — `setup/route.ts` 移除 `dirEmpty` 条件，改由前端控制是否发送 template，后端依赖 `copyRecursive` skip-existing 保护
- **StepDots 组件** — 新增 `disabled` prop，支持 `disabled:cursor-not-allowed disabled:opacity-60` 视觉反馈

### 文档
- **开发洞察** — `wiki/41-dev-pitfall-patterns.md` 新增"状态变更的影响面追踪"章节（规则 6-8）
- **已知陷阱** — `wiki/80-known-pitfalls.md` 新增"变更质量 checklist"
- **Agent 协作规则** — `AGENTS.md` 新增"前端状态变更检查"条目

---

## v0.5.7 — Agent 自动检测 + README 优化 + Landing Page 刷新 (2026-03-17)

### 新增
- **Agent 自动检测** — 扫描已安装的 AI Agent，onboard 时自动预填 MCP 配置
- **WeChat 社区入口** — README 新增 Community section（二维码 + 加群引导），中英文同步
- **营销文档** — `marketing/user-growth.md` 增长飞轮策略（MCP 生态占位、搜索截流、开发者社区、被动分发）；`marketing/wechat-community.md` 微信内测群运营方案
- **MCP 请求日志** — MCP Server 新增请求日志中间件
- **project-wiki Skill 模板** — 新增 design-exploration、postmortem 模板，移除 human-insights
- **新增测试** — detect-agents、skill install、stop-restart、check-port、setup、middleware

### 变更
- **README badge 重构** — 新增 npm version（amber）+ WeChat（微信绿），去掉 DeepWiki，排序调整为 Website → npm → WeChat → License，颜色协调统一
- **Landing Page 刷新** — 内容和布局更新
- **Skill 自动安装增强** — 重试逻辑、校验、错误处理优化
- **Graceful stop** — 关停时等待进行中请求完成，额外健壮性改进
- **Restart API** — 增强错误处理
- **Renderer** — graph manifest 修复，codegen 脚本更新，新增 core flag

---

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
