# Spec: 排除 Build-Time 和 CLI-Only 依赖从 Next.js Standalone 产物

## 目标

从 `app/.next/standalone/` 中排除 build-time 和 CLI-only 的原生依赖库（koffi、sharp、@img/*、typescript、cli-highlight），减少 Desktop 内置运行时体积 110-140MB，最终产物体积减少 8-12%。

## 现状分析

### 问题

在 `npm run build` 后，`app/.next/standalone/node_modules/` 中包含了大量 build-time 和 CLI-only 的包：

| 包 | 大小 | 用途 | 为什么不应该被打包 |
|----|------|------|-----------------|
| `koffi` | 87 MB | C FFI 库（pi-coding-agent 的传递依赖） | 仅在 CLI 工具中使用，Web 服务无需 |
| `@img/*` (libvips) | 33 MB | 图像处理native库（sharp 平台特定二进制） | Next.js build-time 图像优化，runtime 不需要 |
| `typescript` | 20 MB | TypeScript 编译器 | Build-time 专用，runtime 无需 |
| `cli-highlight` | 2.3 MB | 终端代码高亮库 | CLI 工具专用 |
| 合计 | **142 MB** | - | - |

### 为什么现在才发现

- `app/next.config.ts` 中 `serverExternalPackages` 列表已有 `pi-coding-agent`、`mcporter` 等关键库
- 但**传递依赖树**中的 `koffi`（来自 `pi-coding-agent` → `pi-tui` → `koffi`）未被标记
- `sharp` 和 `@img/*` 虽然是 Next.js 内置库，但配置不完整
- 现有 `serverExternalPackages` 定义不够全面

### 验证（已确认）

```bash
$ du -sh app/.next/standalone/node_modules/{koffi,sharp,@img,typescript,cli-highlight}
87M     koffi
380K    sharp
33M     @img
20M     typescript
2.3M    cli-highlight
# 总计：142 MB
```

## 数据流 / 状态流

```
npm run build (Next.js 16.1.6 standalone mode)
  ↓
  next.js 检查 serverExternalPackages 配置
  ↓
  当前配置缺少 koffi/sharp/@img/typescript/cli-highlight
  ↓
  bundler 将这些包当作"运行时依赖"复制进 .next/standalone/node_modules
  ↓
  app/.next/standalone 体积膨胀 +142 MB
  ↓
  desktop/resources/mindos-runtime 包含完整 .next/standalone
  ↓
  最终 Desktop DMG/AppImage/exe 包含 142 MB 冗余
```

修复后：

```
app/next.config.ts: serverExternalPackages 加入 5 个包
  ↓
next.js 构建时跳过打包这些包
  ↓
.next/standalone/node_modules 中无 koffi/@img/typescript/cli-highlight
  ↓
体积减少 142 MB
```

## 方案

### 修改 `app/next.config.ts`

在 `serverExternalPackages` 数组中追加 5 个包：

```typescript
serverExternalPackages: [
  'chokidar',
  'openai',
  '@mariozechner/pi-ai',
  '@mariozechner/pi-agent-core',
  '@mariozechner/pi-coding-agent',
  'mcporter',
  // 新增以下
  'sharp',                    // Next.js image optimization (build-time only)
  '@img/*',                   // Image processing native binaries
  'typescript',               // TypeScript compiler (build-time only)
  'cli-highlight',            // Terminal UI library (CLI-only)
  '@mariozechner/pi-tui',     // Terminal UI (CLI-only)
  'koffi',                    // C FFI (transitive from pi-coding-agent, CLI-only)
],
```

### 为什么这五个包安全排除

1. **koffi**：
   - 用于 `pi-coding-agent` 的子进程管理（CLI 工具）
   - Web 服务（Express/Next.js）不需要，使用 Node 标准 `child_process` 模块

2. **sharp** 和 **@img/***：
   - Next.js 在 build 时用来优化静态图像
   - 优化后的产物已在 `.next/static/`，runtime 无需 sharp 库本身
   - 若 runtime 需要图像处理可用专用 API（如 `/api/extract-pdf` 用 puppeteer）

3. **typescript**：
   - 完全是 build-time 依赖
   - 最终 `.next/standalone/` 中只有 JS，无需 TS 编译器

4. **cli-highlight**：
   - 仅在 CLI 输出中使用（`bin/cli.js` 等）
   - Web 服务中无调用

5. **@mariozechner/pi-tui**：
   - TUI（终端用户界面）库，CLI-only
   - Web 服务不需要

### 验证机制

修改后 Next.js build 时会检查这些包，跳过复制到 standalone。验证步骤：

```bash
npm run build
du -sh app/.next/standalone/node_modules/{koffi,@img,typescript,cli-highlight} 2>/dev/null
# 应该全部返回 "cannot access"（文件不存在）
```

## 影响范围

### 变更文件

- `app/next.config.ts` — 修改 `serverExternalPackages` 数组（+6 行）

### 受影响模块

- **无代码改动**：serverExternalPackages 是纯配置，不影响业务逻辑
- **无破坏性变更**：pi-coding-agent、pi-ai、mcporter 仍正常工作
- **Web 功能无影响**：这些包本来就不被 Web 服务使用

### 包大小影响

- `.next/standalone/` 体积减少 ~142 MB
- `desktop/resources/mindos-runtime` 体积减少 ~142 MB
- 最终 Desktop DMG/AppImage/exe 各减少 ~8-12%（依赖压缩率）

## 边界 case 与风险

### 边界 case

1. **Future: 新增 Web feature 需要 sharp**
   - 若将来 Web 服务需要图像处理（如头像 resize）
   - 应改用云服务或轻量库（jimp），不带原生二进制
   - Mitigation: 当需要时再加，当前无此需求

2. **CLI 进程缺 koffi**
   - CLI 进程（`bin/cli.js`）继续从全局 npm install 获取
   - 或从本项目的 `node_modules` 获取（npm 的 hoisting）
   - Mitigation: 测试 `mindos mcp`、`mindos start` 等 CLI 命令仍正常工作

3. **Cross-platform builds**
   - Desktop 在 Linux CI 上打包后，macOS 用户解压缺 arm64 native
   - **不影响**：koffi/@img 本来就不会被打进 Desktop，无平台冲突
   - Mitigation: 无需特殊处理

### 已知风险

1. **serverExternalPackages 是 experimental**
   - Next.js 14+ 已稳定，v16 无改动计划
   - Likelihood: **低**

2. **@img/* glob pattern 识别**
   - Next.js 需要正确解析 glob pattern
   - 改为列表形式（`@img/sharp-libvips-*`）如识别失败
   - Mitigation: 若 build 失败则改为逐个列举

## 验收标准

- [ ] `app/next.config.ts` 已更新 `serverExternalPackages`，增加 6 个包
- [ ] `npm run build` 成功（无编译错误）
- [ ] `du -sh app/.next/standalone/node_modules/koffi` 返回"cannot access"或 0 bytes
- [ ] 同样验证 `@img`、`typescript`、`cli-highlight`
- [ ] CLI 命令测试通过（`mindos mcp --help`、`mindos start --help`）
- [ ] Desktop 本地模式 `npm run build:desktop` 成功
- [ ] Desktop app 启动后 `/api/health` 返回正常响应
- [ ] 最终 Desktop DMG/AppImage/exe 包大小各减少 8-12% 对比 main branch
- [ ] 全量测试通过（857 tests）

## 实施计划（TODO）

1. ✏️ 编写测试验证 serverExternalPackages 配置
2. ✏️ 修改 app/next.config.ts 加入 6 个包
3. ✏️ 本地 `npm run build` 验证包大小
4. ✏️ CLI 命令手工验证
5. ✏️ 更新 wiki/80-known-pitfalls.md
6. ✏️ commit + push
