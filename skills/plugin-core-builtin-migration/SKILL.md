---
name: plugin-core-builtin-migration
description: >
  将 MindOS 渲染器插件从“可选插件”升级为“完全内置能力（core builtin）”的通用流程。
  当用户要求“把某插件改成内置/核心”“插件不应可关闭”“插件主程序化”或需要将旧入口迁移到
  新主流程并保留兼容迁移能力时触发。
---

# Plugin Core Built-in Migration

把单个插件改造成“稳定、默认、不可缺席”的产品能力，并沉淀可复用迁移步骤。

适用场景：
- 某插件已经成为核心体验（例如 TODO、CSV、配置、变更中心）
- 旧插件入口要退役，但历史数据要可迁移
- 需要避免“某页面漏 import 导致插件空列表”这类注册漂移

---

## 目标定义（先对齐）

在本项目中，“完全内置”建议同时满足：

1. **注册稳定**：渲染器注册有且仅有一个**客户端根入口**（推荐 `SidebarLayout` / `ShellLayout`）
2. **默认可用**：`manifest.builtin = true`
3. **不可禁用**（如需真正 core）：`manifest.core = true`（`registry` 会强制启用）
4. **可观测可维护**：插件页、设置页、文档、测试一致
5. **历史兼容**：旧入口数据有迁移方案，不丢内容
6. **表层语义清晰**：区分“插件（可管理）”和“应用内建能力（不在插件面板展示）”

---

## 质量闸门（必走）

每次执行本 Skill 时，默认同时应用以下质量视角（按顺序）：

1. **产品设计视角**（`product-designer`）
   - 检查信息层级、任务路径、主次操作、反馈时机
   - 明确“主路径 3 步内可完成”，避免迁移后流程变长

2. **UI/UX 视角**（`ui-design-patterns`）
   - 检查按钮层级、交互一致性、空状态/错误状态/加载状态
   - 禁止无意义下划线链接滥用；主 CTA 与次级 CTA 视觉层级明确
   - 深色模式可读性必须通过（按钮文字对比、tag 对比、focus 可见）

3. **实现质量视角**
- 迁移逻辑幂等（重复执行不重复导入）
- 注册机制单点化（禁止多处散落 import 造成漂移）
- 避免仅服务端注册导致客户端 `0/0` 空列表
   - 兼容代码失败不阻断主流程（best-effort + 可观测）

4. **验证视角**
   - 最少通过：core/API 回归测试 + lint
   - UI 变更至少进行一次人工检查（亮色/暗色）

若任一步不满足，迁移不得判定完成。

---

## 执行流程（通用）

### Step 1) 盘点现状与边界

先确认插件的四类事实来源：

- 代码入口：`app/components/renderers/<plugin>/manifest.ts`
- 注册入口：`app/lib/renderers/index.ts`（自动生成）
- 使用入口：`resolveRenderer()` 调用链（如 `ViewPageClient`）
- 展示入口：插件面板/设置页（优先使用 `getPluginRenderers()`）

并回答：
- 该插件是否应 **core**（不可关闭）？
- 是否存在旧文件协议/旧入口（如 `Agent-Diff.md`）需要迁移？

### Step 2) 升级插件声明

在 manifest 中设置：

- `builtin: true`（内置）
- `core: true`（若要完全内置且不可关闭）
- `appBuiltinFeature: true`（若是“应用内建能力”且不应出现在插件管理面板）
- `match` 保持明确，避免误匹配

如果插件要被替换/下线：
- 删除旧 renderer 文件
- 重新生成 `app/lib/renderers/index.ts`

### Step 3) 统一注册机制（防漂移）

必须收敛为单点初始化（客户端）：

- 在客户端根组件（推荐 `SidebarLayout`）引入 `@/lib/renderers/index`
- 移除其他页面/组件分散 import（避免重复与遗漏并存）

验收标准：
- 任意路由进入插件页，插件列表不应出现 `0/0` 的假空状态
- 在“应用内建能力”模式下，被标记能力应从插件面板消失但渲染仍正常

### Step 4) 历史兼容迁移（关键）

如果旧插件依赖旧文件格式：

1. 在核心数据层实现“懒迁移”：
   - 首次读取时自动导入旧格式
   - 写入新格式（结构化 JSON）
2. 迁移后清理旧入口文件（防止双写和重复导入）
3. 提供一次性脚本（离线/手动修复）：
   - `scripts/migrate-*.js`

### Step 5) UI/UX 对齐

- 插件页：状态、可开关策略与 core 语义一致
- 设置页：显示 builtin/core 标签逻辑一致
- 若设为 `appBuiltinFeature`：在插件页/设置页/首页 Extensions 一致隐藏
- 新主流程页面补齐筛选、空状态、加载、已读等基本交互

### Step 6) 文档与知识同步

至少同步：

- `wiki/plugins/README.md`
- `wiki/60-stage-plugins.md`
- 相关 spec / pitfalls / refs（若行为模型发生变化）

并记录迁移决策：
- 为什么从插件入口转主程序能力
- 旧入口如何兼容、何时清理

### Step 7) 测试与回归

最低测试集合：

- core 层迁移测试（旧格式 -> 新格式）
- API 层筛选/查询测试（若有 changes/feed 类接口）
- UI 基础 smoke（插件列表非空、核心按钮可用）
- 分类测试（`appBuiltinFeature` 能否正确从插件表层隐藏）

推荐命令：

```bash
npm --prefix app run test -- __tests__/core/content-changes.test.ts __tests__/api/changes.test.ts
```

---

## AgentDiff -> Built-in 的参考映射

这次迁移可作为样板：

- 旧：`Agent-Diff.md` + ```agent-diff``` renderer
- 新：`.mindos/change-log.json` + `/api/changes` + `/changes` 主页面 + 全局提醒
- 兼容：读取旧 block 自动导入；导入后删除 `Agent-Diff.md`
- 治理：删除 `diff-viewer` renderer 与文档旧入口，保留结构化审计链路

---

## 常见坑位清单

1. **只删插件没迁移旧数据** -> 用户历史丢失
2. **注册入口分散/仅服务端注册** -> 客户端插件面板出现 `0/0`
3. **文档未同步** -> 用户看到过时入口
4. **core/builtin/appBuiltinFeature 语义混淆** -> 本应“应用内建”的能力仍出现在插件面板
5. **迁移不幂等** -> 每次读取重复导入同一批旧数据

---

## 交付 Checklist（可复制）

- [ ] manifest 层完成 builtin/core 定义
- [ ] 如需“非插件化”，manifest 增加 `appBuiltinFeature: true`
- [ ] 全局注册单点化（客户端根入口统一引入）
- [ ] 旧入口迁移逻辑已实现且幂等
- [ ] 迁移后旧文件可清理
- [ ] 提供一次性迁移脚本
- [ ] 插件页/设置页状态正确（含 appBuiltinFeature 隐藏策略）
- [ ] 文档已同步更新
- [ ] 测试通过

