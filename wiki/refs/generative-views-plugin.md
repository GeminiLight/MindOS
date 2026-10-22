# 本地数据、生成式视图与统一插件

本轮已通过 PR #368 合入 main（3bdc8f3b），包含原人脉视图候选 PR #365。尚未发布 npm/桌面安装包。实际验证见 [交付记录](../reviews/review-generative-views-mvp-20261022.md)，设计依据见 [spec](../specs/spec-local-generative-views-plugin.md)。

## 记录与显示

- people：普通 Markdown。结构化接口只返回已知字段，未知/私人段落保留，首次编辑固化人物 ID。读取包含 followupState（todo/done）、最近互动正文/日期与近期互动数（最多200条解析窗口），支持写后核验；这些是只读投影，写入仍使用专用 action。
- tasks：一个项目文件夹内的 `TODO.csv`。必需 header 为 `id,title,status,dueDate,personRef,sourcePath`；状态 todo/doing/done，日期 YYYY-MM-DD 或空，personRef 为同库 `collectionId/recordId`，sourcePath 为库内相对路径。CSV 由 PapaParse 解析，支持 BOM、引号、换行；未知列保留且不可直接编辑。
- 视图登记：`.mindos/views/index.json` schemaVersion=2，collections 定义来源，views 定义显示。v1 读时内存转换，首次写前保留原始备份。移除视图不删原文件。
- ViewSpec：specVersion=1，collectionId、layout、fields、filter.all、sort、groupBy、labels、actions。固定 list-detail/table/board；board 只按任务 status 分组。字段、动作、长度、日期和值类型由服务器校验；不接受脚本和任意组件。
- 可选字段：仅 tasks 的 `x_*` 文本列，最多十个；先 preview schemaExtension，随后 schema.extend 带当前文件与 schema revision 提交，旧行新列为空。

## 统一入口

`/api/views/v2` 所有读取 private/no-store，写操作带 expectedRootId，复用现有认证和知识写入权限。

| 方法/操作 | 输入与行为 |
| --- | --- |
| GET describe / doctor / templates | capabilities、模板、字段、mutationInputs 参数契约与示例；collectionId 可选 |
| GET list | rootId、collections、views；置顶优先 |
| GET read | collectionId 或 viewId；可选 recordId、fields（逗号分隔）、offset、limit；返回 total、nextOffset；HTTP/UI 最多500，MCP默认20/最多100 |
| GET preview | draftId，返回仍有效的预览及当前记录 |
| GET operation | operationId，返回状态和提交摘要，不返回恢复正文 |
| POST create | template=people/tasks、mode=new/existing、name、folder、operationId |
| POST mutate | collectionId、action、input、operationId；更新携带 recordId、expectedRevision、expectedSchemaRevision |
| POST preview | collectionId + spec，或 schemaExtension.key；不改变业务数据 |
| POST save | draftId/name，或 viewId/expectedViewVersion + save/copy/restore/remove；save 可改 pinned/name |

六个 MCP 工具：mindos_views_describe/read/create/mutate/preview/save。CLI `mindos views` 支持对应操作、doctor/templates/list/operation/open，JSON 文件或 stdin 输入。二者共用 foundation/views-client，仅调用 Product API。旧人脉 API 的人物、互动和跟进写入转到同一核心 mutation；原会前选材、原文、CSV 导出继续复用。

## 状态与恢复

一次数据更新：验证 root/schema → 获取 operation/file lock → 校验 revision → 写 prepared 回执 → 现有 file handler 权限与原子文件替换 → 读回校验 → committed 回执 → onChanged/SSE → 客户端重读。回执在 `.mindos/views/operations`，只读接口不暴露 before/after 正文。相同 operationId 不同输入拒绝；写后中断可通过同请求重试确认；遇到其他内容变化不覆盖。

更新撤销要求文件仍是该操作的结果；不自动撤销创建和 schema 演进。恢复存储上限128MiB，满时拒绝新写入；需人工归档超过七天的已完成回执，不自动删除未知/未完成恢复证据。配置回执与 registry 同一原子替换；过期预览不会阻碍已经成功的配置请求重试。

预览保留30分钟，URL `/studio/views/preview/<draftId>`。保存后的视图无需模型继续运行。隐藏 registry 有专门监听与每秒指纹兜底；活跃视图订阅 files/views/ready 事件并每秒重读。返回的是源文件投影，无第二份记录缓存。编辑器固定打开时的版本；轮询不覆盖输入，切 root 隔离草稿，冲突保留输入。

原子文件替换不等于跨文件事务，也不约束任意外部编辑器。未经 API 的本地写入通过重读检测，极窄的外部 CAS 竞争仍是文件系统边界。Agent 名称只用于审计，不代表独立安全主体。

## 插件安装与运行时

[插件安装说明](../../plugins/mindos/README.md)包含两宿主命令。采用一个可分发目录包含两套 manifest，共享 skill/setup/launcher；没有复制业务 codec。setup 以 capabilityVersion=1 判断兼容性，复用现有 root；不执行浮动 latest 安装，不创建第二服务，不申请模型 Key。新安装须指定匹配的已验证产品及平台运行时。

宿主格式依据：[OpenAI 插件构建](https://developers.openai.com/plugins/build/plugins)、[桌面 MCP](https://developers.openai.com/plugins/deploy/desktop-only)、[Claude 插件参考](https://code.claude.com/docs/en/plugins-reference)。实际本机安装验证与完整自然语言会话测试分别记录，不能混称。

## 自然语言操作契约

`describe.mutationInputs` 提供每种动作的输入键、类型、示例和版本要求。`interaction.add` 使用 `{text,date,source?}`；`followup.update` 使用 `{text,date,completed}`，替换整条跟进，因此完成时保留原文与日期。任务 `personRef` 是 `collectionId/personId` 字符串。读取字段 `followup`、`followupState` 不直接传入 record.update。

真实 Codex 验收包含建档、互动/跟进、关联任务、生成表格/看板、界面编辑后新会话接续、可选备注字段预览及保存。插件 MCP 进程只继承宿主允许的环境变量；隔离验收应在测试 HOME 中安装/解析 runtime，不能假定父进程临时 `MINDOS_VIEWS_CLI` 自动透传。不要为连接失败更换用户的知识库。

## 在界面中日常使用

- 在「工作台 → 视图」选择人脉或项目待办模板；已有视图按类型显示图标。
- 项目待办支持当前视图搜索、状态与到期筛选（今天、逾期、未安排日期），随时清除；这些临时筛选不改变原文件或保存的视图定义。搜索仅匹配当前显示字段。
- 任务名前的完成按钮可直接完成/重新打开，成功反馈旁可撤回；支持键盘空格操作。只读视图、预览或未展示状态字段时不显示该按钮。保存失败会提示错误，可重试；不会先显示虚假成功。已完成任务不计入逾期/今天待办。
- 默认人脉详情页可切换「全部人物 / 待跟进」，并与搜索一起缩小范围；跟进已完成或没有下一步内容的人物不进入待跟进列表。
- 点击任务名编辑：任务、状态、日期直接填写；关联人物先选择资料夹，再选择姓名；备注与来源按需展开。关联失效时保留旧值，不会自动删除引用。
- 关闭编辑器会保留已经输入的草稿。保存失败也保留输入，恢复后仍用原始 revision 校验；不会静默覆盖其他 Agent 的修改。
- 「调整视图」选择列表/表格/看板、显示字段和排序方向，点击「预览」即可在同一窗口看到真实资料；「保留此视图」才更新当前布局。改变布局/字段后需重新预览。原有独立预览链接、复制、置顶和恢复布局仍可用。
- 看板省略空字段和重复状态；表格可横向滚动，姓名/任务名是编辑入口。窄屏使用纵向布局，操作保持可见。
- 「复制给 Agent 的说明」成功后显示复制反馈，再到 Codex 或 Claude Code 粘贴并补充要求。

本轮 UI 设计与验收范围见 [体验打磨 spec](../specs/spec-generative-views-ux-polish.md)。

## 工作页面与查看方式

导航以数据集合为单位：一份人脉或项目资料只出现一个工作页面，表格/看板等保存方式收在该页面内部。旧链接仍然有效，同名但不同资料不会合并。页面上的布局切换只改变当前浏览，不新增记录或视图；要保存为默认布局，在「调整视图」中预览并保留。

页面配置可包含：

```json
{
  "specVersion": 1,
  "collectionId": "c-project-12345678",
  "layout": "board",
  "page": { "description": "把讨论转成行动，掌握下一步。", "showSummary": true },
  "fields": ["title", "status", "dueDate"],
  "groupBy": "status",
  "actions": ["record.create", "record.update", "source.open"]
}
```

`page` 可选，说明最多280字符；仅包含声明式属性，按既有预览/保存校验。Agent 应先检查 `describe.presentation` 再使用新配置；旧配置在新版继续可读，含新配置的视图需要支持该能力的运行时。概览统计的是当前保存视图的投影，不代表整个资料库。业务字段仍由 people/tasks schema 管理，与页面描述独立。人物概览的互动数是每人最近200条解析窗口的已载入记录数，不是按某个时间段统计。

默认人物详情模板保留档案、互动和跟进的完整流程；自定义字段顺序/标签或收紧动作后，使用通用字段呈现器遵守保存的配置。筛选、排序在两种呈现器中一致。原文件与CSV导出入口面向整个源集合，页面筛选不代表数据访问权限。

`create(mode=existing)` 对已关联的同模板/目录返回原页面；需要额外保存方式时使用 preview/save 或显式 copy。移除视图不会删除源资料，重放已移除的创建结果不会自动复活它。

## 可重复的隔离验收

```sh
pnpm --filter @geminilight/mindos build
pnpm --filter @mindos/web build
# 同 Desktop runtime 一样补齐 standalone 的静态资源和依赖闭包
node --input-type=module -e 'import {materializeStandaloneAssets,BUILTIN_AGENT_EXTENSION_RUNTIME_DEPENDENCY_SEEDS,IM_RUNTIME_DEPENDENCY_SEEDS} from "./packages/desktop/scripts/prepare-mindos-bundle.mjs"; import {resolve} from "node:path"; materializeStandaloneAssets(resolve("packages/web"),{runtimeDependencySeeds:[...BUILTIN_AGENT_EXTENSION_RUNTIME_DEPENDENCY_SEEDS,...IM_RUNTIME_DEPENDENCY_SEEDS]});'
pnpm test:views:isolated
# 同一个一次性服务内再验证两个 MCP 客户端
pnpm test:views:isolated -- --mcp
```

Runner 每次创建独立临时HOME、资料库和随机端口。浏览器/MCP在写入前验证所有权token、路径、配置和服务rootId，结束清理自己的进程和资料；测试截图与Playwright结果仍留在测试输出目录。不得再把供人体验的4587服务或长期资料库用于回归测试，单独设置 `MINDOS_VIEWS_ISOLATED=1` 已不足以运行写入测试。

架构及验收依据：[工作页面与隔离 spec](../specs/spec-views-workspaces-and-test-isolation.md)。


## 人物与项目待办联动

默认人物详情中的「一起推进的事」按项目待办分组：点击任务可编辑，选择项目后添加任务会自动带入当前人物。人物页和项目页共用原 CSV，关闭表单保留该人物/项目上下文的草稿；Agent 在后台更新人物资料不会关掉正在填写的任务。任务页显示关联姓名，点击可进入可用的人物详情，失效关联保留引用供修复。

关系沿用 `personRef = collectionId/personId`，同名人物不会合并。项目在这里指任务集合，尚未与 Studio 的独立 Project 实体合并。没有新增 schema 或第二份关系数据库，也没有额外创建视图。

只读 HTTP 查询 `GET /api/views/v2?op=related&rootId=…&collectionId=…&personId=…` 返回按集合分组的 `RelatedWork`。每个集合采用最早登记的现存保存视图，遵守筛选、字段和动作；关联条件可以引用未显示的 personRef，返回字段仅限显示字段。标题隐藏的集合不展示。最多扫描30个任务集合、返回100条任务，缺失/损坏/截断会通过 `incomplete` 提示部分结果。任务读取按需解析最多20个人物集合的姓名，没有永久姓名缓存。保存视图是呈现配置，不是数据权限边界。

页面复用文件变更、服务端视图事件和重新聚焦刷新，写入仍走原 mutation、root/revision/schema 与操作回执检查。插件继续使用既有 read/mutate/preview/save，不增加另一套写协议。验收见 [人物项目联动 spec](../specs/spec-views-person-project-links.md)。
