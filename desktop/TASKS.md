# Desktop 优化任务

## P0：影响用户日常使用

### [ ] Node 检测启动慢
- **文件**: `desktop/src/node-detect.ts`
- **问题**: Shell login 检测每个 shell 5s 超时，两个 shell 合计可能卡 10s
- **修复**: 加总超时上限 3s，第一个成功立即停止

### [ ] Overlay 注入静默失败
- **文件**: `desktop/src/main.ts` (injectOverlay / removeOverlay)
- **问题**: `.catch(() => {})` 吞掉所有错误，模式切换注入失败时用户看到白屏无提示
- **修复**: 记录错误到 console + crash.log，发送事件到 renderer 显示 toast

### [ ] Respawn 后没做 health check
- **文件**: `desktop/src/process-manager.ts` (setupCrashHandler)
- **问题**: crash 后 respawn 新进程，没验证 /api/health 就当作恢复成功
- **修复**: respawn 后轮询 health check，不健康则继续计入 crash count

## P1：提升可靠性

### [ ] Bundled runtime 完整性没验证
- **文件**: `desktop/src/mindos-runtime-layout.ts`
- **问题**: 只看 server.js 存在，不检查 app/public/、app/.next/static/ 是否完整。DMG 提取不完整时页面无样式
- **修复**: 新增 `isBundledRuntimeIntact()` 检查关键目录存在

### [ ] Splash "切换远程" 没验证连接信息
- **文件**: `desktop/src/main.ts` (handleSplashAction)
- **问题**: 点 "Switch to Remote" 但没配过远程服务器 → 空白界面
- **修复**: 验证有可用连接信息后再切换，否则在 splash 显示错误

### [ ] 断连检测延迟
- **文件**: `desktop/src/connection-monitor.ts`
- **问题**: 第一次断连要等 1s 重试失败后才通知 UI，用户看到短暂白屏
- **修复**: 断连时立即触发 onLost 回调，重试逻辑独立运行

### [ ] MCP transport 未文档化
- **文件**: `desktop/src/process-manager.ts`
- **问题**: Desktop 硬编码 MCP_TRANSPORT=http，用户若按 stdio 配置会静默失败
- **修复**: 文档说明 Desktop 模式固定使用 HTTP transport

## P2：代码质量

### [ ] ProcessManager 没有启动耗时统计
- **文件**: `desktop/src/process-manager.ts`
- **问题**: 启动慢时日志看不出时间花在哪里
- **修复**: 各阶段记录 elapsed 时间（detect / build / spawn / health）

### [ ] Node 检测顺序未优化
- **文件**: `desktop/src/node-detect.ts`
- **问题**: 7 个检测步骤没有按命中率排序，低概率的 shell login 检测放在最后但超时最长
- **修复**: 按 bundled → system → nvm → which → shell 排序，加总超时上限

### [ ] MCP health check socket 超时太宽
- **文件**: `desktop/src/process-manager.ts` (checkMcpHealth)
- **问题**: 1500ms HTTP 超时包含 socket 创建时间，MCP 启动卡住时等太久
- **修复**: 分离 socket timeout 和 response timeout

### [ ] Overlay 注入未考虑 CSP
- **文件**: `desktop/src/main.ts`
- **问题**: 用 innerHTML 注入可能被 CSP 拦截，无降级方案
- **修复**: 用 insertAdjacentHTML 或添加 CSP 预检
