# 本地数据、生成式视图与统一插件

本轮通过 PR #368 集成，包含原人脉视图候选 PR #365；合并状态以 PR 为准。尚未发布 npm/桌面安装包。实际验证见 [交付记录](../reviews/review-generative-views-mvp-20261022.md)，设计依据见 [spec](../specs/spec-local-generative-views-plugin.md)。

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
