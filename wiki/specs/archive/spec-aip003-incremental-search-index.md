# Spec: AIP-003 增量搜索索引

## 目标

为 Core Search（`lib/core/search.ts`）引入倒排索引，将大规模知识库（1000+ 文件）下的搜索从 O(N×M) 全量遍历降到 O(k) 索引查询，同时保持与现有 MCP 工具的 API 兼容。

## 现状分析

### Core Search（MCP 工具用）
- `searchFiles(mindRoot, query, opts)` 每次查询遍历所有文件
- 对每个文件：`readFile` → `toLowerCase` → `indexOf` → `RegExp` 计数
- 没有索引、没有缓存。1000 文件 × 10KB 平均 = 每次查询读 10MB 磁盘
- 支持 scope / file_type / modified_after 三种过滤器

### App Search（前端 ⌘K 用）
- `lib/fs.ts` 有独立的 Fuse.js 搜索 + 5s TTL 缓存
- 本次不改动 App Search，两套搜索继续共存

### 痛点
- 搜索响应时间随知识库增长线性恶化
- MCP Agent 频繁调用搜索工具时产生大量重复 I/O
- 无法支持未来的多关键词搜索、高级查询等

## 数据流 / 状态流

```
写操作 → invalidateSearchIndex() → index = null
                                        ↓
搜索请求 → index 为空？→ YES → rebuildIndex():
                                  collectAllFiles()
                                  → 遍历文件 readFile()
                                  → 逐文件分词（空格 + CJK 字符级）
                                  → 构建 invertedIndex: Map<token, Set<filePath>>
                                  → 构建 fileHashes: Map<filePath, hash>
                                  → 缓存到模块级变量
                ↓ NO
           invertedIndex.get(queryTokens)
           → 候选文件交集
           → 对候选文件做精确 indexOf 匹配（复用现有逻辑）
           → 排序 + 返回
```

**读数据**: `collectAllFiles()` (tree.ts), `readFile()` (fs-ops.ts)
**写数据**: 模块内存变量 `_index`（不持久化）
**缓存层**: 仅内存，无磁盘缓存。通过 TTL 或写操作失效

## 方案

### 核心设计：内存倒排索引 + 增量更新

1. **新建 `app/lib/core/search-index.ts`**
   - `SearchIndex` 类：倒排索引 + 文件元数据
   - 分词策略：空格分割 + CJK 字符级 unigram/bigram
   - `rebuild()`: 全量重建索引
   - `invalidate()`: 清除索引（下次查询时 lazy rebuild）
   - `search(query, opts)`: 基于索引的搜索

2. **修改 `app/lib/core/search.ts`**
   - 导入 `SearchIndex`，用索引缩小候选文件集
   - 保持现有 `SearchResult` 接口不变
   - 保持现有过滤器（scope, file_type, modified_after）不变

3. **接入失效机制**
   - `lib/fs.ts` 的 `invalidateCache()` 同时调用 `searchIndex.invalidate()`

### 技术选型
- **纯 TypeScript 实现**，无额外依赖
- **不持久化到磁盘**：进程内缓存即可（与 App Search 的 Fuse.js 缓存策略一致）
- **分词**：`\b` word boundary + CJK 字符拆分（与 App Search 的 CJK 支持对齐）

## 影响范围

### 变更文件
| 文件 | 改动 |
|------|------|
| `app/lib/core/search-index.ts` | **新建** — SearchIndex 类 |
| `app/lib/core/search.ts` | 改用索引缩小候选集 |
| `app/lib/core/index.ts` | 导出 invalidateSearchIndex |
| `app/lib/fs.ts` | invalidateCache() 同时失效搜索索引 |
| `app/__tests__/core/search-index.test.ts` | **新建** — 索引单元测试 |
| `app/__tests__/core/search.test.ts` | 增加索引集成测试 |

### 不受影响的模块
- `app/lib/fs.ts` 的 Fuse.js 搜索：完全独立，不改动
- `app/app/api/search/route.ts`：调用 App Search，不涉及
- `app/lib/agent/tools.ts`：调用 App Search，不涉及
- 前端组件：不涉及

### 破坏性变更
- 无。`searchFiles()` 签名和返回类型不变

## 边界 case 与风险

1. **索引为空时首次搜索** — lazy rebuild，退化为全量遍历（与改动前行为一致）
2. **查询包含特殊字符**（`*`, `?`, `[`, `{`）— 分词后作为普通 token 匹配，不解释为 glob/regex
3. **极短查询**（1-2 字符）— 倒排索引可能返回大量候选，退化为接近全量遍历。风险低：现有行为就是全量遍历
4. **CJK 混合查询**（如 "知识base"）— 分词同时产生 CJK bigram 和 Latin word token，交集缩小候选集
5. **文件在两次搜索之间被外部修改**（绕过 MindOS API）— 5s TTL 或手动 invalidate 兜底
6. **并发查询 + rebuild 竞态** — 单线程 Node.js，rebuildIndex 是同步操作，无竞态
7. **超大文件（>50KB）** — 索引时截断到 50KB（与 Fuse.js 一致）
8. **内存占用** — 倒排索引 ≈ 去重 token Set。1000 文件 × 10KB，token 数 ≈ 50K-100K，Map 开销 ≈ 5-10MB

### 风险
- **索引失效遗漏**：如果新增写操作入口未调用 invalidate，搜索结果过时。Mitigation: 统一在 `lib/fs.ts` 的 `invalidateCache()` 中触发
- **分词质量不足**：简单空格分割可能遗漏复合词。Mitigation: 索引只做候选集缩减，最终匹配仍用 indexOf 精确查找

## 验收标准

- [ ] 现有 `__tests__/core/search.test.ts` 全部通过（行为兼容）
- [ ] `SearchIndex.rebuild()` 正确构建倒排索引
- [ ] 搜索结果与无索引版本一致（相同查询 → 相同结果集）
- [ ] 索引在 `invalidateCache()` 后被清除
- [ ] CJK 查询正确分词并命中
- [ ] 空查询 / 无匹配查询 / 特殊字符查询返回正确结果
- [ ] `npx vitest run` 全部通过
- [ ] TypeScript 编译无错误
