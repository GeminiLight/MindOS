# Memory Bench Literature Scan

> Date: 2026-05-10
> Scope: arXiv / OpenReview / top-conference-adjacent scan for memory benchmarks, coding-agent context files, and Markdown/workspace memory
> Conclusion: the space is active; the Memory Bench thesis must be narrowed and positioned carefully.

See also: `references/2026-agent-memory-papers.md` for the expanded annotated bibliography.

## 0. Bottom Line

不能再说“没有这种 paper”。

更准确的判断是：

> 已经有不少 2025-2026 的 agent memory benchmark，且已经出现非常接近的 repository-level context file 论文；但我暂时没有看到一个完整覆盖“Markdown workspace operational memory”的 benchmark：即同时评测 Markdown 文件/目录/标题/链接/README/INSTRUCTION/SOP/决策记录/changelog/过期文档/冲突文档/section-level citation/token-aware context packing 的系统性工作。

所以 Memory Bench 的论文机会还在，但必须换一个更精确的定位：

> 不是“第一个 agent memory benchmark”，也不是“第一个 coding-agent context benchmark”，而是“从 repository-level context files 进一步走向 Markdown knowledge workspace 的 operational memory benchmark”。

最重要的相近论文是：

- **Evaluating AGENTS.md: Are Repository-Level Context Files Helpful for Coding Agents?**
  ICLR 2026 Workshop on Memory for LLM-Based Agentic Systems.
  这篇非常接近，必须在 related work 和 problem framing 里正面处理。
- **ByteRover: Agent-Native Memory for Code Intelligence**
  arXiv 2604.01599.
  这篇明确使用 human-readable markdown files 和 hierarchical context tree，是 MindOS 方法方向最接近的相邻工作之一。

## 1. Very Close Work: Repository-Level Context Files

## 1.1 Evaluating AGENTS.md

Source: OpenReview PDF, ICLR 2026 Workshop on Memory for LLM-Based Agentic Systems.
Title: **Evaluating AGENTS.md: Are Repository-Level Context Files Helpful for Coding Agents?**

Key facts from the paper:

- Studies AGENTS.md / repository-level context files for coding agents.
- Notes that context files are recommended by industry leaders and supported by popular agent frameworks.
- Reports AGENTS.md/context files in more than 60,000 open-source repositories.
- Constructs **AGENTBENCH**, 138 Python software engineering tasks from 12 recent/niche GitHub repositories, all with developer-written context files.
- Evaluates agents with no context, LLM-generated context, and human/developer-written context.
- Finds developer-provided context can improve success rate, but also increases average steps and cost.

Why it matters:

- This is the closest academic work to our direction.
- It already claims repository-level context files as a memory/context mechanism for coding agents.
- Any Memory Bench paper that ignores this will look uninformed.

What it does not cover enough for MindOS:

- It focuses on coding issue resolution, not general Markdown knowledge workspace memory.
- The unit is repository context files, not section-level Markdown KB recall.
- It does not appear to evaluate README/INSTRUCTION hierarchy across Spaces, living notes, decision ledgers, changelogs, stale specs, conflict resolution, or cross-agent handoff as first-class benchmark categories.
- It evaluates whether context files help coding success, not whether a memory system can retrieve/pack/cite the smallest sufficient evidence set from a Markdown workspace.
- It does not frame token efficiency as grounded task success per token across workspace memory tasks.

Implication:

> Our paper should cite this as the strongest adjacent work and position Memory Bench as a broader, structure-aware workspace memory benchmark, not merely a repo-level context-file benchmark.

## 1.2 Configuring Agentic AI Coding Tools: An Exploratory Study

Source: OpenReview PDF, AIware 2026.

Key facts:

- Empirical study of agentic coding tool configuration.
- Finds CLAUDE.md, AGENTS.md, and copilot-instructions.md are common artifacts.
- Describes CLAUDE.md and AGENTS.md as de facto standards, with AGENTS.md emerging as a unifying standard.
- Notes Claude Code subagents can have persistent memory directories, but the study did not find repositories storing such memory files.

Why it matters:

- Establishes that Markdown context/configuration files are becoming real practice.
- Supports the claim that this is not an imaginary product niche.

What it lacks:

- It is an exploratory configuration study, not a benchmark of Markdown operational memory.
- It does not evaluate retrieval, citation, staleness, context packing, or long-term memory behavior.

## 2. Agent Memory Benchmarks

## 2.1 MemoryAgentBench

Source: OpenReview, ICLR 2026 Poster.
Title: **Evaluating Memory in LLM Agents via Incremental Multi-Turn Interactions**

Key facts:

- Defines memory agents and evaluates four competencies:
  - accurate retrieval
  - test-time learning
  - long-range understanding
  - selective forgetting
- Converts long-context datasets and newly constructed datasets into incremental multi-turn format.
- Evaluates context-based, RAG, external memory, and tool-integrated memory agents.

Relevance:

- Strong general memory-agent benchmark.
- Useful for related work and competency framing.

Gap for us:

- It is not Markdown workspace-specific.
- It does not focus on human-maintained files, headings, links, instructions, SOPs, or path/section citation.

## 2.2 BEAM

Source: arXiv 2510.27246, **Beyond a Million Tokens: Benchmarking and Enhancing Long-Term Memory in LLMs**.

Key facts:

- Generates coherent long conversations up to 10M tokens.
- Constructs BEAM: 100 conversations and 2,000 validated questions.
- Tests broad memory abilities as conversations lengthen.
- Shows even 1M-context models struggle as dialogue length grows.

Relevance:

- Strong long-context/conversational memory benchmark.
- Good for token-scale argument.

Gap:

- Conversation-centric, not Markdown workspace-centric.
- Does not test operational use of structured human docs.

## 2.3 RealMem

Source: arXiv 2601.06966, **RealMem: Benchmarking LLMs in Real-World Memory-Driven Interaction**.

Key facts:

- Argues existing benchmarks focus on casual conversation or task-oriented dialogue.
- Introduces realistic long-term project-oriented interactions.
- Contains 2,000+ cross-session dialogues across 11 scenarios.
- Focuses on dynamic project states and context dependencies.

Relevance:

- Very important because it moves from casual chat to project-oriented memory.

Gap:

- Still dialogue-centered rather than Markdown-workspace-centered.
- Does not treat files, headings, links, README/INSTRUCTION, and stale docs as the primary substrate.

## 2.4 Mem2ActBench

Source: arXiv 2601.19935, **Mem2ActBench: A Benchmark for Evaluating Long-Term Memory Utilization in Task-Oriented Autonomous Agents**.

Key facts:

- Argues existing benchmarks test passive fact retrieval, not active memory use in task execution.
- Evaluates whether agents use memory to select tools and ground parameters.
- Builds 2,029 sessions and 400 tool-use tasks.
- Human evaluation confirms 91.3% are strongly memory-dependent.

Relevance:

- Strong support for our claim that memory must be evaluated through action, not just QA.

Gap:

- Tool-use memory, not Markdown workspace memory.
- Does not focus on human-authored knowledge base structure and section-level evidence.

## 2.5 AMA-Bench

Source: OpenReview, ICLR 2026 MemAgents Workshop Oral.
Title: **AMA-Bench: Evaluating Long-Horizon Memory for Agentic Applications**

Key facts:

- Argues existing benchmarks are dialogue-centric.
- Uses real-world agentic trajectories and synthetic trajectories scalable to arbitrary horizons.
- Shows memory systems suffer from loss of causality/objective information and limitations of similarity retrieval.
- Proposes AMA Agent with causality graph and tool-augmented retrieval.

Relevance:

- Very aligned with the critique of dialogue-centric memory.
- Causality/objective information is relevant to operational memory.

Gap:

- Agentic trajectories are machine-generated representations, not Markdown knowledge workspaces.
- It does not evaluate user-maintained documentation hierarchy and citation.

## 2.6 StructMemEval

Source: OpenReview, ICLR 2026 MemAgents Workshop Oral / arXiv 2602.11243.
Title: **Evaluating Memory Structure in LLM Agents**

Key facts:

- Argues long-term memory benchmarks focus on fact retention, multi-hop recall, and time-based changes.
- Tests ability to organize long-term memory into useful structures.
- Includes structures like ledgers, to-do lists, trees, and state trackers.

Relevance:

- Strong conceptual neighbor.
- Supports the idea that memory structure matters beyond recall.

Gap:

- Evaluates whether agents can organize memory into abstract structures.
- Does not specifically benchmark existing Markdown workspaces, file hierarchy, links, instruction precedence, stale docs, and section-level citation.

## 2.7 MemEvoBench

Source: arXiv 2604.15774, **MemEvoBench: Benchmarking Memory MisEvolution in LLM Agents**.

Key facts:

- Focuses on memory safety and behavioral drift.
- Evaluates adversarial memory injection, noisy tool outputs, and biased feedback.
- Covers QA-style tasks and workflow-style tasks.

Relevance:

- Useful for future safety/staleness/noise track.

Gap:

- Safety/misevolution focus, not Markdown workspace retrieval/citation/packing.

## 2.8 LifelongAgentBench

Source: OpenReview, ICLR 2026 submission.
Title: **LifelongAgentBench: Evaluating LLM Agents as Lifelong Learners**

Key facts:

- Evaluates lifelong learning under interdependent tasks.
- Environments include Database, Operating System, and Knowledge Graph.
- Focuses on skill-grounded tasks and automatic verification.

Relevance:

- Useful for agent workflow/lifelong learning framing.

Gap:

- Environment/task learning benchmark, not Markdown operational memory.

## 3. Memory Methods, Not Benchmarks

## 3.1 PlugMem

Source: Microsoft Research publication page, February 2026.
Title: **PlugMem: A Task-Agnostic Plugin Memory Module for LLM Agents**

Key facts:

- Task-agnostic plugin memory module.
- Structures episodic memories into compact knowledge-centric memory graph.
- Evaluated across long-horizon conversational QA, multi-hop knowledge retrieval, and web agent tasks.

Relevance:

- Strong baseline/method neighbor.

Gap:

- Method paper, not Markdown workspace benchmark.

## 3.2 FS-Researcher

Source: arXiv 2602.01566, **FS-Researcher: Test-Time Scaling for Long-Horizon Research Tasks with File-System-Based Agents**.

Key facts:

- Uses a persistent file-system workspace for deep research.
- Context Builder agent writes structured notes and archives raw sources into a hierarchical knowledge base beyond context length.

Relevance:

- Very important for the “workspace memory” concept.
- Shows file-system-based agents are becoming a research pattern.

Gap:

- Research-agent method, not a memory benchmark.
- Focuses on deep research task scaling, not evaluating Markdown memory systems across task categories.

## 4. Markdown-Native Practice and Products

These are not necessarily peer-reviewed papers, but they show the product/practice trend.

## 4.1 Claude Code memory docs

Claude Code now documents CLAUDE.md files and auto memory:

- CLAUDE.md files: human-authored project/user/org context.
- Auto memory: agent-written learnings.
- Topic files loaded on demand.
- Auto memory first 200 lines or 25KB loaded initially; topic files read when needed.

Relevance:

- Confirms Markdown/file-based memory is mainstream in coding-agent workflows.

## 4.2 Acontext

Acontext describes “Agent Skills as a Memory Layer”:

- captures what the agent did and outcomes
- stores knowledge as Markdown skill files
- human-readable, portable, reusable across agents

Relevance:

- Very close product thesis: procedural/skill memory in Markdown.

## 4.3 mdvdb

Markdown-native vector database:

- filesystem as source of truth
- frontmatter metadata
- links as edges
- lexical/semantic/hybrid search
- recency decay

Relevance:

- Confirms the exact technical direction: Markdown files + links + hybrid search.

## 4.4 Noema

Markdown files + local SQLite + MCP server for agent memory.

Relevance:

- Another signal that local-first Markdown agent memory is a real emerging pattern.

## 5. Updated Novelty Assessment

## 5.1 What is no longer novel enough

Do not claim:

- “First agent memory benchmark.”
- “First benchmark beyond chat memory.”
- “First benchmark for coding-agent context.”
- “First to study AGENTS.md/CLAUDE.md context files.”
- “First Markdown-based agent memory system.”

These are either false or too risky after this scan.

## 5.2 What may still be novel

Potentially defensible claims:

1. **First benchmark for Markdown knowledge workspace operational memory**
   Not just repo root context files, and not just chat/project dialogues.

2. **Section-level evidence and citation over Markdown workspaces**
   Evaluates path/heading/section citation and canonical source selection.

3. **Instruction hierarchy as an evaluation target**
   Tests global/project/space/current-file instruction precedence.

4. **Stale/conflicting Markdown docs as first-class memory failures**
   Tests old specs, superseded SOPs, duplicate docs, changelog mismatch.

5. **Grounded task success per token**
   Combines correctness, citation, freshness, and input-token cost.

6. **Workspace-memory tasks broader than coding issue resolution**
   Includes research, decision rationale, SOP use, troubleshooting, handoff, synthesis, and abstention.

## 6. Required Reframing

Old framing:

> Existing memory benchmarks are chat history memory; nobody benchmarks Markdown KB memory.

New framing:

> Recent work has started moving beyond conversational memory toward project-oriented memory, agent trajectories, memory structure, and repository-level context files. However, these benchmarks still do not fully capture Markdown knowledge workspaces as operational memory: human-maintained files with headings, links, instructions, decisions, SOPs, changelogs, stale documents, and citation requirements. Memory Bench targets this missing layer.

This is more defensible.

## 7. Recommended Paper Angle After Scan

Best title direction:

> **From Repository Context Files to Knowledge Workspaces: Benchmarking Markdown-Native Operational Memory for LLM Agents**

Why this is stronger:

- It acknowledges AGENTS.md work.
- It positions our work as the next step, not an unaware duplicate.
- It narrows the novelty to workspace-level memory.

Alternative:

> **Beyond AGENTS.md: Evaluating Markdown Knowledge Workspaces as Operational Memory for LLM Agents**

This is punchier but more risky because it directly names AGENTS.md.

## 8. What the Benchmark Must Include to Stay Distinct

Minimum distinctiveness requirements:

1. Multiple Markdown workspaces, not only repo root context files.
2. Section-level gold labels, not only task success.
3. Canonical vs non-canonical source annotations.
4. Stale/conflict cases.
5. Instruction hierarchy cases.
6. Links/backlinks/multi-hop cases.
7. Token-budget context packing evaluation.
8. Citation support evaluation.
9. Both retrieval-only and end-to-end agent task metrics.
10. At least one non-coding knowledge-work track.

If Memory Bench lacks these, it will look too close to AGENTBENCH or general memory benchmarks.

## 9. Publication Potential After Scan

Updated judgment:

- **Workshop paper**: still very feasible.
- **Benchmark paper**: feasible if dataset is clearly broader than AGENTS.md/repo issue resolution and labels are strong.
- **Big paper**: needs both benchmark and method, likely “Markdown Memory Compiler” with strong ablations.

The bar is higher than before because adjacent 2026 work is strong and recent.

## 10. Sources Checked

Primary sources used in this scan:

- OpenReview: MemoryAgentBench, ICLR 2026 Poster.
- OpenReview: StructMemEval, ICLR 2026 MemAgents Workshop Oral.
- OpenReview: AMA-Bench, ICLR 2026 MemAgents Workshop Oral.
- OpenReview PDF: Evaluating AGENTS.md, ICLR 2026 MemAgents Workshop.
- OpenReview PDF: Configuring Agentic AI Coding Tools, AIware 2026.
- arXiv: RealMem, 2601.06966.
- arXiv: Mem2ActBench, 2601.19935.
- arXiv: BEAM, 2510.27246.
- arXiv: MemEvoBench, 2604.15774.
- arXiv: FS-Researcher, 2602.01566.
- Microsoft Research: PlugMem publication page.
- Claude Code docs: memory / CLAUDE.md / auto memory.
- Acontext docs.
- mdvdb docs.
- Noema homepage.
