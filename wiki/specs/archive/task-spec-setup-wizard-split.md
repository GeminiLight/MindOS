# Task Spec: SetupWizard 文件拆分

**Status**: Draft
**来源**: `wiki/85-backlog.md` 技术债
**优先级**: P3（不影响功能，纯代码结构优化）

---

## 背景

`app/components/SetupWizard.tsx` 当前 ~1400 行，包含 10 个组件/函数、6 个类型定义、1 个常量块，全部塞在一个文件里。阅读和维护成本高，改一个 Step 必须打开整个文件。

### 当前文件内部结构

| 行范围 | 组件/定义 | 行数 | 职责 |
|--------|-----------|------|------|
| 1-65 | 类型 + 常量 | 65 | `SetupState`, `PortStatus`, `AgentEntry`, `AgentInstallStatus`, `TEMPLATES`, Step 常量 |
| 68-138 | `Step4Inner` | 70 | Security — Token + Password |
| 141-206 | `PortField` | 65 | 端口输入 + 状态展示（被 Step3 使用） |
| 209-217 | `getParentDir` | 9 | 工具函数（被 Step1 使用） |
| 220-430 | `Step1` | 210 | Knowledge Base — 路径选择 + 模板选择 |
| 433-493 | `Step2` | 60 | AI Provider |
| 496-538 | `Step3` | 42 | Ports |
| 541-763 | `Step5` | 222 | Agent Tools |
| 768-823 | `RestartBlock` | 55 | 重启 UI + polling |
| 828-959 | `Step6` | 131 | Review + 进度 + 结果 |
| 964-992 | `StepDots` | 28 | 步骤导航点 |
| 997-1406 | `SetupWizard` | 409 | 主组件 — 状态管理 + 布局 + 导航 |

---

## 目标

1. 将各 Step 组件拆为独立文件，每个文件 < 250 行
2. 共享类型和常量抽到 `types.ts` / `constants.tsx`
3. 主组件 `index.tsx` 只保留状态管理 + 布局 + 导航（目标 < 450 行）
4. **零功能变更** — 纯重构，行为不变

---

## 方案

### 目录结构

```
app/components/setup/
├── types.ts           # 共享 type / interface（纯 TS，无 JSX）
├── constants.tsx      # TEMPLATES（含 JSX icon）、TOTAL_STEPS、STEP_KB 等常量
├── StepKB.tsx         # Step1 — Knowledge Base（含 getParentDir）
├── StepAI.tsx         # Step2 — AI Provider
├── StepPorts.tsx      # Step3 — Ports（含 PortField）
├── StepSecurity.tsx   # Step4 — Security (Step4Inner)
├── StepAgents.tsx     # Step5 — Agent Tools
├── StepReview.tsx     # Step6 — Review（含 RestartBlock）
├── StepDots.tsx       # 步骤导航组件
└── index.tsx          # 主组件 SetupWizard（re-export default）
```

### 拆分规则

1. **`types.ts`**（无 JSX，纯 TS）
   - 导出所有 `type` / `interface`：`Template`, `SetupState`, `PortStatus`, `AgentEntry`, `AgentInstallState`, `AgentInstallStatus`
   - 导出 i18n 辅助类型别名：`type SetupMessages = Messages['setup']`（从 `@/lib/i18n` 导入 `Messages`），消除各文件重复写 `ReturnType<typeof useLocale>['t']['setup']`
   - **不需要 `'use client'`**

2. **`constants.tsx`**（含 JSX）
   - `TEMPLATES` 数组（icon 字段包含 `<Globe />`、`<BookOpen />`、`<FileText />` JSX）
   - `TOTAL_STEPS`、`STEP_KB`、`STEP_PORTS`、`STEP_AGENTS` 数值常量
   - 从 `./types` 导入 `Template` 类型
   - **不需要 `'use client'`**（常量不使用 hooks）
   - ⚠️ 之所以不放 `types.ts`：`TEMPLATES` 包含 JSX（lucide-react 图标），`.ts` 文件不能有 JSX

3. **各 Step 文件**
   - 每个文件开头 `'use client'`
   - 从 `./types` 导入类型（含 `SetupMessages` 别名）
   - 从 `lucide-react`、`@/lib/LocaleContext`、`@/components/settings/Primitives` 按需导入（每个文件只导入自己用到的图标）
   - Props 类型在各文件内用 `interface XxxProps` 定义并导出（方便主组件引用类型，也方便未来测试）
   - i18n prop 统一用 `s: SetupMessages` 替代冗长的 `ReturnType<typeof useLocale>['t']['setup']`
   - Step1 特殊：需要完整的 `t: Messages`（因为访问 `t.onboarding.templates`），其余 Step 只需 `s: SetupMessages`
   - `PortField` 只被 `StepPorts` 使用 → 放在 `StepPorts.tsx` 内部，不导出
   - `getParentDir` 只被 `StepKB` 使用 → 放在 `StepKB.tsx` 内部，不导出
   - `RestartBlock` 只被 `StepReview` 使用 → 放在 `StepReview.tsx` 内部，不导出

4. **`index.tsx`**（主组件）
   - `'use client'`
   - 从 `./types` 导入类型，从 `./constants` 导入常量
   - 从各 Step 文件导入组件
   - 保留所有 `useState`、`useEffect`、`useCallback` 逻辑
   - 保留 `handleComplete`、`checkPort`、`retryAgent`、`generateToken`、`copyToken` 等
   - 保留导航 UI（Back / Next / Complete 按钮）
   - `export default function SetupWizard()`

5. **外部引用兼容**
   - 当前只有一处引用：`app/app/setup/page.tsx` → `import SetupWizard from '@/components/SetupWizard'`
   - 将原 `SetupWizard.tsx` 改为 re-export：`export { default } from './setup'`
   - 外部零改动

### i18n 类型简化

**Before（各 Step 重复 7 次）：**
```typescript
s: ReturnType<typeof useLocale>['t']['setup'];
```

**After（types.ts 定义一次）：**
```typescript
// types.ts
import type { Messages } from '@/lib/i18n';
export type SetupMessages = Messages['setup'];
export type McpMessages = Messages['settings']['mcp'];

// 各 Step 文件
import type { SetupMessages } from './types';
// Props: s: SetupMessages
```

### 预估行数

| 文件 | 预估行数 | 说明 |
|------|----------|------|
| `types.ts` | ~50 | 6 个类型 + 2 个类型别名 |
| `constants.tsx` | ~20 | TEMPLATES + 4 个常量 |
| `StepKB.tsx` | ~220 | 最大的 Step（路径补全 + 模板选择 + 非空目录逻辑） |
| `StepAI.tsx` | ~65 | 最小的 Step |
| `StepPorts.tsx` | ~115 | 含 PortField 子组件 |
| `StepSecurity.tsx` | ~80 | 含 seed / showSeed 本地状态 |
| `StepAgents.tsx` | ~230 | 第二大 Step（agent 列表 + 高级选项） |
| `StepReview.tsx` | ~195 | 含 RestartBlock 子组件 + 进度 stepper |
| `StepDots.tsx` | ~35 | 最小的独立组件 |
| `index.tsx` | ~420 | 状态管理 + useEffect + handlers + 布局 |
| **总计** | **~1430** | 略多于原文件（import 开销），每个文件均 < 250 行 ✅ |

---

## 不做

- **不改样式**：所有 CSS 变量、class 完全保持
- **不改逻辑**：状态管理全部留在主组件，Step 仍是受控组件
- **不改 i18n key**：翻译 key 不变
- **不改 API 调用**：fetch 逻辑留在主组件
- **不新建 barrel export**：`components/setup/` 只通过 `index.tsx` 导出 `SetupWizard`，不导出子组件

---

## 验收标准

1. `npm run build` 通过
2. `npm test` 通过（如有 SetupWizard 相关测试）
3. `/setup` 页面 6 个 Step 功能不变（路径选择、模板选择、AI Provider、端口检测、Token 生成/复制、Agent 安装、Review + Complete）
4. 非空目录模板跳过/合并逻辑正常
5. 原 `SetupWizard.tsx` 保留为 re-export（一行），外部引用无需改动
6. 每个新文件 < 250 行
7. 全局无 `ReturnType<typeof useLocale>` 冗余写法（已替换为 `SetupMessages` 别名）

---

## 执行顺序

1. 新建 `setup/types.ts`（类型 + 别名）
2. 新建 `setup/constants.tsx`（TEMPLATES + 常量）
3. 新建各 Step 文件（从原文件剪切粘贴，调整 import）
4. 新建 `setup/index.tsx`（主组件，调整 import）
5. 将原 `SetupWizard.tsx` 改为 `export { default } from './setup'`
6. `npm run build` 验证
7. 更新 `wiki/85-backlog.md` 打勾

---

## 文件变更清单

| 操作 | 文件 |
|------|------|
| 新建 | `app/components/setup/types.ts` |
| 新建 | `app/components/setup/constants.tsx` |
| 新建 | `app/components/setup/StepKB.tsx` |
| 新建 | `app/components/setup/StepAI.tsx` |
| 新建 | `app/components/setup/StepPorts.tsx` |
| 新建 | `app/components/setup/StepSecurity.tsx` |
| 新建 | `app/components/setup/StepAgents.tsx` |
| 新建 | `app/components/setup/StepReview.tsx` |
| 新建 | `app/components/setup/StepDots.tsx` |
| 新建 | `app/components/setup/index.tsx` |
| 修改 | `app/components/SetupWizard.tsx` → 改为 re-export（1 行） |
| 修改 | `wiki/85-backlog.md` → 打勾 |
