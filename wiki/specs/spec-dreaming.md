# Spec: Dreaming（后台知识整理）

> 创建日期：2026-04-14
> 状态：Draft - Pending Review

## 目标

让 MindOS 在后台**定期自动整理知识库**：检测过时内容、发现矛盾、合并重复、生成摘要。类似人类睡眠时的记忆整合——用户不需要主动操作，知识库自己会越来越整洁。

## 现状分析

**当前问题**：知识库只增不减、缺乏自动维护。

| 问题 | 表现 |
|------|------|
| **内容过时** | 3 个月前的调研笔记里的结论可能已经不对了，但没人更新 |
| **信息矛盾** | 两篇笔记对同一事物说法不同（如技术选型变更后旧笔记未更新） |
| **内容重复** | Inbox 导入的内容和已整理的笔记有大量重叠 |
| **缺乏摘要** | 大量笔记但没有高层总结，Agent 的 Active Recall 可能命中细节但缺全局视角 |

**用户现状**：MindOS 的目标用户（独立开发者/创始人）有 150+ 文件的知识库，手动维护不现实。

## OpenClaw 对比分析

OpenClaw Dreaming 是三阶段系统：Light（收集短期信号）→ REM（发现主题）→ Deep（提炼到 MEMORY.md）。

| 维度 | OpenClaw Dreaming | MindOS Dreaming（本方案） |
|------|-------------------|--------------------------|
| **核心目标** | 从对话中提炼隐式记忆到 MEMORY.md | 整理用户**已有的显式笔记** |
| **输入源** | 对话记录 + 回忆痕迹 | 知识库中的 Markdown/CSV 文件 |
| **输出** | 新建 MEMORY.md 条目 | **修改已有文件**（标注过时、合并重复） |
| **三阶段** | Light → REM → Deep | **Scan → Analyze → Act** |
| **触发** | Cron（默认凌晨 3 点） | Cron（默认凌晨 3 点，复用 pi-schedule-prompt） |
| **LLM 调用** | 每个阶段都有 sub-agent | 仅 Analyze 阶段使用 LLM |

**为什么不照搬 OpenClaw**：OpenClaw 的 Dreaming 解决的是"从对话中提炼记忆"——MindOS 不需要，因为用户的知识库已经是显式的。我们要解决的是"已有笔记的维护"。

## 数据流 / 状态流

```
Dreaming Pipeline (每日凌晨 3 点 or 手动触发)
│
├── Phase 1: SCAN（纯本地，不调 LLM）
│   ├── 扫描所有 .md/.csv 文件的元数据
│   │   └── 路径、大小、修改时间、标题、前 500 字符
│   ├── 检测候选问题：
│   │   ├── 过时: mtime > 90 天 且不在排除列表
│   │   ├── 重复: 文件名相似度 > 0.8 或内容 jaccard > 0.3
│   │   └── 空文件: 内容 < 50 字符（排除 README/INSTRUCTION）
│   └── 输出: candidates.json（候选问题列表）
│       └── 写入 {mindRoot}/.mindos/dreaming/candidates.json
│
├── Phase 2: ANALYZE（调 LLM sub-agent）
│   ├── 读取 candidates.json
│   ├── 对每组候选调用 LLM 分析：
│   │   ├── 重复组：两文件内容 → "是否真正重复？建议合并方式？"
│   │   ├── 过时文件："内容是否可能过时？哪些部分需要更新？"
│   │   └── 矛盾组：两文件冲突内容 → "哪个是最新版本？"
│   └── 输出: analysis.json（分析结果 + 建议操作）
│       └── 写入 {mindRoot}/.mindos/dreaming/analysis.json
│
├── Phase 3: ACT（需要用户确认 or 自动执行）
│   ├── 读取 analysis.json
│   ├── 按置信度分类：
│   │   ├── 高置信度（>0.8）：自动执行
│   │   │   └── 例：删除空文件、标注过时警告
│   │   └── 低置信度（<0.8）：写入待确认列表
│   │       └── 例：合并建议、矛盾解决
│   └── 输出:
│       ├── 自动执行的操作记录 → dreaming-log.md
│       └── 待确认建议 → {mindRoot}/.mindos/dreaming/pending.json
│           └── 用户可在 UI 中审批/驳回
│
└── 写入 {mindRoot}/.mindos/dreaming/last-run.json
    └── { timestamp, scanned, analyzed, acted, skipped }
```

**读写组件标注**：
- Scan：读 → 知识库全量文件元数据；写 → `.mindos/dreaming/candidates.json`
- Analyze：读 → candidates.json + 候选文件内容；写 → `.mindos/dreaming/analysis.json`（调 LLM）
- Act：读 → analysis.json；写 → 知识库文件（高置信度自动）或 pending.json（低置信度）

## 方案

### Phase 1: Scan（本地扫描，无 LLM）

```typescript
// app/lib/dreaming/scan.ts

interface ScanResult {
  stale: StaleCandidate[];      // 修改时间 > 90 天
  duplicates: DuplicateGroup[];  // 文件名/内容相似
  empty: string[];               // 内容 < 50 字符
  stats: { totalFiles: number; scannedAt: string; durationMs: number };
}

interface StaleCandidate {
  path: string;
  lastModified: string;  // ISO date
  daysSinceModified: number;
  preview: string;       // 前 200 字符
}

interface DuplicateGroup {
  files: Array<{ path: string; preview: string }>;
  similarity: number;    // 0-1 jaccard 相似度
  reason: 'filename' | 'content';
}
```

**重复检测算法**（不用 LLM）：
1. 文件名相似度：去掉日期前缀和 emoji 后，计算 Levenshtein distance
2. 内容相似度：提取 trigram 集合，计算 Jaccard 系数
3. 阈值：文件名相似度 > 0.8 或内容 jaccard > 0.3

**排除列表**（不纳入过时检测）：
- `README.md`, `INSTRUCTION.md`, `CONFIG.json`（结构文件不算过时）
- `.mindos/` 下的系统文件
- `CHANGELOG.md`, `TODO.md`（本身就是长期文件）

### Phase 2: Analyze（LLM 分析）

通过 `runHeadlessAgent()` 调用 LLM 进行高质量分析：

```typescript
// app/lib/dreaming/analyze.ts

interface AnalysisResult {
  items: AnalysisItem[];
  tokenUsage: number;
  analyzedAt: string;
}

interface AnalysisItem {
  type: 'stale' | 'duplicate' | 'empty';
  paths: string[];
  suggestion: string;       // LLM 生成的建议
  confidence: number;       // 0-1
  action: SuggestedAction;
}

type SuggestedAction =
  | { type: 'mark_stale'; path: string; reason: string }
  | { type: 'merge'; source: string; target: string; strategy: string }
  | { type: 'delete'; path: string; reason: string }
  | { type: 'update'; path: string; sections: string[] }
  | { type: 'skip'; reason: string };
```

**LLM Prompt 策略**：对每组候选批量提交（不是逐个），一次 LLM 调用处理多组，控制成本。

### Phase 3: Act（执行/待确认）

- **自动执行**（confidence > 0.8）：
  - 删除确认为空的文件
  - 在过时文件顶部添加 `> ⚠️ This note may be outdated (last modified: YYYY-MM-DD)` 警告
- **待确认**（confidence ≤ 0.8）：
  - 写入 `pending.json`，用户可在 Settings 或通知中审批
  - Phase 2 的 UI 留到后续迭代

### 触发方式

复用现有 `pi-schedule-prompt`：

```typescript
// 注册一个 cron 任务：每天凌晨 3 点执行 Dreaming
schedule_prompt({
  name: 'mindos-dreaming',
  schedule: '0 3 * * *',
  prompt: 'Run the MindOS Dreaming pipeline: scan knowledge base for stale/duplicate/empty content, analyze with LLM, and execute high-confidence actions.',
  mode: 'agent',
});
```

也支持手动触发：用户可以在 Agent 对话中说"整理一下知识库"或用命令。

## 影响范围

### 变更文件

| 文件 | 操作 | 说明 |
|------|------|------|
| `app/lib/dreaming/scan.ts` | **新增** | Phase 1 扫描逻辑 |
| `app/lib/dreaming/analyze.ts` | **新增** | Phase 2 LLM 分析 |
| `app/lib/dreaming/act.ts` | **新增** | Phase 3 执行/待确认 |
| `app/lib/dreaming/index.ts` | **新增** | Pipeline 入口 |
| `app/lib/dreaming/types.ts` | **新增** | 类型定义 |
| `app/lib/settings.ts` | 修改 | 新增 `DreamingConfig` |

### 不受影响的模块

| 模块 | 原因 |
|------|------|
| Active Recall | 独立模块，不耦合 |
| 前端 UI | Phase 1 无 UI（Phase 2 再加） |
| 搜索引擎 | 只读调用 |
| Agent prompt | 不修改 system prompt |

## 边界 case 与风险

### 边界 case

| Case | 处理 |
|------|------|
| 知识库只有几个文件 | Scan 阶段如果候选 < 2 个，跳过 Analyze 阶段 |
| 知识库有上千个文件 | Scan 是纯本地的，< 1s；Analyze 只处理候选，不全量分析 |
| 用户刚导入大量文件（全是新的） | 全部 mtime 都是今天，不会触发过时检测 |
| 用户正在编辑文件 | 检查文件锁？不需要——Dreaming 只读分析 + 只写元数据注释 |
| 文件内容是纯英文 / 纯中文 / 混合 | trigram jaccard 对中英文都有效 |
| Dreaming 运行中途 crash | last-run.json 记录状态，下次重跑不会丢数据 |
| 用户禁用 Dreaming | `settings.dreaming.enabled = false` 跳过所有阶段 |

### 风险

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| LLM 误判导致错误操作 | 中 | 高 | 高置信度才自动执行；低置信度需用户确认 |
| Dreaming 占用大量 API token | 中 | 中 | 只分析候选（不是全量）；批量提交控制调用次数 |
| 凌晨运行时 API key 过期 | 低 | 低 | 失败后记录 error，不重试 |
| 误删用户文件 | 低 | 极高 | Phase 1 **只删空文件**，非空文件只标注不删除；自动操作全部记录到 log |
| 并发冲突（用户同时编辑） | 低 | 低 | Dreaming 执行时间很短（< 30s），冲突概率极低 |

## 验收标准

### Phase 1 MVP

| # | 验收项 | Pass 条件 |
|---|--------|-----------|
| 1 | Scan 检测过时 | mtime > 90 天的非结构文件出现在 candidates.json |
| 2 | Scan 检测重复 | 文件名相似度 > 0.8 的文件对出现在 candidates.json |
| 3 | Scan 检测空文件 | 内容 < 50 字符的非 README 文件出现在 candidates.json |
| 4 | Scan 排除规则 | README.md/INSTRUCTION.md/CONFIG.json 不在过时候选中 |
| 5 | Analyze 调用 LLM | 对候选组调用 headless agent 并返回结构化建议 |
| 6 | Act 自动标注 | 高置信度过时文件被添加 ⚠️ 警告注释 |
| 7 | Act 待确认 | 低置信度建议写入 pending.json |
| 8 | Cron 触发 | schedule-prompt 注册成功，定时触发 pipeline |
| 9 | 手动触发 | 用户说"整理知识库"时可以手动执行 |
| 10 | 禁用开关 | `dreaming.enabled = false` 时不执行任何操作 |

### 测试覆盖

- [ ] `scan.test.ts`: 过时检测、重复检测、空文件检测、排除规则
- [ ] `analyze.test.ts`: LLM 调用 mock、结果解析、批量处理
- [ ] `act.test.ts`: 高置信度自动执行、低置信度待确认、日志记录
- [ ] `pipeline.test.ts`: 端到端流程、禁用开关、错误恢复

## 实施计划

### Phase 1（MVP）— 本次实施
- [ ] 类型定义 (`types.ts`)
- [ ] Scan 模块 (`scan.ts`) — 纯本地扫描
- [ ] Analyze 模块 (`analyze.ts`) — LLM 分析
- [ ] Act 模块 (`act.ts`) — 执行/待确认
- [ ] Pipeline 入口 (`index.ts`)
- [ ] Settings 集成 (`DreamingConfig`)
- [ ] Cron 注册
- [ ] 单元测试
- [ ] 集成测试

### Phase 2（增强）— 后续
- [ ] UI：Dreaming 报告面板（显示上次运行结果）
- [ ] UI：待确认建议的审批界面
- [ ] 矛盾检测：利用 embedding 发现内容矛盾
- [ ] 知识图谱更新：Dreaming 时自动更新 Graph 中的关系
- [ ] 摘要生成：为每个目录生成 AI 摘要

## 参考

- OpenClaw Dreaming: https://docs.openclaw.ai/concepts/dreaming
- 现有 organize 模式: `app/lib/agent/prompt.ts:88`
- 现有 schedule-prompt 集成: `app/lib/schedule-prompt/index.ts`
- pi-subagents: `app/node_modules/pi-subagents/index.ts`
- 现有 headless agent: `app/lib/agent/headless.ts`
