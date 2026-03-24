你正在执行全自治开发流程。任务：$ARGUMENTS

严格按以下阶段顺序执行，不要跳过任何步骤，不要中途停下来等确认。

## 阶段 0：环境准备

1. 公开仓同步检查（有 public remote 时执行，无则跳过）：
   - `git remote | grep public` → `git fetch public main && git log public/main --oneline -5`
   - 有未同步 commit → 先 `git merge public/main --no-edit`，再继续
2. 读 `wiki/85-backlog.md`、相关代码和已有 spec，理解上下文

## 阶段 1：Spec + 架构评审

3. 按需使用 `product-designer` 和 `ui-design-patterns` skill 确保用户体验
 按 CLAUDE.md 的 **Spec 模板** 写 spec 到 `wiki/specs/`，每段不能为空
4. 用 `software-architecture` skill 的原则审查 spec 方案：
   - **Library-First**：方案中是否有可用现成库替代的自定义实现？优先用库，除非是核心业务逻辑
   - **Clean Architecture**：业务逻辑是否独立于框架和 UI？关注点是否分离？
   - **命名**：模块/文件命名是否领域化？禁止 `utils`/`helpers`/`common`/`shared` 等泛化命名
   - **复杂度预判**：新增函数能否控制在 50 行内？文件能否控制在 200 行内？嵌套 ≤3 层？
   - 不符合 → 在 spec 中调整方案再继续
5. 自我 review spec ≥2 轮：
   - 轮 1：完整性 — 边界 case 列够了吗？数据流图画了吗？与现有架构有冲突吗？
   - 轮 2：可行性 — 涉及的 API 存在吗？版本兼容吗？性能影响？
   - 有空白段落 → 补全。有问题 → 修改后重新 review

## 阶段 2：测试

6. 根据 spec 验收标准写测试（先于实现）
7. 必须覆盖三类 case：正常路径 + 边界 case + 错误路径
8. 过一遍 CLAUDE.md 的"边界 case 发现清单"（空值/类型/字符串/集合/时序/环境/状态）
9. 确认测试可运行且全部 fail（红灯状态）

## 阶段 3：实现

10. **Two Hats 原则**（来自 `refactoring-patterns` skill）：重构和加功能不同时做
    - 如果现有代码结构不适合新功能 → 先戴"重构帽"：小步重构（每步跑测试→绿→commit），让代码适合接纳新功能
    - 再戴"功能帽"：在干净的结构上添加功能，让测试变绿
    - 重构时遵循小步循环：改一步 → 跑测试 → 绿 → commit，红 → 立即 revert 不要 debug
11. 前端改动必须逐条检查：
    - **设计系统合规**：色值用 CSS 变量、Focus ring 用 `focus-visible:`、字体用 class、z-index 查表、动效 ≤0.3s、圆角查表（详见 `wiki/21-design-principle.md`）
    - **状态变更三检查**（详见 `wiki/41-dev-pitfall-patterns.md` 规则 6-8）：
      - 加条件 UI 分支 → grep 旧 UI，确认移除或互斥
      - 加分支改变默认行为 → 验证 state 初始值
      - 加 disabled → grep 所有 `setXxx` 调用方，逐一确认守卫
    - 纯后端改动跳过此步
12. 全局扫描同类模式：搜索代码库中是否存在与本次改动相同的模式/结构，统一处理，不留不一致
    - 大型替换使用 **Expand-Migrate-Contract** 策略：先新旧并存 → 逐步迁移调用方 → 最后移除旧版

## 阶段 4：Code Review

13. 执行 `/self-review`（4 维度 checklist：正确性→健壮性→架构+可维护性+精简→性能+前端合规）
    - 有 🔴 Blocker → 修复后重新检查该文件
    - 有 🟡 Major → 修复后说明改了什么
    - **最多执行 3 轮**：如果第 3 轮仍有 🔴 → 停止，向用户报告剩余问题和根因分析，等待决策（通常意味着 spec 方案本身需要调整）

## 阶段 5：验证

14. 跑全量测试（`npx vitest run`），必须全部通过
15. 如果改动涉及 UI → 用 Playwright 截图关键页面，保存到 `/tmp/`

## 阶段 6：交付

16. 更新文档：`wiki/`（架构变更、新坑记入 `80-known-pitfalls.md`）、`85-backlog.md`（打勾）
17. commit + push（遵循 CLAUDE.md Git 流程，Conventional Commits）
18. 如果涉及 release → 执行冒烟验证（临时目录 `npx @geminilight/mindos@latest --version`）

## 失败处理

- **测试跑不过（阶段 5）**→ 回到阶段 3 修复，不要跳过 review 直接提交
- **Review 发现 spec 缺陷（阶段 4）**→ 回到阶段 1 修订 spec，重走阶段 2-4
- **公开仓 merge 冲突（阶段 0）**→ 解决冲突后再开始开发，不要带着冲突写代码
- **重构步骤测试变红（阶段 3）**→ 立即 revert，不要 debug，尝试更小的步骤

## 最终呈现

向用户展示：
- 变更摘要（改了什么、为什么）
- 关键 diff
- 测试覆盖情况
- 架构决策说明（如有 Library-First 选择、重构策略等）
- 截图（如有 UI 改动）
- 冒烟结果（如有 release）
- 已知风险 / 遗留项 / 后续 TODO（如有）
