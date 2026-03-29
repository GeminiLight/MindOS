MindOS Agent 断开如果能自动重连就多好
能设置断开后自动重连吗？
继续任务
能设置断开后自动重连吗？，继续任务那种[LetMeSee]
是指其他agent连接mcp工作的时候，还是web 页面的断开重连呀
很多，好像api都有各种情况断开
然后，有个设置断开自动重连就好
设置不管什么情况断开重连多少次才自动放弃
嗯嗯 会在MindOS Agent里面加上自动重连

基于你这几天的实际使用模式，以下是我观察到你反复需要但没有自动化的
  工作流：

  1. /diagnose-bug

  你多次贴日志让我分析根因（BUGS.md、Untitled）。这个 command
  专门做：
  - 读日志文件 → 识别错误链 → 追溯代码路径 → 输出根因分析 + 修复方案
  - 不动代码，只做分析

  2. /sync-repos

  你反复执行 public/main 同步。自动化：
  - git fetch public main → 检查差异 → merge → 跑测试 → push origin

  3. /review-pr

  你刚做过——审阅 GitHub PR 并合并。自动化：
  - 列出 open PRs → 逐个审阅 diff → 本地 apply + 测试 → merge

  4. /release

  发版流程。当前散落在 AGENTS.md 里：
  - bump version → 跑测试 → 打 tag → push → 冒烟验证

  5. /arch-review

  你让我做过完整架构审查（30 个问题那次）。自动化：
  - 全量读取模块 → 按维度审查 → 输出优先级列表 → 可选自动修复

  6. /desktop-build

  Desktop 打包验证。你关心包大小、Node.js 内置等：
  - 准备 runtime → 检查体积 → 列出构成 → 验证关键文件存在

  你觉得哪几个值得做？还是有其他你更需要的工作流？

---

## 新项目如何避免原生浏览器组件入侵

> 经验来源：MindOS 项目中发现 7 处 native confirm()、7 处 native checkbox/radio、7 处 native select，逐一替换耗时大。

### 三层防线

**1. 基础设施先行（Day 1）**

项目初始化时就建好 UI primitives：

```
components/ui/
  Checkbox.tsx        # 统一 checkbox 样式
  Radio.tsx           # 统一 radio 样式
  Select.tsx          # 替代 native <select>
  ConfirmDialog.tsx   # 替代 window.confirm()
  Toast.tsx           # 替代 window.alert()
```

不需要一开始就很精致，只要有一个能用的封装，开发时自然会 import 它而不是写 native。正确的事比偷懒的事更容易做。

**2. ESLint 规则拦截（写了就报错）**

```json
{
  "no-restricted-globals": ["error", "alert", "confirm", "prompt"],
  "no-restricted-syntax": [
    "error",
    {
      "selector": "JSXOpeningElement[name.name='select']",
      "message": "Use <CustomSelect> instead of native <select>"
    }
  ]
}
```

CI 和 IDE 里实时报错，native 组件根本提交不进去。

**3. AGENTS.md 写进规范（AI Agent 也遵守）**

在设计系统合规段加：

```markdown
- **原生控件**：禁止 window.confirm/alert/prompt，用 ConfirmDialog / Toast；
  禁止裸 <select>，用 CustomSelect；
  <input type="checkbox/radio"> 必须加 className="form-check" 或 "form-radio"
```

无论人写还是 AI 生成，规则一致。

### 核心思路

Primitives 让正确的事更容易 → ESLint 让错误的事做不了 → 文档让所有协作者知道规则。三层一起防。
