<!-- Last updated: 2026-03-26 -->

# Wiki 更新摘要 (2026-03-26)

本文档汇总了 MindOS 代码和架构的最新变化，需要同步更新到各个 wiki 文档中。

---

## 🏗️ 架构变化总览

### 1. Activity Bar + Panel 布局重构 (P0 - 已完成)

**变化描述：**
从传统 Sidebar 布局改为类似 VS Code 的 Activity Bar + 可切换 Panel 布局。

**代码位置：**
- `components/ActivityBar.tsx` - 左侧 48px 导航栏
- `components/Panel.tsx` - 可切换面板容器
- `components/SidebarLayout.tsx` - 主布局

**Activity Bar 按钮顺序（上 → 下）：**
| 图标 | 功能 | Panel 内容 |
|------|------|------------|
| 🏠 | 首页/空间 | 空间列表 + 文件树 |
| 🔄 | 回响 (Echo) | EchoPanel - 与你有关/未完待续等 |
| 🔍 | 搜索 | SearchPanel - 全文搜索 |
| 🔌 | 插件 | PluginsPanel - 插件管理 |
| 🤖 | 智能体 | AgentsPanel - Agent 管理 |
| ✨ | 探索 | DiscoverPanel - 使用案例 |
| ? | 帮助 | 跳转到帮助页面 |
| ⚙️ | 设置 | 跳转到设置 |

**待更新文档：**
- `22-page-design.md` - 已有 Activity Bar 布局描述，需同步更新
- `20-system-architecture.md` - 添加 Activity Bar + Panel 架构说明

---

### 2. Echo 回响系统 (新增)

**变化描述：**
新增智能洞察系统，通过分析用户与知识库的交互生成个性化内容。

**代码位置：**
- `app/echo/[segment]/page.tsx` - 回响内容页路由
- `components/echo/*.tsx` - Echo 相关组件
- `lib/echo-segments.ts` - Echo 类型定义
- `lib/echo-insight-prompt.ts` - 洞察生成 Prompt

**回响类型：**
| Segment | 路由 | 描述 |
|---------|------|------|
| `with-you` | `/echo/with-you` | 与你有关 - 基于用户活动 |
| `history` | `/echo/history` | 历史的你 - 行为模式分析 |
| `unfinished` | `/echo/unfinished` | 未完待续 - 追踪未完成事项 |
| `related` | `/echo/related` | 相关推荐 - 内容关联 |
| `growth` | `/echo/growth` | 心向生长 - 学习建议 |

**待更新文档：**
- `22-page-design.md` - 已有 Echo 页面设计，需补充完整
- 新增 `23-echo-system.md` - 详细的 Echo 系统说明

---

### 3. Agents 智能体管理 (重大更新)

**变化描述：**
从简单的 MCP Server 概念升级为完整的 Agent 管理系统，支持多异构 Agent 的发现、配置和监控。

**代码位置：**
- `app/agents/` - Agent 页面路由
- `components/agents/*.tsx` - Agent 相关组件
- `components/panels/AgentsPanel*.tsx` - Agents Panel
- `lib/mcp-agents.ts` - Agent 管理逻辑

**Agent 详情页结构：**
- **Overview** - 基本信息、状态、启动/停止
- **MCP** - 工具配置、权限管理
- **Skills** - 启用/禁用技能、配置注入
- **Usage** - 使用统计、审计日志

**Agent 发现机制：**
1. 扫描系统已安装的 Agent (Claude Code, Cursor, etc.)
2. 读取知识库中的 Agent 配置
3. 支持通过 URL 或本地路径安装新 Agent

**待更新文档：**
- `20-system-architecture.md` - 添加 Agents 子系统详细说明
- 新增或更新 Agents 专门文档

---

### 4. Search Index 优化

**变化描述：**
实现了内存倒排索引，大幅提升搜索性能，支持增量更新。

**代码位置：**
- `lib/core/search-index.ts` - 倒排索引实现
- `lib/core/search.ts` - 搜索 API

**核心特性：**
- **懒加载：** 首次搜索时构建索引
- **增量更新：** 文件修改时仅更新变更部分
- **候选裁剪：** 先通过索引过滤候选文件
- **双搜索策略：**
  - 后端：字面量搜索 (MCP 使用)
  - 前端：Fuse.js 模糊搜索 (⌘K 使用)

**索引失效触发：**
```typescript
// 文件写入操作时自动触发
export function invalidateSearchIndex(): void {
  searchIndex.invalidate();
}
```

**待更新文档：**
- `20-system-architecture.md` - 添加 Search Index 架构说明

---

### 5. Changes 变更追踪 (新增)

**变化描述：**
新增文件变更追踪系统，实时记录文件改动，支持变更审查。

**代码位置：**
- `app/changes/page.tsx` - 变更页面
- `components/changes/*.tsx` - 变更组件
- `lib/core/content-changes.ts` - 变更追踪逻辑

**变更类型：**
| 类型 | 图标 | 描述 |
|------|------|------|
| Added | ➕ | 新增文件 |
| Modified | ✏️ | 修改内容 |
| Deleted | 🗑️ | 删除文件 |
| Renamed | ➡️ | 重命名 |

**待更新文档：**
- `20-system-architecture.md` - 添加 Changes 子系统

---

### 6. 多空间支持 (Space)

**变化描述：**
支持多知识库空间隔离，每个 Space 独立管理文件和配置。

**代码位置：**
- `lib/core/create-space.ts` - 创建 Space
- `lib/core/list-spaces.ts` - 列出 Spaces
- `components/CreateSpaceModal.tsx` - 创建空间对话框

**Space 目录结构：**
```
~/MindOS/
├── spaces/
│   ├── personal/
│   │   ├── wiki/
│   │   ├── skills/
│   │   └── agents/
│   └── work/
│       ├── wiki/
│       ├── skills/
│       └── agents/
└── templates/
```

**待更新文档：**
- `23-mind-spaces.md` - 更新多空间说明

---

### 7. Renderers 系统完善

**变化描述：**
渲染器系统从概念实现为完整的可插拔架构。

**代码位置：**
- `components/renderers/*/manifest.ts` - 渲染器清单
- `lib/renderers/registry.ts` - 注册表

**渲染器列表：**
| 渲染器 | 匹配规则 | 功能 |
|--------|----------|------|
| TodoRenderer | `TODO.md` | 交互式待办 |
| GraphRenderer | 任意 `.md` (opt-in) | 知识图谱 |
| CsvRenderer | `*.csv` | 三视图 (表/看板/画廊) |
| TimelineRenderer | `CHANGELOG.md` | 时间线 |
| WorkflowRenderer | `Workflows/**/*.md` | 工作流编排 |
| ConfigRenderer | 配置项 | 配置面板 |
| BacklinksRenderer | 自动 | 反向链接 |
| SummaryRenderer | `SUMMARY.md` | 摘要 |
| AgentInspector | `agent-inspector/*.md` | Agent 审计 |

**待更新文档：**
- `60-stage-plugins.md` - 更新渲染器说明
- `61-plugin-architecture.md` - 更新架构细节

---

## 📁 目录结构更新

### App 目录结构 (最新)

```
app/
├── page.tsx                    # 首页
├── layout.tsx                  # 根布局 (SidebarLayout)
├── globals.css                 # 全局样式
├── error.tsx                   # 错误边界
├── echo/
│   ├── page.tsx               # Echo 主入口
│   └── [segment]/             # 动态回响页面
├── explore/                   # 探索页面
├── agents/                    # 智能体管理
│   ├── page.tsx
│   └── [agentKey]/
├── changes/                   # 变更追踪
├── view/[...path]/            # 文件查看/编辑
├── setup/                     # 初始化向导
├── login/                     # 登录
├── help/                      # 帮助
└── api/                       # API 路由
    ├── ask/                   # AI 对话流
    ├── file/                  # 文件操作
    ├── search/                # 搜索
    ├── mcp/                   # MCP 管理
    ├── skills/                # Skill 管理
    ├── sync/                  # Git 同步
    └── ...
```

### Components 目录结构 (最新)

```
components/
├── SidebarLayout.tsx          # 主布局
├── ActivityBar.tsx            # Activity Bar (新增)
├── Panel.tsx                  # Panel 容器 (新增)
├── Sidebar.tsx                # 传统 Sidebar
├── FileTree.tsx               # 文件树
├── HomeContent.tsx            # 首页
├── ViewPageClient.tsx         # 查看/编辑页
├── GuideCard.tsx              # 引导卡片
├── OnboardingView.tsx         # 空状态引导
├── AskFab.tsx                 # AI 浮动按钮
├── SearchModal.tsx            # 搜索弹窗
├── SettingsModal.tsx          # 设置弹窗
├── UpdateOverlay.tsx          # 更新覆盖层
├── panels/                    # Panel 组件 (新增)
│   ├── AgentsPanel.tsx
│   ├── EchoPanel.tsx
│   ├── SearchPanel.tsx
│   ├── PluginsPanel.tsx
│   └── DiscoverPanel.tsx
├── agents/                    # Agent 组件 (新增)
│   ├── AgentDetailContent.tsx
│   ├── AgentsContentPage.tsx
│   └── ...
├── echo/                      # Echo 组件 (新增)
│   └── EchoSegmentPageClient.tsx
├── changes/                   # Changes 组件 (新增)
│   └── ChangesContentPage.tsx
├── ask/                       # AI 对话
│   ├── AskContent.tsx
│   └── MessageList.tsx
├── settings/                  # 设置
│   ├── SettingsContent.tsx
│   ├── McpTab.tsx
│   ├── SyncTab.tsx
│   └── ...
├── renderers/                 # 渲染器
│   ├── todo/
│   ├── graph/
│   ├── csv/
│   └── ...
└── setup/                     # 初始化向导
    └── index.tsx
```

### Lib 目录结构 (最新)

```
lib/
├── core/                      # 核心文件操作
│   ├── search.ts             # 搜索 (含索引)
│   ├── search-index.ts       # 倒排索引 (新增)
│   ├── tree.ts               # 文件树
│   ├── fs-ops.ts             # 文件操作
│   ├── agent-audit-log.ts    # 审计日志
│   ├── content-changes.ts    # 变更追踪 (新增)
│   ├── create-space.ts       # 空间创建 (新增)
│   ├── list-spaces.ts        # 空间列表 (新增)
│   ├── space-scaffold.ts     # 空间脚手架 (新增)
│   ├── git.ts                # Git 操作
│   └── ...
├── agent/                     # AI Agent
│   ├── tools.ts              # 工具定义
│   ├── context.ts            # 上下文
│   └── model.ts              # 模型配置
├── renderers/                 # 渲染器
│   └── registry.ts
├── mcp-agents.ts             # Agent 管理 (新增)
├── mcp-snippets.ts           # MCP 代码片段
├── echo-segments.ts          # Echo 类型 (新增)
├── echo-insight-prompt.ts    # Echo Prompt (新增)
├── fs.ts                     # 文件系统 API
└── settings.ts               # 设置管理
```

---

## 🔌 API 更新

### 新增 API 端点

| 端点 | 描述 | 文件 |
|------|------|------|
| `POST /api/ask-sessions` | AI 会话管理 | `api/ask-sessions/route.ts` |
| `GET /api/changes` | 获取变更列表 | `api/changes/route.ts` |
| `GET /api/graph` | 知识图谱数据 | `api/graph/route.ts` |
| `GET /api/monitoring` | 系统监控 | `api/monitoring/route.ts` |
| `GET /api/mcp/status` | MCP 状态 | `api/mcp/status/route.ts` |
| `POST /api/mcp/install` | 安装 Agent | `api/mcp/install/route.ts` |
| `POST /api/mcp/install-skill` | 安装 Skill | `api/mcp/install-skill/route.ts` |
| `POST /api/mcp/restart` | 重启 MCP | `api/mcp/restart/route.ts` |
| `GET /api/update-status` | 更新状态 | `api/update-status/route.ts` |
| `POST /api/settings/test-key` | 测试 API Key | `api/settings/test-key/route.ts` |

### 更新的 API

| 端点 | 变更 | 文件 |
|------|------|------|
| `POST /api/ask` | 支持会话历史 | `api/ask/route.ts` |
| `GET /api/files` | 支持空间过滤 | `api/files/route.ts` |
| `POST /api/sync` | 增强错误处理 | `api/sync/route.ts` |
| `GET /api/search` | 使用新搜索索引 | `api/search/route.ts` |

---

## ✅ 更新任务清单

### 高优先级

- [ ] `20-system-architecture.md`
  - [ ] 添加 Activity Bar + Panel 架构说明
  - [ ] 添加 Search Index 架构
  - [ ] 添加 Agents 子系统
  - [ ] 添加 Echo 子系统
  - [ ] 添加 Changes 子系统
  - [ ] 更新目录结构
  - [ ] 更新 API 端点列表

- [ ] `22-page-design.md`
  - [ ] 确认 Activity Bar 布局描述最新
  - [ ] 添加 Echo 页面详细设计
  - [ ] 添加 Agents 页面设计
  - [ ] 添加 Changes 页面设计

### 中优先级

- [ ] `23-mind-spaces.md`
  - [ ] 更新多空间说明
  - [ ] 添加空间创建流程

- [ ] `60-stage-plugins.md`
  - [ ] 更新渲染器列表
  - [ ] 添加新渲染器说明

- [ ] `61-plugin-architecture.md`
  - [ ] 更新渲染器注册机制

### 低优先级

- [ ] 新增 `23-echo-system.md`
  - [ ] Echo 概念说明
  - [ ] 回响类型详解
  - [ ] 生成流程

- [ ] 新增 Agents 专门文档
  - [ ] Agent 概念
  - [ ] 配置说明
  - [ ] API 参考

- [ ] 其他 wiki 链接校正
  - [ ] 检查所有相对链接
  - [ ] 确认文档间引用正确

---

## 📚 参考文档

| 文档 | 路径 | 说明 |
|------|------|------|
| Activity Bar Spec | `specs/spec-activity-bar-layout.md` | Activity Bar 详细设计 |
| Echo Panel Spec | `specs/spec-echo-panel.md` | Echo 详细设计 |
| Echo Content Spec | `specs/spec-echo-content-pages.md` | Echo 页面设计 |
| Agents Panel Spec | `specs/spec-agents-panel-hub-nav.md` | Agents Panel 设计 |
| Search Index Impl | `lib/core/search-index.ts` | 搜索索引实现 |
| Wiki Audit | `wiki-audit-report-2026-03-22.md` | 之前审计报告 |

---

## 🔄 版本信息

| 版本 | 日期 | 主要变更 |
|------|------|----------|
| 0.5.67 | 2026-03-26 | 当前版本 |
| 0.5.0 | 2026-03 | Activity Bar 重构、Echo 系统 |
| 0.4.0 | 2026-02 | Changes 追踪、Agents 管理 |
| 0.3.0 | 2026-01 | Search Index 优化、多视图 CSV |
| 0.2.0 | 2025-12 | 桌面应用、MCP Server |
| 0.1.0 | 2025-11 | 初始版本 |

---

*本文档由 AI 助手根据代码库分析生成，需要人工审核后同步到各 wiki 文档中。*
