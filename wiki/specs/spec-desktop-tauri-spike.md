# Spec: Desktop Tauri Spike

## 目标

创建一个最小化的 Tauri Desktop spike，验证 MindOS 是否适合从 Electron 迁移到 Tauri，为后续架构决策提供数据支持。

## 现状分析

当前 MindOS 只有 Electron Desktop 版本（`desktop/`），存在以下问题：
- 包体积大（~200MB）
- 启动速度慢
- 内存占用高
- 平台逻辑和产品逻辑混在一起，难以复用

Tauri 提供：
- 更小的包体积（~10-20MB）
- 更快的启动速度
- 更低的内存占用
- Rust 安全性

但需要验证：
- MindOS 的架构是否"壳薄核心厚"，适合迁移
- Tauri 是否能满足 MindOS 的核心需求（窗口、tray、runtime 管理）
- 迁移成本是否可接受

## 数据流 / 状态流

```
用户启动 Tauri App
  ↓
Rust main.rs 初始化
  ↓
创建主窗口 + System Tray
  ↓
加载 webview (localhost:3456 或 bundled HTML)
  ↓
前端通过 Tauri Commands 调用 Rust backend
  ↓
Rust backend 启动 MindOS runtime (Node.js sidecar)
  ↓
前端连接到 runtime API (http://localhost:3456)
  ↓
正常运行
```

关键数据流：
1. **窗口管理**：Rust ↔ Tauri Window API
2. **Runtime 通信**：Rust ↔ Node.js sidecar (stdio/http)
3. **前端通信**：WebView ↔ Rust (Tauri Commands)
4. **配置管理**：Rust ↔ ~/.mindos/config.json

## 方案

### 目录结构

```
desktop-tauri/
├─ src/                    # 前端入口（复用 app/ 的构建产物）
│  ├─ main.ts              # 前端入口
│  └─ index.html           # HTML 模板
├─ src-tauri/
│  ├─ src/
│  │  ├─ main.rs           # Rust 主入口
│  │  ├─ window.rs         # 窗口管理
│  │  ├─ tray.rs           # System Tray
│  │  ├─ runtime.rs        # Runtime 管理（启动 Node.js sidecar）
│  │  └─ commands.rs       # Tauri Commands
│  ├─ icons/               # 应用图标
│  ├─ Cargo.toml           # Rust 依赖
│  └─ tauri.conf.json      # Tauri 配置
├─ package.json
├─ vite.config.ts          # Vite 配置（前端构建）
└─ README.md
```

### 核心功能

**Phase 1: 最小窗口（本次实现）**
- [x] 创建主窗口
- [x] 加载前端（指向 localhost:3456）
- [x] System Tray（最小化到托盘）
- [x] 基础菜单（Quit）

**Phase 2: Runtime 集成**
- [x] 启动 Node.js sidecar（使用 Tauri sidecar API）
- [x] Runtime 健康检查（HTTP health endpoint）
- [x] 配置管理（读写 ~/.mindos/config.json）
- [x] 自动启动 runtime（app 启动时）
- [x] 优雅关闭（app 退出时停止 runtime）

**Phase 3: 高级功能（后续）**
- [ ] Deep link (mindos://)
- [ ] 自动更新
- [ ] 多窗口管理
- [ ] 快捷键

### 技术选型

- **前端**：复用现有 Next.js app（通过 localhost:3456）
- **Rust backend**：Tauri 2.x
- **Runtime**：复用现有 Node.js runtime（作为 sidecar）
- **配置**：复用 ~/.mindos/config.json

### 不做的事（明确边界）

- ❌ 不重构现有 desktop/ 代码
- ❌ 不创建 packages/desktop-core/（留待后续）
- ❌ 不实现完整功能（只做 spike）
- ❌ 不发布正式版本

## 影响范围

### 变更文件列表

新增文件：
- `desktop-tauri/` 整个目录（新建）
- `wiki/specs/spec-desktop-tauri-spike.md`（本文件）

不变更文件：
- `desktop/` 保持不变
- `app/` 保持不变
- 其他模块保持不变

### 受影响的其他模块

- **desktop/**：不受影响，继续作为主要 Desktop 版本
- **app/**：不受影响，Tauri 通过 localhost:3456 访问
- **mcp/**：不受影响，runtime 启动后自动可用

### 破坏性变更

无。这是一个独立的 spike，不影响现有功能。

## 边界 case 与风险

### 边界 case

1. **首次运行（无配置文件）**
   - 处理：创建默认配置到 ~/.mindos/config.json
   - 测试：删除配置文件后启动

2. **端口冲突（3456 已被占用）**
   - 处理：显示错误提示，引导用户关闭冲突进程
   - 测试：手动占用 3456 端口后启动

3. **Runtime 启动失败**
   - 处理：显示错误对话框，提供重试选项
   - 测试：删除 Node.js 后启动

4. **多实例启动**
   - 处理：检测已有实例，聚焦现有窗口
   - 测试：启动两次应用

5. **网络断开（无法下载 Node.js）**
   - 处理：显示离线错误，引导用户检查网络
   - 测试：断网后首次启动

### 风险与 Mitigation

| 风险 | 影响 | Mitigation |
|------|------|------------|
| Tauri 不支持某些 Electron 功能 | 迁移受阻 | 提前调研 Tauri API，列出不支持的功能 |
| Rust 学习曲线陡峭 | 开发效率低 | 从最小功能开始，逐步学习 |
| Runtime 集成复杂 | 启动失败 | 先用 localhost:3456，后续再集成 sidecar |
| 包体积仍然大（bundled Node.js） | 优势不明显 | 测量实际包体积，评估是否值得迁移 |
| localhost:3456 无认证 | 安全风险 | Phase 1 仅本地开发，Phase 2 添加 token 认证 |
| 资源泄漏（runtime 未清理） | 内存泄漏 | 实现 cleanup handler，确保退出时终止 runtime |
| webview 加载延迟 | 用户体验差 | 显示 loading 状态，30s 超时后显示错误 |
| 系统兼容性（Windows 7） | 无法运行 | 文档明确最低要求：Windows 10, macOS 10.15 |

## 验收标准

### Phase 1（本次实现）

- [ ] `desktop-tauri/` 目录创建成功
- [ ] `npm install` 安装依赖成功
- [ ] `npm run tauri dev` 启动成功
- [ ] 主窗口显示，加载 localhost:3456
- [ ] System Tray 显示，点击可显示/隐藏窗口
- [ ] 菜单中的 Quit 可以退出应用
- [ ] 关闭窗口时最小化到托盘（不退出）
- [ ] 托盘右键菜单显示 "Show/Hide" 和 "Quit"
- [ ] README.md 包含启动说明

### Phase 2（后续）

- [ ] Runtime 自动启动（Node.js sidecar）
- [ ] 健康检查通过（localhost:3456 可访问）
- [ ] 配置文件读写正常

### Phase 3（后续）

- [ ] Deep link 注册成功（mindos://）
- [ ] 自动更新检查正常
- [ ] 快捷键注册成功

## 成功指标

- **包体积**：< 50MB（vs Electron ~200MB）
- **启动时间**：< 2s（vs Electron ~5s）
- **内存占用**：< 200MB（vs Electron ~400MB）
- **开发体验**：开发者能在 1 小时内理解并修改代码

## 后续决策点

完成 Phase 1 后，评估：
1. Tauri 是否满足 MindOS 核心需求？
2. 包体积/性能提升是否显著？
3. 迁移成本是否可接受？

基于评估结果决定：
- **继续**：实现 Phase 2/3，逐步替换 Electron
- **暂停**：保留 spike 作为参考，继续使用 Electron
- **放弃**：删除 spike，专注优化 Electron 版本
