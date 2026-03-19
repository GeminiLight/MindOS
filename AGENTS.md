# Agent 协作规则

> 所有 Coding Agent（Claude Code、Cursor、Windsurf、Cline 等）在本项目中必须遵守的规则。

## 开发流程

### 全自治执行流程

当用户提出一个想法或需求时，Agent 独立完成以下全链路，**中间不停下来等确认**：

```
用户提 idea
  ↓
① 调研：读 backlog、已有 spec、相关代码，理解上下文
  ↓
② 写 spec：输出到 wiki/specs/，包含目标、方案、变更文件、验收标准
  ↓
③ 自我 review spec（≥2 轮）：
   - 轮 1：检查完整性（边界 case、与现有架构的冲突、遗漏的依赖）
   - 轮 2：检查可行性（涉及的 API 是否存在、版本是否兼容、性能影响）
   - 有问题就修改 spec 并重新 review，直到满意
  ↓
④ 实现代码
  ↓
⑤ 自我 code review（≥2 轮）：
   - 轮 1：对照 spec 逐条验收 + 查 wiki/80-known-pitfalls.md 防踩旧坑
   - 轮 2：检查改动文件的未使用 import、错误处理、测试兼容性、缓存失效
   - 有问题就修代码并重新 review，直到满意
  ↓
⑥ 跑测试（npx vitest run），必须全部通过
  ↓
⑦ 更新文档：wiki（架构/新坑）、backlog（打勾）、changelog（发版时）
  ↓
⑧ commit + push（遵循 Git 流程）
  ↓
⑨ 向用户呈现：改了什么、为什么、变更 diff 摘要
```

**关键原则：**
- 整个流程 Agent 自驱，用户只在最终验收时介入
- 如果 spec 阶段发现需求有歧义，才停下来问用户（用一次提问问清，不拆多轮）
- 用户说"release"则在 ⑧ 后追加 `npm run release patch`
- 不要估算工时

### Bug 处理流程

1. **复现** — 确认能稳定复现，记录复现步骤
2. **检查已知问题** — 搜索 `wiki/80-known-pitfalls.md` 和 `wiki/85-backlog.md`，看是否有同类问题
3. **定位根因** — 不要只修表面现象，找到为什么会发生
4. **全局扫描** — 搜索代码库中同样的错误模式，主动排查是否在其他文件也存在（不要只修当前文件就结束）
5. **修复全部** — 修当前 bug + 扫描发现的同类问题，一次性清理干净
6. **补 tests + 记录** — 补测试用例，将坑记入 `wiki/80-known-pitfalls.md`

### 并行任务防重复

执行前先检查任务状态，避免重复执行已完成的任务。并行任务可能导致某些任务已被完成，记得先对比查看。

## 代码规范

### 设计系统合规（前端必须遵守）

完整规范见 `wiki/21-design-principle.md`，预防指南见 `wiki/41-dev-pitfall-patterns.md`。

- **色值**：禁止硬编码 hex。状态色用 `var(--success)` / `var(--error)` 或 `text-success` / `text-error`；品牌色用 `var(--amber)`。新增语义色必须先在 `globals.css` 定义变量 + `@theme inline` 注册 + 文档记录
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
5. 如果用户要求 release → 执行 `npm run release [patch|minor|major]`（默认 patch）

### 发版说明

- push 到 main 会触发 `sync-to-mindos` workflow（同步到公开仓 + 部署 landing page）
- 只有打 `v*.*.*` tag 才会触发 `publish-npm` workflow（发布到 npm）
- `npm run release` 会自动：检查工作区干净 → 跑测试 → bump 版本 → 打 tag → push → 等待 CI

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

## Agent 自治原则

> 目标：用户发一条指令，Agent 一次做完，减少来回交互轮次。

### 一次性交付

- **理解终态**：用户说"修这个 bug"，隐含的完整链路是：定位 → 修复 → 自检 → 跑测试 → 更新文档。不要做一步等一步，一次性做到"可提交"状态再呈现
- **合并中间步骤**：如果用户同时或连续提到 commit / push / release，一条链串完，不要每步都停下来汇报
- **不等用户催 review**：改完代码后主动自检（见下方清单），不需要用户说"review 下"才去做

### 提交前自检清单（每次改动后自动执行）

1. 跑测试（`npx vitest run`），全部通过才继续
2. 检查改动文件：未使用的 import、遗漏的错误处理、与测试环境不兼容的 API 调用
3. 框架特定陷阱：查 `wiki/80-known-pitfalls.md` 中已记录的模式，确认没有重蹈覆辙
4. 涉及缓存/刷新的改动：确认客户端缓存、服务端缓存、内存缓存三层都已处理
5. 新增写操作 API → 检查是否需要通知其他组件刷新

### 主动沟通而非被动等待

- 发现改动影响范围超预期 → 主动说明，不等用户追问
- 发现关联 bug → 一并修复并说明，不留给下一轮
- 不确定的决策 → 列出选项和推荐，一次问清，不要拆成多轮提问

## Landing Page

content.md <-> landing/index.html
