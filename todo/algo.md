# 算法与核心功能深度优化

> 最后更新：2026-04-01

## 🔍 搜索与检索

### P0 — 搜索质量
- [x] **BM25 相关性排序** — ✅ 已实现。`search.ts` 使用 BM25 公式（k1=1.2, b=0.75），支持多词查询独立评分求和，两遍扫描（先算 df 再评分）。`getCandidatesUnion` 已优化 CJK bigram 候选集剪枝（按 token 命中数过滤，threshold = tokenCount/2）
  - 文件：`app/lib/core/search.ts:115`, `search-index.ts`
  - 方案：计算 `idf = log((N - df + 0.5) / (df + 0.5))`，结合文档长度归一化

### P0 — 索引性能
- [ ] **增量索引更新** — 当前任何写入操作都使整个搜索索引失效（`fs.ts:101-104`），导致全量重建 O(n)。应改为只更新被修改文件的 token
  - 文件：`app/lib/fs.ts:99-105`, `search-index.ts:112-117`
  - 方案：`removeFileTokens(path)` → `reindexFile(path)`

### P1 — 中文分词
- [ ] **中文分词优化** — 当前用 bigram 切分（`search-index.ts:16-57`），"知识管理" 被切成 "知识/识管/管理"，召回率低
  - 方案：接入 jieba 或 Intl.Segmenter API

### P2 — 语义搜索
- [ ] **Embedding 向量搜索** — 纯关键词匹配无法处理同义词/概念相似（"部署" 搜不到 "deployment"）
  - 方案：本地 embedding 模型 + SQLite FTS5 或 FAISS
  - 依赖：需要额外的向量存储基础设施

---

## 🧠 AI 上下文管理

### P0 — 成本优化
- [ ] **Prompt Caching** — 系统提示（~600 tokens）每次请求都重新发送。Anthropic 支持缓存前缀，可省 50%+ 成本
  - 文件：`app/lib/agent/prompt.ts`, `app/api/ask/route.ts`
  - 方案：在 model config 中启用 `cache: { enabled: true, breakpoints: ['system'] }`

### P0 — Token 估算
- [ ] **精确 Token 计数** — 当前用 `Math.ceil(content.length / 4)`（`context.ts:16-30`），中文字符实际 ~1.5 token/字，误差可达 6 倍
  - 文件：`app/lib/agent/context.ts:16-30`
  - 方案：引入 tiktoken 或 Anthropic 的 token counting API

### P1 — 大文件处理
- [ ] **智能段落提取** — 当前 >20k 字符直接截断（`tools.ts:17`），丢失后半部分全部信息
  - 方案：按查询相关性提取 Top-K 段落（chunk + 余弦相似度排序）

### P1 — Bootstrap 优化
- [ ] **按需懒加载 Bootstrap** — 每次 agent 请求加载 8-10 个配置文件（INSTRUCTION.md, README.md, CONFIG 等，`route.ts:323-386`），多数请求不需要全部
  - 方案：首次请求只加载 INSTRUCTION.md + CONFIG.json，其余按需

### P2 — SKILL.md 缓存
- [ ] **SKILL.md 内存缓存** — 每次请求从磁盘重读，应加 mtime 校验的内存缓存
  - 文件：`route.ts:325-331`

---

## 📁 文件树 & 缓存

### P0 — 异步化
- [ ] **文件操作 async 化** — `tree.ts` 使用 `fs.readdirSync`（阻塞事件循环），大目录（1000+ 文件）会导致服务器响应延迟
  - 文件：`app/lib/core/tree.ts:28-31`
  - 方案：改用 `fs.promises.readdir` + `Promise.all` 并行遍历

### P0 — 缓存粒度
- [ ] **路径级缓存失效** — 当前修改一个文件会清除所有缓存（`fs.ts:99-105`），应改为只失效受影响的路径
  - 文件：`app/lib/fs.ts:99-105`
  - 方案：`invalidatePath(filePath)` 替代 `invalidateAll()`

### P1 — 文件监听
- [ ] **文件系统 Watcher** — 外部编辑（VSCode、Finder）不被检测，5s 缓存期间可能提供过期数据
  - 方案：引入 chokidar 监听 mindRoot，变动时精准失效缓存 + 推送 SSE 事件

### P1 — 搜索索引持久化
- [ ] **磁盘持久化搜索索引** — 进程重启后索引从零重建。应持久化到 `~/.mindos/search-index.json`，启动时热加载
  - 方案：`persistIndex()` + `loadIndex()` with mtime 校验

### P2 — 启动预热
- [ ] **冷启动索引预热** — 第一次搜索会卡顿（需要建索引）。应在 `mindos start` 时异步预构建
  - 方案：`process.nextTick(() => buildSearchIndex())`

---

## 🤖 Agent Pipeline

### P0 — 可靠性
- [ ] **API 重试机制** — 当前 API 超时/限流直接失败，无重试。应加指数退避重试（最多 3 次）
  - 文件：`app/app/api/ask/route.ts`
  - 方案：`callWithRetry(fn, maxRetries=3, baseDelay=1000)`

### P1 — 循环检测增强
- [ ] **语义循环检测** — 当前只检测完全相同的 tool + args（`route.ts:589-599`）。应检测模式循环（read A → read B → read A → read B）
  - 方案：维护滑动窗口，检测 tool 序列的周期性

### P2 — Tool 输出流式化
- [ ] **长时间工具流式反馈** — web_fetch 等工具执行期间 UI 无进度反馈
  - 方案：通过 SSE 推送工具执行状态

---

## ⚡ 性能热点

### P0 — Graph API
- [ ] **增量预计算链接图** — 当前 O(n*m)：遍历所有文件 × 每个文件的正则提取（`api/graph/route.ts:89-106`）。1000 文件 × 50 链接 = 50,000 次正则
  - 方案：维护 `linkIndex: Map<source, Set<target>>`，文件写入时增量更新

### P0 — Backlinks
- [ ] **反向索引** — 当前 O(n * lines * patterns)（`core/backlinks.ts:25-47`），每个文件每行测试 5 个正则
  - 方案：写入时构建 `backlinkIndex: Map<target, Set<source>>`，查询 O(1)

### P1 — UI 虚拟化
- [ ] **大列表虚拟渲染** — 文件树/搜索结果无虚拟化，500+ 条目会导致 UI 卡顿
  - 方案：引入 `@tanstack/react-virtual`

### P1 — Diff 异步化
- [ ] **Worker Thread 计算 Diff** — LCS 算法 O(n*m)，大文件阻塞主线程（`agent/tools.ts:43-68`，已有 2000 行保护）
  - 方案：Web Worker / worker_threads 异步计算

### P2 — 行编辑优化
- [ ] **原子追加操作** — `lines.ts` 的 `updateLines()` 每次行编辑都读写整个文件。追加操作应用 `fs.appendFileSync`
  - 文件：`app/lib/core/lines.ts:37-42`

---

## 🔄 Sync 与协作

### P1 — 自动同步
- [ ] **防抖自动提交** — 当前手动触发 `sync now`。应在文件变动 30s 后自动 commit + push
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
