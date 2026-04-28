# Transcript: Search Past Decision — API Rate Limiting

## User Request

> 上周我记得我们讨论过API限流的方案，具体是怎么定的来着？好像是每分钟100次还是200次？我找不到了。

## Decision Tree Classification

**Category: Lookup / summarize / quote**
→ Read-only path: search → read → answer with citations. No writes.

The user wants to recall a past decision about API rate limiting. They remember discussing it but can't find it. This is a pure search-and-retrieve task.

---

## Step 1: Bootstrap — List KB Tree

**Command:**
```bash
mindos file list
```

**Purpose:** Understand the knowledge base structure before searching. Identify likely directories where meeting notes, decisions, or architecture docs might live (e.g., `meetings/`, `decisions/`, `architecture/`, `discussions/`, etc.).

**Expected output:** A tree listing of all files and directories in the knowledge base, which tells us where to focus our search.

---

## Step 2: Parallel Multi-Keyword Search

Per the skill rule: **"NEVER search with a single keyword. Fire 2-4 parallel searches (synonyms, abbreviations, Chinese/English variants)."**

The user's query involves API rate limiting discussed last week. We fire 4 parallel searches covering Chinese/English variants and synonyms:

**Search 1 — Chinese term (限流):**
```bash
mindos search "API限流"
```

**Search 2 — Chinese synonym (速率限制):**
```bash
mindos search "速率限制"
```

**Search 3 — English term:**
```bash
mindos search "rate limit"
```

**Search 4 — Specific numbers the user recalls:**
```bash
mindos search "每分钟100次"
```

All four searches run in parallel to maximize coverage.

---

## Step 3: Read Matching Files

Based on the search results, read the top matching files to find the specific discussion/decision.

**Commands (example — actual paths depend on search results):**
```bash
mindos file read "meetings/2026-03-31-api-design.md"
mindos file read "decisions/api-rate-limiting.md"
mindos file read "architecture/api-gateway.md"
```

We would read each file that matched the search queries, looking for:
- Specific rate limit numbers (100/min vs 200/min)
- Decision rationale
- Date of discussion (last week)
- Participants or context

---

## Step 4: Answer with Citations

After reading the matching files, synthesize the answer and **cite the file paths** (per the skill rule: "KB-cited facts must include the file path").

**Example response (simulated — actual content depends on KB):**

---

### If results are found:

> 找到了！根据 `meetings/2026-03-31-api-design.md` 的记录：
>
> 上周讨论的 API 限流方案最终定为 **每分钟 200 次**（per user），具体决策如下：
>
> - 普通用户：200 次/分钟
> - 免费用户：60 次/分钟
> - 超限返回 HTTP 429，附带 `Retry-After` header
>
> 讨论中也考虑过 100 次/分钟的方案，但因为 [具体原因] 最终选择了 200 次。
>
> **来源：** `meetings/2026-03-31-api-design.md`，第 45-62 行

### If no results are found:

> 我在知识库中搜索了以下关键词，但没有找到关于 API 限流讨论的记录：
> - "API限流"
> - "速率限制"
> - "rate limit"
> - "每分钟100次"
>
> 可能的原因：
> 1. 这次讨论还没有被记录到知识库中
> 2. 记录使用了不同的措辞
>
> 建议：
> - 你是否记得是在哪个文件或哪次会议中讨论的？我可以缩小搜索范围
> - 如果你回忆起了具体内容，我可以帮你记录下来

---

## Step 5: Post-Task Check

Since this is a **read-only** task, no post-task hooks apply. The skill states:
> "After write tasks (not simple reads), scan this table."

No writes were performed, so no hooks are triggered.

---

## Summary of Simulated Actions

| Step | Action | Command(s) | Write? |
|------|--------|------------|--------|
| 1 | Bootstrap KB tree | `mindos file list` | No |
| 2 | Parallel search (4 queries) | `mindos search "API限流"`, `mindos search "速率限制"`, `mindos search "rate limit"`, `mindos search "每分钟100次"` | No |
| 3 | Read matching files | `mindos file read <path>` (for each match) | No |
| 4 | Answer with citations | (text response to user) | No |
| 5 | Post-task hooks | Skipped (read-only task) | No |

## Key Skill Rules Applied

1. **Bootstrap first** — Listed KB tree before searching (Rule 1)
2. **Default to read-only** — User is looking up info, not saving; no writes performed (Rule 2)
3. **NEVER search with a single keyword** — Fired 4 parallel searches with Chinese/English variants and synonyms (NEVER rule 4)
4. **Citation** — All KB-cited facts would include file paths (Judgment heuristic)
5. **Decision tree** — Correctly classified as "Lookup / summarize / quote" → read-only path
