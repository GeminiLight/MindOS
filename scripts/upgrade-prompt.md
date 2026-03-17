# MindOS Upgrade Prompt

Send this to your Agent (e.g. Claude Code) to upgrade from the old source-based setup to the new npm package.

---

## English

```
Help me upgrade my MindOS installation from the old source-based setup to the new npm package version.

**Old setup (what I have now):**
- Cloned the MindOS repo
- Ran `cd app && npm install` and `cd mcp && npm install && npm run build`
- Configured via `app/.env.local` (with MIND_ROOT, ANTHROPIC_API_KEY, etc.)
- Started with `cd app && npm run dev`
- MCP was started separately via `cd mcp && npm run start` or similar

**New setup (target):**
- Installed as a global npm package: `npm install -g mindos@latest`
- Configured via `~/.mindos/config.json` (managed by `mindos onboard`)
- Started with a single `mindos start` command (app + MCP together)

**Please do the following:**

1. **Install the new package globally:**
   ```bash
   npm install -g mindos@latest
   ```

2. **Read my current `app/.env.local`** to extract my existing configuration:
   - `MIND_ROOT` → knowledge base path
   - `AI_PROVIDER`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_BASE_URL`
   - `AUTH_TOKEN` (if set)

3. **Write `~/.mindos/config.json`** with those values in the new format:
   ```json
   {
     "mindRoot": "<value of MIND_ROOT>",
     "port": 3456,
     "mcpPort": 8781,
     "authToken": "<value of AUTH_TOKEN or empty string>",
     "webPassword": "",
     "ai": {
       "provider": "<value of AI_PROVIDER, default: anthropic>",
       "providers": {
         "anthropic": {
           "apiKey": "<value of ANTHROPIC_API_KEY>",
           "model": "<value of ANTHROPIC_MODEL, default: claude-sonnet-4-6>"
         },
         "openai": {
           "apiKey": "<value of OPENAI_API_KEY>",
           "model": "<value of OPENAI_MODEL, default: gpt-5.4>",
           "baseUrl": "<value of OPENAI_BASE_URL or empty string>"
         }
       }
     }
   }
   ```
   Create `~/.mindos/` directory if it doesn't exist.

4. **Verify** the config was written correctly by reading it back.

5. **Kill any running old MindOS processes** (next dev, mcp server).

6. **Start MindOS with the new command:**
   ```bash
   mindos start
   ```
   (First run will build automatically — this may take a minute.)

7. **Confirm** the app is accessible at http://localhost:3456 and MCP is running at http://localhost:8781/mcp.

Do not delete the old cloned repository — keep it as a backup. The `app/.env.local` file can also be kept as reference.
```

---

## 中文版

```
帮我把 MindOS 从旧版本（源码方式）升级到新的 npm 包版本。

**旧版安装方式（我现在的状态）：**
- 克隆了 MindOS 仓库
- 分别执行了 `cd app && npm install` 和 `cd mcp && npm install && npm run build`
- 通过 `app/.env.local` 配置（包含 MIND_ROOT、ANTHROPIC_API_KEY 等）
- 用 `cd app && npm run dev` 启动
- MCP 需要单独启动

**新版安装方式（目标）：**
- 全局 npm 包：`npm install -g mindos@latest`
- 通过 `~/.mindos/config.json` 统一配置（由 `mindos onboard` 管理）
- 一个命令启动 app + MCP：`mindos start`

**请按以下步骤操作：**

1. **安装新版全局包：**
   ```bash
   npm install -g mindos@latest
   ```

2. **读取我现有的 `app/.env.local`**，提取以下配置：
   - `MIND_ROOT` → 知识库路径
   - `AI_PROVIDER`、`ANTHROPIC_API_KEY`、`ANTHROPIC_MODEL`、`OPENAI_API_KEY`、`OPENAI_MODEL`、`OPENAI_BASE_URL`
   - `AUTH_TOKEN`（如果有）

3. **写入 `~/.mindos/config.json`**，格式如下：
   ```json
   {
     "mindRoot": "<MIND_ROOT 的值>",
     "port": 3456,
     "mcpPort": 8781,
     "authToken": "<AUTH_TOKEN 的值，没有则留空字符串>",
     "webPassword": "",
     "ai": {
       "provider": "<AI_PROVIDER 的值，默认 anthropic>",
       "providers": {
         "anthropic": {
           "apiKey": "<ANTHROPIC_API_KEY 的值>",
           "model": "<ANTHROPIC_MODEL 的值，默认 claude-sonnet-4-6>"
         },
         "openai": {
           "apiKey": "<OPENAI_API_KEY 的值>",
           "model": "<OPENAI_MODEL 的值，默认 gpt-5.4>",
           "baseUrl": "<OPENAI_BASE_URL 的值，没有则留空字符串>"
         }
       }
     }
   }
   ```
   如果 `~/.mindos/` 目录不存在，请先创建。

4. **验证**配置文件写入正确。

5. **停止旧的 MindOS 进程**（next dev、mcp server 等）。

6. **用新命令启动：**
   ```bash
   mindos start
   ```
   （首次运行会自动构建，可能需要一两分钟。）

7. **确认** http://localhost:3456 可以访问，http://localhost:8781/mcp 的 MCP 服务也在运行。

不要删除旧的克隆仓库，保留作为备份。`app/.env.local` 也可以保留作参考。
```
