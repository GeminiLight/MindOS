# Actions 用量控制

2026-09-12：账户当月包含的 3,000 分钟已用尽。审计显示 MindOS 实际任务时间约 825 分钟，主要是多平台重复环境准备；这不是账单扣除分钟的精确对账。

## PR 验证

统一入口为 **Test PR Regressions**（`test-reliability.yml`）：先用不安装依赖的轻量任务读取 PR 变更。

- Channel 与 Reliability 按改动选择，合并到同一三平台矩阵，共用一次依赖安装、一次核心构建。
- Channel 测试、核心所有权/恢复、mobile 持久化、Web 恢复回归保留；Web/mobile 类型检查只在 Linux 执行。
- 文档和网站改动跳过应用矩阵；纯工作流 contract 改动只跑 Linux；Desktop/Tauri 改动走各自专属流程。共享核心/锁文件/未知输入保守扩大检查。
- 缺失 Git 历史、空列表、无效输入或 diff 超时按全检查处理。手动 Run workflow 运行全检查。
- 同 PR 新提交取消旧验证；原生安装/发布覆盖及主线同步串行保护不变。

## 缓存读写

`scripts/ci/setup/action.yml` 固定 Node 22.19.0 / pnpm 10.18.3，仅恢复精确 key 的依赖 store。key 包含 OS、架构、工具版本、锁文件和 workspace 配置。PR 不保存 pnpm 缓存。Rust 编译缓存保持现有读写：本期保存约 2.85 分钟、编译约 35.75 分钟，避免因关闭少量写入增加大量冷编译。

只有 **Warm CI dependency cache** 在 main 依赖变化时更新 pnpm 缓存，也可在 main 手动运行。每个平台先仅查询缓存是否存在：存在则结束，不存在才安装、清理并保存。工作流串行，写入失败不把业务测试标绿；真正的业务依赖安装失败仍正常报错。

缓存单段下载最多一分钟，整个环境准备步骤最多五分钟。缓存缺失/单段恢复失败会走正常冻结安装；环境准备整体超时会正常报错。主线还没生成新锁文件缓存时，PR 冷启动属于允许的性能退化。线上恢复后需比较冷/热缓存时间与命中率；当前未验证具体节省比例。

## Obsidian 与预算

Obsidian 语料扫描默认不自动运行，仅保留 **Obsidian Corpus (Manual)** 的手动入口，文件名保持 `obsidian-corpus-nightly.yml`，单次上限 45 分钟。公开仓旧 workflow 已手动暂停；更新同步后要手动运行时需先 Enable workflow。产品内兼容功能不受影响。

本次不调整预算/付款方式，也不申请新的账户权限。预算恢复或配置可用运行器后，重跑最新 main 的 **Sync to MindOS**，确认公开仓完成同步。发布仍沿既有白名单单向同步，不直接推 public main。

## 验证

`pnpm exec vitest run tests/ci-change-plan.test.ts tests/ci-cache-policy.test.ts tests/actions-cost-policy.test.ts tests/reliability-workflow.test.ts tests/workflow-migration-contract.test.ts`

此外跑 root `test:quick`、受影响工作流语法检查和原回归命令。冷/热缓存的实际 Actions 分钟要等运行器恢复后核对，不能用本地测试宣称线上节省。

## 无法付款时手动恢复同步

`Sync to MindOS` 的 Run workflow 提供 `runner=local-sync`。仅允许手动选择 main；默认仍为 `ubuntu-latest`，main/tag 自动触发和 release 语义不变。同步继续执行原有 `.syncinclude` 白名单、泄漏检查、串行队列，单次上限 30 分钟。

临时运行器要求：

- 在本机 Docker Linux 容器中运行官方 Actions runner；镜像需包含 bash、git（含 subtree）、rsync、curl 和 CA 证书。
- 只注册到私有 `GeminiLight/mindos-dev`，使用 `--ephemeral --no-default-labels --labels mindos-sync-isolated`。不能添加 `self-hosted` 等通用标签；不用于 PR 验证。
- 容器使用普通用户、`--cap-drop=ALL --security-opt=no-new-privileges`，限制 CPU/内存/PID；不挂载宿主目录或 Docker socket。注册凭证经标准输入传入，不写入仓库、镜像或命令日志。
- 启动后确认 GitHub 显示 online，再执行 `gh workflow run sync-to-mindos.yml --repo GeminiLight/mindos-dev --ref main -f runner=local-sync`。
- 一个任务后 runner 自动注销。检查运行结论和公开仓同步提交，再删除临时容器；未接到任务或异常退出时，通过仓库 runner API 删除离线注册。不要留下常驻执行服务。

这是不消耗 GitHub 托管运行分钟的手动恢复入口；本机需开机且 Docker 在线，CPU、存储和网络由本机承担。不会恢复 Windows/macOS 托管 PR 检查，也不会自动启用 Obsidian 扫描。额度恢复后可继续使用默认托管入口。

### 2026-09-12 实际恢复记录

用户无法付款后授权使用本机隔离运行器。PR #349 已合入 main（`d1b057c4`）；58 项相关测试及 actionlint 通过。官方 runner 2.337.0 Linux ARM64 发布包通过 SHA-256 验证，在普通用户、零宿主挂载、丢弃 capabilities 的 Docker 容器中执行。

[首次手动同步运行](https://github.com/GeminiLight/mindos-dev/actions/runs/34701975848) 成功（15:21–15:24 UTC）；公开仓 main 更新到 `d651c80c`，gh-pages 更新到 `013b8281`，网站树与源 main 的 landing 树完全一致，公开仓 Obsidian 手动工作流文件也与源文件 SHA 相同。运行器完成一次任务后自动注销，API 返回 0 个 runner，容器已删除。未修改付款方式、预算，也未发布 npm/Desktop 版本。

本次对话期望 workflow：恢复同步，已完成。后续需要同步时重新启动单次运行器并手动派发；其他 GitHub 托管 PR 检查仍受账户额度限制。

### 一条命令恢复同步（2026-11-09 起）

上次恢复只在这里写了要求，没有留下脚本，第二次只能从头构建，又撞上 Docker Hub 不可达。现在镜像定义和驱动脚本放在 `.github/local-sync-runner/`（只有 `.github/workflows/*.yml` 会被同步，这个目录始终留在私有仓；`.syncinclude` 的泄漏检查会拦截任何名为 `Dockerfile` 的文件，所以它也不能放进 `scripts/`）：

```bash
.github/local-sync-runner/run.sh                                  # Docker Hub 可达时
BASE_IMAGE=python:3.11-slim .github/local-sync-runner/run.sh      # 用本机已缓存的 bookworm 镜像
```

脚本依次完成：构建镜像（先校验官方 runner 包的 SHA-256）→ 经标准输入传入注册令牌启动一次性容器 → 确认 runner online → 从 main 派发 `runner=local-sync` → 等待容器自行退出 → 清理残留注册 → 打印公开仓 main 的提交、剩余 runner 数和容器状态。同步结论不是 `success` 时以非零退出，不会把失败报成完成。契约见 `tests/local-sync-runner.test.ts`。

### 2026-11-09 第二次恢复记录

公开仓停在 #389。用临时镜像（runner v2.338.2，Docker Hub 超时，改用本机缓存的 `python:3.11-slim` 作为 bookworm 基础镜像）完成了 [同步运行](https://github.com/GeminiLight/mindos-dev/actions/runs/42586951639)，公开仓 main 更新到 #415 的合并提交（`1670523b`），runner 自行注销，容器已删除。

随后在公开仓手动运行 [Test Desktop Installation](https://github.com/GeminiLight/MindOS/actions/runs/42587369645)，三个平台都在 `pnpm install --frozen-lockfile` 失败：`pnpm-workspace.yaml` 的 `patchedDependencies` 引用了 `patches/pi-schedule-prompt@0.4.1.patch`，而 `patches/` 不在 `.syncinclude` 中。也就是说，这次同步带过去的公开仓是**无法安装的**。已把 `patches` 加入白名单，并新增 `tests/sync-include-completeness.test.ts`：工作区引用的每个补丁文件都必须落在会被同步的路径中。

修复（#416）后用 `run.sh` 再次同步，公开仓 main 更新到 #416（`efbaa71c`），补丁文件已在公开仓中。重跑 [Test Desktop Installation](https://github.com/GeminiLight/MindOS/actions/runs/42588608775)：ubuntu-latest、windows-latest、macos-15 **全部通过**，包括 `pnpm install`、desktop 全部测试、发布完整性测试、typecheck、构建，Windows 上还有安装器所有权与旧数据迁移测试、安装钩子编译。这是 desktop 在 Windows / Linux 上第一次有执行级验证。

那次运行也暴露了 `run.sh` 的一个缺陷：同步已经成功，脚本却在打印公开仓提交时因一次网络超时被 `set -e` 中断，没有完成后面的清理核对。现在汇报阶段的 API 调用都会重试三次，失败时只提示去网页确认，不再中断。

### 公开仓根契约

私有源仓和公开镜像共用 Linux 回归任务。公开镜像继续运行产品、打包和已发布工作流的通用断言，只跳过需要私有规格、基准和同步配置的断言。根 ESLint 配置通过白名单同步。私有源仓仍运行全部契约；CI 用仓库身份判断私有源仓，缺少私有文件会失败。
