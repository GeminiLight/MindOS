<p align="center">
  <img src="assets/logo-square.svg" alt="MindOS" width="80" />
  <br />
  <strong style="font-size: 1.5em;">MindOS</strong>
</p>

<p align="center">
  <strong>人类在此思考，Agent 依此行动。</strong>
</p>

<p align="center">
  <a href="README.md">English</a> | <a href="README_zh.md">中文</a>
</p>

<p align="center">
  <a href="https://deepwiki.com/GeminiLight/MindOS"><img src="https://img.shields.io/badge/DeepWiki-MindOS-blue.svg?style=for-the-badge" alt="DeepWiki"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge" alt="MIT License"></a>
</p>

MindOS 是一个**人机协同心智平台**——基于本地优先的协作知识库，让你的笔记、工作流、个人上下文既对人类阅读友好，也能直接被 AI Agent 调用和执行。**为所有 Agents 全局同步你的心智，透明可控，共生演进。**

---

## 核心价值：人机共享思维

MindOS 通过以下三大支柱彻底重构人机协作范式，让人机在同一个 Shared Mind 中协作演进。

### 1. 全局同步 — 打破心智孤岛
*   **痛点：** 传统云端笔记管理繁琐、存在 API 壁垒，且灵感捕获成本高，导致 Agent 难以稳定读取人类的深度背景与瞬间顿悟。
*   **进化：** 一处记录，全量赋能。MindOS 提供极致轻量的 Web 捕获入口，并内置标准 MCP Server。任何支持协议的 Agent 均可无缝读取你的 Profile、SOP 与过往经验，实现个人 Context 的“开箱即用”与心智的实时对齐。

### 2. 透明可控 — 消除 Agent 黑箱
*   **痛点：** 现有 AI 助手的“记忆”锁在系统黑箱中，人类无法直观查看或纠正 Agent 的中间思考过程，容易产生不受控的幻觉。
*   **进化：** 让 Agent 在阳光下思考。Agent 的每一次检索、反思与执行，均通过 MCP 直接沉淀为本地纯文本（Markdown/CSV）。人类在直观的 GUI 工作台中拥有绝对的审查、干预与心智修正权。

### 3. 共生演进 — 动态指令流转
*   **痛点：** 传统的文档管理层级深、同步难，难以在复杂的人机协作任务中作为“执行引擎”流转。
*   **进化：** 知识库即代码。通过 Prompt-Native 的记录范式与引用驱动的自动同步，你的日常笔记天然就是高质量的 Agent 执行指令。让人机在同一个 Shared Mind 中相互启发，共同迭代生长。

> **底层基石：** 坚持 **本地优先** 原则。所有数据以纯文本形式存储在本地，彻底消除隐私顾虑，确保你拥有绝对的数据主权与极致的读写性能。

---

## 功能特性

*   **思维优先的记录风格** — 倡导“思维优先”的记录范式，提供契合大模型推理逻辑的约束性写作模板，让人类的日常笔记天然转化为高质量的 Agent 执行指令。
*   **引用驱动的自动化同步** — 摒弃传统的孤立任务管理，通过在 Markdown 文件间进行引用与双链关联，实现项目状态、任务进度与上下文的跨文件自动同步与流转。
*   **人类 GUI 工作台** — 提供直观、友好的交互体验，支持快速浏览、编辑、搜索笔记，专为人机共创设计的 UI。
*   **内置 Agent 助手** — 在上下文中与知识库对话，Agent 管理文件，编辑人类主动管理知识的无缝沉淀。
*   **MCP Server & Skills** — 将知识库暴露为标准 MCP 工具集，任意 Agent 可零配置接入，瞬间获得读写、搜索及执行本地工作流的专属技能。
*   **结构化模板** — 预置 Profile、Workflows、Configurations 等目录骨架，快速冷启动个人 Context。
*   **可视化引用图谱** — 动态解析并可视化文件间的相互引用与依赖关系，直观管理并理清复杂的人机上下文网络。
*   **时光机与版本控制** — 自动记录人类与 Agent 的每一次读写与编辑历史，支持一键回滚，可视化呈现 Context 的演变与 Agent 推理轨迹。
*   **灵活的插件扩展** — 针对特定文件或场景，支持安装或自定义视图插件（如 TODO 列表、看板式任务管理等），实现极具弹性的知识管理。

---

## 快速开始

```bash
# 1. 克隆项目
git clone https://github.com/geminilight/mind-os
cd mind-os

# 2. 从模板初始化你的知识库
cp -r template/ my-mind/

# 3. 配置环境变量
cp app/.env.example app/.env.local
# 编辑 MIND_ROOT，指向你的 my-mind/ 绝对路径

# 4. 启动应用
cd app && npm install && npm run dev
```

打开 [http://localhost:3000](http://localhost:3000) 即可开始使用。

---

## MCP Server 接入指南

将 MindOS MCP Server 注册到你的 Agent 客户端（例如 Claude Desktop），即可让 Agent 直接访问和操作你的本地知识库：

```json
{
  "mcpServers": {
    "mindos": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/mind-os/mcp/dist/index.js"],
      "env": {
        "MIND_ROOT": "/path/to/mind-os/my-mind"
      }
    }
  }
}
```

**Agent 可用的底层工具集：**
`mindos_list_files`, `mindos_read_file`, `mindos_write_file`, `mindos_create_file`, `mindos_delete_file`, `mindos_search_notes`, `mindos_get_recent`, `mindos_append_csv`

**构建 Server：**
```bash
cd mcp && npm install && npm run build
```

---

## 项目架构

```bash
mind-os/
├── app/              # Next.js 15 前端 — 浏览、编辑、与 AI 交互
├── mcp/              # MCP Server 核心 — 暴露给 Agent 的标准化工具集
├── template/         # 知识库结构模板 — 复制到 my-mind/ 后开始填写
├── my-mind/          # 你的私有共享内存（已加入 .gitignore，确保隐私）
├── SERVICES.md       # 技术与服务架构总览
└── README.md
```

---

## 环境变量设置

在 `app/.env.local` 中配置：

```env
MIND_ROOT=/path/to/mind-os/my-mind
AI_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...
# OPENAI_API_KEY=sk-proj-...
# OPENAI_BASE_URL=https://api.openai.com/v1
ANTHROPIC_MODEL=claude-3-7-sonnet-20250219
```

| 变量 | 默认值 | 说明 |
| :--- | :--- | :--- |
| `MIND_ROOT` | — | **必填**。知识库根目录的绝对路径 |
| `AI_PROVIDER` | `anthropic` | 可选 `anthropic` 或 `openai` |
| `ANTHROPIC_API_KEY` | — | 当 Provider 为 `anthropic` 时必填 |
| `OPENAI_API_KEY` | — | 当 Provider 为 `openai` 时必填 |
| `OPENAI_BASE_URL` | — | 可选。用于代理或 OpenAI 兼容 API 的自定义接口地址 |

---

## 快捷键指南

| 快捷键 | 功能 |
| :--- | :--- |
| `⌘ + K` | 全局搜索知识库 |
| `⌘ + /` | 唤起 AI 问答 / 侧边栏 |
| `E` | 在阅读界面按 `E` 快速进入编辑模式 |
| `⌘ + S` | 保存当前编辑 |
| `Esc` | 取消编辑 / 关闭弹窗 |

---

## License

MIT © GeminiLight
