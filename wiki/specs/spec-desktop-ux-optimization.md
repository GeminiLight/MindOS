# Spec: Desktop UX — 模式切换优化 + 体验提升

## 目标

让用户在 Local/Remote 模式间无摩擦切换，消除首次启动的卡顿感，提升日常使用的流畅度。

## 现状分析

### 当前模式切换流程问题

```
用户点 Tray "Switch to Remote"
  → IPC switch-mode
  → await processManager.stop() (5-10秒)
  → showConnectWindow() (弹新窗口)
  → 用户输入服务器地址 + 密码
  → mainWindow.loadURL(newUrl)
  → 过程中主窗口内容消失，白屏等待
```

**痛点：**
1. 切换过程无过渡——主窗口直接白屏 5-10 秒
2. 只能通过 Tray 菜单切换，操作路径深（右键 → 找菜单项 → 点击）
3. Local→Remote 需要填服务器信息，中间弹出独立窗口，割裂感强
4. 切换失败（如服务器不可达）后无法回退到原模式，直接显示错误页
5. Remote→Local 如果 Node.js/MindOS 未安装，死在安装流程里

### 当前体验问题

| 问题 | 严重度 | 现象 |
|------|--------|------|
| 启动时无反馈 | 高 | 点击 app → 等 3-15 秒 → 窗口突然出现，用户不知道发生了什么 |
| 进程启动失败只有 tray 红灯 | 高 | 主窗口显示白屏或错误 HTML，没有重试/切换选项 |
| 远程连接断开后无 UI | 中 | connection-lost IPC 发送了但主窗口没处理 |
| 二次启动的 Local 模式等 Next.js 启动 | 中 | 每次重启都要等 30-120 秒进程启动 |
| 更新后首次启动需要 rebuild | 中 | 用户不知道为什么比平时慢很多 |
| 密码每次都要重新输入 | 低 | 远程模式记住了地址但不记密码 |

## 数据流 / 状态流

### 改进后的模式切换状态机

```
                    ┌──────────────────────┐
                    │   App Running        │
                    │   (Local or Remote)  │
                    └──────┬──────┬────────┘
                           │      │
              Tray/设置页  │      │  连接断开
              "切换模式"   │      │  (auto-trigger)
                           ▼      ▼
                    ┌──────────────────────┐
                    │   Transition Screen  │ ← 主窗口内显示
                    │   (保持旧内容模糊)    │   不弹新窗口
                    │                      │
                    │   [正在切换...]       │
                    │   [取消]             │
                    └──────────┬───────────┘
                               │
                    ┌──────────▼───────────┐
                    │   新模式启动中        │
                    │   (后台并行)          │
                    │                      │
                    │   成功 → loadURL      │
                    │   失败 → 回退原模式   │
                    └──────────────────────┘
```

### 改进后的启动状态机

```
App Launch
    ↓
┌─────────────────────────┐
│ Splash Screen (独立窗口) │ ← 小窗口,品牌 logo + 状态文字
│ "∞ MindOS"              │
│ "正在检测环境..."        │
└───────────┬─────────────┘
            ↓
     有 config.json?
     ├─ YES → 根据 desktopMode 启动
     │        Splash: "正在启动服务..."
     │        (Local) 或 "正在连接服务器..."(Remote)
     │        ↓
     │        成功 → 隐藏 Splash → 显示主窗口
     │        失败 → Splash 显示错误 + 选项按钮
     │
     └─ NO → Splash 变为模式选择
             (不弹新窗口，在 Splash 上切换视图)
```

## 方案

### P0：关键体验修复（本次实现）

#### 1. Splash Screen 替代空白等待

**不新建窗口——复用 splash.html**（已存在但未使用）

splash.html 改为带状态的启动屏：
- Logo + 品牌名
- 动态状态文字（"检测环境..." → "启动 Web 服务..." → "就绪"）
- 进度条（不确定型，纯动画）
- 失败时显示选项按钮（"重试" / "切换到远程" / "退出"）

**实现方式：**
- `main.ts` 启动时先创建小窗口加载 splash.html
- 通过 IPC 发送状态更新到 splash
- 成功后创建主窗口 + 关闭 splash
- 失败时 splash 变为错误 + 操作界面

#### 2. 模式切换时主窗口不白屏

**原则：先连接成功，再切换显示**

```typescript
// switch-mode IPC handler
async function switchMode() {
  // 1. 主窗口注入半透明遮罩 + spinner（通过 executeJavaScript）
  mainWindow.webContents.executeJavaScript(`
    document.body.insertAdjacentHTML('beforeend',
      '<div id="mindos-switch-overlay">切换中...</div>')
  `);

  // 2. 后台启动新模式
  const newUrl = await startNewMode();

  if (newUrl) {
    // 3. 成功 → 直接 loadURL
    mainWindow.loadURL(newUrl);
  } else {
    // 4. 失败 → 移除遮罩，回退原模式
    mainWindow.webContents.executeJavaScript(`
      document.getElementById('mindos-switch-overlay')?.remove()
    `);
    dialog.showErrorBox('切换失败', '无法启动新模式，已恢复原连接');
  }
}
```

#### 3. 主窗口内嵌连接 UI（消灭独立窗口）

**核心改变：** `showConnectWindow()` 不再创建 BrowserWindow，改为在主窗口中加载 connect.html：

```typescript
// 首次启动：splash → 模式选择（splash 窗口内）→ 主窗口
// 切换模式：主窗口 loadFile(connect.html) → 用户操作 → 主窗口 loadURL(appUrl)
```

这样用户始终只看到一个窗口，不会有背后的大白框问题。

### P1：流畅度优化（下一迭代）

#### 4. 进程预热：切换前预启动

Local→Remote 时，旧进程等新连接确认后再关闭，实现 0 中断切换：

```
当前：stop old → start new → switch (有空白期)
优化：start new (后台) → confirm ready → switch URL → stop old
```

#### 5. 一键重连

远程连接断开时，主窗口显示遮罩 + 重连按钮（而非静默在 tray 上变红灯）：

```typescript
// connection-lost 事件处理
mainWindow.webContents.executeJavaScript(`
  document.body.insertAdjacentHTML('beforeend',
    '<div id="mindos-reconnect">
       连接中断 · <button onclick="...">重新连接</button>
       · <button onclick="...">切换到本地模式</button>
     </div>')
`);
```

#### 6. 密码安全存储

使用 Electron `safeStorage` API 加密存储远程服务器密码：

```typescript
import { safeStorage } from 'electron';
// 存储：safeStorage.encryptString(password) → Buffer → base64
// 读取：safeStorage.decryptString(Buffer.from(base64, 'base64'))
```

### P2：锦上添花（未来）

- 启动性能：缓存上次的端口号，优先复用（避免每次扫描）
- 多服务器管理：Settings 页面内管理已保存的远程服务器（编辑/删除/排序）
- 自动模式：检测到 MindOS 全局安装 → 自动 Local；检测不到 → 提示 Remote

## 影响范围

### 变更文件列表

| 文件 | 改动 |
|------|------|
| `splash.html` | 重写：加状态文字 + 进度条 + 错误操作按钮 |
| `main.ts` | 启动流程：splash → 检测 → 主窗口；switch-mode 加过渡 |
| `connect-window.ts` | 简化：首次在 splash 内显示选项；切换在主窗口内 |
| `connect-renderer.ts` | 适配新的 splash 内嵌模式 |
| `tray.ts` | 无变化（菜单项保持） |
| `process-manager.ts` | 无变化 |
| `preload.ts` | 新增 splash 状态更新 IPC |

### 受影响的其他模块

- `connection-monitor.ts`：P1 阶段加主窗口重连 UI，当前无改动
- `updater.ts`：不受影响
- `window-state.ts`：不受影响

### 破坏性变更

无。config.json 格式不变，electron-store 数据不变。

## 边界 case 与风险

| # | 场景 | 处理方式 |
|---|------|----------|
| 1 | Splash 阶段用户强制关闭 → app 进程残留 | splash close → app.quit()，清理子进程 |
| 2 | 模式切换中途断网 | 回退原模式，显示错误提示 |
| 3 | Local 模式进程崩溃 3 次 + 自动切换到远程 | 不自动切换——显示错误 + 手动选项 |
| 4 | 超窄屏幕 splash 显示不全 | splash 最小尺寸 400×300，内容自适应 |
| 5 | macOS 安全策略阻止 executeJavaScript | 仅在自有页面上执行，不涉及第三方页面 |
| 6 | 用户快速连续点击"切换模式" | selectInProgress 锁 + UI 禁用 |

### 风险

| 风险 | 影响 | 缓解 |
|------|------|------|
| splash.html 路径在 asar 内可能不同 | splash 白屏 | 复用已验证的 APP_ROOT + HTML_PATH 模式 |
| executeJavaScript 在 loadURL 未完成时报错 | 遮罩注入失败 | 用 did-finish-load 事件确保页面就绪 |
| 预热模式下两个 Next.js 实例短暂共存占内存 | 内存峰值 ~500MB | P1 才做，启动时检查可用内存 |

## 验收标准

- [x] 启动 app → 看到 splash 屏（logo + 状态文字），不出现空白窗口
- [x] splash 检测到已安装 MindOS → 自动进入主窗口，splash 消失
- [x] splash 检测到未安装 → splash 上显示错误 + 操作按钮
- [x] Tray 点击 "Switch to Remote" → 主窗口显示过渡遮罩 → 成功后切换
- [x] 模式切换失败 → 自动回退原模式，无白屏
- [x] 中英文正确，跟随系统语言
- [x] Light/Dark 跟随系统
- [x] 远程断线 → 主窗口显示重连 overlay（含"切换到本地模式"按钮）
- [x] 远程连接密码通过 safeStorage 加密存储，下次自动使用
- [x] 模式切换用预热策略（先启动新进程，成功后才关旧进程）
