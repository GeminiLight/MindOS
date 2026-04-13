# MarkItDown — 文件转换插件

> 基于微软 [MarkItDown](https://github.com/microsoft/markitdown) 的文件格式转换插件，将 Word / PPT / Excel / EPUB 等格式转为 Markdown 导入知识库。

## 基本信息

| 字段 | 值 |
|------|---|
| ID | `markitdown` |
| 类型 | 转换器（Converter） |
| 来源 | 外部依赖（Python，可选安装） |
| 上游 | `microsoft/markitdown` (54.8k stars) |
| 许可证 | MIT |

## 解决什么问题

MindOS 暂存台（Capture）目前支持导入 `.md .txt .csv .json .pdf`。
用户最常见的知识来源——Word、PPT、Excel、EPUB——无法直接导入。
接入 MarkItDown 后，暂存台可以处理 20+ 种格式，零额外配置。

## 支持格式

| 格式 | 扩展名 | 说明 |
|------|--------|------|
| Word | `.docx` | 保留标题层级、列表、表格 |
| PowerPoint | `.pptx` | 逐页提取文本和标题 |
| Excel | `.xlsx .xls` | 转为 Markdown 表格 |
| PDF | `.pdf` | 替代现有 JS 解析，质量更高 |
| EPUB | `.epub` | 电子书章节提取 |
| HTML | `.html .htm` | 替代现有 Readability + Turndown |
| XML | `.xml` | 结构化提取 |
| ZIP | `.zip` | 递归解包后逐文件转换 |
| 图片 | `.jpg .png` | OCR 提取文字（需 `markitdown-ocr` 插件） |
| 音频 | `.mp3 .wav` | 语音转录（需 `[audio-transcription]`） |
| YouTube | URL | 获取字幕/转录文本 |

## 安装

### 最小安装（推荐，~200KB + 已有依赖）

```bash
pip install 'markitdown[pdf,docx,pptx,xlsx]'
```

### 完整安装（~16MB，含文件类型检测模型）

```bash
pip install 'markitdown[all]'
```

### 验证

```bash
markitdown --version
echo "hello" > /tmp/test.txt && markitdown /tmp/test.txt
```

## 空间成本

| 安装方式 | 新增依赖 | 总大小 | 对 MindOS npm 包影响 |
|----------|---------|--------|---------------------|
| 最小安装 | markitdown + mammoth + markdownify + cobble | ~130 KB | **零**（Python 侧依赖） |
| 完整安装 | 上面 + magika（ONNX 模型） | ~16 MB | **零** |
| `[all]`（含 Azure/Audio） | + azure-sdk + speechrecognition | ~50-100 MB | **零** |

**关键**：MarkItDown 是 Python 包，不进入 `npm install`，不影响 MindOS App 体积。
仅当用户本地安装了 Python + markitdown 时才可用，否则回退到现有 JS 转换。

## 集成方式

### 架构

```
暂存台上传 .docx
    │
    ▼
[检测 markitdown CLI 是否可用]
    │                │
    ▼ 可用           ▼ 不可用
markitdown          回退 JS 转换
file.docx           (仅 .md/.txt/.csv/.json/.pdf)
    │
    ▼
stdout → .md
    │
    ▼
保存到 Inbox/
```

### 接入点

1. **`app/lib/core/inbox.ts`** — `saveToInbox()` 接收文件时，对非 Markdown 格式先调用 markitdown 转换
2. **`app/lib/file-convert.ts`** — 新增 `convertWithMarkItDown()` 函数，通过 `child_process.execFileSync` 调用 CLI
3. **`app/app/api/inbox/route.ts`** — POST 端点处理新格式的 MIME type

### 检测逻辑（伪代码）

```typescript
import { execFileSync } from 'child_process';

let _available: boolean | null = null;

export function isMarkItDownAvailable(): boolean {
  if (_available !== null) return _available;
  try {
    execFileSync('markitdown', ['--version'], { timeout: 3000 });
    _available = true;
  } catch {
    _available = false;
  }
  return _available;
}

export function convertWithMarkItDown(filePath: string): string {
  const result = execFileSync('markitdown', [filePath], {
    encoding: 'utf-8',
    timeout: 30000,
    maxBuffer: 10 * 1024 * 1024,
  });
  return result;
}
```

## MCP 集成（可选）

MarkItDown 提供了官方 MCP Server：[markitdown-mcp](https://github.com/microsoft/markitdown/tree/main/packages/markitdown-mcp)

```bash
pip install markitdown-mcp
```

MindOS AI Agent 可通过 MCP 协议直接调用文件转换，适合在 AI 整理（Organize）流程中处理非 Markdown 文件。

## 实施路线

| 阶段 | 内容 | 前置条件 |
|------|------|---------|
| **P0** | 检测 + CLI 调用 + 暂存台支持新格式上传 | 无 |
| **P1** | 前端 accept 扩展名更新 + 格式 badge | P0 |
| **P2** | MCP 集成，AI Agent 自主调用 | markitdown-mcp 安装 |
| **P3** | 设置面板显示插件状态（已安装/未安装） | P0 |

## 参考

- GitHub: https://github.com/microsoft/markitdown
- MCP Server: https://github.com/microsoft/markitdown/tree/main/packages/markitdown-mcp
- 支持的格式完整列表: https://github.com/microsoft/markitdown#supported-formats
