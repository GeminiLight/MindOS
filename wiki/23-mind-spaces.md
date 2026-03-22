# 心智空间 (Mind Spaces)

## 定义

> **心智空间是用户心智模型的具象化分区，每个空间有独立的 Agent 行为规则，让 AI 在不同认知语境下自动切换工作模式。**

Space ≠ 文件夹。文件夹是被动容器，Space 是 **Agent 执行上下文**。

## Space 与文件夹的本质区别

| 维度 | 文件夹 (Finder/Obsidian) | 心智空间 (MindOS Space) |
|------|------------------------|----------------------|
| **本质** | 被动容器，存放文件 | Agent 执行上下文——AI 进入时切换行为模式 |
| **智能** | 没有 | 有 INSTRUCTION.md，定义"在这里 Agent 该怎么做" |
| **边界** | 纯物理分区 | 认知边界——"这是我的身份信息" vs "这是我的工作流" |
| **交互** | 打开 → 看到文件列表 | 进入 → Agent 理解上下文 → 按规则执行 |
| **结构** | 无约束 | 推荐 Schema（如 Profile 有 Identity/Focus/Preferences） |
| **关联** | 无语义关联 | 跨空间引用（Workflows 引用 Profile 数据） |

## Space 的六个维度

| 维度 | 定义 | 技术实现 |
|------|------|---------|
| **Purpose** | 每个 Space 有一个明确的认知职能 | README.md 第一段描述 |
| **Rules** | INSTRUCTION.md 定义 Agent 在此空间的行为约束 | bootstrap 第 5 步自动加载 |
| **Schema** | 空间内文件有推荐的结构模式 | README.md 的 Structure 部分 |
| **Context** | Agent 进入空间时自动加载上下文 | `/api/bootstrap?target_dir=` |
| **Cross-ref** | 空间之间可以互相引用 | Markdown 链接 + backlinks |
| **Health** | 空间有活跃度、完整度 | 首页 Space 卡片展示文件数 |

## 预置的 6 个心智空间

| Space | 认知职能 | Agent 在这里做什么 | 描述 |
|-------|---------|------------------|------|
| 👤 **Profile** | 我是谁 | 维护身份、偏好、目标——所有 Agent 的"了解你"锚点 | Primary entry for stable personal context |
| 📝 **Notes** | 我在想什么 | 快速捕捉、分类整理、迁移到其他空间 | Quick capture and lightweight notes |
| 🔗 **Connections** | 我认识谁 | 人脉关系、联系方式、互动记录 | Reusable relationship context |
| 🔄 **Workflows** | 我怎么做事 | SOP、流程模板、可复用的工作方法 | Workflow SOPs and process templates |
| 📚 **Resources** | 我积累了什么 | 结构化数据（产品库、工具列表、参考资料） | External resource collections and indexes |
| 🚀 **Projects** | 我在做什么 | 项目计划、进度跟踪、交付物 | Product and research project workspaces |

## 用户自建空间

用户可以创建任意一级目录作为新的 Space（如 `📖 Learning`、`💰 Investments`）。自动脚手架（`space-scaffold.ts`）会：

1. 生成 `INSTRUCTION.md`（通用模板，Agent 立即可用）
2. 生成 `README.md`（空骨架，用户自定义）
3. 首页自动出现新的 Space 卡片

## 用户体验差异

**普通笔记 App**：
```
用户：帮我整理这个会议纪要
AI：好的，我把内容整理了（不知道放哪里，不知道什么格式）
```

**MindOS Space**：
```
用户：帮我整理这个会议纪要
AI：[进入 📝 Notes → 读 INSTRUCTION → 用 Inbox/ 收录]
    → 已存入 📝 Notes/Inbox/2026-03-22-meeting.md
    → 检测到提及了 @张三 → 建议更新 🔗 Connections
    → 检测到有 action item → 建议添加到 🚀 Projects
```

AI 不只是处理内容，还**理解内容属于哪个认知空间**，并提示跨空间的关联操作。

## 首页展示

首页"🧠 Spaces"区域展示所有 Space 卡片，每张卡片包含：

- emoji 图标（从目录名提取）
- 空间名称（剥离 emoji）
- 一句话描述（从 README.md 第一段提取）
- 文件数量
- 空 Space 虚线边框（暗示"可以往这里加内容"）

## 技术实现

- 后端自动脚手架：`app/lib/core/space-scaffold.ts`
- 首页数据层：`app/app/page.tsx` → `getTopLevelDirs()`
- 首页视图层：`app/components/HomeContent.tsx` → Section 2: Spaces
- Space 描述提取：从 `{space}/README.md` 读取标题后第一段非空文本
- Spec：`wiki/specs/spec-space-auto-scaffolding.md`
