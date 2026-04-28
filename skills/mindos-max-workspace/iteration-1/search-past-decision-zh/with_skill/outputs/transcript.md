# Transcript: Search Past Decision — API 限流方案

## User Query

> 上周我记得我们讨论过API限流的方案，具体是怎么定的来着？好像是每分钟100次还是200次？我找不到了。

## Skill Applied

**mindos-max** (v3.0.0-max) — Persistent global memory / knowledge base skill.

## Decision Tree Classification

This is a **Lookup / summarize / quote** request:
- User wants to find a past decision
- No writes needed
- Read-only path: **search → read → answer with citations**

---

## Step 1: Bootstrap — List KB tree to understand structure

Per Rule #1: "Bootstrap first — list the KB tree to understand structure before searching or writing."

### Command

```bash
mindos file list
```

### Expected Output (simulated)

```
/
├── INSTRUCTION.md
├── README.md
├── .mindos/
│   └── user-preferences.md
├── projects/
│   ├── ...
├── meetings/
│   ├── 2026-03-31-weekly.md
│   ├── 2026-04-01-api-design.md
│   ├── 2026-04-03-standup.md
│   └── ...
├── decisions/
│   ├── ...
│   └── api-rate-limiting.md  (possible hit)
├── architecture/
│   ├── ...
├── notes/
│   └── ...
└── inbox/
    └── ...
```

### Rationale

Before searching, I need to see the directory layout. The KB might have a `decisions/` folder, a `meetings/` folder, or use Chinese directory names. I must not assume.

---

## Step 2: Multi-keyword parallel search

Per SKILL rule: "NEVER search with a single keyword. Fire 2-4 parallel searches (synonyms, abbreviations, Chinese/English variants)."

### Commands (run in parallel)

```bash
# Search 1: Chinese term — 限流
mindos search "API限流"

# Search 2: English term — rate limit
mindos search "rate limit"

# Search 3: Specific numbers user mentioned
mindos search "每分钟100次 OR 每分钟200次"

# Search 4: English variant with numbers
mindos search "rate limiting 100 200"
```

### Expected Output (simulated)

```
# Search 1: "API限流"
Results:
  - meetings/2026-04-01-api-design.md (score: 0.92)
    "...讨论了API限流方案，最终确定..."
  - decisions/api-rate-limiting.md (score: 0.88)
    "...API限流策略：每分钟..."

# Search 2: "rate limit"
Results:
  - decisions/api-rate-limiting.md (score: 0.95)
    "...Rate Limiting Policy..."
  - architecture/api-gateway.md (score: 0.61)
    "...rate limiting middleware..."

# Search 3: "每分钟100次 OR 每分钟200次"
Results:
  - decisions/api-rate-limiting.md (score: 0.85)
    "...认证用户每分钟200次，未认证每分钟100次..."

# Search 4: "rate limiting 100 200"
Results:
  - decisions/api-rate-limiting.md (score: 0.82)
```

### Rationale

Multiple parallel searches maximize recall. The user's memory is fuzzy ("100次还是200次?"), so we search for both numbers and both languages. The convergence on `decisions/api-rate-limiting.md` and `meetings/2026-04-01-api-design.md` gives high confidence.

---

## Step 3: Read the top-hit files

Per decision tree: "search → read → answer with citations."

### Commands

```bash
# Read the decision document (highest relevance)
mindos file read decisions/api-rate-limiting.md

# Read the meeting notes for additional context
mindos file read meetings/2026-04-01-api-design.md
```

### Expected Output — decisions/api-rate-limiting.md (simulated)

```markdown
# API 限流策略

**决定日期**: 2026-04-01
**参与者**: @user, @backend-team
**状态**: ✅ 已确定

## 决定

| 用户类型 | 限流阈值 | 窗口 | 超限行为 |
|---------|---------|------|---------|
| 认证用户 | 200 次 | 每分钟 | 返回 429 + Retry-After header |
| 未认证用户 | 100 次 | 每分钟 | 返回 429 + Retry-After header |
| 管理员 API | 500 次 | 每分钟 | 返回 429 + 告警通知 |

## 背景

- 当前无限流，高峰期出现过 P99 延迟飙升
- 参考了 GitHub API (5000/h ≈ 83/min) 和 Stripe (100/s) 的方案
- 最终选择 sliding window 算法 + Redis 实现

## 后续 TODO

- [ ] 在 API Gateway 层实现
- [ ] 添加 X-RateLimit-* response headers
- [ ] 监控 dashboard 配置
```

### Expected Output — meetings/2026-04-01-api-design.md (simulated)

```markdown
# 会议记录: API 设计讨论

**日期**: 2026-04-01
**参会人**: ...

## 议题 3: API 限流

讨论了三个方案：
1. 固定窗口 — 简单但有边界突发问题
2. 滑动窗口 — 选定方案，更平滑
3. 令牌桶 — 过于复杂，暂不需要

最终确定：认证用户 200次/分钟，未认证 100次/分钟。
用 Redis sorted set 实现 sliding window。

详细决策记录见 `decisions/api-rate-limiting.md`。
```

---

## Step 4: Synthesize answer with citations

Per SKILL rule: "KB-cited facts must include the file path."

### Response to User (simulated)

---

找到了！根据知识库中的记录，**上周（4月1日）的 API 设计会议**确定了限流方案，两个数字都对——分用户类型：

| 用户类型 | 限流阈值 |
|---------|---------|
| **认证用户** | **200 次/分钟** |
| **未认证用户** | **100 次/分钟** |
| 管理员 API | 500 次/分钟 |

超限统一返回 `429 Too Many Requests` + `Retry-After` header。技术方案选的是 **sliding window + Redis**。

**来源**：
- `decisions/api-rate-limiting.md` — 完整决策文档
- `meetings/2026-04-01-api-design.md` — 会议记录（议题 3）

---

## Step 5: Post-task hooks check

Per SKILL: "After write tasks (not simple reads), scan this table."

**This was a read-only task. No writes were performed. No post-task hooks apply.**

---

## Summary of Commands Executed

| # | Command | Purpose |
|---|---------|---------|
| 1 | `mindos file list` | Bootstrap — understand KB structure |
| 2 | `mindos search "API限流"` | Search — Chinese term |
| 3 | `mindos search "rate limit"` | Search — English term |
| 4 | `mindos search "每分钟100次 OR 每分钟200次"` | Search — specific numbers |
| 5 | `mindos search "rate limiting 100 200"` | Search — English variant |
| 6 | `mindos file read decisions/api-rate-limiting.md` | Read top hit |
| 7 | `mindos file read meetings/2026-04-01-api-design.md` | Read supporting context |

## Skill Rules Followed

- ✅ **Bootstrap first** (Rule 1) — Listed KB tree before searching
- ✅ **Default to read-only** (Rule 2) — No writes performed for a lookup task
- ✅ **Never search with single keyword** (NEVER rule) — Used 4 parallel searches with Chinese/English variants
- ✅ **Read before write** (Rule 6) — N/A (no writes)
- ✅ **Citation with file path** (Judgment heuristic) — Both source files cited in answer
- ✅ **Decision tree** — Correctly classified as "Lookup / summarize / quote" → read-only path
