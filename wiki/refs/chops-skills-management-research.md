# Chops 调研：Skills 管理可借鉴点（for MindOS Agents）

参考项目：[`Shpigford/chops`](https://github.com/Shpigford/chops)

## 调研目标
- 识别 Chops 在“多工具、多技能”管理上的高效交互模式。
- 筛选可在 MindOS 当前架构中低风险落地的能力。
- 明确哪些能力受限于 MindOS 现有数据模型（避免过度设计）。

## 关键发现
1. **统一多来源入口（Multi-tool support）**
   - Chops 将 Claude/Cursor/Codex/Windsurf/Amp 等技能统一在一个工作台管理。
   - 对 MindOS 的启发：Skills 页应优先提供“统一检索 + 统一过滤 + 统一批量动作”，而非按入口分散。

2. **实时文件监听（Real-time file watching）**
   - Chops 通过文件监听快速反映磁盘变化，减少用户“刷新焦虑”。
   - 对 MindOS 的启发：在现有 `useMcpData` 轮询基础上，强化“最后刷新状态 + 可见反馈”，并保持手动 refresh 可预期。

3. **全文搜索是核心效率器（Full-text search）**
   - Chops 不只按名称搜，还搜描述和内容。
   - 对 MindOS 的启发：当前技能搜索至少应保证 `name + description` 覆盖，并在空结果时给可恢复路径。

4. **集合组织（Collections）降低认知负担**
   - Chops 支持把技能组织到集合（不改原文件）。
   - 对 MindOS 的启发：P1 先用“状态过滤 + 批量动作”模拟运营视图；后续可演进到“策略集合/推荐集合”。

5. **三栏工作台信息架构**
   - Sidebar（过滤）+ List（结果）+ Detail（编辑）的结构让“定位-操作-确认”闭环稳定。
   - 对 MindOS 的启发：继续坚持 Content-first，在 Skills 页内部形成“筛选栏 + 列表 + 矩阵/详情”节奏。

6. **去重与可追踪性**
   - Chops 提到 symlink 去重策略，确保同一技能不会重复显示。
   - 对 MindOS 的启发：至少在 UI 层避免重复渲染同名技能，并在后续考虑 path 级唯一性约束。

## 对 MindOS 的落地决策（本轮）
- 做：
  - Skills 管理视图增加状态过滤（enabled/disabled/attention）。
  - 增加批量启用/停用筛选结果。
  - 矩阵增加 Agent 聚焦维度（all/单 agent）。
  - 统一 loading/success/error 反馈与空态恢复。
- 暂不做：
  - 真正 per-agent skill assignment（现有数据模型仅全局 enabled）。
  - 文件系统级监听替代（先沿用现有轮询与 refresh）。
  - 完整 collections 数据模型（作为后续阶段）。

## 风险与约束
- 当前 `SkillInfo` 仅有全局 `enabled`，矩阵不能提供“单元格编辑”。
- 批量操作基于串行 API 调用，需提供进度与失败反馈避免误判卡死。
- 不新增后端接口，功能实现应完全兼容现有 API。

## 参考
- Chops 仓库主页与 README：[`https://github.com/Shpigford/chops`](https://github.com/Shpigford/chops)
