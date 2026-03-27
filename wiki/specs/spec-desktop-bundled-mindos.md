# Spec: Desktop 内置 MindOS 运行时与版本择优

## 目标

1. **零全局安装也能本地跑**：MindOS Desktop 安装包内携带**固定版本、已构建完成**的 MindOS（Next.js 可运行产物 + 启动所需资源），用户在未执行 `npm i -g @geminilight/mindos` 时仍可进入本地模式。
2. **与用户升级对齐**：当本机存在**更高版本**的 `@geminilight/mindos`（npm 全局安装且已 build）时，默认**优先使用该版本**启动 Web/MCP，使用户通过 `npm update -g` 获得的新功能与修复在 Desktop 中生效；同时保留回退到内置版的路径与可配置项。
3. **行为可解释、可排障**：当前实际使用的运行时来源（内置 / 全局路径 / 显式配置）应对用户或日志可见，避免「装了新版本却仍在跑旧壳」的困惑。

本 spec **不替代** [spec-electron-desktop-app.md](./spec-electron-desktop-app.md)，在其本地模式之上增加**运行时解析层**与**打包物约束**。

### 术语澄清（避免误读）

| 说法 | 含义 |
|------|------|
| **零全局安装** | 指用户**不必** `npm i -g @geminilight/mindos`；**不**表示不需要 Node。本地模式仍由 Electron 使用 **Node 二进制**（`~/.mindos/node` 私有 Node、系统 Node 或 `MINDOS_NODE_BIN`，见 [`desktop/src/node-detect.ts`](../../desktop/src/node-detect.ts)）spawn Next 与 MCP。 |
| **内置 MindOS** | 随 Desktop 分发的 **MindOS 仓库根目录**（含 `app/`、`mcp/` 等），不是「把 Node 打进安装包」的替代方案（除非另开 spec 讨论捆绑 Node）。 |

## 现状分析

### 当前行为（摘要）

- 本地模式由 Electron Main 解析 **Node** → **`getMindosInstallPath(nodePath)`**（[`desktop/src/node-detect.ts`](../../desktop/src/node-detect.ts)）得到 `@geminilight/mindos` 目录；若无则 **`installMindosWithPrivateNode`** 拉全局包并依赖本机 build（`app/.next` 等）。
- 首次或缺 **`app/.next` 目录**时会在 splash 下执行 **app 目录 `npm install`、（可选）`scripts/gen-renderer-index.js`、`next build`**，耗时长、对网络与磁盘敏感。（代码以 `existsSync(path.join(projectRoot, 'app', '.next'))` 为门槛，与「仅有 standalone 而无 `.next` 父目录」的边界需实现时留意。）
- **没有**「与 Desktop 安装包绑定的、已编译好的 app 目录」概念；可复现性与离线首启能力弱于「内置 artifact」方案。

### 与当前实现对照（代码核查）

以下锚定仓库现状，便于实现本 spec 时改对位置、避免与既有分支冲突。

**主流程**：[ `startLocalMode()` ](../../desktop/src/main.ts)（约 `main.ts` L186 起）当前顺序为：

1. **`getNodePath()`**（[`node-detect.ts`](../../desktop/src/node-detect.ts)）→ 若无则 **`downloadNode()`** 安装到 **`~/.mindos/node`**（[`node-bootstrap.ts`](../../desktop/src/node-bootstrap.ts)，版本常量 `NODE_VERSION`）。
2. **`getMindosInstallPath(nodePath)`** → 若无则 **`installMindosWithPrivateNode()`**（全局 `npm i -g @geminilight/mindos`）。
3. **`checkCliConflict()`**（读 **`~/.mindos/mindos.pid`**）：若判定 **已有 CLI 进程占用**，则 **直接 `return http://127.0.0.1:{port}`**，**不**创建 **`ProcessManager`**，也 **不**再执行后续 build / spawn。此时 UI 连接的是**已存在**的 Web 服务，**与本 spec 的 projectRoot 择优无关**。
4. 否则：若不存在 **`projectRoot/app/.next`**，则在 **`projectRoot`** 上执行依赖安装与 **`next build`**（并可能在 `projectRoot/scripts/gen-renderer-index.js` 存在时先跑生成脚本）。
5. **`new ProcessManager({ nodePath, npxPath, projectRoot, webPort, mcpPort, mindRoot, ... })`** → **`start()`**：先 MCP 后 Web，**轮询 `http://127.0.0.1:{webPort}/api/health`**，超时 **120s**（见 `process-manager.ts`）。

**本 spec 的插入点**：应在得到最终 **`projectRoot`** 的步骤 **替换/扩展** 当前第 2 步（在 **`installMindosWithPrivateNode`** 之前优先解析 **Bundled / 择优**）；第 4 步的 build 必须针对**选定后的** **`projectRoot`**。第 3 步 **CLI 冲突短路** 行为保持不变，但须在文档与排障中说明：**撞 PID 时不会应用 Bundled/User 解析结果**。

**托盘「重启服务」**：[`handleRestartServices()`](../../desktop/src/main.ts) 在已有 **`processManager`** 时调用 **`processManager.restart()`**，**不会**重新执行 **`getMindosInstallPath` / 运行时择优**。因此用户在同一 Desktop 会话内升级全局 MindOS 包后，**仅点重启可能仍跑旧 `projectRoot`**；若产品要求「重启即重新择优」，需在实现中显式改为 **stop → 重新 `startLocalMode()`** 或等价逻辑（本 spec 验收可单列一条可选）。

**配置类型**：[`MindOSConfig`](../../desktop/src/main.ts) 已含 **`[key: string]: unknown`**，JSON 可先行写入新键；建议在 TypeScript 中为 **`mindosRuntimePolicy`** 等增加**可选明文字段**，避免全靠索引签名。

### 与现有 ProcessManager 的硬约束（实现必须满足）

[`desktop/src/process-manager.ts`](../../desktop/src/process-manager.ts) 对 `projectRoot`（即 MindOS 包根目录）约定如下，**BundledRuntime 与用户全局包结构一致**，否则启动失败：

| 组件 | 路径 / 条件 | 说明 |
|------|-------------|------|
| MCP | `projectRoot/mcp` 存在 | `cwd` 为 `mcp/`；使用 `nodePath` + `dist/index.cjs`（esbuild 预编译 bundle），不再依赖 `tsx` 或 `node_modules`。旧版 Desktop 仍兼容 `tsx src/index.ts` 路径（`tsx` 保留在 `mcp/package.json` dependencies 中） |
| Web | `projectRoot/app` 存在 | **优先** `app/.next/standalone/server.js` + **`nodePath`** 执行，`cwd`=`appDir`，`PORT`=`webPort`；否则 `app/node_modules/.bin/next start -p`；再否则 **`npxPath` + `next start`** |

**环境变量（子进程）**：Web 使用 **`MINDOS_WEB_PORT`**、**`MIND_ROOT`**、**`NODE_ENV=production`**；MCP 使用 **`MCP_PORT`**、**`MCP_HOST=0.0.0.0`**、**`MINDOS_URL=http://127.0.0.1:{webPort}`** 等（与现实现一致）。

因此内置产物不能只带「裸 `.next`」而缺少 **`mcp/dist/index.cjs`** 预编译 bundle 及 **`app` 侧 next/standalone 所需文件**。技术选型表（standalone vs 带 `node_modules`）必须对照上表验收。

### 为什么不满足需求

| 问题 | 说明 |
|------|------|
| 依赖全局包或现场安装 | 非技术用户仍需等待安装/build，与「开箱即用」桌面产品预期不符 |
| 版本与 Desktop 解耦 | 用户难以感知「当前 UI 对应哪一版 MindOS」；排障时要同时问 Desktop 与 npm 版本 |
| 未定义「新于内置则用全局」 | 产品上有诉求，但代码层无统一择优策略，易产生随意硬编码 |

## 数据流 / 状态流

### 概念

- **内置运行时（BundledRuntime）**：随 Desktop 安装包释放到只读资源目录（如 `app.asar.unpacked` 或 `Resources/mindos-runtime/`）下的 MindOS 根目录，内含**已构建**的 `app`（例如存在可用的 `.next` 或 standalone 入口，具体形态由实现选定），以及 `package.json` 中的 **`version`**（与 npm 包 semver 对齐）。
- **用户运行时（UserRuntime）**：通过现有逻辑解析到的全局 `@geminilight/mindos` 路径，且满足「已 build、可启动」判定。
- **有效版本（EffectiveVersion）**：从对应根目录 `package.json` 读取的 `version` 字段，按 **semver** 比较。

### 解析顺序（本地模式，建议默认策略）

```
启动本地模式
    │
    ▼
┌─────────────────────────────────────┐
│ 1. 显式覆盖（最高优先级）              │
│    config.mindosRuntimeRoot 或        │
│    环境变量（建议 MINDOS_RUNTIME_ROOT，│
│    实现阶段命名需与代码一致；**勿与**   │
│    已有 MINDOS_NODE_BIN 混淆）        │
└─────────────────────────────────────┘
    │ 未配置则继续
    ▼
┌─────────────────────────────────────┐
│ 2. 解析 UserRuntime 路径 + 版本 Vu     │
│    （沿用 getMindosInstallPath 等）    │
└─────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────┐
│ 3. 读取 BundledRuntime 版本 Vb       │
└─────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────┐
│ 4. 择优（默认 mindosRuntimePolicy=   │
│    "prefer-newer"）                   │
│    • User 可用 且 Vu > Vb 且 Vu 满足   │
│      Desktop 声明的 minMindOsVersion   │
│      → 选 UserRuntime                 │
│    • 否则 → 选 BundledRuntime         │
│    • Bundled 不可用且 User 不可用      │
│      → 现有降级：安装/构建流程或错误 UI │
└─────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────┐
│ ProcessManager 使用选定根目录          │
│ + 既有 Node 解析（私有 Node / 系统 Node）│
└─────────────────────────────────────┘
```

### 与配置、缓存的关系

- **`~/.mindos/config.json`**：可扩展字段（实现时命名需与现有字段风格一致），例如：
  - `mindosRuntimePolicy`: `'prefer-newer' | 'bundled-only' | 'user-only'`（默认 `prefer-newer`）
    - **`user-only`**：仅尝试 UserRuntime（及 `mindosRuntimeRoot` 若视为 user 源）；**不可用则启动失败并提示**，不静默回退 Bundled（避免违背「我只要全局/自定义目录」的预期）。若产品后续需要「user 优先失败再 bundled」，应新增显式策略值（如 `prefer-user-fallback-bundled`），勿改变 `user-only` 语义。
  - `mindosRuntimeRoot`: 可选，绝对路径，指向自定义 MindOS 根目录（高级用户 / 调试）
  - `mindosRuntimeStrictCompat`: 可选 boolean，对应下文 **`strictCompat`**（默认 false）
- **不需**把「本次选了哪一路」持久化为唯一真相源；每次启动重新解析即可（避免用户降级 npm 后仍锁死旧路径）。若需减少探测成本，可做**内存缓存**或**短期文件缓存**并定义失效条件（见边界 case）。

**择优细节（避免歧义）**

- **`prefer-newer` 且 `Vu === Vb`**（semver 相等）：建议 **优先 UserRuntime**（与边界表 #3 一致），理由：同版本号下用户全局树可能含热修/本地 patch；代价是与内置 bit-for-bit 不一致，排障依赖日志中的 `path`。
- **`prefer-newer` 且 `Vu < Vb`**：采用 **BundledRuntime**（内置新于用户全局时，默认不降级用旧全局，除非 `user-only` 或 override）。

### 状态流（用户视角）

1. 安装 Desktop → 内置 Vb 可用 → 无全局包亦可启动。
2. 用户 `npm i -g @geminilight/mindos@latest` 且 build 完成 → 下次启动若 Vu > Vb 且兼容 → **自动切到 UserRuntime**。
3. 用户在设置中改为「仅使用内置」→ 强制 BundledRuntime，忽略更高 Vu（用于可复现或规避全局损坏）。

## 方案

### 技术选型（运行时形态）

在实现阶段二选一或组合，需在开发前在子文档中敲定并写入验收项：

| 方案 | 优点 | 缺点 |
|------|------|------|
| **A. Next standalone** | 进程模型清晰、与生产部署接近 | 打包体积大；需验证与当前 MCP spawn 参数一致 |
| B. 预置完整 `app/.next` + `node_modules`（精简） | 与现有 dev 路径接近 | 体积分层难；跨平台 native 依赖需分平台包 |

**建议**：优先评估 **standalone** 是否与现有 `ProcessManager`、端口与健康检查一致；若短期成本过高，可阶段性采用「内置仅带 `.next` + 最小依赖」，但必须在 spec 附录记录差异与迁移计划。

**现状（2026-03）**：已落地 **Next `output: 'standalone'`** + `prepare-mindos-runtime` 精简拷贝（无 `app/node_modules`，排除 `.next/cache` / `.next/dev`），详见 [spec-desktop-standalone-runtime.md](./spec-desktop-standalone-runtime.md)。

### 版本比较

- 使用与 npm 一致的 **semver**（`semver` 库或等价实现），比较 `UserRuntime` 与 `BundledRuntime` 的 `package.json#version`。
- **预发布标签**（`1.0.0-beta.1`）：默认视为低于同号正式版；与 npm 行为对齐，避免误选 beta 覆盖稳定内置（可通过策略位扩展，首版可简化为「仅比较，预发布规则与 npm 一致」）。

### 兼容性门槛

- Desktop **每个发布版本**在构建时**内嵌**只读元数据（实现任选其一，需写入验收与代码常量）：
  - **`bundledMindOsVersion`**：与 BundledRuntime 的 `package.json#version` 一致，供展示与比较；
  - **`minMindOsVersion`**：Desktop 壳**愿意 spawn** 的最旧 MindOS 全局版本；`Vu < minMindOsVersion` 时 **不采纳** UserRuntime，改用 Bundled 或明确错误 + 引导升级全局包。
  - **`maxTestedMindOsVersion`**：CI/发布前在「该版本 MindOS」上测过的上限；**不**等同于硬上限 API。
- 运行时若 `Vu` **高于** `maxTestedMindOsVersion`：
  - **默认**（`strictCompat=false`）：仍尝试启动 UserRuntime，失败则回退 Bundled 并提示升级 Desktop 或检查全局安装。
  - **`strictCompat=true`**（配置 `mindosRuntimeStrictCompat` 或等价）：**不采纳** UserRuntime，仅 Bundled（企业/可复现场景）。

若 `Vu` **低于** `minMindOsVersion`（极旧全局包）：**不采纳** UserRuntime，直接用 Bundled 或引导用户升级全局包（文案需明确）。

### 可观测性

- **日志**（Main）：一行结构化信息：`runtimeSource=bundled|user|override`，`path=...`，`version=...`。
- **设置页或关于**（后续 UI spec）：展示当前 `EffectiveVersion` 与来源；非本任务必须，但验收中可对 Main 暴露 IPC 供后续使用。

### 远程模式

- **不受影响**；本 spec 仅定义本地模式下的 MindOS 根目录解析。

### 打包与 electron-builder（与当前仓库对齐）

- 现状 [`desktop/electron-builder.yml`](../../desktop/electron-builder.yml)：`asar: true`，且注释说明当前**无需** asarUnpack。引入 BundledRuntime 后若包含**大量小文件、原生模块或可执行文件**，需重新评估 **`asarUnpack` 白名单**（或整包 `extraResources`），保证 `spawn` 的 `cwd`、动态 `require` 与文件锁在目标平台上可用。
- **跨平台**：`mcp` 若含平台相关依赖，内置树应为**分平台构建产物**（与现有 mac/win/linux 矩阵一致），不得在 Windows 包中嵌入仅 macOS 的 native 模块。

## 影响范围

### 变更文件列表（预期）

- `desktop/`：`main.ts`（`startLocalMode`、可选 `handleRestartServices`）、或抽离的 `mindos-runtime-resolve.ts`、`process-manager.ts`（通常仅消费 `projectRoot`，除非 standalone 启动约定变化）、electron-builder 配置、打包资源目录说明。
- `desktop/src/node-detect.ts`：可能与「解析顺序」整合或保持分工（Node vs MindOS 根）。
- 根仓库或 CI：**构建内置 artifact** 的步骤（例如在发布 Desktop 前从固定 tag 构建 MindOS 并拷贝到 `desktop/resources/`）。
- 文档：`wiki/specs/spec-electron-desktop-app.md` 本地模式章节增加指向本 spec 的链接；`README` / Desktop 发布说明补充体积与策略说明。

### 受影响模块

- **ProcessManager**：cwd、spawn 参数需来自「解析后的根目录」。
- **自动更新**：Desktop 更新可更新 Vb；全局 Vu 仍可能在新版 Desktop 发布后更高——`prefer-newer` 继续成立。
- **connect-window / 模式选择**：内置 MindOS **不消除** Node 依赖；若用户机器无任何可用 Node 且未安装私有 Node，现有「安装 Node / 远程」流程仍适用。实现私有 Node 自动下载后，文案上应区分「安装 MindOS 包」与「安装 Node」。对齐 [spec-onboard-startup-reliability.md](./spec-onboard-startup-reliability.md) 时勿混淆二者。

### 破坏性变更

- 默认策略从「几乎总用全局或现装」变为「可能与内置择优」：**对外行为**仍是启动本地 MindOS，但**实际代码路径**可能变化；需在 changelog 说明。
- 安装包体积显著增加：**非** API 破坏性，属发布与用户预期层面的变更。

## 边界 case 与风险

| # | 边界 case | 处理 |
|---|-----------|------|
| 1 | 内置目录损坏或缺失（安装不完整） | 回退 UserRuntime；若两者皆无则现有错误路径 + 引导重装 Desktop |
| 2 | 全局包存在但 **`app/.next` 目录**不存在（与 `startLocalMode` 判定一致）或 Web 实际不可启动 | 视为 UserRuntime **不可用**，不参与 Vu 择优；`prefer-newer` 应回退 Bundled；可选触发「为用户 build」仅当策略允许且非 bundled-only |
| 3 | `Vu === Vb` 或无法比较（非 semver） | 优先 UserRuntime 或优先 Bundled 需固定规则（建议：**相等时优先 User**，减少内置与用户文件不一致；非法版本号跳过该候选） |
| 4 | 用户显式配置 `mindosRuntimeRoot` 指向无效路径 | 启动失败时清晰错误；不静默回退除非配置 `fallbackToBundled=true` |
| 5 | 并发两次启动 / 快速切换模式 | 解析无共享可变全局状态；以单次启动会话为准 |
| 6 | Windows 路径、asar、只读介质 | Bundled 路径必须在 `asarUnpack` / `extraResources` 等机制中可执行；单元测试覆盖路径拼接 |
| 7 | `mindosRuntimeRoot` 指向非 MindOS 根目录（无 `app/` 或 `mcp/`） | 启动前校验目录结构，错误信息列出 ProcessManager 期望的路径 |
| 8 | 仅 `Vu > Vb` 但 User 缺 **`app/.next`**（或 build 不完整），Bundled 完整 | `prefer-newer` 应回退 **Bundled**，而非卡在「选了 User 但起不来」；日志标明 skip 原因 |
| 10 | **`mindos.pid` 存活（CLI 已启动）** | Desktop **连接现有端口**，不 spawn、不应用本 spec 的 projectRoot；与「当前页面对应哪一版 MindOS」一致性问题见上文 **与当前实现对照** |
| 9 | 恶意或不可信 `mindosRuntimeRoot` | 文档与高级设置中警示仅使用可信路径；不执行包内任意脚本超出既有 spawn 范围（范围由安全 review 定义） |

**风险与 mitigation**

- **新全局版与旧 Desktop 壳不兼容**：通过 `maxTestedMindOsVersion` 监控 + 遥测/工单；失败回退 Bundled 并提示升级 Desktop。
- **包体过大导致下载失败率上升**：分渠道包（完整版 vs 轻量版仅内置）可作为后续 spec。
- **合规与许可证**：内置产物与主项目同源分发，保持 LICENSE 一致；第三方依赖清单随构建锁定。
- **macOS Gatekeeper / 公证**：内置可执行文件若被标记隔离属性，需纳入 Desktop 发布 checklist（与现有 `identity: '-'` 说明共存，随签名策略演进更新）。

## 发布与版本（npm 与 Desktop 对齐）

与团队约定一致：**减少「npm 一版、Desktop 又一版」的割裂感**，同时保留壳与 Web 不同的迭代节奏。

### 版本叙事

| 概念 | 含义 |
|------|------|
| **MindOS 产品版本** | `@geminilight/mindos` 的 **`package.json#version`**，与 git **`vX.Y.Z`** tag、npm 发布一致；用户问「MindOS 几版」指它。 |
| **Desktop 壳版本** | Electron 安装包版本（如 `desktop/package.json` / `app.getVersion()`）；负责壳、自动更新、平台打包。 |
| **内置 MindOS 版本 `Vb`** | BundledRuntime 根目录的 `package.json#version`，**须与某次已发布的 MindOS `vX.Y.Z` 同源构建**，禁止手拷未 tag 目录。 |

**关于页 / 诊断信息（建议）**：同时展示两行，例如 **MindOS 0.5.55**（内置或与当前运行根一致）与 **Desktop 1.3.0**，避免只显示壳版本导致与 npm 用户对不上号。

### 发布节奏

1. **主轴**：打 **`vX.Y.Z`** → publish npm（现有 `publish-npm` 流程）。  
2. **发 Desktop 安装包时**：内置产物从 **同一 `vX.Y.Z` 检出构建**；Release Notes 写清「内置 MindOS vX.Y.Z」。  
3. **日常**：允许 **只发 npm**（patch 频繁不必每次发 Desktop）；**一旦发 Desktop**，内置版本应对齐**本次要推给用户的 MindOS 版本**（通常为当时 `latest` 对应 tag）。  
4. **工程目标（建议）**：CI 在 npm 发布成功后 **触发或参数化 Desktop 构建**，传入 **`X.Y.Z`**，避免安装包内嵌版本与 npm 漂移；落地前可在发版 checklist 中人工核对。

### 与本文档其它条目的关系

- **`bundledMindOsVersion` / 择优**：`Vb` 即上述内置版本，与 npm 同 semver 可比。  
- **详细 GitHub workflow 与 `npm run release`**：见 [git-sync-workflow.md](../refs/git-sync-workflow.md#发版流程)。

## 待决问题（实现前收口）

1. **内置产物形态**：standalone-only 是否足以覆盖 `mcp` 的 tsx 依赖（是否 copy mcp `node_modules` 子集）；若否，首版最小文件清单需列清。
2. **版本元数据存放**：`minMindOsVersion` / `maxTestedMindOsVersion` 写入 `desktop/package.json`、`app.config` 常量还是构建时 `define`；需单一真相源。
3. **用户从 `bundled-only` 切回 `prefer-newer`**：仅改 config 即可，无需清缓存（与「不持久化择优结果」一致）；是否在 UI 提示「下次启动生效」。

## 实现进度（代码）

| 状态 | 项 |
|------|-----|
| 已完成 | `pickMindOsRuntime`（纯函数）、`analyzeMindOsLayout`、`getDefaultBundledMindOsDirectory`（打包路径 `resources/mindos-runtime`；开发用 `MINDOS_DEV_BUNDLED_ROOT`）、`resolveLocalMindOsProjectRoot`、`startLocalMode` 接入；`config`：`mindosRuntimePolicy`、`mindosRuntimeRoot`、`MINDOS_RUNTIME_ROOT`、`mindosRuntimeStrictCompat`、`minMindOsVersion`、`maxTestedMindOsVersion`；Main 日志 `[MindOS] runtime pick …` |
| 已完成 | Desktop `npm test`：`mindos-runtime-pick` + `mindos-runtime-layout` 单测（`semver` 择优与布局探测） |
| 进行中 | `electron-builder` 已配置 `extraResources` → `mindos-runtime`；`desktop/scripts/prepare-mindos-runtime.mjs` + `npm run prepare-mindos-runtime` / `dist:with-bundled`；详见 `desktop/resources/mindos-runtime/README.md` |
| 未做 | CI 在发版流程中自动执行 prepare + 三平台安装包冒烟、关于页双版本、托盘重启重新 resolve |

## 验收标准

- [ ] 在无全局 `@geminilight/mindos`、且**未**触发 `installMindosWithPrivateNode`（或等价：用户目录无可用全局包）的前提下，本地模式能仅依赖 **BundledRuntime** 完成 **`/api/health`** 与主窗口加载（**且**非 `mindos.pid` 撞车 CLI 场景，或该场景在验收环境中已关闭）。
- [ ] 安装全局 `@geminilight/mindos` 且版本 **高于** 内置版本、且构建完整时，默认策略下启动使用的是 **UserRuntime**（日志或调试接口可证）。
- [x] 全局版本 **低于** `minMindOsVersion` 时，不采用该 UserRuntime，启动使用 Bundled 或明确错误提示（与实现约定一致）。（逻辑在 `pickMindOsRuntime` + 单测；E2E 待内置与用户包组合环境）
- [x] `mindosRuntimePolicy=bundled-only` 时，即使全局版本更高也 **不**使用 UserRuntime。
- [x] `mindosRuntimePolicy=user-only` 且无可用 UserRuntime（无全局包或路径无效）时，**失败并提示**，不静默使用 Bundled。
- [x] `mindosRuntimeRoot` / `MINDOS_RUNTIME_ROOT` 指向有效可运行根时**优先于** bundled/user（`resolveLocalMindOsProjectRoot`）；无效路径明确报错。
- [x] 内置与用户路径切换**不需要**用户手动删 `config.json`；重启后策略自动重新评估。
- [ ] electron-builder 产物在 **macOS / Windows / Linux** 至少各一平台冒烟：本地模式启动成功（平台矩阵可在 CI 中分阶段）。
- [x] `wiki/specs/spec-electron-desktop-app.md` 已增加对本 spec 的交叉引用。
- [x] 新增或更新自动化测试：**semver 择优逻辑**与「路径不可用回退」可在 Node 层单测覆盖（不强制启动 Electron）。
- [ ] （可选）托盘「重启服务」在用户升级全局包后：要么文档明确「需重启 Desktop / 切换模式」，要么实现**重新 resolve** `projectRoot` 并验收通过。

---

## 附录：与产品讨论的一致性

- **「内置固定版本 + 无安装也能开」** → 对应 **BundledRuntime** 与首条验收。
- **「npm 更高则回到更高版本 build」** → 对应 **prefer-newer** 与第二条验收；**合理**，前提是兼容与回退策略如上所述，避免裸比较版本导致不可启动。
