# Spec: MCP / API — create_space, rename_space & list_spaces

## 目标

为 Mind **Space**（一级或带 parent 的知识分区目录）提供与现有 `mindos_*` 工具一致的通路：业务逻辑集中在 **App**（`lib/core` + `/api/file`），MCP 为薄 HTTP 客户端。覆盖 **新建空间**（已有 UI `createSpaceAction`）、**重命名空间目录**（新能力），以及 **列出顶层空间**（与首页 Spaces 网格同源、轻于整棵树）。

## 现状分析

- 新建：`createSpaceAction`（`app/lib/actions.ts`）写 `{fullPath}/README.md` 并触发 `scaffoldIfNewSpace`；MCP 仅有 `mindos_create_file`，Agent 易误用为普通文件而非「空间」语义。
- 重命名：`rename_file` 只适用于**文件**；`move_file` 只移动文件。重命名顶层目录（Space）需对目录 `renameSync`，规则与文件不同（路径为目录、保留整棵子树）。
- 列举：`mindos_list_files` 输出整棵树；Agent 仅需「有哪些顶层 Space + 简介」时过重，且应与 UI 使用同一套树过滤规则，避免与 `buildFileTree` 不一致。

## 数据流 / 状态流

```
MCP mindos_create_space
  → POST /api/file { op: "create_space", path: "_", name, description?, parent_path? }
       → createSpaceFilesystem(getMindRoot(), …)  // `lib/core/create-space.ts`，与 UI `createSpaceAction` 同源
       → core createFile → scaffoldIfNewSpace
       → invalidateCache()
  → revalidatePath('/', 'layout')（action 内 + route TREE_CHANGING）

MCP mindos_rename_space
  → POST /api/file { op: "rename_space", path: "<spaceRelDir>", new_name }
       → renameSpace(path, new_name)  // lib/fs → core/fs-ops.renameSpaceDirectory
       → fs.renameSync(目录)
  → invalidateCache + revalidatePath

MCP mindos_list_spaces
  → GET /api/file?op=list_spaces
       → listMindSpaces()  // lib/fs: summarizeTopLevelSpaces(mindRoot, ensureCache().tree)
       → 与 UI 同源缓存树；仅顶层目录；跳过 `.` 开头；统计各 Space 下 .md/.csv；README 首段非标题行为 description
  → JSON { spaces: MindSpaceSummary[] }；MCP 可选 markdown / json 格式化输出
```

说明：`create_space` 的 `path` 字段可为占位 `_`（与其它 op 的必填 `path` 兼容）；真正参数走 body 的 `name` / `parent_path`。`list_spaces` 的 GET **不要求** `path` 查询参数。

## 方案

1. **`renameSpaceDirectory`**（`app/lib/core/fs-ops.ts`）：`resolveSafe` 解析目录；校验存在且 `isDirectory`；`new_name` 无分隔符；目标路径不存在；`renameSync`；返回新相对路径。
2. **`renameSpace`** 包装于 `app/lib/fs.ts`：`invalidateCache()`。
3. **`/api/file`**：`create_space` 调用 `createSpaceAction`；`rename_space` 调用 `renameSpace`；`TREE_CHANGING_OPS` 加入二者。
4. **MCP**（`mcp/src/index.ts`）：`mindos_create_space`、`mindos_rename_space`、`mindos_list_spaces`（GET `op=list_spaces`），描述中强调 Space = Agent 上下文目录。
5. **文档**：`mcp/README.md` 表格；SKILL 副本同步 `skills/`、`app/data/skills/`、`.claude-internal/skills/`。
6. **Core**：`app/lib/core/list-spaces.ts` 的 `summarizeTopLevelSpaces` 仅做摘要；调用方传入与 UI 一致的 `FileNode[]`。

## 影响范围

- 变更：`app/lib/core/fs-ops.ts`、`app/lib/core/list-spaces.ts`、`app/lib/core/index.ts`、`app/lib/fs.ts`、`app/app/api/file/route.ts`、`app/__tests__/api/file.test.ts`、`app/__tests__/core/fs-ops.test.ts`、`app/__tests__/core/list-spaces.test.ts`、`mcp/src/index.ts`、`mcp/README.md`、`skills/mindos/SKILL.md`、`skills/mindos-zh/SKILL.md`、对应 `app/data/skills/` 与 `.claude-internal/skills/` 副本。
- 不受影响：Modal 新建空间 UI（仍用 `createSpaceAction`）；`rename_file` / `move_file` 语义不变。
- 破坏性：无（仅新增 op 与 tool）。

## 边界 case 与风险

| 边界 | 处理 |
|------|------|
| `new_name` 含 `/`、`\` | 拒绝 |
| `path` 不是目录或不存在 | 明确错误 |
| 目标目录名已存在 | `FILE_ALREADY_EXISTS` |
| `path` 为空、`.` | 拒绝（不能重命名根） |
| `parent_path` 非法（`..`、绝对路径） | `createSpaceAction` 已有校验 |
| 重命名后笔记内链接仍指向旧路径 | **不自动批量替换**（与 `move_file` 提示 backlinks 类似，目录级更大 scope；本 spec 不引入批量改写） |
| Space 在磁盘存在但被 `buildFileTree` 忽略 | 不出现在 `list_spaces`（与首页一致，属预期） |
| README 只有标题无正文 | `description` 为空字符串 |

**风险**：陈旧 `mindos.pid` / 监听与本次无关；Electron SW 跳过与本次无关。

## 验收标准

- [ ] `POST /api/file` `create_space` 在临时 mindRoot 下创建 `Foo/README.md` + 脚手架 `INSTRUCTION.md`（若 scaffold 规则满足）。
- [ ] `POST /api/file` `rename_space` 将 `Foo` → `Bar`，相对路径返回 `Bar`；拒绝文件路径、非法 `new_name`。
- [ ] `fs-ops` 单测覆盖：成功重命名、非目录、目标已存在、非法 `new_name`。
- [ ] MCP 注册三工具：`create_space` / `rename_space`（POST）、`list_spaces`（GET）；`npm test` 全绿。
- [ ] SKILL 中英文列出 `mindos_create_space` / `mindos_rename_space` / `mindos_list_spaces`，与 README 一致。
- [ ] `GET /api/file?op=list_spaces` 返回 `spaces` 数组；单测覆盖含 README 描述与隐藏目录跳过。
