# Browser Web Clipper 竞品调研

> 2026-04-04 | 目标：为 MindOS 浏览器插件（一键导入知识库）提供竞品参考

## 概览

| 产品 | 开源 | 核心技术 | 数据流向 | 评分 | 用户量 |
|------|------|----------|----------|------|--------|
| Notion Web Clipper | 否 | 私有 | Notion 云端 | 3.1/5 | 4M+ |
| Obsidian Web Clipper | 是 (MIT) | Defuddle + Turndown | 本地 Vault | 4.3/5 | 200K+ |
| YouMind 浏览器插件 | 否 | 私有（AI 驱动） | YouMind 云端 | ~4.5/5 | 50K+ |
| MarkDownload | 是 (MIT) | Readability + Turndown | 本地下载 | 4.5/5 | 200K+ |
| Joplin Web Clipper | 是 (AGPL) | Readability + Turndown | 本地 REST API | 3.8/5 | 100K+ |
| Web Clipper (通用) | 是 (MIT) | Readability + Turndown | 19+ 目标平台 | 4.4/5 | 不详 |

---

## 1. Notion Web Clipper

### 基本信息
- **官网**: https://www.notion.so/web-clipper
- **Chrome Web Store**: `Notion Web Clipper`
- **开源**: 否（闭源）
- **用户量**: 4,000,000+
- **评分**: 3.1/5（评价两极分化）

### 核心功能
- 将网页保存为 Notion 页面（全页或选中区域）
- 选择目标 workspace 和 database
- 添加标签/属性（日期、标签、URL）
- 自动提取页面标题和 URL

### 数据流
```
网页 → Notion Web Clipper（浏览器） → Notion API → Notion 云端数据库
```

### UX 流程
1. 点击扩展图标 → 弹出小窗口
2. 选择 Workspace → Database → 可选添加属性
3. 点击 "Save" → 保存到 Notion

### 优缺点
**优点**：
- 与 Notion 深度集成
- 用户量大，品牌认知强
- 支持 Database 属性映射

**缺点**：
- 评分低（3.1/5），用户抱怨频繁登录失败
- 只支持 Notion，不支持其他平台
- 格式转换质量一般（表格、代码块丢失较多）
- 不支持高亮/选中文本裁剪
- 闭源，无法扩展

### 技术实现（推测）
- Manifest V3
- 使用 Notion 私有 API（非公开 API）
- DOM 解析 → 转换为 Notion Block 格式
- 需要 OAuth 登录

### 对 MindOS 的启示
- Database/属性选择器是好设计，但 MindOS 可映射到 Space + Tags
- 登录流程要简单稳定（Notion 的痛点）
- 格式转换质量是核心竞争力

---

## 2. Obsidian Web Clipper

### 基本信息
- **官网**: https://obsidian.md/clipper
- **Chrome Web Store**: `Obsidian Web Clipper`
- **GitHub**: https://github.com/obsidianmd/obsidian-clipper
- **开源**: 是，MIT 许可证
- **用户量**: 200,000+
- **评分**: 4.3/5
- **Stars**: ~3,000+

### 核心功能
- 将网页保存为 Markdown 文件到 Obsidian Vault
- **模板系统**：用户可自定义 Markdown 模板，用变量（`{{title}}`, `{{content}}`, `{{date}}`）控制输出格式
- **高亮裁剪**：选中文本后裁剪，只保存选中部分
- **元数据提取**：自动提取 Schema.org、Open Graph、meta 标签
- **属性映射**：支持 Obsidian frontmatter（YAML）
- **多 Vault 支持**：选择目标 Vault 和文件夹

### 数据流
```
网页 → Obsidian Web Clipper（浏览器）
    → Defuddle 解析 → Turndown 转 Markdown → 模板渲染
    → obsidian:// URI scheme → Obsidian 本地 Vault
```
**关键**：完全本地，不经过任何云端。

### UX 流程
1. 点击扩展图标 → 弹出侧边栏
2. 自动填充标题、内容预览
3. 选择 Vault → 文件夹 → 模板
4. 可选编辑 frontmatter 属性
5. 点击 "Save to Obsidian" → 通过 URI scheme 打开 Obsidian 写入

### 技术架构（开源，详细分析）

#### 核心库：Defuddle
- **GitHub**: https://github.com/nicolevanderhoeven/defuddle（归属 Obsidian 团队维护）
- **Stars**: 6,100+
- **定位**: Readability.js 的增强替代品
- **优势**:
  - 标准化处理脚注、数学公式（LaTeX）、代码块（语法高亮）
  - Schema.org 结构化数据提取
  - 更好的噪音移除（广告、导航栏、侧边栏）
  - 专为 Markdown 转换优化

#### 4 阶段处理管道
```
1. DOM 清洗 → 移除 script/style/广告
2. Defuddle 解析 → 提取主要内容 + 元数据
3. Turndown 转换 → HTML → Markdown
4. 模板渲染 → 变量替换 + frontmatter 注入
```

#### 模板变量（部分列表）
```
{{title}}        - 页面标题
{{url}}          - 当前 URL
{{content}}      - 解析后的 Markdown 正文
{{date}}         - 当前日期（可格式化）
{{author}}       - 作者（从 meta 提取）
{{description}}  - 页面描述
{{highlights}}   - 用户高亮的文本
{{tags}}         - 自动提取的标签
{{schema:xxx}}   - Schema.org 字段
```

#### 技术栈
- TypeScript
- Manifest V3（Chrome）+ WebExtension API（Firefox/Safari）
- Turndown（HTML → Markdown）
- Defuddle（内容提取）
- Svelte（UI 框架，侧边栏）

### 对 MindOS 的启示
- **模板系统是杀手功能**：用户可以定义"论文笔记"、"产品调研"等不同模板
- **Defuddle 值得复用**：MIT 许可证，比 Readability.js 更适合 Markdown 场景
- **URI scheme 模式**：`obsidian://` 通过本地协议写入，MindOS 可以用 HTTP API（`/api/import`）
- **本地优先**：和 MindOS 理念一致

---

## 3. YouMind 浏览器插件

### 基本信息
- **官网**: https://youmind.ai
- **Chrome Web Store**: `YouMind - AI Copilot`
- **开源**: 否（闭源）
- **用户量**: 50,000+（估计）
- **评分**: ~4.5/5
- **定价**: 免费版（有限制）/ Pro $9.9/月 / Premium $19.9/月

### 核心功能
- **AI 摘要**：一键生成网页内容摘要
- **智能收藏**：保存网页并自动分类
- **知识图谱**：收藏内容之间的关联可视化
- **AI 问答**：基于收藏内容进行 AI 对话
- **多格式支持**：网页、PDF、YouTube 字幕
- **标注 & 高亮**：页面内高亮并保存

### 数据流
```
网页 → YouMind 插件 → YouMind 云端（AI 处理）→ 知识库
```
**关键**：数据全部上云，无本地选项。

### UX 流程
1. 点击扩展图标 → 侧边栏打开
2. 自动生成 AI 摘要 + 关键要点
3. 一键收藏到 YouMind 知识库
4. 可选添加高亮和笔记
5. 在 YouMind 网页/App 中管理

### 差异化
- **AI 原生**：不只是保存，而是"理解"内容
- **工作流**：收集 → AI 处理 → 笔记创建（一步到位）
- **知识图谱**：内容关联可视化

### 对 MindOS 的启示
- **AI 摘要是强需求**：用户不想保存整页，要精华
- **但数据上云是痛点**：MindOS 的本地优先是差异化优势
- **知识关联**：MindOS 的 Graph View / Echo 可以作为对应功能
- MindOS 可以做到 "YouMind 的 AI 能力 + Obsidian 的本地优先"

---

## 4. 其他值得参考的 Web Clipper

### MarkDownload
- **GitHub**: https://github.com/deathau/markdownload（600+ stars）
- **用户量**: 200,000+
- **评分**: 4.5/5
- **技术栈**: Readability.js + Turndown
- **特点**:
  - 纯 Markdown 下载，不依赖任何应用
  - 支持 frontmatter 自定义
  - 图片可选下载或保留链接
  - 极简——做一件事做到好
- **启示**: 用户需要"简单可靠"的基础功能

### Joplin Web Clipper
- **GitHub**: https://github.com/laurent22/joplin（45K+ stars）
- **用户量**: 100,000+
- **评分**: 3.8/5
- **技术栈**: Readability.js + Turndown
- **特点**:
  - **本地 REST API 模式**：Joplin 桌面端运行 HTTP Server（端口 41184），浏览器插件通过 REST API POST 内容到本地
  - 支持标签和笔记本选择
  - 和 MindOS MCP 模式最接近
- **启示**: REST API 模式验证了"浏览器插件 → 本地 HTTP Server"的技术可行性，MindOS 已经有 MCP HTTP Server，天然适配

### Web Clipper（通用版）
- **GitHub**: https://github.com/nicolevanderhoeven/web-clipper（6,700+ stars）
- **特点**:
  - 支持 19+ 目标平台（Notion, Obsidian, Joplin, Bear, Yuque, etc.）
  - 插件架构——每个目标是一个 plugin
  - MIT 许可证
- **启示**: 如果 MindOS 不想自己做插件，可以作为这个项目的一个 plugin target

---

## 技术方案对比

### 内容提取方案

| 方案 | 使用者 | 优点 | 缺点 |
|------|--------|------|------|
| **Defuddle** | Obsidian | 最佳 Markdown 转换质量、数学/代码/脚注支持 | 较新，社区小 |
| **Readability.js** | Joplin, MarkDownload | 经典、稳定、社区大 | 不处理代码块/数学公式 |
| **私有解析** | Notion, YouMind | 针对自家格式优化 | 闭源，不可复用 |

### 数据传输方案

| 方案 | 使用者 | 优点 | 缺点 |
|------|--------|------|------|
| **HTTP API** | Joplin | 浏览器原生支持、MindOS 已有 | 需要 auth token |
| **URI Scheme** | Obsidian | 无需网络、本地直达 | 需要注册协议、不跨平台 |
| **云端 API** | Notion, YouMind | 无需本地运行 | 需要登录、数据上云 |
| **文件下载** | MarkDownload | 最简单、无依赖 | 用户需手动移动文件 |

### MindOS 推荐方案
```
内容提取: Defuddle（MIT，最佳质量）
传输方式: HTTP API（MindOS MCP Server 已有 /api 端点）
UI 框架: Svelte 或 React（轻量）
Manifest: V3（Chrome 强制要求）

流程:
  网页 → 插件 Content Script 提取 DOM
      → Defuddle 解析 + Turndown 转 Markdown
      → POST /api/import { title, content, url, tags, space }
      → MindOS 保存到知识库对应 Space
```

---

## 关键洞察

1. **Obsidian Web Clipper 是最佳技术参考**：开源、MIT、架构清晰、Defuddle 库质量高
2. **Joplin 验证了 REST API 模式**：浏览器插件 → 本地 HTTP Server 是成熟方案，MindOS 天然适配
3. **YouMind 的 AI 摘要是差异化方向**：MindOS 可以在剪藏时提供 AI 摘要/自动分类
4. **Notion Clipper 的教训**：登录体验差 + 格式转换差 = 3.1 分。稳定性和格式质量是基础
5. **MindOS 的独特优势**：本地优先 + AI 能力 + MCP 集成 = 结合 Obsidian 的隐私 + YouMind 的智能
