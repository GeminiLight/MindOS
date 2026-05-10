# Memory Bench 中文研究写作草稿

> 状态：研究写作草稿
> 日期：2026-05-10
> 主题：Markdown-native operational memory benchmark 的论文叙事与写法
> 相关文件：`README.md`、`publication-potential.md`

## 0. 核心判断

这件事可以写成 research，而且最好不要从“我们做了一个 MindOS benchmark”这个角度写。2026-05-10 的补充检索发现，已经有非常接近的工作，尤其是 ICLR 2026 MemAgents workshop 的 **Evaluating AGENTS.md: Are Repository-Level Context Files Helpful for Coding Agents?**。所以不能写成“没人做过”。更强、更稳的写法是：

> 现有长期记忆评测正在从 chat history memory 扩展到 project memory、agent trajectory memory 和 repository-level context files；但真实的 coding agent / research agent 越来越多地工作在更广义的 Markdown workspace 里，面对的是文件、目录、标题、链接、README、INSTRUCTION、SOP、决策记录、changelog、过期 spec 和冲突文档。我们提出 Markdown-native operational memory 这个评测设定，并构建 Memory Bench 来衡量 agent 是否能以更少 token 找到、引用并正确使用这些结构化人类知识。

这个写法的重点是：**从 chat memory / repo context files 走向 workspace memory**。

## 1. 论文要讲的核心故事

可以把论文故事压成四句话：

1. 长期记忆是 agent 系统的关键能力，但当前 memory benchmark 多数把 memory 当成历史对话。
2. 真实工作场景里，agent 经常需要使用人类维护的 Markdown 知识库，包括项目规则、SOP、决策、已知坑和版本变化。
3. 这种 Markdown workspace memory 有独特挑战：层级规则、canonical source、section-level citation、stale docs、链接关系、token budget。
4. 因此需要一个新的 benchmark 和评测协议，衡量 agent 是否能在 Markdown workspace 中实现 grounded task success per token。

一句话 thesis：

> Agent memory should not only be evaluated as conversational recall, but also as operational use of structured human knowledge workspaces.

中文可以写成：

> Agent 记忆不应只被评测为“能否回忆历史对话”，还应该被评测为“能否使用人类维护的结构化知识工作区完成任务”。

## 2. 可能的中文标题

偏正式：

- **从对话记忆到知识工作区：面向 LLM Agent 的 Markdown 原生操作记忆评测**
- **Memory Bench：面向 Markdown 知识库的 Agent 长期记忆评测**
- **Markdown as Agent Memory：面向结构化知识工作区的长期记忆评测与优化**
- **面向 Agent 工作流的 Markdown 原生记忆评测：任务成功率、引用可靠性与 Token 效率**

我最推荐：

> **从对话记忆到知识工作区：面向 LLM Agent 的 Markdown 原生操作记忆评测**

原因：

- “从对话记忆到知识工作区”直接点出和现有 benchmark 的区别。
- “Markdown 原生”点出 MindOS 的差异化。
- “操作记忆”强调不是静态 QA，而是 agent 工作流。

## 3. 英文论文标题方向

如果后续写英文：

- **From Chat History to Knowledge Workspaces: Benchmarking Markdown-Native Operational Memory for LLM Agents**
- **Memory Bench: Evaluating Markdown-Native Operational Memory for LLM Agents**
- **Markdown as Agent Memory: Benchmarking Structured Knowledge Workspaces for LLM Agents**

最推荐第一个：

> From Chat History to Knowledge Workspaces: Benchmarking Markdown-Native Operational Memory for LLM Agents

## 4. Abstract 中文草稿

下面是一个偏论文摘要风格的中文草稿：

```text
长期记忆被认为是 LLM Agent 走向持续工作和个性化协作的关键能力。现有评测大多关注 conversational memory，即模型能否从跨会话对话历史中回忆事实、用户偏好和时间变化。然而，在真实的软件开发和研究工作流中，Agent 往往不是直接面对原始聊天记录，而是需要使用人类长期维护的知识工作区，例如 Markdown 文档、项目规则、SOP、决策记录、链接笔记、changelog 和过期 spec。此类 workspace memory 对 Agent 提出了不同挑战：它必须识别 canonical source，遵守层级化 instruction，处理过时或冲突文档，利用标题、路径和链接结构，并在有限 token 预算下提供可引用证据。

本文提出 Markdown-native operational memory 这一评测设定，并构建 Memory Bench，用于评估 LLM Agent 在 Markdown 知识库中进行检索、引用、时序判断、冲突识别、流程执行和跨会话任务接续的能力。Memory Bench 覆盖 exact fact lookup、procedure retrieval、decision rationale、latest policy、historical reasoning、multi-hop link traversal、conflict detection、abstention、troubleshooting 和 agent handoff 等任务类型。除传统准确率外，我们进一步引入 grounded task success per token，联合衡量答案正确性、引用支撑、时序正确性和 token 成本。

通过对 file-level BM25、embedding retrieval、hybrid retrieval、section-level retrieval、long-context 和 context packing 等策略的比较，Memory Bench 揭示了现有 memory 方法在 Markdown workspace 场景下的典型失败模式，包括过期文档误召回、非 canonical 来源优先、摘要丢失关键参数、instruction hierarchy 违背和重复上下文浪费。实验表明，Markdown-aware 的 section-level retrieval 与 budget-aware context packing 有潜力在保持或提升任务成功率的同时显著降低上下文 token。该评测为构建可审计、可解释、token-efficient 的 Agent 长期记忆系统提供了新的基准和分析框架。
```

## 5. Introduction 应该怎么写

Introduction 可以按这个结构写：

### 5.1 第一段：长期记忆的重要性

要点：

- LLM Agent 不再只是单轮问答。
- 它们需要跨 session 接续任务、记住用户偏好、复用项目经验。
- Memory 成为 agentic system 的基础组件。

不要写得太泛，要快速转向 evaluation gap。

### 5.2 第二段：现有 benchmark 的偏差

要点：

- LoCoMo / LongMemEval / Mem0-style benchmark 主要关注 chat history。
- 这些 benchmark 很有价值，但评测的是 conversation recall。
- 它们不能充分覆盖 agent 在真实 workspace 中的操作记忆能力。

关键句：

> Existing benchmarks ask whether an agent remembers what was said. Real workspace agents must also know which document is canonical, which instruction has precedence, and which procedure is still current.

中文：

> 现有评测更关注 agent 是否记得“说过什么”；而真实 workspace agent 还必须判断“哪份文档是权威来源、哪条规则优先级更高、哪个流程仍然有效”。

### 5.3 第三段：Markdown workspace 的独特性

要点：

- Markdown 是真实开发者和研究者常用的知识载体。
- 它不是无结构文本，有路径、标题、链接、frontmatter、README、changelog。
- 这些结构是 retrieval signal，也是 failure source。

### 5.4 第四段：提出 Memory Bench

要点：

- 定义 Markdown-native operational memory。
- 介绍任务类型。
- 说明 metrics：accuracy、citation、freshness、token。

### 5.5 第五段：贡献列表

贡献点要简洁。

## 6. Contributions 写法

可以写成：

```text
本文的主要贡献如下：

1. 我们提出 Markdown-native operational memory 这一评测设定，区别于以历史对话回忆为核心的长期记忆评测，强调 agent 对人类维护知识工作区的操作性使用。

2. 我们构建 Memory Bench，覆盖事实查找、流程执行、决策溯源、最新规则判断、历史原因分析、多跳链接检索、冲突检测、拒答、故障排查和跨会话任务接续等任务类型。

3. 我们提出 grounded task success per token 作为 cost-aware memory 指标，将答案正确性、引用可靠性、时序正确性和 token 成本联合评估。

4. 我们系统比较 file-level retrieval、section-level retrieval、BM25、embedding、hybrid retrieval、long-context 和 context packing 等策略，分析 Markdown workspace memory 中的典型失败模式。

5. 我们展示 Markdown-aware 的 section-level retrieval 与 budget-aware context packing 在提升引用可靠性和降低上下文 token 方面的潜力。
```

如果后面真的做了方法，可以加第 6 点：

```text
6. 我们提出一个 Markdown memory compiler，将文件、标题、链接、时间和反馈信号编译为可预算调度的 memory context，以支持更高效的 agent memory 使用。
```

## 7. Related Work 结构

Related Work 不要堆项目名，建议分四类。

### 7.1 Long-term conversational memory

写：

- LoCoMo
- LongMemEval
- MemoryBank / Mem0 相关

重点：

- 它们测长期对话和个性化记忆。
- 我们关注 Markdown workspace 中的 operational memory。

### 7.2 Agent memory systems

写：

- MemGPT
- Mem0
- Letta
- MemOS
- LightMem

重点：

- 它们提出 memory architecture。
- 我们提出评测 setting 和 benchmark，关注结构化 workspace 使用。

### 7.3 Structured / graph / temporal memory

写：

- Graphiti / Zep
- A-MEM
- StructMemEval
- MemoryArena

重点：

- 这些工作说明 memory 正在从 simple recall 转向 structured/task-oriented memory。
- Markdown workspace 是这种趋势下的重要但未充分评测的场景。

### 7.4 RAG and document retrieval evaluation

写：

- BM25 / dense retrieval / hybrid retrieval
- RAG benchmark

重点：

- 普通 RAG 评测通常关注文档问答。
- Memory Bench 额外要求 instruction hierarchy、staleness、agent handoff、token-aware packing。

## 8. Benchmark Design 章节写法

这章要非常清楚，避免像产品说明。

建议小节：

### 8.1 Problem Definition

定义输入输出：

```text
Given a Markdown workspace W, a task query q, and a memory strategy M,
the system retrieves and packs evidence C from W, then an agent produces answer a.
The evaluation measures whether C and a are correct, grounded, temporally valid,
and token-efficient.
```

中文：

> 给定一个 Markdown 工作区 W、任务查询 q 和记忆策略 M，系统需要从 W 中检索并打包证据 C，随后 agent 基于 C 生成答案 a。评测关注 C 与 a 是否正确、有证据支撑、符合时间状态，并在 token 使用上高效。

### 8.2 Workspace Construction

说明数据集里的 workspace：

- real-like project docs
- README / INSTRUCTION
- SOP
- decisions
- changelog
- stale docs
- conflicts
- links
- missing-answer distractors

### 8.3 Task Categories

列任务类型和例子。

### 8.4 Annotation

每个 case 的 gold：

- gold file
- gold section
- required facts
- forbidden stale facts
- citation target
- answer rubric

### 8.5 Metrics

四组：

- retrieval
- answer
- grounding
- cost

## 9. Method 章节是否需要

如果只是 benchmark paper，Method 可以是 Baselines and Memory Strategies。

如果想做大一点，Method 可以提出：

> Markdown Memory Compiler

包括：

1. Section parser。
2. Heading/path/link/time indexing。
3. Intent-aware retrieval。
4. Budget-aware context packing。
5. Citation-preserving evidence cards。

这会让论文不只是 benchmark，也有方法贡献。

## 10. Experiments 应该怎么设计

### 10.1 Baseline comparison

比较：

- no memory
- full context small
- file BM25
- file embedding
- file hybrid
- section BM25
- section hybrid
- section hybrid + context packing
- section hybrid + link/time ranking

### 10.2 Ablation

消融：

- no headings
- no path boost
- no links
- no temporal signal
- no context packing
- summary-only vs excerpt+summary

### 10.3 Scaling

KB 规模：

- 50 files
- 500 files
- 5000 files

看：

- recall quality 是否下降
- token 是否增长
- latency 是否可控

### 10.4 Failure analysis

分类：

- stale document error
- non-canonical source
- wrong section
- missing multi-hop
- instruction hierarchy violation
- unsupported citation
- summary dropped exact command
- duplicate context

## 11. Results 可能怎么写

先不要预设结果，但可以预设要回答的问题：

1. Section-level retrieval 是否比 file-level retrieval 更省 token？
2. Hybrid 是否真的比 BM25 更好，还是只在语义问法上更好？
3. Link/time ranking 是否减少 stale/canonical 错误？
4. Context packing 是否在不伤正确性的情况下减少输入 token？
5. Long-context baseline 是否会因为 irrelevant docs 变差？
6. 哪些任务最难？

特别重要：

> 不要只报 average accuracy。要按 task category 分开报。

因为 procedure、latest policy、handoff、conflict detection 的难点不同。

## 12. Discussion 可以写什么

有价值的讨论点：

- Markdown structure is memory signal。
- Human-maintained hierarchy beats raw semantic similarity in some operational tasks。
- Token efficiency requires evidence selection, not only compression。
- Staleness is a first-class memory problem。
- Citations are not UI polish; they are part of memory correctness。
- Agent memory benchmark should include workflow behavior, not just QA。

## 13. Limitations 要诚实

可以写：

- Benchmark 主要关注 Markdown workspace，不覆盖所有 memory 场景。
- Synthetic workspace 可能无法完全模拟真实知识库的混乱程度。
- LLM judge 有偏差，需要 deterministic checks 和 human audit。
- 外部系统比较可能受接口适配影响。
- Agent workflow track 的自动评估更难。
- 数据集如果来自 MindOS 风格文档，可能有 domain bias。

这些 limitation 不会削弱论文，反而显得严谨。

## 14. 最小可写版本

如果先写一个 workshop 版本，结构可以是：

```text
1. Introduction
2. Related Work
3. Markdown-Native Operational Memory
4. Memory Bench
   4.1 Workspace Design
   4.2 Task Taxonomy
   4.3 Annotation and Metrics
5. Baselines
6. Experiments
7. Failure Analysis
8. Discussion
9. Limitations
10. Conclusion
```

最小数据：

- 50-100 tasks。
- 3-5 workspaces。
- 6-8 baselines。
- retrieval + answer evaluation。
- token accounting。
- failure taxonomy。

## 15. 大论文版本

如果要写大一点：

```text
1. Introduction
2. Related Work
3. Problem Formulation
4. Memory Bench Dataset
5. Markdown Memory Compiler
6. Experimental Setup
7. Main Results
8. Ablations
9. Scaling Analysis
10. Agent Workflow Evaluation
11. Failure Analysis
12. Discussion and Limitations
13. Conclusion
```

必须多出：

- 方法贡献。
- 300+ tasks。
- public synthetic dataset。
- external baselines。
- agent workflow track。
- 明确 token/cost advantage。

## 16. 现在应该怎么推进

不是先写论文全文，而是先写一个 research scaffold：

1. 写 1 页中文 problem statement。
2. 写 30 个 benchmark case。
3. 标注 gold section / required facts / forbidden facts。
4. 跑 current baseline，找失败案例。
5. 根据失败案例反推论文里的 task taxonomy。
6. 再决定写 workshop 还是大论文。

关键是先证明：

> 这个 benchmark 能发现真实系统问题。

如果做不到，论文不会强。如果能做到，后面就有非常扎实的 research story。

## 17. 一句话收束

这篇 research 最好的中文叙事是：

> 现有 Agent Memory 评测主要回答“模型是否记得历史对话”，而我们要回答“Agent 是否能使用人类维护的 Markdown 知识工作区完成真实任务”。Memory Bench 用 section-level evidence、instruction hierarchy、stale/conflict handling、citation support 和 token-aware task success，把这个问题变成可测量的 benchmark。
