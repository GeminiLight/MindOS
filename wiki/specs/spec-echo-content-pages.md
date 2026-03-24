# Spec: 回响内容页（Echo Content Pages）

> **视觉与交互精修**（hero、卡片节奏、侧栏琥珀条）：见 [`spec-echo-visual-polish.md`](./spec-echo-visual-polish.md)。

## 目标
将回响五个模块从侧栏 **占位列表** 演进为：**每一项可进入独立内容页**；页内提供 **结构化信息 + 轻量分析 + 可选 AI 能力**，仍保持 **内向、本地优先、与 Ask 主对话分流**。用户获得的是「与自己有关的深度工作面」，而非第二个文件树或第二聊天窗。

## 现状分析
- 当前 `EchoPanel` 仅展示五行标题 + hint +「随后到来」，无路由、无主内容区承载。
- `view/[...path]` 面向单文件编辑；首页面向聚合与 Guide；**缺少专属于 Echo 的 full-width 阅读/反思面**。
- 若在侧栏内嵌长内容，会与 Panel 宽度（~280px）和「可切换面板」模型冲突，且不利于分析块、时间轴、卡片式 AI 输出展示。

## 数据流 / 状态流

```
用户点击 EchoPanel 某行（或访问 /echo）
    → Next.js 导航到 /echo/<segment>（/echo 可重定向到默认 segment）
    → 主内容区渲染 EchoLayout（与现有 Main 同壳：顶栏/面包屑「回响 › 子模块」）
    → 各 segment 页面：
        ├─ 读：文件树 API / mtime / TODO 解析 / ~/.mindos config / 可选 git log
        ├─ 写：意图句、每日一句、snooze、dismiss、偏好（localStorage 或已有 /api/setup 扩展）
        └─ 可选 AI：页内「分析块」显式触发 → 复用 /api/ask 流式或专用短请求；上下文 = 本页可见摘录；不默认持久化到云端

侧栏 EchoPanel（实现演进）：
    - 每行 = Link → /echo/<segment>；pathname 匹配时行样式为选中（amber + 左侧条，与 Rail 一致）
    - 「随后到来」徽章：可在 **整页无 P1 数据** 时保留于侧栏；P1 就绪后改为 **数字角标**（如未完条数）或移除徽章
```

**缓存与一致性：** 内容页以 **客户端拉取 + 短 revalidate** 为主；与首页「最近编辑」共享底层列表时，**同一数据源、不同呈现**（回响页必须带「因何相关」解释层，禁止纯 mtime 复制）。

---

## Review 纪要（对上一版 spec 的修订）

| 项 | 处理 |
|----|------|
| **路由真值表** | 补充合法 `segment` 枚举；非法 segment → 404 或重定向 `/echo/about-you`。 |
| **默认入口** | 与 `spec-echo-panel` 一致：`/echo` → **302/替换到 `/echo/about-you`**（或 `next.config` redirect）。 |
| **实现路径** | 本仓库 Next 应用位于 `app/app/`，新页面为 `app/app/echo/[segment]/page.tsx`（及可选 `layout.tsx`）。 |
| **区块顺序矛盾** | 统一为每页内：**事实层 → 分析层（可折）→ 行动层**；全局 AI 块置于事实层**之后**，避免首屏空洞。 |
| **侧栏验收** | `spec-echo-panel` 中「仅即将推出、无外链」将随本 spec 落地而更新：**允许**链到 `/echo/*`，仍禁止链 `/`、`/explore` 作主导流。 |
| **移动入口** | Echo 深链在窄屏需可达（Header 菜单或 Drawer 内重复五行链接）；列为 P1 与内容页同步验收。 |

---

## 路由与 segment 约定

| `segment` | 模块 | 备注 |
|-----------|------|------|
| `about-you` | 与你有关 | 默认落地页 |
| `continued` | 未完待续 | |
| `daily` | 每日回响 | |
| `past-you` | 历史的你 | URL 用 kebab-case |
| `growth` | 心向生长 | |

- **校验**：`page.tsx` 内对 `params.segment` 做白名单校验；否则 `notFound()`。
- **i18n key 建议**：`echoPages.<segment>.title` / `subtitle` / `empty` / `ai.*`，与 `panels.echo` 侧栏文案区分。

---

## 全局 UI 壳（所有 Echo 页共用）

### 布局（ASCII）

```
┌─────────────────────────────────────────────────────────────┐
│ App chrome（现有顶栏 / 移动端 Header）                        │
├──────────┬──────────────────────────────────────────────────┤
│ Rail+Panel│  <main> EchoLayout                               │
│ （可选开）│  ┌────────────────────────────────────────────┐   │
│          │  │ 面包屑：回响 › {子模块}     [可选：深入 Ask]   │   │
│          │  ├────────────────────────────────────────────┤   │
│          │  │ A. 页眉区：h1 标题 + 一行副标（muted）        │   │
│          │  ├────────────────────────────────────────────┤   │
│          │  │ B. 事实层（卡片/列表/表单）                   │   │
│          │  ├────────────────────────────────────────────┤   │
│          │  │ C. 分析层 EchoInsight（折叠 panel，可选）    │   │
│          │  ├────────────────────────────────────────────┤   │
│          │  │ D. 行动层：主按钮（打开选中文档等）            │   │
│          │  └────────────────────────────────────────────┘   │
└──────────┴──────────────────────────────────────────────────┘
```

### 设计系统（`21-design-principle`）

- 背景与正文与 `ViewPage` 阅读区一致；强调色 **amber** 仅用于选中、主按钮、链接 hover。
- 卡片：`rounded-lg border border-border bg-card`；间距用既有 `px-4` / `gap-3` 节奏。
- **禁止** Echo 专用新 hex；分析块引用 `muted`、`border`、`text-success`/`text-error` 表示状态。

### 共用组件（建议命名）

| 组件 | 职责 |
|------|------|
| `EchoLayout` | `children` + 面包屑 + optional right action |
| `EchoPageHeader` | `title` / `subtitle` |
| `EchoClueCard` | 路径、标题、相对时间、一行「因何相关」、点击进入 `view` |
| `EchoInsightPanel` | 折叠、上下文摘要列表、「生成见解」、流式/加载/错误/空 |
| `EchoEmptyState` | 插画可选无；一句标题 + 一句说明 + 可选主按钮 |

### 状态（每页）

- **loading**：事实层 skeleton（3 条卡片占位），不闪整块白屏。
- **empty**：`EchoEmptyState`，不调用 AI。
- **error**：一行 `text-error` + 重试；分析块失败 **不**拖垮事实层。

---

## 分页面：功能 + UI 细节

以下每页均满足：**无 AI 也可完整使用**；AI 为 **C 区 EchoInsightPanel**。

---

### 1. `/echo/about-you` 与你有关

**JTBD：** 几秒内看到「此刻库里哪些在碰我」。

| 区域 | UI | 功能 |
|------|-----|------|
| B 事实 | 纵向 **3～5 张 `EchoClueCard`** | 每条：显示名（文件名或 frontmatter title）、相对 mtime、**灰色小字原因**（规则：路径含关键词 / 链向「关于我」笔记 / 用户配置词表命中） |
| B 空态 | 无命中时 | 「还没有明显指向你的线索」+ 说明可去设置配置关键词（若未做设置入口则仅文案） |
| C 分析 | 折叠；默认 **收起** | 按钮「基于上列生成一句总结」；上下文 = **仅卡片标题+路径**（不含全文）；流式一段 ≤ ~200 字；失败则展示规则生成的 **一句** static 总结 |
| D 行动 | 卡片点击即 `router.push(/view/...)` | 无批量删除 |

**数据（P1）：** 客户端拉 file tree + 最近修改列表 → 客户端过滤（关键词可存 `localStorage` key `echo-about-you-keywords` 逗号分隔，后续可迁 config）。

**刻意不做：** 全库向量检索；侧栏宽度展示全文。

---

### 2. `/echo/continued` 未完待续

**JTBD：** 草稿与开放回路一眼可续。

| 区域 | UI | 功能 |
|------|-----|------|
| B 事实 | **Accordion 三组**：草稿 / TODO 开放项 / 其他（可选） | 每组最多 **展开显示 5 条**，超出「还有 n 项」文字即可 |
| 行内容 | 单行：`Radio` 无；用 **左图标 + 标题 + 相对时间** | 主点击：打开 `view`；次操作：**「稍后」** → localStorage snooze id + 日期 |
| B 空态 | 「没有待续写的条目」 | |
| C 分析 | 可选 | 「这些未完项有什么共同点？」上下文仅 **标题列表**；默认 P2 |
| D 行动 | 顶部可选「全部展开/收起」 | |

**数据（P1）：** 草稿：`Untitled`、含 `draft` 路径约定或 frontmatter；TODO：解析 `TODO.md` 或 registry（与现有 Todo 能力对齐若已有）。

---

### 3. `/echo/daily` 每日回响

**JTBD：** 今天一行留白，轻到不必开聊天。

| 区域 | UI | 功能 |
|------|-----|------|
| B 事实 | **大卡片**：日期（locale）+ **今日提示语**（Markdown 一行或短段，来自模板数组轮换） | 按钮「换一句」→ 下一模板（本地 seed 可存当日避免刷新变） |
| B 输入 | 下方 **`<textarea>` 三行内** | 占位「今日一句」；`localStorage` key `echo-daily-line-YYYY-MM-DD` 或追加到日记文件（P2） |
| B 历史 | `<details>` **过去 7 天**一行列表（仅本地有存时显示） | |
| C 分析 | 可选 P2 | 「把今日一句和昨天联系起来」需用户勾选「纳入昨日」；显式同意 |
| D 行动 | 主按钮「用 Agent 深聊（带今日上下文）」 | `openAskModal(prefill)` **单次**，不嵌对话 |

**刻意不做：** streak 火焰图标；推送通知。

---

### 4. `/echo/past-you` 历史的你

**JTBD：** 叙事性一瞥旧我，非 diff 工具。

| 区域 | UI | 功能 |
|------|-----|------|
| B 事实 | **一张主卡**：大日期标签 + **来源**（如「约一年前的今天附近」） | 展示 **标题 + 2～3 行纯文本预览**（由客户端读文件头或 API 返回 excerpt） |
| D 行动 | 「打开全文」「再看一条」 | 再看一条：同一算法重新抽样（本地 mtime 伪随机） |
| B 空态 | 「没有找到可展示的往日笔记」 | |
| C 分析 | 可选 | 「这段话里的你在关心什么？」上下文仅 excerpt；默认折叠 |

**数据（P2）：** mtime 窗口查询；注意性能 **单次扫描预算** 或后台索引。

---

### 5. `/echo/growth` 心向生长

**JTBD：** 当前在乎的方向与缓慢变化（元层）。

| 区域 | UI | 功能 |
|------|-----|------|
| B 事实 | **意图句**：大号 `textarea` 或 `contenteditable` 区块 | debounce 保存 `localStorage` `echo-growth-intent`（P1）；后续 `/api/setup` 字段（P2） |
| B 自评 | **可选** 本周 1～5 **单选**或滑条（仅 UI 占位可 P2） | 写入本地时间序列数组 |
| D 行动 | 次要文字按钮「清除回响数据」（仅本模块 keys）+ 二次确认 | **侧栏 hint 不写「只存本机」**；说明放本页底部辅助文案 |
| C 分析 | 可选 | 「这句话里能读出哪些主题？」全文仅意图句；用户显式触发 |

---

## AI 块统一规范（EchoInsightPanel）

1. **触发前**：展示 bullet 列表「将参考：file1.md 标题、…」最多 5 条；勾选框剔除某条（可选 P2）。
2. **按钮文案**：中文「生成见解」/ 英文 "Generate insight"（与 Ask 的「聊天」区分）。
3. **结果**：单条流式文本 + 「复制」+「带入 Ask 继续」；**无**多轮历史在 Echo 页内。
4. **失败**：`text-muted` 提示 + 「重试」；不抛未捕获错误。
5. **模型**：走用户 Settings 已配 provider；未配置时按钮 **disabled** + tooltip「请先在设置中配置 AI」。

---

## 品味：刻意不做

- 不做 Echo 内第二套全局聊天。
- 不做 streak / 排行榜 / 生产力分数。
- 不默认全文库送模型；默认按需、可勾选、可预览上下文。
- 不把五模块合并为单一无限信息流。

---

## 与人-AI 分工（摘要）

| 人类 | 系统/AI |
|------|---------|
| 写意图句、每日一句、是否点生成 | 聚合、排序、规则理由 |
| 勾选上下文、关闭 AI | 短见解、失败降级 |
| 清除本模块数据 | 缓存失效 |

---

## 影响范围

| 类别 | 路径/说明 |
|------|-----------|
| 新建 | `app/app/echo/layout.tsx`（可选）、`app/app/echo/[segment]/page.tsx`、`components/echo/*` |
| 修改 | `EchoPanel.tsx`（Link + active）、`SidebarLayout` 或全局 layout（面包屑）、`i18n` |
| API | 优先复用现有；必要时 `/api/echo/excerpt` 等 |
| 文档 | 本 spec；`22-page-design`；更新 `spec-echo-panel` 验收（侧栏可链 `/echo/*`） |

---

## 边界 case 与风险

1. 空库 / 每页独立空态；不强行 AI。  
2. 移动：Echo 入口与深链可达性。  
3. 路径均在 mind root 内；AI 上下文不越权。  
4. 性能：列表 Top N、抽样预算、禁止首屏全量递归。  

---

## 验收标准

- [x] 五 segment 路由可访问；非法 segment → 404。  
- [x] `/echo` 重定向到 `/echo/about-you`（或与产品最终选择一致并文档化）。  
- [x] `EchoPanel` 五行链到对应 URL；当前路径匹配时行选中态正确。  
- [x] 每页含 **B 事实层** 可独立使用；C 分析层可不存在或折叠。  
- [ ] AI（若上）：显式触发、上下文摘要、失败降级、无页内多轮会话。  
- [x] i18n：页标题与关键按钮 en/zh；`main` landmark、`h1` 唯一（内容在 `SidebarLayout` 的 `#main-content` 内，每页单一 `h1`）。  
- [x] `npm test` 通过；segment 白名单与 redirect 有单测。  

---

## 实现阶段（给排期用）

| 阶段 | 交付 |
|------|------|
| **P0** | 路由壳 + `EchoLayout` + 五页占位（仅标题+空态）+ 侧栏 Link + redirect |
| **P1** | about-you 规则列表 + continued 草稿/TODO 最小集 + daily 模板卡 + localStorage 意图句 |
| **P2** | past-you 抽样 + growth 自评 + EchoInsightPanel 接 /api/ask |
| **P3** | 性能索引、设置页关键词、导出清除、移动入口 polish |

---

## 与 `spec-echo-panel.md` 的关系

- **spec-echo-panel**：Rail、侧栏五行命名、不做 Guide/Discover/首页导流、默认首屏与排序假设。  
- **本 spec**：内容页 **具体 UI 分区、数据与 AI 行为、路由与分阶段交付**。  
