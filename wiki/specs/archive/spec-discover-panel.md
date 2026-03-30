# Spec: 探索面板 (Discover Panel)

## 目标

在 Activity Bar 的 Agents 图标下方新增 "Discover / 探索" 入口，将现有 `/explore` 页面的使用案例提升为 Rail 面板，并预留插件市场和技能市场的占位区域，让用户从侧边栏即可发现 MindOS 的能力，而非依赖隐藏的 `/explore` 路由。

## 现状分析

- `/explore` 页面已有 9 个使用案例（C1-C9）+ 分类筛选，但入口隐藏在 URL，用户不易发现
- Activity Bar 当前有 4 个面板按钮（Files/Search/Plugins/Agents），Discover 是第 5 个
- 面板体系成熟（PanelId type → ActivityBar toggle → Panel container → 子组件），扩展模式清晰
- 插件市场 / 技能市场目前无实际后端，此次只做 UI 占位

## 数据流 / 状态流

```
ActivityBar
  │
  ├─ RailButton "Discover" (Compass icon)
  │   └─ onClick → toggle('discover')
  │
  ├─ PanelId type 新增 'discover'
  │
  └─ Panel.tsx
      └─ children (SidebarLayout 注入)
          └─ DiscoverPanel
              ├─ PanelHeader "Discover"
              ├─ 3 个 Section（可折叠）：
              │   ├─ 🎯 Use Cases — 复用 use-cases.ts 数据 + 简化卡片
              │   ├─ 🧩 Plugin Market — 占位，Coming soon
              │   └─ ⚡ Skill Market — 占位，Coming soon
              └─ 底部：View all → Link to /explore
```

无新增 API。Use Cases 数据来自 `use-cases.ts`（纯静态）+ i18n。

## 方案

### 1. 扩展 PanelId

`ActivityBar.tsx` 的 `PanelId` type 新增 `'discover'`。

### 2. ActivityBar 新增按钮

在 Agents 按钮下方加 Discover，使用 `Compass` 图标（lucide）。

### 3. Panel.tsx 新增默认宽度

`DEFAULT_PANEL_WIDTH.discover = 280`。

### 4. 新建 DiscoverPanel 组件

`app/components/panels/DiscoverPanel.tsx`：

- 复用 `PanelHeader`
- 三个可折叠 Section（使用简单的 disclosure pattern）：
  1. **Use Cases**：展示 use-cases.ts 中 9 个案例的 emoji + title，点击触发 Ask AI（复用 `UseCaseCard` 的打开逻辑 — dispatch `mindos:open-ask` 事件）
  2. **Plugin Market**：Coming soon 占位
  3. **Skill Market**：Coming soon 占位
- 底部 "View all use cases" 链接到 `/explore`

### 5. SidebarLayout 注入 DiscoverPanel

与 SearchPanel/PluginsPanel/AgentsPanel 同模式。

### 6. i18n

新增 `sidebar.discover` + `panels.discover.*` 的 en/zh key。

### 不做什么

| 排除项 | 原因 |
|--------|------|
| 插件市场实际功能 | 无后端，此次只做 UI 占位 |
| 技能市场实际功能 | 同上 |
| 删除 `/explore` 路由 | 保留作为全屏详细视图 |
| 移动端 Rail 适配 | 移动端用 drawer，不影响 |

## 影响范围

### 新增

| 文件 | 说明 |
|------|------|
| `app/components/panels/DiscoverPanel.tsx` | Discover 面板主组件 |

### 修改

| 文件 | 改动 |
|------|------|
| `app/components/ActivityBar.tsx` | PanelId 加 `'discover'` + 新 RailButton |
| `app/components/Panel.tsx` | DEFAULT_PANEL_WIDTH 加 discover |
| `app/components/SidebarLayout.tsx` | import + 注入 DiscoverPanel |
| `app/lib/i18n-en.ts` | 新增 sidebar.discover + panels.discover.* |
| `app/lib/i18n-zh.ts` | 同上中文版 |

### 不改动

| 文件 | 原因 |
|------|------|
| `useLeftPanel.ts` | PanelId type 从 ActivityBar import，自动跟随 |
| `explore/` 目录 | 保留原样，Discover 面板复用数据但不修改 |

## 边界 case 与风险

| # | 场景 | 处理 |
|---|------|------|
| 1 | Rail 按钮数变多，挤压空间 | 5 个按钮（高度 5×40=200px）+ logo ~44px + dividers ~24px ≈ 268px，桌面端最小高度 768px 足够 |
| 2 | Use Case 点击触发 Ask AI 时面板是否关闭 | 不关闭面板，Ask AI 在右侧打开，左右并行 |
| 3 | i18n key 拼写错误导致运行时 undefined | TypeScript 编译时检测（`as const` 约束） |
| 4 | DEFAULT_PANEL_WIDTH 缺 discover 导致 undefined | Panel.tsx 有 fallback `?? 280` |

### 风险

| 风险 | 等级 | 缓解 |
|------|------|------|
| 面板内容少，显得空 | 低 | Use Cases 有 9 个卡片 + 2 个 Coming Soon section，内容够用 |
| Coming soon 占位久了用户失望 | 低 | 文案说明"即将推出"，不做承诺时间 |

## 验收标准

- [ ] Activity Bar 在 Agents 下方出现 Discover 按钮（Compass 图标）
- [ ] 点击 Discover → 左侧面板展开，显示 PanelHeader "Discover"
- [ ] Use Cases section 显示 9 个案例（emoji + title）
- [ ] 点击 Use Case → 右侧 Ask AI 面板打开，填入对应 prompt
- [ ] Plugin Market / Skill Market section 显示 Coming soon
- [ ] 底部 "View all" 链接跳转 `/explore`
- [ ] i18n en/zh 正常
- [ ] 再次点击 Discover Rail 按钮 → 面板关闭（toggle 行为）
- [ ] 面板支持 resize + maximize
