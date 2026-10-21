# 工作台视图：资料与接口

名称统一为“视图”。入口为工作台内部 `/studio/views`，已有 `/studio/apps` 重定向至此；最左 Activity Bar 不改。内置模板包括人脉和项目待办。模板的界面绑定一个普通资料文件夹，原文件始终可在心智文件编辑器里读取和修改。

## 用户流程

1. 在视图入口使用人脉模板，选择新建文件夹或关联已有资料。关联前预览真实人物；已有关联时打开现有视图。
2. 新建从空资料开始，生成 README 与会前准备 INSTRUCTION，不插入演示联系人。
3. 选择人物，在同一主区维护背景、关注方向、互动和下一次跟进。修改写回人物 Markdown，未知段落与私人反思保留。
4. 退出编辑后可重新打开未保存草稿。外部修改造成冲突时保留输入，读取并核对当前版本后再保存。
5. 会前准备勾选需要的资料并预览，可复制、导出 Markdown，或填入一份未发送的 MindOS 对话草稿。未选内容、私人与未知段落不附带。
6. 管理视图可以改名、修复文件夹关联或移除入口；移除不会删除资料。当前关系总览可导出 CSV，原有 CSV 保留。

## 数据所有权

- `.mindos/views/index.json` 保存 schemaVersion=2、collection 来源与视图登记：id/name/folder/template/version、创建/修改时间、最后查看人物。没有人物正文副本。
- 人物为 `<folder>/人物/<姓名> - <UUID>.md`；UUID comment 仅用于身份与请求重试。显示名称来自 H1，普通文件读取即可供 Agent 使用。
- 可识别普通人物目录和背景/互动/跟进段落。原文件只按对应已知段落更新，代码围栏内的标题不会作为共享资料段落。
- 草稿在浏览器本地，按知识库身份、视图、人物和编辑类型隔离，含原始 revision。操作绑定打开时的知识库与配置版本，切库后不会把原草稿写入新库，迟到回包不导航当前页面。草稿暂存不等于写入知识库。
- 目录扫描最多 4 层、1500 条目录项、500 个资料文件；单文件 256KiB，单次内容总量 8MiB。受限、跳过或不可读取时显示提示；不提供声称完整的 CSV 导出。

## Product Server API

所有请求走认证边界；读响应 private/no-store。Next 文件仅调用 `delegateToMindos`。GET 使用 URL 参数，POST 使用 JSON，所有写入要求 `expectedRootId`。

| 操作 | 必需字段 | 结果 |
| --- | --- | --- |
| GET list（默认） | 无 | rootId、views、folders |
| GET preview | rootId、folder | 人物预览、实际计数、范围状态、已关联视图 |
| GET read | rootId、id | view、people 摘要、files、范围状态 |
| GET person / raw | rootId、id、personId / path | 当前完整人物 / 原文及 revision |
| GET prepare | rootId、id、personId、path、expectedRevision、selected | 选定字段与材料文本；旧版本拒绝 |
| GET csv | rootId、id | 当前人物资料 CSV；公式前缀转义 |
| POST create | name、folder、mode=new/existing、operationId | view；同请求重试幂等 |
| POST rename / rebind / remove | id、expectedVersion、name / folder | 更新视图配置；移除保留原文件 |
| POST remember | id、personId、path | 更新最近访问，不改人物或配置版本 |
| POST person.create | id、operationId、fields | 写入并读回人物；nonce 防重复 |
| POST person.update | id、personId、path、expectedRevision、fields | 只更新已知人物字段 |
| POST interaction.add | id、personId、path、expectedRevision、operationId、text、date、source | 追加一次互动，重试不重复 |
| POST followup.update | id、personId、path、expectedRevision、text、date、completed | 更新跟进 |

知识写入复用 `handleFilePost`：路径安全、权限、受保护根文件、revision 校验。成功后记录审计、触发 host `onChanged`；Web 内存索引/Next revalidate 及客户端文件事件/router.refresh 共同更新。视图元数据使用有界跨进程锁与原子替换。

## 交付边界

本轮增加任务 CSV、声明式 ViewSpec 与双宿主插件，详见 [统一契约](generative-views-plugin.md)。不提供任意插件界面执行、模板市场或任意 CSV 自动转换。原文件跳转和对话草稿交接复用已有能力。任意外部进程不配合知识写入通道时的极窄 CAS 竞态沿用当前文件系统边界，不声称已提供跨进程全文件事务。
