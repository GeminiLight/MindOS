# Wiki 更新指南 (2026-03-26)

基于代码和架构的最新变化，以下是各 wiki 文档需要更新的内容：

---

## 1. 系统架构文档 (20-system-architecture.md)

### 新增/更新内容：

#### Activity Bar + Panel 布局
- 类 VS Code 的侧边导航栏设计
- Activity Bar 按钮: 🏠首页、🔄回响、🔍搜索、🔌插件、🤖智能体、✨探索、?帮助、⚙️设置
- 可切换 Panel 宽度支持拖拽 (200-400px)

#### Echo 回响系统
- 5种回响类型: with-you, history, unfinished, related, growth
- 路由: /echo/[segment]
- 智能洞察流程

#### Search Index 优化
- 内存倒排索引
- 懒加载 + 增量更新
- 双搜索策略 (后端字面量/前端Fuse.js)

#### Agents 子系统
- Agent 发现机制
- 详情页: Overview/MCP/Skills/Usage

#### Changes 变更追踪
- 变更类型: Added/Modified/Deleted/Renamed
- 行级 diff 对比

---

## 2. 技术支柱文档 (03-technical-pillars.md)

添加"已实现架构组件"章节：
- ✅ Activity Bar + Panel 布局
- ✅ Echo 回响系统
- ✅ Agents 智能体管理
- ✅ Search Index (倒排索引)
- ✅ Changes 变更追踪
- ✅ 多空间支持

更新竞品对比表，添加新行。

---

## 3. 页面设计文档 (22-page-design.md)

确认 Activity Bar 布局，添加：
- Echo 页面设计 (/echo/[segment])
- Changes 页面设计 (/changes)
- Agents 详情页设计 (/agents/[agentKey])

---

## 4. Mind Spaces 文档 (23-mind-spaces.md)

更新多空间目录结构：
```
~/MindOS/
├── spaces/
│   ├── personal/
│   │   ├── wiki/
│   │   ├── skills/
│   │   └── agents/
│   └── work/
└── templates/
```

---

## 5. Plugins 文档 (60-stage-plugins.md)

更新渲染器列表，添加 AgentInspector 等。

---

## 6. 新增文档建议

- 23-echo-system.md - Echo 系统详细说明
- 24-agents-system.md - Agents 系统详细说明

---

## 代码参考

| 功能 | 核心路径 |
|------|----------|
| Activity Bar | components/ActivityBar.tsx |
| Panel | components/panels/*.tsx |
| Echo | app/echo/, components/echo/ |
| Agents | app/agents/, lib/mcp-agents.ts |
| Search Index | lib/core/search-index.ts |
| Changes | app/changes/, lib/core/content-changes.ts |
