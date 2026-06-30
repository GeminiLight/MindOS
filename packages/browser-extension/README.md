<h1 align="center">MindOS Web Clipper</h1>

<p align="center">
  Save any web page or AI chat session to your MindOS knowledge base — one click, clean Markdown.
  <br/>
  <b>一键保存任意网页或 AI 对话到 MindOS 知识库 — 干净的 Markdown 格式。</b>
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
2. Enter your MindOS URL (default: `http://localhost:3456`; `localhost:3456` is accepted too)
3. Paste your Auth Token (find it in MindOS → Settings → MCP)
4. Click **Connect**

### How to clip

- **Click the icon** to clip the current page
- **Right-click** → "Save to MindOS" on any page
- **Keyboard shortcut**: `Ctrl+Shift+M` (Mac: `Cmd+Shift+M`)

Choose a folder, edit the title if needed, and hit **Save to MindOS**. On supported AI chat pages, MindOS captures the visible conversation transcript instead of generic article text.

If the page changes while the popup is open, use the refresh icon to read the current tab again. If the folder list cannot load, saving to Inbox still works.

### Browser Bridge

When the extension is installed, local MindOS pages can detect it through a small local-only bridge. If you paste a logged-in source such as ChatGPT, Claude, Gemini, Kimi, or Xiaohongshu into Inbox, MindOS can open that URL in your browser so you can sign in if needed, wait for the page to load, and then use the extension to save the rendered page or conversation.

The bridge does **not** read or export browser cookies. It only accepts requests from local MindOS pages and only opens `http://` or `https://` URLs for user-driven capture.

### AI chat capture

The clipper recognizes active conversations on:

- ChatGPT (`chatgpt.com`, `chat.openai.com`)
- Claude (`claude.ai`)
- Gemini (`gemini.google.com`)
- DeepSeek (`chat.deepseek.com`)
- Kimi (`kimi.moonshot.cn`, `kimi.com`)
- Qwen / Tongyi (`chat.qwen.ai`, `tongyi.aliyun.com`, `qianwen.aliyun.com`)
- Zhipu GLM (`chatglm.cn`, `z.ai`, `chat.z.ai`)
- MiniMax / Hailuo (`chat.minimax.io`, `minimax.io`, `hailuoai.com`)

AI conversations are saved as `type: log` with `source_type: session`, `source_url`, `source_platform`, and `captured_at` frontmatter, then staged in Inbox by default.

### What gets saved

```yaml
---
title: Article Title
type: material
status: active
created: 2026-06-17
source_type: web
source_url: https://example.com/article
captured_at: 2026-06-17T10:30:00Z
---

# Article Title

Clean markdown content...
```

### Features

- Smart content extraction (Mozilla Readability — strips ads, nav, etc.)
- AI chat session capture for ChatGPT, Claude, Gemini, DeepSeek, Kimi, Qwen, Zhipu GLM, and MiniMax
- YAML frontmatter with MindOS source metadata
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
2. 输入 MindOS 地址（默认 `http://localhost:3456`；也可以直接填 `localhost:3456`）
3. 粘贴认证令牌（在 MindOS → 设置 → MCP 中找到）
4. 点击 **Connect**

### 如何剪藏

- **点击图标** 剪藏当前页面
- **右键菜单** → "Save to MindOS"
- **快捷键**：`Ctrl+Shift+M`（Mac：`Cmd+Shift+M`）

选择目标文件夹，可编辑标题，然后点 **Save to MindOS**。在已支持的 AI 对话页里，插件会优先保存当前会话转写，而不是把页面当普通文章抽取。

如果页面内容在弹窗打开后发生变化，可以点刷新图标重新读取当前页。若文件夹列表加载失败，仍可先保存到 Inbox。

### 浏览器桥接

安装扩展后，本地 MindOS 页面可以通过一个仅限本地页面的轻量 bridge 检测到扩展。你在收集箱粘贴 ChatGPT、Claude、Gemini、Kimi、小红书等需要登录态的来源时，MindOS 可以把这个网址打开到你的真实浏览器里；你按需登录、等待页面加载后，再点击扩展保存渲染后的网页或对话。

这个 bridge **不会**读取或导出浏览器 cookie。它只接受本地 MindOS 页面的请求，并且只会打开 `http://` / `https://` 网址供用户主动捕获。

### AI 对话捕获

当前支持：

- ChatGPT (`chatgpt.com`, `chat.openai.com`)
- Claude (`claude.ai`)
- Gemini (`gemini.google.com`)
- DeepSeek (`chat.deepseek.com`)
- Kimi (`kimi.moonshot.cn`, `kimi.com`)
- Qwen / 通义千问 (`chat.qwen.ai`, `tongyi.aliyun.com`, `qianwen.aliyun.com`)
- Zhipu GLM / 智谱清言 (`chatglm.cn`, `z.ai`, `chat.z.ai`)
- MiniMax / 海螺 (`chat.minimax.io`, `minimax.io`, `hailuoai.com`)

AI 对话会写成 `type: log`，并带上 `source_type: session`、`source_url`、`source_platform` 和 `captured_at`，默认进入 Inbox 暂存。

### 保存内容示例

```yaml
---
title: 文章标题
type: material
status: active
created: 2026-06-17
source_type: web
source_url: https://example.com/article
captured_at: 2026-06-17T10:30:00Z
---

# 文章标题

干净的 Markdown 正文...
```

### 功能特性

- 智能内容提取（Mozilla Readability — 自动去除广告、导航栏等）
- AI 对话捕获：ChatGPT、Claude、Gemini、DeepSeek、Kimi、Qwen、智谱 GLM、MiniMax
- YAML 元数据（MindOS 来源字段）
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
pnpm install     # install dependencies / 安装依赖
pnpm run build   # rebuild extension/ from src/ / 从源码重新构建
pnpm run watch   # rebuild on file changes / 监听文件变化自动构建
pnpm run package # create .zip for Chrome Web Store / 打包用于商店提交
```

### Architecture / 架构

```
src/
├── manifest.json              # Chrome Manifest V3
├── background/
│   └── service-worker.ts      # Context menu + keyboard shortcut
├── content/
│   ├── extractor.ts           # Readability + AI conversation extraction
│   └── ai-conversation.ts     # AI chat platform profiles
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
