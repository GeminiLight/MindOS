# CLI 命令

## 核心

| 命令 | 说明 |
| :--- | :--- |
| `mindos` | 使用 `~/.mindos/config.json` 中保存的模式启动 |
| `mindos onboard` | 交互式初始化（生成配置、选择模板） |
| `mindos onboard --install-daemon` | 初始化 + 安装并启动后台服务 |
| `mindos start` | 前台启动 app + MCP 服务（生产模式） |
| `mindos start --daemon` | 安装并以后台 OS 服务方式启动（关闭终端仍运行，崩溃自动重启） |
| `mindos dev` | 启动 app + MCP 服务（开发模式，热更新） |
| `mindos dev --turbopack` | 开发模式 + Turbopack（更快的 HMR） |
| `mindos open` | 在默认浏览器中打开 Web UI |
| `mindos stop` | 停止正在运行的 MindOS 进程 |
| `mindos restart` | 停止后重新启动 |
| `mindos build` | 手动构建生产版本 |

## MCP

| 命令 | 说明 |
| :--- | :--- |
| `mindos mcp` | 仅启动 MCP 服务 |
| `mindos mcp install` | 自动将 MCP 配置写入 Agent（交互式） |
| `mindos mcp install -g -y` | 一键全局安装 |
| `mindos token` | 查看当前 Auth token 及 MCP 配置片段 |

## 同步

| 命令 | 说明 |
| :--- | :--- |
| `mindos sync` | 查看同步状态（`sync status` 的别名） |
| `mindos sync init` | 交互式配置 Git 远程同步 |
| `mindos sync status` | 查看同步状态：最后同步时间、未推送提交、冲突 |
| `mindos sync now` | 手动触发完整同步（commit + push + pull） |
| `mindos sync on` | 启用自动同步 |
| `mindos sync off` | 禁用自动同步 |
| `mindos sync conflicts` | 列出未解决的冲突文件 |

## 后台服务（Gateway）

| 命令 | 说明 |
| :--- | :--- |
| `mindos gateway install` | 安装后台服务（Linux 用 systemd，macOS 用 LaunchAgent） |
| `mindos gateway uninstall` | 卸载后台服务 |
| `mindos gateway start` | 启动后台服务 |
| `mindos gateway stop` | 停止后台服务 |
| `mindos gateway status` | 查看后台服务状态 |
| `mindos gateway logs` | 实时查看服务日志 |

## 运维

| 命令 | 说明 |
| :--- | :--- |
| `mindos doctor` | 健康检查（配置、端口、构建、daemon 状态） |
| `mindos update` | 更新 MindOS 到最新版本 |
| `mindos uninstall` | 完整卸载 MindOS（停止进程、移除 daemon、npm 卸载） |
| `mindos logs` | 实时查看服务日志（`~/.mindos/mindos.log`） |
| `mindos config show` | 查看当前配置（API Key 脱敏显示） |
| `mindos config validate` | 验证配置文件 |
| `mindos config set <key> <val>` | 更新单个配置字段 |
