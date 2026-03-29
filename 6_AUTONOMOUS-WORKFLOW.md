# 全自治开发工作流

> 从"人肉调度器"到"一句话交付"的完整方法论。基于 MindOS 项目的真实协作经验迭代而成。

---

## 使用说明

### 日常只需要三个命令

| 场景 | 命令 | 示例 |
|------|------|------|
| 做新功能 | `/autonomous-dev` | `/autonomous-dev 给 Settings 加暗色主题切换` |
| 修 bug | `/fix-bug` | `/fix-bug 移动端 sidebar 点击后不收起` |
| 改完代码想检查 | `/self-review` | `/self-review` |

不需要说"写 spec"、"跑测试"、"review 下"、"commit push"——命令里全包了。

### 什么时候用命令，什么时候直接说

```
改动超过 2 个文件，或者你希望 Agent 别偷工减料 → 用命令
改个变量名、README 加一行、问个问题 → 直接说
```

### 命令 vs 直接说的区别

```
你：修个 bug，sidebar 不更新        → Agent 可能走 3 步就完了
你：/fix-bug sidebar 不更新         → Agent 被塞一整页 SOP，走完 9 步
```

### 命令文件位置

```
.claude-internal/commands/
├── autonomous-dev.md   # 全自治开发（spec→test→code→review→commit）
├── self-review.md      # 3 轮结构化 code review（有 🔴 自动修）
└── fix-bug.md          # 完整 bug 处理（复现→根因→全局扫描→修复→记录）
```

### 与 CLAUDE.md 的分工

- **CLAUDE.md** = 标准和模板（Spec 模板、测试规范、代码质量清单、设计系统规则）
- **Slash Commands** = 流程编排（什么时候查什么标准、按什么顺序执行）
- 命令通过"见 CLAUDE.md"引用标准，不重复定义

---

## 目标状态

```
你：一个 idea（一句话）
  ↓
Agent：
  spec（模板化）→ self-review spec ×2
  → 写测试（三类 case）→ 写代码（绿灯）
  → self-review code ×3（正确性/健壮性/可维护性）
  → 跑测试 → 视觉验证（如有 UI 改动）
  → 更新文档 → commit → push
  → 冒烟验证（如有 release）
  ↓
你：验收（diff + 截图 + 冒烟结果）
```

**人的角色**：只在两个时刻介入——开头（提 idea）和结尾（验收结果）。

---

## 执行流水线（12 步）

详见 Slash Command `autonomous-dev.md`（`.claude-internal/commands/`）。概要：

| 阶段 | 步骤 | 质量保障 |
|------|------|---------|
| 设计 | ① 调研 → ② 写 spec（模板化）→ ③ self-review spec ×2 | Spec 模板强制覆盖数据流、边界 case、验收标准 |
| 测试 | ④ 写测试（三类 case） | 正常路径 + 边界 case + 错误路径 |
| 实现 | ⑤ 写代码 → ⑥ self-review code ×3 | 正确性 → 健壮性 → 可维护性 |
| 验证 | ⑦ 跑测试 → ⑧ 视觉验证 | vitest + Playwright 截图 |
| 交付 | ⑨ 文档 → ⑩ commit → ⑪ 冒烟验证 → ⑫ 呈现 | 发版后临时目录模拟全新安装 |

---

## 实现路径

### 已落地 ✅

| 机制 | 位置 | 作用 |
|------|------|------|
| Slash Commands（3 个） | `.claude-internal/commands/` | 一句话触发完整流程 |
| Spec 模板 | `CLAUDE.md` | 结构化 spec，self-review 有锚点 |
| 测试规范（三类 case + 边界清单） | `CLAUDE.md` | 最小完备测试集 |
| 代码质量自检（4 维度 14 项） | `CLAUDE.md` | 结构化 code review |
| 视觉回归规范 | `CLAUDE.md` | UI 改动 Playwright 截图 |
| 发版冒烟验证 | `CLAUDE.md` | release 后模拟全新安装 |
| 已知陷阱数据库 | `wiki/80-known-pitfalls.md` | Agent 改动前查阅 |
| 防护测试 | `tests/unit/dep-safety.test.ts` | CI 自动拦截已知 bug 模式 |

### 五层机制的关系

**一句话总结**：CLAUDE.md 定义标准 → Slash Command 触发流程 → Skill 保证步骤质量 → Hook 强制不可跳过 → Ralph Wiggum 循环直到达标。

#### 各层定位

| | CLAUDE.md | Slash Command | Skill | Hook | Ralph Wiggum |
|---|---|---|---|---|---|
| **性质** | 被动知识（知道但不一定做） | 主动触发（显式要求走流程） | 专业能力包（怎么做得好） | 硬性门禁（不可跳过） | 收敛循环（不够好就再来） |
| **触发方式** | Agent 自动读取 | 用户 `/命令名` | Agent 自动调用或命令里指定 | 事件驱动，自动触发 | 用户 `/ralph-loop` |
| **覆盖范围** | 所有规范的总集 | 特定场景的子集 | 单个步骤的质量标准 | 单个事件的自动响应 | 单个目标的迭代收敛 |
| **粒度** | 通用规则 | 具体到参数（`$ARGUMENTS`） | 具体到评分维度 | 具体到 shell 命令 | 具体到退出条件 |
| **类比** | 公司员工手册 | 工单模板 | 专业资格认证 | 门禁刷卡系统 | 质检返工循环 |

#### 它们怎么配合

```
用户：/autonomous-dev 给 sidebar 加拖拽排序
       │
       ▼
  Slash Command（autonomous-dev.md）
  定义流程：spec → test → code → review → commit
       │
       │  每一步内部 ──→ Skill 保证质量
       │  ├── spec 阶段 → qa-test-planner 生成测试清单
       │  ├── review 阶段 → code-review-quality 四级评分
       │  └── commit 阶段 → commit-work 智能拆分
       │
       │  步骤之间 ──→ Hook 自动衔接
       │  ├── 写文件后 → PostToolUse → 自动 prettier
       │  ├── Agent 停下后 → Stop → 自动跑测试（blocking）
       │  └── 测试失败 → Agent 被阻断，必须修
       │
       │  某个步骤需要迭代 ──→ Ralph Wiggum 循环
       │  └── "覆盖率不到 90% → 再写测试 → 再跑 → 够了才退出"
       │
       │  全程 ──→ CLAUDE.md 提供底线规则
       │  └── 即使没用 Slash Command，Agent 也知道"commit 前跑测试"
       ▼
  交付结果
```

#### 缺一个会怎样

| 缺了什么 | 后果 |
|---------|------|
| 只有 CLAUDE.md | Agent 知道标准但经常不完整执行，需要人催 |
| 只有 Slash Command | 没用命令时 Agent 完全没规范；步骤质量靠运气 |
| 没有 Skill | Slash Command 说"做 review"，但 review 变成"看起来不错"——缺乏评分框架 |
| 没有 Hook | Agent 偶尔忘记跑 lint / 测试，Slash Command 说了但没有硬性约束 |
| 没有 Ralph Wiggum | 需要迭代的任务（提覆盖率、优化性能）只做一轮就停，达不到目标 |

#### 流程类型对比

```
CLAUDE.md        = 永远生效的背景规则（被动）
Slash Command    = 线性流程 A → B → C → D（主动触发）
Skill            = 单步内的质量放大器（自动调用）
Hook             = 步骤间的硬性门禁（事件驱动）
Ralph Wiggum     = 收敛循环：做 → 查 → 不够 → 再做（目标驱动）
```

五层叠加 = 完整的自治开发系统。去掉任何一层都会留下"Agent 可以偷懒"的缝隙。

---

### 已创建 ✅

#### Slash Commands

`.claude-internal/commands/` 目录下的 markdown 文件，一个文件 = 一个可复用流程。

```bash
# 使用方式
/autonomous-dev 给 sidebar 加文件拖拽排序
/self-review
/fix-bug sidebar 文件树不更新
```

实际命令文件内容见 `.claude-internal/commands/` 目录，此处不重复。

#### 已有 Skills 编排

| Skill | 用在哪一步 | 具体做什么 |
|-------|-----------|-----------|
| `code-review-quality` | self-review | 🔴🟡🟢💡 四级评分，有 🔴 就不能提交 |
| `test-driven-development` | 写测试+代码 | 红 → 绿 → 重构循环 |
| `commit-work` | 提交 | 自动分析改动、拆分逻辑 commit、写 message |
| `fullstack-review` | self-review | 前后端改动对齐检查 |
| `qa-test-planner` | 写测试 | 自动生成测试用例和回归清单 |

Slash Command 定义"做什么"，Skill 保证"做得好"。在命令文件里写"使用 XX skill"，Agent 自动调用。

---

### 已配置 ✅

#### Hooks（`.claude-internal/settings.json`）

Prompt 是建议（Agent 可以跳过），Hook 是强制（系统自动触发，Agent 没有选择权）。

**已配置的 3 个 Hook**：

| Hook | 触发时机 | 做什么 | blocking |
|------|---------|--------|----------|
| prettier | 写/编辑 `.ts/.tsx/.js/.json/.css/.md` 后 | 自动格式化 | ❌ 后台跑 |
| eslint | 写/编辑 `.ts/.tsx/.js/.jsx` 后 | 自动 lint 检查 | ❌ 后台跑 |
| vitest | Agent 每轮回复结束后 | 跑全量测试 | ✅ 失败则阻断 |

**`blocking` 是关键**：`true` = 质量门禁（测试不过 Agent 必须修）；`false` = 锦上添花（后台跑不阻塞）。

**14 种事件类型速查**（可按需扩展）：

| 事件 | 时机 | 典型用途 |
|------|------|---------|
| `SessionStart` | 会话启动 | 自动加载上下文 |
| `UserPromptSubmit` | 发消息后 | 自动增强 prompt |
| `PreToolUse` | 工具调用前 | 阻止危险操作 |
| `PostToolUse` | 工具调用成功后 | 自动 format / lint |
| `PostToolUseFailure` | 工具调用失败后 | 自动重试 |
| `Stop` | Agent 回复完 | 自动跑测试 |
| `SubagentStart/Stop` | 子 Agent 生命周期 | 监控多 Agent 进度 |
| `TeammateIdle` | 团队成员空闲 | 自动分配任务 |
| `TaskCompleted` | 任务完成 | 触发后续步骤 |

#### Agent Teams

一个主 Agent 管理多个子 Agent 并行工作。已开启 `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`。

```
你："并行做这三个任务：A, B, C"
  │
  ▼
主 Agent（调度器）
  ├── Agent-1（worktree 隔离）→ 任务 A → 完成 → 汇报
  ├── Agent-2（worktree 隔离）→ 任务 B → 完成 → 汇报
  └── Agent-3（worktree 隔离）→ 任务 C → 完成 → 汇报
  │
  ▼
主 Agent：汇总 → 合并 → 测试 → 提交
```

内置工具链：

| 工具 | 用途 |
|------|------|
| `TeamCreate` | 创建团队（= 共享任务列表） |
| `TaskCreate` | 创建任务 + 设置 `blockedBy` 依赖 |
| `Agent` | 派子 Agent（`subagent_type` + `isolation: "worktree"`） |
| `SendMessage` | Agent 间通信（DM / 广播 / 关闭） |
| `TaskUpdate` | 完成 / 分配 |

适用 vs 不适用：

| ✅ 适合并行 | ❌ 不适合并行 |
|------------|-------------|
| 独立 bug 同时修 | 同文件多处改动 |
| 前端 + 后端 + 文档 | 严格先后依赖链 |
| 多方案同时调研 | 频繁讨论的探索 |

**注意**：每个子 Agent 都消耗 API 额度。

#### Headless CLI

无交互模式，用于 CI/CD 和定时任务。

```bash
claude-internal -p "任务描述" \
  --permission-mode dontAsk \        # 自动拒绝未白名单工具
  --allowedTools "Read,Grep,Bash(git diff)" \  # 精确白名单
  --output-format json \             # 结构化输出
  --max-turns 10                     # 成本控制
```

场景示例：

```yaml
# GitHub Actions: PR 自动 review
on: pull_request
jobs:
  review:
    steps:
      - run: |
          claude-internal -p "Review this PR diff, output blockers" \
            --permission-mode dontAsk \
            --allowedTools "Read,Grep,Bash(git diff)" \
            --max-turns 5
```

```bash
# 定时任务: 每天检查依赖安全
0 9 * * * claude-internal -p "Check all package.json for outdated deps" \
  --permission-mode dontAsk --max-turns 3 >> /var/log/dep-check.log
```

Hooks 是"Agent 工作时自动触发"，Headless 是"没人工作时定期触发"。互补。

---

### 需要开发 🔨

#### Agent SDK

Anthropic 官方 TypeScript/Python SDK，用代码编写复杂工作流（条件分支、循环、checkpoint 回滚）。

```bash
npm install @anthropic-ai/claude-agent-sdk
```

```typescript
import { Agent, Tool } from '@anthropic-ai/claude-agent-sdk';

const agent = new Agent({
  model: 'claude-opus-4',
  tools: [Tool.Read, Tool.Edit, Tool.Bash],
});

// 条件循环：写代码 → 跑测试 → 不过就改，最多 5 轮
for (let i = 0; i < 5; i++) {
  await agent.run('实现 feature X');
  const result = await agent.run('npx vitest run --reporter=json');
  if (result.includes('"passed": true')) break;
  await agent.run('修复失败的测试');
}

// Checkpoint：快照 + 回滚
const checkpoint = await agent.checkpoint();
await agent.run('尝试大胆重构');
if (somethingWentWrong) await agent.restore(checkpoint);
```

**现阶段不急**：Slash Command + Hooks + Teams 覆盖 90% 场景。SDK 留给需要自定义 orchestrator 时。

#### Ralph Wiggum 循环

持续迭代插件，"做 → 检查 → 不够好 → 再做"直到达标。

```
/ralph-loop "把测试覆盖率从 60% 提到 90%" --max-iterations 20
```

```
迭代 1：分析未覆盖代码 → 写测试 → 72%，不够
迭代 2：补更多分支 → 85%，不够
迭代 3：补边界 case → 91% → ✅ 达标，退出
```

适用场景：提高覆盖率、优化性能指标、批量修复同类 bug、打磨文案。

Slash Command = 线性流程（A→B→C），Ralph Wiggum = 收敛循环（做→查→不够→再做）。可以组合。

---

## 工具全景

```
你的一句话 idea
  │
  ▼
┌─────────────────────────────────────────────────────────┐
│ ① 指令层：Slash Commands                                │
│    把 idea 翻译成 Agent 能执行的完整流程                   │
│    ↓                                                     │
│ ② 质量层：Skills                                         │
│    每个步骤用专业 Skill 保证质量                            │
│    ↓                                                     │
│ ③ 自动化层：Hooks                                        │
│    步骤之间自动衔接，不需要人催                              │
│    ↓                                                     │
│ ④ 协作层：Agent Teams                                    │
│    多个 Agent 同时干活                                     │
│    ↓                                                     │
│ ⑤ CI 层：Headless CLI                                   │
│    无人值守，跑在 CI/定时任务里                              │
│    ↓                                                     │
│ ⑥ 编排层：Agent SDK                                      │
│    用代码定义任意复杂的工作流                                │
│    ↓                                                     │
│ ⑦ 循环层：Ralph Wiggum                                   │
│    不满意就重来，直到达标                                    │
└─────────────────────────────────────────────────────────┘
  │
  ▼
你验收最终结果
```

| 层次 | 工具 | 状态 | 核心价值 |
|------|------|------|---------|
| 指令层 | Slash Commands | ✅ 已创建 | 一句话触发完整流程 |
| 质量层 | Skills | ✅ 已装 | 专业评分框架保证每步质量 |
| 自动化层 | Hooks | ✅ 已配置 | 不可跳过的硬性门禁 |
| 协作层 | Agent Teams | ✅ 已开启 | 多 Agent 并行替代多 terminal |
| CI 层 | Headless CLI | ✅ 可用 | 无人值守自动触发 |
| 编排层 | Agent SDK | ⬜ 待开发 | 条件分支 / 循环 / 回滚 |
| 循环层 | Ralph Wiggum | ✅ 已装 | 持续迭代直到达标 |

---

*此文件是 HUMAN-INSIGHTS.md 第十章的展开版。持续迭代。*

---

## 下一步

| 优先级 | 待办 | 状态 | 说明 |
|--------|------|------|------|
| 1 | ~~配置 Hooks~~ | ✅ | prettier + eslint + vitest 三个 Hook 已配置 |
| 2 | Agent Teams 实战 | ⬜ | 找一个适合并行的任务试跑（如：3 个独立 bug 同时修） |
| 3 | Headless CLI 接入 CI | ⬜ | GitHub Actions PR 自动 review |
| 4 | Agent SDK 自定义编排 | ⬜ | 等前三个跑顺了再考虑 |
