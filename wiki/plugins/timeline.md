# Timeline

> 将含日期标题的 Markdown 渲染为垂直时间线。

## 基本信息

| 字段 | 值 |
|------|---|
| ID | `timeline` |
| 图标 | 📅 |
| Core | No |
| 入口文件 | `CHANGELOG.md` |
| 匹配规则 | `/\b(CHANGELOG\|changelog\|TIMELINE\|timeline\|journal\|Journal\|diary\|Diary)\b.*\.md$/i` |

## 文件格式

Markdown 文件，以 `## 日期` 作为时间节点。支持多种日期格式：

```markdown
## 2025-03-15
Started new project phase.
- Created initial architecture
- Set up development environment

## 2025-03-10
Research phase completed. #research #planning
- Analyzed 5 competitor products
- Drafted requirements doc

## 2025-03-01
Project kickoff meeting with stakeholders.
```

### 支持的日期格式

| 格式 | 示例 |
|------|------|
| ISO | `## 2025-03-15` |
| 斜杠 | `## 2025/03/15` |
| 英文月 | `## Mar 2025` / `## March 15, 2025` |

### 内容规范

- 每个 `##` 标题作为一个时间节点
- 标题下的内容作为该节点的详情
- `#tag` 会被自动提取为标签
- 支持标准 Markdown（列表、链接、代码块等）

## 交互功能

- 📅 垂直时间线可视化
- 🏷️ 自动提取 `#tag` 标签
- 📖 Markdown 富文本渲染
- 🔽 时间节点可折叠/展开

## 适用场景

- Changelog（版本更新日志）
- 个人日记 / 周记
- 项目里程碑记录
- 研究时间线
