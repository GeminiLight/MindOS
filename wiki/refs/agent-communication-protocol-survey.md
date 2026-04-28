# ACP / A2A / MCP — 调研备忘

> **Last verified:** 2026-03-24  
> **Scope:** 「ACP」在路线图、README 中指 **Agent Communication Protocol**（IBM / BeeAI 系），与 **MCP**（工具与数据）、**A2A**（Agent2Agent）的关系与落地建议。  
> **Sources:** IBM Research 博文、Linux Foundation 社区公告、子 Agent 二次整理 + 公开链接核对。

---

## 1. Executive summary

- **IBM ACP（Agent Communication Protocol）**：面向 **Agent ↔ Agent** 的开放协议，强调 **HTTP/REST**、可与 curl/Postman 交互；与 **MCP**（Agent ↔ 工具/知识库，JSON-RPC 系）**分层互补**——IBM 明确类比「MCP 接工具，ACP 接 Agent」。
- **A2A（Agent2Agent）**：Google 发起、面向 **Agent 互操作** 的协议与生态；**2025-08** Linux Foundation（LF AI & Data）公告 **ACP 与 A2A 合并方向**（社区与 BeeAI 迁移至 A2A）。**后续产品选型应跟踪 A2A 规范与迁移指南**，而非单独押注旧 ACP 形态。
- **MindOS 现状**：已通过 **MCP** 暴露知识库能力；若要做「**调用其他 Agent** / **被其他 Agent 编排**」，长期对齐 **A2A** + 策略与安全边界，比单独实现 IBM ACP 更合适。
- **术语冲突（必读）**：缩写 **ACP** 在业界至少有两套：
  - **Agent Communication Protocol**（本文主题，IBM/BeeAI，agent-to-agent）。
  - **Agent Client Protocol**（[agentclientprotocol.org](https://agentclientprotocol.org/)）— **IDE / 编辑器 ↔ 编程 Agent**（JSON-RPC、LSP 类比），与「多 Agent 互联」不是同一件事。  
  内部文档写「ACP」时建议写全称或加链接，避免与 **Agent Coding** 口语混用（TASKS.md 中的「Agent Coding Protocol」并非独立标准名，宜改为「Agent Client Protocol」或具体产品能力）。

---

## 2. 协议角色对照

| 维度 | MCP | IBM ACP（历史；合并进 A2A 生态） | A2A |
|------|-----|----------------------------------|-----|
| **问题域** | Agent 连接 **工具、数据、本地服务** | Agent **之间**协作、发现、对等对话 | **Agent 互操作**（企业叙事与 LF 治理下的主方向之一） |
| **常见形态** | JSON-RPC；stdio / Streamable HTTP 等 | REST over HTTP；异步为主 | HTTP / JSON-RPC 类（以 A2A 规范为准） |
| **与 MindOS** | **已采用**：`/api/*` + MCP 薄封装 | 间接：仅当需要 **多 Agent 拓扑** | **若做跨 Agent 调用/被发现**，优先对齐 |

IBM 原文要点（[IBM Research — Agent Communication Protocol](https://research.ibm.com/blog/agent-communication-protocol-ai)）：

- MCP 与 ACP **可组合**：多 Agent 系统里，各 Agent 可用 MCP 拉数据/跑工具，再用 ACP 在 Agent 间对齐结果与决策。
- **MCP 用 JSON-RPC；ACP 采用 REST/HTTP**，便于无 SDK 调试。

---

## 3. 与 MindOS 相关的落地建议

1. **短期**  
   - 继续以 **MCP** 作为知识库与工具的 **单一事实来源**（与当前架构一致）。  
   - 文档与 README 中「ACP」统一注明 **Agent Communication Protocol**，避免与 **Agent Client Protocol** 混淆。

2. **中期（多 Agent /「调用其他 Agent」）**  
   - 跟踪 **A2A** 规范、Agent Card、安全模型；评估「MindOS 作为可被发现的 Agent」vs「MindOS 编排外部 Agent」两种模式。  
   - 查阅 BeeAI / IBM 侧 **ACP → A2A** 迁移材料（见下 References），避免实现已冻结的 REST 形状。

3. **风险**  
   - **合并后的细节**：ACP 与 A2A 合并后，旧 ACP 端点与对象模型可能变化，**以 A2A 官方 spec + 迁移文档为准**。  
   - **搜索噪声**：论文与博客中 「agent communication」常泛指 MCP/A2A/ANP，需对照 **协议全名与域名**。

---

## 4. References（URL）

| # | 说明 | URL |
|---|------|-----|
| 1 | IBM Research：ACP 定位、与 MCP 互补、REST vs JSON-RPC | https://research.ibm.com/blog/agent-communication-protocol-ai |
| 2 | IBM / BeeAI：ACP 文档入口（Welcome） | https://agentcommunicationprotocol.dev/introduction/welcome |
| 3 | Anthropic：MCP 介绍 | https://www.anthropic.com/news/model-context-protocol |
| 4 | MCP 官方站点 | https://modelcontextprotocol.io/ |
| 5 | Google：A2A（Agent2Agent）互操作 | https://developers.googleblog.com/en/a2a-a-new-era-of-agent-interoperability/ |
| 6 | Linux Foundation：ACP 与 A2A 合并公告（2025-08） | https://lfaidata.foundation/communityblog/2025/08/29/acp-joins-forces-with-a2a-under-the-linux-foundations-lf-ai-data/ |
| 7 | Agent **Client** Protocol（缩写同为 ACP，不同协议） | https://agentclientprotocol.org/ |
| 8 | BeeAI：ACP → A2A 迁移指南（路径以仓库当前为准） | https://github.com/i-am-bee/beeai-platform/blob/main/docs/community-and-support/acp-a2a-migration-guide.mdx |

---

## 5. 调研过程说明（可复现）

- **Web 检索**：Agent Communication Protocol、IBM、A2A、MCP 对比。  
- **子 Agent（Task）**：整理对比表、MindOS 相关性、命名冲突与风险；本文件已合并其输出并核对 IBM 原文。  
- **拉取页面**：`research.ibm.com` 博文正文用于核对引用表述。

若需把结论同步进 `wiki/01-project-roadmap.md` 或 README checkbox 文案，可另开编辑任务，避免与本 refs 文件重复堆叠。
