# PR 与开发分支集成核对：2026-09-13

用户要求合理合入待交付成果并同步公开仓。盘点基线为 main `46e73052`，已 fetch origin；根目录现有论文修改和五份未追踪审计笔记保持原样。

## 近期任务

12 个现有任务 worktree 均无未提交改动，且其 HEAD 都已经是 origin/main 的祖先：Actions 用量优化、Agent 配置 UX、Agent 架构简化、Electron 安装加固、外部会话、临时同步运行器、Mobile 加固、Obsidian 泛化、Study readiness、UI/UX 打磨、网站品牌栏、网站协同演化。它们保留在工作区/分支列表中不代表还没合并，不需要重复合入。

## 唯一开放 PR：#337

[Windows 可靠性修复](https://github.com/GeminiLight/mindos-dev/pull/337) 的功能已由 `234dfcd1` 合入主线，包括：

- bootstrap 使用 POSIX vault 路径。
- Windows 连接注册锁保护。
- 测试清理前关闭 SQLite；Windows 跳过 POSIX mode-bit 权限用例。

旧分支与主线有六处冲突；对齐时保留主线这六个文件。尤其不能恢复旧分支 `legacyFileLockHeld`：它吞掉所有 lstat 异常，而主线仅允许 ENOENT 继续获取锁，保护更严格。

保留 PR 独有的 bootstrap 路径回归测试，确认 README/INSTRUCTION/CONFIG 的请求路径不产生反斜杠。最终产品运行时代码相对 main 无变化。独立复核确认无遗漏。

原 PR 的 Windows 失败位于 mobile 文本 contract 的 CRLF 断言；当前 main 已使用 `\r?\n`。本次不把旧 CI 成绩当作新提交的 Windows 验证。

## 完整检查发现的测试集成遗漏

主线与候选均复现两组旧测试失败，完整核心 suite 还暴露一个已有的计时不稳定用例。修正测试，不恢复已删除的产品代码：

- `titlebar-geometry` 仍从 InboxView 寻找旧 lg 布局。实际 sticky 预览已移到 ResponsiveInboxDetails 并改为 xl 断点；把同一几何保护断言指向当前组件。
- `non-streaming-api.test.ts` 的 14 个用例调用 `8166a493` 已明确移除的旧 fallback API。删除这份失去被测实现的旧测试；当前 Pi/runtime/provider 验证继续保留，不恢复重复执行引擎。

- Capsule 写队列测试使用固定 `<5ms` 耗时阈值，在 242 文件并行时受调度影响而失败。改为直接验证大消息内容在同步返回前不被读取、磁盘仅有小 stub、flush 后完整落盘；保留延迟写入保证，不靠放宽耗时阈值。

首次任务工作区 pre-push 因 Web 依赖未链接而失败，补齐现有依赖并完成核心构建后，root contract/unit 检查通过；完整 Web 检查才暴露以上主线遗留项。

## 不应恢复的旧分支

- `codex/product-section-memory-core-20260708`：对应 PR #292，维护者已于 2026-09-08 明确关闭，原因是陈旧、冲突且部分范围已另行进入主线；剩余 foundation 若要恢复，应重新立项对齐当前架构。
- `legacy/main-before-v1-2026-04-28`、`legacy/main-with-history-before-fresh-start-2026-04-28`：历史存档，不作为交付候选。
- `gh-pages`：网站发布产物分支，不反向合并到源码。
- `paper`：独立子模块，存在持续中的论文修改；不混入软件 PR 集成。

## 验证与交付状态

- main 基线相关 7 个文件、60 项测试通过。
- PR 对齐后相关 7 个文件、61 项测试通过，新增路径回归通过。
- 候选已完成六处冲突审查，运行时语义保持主线。
- PR #337 已合入 main：`23d476a1`。合并后核心相关 71 项和布局 5 项测试再次通过。
- 完整 pre-push 使用 `VITEST_MAX_WORKERS=2`：root contract 293、root unit 576、Web 5,414、core 2,726、mobile 315、Desktop 562，共 9,886 项通过，44 项既有可选跳过；四个应用/核心类型检查与脚本语法检查通过，核心构建通过。
- 高并发时文件树基准受到本机负载影响；降低测试并发后原始阈值通过，没有跳过测试或放宽该阈值。Capsule 延迟写入测试通过反向变异验证，能拦住同步 clone 回退。
- 用户期望的主线集成已完成；公开仓交付使用 latest main 的 `Sync to MindOS` 手动隔离入口，最终同步状态以该 head 的 Actions 运行结果与公开仓文件 SHA 核对为准。
- 未跑 release 全量构建及新 Windows 托管任务：本次仅测试/文档变更，无发布请求，托管额度仍阻断。

公开仓只能由既有 `.syncinclude` 白名单工作流单向同步；不得直接推送 public main。托管额度仍受限时使用单次隔离运行器。
