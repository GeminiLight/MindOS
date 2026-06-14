<!-- Last verified: 2026-06-14 | Current version: v1.0.5 -->

# 插件系统 (Stage: Plugins)

> 详见 [./02-system-architecture.md](./20-system-architecture.md) 的渲染器部分。

MindOS 内置渲染器插件体系，通过 `registerRenderer()` 注册，用户可在 Settings 中单独禁用。

Settings > Plugins 现在按四个面板组织：

- **Installed**：管理 MindOS 内置渲染器，并查看已导入的 Obsidian 插件运行状态。
- **Community**：浏览 Obsidian 官方社区插件索引，并和当前 MindOS `.plugins/` 的本机状态对照；浏览、预检和 update plan 仍是只读，install / update 都必须显式确认后才会写入本机 `.plugins/`，默认不启用、不自动加载。
- **Import**：扫描本机 Obsidian vault，按兼容性选择插件复制到当前 MindOS `.plugins/`。
- **Surfaces**：解释插件能力最终出现在哪里，例如 Command Center、Plugin Entries、Plugin Views。

这套结构刻意区分“插件包来源”和“插件能力入口”：Obsidian 插件仍先进入 MindOS 的受限本地 host，再把 command、setting、view、diagnostic 等能力映射到明确的 MindOS surface。
当前 Obsidian 兼容插件体系的完成审计见 [reviews/obsidian-plugin-compat-completion-audit-2026-06-14.md](./reviews/obsidian-plugin-compat-completion-audit-2026-06-14.md)；旧版 2026-06-13 audit 仅作为历史基线，不再代表 Community install/update 的当前能力。
Surfaces 面板读取真实 `/api/plugins/surfaces?loadEnabled=1`，展示 mounted / catalog / recorded / blocked 状态和 command、ribbon、view、markdown、style、editor、document-renderer 等入口类型分布；它不是静态说明页。
Obsidian command hotkeys 默认仍不抢占全局键盘；Surfaces 面板提供本机确认开关，开启后只绑定已加载、可执行、无 MindOS/插件冲突且带修饰键的 command hotkeys。冲突 hotkey 继续只展示和诊断，不执行。
Obsidian editor extension 仍保持 catalog-only：Surfaces 面板现在会汇总 Browser editor gate，展示涉及插件、扩展、catalog-only 和可序列化数量。这个卡片只是兼容边界和后续迁移锚点，不是一键开启 CodeMirror host；真正挂载前必须先有浏览器沙箱、显式权限和卸载清理。

插件体系有四个 API 层：

- `/api/plugins/catalog`：统一插件清单层，返回 MindOS renderer 与 Obsidian imported plugin 的包身份、启用/加载/阻断状态、兼容性摘要和 surface 统计。
- `/api/plugins/surfaces`：统一能力入口层，返回 command、settings、ribbon、status、view、markdown、style、editor、document-renderer 等可挂载或可诊断的能力。
- `/api/obsidian/community-catalog`：Obsidian 官方社区插件索引的只读适配层，读取 `obsidianmd/obsidian-releases` 的 `community-plugins.json`，支持搜索、limit 和本机已导入状态 overlay。
- `/api/obsidian/community-catalog/preflight`：Obsidian 社区插件 release 包的只读预检层，按 `owner/repo` 读取远端 `manifest.json` / `main.js` / `styles.css` 到内存，执行 manifest 校验和静态兼容性分析；不安装、不更新、不启用、不加载，也不写 `.plugins/`。
- `/api/obsidian/community-catalog/update-plan`：已安装社区插件的只读更新计划层，复用远端 release 预检并读取本机 `.plugins/<id>` 包文件，返回版本状态、远端 package sha256 digest 和 `manifest.json` / `main.js` / `styles.css` / `obsidian-community.json` 的文件级预览；不覆盖、不删除、不写 metadata，也不修改 enabled/load 状态。
- `/api/obsidian/community-catalog/update`：已安装社区插件的显式确认更新层；后端重新下载并复用 preflight gate，要求 `confirm: true`、`expectedRemoteVersion` 和 `expectedPackageDigest`，以拦截过期预览或同版本远端内容漂移。更新只替换 package 文件和 `obsidian-community.json`，保留 `data.json`、本机额外普通文件/目录和 `.plugin-manager.json` 启用状态，跳过 symlink / 特殊文件；若旧插件已加载，会在 swap 前卸载 runtime，但不会自动加载更新后的包。
- `/api/obsidian/community-catalog/install`：Obsidian 社区插件 release 包的显式确认安装层；后端重新下载并复用 preflight gate，校验 `manifest.id`、兼容性和大小限制，通过后用 staging 目录写入 `.plugins/<id>`，记录 `obsidian-community.json` 来源元数据，但不修改 `.plugin-manager.json`，不启用、不加载、不覆盖已有插件。

Settings > Plugins 的顶部摘要、Installed 计数和 MindOS renderer 行里的 surface 数量读取 `/api/plugins/catalog`；Obsidian plugin host 的启用、加载、设置、卸载等生命周期操作仍走 `/api/obsidian-plugins`。
Community 面板按需读取 `/api/obsidian/community-catalog`，展示官方目录、本机 installed-state overlay、GitHub / 本地导入入口和按需 preflight；浏览和 preflight 不会下载落盘或写入远端插件。未安装插件只有 preflight 通过且用户再次确认时，UI 才调用 install API；已安装插件的按钮语义改为 Check update，只显示本机版本、远端 manifest 版本和版本状态，不执行 reset/overwrite。检查到可更新后，UI 可再打开 Preview plan，只读展示将涉及哪些包文件；只有用户在预览后再次确认 Apply update，才调用 update API。
Community 相关的 install / update 必须分别走 `/api/obsidian/community-catalog/install` 和 `/api/obsidian/community-catalog/update`，并要求 `confirm: true`；后端会重新执行来源校验、manifest id 校验、兼容性扫描和 staging 回滚，不能信任前端缓存的 preflight / update plan 结果。Update 额外要求本机已安装且远端版本更新，并必须带上 preview 返回的 `expectedRemoteVersion` 与 `expectedPackageDigest`；前者检测版本过期，后者检测 GitHub `HEAD` 下同版本包内容变化。
`/api/plugins/catalog` 支持 `source=obsidian|mindos-renderer` 和 `status=core|enabled|disabled|loaded|blocked|error` 查询，用于 Obsidian 式 Installed / Community / Disabled / Problem plugins 分区。
同一 API 也支持 `bucket=all|mindos|obsidian|disabled|problem`，由 catalog 层统一定义分区语义，避免 UI 和 API 各自维护 Problem / Disabled 等规则。
Installed 页面的 Plugin inventory 会把同一份 catalog 暴露成 All / MindOS / Obsidian / Disabled / Problem 视图；默认不展开重复清单，只有切换到具体视图时才显示轻量包明细。
Obsidian 来源的清单项只提供轻量 `Open` 跳转，不在 catalog 里复制生命周期按钮；点击后会聚焦并展开下方 Obsidian plugin host 的对应插件行，详细 enable / load / settings / remove 操作仍由 host 承担。
Obsidian 插件自己的 `data.json` 现在作为本地 storage 元数据进入 catalog / host，只展示存在性、大小和 JSON 有效性，不读取或暴露用户配置内容。
兼容性报告会收集所有非 `obsidian` 的 literal `require()` / `import` / `export from` / `import()` 模块引用；当前 runtime 只解析 `obsidian` shim，因此未知模块会在报告阶段进入 blocker，避免“清单看似可用、加载时才失败”的错位。
Obsidian 插件的 `styles.css` 不再只是诊断 catalog：已启用且成功加载的插件可通过 `/api/obsidian-plugins/styles` 获取 server-side scoped CSS，只挂载到 `/plugins/views` 的 `data-obsidian-plugin-view` 容器内；disabled / blocked / load failed 插件不会暴露样式内容，全局 CSS 注入仍关闭。
`/plugins/views` 是稳定的 Obsidian custom view snapshot host：它展示当前 `pluginId/viewType/sourcePath` 的 workspace context、scoped stylesheet 状态和 refresh 状态；插件安装、启用、禁用或导入触发 `mindos:plugins-changed` 后会自动刷新当前 snapshot，用户也可以手动 Refresh。它仍不把插件 DOM/function 常驻到浏览器端，复杂交互 view 需要后续 sandbox/capability gate。
从文件页打开 Plugin Entries 再进入 `Open view` 时，当前 `/view/*` 文件路径会作为 `sourcePath` 传给 `/plugins/views`，包括 `.kanban`、`.canvas` 等非 Markdown 插件扩展；Markdown editor command 的上下文仍只对 `.md` 文件启用。
Obsidian `Modal` / `Menu` 仍按安全 snapshot 展示，不把插件 HTMLElement、闭包或 DOM 事件跨 API 注入前端；带 callback 的 `Menu` 项可通过 `menuId + interactionId + itemIndex` 在 server runtime 中续接，disabled/separator/无 callback 项保持只读。覆写了 `onChooseSuggestion()` 的 `SuggestModal` 也支持受限用户选择流：UI 只展示 empty-query 下前 8 个候选，点击时通过 `modalId + interactionId + suggestionIndex` 调回 `/api/obsidian-plugins`，server runtime 只把当时展示并缓存的候选值传给插件的 `onChooseSuggestion()`。Menu 和 SuggestModal interaction 都是短 TTL、一次性消费；即使插件 callback 在产生部分副作用后抛错，同一个 `interactionId` 也不能再次执行。
这意味着 QuickAdd/模板选择/菜单选择这类轻量 Obsidian 插件可以在 MindOS 内完成“打开候选或菜单 → 用户选择 → 插件写文件或打开文件”的闭环；query filtering、键盘选择、任意 modal 按钮和复杂 DOM 事件仍需要后续更完整的 sandbox/capability gate。
社区插件目录的浏览和预检只做本机状态对照；已安装插件可以复用 preflight 做只读更新检查，显示 update available / up to date / local newer / unknown，并可查看 preview-only 的文件计划。远程 install 现在是显式确认 API：只接受 GitHub `owner/repo`，只写固定文件 `manifest.json`、`main.js`、可选 `styles.css` 和 `obsidian-community.json`，并拒绝覆盖已有 `.plugins/<id>`。
远程更新也是显式确认 API：只针对已有社区来源插件，把包文件替换到当前 MindOS root 的 `.plugins/<id>`，保留 `data.json`、本机额外普通文件/目录和 enabled state，不保留 symlink / 特殊文件，也不从网页端接受 `targetMindRoot`。若插件在当前 runtime 已加载，更新前只卸载旧 runtime 并刷新 discover；新包不会自动 load，用户仍可在 Installed host 中手动管理。
远程安装/更新写入的 `obsidian-community.json` 会作为 installed package provenance 读回 `/api/obsidian-plugins` 和 `/api/plugins/catalog`；Installed host 的插件详情会显示 Obsidian Community 来源、repo 和安装/更新日期，metadata 还记录 manifest/main/styles/package 的 sha256 digest，便于用户区分本机 vault import 与官方社区安装，也为后续 update 检查保留来源锚点。
Obsidian host 的渲染组件只保留交互状态和页面结构；runtime summary、surface routing、API 响应 type guard 等纯逻辑位于 `components/settings/ObsidianPluginHostModel.ts`，方便后续继续扩展 Obsidian lifecycle / diagnostics 而不放大单个 UI 文件。

---

## 面向人类的插件 (Human-Facing)

| 插件 | 触发文件 | 功能 |
|------|---------|------|
| Wiki Graph | 任意 `.md` | WikiLink + Markdown Link → force-directed 图谱，Local/Global 范围 |
| Timeline | `CHANGELOG.md`, `TIMELINE.md` | 日期标题 → 竖向时间轴卡片，`#tag` 提取 |
| Backlinks | `BACKLINKS.md`, `index.md`, `MOC.md` | 全库扫描引用来源 + 上下文 snippet |
| AI Briefing | `DAILY.md`, `SUMMARY.md` | 最近修改 → AI 流式生成每日简报 |

## 面向 Agent 的插件 (Agent-Facing)

| 插件 | 触发文件 | 功能 |
|------|---------|------|
| Workflow Runner | `Workflow.md`, `SOP.md` | `## Step N` → 可执行步骤卡片，单步 Run/Skip |
| Workflow YAML Engine | `*.yaml` in Workflows/ | YAML 工作流引擎：Skill/Agent 集成、可视化编辑器、单步/全量执行 |

## 应用内建能力（非插件面板）

| 能力 | 触发文件 | 功能 |
|------|---------|------|
| TODO Board | `TODO.md/csv` | checkbox → 交互看板，按 `##` 分列，变更即时写回；作为 MindOS 内建能力，不在插件面板管理 |
| CSV Views | 任意 `.csv`（排除 TODO） | Table/Gallery/Board 视图；作为 MindOS 内建能力，不在插件面板管理 |
| Agent Inspector | `.mindos/agent-audit-log.json`（兼容旧 `.agent-log.json`） | Agent 工具调用日志可视化；作为 MindOS 内建能力，不在插件面板管理 |
| Config Panel | `CONFIG.json` | 配置编辑面板；作为 MindOS 内建能力，不在插件面板管理 |
| Diff Viewer | `.mindos/change-log.json` 关联文件 | 文件变更 inline diff 可视化；作为 MindOS 内建能力，不在插件面板管理 |

## 注册机制

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 唯一标识 |
| `name` | string | 显示名称 |
| `match` | `(ctx) => boolean` | 触发条件（filePath + extension） |
| `component` | React | 接收 `{ filePath, content, extension, saveAction }` |
| `builtin` | boolean | true = 内置 |
