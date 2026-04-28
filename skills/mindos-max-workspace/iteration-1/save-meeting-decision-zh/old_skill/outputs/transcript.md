# Transcript: Save Meeting Decision (NPS + Open Comments)

## Task

用户请求：「我昨天跟产品经理开会讨论了一个新的用户反馈系统的方案，他们建议用NPS打分加上开放式评论，我觉得挺好的。帮我把这个决策记下来，以后其他同事问起来可以查到。」

## Skill Analysis

According to the SKILL.md decision tree, this is a **"Save / record / update / organize specific content"** task — the user explicitly says "帮我把这个决策记下来" (help me record this decision). This is a **single-file write** operation.

## Execution Plan

### Step 1: Bootstrap — List KB tree to understand structure

```bash
mindos file list
```

**Purpose**: Understand the knowledge base directory structure before deciding where to save the note. Per SKILL rule #1: "Bootstrap first — list the KB tree to understand structure before searching or writing."

**Expected output**: A tree of directories and files in the KB. We need to identify:
- Is there a `decisions/` or `决策/` directory?
- Is there a `meetings/` or `会议/` directory?
- What is the general organizational pattern (Chinese vs English names, flat vs nested)?

### Step 2: Search for existing related content

Per SKILL rule: "NEVER search with a single keyword. Fire 2-4 parallel searches."

```bash
mindos search "用户反馈"
mindos search "NPS"
mindos search "feedback system"
mindos search "反馈系统"
```

**Purpose**: Check if there's already a file about user feedback systems, NPS, or related decisions. We should not create duplicates — if an existing file covers this topic, we should append or update it instead.

### Step 3: Check sibling files in target directory

Per SKILL rule: "NEVER create a file without checking siblings. Read 1-2 files in the target directory to learn local style."

```bash
mindos file read <target-directory>/some-existing-file.md
```

**Purpose**: Learn the local file style (heading structure, metadata conventions, language) before writing. For example, if existing decision files use a specific template with `## 背景`, `## 决策`, `## 理由` sections, we should follow that pattern.

### Step 4: Create the decision note

Assuming the KB has a decisions-related directory (e.g., `decisions/` or `决策/`), we would create a new file. If no such directory exists, we'd use the closest fitting location (e.g., `meetings/` or an inbox).

```bash
mindos file create "decisions/2026-04-06-user-feedback-system-nps.md" --content "# 用户反馈系统方案决策：NPS + 开放式评论

## 决策摘要

采用 **NPS 打分 + 开放式评论** 作为新的用户反馈系统方案。

## 背景

与产品经理开会讨论新的用户反馈系统方案（2026-04-06）。

## 决策内容

- **反馈方式**：NPS（Net Promoter Score）打分 + 开放式评论
- **NPS 打分**：标准 0-10 分制，衡量用户推荐意愿
- **开放式评论**：允许用户自由填写反馈内容，补充定量分数无法覆盖的细节
- **决策状态**：已确认采纳

## 参与者

- 产品经理（提议方）
- 本人（确认同意）

## 理由

产品经理建议该方案，综合评估后认为合理：
- NPS 是业界成熟的用户满意度衡量标准，便于横向对比
- 开放式评论可以捕获结构化打分无法覆盖的具体问题和建议
- 两者结合兼顾定量分析和定性洞察

## 后续 TODO

- [ ] 确定 NPS 调研的触发时机（如使用后 X 天、关键操作后）
- [ ] 设计评论区的引导性问题（可选）
- [ ] 技术方案评审
"
```

### Step 5: Post-task hooks check

After the write, scan the post-task hooks table:

| Hook | Check | Result |
|------|-------|--------|
| Experience capture | Was this debugging/troubleshooting/multi-round? | No — straightforward save. **Skip.** |
| Consistency sync | Does the new file have backlinks? | No — newly created file. **Skip.** |
| SOP drift | Did we follow an SOP? | No SOP involved. **Skip.** |
| Linked update | Changed CSV/TODO with related docs? | No. **Skip.** |
| Structure classification | Created file in inbox/temp? | No — placed in appropriate directory. **Skip.** |
| Pattern extraction | 3+ similar operations? | No. **Skip.** |

No post-task hooks triggered.

### Step 6: Confirm to user

> 已将决策记录保存到 `decisions/2026-04-06-user-feedback-system-nps.md`。
>
> 内容包括：决策摘要（NPS + 开放式评论）、背景、具体方案、参与者、理由和后续 TODO。
>
> 以后同事查找时可以搜索「NPS」「用户反馈」等关键词找到这份记录。

---

## Notes on Simulation

- The actual target directory would depend on the KB's real structure (revealed by `mindos file list`). The path `decisions/...` is an example; the real path would be inferred from bootstrap.
- If no `decisions/` directory exists, we would either create one (with user confirmation) or place the file in the most fitting existing directory.
- The file content format would be adjusted to match sibling file conventions discovered in Step 3.
- Date in filename uses the meeting date (yesterday = 2026-04-06), not today's date.
