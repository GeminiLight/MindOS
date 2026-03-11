# MindOS CLI 开发笔记

## 当前命令全景（截至 2026-03-12）

```
mindos onboard                      交互式初始化，写入 ~/.mindos/config.json
mindos onboard --install-daemon     初始化 + 安装并启动后台服务（一键）
mindos start                        前台启动 app + MCP server（生产，自动检测版本重建）
mindos start --daemon               安装并以后台 OS 服务方式启动
mindos start --verbose              前台启动 + 详细 MCP 日志
mindos dev                          前台启动（开发模式，热更新）
mindos dev --turbopack              开发模式 + Turbopack
mindos dev --verbose                开发模式 + 详细 MCP 日志
mindos stop                         停止前台进程（读 PID 文件，fallback 到 pkill）
mindos restart                      stop + start
mindos build                        手动构建生产版本
mindos mcp                          仅启动 MCP server
mindos token                        查看当前 auth token 及 MCP config 片段
mindos gateway install              安装后台服务（systemd / launchd）
mindos gateway uninstall            卸载后台服务
mindos gateway start                启动后台服务
mindos gateway stop                 停止后台服务
mindos gateway status               查看后台服务状态
mindos gateway logs                 tail 后台日志（journalctl 或 tail）
mindos doctor                       健康检查（config/mindRoot/AI key/Node版本/构建/端口/daemon）
mindos update                       npm install -g mindos@latest + 清除 build stamp
mindos logs                         tail -f ~/.mindos/mindos.log（顶级命令，--follow/-f 可选）
mindos config show                  打印当前配置（API key 脱敏）
mindos config validate              验证必填字段和格式
mindos config set <key> <val>       更新单字段（支持点号 dot-notation）
```

向后兼容别名：`init` / `setup` → 等同于 `onboard`（不对外宣传）

---

## 今天做的事

### 1. `mindos start --daemon` + `mindos service` 子命令

**背景：** `mindos start` 是前台进程，关掉终端就死。用户需要一个能在后台持续运行、崩溃自动重启的模式。

**实现：**
- Linux：写 systemd user unit → `~/.config/systemd/user/mindos.service`
  - `systemctl --user daemon-reload / enable / start / stop / status`
  - 日志追加到 `~/.mindos/mindos.log`（`StandardOutput=append:`）
  - `EnvironmentFile=-~/.mindos/env` 支持可选覆盖
- macOS：写 LaunchAgent plist → `~/Library/LaunchAgents/com.mindos.app.plist`
  - `launchctl bootstrap / bootout / kickstart / print`
  - `RunAtLoad=true` + `KeepAlive=true`
- 平台检测：`process.platform === 'linux'` → systemd，`darwin` → launchd，其他打 warning 并 fallback 到前台
- node 路径用 `process.execPath`（nvm 环境安全），CLI 路径用 `resolve(__dirname, 'cli.js')`
- `mindos start --daemon` = `service install` + `service start` 一步完成
- `--daemon` flag 从 `extra` 里过滤掉，不透传给 Next.js

**关键文件：** `bin/cli.js`（175–355 行）

---

### 2. `init` → `onboard`，对齐 openclaw 命名

**背景：** `init` 是技术词，`onboard` 更有品牌感，openclaw 也用这个词。

**改动范围：**
- `bin/cli.js`：新增 `onboard` 命令（含 `--install-daemon` 逻辑），保留 `init`/`setup` 为静默别名
- `scripts/setup.js`：注释更新
- `README.md` / `README_zh.md` / `mcp/README.md` / `templates/README.md` / `note.md` / `scripts/upgrade-prompt.md`：全部 `mindos init` → `mindos onboard`

**`onboard --install-daemon` 流程：**
1. 运行 `scripts/setup.js`（交互向导）
2. 检测平台
3. `service install` → `service start`
4. 打印操作后提示（logs / stop / uninstall）

---

## OpenClaw CLI 参考研究（2026-03-12）

openclaw 是一个自托管 AI 网关，多平台消息路由（WhatsApp/Telegram/Slack/Discord/iMessage/…）。
npm 包名 `openclaw`，latest `2026.3.8`，Node >= 22。

### openclaw 完整命令

```
openclaw onboard                     交互式 wizard
openclaw onboard --install-daemon    wizard + daemon 安装
openclaw gateway run                 前台（debug）
openclaw gateway start               后台 daemon
openclaw gateway stop / restart / status / install
openclaw doctor                      健康检查 + 迁移
openclaw agent --message "..."       终端直接对话
openclaw message send                编程式发消息
openclaw pairing approve <ch> <code> 批准未知 DM 发送方
openclaw nodes / devices             iOS / Android 节点管理
openclaw update --channel stable|beta|dev
openclaw config show / set / validate
openclaw logs --follow --plain
openclaw skills                      插件管理
```

### 值得 MindOS 借鉴的点（含优先级）

| 功能 | 状态 | 说明 |
|---|---|---|
| `service` → `gateway` 重命名 | ✅ 已实现 | 语义更准确，MCP server 本质就是 gateway |
| `mindos doctor` | ✅ 已实现 | 检查 config/mindRoot/AI key/Node版本/构建/端口/daemon |
| `mindos update` | ✅ 已实现 | `npm install -g mindos@latest` + 清除 build stamp |
| `mindos logs` 提升为顶级命令 | ✅ 已实现 | 默认 `tail -f`，daemon 模式下有意义 |
| `mindos config show/set/validate` | ✅ 已实现 | 避免用户手动改 JSON，支持 dot-notation |
| `--verbose` flag on start/dev | ✅ 已实现 | 透传 `MCP_VERBOSE=1` 给 MCP server |

### 实现细节

#### `mindos doctor` 检查项
1. config 文件存在且 JSON 合法
2. `mindRoot` 字段存在，路径存在（warning if not）
3. AI provider 配置及对应 API key 存在
4. Node.js 版本 >= 18
5. `app/.next` 构建状态（不存在 / 过期 / 最新）
6. web port / mcp port 是否在监听
7. daemon 状态（systemd `is-active` / launchd `print`）

#### `mindos update` 逻辑
- `npm install -g mindos@latest`
- 删除 `BUILD_STAMP` → 下次 `mindos start` 自动重建
- 比较版本号，打印 `old → new`

#### `mindos config set` 设计
- 支持 dot-notation：`ai.provider`、`ai.providers.anthropic.apiKey`
- 数字自动 coerce：`port 3002` → `"port": 3002`
- 直接写回 `~/.mindos/config.json`

---

### 3. `printStartupInfo` 远程服务器友好提示

**背景：** 通过 SSH 连接服务器运行 `mindos start` 时，打印的 `localhost` URL 在本地浏览器打不开，因为 localhost 指向用户自己的机器而非服务器。

**改动：**
- Network URL 颜色从 `dim` 改为 `cyan`，与 localhost 一致，更醒目
- 检测到有网卡 IP 时，在 URL 列表下方追加一行提示：
  ```
  💡 Running on a remote server? Open the Network URL (x.x.x.x) in your browser,
     or use SSH port forwarding: ssh -L <port>:localhost:<port> user@x.x.x.x
  ```
- 纯本机运行（无 localIP）时不显示此提示

**关键文件：** `bin/cli.js` `printStartupInfo()`

---

### 4. `npm not found` 友好错误提示

**背景：** 用户通过 nvm/fnm/volta 安装 Node.js 时，npm 只在交互式 shell 中可用，`/bin/sh` 找不到，导致 `ensureAppDeps()` 报 `npm: command not found` 并反复循环，没有任何指引。

**改动：**
- `ensureAppDeps()`：执行 `npm install` 前先 `npm --version` 探测，找不到则立即退出并打印原因 + 修复方式（将 Node bin 路径加入 `~/.profile`）
- `mindos doctor`：新增第 4b 项检查 npm 可达性，提前发现问题

**关键文件：** `bin/cli.js` `ensureAppDeps()`、`doctor`

---

### 5. `mindos onboard --install-daemon` 启动等待体验

**背景：** `systemctl start` 返回后 `is-active` 立刻变为 active（进程存在），但服务进程内部还要跑 `npm install` + `next build`（可能几分钟）。之前打印 `✔ Service started` 就结束，用户去浏览器开页面什么都没有，完全无感知。

**根本问题：** `is-active` ≠ HTTP 服务 ready。

**改动：**
- 新增 `waitForHttp(port)` 函数：轮询 `HTTP HEAD 127.0.0.1:<port>/`，最多 120 次（每次 2s，共 4 分钟），每次打一个点显示进度
- `start --daemon` 流程：`runGatewayCommand('start')` 之后调用 `waitForHttp`，HTTP 200 才算真正 ready
- 等待期间提示用户可用 `mindos logs` 跟踪进度
- 超时则打印错误并 `process.exit(1)`，不无声失败

**新流程：**
```
systemctl start
  → 提示"第一次启动可能需要几分钟..."
  → 提示"可用 mindos logs 跟踪进度"
  → Waiting for Web UI to be ready..........✔
  → 打印 MCP 配置 + ✔ MindOS is running as a background service
```

**关键文件：** `bin/cli.js` `waitForHttp()`、`start --daemon` 分支

---

---

### 6. `mindos update` 自动重启 daemon

**背景：** `mindos update` 只做 `npm install -g mindos@latest` + 清除 build stamp，然后提示用户手动 `mindos start`。daemon 场景下服务还在用旧版本跑，需要用户自己重启，体验差。

**改动：** 版本升级后检测 daemon 是否在跑，在跑则自动 stop + start + 等待 HTTP ready：

```
mindos update
  → npm install -g mindos@latest
  → 版本没变 → "Already on latest" 退出
  → 版本升了 → ✔ Updated x.x.x → x.x.x
      → 检测 daemon
        → 没跑：提示 "run mindos start"
        → 在跑：stop → start → waitForHttp → ✔ MindOS restarted and ready.
```

**关键文件：** `bin/cli.js` `update`（改为 async）

---

### 不适合 MindOS 的

- in-chat commands（`/status`、`/think`）：MindOS 用标准 MCP 协议，不是自己的消息通道
- pairing/DM policy：MindOS 是本地单用户工具
- release channels（stable/beta/dev）：当前规模不需要
- Tailscale integration：进阶功能，非当前优先级
