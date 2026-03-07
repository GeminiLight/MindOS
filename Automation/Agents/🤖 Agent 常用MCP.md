# 🤖 Agent 常用MCP

| 名称 | 用途 | 安装方式 | 配置方式 | 备注 |
|------|------|----------|----------|------|
| Notion MCP Server | 让 AI 访问 Notion 工作区，支持搜索、创建/更新页面、管理数据库 | `npx @notionhq/notion-mcp-server` | 见下方配置 | 需要 Notion 集成令牌 |
| arxiv-mcp-server | 搜索、下载、本地存储并全文读取 arXiv 论文 | `uv tool install arxiv-mcp-server` | 见下方配置 | 需指定本地存储路径 |
| mcp-server-git | 让 AI 操作本地 Git 仓库，读取 diff/log/status、提交、切分支等 | `uvx mcp-server-git` | 见下方配置 | 需指定仓库路径 |
| GitHub MCP Server | 让 AI 操作 GitHub Issues、PR、Actions、仓库等 | Docker 方式，见下方配置 | 见下方配置 | 需要 GitHub PAT |
| Playwright MCP | 让 AI 控制真实浏览器，导航、点击、截图、抓动态内容 | `npx @playwright/mcp@latest` | 见下方配置 | 需要 Node.js 18+ |
| filesystem MCP | 让 AI 读写本地指定目录，支持批量操作和目录树 | `npx @modelcontextprotocol/server-filesystem` | 见下方配置 | 需指定允许访问的目录 |

## Notion MCP Server

### 1. 创建 Notion 集成

访问 https://www.notion.so/profile/integrations，创建内部集成，获取 Token（格式：`ntn_****`），并在集成的 Access 页面授权相关页面。

### 2. 客户端配置（Claude Desktop / Cursor）

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

## arxiv-mcp-server

### 安装

```bash
uv tool install arxiv-mcp-server
```

### 客户端配置（Claude Desktop / Cursor）

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

## mcp-server-git

### 客户端配置（Claude Desktop / Cursor）

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

## GitHub MCP Server

### 1. 获取 GitHub Personal Access Token

访问 https://github.com/settings/tokens，创建 Fine-grained token，按需授权 Issues、PR、Actions 等权限。

### 2. 客户端配置（Claude Desktop / Cursor）

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

## Playwright MCP

### 客户端配置（Claude Desktop / Cursor）

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

## filesystem MCP

### 客户端配置（Claude Desktop / Cursor）

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
