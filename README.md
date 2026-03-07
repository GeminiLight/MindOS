# SOP Note

个人知识库与 SOP 系统，将工作流程、偏好和配置沉淀为可复用的文档，供 Agent 执行时直接引用。

## ✨ 项目特点

- **一次定义，随处执行** — 重复操作写成 SOP，Agent 按步骤执行，无需每次对话重复说明
- **人机共读** — 内容面向 Agent 执行，格式同样对人类友好易读
- **场景分类** — 按科研、创业、配置、成长等场景组织，职责清晰不混杂
- **持续沉淀** — 随着使用不断完善，个人偏好和最佳实践逐步积累

## 🤖 Agent 使用指南

### 进入项目时

1. 先读取本文件（README.md），了解整体结构
2. 根据任务类型，进入对应目录读取相关 SOP
3. 执行环境配置类任务前，先读取 `Configurations/🧠 使用规范.md`

### 各目录适用任务

| 目录 | 适用任务 |
|------|----------|
| `Configurations/` | 环境初始化、工具安装、Agent 配置 |
| `Research/` | 文献调研、idea 生成、实验、论文写作与投稿 |
| `Startup/` | 产品设计、技术开发、市场营销 |
| `Growth/` | 个人成长、学习规划 |

## 📁 目录结构

```
sop_note/
├── Configurations/     # 环境配置与工具 SOP
│   ├── 🧠 使用规范.md
│   ├── 🖥️ Server Setup.md
│   ├── 💻 MacBook Setup.md
│   ├── 🤖 Agent 工具配置.md
│   ├── Agents/         # Claude Code、MCP、Skill 配置
│   ├── Apps/           # 常用软件清单
│   ├── Tools/          # SSH、Python、HuggingFace 配置
│   └── Orgs/           # 公司特定配置（腾讯等）
├── Research/           # 科研工作流
│   ├── Survey/
│   ├── Ideation/
│   ├── Experiment/
│   ├── Writing/
│   └── Review/
├── Startup/            # 创业相关
│   ├── Product/
│   ├── Development/
│   └── Marketing/
└── Growth/             # 个人成长
    ├── Information/
    └── Cognition/
```

## 📐 扩展规范

### 新增文件

- 文件名以 emoji 开头，使用中文，英文专有名词保留原文
- 新增后必须同步更新所属目录的索引文件（如 `使用规范.md`）

### 新增目录

- 目录名使用英文，体现领域或场景
- 在 README.md 目录结构和目录职责表中同步更新

### 文件变更

- 文件重命名或移动后，更新所有引用该文件的地方
- `README.md` 是项目总索引，目录结构变更必须同步更新
- `Configurations/🧠 使用规范.md` 是 `Configurations/` 目录的索引，该目录内的变更必须同步更新

## 📝 格式规范

- 命令统一用 code 格式，独立执行的命令用 code block，行内提及用 `行内代码`
- 章节标题和关键条目适当添加 emoji
- 内容精炼，不啰嗦，面向执行而非解释
