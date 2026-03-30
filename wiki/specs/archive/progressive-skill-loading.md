# Spec: Progressive Skill Loading

> Status: Draft v4
> Author: geminitwang + claude
> Date: 2026-03-18

## 问题

当前 SKILL.md 是**单文件全量注入**（185 行 / 183 行中文版）：

1. **不可热更新**：改规则 = 改 SKILL.md → 同步 3 处副本 → 发版
2. **无法个性化**：所有用户共享同一套规则，bad case 只能写死进代码
3. **不可扩展**：规则越写越长，但全量注入意味着每行都有 token 成本，限制了规则体系的成长空间
4. **副本同步负担**：3 处 185 行需保持一致
5. **纯被动**：用户说什么做什么，做完就停。不会主动沉淀经验、发现不一致、提议下一步
6. **不会学习**：每次会话都是白纸一张，不会从历史交互中积累对用户的理解

Token 节省是附带收益，不是主要动机。核心目标是让 skill **可演化、可学习、有主动性**。

## 设计原则

1. **不给 agent 偷懒的机会**：SKILL.md 不内嵌 fallback rules。要么加载规则文件，要么走 mindos_bootstrap——不存在"够用的精简版"
2. **最少文件数 = 最少 tool call**：只有 2 个文件（`skill-rules.md` + `user-rules.md`），agent 1 轮并行读取即可开始干活。不做"按需加载"——agent 判断复杂度不可靠，漏读 patterns 比多读 50 行更糟
3. **规则可升级**：默认规则有版本号，`mindos update` 时可检测并提示更新
4. **向后兼容**：旧用户没有规则文件 → 退化到 mindos_bootstrap，仍可工作
5. **学习分层**：显式反馈立即生效，隐式观察批量提议，不在会话中途碎片化写入
6. **主动但不烦人**：有阈值、可关闭、可自定义

## 方案

### 架构

```
skills/mindos/SKILL.md          ←  Thin loader（~30 行），trigger + 加载协议
                                    无内嵌规则，无 fallback

.agents/skills/                 ←  规则文件，存在用户知识库中（路径相对于 mindRoot）
  mindos/                          英文版 skill 规则（skills/mindos/SKILL.md 引用）
    skill-rules.md                 操作规则（core + patterns + proactive hooks）
    user-rules.md                  用户个性化规则（偏好 + 抑制）
  mindos-zh/                       中文版 skill 规则（skills/mindos-zh/SKILL.md 引用）
    ...                            同结构
```

### 为什么只有 2 个文件

v3 设计有 4 个文件（rules + patterns + proactive + user-rules），问题：

1. **4~5 次 tool call 才开始干活**：bootstrap → rules → proactive → patterns（复杂时）→ user-rules
2. **"按需加载 patterns" 不可靠**：agent 判断"是否复杂"本身就不准——要么漏读要么多读
3. patterns（~55 行）和 proactive（~47 行）本身很短，合并后 ~220 行，对 LLM 上下文来说微不足道

v4 合并为 2 个文件：
- `skill-rules.md`：所有默认操作规则（core + patterns + proactive hooks）
- `user-rules.md`：用户个性化规则（必须独立，因为 agent 要往里写）

Agent 1 轮并行读 2 个文件，然后直接干活。

### 为什么不用 index.md 路由表

SKILL.md 自身就是路由指令，直接写明读哪些文件。省掉 index.md 间接层。

### 为什么放在 `.agents/skills/`

- `.agents/` 语义清晰：给 agent 的元配置，不与 `~/.mindos/` 混淆
- **跟着知识库走**：cloud sync 时规则同步到新设备
- 知识库 = 完整的大脑，包括"大脑如何运作"的元规则
- 用户可在 MindOS Web UI 中直接编辑
- 隐藏目录不污染内容区

---

## Layer 0 — SKILL.md（loader）

```markdown
---
name: mindos
description: >
  MindOS knowledge base operation guide, only for agent tasks on files
  inside the MindOS knowledge base.
  （trigger 条件不变，省略）
---

# MindOS Skill

Load operating rules from the knowledge base, then execute the user's task.

## Protocol

1. Read `.agents/skills/mindos/skill-rules.md` — operating rules.
   - If not found: fall back to `mindos_bootstrap` (or read root INSTRUCTION.md
     + README.md). Inform user: "Run `mindos init-skills` for full skill rules."
2. If `.agents/skills/mindos/user-rules.md` exists and is non-empty:
   read it. User rules override default rules on conflict.
3. Execute task following loaded rules. After completion, evaluate proactive hooks.
```

~25 行。无内嵌规则，agent 被迫执行加载协议。1 轮并行读取 2 个文件即可开始。

---

## Layer 1 — skill-rules.md（操作规则，~220 行）

合并三个来源为一个文件：

### Part 1：核心规则（原 rules.md）
- Core Principles
- Startup Protocol（bootstrap → discover → local guidance → execute）
- Dynamic Structure Rules
- Pre-Write Checklist
- Tool Selection Guide + Fallback Rules
- Safety Rules
- Quality Gates
- Preference Capture（指向 user-rules.md）

### Part 2：执行模式（原 patterns.md）
- Core Patterns（capture/update, Q&A, multi-file routing, retrospective）
- Structural Change Patterns（rename/move + README sync）
- Reference Patterns（CSV, TODO, SOP, handoff 等）
- Interaction Rules

### Part 3：任务后 Hooks（原 proactive.md）
- 纪律（简单操作不提议 / 每次最多 1 条 / 一句话表达 / 检查抑制规则）
- 6 个默认 Hooks（经验沉淀、一致性同步、联动更新、结构归类、模式提炼、对话复盘）
- 用户自定义 Hooks 区域

文件头 `<!-- version: 1.0.0 -->`。一次读取，零路由。

---

## ~~Layer 2 — patterns.md~~ / ~~Layer 3 — proactive.md~~

**已合并入 skill-rules.md。** v3 的 3 文件拆分在 v4 中取消，原因见"为什么只有 2 个文件"。

---

## Layer 4 — user-rules.md（学习与个性化）

### 当前设计的问题

旧版 user-rules.md 本质是个**禁止清单**——只记"不要做什么"。v1 扩展为偏好 + 抑制两种类型，后续版本继续扩展：

| 学习维度 | v1 能力 | v2 规划 |
|---------|--------|--------|
| 显式否定 | ✅ "以后不要…" → 写入偏好 | — |
| 显式正向偏好 | ✅ "当我说'整理'意思是按时间排序" → 写入偏好 | — |
| 上下文偏好 | ✅ "Project A 用英文，日记用中文" → 写入偏好 | — |
| 主动性抑制 | ✅ 拒绝 3 次自动关闭 → 写入抑制 | — |
| 工作流捷径 | ❌ | "更新周报 = 汇总 TODO + 近期笔记" |
| 隐式反馈 | ❌ | agent 改了，用户改回来 → 观察 → 批量提议 |

### 重新设计：多类型规则

```markdown
<!-- MindOS User Rules -->
<!-- Agent 根据用户反馈自动维护。用户也可以手动编辑。 -->

## 偏好（Preferences）

<!-- 操作方式的正向/负向偏好 -->

## 抑制（Suppressed）

<!-- 被关闭的主动提议 -->
```

v1 只支持偏好和抑制。工作流捷径和隐式观察在 v2 加入。

偏好示例：

```markdown
### 新笔记默认放收件箱
- 触发：创建新笔记且用户未指定路径
- 规则：放入「📝 笔记/收件箱/」

### Project A 用英文
- 触发：操作 Projects/ProductA/ 下的文件
- 规则：内容用英文撰写
```

抑制示例：

```markdown
### 关闭"经验沉淀"提议
- 原因：用户拒绝 3 次（2026-03-15, 2026-03-16, 2026-03-18）
- 状态：已关闭
```

### 学习机制：显式 + 隐式

#### 显式学习（即时）

用户明确说"以后不要…""下次记得…"→ 直接写入对应分类（偏好/工作流/抑制）。

用户说"更新周报就是…"→ 写入工作流区域。

#### 隐式学习（v2，批量提议）

> 以下为 v2 规划，v1 不实现。

Agent 在操作中观察到可能的模式但不立即写入，而是记到 user-rules.md 的 `观察` 区域。**会话结束时批量提议**：

```
📝 这次会话我观察到一些可能的偏好：
1. 你创建的笔记都放在了收件箱 — 要设为默认规则吗？
2. CSV 追加后你手动加了空行 — 要自动化吗？
（输入编号确认，或跳过）
```

为什么批量而非实时：
- 一个长对话可能产生 5 条隐式观察，实时写 5 次太碎
- 用户有机会整体 review，拒绝不合理的
- 避免 agent 在执行任务中途跑题去写规则

#### 观察来源

| 信号 | 观察方式 |
|------|---------|
| 用户 undo agent 的操作 | Agent 改了文件，用户紧接着改回来或改到别处 |
| 重复模式 | 同类操作 3+ 次走同样路径 |
| 总是跳过某个步骤 | Agent 按规则提议了 X，用户每次都跳过 |
| 固定操作组合 | "每次更新 TODO 后都会更新 CHANGELOG" |

### 规则生命周期

v1 只按数量管理：user-rules.md 超过 30 条时提议清理。

v2 加入时间维度（每条规则加 `last_triggered` 字段，3 个月未触发 → 提议清理）和完整生命周期：

```
观察 → [用户确认] → 偏好/工作流 → [长期未触发] → 建议清理
```

---

## 初始化

### 新用户：onboard 时自动初始化

`scripts/setup.js` 模板拷贝后：

```javascript
const skillName = template === 'zh' ? 'mindos-zh' : 'mindos';
const skillDir = resolve(mindDir, '.agents', 'skills', skillName);
if (!existsSync(skillDir)) {
  const source = resolve(ROOT, 'templates', 'skill-rules', lang);
  cpSync(source, skillDir, { recursive: true });
}
```

模板随代码发布：

```
templates/skill-rules/
  en/
    skill-rules.md     ← 操作规则（core + patterns + proactive hooks）
    user-rules.md      ← 空模板，含分类结构和注释
  zh/
    skill-rules.md
    user-rules.md
```

### 已有用户：CLI 命令

```
mindos init-skills [--force]
```

- 无 `--force`：只创建不存在的文件
- 有 `--force`：重置 skill-rules.md，**保留 user-rules.md**

### 规则升级

规则文件头部 `<!-- version: x.y.z -->`。`mindos update` 时检测提示：

```
规则文件版本 1.0.0 → 最新 1.1.0。
运行 mindos init-skills 更新默认规则（user-rules.md 不受影响）。
```

---

## Token 估算

| 场景 | 当前 | 新方案 |
|------|------|--------|
| 任何操作 | 185 行 | ~220 行（skill-rules，含 patterns + hooks） |
| 有个性化规则 | 不可能 | +N 行 user-rules |
| 扩展新能力 | 只能塞进 185 行 | 在 skill-rules.md 追加章节 |

Token 略多（~35 行是 proactive hooks 新能力的开销），但 tool call 从 4~5 次降到 1~2 次。核心收益不是 token 节省，是让 skill 变成一个可演化的系统。

## 副本同步

| 之前 | 之后 |
|------|------|
| 3 处 × 185 行 | 3 处 × ~25 行 loader |
| 改规则 = 改代码 + 同步 + 发版 | 改规则 = 改 templates/ + 发版 |
| 用户个性化 = 不可能 | user-rules.md 即改即生效 |

---

## 实现步骤

### Phase 1：规则合并与模板

1. 合并 `rules.md` + `patterns.md` + `proactive.md` → `skill-rules.md`
2. 编写 `user-rules.md` 空模板（含偏好+抑制两节）
3. 创建 `templates/skill-rules/en/` 和 `zh/`（每个只有 2 个文件）
4. 改写 `skills/mindos/SKILL.md` 为 thin loader（~25 行）
5. 同步 `skills/mindos-zh/SKILL.md`
6. 同步 `app/data/skills/` 副本

### Phase 2：初始化集成

7. `scripts/setup.js` onboard 增加 skill rules 初始化
8. `bin/cli.js` 增加 `init-skills` 子命令
9. `mindos update` 增加规则版本检测

### Phase 3：验证

10. 新用户 onboard → 规则文件正确创建
11. 已有用户 → 无规则文件时 fallback 到 mindos_bootstrap
12. `mindos init-skills` → 不覆盖 user-rules.md
13. 显式偏好写入 → 下次加载生效
14. proactive hooks → 任务后正确提议，拒绝 3 次自动关闭
15. `npm test` 通过

### Phase 4（后续迭代）

16. 隐式观察 → 会话结束时批量提议
17. 工作流捷径 → 触发词识别 + 展开执行
18. 规则卫生 → 过期规则清理提议
19. 用户自定义 proactive hooks 引导
20. bootstrap 集成 → MCP Agent 零额外 tool call（`mindos_bootstrap` 返回值直接包含 skill rules）

---

## 不做的事（v1）

- **不改 MCP 工具**：规则加载在 agent 侧完成
- **不做 project-wiki 改造**：先在 mindos 验证再推广
- **不做 rule 冲突检测**：user-rules 优先级最高，简单覆盖
- **不做 index.md 路由层**：SKILL.md 自身承担路由
- **不做 bootstrap 集成**：v1 规则加载在 agent 侧完成。MCP bootstrap 集成作为 Phase 4 优化项
- **不做知识库健康巡检**：（未来方向，需要 cron-like 调度能力）
- **不做跨会话记忆**：user-rules.md 是持久化的"长期记忆"，但短期会话记忆靠 agent 自身 context

## 风险

| 风险 | 缓解 |
|------|------|
| Agent 跳过加载协议 | SKILL.md 无内嵌规则，跳过 = 无指导，被迫执行 |
| 用户改坏 rules.md | `mindos init-skills --force` 重置 |
| 规则文件被删 | Fallback 到 mindos_bootstrap |
| user-rules.md 膨胀 | v1 按数量管理：超 30 条提议清理。v2 加时间维度 |
| 主动提议烦人 | 有阈值 + 每次最多 1 条 + 可学习关闭 + 可自定义 |
| 隐式观察误判 | 批量提议而非自动写入，用户有确认/拒绝的机会 |
| 工作流定义歧义 | 触发词匹配 + 展开前展示步骤确认 |

---

## 演化路线图

### 现在 → v1（本 spec）

被动执行 → 规则外置 + 主动提议 + 显式学习

### v1 → v2

显式学习 → 隐式观察 + 批量提议 + 工作流捷径

### v2 → v3

静态 hooks → 知识库健康感知

Agent 不只知道"刚才做了什么"，还知道"知识库整体什么状态"：
- 哪些 TODO 过期未处理
- 哪些文件 3 个月没更新但高频被引用
- 有没有孤岛文件（无链接指向）
- 收件箱积压量

需要 cron-like 调度（每日/每周巡检），超出当前 skill 架构，留到有定时任务能力时做。

### v3 → v4

单人规则 → 团队规则层

```
.agents/skills/mindos/
  skill-rules.md    ← 默认
  user-rules.md     ← 个人
  team-rules.md     ← 团队共享（cloud sync 同步给所有成员）
```

优先级：team-rules > user-rules > rules（反直觉但合理——团队规范应该约束个人偏好）。
