# Memory Bench Publication Potential

> Status: research memo
> Date: 2026-05-10
> Question: Can a Markdown-native Memory Bench become a publishable research paper?

## Short Answer

Yes, it can become a publishable research project, but the paper has to be framed carefully. A follow-up scan on 2026-05-10 found several close adjacent works, especially an ICLR 2026 MemAgents workshop paper on evaluating AGENTS.md repository-level context files. The opportunity is therefore narrower than "no one has done this"; the defensible gap is Markdown knowledge workspaces as operational memory, beyond chat-history memory and beyond repo-root context files.

The strongest framing is not:

> We built another memory benchmark.

The stronger framing is:

> Existing memory benchmarks mostly evaluate conversational recall, while real coding and research agents increasingly operate over human-maintained Markdown workspaces. We introduce a benchmark and evaluation protocol for Markdown-native operational memory: locating canonical sections, respecting instruction hierarchy, handling stale/conflicting documents, using links and directory structure, and optimizing grounded task success per token.

This can plausibly become a serious workshop paper first, and potentially a main conference paper if the dataset, baselines, and analysis are strong enough.

See `literature-scan-2026-05-10.md` for the updated related-work scan and novelty caveats.

## 1. Is This Novel Enough?

Potentially yes, because the field is moving from simple recall toward structured and task-oriented memory, but there is still a gap around Markdown/knowledge-work repositories.

Recent work already covers related areas:

- **LoCoMo**: long-term conversational memory, multi-session QA, temporal events.
- **LongMemEval**: long-term interactive memory with extraction, multi-session reasoning, temporal reasoning, updates, and abstention.
- **StructMemEval**: whether agents can organize long-term memory into useful structures, not just retrieve facts.
- **MemoryArena**: interdependent multi-session agentic tasks where prior experiences guide later actions.
- **MemoryCD**: large-scale user-centric cross-domain personalization memory.
- **Mem0 / LightMem / MemOS / Graphiti-style systems**: memory architecture and cost/performance claims.

What remains under-covered:

- Markdown files as source-of-truth memory.
- Human-maintained directory/heading/link structures as retrieval signals.
- Instruction hierarchy: global rules, project rules, space rules, current-file context.
- Operational tasks, not just QA.
- Citation support at path/heading/section level.
- Stale specs and superseded docs.
- Token efficiency tied to grounded task success.
- Agent workflow continuity over docs, not only conversation history.

That is a real research gap.

## 2. How Big Could the Paper Be?

There are three possible levels.

## 2.1 Small paper / workshop paper

This is very feasible.

Contribution:

- define Markdown-native memory benchmark
- release 50-100 cases
- evaluate current MindOS-style retrieval vs baselines
- show qualitative failure taxonomy

Likely venues:

- agent memory workshop
- lifelong agents workshop
- LLM agents workshop
- RAG / evaluation workshop
- software engineering for AI agents workshop

This is the right first target.

## 2.2 Solid benchmark paper

This is feasible with more work.

Contribution:

- 300-1000 tasks
- real-like and synthetic Markdown KBs
- task taxonomy
- retrieval-only and end-to-end evaluation
- baselines: BM25, vector, hybrid, section-level retrieval, long-context, Mem0/Letta/Zep-style memory if feasible
- human-verified gold labels
- cost/latency/token analysis
- ablation on headings, links, temporal metadata, section packing

This could be credible as a benchmark paper if the dataset quality is high.

## 2.3 Big paper

Possible, but only if it includes more than the benchmark.

A larger paper probably needs three pillars:

1. **Benchmark**
   A new Markdown operational memory benchmark with strong task taxonomy and validated labels.

2. **Method**
   A Markdown-native memory compiler: section indexing, hierarchy-aware retrieval, link/time-aware ranking, and budget-aware context packing.

3. **Analysis**
   Clear evidence that this method improves grounded task success per token across realistic agent workflows.

The big-paper version is not just "Memory Bench". It is more like:

> Markdown as Agent Memory: Benchmarking and Compiling Human Knowledge Bases for Token-Efficient Agent Workflows

That is a stronger research package.

## 3. What Would Make It Publishable?

## 3.1 A clear gap statement

The paper must clearly say:

- current memory benchmarks are mostly chat-history centric
- real agents often rely on repo docs, Markdown notes, instructions, SOPs, and decision records
- using those workspaces requires structure-aware memory, not just semantic recall

## 3.2 A precise task taxonomy

The benchmark should not be a random list of questions.

It needs categories such as:

- exact fact lookup
- procedure following
- decision rationale
- latest policy
- historical reasoning
- multi-hop link traversal
- conflict detection
- abstention
- troubleshooting
- agent handoff
- instruction hierarchy compliance
- grounded synthesis

Each task type should explain what existing benchmarks miss.

## 3.3 High-quality gold labels

For each case:

- gold section path
- heading path
- required facts
- forbidden stale facts
- citation requirements
- answer rubric
- token budget target

This is labor-intensive but necessary. Weak labels will kill the paper.

## 3.4 Strong baselines

At minimum:

- no memory
- full context on small KBs
- file-level BM25
- file-level embedding
- file-level hybrid
- section-level BM25
- section-level hybrid
- long-context retrieval
- current MindOS active recall

Nice to have:

- Mem0
- Letta
- Zep / Graphiti-style temporal memory
- LlamaIndex / Haystack RAG pipeline

But external baselines should not block v1. The paper can first compare retrieval strategies if the benchmark itself is strong.

## 3.5 Token-cost analysis

This is where MindOS can be sharper than many benchmark papers.

Measure:

- retrieval tokens
- injected memory tokens
- answer input tokens
- output tokens
- rerank tokens
- summarization/indexing cost
- latency
- task success per 1K tokens

The central metric should be:

> grounded task success per 1K input tokens

This makes the paper more than an accuracy benchmark.

## 3.6 Failure taxonomy

A good paper should show not just scores, but what fails:

- stale doc selected
- wrong section selected
- related but non-canonical source selected
- summary dropped exact flag
- answer ignored citation
- instruction hierarchy violation
- duplicate context wasted budget
- long-context model distracted by irrelevant docs

This analysis is useful even if the absolute benchmark size is modest.

## 4. What Would Make It Weak?

The paper will be weak if:

- it only says "Markdown is different" without rigorous tasks
- it has too few cases
- gold labels are vague
- evaluation relies entirely on LLM judge
- no token/cost accounting
- no comparison with simple BM25/vector baselines
- no evidence that links/headings/time actually matter
- no agent workflow tasks
- dataset is too tied to MindOS internals and not generalizable

The research risk is not that the idea is bad. The risk is that the benchmark becomes a product demo instead of a scientific artifact.

## 5. Recommended Paper Framing

## 5.1 Best title direction

Possible titles:

- **Memory Bench: Evaluating Markdown-Native Operational Memory for LLM Agents**
- **Markdown as Agent Memory: Benchmarking Structured Knowledge Workspaces for LLM Agents**
- **From Chat History to Knowledge Workspaces: Benchmarking Operational Memory for LLM Agents**
- **MindOS Memory Bench: Measuring Grounded Task Success per Token in Markdown Knowledge Bases**

The best academic framing is probably:

> From Chat History to Knowledge Workspaces

because it positions the paper against existing benchmark assumptions.

## 5.2 Core thesis

```text
Long-term agent memory is usually evaluated as conversational recall,
but many real agents operate over user-maintained knowledge workspaces.
These workspaces expose structure: files, headings, links, instructions,
decision records, changelogs, and version history. We show that evaluating
and exploiting this structure changes both benchmark design and memory
system performance.
```

## 5.3 Claimed contributions

A credible contribution list:

1. We define **Markdown-native operational memory** as a distinct evaluation setting for LLM agents.
2. We introduce **Memory Bench**, a benchmark covering retrieval, citation, temporal correctness, instruction hierarchy, and agent handoff over Markdown workspaces.
3. We evaluate common memory strategies, including file-level BM25/vector retrieval, section-level retrieval, long-context baselines, and structured context packing.
4. We propose **grounded task success per token** as a cost-aware memory metric.
5. We analyze failure modes unique to knowledge workspaces, including stale specs, duplicate docs, non-canonical sources, and instruction hierarchy violations.

If we also build the method:

6. We introduce a Markdown memory compiler that improves task success/token by using section boundaries, links, temporal metadata, and budget-aware packing.

## 6. Dataset Strategy for a Paper

## 6.1 Internal-first dataset

Start with real MindOS docs:

- high realism
- fast iteration
- directly useful

But this is not enough for a paper unless sanitized or replicated.

## 6.2 Public synthetic-realistic dataset

Create synthetic Markdown workspaces modeled after real ones:

- project docs
- release SOPs
- architecture decisions
- stale specs
- changelogs
- nested instructions
- links and backlinks
- conflict pairs
- missing-answer distractors

This makes the benchmark publishable without leaking private docs.

## 6.3 Human-authored seed cases

The most credible dataset likely mixes:

- human-authored canonical tasks
- synthetic scale variants
- generated distractor docs
- human-verified labels

Fully generated benchmark data will be less convincing.

## 7. Minimum Publishable Version

For a workshop paper:

- 50-100 tasks
- 3-5 Markdown workspaces
- 8-10 task categories
- retrieval-only + answer evaluation
- 5 baselines
- token accounting
- human spot-check of labels and judges
- clear failure taxonomy

For a stronger paper:

- 300+ tasks
- 10+ workspaces
- 10+ baselines/ablations
- section-level gold labels
- external memory baselines
- multi-session agent workflow track
- public dataset and runner

## 8. Relationship to MindOS Product

This research is product-aligned.

The benchmark would directly guide:

- section-level index design
- active recall improvements
- context packing
- README/digest strategy
- temporal/stale document handling
- CLI/MCP response formats
- agent handoff UX

This is valuable even if it never becomes a paper.

But if it does become a paper, MindOS gains:

- a technical narrative
- a defensible evaluation standard
- a way to compare against memory systems
- a product credibility artifact

## 9. Realistic Recommendation

I would not start by saying "let's write a big paper".

I would start with:

1. Build a 30-case internal benchmark.
2. Prove it finds real failures.
3. Expand to 100 cases.
4. Add section-level retrieval and context packing baselines.
5. Write a workshop paper draft.
6. Decide whether the results justify scaling to a full paper.

The threshold for "big paper" should be:

- the benchmark exposes failures that existing benchmarks do not
- the Markdown-native method beats strong baselines
- token savings are substantial at equal or better correctness
- the dataset is clean enough to release
- the story generalizes beyond MindOS

## 10. Bottom Line

This can be a paper.

It becomes a **small/workshop paper** if it is mainly a new benchmark and failure analysis.

It becomes a **serious benchmark paper** if the dataset is large, labels are clean, baselines are strong, and metrics include citation/temporal/token dimensions.

It becomes a **big paper** if paired with a strong method: a Markdown memory compiler that demonstrably improves grounded agent workflows per token.

The research opportunity is real because the field is moving toward structured memory, but most evaluation still does not capture how agents use real human-maintained knowledge workspaces. MindOS is unusually well positioned to define that setting.
