<!-- Last verified: 2026-03-14 | Current stage: 规划 -->

# Stage 12 — 深度 RAG：语义搜索 + 智能上下文注入

## 功能汇总

| # | 功能 | 状态 | 备注 |
|---|------|------|------|
| 12A | LanceDB 向量存储 + 增量索引 | 📋 | 嵌入式向量库，零部署 |
| 12B | Embedding Pipeline | 📋 | 本地模型 or API，分块策略 |
| 12C | 混合搜索（向量 + Fuse.js） | 📋 | Reranking 融合 |
| 12D | AI 对话上下文增强 | 📋 | 自动注入语义相关片段 |
| 12E | MCP 搜索升级 | 📋 | 外部 Agent 也能用语义搜索 |

---

## 现状分析

### 当前搜索架构

```
用户/Agent 查询
    │
    ├── UI (⌘K): Fuse.js 模糊匹配
    │   权重: content 50% / name 30% / path 20%
    │   阈值: 0.4 | 上限: 20 条 | CJK 特殊处理
    │
    └── MCP (mindos_search_notes): 同样走 Fuse.js
        上限: 50 条 | 25,000 字符截断
```

### AI 对话上下文注入

```
每次对话请求自动加载:
  1. SKILL.md (Agent 技能)
  2. INSTRUCTION.md + README.md + CONFIG (Bootstrap)
  3. 当前文件 + 附件 + 上传文件
  4. Agent 可调用 search 工具主动检索 (Fuse.js, 20,000 字符/文件)
```

### 核心问题

| 问题 | 影响 |
|------|------|
| 纯关键词匹配，无语义理解 | "如何管理团队"搜不到"项目协作 SOP" |
| Agent 必须猜对关键词才能找到上下文 | AI 回答质量依赖关键词命中率 |
| 无自动相关上下文注入 | Agent 不知道知识库里有什么相关内容 |
| 中文语义匹配弱 | Fuse.js 对中文只有前缀匹配 |

---

## 12A: LanceDB 向量存储

### 设计决策

| 决策点 | 选择 | 原因 | 放弃的方案 |
|--------|------|------|-----------|
| 向量库 | LanceDB (`@lancedb/lancedb` npm) | 嵌入式零部署，TS 原生，本地优先 | ChromaDB（需 Python）, Pinecone（云端） |
| 存储位置 | `~/.mindos/lance/` | 和 config 同级，不污染知识库 | `my-mind/.lance/`（会被 git sync） |
| 索引粒度 | chunk 级（非文件级） | 长文件中精准定位段落 | 文件级（大文件浪费 token） |
| 向量维度 | **按 provider 建独立表**：`chunks_384` (本地) / `chunks_1536` (API) | 本地 384 维 vs API 1536 维不兼容，不能混存 | 统一维度（强制只用一种 provider） |

### 数据模型

```typescript
interface ChunkRecord {
  id: string;            // `${filePath}#${chunkIndex}`
  filePath: string;      // 相对于 MIND_ROOT
  chunkIndex: number;    // 在文件中的序号
  content: string;       // chunk 原文
  heading: string;       // 所属标题（最近的 ## 标题）
  vector: number[];      // embedding 向量
  modifiedAt: number;    // 文件 mtime，用于增量更新
}
```

### 受影响文件

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `app/lib/vector.ts` | 新增 | LanceDB 连接、建表、查询、增量索引 |
| `app/package.json` | 修改 | 添加 `@lancedb/lancedb` 依赖 |
| `~/.mindos/lance/` | 新增 | 向量数据存储目录 |

---

## 12B: Embedding Pipeline

### 设计决策

| 决策点 | 选择 | 原因 | 放弃的方案 |
|--------|------|------|-----------|
| Embedding 模型 | 双模式：本地 or API，用户选择 | 兼顾离线和质量 | 仅 API（不本地）/ 仅本地（质量差） |
| 本地模型 | `@huggingface/transformers` + `all-MiniLM-L6-v2` | JS 原生，模型小(~80MB)，384 维 | `nomic-embed`（大）/ ONNX 手动加载 |
| 模型分发 | **按需下载到 `~/.mindos/models/`**，不打进 npm 包 | 80MB 模型不应强制所有用户下载 | 打进包（npm 包过大）/ 要求用户手动下载 |
| API 模型 | OpenAI `text-embedding-3-small` | 1536 维，质量最好 | Cohere / Voyage（生态小） |
| 维度切换 | 切换 provider 后自动重建索引（删旧表建新表） | 384 维和 1536 维不能混存 | 降维对齐（损失精度） |
| 分块策略 | 按标题分块（`## heading`），fallback 固定 512 token | Markdown 天然按标题组织 | 固定窗口（割裂语义）/ 句子级（太碎） |
| 索引时机 | 文件保存后异步触发 | 不阻塞写入操作 | 定时全量重建（浪费算力） |

### 本地模型按需安装流程

```
用户开启 RAG (Settings → AI → Embedding: local)
    → 检测 ~/.mindos/models/all-MiniLM-L6-v2/ 是否存在
    ├── 存在 → 直接加载，开始索引
    └── 不存在 → UI 提示 "首次使用需下载模型 (~80MB)"
        ├── 确认 → @huggingface/transformers 自动从 HuggingFace 下载到 ~/.mindos/models/
        │          显示下载进度条 → 完成后自动开始索引
        └── 取消 → 自动切换为 API 模式（需 OpenAI key）
                   若无 key → RAG 功能不启用，降级为纯 Fuse.js
```

`@huggingface/transformers` 作为 **optionalDependencies**，不装也不影响核心功能。
CLI 也可触发：`mindos rag setup` 一键下载模型 + 首次全量索引。

### 分块规则

```
1. 按 ## 标题切分（一级分块）
2. 超过 512 token 的块再按段落切分
3. 每块保留元数据：filePath, heading, chunkIndex
4. 前置上下文：每块开头拼接 "文件: {path} > {heading}"
5. CSV 文件：按行分组（每 10-20 行为一个 chunk，列名 + 行内容），避免碎片化
```

### 增量索引逻辑

```
文件保存 → 比较 mtime → 有变化？
  ├── 是 → 删除该文件旧 chunks → 重新分块 → embedding → 写入 LanceDB
  └── 否 → 跳过
```

### 受影响文件

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `app/lib/embedding.ts` | 新增 | 分块 + embedding 生成（双模式） |
| `app/lib/vector.ts` | 修改 | 增量索引调度 |
| `app/lib/settings.ts` | 修改 | 添加 RAG 配置项（模型选择、auto-index 开关） |
| `app/components/settings/AiTab.tsx` | 修改 | UI：Embedding 模型选择 + 下载提示 |
| `app/package.json` | 修改 | 添加 `@huggingface/transformers` (optionalDependencies) |

---

## 12C: 混合搜索

### 用户场景

用户在 ⌘K 搜索或 AI 对话中输入自然语言查询，系统同时走关键词和语义两条路径，融合后返回最相关结果。

### 设计决策

| 决策点 | 选择 | 原因 | 放弃的方案 |
|--------|------|------|-----------|
| 融合策略 | RRF (Reciprocal Rank Fusion) | 简单有效，无需调参训练 | 线性加权（需要调参）/ 学习排序 |
| RRF 常数 k | k=60（标准值）| 平衡头部和长尾结果 | — |
| Fallback | 向量库不可用时降级为纯 Fuse.js | 不能因 RAG 挂了搜索就废了 | 无 fallback |

### API 契约

```
GET /api/search?q=如何管理团队&mode=hybrid
```

**响应：**
```json
{
  "results": [
    {
      "path": "Workflows/团队协作SOP.md",
      "snippet": "## 项目协作流程\n...",
      "score": 0.92,
      "matchType": "semantic",
      "heading": "项目协作流程"
    }
  ],
  "mode": "hybrid"
}
```

### 受影响文件

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `app/lib/fs.ts` | 修改 | `searchFiles()` 支持 hybrid 模式 |
| `app/app/api/search/route.ts` | 修改 | 添加 `mode` 参数 |
| `app/components/SearchModal.tsx` | 修改 | 搜索结果标注匹配类型 |

---

## 12D: AI 对话上下文增强

### 用户场景

用户问 "我上周关于 RAG 的笔记在哪"，Agent 无需手动调 search 工具，系统自动注入语义相关的 chunks 作为上下文。

### 设计决策

| 决策点 | 选择 | 原因 | 放弃的方案 |
|--------|------|------|-----------|
| 注入时机 | 每次对话请求前自动检索 top-8 相关 chunks | 减少 Agent 工具调用轮次 | 仅靠 Agent 主动 search（经常漏） |
| Token 预算 | 相关上下文最多占 4,000 token | 留够空间给对话本身 | 无限制（爆 context） |
| 去重 | 与 Bootstrap/附件重复的 chunk 自动跳过 | 避免重复注入 | 不去重 |

### 上下文注入流程

```
用户消息 → 对用户最新消息做 embedding
    → LanceDB 向量搜索 top-8
    → 去重（排除已在 bootstrap/附件中的文件）
    → 截断到 4,000 token
    → 注入为 system prompt 新 section:
      "## 🔍 语义相关上下文（自动检索）"
    → 传给 LLM
```

### 受影响文件

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `app/app/api/ask/route.ts` | 修改 | 对话前自动向量检索 + 注入 |
| `app/lib/vector.ts` | 修改 | 暴露 `semanticSearch(query, topK)` |

---

## 12E: MCP 搜索升级

### 用户场景

外部 Agent（Claude Code、Cursor）通过 MCP 调用 `mindos_search_notes`，也能使用语义搜索。

### API 契约

```json
// mindos_search_notes 新增参数
{
  "query": "项目协作流程",
  "mode": "hybrid",     // 新增：hybrid | keyword | semantic，默认 hybrid
  "limit": 20
}
```

### 受影响文件

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `mcp/src/index.ts` | 修改 | search tool 添加 mode 参数，调用混合搜索 |

---

## 配置项

添加到 Settings → AI Tab：

| 配置 | 默认值 | 说明 |
|------|--------|------|
| `rag.enabled` | `false` | 总开关（首次需用户主动开启，避免弹下载提示） |
| `rag.embeddingProvider` | `local` | `local` / `openai` |
| `rag.autoIndex` | `true` | 文件保存后自动索引 |
| `rag.contextBudget` | `4000` | AI 对话自动注入的 token 上限 |

---

## 实施顺序

```
12A (LanceDB 接入, 1 天)
    → 12B (Embedding + 索引, 3-4 天)
        → 12C (混合搜索, 2 天)
            → 12D (AI 上下文增强, 1-2 天)
            → 12E (MCP 升级, 0.5 天)
```

**总计：~8-10 天**

---

## 遗留项 / Backlog

- 索引进度 UI（大知识库首次索引可能要几分钟）
- 向量模型热更新（切换模型后需重建索引）
- 多语言 embedding 模型选择（中文优化）
- Reranker 模型（二次排序提升精度）
