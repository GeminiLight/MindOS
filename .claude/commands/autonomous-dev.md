你正在执行全自治开发流程。任务：$ARGUMENTS

**核心原则**：
1. **全自治**：严格按以下阶段顺序执行。除了“阶段 7”需要等待确认外，**不要跳过任何步骤，中途不要停下来等用户确认**。
2. **失败即恢复**：如遇报错，严格按照阶段末尾的[⚠️ 失败恢复策略]执行，禁止强行跳过。

---

## 阶段 0：环境准备与探路 (Spike)

1. **公开仓同步检查**（有 public remote 时执行，无则跳过）：
   - 运行 `git remote | grep public`。
   - 若存在，运行 `git fetch public main && git log public/main --oneline -5`。
   - 有未同步 commit → 先 `git merge public/main --no-edit`，再继续。
   - [⚠️ 失败恢复] 如果 merge 发生冲突 → 解决冲突后再开始开发，不要带着冲突写代码。
2. **上下文理解**：读 `wiki/85-backlog.md`、相关代码和已有 spec。
3. **探路 (Spike) [可选]**：
   - 如果技术方案高度不确定（如使用了未知的 API 或新库），允许先写一段脏代码（dirty code）试跑。
   - 确认核心 API 跑通、验证完假设后，**必须将探路代码删除或 revert**，然后再正式进入阶段 1。

## 阶段 1：Spec 与类型契约 (Type-First)

4. **UX/UI 约束与方案设计**：
   - 按需使用 `product-designer`, `ui-ux-pro-max` 和 `ui-design-patterns` skill，明确目标用户、核心任务流、关键交互反馈（空状态/加载/错误/成功）与可用性风险。
   - 按 `CLAUDE.md` 的 **Spec 模板** 写 spec 到 `wiki/specs/spec-<topic>.md`。**注意**：每段不能为空；验收标准必须可执行、可判定 pass/fail。
5. **架构审查**（利用 `software-architecture` skill 原则）：
   - **Library-First**：优先用现成库，除非是核心业务逻辑。
   - **Clean Architecture**：业务逻辑是否独立于框架和 UI？关注点是否分离？
   - **命名规范**：模块/文件命名领域化，禁止 `utils`/`helpers`/`common`/`shared`。
   - **复杂度预判**：新增函数控制在 50 行内，文件控制在 200 行内，嵌套 ≤3 层。
   - [⚠️ 失败恢复] 不符合上述任何一条 → 立即在 spec 中调整方案再继续。
6. **类型先行 (Type-First)**：
   - 在写任何逻辑或测试前，**必须先定义 TypeScript Interface / Types / API 数据结构**。
   - 将类型定义提交为一个独立的微提交 (e.g., `git commit -am "wip: define types"`）。
7. **Spec 自我评审（≥2 轮）**：
   - 轮 1（完整性）：边界 case 列够了吗？数据流图画了吗？类型定义是否契合？
   - 轮 2（可行性）：涉及的 API 存在吗？版本兼容吗？性能影响？
   - [⚠️ 失败恢复] 发现空白段落 → 补全；发现问题 → 修改后重新 review。

## 阶段 2：测试 (分层策略)

8. **纯逻辑与后端测试先行 (TDD)**：
   - 根据 spec 和刚刚定义的 Types，编写纯逻辑、数据流、Hooks 或后端接口的测试。
   - 必须覆盖三类 case：正常路径 + 边界 case + 错误路径。对照 `CLAUDE.md` 的"边界 case 发现清单"核查。
   - 确认测试可运行且**全部 fail**（红灯状态）。
9. **UI 层推迟测试**：
   - 如果涉及纯前端 UI 组件，**允许先跳过交互测试**。UI 组件遵循“结构先行 -> 视觉确认 -> 补齐测试”的流线，在阶段 3 完成。

## 阶段 3：微步实现 (Atomic WIP)

10. **纯逻辑实现 (核心层)**：
    - 实现阶段 2 中对应的纯业务逻辑，使测试变绿。
    - **Two Hats 原则**：若需重构，先保证绿灯，小步重构后立即跑测试。
    - [⚠️ 失败恢复] 重构时若测试变红 → 立即 `git revert` 到上一个绿灯状态，不要 debug。
    - 逻辑写完且绿灯后，自动执行微提交：`git commit -am "wip: core logic"`。
11. **UI 与组件实现 (展示层)**：
    - 渲染 UI 结构，确保符合**设计系统合规**（色值变量、Focus ring、字体 class、z-index 查表等，详见 `wiki/21-design-principle.md`）。
    - 梳理状态变更（条件分支查旧 UI、验证初始值、查禁用守卫，详见 `wiki/41-dev-pitfall-patterns.md`）。
    - 自动执行微提交：`git commit -am "wip: ui structure"`。
12. **补齐 UI 测试**：
    - 针对已经构建好的 DOM 树，补充 UI 交互和视觉层的自动化测试。
    - 确保 UI 测试通过后，执行微提交：`git commit -am "wip: ui tests"`。
13. **全局模式一致性**：扫描代码库处理同类模式替换。大型替换使用 **Expand-Migrate-Contract** 策略。

## 阶段 4：Code Review

14. **执行自查**：调用 `/self-review`（或严格按其 4 维度 checklist 执行：正确性→健壮性→架构+可维护性+精简→性能+前端合规）。
    - 🔴 Blocker 级缺陷 → 修复后重新检查该文件。
    - 🟡 Major 级缺陷 → 修复后说明改了什么。
    - [⚠️ 失败恢复] **最多执行 3 轮**。若第 3 轮仍有 🔴 → 停止流程，向用户报告剩余问题，等待决策。

## 阶段 5：验证与清理

15. **跑全量测试**：执行 `npx vitest run`，必须全部通过。
    - [⚠️ 失败恢复] 测试跑不过 → 回到阶段 3 修复，不要跳过 review。
16. **UI 回归测试**：改动涉及 UI → 用 Playwright 截图关键页面，保存到 `/tmp/`。
17. **清理 WIP 记录 (Squash commits)**：
    - 使用 `git reset --soft HEAD~N` 将本任务产生的多个 `wip:` 提交合并。
    - 不要立刻 commit，将所有改动保留在暂存区，准备在阶段 7 提交一个干净的 Conventional Commit。

## 阶段 6：交付准备

18. **更新文档**：同步更新 `wiki/`（架构变更、新坑记入 `80-known-pitfalls.md`）和 `wiki/85-backlog.md`（给任务打勾）。

## 阶段 7：提交与汇报

🛑 **注意：执行到此处时，主动向用户汇报并询问是否提交。如果用户同意，则继续执行：**

19. **代码提交**：以 Conventional Commits 格式执行单次优雅的 commit，并 push。
20. **发布验证**：如果涉及 release → 执行冒烟验证（在临时目录执行 `npx @geminilight/mindos@latest --version` 等验证指令）。

### 最终呈现清单

向用户展示本次自治开发的结果：
- 变更摘要（改了什么、为什么）
- 关键 diff
- 测试覆盖情况
- 架构决策说明（如有 Library-First 选择、Spike 结论等）
- 截图（如有 UI 改动）
- 冒烟结果（如有 release）
- 已知风险 / 遗留项 / 后续 TODO（如有）