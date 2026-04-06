<h1 align="center">MindOS Web Clipper</h1>

<p align="center">
  Save any web page to your MindOS knowledge base — one click, clean Markdown.
  <br/>
  <b>一键保存任意网页到 MindOS 知识库 — 干净的 Markdown 格式。</b>
</p>

<p align="center">
  <a href="#install">English</a> | <a href="#安装">中文</a>
</p>

---

## Install

**No build required — the `extension/` folder is ready to load.**

1. Open Chrome, go to `chrome://extensions`
2. Turn on **Developer mode** (top-right toggle)
3. Click **Load unpacked** → select the `extension/` folder in this directory

Done. You'll see the MindOS icon in your toolbar.

### First-time setup

1. Click the MindOS icon in your toolbar
2. Enter your MindOS URL (default: `http://localhost:3456`)
3. Paste your Auth Token (find it in MindOS → Settings → MCP)
4. Click **Connect**

### How to clip

- **Click the icon** to clip the current page
- **Right-click** → "Save to MindOS" on any page
- **Keyboard shortcut**: `Ctrl+Shift+M` (Mac: `Cmd+Shift+M`)

Choose a folder, edit the title if needed, and hit **Save to MindOS**.

### What gets saved

```yaml
---
title: Article Title
source: https://example.com/article
author: Author Name
site: example.com
saved: 2025-01-15T10:30:00Z
---

# Article Title

Clean markdown content...
```

### Features

- Smart content extraction (Mozilla Readability — strips ads, nav, etc.)
- YAML frontmatter with metadata (title, source URL, author, site, date)
- Space/folder selector
- Editable title before saving
- Dark mode (follows system)
- Keyboard shortcut + right-click context menu
- 100% local — data goes to your MindOS instance, never to any cloud

### Supported browsers

- Chrome 120+
- Edge 120+
- Brave, Arc, and other Chromium browsers

---

## 安装

**无需构建 — `extension/` 文件夹可直接加载。**

1. 打开 Chrome，访问 `chrome://extensions`
2. 打开右上角 **开发者模式**
3. 点击 **加载已解压的扩展程序** → 选择本目录下的 `extension/` 文件夹

完成。工具栏会出现 MindOS 图标。

### 首次配置

1. 点击工具栏的 MindOS 图标
2. 输入 MindOS 地址（默认 `http://localhost:3456`）
3. 粘贴认证令牌（在 MindOS → 设置 → MCP 中找到）
4. 点击 **Connect**

### 如何剪藏

- **点击图标** 剪藏当前页面
- **右键菜单** → "Save to MindOS"
- **快捷键**：`Ctrl+Shift+M`（Mac：`Cmd+Shift+M`）

选择目标文件夹，可编辑标题，然后点 **Save to MindOS**。

### 保存内容示例

```yaml
---
title: 文章标题
source: https://example.com/article
author: 作者名
site: example.com
saved: 2025-01-15T10:30:00Z
---

# 文章标题

干净的 Markdown 正文...
```

### 功能特性

- 智能内容提取（Mozilla Readability — 自动去除广告、导航栏等）
- YAML 元数据（标题、来源 URL、作者、站点、日期）
- 知识库文件夹选择器
- 保存前可编辑标题
- 暗色模式（跟随系统）
- 快捷键 + 右键菜单
- 100% 本地 — 数据直接存入你的 MindOS，不上传任何云端

### 支持的浏览器

- Chrome 120+
- Edge 120+
- Brave、Arc 及其他 Chromium 浏览器

---

## For Developers / 开发者

```bash
npm install     # install dependencies / 安装依赖
npm run build   # rebuild extension/ from src/ / 从源码重新构建
npm run watch   # rebuild on file changes / 监听文件变化自动构建
npm run package # create .zip for Chrome Web Store / 打包用于商店提交
```

### Architecture / 架构

```
src/
├── manifest.json              # Chrome Manifest V3
├── background/
│   └── service-worker.ts      # Context menu + keyboard shortcut
├── content/
│   └── extractor.ts           # Readability content extraction
├── popup/
│   ├── popup.html             # Extension popup
│   ├── popup.css              # MindOS brand styles
│   └── popup.ts               # Setup → Clip → Save flow
└── lib/
    ├── types.ts               # Shared TypeScript types
    ├── api.ts                 # MindOS REST API client
    ├── storage.ts             # Chrome storage wrapper
    └── markdown.ts            # HTML → Markdown + frontmatter
```
