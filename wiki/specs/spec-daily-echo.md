# Spec: 每日回响（Daily Echo）— 个人成长日报

## 目标

为用户生成**自动化的个人成长日报**，基于其过去 24 小时的行为（文件编辑、AI 对话、日计划）进行反思和对齐分析。帮助用户理解工作模式、明确成长方向、发现意图与行动之间的偏差。

## 现状分析

### 现有 Echo 系统

MindOS 已有 5 个 Echo 段面（`app/lib/echo-segments.ts`）：
- **about-you** — 指向你的笔记
- **continued** — 草稿和开放任务  
- **daily** — 今日一句话（当前仅支持单行输入，存于 localStorage）
- **past-you** — 往日瞬间（未实现）
- **growth** — 成长方向（用户设定的长期意图）

现状问题：
- **Daily 段现在只是输入框** — 用户写入"今日焦点"但无自动反思
- **无行为聚合** — 不收集用户 24h 的文件编辑、对话模式
- **无对齐检测** — 无法告诉用户：他说要做 A，实际做了 B，差异原因何在
- **无成长连接** — 每日孤立；无长期学习路径可视化

### 用户期望

用户希望：
1. 无需手动复盘，**系统自动生成日报**
2. 看到**今日做了什么** — 文件编辑、主题聚类
3. 检测**计划 vs 现实** — 对齐度评分
4. 获得**思考提示** — 不是指挥，是好奇的问题
5. 形成**历史记录** — 追踪一周/一月的成长趋势

## 数据流 / 状态流

```
用户在 /echo/daily 页面
    │
    ├─ 输入 "Today's thought"（现有）
    │   ↓ localStorage.setItem('mindos-echo-daily-line')
    │
    └─ 点击 [生成今日回响]（新）
        │
        ├─────────────────────────────────────────────────────────┐
        │ 数据聚合（DataAggregation Layer）                       │
        ├─────────────────────────────────────────────────────────┤
        │                                                          │
        │ ├─ GET /api/changes?since=<24h前的时间>                │
        │ │     → 获取文件编辑列表（路径、操作类型、时间戳）      │
        │ │                                                      │
        │ ├─ GET /api/ask-sessions?since=<24h前>                │
        │ │     → 获取聊天会话计数和长度                         │
        │ │                                                      │
        │ ├─ localStorage.getItem('mindos-echo-daily-line')      │
        │ │     → 今日计划行                                     │
        │ │                                                      │
        │ └─ localStorage.getItem('mindos-echo-growth-intent')   │
        │       → 长期成长意图                                   │
        │                                                          │
        ├──────────────────────────────────────────────────┐
        │ 快照生成（Snapshot Generation）                 │
        └──────────────────────────────────────────────────┤
        │ 计算原始统计：                                  │
        │ • filesEdited: 不同文件总数                     │
        │ • filesCreated: 新建文件数                      │
        │ • sessionCount: 会话数                          │
        │ • kbGrowth: 知识库增长量（+12 KB）             │
        │                                                  │
        └───────────────────────┬────────────────────────────────────┐
        │ LLM 调用 1: 主题提取                          │
        ├───────────────────────┤ (POST /api/daily-echo/generate)   │
        │                                                │
        │ Input: fileNames[] + language                │
        │ Output JSON:                                 │
        │ {                                            │
        │   themes: [                                 │
        │     {                                       │
        │       name: "Infrastructure & DevOps",      │
        │       fileCount: 4,                         │
        │       percentage: 65,                       │
        │       description: "Setup phase—...",       │
        │       workType: "strategic"                 │
        │     },                                      │
        │     ...                                     │
        │   ]                                         │
        │ }                                           │
        │                                                │
        └─────────────┬────────────────────────────────────────┐
        │ LLM 调用 2: 对齐分析                       │
        ├─────────────┤                              │
        │                                           │
        │ Input:                                    │
        │ • dailyLine (e.g., "完成 async 文档")    │
        │ • growthIntent (e.g., "精通生产 async")  │
        │ • themes (来自上一步)                     │
        │                                           │
        │ Output:                                   │
        │ {                                         │
        │   alignmentScore: 65,  // 0-100          │
        │   analysis: "Markdown narrative...",     │
        │   reasoning: "主要偏离原因..."             │
        │ }                                         │
        │                                           │
        └─────────────┬────────────────────────────────────────┐
        │ LLM 调用 3: 反思提示                       │
        ├─────────────┤                              │
        │                                           │
        │ Input:                                    │
        │ • alignment 分析（来自上一步）           │
        │ • themes（来自第 1 步）                   │
        │ • growthIntent                            │
        │                                           │
        │ Output:                                   │
        │ {                                         │
        │   prompts: [                              │
        │     "你的成长意图是...",                   │
        │     "是否是正当的优先级转移？",            │
        │     "..."                                 │
        │   ]                                       │
        │ }                                         │
        │                                           │
        ├──────────────────────────────────────────────────┐
        │ 报告编译（Report Compilation）            │
        └──────────────────────────────────────────────────┤
        │ 组合所有字段 → DailyEchoReport 对象       │
        │ 转换为 Markdown（export 用）              │
        │                                          │
        └────────────────┬──────────────────────────────────┐
        │ 存储（Storage）                  │
        ├────────────────┤                  │
        │                                  │
        │ IndexedDB 'daily-echo-reports'  │
        │ Key: "YYYY-MM-DD"               │
        │ Value: {                         │
        │   id, generatedAt, snapshot,    │
        │   themes, alignment, prompts,   │
        │   rawMarkdown, ...              │
        │ }                                │
        │                                  │
        └────────────────┬─────────────────────────────────┐
        │ UI 渲染（Drawer）          │
        ├────────────────┤            │
        │                           │
        │ Desktop: 右侧抽屉展开     │
        │ Mobile: 全屏 modal        │
        │                           │
        │ 可折叠段：                │
        │ ✓ 快照（初始展开）        │
        │ ✓ 主题（初始展开）        │
        │ ✓ 对齐（初始展开）        │
        │ ✓ 反思提示（初始展开）    │
        │                           │
        └─────────────────────────┬──────────────────────┐
                                  │
                            用户可操作：
                            • 阅读报告
                            • 点击 [继续与 Agent]
                            •  点击 [重新生成]
                            • （未来）[导出 PDF]
```

**读写组件：**
- **写数据：** 
  - `EchoSegmentPageClient` → 点击 [生成] 按钮 → API 调用
  - `/api/daily-echo/generate` → 聚合数据、LLM 处理、保存 IndexedDB
  
- **读数据：** 
  - `DailyEchoReportDrawer` — 从 IndexedDB 读取已生成报告
  - `EchoSidebarStats` — （未来）显示"今日报告"链接
  
- **缓存：**
  - IndexedDB 缓存报告（每天一份，key 为日期）
  - localStorage 缓存配置（scheduleTime、语言、启用状态）
  - 报告生成后 localStorage 记录 `lastGeneratedAt` 时间戳

## 方案

### 1. 数据聚合模块（`app/lib/daily-echo/aggregator.ts`）

```typescript
export interface DailyEchoRawData {
  date: string;                 // YYYY-MM-DD
  filesEdited: string[];        // 编辑过的文件路径数组
  filesCreated: number;         // 新建文件数
  totalFiles: number;           // 编辑的不同文件总数
  sessionCount: number;         // AI 聊天会话数
  kbGrowth: string;             // "+12 KB" 或 "same"
  dailyLine: string;            // 今日一句话
  growthIntent: string;         // 长期成长意图
}

export async function aggregateDailyData(
  date: Date
): Promise<DailyEchoRawData>
```

职责：
- 从 `/api/changes` 获取 24h 文件编辑列表
- 从 `/api/ask-sessions` 获取聊天计数
- 从 localStorage 读取 daily-line 和 growth-intent
- 计算 KB 增长（对比时间戳前后的数据）
- 错误处理：API 失败返回部分数据而非完全失败

### 2. 快照生成（`app/lib/daily-echo/snapshot.ts`）

```typescript
export interface DailySnapshot {
  filesEdited: number;
  filesCreated: number;
  sessionCount: number;
  kbGrowth: string;
}

export function generateSnapshot(raw: DailyEchoRawData): DailySnapshot
```

职责：
- 格式化原始统计数据
- 计算友好的展示文本（"6 files · +12 KB"）

### 3. LLM 提示构造器（`app/lib/daily-echo/prompts.ts`）

三个独立函数：

**3a. 主题提取提示**
```typescript
export function buildThemeExtractionPrompt(opts: {
  fileNames: string[];
  language: 'en' | 'zh';
}): string
```

提示内容：分析文件名列表，识别 2-4 个coherent 的主题，每个包含name/description/workType。

**3b. 对齐分析提示**
```typescript
export function buildAlignmentPrompt(opts: {
  dailyLine: string;
  growthIntent: string;
  themes: DailyTheme[];
  language: 'en' | 'zh';
}): string
```

提示内容：对比用户声明的意图 vs 实际工作主题，计算 0-100 的对齐度，输出结构化 JSON。

**3c. 反思提示生成**
```typescript
export function buildReflectionPromptsPrompt(opts: {
  alignment: AlignmentAnalysis;
  themes: DailyTheme[];
  dailyLine: string;
  growthIntent: string;
  language: 'en' | 'zh';
}): string
```

提示内容：生成 2-3 个好奇但非指责的问题，帮助用户自我反思。

### 4. 报告生成器（`app/lib/daily-echo/generator.ts`）

```typescript
export async function generateDailyEchoReport(
  date: Date,
  config: DailyEchoConfig
): Promise<DailyEchoReport>
```

职责：
- 调用 `aggregateDailyData()` 获取原始数据
- 顺序调用 3 个 LLM 提示，获得 themes / alignment / prompts
- 处理 LLM 错误（缺少数据时降级到快照模式）
- 解析并验证 JSON 响应形状
- 编译最终报告对象
- 返回完整的 `DailyEchoReport`

### 5. 存储层（`app/lib/db/daily-echo-db.ts`）

IndexedDB 操作：

```typescript
export async function saveDailyEchoReport(report: DailyEchoReport): Promise<void>
export async function getDailyEchoReport(date: string): Promise<DailyEchoReport | null>
export async function getAllDailyEchoReports(): Promise<DailyEchoReport[]>
export async function deleteDailyEchoReport(date: string): Promise<void>
export async function cleanupOldReports(daysToKeep: number = 30): Promise<void>
```

- 使用 `YYYY-MM-DD` 作为 key（便于按日期查询）
- 自动清理超过 30 天的旧报告（可配置）

### 6. 配置管理（`app/lib/daily-echo/config.ts`）

```typescript
export interface DailyEchoConfig {
  enabled: boolean;                    // 启用开关
  scheduleTime: string;                // "20:00"（24h 格式）
  timezone: string;                    // "Asia/Shanghai"
  language: 'en' | 'zh';               // 报告语言
  includeChat: boolean;                // 是否分析聊天会话
  includeTrendAnalysis: boolean;        // 是否包含 7 天趋势分析
  maxReportLength: 'short' | 'medium' | 'long'; // 报告长度
}

export async function loadDailyEchoConfig(): Promise<DailyEchoConfig>
export async function saveDailyEchoConfig(config: DailyEchoConfig): Promise<void>
export async function resetConfig(): Promise<void>
```

- localStorage key: `mindos-daily-echo-config`
- 默认配置：enabled=false（用户手动启用），scheduleTime="20:00"

### 7. API 路由（`app/app/api/daily-echo/generate/route.ts`）

```
POST /api/daily-echo/generate
Content-Type: application/json

Body:
{
  date?: string;  // YYYY-MM-DD，默认今日
}

Response (200):
{
  report: DailyEchoReport,
  cached: boolean  // true 表示从缓存返回（非新生成）
}

Response (400):
{
  error: "知识库未配置" | "AI 提供者未配置" | ...
}
```

服务端：
- 验证请求日期合法性（不能是未来日期）
- 调用 `generateDailyEchoReport()`
- 返回报告或缓存数据

### 8. UI 组件

**8a. 触发按钮** (`app/components/echo/DailyEcho/DailyEchoReportButton.tsx`)
- 显示 "生成今日回响" 按钮
- Loading 状态：显示微调转轮 + "生成中..."
- Error 状态：显示错误提示 + [重试] 按钮
- Success：触发 onGenerated 回调，打开抽屉

**8b. 报告抽屉** (`app/components/echo/DailyEcho/DailyEchoReportDrawer.tsx`)
- Desktop: 从右侧滑入，宽度 40vw
- Mobile: 底部 sheet 或全屏 modal
- Header: 标题 + "生成于 X 小时前" + [重新生成] + [关闭]
- Body: 5 个可折叠段
  - 快照（默认展开）
  - 主题（默认展开）
  - 对齐（默认展开）
  - 反思（默认展开）
- Footer: [继续与 Agent] + [下载 PDF]（未来）

**8c. 快照段** (`DailyEchoSnapshotSection.tsx`)
- 3 列网格：Files | Sessions | Growth
- 简洁数字展示

**8d. 主题段** (`DailyEchoThemesSection.tsx`)
- 2-4 张主题卡片，每张包含：
  - 图标 + 名称 + 百分比
  - 工作类型徽章
  - 可展开详情（文件列表、模式描述）

**8e. 对齐段** (`DailyEchoAlignmentSection.tsx`)
- 进度条：0-100 分，色彩编码
  - 🔴 0-40: 偏离
  - 🟡 40-70: 部分偏离
  - 🟢 70-100: 对齐
- 今日声明 vs 实际行动的文字对比
- 分析叙述

**8f. 反思段** (`DailyEchoReflectionSection.tsx`)
- "明天思考" 为标题
- 项目符号列表，每项为一个问题

**8g. 集成** (`EchoSegmentPageClient.tsx`)
- 在"今日一句话"下方添加按钮
- 管理报告抽屉的 open/close 状态
- 传递 onRegenerate、onContinueAgent 回调

### 9. 与 Agent 集成

点击 [继续与 Agent]：
- 预填充 Ask Modal 内容：报告中的关键信息（主题、对齐分析、反思提示）
- 用户可直接与 Agent 讨论这些模式

### 10. i18n 支持

在 `app/lib/i18n/modules/knowledge.ts` 中新增 `dailyEcho` 命名空间：

```typescript
dailyEcho: {
  title: '每日回响',
  generate: '生成今日回响',
  generating: '生成中...',
  generated: '生成于 {time}',
  regenerate: '重新生成',
  download: '下载 PDF',
  continueAgent: '继续与 Agent',
  
  // 快照
  snapshotTitle: '今日动向',
  filesEdited: '文件编辑',
  filesCreated: '新建文件',
  sessions: '聊天会话',
  kbGrowth: '知识库增长',
  
  // 主题
  themesTitle: '今日主题',
  themePattern: '模式：{pattern}',
  themeWorkType: '工作类型：{type}',
  themeStrategic: '策略性',
  themeTactical: '执行性',
  themeLearning: '学习性',
  themeMaintenance: '维护性',
  
  // 对齐
  alignmentTitle: '对齐度',
  alignmentScore: '{score}/100',
  alignmentMisaligned: '偏离',
  alignmentPartial: '部分对齐',
  alignmentAligned: '对齐',
  
  // 反思
  reflectionTitle: '明天思考',
  
  // 错误
  errorNoKb: '请先配置知识库路径',
  errorNoAi: '请先配置 AI 提供者',
  errorGeneration: '报告生成失败，请重试',
  
  // 设置
  settingsTitle: '每日回响设置',
  settingsEnable: '启用每日回响',
  settingsSchedule: '生成时间',
  settingsTimezone: '时区',
  settingsLength: '报告长度',
  // ...
}
```

## 影响范围

### 变更文件列表

| 文件 | 操作 | 说明 |
|------|------|------|
| `app/lib/daily-echo/aggregator.ts` | 新增 | 数据聚合逻辑 |
| `app/lib/daily-echo/snapshot.ts` | 新增 | 快照生成 |
| `app/lib/daily-echo/prompts.ts` | 新增 | LLM 提示构造 |
| `app/lib/daily-echo/generator.ts` | 新增 | 报告生成器 |
| `app/lib/daily-echo/config.ts` | 新增 | 配置管理 |
| `app/lib/db/daily-echo-db.ts` | 新增 | IndexedDB 操作 |
| `app/app/api/daily-echo/generate/route.ts` | 新增 | API 路由 |
| `app/components/echo/EchoSegmentPageClient.tsx` | 修改 | 集成按钮 + 抽屉 |
| `app/components/echo/DailyEcho/` | 新增 | UI 组件文件夹（6 个组件） |
| `app/lib/i18n/modules/knowledge.ts` | 修改 | 新增 dailyEcho i18n 键 |
| `app/__tests__/lib/daily-echo-*.test.ts` | 新增 | 单元测试（5 个文件） |
| `app/__tests__/components/DailyEcho/` | 新增 | 组件测试（3 个文件） |

### 受影响但不修改的模块

- **EchoSegmentNav.tsx** — 无需改动，daily 段路由保持不变
- **EchoInsightCollapsible.tsx** — 无需改动，独立存在
- **EchoSidebarStats.tsx** — 未来可添加"今日报告链接"，现阶段无需改

### 破坏性变更

无。Daily 段现有的"一句话"输入框保留，新增报告功能在其下方。

## 边界 case 与风险

| # | 边界 case | 处理方式 |
|---|-----------|---------|
| 1 | 用户 24h 内无文件编辑 | 报告生成快照，提示"静默日期"；反思提问："这是有意的吗？" |
| 2 | 文件编辑数 >50 | 按百分比聚类前 10 个主题；标注"高速度日期" |
| 3 | 未设定 daily-line | 对齐度评分为中立 (60/100)；对齐分析跳过 daily-line 部分 |
| 4 | 未设定 growth-intent | 对齐分析仅对比快照，无长期方向检测 |
| 5 | LLM 调用失败 | 报告降级到快照模式（仅展示原始统计数据，无主题/对齐/反思） |
| 6 | 报告生成 >5 秒 | 显示加载骨架屏（skeleton）；用户可取消；（未来）后台异步生成 |
| 7 | 首日使用（无历史数据） | 7 日趋势分析被禁用；快照正常显示 |
| 8 | 多次快速点击 [生成] | 第二次点击禁用（防止重复 API 调用）；已有请求完成前显示 loading |
| 9 | API 返回格式异常 | 尝试降级处理；若完全无法解析则显示错误 toast + [重试] |
| 10 | IndexedDB 写入失败（存储满） | 打印警告日志；报告仍可展示（内存中）但不持久化 |
| 11 | 用户离线时请求生成 | 本地离线模式不支持生成；当回到在线时提示"现在生成？" |

### 已知风险

| 风险 | 严重度 | 缓解 |
|------|--------|------|
| LLM 推理延迟导致用户体验差 | 中 | 设定 5s 超时；显示实时进度提示；（未来）异步后台生成 |
| 主题提取精度低（错误分类） | 中 | 提示词优化；用户可忽略不准确的分类；鼓励反馈 |
| 对齐分析偏差大（与用户直觉不符） | 中 | 分数仅为参考；主要价值在叙述分析和反思提示，而非绝对数值 |
| 报告内容过长阅读疲劳 | 低 | 提供 short/medium/long 三档长度选项；可折叠段设计 |
| 云同步导致隐私泄露 | 高 | 默认本地存储；云同步需用户显式启用；文件内容不上传（仅文件名和统计） |

## 验收标准

### 基础功能
- [ ] 点击 [生成今日回响] 按钮，<5 秒内生成报告（或显示超时提示）
- [ ] 报告展示 5 个可折叠段：快照、主题、对齐、反思、（未来）趋势
- [ ] Desktop 抽屉从右侧滑入，Mobile 为 bottom sheet；焦点管理正确
- [ ] 对齐进度条根据分数变色（🔴/🟡/🟢）
- [ ] 若 LLM 失败，降级显示快照模式（原始统计）

### 数据聚合
- [ ] 聚合过去 24h 的文件编辑、聊天会话、KB 增长
- [ ] 正确读取 localStorage 中的 daily-line 和 growth-intent
- [ ] 缺失数据时返回部分数据而非完全失败

### LLM 集成
- [ ] 主题提取：返回 JSON 格式正确、字段完整
- [ ] 对齐分析：计算 0-100 分数，包含解释文本
- [ ] 反思提示：生成 2-3 个有意义的问题（非 generic）

### 存储与缓存
- [ ] 报告保存到 IndexedDB（key 为 YYYY-MM-DD）
- [ ] 相同日期重新生成时，自动覆盖旧报告
- [ ] 30 天后自动清理老报告

### i18n
- [ ] 中英文 UI 文案完整
- [ ] 中英文报告内容格式一致
- [ ] 配置页面支持中英切换

### 集成
- [ ] [继续与 Agent] 按钮预填充 Ask Modal，内容包含报告摘要
- [ ] 与既有 Echo 系统无冲突（daily-line 输入框保留）

### 无障碍 & 可用性
- [ ] 抽屉内所有交互元素可通过 Tab 键导航
- [ ] 焦点管理正确（打开时焦点移入，关闭时回到按钮）
- [ ] 对齐分数不仅用色彩表达，有文字说明
- [ ] 触摸目标 ≥44px

### 测试覆盖
- [ ] 聚合、快照、提示生成单元测试 ≥80% 覆盖
- [ ] 组件测试：正常路径、loading、error 状态
- [ ] 集成测试：点击按钮 → API 调用 → 报告渲染 → 点击 [Agent] 按钮
- [ ] 全量测试通过（`npx vitest run`）

### 性能 & 边界
- [ ] 报告生成 <5 秒（通常 2-3 秒）
- [ ] UI 渲染 <500ms
- [ ] 50+ 文件编辑时正确聚类
- [ ] 无 daily-line 或 growth-intent 时优雅降级
- [ ] 网络超时、LLM 错误时有明确错误提示

## 实现路线图

### Phase 1: MVP（按需生成）
- [ ] 数据聚合 + 快照计算
- [ ] 3 个 LLM 提示 + 基础 API 路由
- [ ] 按需生成按钮 + 报告抽屉 UI
- [ ] IndexedDB 存储
- [ ] 基础 i18n

**预计工作量**：2-3 天

### Phase 2: 计划生成 + 配置
- [ ] 定时器 hook（每分钟检查是否应生成）
- [ ] 设置面板（启用/禁用、时间、时区、语言）
- [ ] 定时生成时 toast 通知
- [ ] localStorage 配置持久化

**预计工作量**：1 天

### Phase 3: 历史与趋势
- [ ] `/echo/daily-archive` 页面（查看历史报告）
- [ ] 7 日趋势分析（deepening vs expanding）
- [ ] 周期性汇总报告

**预计工作量**：1-2 天

### Phase 4: 高级功能
- [ ] PDF 导出
- [ ] 云同步（可选）
- [ ] 自定义主题分类（用户定义）
- [ ] 与目标/OKR 系统集成（如存在）

**预计工作量**：2-3 天（可选）
