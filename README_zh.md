# MindOS

**人类在此思考，Agent 依此行动。**

MindOS 是一个本地优先的知识库，内置浏览器界面、MCP Server 和结构化模板，让你的笔记、工作流、个人上下文既对人类友好，也能直接被 AI Agent 调用执行。

> 无数据库，无云同步，完全运行在本地。

---

## 功能特性

- **浏览器界面** — 在 `localhost:3000` 浏览、编辑、搜索笔记
- **MCP Server** — 将知识库暴露为 MCP 工具，任意 Agent 可读写搜索
- **结构化模板** — 涵盖 Profile、Workflows、Configurations 等目录的知识库骨架
- **AI 问答** — `⌘/` 与知识库对话（流式输出，`@` 附件引用）
- **全文搜索** — `⌘K` 模糊搜索 + snippet 预览
- **Markdown + CSV** — GFM 渲染、可排序 CSV 表格、CodeMirror 编辑器

---

## 快速开始

```bash
# 1. 克隆项目
git clone https://github.com/geminilight/mind_os
cd mind_os

# 2. 从模板初始化你的知识库
cp -r template/ my-mind/

# 3. 配置环境变量
cp app/.env.example app/.env.local
# 编辑 MIND_ROOT，指向你的 my-mind/ 目录

# 4. 启动应用
cd app && npm install && npm run dev
```

打开 [http://localhost:3000](http://localhost:3000)。

---

## 项目结构

```
mind_os/
├── app/          # Next.js 前端 — 浏览、编辑、搜索笔记
├── mcp/          # MCP Server — Agent 访问知识库的工具集
├── template/     # 知识库模板 — 复制到 my-mind/ 后开始填写
├── my-mind/      # 你的私有知识库（已加入 .gitignore）
├── SERVICES.md   # 技术服务总览
└── README.md
```

---

## MCP Server

将 MindOS MCP Server 注册到你的 Agent 配置，即可让 Agent 直接访问知识库：

```json
{
  "mcpServers": {
    "mindos": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/mind_os/mcp/dist/index.js"],
      "env": {
        "MIND_ROOT": "/path/to/mind_os/my-mind"
      }
    }
  }
}
```

构建 Server：

```bash
cd mcp && npm install && npm run build
```

可用工具：

| 分类 | 工具 |
|------|------|
| 文件 CRUD | `mindos_list_files`, `mindos_read_file`, `mindos_write_file`, `mindos_create_file`, `mindos_delete_file` |
| 搜索 | `mindos_search_notes`, `mindos_get_recent` |
| CSV | `mindos_append_csv` |
| 行级操作 | `mindos_read_lines`, `mindos_insert_lines`, `mindos_update_lines`, `mindos_delete_lines` |
| 语义操作 | `mindos_append_to_file`, `mindos_insert_after_heading`, `mindos_update_section` |

---

## 环境变量

创建 `app/.env.local`：

```env
MIND_ROOT=/path/to/mind_os/my-mind
AI_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-sonnet-4-6
```

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `MIND_ROOT` | — | 知识库根目录（绝对路径） |
| `AI_PROVIDER` | `anthropic` | `anthropic` 或 `openai` |
| `ANTHROPIC_API_KEY` | — | Anthropic API Key |
| `ANTHROPIC_MODEL` | `claude-sonnet-4-6` | Anthropic 模型名 |
| `OPENAI_API_KEY` | — | OpenAI / 兼容接口 Key |
| `OPENAI_BASE_URL` | — | 自定义接口地址（代理 / 兼容服务） |
| `OPENAI_MODEL` | `gpt-4o-mini` | OpenAI 模型名 |

---

## 快捷键

| 快捷键 | 功能 |
|--------|------|
| `⌘K` | 搜索 |
| `⌘/` | AI 问答 |
| `⌘,` | 设置 |
| `E` | 进入编辑模式 |
| `⌘S` | 保存 |
| `Esc` | 取消 / 关闭 |

---

## 技术栈

| 层 | 选型 |
|----|------|
| 框架 | Next.js 15 · TypeScript |
| 样式 | Tailwind CSS |
| 编辑器 | CodeMirror 6 |
| AI | Vercel AI SDK (`@ai-sdk/anthropic` / `@ai-sdk/openai`) |
| MCP | `@modelcontextprotocol/sdk` |

---

## License

MIT
