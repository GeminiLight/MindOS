# User Flow & UI Wireframes: Wiki/Space Homepage

## User Goal

用户点击 Activity Rail 上的 Wiki 按钮后，看到一个精美的左侧 panel，展示最近使用的空间、收件箱文件，快速导航到知识库各部分。

## 前置条件

- 用户已打开 MindOS 应用
- 至少有 1 个 Space 或 Inbox 文件
- Activity Rail 处于可见状态

---

## Step-by-Step User Flow

```
Step 1: 用户看到 Activity Rail，定位到 Wiki 按钮
  系统反馈：Brain icon 按钮位于 Files 按钮之下，tooltip 显示 "Wiki"
  状态变化：无

Step 2: 用户点击 Wiki 按钮
  系统反馈：
    - Button 变黄 (amber active state)
    - 左侧 Panel 从左边滑入 (transform duration-200)
    - Panel 宽 320px，内容开始加载
  状态变化：activePanel = 'wiki-home'，SidebarLayout 重新计算 padding

Step 3: Panel 内容加载（0-300ms）
  系统反馈：
    - Skeleton screens 显示占位符
    - 3 个区域的 skeleton 并行加载
  状态变化：
    - loading = true
    - fileTree 已有（SSR prop，零延迟）
    - 并行 fetch `/api/recent-files?limit=20` 和 `/api/inbox`

Step 4: 内容加载完毕（>300ms）
  系统反馈：
    - Skeleton 消失，内容平滑淡入 (fade-in)
    - Hero section 展示：Brain icon + "Wiki" 标题 + tagline
    - Spaces 列表按"最近更新时间"排序显示（最多 8 个，其余 toggle 展开）
    - Inbox section 显示最多 5 个最近文件
  状态变化：
    - loading = false
    - spaces = summarizeTopLevelSpaces(fileTree)
    - recentFiles = 从 API 获取
    - inboxFiles = 从 API 获取

Step 5: 用户点击某个 Space 卡片
  系统反馈：
    - Card 瞬间 hover 高亮 (border amber/30, shadow-sm)
    - 导航不中断，Panel 保持打开
    - 新页面加载中显示 loading spinner
  状态变化：
    - 导航到 `/view/<space-path>`
    - Panel 保持 activePanel = 'wiki-home'（用户可快速返回）

Step 6: 用户点击 Inbox 文件
  系统反馈：
    - File row 高亮，underline
    - 导航到 `/view/Inbox/<filename>`
  状态变化：同 Step 5

Step 7: 用户点击排序下拉菜单
  系统反馈：
    - Dropdown 展开，显示 3 个选项
    - 当前选项有 checkmark
    - 鼠标悬停选项时高亮
  状态变化：sortBy 状态改变，Spaces 列表立即重新排序（useMemo）

Step 8: 用户拖拽文件到 Panel
  系统反馈：
    - Panel 整体高亮 (amber 虚线边框闪现)
    - 或者完全由 SidebarLayout 全局 drag overlay 处理
  状态变化：
    - Inbox 文件列表自动刷新（30s poll 或事件驱动）

Step 9: 用户点击 UI 元素（返回、关闭等）再次点击 Wiki 按钮
  系统反馈：
    - Panel 从左边滑出 (transform -translate-x-full)
    - Button 回到非 active 状态
  状态变化：activePanel = null

异常分支：
┌─ 异常 A: 无空间存在 ────────────────────┐
│ 触发：fileTree 为空或无 top-level dir   │
│ 系统反馈：                              │
│   - Spaces section 显示空状态            │
│   - Brain icon + "No spaces yet"        │
│   - [ Create Space ] CTA 按钮           │
│ 修复：用户点击 CTA → 触发 create space  │
└───────────────────────────────────────────┘

┌─ 异常 B: Inbox 为空 ──────────────────┐
│ 触发：/api/inbox 返回空数组            │
│ 系统反馈：                             │
│   - Inbox section 显示空状态          │
│   - Inbox icon + "No files yet"      │
│   - [ Upload ] 按钮突出               │
│ 修复：用户上传或拖拽文件 → auto refresh│
└─────────────────────────────────────────┘

┌─ 异常 C: 网络失败 ────────────────────┐
│ 触发：/api/recent-files 或 /api/inbox  │
│         fetch 失败 (timeout / 500)     │
│ 系统反馈：                             │
│   - Toast error: "Failed to load files"│
│   - Skeleton 消失，显示错误占位         │
│   - 自动在 30s 后重试                 │
│ 修复：用户无需操作，或手动点击重试    │
└────────────────────────────────────────┘

边界场景：
1. 高频切换 Panel：user rapidly toggles Wiki on/off
   → 使用 debounce 或 abort 旧请求，确保最新的请求胜出
2. 空间名称超长：e.g. "这是一个非常非常长的空间名称用来测试超出Panel宽度的情况"
   → truncate + ellipsis + title attr 显示完整名字
3. Inbox 有 100+ 文件：
   → 默认显示 5 个 + "Show N more" toggle
4. 文件在 Panel 打开时被删除：
   → fileTree 自动刷新 → recentFiles 重新加载 → UI 自动更新
5. 移动端 (<768px)：
   → Panel 隐藏（复用现有 mobile 行为），MVP 不处理
```

---

## UI 状态线框图

### 状态 1：初始化 (Loading)

```
┌─ Left Panel ───────────────────────────┐
│ Activity Rail 宽 48px │Panel 宽 320px  │
├────────────────────────────────────────┤
│ ▮ [Brain] Wiki                         │ ← PanelHeader
├────────────────────────────────────────┤
│ ◌◌◌◌◌◌◌◌◌ Skeleton Screens             │
│                                        │
│ ┌─────────────────────────────────────┐│
│ │ ▯▯▯▯▯ (8px h, bg-muted)            ││ ← Space card skeleton
│ │ ▯▯▯▯▯▯ (6px h)                     ││
│ │ ▯▯▯▯ (4px h)                       ││
│ └─────────────────────────────────────┘│
│                                        │
│ ┌─────────────────────────────────────┐│
│ │ ▯▯▯▯▯ (Same pattern)                ││
│ │ ▯▯▯▯▯▯                              ││
│ │ ▯▯▯▯                                ││
│ └─────────────────────────────────────┘│
│                                        │
└────────────────────────────────────────┘
System Feedback: Panel 320px wide, skeletons 占位符
```

### 状态 2：内容加载完毕 (Ready)

```
┌─ Left Panel ───────────────────────────┐
│ Activity Rail │Panel (Brain icon active)│
├────────────────────────────────────────┤
│ ▮ [Brain] Wiki                         │ ← 黄色左边框 + active bg
├────────────────────────────────────────┤
│ 🧠 Wiki                                 │ ← Hero, PanelHeader
│ Your knowledge spaces, organized.      │   (optional tagline)
│                                        │
│ ▼ Your Spaces (3)         [By Recent▼] │ ← Title + count + sort
│                                        │
│ ┌──────────────────────────────────┐  │
│ │ 📚 Wiki                          │  │ ← Space card (full width)
│ │ Knowledge base docs              │  │
│ │ 12 files • 2 hours ago           │  │
│ └──────────────────────────────────┘  │
│                                        │
│ ┌──────────────────────────────────┐  │
│ │ 📊 Data                          │  │
│ │ Analysis & metrics               │  │
│ │ 8 files • 5 hours ago            │  │
│ └──────────────────────────────────┘  │
│                                        │
│ ┌──────────────────────────────────┐  │
│ │ 🎯 Projects                      │  │
│ │ Active projects                  │  │
│ │ 5 files • 1 day ago              │  │
│ └──────────────────────────────────┘  │
│                                        │
│ [+ View all] (if >8)                  │
│                                        │
│ ▼ Inbox (7)                            │ ← Section title + count
│ ┌──────────────────────────────────┐  │
│ │ ● 📄 notes.md     2 mins ago     │  │ ← File row
│ └──────────────────────────────────┘  │
│ ┌──────────────────────────────────┐  │
│ │ ● 📊 data.csv     1 hour ago     │  │
│ └──────────────────────────────────┘  │
│ ┌──────────────────────────────────┐  │
│ │ ⚠ 📄 old_note.md  8 days ago     │  │ ← Aging indicator (amber)
│ └──────────────────────────────────┘  │
│ [+ Show 4 more]                       │
│                                        │
└────────────────────────────────────────┘
User can now:
- Click Space card → /view/<space>
- Click File row → /view/Inbox/<file>
- Click sort dropdown → reorder spaces
- Click [+ View all] → expand spaces list
```

### 状态 3：空状态 (No Spaces)

```
┌─ Left Panel ───────────────────────────┐
│ ▮ [Brain] Wiki                         │
├────────────────────────────────────────┤
│ 🧠 Wiki                                 │
│                                        │
│ ▼ Your Spaces (0)                      │
│                                        │
│ ┌──────────────────────────────────┐  │
│ │                                  │  │
│ │     [🧠] (Brain icon, large)    │  │
│ │   No spaces yet                  │  │
│ │   Create your first space        │  │
│ │   to organize your knowledge     │  │
│ │                                  │  │
│ │  [ + Create Space ]              │  │ ← CTA button, amber
│ │                                  │  │
│ └──────────────────────────────────┘  │
│                                        │
│ ▼ Inbox (2)                            │
│ ┌──────────────────────────────────┐  │
│ │ ● 📄 file1.md                   │  │
│ └──────────────────────────────────┘  │
│                                        │
└────────────────────────────────────────┘
Empty state for spaces: dashed border, centered icon + text + CTA
```

### 状态 4：错误状态 (Network Failed)

```
┌─ Left Panel ───────────────────────────┐
│ ▮ [Brain] Wiki                         │
├────────────────────────────────────────┤
│ 🧠 Wiki                                 │
│                                        │
│ ▼ Your Spaces                          │
│                                        │
│ ┌──────────────────────────────────┐  │
│ │  ✕ Failed to load spaces          │  │ ← Error message (red icon)
│ │  Network error. Retrying...      │  │
│ │  Next retry in 25s               │  │
│ └──────────────────────────────────┘  │
│                                        │
│ ▼ Inbox                                │
│ ┌──────────────────────────────────┐  │
│ │  ✕ Failed to load inbox          │  │
│ │  Please try again                │  │
│ │         [ Retry ]                │  │
│ └──────────────────────────────────┘  │
│                                        │
└────────────────────────────────────────┘
Error states: Red error icon + message + auto-retry logic
```

### 状态 5：排序下拉 (Sorting)

```
┌─ Left Panel ───────────────────────────┐
│ ...                                    │
│ ▼ Your Spaces (12)     [By Recent▼]   │ ← Dropdown open
│                        ┌───────────────┤
│                        │ ✓ By Recent   │ ← Selected, checkmark
│                        │   A-Z         │ ← Unselected
│                        │   File Count  │ ← Unselected
│                        └───────────────┤
│ ┌──────────────────────────────────┐  │
│ │ 📚 Wiki (updated now)            │  │ ← Spaces reordered
│ └──────────────────────────────────┘  │
│                                        │
└────────────────────────────────────────┘
Dropdown appears on click, selects sort, spaces re-sorted in real-time
```

### 状态 6：缓存过期重新加载 (Refresh)

```
按 Space card 或 Inbox file 上的"刷新"或事件触发：
- mindos:files-changed → Panel 观察并重新 fetch recent-files + inbox
- fileTree 从 SidebarLayout SSR 自动更新（3s 版本轮询）
- UI 平滑刷新（无抖动）

不会显示 skeleton，而是后台静默更新，用户无感知
```

---

## 状态流转图

```
                            [Wiki Button]
                                 ↓ click
                            [Panel Opens]
                                 ↓
                         [Loading State]
                              ↙     ↘
                    (Success)         (Error)
                         ↓               ↓
                  [Show Content]    [Error Message]
                         ↓               ↓ [Retry]
                         ↓         ←───┘
         ┌────────────────────────────┐
         │ Spaces | Inbox | Sort Ctrl │
         └────────────────────────────┘
              ↓ click Space/File
         [Navigate + Keep Panel Open]
              ↓
         [fileTree update]
         [Recent files refresh]
              ↓
         [Content re-renders]
              
         User 再次点击 Wiki Button
              ↓ click
         [Panel Closes]
```

---

## 验证检查清单（对照 Nielsen 十条启发法）

| # | Nielsen 启发法 | 检查项 | 验证标准 |
|----|---------------|--------|---------|
| 1 | 系统状态可见 | Panel 打开后立即显示什么？ | ✅ Skeleton 或内容，无空白 |
| 2 | 匹配现实世界 | "Spaces"、"Inbox" 术语用户理解吗？ | ✅ 与 HomeContent、Files 术语一致 |
| 3 | 用户控制 | 用户能轻易关闭 Panel 吗？ | ✅ 点 Wiki 按钮或 Esc 即可 |
| 4 | 一致性 & 标准 | Space card 和其他地方的卡片风格一致吗？ | ✅ 对齐 HomeContent.tsx 的卡片样式 |
| 5 | 错误预防 | 有边界情况处理吗？ | ✅ 空状态、超长名称、网络错误 |
| 6 | 识别而非回忆 | 用户需要记住什么吗？ | ✅ 所有操作直觉化，无需 help |
| 7 | 灵活效率 | 有快捷操作吗？ | ✅ 快捷键 / 排序下拉 / 拖拽 Inbox |
| 8 | 极简设计 | 每个元素都必要吗？ | ✅ 移除冗余，保留只有核心信息 |
| 9 | 错误恢复 | 错误后能恢复吗？ | ✅ 自动重试 / 重试按钮 |
| 10 | 帮助文档 | 有上下文引导吗？ | ✅ 空状态 CTA 清晰 |

---

## Design System 合规性检查

| 项 | 要求 | 实现 |
|---|------|------|
| 色彩 | 仅用 CSS 变量 | `var(--amber)`, `var(--background)` 等 |
| 间距 | 4/8/16/24/32/48/64 scale | mb-8, gap-2, px-3.5 py-3 等 |
| 字体 | font-display, font-sans, font-mono | 标题用 font-display, 正文 font-sans |
| Focus ring | focus-visible:ring | `focus-visible:ring-1 focus-visible:ring-ring` |
| Skeleton | animate-pulse | 加载状态用 skeleton 骨架屏 |
| Z-index | 查表 (10/20/30/40/50) | Panel z-30, Dropdown z-50 |

---

## 下一步

这个 User Flow 和线框图是**实现的锚点**。所有代码必须对照这个流程验证：
- ✅ 每个 step 的系统反馈是否都实现了？
- ✅ 所有异常分支是否都处理了？
- ✅ 所有状态线框图是否都渲染正确？
- ✅ 设计系统是否完全遵循？

进入 Phase 2 时，我会列出 2-3 个实现方案并对比线框图选择最佳 UX 的方案。
