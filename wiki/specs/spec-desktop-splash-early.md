# Spec: Desktop 启动 Splash 提前展示

## 目标

让用户在 Desktop 启动后立刻看到 Splash 品牌画面和进度提示，而不是在 healing 期间对着空白桌面干等。

## 现状分析

当前启动顺序：
```
app.whenReady()
  → ensureMindosCliShim()
  → cleanupOrphanedSshTunnel()
  → await healPreviousInstallation()    // dirty start 可能数秒
  → needsDesktopModeSelectAtLaunch()?
    → showModeSelectWindow() 或 createSplash()
  → await bootApp()
```

问题：`healPreviousInstallation()` 在 dirty start 下可能花费 2-6 秒（端口检查 + kill + waitForPortRelease），这段时间用户看到的是空桌面——没有窗口、没有进度、没有反馈。

Why?
- "打开 App 没反应"是用户最容易觉得"卡"的场景之一。
- 即使 healing 本身不可避免，只要有视觉反馈，用户的等待容忍度会明显提高。

Simpler?
- 跳过 healing 不行（会导致端口冲突、僵尸进程）。
- 异步化 healing 风险高（可能与后续 boot 竞态）。
- 最简单且最利于用户体验的方式：**把 splash 提前到 healing 之前显示**。

## 方案

### 改后的启动顺序
```
app.whenReady()
  → ensureMindosCliShim()
  → cleanupOrphanedSshTunnel()
  → needsDesktopModeSelectAtLaunch()?
    → showModeSelectWindow()（首次）
    → 或 createSplash()（非首次）
  → await healPreviousInstallation()    // splash 已可见
  → await bootApp()
```

### 核心改动
只调整 `app.whenReady()` 回调内的函数调用顺序：
1. 把 `needsDesktopModeSelectAtLaunch()` 判断和 `createSplash()` 移到 `healPreviousInstallation()` 之前
2. healing 期间通过 `splashStatus()` 更新进度文案
3. 不改 healing 内部逻辑

### healing 期间的 splash 状态更新
在 healing 的关键阶段发送状态：
- 开始：`Checking previous installation...`
- 端口检查：`Freeing ports...`
- 校验：`Validating runtime...`

## 影响范围

- 变更文件：`desktop/src/main.ts`（仅启动顺序调整 + healing 内 splashStatus 调用）
- 不受影响：healing 内部逻辑、ProcessManager、所有其他模块
- 破坏性变更：无

## 边界 case 与风险

1. **首次启动需要先选模式**
   - 处理：`needsDesktopModeSelectAtLaunch()` 只读 config.json，不依赖 healing
   - mode picker 窗口会在 healing 之前显示，用户选完后才进入 healing + boot
2. **splash 创建失败**
   - 处理：`createSplash()` 内部已有 error 处理，不影响后续启动
3. **healing 耗时很短（clean start）**
   - 处理：splash 会快速过渡，用户几乎看不到 healing 阶段文案
4. **healing 耗时很长（dirty start）**
   - 处理：splash 持续可见，进度文案持续更新

## 验收标准

- [ ] 启动 Desktop 后立刻看到 splash，不再有空白等待期
- [ ] dirty start 时 splash 显示 healing 进度提示
- [ ] clean start 时 splash 快速过渡，不闪动
- [ ] 首次启动的 mode picker 仍正常工作
- [ ] desktop typecheck 通过
- [ ] desktop 全量测试通过
