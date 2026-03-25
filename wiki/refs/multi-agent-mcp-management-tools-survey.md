# 多 Agent / MCP 统一管理工具调研（2026-03）

## 调研范围
目标：提炼“多 Agent + MCP + 工具治理”工作台的共性模式，指导 MindOS 的 MCP 页面升级。

## 重点产品与可借鉴模式

### 1) Chops（技能资产中心）
- 定位：多工具技能统一管理（Claude/Cursor/Codex/Windsurf/Amp）。
- 借鉴点：
  - 统一入口管理跨工具技能，减少“配置分散”。
  - 搜索 + 集合（Collections）优先，不强依赖文件目录认知。
  - 实时文件变化同步（降低刷新焦虑）。
- 对 MindOS 的启发：
  - MCP 页面应提供“统一过滤 + 批量动作 + 状态反馈”。
  - 结果优先的信息架构比“配置文档优先”更高效。
- 参考：<https://github.com/Shpigford/chops>

### 2) Open WebUI（MCP 连接中心）
- 定位：通过 Settings/Connections 管理 Native MCP / Proxy MCP / OpenAPI 连接。
- 借鉴点：
  - 连接类型分层清晰（HTTP/SSE vs 代理桥接）。
  - 管理入口集中在连接中心，减少散点配置。
  - 强调认证与安全边界（如 secret key、OAuth 限制）。
- 对 MindOS 的启发：
  - MCP 页面应显式区分连接层状态与工具层状态。
  - 风险提示要带“可执行动作”。
- 参考：<https://docs.openwebui.com/features/extensibility/mcp>

### 3) LibreChat（MCP UI 内建管理）
- 定位：MCP 在聊天 UI 与 Agent Builder 双入口统一管理。
- 借鉴点：
  - 无需编辑配置文件即可管理 MCP server。
  - 支持重初始化与 OAuth 流程可视化。
  - 在 Agent Builder 中做工具级粒度控制。
- 对 MindOS 的启发：
  - MCP 页面要支持“连接重试/重连”与状态刷新的闭环。
  - 同一实体在“聊天使用”和“配置管理”之间应保持一致口径。
- 参考：<https://www.librechat.ai/docs/features/mcp>

### 4) Smithery（MCP Registry + CLI）
- 定位：MCP servers 注册、检索、安装与发布体系。
- 借鉴点：
  - Registry + Search + Metadata（verified/deployed）支持治理。
  - CLI 与 registry 协作，形成“发现 -> 安装 -> 更新”链路。
- 对 MindOS 的启发：
  - MCP 页面可以逐步引入“来源可信度”与“状态标签”概念。
  - 后续可扩展 server discoverability（本轮先不实现 registry 接入）。
- 参考：<https://smithery.ai/docs/registry>

### 5) Langfuse（多 Agent 可观测）
- 定位：Agent graph + tool call 可观测 + 会话级追踪。
- 借鉴点：
  - 图与表结合：图负责理解结构，表负责定位问题。
  - 工具调用过滤能快速识别异常路径。
- 对 MindOS 的启发：
  - MCP 页面“图谱 + 管理”双视图方向正确。
  - 管理视图需补充过滤维度与结果计数，降低定位成本。
- 参考：<https://langfuse.com/docs/observability/features/agent-graphs>

### 6) Portkey（AI Gateway 控制平面）
- 定位：网关 + 日志 + 观测 + 代理框架整合。
- 借鉴点：
  - Logs/Analytics 以用户/团队/工具维度切片。
  - 强调成本、延迟、错误率的统一看板。
- 对 MindOS 的启发：
  - MCP 页面可先从“状态、连接、可恢复动作”做轻量控制平面。
  - 详细成本/时延分析作为后续迭代。
- 参考：<https://portkey.ai/docs/product/mcp-gateway/observability>

## 对 MindOS MCP 页的设计结论（本轮）
1. 保持 `管理 / 图谱` 双视图，分别承载“动作”和“理解”。
2. 管理视图补齐多维过滤（状态 + 传输）与结果计数。
3. 增加批量动作（对筛选结果批量重连）并提供成功/失败反馈。
4. 增加风险队列（MCP 停止、待配置、未检测）并可一键导向处理。

## 本轮不做（避免过度设计）
- 不接入外部 Registry（Smithery）与 OAuth 复杂流程。
- 不引入完整可观测链路（成本、时延百分位、trace drill-down）。
- 不新增后端 API；仅基于现有 `useMcpData` 做前端控制台升级。
