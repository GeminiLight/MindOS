# Spec: Diff 从插件升级为主程序变更中心

## 目标
把 Diff 能力从 `Agent-Diff.md` 插件升级为主程序核心能力：所有内容改动统一记录为 JSON 事件流，并在全局提供友好提醒与可下钻的逐条 diff 视图。

## 现状分析
当前 diff 仅由 `DiffRenderer` 在命中 `Agent-Diff*.md` 时生效，数据来源是 markdown fenced block（```agent-diff）。这导致三个问题：
1. 入口被动：用户只有打开特定文件才看到变化，缺少全局提醒。
2. 数据弱结构：日志是 markdown 嵌入 JSON，不利于聚合、筛选、未读态统计与跨页面联动。
3. 语义割裂：Diff 被视为“插件”，而不是“编辑/审计主流程”的一部分，难以支撑后续审计与风险分级。

## 数据流 / 状态流
```
用户/Agent 触发写操作
  -> POST /api/file (save/create/append/update/rename/move/delete...)
    -> lib/fs 执行文件系统变更
    -> 生成 ChangeEvent (before/after/path/op/summary/ts/source)
    -> 写入 mindRoot/.mindos/change-log.json

全局提醒（任意页面）
  -> GET /api/changes?op=summary
    -> 读取 change-log.json
    -> 计算 unreadCount + latest
    -> UI 显示顶部提醒条（Review changes）

变更中心页面 /changes
  -> GET /api/changes?op=list&limit=&path=
    -> 返回结构化事件列表
    -> 页面展开单条事件，显示 line-level diff

用户已读
  -> POST /api/changes { op: "mark_seen" }
    -> 更新 lastSeenAt
    -> summary unreadCount 归零
```

## 方案
1. **Core 日志模型（Library-First + Clean Architecture）**
   - 新增 `app/lib/core/content-changes.ts`，负责 JSON 持久化与读取：
     - `appendContentChange(...)`
     - `listContentChanges(...)`
     - `getContentChangeSummary(...)`
     - `markContentChangesSeen(...)`
   - 存储文件：`<mindRoot>/.mindos/change-log.json`（隐藏目录，避免污染用户主文件树）。
   - 控制体积：单条 before/after 截断；总事件数上限（环形裁剪），避免日志无限增长。

2. **主流程接入（非插件）**
   - 在 `app/api/file/route.ts` 的写操作分支记录事件（save/create/append/update/delete/rename/move...）。
   - 事件 summary 做领域命名（如 “updated section”, “moved file”），禁止通用 `utils/common` 命名。

3. **Changes API**
   - 新增 `app/api/changes/route.ts`：
     - `GET op=summary`: unreadCount + latest 事件摘要
     - `GET op=list`: 支持 `limit`、`path` 过滤
     - `POST op=mark_seen`: 记录 lastSeenAt

4. **UX/UI 设计约束**
   - 全局提醒：在主布局提供“内容变化”提醒条，不打断编辑（可关闭/可点击）。
   - 下钻体验：`/changes` 页面按时间倒序显示，单条可展开 diff；可按文件过滤。
   - 反馈完整：空状态（无变化）、加载状态、错误状态、成功已读状态全部可见。

5. **Diff 组件定位**
   - 保留现有 `DiffRenderer` 作为兼容视图（不立即删除），但主流程切换到 `/changes` + JSON。
   - 后续可进入 Expand-Migrate-Contract 的 Contract 阶段再移除旧插件入口。

## 影响范围
- 变更文件（预期）：
  - `app/lib/core/content-changes.ts`（新）
  - `app/lib/core/index.ts`
  - `app/lib/fs.ts`
  - `app/app/api/file/route.ts`
  - `app/app/api/changes/route.ts`（新）
  - `app/components/SidebarLayout.tsx`
  - `app/app/changes/page.tsx`（新）+ `app/components/changes/*`（新）
  - `app/__tests__/api/file.test.ts`
  - `app/__tests__/api/changes.test.ts`（新）
  - `app/__tests__/core/content-changes.test.ts`（新）
- 受影响模块：
  - 写操作 API 响应时间（增加轻量 JSON 写入）
  - 顶层布局增加提醒条渲染
- 破坏性变更：
  - 无外部 API 破坏；新增 API 路由与日志文件

## 边界 case 与风险
1. **首次运行无日志文件**
   - 处理：`GET summary/list` 返回空数据，不报错。
2. **日志文件损坏（非 JSON）**
   - 处理：容错回退为空日志并保留可恢复运行；写入时覆盖为合法结构。
3. **超大文件改动**
   - 处理：before/after 截断 + summary 标记 `truncated`，避免内存/磁盘爆增。
4. **高频并发写入**
   - 处理：单进程同步写（当前架构下可接受）；后续若并发提升再引入锁/队列。
5. **重命名/移动操作无文本变化**
   - 处理：允许 before/after 为空，但保留 beforePath/afterPath 与可读 summary。

已知风险与 mitigation：
- 风险：日志写入失败影响主流程。
- 缓解：日志记录失败不阻断主操作（best effort + console warn）。

## 验收标准
- [ ] 任一写操作后，`<mindRoot>/.mindos/change-log.json` 新增结构化事件（含 op/path/ts/summary）。
- [ ] `GET /api/changes?op=summary` 返回未读数；`POST /api/changes op=mark_seen` 后未读归零。
- [ ] `/changes` 页面可查看事件列表，展开单条可看到 line-level diff。
- [ ] 全局存在友好提醒入口（非插件入口）；点击可进入 `/changes`。
- [ ] 测试覆盖正常路径 + 边界 case + 错误路径，并通过 `npx vitest run`。
