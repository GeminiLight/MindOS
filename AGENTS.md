# Agent 协作规则

> 所有 Coding Agent（Claude Code、Cursor、Windsurf、Cline 等）在本项目中必须遵守的规则。
> 流程编排见 Slash Commands（`.claude-internal/commands/`），本文件只定义标准和模板。

## 代码规范

### Spec 模板

每个 spec 文件（`wiki/specs/spec-*.md`）必须包含以下段落，不能留空：

```markdown
# Spec: <标题>

## 目标
一句话说清楚要解决什么问题、达到什么效果。

## 现状分析
当前的行为/架构是什么，为什么不满足需求。

## 数据流 / 状态流
用文字或 ASCII 图描述改动涉及的数据流转路径。
重点标注：哪些组件读数据、哪些组件写数据、中间经过几层缓存。
（这一段是 self-review 时最重要的锚点——sidebar 不更新的 bug 就是因为缺这个分析）

## 方案
具体怎么做。包含技术选型和关键设计决策。

## 影响范围
- 变更文件列表
- 受影响的其他模块（即使不改它，也要说明为什么不受影响）
- 是否有破坏性变更

## 边界 case 与风险
列出至少 3 个边界 case 和对应处理方式。
列出已知风险和 mitigation。

## 验收标准
可执行的 checklist，每条都能客观判断 pass/fail。
```

### 测试规范（每个改动必须遵守）

#### 测试先行
- 新功能：先写测试（红灯）→ 再写实现（绿灯）→ 再重构
- Bug fix：先写能复现 bug 的测试 → 再修复 → 确认测试变绿
- 重构：先确认现有测试通过 → 重构 → 确认测试仍然通过

#### 三类 case 必须覆盖

| 类型 | 说明 | 示例 |
|------|------|------|
| **正常路径** | 典型输入，预期输出 | 创建文件成功、API 返回 200 |
| **边界 case** | 极端/临界输入 | 空字符串、超长路径、并发调用、Unicode 文件名、磁盘满 |
| **错误路径** | 非法输入、外部失败 | 文件不存在、网络断开、权限不足、JSON 格式错误 |

#### 边界 case 发现清单

写测试时逐条过：
- **空值**：null / undefined / 空字符串 / 空数组 / 空对象
- **类型边界**：0 / -1 / MAX_SAFE_INTEGER / NaN / Infinity
- **字符串边界**：含空格 / 特殊字符 / Unicode / emoji / 超长（>1000字符）
- **集合边界**：空集合 / 单元素 / 重复元素 / 超大集合
- **时序边界**：并发调用 / 重复提交 / 超时 / 中途取消
- **环境边界**：文件不存在 / 目录不存在 / 权限不足 / 磁盘满
- **状态边界**：首次运行 / 已有数据迁移 / 降级模式

#### 测试质量自检
- 测试名是否描述了**行为**而非实现？（`'returns 404 for missing file'` 而非 `'test case 3'`）
- 测试是否**独立**？（不依赖其他测试的执行顺序或副作用）
- 测试是否**快速**？（单个测试 <100ms，全量 <30s）
- 测试是否**明确**？（失败时能直接看出哪里错了）

### 视觉回归验证

UI 改动（TSX / CSS / 布局）时，commit 前用 Playwright 截图关键页面，保存到 `/tmp/<component>-<state>.png`。纯后端 / 文档改动不需要。

### 发版后冒烟验证

`npm run release` 后执行：

```bash
cd /tmp && mkdir mindos-smoke-$$ && cd mindos-smoke-$$
npx @geminilight/mindos@latest --version
npx @geminilight/mindos@latest --help
cd / && rm -rf /tmp/mindos-smoke-$$
```

失败则 hotfix + 重新 release。

### 代码质量自检（code review 时逐条过）

#### 正确性
- [ ] 对照 spec 验收标准逐条验证
- [ ] 查 `wiki/80-known-pitfalls.md`，确认没有重蹈覆辙
- [ ] 所有新引入的依赖版本范围是否正确？（`^` range 的下界是否真的有需要的 API）

#### 健壮性
- [ ] 外部调用（API / 文件 / 网络）是否有 try-catch？错误信息是否对用户有帮助？
- [ ] 用户输入是否做了验证和清洗？（空值、类型错误、注入攻击）
- [ ] 异步操作是否有超时保护？是否处理了竞态条件？
- [ ] 失败路径是否有 fallback 或 graceful degradation？

#### 可维护性
- [ ] 没有未使用的 import / 变量 / 函数
- [ ] 没有重复代码（>3 行相同逻辑应提取函数）
- [ ] 命名是否清晰、一致？（看名字就知道干什么）
- [ ] 复杂逻辑是否有注释说明 **why**（不是 what）？

#### 性能
- [ ] 是否引入了 N+1 查询或不必要的循环？
- [ ] 大数据量场景是否会 OOM？（数组、字符串拼接）
- [ ] 缓存是否三层覆盖？（客户端 router cache / 服务端 revalidate / 内存 cache）

### 设计系统合规（前端必须遵守）

完整规范见 `wiki/21-design-principle.md`，预防指南见 `wiki/41-dev-pitfall-patterns.md`。

- **色值**：禁止硬编码 hex。状态色用 `var(--success)` / `var(--error)` 或 `text-success` / `text-error`；品牌色用 `var(--amber)`。新增语义色必须先在 `globals.css` 定义变量 + `@theme inline` 注册 + 文档记录
- **Amber 按钮文字**：`--amber-foreground` 固定为白色 `#ffffff`。Amber CTA 按钮统一 `bg-[var(--amber)] text-[var(--amber-foreground)]`。**禁止**在非 amber 背景上使用 `amber-foreground` 作为独立文字色
- **Focus ring**：一律用 `focus-visible:`（不是 `focus:`），颜色走 `ring-ring`（= amber）
- **字体**：用 `.font-display` / `font-mono` / `font-sans`，禁止 `style={{ fontFamily }}`
- **z-index**：只用 10/20/30/40/50 五个层级，查表选最近语义层
- **动效**：不超过 0.3s，`prefers-reduced-motion` 已全局处理，无需单独适配
- **圆角**：查圆角表（rounded / rounded-md / rounded-lg / rounded-xl）

### 前端状态变更检查（改组件时必须遵守）

详细案例见 `wiki/41-dev-pitfall-patterns.md` 规则 6-8。

- **加条件 UI 分支 → grep 旧 UI**：搜索同一 state 变量驱动的其他 UI 元素，确认旧的移除或互斥，不能重复显示
- **加分支改变默认行为 → 验证初始值**：假设用户什么都不点直接 Next，`state` 初始值是否符合新分支的预期？不符合就在分支生效时主动 `setState`
- **加 disabled → grep 所有触发入口**：搜索 `setXxx` 的所有调用方（按钮、步骤条、快捷键），逐一确认守卫，漏一个就是可绕过的通道

### 代码更新后置流程

开发中实时做，提交前 checklist 最后确认：

```
改代码 → tests（新功能写上，修 bug 视情况补）→ 更新 wiki
```

## 开发服务器

MindOS 开发时使用 `mindos-srv` tmux session 运行，包含两个窗口：

| 窗口 | 服务 | 端口 | 说明 |
|------|------|------|------|
| `web` | Next.js dev server | 4567 | **热更新**——改 `.tsx`/`.css` 自动刷新，不需要重启 |
| `mcp` | MCP HTTP server | 8567 | Agent 通过 `http://localhost:8567/mcp` 调用 |

### 启动

```bash
tmux attach -t mindos-srv       # 如果已存在，直接 attach

# 或者手动创建：
tmux new-session -s mindos-srv -n web -c ~/code/sop_note/app
# web 窗口：
MINDOS_WEB_PORT=4567 npm run dev
# 新建 mcp 窗口：
MCP_TRANSPORT=http MINDOS_MCP_PORT=8567 MINDOS_WEB_PORT=4567 node bin/cli.js mcp
```

### 访问

- Web UI: `http://21.6.243.108:4567`
- MCP endpoint: `http://127.0.0.1:8567/mcp`

### 跑测试不杀 dev server

`stopMindos()` 在 `NODE_ENV=test` 时自动跳过进程 kill，`npm test` 和 `git push` 都不会影响 dev server。

```bash
git push                          # 正常跑测试，不杀 dev server
SKIP_TESTS=1 git push             # 跳过测试直接 push
npm test                          # 手动跑测试，不杀 dev server
```

## Git 提交流程

### Commit 前 Checklist

- [ ] tests 通过（新功能已写 tests，修 bug 视情况补）
- [ ] code review 完成
- [ ] wiki 已更新（架构变更、API 变更、新坑等）
- [ ] backlog 已打勾（完成的任务标记为完成）
- [ ] changelog 已更新（发版时从 backlog 整理写入 `wiki/90-changelog.md`）
- [ ] 文档一致性检查（README 双语、SKILL.md 副本）
- [ ] 无 debug 代码 / console.log 遗留
- [ ] 无敏感信息混入（API key、密码等）
- [ ] 无不相关的临时文件混入

### 提交步骤

1. **公开仓同步检查**（修改前执行）：确认 mindos (public) 没有未回流的外部 PR commit
   - `git fetch public main && git log public/main --oneline -5`
   - 有未同步的 → 先 `git merge public/main --no-edit`，再开始改代码
   - 无 public remote 则跳过（`git remote | grep public`）
2. **检查改动**：`git status` + `git diff`，排除不相关的临时文件
3. **写 commit message**：遵循 Conventional Commits（`feat:` / `fix:` / `refactor:` / `docs:` 等）
4. **提交并 push**：`git add <files> && git commit && git push origin main`
5. 如果用户要求 release → 执行 `npm run release`（**始终使用 patch，除非用户明确指定 minor 或 major**）

### 发版说明

- **默认 patch**：除非用户明确说 minor 或 major，否则一律 `npm run release`（等同于 `npm run release patch`）。不要自行判断应该用 minor/major。

- push 到 main 会触发 `sync-to-mindos` workflow（同步到公开仓 + 部署 landing page）
- 只有打 `v*.*.*` tag 才会触发 `publish-npm` workflow（发布到 npm）
- `npm run release` 会自动：检查工作区干净 → 跑测试 → bump 版本 → 打 tag → push → 等待 CI

**npm 与 MindOS Desktop 对齐（精简）**

- **MindOS 产品版本** = `@geminilight/mindos` 的 `version` = git **`vX.Y.Z`**（npm 发布主轴）。
- **Desktop 安装包**另有**壳版本**（Electron）；**内置 MindOS** 须从**同一 `vX.Y.Z`** 构建，勿手拷未 tag 目录。可只发 npm、不必每次发 Desktop；**一旦发 Desktop**，内置应对齐本次要推的 MindOS 版本。
- **关于 / 诊断**：建议同时展示 **MindOS 版本** 与 **Desktop 壳版本**，避免用户只对不上号。
- 全文与 checklist：`wiki/specs/spec-desktop-bundled-mindos.md`（「发布与版本」）、发版步骤 `wiki/refs/git-sync-workflow.md`。

## 文档维护

### 文档一致性规则

- `CLAUDE.md` → `AGENTS.md` 的 symlink，无需单独维护
- `README.md` 和 `README-zh.md` 必须保持一致
- `skills/mindos/SKILL.md` 和 `app/data/skills/mindos/SKILL.md` 必须保持一致（不一致时以 `skills/` 为准）

### Backlog 与 Changelog

- **Backlog**（`wiki/85-backlog.md`）：追踪待办 / 进行中 / 已完成任务，完成后打勾
- **Changelog**（`wiki/90-changelog.md`）：发版时从已完成的 backlog 条目批量整理写入，面向用户描述变更

### 对话记录

记录每次对话，分类存入 MindOS 笔记，标注期望的 workflow 是否完成。

<!-- TODO: 补充对话分类方式（如：需求讨论 / bug fix / 流程优化 / ...） -->

## Skill 优化流程

1. **收集 Bad Case**：用户描述或提供 `BAD_CASES.md`，记录具体的错误行为
2. **读取 Skill**：读取 `skills/<name>/SKILL.md`，理解当前 description 和执行逻辑
3. **定位根因**：判断问题出在 trigger 描述、执行模式、工具选型，还是边界条件缺失
4. **提出修复方案**：给出具体的改动建议，说明改了什么、为什么
5. **用户确认**：等用户确认方向后再动手
6. **同步更新所有副本**：
   - `skills/<name>/SKILL.md`（中文版同步修改英文版，反之亦然）
   - `app/data/skills/<name>/SKILL.md`（按 AGENTS.md 规则与 skills/ 保持一致）
   - `.claude-internal/skills/<name>/SKILL.md`（若存在）
7. **验证一致性**：用命令行 diff 确认所有副本内容相同

## Landing Page

content.md <-> landing/index.html

## Design Context

### Users

同时使用 3+ AI Agent 的独立开发者/创始人。日常在 CLI、IDE、多个 AI 对话窗口之间切换，管理 500+ 文件的本地 Markdown 知识库。使用场景：快速查阅笔记、沉淀对话经验、跨 Agent 共享上下文。核心诉求是效率和掌控感，而非协作或社交。

### Brand Personality

**温暖、专业、克制。**

Warm Amber 传递人机共生的温度，但绝不花哨。工具本身退到背景，内容是主角。品牌情感目标：让用户感到"安静的信赖"——像一本皮质笔记本，不是一个闪亮的 App。

### Aesthetic Direction

- **靠近**：Notion（留白与内容优先）、Obsidian（本地优先 + Graph 可视化）、Linear（键盘驱动 + 工程师审美）
- **远离**：企业 SaaS（Jira/Salesforce 的蓝灰密集表单）、黑客终端（纯黑底绿字）、玩具感（过多圆角渐变卡通图标）
- **色调**：低饱和暖土色系（Warm Amber #c8873a），完整 light/dark 双主题
- **字体**：Lora serif（长文阅读）+ IBM Plex Sans（UI）+ IBM Plex Mono（代码/display）

### Design Principles

1. **Content is King** — 界面为内容服务。最大化阅读区域，最小化 chrome（工具栏、边框、装饰）。
2. **Keyboard First, Mouse Welcome** — 核心操作都有快捷键（⌘K/⌘/ /⌘,），但鼠标用户不应感到被忽视。
3. **Progressive Disclosure** — 功能按需展开，不在首屏堆砌所有选项。空状态引导而非空白。
4. **Warm Industrial** — 琥珀色点缀工业克制的灰调骨架。交互反馈用颜色和微动效，不用弹窗打断。
5. **Local & Transparent** — 所有操作可审计、可撤销、数据在本地。UI 传递"你掌控一切"的安全感。

### Layout Direction

目标演进方向：Activity Bar（48px 纯图标 Rail）+ 可切换 Panel + Content，替代当前的多 Modal 方案。详见 `wiki/22-page-design.md` 优化路线图。

### Echo（内向内容面）

- **标题不重复**：面包屑只保留父级（如「回响 / Echo」），当前小节名仅出现在 `h1`，避免同一词读两遍。
- **主区内切换**：在 `/echo/*` 内提供横向 segment 导航（pill），减少「关面板 → 再点另一行」的往返。
- **克制动效**：卡片 hover 仅用边框/阴影微变化（≤150ms），不大面积铺琥珀色块。
