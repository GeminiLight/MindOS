# 开发洞察：如何避免设计系统债务

> 复盘 2026-03-17 设计原则审计后的 P1/P2/P3 治理，提炼出可复用的预防规则。

## 问题根因

代码中积累了 20+ 文件的硬编码色值、不一致的 focus ring、缺失的 motion 支持。这些不是一次性犯的错，而是**每次写新组件时一点点积累的**。根因是：

1. **设计系统文档有缺口** — 定义了品牌色但没定义状态色，开发时只能自己选值
2. **没有 lint 规则拦截** — 写了 `#7aad80` 不会报错，review 时肉眼也容易漏
3. **新组件抄旧组件** — 第一个人写了 `#c85050`，后面的人复制粘贴就传染了
4. **focus / focus-visible 区分不明确** — 文档没写用哪个，各自发挥

## 预防规则

### 规则 1：新增色值必须走「变量 → 文档 → 使用」三步

```
1. globals.css 定义变量（:root + .dark）
2. @theme inline 注册 Tailwind token
3. 03-design-principle.md 记录语义和色值
4. 代码中使用 var(--xxx) 或 text-xxx
```

**绝不直接写 hex 值。** 如果发现设计稿里有一个色值在系统里没有对应 token，先停下来补变量，再写组件。

### 规则 2：新建组件前，先查设计原则文档

写新组件前花 30 秒扫一遍 `wiki/21-design-principle.md`：

- 状态色用什么？→ `var(--success)` / `var(--error)` / `text-success` / `text-error`
- Focus ring 用什么？→ `focus-visible:ring-1 focus-visible:ring-ring`（不是 `focus:`）
- 圆角用什么？→ 查圆角表
- z-index 用什么？→ 查层级表
- 字体 weight？→ 查 weight 表

### 规则 3：抄代码时替换硬编码

复制已有组件的代码片段时，检查是否有：

| 看到这个 | 替换为 |
|---------|--------|
| `#7aad80` / `green-500` | `var(--success)` / `text-success` |
| `#c85050` / `#ef4444` / `red-400` / `red-500` | `var(--error)` / `text-error` |
| `focus:ring-xxx` | `focus-visible:ring-xxx` |
| `border-blue-500` | `ring-ring` |
| `style={{ fontFamily: ... }}` | `.font-display` / `font-mono` |
| 硬编码 `z-[999]` | 查 z-index 层级表，选最近语义层 |

### 规则 4：PR review 检查清单加一项

Code review 时增加一项检查：

```
- [ ] 新增/修改的色值是否使用了 CSS 变量或 Tailwind token？（无硬编码 hex）
- [ ] focus 样式是否用 focus-visible:？
- [ ] 新增的 z-index 是否在层级表范围内？
```

### 规则 5：定期审计（季度或大版本前）

每个大版本前跑一次：

```bash
# 检查硬编码色值泄漏
rg '#[0-9a-fA-F]{6}' app/components/ app/app/ --glob '*.tsx' --glob '*.ts' | grep -v 'globals.css\|\.svg'

# 检查 focus: 而非 focus-visible:
rg 'focus:ring|focus:border|focus:outline' app/components/ app/app/ --glob '*.tsx'

# 检查 red/green/blue 硬编码 Tailwind 色
rg 'text-red-|bg-red-|border-red-|text-green-|bg-green-|border-blue-' app/components/ app/app/ --glob '*.tsx'
```

发现新泄漏就当场修，别攒着。

## 本次治理的教训

| 教训 | 行动 |
|------|------|
| 设计系统的每个维度都要文档化 | 补了状态色、z-index、font weight、a11y、暗色机制、xl 断点 |
| 文档缺口 = 未来的硬编码 | 没定义 → 自己选值 → 传染 → 20+ 文件要改 |
| 两种红共存比一种红差 | `#c85050` 和 `#ef4444` 混用，暗色模式下对比度不同，视觉不一致 |
| `focus:` 在移动端有副作用 | 触摸操作也触发 focus，ring 一直亮着，用 `focus-visible:` 只响应键盘 |
| 改变量比改 20 个文件便宜 | 定义好变量后，全局调色只需改 globals.css 的 2 行 |

## 状态变更的影响面追踪

> 复盘 2026-03-17 SetupWizard 非空目录模板选择功能，三个 bug 都是「只看新增代码，没追踪状态在整个组件的消费方」。

### 问题根因

改动一个组件时，新增了条件分支 / UI 块 / 状态消费，但漏了以下三类检查，导致三个 bug 同时混入：

1. **加新 UI 没清旧 UI** — 新增了 amber 提示框，旧的同功能 amber 警告行没移除，用户看到两条重复提示
2. **加分支没验初始值** — 非空目录应默认跳过模板，但 `template` 初始值仍是 `'en'`，用户不点跳过直接 Next 就合并了
3. **加 disabled 没排查所有入口** — `submitting` 只禁了 Complete 按钮，StepDots 和 Back 按钮漏了，saving 期间用户可以跳走

### 规则 6：加条件分支时，grep 被替代的旧 UI

新增条件渲染块时，搜索**同一 state 变量**驱动的其他 UI 元素。如果新块完全替代旧块的功能，移除旧块；如果互补，确认不会重复显示。

```bash
# 示例：加了 pathInfo 驱动的新提示框，检查旧的 pathInfo UI
rg 'pathInfo' app/components/SetupWizard.tsx
```

### 规则 7：新分支改变"期望默认值"时，必须主动设置

如果一个条件分支的出现意味着某状态的默认行为应该改变（比如非空目录应默认跳过模板），不能依赖用户手动点击——必须在分支生效时 `setState`。

检查方法：**假设用户什么都不点直接 Next，默认值是否符合预期？**

### 规则 8：加 disabled 时，grep 所有同一动作的触发入口

一个导航动作（如 `setStep`）可能有多个触发入口：按钮、步骤条、键盘快捷键。加 disabled 守卫时，搜索所有调用该 setter 的地方：

```bash
rg 'setStep' app/components/SetupWizard.tsx
```

逐一确认每个入口都有守卫。遗漏一个就是一个可被绕过的通道。

### 本次治理的教训

| 教训 | 行动 |
|------|------|
| 局部看新代码容易遗漏全局影响 | 每次改动后 grep 被改 state 变量的所有消费方 |
| 默认值是隐形分支 | 初始值 + 用户不操作 = 一条真实执行路径，必须验证 |
| disabled 是访问控制，漏一个入口就有绕过 | 加 disabled 后 grep setter，像查权限一样查全 |
| 重复 UI 比缺 UI 更难发现 | 新增 UI 后肉眼不容易发现旧 UI 仍在，靠 grep 确认 |

## 跨 Agent 协议文件的管理

> 复盘 2026-03-17 CLAUDE.md → AGENTS.md 重命名，解决多 Agent 共用项目规则的问题。

### 问题

`CLAUDE.md` 是 Claude Code 专用的约定文件名，但项目规则应该对所有 Coding Agent（Cursor、Windsurf、Cline 等）生效。维护多份实体文件（CLAUDE.md + AGENTS.md + .cursorrules）必然会不一致。

### 方案：AGENTS.md + symlink

```
AGENTS.md          ← canonical source，所有规则在这
CLAUDE.md → AGENTS.md  ← symlink，Claude Code 自动读取
```

### 关键细节

| 要点 | 说明 |
|------|------|
| Git 原生支持 symlink | `git add` symlink 时存储目标路径字符串（9 bytes），文件模式为 `120000` |
| GitHub UI 正确显示 | 会显示 "Symbolic Link → AGENTS.md" |
| CI/CD 同步注意 | `cp` 默认跟随 symlink 复制内容，保留 symlink 要用 `cp -P` |
| `-L` 判断 symlink | `[ -L "CLAUDE.md" ]` 判断是否为 symlink，`-f` 会穿透 |
| 编辑器打开 symlink | 显示的就是目标文件内容，这是正常行为，不是重复 |

### workflow 同步写法

```yaml
# 普通文件用 cp（跟随 symlink，复制内容）
for f in AGENTS.md ...; do
  [ -f "$f" ] && cp "$f" /tmp/target/
done

# symlink 用 cp -P（保留 symlink 本身）
[ -L "CLAUDE.md" ] && cp -P CLAUDE.md /tmp/target/
```

### 教训

| 教训 | 行动 |
|------|------|
| 两份实体文件迟早不一致 | 用 symlink 保证单一 source of truth |
| `cp` 和 `cp -P` 行为不同 | 同步 workflow 里 symlink 必须用 `cp -P` |
| 文件名是约定不是标准 | AGENTS.md 是通用名，各 Agent 通过各自的 symlink/config 指向它 |


避免硬编码