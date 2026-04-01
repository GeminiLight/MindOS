# Spec: Tier 1 Features (Trash, Export, Favorites)

**Author**: AI Development  
**Date**: 2026-04-01  
**Status**: Spec Approved (Ready for Implementation)

---

## Overview

Implement three high-frequency features to improve MindOS UX:

1. **Trash / Recycle Bin** — Recover accidentally deleted files
2. **Export** — Share knowledge base in standard formats (PDF/HTML/ZIP)
3. **Favorites / Pinning** — Quick access to frequently used files

---

## 1. TRASH / RECYCLE BIN

### Why This Feature?

Users currently experience permanent data loss on delete. No recovery option exists. Git history is not intuitive for casual users.

**YAGNI Check**: ✅ Every major KB tool (Notion, Obsidian, Apple Notes) has trash. Essential.  
**KISS Check**: ✅ Simple implementation: move to `.trash/` instead of `fs.unlinkSync()`. Keep it simple initially (no auto-purge, no quota).

### Design Decisions

1. **Storage**: `.mindos/.trash/` directory (parallel to `.mindos/mind/`)
2. **Metadata**: Preserve original path in hidden `.deleted-from` file (JSON)
3. **Retention**: 30 days auto-purge (check on app start + daily background job)
4. **Naming Conflicts**: If file exists in trash with same name, append `_<timestamp>` to preserve
5. **UI**: Trash page at `/trash` + undo toast in file/folder delete workflows

### User Flow

#### 🎯 Main Flow: Delete File → Undo

```
用户目标：删除不需要的文件，但可以反悔

前置条件：用户在文件树中，有某个文件

Step 1: 用户右键点击文件 → 选择"Delete"
  → 系统反馈：确认弹窗 "Delete permanently? You can recover from Trash for 30 days."
  → 状态变化：UI 等待用户确认

Step 2: 用户点击 [Delete] 按钮
  → 系统反馈：文件从树中消失，Undo 吐司出现 "Deleted. [Undo] [View in Trash]"
  → 状态变化：文件移动到 .trash/，原路径记录到 .deleted-from

Step 3a: 用户点击 [Undo]（5 秒内）
  → 系统反馈：文件恢复到原位置，吐司显示 "Restored."
  → 状态变化：从 .trash/ 移回原路径
  → 页面自动刷新，文件重新出现在树中

Step 3b: 用户忽略吐司（或5秒后自动消失）
  → 系统反馈：无
  → 状态变化：文件留在 .trash/ 中

Step 4: 用户访问 /trash 页面
  → 系统反馈：展示 trash 中的所有文件，按删除时间逆序排列，每个文件显示"来自: /path/to/file"
  → 状态变化：无

Step 5a: 用户点击某个文件的 [Restore]
  → 系统反馈：文件恢复吐司，页面移除该行
  → 状态变化：文件恢复到原位置

Step 5b: 用户点击某个文件的 [Delete Forever]
  → 系统反馈：确认弹窗 "Permanently delete?"
  → 状态变化：等待确认

Step 5c: 用户点击确认
  → 系统反馈：文件从 trash 消失，吐司显示 "Permanently deleted."
  → 状态变化：文件被 fs.unlinkSync() 彻底删除

成功结果：用户可以恢复删除的文件，或彻底删除

异常分支：
- A. 原路径已被占用（另一个文件）：恢复时弹窗让用户选择"覆盖"或"保存为副本"
- B. 原路径所在目录不存在：自动重新创建目录后恢复
- C. 30天过期：自动清理，用户无感知；Trash页面显示过期时间
- D. 用户恢复时 trash 中找不到文件：显示错误信息 "File no longer in trash"

边界场景：
- 删除整个文件夹 → 递归移到 trash，单独恢复每个文件或整个目录
- 多个同名文件删除 → trash 中用 _timestamp 区分
- Trash 超过 500 个文件 → 列表虚拟滚动（Virtuoso）
- Undo 有5秒时间窗口 → 期间删除其他文件不影响之前的 undo
```

### UI States

```
┌─ 状态 1：删除确认弹窗 ─────────────────────┐
│  ┌──────────────────────────────────┐     │
│  │  ⚠️  Delete "meeting.md"?         │     │
│  │  You can recover from Trash      │     │
│  │  within 30 days.                 │     │
│  │                                  │     │
│  │     [Cancel]  [Delete]           │     │
│  └──────────────────────────────────┘     │
└────────────────────────────────────────────┘

┌─ 状态 2：删除后 Undo 吐司 ─────────────────┐
│ ┌─────────────────────────────────┐       │
│ │ ✓ Deleted  [Undo]  [View]  [×]  │ ⏱ 5s │
│ └─────────────────────────────────┘       │
└────────────────────────────────────────────┘

┌─ 状态 3：Trash 页面（空） ─────────────────┐
│  ┌──────────────────────────────────┐     │
│  │  🗑️  Trash                       │     │
│  │                                  │     │
│  │  No deleted files yet.           │     │
│  │  Items you delete appear here    │     │
│  │  for 30 days.                    │     │
│  └──────────────────────────────────┘     │
└────────────────────────────────────────────┘

┌─ 状态 4：Trash 页面（有内容） ────────────────────┐
│  🗑️  Trash (3 items)  [Empty Trash]               │
│  ┌──────────────────────────────────────────────┐ │
│  │ ✓ meeting.md                               │ │
│  │   From: /2026-Q1/Meetings/               │ │
│  │   Deleted: 2 days ago • Expires: 28 days  │ │
│  │                    [Restore]  [Delete ×]   │ │
│  ├──────────────────────────────────────────────┤ │
│  │ ✓ budget.csv                              │ │
│  │   From: /Finance/                         │ │
│  │   Deleted: 1 week ago • Expires: 23 days   │ │
│  │                    [Restore]  [Delete ×]   │ │
│  ├──────────────────────────────────────────────┤ │
│  │ ✓ draft_notes.md                          │ │
│  │   From: /Inbox/                           │ │
│  │   Deleted: 29 days ago • Expires: 1 day    │ │
│  │                    [Restore]  [Delete ×]   │ │
│  └──────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────┘

┌─ 状态 5：恢复冲突确认 ──────────────────┐
│  ┌────────────────────────────────┐     │
│  │  ⚠️  Restore Conflict           │     │
│  │  "meeting.md" already exists    │     │
│  │  at /2026-Q1/Meetings/         │     │
│  │                                │     │
│  │  [ Overwrite ]  [ Save as: ]    │     │
│  │                  [_copy_2026...] │     │
│  │           [ Cancel ]            │     │
│  └────────────────────────────────┘     │
└────────────────────────────────────────┘
```

### Validation Criteria (Pass/Fail)

✅ **Delete to Trash**: File disappears from tree, appears in `.trash/`, original path in metadata  
✅ **Undo**: Click undo within 5s → file returns to original location  
✅ **Trash Page**: Displays all deleted files sorted by deletion time (newest first)  
✅ **Restore**: Click restore → file returns to original path  
✅ **Delete Forever**: File permanently deleted from trash  
✅ **Conflict Handling**: If original path occupied → user chooses overwrite/save as copy  
✅ **30-Day Auto Purge**: Files older than 30 days auto-deleted on app start  
✅ **Undo Toast Timeout**: Toast auto-dismisses after 5s, timer visible  
✅ **Directory Delete**: Deleting a folder moves it to trash with all contents  
✅ **Restore Directory**: Restores entire directory structure  

---

## 2. EXPORT

### Why This Feature?

MindOS is local-first but users need to share knowledge base with non-MindOS users. No export formats currently supported.

**YAGNI Check**: ✅ Export is table-stakes for any KB tool. Users will request.  
**KISS Check**: ⚠️ Start with Markdown + ZIP. PDF/HTML can come later (high complexity). Keep v1 simple.

### Design Decisions

1. **Formats (v1)**: 
   - Single file: `.md` (markdown) + `.html` (static HTML)
   - Multiple: `.zip` (preserving directory structure)
2. **HTML Conversion**: Use `marked` (already in deps) + minimal CSS
3. **ZIP Creation**: Use `archiver` (npm install if needed)
4. **Scope**: 
   - Export current file → download single file
   - Export current Space → download entire directory as ZIP
5. **Links**: Wiki-links `[[file]]` → convert to relative paths in HTML
6. **File Size Limit**: Warn if exporting >500 files or >100MB

### User Flow

#### 🎯 Main Flow: Export Single File

```
用户目标：导出一个文件给同事看

前置条件：用户在预览某个文件

Step 1: 用户点击文件菜单 → [Export]
  → 系统反馈：Export 模态框打开，显示"选择格式 + 预览"
  → 状态变化：UI 展示三个选项：Markdown / HTML / PDF*（灰掉提示v2）

Step 2: 用户选择 HTML
  → 系统反馈：预览区域显示转换后的 HTML（实时预览）
  → 状态变化：HTML 内容在预览框中渲染

Step 3: 用户点击 [Export as HTML]
  → 系统反馈：浏览器下载 `{filename}.html`，吐司显示"Downloaded"
  → 状态变化：无（文件已下载到用户本地）

成功结果：用户得到 HTML 文件，可以分享给他人
```

#### 🎯 Main Flow: Export Space as ZIP

```
用户目标：导出整个"会议笔记"Space 作为备份或分享

前置条件：用户在 FileTree 中，选中了某个 Space

Step 1: 用户右键点击 Space → [Export...]
  → 系统反馈：Export 模态框，显示"Space 名 + 文件数 + 预计大小"
  → 状态变化：预显示"包含 42 个 .md 文件，~2.3 MB"

Step 2: 用户选择导出格式（Markdown ZIP / HTML ZIP）
  → 系统反馈：预览显示目录结构树，wiki-links 转换提示
  → 状态变化：无

Step 3: 用户点击 [Export as ZIP]
  → 系统反馈：Loading 指示"准备文件..."（显示进度 0%）
  → 状态变化：后端开始压缩文件

Step 4: 压缩进行中
  → 系统反馈：进度条更新"压缩中... 12% (5/42 文件)"
  → 状态变化：后端持续工作

Step 5: 压缩完成
  → 系统反馈：进度条 100%，浏览器下载 `meetings-2026-04-01.zip`，吐司"Downloaded"
  → 状态变化：文件已下载

成功结果：用户得到 ZIP 文件，包含所有文件和目录结构
```

### UI States

```
┌─ 状态 1：Export 模态框（单文件，选择格式）──────┐
│  ┌─────────────────────────────────────────┐    │
│  │  📥 Export "meeting.md"                 │    │
│  │                                          │    │
│  │  Choose format:                          │    │
│  │  ◯ Markdown (.md) - Recommended         │    │
│  │  ◉ HTML (.html)   - Static webpage      │    │
│  │  ◯ PDF (.pdf)     - Coming in v2        │    │
│  │                                          │    │
│  │  ─── Preview ───────────────────────    │    │
│  │  │ <html>                              │    │
│  │  │ <body>                              │    │
│  │  │ <h1>Meeting Notes</h1>              │    │
│  │  │ ...                                 │    │
│  │  │ </body></html>                      │    │
│  │  │ (scrollable, syntax highlight)      │    │
│  │  └──────────────────────────────────┘    │    │
│  │                                          │    │
│  │       [Cancel]  [Export as HTML]        │    │
│  └─────────────────────────────────────────┘    │
└─────────────────────────────────────────────────┘

┌─ 状态 2：Export Space（进度） ──────────────────┐
│  ┌─────────────────────────────────────────┐    │
│  │  📥 Export "Meetings" (Space)            │    │
│  │                                          │    │
│  │  Files: 42 total                         │    │
│  │  Size: ~2.3 MB                           │    │
│  │  Format: Markdown ZIP                    │    │
│  │                                          │    │
│  │  ◌ Preparing files...                   │    │
│  │  ████████░░░░░░░░░░░░ 35% (15/42)       │    │
│  │                                          │    │
│  │  Details:                                │    │
│  │  ├─ meetings/2026-Q1/                   │    │
│  │  ├─ meetings/2026-Q1/2026-03.md         │    │
│  │  ├─ meetings/2026-Q1/2026-04.md ✓       │    │
│  │  ├─ meetings/2026-Q2/...               │    │
│  │  └─ ...                                 │    │
│  │                                          │    │
│  │                    [Cancel]              │    │
│  └─────────────────────────────────────────┘    │
└─────────────────────────────────────────────────┘

┌─ 状态 3：Export 完成 ─────────────────────────┐
│  ┌─────────────────────────────────────────┐   │
│  │  ✓ Export Complete                      │   │
│  │                                          │   │
│  │  Downloaded: meetings-2026-04-01.zip    │   │
│  │  Size: 2.3 MB • 42 files                │   │
│  │  Location: ~/Downloads/                 │   │
│  │                                          │   │
│  │       [Show in Folder]  [Done]          │   │
│  └─────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
```

### Validation Criteria

✅ **Export File to MD**: Download works, content identical to source  
✅ **Export File to HTML**: HTML renders correctly, links converted  
✅ **Export Space to ZIP**: Directory structure preserved, all files included  
✅ **Progress Tracking**: For >10 files or >5MB, show progress  
✅ **Wiki-Link Conversion**: `[[file]]` → relative links in HTML/ZIP  
✅ **File Size Warning**: Warn if >500 files or >100MB  
✅ **Download Naming**: Use sensible names: `{filename}.{ext}` or `{space-name}-{date}.zip`  
✅ **No Data Modification**: Export doesn't modify original files  

---

## 3. FAVORITES / PINNING

### Why This Feature?

Users have frequently accessed files scattered across the KB. No quick access without tree navigation.

**YAGNI Check**: ✅ Users naturally want favorites (browser bookmarks, app favorites, etc.).  
**KISS Check**: ✅ Pure client-side localStorage. Cheapest feature.

### Design Decisions

1. **Storage**: `localStorage['mindos-pinned-files']` = JSON array of file paths
2. **Capacity**: No limit (allow users to pin 100+ if they want)
3. **UI Placement**: New "Pinned Files" section at top of HomeContent, above "Recent Files"
4. **Icon**: Star (⭐) for pinned state; outline star for un-pinned
5. **Sync**: No sync to git (local preference only, like .gitignore)
6. **Ordering**: Manual drag-to-reorder (use Sortable.js or dnd-kit)

### User Flow

#### 🎯 Main Flow: Pin a File

```
用户目标：快速访问常用文件，而不用搜索

前置条件：用户在文件树或预览中

Step 1: 用户在文件树中右键点击文件 → 选择 "Pin to Favorites"
  → 系统反馈：文件旁边的星形图标变实心（⭐），小吐司"Added to Favorites"
  → 状态变化：文件路径加入 localStorage

Step 2: 用户返回 Home
  → 系统反馈：顶部出现新的"Pinned Files"卡片，列出所有固定文件
  → 状态变化：无

Step 3: 用户点击某个 pinned 文件
  → 系统反馈：导航到该文件预览页
  → 状态变化：无

Step 4: 用户想删除某个 pin，右键点击 pinned 文件 → "Remove from Favorites"
  → 系统反馈：文件从 Pinned Files 中消失，星形变空心，吐司"Removed"
  → 状态变化：从 localStorage 移除

Step 5: 用户想重新排列 pinned 文件，拖拽某个文件到新位置
  → 系统反馈：文件跟随鼠标，松开时滑动到新位置
  → 状态变化：排序保存到 localStorage

成功结果：Favorites 页面显示用户最常用的文件，快速访问
```

### UI States

```
┌─ 状态 1：无 Pinned Files ──────────────────────┐
│  (Pinned Files 卡片不显示)                      │
│                                                 │
│  📂 Recent Files                                │
│  ├─ Budget Review Q1.md  •  2 days ago        │
│  ├─ Team Standup 2026-03.md  •  1 day ago     │
│  └─ ...                                        │
└─────────────────────────────────────────────────┘

┌─ 状态 2：有 Pinned Files ──────────────────────┐
│  ⭐ Pinned Files (3)                           │
│  ┌──────────────────────────────────────────┐  │
│  │ ⭐ meeting-template.md                  │  │
│  │    /Templates/                          │  │
│  │                                          │  │
│  │ ⭐ 2026-Q1-goals.md                     │  │
│  │    /Strategy/                           │  │
│  │                                          │  │
│  │ ⭐ Team Standup Log.md                  │  │
│  │    /Processes/                          │  │
│  └──────────────────────────────────────────┘  │
│  (可拖拽重新排序)                               │
│                                                 │
│  📂 Recent Files                                │
│  ├─ Budget Review Q1.md  •  2 days ago        │
│  └─ ...                                        │
└─────────────────────────────────────────────────┘

┌─ 状态 3：Pinned Files 卡片（拖拽中） ──────────┐
│  ⭐ Pinned Files (3)                           │
│  ┌──────────────────────────────────────────┐  │
│  │ ⭐ meeting-template.md   ↕️ (拖拽中)       │  │
│  │    /Templates/                          │  │
│  │                                          │  │
│  │ ⭐ 2026-Q1-goals.md                     │  │
│  │    /Strategy/                           │  │
│  │    ─────────────────── (插入位置指示)     │  │
│  │ ⭐ Team Standup Log.md                  │  │
│  │    /Processes/                          │  │
│  └──────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘

┌─ 状态 4：文件树中的 Pin 图标 ──────────────────┐
│  📂 Templates/                                  │
│  ├─ ⭐ meeting-template.md (filled star)      │
│  ├─ ☆ draft-template.md (empty star)          │
│  └─ ☆ backup-template.md (empty star)         │
│                                                 │
│  (hover on file 时，星形可点击切换)              │
└─────────────────────────────────────────────────┘
```

### Validation Criteria

✅ **Pin File**: File appears in Pinned section, star filled  
✅ **Unpin File**: File disappears from Pinned, star empty  
✅ **Pinned Persistence**: Refresh page → pins still there  
✅ **Manual Reordering**: Drag-to-reorder works, saves to localStorage  
✅ **No Limit**: Can pin unlimited files  
✅ **UI Consistency**: Star icon consistent across FileTree + Pinned section + Home  
✅ **Quick Pin**: Right-click context menu has "Pin" option  
✅ **Undo Toast**: After unpin, undo toast appears (3s timeout)  

---

## Implementation Priority

**Order** (do in sequence, each depends on previous):

1. **Favorites** — Easiest (localStorage only), lowest risk, highest user delight for effort
2. **Trash** — Medium (file system, metadata), foundational for other ops
3. **Export** — Harder (format conversion, progress UI), can iterate with v1 limited

---

## Technical Specs

### Data Structures

#### Trash Metadata (`.trash/.deleted-from/<filename>.json`)

```json
{
  "originalPath": "/2026-Q1/Meetings/meeting.md",
  "deletedAt": "2026-04-01T10:30:00Z",
  "expiresAt": "2026-05-01T10:30:00Z",
  "fileName": "meeting.md",
  "fileSize": 2048
}
```

#### Pinned Files (localStorage)

```json
{
  "mindos-pinned-files": "[
    \"/Templates/meeting-template.md\",
    \"/Strategy/2026-Q1-goals.md\",
    \"/Processes/Team Standup Log.md\"
  ]"
}
```

### File Operations

- `moveToTrash(filePath: string)` → moves file to `.trash/`, creates metadata
- `restoreFromTrash(trashedPath: string)` → moves back to original path
- `emptyTrash()` → hard-delete all expired files
- `exportToHTML(filePath: string)` → converts MD → HTML
- `exportToZIP(spacePath: string)` → creates ZIP with directory structure
- `togglePin(filePath: string)` → add/remove from localStorage

### API Endpoints (New)

```
GET  /api/trash                    # List trash contents
POST /api/trash/restore/{id}       # Restore file from trash
POST /api/trash/empty              # Delete expired files
POST /api/trash/delete-forever/{id} # Permanently delete

GET  /api/file?op=export&path=...&format=html  # Export single file
GET  /api/file?op=export&path=...&format=zip   # Export space
```

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Delete recovery rate | 95% (users don't permanently lose files) |
| Export success rate | 98% (files download correctly) |
| Favorites usage | 80% of returning users pin ≥1 file |
| Page load impact | <50ms for Pinned section |
| Undo toast CTR | >40% (users take advantage of undo) |
| Trash page bounce rate | <30% (users find files easily) |

---

## Known Risks & Mitigations

| Risk | Severity | Mitigation |
|------|----------|-----------|
| Git sync conflicts with trash | Medium | Trash is local-only; not synced to git |
| File size explosion (trash fills disk) | Low | 30-day auto-purge; warn if >1GB |
| Export corrupts wiki-links | Medium | Unit test link conversion; preview in UI |
| Performance: Trash listing slow with 1000+ files | Medium | Virtual scroll (Virtuoso); lazy-load metadata |
| localStorage collision (pinned files) | Low | Use namespaced key; version string |

---

## Acceptance Criteria Checklist

Before shipping, verify all of:

- [ ] Trash: Files recoverable within 30 days, expired files auto-purge
- [ ] Trash: Undo toast working, 5-second timeout visible
- [ ] Trash: Conflict resolution (overwrite vs. save as copy)
- [ ] Export: Single files download as MD/HTML, UI shows progress
- [ ] Export: Space exports as ZIP, wiki-links converted
- [ ] Export: Performance tested with 100+ files
- [ ] Favorites: Pin/unpin works, persists across refreshes
- [ ] Favorites: Drag-to-reorder works, persists order
- [ ] Favorites: UI star icon consistent everywhere
- [ ] All: i18n strings for EN + ZH
- [ ] All: User walkthrough complete, no UX friction
- [ ] All: Tests passing (unit + integration)
- [ ] All: Backlog updated, retrospective in wiki

---

## Timeline Estimate

- **Favorites**: 2-3 days (no dependencies)
- **Trash**: 4-5 days (file ops, trash page, undo integration)
- **Export**: 5-6 days (format conversion, progress UI, link rewriting)
- **Total**: ~10-12 days for all three (parallel work possible on days 3-7)

