# 🌟 GitHub Projects

值得关注的开源项目收藏。

---

## pi coding agent

> **少即是多**：只给模型 4 个工具，其他能力靠 skills 扩展，prompt caching 命中率高，省钱又快。

- **GitHub**：https://github.com/badlogic/pi-mono
- **作者**：Mario Zechner（badlogic）
- **语言**：TypeScript

### 核心设计

| 特点 | 说明 |
|------|------|
| 极简工具集 | 只有 `read`、`write`、`edit`、`bash` 四个工具 |
| 极简系统提示 | < 1000 tokens，同类产品普遍 10,000+ |
| Skills 扩展 | 模型通过写代码自己扩展能力，而非内置大量工具 |
| YOLO 模式 | 默认无权限检查，假设用户知道自己在做什么 |
| 无 MCP | 认为 MCP 消耗过多上下文空间 |
| 无 plan mode | 通过对话思考即可，不需要专门的规划模式 |

### 为什么值得关注

工具数量固定、系统提示固定 → prompt caching 命中率极高 → 实际推理成本大幅降低。这种"约束即优化"的思路与大多数 agent 框架堆功能的方向相反。

### 仓库结构

```
pi-mono/
├── pi-ai           # 统一 LLM API（支持 Anthropic、OpenAI、Gemini 等）
├── pi-agent-core   # Agent 循环核心
├── pi-tui          # 终端 UI 框架
└── pi-coding-agent # CLI 工具
```

### Skills / 扩展机制

- **AGENTS.md**：项目上下文文件，从全局到项目级分层加载，可完全替换系统提示
- **Slash Commands**：以 Markdown 模板实现，支持参数
- **工具扩展**：构建带 README 的 CLI 工具，Agent 按需读取 README，只在使用时付 token 成本
