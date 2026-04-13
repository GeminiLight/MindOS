# Spec: Vector Search Correctness & User Experience

## 目标

确保向量搜索从模型下载到检索结果呈现的全流程正确性和最佳用户体验，包括：
1. 本地模型下载的可靠性与进度反馈
2. 索引构建与持久化的正确性
3. 搜索检索的准确性
4. 全流程的错误处理与用户反馈

## 现状分析

### 当前架构（已实现）

```
用户配置 Embedding
    │
    ├─ 本地模式 (provider: 'local')
    │   └─ @huggingface/transformers → ONNX 模型
    │   └─ 模型缓存: ~/.cache/huggingface/
    │
    └─ API 模式 (provider: 'api')
        └─ OpenAI-compatible /v1/embeddings

    │
    ▼
EmbeddingIndex (embedding-index.ts)
    ├─ 文件 → 向量 Map<string, Float32Array>
    ├─ JSON 持久化: ~/.mindos/embedding-index.json
    └─ 10% 漂移阈值判断 staleness

    │
    ▼
HybridSearch (hybrid-search.ts)
    ├─ BM25 (同步, 始终执行)
    ├─ Embedding search (异步, 可选)
    └─ RRF 融合 (k=60)
```

### 已发现的问题与改进点

| 问题类别 | 具体问题 | 优先级 |
|---------|---------|--------|
| **模型下载** | 1. 下载进度无法实时显示给用户 | P1 |
| | 2. 下载超时 5 分钟后无明确反馈 | P1 |
| | 3. 模型切换时旧模型未清理缓存 | P2 |
| **索引构建** | 4. rebuild 期间无进度反馈（用户只看到 "Building..."） | P1 |
| | 5. 文件内容变更后增量更新无反馈 | P2 |
| | 6. 持久化失败时静默吞掉错误 | P2 |
| **检索正确性** | 7. 查询向量与文档向量维度不匹配时返回空而非报错 | P1 |
| | 8. 语义匹配结果缺少内容 snippet（只有 similarity 分数） | P1 |
| | 9. RRF 融合后的 score 语义不清晰（不是 0-1 分数） | P2 |
| **用户体验** | 10. Settings 页面下载按钮点击后无即时反馈 | P1 |
| | 11. 搜索结果中语义匹配的展示方式不友好 | P1 |
| | 12. Embedding 配置更改后需要手动重建索引 | P2 |

## 数据流 / 状态流

### 完整数据流

```
[Settings UI] ─────────────────────────────────────────────────────────────────
    │
    │ 1. 用户开启 Embedding Search
    │ 2. 选择 Local 或 API 模式
    │
    ▼
[POST /api/settings] ──────────────────────────────────────────────────────────
    │
    │ 保存 embedding config 到 ~/.mindos/config.json
    │
    ▼
[Local 模式: 模型下载] ────────────────────────────────────────────────────────
    │
    │ GET /api/embedding → { downloaded: false }
    │ POST /api/embedding { action: "download" }
    │   └─ downloadLocalModel(modelId)
    │       └─ loadLocalPipeline(modelId)  [retry ×2, timeout 5min]
    │           └─ @huggingface/transformers.pipeline()
    │               └─ 下载 ONNX 模型到 ~/.cache/huggingface/
    │
    │ 轮询: POST /api/embedding { action: "status" }
    │   └─ { downloading: bool, downloaded: bool, error: string | null }
    │
    ▼
[首次搜索触发索引构建] ────────────────────────────────────────────────────────
    │
    │ hybridSearch(mindRoot, query)
    │   └─ embeddingIndex.load(mindRoot) → false (无持久化文件)
    │   └─ embeddingIndex.rebuild(mindRoot)  [async, non-blocking]
    │       │
    │       ├─ collectAllFiles(mindRoot)  → 过滤 .md, .csv
    │       ├─ 读取每个文件内容, 截断 8000 chars
    │       ├─ getEmbeddings(texts[])
    │       │   └─ 批量 embed (local: 32/batch, api: 100/batch)
    │       └─ persist() → ~/.mindos/embedding-index.json
    │
    │ 此时返回纯 BM25 结果
    │
    ▼
[后续搜索使用混合检索] ────────────────────────────────────────────────────────
    │
    │ hybridSearch(mindRoot, query)
    │   ├─ BM25: searchFiles(mindRoot, query)  [同步]
    │   ├─ Embedding: embeddingIndex.search(query)
    │   │   ├─ getEmbedding(query)  → query vector
    │   │   └─ cosineSimilarity(query, doc) for all docs  [brute force]
    │   └─ rrfMerge(bm25Results, embeddingResults)
    │
    ▼
[SearchPanel UI] ──────────────────────────────────────────────────────────────
    │
    │ 显示搜索结果
    │ - path: 文件路径
    │ - snippet: 内容片段 或 "[semantic match, similarity: 0.xxx]"
    │ - score: RRF score (非 0-1)
```

### 状态机 (Settings UI → 模型下载)

```
[未启用] ──启用──→ [已启用 / 未配置]
                      │
                      ├── 选择 API 模式 ──→ [已启用 / API 配置完成]
                      │                           │
                      │                           └── 保存 → 立即生效
                      │
                      └── 选择 Local 模式 ──→ [已启用 / 检查模型]
                                                  │
                                                  ├── 已下载 ──→ [就绪]
                                                  │
                                                  └── 未下载 ──→ [需下载]
                                                                  │
                                                                  └── 点击下载
                                                                        │
                                                                        ▼
                                                               [下载中]
                                                                  │
                                                                  ├── 成功 ──→ [就绪]
                                                                  │
                                                                  ├── 超时 ──→ [错误: 超时]
                                                                  │               │
                                                                  │               └── 重试
                                                                  │
                                                                  └── 失败 ──→ [错误: 网络/磁盘]
                                                                                  │
                                                                                  └── 重试 或 切换 API 模式
```

### 状态机 (搜索索引)

```
[索引未构建] ──首次搜索──→ [构建中]
                             │
                             ├── 成功 ──→ [索引就绪]
                             │               │
                             │               ├── 文件变更 ──→ [增量更新中] ──→ [索引就绪]
                             │               │
                             │               └── 配置变更 ──→ [需重建] ──→ [构建中]
                             │
                             └── 失败 ──→ [索引失败] ──→ 降级为纯 BM25
```

## 方案

### 方案 A: 渐进增强（推荐）

**核心思路**: 在不改变现有架构的前提下，增强反馈机制和错误处理

#### A1. 增强模型下载体验

1. **下载进度 WebSocket/SSE 推送**
   - 修改 `/api/embedding` POST download action 返回 job ID
   - 新增 GET `/api/embedding/progress/{jobId}` SSE 端点
   - 前端订阅进度事件，显示实时下载进度

2. **超时友好处理**
   - 超时前 30 秒提示 "下载较慢，请稍候..."
   - 超时后提供明确的重试按钮和切换 API 模式的建议

3. **模型切换清理**
   - 切换模型时提示 "旧模型将保留在缓存中"
   - 提供手动清理缓存的选项

#### A2. 增强索引构建反馈

1. **构建进度反馈**
   - 在 EmbeddingIndex 中添加 progress callback
   - 通过 SSE 推送构建进度: `{ phase: 'reading' | 'embedding' | 'persisting', current: n, total: m }`
   - UI 显示: "正在构建索引... (150/500 文件)"

2. **持久化错误处理**
   - persist() 失败时 emit warning 而非静默
   - 用户可见的 toast 提示

#### A3. 增强检索正确性

1. **维度校验**
   - searchByVector 检查维度是否匹配，不匹配时 console.warn 并返回空
   - 配置变更（不同 model → 不同维度）时自动标记索引为 stale

2. **语义匹配 snippet 增强**
   - 当 embedding 找到但 BM25 未找到的文档时，读取文件前 200 字符作为 snippet
   - 避免 "[semantic match, similarity: 0.xxx]" 这样的无意义文案

3. **RRF score 归一化（可选）**
   - 将 RRF score 归一化到 0-1 范围
   - 或在 UI 层不显示 score，只显示排名

#### A4. 增强用户体验

1. **下载按钮即时反馈**
   - 点击后立即显示 spinner + "Starting download..."
   - 网络请求失败时立即报错，不等轮询

2. **配置变更自动重建**
   - 检测 embedding config 变更时，提示 "配置已更改，是否重建索引？"
   - 或自动在后台重建

3. **搜索结果 UI 优化**
   - 语义匹配结果加上小图标标识
   - hover 显示 "Semantic match (similarity: 0.85)"

---

### 方案 B: 重构为事件驱动架构

**核心思路**: 引入 EventEmitter 统一管理所有状态变更

优点: 更清晰的状态管理
缺点: 改动较大，需要修改多个模块

**不推荐**: 当前场景复杂度不高，渐进增强已足够

---

### 方案对比

| 维度 | 方案 A (渐进增强) | 方案 B (事件驱动重构) |
|------|------------------|---------------------|
| 用户体验质量 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| 实现复杂度 | 低 | 高 |
| 可维护性 | 高 | 高 |
| 风险 | 低 (增量改动) | 中 (大范围重构) |

**选择方案 A**

## 影响范围

### 变更文件列表

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `app/lib/core/embedding-provider.ts` | 修改 | 添加进度回调 |
| `app/lib/core/embedding-index.ts` | 修改 | 维度校验、进度回调、snippet 增强 |
| `app/lib/core/hybrid-search.ts` | 修改 | 读取文件内容填充 snippet |
| `app/app/api/embedding/route.ts` | 修改 | 增强错误分类、添加进度端点 |
| `app/components/settings/AiTab.tsx` | 修改 | 下载进度 UI、即时反馈 |
| `app/components/panels/SearchPanel.tsx` | 修改 | 语义匹配结果 UI 增强 |

### 不受影响的模块

- `app/lib/core/search.ts` (BM25 搜索) — 无需修改
- `app/lib/core/search-index.ts` (倒排索引) — 无需修改
- `app/lib/settings.ts` — 配置结构无变化

## 边界 case 与风险

### 边界 case

| 场景 | 处理方式 |
|------|---------|
| 网络断开时下载模型 | retry 2 次 → 友好错误提示 + 重试按钮 |
| 磁盘空间不足 | 检测错误信息 → 提示 "空间不足" |
| 文件内容超长（>8000 字符） | 截断后 embed（已有） |
| 空知识库（无 .md/.csv 文件） | rebuild 完成但 docCount=0，UI 提示 "无可索引文件" |
| 并发 rebuild 请求 | `_building` flag 防重入（已有） |
| 配置从 local 切换到 api（维度不同） | 标记索引 stale，下次搜索触发重建 |
| 模型下载中用户关闭页面 | 后台继续下载，下次打开页面检测状态 |

### 风险与 mitigation

| 风险 | 可能性 | 影响 | Mitigation |
|------|--------|-----|------------|
| 进度推送增加服务器负载 | 低 | 低 | 使用 debounce，限制推送频率 |
| SSE 连接断开 | 中 | 低 | 前端重连逻辑 + 降级为轮询 |
| 读取文件生成 snippet 性能 | 低 | 低 | 只读取前 200 字符，使用缓存 |

## 验收标准

### 模型下载

- [ ] 点击下载按钮后 <200ms 内显示加载状态
- [ ] 下载进度实时更新（至少每 5 秒一次）
- [ ] 超时后显示明确的错误信息和重试按钮
- [ ] 网络错误、磁盘空间不足等错误有差异化提示

### 索引构建

- [ ] 首次搜索触发构建时 UI 显示 "正在构建索引..."
- [ ] 构建完成后 toast 提示 "索引构建完成，共 X 个文件"
- [ ] 配置变更后提示需要重建索引

### 检索正确性

- [ ] 语义匹配结果有实际的内容 snippet（而非 "[semantic match...]"）
- [ ] 维度不匹配时不崩溃，降级为纯 BM25
- [ ] 混合搜索结果排序合理（相关性高的在前）

### 用户体验

- [ ] 所有异步操作有 loading 状态
- [ ] 所有错误有用户可理解的提示
- [ ] 搜索结果中语义匹配有视觉区分
