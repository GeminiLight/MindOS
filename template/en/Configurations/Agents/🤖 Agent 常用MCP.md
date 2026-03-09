# 🤖 Agent 常用MCP

## 1️⃣ 安装方式与路径

通过修改各工具的全局配置文件来配置 MCP Server。

| 工具 | 配置文件路径 | 配置字段 | 格式 |
|------|-------------|----------|------|
| Claude Code Internal | `~/.claude-internal/.claude.json` | `mcpServers` | JSON |
| Claude Code | `~/.claude/.claude.json` | `mcpServers` | JSON |
| Codex | `~/.codex/config.toml` | `[mcpServers]` | TOML |
| Gemini CLI | `~/.gemini/settings.json` | `mcpServers` | JSON |
| iFlow | `~/.iflow/config.json` | `mcpServers` | JSON |

> **注意**：下方提供的配置示例均为 JSON 格式。Codex 用户需将其转换为 TOML 格式。

---

## ⚡ 快速配置（当前已启用的全局 MCP）

直接将以下内容合并到 `~/.claude-internal/.claude.json` 的 `mcpServers` 字段：

```json
{
  "notion": {
    "type": "stdio",
    "command": "npx",
    "args": ["-y", "@notionhq/notion-mcp-server"],
    "env": { "NOTION_TOKEN": "ntn_****" }
  },
  "dida365": {
    "type": "stdio",
    "command": "node",
    "args": ["~/.npm-global/lib/node_modules/dida365-mcp-servers/dist/index.js"],
    "env": { "DIDA365_TOKEN": "your_token_here" }
  },
  "youtube": {
    "type": "stdio",
    "command": "npx",
    "args": ["-y", "@aitofy/youtube"],
    "env": {}
  },
  "arxiv": {
    "type": "stdio",
    "command": "~/.local/bin/mcp-simple-arxiv",
    "args": [],
    "env": {}
  },
  "github": {
    "type": "stdio",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-github"],
    "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "github_pat_****" }
  }
}
```

> **注意**：
> - `dida365` 需先全局安装：`npm install -g dida365-mcp-servers`，并修复 `dist/index.js` 第 20 行，将 `Authorization: DIDA365_TOKEN` 改为 `` Authorization: `Bearer ${DIDA365_TOKEN}` ``
> - Token 获取方式见各 MCP 的详细配置章节
> - **不要**在 `projects` 字段下注册 MCP，统一用全局 `mcpServers`

## 2️⃣ 常用 MCP 及分类

| 名称 | 类别 | 用途 | 安装方式 | 备注 |
|------|------|------|----------|------|
| filesystem MCP | 本地系统 | 让 AI 读写本地指定目录，支持批量操作和目录树 | `npx @modelcontextprotocol/server-filesystem` | 需指定允许访问的目录 |
| mcp-server-git | 本地系统 | 让 AI 操作本地 Git 仓库，读取 diff/log/status、提交、切分支等 | `uvx mcp-server-git` | 需指定仓库路径 |
| GitHub MCP Server | 代码托管 | 让 AI 操作 GitHub Issues、PR、Actions、仓库等 | Docker 方式，见下方配置 | 需要 GitHub PAT |
| Notion MCP Server | 知识库 | 让 AI 访问 Notion 工作区，支持搜索、创建/更新页面、管理数据库 | `npx /notion-mcp-server` | 需要 Notion 集成令牌 |
| xiaohongshu-mcp | 社交媒体 | 让 AI 搜索小红书、获取帖子详情/评论/互动数据、发布笔记 | 二进制，见下方配置 | 需登录态，配合 xiaohongshu skill 使用 |
| aitofy-dev/youtube | 社交媒体 | 搜索视频、获取字幕/Transcript、频道信息 | `npx @aitofy/youtube` | 无需 API Key |
| arxiv-mcp-server | 科研 | 搜索、下载、本地存储并全文读取 arXiv 论文 | `uv tool install arxiv-mcp-server` | 需指定本地存储路径 |
| dida365-mcp-servers | 任务管理 | 让 AI 管理滴答清单任务与项目，支持创建/更新/完成/删除 | `npx dida365-mcp-servers` | 需 Dida365 OAuth Token |

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

---

## 视频

### aitofy-dev/youtube

无需 YouTube API Key，开箱即用。

```json
{
  "mcpServers": {
    "youtube": {
      "command": "npx",
      "args": ["-y", "@aitofy/youtube"]
    }
  }
}
```

提供工具：`search_youtube_videos`、`get_youtube_transcript`、`get_youtube_transcript_text`、`list_youtube_transcripts`、`get_youtube_video_info`、`get_youtube_channel_info`、`get_youtube_channel_videos`

### dida365-mcp-servers

#### 获取 Token

1. 访问 https://developer.dida365.com/manage，登录后点击 **Create App**，填写应用名称，回调地址填 `http://localhost:8080/oauth/callback`
2. 记录 **Client ID** 和 **Client Secret**
3. 本地启动临时服务捕获 code（授权前先运行）：
   ```bash
   python3 -c "
   import http.server, sys
   class H(http.server.BaseHTTPRequestHandler):
       def do_GET(self):
           print('URL:', self.path); self.send_response(200); self.end_headers(); self.wfile.write(b'Got it!'); sys.stdout.flush()
       def log_message(self, *a): pass
   http.server.HTTPServer(('', 8080), H).handle_request()
   " &
   ```
4. 在浏览器中打开以下 URL（替换 `{CLIENT_ID}`）：
   ```
   https://dida365.com/oauth/authorize?scope=tasks:write%20tasks:read&client_id={CLIENT_ID}&state=state&redirect_uri=http://localhost:8080/oauth/callback&response_type=code
   ```
5. 点击授权后终端打印出 `URL: /oauth/callback?code=XXXX`，复制 `code=` 后的值
6. 换取 Access Token（替换对应值）：
   ```bash
   curl -X POST "https://dida365.com/oauth/token" \
     -u "{CLIENT_ID}:{CLIENT_SECRET}" \
     -d "code={CODE}&grant_type=authorization_code&redirect_uri=http://localhost:8080/oauth/callback"
   ```
7. 响应中的 `access_token` 即为 `DIDA365_TOKEN`，有效期 180 天

```json
{
  "mcpServers": {
    "dida365": {
      "command": "npx",
      "args": ["-y", "dida365-mcp-servers"],
      "env": {
        "DIDA365_TOKEN": "your_bearer_token_here"
      }
    }
  }
}
```

> **Token 续期记录**
> - 当前 Token 有效期至：2026-09-04（180天）
> - 续期时重走上方 OAuth 流程，然后直接编辑 `~/.claude/.claude.json` 中 `mcpServers.dida365.env.DIDA365_TOKEN` 字段

#### ⚠️ 踩坑记录（2026-03-08）

| 问题 | 原因 | 解决 |
|------|------|------|
| `invalid_grant: Invalid redirect` | App 注册的回调地址与授权 URL 的 `redirect_uri` 不一致 | 统一使用 `http://localhost:8080/oauth/callback` |
| 浏览器页面一直加载/卡住 | 本地没有服务监听 8080，无法完成跳转 | 授权前先启动临时 python 服务（见步骤 3） |
| `cannot approve uninitialized request` | 复用了旧授权标签页，session 已失效 | 每次都开新标签页，打开后立即点授权 |
| `mcp add` 报 already exists | Token 之前已注册，新 Token 无法直接覆盖 | 直接编辑 `~/.claude-internal/.claude.json` 更新 Token |
| `Failed to reconnect` / API 返回 unauthorized | MCP server 代码 bug：`Authorization` 头缺少 `Bearer` 前缀 | 修改 `~/.npm-global/lib/node_modules/dida365-mcp-servers/dist/index.js` 第 20 行为 `` `Bearer ${DIDA365_TOKEN}` `` |

提供工具：`create_task`、`get_tasks_by_projectId`、`get_task_by_projectId_and_taskId`、`update_task`、`complete_task`、`delete_task`、`get_projects`、`get_project_by_projectId`、`create_project`、`update_project_by_projectID`、`delete_project_by_projectID`

提供资源：`dida365://tasks`、`dida365://projects`
