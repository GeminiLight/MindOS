# Spec: 首次使用引导 (First-Use Guide)

**Status**: Draft → v2
**Priority**: I5 (中优先)
**Backlog ref**: `wiki/85-backlog.md` → I5

---

## 问题

用户完成 6 步 SetupWizard 后，落地在首页，看到：

1. 一个可关闭的 WelcomeBanner（3 个按钮：Reconfigure / Ask AI / MCP Settings）
2. 模板生成的 ~30 个文件列表
3. 插件列表

**断裂点**：用户看到一堆陌生文件，不知道：
- 这些文件夹是做什么的
- 应该先做什么
- AI 能帮我做什么（从没用过 `⌘/`）
- 这个系统和普通笔记软件有什么不同

WelcomeBanner 一关就再也找不到了。模板里虽然有 `🧪_example_*` 文件，但用户不知道这些是示例，也不会主动去读。

**核心指标**：Setup 完成 → 用户发出第一条 AI 提问 的转化率（当前无数据，但从产品直觉判断存在显著流失）。

---

## 目标

在 SetupWizard 完成后，用 **最低侵入** 的方式帮用户完成三件事：

1. **动手探索知识库**（通过交互建立心智模型，而非阅读静态文字）
2. **发出第一条 AI 提问**（体验核心价值）
3. **知道下一步做什么**（不迷茫地离开）

不做：
- 不做传统产品 tour（弹窗 + 箭头高亮），太重，完成率低
- 不做强制引导（不阻断用户自由探索）
- 不做视频教程（当前阶段没必要）

---

## 设计方案

### 核心思路：替换 WelcomeBanner → 首页 Guide Card

不新增独立页面/模态框，而是把现有 WelcomeBanner 升级为一个**持久化的 Guide Card**，嵌入首页顶部，分阶段引导，用户完成或手动关闭后消失。

**恢复入口**：关闭后可通过 Settings → General → "Show getting started guide" 重新开启（解决原 WelcomeBanner "一关就没了"的问题）。

### 用户旅程

```
SetupWizard 完成
  → POST /api/setup 写入 config.guideState = { active: true, template: 'en'|'zh'|'empty' }
  → 重定向 /?welcome=1
  ↓
首页通过 GET /api/setup 读取 guideState.active === true → 显示 Guide Card
  （?welcome=1 仅用于首次自动展开任务①，不作为激活的唯一来源）
  ↓
Guide Card 展示 3 个任务卡片（可折叠）：
  ① 探索知识库 → 点击打开 example 文件，浏览目录结构
  ② 和 AI 对话 → 点击打开 AskModal，带模板定制的预填问题
  ③ 配置同步（可选）→ 点击打开 Settings Sync tab
  ↓
完成 ①② 后 Guide Card 自动变为 "🎉 你已准备好" 状态
  ↓
用户关闭 → PATCH /api/setup { guideState: { dismissed: true } }
  ↓
Settings → General → "Show getting started guide" 可重新开启
```

### Guide Card 视觉结构

```
┌─────────────────────────────────────────────────────┐
│ ✨ 开始使用 MindOS                            [×]  │
│                                                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐         │
│  │ 📁       │  │ 💬       │  │ 🔄       │         │
│  │ 探索     │  │ 和 AI    │  │ 配置     │         │
│  │ 知识库   │  │ 对话     │  │ 同步     │         │
│  │          │  │          │  │ (可选)   │         │
│  │ [开始 →] │  │ [开始 →] │  │ [设置 →] │         │
│  └──────────┘  └──────────┘  └──────────┘         │
│                                                     │
│  ─── 展开后：探索知识库 ───────────────────────     │
│                                                     │
│  📁 你的知识库有 6 个区域，试试点开看看：              │
│                                                     │
│  👤 Profile ←点击    📝 Notes        🔗 Connections  │
│  🔄 Workflows        📚 Resources   🚀 Projects     │
│                                                     │
│  💡 所有 AI Agent 都遵循 INSTRUCTION.md              │
│     点击它可以看看 AI 的行为规则                       │
│                                                     │
│              已浏览 0/1 个文件  [跳过]               │
└─────────────────────────────────────────────────────┘

移动端（< sm）：
  3 个卡片改为竖排堆叠
  展开内容区用 2 列 grid 展示目录图标+说明，不溢出
```

### 三个任务卡片详细设计

#### ① 探索你的知识库（交互式，非静态展示）

> **设计原则**：用户刚在 Step 1 看过模板目录树预览，再展示一遍静态文字没有价值。改为引导用户实际打开一个文件，通过操作建立心智模型。

- **默认状态**：折叠，显示图标 + 标题 + "开始"按钮
- **展开后**：根据模板类型展示可点击的目录/文件入口
  - **en/zh 模板用户**：展示 6 个目录为可点击卡片，每个卡片是一个 `<button>` 触发 `FileView` 打开对应目录。底部高亮提示 INSTRUCTION.md 的作用
  - **empty 模板用户**：展示 3 个核心文件为可点击链接（INSTRUCTION.md、README.md、CONFIG.json），提示"你可以随时创建自己的目录结构"
- **完成条件**：用户至少浏览过 1 个文件/目录（通过 `FileView` 的 `onOpen` 事件追踪），或点击"跳过"
- **完成后**：卡片显示 ✓，折叠不可再展开
- **为什么不用"知道了"按钮**：点"知道了"不代表真的理解了，让用户实际看到一个文件的内容，才能形成"这里放什么"的认知

#### ② 和 AI 对话

- **默认状态**：折叠，显示图标 + 标题 + "开始" 按钮
- **点击 "开始"**：通过 `useAskModal` store 打开 AskModal 并传递预填问题
- **预填问题按模板类型定制**（参考 `marketing/use-cases.md` C1 场景——新手的第一件事应该是注入身份）：
  - **en 模板**: `Read my knowledge base and help me write a self-introduction into Profile.`
  - **zh 模板**: `读一下我的知识库，帮我把自我介绍写进 Profile。`
  - **empty 模板**: `Help me design a knowledge base folder structure that fits my needs` / `帮我设计一个适合我的知识库目录结构`
- **为什么用这个 Prompt**：use-cases C1 验证了"注入身份"是整个体系的第一步（难度最低、价值可感知、所有后续场景都受益）。不需要用户填空——AI 会主动追问姓名、职业、偏好。让用户立刻体验到"AI 帮你写东西并存进知识库"的核心能力
- **Modal 打开机制**（替代 CustomEvent）：
  ```typescript
  // useAskModal.ts — zustand store，替代 CustomEvent 跨组件通信
  // CustomEvent 绕过 React 数据流，难以测试，TypeScript 无法类型检查
  import { create } from 'zustand';

  interface AskModalStore {
    open: boolean;
    initialMessage: string;
    openWith: (message: string) => void;
    close: () => void;
  }

  export const useAskModal = create<AskModalStore>((set) => ({
    open: false,
    initialMessage: '',
    openWith: (message) => set({ open: true, initialMessage: message }),
    close: () => set({ open: false, initialMessage: '' }),
  }));

  // GuideCard 调用：
  const { openWith } = useAskModal();
  openWith('读一下我的知识库，帮我把自我介绍写进 Profile。');

  // SidebarLayout 消费：
  const { open, initialMessage, close } = useAskModal();
  // 传给 AskModal 的 props
  ```
- **完成条件**：AskModal 中用户发送 ≥1 条消息后，通过 `onFirstMessage` 回调标记完成
  ```typescript
  // AskModal 新增 onFirstMessage 回调：
  // 用 ref 确保只触发一次（避免 streaming re-render 重复调用）
  const firstMessageFired = useRef(false);

  function handleSend() {
    // ... 发送逻辑 ...
    if (props.onFirstMessage && !firstMessageFired.current) {
      firstMessageFired.current = true;
      props.onFirstMessage();
    }
  }
  ```
- **完成后**：卡片显示 ✓

#### ③ 配置同步（可选）

- **默认状态**：折叠，显示图标 + 标题 + "(可选)" 标签 + "设置" 按钮
- **点击 "设置"**：打开 SettingsModal，initialTab = 'sync'
- **完成条件**：无强制完成条件，标记为可选
- **不影响整体完成状态**

### 完成状态

- ①② 都完成 → Guide Card 标题变为 "🎉 你已准备好使用 MindOS"，显示 1 秒后自动折叠为单行
- **折叠后显示"下一步"提示**（跟随 `marketing/use-cases.md` 第一批路径 C1→C2→C3→C4）：
  - 任务②完成的是 C1（注入身份），后续按顺序推荐 C2→C3→C4
  - 每完成一步（用户点击并发送了 Prompt），自动切换到下一步
  - 全部完成或用户关闭后不再显示

  ```
  完成 C1 后：
  ┌─────────────────────────────────────────────────────┐
  │ 🎉 你已准备好使用 MindOS                       [×] │
  │                                                     │
  │ 💡 下一步：试试把一篇文章存进来 →                     │
  │    "帮我把这篇文章的要点整理到 MindOS 里"            │
  └─────────────────────────────────────────────────────┘

  完成 C2 后：
  ┌─────────────────────────────────────────────────────┐
  │ 🎉 你已准备好使用 MindOS                       [×] │
  │                                                     │
  │ 💡 下一步：试试在另一个 Agent 里调用知识库 →          │
  │    "帮我按 MindOS 里的 XXX 方案开始写代码"            │
  └─────────────────────────────────────────────────────┘

  完成 C3 后：
  ┌─────────────────────────────────────────────────────┐
  │ 🎉 你已准备好使用 MindOS                       [×] │
  │                                                     │
  │ 💡 下一步：试试把经验沉淀为 SOP →                    │
  │    "帮我把这次对话的经验沉淀到 MindOS，形成可复用的工作流" │
  └─────────────────────────────────────────────────────┘

  完成 C4 后 → Guide Card 显示 "✨ 你已掌握 MindOS 核心用法" → 自动淡出
  ```

  | 步骤 | 提示文案 | 预填 Prompt | 对应场景 |
  |------|---------|-------------|---------|
  | C2 | 试试把一篇文章存进来 | `帮我把这篇文章的要点整理到 MindOS 里。` | 注入信息 |
  | C3 | 试试在另一个 Agent 里调用知识库 | `帮我按 MindOS 里的 XXX 方案开始写代码。` | 跨 Agent |
  | C4 | 试试把经验沉淀为 SOP | `帮我把这次对话的经验沉淀到 MindOS，形成可复用的工作流。` | 经验→SOP |

  **实现**：`guideState` 新增 `nextStepIndex: number`（0=C2, 1=C3, 2=C4, 3=全部完成），每次用户点击提示并发送消息后 +1
- 用户随时可点 × 关闭
- 关闭后 `PATCH /api/setup { guideState: { dismissed: true } }`，写入 config
- **恢复入口**：Settings → General → "Show getting started guide" 开关，点击后 `PATCH /api/setup { guideState: { dismissed: false } }`

---

## 技术设计

### 状态管理

> **设计决策**：状态由后端 `config.json` 管理（非 localStorage），原因：
> 1. 激活可靠性——`?welcome=1` redirect 失败（浏览器崩溃/断网）不会导致 Guide 永远丢失
> 2. 多设备一致——如果用户在 A 设备 setup、B 设备访问，Guide 仍可见
> 3. 恢复入口可实现——Settings 开关只需 PATCH config，不需要跨 tab 同步 localStorage

```typescript
// config.json 新增字段
interface GuideState {
  active: boolean;      // setup 完成时写入 true
  dismissed: boolean;   // 用户关闭 Guide Card 时写入 true
  template: 'en' | 'zh' | 'empty';  // setup 时写入，决定任务①展示内容
  step1Done: boolean;   // 至少浏览过 1 个文件
  askedAI: boolean;     // 至少发过 1 条 AI 消息（完成 C1）
  nextStepIndex: number; // 0=推荐C2, 1=推荐C3, 2=推荐C4, 3=全部完成
}

// GET /api/setup 返回值新增 guideState 字段
// PATCH /api/setup 可更新 guideState 子字段

// 组件内 state（纯 UI 状态，不持久化）
const [expanded, setExpanded] = useState<'kb' | 'ai' | 'sync' | null>(null);
```

### 显示条件

```typescript
interface UseGuideResult {
  guideState: GuideState | null;
  isFirstVisit: boolean;  // ?welcome=1 → 首次自动展开任务①
}

function useGuide(): UseGuideResult {
  const [guideState, setGuideState] = useState<GuideState | null>(null);
  const [isFirstVisit, setIsFirstVisit] = useState(false);

  useEffect(() => {
    fetch('/api/setup')
      .then(r => r.json())
      .then(data => {
        if (data.guideState?.active && !data.guideState?.dismissed) {
          setGuideState(data.guideState);
        }
      })
      .catch(() => {});

    // ?welcome=1 → 首次到达，自动展开任务①
    const params = new URLSearchParams(window.location.search);
    if (params.get('welcome') === '1') {
      setIsFirstVisit(true);
      const url = new URL(window.location.href);
      url.searchParams.delete('welcome');
      window.history.replaceState({}, '', url.pathname + url.search);
    }
  }, []);

  return { guideState, isFirstVisit };
}

// GuideCard 消费：
const { guideState, isFirstVisit } = useGuide();
const [expanded, setExpanded] = useState<'kb' | 'ai' | 'sync' | null>(
  isFirstVisit ? 'kb' : null  // 首次到达自动展开"探索知识库"
);
```

**关键设计**：老用户升级后 `guideState` 为 `undefined`（config 中无此字段），所以不会被打扰。只有走过 SetupWizard 的新用户才会有 `guideState.active = true`。

### 组件层级

```
HomeContent.tsx
  └── GuideCard.tsx (新组件，替换 WelcomeBanner)
        ├── 任务 ① 探索知识库（inline，内容按 guideState.template 动态切换）
        ├── 任务 ② 和 AI 对话
        ├── 任务 ③ 配置同步
        └── 完成后 → NextStepBar（C2→C3→C4 渐进推荐）
```

3 个任务逻辑简单（各 ~30 行），inline 在 GuideCard 内部即可，不必拆独立文件。

### 与现有代码的关系

| 现有组件 | 改动 | 细节 |
|----------|------|------|
| `WelcomeBanner.tsx` | **删除** | 功能被 GuideCard 完全替代 |
| `HomeContent.tsx` | 替换 1 行 | `<WelcomeBanner />` → `<GuideCard />` |
| `SidebarLayout.tsx` | 改 3 行 | 消费 `useAskModal` store 替代原有 state 管理 |
| `AskModal.tsx` | 加 2 个 prop | `initialMessage?: string`（预填输入框），`onFirstMessage?: () => void`（首条消息回调，ref 保护只触发一次） |
| `OnboardingView.tsx` | 不改 | 仅空 KB 时显示，与 Guide 不冲突 |
| `i18n.ts` | 加 key | 新增 `guide` namespace（en + zh） |
| `POST /api/setup` | 加 3 行 | complete 时写入 `config.guideState` |
| `GET /api/setup` | 加 1 字段 | 返回 `guideState` |
| `PATCH /api/setup` | **新增** | 接收 `guideState` 子字段更新（完成标记、dismissed、nextStepIndex） |
| Settings General | 加 1 行 | "Show getting started guide" 开关 |

### 响应式布局

```
桌面 (≥ sm)：3 个任务卡片横排 grid-cols-3
移动端 (< sm)：竖排 grid-cols-1，卡片间距收窄
展开内容区：始终全宽
```

### i18n

新增 key namespace: `guide`

```typescript
guide: {
  title: 'Get Started with MindOS',
  showGuide: 'Show getting started guide',  // Settings 恢复入口

  kb: {
    title: 'Explore your knowledge base',
    cta: 'Start',
    // en/zh 模板用户
    fullDesc: 'Your knowledge base has 6 areas — try clicking one:',
    dirs: {
      profile: 'Who you are, preferences, goals',
      notes: 'Daily capture: ideas, meetings, todos',
      connections: 'Your network of people',
      workflows: 'Reusable process SOPs',
      resources: 'Structured data: product lists, tool lists',
      projects: 'Project plans and progress',
    },
    instructionHint: 'Click INSTRUCTION.md to see how AI agents behave.',
    // empty 模板用户
    emptyDesc: 'Your knowledge base has 3 core files:',
    emptyFiles: {
      instruction: 'INSTRUCTION.md — Rules that all AI agents follow',
      readme: 'README.md — Directory index and navigation',
      config: 'CONFIG.json — Machine-readable preferences',
    },
    emptyHint: 'Create your own folder structure anytime.',
    progress: 'Browsed {count}/1 file',
    skip: 'Skip',
    done: 'Done',
  },

  ai: {
    title: 'Chat with AI',
    cta: 'Start',
    // 按模板类型定制（参考 use-cases.md C1）
    suggestedPromptEn: 'Read my knowledge base and help me write a self-introduction into Profile.',
    suggestedPromptZh: '读一下我的知识库，帮我把自我介绍写进 Profile。',
    suggestedPromptEmpty: 'Help me design a knowledge base folder structure that fits my needs',
    suggestedPromptEmptyZh: '帮我设计一个适合我的知识库目录结构',
  },

  done: {
    title: "You're all set!",              // zh: '你已准备好使用 MindOS'
    titleFinal: "You've mastered MindOS essentials!",  // zh: '你已掌握 MindOS 核心用法'
    steps: [
      {
        hint: 'Next: try saving an article →',           // zh: '下一步：试试把一篇文章存进来 →'
        promptEn: 'Help me save the key points from this article into MindOS.',
        promptZh: '帮我把这篇文章的要点整理到 MindOS 里。',
      },
      {
        hint: 'Next: try using your KB in another Agent →',  // zh: '下一步：试试在另一个 Agent 里调用知识库 →'
        promptEn: 'Help me start coding based on the XXX plan in MindOS.',
        promptZh: '帮我按 MindOS 里的 XXX 方案开始写代码。',
      },
      {
        hint: 'Next: try turning experience into a reusable SOP →',  // zh: '下一步：试试把经验沉淀为 SOP →'
        promptEn: 'Help me distill this conversation into a reusable workflow in MindOS.',
        promptZh: '帮我把这次对话的经验沉淀到 MindOS，形成可复用的工作流。',
      },
    ],
  },

  sync: {
    title: 'Set up sync',
    optional: 'Optional',
    cta: 'Configure',
  },
}
```

中文同结构，翻译内容。

---

## 影响面分析

| 维度 | 影响 |
|------|------|
| 新文件 | `GuideCard.tsx`（~250 行），`useAskModal.ts`（~15 行） |
| 删文件 | `WelcomeBanner.tsx` |
| 改文件 | `HomeContent.tsx`（1 行替换），`SidebarLayout.tsx`（改用 useAskModal ~3 行），`AskModal.tsx`（加 2 个 prop + ref 保护回调 ~8 行），`i18n.ts`（加 guide key），`POST /api/setup`（写 guideState），`GET /api/setup`（返回 guideState），Settings General（加开关） |
| API | `GET /api/setup` 新增 `guideState` 字段，`PATCH /api/setup` 支持 `guideState` 更新 |
| 存储 | `config.json` 新增 `guideState` 对象（6 个字段） |
| 测试 | GuideCard 单元测试：显示条件（active/dismissed/老用户不显示）、模板类型切换、交互式完成逻辑（FileView onOpen 触发）、首条消息 ref 保护、关闭持久化、Settings 恢复入口 |

---

## 验收标准

1. **新用户**：Setup 完成后首页顶部出现 Guide Card，3 个任务卡片可见
2. **老用户升级**：不显示 Guide Card（config 无 guideState 字段）
3. **激活可靠性**：Setup 完成后浏览器崩溃 → 再次打开 → Guide Card 仍显示（因为 active 写在 config 而非 URL 参数）
4. 点击 "探索知识库" → en/zh 模板看到 6 个可点击目录 → 点击任一目录/文件 → FileView 打开 → 标记完成 ✓（也可点"跳过"完成）
5. 点击 "和 AI 对话" → AskModal 打开且输入框有按模板定制的预填问题 → 发送后 → 标记完成 ✓
6. ①② 完成后标题变为 "你已准备好"
7. 点 × 关闭 → 刷新页面 → Guide Card 不再出现
8. 关闭后 → Settings → General → 点击 "Show getting started guide" → 刷新 → Guide Card 重新出现
9. 未完成 → 关闭浏览器 → 再次打开 → Guide Card 仍显示
10. 移动端 3 个卡片竖排，展开内容 2 列 grid，不溢出
11. 中英文 i18n 完整
12. **下一步路径**：①② 完成后折叠为单行，显示 C2 提示 → 点击并发送 → 切换到 C3 提示 → 点击并发送 → 切换到 C4 提示 → 点击并发送 → 显示"已掌握核心用法"→ 自动淡出
13. **下一步可跳过**：任何阶段点 × 关闭 → 下一步不再显示（不强制走完 C2-C4）

---

## 不做（显式排除）

- **Step-by-step modal tour**：完成率低，打断体验，维护成本高
- **强制完成才能使用**：MindOS 哲学是不限制用户
- **Gamification（进度条/徽章）**：当前用户量不需要，过度设计
- **视频/GIF 教程**：维护成本高，版本迭代快会过期
- **引导 Sync 为必选步骤**：很多用户不需要多设备同步
- **第二批以后的场景引导（C5-C9）**：当前只覆盖第一批 C1→C4，后续场景等用户量和数据支撑后再考虑

---

## 分阶段交付

| 阶段 | 内容 | 工作量 |
|------|------|--------|
| **P0** | GuideCard 替换 WelcomeBanner + `useAskModal` store + 任务 ① 交互式知识库探索（FileView onOpen 追踪）+ 任务 ② AI 对话（模板定制预填 + ref 保护回调）+ 后端 guideState 读写 | ~5h |
| P1 | 任务 ③ Sync 引导 + 完成状态动画 + 完成后"下一步"路径（C2→C3→C4 渐进推荐） | ~2h |
| P2 | Settings → General → "Show getting started guide" 恢复入口 | ~1h |

---

## v2 变更记录

| # | 变更 | 原因 |
|---|------|------|
| 1 | 激活条件从 `localStorage + ?welcome=1` 改为后端 `config.guideState` | URL 参数激活有丢失风险（浏览器崩溃/断网时 redirect 未到达） |
| 2 | 新增 Settings 恢复入口 | 原方案"关闭后永不再现"正是 WelcomeBanner 被诟病的问题，spec 自己在"问题"部分指出了却没解决 |
| 3 | 任务①从静态展示改为交互式探索 | 用户刚在 Step 1 模板预览看过目录结构，重复展示无价值；改为引导打开文件才能建立真正的心智模型 |
| 4 | 预填问题按模板类型定制 | 新用户知识库几乎为空，"概述结构"回答价值低；改为引导产出第一份 Profile 内容，展示 AI 核心能力 |
| 5 | CustomEvent 替换为 zustand store | CustomEvent 绕过 React 数据流，难测试，无类型检查 |
| 6 | 5 个 localStorage key 合并到 config.guideState | 零散 key 难清理/迁移/调试，且与后端驱动的激活逻辑不一致 |
| 7 | onFirstMessage 加 ref 保护 | 原方案 `session.messages.filter().length === 1` 在 streaming re-render 时会多次触发 |
| 8 | 移动端展开内容区补充 2 列 grid 规格 | 原方案仅说"竖排堆叠"，未考虑展开后 6 个目录在小屏的排版 |
