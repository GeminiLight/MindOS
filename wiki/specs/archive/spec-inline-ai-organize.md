# Spec: Inline AI Organize (Replace ChatBot with In-Modal Progress)

## 目标
上传文件选择「AI Organize」后，不再弹出 ChatBot 对话框，而是在 ImportModal 内部原地显示处理进度和结果，供用户 review。默认接受，允许撤销。

## 现状分析
当前 "AI Organize" 流程：
1. ImportModal 关闭
2. 通过 `window.dispatchEvent('mindos:inject-ask-files')` 注入文件到 AskContent
3. 通过 `openAskModal(prompt)` 打开 ChatBot 对话窗
4. Agent 在 ChatBot 中使用 tool 调用 (create_file, write_file 等) 完成组织

问题：
- 用户离开了导入上下文，进入了完整的 ChatBot
- 无法一目了然地看到 AI 做了什么
- 无法轻松撤销 AI 的更改
- 体验不连贯：上传 → 离开 → 聊天

## 数据流 / 状态流

```
User clicks "AI Organize"
  → ImportModal transitions to step 'organizing'
  → Client calls POST /api/ask (SSE stream)
     - messages: [{ role: 'user', content: digestPrompt }]
     - uploadedFiles: [{ name, content }]
  → SSE stream events parsed:
     - tool_start (create_file/write_file) → track file operation
     - tool_end → record result (path, action)
     - text_delta → capture AI summary
     - done → transition to 'organize_review' step
  → ImportModal shows results:
     - List of created/updated files with summaries
     - "Done" button (default accept)
     - "Undo All" button
  → Undo: POST /api/file { op: 'delete_file', path } for each created file
  → Done/Close: dispatch 'mindos:files-changed', close modal
```

## 方案

### 1. 新增 hook: `useAiOrganize`
纯逻辑 hook，负责：
- 调用 `/api/ask` 发送整理请求 (SSE streaming)
- 解析 SSE 事件流，提取 tool_start/tool_end 中的文件操作
- 维护状态：phase (idle/organizing/done/error), changes[], aiSummary
- 提供 undo 功能：调用 `/api/file` 删除已创建的文件

### 2. 修改 ImportModal
- 新增 step: `'organizing'` → 显示 AI 处理进度
- 新增 step: `'organize_review'` → 显示结果列表 + 接受/撤销按钮
- `handleIntentSelect('digest')` 不再关闭 modal，改为触发 AI organize

### 3. 修改 useFileImport
- ImportStep 类型扩展：增加 `'organizing'` | `'organize_review'`

### 4. i18n
- 新增英/中文本：organizing 状态提示、review 标题、undo 按钮等

## 影响范围
- 变更文件列表：
  - `app/hooks/useAiOrganize.ts` (新建)
  - `app/hooks/useFileImport.ts` (ImportStep 扩展)
  - `app/components/ImportModal.tsx` (新增 organizing/review 步骤 UI)
  - `app/lib/i18n-en.ts` (新增 fileImport 下的 i18n key)
  - `app/lib/i18n-zh.ts` (同上)
- 受影响但不改的模块：
  - `/api/ask` — 作为后端不变，前端换调用方式
  - `AskContent` — 不再从 ImportModal 接收 inject-ask-files 事件 (但 AskContent 仍支持该事件，不需要改)
  - `useAskModal` — 不再从 ImportModal 调用 `openAskModal`
- 无破坏性变更：openAskModal 和 inject-ask-files 事件机制仍然存在

## 边界 case 与风险
1. **AI 请求失败 (网络/API key 未配置/模型不可用)**：显示错误信息 + 重试按钮
2. **AI 未创建任何文件 (只给了文字建议)**：显示 AI 的文字总结，无文件变更可撤销
3. **用户在 organizing 过程中关闭 modal**：abort 请求，已创建的文件保留 (用户可手动删除)
4. **大文件处理耗时长**：streaming 进度实时展示 tool 调用，用户可见进展
5. **Undo 部分失败 (文件已被其他操作修改/删除)**：跳过失败的，报告成功撤销的数量

## 验收标准
- [ ] 点击 "AI Organize" 后不弹出 ChatBot
- [ ] ImportModal 内显示 "AI 正在整理..." 动画
- [ ] 实时展示 AI 正在执行的工具调用 (如 "Creating notes/xxx.md")
- [ ] 完成后列出所有创建/修改的文件路径
- [ ] 点击 "Done" 关闭 modal，刷新文件树
- [ ] 点击 "Undo All" 撤销所有创建的文件，关闭 modal，刷新文件树
- [ ] AI 请求失败时显示错误信息 + 重试按钮
- [ ] 英文/中文 i18n 完整
