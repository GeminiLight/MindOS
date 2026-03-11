# 重构计划：抽取 packages/core 共享包

## 目标

将 `app/lib/fs.ts` 和 `mcp/src/index.ts` 中重复的文件系统操作逻辑抽到 `packages/core/`，两边都从这里 import。改一处，两边生效。

## 当前问题

MCP (25个函数) 和 App (21个函数) 各自实现了几乎一样的逻辑：
- `collectAllFiles`, `getFileTree`, `readFile/getFileContent`, `writeFile/saveFileContent`
- `searchFiles`, `getRecentlyModified`, `findBacklinks/getBacklinks`
- `readLines`, `insertLines`, `updateLines`, `appendToFile`
- `insertAfterHeading`, `updateSection`, `renameFile`, `createFile`, `deleteFile`
- 类型定义: `FileNode`, `SearchResult`
- 安全函数: `resolveSafe`, `assertWithinRoot`

两边有少量差异需要处理：
- **ALLOWED_EXTENSIONS**: App 允许 `.json`，MCP 不允许 → 合并为 `.md`, `.csv`, `.json`
- **IGNORED_DIRS**: App 少了 `mcp`，MCP 多了 `mcp` → 合并取并集
- **searchFiles**: App 已升级 Fuse.js，MCP 还是 indexOf → 统一用 Fuse.js
- **App 独有**: `getMindRoot()` (读 settings)、`invalidateCache()`、`deleteLines()`、`getDirEntries()`、`isDirectory()`
- **MCP 独有**: `isRootProtected()`/`assertNotProtected()`、`appendCsvRow()`、`gitLog()`/`gitShowFile()`/`isGitRepo()`、`moveFile()`、`renderTree()`、`truncate()`、审计日志 (`logOp`/`logDiff`)

## 架构方案

```
sop_note/
├── packages/
│   └── core/
│       ├── package.json          # name: "@mindos/core", type: module
│       ├── tsconfig.json
│       └── src/
│           ├── index.ts          # re-export all
│           ├── types.ts          # FileNode, SearchResult, SearchMatch, BacklinkEntry
│           ├── constants.ts      # IGNORED_DIRS, ALLOWED_EXTENSIONS
│           ├── security.ts       # resolveSafe, assertWithinRoot, isRootProtected, assertNotProtected
│           ├── files.ts          # collectAllFiles, getFileTree, readFile, writeFile, createFile, deleteFile, renameFile, moveFile
│           ├── search.ts         # searchFiles (Fuse.js), getBacklinks
│           ├── lines.ts          # readLines, insertLines, updateLines, deleteLines, appendToFile, insertAfterHeading, updateSection
│           ├── csv.ts            # appendCsvRow
│           ├── git.ts            # isGitRepo, gitLog, gitShowFile
│           └── utils.ts          # renderTree, truncate
├── app/
│   ├── package.json              # 添加 "@mindos/core": "file:../packages/core"
│   └── lib/
│       └── fs.ts                 # 薄包装层：import from @mindos/core + App 独有逻辑 (cache, getMindRoot, getDirEntries, isDirectory)
├── mcp/
│   ├── package.json              # 添加 "@mindos/core": "file:../packages/core", "fuse.js"
│   └── src/
│       └── index.ts              # 薄包装层：import from @mindos/core + MCP 独有逻辑 (审计日志, server.tool 注册)
```

## 关键设计决策

### 1. MIND_ROOT 注入方式
core 不硬编码 MIND_ROOT，所有函数接收 `rootDir: string` 参数，或通过初始化函数设置：

```typescript
// packages/core/src/config.ts
let _rootDir: string = '';
export function setRootDir(dir: string): void { _rootDir = dir; }
export function getRootDir(): string {
  if (!_rootDir) throw new Error('Call setRootDir() before using core functions');
  return _rootDir;
}
```

App 侧在 server startup 时调用 `setRootDir(effectiveSopRoot())`。
MCP 侧在启动时调用 `setRootDir(MIND_ROOT)`。

### 2. Cache 放在 App 侧
缓存是 App 独有需求（Web 请求频繁），core 不管缓存。App 的 `fs.ts` 在 core 函数外面包一层缓存。

### 3. 审计日志放在 MCP 侧
`logOp`/`logDiff` 是 MCP 独有功能，不进 core。MCP 的 tool handler 在调用 core 函数前后自己记日志。

### 4. fuse.js 作为 core 依赖
`searchFiles` 统一使用 Fuse.js，fuse.js 加入 core 的 dependencies。

## 修改文件清单

### 新建
1. `packages/core/package.json`
2. `packages/core/tsconfig.json`
3. `packages/core/src/index.ts`
4. `packages/core/src/types.ts`
5. `packages/core/src/config.ts`
6. `packages/core/src/constants.ts`
7. `packages/core/src/security.ts`
8. `packages/core/src/files.ts`
9. `packages/core/src/search.ts`
10. `packages/core/src/lines.ts`
11. `packages/core/src/csv.ts`
12. `packages/core/src/git.ts`
13. `packages/core/src/utils.ts`

### 修改
14. `app/package.json` — 添加 `"@mindos/core": "file:../packages/core"` 依赖
15. `app/lib/fs.ts` — 重写为薄包装层，从 `@mindos/core` import 核心逻辑
16. `app/lib/types.ts` — 从 `@mindos/core` re-export 类型
17. `mcp/package.json` — 添加 `"@mindos/core": "file:../packages/core"` 和 `"fuse.js"` 依赖
18. `mcp/src/index.ts` — 删除重复函数，从 `@mindos/core` import

## 实施步骤

1. **创建 packages/core** — 类型、常量、安全、文件操作、搜索、行编辑、CSV、Git、工具函数
2. **构建 core** — `cd packages/core && npm install && npm run build`
3. **改造 app** — 更新依赖 → 重写 fs.ts 为薄包装 → npm install → 验证 tsc
4. **改造 mcp** — 更新依赖 → 重写 index.ts 删除重复函数 → npm install → 验证 tsc
5. **端到端验证** — 分别构建 app 和 mcp，确认无报错

## 验证

- `cd packages/core && npm run build` — 编译无报错
- `cd app && npm install && npx tsc --noEmit` — 类型检查通过
- `cd mcp && npm install && npm run build` — 编译无报错
- App 搜索功能正常（Fuse.js）
- MCP 搜索功能正常（同样的 Fuse.js）
