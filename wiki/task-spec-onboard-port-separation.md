# Onboarding 端口分离

## 问题

当前 `mindos onboard` 选择 GUI 模式时，Setup Wizard 和正式服务共用同一端口：

1. `startGuiSetup()` 用 `config.port`（默认 3000）启动服务
2. 用户在 Step 3 改端口（如 3000 → 4000），此时服务仍在 3000 运行
3. Complete 后写 `port: 4000` 到 config，返回 `needsRestart: true`（但首次 onboard 被跳过）
4. 首次 onboard 直接 redirect 到当前端口，没有重启到用户选择的端口

**问题**：onboard 和正式服务端口耦合。首次 onboard 的端口直接写入 config（覆盖用户选择），改端口场景体验割裂。

## 方案：首次用临时端口，re-onboard 复用已有服务

### 两种场景分别处理

| 场景 | 启动端口 | 结束行为 |
|------|---------|---------|
| 首次 onboard（无 `mindRoot`） | 临时端口 9100+（扫描可用） | 写 config → restart 到正式端口 → redirect |
| re-onboard（服务已运行） | 复用当前服务端口 | 有变更才 restart；无变更直接 redirect |
| re-onboard（服务未运行） | 已有端口或 9100+ fallback | 同首次 |

### 临时端口选择

从 **9100** 起扫描（`findFreePort(9100)`），已有 +1 逻辑自动跳过被占用的端口。

选 9100 而非 5000 的原因：macOS Monterey+ 的 AirPlay Receiver 占用 5000，3000/8080 是常见开发端口。

### 用户流程（首次）

```
mindos onboard → 选 GUI →
  findFreePort(9100) → 9100 可用 →
  启动服务在 localhost:9100 →
  浏览器打开 http://localhost:9100/setup →
  Step 3 配置正式端口 3000 →
  Complete → config 写入 port: 3000, needsRestart: true →
  Step 6 RestartBlock → 用户点 Restart →
  服务重启到 3000 → poll → redirect 到 http://localhost:3000/?welcome=1
```

### 用户流程（re-onboard，服务已运行）

```
mindos onboard → 选 GUI →
  检测 config.port=3000 已有 MindOS 服务运行 →
  直接打开 http://localhost:3000/setup → 不额外启动进程 →
  用户修改配置 → Complete →
  有变更 → RestartBlock → restart → redirect
  无变更 → 直接 redirect
```

## 已实现的改动

### 1. `scripts/setup.js` — `startGuiSetup()`

- 首次 onboard：`findFreePort(9100)` 分配临时端口，**不写入 config**
- re-onboard 且服务已运行：`isSelfPort()` 检测 → 直接打开 setup 页面，不 spawn 新进程
- re-onboard 且服务未运行：尝试用 config 端口，被占用则 fallback 到 9100+

### 2. `app/app/api/setup/route.ts` — `needsRestart` 逻辑

```javascript
// 首次 onboard 始终 restart（临时端口 → 正式端口）
// re-onboard 仅在配置变更时 restart
const isFirstTime = current.setupPending === true || !current.mindRoot;
const needsRestart = isFirstTime || (
  webPort !== (current.port ?? 3000) ||
  mcpPortNum !== (current.mcpPort ?? 8787) ||
  resolvedRoot !== (current.mindRoot || '') ||
  resolvedAuthToken !== (current.authToken ?? '') ||
  resolvedWebPassword !== (current.webPassword ?? '')
);
```

### 3. `app/components/SetupWizard.tsx` — Step 3

- `portRestartWarning` 图标从 ⚠️ 改为 ℹ️（`AlertTriangle` → `Info`）
- RestartBlock 保留手动点击（避免自动 restart 失败时白屏无法恢复）

### 4. `app/lib/i18n.ts`

- EN: `'The service will start on these ports after setup completes.'`
- ZH: `'完成配置后，服务将以这些端口启动。'`

## 文件变更清单

| 操作 | 文件 | 改动量 |
|------|------|--------|
| 修改 | `scripts/setup.js` — `startGuiSetup()` | ~30 行重写 |
| 修改 | `app/app/api/setup/route.ts` — `needsRestart` | ~3 行 |
| 修改 | `app/components/SetupWizard.tsx` — Step 3 图标 + import | ~2 行 |
| 修改 | `app/lib/i18n.ts` — 端口提示文案 | ~2 行 |

## 不需要改的

- `findFreePort()` — 已有 +1 扫描逻辑
- `RestartBlock` — redirect/poll 逻辑已正确使用 `newPort`（= `state.webPort`）
- CLI 模式 — 不受影响（直接写 config，不启动服务）

## 验证

1. 首次 `mindos onboard` → GUI → 确认服务在 9100（或 910x）启动
2. Step 3 配 3000 → Complete → RestartBlock 出现 → Restart → redirect 到 3000
3. 9100 被占用 → 确认自动使用 9101
4. re-onboard（服务在 3000 运行）→ 直接打开 setup 页面，不额外启动进程
5. re-onboard 改端口 → restart 到新端口
6. re-onboard 不改任何配置 → 不触发 restart（`needsRestart = false`）
7. CLI 模式不受影响
