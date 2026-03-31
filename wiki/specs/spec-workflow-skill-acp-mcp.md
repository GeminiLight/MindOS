# Spec: Workflow Plugin — Skill/Tool/Agent Integration

## 目标

在 Workflow 插件中支持声明式的 Skills、MCP Tools、Agent 委派配置，让每个步骤都能**精准指定执行上下文**。用户只需在 Markdown 文件中添加简单的注释或前置元数据，就能让 AI 带上领域知识、使用指定工具、或委派给专门的 Agent 执行。

**成功标志**：
1. ✅ Workflow 文件支持 YAML frontmatter，声明全局可用的 skills、tools
2. ✅ 每个 step 支持 `<!-- skill: xxx -->` 和 `<!-- agent: xxx -->` 注释
3. ✅ 步骤执行时，自动读取对应 skill 内容、构建上下文、或通过 ACP 委派
4. ✅ UI 显示 step 的 skill/agent 标记，用户一眼知道这一步的执行上下文

---

## 现状分析

### 问题

现在 Workflow 的每个 step 都是**裸跑**：
- 直接 `POST /api/ask` 无任何工具/技能上下文
- AI 需要自己判断用什么工具、如何处理
- 多 agent 任务无法分工（都是一个 AI 伪装多角色）
- User 想要用特定 skill、工具或 agent 无处指定

### 机会

系统已有三层能力等待被激活：
1. **Skills**（144+ 个）— 纯文本专业知识，能读能用
2. **MCP Tools**（git、filesystem、npm 等）— 已自动装配进 `/api/ask`，但无法约束范围
3. **ACP + Agents**（Cursor、Claude-Code、MindOS）— 已能跨进程通信，无法从 Workflow 触发

---

## 数据流 / 状态流

### 现状数据流

```
Workflow File (Markdown)
  ↓ [parseWorkflow()]
  Step[] { index, heading, body, status, output }
  ↓ [User clicks Run]
  runStepWithAI(step, filePath, ...)
  ↓ [Construct prompt]
  prompt = "Execute step {index}: {heading}\n\nInstructions:\n{body}"
  ↓ [POST /api/ask]
  { messages: [{ role: 'user', content: prompt }], currentFile }
  ↓ [LLM in /api/ask automatically gets MCP tools]
  AI response (streamed)
  ↓ [setSteps(...output: chunk)]
  UI renders AI output
```

### 新数据流：Skills 注入

```
Workflow File (Markdown with metadata)
---
title: Code Review Workflow
skills: [code-review-quality, software-architecture]
---

## Step 1: Review code
<!-- skill: code-review-quality -->
Check code against checklist.
  ↓ [parseWorkflow() + parseMetadata()]
  WorkflowStep { ..., metadata: { skills: ['code-review-quality'] } }
  ↓ [User clicks Run]
  runStepWithAI(step with metadata, ...)
  ↓ [Fetch skill content]
  GET /api/skills → { content: "<skill body>" }
  ↓ [Construct enhanced prompt]
  systemPrompt = buildSystemPrompt(step.metadata.skills)
  prompt = "Execute step...\n\nApply these standards:\n{skill_body}"
  ↓ [POST /api/ask with enhanced prompt]
  AI response
```

### 新数据流：ACP 委派

```
Workflow File
## Step 2: Run tests
<!-- agent: cursor -->
Execute full test suite.
  ↓ [User clicks Run]
  runStepWithAI(step with metadata: { agent: 'cursor' }, ...)
  ↓ [NOT /api/ask, instead POST /api/acp/session]
  { agentId: 'cursor', initialPrompt: '...' }
  ↓ [Create session + stream response]
  ACP session established with Cursor agent
  AI response from Cursor
  ↓ [Close session]
```

---

## 方案

### 方案 A：Frontmatter + 步骤注释

**Markdown 格式**：
```markdown
---
title: Sprint Release
skills: [software-architecture]
tools: [git, npm]
---

# Sprint Release Workflow

Optional description.

## Step 1: Code Review
<!-- skill: code-review-quality, agent: claude-code -->
Perform code review using the checklist.

## Step 2: Run Tests  
<!-- tools: npm, github -->
Execute all test suites.

## Step 3: Docs
Update CHANGELOG and README.
```

**优点**：
- 易于阅读、易于编辑
- Frontmatter 支持 YAML，可扩展
- 注释级粒度，支持 per-step 覆盖全局配置

**缺点**：
- 需要解析两层元数据（frontmatter + 注释）

### 方案 B：仅注释，无 frontmatter

```markdown
## Step 1: Code Review
<!-- skill: code-review-quality -->
<!-- agent: claude-code -->
<!-- tools: [git, npm] -->
```

**优点**：
- 只需解析注释，逻辑简单
- 每步明确

**缺点**：
- 无全局默认，每步都要写
- 可维护性差

### 选择

**方案 A** — Frontmatter + 注释。
- Frontmatter 定义工作流级默认（哪些 skill 全局可用、哪些 tool 通常用到）
- 注释提供 per-step 覆盖（"这一步用 Claude Code 而不是默认 LLM"）
- 两层结合更灵活

---

## User Flow

### 用户目标
用户想创建一个"代码发布"工作流，让 Cursor 跑测试、Claude Code 审代码、MindOS 更新文档。

### 前置条件
- 用户已创建 `Sprint Release.md` 文件
- MindOS 已安装 `code-review-quality` skill
- 系统已注册 `cursor`、`claude-code` 两个 agent

### 步骤

**Step 1: 用户编辑 Workflow 文件**
```markdown
---
title: Sprint Release Workflow
skills: [software-architecture]
---

## Step 1: Run tests
<!-- agent: cursor -->
Execute full test suite.

## Step 2: Code review
<!-- agent: claude-code, skill: code-review-quality -->
Review the diff.

## Step 3: Update docs
<!-- skill: document-release -->
Sync README, CHANGELOG.
```
→ 系统反馈：文件保存成功
→ 状态变化：WorkflowRenderer 重新解析，UI 显示 Step 1 有 `🤖 cursor` 标记

**Step 2: 用户打开 Workflow 文件**
→ 系统反馈：UI 渲染 3 个 step，每个 step 显示 skill/agent 元数据徽章
→ 状态变化：UI 显示"Step 1 will delegate to Cursor"

**Step 3: 用户点击"Run next"**
→ 系统反馈：Step 1 进入 running 状态，显示"delegating to cursor…"
→ 状态变化（后台）：
  - 解析 `agent: cursor`
  - `POST /api/acp/session { agentId: 'cursor', prompt: '...' }`
  - ACP 创建 session
  - 流式响应开始

**Step 4: Step 1 执行完成**
→ 系统反馈：Step 1 显示绿色勾，AI 输出显示在下方，"Run next" 按钮激活
→ 状态变化：Step 2 变为 active

**Step 5: 用户点击 Step 2 的"Run"**
→ 系统反馈：Step 2 进入 running 状态
→ 状态变化（后台）：
  - 解析 `agent: claude-code, skill: code-review-quality`
  - `GET /api/skills { action: 'read', name: 'code-review-quality' }`
  - 读取 skill 内容
  - 构建 system prompt 包含 skill
  - `POST /api/acp/session { agentId: 'claude-code', prompt: 'Execute step....\n\nSkill context:\n{skill_body}' }`
  - 流式响应

**Step 6: 所有步骤完成**
→ 系统反馈：进度条 100%，"3/3 done"，所有 step 显示绿色勾
→ 状态变化：UI 显示"Workflow complete"按钮，允许"Reset"

### 异常分支

**异常 A：Skill 不存在**
- 触发条件：User 指定 `skill: nonexistent`
- 系统如何处理：`GET /api/skills` 返回 404，捕获错误，标记 step 为 error
- 用户看到什么：Step 显示红色 ✗，错误信息"Skill 'nonexistent' not found"

**异常 B：Agent 不存在或不可用**
- 触发条件：User 指定 `agent: unknown-agent`，或 Cursor 进程不在线
- 系统如何处理：`POST /api/acp/session` 返回错误
- 用户看到什么：Step 显示红色 ✗，错误信息"Agent 'unknown-agent' not available"

**异常 C：网络中断**
- 触发条件：执行中网络断开
- 系统如何处理：AbortController 捕获，stream 中断
- 用户看到什么：Step 显示黄色 ⚠️，"Connection interrupted. Click to retry."

**异常 D：步骤执行超时**
- 触发条件：step 执行超过 60s
- 系统如何处理：ACP session 或 `/api/ask` 超时，返回 timeout 错误
- 用户看到什么：Step 显示红色 ✗，"Execution timed out after 60s"

### 边界场景

**边界 1：空 frontmatter 或没有元数据**
- Workflow 文件无 frontmatter，无注释
- → parseMetadata() 返回空对象，行为同当前版本（裸跑）

**边界 2：Frontmatter + 注释冲突**
- Frontmatter: `skills: [a, b]`，注释: `<!-- skill: c -->`
- → 注释覆盖 frontmatter（per-step metadata 优先级更高）

**边界 3：无效 YAML frontmatter**
- ```markdown
  ---
  title: broken yaml: [
  ---
  ```
- → parseMetadata() 捕获 YAML 错误，记录到控制台，忽略 frontmatter，执行裸跑

**边界 4：Agent 执行成功但返回空输出**
- Agent 运行但没有任何输出
- → Step 标记为 done（成功），输出区显示"(No output)"

**边界 5：Skill 内容超级长（>50KB）**
- Skill SKILL.md 体积大
- → 读取成功，拼接进 system prompt（可能造成 token 溢出）
- → `/api/ask` 返回 413 或 context length exceeded 错误
- → Step 标记为 error："Skill content too large for this step"

---

## 影响范围

### 变更文件

| 文件 | 改动 | 影响 |
|------|------|------|
| `WorkflowRenderer.tsx` | parseMetadata()、runStepWithAI() 改 | 核心逻辑扩展 |
| `WorkflowRenderer.tsx` | StepCard UI 新增徽章 | UI 扩展 |
| `manifest.ts` | 无改动 | — |
| `/api/skills` | 无改动，已有 read 接口 | — |
| `/api/ask` | 无改动，已有 tool 装配 | — |

### 受影响模块

- **AgentDetailContent**：同样涉及 skill 显示逻辑，可复用徽章组件
- **Ask UI**：可参考 skill/tool 选择模式

### 破坏性变更

**无**。扩展是向后兼容的：
- 无 frontmatter / 注释的旧 workflow 文件正常工作
- 新特性纯增，不改变旧行为

---

## 验收标准

| # | 准则 | 如何验证 |
|---|------|---------|
| 1 | Frontmatter 解析正确 | 读取含 YAML frontmatter 的 workflow，UI 显示 title、description |
| 2 | 步骤注释解析正确 | 含 `<!-- skill: xxx -->` 的 step，metadata.skill === 'xxx' |
| 3 | Skill 读取成功 | 点击有 skill 的 step，/api/skills read 被调用，skill 内容读取 |
| 4 | Skill 注入 prompt | 运行有 skill 的 step，system prompt 包含 skill 内容 |
| 5 | ACP 委派成功 | 点击有 `agent: cursor` 的 step，/api/acp/session 被调用，响应流式输出 |
| 6 | UI 显示元数据徽章 | Step heading 后显示 `🎓 code-review-quality`、`🤖 cursor` 徽章 |
| 7 | 异常处理正确 | 指定不存在的 skill/agent，UI 显示错误信息，step 标记为 error |
| 8 | 向后兼容 | 旧 workflow 文件（无元数据）正常工作，行为不变 |
| 9 | 全量测试通过 | `npx vitest run` 全部绿灯，包括新增测试 |
| 10 | 无控制台错误 | 执行完整流程，浏览器控制台无红色错误 |

---

## 方案选择说明

**为什么不用 API 参数 (e.g., `requestedSkills`, `toolNames`)?**
- `/api/ask` 目前无这些参数（设计是黑盒自动选），修改 API 风险大
- 我们直接在 client 读 skill、注入 prompt，风险低、改动小

**为什么用 Frontmatter + 注释而不只用注释?**
- Frontmatter 提供全局默认，减少重复
- 注释支持 per-step 覆盖，灵活度高
- 两层结合是最优衡

**为什么现在只做 Skill 注入、先不做 Tool 过滤?**
- Tool 过滤需要 `/api/ask` 新参数或 client 侧 tool 管理，改动大
- Skill 注入改动小、见效快，且 skill 才是 workflow 最关键的上下文（tool 自动选）

---

## 类型定义

```typescript
// Metadata from frontmatter
interface WorkflowFrontmatter {
  title?: string;
  description?: string;
  skills?: string[];        // global available skills
  tools?: string[];         // global available tools (advisory, not enforced)
  [key: string]: any;       // extensible
}

// Metadata from step comment
interface StepMetadata {
  skill?: string;           // single skill (per-step override)
  agent?: string;           // delegate to agent instead of /api/ask
  tools?: string[];         // advisory: which tools this step might use
}

// Enhanced workflow step
interface WorkflowStep {
  index: number;
  heading: string;
  body: string;
  status: StepStatus;
  output: string;
  metadata?: StepMetadata;  // NEW: parsed from comment
}

// Enhanced workflow parsed result
interface ParsedWorkflow {
  meta: {
    title: string;
    description: string;
    frontmatter?: WorkflowFrontmatter;  // NEW
  };
  steps: WorkflowStep[];
}
```
