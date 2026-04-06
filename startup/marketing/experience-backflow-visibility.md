# 经验回流可见性问题分析

> 来源：用户反馈 "沉淀对话、构建关联是怎么实现的？"
> 问题本质：经验回流是 MindOS 最核心的差异化能力，但用户完全感知不到。

---

## 一、当前状态：经验回流在产品里有多隐蔽

### Onboarding（GuideCard 三步走）

```
Step 1: 导入文件        ← 用户主动往里放东西
Step 2: AI 读取内容     ← 证明 AI 能读
Step 3: 跨 Agent 验证   ← 证明多 Agent 能读
---
(可选) 下一步1: 存一篇文章
(可选) 下一步2: 沉淀经验为 SOP  ← 经验回流藏在这里
```

问题：
- 经验回流被放在"可选的下一步"里，大部分用户走完三步就关掉了
- 即使点了，prompt 是"帮我把这次对话的经验沉淀到 MindOS"，用户不知道这意味着什么
- 没有展示"回流"的闭环——沉淀了之后呢？下次 Agent 真的会用吗？

### Walkthrough（新手导览三步）

```
Step 1: 你的项目记忆     ← 讲 Spaces
Step 2: 不用重讲背景的 AI ← 讲 Agent 自动读
Step 3: 多 Agent 共享记忆 ← 讲 MCP 连接
```

问题：
- 完全没有提到经验回流
- 三步全在讲"读"，没有一步讲"写回"

### 产品 UI

| 位置 | 有没有经验回流的痕迹 |
|------|---------------------|
| 首页 | 无 |
| 侧边栏 | 无 |
| Agent 对话面板 | Agent 有时会提议写入 user-preferences.md，但没有 UI 提示 |
| Agents 页 | 只显示连接状态，不显示读写活动 |
| Echo 页 | 有复盘功能，但入口不显眼，新用户可能不知道 |
| 设置页 | 无 |

### Landing Page

- "Symbiotic Evolution — Experience Flows Back As Instructions" 概念正确，但描述抽象
- 没有动图或视频展示回流过程
- 没有 Before/After 对比

### README

- "auto-distills every thought into your knowledge base" 一句话带过
- Experience Compiler 在 Coming Soon 列表里
- 没有具体的使用示例

---

## 二、理想状态：用户应该在什么时候感知到经验回流

### 时机 1：Onboarding 里体验完整闭环（最重要）

当前的三步只证明了"AI 能读"。需要加一步证明"AI 能写回，而且写回的东西下次会被用到"。

建议的新流程（五步）：

```
Step 1: 导入文件              ← 原来的 Step 1
Step 2: AI 读取你的内容        ← 原来的 Step 2
Step 3: 纠正 AI，看它记住     ← 🆕 经验回流演示
Step 4: 切换 Agent，验证同步   ← 原来的 Step 3（但现在验证的不只是读，还有规则）
Step 5: 查看知识库的变化       ← 🆕 展示沉淀结果
```

Step 3 的具体设计：

```
标题：教 AI 记住你的偏好
描述：告诉 MindOS Agent 一条你的习惯，看它自动记住。
预设 Prompt：「我的代码风格偏好：变量名用 camelCase，不用 snake_case。请记住这条规则。」
完成条件：Agent 回复确认 + user-preferences.md 出现新条目
UI 反馈：Toast "已保存到 Preferences/conventions.md" + 文件树中高亮新增的文件
```

Step 5 的具体设计：

```
标题：看看你的知识库学到了什么
描述：打开刚才 Agent 写入的文件，确认你的偏好已被记录。
动作：自动打开 user-preferences.md，高亮新增的规则
意义：让用户直观看到"对话变成了持久化的知识"
```

### 时机 2：每次经验被沉淀时给 UI 反馈

当前：Agent 把规则写入 user-preferences.md，前端没有任何提示。
建议：

```
┌────────────────────────────────────┐
│ ✦ 已记住你的偏好                    │
│ "变量名用 camelCase" → conventions.md │
│                          [查看]     │
└────────────────────────────────────┘
```

- 不打断对话流，用底部 Toast 或侧边 Snackbar
- 点击"查看"跳转到文件
- 颜色用琥珀色，和品牌一致

### 时机 3：Agent 使用已沉淀规则时标注来源

当前：Agent 遵循了规则但不说它是从哪读到的。
建议：

Agent 回复中加引用标注：

```
Agent: 我用 camelCase 给你命名了这些变量。
       📎 依据：Preferences/conventions.md → "变量名用 camelCase"
```

这让用户看到"回流"在起作用：我之前说过的话，现在变成了 Agent 的行为依据。

### 时机 4：首页展示知识库成长指标

在首页 GuideCard 下方或 Echo 入口处，加一个轻量的"成长卡片"：

```
📈 你的知识库
   12 条偏好规则 · Agent 引用了 47 次 · 最近新增：3 天前
```

让用户感知到"知识库在长大"，而不只是"知识库在那放着"。

---

## 三、改动清单（按优先级）

### P0：Onboarding 加经验回流步骤

| 改动 | 文件 | 工作量 |
|------|------|--------|
| GuideCard 增加 Step 3 "教 AI 记住偏好" | `components/GuideCard.tsx` | 中 |
| 增加 Step 5 "查看知识库变化" | `components/GuideCard.tsx` | 小 |
| i18n 增加新步骤文案 | `lib/i18n/modules/onboarding.ts` | 小 |
| Guide state 增加新步骤的完成状态 | `lib/settings.ts` + `api/setup/route.ts` | 小 |
| Walkthrough 增加第四步"经验会自动回流" | `components/walkthrough/steps.ts` | 小 |

### P1：沉淀时的 UI 反馈

| 改动 | 文件 | 工作量 |
|------|------|--------|
| Agent 写入 user-preferences.md 时触发前端 Toast | `api/ask/route.ts` + Agent 工具层 | 中 |
| Toast 组件支持"查看文件"跳转 | `lib/toast.ts` | 小 |

### P1：Agent 引用规则时标注来源

| 改动 | 说明 | 工作量 |
|------|------|--------|
| System prompt 增加指令：使用已沉淀规则时引用文件路径 | SKILL.md / system prompt | 小 |
| 前端渲染引用标注（可选，初期纯文本即可） | Agent chat renderer | 中 |

### P2：首页成长指标卡片

| 改动 | 说明 | 工作量 |
|------|------|--------|
| 后端 API：统计规则数、引用次数 | 新 API route | 中 |
| 前端卡片组件 | 首页新组件 | 中 |

### P2：Landing / README 增加经验回流的具体示例

| 改动 | 说明 | 工作量 |
|------|------|--------|
| Landing page 加一个 GIF/视频：纠正 → 记住 → 下次遵守 | 录屏 + 嵌入 | 小 |
| README 加 "Experience Backflow in 30 seconds" 段 | 文案 + 截图 | 小 |

---

## 四、核心设计原则

1. **回流的每一步都要可见**。用户纠正了 → 看到被记住了 → 看到下次被用了。任何一步隐藏了，用户就不信。

2. **不要只讲概念，要让用户自己走一遍**。"经验编译"是概念，"告诉 AI 用 camelCase，然后切到另一个 Agent 看它也用 camelCase"是体验。Onboarding 要引导后者。

3. **回流反馈不能打断工作流**。Toast / Snackbar / 边栏标注，不能用 Modal 弹窗。用户在写代码的时候不想被打断。

4. **量化成长感**。用户需要看到数字在涨：规则数、引用次数、Agent 遵守率。这是让用户持续使用的钩子。
