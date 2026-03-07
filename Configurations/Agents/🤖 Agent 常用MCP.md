# 🤖 Agent 常用MCP

## 1️⃣ 安装方式与路径

通过修改各工具的全局配置文件来配置 MCP Server。

| 工具 | 配置文件路径 | 配置字段 | 格式 |
|------|-------------|----------|------|
| Claude Code | `~/.claude/config.json` | `mcpServers` | JSON |
| Codex | `~/.codex/config.toml` | `[mcpServers]` | TOML |
| Gemini CLI | `~/.gemini/settings.json` | `mcpServers` | JSON |
| iFlow | `~/.iflow/config.json` | `mcpServers` | JSON |

> **注意**：下方提供的配置示例均为 JSON 格式。Codex 用户需将其转换为 TOML 格式。

## 2️⃣ 常用 MCP 及分类

| 名称 | 类别 | 用途 | 安装方式 | 备注 |
|------|------|------|----------|------|
| filesystem MCP | 本地系统 | 让 AI 读写本地指定目录，支持批量操作和目录树 | `npx @modelcontextprotocol/server-filesystem` | 需指定允许访问的目录 |
| mcp-server-git | 本地系统 | 让 AI 操作本地 Git 仓库，读取 diff/log/status、提交、切分支等 | `uvx mcp-server-git` | 需指定仓库路径 |
| GitHub MCP Server | 代码托管 | 让 AI 操作 GitHub Issues、PR、Actions、仓库等 | Docker 方式，见下方配置 | 需要 GitHub PAT |
| Playwright MCP | 浏览器 | 让 AI 控制真实浏览器，导航、点击、截图、抓动态内容 | `npx @playwright/mcp@latest` | 需要 Node.js 18+ |
| Notion MCP Server | 知识库 | 让 AI 访问 Notion 工作区，支持搜索、创建/更新页面、管理数据库 | `npx @notionhq/notion-mcp-server` | 需要 Notion 集成令牌 |
| xiaohongshu-mcp | 社交媒体 | 让 AI 搜索小红书、获取帖子详情/评论/互动数据、发布笔记 | 二进制，见下方配置 | 需登录态，配合 xiaohongshu skill 使用 |
| arxiv-mcp-server | 科研 | 搜索、下载、本地存储并全文读取 arXiv 论文 | `uv tool install arxiv-mcp-server` | 需指定本地存储路径 |

---

## 本地系统

### filesystem MCP

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/dir"]
    }
  }
}
```

`/path/to/dir` 为允许 AI 访问的目录，可传入多个路径。

提供工具：`read_text_file`、`read_multiple_files`、`write_file`、`edit_file`、`list_directory`、`directory_tree`、`search_files`、`move_file`

### mcp-server-git

```json
{
  "mcpServers": {
    "git": {
      "command": "uvx",
      "args": ["mcp-server-git", "--repository", "/path/to/repo"]
    }
  }
}
```

提供工具：`git_status`、`git_diff`、`git_diff_staged`、`git_log`、`git_commit`、`git_add`、`git_checkout`、`git_create_branch`、`git_show`

---

## 代码托管

### GitHub MCP Server

访问 https://github.com/settings/tokens，创建 Fine-grained token，按需授权 Issues、PR、Actions 等权限。

```json
{
  "mcpServers": {
    "github": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "-e", "GITHUB_PERSONAL_ACCESS_TOKEN", "ghcr.io/github/github-mcp-server"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_****"
      }
    }
  }
}
```

提供工具集：`repos`、`issues`、`pull_requests`、`actions`、`code_security`

---

## 浏览器

### Playwright MCP

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["@playwright/mcp@latest"]
    }
  }
}
```

无头模式（服务器环境）：

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["@playwright/mcp@latest", "--headless"]
    }
  }
}
```

提供工具：页面导航、点击、输入、截图、内容抓取等

---

## 知识库

### Notion MCP Server

访问 https://www.notion.so/profile/integrations，创建内部集成，获取 Token（格式：`ntn_****`），并在集成的 Access 页面授权相关页面。

```json
{
  "mcpServers": {
    "notionApi": {
      "command": "npx",
      "args": ["-y", "@notionhq/notion-mcp-server"],
      "env": {
        "NOTION_TOKEN": "ntn_****"
      }
    }
  }
}
```

---

## 科研

### arxiv-mcp-server

```bash
uv tool install arxiv-mcp-server
```

```json
{
  "mcpServers": {
    "arxiv-mcp-server": {
      "command": "uv",
      "args": [
        "tool",
        "run",
        "arxiv-mcp-server",
        "--storage-path", "/path/to/paper/storage"
      ]
    }
  }
}
```

提供工具：`search_papers`、`download_paper`、`list_papers`、`read_paper`

---

## 社交媒体

### xiaohongshu-mcp

> Mac 用户参考 [Credentials/🍪 小红书.md](../Credentials/🍪 小红书.md) 完成登录，生成 `cookies.json`。

```json
{
  "mcpServers": {
    "xiaohongshu": {
      "command": "/path/to/xiaohongshu-mcp"
    }
  }
}
```

提供工具：搜索笔记、获取帖子详情/评论/互动数据、发布笔记、获取用户主页

配合 skill 使用：
- `xiaohongshu`：内容搜索与舆情分析
- `write-xiaohongshu`：研究爆款 → 写作 → 发布全流程
- `xiaohongshu-note-analyzer`：发布前内容审核与优化
