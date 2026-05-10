# Memory Bench References

> Date: 2026-05-10
> Scope: curated references for Memory Bench, Markdown/workspace memory, agent memory benchmarks, and recent arXiv/OpenReview work.
> Primary use: paper positioning, related work, benchmark design, and novelty checks.

## How to Use This Folder

Start with:

- [2026-agent-memory-papers.md](./2026-agent-memory-papers.md) — annotated bibliography of recent memory papers.

Reading order for writing:

1. **Closest-neighbor papers first**: AGENTS.md evaluation, ByteRover, FS-Researcher.
2. **Benchmark landscape**: MemoryAgentBench, AMA-Bench, StructMemEval, RealMem, Mem2ActBench, BEAM, MemoryArena, MemoryCD.
3. **Method landscape**: LightMem, SimpleMem, PlugMem, MemOS, A-MEM, AgentSys, Memex.
4. **Older anchors**: MemGPT, LoCoMo, LongMemEval, MemoryBank.
5. **Surveys**: recent agent-memory surveys for taxonomy and terminology.

## Updated Novelty Boundary

After this scan, Memory Bench should not claim:

- first LLM agent memory benchmark
- first benchmark beyond chat memory
- first study of AGENTS.md / repository context files
- first markdown/file-based agent memory system

Defensible positioning:

> Memory Bench targets Markdown knowledge workspaces as operational memory: multi-file human-maintained KBs with headings, links, README/INSTRUCTION hierarchy, SOPs, decisions, changelogs, stale/conflicting docs, section-level citation, and token-aware context packing.

The closest-neighbor work now includes:

- [Evaluating AGENTS.md](https://openreview.net/forum?id=u23wy9N0vo)
- [ByteRover](https://arxiv.org/abs/2604.01599)
- [FS-Researcher](https://arxiv.org/abs/2602.01566)
- [StructMemEval](https://arxiv.org/abs/2602.11243)
