# Workflow Runner

> 将步骤式 Markdown 渲染为可交互的 AI 工作流执行器。

## 基本信息

| 字段 | 值 |
|------|---|
| ID | `workflow` |
| 图标 | ⚡ |
| Core | No |
| 入口文件 | `Workflow.md` |
| 匹配规则 | `/\b(Workflow\|workflow\|WORKFLOW)\b.*\.md$/i` |

## 文件格式

Markdown 文件，`# 标题` 定义工作流名称，`## Step N: 描述` 定义步骤。

```markdown
# Weekly Review Workflow

## Step 1: Collect recent changes
List all files modified in the past 7 days and summarize key changes.

## Step 2: Review open TODOs
Check TODO.md for overdue items and update priorities.

## Step 3: Plan next week
Based on the review, create next week's focus areas and add to TODO.md.

## Step 4: Archive completed items
Move completed items from TODAY section to an archive file.
```

### 格式规范

- **`# 标题`**：工作流名称（整个文件一个）
- **`## Step N: 描述`**：步骤标题（N 为序号，描述为人类可读说明）
- **步骤正文**：该步骤的详细指令，AI 执行时作为 prompt 上下文
- 步骤按文档顺序依次执行

## 交互功能

- ▶️ **Run**：执行当前步骤（AI 流式输出结果）
- ⏭️ **Skip**：跳过当前步骤
- 🔄 **Reset**：重置步骤状态
- 📊 **Progress Bar**：可视化执行进度
- 📝 **实时输出**：AI 响应流式显示
- 🔢 **步骤状态**：pending → running → done / error / skipped

## 适用场景

- 周 / 月度回顾流程
- 新项目初始化 checklist
- 内容发布审核流程
- 任何需要 AI 辅助的多步骤任务
