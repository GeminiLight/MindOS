# 算法与核心功能深度优化

> 最后更新：2026-04-01

## 🔍 搜索与检索

### P0 — 搜索质量
- [x] **BM25 相关性排序** — ✅ 已实现。`search.ts` 使用 BM25 公式（k1=1.2, b=0.75），支持多词查询独立评分求和，两遍扫描（先算 df 再评分）。`getCandidatesUnion` 已优化 CJK bigram 候选集剪枝（按 token 命中数过滤，threshold = tokenCount/2）
  - 文件：`app/lib/core/search.ts:115`, `search-index.ts`
  - 方案：计算 `idf = log((N - df + 0.5) / (df + 0.5))`，结合文档长度归一化

### P0 — 索引性能
- [x] **增量索引更新** — ✅ 已实现。`SearchIndex.addFile/removeFile/updateFile` 增量更新，`fileTokens` 逆映射使 removeFile 从 O(all-tokens) 优化到 O(tokens-in-file)

### P1 — 中文分词
- [x] **中文分词优化** — ✅ 已实现。使用 `Intl.Segmenter('zh', { granularity: 'word' })` 替代 bigram，“知识管理” 正确分为 ["知识", "管理"]。保留单字 unigram 兼容单字查询，无 Intl.Segmenter 时回退 bigram

### P2 — 语义搜索
- [ ] **Embedding 向量搜索** — 纯关键词匹配无法处理同义词/概念相似（"部署" 搜不到 "deployment"）
  - 方案：本地 embedding 模型 + SQLite FTS5 或 FAISS
  - 依赖：需要额外的向量存储基础设施

---

## 🧠 AI 上下文管理

### P0 — 成本优化
- [x] **Prompt Caching** — ✅ 已由 pi-ai 自动启用。Anthropic provider 默认 `cacheRetention: "short"` → `cache_control: { type: "ephemeral" }`，系统提示块自动缓存
  - 文件：`app/lib/agent/prompt.ts`, `app/api/ask/route.ts`
  - 方案：在 model config 中启用 `cache: { enabled: true, breakpoints: ['system'] }`

### P0 — Token 估算
- [x] **精确 Token 计数** — ✅ 已实现。CJK ~1.5 tokens/char, ASCII ~0.25 tokens/char，比 `length/4` 对中文准确 3-4 倍

### P1 — 大文件处理
- [x] **智能段落提取** — ✅ 已实现。`extractRelevantContent()` 按查询相关性提取 Top-K 段落，保留文档顺序。无查询时按段落边界截断。替代旧的 `truncate()` 逻辑

### P1 — Bootstrap 优化
- [x] **按需懒加载 Bootstrap** — ✅ 已实现。次要文件（README.md, CONFIG.md, target_*）仅在内容 >10 字符时加载，跳过空/样板文件节省 token
  - 方案：首次请求只加载 INSTRUCTION.md + CONFIG.json，其余按需

### P2 — SKILL.md 缓存
- [x] **SKILL.md 内存缓存** — ✅ 已实现。`readAbsoluteFile` 加 mtime 校验内存缓存，文件未修改时跳过磁盘 IO
  - 文件：`route.ts:325-331`

---

## 📁 文件树 & 缓存

### P0 — 异步化
- [x] **文件操作 async 化** — ✅ 已实现。新增 `collectAllFilesAsync()` 使用 `fs.promises.readdir` + `Promise.all` 并行遍历，不阻塞事件循环。保留同步版本向后兼容

### P0 — 缓存粒度
- [x] **路径级缓存失效** — ✅ 已实现。`invalidateCacheForFile/NewFile/DeletedFile` 替代全局 invalidateCache，写入操作触发增量搜索索引更新

### P1 — 文件监听
- [x] **文件系统 Watcher** — ✅ 已实现。`startFileWatcher()` 使用 Node.js `fs.watch(recursive)` + 500ms debounce 监听 mindRoot。外部编辑立即失效缓存，不再等待 5s TTL。错误时静默降级

### P1 — 搜索索引持久化
- [x] **磁盘持久化搜索索引** — ✅ 已实现。`persist()` 序列化到 `~/.mindos/search-index.json`，`load()` 启动时恢复（含 mtime 采样校验）。写操作后 5s debounce 自动持久化

### P2 — 启动预热
- [ ] **冷启动索引预热** — 第一次搜索会卡顿（需要建索引）。应在 `mindos start` 时异步预构建
  - 方案：`process.nextTick(() => buildSearchIndex())`

---

## 🤖 Agent Pipeline

### P0 — 可靠性
- [x] **API 重试机制** — ✅ 已实现。`session.prompt()` 包裹指数退避重试（最多 3 次，1s/2s），仅对瞬态错误重试（timeout/429/5xx/ECONNRESET），已发送内容后不重试。`isTransientError` 抽取到 `lib/agent/retry.ts`

### P1 — 循环检测增强
- [x] **语义循环检测** — ✅ 已实现。除了完全相同的 tool+args 3x 重复外，新增模式循环检测（A→B→A→B，周期长度 2-4）。提取到 `lib/agent/loop-detection.ts`

### P2 — Tool 输出流式化
- [ ] **长时间工具流式反馈** — web_fetch 等工具执行期间 UI 无进度反馈
  - 方案：通过 SSE 推送工具执行状态

---

## ⚡ 性能热点

### P0 — Graph API
- [x] **增量预计算链接图** — ✅ 已实现。新建 `LinkIndex` 维护双向链接索引（forwardLinks + backwardLinks），缓存 fileSet/basenameMap，增量更新。Graph API 从 O(n*m) 降为 O(1) 查表

### P0 — Backlinks
- [x] **反向索引** — ✅ 已实现。复用 LinkIndex 的 backwardLinks，`findBacklinks()` 从 O(n*L*5) 降为 O(linking-files * L * 5)。通过 `getLinkIndex().getBacklinks()` O(1) 获取源文件列表，仅扫描这些文件取上下文
  - 方案：写入时构建 `backlinkIndex: Map<target, Set<source>>`，查询 O(1)

### P1 — UI 虚拟化
- [x] **大列表虚拟渲染** — ✅ 已实现。SearchPanel 搜索结果使用 `react-virtuoso` 虚拟化渲染，500+ 结果不卡顿

### P1 — Diff 异步化
- [x] **Worker Thread 计算 Diff** — ✅ 已实现。新增 `diff-worker.ts` + `diff-async.ts`，>2000 行文件的 LCS diff 在 worker_threads 中异步计算（5s 超时），不阻塞 agent 主线程

### P2 — 行编辑优化
- [x] **原子追加操作** — ✅ 已实现。`appendToFile()` 改用 `fs.appendFileSync`，只读最后 8 字节判断换行，O(1) 替代 O(file-size)。fd leak 已修复（try/finally）

---

## 🔄 Sync 与协作

### P1 — 自动同步
- [x] **防抖自动提交** — ✅ 已实现。chokidar 文件监听 + 30s debounce 自动 `autoCommitAndPush()`。启动时拉取，每 5min 定期拉取。优雅关闭时冲刷待提交更改（bin/lib/sync.js:340-370）
  - 文件：`app/api/sync/route.ts`

### P2 — Webhook 集成
- [ ] **GitHub/GitLab Webhook** — 当前只能手动刷新看到远端变化。应接收 webhook 自动 pull
  - 方案：`POST /api/sync/webhook` → `git pull` → 失效缓存

### P3 — 离线队列
- [ ] **离线操作队列** — 网络断开时 sync 直接失败。应排队操作，恢复连接后重试

---

## 📊 优先级总览

| 优先级 | 优化项 | 预期收益 |
|--------|--------|----------|
| **P0** | BM25 搜索排序 | 搜索质量大幅提升 |
| **P0** | Prompt Caching | API 成本降低 50%+ |
| **P0** | 文件操作 async 化 | 服务器响应速度提升 |
| **P0** | 增量索引更新 | 写入后搜索延迟从 O(n) 降到 O(1) |
| **P0** | 路径级缓存失效 | 减少不必要的缓存重建 |
| **P0** | API 重试机制 | Agent 可靠性提升 |
| **P0** | Graph/Backlinks 增量索引 | 大知识库性能飞跃 |
| **P1** | 精确 Token 计数 | 上下文利用率提升 |
| **P1** | 文件系统 Watcher | 实时感知外部变更 |
| **P1** | 大列表虚拟化 | UI 不再卡顿 |
| **P1** | 中文分词优化 | 中文搜索召回率提升 |
| **P2** | 语义向量搜索 | 概念级检索能力 |
| **P2** | CRDT 实时协作 | 多人同时编辑 |
