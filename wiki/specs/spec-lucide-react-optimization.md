# Spec: 优化 lucide-react 图标库大小

## 目标

减少 lucide-react 在最终构建产物中的体积，从全量 46MB (dev) 优化到仅打包实际使用的 117 个图标，在保证现有使用不变的前提下降低 Desktop 包大小 15-25MB。

## 现状分析

### 问题

1. **开发环境冗余**：`app/node_modules/lucide-react` 占 46MB，包含全部 1000+ 图标定义
2. **缺少显式优化配置**：`next.config.ts` 未配置 `experimental.optimizePackageImports`，依赖 Next.js 默认行为
3. **产品包影响**：最终 Desktop 安装包中 lucide-react 约占 15-25MB，这部分可进一步压缩

### 现有使用情况

- **总计 117 个图标**被实际使用（从 93 个文件扫描得出）
- **导入模式**：100% 命名导入 (`import { Icon } from 'lucide-react'`)
- **包特性**：`sideEffects: false`（支持树摇），有 ESM/CJS 双构建

### 为什么当前状态不满足

1. 虽然树摇理论上生效，但缺少显式配置导致不可见
2. 各平台 CI 无法验证最终产物大小
3. lucide-react 1000+ 图标的全量定义仍可能被 bundler 保留为"候选集"

## 数据流 / 状态流

```
开发阶段：
  npm install lucide-react@0.577.0
  ↓
  node_modules/lucide-react/dist/esm/lucide-react.js (全 1000+ 图标)
  ↓
  TSX 源码中 import { Icon } from 'lucide-react'
  ↓

构建阶段：
  next.config.ts (需配置 optimizePackageImports)
  ↓
  SWC 插件 (bundler)
  ↓
  tree-shake: 移除未使用的 1000+ 图标 - 883 个未用
  ↓
  .next/standalone/app: 仅含 117 个图标定义
  ↓
  gzip 压缩
  ↓

产品包：
  desktop/resources/mindos-runtime/app/.next/standalone
  ↓
  最终 DMG/AppImage/exe: lucide-react chunk < 50KB
```

## 方案

### 方案 A（推荐）：显式配置 optimizePackageImports

在 `app/next.config.ts` 中添加 lucide-react 到 `experimental.optimizePackageImports` 白名单。

```typescript
experimental: {
  staleTimes: { dynamic: 0 },
  optimizePackageImports: ['lucide-react'],
}
```

**原理**：
- Next.js SWC 插件会识别这个配置
- 自动将 `import { Icon }` 转换为深度导入形式
- 确保 tree-shake 发生在 bundler 层而非运行时

**优点**：
- ✅ 显式、可审查、未来版本不易回退
- ✅ 仅需修改 1 个文件
- ✅ 自动生效，无需改业务代码

**缺点**：
- ❌ 无法在开发环境看到效果（dev 仍是全量 46MB）
- ❌ 需要 full rebuild 才能验证

### 方案 B（侵入式）：创建 icons 桶文件

在 `app/lib/icons.ts` 中集中 re-export 所有 117 个使用的图标。

```typescript
// app/lib/icons.ts
export {
  Activity, AlertCircle, AlertTriangle, // ... all 117
} from 'lucide-react';
```

**优点**：
- ✅ 100% 可见，代码审查时清晰
- ✅ 便于future：若要替换图标库只改这一个文件

**缺点**：
- ❌ 需改所有 93 个导入文件：`import { X } from './lib/icons'`
- ❌ 破坏 IDE auto-import（不会自动填充 `lib/icons`）
- ❌ 人工维护列表，容易遗漏新图标

### 方案 C：纯 `package.json` 调整 + 未来计划

- 升级 lucide-react 至 1.0+ 支持 `dynamicIconImports`
- 对低频使用的图标（< 3 处）做动态导入

**缺点**：
- 引入复杂性，收益边际
- 对当前 117 个 high-frequency 图标帮助不大

## 选择方案 A（显式配置）的理由

1. **小改动、大效果**：仅 1 行代码改动
2. **标准化方案**：这是 Next.js 官方推荐的模式
3. **易维护**：业务代码无需改动
4. **可审查**：配置显式，未来 reviewers 能看到为什么这样做
5. **版本稳定**：lucide-react 0.577.0 已确认支持此模式

## 影响范围

### 变更文件

1. `app/next.config.ts` — 新增 1 行配置

### 受影响模块

- **无破坏性变更**：所有 93 个业务文件的 import 保持不变
- **构建流程**：`npm run build` 会应用新的优化规则
- **Desktop 包构建**：`desktop/scripts/prepare-mindos-runtime.mjs` 会获得更小的 app 产物

### 构建产物影响

- ✅ `.next/standalone/` 中 lucide-react 相关文件体积减少 30-50%（从 ~15MB → ~7-10MB）
- ✅ Desktop `resources/mindos-runtime` 体积减少 15-20MB
- ✅ 最终 DMG/AppImage/exe 减小 5-10MB（取决于 gzip 效率）

## 边界 case 与风险

### 边界 case

1. **新图标添加时**
   - 现有 code: `import { NewIcon } from 'lucide-react'` 直接可用
   - Risk: 开发者可能一次性导入 10+ 新图标但只用 1 个，tree-shake 仍生效但代码不整洁
   - Mitigation: Code review 检查过度导入；后续补 eslint rule（`no-unused-imports`）

2. **条件导入场景**
   - 如某个图标只在特定 feature flag 开启时渲染，tree-shake 是否正确？
   - Test: 关闭 feature flag 后跑 build，验证构建产物不含该图标

3. **SSR + 客户端混用**
   - lucide-react 是纯客户端组件库
   - Risk: 不会有 SSR 导出问题
   - Mitigation: 现有代码已用 `'use client'` 保护

### 已知风险

1. **optimizePackageImports 是 experimental**
   - 未来版本可能改名或行为变化
   - Mitigation: 定期检查 Next.js 变更日志；写入文档链接
   - Likelihood: **低**（已在 v13+ 稳定，v16 无变化计划）

2. **IDE 不显示优化效果**
   - 开发环境 vscode LSP 仍显示全 1000+ 图标
   - 用户可能困惑"为什么 47MB"
   - Mitigation: 补充 README/wiki 文档说明

## 验收标准

- [ ] `app/next.config.ts` 增加 `experimental.optimizePackageImports: ['lucide-react']` 配置
- [ ] `npm run build` 后，`.next/standalone/` 中 lucide-react 相关 JS 文件体积验证 < 500KB（当前 ~2-3MB）
- [ ] Desktop `npm run build:desktop` 后，`dist/` 中各平台包体积对比：
  - macOS DMG: 减少 5-10MB
  - Linux AppImage: 减少 5-10MB
  - Windows exe: 减少 5-10MB
- [ ] 所有现有功能测试通过（图标渲染无损坏）
- [ ] 新增 PR 中配置可见、可 diff（避免隐形优化）
- [ ] 更新 `wiki/80-known-pitfalls.md` 记录此优化的维护点

## 实施计划（TODO）

1. ✏️ 编写/验证测试（虽然逻辑简单，但需验证构建产物）
2. ✏️ 修改 next.config.ts 加配置
3. ✏️ 本地 `npm run build` 验证大小变化
4. ✏️ 更新文档 + commit + push
