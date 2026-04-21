# Spec: Performance Optimization - Week 1 High-Impact Fixes

## 概述

优化 MindOS 的性能瓶颈和内存占用，聚焦 3 个高影响问题：
1. Lazy load 重度依赖（减少 100-150MB bundle）
2. React.memo 优化列表组件（减少 50-70% 重渲染）
3. 虚拟化 MessageList（支持 500+ 消息无卡顿）

## 背景

基于系统性能分析报告（2026-04-21），发现：
- **Bundle size**: 196MB 关键依赖（pdfjs-dist 37MB, @huggingface/transformers 14MB, onnxruntime-web 128MB）
- **Runtime performance**: 缺少 React 优化（154 个组件中只有 5 个使用 React.memo）
- **Memory usage**: MessageList 渲染所有消息，100+ 消息时占用 200MB+ 内存

用户反馈：应用启动慢（5-8 秒）、文件树交互卡顿、聊天消息多时滚动不流畅。

## 目标

- 首屏加载时间减少 2-4 秒（从 5-8 秒降到 2-4 秒）
- 文件树/Inbox 交互响应时间 <16ms（当前 100-300ms）
- 支持 500+ 聊天消息无卡顿（当前 100+ 消息时明显卡顿）
- 内存占用减少 150-300MB

## User Flow

### 优化 1：Lazy Loading

**用户目标**：应用启动更快

**前置条件**：用户已安装 MindOS

**Step 1**: 用户打开应用
  → 系统反馈：首屏快速加载（2-3 秒，比优化前快 2-4 秒）
  → 状态变化：只加载核心代码，重度依赖按需加载

**Step 2**: 用户点击 PDF 文件
  → 系统反馈：显示 "Loading PDF viewer..." 提示（<500ms）
  → 状态变化：动态加载 pdfjs-dist（37MB），加载完成后显示 PDF

**Step 3**: 用户在设置中启用本地嵌入搜索
  → 系统反馈：显示 "Loading embedding model..." 进度条
  → 状态变化：动态加载 @huggingface/transformers（14MB）

**成功结果**：应用启动快 2-4 秒，内存占用减少 100-150MB

**异常分支**：
- 异常 A：动态加载失败 → 显示错误提示 "Failed to load component. Please refresh." + 重试按钮 → 用户可重试
- 异常 B：网络慢导致加载超时 → 显示进度条 + 预估时间 → 用户知道正在加载
- 异常 C：浏览器不支持动态导入 → 降级到全量加载 → 记录警告日志

**边界场景**：
- 用户快速切换多个 PDF → 只加载一次 PDF 渲染器（缓存）
- 用户从未使用本地嵌入 → 永远不加载 transformers
- 离线环境 → 提示需要网络连接下载模型

### 优化 2：React.memo

**用户目标**：文件树和 Inbox 交互流畅

**前置条件**：用户有一定量的文件（50+ 个）

**Step 1**: 用户在文件树中展开/折叠文件夹
  → 系统反馈：即时响应（<16ms），无卡顿
  → 状态变化：只重渲染变化的节点，其他节点跳过渲染

**Step 2**: 用户在 Inbox 中拖拽文件
  → 系统反馈：流畅的拖拽动画（60fps）
  → 状态变化：只更新拖拽目标，其他文件行不重渲染

**Step 3**: 用户在文件树中搜索
  → 系统反馈：输入即时过滤（<50ms）
  → 状态变化：只重渲染过滤结果，已渲染节点复用

**成功结果**：文件树和 Inbox 交互流畅，CPU 占用降低 40-60%

**异常分支**：
- 异常 A：文件树节点过多（1000+）→ 保持流畅（memo 优化生效）→ 用户无感知
- 异常 B：频繁状态更新 → startTransition 包裹（已在之前优化中实现）→ 优先响应用户输入

**边界场景**：
- 空文件树 → 显示空状态提示，无性能问题
- 单个文件 → 正常渲染，无性能问题
- 10000+ 文件 → memo 优化生效，保持流畅

### 优化 3：MessageList 虚拟化

**用户目标**：聊天消息多时滚动流畅

**前置条件**：用户有一个包含 100+ 消息的聊天会话

**Step 1**: 用户打开有 100+ 消息的聊天会话
  → 系统反馈：快速加载（<1 秒），滚动流畅
  → 状态变化：只渲染可见的 20-30 条消息

**Step 2**: 用户滚动查看历史消息
  → 系统反馈：平滑滚动（60fps），无卡顿
  → 状态变化：动态渲染进入视口的消息，移除离开视口的消息

**Step 3**: 用户发送新消息
  → 系统反馈：自动滚动到底部，新消息立即显示
  → 状态变化：追加新消息到虚拟列表，保持滚动位置

**成功结果**：支持 500+ 消息无卡顿，内存占用减少 60-80%

**异常分支**：
- 异常 A：消息包含大图片 → 懒加载图片（已有实现）→ 显示占位符直到进入视口
- 异常 B：消息包含复杂 Markdown → 缓存渲染结果（react-markdown 内置）→ 避免重复解析
- 异常 C：快速滚动 → Virtuoso 自动优化 → 避免过度渲染

**边界场景**：
- 空会话 → 显示欢迎消息，无虚拟化开销
- 单条消息 → 正常渲染，无虚拟化开销
- 消息高度不一致 → Virtuoso 动态测量高度，保持滚动位置

## 方案选择

### 优化 1：Lazy Loading

**选择方案**：React.lazy() + Suspense

**对比**：

| 方案 | UX 质量 | 实现复杂度 | 可维护性 | 风险 |
|------|---------|-----------|---------|------|
| A: React.lazy + Suspense | ⭐⭐⭐⭐⭐ | 低 | 高 | 低 |
| B: 动态 import + 手动状态 | ⭐⭐⭐ | 中 | 中 | 中 |
| C: Webpack Code Splitting | ⭐⭐⭐⭐ | 低 | 低 | 中 |

**选择理由**：
- UX 最好：有 loading 状态提示，用户体验自然
- 实现最简单：React 内置支持，每个组件 3-5 行改动
- 可维护性最高：标准 React 模式，易于理解和扩展
- 风险最低：成熟方案，广泛使用

### 优化 2：React.memo

**选择方案**：React.memo + useMemo + useCallback

**对比**：

| 方案 | UX 质量 | 实现复杂度 | 可维护性 | 风险 |
|------|---------|-----------|---------|------|
| A: React.memo + hooks | ⭐⭐⭐⭐⭐ | 低 | 高 | 低 |
| B: Immutable.js | ⭐⭐⭐⭐ | 高 | 中 | 中 |
| C: react-window | ⭐⭐⭐⭐⭐ | 中 | 中 | 中 |

**选择理由**：
- UX 好：减少 50-70% 重渲染，交互流畅
- 实现简单：标准 React 优化模式，每个组件 5-10 行改动
- 风险低：不改变组件结构，不引入新依赖

### 优化 3：MessageList 虚拟化

**选择方案**：react-virtuoso（已安装）

**对比**：

| 方案 | UX 质量 | 实现复杂度 | 可维护性 | 风险 |
|------|---------|-----------|---------|------|
| A: react-virtuoso | ⭐⭐⭐⭐⭐ | 低 | 高 | 低 |
| B: react-window | ⭐⭐⭐⭐ | 中 | 中 | 中 |
| C: 自定义虚拟化 | ⭐⭐⭐ | 高 | 低 | 高 |

**选择理由**：
- UX 最好：支持 500+ 消息无卡顿，自动处理动态高度
- 实现最简单：已安装依赖，API 简单（10-20 行代码）
- 已验证：SearchPanel 已使用 Virtuoso，证明可用

## 技术设计

### 优化 1：Lazy Loading

**目标组件**：
1. PDF 渲染器（pdfjs-dist 37MB）
2. 本地嵌入模型（@huggingface/transformers 14MB）
3. WYSIWYG 编辑器（@tiptap/@milkdown 17MB）
4. Graph 渲染器（@xyflow/react）

**实现方式**：

```typescript
// 1. PDF 渲染器
// app/components/renderers/pdf/PdfRenderer.tsx
const PdfRenderer = lazy(() => import('./PdfRendererImpl'));

export default function PdfRendererWrapper(props: PdfRendererProps) {
  return (
    <Suspense fallback={<LoadingSpinner message="Loading PDF viewer..." />}>
      <PdfRenderer {...props} />
    </Suspense>
  );
}

// 2. 本地嵌入模型
// app/lib/core/embedding-provider.ts
async function loadLocalModel() {
  const { pipeline } = await import('@huggingface/transformers');
  // ... 初始化逻辑
}

// 3. WYSIWYG 编辑器
const WysiwygEditor = lazy(() => import('./WysiwygEditorImpl'));

// 4. Graph 渲染器
const GraphRenderer = lazy(() => import('./renderers/graph/GraphRendererImpl'));
```

**Loading 状态**：
- 使用统一的 LoadingSpinner 组件
- 显示加载消息（"Loading PDF viewer...", "Loading editor..."）
- 超过 3 秒显示进度条（如果可获取）

**错误处理**：
- 使用 ErrorBoundary 捕获加载错误
- 显示友好的错误消息 + 重试按钮
- 记录错误日志到 console

### 优化 2：React.memo

**目标组件**：
1. FileTree.tsx（635 行）
2. InboxView.tsx（767 行）
3. DirView.tsx（598 行）

**实现方式**：

```typescript
// FileTree.tsx
const FileTree = memo(function FileTree({ nodes, onNavigate }: FileTreeProps) {
  // 1. Memoize 过滤逻辑
  const visibleNodes = useMemo(() =>
    showHidden ? nodes : filterHiddenNodes(nodes, isRoot),
    [nodes, showHidden, isRoot]
  );

  // 2. Memoize 回调函数
  const handleToggle = useCallback((path: string) => {
    setExpanded(prev => ({ ...prev, [path]: !prev[path] }));
  }, []);

  // 3. 子组件已有 memo（DirectoryNode, FileNodeItem）
  return <div>{visibleNodes.map(node => ...)}</div>;
});

// InboxView.tsx
const InboxView = memo(function InboxView({ files }: InboxViewProps) {
  // 1. Memoize 排序逻辑
  const sortedFiles = useMemo(() =>
    [...files].sort((a, b) => b.mtime - a.mtime),
    [files]
  );

  // 2. Memoize 拖拽处理
  const handleDragStart = useCallback((e: DragEvent, file: FileNode) => {
    e.dataTransfer.setData('text/plain', file.path);
  }, []);

  return <div>{sortedFiles.map(file => ...)}</div>;
});

// DirView.tsx
const DirView = memo(function DirView({ files }: DirViewProps) {
  // 类似优化
});
```

**优化原则**：
- 只对重度渲染的组件使用 memo（>100 行或包含列表）
- 使用 useMemo 缓存计算结果（排序、过滤）
- 使用 useCallback 缓存回调函数（传递给子组件的）
- 子组件已有 memo 的保持不变

### 优化 3：MessageList 虚拟化

**目标组件**：
- app/components/ask/MessageList.tsx（473 行）

**实现方式**：

```typescript
import { Virtuoso } from 'react-virtuoso';

export default function MessageList({ messages }: MessageListProps) {
  const virtuosoRef = useRef<VirtuosoHandle>(null);

  // 自动滚动到底部（新消息）
  useEffect(() => {
    if (messages.length > 0) {
      virtuosoRef.current?.scrollToIndex({
        index: messages.length - 1,
        behavior: 'smooth',
      });
    }
  }, [messages.length]);

  return (
    <Virtuoso
      ref={virtuosoRef}
      data={messages}
      itemContent={(index, message) => (
        <MessageItem key={message.id} message={message} />
      )}
      followOutput="smooth"
      initialTopMostItemIndex={messages.length - 1}
    />
  );
}
```

**关键配置**：
- `followOutput="smooth"`：新消息时自动滚动
- `initialTopMostItemIndex`：初始滚动到底部
- `itemContent`：渲染单条消息
- 保留现有的 MessageItem 组件（不改变渲染逻辑）

## 验收标准

### 优化 1：Lazy Loading

- [ ] 首屏加载时间减少 2-4 秒（使用 Chrome DevTools Performance 测量）
- [ ] PDF 文件首次点击显示 "Loading PDF viewer..." 提示
- [ ] 本地嵌入启用时显示 "Loading embedding model..." 进度条
- [ ] 动态加载失败时显示错误提示 + 重试按钮
- [ ] 已加载的组件再次使用时无需重新加载（缓存生效）
- [ ] Bundle size 减少 100-150MB（使用 webpack-bundle-analyzer 验证）

### 优化 2：React.memo

- [ ] FileTree 展开/折叠响应时间 <16ms（使用 React DevTools Profiler 测量）
- [ ] Inbox 拖拽文件时帧率 ≥60fps（使用 Chrome DevTools Performance 测量）
- [ ] 文件树搜索过滤响应时间 <50ms
- [ ] 重渲染次数减少 50-70%（使用 React DevTools Profiler 对比）
- [ ] 100+ 文件时交互无卡顿

### 优化 3：MessageList 虚拟化

- [ ] 100+ 消息的会话加载时间 <1 秒
- [ ] 滚动帧率 ≥60fps（使用 Chrome DevTools Performance 测量）
- [ ] 新消息自动滚动到底部
- [ ] 滚动到历史消息时平滑加载
- [ ] 内存占用减少 60-80%（使用 Chrome DevTools Memory 对比）
- [ ] 支持 500+ 消息无卡顿

### 通用验收

- [ ] 所有现有测试通过（1933 tests）
- [ ] 无新增 console 错误或警告
- [ ] 无功能回归（手动测试核心功能）
- [ ] 文档更新（wiki/80-known-pitfalls.md, wiki/85-backlog.md）

## 风险与缓解

### 风险 1：动态加载失败

**影响**：用户无法使用 PDF 查看器或本地嵌入

**缓解**：
- 显示清晰的错误消息 + 重试按钮
- 提供降级方案（PDF 下载链接，切换到 API 嵌入）
- 记录错误日志便于调试

### 风险 2：memo 导致状态不同步

**影响**：组件不更新，显示过期数据

**缓解**：
- 仔细检查 memo 的依赖项
- 使用 React DevTools 验证 props 变化
- 充分测试边界场景

### 风险 3：虚拟化影响现有功能

**影响**：消息滚动、自动滚动到底部等功能异常

**缓解**：
- 保留现有的 MessageItem 组件（不改变渲染逻辑）
- 充分测试滚动、新消息、历史消息等场景
- 使用 Virtuoso 的成熟 API（followOutput, scrollToIndex）

## 实施计划

### Phase 1：Lazy Loading（2 天）
- Day 1：实现 PDF/Graph/Editor 的 lazy loading
- Day 2：实现 embedding model 的动态加载 + 测试

### Phase 2：React.memo（1 天）
- Day 3：优化 FileTree/InboxView/DirView + 测试

### Phase 3：MessageList 虚拟化（1 天）
- Day 4：实现 Virtuoso 虚拟化 + 测试

### Phase 4：验证与文档（1 天）
- Day 5：性能测试、文档更新、提交

## 参考资料

- React.lazy 文档：https://react.dev/reference/react/lazy
- React.memo 文档：https://react.dev/reference/react/memo
- react-virtuoso 文档：https://virtuoso.dev/
- 性能分析报告：wiki/refs/performance-analysis-2026-04-21.md（待创建）
