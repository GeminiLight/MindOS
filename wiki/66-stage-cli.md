# Agent CLI 生态调研（2026-03）

## 核心结论

MCP 没有落伍，但 CLI 正在成为 AI Agent 的首选交互层。两者互补：

| | CLI | MCP |
|--|-----|-----|
| 擅长 | 执行效率、可审计、token 省 33% | 工具发现、安全治理、企业级编排 |
| 适合 | 单用户/开发者/快速原型 | 生产系统/多租户/合规场景 |

## CLI vs MCP

| 方面 | CLI | MCP |
|------|-----|-----|
| 协议 | 文本 shell 命令 | JSON-RPC |
| 工具发现 | `--help` 输出即 prompt | Schema 广播 |
| 数据格式 | stdout 文本/JSON | 强类型 JSON schema |
| 安全模型 | shell 权限 | OAuth/consent/沙箱 |
| Token 效率 | 好 33% | schema 开销大 |
| 调试 | 手动重放命令 | 需 MCP 专用工具 |
| 可扩展性 | 1000+ 工具时复杂 | 为大规模设计 |

### 为什么 CLI 是 AI-Native

1. LLM 擅长文本 — CLI 输出是模型天然理解的
2. 自描述 — `--help` 就是零噪声高密度 prompt
3. Unix 哲学 — "做好一件事"映射到 Chain-of-Thought
4. 可审计 — 命令日志完整可追溯

## 竞品分析

### Gemini CLI（Google）

- GitHub: 99.5k stars
- 安装: `npm i -g @google/gemini-cli`
- 模型: Gemini 3（1M token context）
- 特点: **免费** Google OAuth（60 req/min），多模态，MCP 支持，Google Search grounding
- 发布节奏: 每周二（Preview + Stable），每天（Nightly）

### Claude Code（Anthropic）

- GitHub: 84.4k stars
- 安装: `curl -fsSL https://claude.ai/install.sh | bash`
- 模型: Claude（仅 Anthropic）
- 特点: 深度代码理解，插件系统，GitHub `@claude` 集成，IDE 集成

### Codex CLI（OpenAI）

- GitHub: 67k stars
- 安装: `npm i -g @openai/codex`
- 语言: Rust 94.7%
- 模型: GPT-5, o-series
- 特点: 沙箱安全执行，Skills 配置，MCP 集成，桌面应用

### Agent Browser（Vercel）

- GitHub: 25.7k stars
- 安装: `npm i -g agent-browser`
- 语言: Rust 86%
- 特点: ref-based 选择（比 Playwright MCP 省 93% context），批量命令，会话持久化

### Lark CLI（飞书）

- GitHub: 3.9k stars
- 安装: `npm i -g @larksuite/cli`
- 语言: Go 99.7%
- 覆盖: 11 个业务域，200+ 命令，19 个预建 AI Agent 技能

**三层架构（值得借鉴）：**

```
Layer 1: Shortcuts (+)     lark-cli +agenda        → 人类友好，智能默认
Layer 2: API Commands      lark-cli calendar list   → 1:1 映射平台 API
Layer 3: Raw API           lark-cli api POST /v1/.. → 直接调 2500+ API
```

业务域覆盖：日历、消息、文档、云盘、多维表格、电子表格、任务、Wiki、通讯录、邮件、会议

### Cursor CLI

- 状态: Beta（2025-08）
- 安装: `curl https://cursor.com/install -fsS | bash`
- 特点: 多模型（GPT-5/Claude/Gemini），深度 IDE 集成，50+ MCP 插件

## 新兴协议

| 协议 | 推动者 | 作用 |
|------|--------|------|
| ACP (Agent Client Protocol) | JetBrains, Zed, GitHub | 编辑器 ↔ Agent 通信标准（类似 LSP） |
| MCP | Anthropic | 工具/资源连接协议 |
| NIST AI Agent 标准 | 美国国家标准局 | 互操作性、安全、测试 |
| W3C Agent Protocol | W3C | Agent 发现与跨平台协作 |

关键区分：MCP = 工具连接，ACP = 编辑器到 Agent 的通信。两者不冲突。

ACP 已兼容：Gemini CLI, GitHub Copilot, Junie, Cline, Codex CLI, Qwen Code, Kimi CLI 等。

## MindOS CLI 建议

### 定位

```
MCP  → 企业集成（连接 Slack、Notion、Jira 等外部服务）
CLI  → 用户/Agent 直接操作 MindOS（文件、搜索、AI）
ACP  → IDE 集成（VS Code、Cursor 内调用 MindOS）
```

### 命令设计（参考飞书三层架构）

```bash
# Layer 1: Shortcuts（人类/Agent 友好）
mindos ask "总结今天的笔记"
mindos organize ~/Downloads/paper.pdf
mindos search "RAG 实现方案"

# Layer 2: 资源操作（1:1 映射 API）
mindos file create "notes/meeting.md" --content "# Meeting"
mindos file list --space "工作"
mindos agent run "summarizer" --input notes/today.md
mindos space create "项目文档"

# Layer 3: Raw API（开发者/高级 Agent）
mindos api GET /api/files
mindos api POST /api/ask --body '{"question":"..."}'
```

### 核心命令（短期 1-2 周）

```
mindos file [create|read|delete|rename|move|list|search]
mindos space [create|list|delete]
mindos ask <question>
mindos agent [list|run|inspect]
mindos config [get|set]
mindos status
```

输出格式：默认 human-readable，`--json` 给 Agent 用。

### 技能生态（中期 1-2 月）

```bash
mindos skill install "daily-summary"
mindos skill run "organize" --input ~/Downloads/
mindos skill list --marketplace
```

### ACP 支持（长期）

实现 ACP server，让 VS Code/Cursor/Zed 直接调用 MindOS 知识库。

### 技术架构

```
mindos-cli/
├── bin/mindos
├── commands/
│   ├── file.ts
│   ├── space.ts
│   ├── ask.ts
│   ├── agent.ts
│   ├── skill.ts
│   ├── config.ts
│   └── api.ts
├── lib/
│   ├── client.ts    # HTTP client
│   ├── auth.ts      # token 管理
│   └── output.ts    # human/json 格式化
└── package.json     # @geminilight/mindos-cli
```

发布：`npm install -g @geminilight/mindos-cli`

### AI-Native CLI 设计原则

1. 支持 `--json` 输出
2. `--help` 写详细（它就是给 Agent 的 prompt）
3. 避免交互式输入（支持 `-y` 标志）
4. 提供确定性引用（不只是模糊匹配）
5. 错误信息包含修复建议
