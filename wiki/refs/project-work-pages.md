# 项目工作页

Studio → 项目 → 关联项目资料：选择已有任务集合和人物，保存后打开工作页面。页面复用原始 CSV 与人物 Markdown；改变布局不迁移记录。项目名称、目标与关系保存在当前知识库，另一浏览器可以在项目列表中找到它。原有 WorkDir、Space、AI 对话默认配置仍是浏览器设置，本轮不自动迁移。

## 日常操作

1. 在项目中关联已有资料。一个任务集合归属一个项目，人物可以参加多个项目。
2. 打开项目工作页，完成任务、打开人物档案、记录沟通。沟通写入人物原文并标注 projectId；人物页可返回所属项目。
3. 点模块上的「用 AI 改这里」，使用建议或直接描述调整。预览显示区域、筛选、字段和布局的变化；应用后保存。未选择和已锁定区域保持稳定，项目身份保留。
4. 更换关联资料后，重新协调同一个工作页的来源，保留定制标题、布局和其他内容。新增来源有原生区块，移除来源停止读取。
5. 断线时输入保留为本地草稿，重试复用操作身份。版本冲突先刷新资料，检查对象和内容后再试。

## 数据与边界

- `.mindos/views/projects.json`：schemaVersion 1，稳定 id、title、goal、taskCollectionIds、personRefs、version、updatedAt、pageGeneration 与操作回执；文件锁内校验归属与版本，原子写入。新 Studio 项目使用 UUID，旧 slug 身份继续支持。
- 人物互动沿用原 Markdown 区段，增加 `<!-- mindos-project:<id> -->` 标记；旧互动兼容。项目时间线只汇总当前关联人物的项目互动，解除关联不删除原文。私人互动不会自动标注项目。
- 工作页沿用 PageSpec v1，增加可选 projectId/projectSources。实时读取根据当前项目关系筛选；仅改 HTML、恢复页面或修改旧 source 标记不能扩大当前关系范围。恢复布局不回滚项目关系或业务记录；过期来源会提示不可读。
- 默认页身份可重复打开。显式移除后，下次打开增加 pageGeneration 并创建新的默认身份，不复活已移除页。项目关系与页面分步提交；若关系已保存、页面协调失败，显示具体状态并可重试接续。
- 最多 100 个项目、4 个任务集合、40 个人物/4 个人物集合；metadata 1 MiB、最近 500 个设置操作回执。人物选择最多读 20 个集合；每个人原有读取限制与最近 200 条互动限制沿用。项目时间线最多 100 条，部分读取/上限显示提示。
- 项目关系是组织与呈现规则，不是针对拥有本地文件权限 Agent 的访问隔离。

## Agent 接口

GET `/api/views/v2?op=project.list`、`project.read&projectId=<id>`；可带 rootId 防止错库。

POST `project.save`：`{project:{id,title,goal,taskCollectionIds,personRefs},expectedRootId,expectedVersion,operationId}`。

POST `project.page`：`{projectId,expectedRootId}`，返回同一默认页面；如果来源改变则协调来源。

POST `project.interact`：`{projectId,personRef,text,date,source?,expectedRootId,expectedVersion,expectedRevision,expectedSchemaRevision,operationId}`。先读项目及人物版本；重复操作复用 operationId。

CLI：`mindos views project.list` / `project.read <id>` / `project.save --input request.json` / `project.page <id> --input request.json` / `project.interact <id> --input request.json`。

MCP：`mindos_projects_read`、`mindos_projects_write`（action: save / open-page / conversation），Codex 与 Claude Code 使用同一服务契约。

## 验证入口

Core：`pnpm --filter @geminilight/mindos exec vitest run src/knowledge/views/project-service.test.ts src/server/handlers/views-projects.test.ts`。

已构建并 materialize standalone 后：`node scripts/test-views-isolated.mjs project-work-pages.spec.ts --mcp`；加 `--real-ai` 启用显式真实模型用例。使用独立临时知识库，不在用户体验数据上运行破坏性测试。
