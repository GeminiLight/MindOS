# MindOS 典型使用场景 & Workflow

> 9 个场景覆盖从首次接触到深度使用的完整旅程。每个场景包含：痛点、Workflow、验证点、可复制 Prompt。

---

## 场景矩阵

| # | 场景 | 一句话 | 阶段 | 难度 | 演示时长 |
|---|------|--------|------|------|----------|
| C1 | 冷启动：注入个人身份 | 上传简历 → Profile 结构化 → 所有 Agent 立即认识你 | 首次使用 | ⭐ | 2min |
| C2 | 注入外部信息 | 丢一篇文章/会议纪要/网页 → 自动提取要点、归档关联 → 全局可检索 | 日常积累 | ⭐ | 2min |
| C3 | 跨 Agent 无缝切换 | 网页端聊方案 → Claude Code 写代码 → Cursor 重构，零重讲 | 日常核心 | ⭐⭐ | 3min |
| C4 | 对话经验沉淀为 SOP | 踩完坑 → Agent 提炼 SOP → 下次自动执行 | 经验回流 | ⭐⭐ | 3min |
| C5 | 手机记灵感，多 Agent 执行 | 手机记一句 → MindOS 归档 → 多 Agent 各就各位 | 移动+协作 | ⭐⭐ | 3min |
| C6 | 新项目冷启动 | "帮我启动新项目" → 读 Profile+SOP → 首版即可用 | 开发效率 | ⭐⭐ | 2min |
| C7 | 竞品调研 → 结构化入库 | "帮我调研 X 竞品" → 写入 Products.csv + 分析报告 | 研究决策 | ⭐⭐ | 3min |
| C8 | 人脉关系管理 | 聊完一个人 → 结构化记录 → 自动生成跟进待办 | 社交管理 | ⭐⭐ | 2min |
| C9 | Agent 行为审计与纠偏 | 发现 Agent 记错 → GUI 审查修正 → 全局生效 | 信任建设 | ⭐⭐⭐ | 3min |

---

## C1: 冷启动——注入个人身份

> 对应愿景支柱：**全局同步**

### 痛点

每个 Agent 都不认识你，每次都要自我介绍。换个工具又得从零开始。

### Workflow

```
用户 → "读一下我的知识库，帮我把自我介绍写进 Profile"
  ↓
Agent 调用 mindos_bootstrap → 读取知识库结构
  ↓
Agent 调用 mindos_read_file(Profile/Identity.md) → 发现为空/模板
  ↓
用户提供简历/自我介绍（文字或上传文件）
  ↓
Agent 提取结构化信息 → mindos_write_file(Profile/Identity.md)
  ├── 技术栈偏好（Next.js, Tailwind, pnpm）
  ├── 代码风格（命名规范、注释习惯）
  ├── 角色定位（独立开发者/创始人）
  └── 沟通偏好（简洁、不要语气词）
  ↓
切换到 Claude Code → "帮我搭个项目"
  → 自动用 pnpm + Next.js + Tailwind，无需解释
```

### 验证点

换 3 个不同 Agent，都能正确读取你的技术栈偏好。

### Prompt 卡片

```
读一下我的 MindOS 知识库，看看里面有什么，然后帮我把自我介绍写进 Profile。
```

---

## C2: 注入外部信息

> 对应愿景支柱：**全局同步 + 共生演进**

### 痛点

有价值的信息散落在各处——一篇文章的关键观点、一次会议的决策、一段聊天里的需求、一个网页上的竞品数据。看完就忘，下次要用还得重新找。Agent 更不可能知道你读过什么。

### Workflow

```
场景 A：注入一篇文章
  用户 → "帮我把这篇文章的要点存到 MindOS"（粘贴链接或文本）
    ↓
  Agent → 提取核心观点、数据、结论
        → mindos_search_notes("相关关键词") → 找到关联文件
        → mindos_create_file(Resources/Articles/文章标题.md)
          ├── 来源 & 日期
          ├── 核心观点（3-5 条）
          ├── 关键数据/引用
          ├── 与已有知识的关联 [[Projects/xxx.md]]
          └── 我的思考 / 待验证假设
        → mindos_append_csv(Resources/Reading-Log.csv, 新增一行)

场景 B：注入会议纪要
  用户 → "这是今天的会议纪要，帮我整理到 MindOS"
    ↓
  Agent → 提取决策、待办、负责人、截止日期
        → mindos_create_file(Projects/会议-2026-03-18.md)
        → mindos_append_to_file(TODO.md, 新增待办 + 负责人 + 截止日)
        → mindos_update_section(Projects/Roadmap.md, 同步决策变更)

场景 C：注入网页/竞品信息
  用户 → "帮我把这个产品页面的信息存到 MindOS"（粘贴 URL）
    ↓
  Agent → 抓取页面关键信息
        → mindos_append_csv(Resources/Products.csv, 结构化入库)
        → 关联已有竞品分析文件
```

### 验证点

- 注入后任意 Agent 搜索关键词都能找到
- 信息自动与已有知识关联，不是孤立存在
- 下次讨论相关话题时，Agent 主动引用已注入的内容

### Prompt 卡片

```
帮我把这篇文章/会议纪要/网页的要点整理到 MindOS 里。
```

---

## C3: 跨 Agent 无缝切换

> 对应愿景支柱：**全局同步**

### 痛点

同一个任务在不同工具间切换，每次都要重讲背景、约定和当前进度。

### Workflow

```
Step 1: MindOS GUI (AI Ask)
  用户 → "帮我设计一个 TODO 应用的技术方案"
  Agent → 读取 Profile/Identity.md（技术栈）
        → 生成方案写入 Projects/todo-app/plan.md
        → 更新 TODO.md 添加待办

Step 2: Claude Code（写代码）
  用户 → "帮我按 MindOS 里的 todo-app 方案开始写代码"
  Agent → mindos_read_file(Projects/todo-app/plan.md)
        → 按方案搭建项目骨架（自动用你偏好的栈）
        → mindos_update_section(TODO.md, 标记"搭建骨架"完成)

Step 3: Cursor（重构优化）
  用户 → "看看 MindOS 里 todo-app 的进展，帮我优化组件结构"
  Agent → 读取同一份 plan.md + 当前代码
        → 按你的代码风格偏好重构
```

### 验证点

3 个 Agent 之间零重复解释，进度自动同步。

### Prompt 卡片

```
帮我按 MindOS 里的 XXX 方案开始写代码。
```

---

## C4: 对话经验沉淀为 SOP

> 对应愿景支柱：**共生演进**

### 痛点

踩坑经验关掉对话就丢了，下次还踩同样的坑。用了 100 次 Agent，工作流还是第一天的样子。

### Workflow

```
Step 1: 踩坑过程（任意 Agent 中）
  用户和 Agent 排查了一个 ESM 模块 mock 的坑
  → vi.doMock + dynamic import 才能解决
  → 花了 30 分钟

Step 2: 一句话触发沉淀
  用户 → "帮我把这次排查经验沉淀到 MindOS"
  Agent → mindos_search_notes("ESM mock") → 确认无重复
        → mindos_read_file(Workflows/) → 找到合适位置
        → mindos_create_file(Workflows/Debug-ESM-Mock.md)
          ├── 问题描述：ESM 模块的 module-level 副作用无法 mock
          ├── 根因：vi.mock 在 ESM 中不拦截静态 import
          ├── 解法：vi.resetModules() + vi.doMock() + dynamic import()
          └── 适用场景：任何有 module-level 状态的文件

Step 3: 下次自动复用
  用户 → "这个模块也有类似的 mock 问题"
  Agent → mindos_search_notes("ESM mock")
        → 读取 SOP → 直接用正确方案，3 分钟搞定
```

### 验证点

30min 的踩坑 → 1 次沉淀 → 后续 3min 复用。

### Prompt 卡片

```
帮我把这次对话的经验沉淀到 MindOS，形成一个可复用的工作流。
```

---

## C5: 手机记灵感，多 Agent 自动执行

> 对应愿景支柱：**全局同步 + 共生演进**

### 痛点

灵感稍纵即逝，记了也散落各处，没人跟进执行。

### Workflow

```
Step 1: 手机端（PWA / MindOS GUI）
  用户 → 快速记录："新功能想法：给知识库加健康度评分，
         检测过期文件、孤立节点、AI 矛盾内容"

Step 2: MindOS 自动归档
  Agent → mindos_search_notes("知识库健康") → 关联已有文件
        → mindos_create_file(Projects/knowledge-health.md)
          ├── 需求摘要
          ├── 关联文件引用 [[01-project-roadmap.md#P2]]
          └── 拆解为 3 个子任务
        → mindos_append_to_file(TODO.md, 新增 3 个待办)

Step 3: 回到电脑，多 Agent 接力
  Claude Code → "看看 MindOS 里的 knowledge-health 计划，帮我写技术方案"
  Cursor → "按方案实现过期检测模块"
  Gemini CLI → "调研竞品的知识库健康方案"
```

### 验证点

一句灵感 → 结构化归档 → 多 Agent 无缝接力。

### Prompt 卡片

```
帮我把这个想法整理到 MindOS，拆解成可执行的子任务。
```

---

## C6: 新项目冷启动

> 对应愿景支柱：**全局同步**

### 痛点

每次新项目都要重复说明技术栈、目录规范、CI 要求。首版产出经常不符合团队约定，需要二次纠偏。

### Workflow

```
用户 → "帮我启动一个新的 SaaS 项目"
  ↓
Agent → mindos_read_file(Profile/Identity.md)
  → 得知：Next.js + Tailwind + pnpm + TypeScript
  ↓
Agent → mindos_read_file(Workflows/Startup-SOP.md)
  → 得知：标准初始化流程、目录规范、CI 模板、Git 规范
  ↓
Agent → 按 SOP 一次性生成：
  ├── pnpm create next-app（不是 npm！）
  ├── 按团队目录规范组织 src/
  ├── 预置 .eslintrc + prettier + husky
  ├── CI/CD 模板（GitHub Actions）
  └── README 模板（双语）
  ↓
首版即可跑通，零纠偏
```

### 验证点

对比无 MindOS（~25min 含纠偏）vs 有 MindOS（~4min 首版可用）。

### Prompt 卡片

```
帮我按 MindOS 里的 Startup SOP 启动一个新项目。
```

---

## C7: 竞品调研 → 结构化入库

> 对应愿景支柱：**共生演进**

### 痛点

调研结果散落在对话中，下次找不到，也无法跨项目复用。

### Workflow

```
用户 → "帮我调研 Obsidian、Notion、Mem 这三个产品的 AI 能力"
  ↓
Agent → mindos_read_file(Resources/Products.csv) → 加载已有产品库
  ↓
Agent → 调研（WebSearch / 已有知识）
  ↓
Agent → mindos_append_csv(Resources/Products.csv, 每个产品一行)
  ├── Name: Obsidian | Category: PKM | Vision: ... | Status: Active | Tags: local-first
  ├── Name: Notion  | Category: PKM | Vision: ... | Status: Active | Tags: cloud
  └── Name: Mem     | Category: PKM | Vision: ... | Status: Active | Tags: AI-native
  ↓
Agent → mindos_create_file(Projects/competitive-analysis.md)
  ├── 对比矩阵（功能 × 产品）
  ├── MindOS 差异化定位
  └── 可借鉴的功能建议
```

### 验证点

调研结果永久入库，任何 Agent/项目都能查到和复用。

### Prompt 卡片

```
帮我调研 X、Y、Z 这几个产品，结果写入 MindOS 产品库。
```

---

## C8: 人脉关系管理

> 对应愿景支柱：**透明可控 + 共生演进**

### 痛点

聊完一个人，承诺和跟进散落在对话里，容易遗忘。下次再聊还要重新回忆上次说了什么。

### Workflow

```
用户 → "今天和张三聊了，他对 MindOS 很感兴趣，
       愿意帮忙写评测文章，约了下周三再聊具体合作"
  ↓
Agent → mindos_search_notes("张三") → 找到/新建档案
  ↓
Agent → mindos_update_section(Connections/张三.md, "交互记录")
  ├── 2026-03-18：对 MindOS 感兴趣，愿写评测
  ├── 下一步：周三聊合作细节
  └── 情绪：积极、主动
  ↓
Agent → mindos_append_to_file(TODO.md)
  └── "[ ] 2026-03-19(周三) 与张三聊合作细节"
  ↓
下次提到张三时，任何 Agent 都能读到完整上下文
```

### 验证点

从聊天到记录到待办，一次闭环。

### Prompt 卡片

```
我今天和 XXX 聊了这些内容，帮我更新到 MindOS 并生成跟进待办。
```

---

## C9: Agent 行为审计与纠偏

> 对应愿景支柱：**透明可控**

### 痛点

Agent 记了什么你不知道，记错了也没法改。错误偏好会在后续所有任务中持续放大。

### Workflow

```
Step 1: 发现问题
  Agent 搭项目时用了 npm 而不是 pnpm
  → 说明 Profile 里的偏好被忽略或记错了

Step 2: GUI 审查
  打开 MindOS GUI → Profile/Identity.md
  → 发现：技术栈写的是 "Node.js + React"，没提 pnpm
  → 这是之前 Agent 自动写入时遗漏的

Step 3: 人类纠偏
  在 GUI 中直接编辑 → 补充 "包管理器：pnpm（禁止 npm/yarn）"
  → 或用 AI Ask："帮我把 Profile 里的包管理器偏好改成 pnpm"

Step 4: 全局生效
  所有 Agent 下次读取 Profile 时 → 自动遵守新偏好
  → Agent Inspector 可查看每次读写记录
```

### 验证点

人类发现 → 审查 → 修正 → 全局生效，完整的透明可控闭环。

### Prompt 卡片

```
帮我检查 MindOS Profile 里的技术栈偏好是否正确，有错误帮我修正。
```

---

## 制作优先级

**第一批（覆盖三根支柱）**：C1 → C2 → C3 → C4

**第二批（扩展场景）**：C5 → C6

**第三批（进阶用法）**：C7 → C8 → C9

### 推荐形式

| 形式 | 适用场景 | 工作量 |
|------|---------|--------|
| Prompt 卡片 | 让用户直接粘贴体验，最低门槛 | 每个 5min |
| 2min 录屏 GIF/视频 | 微信群、小红书、Twitter | 每个 1h |
| 图文教程（截图+步骤） | GitHub README、官网、博客 | 每个 30min |
| Landing page 交互 demo | 官网 Compare 区（已有框架可复用） | 已有 |
