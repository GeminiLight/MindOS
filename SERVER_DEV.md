# MindOS Dev Server

## 端口

| 服务 | 端口 | 地址 |
|------|------|------|
| Web UI | 4567 | `http://21.6.243.108:4567` |
| MCP HTTP | 8567 | `http://127.0.0.1:8567/mcp` |

## tmux session: `mindos-srv`

```bash
# 查看
tmux attach -t mindos-srv

# 启动 web（窗口 0）
MINDOS_WEB_PORT=4567 npm run dev

# 启动 mcp（窗口 1）
MCP_TRANSPORT=http MINDOS_MCP_PORT=8567 MINDOS_WEB_PORT=4567 node bin/cli.js mcp
```

## 热更新

改 `.tsx`/`.css` → 浏览器自动刷新，无需重启。

MCP 改了代码需手动重启：mcp 窗口 `Ctrl+C` → 重跑上面的命令。

## 测试安全

`npm test` 和 `git push` 不会杀 dev server（`stopMindos` 在 `NODE_ENV=test` 时跳过）。

```bash
git push                  # 跑测试，不杀 dev server
SKIP_TESTS=1 git push     # 跳过测试
```
