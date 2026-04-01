# MindOS Desktop 审计报告

> 2026-04-01 全面审计，覆盖 main.ts / process-manager.ts / connect-window.ts / connect-renderer.ts / ssh-tunnel.ts / connection-sdk.ts / connection-monitor.ts / updater.ts / node-detect.ts / node-bootstrap.ts / mindos-runtime-*.ts / install-cli-shim.ts / port-finder.ts

## P0 — 会导致崩溃或孤儿进程

### #1 `processManager.start()` 被调用两次

- **文件**: `main.ts:467-482 + 627-628`
- **现象**: `startLocalMode()` 在 L465 创建 processManager，L467-482 有 EADDRINUSE 重试逻辑已调用 `start()`，L627 **又调了一次** `start()`
- **影响**: 本地模式每次启动执行两次 start()，产生重复子进程
- **根因**: L467-482 是后来插入的重试逻辑，忘记删除 L627 原有的 start 调用
- **修复**: 删除 L627-628 的重复 start 调用

### #2 respawn 没调 `guardSpawnError`

- **文件**: `process-manager.ts:522-528`
- **现象**: 崩溃重启的子进程如果遇到 ENOENT（node binary 被删），'error' 事件无 handler
- **影响**: unhandled 'error' 事件直接 crash 整个 Electron 进程
- **修复**: respawn 后对新进程调用 `guardSpawnError()`

### #3 `startMcpOnPort()` 不杀旧 MCP 进程

- **文件**: `process-manager.ts:54-61`
- **现象**: 直接 spawn 新 MCP 并覆盖 `this.mcpProcess` 引用，旧进程变孤儿
- **影响**: 端口占用、资源泄漏
- **修复**: spawn 前 kill 旧的 mcpProcess

### #4 SSH retry 中关闭窗口 → crash

- **文件**: `connect-window.ts:224-257`
- **现象**: retry loop 的 `await setTimeout` 期间用户关窗口，后续 `win.close()` 对 destroyed window 调用抛异常
- **影响**: Electron 进程 crash
- **修复**: 检查 `win.isDestroyed()` 后再调用 close；或 retry loop 中检查 window 存活状态

### #5 `showModeSelectWindow` 可能 resolve 出 URL 字符串

- **文件**: `connect-window.ts:497`
- **现象**: SSH 连接成功时通过 `registerSshHandlers` 的 resolve 返回完整 URL（如 `http://localhost:12345`），但调用方 `showModeSelectWindow()` 期望 `'local' | 'remote' | null`
- **影响**: `handleChangeMode` 拿到 URL 字符串当 mode 用，逻辑错乱
- **修复**: registerSshHandlers 用独立的 resolve，或在 mode-select 窗口中 SSH 连接成功时 resolve('remote') 而非 URL

---

## P1 — 功能异常或体验严重受损

### #6 事件监听器泄漏

- **文件**: `main.ts:494, 539, 623`
- **现象**: 每次 `startLocalMode()`（包括 retry、mode switch）都对 processManager 注册新的 crash / mcp-port-blocked / status-change 监听器
- **影响**: retry 3 次 → 3 套重复监听器 → crash 弹窗弹 3 次
- **修复**: 每次 `startLocalMode()` 创建新 processManager 后只绑一次；或注册前 `removeAllListeners()`

### #7 `handleSplashAction('switch-remote')` 验证逻辑错误

- **文件**: `main.ts:1168-1187`
- **现象**: 检查 `cfg.remoteUrl || cfg.connections?.length`，但这两个字段从未被使用；`startRemoteMode()` 读的是 `getActiveRemoteConnection()` 和 `getLastSshConnection()`
- **影响**: 用户首次选"切到远程"时被错误拦截，显示"未配置远程连接"
- **修复**: 删除这段验证，直接进入 remote mode（`startRemoteMode` 本身会 fallback 到 `showConnectWindow()`）

### #8 SSH 连接存到 recent list 但不可用

- **文件**: `connect-window.ts:235-239`, `connect-renderer.ts:484-489`
- **现象**: SSH 连接保存地址为 `ssh://host:port`，点击后填入 HTTP 地址栏，Test Connection 必定失败
- **影响**: recent list 中的 SSH 条目完全不可用，用户困惑
- **修复**: recent list 中 SSH 条目应切换到 SSH tab 并填入 host/port；或在 HTTP panel 中过滤掉 `ssh://` 前缀的条目

### #9 `before-quit` 没有超时保护

- **文件**: `main.ts:1370`
- **现象**: `processManager.stop()` 可能 hang（子进程不响应 SIGTERM）
- **影响**: app 永远无法退出，用户只能 force quit
- **修复**: 加 10s 超时，超时后强制 `app.exit(1)`

### #10 crash handler async 回调和 `stop()` 竞态

- **文件**: `process-manager.ts:477-554`
- **现象**: respawn 定时器的 async 回调在 `this.stopped` check 之后可能执行数秒（等端口），期间 stop() 设置 `this.stopped = true` 无效
- **影响**: stop() 后仍 spawn 孤儿进程
- **修复**: 在 async 回调的每个 await 点后重新检查 `this.stopped`

### #11 PID 文件 respawn 后不更新

- **文件**: `process-manager.ts:608-618`
- **现象**: `writeChildPids()` 只在 `start()` 调用一次，respawn 后新 PID 没写入
- **影响**: Desktop crash 后下次启动无法清理孤儿进程（新 PID 不在文件里）
- **修复**: respawn 成功后调用 `writeChildPids()`

### #12 Node.js 检测不验证版本

- **文件**: `node-detect.ts:50-133`
- **现象**: `getNodePath()` 找到任何 node binary 就返回，不检查版本
- **影响**: 系统有 Node 14/16（低于 18+ 要求）时使用，运行时 ES 语法/API 缺失而崩溃
- **修复**: 找到 node 后执行 `node --version`，低于 18 则跳过

### #13 `analyzeMindOsLayout` 不检查 `mcp/dist/index.cjs`

- **文件**: `mindos-runtime-layout.ts:99`
- **现象**: 只检查 `mcp/` 目录存在，但 MCP 二进制缺失时仍声明 `runnable=true`
- **影响**: spawn MCP 时才崩溃，无前置诊断
- **修复**: `runnable` 条件加上 `existsSync(path.join(mcpDir, 'dist', 'index.cjs'))`

### #14 `activeRecoveryPoll` 超时后不清理 UI 状态

- **文件**: `main.ts:585`
- **现象**: 5 分钟后 clearInterval，但 overlay 和 tray 状态永远卡在 "Updating..."
- **影响**: 用户无法操作，无退出按钮，必须 force quit
- **修复**: 超时后 removeOverlay + refreshTray('error') + 弹窗提示

### #15 `did-fail-load` / `did-finish-load` 监听器重复注册

- **文件**: `main.ts:1253, 1268`
- **现象**: `bootApp()` 可能被 retry 多次调用，每次都添加新监听器
- **影响**: retry 后一次 load 失败弹 N 个 dialog
- **修复**: 监听器注册移到 `createMainWindow()` 内（只注册一次），或注册前检查

### #16 Windows CLI shim npm fallback 不工作

- **文件**: `install-cli-shim.ts:94-98`
- **现象**: `%NPM_CLI%` 在 cmd.exe batch 中 parse-time 展开（在 for 循环执行前），需要 `enabledelayedexpansion` + `!NPM_CLI!`
- **影响**: Windows 用户卸载 Desktop 后 `mindos` 命令永远找不到 npm 全局安装
- **修复**: 加 `setlocal enabledelayedexpansion`，变量改用 `!NPM_CLI!`

### #17 `switchToMode` revert 路径不恢复端口/地址

- **文件**: `main.ts:928-929, 951-958`
- **现象**: 失败时恢复了 processManager 和 connectionMonitor，但 `currentWebPort`/`currentRemoteAddress` 已在 L928-929 被清空
- **影响**: revert 后 tray 显示缺少端口/地址信息
- **修复**: 切换前保存旧的端口/地址，revert 时恢复

---

## P2 — 体验问题或边缘 case

### #18 Desktop 更新不触发 MindOS 核心更新

- **文件**: `updater.ts:69-74`
- **现象**: electron-updater 只更新壳（Electron），不更新 bundled runtime 或全局 npm 安装
- **影响**: 用户可能跑新壳 + 旧 MindOS 核心。目前缓解策略是 electron-builder 发版时带新 bundled runtime，但需要频繁发 Desktop release
- **建议**: npm publish 后自动触发 build-desktop CI；或 Desktop 启动时对比 bundled 版本和 npm latest，提示用户

### #19 更新检查只启动时一次

- **文件**: `updater.ts:77-79`
- **现象**: 10s 后检查一次，之后不再检查
- **影响**: 长时间运行的 app 永远不知道有新版
- **建议**: 加定时检查（如每 12 小时）

### #20 密码通过 HTTP 明文传输

- **文件**: `connect-window.ts:170-173`
- **现象**: 远程连接 `/api/auth` POST 走 HTTP，密码明文
- **影响**: 安全风险（局域网抓包可见）
- **建议**: 非 localhost 且非 HTTPS 时显示警告

### #21 SSH `BatchMode=yes` 导致 passphrase key 静默失败

- **文件**: `ssh-tunnel.ts:171`
- **现象**: 用户有 passphrase 保护的 SSH key 时只看到 "Permission denied"
- **影响**: 用户不知道需要 ssh-agent
- **建议**: 检测 stderr 中的 passphrase 相关信息，提示 "请先运行 ssh-add"

### #22 SSH tunnel 存活检测是 5s 超时启发式

- **文件**: `ssh-tunnel.ts:190-195`
- **现象**: SSH 进程 5 秒内没退出就认为隧道成功，不探测端口
- **影响**: 慢网络下误判成功
- **建议**: 启发式通过后尝试 TCP connect 本地端口验证

### #23 SSH tunnel 挂掉后无通知

- **文件**: `ssh-tunnel.ts:197-206`
- **现象**: tunnel 进程 exit 只设 `this.process = null`，不触发事件
- **影响**: 依赖 ConnectionMonitor 的 health check 延迟发现（30s+）
- **建议**: 加 EventEmitter 或 callback，tunnel 死亡后立即通知

### #24 不可重试的 SSH 错误仍重试 3 次

- **文件**: `connect-window.ts:224-257`
- **现象**: "Permission denied" / "Host key verification failed" 等不可重试错误也等 3×backoff
- **影响**: 浪费 25s+ 等待
- **建议**: 解析 stderr，auth 失败/host key 失败直接 return

### #25 SSH 连接无取消按钮

- **文件**: `connect-renderer.ts:776-815`
- **现象**: 按钮 disabled 后无法中止，retry loop 最长 25s+
- **影响**: 用户只能等或关窗口
- **建议**: 加 Cancel 按钮，通过 IPC 通知 main 进程 abort

### #26 NVM 版本排序可能选 nightly

- **文件**: `node-detect.ts:76-83`
- **现象**: `readdirSync` + reverse localeCompare 选最高版本目录，可能选到 nightly/rc
- **影响**: 使用不稳定 Node 版本
- **建议**: 过滤掉含 `-` 的版本号（nightly/rc/alpha/beta）

### #27 `getNpxPath` 找不到 npx 时返回 npm

- **文件**: `node-detect.ts:183-191`
- **现象**: 期望 npx 但返回 npm，参数不兼容
- **影响**: 命令执行失败
- **建议**: 找不到 npx 时返回 null，让调用方处理

### #28 Node.js 下载不验证 checksum

- **文件**: `node-bootstrap.ts:84-88`
- **现象**: 下载的 tarball/zip 直接解压，无 SHA256 校验
- **影响**: 损坏下载或 MITM 攻击
- **建议**: 对照 nodejs.org 的 SHASUMS256.txt 验证

### #29 `spawnWithEnv` 超时后双 resolve

- **文件**: `main.ts:866-876`
- **现象**: SIGKILL 后 exit 事件 `code === null` 走到 resolve，和 timer 的 reject 竞争
- **影响**: Promise 取第一个（reject），后续 resolve 被忽略。逻辑正确但代码有误
- **修复**: exit handler 中检查 `killed` 标记，超时 kill 后不 resolve

### #30 `crashDialogShown` 永不重置

- **文件**: `main.ts:490, 587`
- **现象**: 设为 true 后服务恢复再崩溃 3 次也不再弹窗
- **影响**: 用户不知道服务又挂了
- **建议**: 服务恢复正常后重置 `crashDialogShown = false`

### #31 tray 创建失败时 macOS hide-on-close 变无头进程

- **文件**: `main.ts:240-241, 1361`
- **现象**: 窗口 close 被 preventDefault + hide，但 tray 失败后无 UI 入口
- **影响**: app 无法退出
- **建议**: tray 创建失败时不 preventDefault，让窗口正常关闭

### #32 `lastStderr` 每次覆盖而非追加

- **文件**: `process-manager.ts:453-456`
- **现象**: `lastStderr = chunk.toString()` 覆盖，EADDRINUSE 可能在前一个 chunk
- **影响**: 端口冲突检测失败
- **修复**: 改为追加（ring buffer 或保留最后 N 行）

### #33 MCP crash 日志输出 web 进程的 stderr

- **文件**: `process-manager.ts:472-473`
- **现象**: `logCrash` 和 `crash` event 都传 `this.webStderrLines`，不区分 which
- **影响**: MCP crash 诊断信息完全错误
- **修复**: 给 MCP 也维护 `mcpStderrLines`，crash event 传对应的 stderr

### #34 `connectInProgress` 成功后不重置

- **文件**: `connect-renderer.ts:594`
- **现象**: 成功后 flag 不重置，按钮永远 "Connected" + disabled
- **影响**: 窗口不自动关闭时无法重试
- **修复**: 成功或失败后都重置 flag

### #35 port finder 只试 10 个端口

- **文件**: `port-finder.ts:25`
- **现象**: 范围 port ~ port+9，Docker 等可能连续占满
- **影响**: 启动失败无 fallback
- **建议**: 增加到 20-30；或最终 fallback 到 `port 0`（OS 随机分配）

### #36 macOS `exec('sleep 1')` 同步阻塞主线程

- **文件**: `main.ts:848`
- **现象**: `cleanupConflictingLaunchdService` 中用 `exec('sleep 1')`
- **影响**: 主线程阻塞 1 秒，可能导致 splash 卡顿
- **修复**: 删除（findAvailablePort 已有兜底），或改 async

### #37 config 系统无文件锁

- **文件**: `main.ts:158-165`
- **现象**: read-modify-write 无原子性，Web 服务和 Desktop 进程并发写可能丢失
- **影响**: config 覆盖（概率低但存在）
- **建议**: 短期可接受；长期考虑 `proper-lockfile` 或 atomic-write

### #38 respawn 后 `captureStderr` 未调用

- **文件**: `process-manager.ts:522-528`
- **现象**: 新 web 进程的 stderr 不被收集到 `webStderrLines`
- **影响**: 第二次+ crash 诊断信息为空
- **修复**: respawn 后对新 web 进程调用 `captureStderr()`

### #39 SSH config 不解析 `Include` 指令

- **文件**: `ssh-tunnel.ts:75-115`
- **现象**: 用户在 `~/.ssh/config` 中用 `Include` 引入的 host 不出现在 datalist
- **影响**: 体验不完整
- **建议**: 递归解析 Include 的文件

### #40 `select-mode` action 用户取消后仍 boot

- **文件**: `main.ts:1198-1208`
- **现象**: `showModeSelectWindow()` 返回 null（用户关窗口）后，仍创建 splash 并 bootApp
- **影响**: 用户取消后 app 以旧 mode 启动
- **修复**: mode 为 null 时跳过 boot

---

## 已修复的问题

### ✅ 每次启动都 "Installing dependencies..."

- **日期**: 2026-04-01
- **根因**: `isNextBuildCurrent()` 要求 `.mindos-build-version` stamp 文件存在，但外部构建（CLI / npm run build / bundled runtime）不写 stamp
- **修复**:
  1. `mindos-runtime-layout.ts`: stamp 不存在时信任 valid build（降级策略）
  2. `prepare-mindos-runtime.mjs`: 打包时写入 stamp
  3. `scripts/write-build-stamp.js` + `app/package.json` postbuild: next build 后自动写 stamp

### ✅ P0 #1: `processManager.start()` 被调用两次

- **日期**: 2026-04-01
- **根因**: L467-482 的 EADDRINUSE 重试逻辑已调用 start()，L627 又调了一次
- **修复**: 删除 L627-643 的重复 start 块，startupComplete/splashStatus 合并到 L482 后

### ✅ P0 #2: respawn 没调 `guardSpawnError`

- **日期**: 2026-04-01
- **根因**: 崩溃重启路径 L522-528 只调 setupCrashHandler，不调 guardSpawnError
- **修复**: respawn 后对新进程调用 `guardSpawnError()` + `captureStderr()`（web）+ `writeChildPids()`

### ✅ P0 #3: `startMcpOnPort()` 不杀旧 MCP 进程

- **日期**: 2026-04-01
- **根因**: 直接 spawn 新 MCP 并覆盖引用，旧进程变孤儿
- **修复**: spawn 前检查并 SIGTERM 旧 mcpProcess + writeChildPids()

### ✅ P0 #4: SSH retry 中关闭窗口 → crash

- **日期**: 2026-04-01
- **根因**: retry loop 期间 win.close() 对 destroyed window 调用抛异常
- **修复**: 引入 safeClose() 辅助函数，所有 win.close() 改为 safeClose()；win 对象增加 isDestroyed 方法

### ✅ P0 #5: `showModeSelectWindow` resolve 类型不安全

- **日期**: 2026-04-01
- **根因**: registerSshHandlers 的 resolve(url) 返回完整 URL，但 showModeSelectWindow 期望 'local'|'remote'|null
- **修复**: registerSshHandlers 增加 resolveOverride 参数，mode-select 窗口传 'remote'，connect 窗口不传（用 URL）

### ✅ P1 #6: 事件监听器泄漏

- **日期**: 2026-04-01
- **根因**: startLocalMode() 创建新 processManager 前不清理旧实例的监听器
- **修复**: 创建新 PM 前 removeAllListeners() + stop() 旧实例

### ✅ P1 #7: switch-remote 验证逻辑错误

- **日期**: 2026-04-01
- **根因**: 检查不存在的 config 字段（remoteUrl/connections），阻止正常远程模式切换
- **修复**: 删除无效验证，直接进入 remote mode

### ✅ P1 #9: before-quit 没有超时保护

- **日期**: 2026-04-01
- **根因**: processManager.stop() 可能 hang，app 永远无法退出
- **修复**: Promise.race 加 8s 超时，超时后强制 exit

### ✅ P1 #13: analyzeMindOsLayout 不检查 mcp/dist/index.cjs

- **日期**: 2026-04-01
- **根因**: 只检查 mcp/ 目录存在，空目录也判为 runnable
- **修复**: runnable 条件改为检查 mcp/dist/index.cjs 或 mcp/src/ 存在

### ✅ P1 #14: activeRecoveryPoll 超时后不清理 UI 状态

- **日期**: 2026-04-01
- **根因**: 5 分钟后只清 interval，不清 overlay 和 tray 状态
- **修复**: 超时后 removeOverlay + refreshTray('error')

### ✅ P1 #15: did-fail-load / did-finish-load 监听器重复注册

- **日期**: 2026-04-01
- **根因**: bootApp() 每次调用都注册新监听器，mainWindow 复用时堆叠
- **修复**: 注册前 removeAllListeners('did-fail-load') + removeAllListeners('did-finish-load')

### ✅ P1 #17: switchToMode revert 路径不恢复端口/地址

- **日期**: 2026-04-01
- **根因**: 切换前清空了 currentWebPort/currentRemoteAddress，失败回滚时未恢复
- **修复**: 切换前保存旧值，revert 时全部恢复

### ✅ P1 #40: select-mode action 用户取消后仍 boot

- **日期**: 2026-04-01
- **根因**: showModeSelectWindow 返回 null 后无条件创建 splash 并 bootApp
- **修复**: mode 为 null 时跳过 boot

### ✅ P1 附加: dialog.showMessageBox mainWindow! 非空断言

- **日期**: 2026-04-01
- **根因**: did-fail-load 回调中 mainWindow! 在窗口销毁后 crash
- **修复**: 加 mainWindow && !mainWindow.isDestroyed() 守卫

### ✅ P1 #12: Node.js 检测不验证版本

- **日期**: 2026-04-01
- **根因**: getNodePath() 找到任何 node binary 就返回，不检查版本号
- **修复**:
  1. 加 `checkNodeVersion()` 辅助函数——执行 `node --version`，低于 18 跳过
  2. NVM 版本目录排序时过滤掉 < v18 和含 `-` 的版本（nightly/rc/alpha）
  3. 所有外部 node 发现点（env var / NVM / fnm / system / which / shell login）都过版本检查
  4. bundled 和 private node 跳过检查（版本由我们控制）

### ✅ P1 #8: SSH 连接出现在 HTTP recent list 中不可用

- **日期**: 2026-04-01
- **根因**: SSH 连接保存为 `ssh://host:port`，点击后填入 HTTP 输入框，Test Connection 必定失败
- **修复**: loadRecentConnections() 过滤掉 `ssh://` 开头的条目，HTTP panel 不再显示 SSH 连接

### ✅ P2 #19: 更新检查只启动时一次

- **日期**: 2026-04-02
- **修复**: 加 12 小时定时检查 setInterval

### ✅ P2 #21: SSH passphrase key 静默失败

- **日期**: 2026-04-02
- **修复**: 检测 stderr 中 "permission denied" 关键词，追加 ssh-add 提示

### ✅ P2 #24: 不可重试 SSH 错误仍重试 3 次

- **日期**: 2026-04-02
- **修复**: 解析 stderr，permission denied / host key verification failed / connection refused 直接 break

### ✅ P2 #27: getNpxPath 返回 npm

- **日期**: 2026-04-02
- **修复**: 找不到 npx 时返回 'npx'（让 PATH 解析），不再返回 npm

### ✅ P2 #29: spawnWithEnv 超时后双 resolve

- **日期**: 2026-04-02
- **修复**: 加 settled 标记，超时 SIGKILL 后 exit 事件不再误 resolve

### ✅ P2 #30: crashDialogShown 永不重置

- **日期**: 2026-04-02
- **修复**: status-change 为 running 时重置 crashDialogShown = false

### ✅ P2 #31: tray 创建失败变无头进程

- **日期**: 2026-04-02
- **修复**: try/catch createTray，失败时 removeAllListeners('close') 让窗口正常关闭

### ✅ P2 #32: lastStderr 覆盖丢失 EADDRINUSE

- **日期**: 2026-04-02
- **修复**: stderrChunks 追加（限 10 chunks ~2KB），join 后再检测端口冲突

### ✅ P2 #33: MCP crash 输出 web stderr

- **日期**: 2026-04-02
- **修复**: 新增 mcpStderrLines 独立维护，crash event 传对应进程的 stderr

### ✅ P2 #34: connectInProgress 成功后不重置

- **日期**: 2026-04-02
- **修复**: 成功后 2s 延迟重置 flag 和按钮

### ✅ P2 #35: port finder 只 10 个端口

- **日期**: 2026-04-02
- **修复**: 扩大到 30 个端口 + 65535 上界保护

### ✅ P2 #36: exec('sleep 1') 阻塞主线程

- **日期**: 2026-04-02
- **修复**: 删除，findAvailablePort 已有兜底
