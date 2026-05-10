# Memory Bench 构建方法论

> 状态：方法论草案
> 日期：2026-05-10
> 目标：基于现有 Memory Benchmark 论文，设计 MindOS 自己的 Markdown workspace memory benchmark
> 相关：`references/2026-agent-memory-papers.md`、`literature-scan-2026-05-10.md`

## 0. 核心结论

我们要构建的 benchmark 不能只是“问一些历史问题，看 agent 能不能答对”。那会落入已有 LoCoMo / LongMemEval / MemoryAgentBench / RealMem 的范围。

MindOS 的 benchmark 应该明确评估：

> Agent 是否能把人类维护的 Markdown workspace 当作 operational memory 使用：找到 canonical section、理解目录/标题/链接/README/INSTRUCTION 层级、处理过期和冲突文档、给出可验证引用，并在有限 token 下完成真实任务。

因此构建方法应分四层：

1. **Memory substrate**：我们评测的记忆载体不是 chat log，而是 Markdown workspace。
2. **Memory operation**：不是只测 recall，而是测 retrieve、pack、cite、reason、act、abstain。
3. **Task taxonomy**：每类任务对应一种真实 agent 失败模式。
4. **Evaluation protocol**：检索、上下文打包、最终回答、agent workflow 分层评估。

## 1. 先看别人怎么构建 Benchmark

## 1.1 MemoryAgentBench：先定义能力维度，再构造多轮输入

论文：`Evaluating Memory in LLM Agents via Incremental Multi-Turn Interactions`
来源：[arXiv:2507.05257](https://arxiv.org/abs/2507.05257)

### 它怎么做

MemoryAgentBench 的关键不是数据量，而是它先定义了 memory agent 的四个核心能力：

- accurate retrieval
- test-time learning
- long-range understanding
- selective forgetting

然后把已有长上下文数据集和新构造数据转成 incremental multi-turn format，让 agent 逐步接收信息，而不是一次性给完整上下文。

### 我们学什么

MindOS 也要先定义能力维度，不能直接造题。

推荐的 MindOS 能力维度：

| 能力 | 含义 | 对应失败 |
|---|---|---|
| Canonical retrieval | 找到权威 section | 找到旧讨论或非权威 README |
| Structural navigation | 使用目录、标题、链接、README | 只靠关键词，漏掉 parent/linked docs |
| Instruction precedence | 遵守全局/Space/当前文件规则优先级 | 用低优先级规则覆盖高优先级规则 |
| Temporal freshness | 区分最新、历史、过期、废弃 | 用旧 spec 当当前流程 |
| Conflict awareness | 发现并说明冲突 | 把两个矛盾文档混成一个答案 |
| Evidence packing | 用最少 token 提供充分证据 | 塞太多无关上下文 |
| Citation grounding | 引用 path/heading/section 支撑答案 | 答对但没有证据或引用错源 |
| Memory-to-action | 用 memory 正确执行任务 | 知道规则但操作时违背 |
| Abstention | 缺证据时拒绝编造 | 幻觉不存在的流程 |
| Handoff continuity | 接续旧任务不重复工作 | 重新调研、漏掉上次决策 |

### 不要照搬什么

不要照搬它的“多轮输入历史”作为主 substrate。MindOS 的主 substrate 是文件系统里的 Markdown，而不是对话流。

## 1.2 StructMemEval：让任务天然需要结构，而不是靠问法暗示

论文：`Evaluating Memory Structure in LLM Agents`
来源：[arXiv:2602.11243](https://arxiv.org/abs/2602.11243)

### 它怎么做

StructMemEval 的核心是：很多任务人类会自然用结构来解决，比如 ledger、todo list、tree、state tracker。它不是问“你记得 X 吗”，而是构造必须维护结构才能解决的问题。

### 我们学什么

Memory Bench 的任务也要“天然需要 Markdown 结构”。

例如：

- 必须看 heading hierarchy 才知道某个规则适用范围。
- 必须看 README + child INSTRUCTION 才知道优先级。
- 必须看 changelog 才知道旧 SOP 被替换。
- 必须沿 links/backlinks 找到相关决策。
- 必须比较两个 sections 才发现冲突。

任务设计原则：

> 如果一个普通 vector search top-k 就能轻松答对，这个 case 不是好 case。

### 不要照搬什么

StructMemEval 测的是 agent 能不能“组织 memory 成结构”。我们测的是 agent 能不能“使用已有 Markdown 结构”。两者 related，但 problem formulation 不同。

## 1.3 AMA-Bench：真实轨迹 + 可扩展合成轨迹双轨

论文：`AMA-Bench: Evaluating Long-Horizon Memory for Agentic Applications`
来源：[arXiv:2602.22769](https://arxiv.org/abs/2602.22769)

### 它怎么做

AMA-Bench 指出现有 benchmark 偏 dialogue-centric，而真实 agent memory 来自 agent-environment interaction stream。它用两类数据：

- real-world agentic trajectories + expert-curated QA
- synthetic agentic trajectories + rule-based QA，可扩展到任意 horizon

它还指出现有 memory system 缺 causality 和 objective information，且 similarity retrieval 有损。

### 我们学什么

MindOS benchmark 也应该双轨：

1. **真实 MindOS docs track**
   来自真实 repo/wiki/AGENTS/Memory discussions，人工标注 gold。

2. **合成 Markdown workspace track**
   可控生成 50/500/5000 文件，包含 stale docs、冲突、links、重复、缺失答案。

真实轨道保证产品相关性，合成轨道保证可扩展、可公开、可做 ablation。

### 不要照搬什么

AMA-Bench 的 substrate 是 agentic trajectories。我们不是评估轨迹记忆，而是评估人类维护的 Markdown knowledge workspace。

## 1.4 Mem2ActBench：从 memory chain 反向生成 action task

论文：`Mem2ActBench: A Benchmark for Evaluating Long-Term Memory Utilization in Task-Oriented Autonomous Agents`
来源：[arXiv:2601.19935](https://arxiv.org/abs/2601.19935)

### 它怎么做

Mem2ActBench 认为现有 benchmark 太被动，只问 fact retrieval，不测 agent 是否主动使用 memory 来执行任务。它构造 memory chains，再反向生成 tool-use tasks，评估 agent 是否能选择工具并 grounding 参数。

### 我们学什么

MindOS 不能只做 QA。必须有 action / workflow track。

例子：

- 根据 release SOP 给出正确命令和顺序。
- 根据 AGENTS 规则判断是否需要更新 wiki。
- 根据上次 handoff 继续写 benchmark cases，而不是重复搜论文。
- 根据 stale warning 避免使用废弃流程。
- 根据 user preference 选择 patch 而不是 minor。

关键指标不是“答案像不像”，而是：

- 是否选了正确文件。
- 是否读了正确 section。
- 是否避免错误操作。
- 是否少读无关文件。
- 是否减少重复工作。

## 1.5 Evaluating AGENTS.md：真实 repo 对照实验

论文：`Evaluating AGENTS.md: Are Repository-Level Context Files Helpful for Coding Agents?`
来源：[arXiv:2602.11988](https://arxiv.org/abs/2602.11988)

### 它怎么做

它比较三种条件：

- no context file
- LLM-generated context file
- developer-written context file

在 SWE-Bench 和新建 AGENTBENCH 上看 coding agent 是否完成任务。结论很重要：context files 往往增加成本，有时还降低成功率；human-written context file 比 LLM-generated 更好，但也要写最小必要规则。

### 我们学什么

我们必须把 **context cost** 和 **context harm** 放进 benchmark。

MindOS 不能只证明“召回更多 memory 有帮助”。还要证明：

- 少召回但更准是否更好。
- README summary 是否会误导。
- context packer 是否减少无关要求。
- full context 是否让 agent 过度探索。
- human-authored canonical section 是否优于 auto summary。

### 不要照搬什么

它测 repo-root context file 对 coding task success 的影响。我们要测 workspace-level memory system：

- 检索是否找到 section。
- context packing 是否合适。
- answer 是否有 citation。
- stale/conflict 是否处理。
- 不只是 coding issue。

## 1.6 ByteRover：Markdown file-based memory 已经有人做方法

论文：`ByteRover: Agent-Native Memory Through LLM-Curated Hierarchical Context`
来源：[arXiv:2604.01599](https://arxiv.org/abs/2604.01599)

### 它怎么做

ByteRover 用 human-readable markdown files 存知识，组织成 hierarchical Context Tree，并用 progressive retrieval。它强调本地文件、无需 vector DB/graph DB/embedding service。

### 我们学什么

这说明 MindOS 的方法方向不是完全空白。我们 benchmark 的独特性必须更强：

- 不只是 markdown memory system。
- 而是系统评估 Markdown workspace operational memory。
- 尤其是 section-level citation、instruction hierarchy、stale/conflict docs、SOP/decision/changelog。

## 2. MindOS Memory Bench 的问题定义

## 2.1 Formal definition

给定：

- 一个 Markdown workspace `W`
- 一个任务查询 `q`
- 一个 memory strategy `M`
- 一个上下文预算 `B`

系统需要：

1. 从 `W` 中检索候选 evidence。
2. 在预算 `B` 内打包 memory context `C`。
3. 由 agent/model 基于 `C` 生成回答或执行动作 `a`。

评估：

```text
score = f(retrieval_correctness,
          answer_or_action_success,
          citation_support,
          temporal_validity,
          instruction_compliance,
          token_cost,
          latency)
```

一句话：

> Memory Bench 评估的是 agent 使用 Markdown workspace memory 完成任务的能力，而不是只评估模型是否记得历史事实。

## 2.2 Benchmark 边界

包括：

- Markdown 文件
- README / INSTRUCTION / AGENTS
- headings / sections
- links / backlinks
- frontmatter / metadata
- SOP / decisions / changelog / reviews / specs
- stale / deprecated / conflicting docs
- session handoff notes
- generated digest / summaries

不包括第一版：

- 任意 PDF/网页 ingestion
- 多模态 memory
- enterprise permission / ACL
- 多用户协作冲突
- adversarial prompt injection

这些可以后续 track。

## 3. Task Taxonomy 设计

第一版建议 12 类任务。每类都要有明确失败模式。

| 类别 | 测什么 | 典型失败 |
|---|---|---|
| Exact fact | 精确事实/字段/命令 | 语义相近但字段错 |
| Procedure | SOP 顺序和参数 | 漏步骤、混用流程 |
| Decision rationale | 为什么这样做 | 只答结论不答依据 |
| Latest policy | 当前规则 | 用旧 spec |
| Historical reasoning | 历史原因 | 被最新状态覆盖 |
| Instruction hierarchy | 规则优先级 | 低层/旧规则覆盖高层 |
| Multi-hop links | links/backlinks 推理 | 只看命中文档 |
| Conflict detection | 文档冲突 | 把矛盾内容合并 |
| Abstention | 缺证据拒答 | 编造不存在流程 |
| Troubleshooting | 已知坑/错误恢复 | 找到相关但非 root cause |
| Agent handoff | 接续任务 | 重复调研或漏掉上次状态 |
| Grounded synthesis | 基于多证据综合 | 泛泛输出，无 citation |

## 4. Dataset 三轨构建

## 4.1 Track A：真实 MindOS 文档

目的：

- 快速验证 benchmark 是否抓真实失败。
- 直接服务产品。

来源：

- `AGENTS.md`
- `README.md` / `README_zh.md`
- `wiki/discussions/Memory/*`
- `wiki/research/memory-bench/*`
- `wiki/specs/*`
- `wiki/reviews/*`
- `wiki/refs/*`
- `wiki/85-backlog.md`
- `wiki/90-changelog.md`

规模：

- v0：30 cases
- v1：100 cases
- v2：300 cases

优点：

- 真实。
- 立即能发现当前 active recall 问题。

缺点：

- gold 会随文档变化。
- 不适合直接公开。

## 4.2 Track B：合成 Markdown workspace

目的：

- 规模可控。
- 可公开。
- 可做 stress test。

生成 workspace：

```text
workspace-50/
workspace-500/
workspace-5000/
```

每个 workspace 包含：

- 5-20 Spaces
- 每个 Space 有 README / INSTRUCTION
- SOP docs
- decision records
- changelogs
- specs
- reviews
- known pitfalls
- stale copies
- conflicting docs
- linked notes
- orphan notes
- missing-answer distractors

生成原则：

- 不要随机 fact soup。
- 要模拟真实知识库的脏乱：重复、半成品、旧版本、摘要滞后、文件名强信号、链接稀疏。

## 4.3 Track C：Agent workflow / handoff

目的：

- 测 memory 是否让 agent 真正工作更好。

任务形式：

```text
Session 1: 做调研/修 bug/写 spec
Session 2: 产生 memory/handoff/decision
Session 3: 新 agent 接续任务
```

评估：

- 是否读到正确 handoff。
- 是否避免重复 work。
- 是否引用上次决策。
- 是否遵守项目规则。
- 是否少走错路。

这部分最接近 MindOS 的真实价值。

## 5. Case 标注规范

每个 case 必须包含五类 gold。

## 5.1 Retrieval gold

```yaml
gold_sources:
  required:
    - path: AGENTS.md
      heading: "Desktop 发版步骤"
      section_id: optional
  optional:
    - path: wiki/refs/git-sync-workflow.md
      heading: "发布与版本"
  forbidden:
    - path: wiki/old-release-flow.md
      reason: stale
```

## 5.2 Answer gold

```yaml
must_include:
  - "Build Desktop"
  - "publish=true"
  - "tag=desktop-v<VERSION>"
must_not_include:
  - "npm run release"
answer_type: ordered_steps
```

## 5.3 Citation gold

```yaml
citation_required: true
citation_granularity: section
acceptable_citations:
  - AGENTS.md#Desktop 发版步骤
```

## 5.4 Temporal gold

```yaml
freshness:
  required: true
  current_after: "2026-05-01"
  stale_sources:
    - wiki/specs/archive/old-desktop-release.md
```

## 5.5 Cost target

```yaml
budget:
  max_recall_tokens: 1200
  max_total_input_tokens: 6000
  prefer_compact_context: true
```

## 6. 数据构造流程

## 6.1 真实案例构造

步骤：

1. 从真实文档中找 30 个高价值问题。
2. 每个问题先人工找 gold section。
3. 写 must_include / must_not_include。
4. 标记任务类型。
5. 标记是否需要 latest / historical / conflict / abstention。
6. 用 current active recall 跑一遍。
7. 把失败 case 分类。

关键原则：

- case 必须来自真实工作流。
- 每个 case 至少有一个明确 gold source。
- 不要只选容易题。

## 6.2 合成案例构造

两阶段：

### Stage 1: 生成 workspace graph

先生成结构：

```yaml
spaces:
  - name: Release
    docs:
      - README.md
      - INSTRUCTION.md
      - npm-release.md
      - desktop-release.md
      - changelog.md
      - old-release-flow.md
links:
  - desktop-release.md -> changelog.md
  - README.md -> desktop-release.md
stale:
  - old-release-flow.md superseded_by desktop-release.md
```

### Stage 2: 生成自然 Markdown 内容

再生成正文，确保：

- gold fact 明确出现。
- distractor 语义相近。
- stale doc 足够迷惑。
- links 有实际意义。

## 6.3 反向生成任务

借鉴 Mem2ActBench：

先构造 memory chain，再反向生成任务。

例如：

```text
Memory chain:
1. npm release 默认 patch。
2. Desktop 不能用 npm run release。
3. Desktop release 必须传 tag。
4. 忘传 tag 会导致文件名版本错。

Generated tasks:
- "Desktop 怎么发版？"
- "文件名版本号不对怎么办？"
- "npm 和 Desktop release 的版本关系是什么？"
```

这样能保证每个任务真的 memory-dependent。

## 7. Evaluation 分层

不要一开始只做 end-to-end。要四层分开评。

## 7.1 Retrieval-only

输入：

- workspace
- query
- retrieval strategy

输出：

- ranked sources
- scores
- snippets/sections
- token estimate
- latency

指标：

- Recall@k
- Precision@k
- MRR
- nDCG
- gold section rank
- stale source rate
- duplicate rate
- source diversity

这层最便宜，应该每次改 retrieval 都跑。

## 7.2 Context packing

输入：

- ranked candidates
- budget
- packer

输出：

- packed context

指标：

- gold evidence included?
- required facts preserved?
- forbidden stale facts excluded?
- citation metadata preserved?
- tokens used?
- duplicate tokens?

这层直接测 token optimization。

## 7.3 Answer generation

输入：

- query
- packed context
- answer model

输出：

- answer
- citations
- token usage

指标：

- correctness
- completeness
- citation support
- temporal correctness
- abstention correctness
- hallucination rate

## 7.4 Agent workflow

输入：

- task
- workspace
- tools
- agent runtime

输出：

- transcript
- file reads
- tool calls
- final result

指标：

- task success
- wrong file reads
- repeated work
- test/command correctness
- rule violations
- total tokens
- elapsed time

## 8. Baselines

第一版至少要有：

| Baseline | 用途 |
|---|---|
| No memory | 证明任务确实需要 memory |
| Full context small | 小规模上界/对照 |
| Current MindOS active recall | 当前产品 baseline |
| File BM25 | 简单强 baseline |
| File hybrid | 当前 BM25 + embedding 路线 |
| Section BM25 | 测 section 粒度价值 |
| Section hybrid | 测 semantic + section |
| Section + packer | 测 token packing |
| Section + link/time | 测结构和时序 |
| Long-context baseline | 测“全塞进去”是否真的好 |

第二阶段再加：

- ByteRover-like hierarchical markdown memory
- Mem0
- Letta
- LlamaIndex/Haystack RAG
- Graphiti/Zep-style temporal graph

## 9. Metrics 设计

## 9.1 主指标

推荐主指标：

```text
Grounded Task Success per 1K Input Tokens
```

计算概念：

```text
grounded_success = task_success * citation_support * temporal_validity
score = grounded_success / (input_tokens / 1000)
```

不要只报这个，还要报原始分项。

## 9.2 Retrieval metrics

- Recall@1 / @3 / @5
- Precision@k
- MRR
- nDCG
- gold section rank
- stale rate
- duplicate rate
- canonical source rate

## 9.3 Answer metrics

- exact correctness
- completeness
- forbidden fact violation
- instruction compliance
- temporal correctness
- abstention correctness
- hallucination

## 9.4 Citation metrics

- citation present
- citation points to correct file
- citation points to correct section
- cited section supports claim
- unsupported claims count

## 9.5 Cost metrics

- recall tokens
- packed context tokens
- total input tokens
- output tokens
- rerank API calls
- summarization API calls
- latency p50/p95

## 9.6 Workflow metrics

- task success
- tool calls
- wrong file reads
- repeated work
- rule violations
- time to first useful action

## 10. Judging 方法

## 10.1 Deterministic first

能规则判断的不要交给 LLM judge：

- required strings
- forbidden strings
- exact commands
- path citation
- section citation
- JSON field
- ordered steps

## 10.2 LLM judge second

LLM judge 用于：

- synthesis quality
- rationale quality
- partial correctness
- contradiction awareness

必须有 rubric：

```yaml
rubric:
  correctness: 0-5
  citation_support: 0-5
  temporal_validity: 0-5
  completeness: 0-5
```

## 10.3 Human audit

每轮 benchmark 抽样：

- 10% LLM-judged cases
- 所有失败类型样本
- 所有新增 case

## 10.4 Judge consistency

对 LLM judge：

- 同一 case 多跑 3 次。
- 如果分数方差大，标记 ambiguous。
- ambiguous case 不用于主 ranking，只用于分析。

## 11. Case YAML 模板

```yaml
id: desktop-release-current-flow
track: real-mindos
category: procedure
difficulty: medium
workspace_snapshot: mindos-dev-2026-05-10

query: "现在 Desktop 应该怎么发版？"

intent:
  requires_latest: true
  requires_ordered_steps: true
  requires_exact_commands: true

gold_sources:
  required:
    - path: AGENTS.md
      heading: "Desktop 发版步骤"
      rationale: "canonical project rule"
  forbidden:
    - path: AGENTS.md
      heading: "发版说明"
      reason: "npm package release, not desktop release"

answer_requirements:
  must_include:
    - "Build Desktop"
    - "publish=true"
    - "tag=desktop-v"
  must_not_include:
    - "npm run release"
  citation_required: true

budget:
  max_recall_tokens: 1200
  max_total_input_tokens: 6000

judging:
  deterministic:
    required_strings:
      - "publish=true"
      - "desktop-v"
    forbidden_strings:
      - "npm run release"
  llm_rubric:
    correctness: 0-5
    completeness: 0-5
    citation_support: 0-5
    temporal_correctness: 0-5
```

## 12. 构建路线

## Phase 0：定义协议

产出：

- task taxonomy
- case schema
- metric schema
- baseline list

完成标准：

- 任何新 case 都能按统一 YAML 表达。

## Phase 1：30-case seed benchmark

产出：

- 30 个真实 MindOS case
- 人工 gold section
- deterministic judge
- retrieval-only runner

完成标准：

- current active recall 跑完。
- 至少发现 5 类真实失败。

## Phase 2：加入 context packing 和 answer eval

产出：

- packer evaluation
- answer generation eval
- citation judge
- token accounting

完成标准：

- 能比较 raw snippet vs evidence card vs summary+excerpt。

## Phase 3：合成 workspace generator

产出：

- workspace-50
- workspace-500
- workspace-5000
- controlled stale/conflict/link cases

完成标准：

- 可重复生成。
- gold 自动生成 + 人工抽查。

## Phase 4：workflow track

产出：

- 10-30 个 agent handoff/action tasks
- transcript logging
- tool/read/action metrics

完成标准：

- 能测“少重复工作”和“少踩坑”。

## Phase 5：paper-ready benchmark

产出：

- 100-300 tasks
- public synthetic subset
- 8-10 baselines
- ablation study
- failure taxonomy

完成标准：

- 可以写 workshop paper。

## 13. 我们的差异化必须落在这些点

如果 Memory Bench 要和已有 benchmark 区分开，第一版就必须包含：

1. **Section-level gold**，不是只标 file。
2. **Canonical vs non-canonical source**。
3. **Stale/conflict docs**。
4. **Instruction hierarchy**。
5. **Links/backlinks multi-hop**。
6. **Citation support**。
7. **Token-aware packing**。
8. **Non-coding knowledge-work tasks**。
9. **Agent handoff / workflow track**。
10. **Current MindOS active recall baseline**。

如果缺少这些，就会太像 AGENTS.md 或普通 memory QA benchmark。

## 14. 最小可执行版本

最小版本不要贪大：

- 30 cases
- 4 task categories:
  - procedure
  - latest policy
  - conflict/stale
  - handoff
- 4 baselines:
  - current active recall
  - file BM25
  - section BM25
  - section BM25 + evidence card
- 3 metrics:
  - gold section rank
  - answer correctness
  - input tokens

只要这个最小版本能证明 section-level + packing 明显更好，就值得继续扩展。

## 15. 最重要的工程纪律

1. **先跑 baseline，再优化。**
   不要先写复杂方法。

2. **每个 case 必须有 gold source。**
   没有 gold source 的 case 只能做探索，不能进主 benchmark。

3. **评估分层。**
   retrieval 错、packing 错、answer 错、agent action 错必须能区分。

4. **保留失败 trace。**
   benchmark 最大价值是解释失败，不只是给分。

5. **token 和 accuracy 一起报。**
   只省 token 不算成功。

6. **公开数据和内部数据分开。**
   内部真实，公开可复现。

7. **不要让 benchmark 变成产品 demo。**
   必须有强 baseline 和失败案例。

## 16. 一句话方法论

> 用真实 MindOS 文档定义问题，用合成 Markdown workspace 放大规模，用 section-level gold 保证可评估，用 retrieval/packing/answer/workflow 四层拆错，用 grounded task success per token 同时约束效果和成本。
