# Spec: SSH 隧道连接远程 MindOS

## 目标

用户通过 SSH 隧道安全连接远程 MindOS 服务器，复用 `~/.ssh/config` 已有配置，无需暴露端口到公网，无需输密码。

## 现状分析

当前 Remote 模式要求用户手动输入 `http://IP:PORT`，服务器必须暴露端口到公网，数据明文传输。用户已有 SSH 配置被完全忽略。

## 数据流 / 状态流

```
用户选 SSH Host
    ↓
spawn: ssh -L {localPort}:localhost:{remotePort} {host} -N -o ExitOnForwardFailure=yes
    ↓
SSH 隧道建立（加密）
    ↓
testConnection(http://localhost:{localPort})
    ↓ 成功
mainWindow.loadURL(http://localhost:{localPort})
    ↓
connectionMonitor 监控 localhost:{localPort}
    ↓ 隧道断开
重新 spawn SSH → 自动恢复
```

## 方案

### 新文件

| 文件 | 职责 |
|------|------|
| `ssh-tunnel.ts` | 解析 ~/.ssh/config、管理 SSH 隧道进程（spawn/stop/restart） |

### 修改文件

| 文件 | 改动 |
|------|------|
| `connect-preload.ts` | 新增 IPC：`getSshHosts`、`connectSsh` |
| `connect-window.ts` | 新增 IPC handler：解析 SSH config、建立隧道 |
| `connect-renderer.ts` | Remote 页面顶部加 SSH 连接 tab |
| `connect.html` | 加 SSH 连接 UI 区域 |
| `i18n/zh.ts` + `en.ts` | SSH 相关文案 |
| `main.ts` | `startRemoteMode` 支持 SSH 隧道保存/恢复 |

### SSH Config 解析（手写，不引入依赖）

~/.ssh/config 格式简单且固定，一个 ~30 行的解析器即可：

```typescript
interface SshHost {
  name: string;        // Host alias
  hostname?: string;   // HostName (actual IP)
  user?: string;       // User
  port?: number;       // Port (SSH port, default 22)
  identityFile?: string;
}
```

### 隧道管理

```typescript
class SshTunnel {
  spawn(host: string, localPort: number, remotePort: number): ChildProcess
  stop(): Promise<void>
  isAlive(): boolean
}
```

用 `ssh -L localPort:localhost:remotePort host -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=15 -o ServerAliveCountMax=3`

### UI：Remote 页面加 SSH Tab

```
┌──────────────────────────────────────┐
│  [🔒 SSH 隧道]    [🌐 直连 HTTP]    │  ← tab 切换
├──────────────────────────────────────┤
│                                      │
│  SSH Host:  [▾ myserver         ]    │  ← 下拉，从 ~/.ssh/config 读取
│  MindOS 端口: [3456]                 │  ← 默认 3456
│                                      │
│  [连接]                              │
│                                      │
│  状态: 正在建立隧道... / 已连接      │
└──────────────────────────────────────┘
```

## 影响范围

- 新文件：`ssh-tunnel.ts`（~100 行）
- 修改 6 个文件，每个改动 < 50 行
- 无破坏性变更（HTTP 直连保持不变）

## 边界 case 与风险

| # | 场景 | 处理 |
|---|------|------|
| 1 | 无 ~/.ssh/config | SSH tab 显示 "未找到 SSH 配置" |
| 2 | SSH 密钥需要 passphrase 但无 ssh-agent | SSH 命令会卡住等输入 → 5s 超时后报错提示用户先 `ssh-add` |
| 3 | SSH Host 指向的服务器没有运行 MindOS | 隧道建立成功但 testConnection 失败 → 报错 "服务器上未检测到 MindOS" |
| 4 | 本地端口被占 | findAvailablePort 自动换端口 |
| 5 | Windows 无 ssh 命令 | 检测 `which ssh` 失败 → 隐藏 SSH tab，只显示直连 |
| 6 | SSH 隧道中途断开 | connectionMonitor 检测 → 自动重新 spawn SSH |

## 验收标准

- [ ] Remote 页面显示 SSH 隧道 + 直连 HTTP 两个 tab
- [ ] SSH tab 列出 ~/.ssh/config 中的 Host（排除通配符 `*`）
- [ ] 选择 Host + 输入端口 → 建立隧道 → 自动测试 → 成功连接
- [ ] 隧道断开后自动重连
- [ ] 无 ~/.ssh/config 或无 ssh 命令时，SSH tab 优雅降级
- [ ] 已保存的 SSH 连接下次启动自动恢复
