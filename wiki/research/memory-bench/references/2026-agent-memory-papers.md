# 2025-2026 Agent Memory Papers: Annotated Bibliography

> Date: 2026-05-10
> Focus: newest arXiv / OpenReview / top-conference-adjacent papers relevant to Memory Bench.
> Note: This is a working bibliography, not a final related-work section.

## 0. Reading Map

For Memory Bench, the papers fall into six buckets:

| Bucket | Why it matters |
|---|---|
| Closest workspace/context-file work | Directly challenges novelty; must be cited carefully |
| Memory benchmarks | Establishes benchmark competition and task taxonomy |
| Task/action memory | Supports our claim that memory must help agents act, not just answer |
| Memory methods | Baselines and design ideas |
| File-system / Markdown-like memory | Closest product/research shape to MindOS |
| Surveys | Terminology, taxonomy, related-work coverage |

## 1. Closest Workspace / Context-File Work

## 1.1 Evaluating AGENTS.md: Are Repository-Level Context Files Helpful for Coding Agents?

Source: [OpenReview](https://openreview.net/forum?id=u23wy9N0vo)
Venue/context: ICLR 2026 Workshop on Memory for LLM-Based Agentic Systems.

### What it studies

This is currently the closest paper to Memory Bench. It evaluates repository-level context files such as AGENTS.md for coding agents.

Key points:

- Builds **AGENTBENCH** with 138 Python software engineering tasks from 12 recent/niche GitHub repositories.
- All repositories contain developer-written context files.
- Compares no context, LLM-generated context, and developer-written context.
- Finds human context files can help success rate but may increase steps and cost.
- Reports that AGENTS.md/context files are already common in open-source repositories.

### Relevance to MindOS

Very high.

This means Memory Bench cannot claim to be the first work on repo-level context files for coding agents.

### Gap that remains

AGENTS.md evaluation is narrower than Memory Bench:

- repo-level context files, not full Markdown knowledge workspaces
- coding issue resolution, not broader research / SOP / decision / handoff workflows
- task success focus, not section-level retrieval and citation
- no systematic treatment of README/INSTRUCTION hierarchy across spaces
- no explicit stale/conflict docs benchmark
- no token-aware context packing benchmark

### How to cite in our narrative

Frame as:

> AGENTS.md work shows repository-level context files can affect coding-agent performance. Memory Bench generalizes this direction from root context files to Markdown knowledge workspaces, where agents must retrieve and cite canonical sections across files, links, instructions, decisions, and stale documents.

## 1.2 Configuring Agentic AI Coding Tools: An Exploratory Study

Source: [OpenReview](https://openreview.net/forum?id=Ff24LnE0ex)
Context: AIware 2026.

### What it studies

Empirical study of how repositories configure agentic coding tools.

It discusses:

- CLAUDE.md
- AGENTS.md
- copilot-instructions.md
- subagents
- tool-specific configuration practices

### Relevance to MindOS

High as practice evidence.

It supports the claim that Markdown instruction/context files are becoming de facto infrastructure for coding agents.

### Gap

It is an empirical configuration study, not a benchmark of memory retrieval, citation, token cost, or operational workspace use.

## 1.3 ByteRover: Agent-Native Memory for Code Intelligence

Source: [arXiv:2604.01599](https://arxiv.org/abs/2604.01599)

### What it studies

ByteRover proposes an agent-native memory system for coding agents.

Important details from the abstract:

- stores experiences in **human-readable markdown files** on local file systems
- organizes memory as a hierarchical context tree
- introduces a two-phase retrieval strategy:
  - coarse-grained retrieval
  - fine-grained retrieval
- emphasizes interpretability and privacy
- reports improvements over baseline methods and competitive performance with existing memory systems

### Relevance to MindOS

Extremely high.

This is the closest method paper to MindOS-style local Markdown agent memory.

### Gap that remains

ByteRover is a memory method for code intelligence. Memory Bench can still differ by:

- being a benchmark, not only a system
- evaluating broader Markdown knowledge workspaces
- focusing on section-level citation and canonical source selection
- testing stale/conflicting docs, instruction hierarchy, SOPs, decisions, and changelogs
- including non-coding knowledge-work tasks

### Impact on novelty

This paper narrows our method novelty. If we propose a Markdown memory compiler, we must compare against ByteRover conceptually and maybe experimentally if available.

## 1.4 FS-Researcher: Test-Time Scaling for Long-Horizon Research Tasks with File-System-Based Agents

Source: [arXiv:2602.01566](https://arxiv.org/abs/2602.01566)

### What it studies

FS-Researcher proposes file-system-based agents for long-horizon research tasks.

Key ideas:

- persistent file-system workspace
- structured notes
- archived sources
- hierarchical knowledge base beyond context length
- context builder agent
- long-horizon deep research scaling

### Relevance to MindOS

High.

It validates the broader direction of file-system workspace memory for agents.

### Gap

It is a method/system for research task scaling, not a benchmark of Markdown operational memory. It does not appear to focus on section-level gold labels, citations, stale docs, or instruction hierarchy.

## 2. Recent Memory Benchmarks

## 2.1 MemoryAgentBench: Evaluating Memory in LLM Agents via Incremental Multi-Turn Interactions

Source: [arXiv / OpenReview](https://openreview.net/forum?id=DT7JyQC3MR)

### What it studies

Evaluates memory agents through incremental multi-turn interactions.

Core competencies:

- accurate retrieval
- test-time learning
- long-range understanding
- selective forgetting

### Relevance to MindOS

High for benchmark design.

### Gap

Not Markdown workspace-specific. Does not evaluate path/heading/section citation, instruction hierarchy, or human-maintained file structures.

## 2.2 AMA-Bench: Evaluating Long-Horizon Memory for Agentic Applications

Source: [OpenReview](https://openreview.net/forum?id=0plhizS1ru)

### What it studies

AMA-Bench evaluates long-horizon memory for agentic applications, using agent trajectories and scalable synthetic trajectories.

It emphasizes:

- objective information
- causality information
- limitations of similarity-based retrieval
- memory use in agentic applications

### Relevance to MindOS

High. It supports the claim that memory benchmark should move beyond dialogue recall.

### Gap

It works over agent trajectories, not human-maintained Markdown knowledge workspaces.

## 2.3 StructMemEval: Evaluating Memory Structure in LLM Agents

Source: [arXiv:2602.11243](https://arxiv.org/abs/2602.11243)

### What it studies

Evaluates whether agents can organize long-term memory into useful structures.

Structures include:

- ledgers
- to-do lists
- trees
- state trackers

### Relevance to MindOS

Very high conceptually.

It shows the field is moving from memory recall to memory structure.

### Gap

It evaluates memory structure generation/use, not retrieval from existing Markdown workspaces with human-authored hierarchy, links, stale specs, and section-level citations.

## 2.4 RealMem: Benchmarking LLMs in Real-World Memory-Driven Interaction

Source: [arXiv:2601.06966](https://arxiv.org/abs/2601.06966)

### What it studies

RealMem argues existing benchmarks focus on casual conversation or task-oriented dialogue. It introduces long-term project-oriented interactions.

Key points:

- 2,000+ cross-session dialogues
- 11 scenarios
- dynamic project states
- realistic context dependencies

### Relevance to MindOS

High. It is close in spirit because it moves toward project memory.

### Gap

Still dialogue-centered, not Markdown-file-centered.

## 2.5 Mem2ActBench: Evaluating Long-Term Memory Utilization in Task-Oriented Autonomous Agents

Source: [arXiv:2601.19935](https://arxiv.org/abs/2601.19935)

### What it studies

Mem2ActBench evaluates whether agents use long-term memory to act, not just answer.

Key points:

- 2,029 sessions
- 400 tool-use tasks
- memory-dependent task execution
- tool selection and parameter grounding

### Relevance to MindOS

High. It supports task/action-oriented memory evaluation.

### Gap

It is tool-use memory, not Markdown workspace memory.

## 2.6 MemoryArena

Source: [arXiv:2602.16313](https://arxiv.org/abs/2602.16313)

### What it studies

MemoryArena evaluates memory in interdependent multi-session agentic tasks.

### Relevance to MindOS

High for agent workflow / handoff track.

### Gap

It does not appear to evaluate Markdown workspaces as the memory substrate.

## 2.7 MemoryCD

Source: [arXiv:2603.25973](https://arxiv.org/abs/2603.25973)

### What it studies

MemoryCD is a cross-domain user-centric benchmark for long-term memory.

### Relevance to MindOS

Useful for personalization and cross-domain coverage.

### Gap

User-centric memory, not Markdown workspace operational memory.

## 2.8 BEAM: Beyond a Million Tokens

Source: [arXiv:2510.27246](https://arxiv.org/abs/2510.27246)

### What it studies

BEAM benchmarks long-term memory over conversations up to 10M tokens.

Key points:

- 100 conversations
- 2,000 validated questions
- evaluates degradation as context grows

### Relevance to MindOS

Useful for scale/token argument.

### Gap

Conversation-centric; does not evaluate structured Markdown workspaces.

## 2.9 MemEvoBench: Memory MisEvolution in LLM Agents

Source: [arXiv:2604.15774](https://arxiv.org/abs/2604.15774)

### What it studies

MemEvoBench studies memory safety and mis-evolution:

- adversarial memory injection
- noisy tool outputs
- biased feedback
- workflow-style tasks

### Relevance to MindOS

Useful for a later safety/noise/staleness track.

### Gap

Safety and memory drift focus, not Markdown workspace retrieval/citation.

## 2.10 LifelongAgentBench

Source: [OpenReview](https://openreview.net/forum?id=PvzW6SosN0)

### What it studies

Evaluates LLM agents as lifelong learners across interdependent tasks and environments such as database, operating system, and knowledge graph.

### Relevance to MindOS

Useful for lifelong learning framing.

### Gap

Environment/task learning benchmark, not Markdown knowledge workspace memory.

## 3. Memory Methods and Architectures

## 3.1 LightMem: Lightweight and Efficient Memory-Augmented Generation

Source: [arXiv:2510.18866](https://arxiv.org/abs/2510.18866)

### What it studies

LightMem proposes efficient memory-augmented generation with:

- online lightweight filtering
- offline sleep-time consolidation
- reduced token/API/runtime cost

### Relevance to MindOS

Very high for algorithm direction.

MindOS can adopt the same principle:

> keep online recall cheap; move heavy consolidation to background jobs.

### Gap

Method paper, not Markdown workspace benchmark.

## 3.2 SimpleMem

Source: [arXiv:2601.02553](https://arxiv.org/abs/2601.02553)

### What it studies

SimpleMem targets efficient lifelong memory for LLM agents.

### Relevance to MindOS

Useful baseline/method reference for efficient memory.

### Gap

Not specifically Markdown workspace operational memory.

## 3.3 PlugMem: Task-Agnostic Plugin Memory Module for LLM Agents

Source: [Microsoft Research](https://www.microsoft.com/en-us/research/publication/plugmem-a-task-agnostic-plugin-memory-module-for-llm-agents/)

### What it studies

PlugMem is a task-agnostic plugin memory module:

- builds compact knowledge-centric memory graph
- evaluated on conversational QA, multi-hop retrieval, and web agent tasks

### Relevance to MindOS

Potential method baseline.

### Gap

Memory graph method, not Markdown workspace benchmark.

## 3.4 MemOS: A Memory OS for AI System

Source: [arXiv:2507.03724](https://arxiv.org/abs/2507.03724)

### What it studies

MemOS frames memory as an operating system abstraction and introduces concepts such as memory units/cubes, metadata, provenance, and lifecycle.

### Relevance to MindOS

High for conceptual framing:

- provenance
- versioning
- memory lifecycle
- memory scheduling

### Gap

System architecture, not a Markdown workspace benchmark.

## 3.5 A-MEM: Agentic Memory for LLM Agents

Source: [arXiv:2502.12110](https://arxiv.org/abs/2502.12110)

### What it studies

A-MEM uses agentic memory structuring with Zettelkasten-like principles.

### Relevance to MindOS

High because MindOS has wiki links and Markdown notes.

### Gap

Method direction, not benchmark.

## 3.6 AgentSys

Source: [arXiv:2602.07398](https://arxiv.org/abs/2602.07398)

### What it studies

AgentSys explores memory management for LLM agents, including hierarchical memory concepts.

### Relevance to MindOS

Useful architecture reference.

### Gap

Not Markdown workspace benchmark.

## 3.7 Memex: Interactive Agent Memory Evolution

Source: [arXiv:2603.04257](https://arxiv.org/abs/2603.04257)

### What it studies

Memex studies memory evolution for LLM-based agents with human-agent interaction.

### Relevance to MindOS

Useful for feedback, memory update, and human control.

### Gap

Not specifically Markdown workspace operational memory.

## 4. Older Anchor Papers

## 4.1 MemGPT

Source: [arXiv:2310.08560](https://arxiv.org/abs/2310.08560)

### Why it matters

Classic virtual-context / memory-management framing for LLMs.

Use for:

- context as memory hierarchy
- paging analogy
- external memory management

## 4.2 LoCoMo

Source: [arXiv:2402.17753](https://arxiv.org/abs/2402.17753)

### Why it matters

Important long-term conversational memory benchmark.

Use for:

- temporal memory
- multi-session recall
- conversation memory baseline

## 4.3 LongMemEval

Source: [arXiv:2410.10813](https://arxiv.org/abs/2410.10813)

### Why it matters

Long-term interactive memory evaluation with:

- extraction
- multi-session reasoning
- temporal reasoning
- knowledge updates
- abstention

Use for:

- benchmark metrics
- temporal/freshness tasks
- abstention tasks

## 4.4 MemoryBank

Source: [arXiv:2305.10250](https://arxiv.org/abs/2305.10250)

### Why it matters

Early long-term memory for LLMs with user memory and personalization.

Use for:

- personalization memory background
- older baseline framing

## 5. Surveys

## 5.1 Memory for Autonomous LLM Agents: A Survey

Source: [arXiv:2603.07670](https://arxiv.org/abs/2603.07670)

Use for:

- taxonomy
- broad related work
- terminology

## 5.2 Survey of Memory in Large Language Model based Agents

Source: [arXiv:2404.13501](https://arxiv.org/abs/2404.13501)

Use for:

- earlier taxonomy
- memory types
- retrieval/update mechanisms

## 5.3 Memory in the LLM Era: What It Is and How It Works

Source: [arXiv:2604.01707](https://arxiv.org/abs/2604.01707)

Use for:

- broad memory concept framing
- distinguishing model/context/external memory

## 6. Implications for Memory Bench

## 6.1 The benchmark must be more specific

Because nearby work is already strong, Memory Bench needs a narrow and defensible scope:

> Markdown knowledge workspace operational memory.

This means benchmark cases must include:

- multiple Markdown files
- headings and sections
- README/INSTRUCTION hierarchy
- links/backlinks
- SOPs
- decisions
- changelogs
- stale specs
- conflicting docs
- section-level citation
- token-aware context packing

## 6.2 ByteRover changes the method story

ByteRover already proposes human-readable markdown files and a hierarchical context tree for code intelligence.

Therefore:

- A pure “Markdown memory compiler” method is not enough as novelty unless it covers broader workspace memory and benchmark evidence.
- The strongest paper should combine:
  - benchmark
  - section/citation/token evaluation
  - broad workspace task taxonomy
  - ablations showing headings/links/time/context packing matter

## 6.3 AGENTS.md paper changes the coding-agent story

The AGENTS.md paper already evaluates repository context files for coding agents.

Therefore:

- Do not position Memory Bench as merely “AGENTS.md helps agents”.
- Position it as moving from root context files to living knowledge workspaces.

## 6.4 Best revised title direction

Suggested:

> From Repository Context Files to Knowledge Workspaces: Benchmarking Markdown-Native Operational Memory for LLM Agents

Alternative:

> Beyond AGENTS.md: Evaluating Markdown Knowledge Workspaces as Operational Memory for LLM Agents

## 7. Must-Read Shortlist

If only reading 10 papers:

1. Evaluating AGENTS.md
2. ByteRover
3. FS-Researcher
4. StructMemEval
5. MemoryAgentBench
6. AMA-Bench
7. RealMem
8. Mem2ActBench
9. LightMem
10. LongMemEval
