# Spec: AI Organize 进度感知优化

## 目标

让用户在 AI Organize 长时间处理期间始终感知到系统在工作，消除"卡死"感。

## 现状分析

当前 organizing 阶段 UI：
- 一个 Sparkles 图标 + Loader2 旋转
- 一行静态文案 "AI 正在分析和整理你的文件..."
- 只有 AI 调用 FILE_WRITE_TOOLS 时才有 `currentTool` 更新

AI 处理 PDF 等文件时，前半段（读取、分析、思考）可能持续 10-30s，期间 `currentTool` 为 null，UI 完全静止。用户无法区分"正在处理"和"已经卡死"。

此外 organizing 阶段没有取消按钮，用户被困在等待中，只能关闭 Modal。

## 数据流 / 状态流

```
SSE Stream (from /api/ask)
  │
  ├── text_delta ──────► 说明 AI 在生成文本（思考/回复阶段）
  ├── tool_start ──────► 说明 AI 开始执行工具
  │   ├── read_file / search / list_files → 分析阶段
  │   └── create_file / write_file / ... → 写入阶段
  ├── tool_end ────────► 工具执行完成
  └── done ────────────► 全部完成

useAiOrganize hook
  ├── currentTool (只跟踪写工具) ← 改为跟踪所有工具
  ├── stageHint (new) ← 根据事件类型推断当前阶段
  └── elapsedSeconds (new) ← 计时器，让用户看到时间在流动
```

关键发现：当前 `consumeOrganizeStream` 只在 `FILE_WRITE_TOOLS` 事件时调用 `onProgress`，
非写工具的 `tool_start`（如 read_file、search）被完全忽略。这些事件可以用来给用户阶段提示。

## 方案

### 1. 阶段提示文案（StageHint）

在 hook 中新增 `stageHint` 状态，根据 SSE 事件实时推断：

| SSE 事件 | stageHint |
|----------|-----------|
| 连接成功，尚无事件 | `'connecting'` |
| 收到 `text_delta` | `'analyzing'` |
| 收到非写 `tool_start`（read/search/list） | `'reading'`（附带文件名） |
| 收到写 `tool_start` | `'writing'`（附带文件名，已有逻辑） |
| 5s 无任何事件 | `'thinking'`（深度思考） |

UI 显示对应的用户友好文案。

### 2. 经过时间指示器

在 organizing 阶段显示已用时间 `0:05` / `0:12` 等，让用户确信系统在工作。
使用 `useEffect` + `setInterval` 每秒递增。

### 3. 取消按钮

在 organizing 阶段底部显示"取消"按钮，调用 `aiOrganize.abort()`。

### 4. 进度条（dots animation）

用 3 个渐变 dot 替代静态 `...`，增加视觉活力。

## 影响范围

- `app/hooks/useAiOrganize.ts` — 新增 `stageHint` 状态 + 跟踪非写工具 + 暴露计时
- `app/components/ImportModal.tsx` — organizing 阶段 UI 重构 + 取消按钮
- `app/lib/i18n-en.ts` / `app/lib/i18n-zh.ts` — 新增阶段文案
- `app/__tests__/hooks/useAiOrganize.test.ts` — 新增 stageHint 逻辑测试
- 不影响 `/api/ask` 后端（纯前端改动）
- 不影响 organize_review 步骤

## 边界 case 与风险

1. **AI 秒级完成（无需等待）** — stageHint 快速跳过各阶段，计时器显示 0:01 后消失，无害。
2. **AI 长时间无事件（>30s）** — thinking hint 持续显示 + 计时器递增，用户可选择取消。
3. **用户取消后重试** — abort + reset 已有逻辑，stageHint 和 timer 跟随 reset 归零。
4. **SSE 连接断开** — 已有 error handling（网络错误），不受影响。

## 验收标准

- [ ] organizing 阶段首秒即显示 "正在连接..." 或 "正在分析..."
- [ ] AI 读取文件时显示 "正在阅读 xxx.md..."
- [ ] 已用时间每秒递增，格式 `0:05`
- [ ] 底部有"取消"按钮，点击可中断
- [ ] 取消后 Modal 回到 select 步骤
- [ ] 5s 无事件时显示 "AI 正在深度思考..."
- [ ] 全量测试通过，无回归
- [ ] i18n 中英双语完整
