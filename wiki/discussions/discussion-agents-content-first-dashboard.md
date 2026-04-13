# Discussion: Agents Content-First Dashboard（Sidebar 作为导航，Content 作为主舞台）

## 背景与问题定义

你提出的核心方向是：**点击 Sidebar 的 Agents 后，应该在 Content 主区完成理解、管理与操作**，而不是把复杂信息塞进右侧窄面板。这个方向非常对，尤其符合 MindOS 的产品定位：

- 用户是多 Agent 并行的开发者，任务密度高，需要全局视角。
- Agent/MCP/Skill 本质是一个系统，不是单条卡片信息。
- 右侧抽屉适合轻量补充，不适合长期管理工作流。

结论：`Sidebar = 导航入口`，`Content = 决策与执行主场`。

---

## 设计目标（产品视角）

1. **可见性**：用户 5 秒内看懂当前 Agent 生态状态（连了谁、缺了谁、哪里坏了）。
2. **可执行性**：看到问题即可操作（安装、连接、启用技能、修复配置）。
3. **可扩展性**：不同用户安装的 Agent 集合不同，UI 不能依赖固定清单。
4. **可审计性**：符合 MindOS 的透明原则，关键操作和状态变化可追溯。

---

## 信息架构建议（Content 内的 4 层）

建议把 Agents 主内容页做成一个统一 IA，而不是多个分散页面：

1. **Overview（总览）**
2. **MCP（连接与健康）**
3. **Skills（能力开关与覆盖）**
4. **Agent Detail（单 Agent 深入页）**

对应路由建议：

- `/agents` → Overview
- `/agents/mcp` → MCP
- `/agents/skills` → Skills
- `/agents/[agentKey]` → Agent Detail

这样 Sidebar 只需要一个入口 “Agents”，其内二级导航放在 Content 顶部 segment。

---

## Overview 应该展示什么（不是传统 BI Dashboard）

Overview 不该是大而空的统计报表，而应是 **“可执行态势板”**。建议 3 个区块：

### A. 连接态势（Connectivity Snapshot）
- Connected / Detected / Not Found 数量
- MCP Server 状态（Running/Stopped、Transport 覆盖）
- 最近 24h 失败连接数

### B. 风险与动作（Action Queue）
- “有 2 个 Agent 缺少可用 snippet”
- “有 3 个 Skill 处于冲突或重复覆盖”
- “MCP token 过期风险/未设置”
- 每个风险卡片旁放直接 CTA（Fix、Open MCP、Review Skills）

### C. 使用热度（Usage Pulse）
- 最近 7 天：各 Agent 被调用次数、成功率、平均耗时（若有）
- Top Skills 命中率（哪些技能真正被用到）
- Space 覆盖（哪些 Space 有规则但没有被任何 Agent 命中）

关键点：Overview 只保留“帮助决策”的指标，不做“好看但不可行动”的图表堆砌。

---

## MCP 怎么展示（面向连接管理，不是设置表单）

MCP 页核心应是 **Connection Graph + Health Table**：

1. **Connection Graph（轻量可视化）**
   - 左：Agents（Cursor / Claude Code / Codex / Gemini ...）
   - 中：Transport（stdio / http）
   - 右：MindOS MCP Server
   - 边的颜色表达状态（ok / degraded / failed）

2. **Health Table（可执行表）**
   - 列：Agent、Transport、Last Seen、Auth、Latency、Error
   - 行内操作：Copy Snippet、Test Connection、Reconnect

3. **Config Drawer（按需展开）**
   - 默认隐藏复杂字段（endpoint/token/path）
   - 只有点击 “Advanced” 才展开，保持主界面简洁

---

## Skills 怎么展示（解决“每人安装不一样”）

技能页不能按固定清单渲染，需要能力模型：

1. **能力分组视图（Capability-first）**
   - 例如：`Research`、`Coding`、`Docs`、`Ops`、`Memory`
   - 每组展示已启用技能数 + 覆盖到的 Agent 数

2. **来源标签（Provenance）**
   - Built-in / User / Team / Imported
   - 让用户知道“这个技能从哪来、能否安全修改”

3. **兼容矩阵（Skill x Agent）**
   - 行是 Skill，列是 Agent
   - 单元格显示：Enabled / Unsupported / Missing Dependency
   - 一眼看出“同名技能在不同 Agent 的可用性差异”

4. **冲突检测**
   - 同能力多个技能互斥时提示
   - 同一触发词被多个技能覆盖时给建议

---

## 点开一个 Agent 应展示什么（Agent Detail）

单 Agent 页建议固定 6 个模块：

1. **Identity**
   - Agent 名称、版本、来源、最后活跃时间

2. **Connection**
   - 当前连接状态、Transport、认证状态、最近错误
   - `Test`、`Reconnect`、`Copy snippet`

3. **Capability Profile**
   - 支持的工具类型、支持的 Skill 类别、限制项

4. **Skill Assignments**
   - 当前生效技能列表（可启停）
   - “为什么这个技能对该 Agent 生效”的解释

5. **Recent Activity**
   - 最近调用轨迹（简版）：任务名、耗时、成功/失败
   - 点击可跳转 Agent Inspector 详情

6. **Space Reach**
   - 该 Agent 最近访问过哪些 Space
   - 哪些 Space 的 `INSTRUCTION.md` 被命中

---

## 可视化建议（克制，不炫技）

结合 MindOS 的 “Warm Industrial / Content First”：

- 以表格 + 状态芯片为主，图表为辅。
- 只保留 2-3 个关键图：连接健康趋势、调用成功率、技能命中分布。
- 失败状态统一用一个语义（颜色 + icon + 文案模板），降低学习成本。

---

## 与 MindOS 的相关性（为什么这套适合你）

这不是通用 SaaS Dashboard，而是围绕你产品的核心链路：

- `Space`（结构层）: 看 Agent 是否真正读到了正确上下文
- `Instruction`（控制层）: 看规则是否被命中和遵守
- `Skill`（执行层）: 看能力是否安装、启用、冲突

最终目标：**让用户对“Agent 是否按我定义的方式工作”有可见、可控、可修复的闭环。**

---

## 建议的渐进式发布

### Phase A（先上线）
- Content 内 4 个页签结构
- Overview 的连接态势 + Action Queue
- Agent Detail 的 Connection + Skill Assignments

### Phase B（增强）
- MCP Connection Graph
- Skill x Agent 兼容矩阵
- Recent Activity 聚合

### Phase C（高级）
- 风险评分（Health Score）
- Space Reach 热力层
- 自动化修复建议（one-click remediation）
