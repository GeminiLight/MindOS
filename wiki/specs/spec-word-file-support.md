# Spec: 支持 Word 文档上传与转换

## 目标
在 Chat 聊天框和 Inbox 暂存台中支持 `.docx`/`.docm` 文件上传，自动解析为可读的纯文本和 Markdown 格式，增强用户的知识库管理能力。

## 现状分析
当前系统仅支持 PDF 文档上传和解析：
- Chat 聊天框：支持 .pdf 文件，自动提取文本并作为 AI 对话上下文
- Inbox 暂存台：支持 .pdf 上传，可拖拽添加
- 限制：无法处理 Word 文档（.docx/。docm），这是用户常用的文档格式

**问题：** 用户如需在对话中参考 Word 文档，必须手动复制粘贴内容，效率低且容易遗漏。

## 数据流 / 状态流

```
用户上传 Word 文件
  │
  ├─→ [Chat 路径]
  │     └─→ useFileUpload hook (立即显示 FileChip)
  │         └─→ 后台调用 /api/extract-docx
  │            ├─→ 转换为 base64
  │            ├─→ 启动子进程 extract-docx.cjs
  │            │    ├─→ 使用 mammoth.js 提取纯文本
  │            │    ├─→ 应用 CJK 智能分词
  │            │    ├─→ 生成 Markdown 格式
  │            │    └─→ 返回 { text, markdown, extracted, chars, images }
  │            └─→ FileChip 显示进度 → 成功/警告/错误状态
  │        └─→ 消息随附件发送给 AI
  │
  └─→ [Inbox 路径]
      └─→ quickDropToInbox() (拖拽触发)
          └─→ 保存原 .docx 到 Inbox/
          └─→ 后台调用 /api/extract-docx (异步)
              ├─→ 提取完成后自动生成 .md 版本
              ├─→ 保存 Markdown 到同一目录
              └─→ Inbox 条目显示双文件状态

数据存储：
  Inbox/
  ├── original-report.docx         (原始文件)
  ├── original-report.md           (转换后 Markdown)
  └── .metadata/original-report.json (提取元数据：页数、字数、图片数等)
```

## 方案

### 3.1 文件格式支持
- **支持格式**：`.docx` (Office 2007+), `.docm` (含宏的 Word)
- **不支持**：`.doc` (旧 Word 97-2003)，`.odt` (OpenDocument) — 可在后续迭代支持

### 3.2 后端解析流程

#### 新增 API 端点：`POST /api/extract-docx`

**输入**：
```typescript
{
  base64: string;      // Base64 编码的 Word 文件
  filename: string;    // 原始文件名（用于日志和错误信息）
}
```

**输出**：
```typescript
{
  text: string;        // 纯文本（CJK 智能分词）
  markdown: string;    // Markdown 格式（标题、列表、表格等结构保留）
  extracted: boolean;  // 是否成功提取
  pages: number;       // 页数估算（非精确）
  chars: number;       // 字符数（未截断）
  truncated: boolean;  // 是否超过字符限制
  charsTruncated: number;  // 截断后字符数
  imageCount: number;  // 含有的图片数
  hasCharts: boolean;  // 是否含有图表
  warning?: string;    // 转换警告（如 "表格结构部分丢失"）
}
```

**错误响应**：
```typescript
{
  error: string;  // "invalid_format" | "corrupted" | "unsupported_version" | "timeout"
  message: string;  // 用户友好的错误提示
}
```

**字符限制**：
- 输出限制：100 KB 字符（同 PDF）
- 输入限制：12 MB（同 PDF）
- 超过限制时自动截断，`truncated: true`

#### 子进程实现：`scripts/extract-docx.cjs`

**步骤**：
1. 接收 base64 编码的 .docx 文件
2. 写入临时文件
3. 使用 `mammoth.js` 提取文本
4. 应用 CJK 智能分词（同 PDF 逻辑，参考 `extract-pdf.cjs` 的 CJK 检测）
5. 生成 Markdown：
   - 保留标题层级（h1-h6）
   - 列表转为 Markdown 格式（`-` 或 `*`）
   - 表格简化为文本（可选：用 `|` 保留结构）
   - 脚注/尾注转为括号注释 `[^1]`
   - 去除格式化但保留段落
6. 返回 JSON 结果
7. 清理临时文件

**关键 CJK 处理**（复用 extract-pdf.cjs 的逻辑）：
- 中文（U+4E00–U+9FFF）+ 中文 → 无空格
- 中文 + 拉丁字母 → 添加空格
- 日文假名 + 假名 → 无空格
- 日文假名 + 拉丁字母 → 添加空格
- 标点符号 + 任何 → 无空格（不添加重复标点前的空格）

### 3.3 前端集成

#### Chat 聊天框支持

**修改文件**：`app/hooks/useFileUpload.ts`
- 在 `ALLOWED_FORMATS` 中添加 `.docx`, `.docm`
- 在 MIME 类型中添加：
  - `application/vnd.openxmlformats-officedocument.wordprocessingml.document` (.docx)
  - `application/vnd.ms-word.document.macroEnabled.12` (.docm)

**修改文件**：`app/components/ask/AskContent.tsx`
- 更新文件输入的 `accept` 属性
- 更新"Attach File"按钮的提示文本（如 "支持：PDF、Word、CSV、JSON、Markdown"）

**修改文件**：`app/components/ask/FileChip.tsx`
- 新增 Word 图标（或复用文档图标）
- 在状态提示中加入 Word 特定信息（如 "X 页 / Y 字"）
- 错误提示中加入 Word 特有错误（如 "不支持的 Word 版本"）

#### Inbox 暂存台支持

**修改文件**：`app/lib/inbox-upload.ts`
- 在 `quickDropToInbox()` 中添加 Word 文件的处理
- 上传后自动调用 `/api/extract-docx`，生成 `.md` 版本

**修改文件**：`app/components/InboxView.tsx`
- 在文件列表中为 Word 文件显示额外信息（页数、字数）
- 添加右键菜单选项："查看 Markdown 版本" → 展开预览或打开编辑

#### 文件转换链

**修改文件**：`app/lib/core/file-convert.ts`
- 添加规则：`.docx` → `.md`（在 Inbox 处理时自动生成）
- 若用户手动指定，也可转换为其他格式（但初期先支持 → Markdown）

### 3.4 错误处理

| 错误场景 | 处理方式 | 用户提示 |
|----------|---------|---------|
| 文件已损坏 | 捕获 mammoth.js 异常 | "无法解析此 Word 文档，可能已损坏" |
| 不支持版本 | 检测文件头 | "暂不支持此 Word 版本，请另存为 .docx" |
| 超大文件 (>12MB) | 拒绝上传 | "文件过大，请压缩到 12 MB 以下" |
| 解析超时 (>30s) | 中断子进程 | "解析超时，请重试或选择较小文件" |
| 网络错误 | 重试 + 降级 | "上传失败，请检查网络后重试" |
| 表格/图片丢失 | 在 warning 字段告知 | FileChip 显示 ⚠️ + "表格结构未完整保留" |

### 3.5 性能优化

- **客户端 Base64 编码**：使用 Web Worker（>512KB），避免主线程阻塞
- **异步处理**：Chat 中立即显示 FileChip，后台异步解析，不阻塞用户继续输入
- **缓存**：对相同文件的重复提取请求，使用缓存减少重复计算（可选，后续迭代）
- **流式输出**：若转换内容超大，分块返回（可选，后续迭代）

## 影响范围

### 变更文件列表
1. **后端 API**：
   - 新增：`app/app/api/extract-docx/route.ts`
   - 新增：`app/scripts/extract-docx.cjs`

2. **前端 Hook & 组件**：
   - 修改：`app/hooks/useFileUpload.ts` (添加文件类型)
   - 修改：`app/components/ask/AskContent.tsx` (文件输入)
   - 修改：`app/components/ask/FileChip.tsx` (状态展示)
   - 修改：`app/components/InboxView.tsx` (文件列表)
   - 修改：`app/lib/inbox-upload.ts` (拖拽处理)
   - 修改：`app/lib/core/file-convert.ts` (格式转换规则)

3. **配置**：
   - 修改：`app/package.json` (添加 mammoth.js 依赖)

### 受影响的其他模块
- **API 字段新增**：Chat message attachment 中可能新增 `documentMetadata` 字段（可选，用于前端展示）
- **知识库索引**：Inbox 新增 .md 文件时，需确保被索引器扫描（现有流程应已支持）
- **备份/导出**：若导出知识库，需确保 .docx 和 .md 都被包含

### 破坏性变更
**无**——完全向后兼容。现有 PDF 处理和其他文件类型不受影响。

## 边界 case 与风险

### 边界 case（至少 3 个）

| Case | 处理方式 | 验证方法 |
|------|---------|---------|
| **空 Word 文档**（无内容） | 返回 `{ text: "", markdown: "", chars: 0 }` | 生成 0 字的测试文件 |
| **Word 含 100+ 张图片** | 图片丢失但提示 `"含 100 张图片，仅保留文本"` | 创建含多图测试文件 |
| **Word 表格含合并单元格** | 简化表格为纯文本，丢失结构 | 包含复杂表格的测试文件 |
| **Unicode 高级字符（Emoji、CJK Extended）** | 保留原样，不转义 | 包含 Emoji + 繁简混合的文件 |
| **Word 宏（.docm）** | 宏被移除（mammoth.js 自动处理），仅保留内容 | 上传含宏的 .docm 文件 |
| **超大页数（500+ 页）** | 正常解析但截断到 100K 字 | 生成大型文档 |
| **特殊编码（非 UTF-8 Word）** | mammoth.js 自动检测和转换 | （罕见，跳过） |
| **并发上传同一文件多次** | 前端防重复提交（禁用按钮直到完成） | 快速双击上传按钮 |
| **上传时网络断开** | 显示重试按钮，前端销毁 FileChip | 拔网线再恢复 |

### 已知风险

| 风险 | 影响 | Mitigation |
|------|------|-----------|
| **mammoth.js 库大小** | 打包体积增加 ~50KB | 延迟加载或动态导入该库（后续优化） |
| **复杂表格转文本丢失** | 某些表格信息无法完整保留 | 在错误消息中提示，建议用户查看原文件 |
| **Word 格式演进** | Office 新版本格式不支持 | 定期跟踪 mammoth.js 库更新 |
| **大文件解析慢** | 用户感知延迟 | 超时 30s 中断，显示重试选项 |
| **子进程崩溃** | 单个文件解析失败 | 进程异常捕获，返回错误信息而不是 500 |

## 验收标准

### 功能验收

- [ ] ✅ Chat 聊天框支持 .docx/.docm 文件上传（无文件类型错误）
- [ ] ✅ Inbox 暂存台支持拖拽 Word 文件（自动保存）
- [ ] ✅ 文件上传后自动调用 `/api/extract-docx`，FileChip 显示加载状态
- [ ] ✅ 解析成功后 FileChip 显示页数、字数、✓ 图标
- [ ] ✅ 解析失败显示错误信息和重试按钮
- [ ] ✅ 内容超过 100K 字自动截断，显示 ⚠️ 和警告文本
- [ ] ✅ Inbox 中自动生成 `.md` 版本（文件列表中同时显示 .docx 和 .md）

### 数据质量验收

- [ ] ✅ 纯文本提取正确率 >95%（中英混合、CJK 分词正确）
- [ ] ✅ Markdown 格式保留标题、列表、代码块（表格允许简化）
- [ ] ✅ Unicode 字符无损（Emoji、繁简中文、日文假名）
- [ ] ✅ 页数估算 <10% 误差（可选）

### 性能验收

- [ ] ✅ Chat 中文件上传到 FileChip 显示 <200ms（同步）
- [ ] ✅ 后端解析时间：
  - < 2 页文档 <1s
  - 10 页文档 <3s
  - 50 页文档 <10s
  - 100+ 页文档 <30s（否则超时）
- [ ] ✅ 无内存泄漏（子进程正常清理）

### UX 验收

- [ ] ✅ 用户在 Chat 中看不到任何解析失败的情况（降级处理，保留原文件链接）
- [ ] ✅ 加载状态有明确提示（不出现无反馈的等待）
- [ ] ✅ 错误消息用户友好（非技术术语）
- [ ] ✅ 支持撤销（删除 FileChip 后重新上传）

### 兼容性验收

- [ ] ✅ Word 97-2003 (.doc) 显示不支持提示（拒绝上传或返回错误）
- [ ] ✅ 现有 PDF 处理不受影响（PDF 测试用例仍 pass）
- [ ] ✅ Inbox 现有功能不受影响（文件列表、拖拽、删除等）

