# Memory Bench: Markdown-Native Agent Memory Benchmark

> Status: research proposal
> Date: 2026-05-10
> Scope: benchmark design for Markdown-driven long-term memory systems
> Related: `wiki/discussions/Memory/03-token-optimization-strategy.md`

See also:

- [literature-scan-2026-05-10.md](./literature-scan-2026-05-10.md) for the latest arXiv/OpenReview scan and updated novelty assessment.
- [benchmark-construction-methodology-zh.md](./benchmark-construction-methodology-zh.md) for a detailed Chinese methodology on building Memory Bench.
- [references/README.md](./references/README.md) for curated memory-paper references and reading order.
- [research-writing-zh.md](./research-writing-zh.md) for Chinese research writing, paper narrative, and section structure.
- [publication-potential.md](./publication-potential.md) for paper framing, contribution options, and publication path.

## Executive Summary

Yes, MindOS should build a Markdown-native memory benchmark.

The reason is not just academic. Most existing memory benchmarks are optimized for **chat history memory**: can an assistant remember facts from previous conversations, answer temporal questions, or retrieve a personal preference from a long dialogue. That is useful, but it misses the core MindOS problem:

> Can an agent use a living Markdown knowledge base as operational memory, with files, headings, links, README summaries, instructions, decisions, SOPs, changelogs, and stale/conflicting documents?

That problem is different enough to deserve its own benchmark. It is also strategically important: if MindOS can define this benchmark well, it can turn its product philosophy into a measurable technical standard.

The first version should not try to become a public leaderboard. It should be an **internal product benchmark** used to decide whether memory changes actually improve answer quality, reduce token cost, and help coding agents avoid repeated mistakes.

Recommended path:

1. Build a small internal benchmark from real MindOS docs.
2. Add synthetic Markdown KB tasks for scale and controlled edge cases.
3. Measure retrieval, answer quality, citation support, temporal correctness, and token cost together.
4. Use it to compare current active recall against section-level recall, context packing, link-aware ranking, temporal ranking, and offline digests.
5. Only after it proves useful internally, package a sanitized public version.

## 1. Why Existing Memory Benchmarks Are Not Enough

### 1.1 What current benchmarks usually test

Most memory benchmarks focus on long conversational memory:

- A user said something in session 1.
- The assistant must recall it in session 8.
- A fact changed over time.
- The assistant must answer with the newest version.
- The assistant should abstain if the memory does not contain the answer.

This is valuable. It tests things like:

- long-term retention
- temporal reasoning
- preference recall
- multi-session QA
- conflict between old and new facts

Examples include LoCoMo, LongMemEval, Mem0-style evaluations, and newer long-context memory tasks.

### 1.2 What they miss for MindOS

MindOS is not primarily a chat transcript database. It is a Markdown-driven memory system. That means the important questions are different:

| Existing chat-memory benchmark | MindOS memory problem |
|---|---|
| Remember a fact from a past conversation | Find the canonical decision note or SOP |
| Retrieve a user preference | Apply user/project/space instruction precedence |
| Answer a temporal chat question | Distinguish old specs, current README, changelog, and git history |
| Search unstructured dialogue | Use headings, file paths, backlinks, frontmatter, and directory semantics |
| Summarize a conversation | Continue a real agent workflow without repeating old work |
| Test answer accuracy only | Test answer accuracy, citation support, token cost, and tool behavior |

The core MindOS question is:

> Given a local Markdown knowledge base, can an agent identify the smallest sufficient set of trustworthy sections and use them correctly?

That is not covered well by existing benchmarks.

## 2. Is This Significant?

Yes, if scoped correctly.

### 2.1 Product significance

Memory is one of MindOS's core claims. Without a benchmark, it is hard to know whether a new retrieval or summarization idea actually helps.

A Memory Bench would let us answer:

- Did section-level recall improve accuracy or just change outputs?
- Does link-aware ranking help multi-hop tasks?
- Does offline digest save tokens without losing exact details?
- Does context packing reduce prompt size while preserving citations?
- Does the agent still follow project rules after the KB grows 10x?
- Are we making common workflows faster or just adding architecture?

This converts memory design from taste-driven to evidence-driven.

### 2.2 Strategic significance

If MindOS can define a benchmark around Markdown KBs, it owns a sharper category:

> Markdown-native operational memory for agents.

That is more differentiated than "another AI memory system".

The benchmark itself can become:

- a product quality gate
- a public technical artifact
- a comparison against Mem0/Letta/Zep-style systems
- a reason to explain why Markdown source-of-truth matters
- a way to show token savings without hiding accuracy tradeoffs

### 2.3 Engineering significance

Memory work is full of false positives. Many ideas feel good but fail in real tasks:

- embeddings retrieve semantically similar but operationally wrong notes
- summaries omit flags, exceptions, and negations
- top-k retrieval returns duplicate sections
- old specs outrank current instructions
- agents ignore recalled evidence
- token cost shifts from prompt to reranking or summarization

A benchmark catches these before they become product complexity.

## 3. What Memory Bench Should Measure

The benchmark should measure four layers at once.

## 3.1 Retrieval quality

Can the system find the right memory?

Metrics:

- Recall@k
- Precision@k
- MRR
- nDCG
- section hit rate
- source diversity
- duplicate hit rate
- stale hit rate

Important distinction:

- file hit is not enough
- section hit is better
- canonical source hit is best

Example:

```yaml
query: "现在 Desktop 应该怎么发版？"
acceptable_file: AGENTS.md
gold_section: "Desktop 发版步骤"
canonical: true
must_not_rank_above:
  - "npm run release 发版说明"
```

## 3.2 Answer quality

Can the model answer correctly using the memory?

Metrics:

- factual correctness
- step completeness
- temporal correctness
- contradiction awareness
- abstention correctness
- hallucination rate
- instruction compliance

For MindOS, answer quality must include operational correctness. A release answer with one wrong flag is not "mostly correct".

## 3.3 Grounding and citation quality

Can the answer prove itself?

Metrics:

- citation accuracy
- citation sufficiency
- unsupported claim count
- wrong-source citation count
- path/heading precision

This is crucial because MindOS sells control and auditability. If the answer is right but cannot point to the right Markdown source, the memory system is not trustworthy enough.

## 3.4 Cost and efficiency

Does it spend less to get the same or better result?

Metrics:

- input tokens
- active recall tokens
- bootstrap tokens
- tool schema tokens
- output tokens
- search latency
- indexing latency
- LLM rerank calls
- summarization calls
- total API cost
- p50 / p95 latency

The key metric should be:

> grounded task success per 1K input tokens

That prevents fake wins where token usage falls but answers get worse.

## 4. Task Taxonomy

Memory Bench should include tasks that reflect real Markdown KB usage.

## 4.1 Exact fact lookup

Question:

> npm release 默认应该用 patch/minor/major 哪个？

Tests:

- exact match
- instruction retrieval
- current policy

Gold:

- answer includes "patch unless explicitly specified"
- cites release instructions

## 4.2 Procedure retrieval

Question:

> Desktop 怎么发版？

Tests:

- SOP retrieval
- ordered steps
- exact flags
- avoiding adjacent-but-wrong npm release docs

Gold:

- GitHub Actions workflow
- `publish=true`
- `tag=desktop-v<VERSION>`
- not `npm run release`

## 4.3 Decision rationale

Question:

> 为什么产品主包固定为 packages/mindos？

Tests:

- decision history
- rationale extraction
- package boundary docs

Gold:

- cites package dependency boundary
- explains runtime closure and OpenCode-style direction

## 4.4 Latest policy

Question:

> 现在 Web 源码在哪里？

Tests:

- freshness
- superseded architecture
- stale spec suppression

Gold:

- `packages/web` is canonical
- npm package does not contain source copy

## 4.5 Historical reasoning

Question:

> 之前为什么绝对禁止 merge public/main？

Tests:

- old incident recall
- cause/effect
- policy rationale

Gold:

- public repo is a subset
- merge can delete dev-only files
- sync is one-way through CI

## 4.6 Multi-hop Markdown graph

Question:

> Desktop release 和 npm package version 应该怎么对齐？

Tests:

- link/backlink traversal
- release docs + desktop docs
- version semantics

Gold:

- MindOS product version follows `@geminilight/mindos`
- Desktop shell version is separate
- bundled MindOS should come from same tag when shipping Desktop

## 4.7 Conflict detection

Question:

> 这些发版说明有没有冲突？

Tests:

- contradiction detection
- source authority
- current vs stale docs

Gold:

- identifies conflicting instructions if present
- does not merge incompatible flows
- recommends canonical source

## 4.8 Abstention

Question:

> Android release 的完整流程是什么？

Tests:

- missing information
- refusal to fabricate
- suggests where to look or what is absent

Gold:

- says no sufficient evidence if KB lacks it
- does not invent steps

## 4.9 Troubleshooting / known pitfall

Question:

> Desktop release 文件名版本号不对怎么办？

Tests:

- pitfall recall
- exact remediation

Gold:

- likely cause: forgot `tag`
- delete bad release if needed
- rerun Build Desktop with correct tag

## 4.10 Agent handoff

Prompt:

> 继续上次 Memory token optimization 的讨论，别重复调研，告诉我下一步该评测什么。

Tests:

- session continuity
- avoiding repeated work
- summarizing current state
- next action recommendation

Gold:

- cites current discussion doc
- proposes benchmark cases / ablations
- does not restart generic landscape research

## 4.11 User/project preference

Question:

> 这个项目里改代码前后测试和 wiki 的要求是什么？

Tests:

- AGENTS instruction retrieval
- preference/rule extraction
- hierarchy of instructions

Gold:

- tests first where applicable
- update wiki after code changes
- UI changes require screenshots

## 4.12 Synthesis with evidence

Question:

> 给我一个 Memory token optimization 的优先级路线图。

Tests:

- broad recall
- synthesis
- evidence-backed planning
- no overclaiming

Gold:

- section-level recall / context packing / ranking / benchmark
- explains why vector-only is insufficient
- cites research docs

## 5. Dataset Design

Memory Bench should have three tracks.

## 5.1 Track A: Real MindOS Docs

Use curated slices of the actual repo docs:

- `AGENTS.md`
- `wiki/discussions/Memory/*`
- `wiki/specs/*`
- `wiki/reviews/*`
- `wiki/refs/*`
- `wiki/85-backlog.md`
- `wiki/90-changelog.md`

Purpose:

- high realism
- immediately useful for product quality
- catches regressions in real workflows

Risk:

- gold answers require maintenance
- private/dev-only docs may not be publishable

Recommended size:

- v0: 30 cases
- v1: 100 cases
- v2: 300 cases

## 5.2 Track B: Synthetic Markdown KB

Generate controlled KBs:

```text
kb-50/
kb-500/
kb-5000/
```

Each KB includes:

- Spaces
- README files
- INSTRUCTION files
- decision notes
- SOPs
- changelogs
- stale specs
- duplicated docs
- linked notes
- missing-answer distractors
- conflicting instructions

Purpose:

- scale testing
- controlled gold labels
- stress tests
- public shareability

Synthetic data should still look like real Markdown, not random facts.

## 5.3 Track C: Agent Workflow Memory

Simulate multi-session agent work:

1. Session 1: user asks agent to plan/fix/research.
2. Session 2: agent records decisions, pitfalls, partial work.
3. Session 3: new agent must continue using memory.

Purpose:

- test actual agent continuity
- measure repeated work
- measure rule violations
- evaluate cross-agent handoff

This is the most product-relevant track, but also the hardest to judge automatically.

## 6. Case Format

Recommended YAML shape:

```yaml
id: desktop-release-current-flow
track: real-mindos
category: procedure
query: "现在 Desktop 应该怎么发版？"
scope:
  include:
    - AGENTS.md
    - wiki/**
  exclude:
    - packages/**
gold:
  sections:
    - path: AGENTS.md
      heading: "Desktop 发版步骤"
      required: true
  must_include:
    - "Build Desktop"
    - "publish=true"
    - "tag=desktop-v<VERSION>"
  must_not_include:
    - "npm run release"
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
metrics:
  freshness_required: true
  exact_steps_required: true
  max_context_tokens_target: 1200
```

## 7. Evaluation Pipeline

The benchmark should separate retrieval from answer generation.

## 7.1 Retrieval-only evaluation

Input:

- KB
- query
- memory strategy

Output:

- ranked sections/files
- scores
- token counts
- latency

Measures:

- did the correct section appear?
- how high?
- how many irrelevant sections?
- how many stale sections?
- how many tokens would be injected?

This can run cheaply and frequently.

## 7.2 Context-packing evaluation

Input:

- ranked candidates
- token budget
- packing strategy

Output:

- final memory context

Measures:

- includes enough evidence?
- duplicates removed?
- exact steps preserved?
- citations preserved?
- fits budget?

This is where MindOS can directly evaluate token optimization.

## 7.3 End-to-end answer evaluation

Input:

- query
- packed memory context
- answer model

Output:

- answer
- citations
- token usage

Measures:

- answer correctness
- citation support
- hallucination
- instruction compliance
- cost

This is slower and should run in nightly or release checks, not every commit.

## 7.4 Agent workflow evaluation

Input:

- task
- KB
- tool access
- agent runtime

Output:

- transcript
- file reads
- commands
- final result

Measures:

- task success
- wrong file reads
- repeated work
- known pitfall violations
- tool call count
- token usage

This track is the most meaningful for MindOS's real value, but needs careful harness design.

## 8. Baselines

Compare at least:

| Baseline | Meaning |
|---|---|
| No memory | answer without KB recall |
| Full context small KB | upper-ish bound for small cases |
| Current active recall | existing hybrid search + snippet expansion |
| File BM25 | file-level keyword retrieval |
| File hybrid | current BM25 + embedding at file level |
| Section BM25 | heading-aware section retrieval |
| Section hybrid | section BM25 + section embeddings |
| Section + packer | section retrieval plus evidence cards |
| Section + links/time | link-aware and temporal ranking |
| Offline digest | topic/decision/SOP digest included |
| External memory | optional Mem0/Letta/Zep-style comparison |

The most important comparison is not against every external system. It is:

> current MindOS vs next MindOS memory strategy.

## 9. Scoring Model

Avoid a single opaque score at first. Use a scorecard.

```text
final_score =
  0.35 * answer_correctness
  + 0.20 * citation_support
  + 0.15 * retrieval_quality
  + 0.15 * temporal_correctness
  + 0.10 * token_efficiency
  + 0.05 * latency_efficiency
```

But keep raw metrics visible. A system that saves 70% tokens while losing exact release flags should not be considered better.

## 10. Why This Benchmark Could Matter Publicly

If matured, Memory Bench could define a niche that existing benchmarks under-serve:

> Can AI agents operate from a human-maintained Markdown knowledge base?

That matters because many real users already store knowledge in:

- Markdown repos
- Obsidian vaults
- Logseq graphs
- GitHub docs
- Cursor/Claude project instructions
- personal SOPs
- changelogs and decision records

The benchmark could become a bridge between note-taking, agent memory, and software engineering workflows.

Public positioning:

- Not "another long chat memory benchmark".
- Not "vector DB retrieval benchmark".
- A benchmark for **operational memory in Markdown workspaces**.

## 11. Feasible Path

## 11.1 Phase 0: Research framing

Deliverables:

- this proposal
- task taxonomy
- metrics list
- baseline list

Decision gate:

- agree that the benchmark is for Markdown operational memory, not generic chat memory

## 11.2 Phase 1: Internal seed benchmark

Build:

- 30 real MindOS cases
- manual gold sections
- deterministic judges for exact tasks
- simple YAML case format
- retrieval-only runner

Goal:

- identify where current active recall fails
- create a regression suite for section recall

Success criteria:

- current baseline can run end-to-end
- failures are interpretable
- at least 5 cases expose real current weaknesses

## 11.3 Phase 2: Section and packing experiments

Add strategies:

- file-level current recall
- section-level BM25
- section-level hybrid
- evidence-card packer
- simple title/path boost

Goal:

- prove or disprove the core hypothesis:

> Markdown section recall gives better grounded answers per token than file/snippet recall.

Success criteria:

- improved section hit rate
- lower injected tokens
- equal or better answer correctness
- better citation support

## 11.4 Phase 3: Synthetic KB generator

Build controlled datasets:

- `kb-50`
- `kb-500`
- `kb-5000`

Generate:

- canonical docs
- stale docs
- conflicts
- links
- repeated docs
- missing answers

Goal:

- test scale and edge cases
- make a publishable benchmark subset

## 11.5 Phase 4: Agent workflow track

Build multi-session tasks:

- bug fix handoff
- release workflow
- spec continuation
- design decision reuse
- known pitfall avoidance

Goal:

- measure whether memory helps agents actually work better, not just answer questions.

## 11.6 Phase 5: Public release candidate

Only after internal utility is proven:

- sanitize docs
- publish synthetic + small real-like dataset
- document baseline scripts
- publish current MindOS score
- invite external memory systems to run

## 12. Risks

## 12.1 Benchmark overfitting

Risk:

- optimizing for benchmark cases instead of real workflows

Mitigation:

- keep private holdout cases
- rotate real cases
- include agent workflow tasks

## 12.2 Judge unreliability

Risk:

- LLM judge favors verbose answers or its own style

Mitigation:

- deterministic checks where possible
- rubric-based LLM judge
- human audits
- citation verification

## 12.3 Data maintenance cost

Risk:

- real docs change, gold answers go stale

Mitigation:

- versioned benchmark snapshots
- case owner metadata
- expected update process

## 12.4 Public benchmark distraction

Risk:

- trying to publish too early slows product work

Mitigation:

- internal-first
- public release only after benchmark catches real regressions

## 12.5 Synthetic data unreality

Risk:

- generated KBs do not reflect real Markdown habits

Mitigation:

- derive templates from real docs
- include messy docs, duplicate docs, half-written docs, old specs

## 13. Open Research Questions

1. What is the minimum case count that catches meaningful regressions?
2. Should gold labels be file-level, section-level, or line-level?
3. How much of answer judging can be deterministic?
4. How should citation support be verified automatically?
5. What is the right token-efficiency metric: total input tokens, recall tokens, or cost-normalized task success?
6. How do we fairly compare against external systems that do not preserve Markdown sections?
7. Should public Memory Bench include agent tool use, or only retrieval + answer?
8. How do we model user-maintained links vs inferred links?
9. How do we include Git history without making setup too heavy?
10. How do we test memory write quality, not just recall quality?

## 14. Recommendation

Build it, but start small and internal.

The meaningful first milestone is not a leaderboard. It is a 30-case benchmark that can answer:

- current active recall fails where?
- section-level recall helps where?
- how many tokens does context packing save?
- do citations get better?
- do latest/current questions stop using stale docs?

If that 30-case benchmark changes engineering decisions, expand it. If it does not, do not scale it.

The north star:

> Memory Bench should measure whether a coding or research agent can use a Markdown knowledge base the way a careful human teammate would: find the canonical note, respect hierarchy and time, cite evidence, avoid stale instructions, and spend only the context it needs.
