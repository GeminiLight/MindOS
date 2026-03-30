# Spec: Desktop 内置运行时 Next standalone 与精简拷贝

## 目标

将 MindOS Desktop 打包进 `mindos-runtime` 时，使用 Next.js **`output: 'standalone'`** 产出的最小服务端依赖，并在 prepare 阶段**不再整棵拷贝 `app/node_modules`**，显著缩小安装包体积，同时保持 `ProcessManager` 优先 `app/.next/standalone/server.js` 的启动路径可用。

## 现状分析

- `app/next.config.ts` 未开启 `standalone`，`prepare-mindos-runtime.mjs` 对 `app/` 做整目录拷贝，把开发态完整 `node_modules`（含 vite、typescript 等）打入包内，体积常达 1GB+。
- `desktop/src/process-manager.ts` 已优先 `node/.next/standalone/server.js` + `cwd=appDir`，与 standalone 部署模型一致，缺的是构建产物形态与 prepare 拷贝策略。

## 数据流 / 状态流

```
monorepo 根 npm run build
  → app/next build（standalone: true）
  → 生成 app/.next/standalone（含 traced node_modules）+ app/.next/static + app/public

prepare-mindos-runtime.mjs（打包前）
  → 读 source repo（MINDOS_BUNDLE_SOURCE 或上级目录）
  → materializeStandaloneAssets(appDir)：把 .next/static、public 同步进 standalone 目录（Next 官方部署要求）
  → 拷贝 app/ 到 resources/mindos-runtime/app/，排除 node_modules、.next/cache
  → 照常拷贝 package.json、LICENSE、mcp/、scripts/

electron-builder extraResources
  → 用户安装包内 mindos-runtime 体积下降

本地模式 ProcessManager
  → 若存在 app/.next/standalone/server.js → node 执行该文件（不变）
  → 否则回退 next start / npx（全局或用户目录安装场景）
```

## 方案

1. **`app/next.config.ts`**：增加 `output: 'standalone'`，保留现有 `outputFileTracingRoot`、`serverExternalPackages`。
2. **`desktop/scripts/prepare-mindos-bundle.mjs`**（新建）：导出纯函数  
   - `materializeStandaloneAssets(appDir)`：校验 `app/.next/standalone/server.js`；将 `app/.next/static` → `standalone/.next/static`，`app/public` → `standalone/public`（存在才拷贝，目录先 `rmSync` 再 `cpSync` 避免脏残留）。  
   - `copyAppForBundledRuntime(sourceAppDir, destAppDir)`：递归拷贝，**跳过** `node_modules`、`.next/cache`、**`.next/dev`**（Turbopack/开发缓存，可达数百 MB，生产启动不需要）。
3. **`prepare-mindos-runtime.mjs`**：在拷贝前对 **source** 的 `app` 调用 `materializeStandaloneAssets`；用 `copyAppForBundledRuntime` 替代 `copyTree('app')`。若缺少 standalone `server.js`，**失败并提示**需先 `npm run build`。
4. **文档**：`desktop/resources/mindos-runtime/README.md` 与 `spec-desktop-bundled-mindos.md` 交叉引用本 spec；npm 包 `files` 已排除 `app/.next`，不受影响。

## 影响范围

- **变更文件**：`app/next.config.ts`、`desktop/scripts/prepare-mindos-runtime.mjs`、新建 `desktop/scripts/prepare-mindos-bundle.mjs`、`desktop/src/prepare-mindos-bundle.test.ts`、`wiki/specs/spec-desktop-standalone-runtime.md`、`wiki/specs/spec-desktop-bundled-mindos.md`（补充一节）、`wiki/85-backlog.md`（可选勾选/条目）、`wiki/80-known-pitfalls.md`（若发现共性坑）。
- **不受影响**：`ProcessManager` 启动顺序；全局 `mindos` 安装仍可用完整 `app` + `next start`；MCP 拷贝策略本次不改（后续可另 spec 做 `mcp` 生产依赖裁剪）。
- **破坏性**：对 **仅含 `.next` 而无 standalone 的旧构建树**，prepare 将**显式失败**（需重新 `npm run build`）。符合「桌面内置必须来自当前版本构建」预期。

## 边界 case 与风险

| 边界 / 风险 | 处理 |
|-------------|------|
| 无 `app/.next/standalone/server.js` | prepare 报错退出，提示开启 standalone 并重新 build |
| 无 `app/.next/static`（极少见） | 跳过 static 同步；若运行缺资源再排查 |
| 无 `app/public` | 跳过 public 同步 |
| `materialize` 在 **source** 上写 standalone | 会修改开发者工作区 `app/.next/standalone`；为幂等可接受；CI 应在干净 build 后跑 prepare |
| `serverExternalPackages` trace 遗漏 | 运行时 `MODULE_NOT_FOUND`；回退为补 `outputFileTracing` 或调整 external |
| 交叉架构构建 | Next native 依赖需在与目标一致的环境 build；与现状一致，不单列新坑 |
| **MCP 打包体积** | 整棵拷贝 `mcp/node_modules` 含 dev 依赖；prepare 后对目标 `mcp/` 执行 `npm ci --omit=dev`（需网络）；`tsx` 已改为 **dependencies**（运行 `src/index.ts` 必需，不可被 omit） |
| **Next 监听地址** | 部分环境下 Next 默认绑定 **机器 hostname**，`127.0.0.1` 健康检查超时；Desktop / CLI 在未设置 `HOSTNAME` 时默认 `127.0.0.1` |

**Mitigation**：

- 仓库根 `npm run verify:standalone`：`materialize` + 起 `standalone/server.js` + `GET /api/health`（`scripts/verify-standalone.mjs`）；`scripts/release.sh` 在 `next build` 后自动执行。
- Desktop `vitest` 覆盖 `materialize` / `copyApp`；prepare 可选 `SKIP_MCP_NPM_CI=1` 跳过 mcp 的 `npm ci`（离线场景）。

## 验收标准

- [ ] `app/next.config.ts` 含 `output: 'standalone'`。
- [ ] `npm run build`（仓库根）成功，且存在 `app/.next/standalone/server.js`。
- [ ] `prepare-mindos-runtime.mjs` 成功后，`resources/mindos-runtime/app/node_modules` **不存在**（或仅 standalone 内嵌套 node_modules，不在 app 根）。
- [ ] `resources/mindos-runtime/app/.next/standalone/.next/static` 与 `.../public` 在 build 后存在（与 Next 要求一致）。
- [ ] `cd desktop && npm test` 全部通过（含新建单测）。
- [ ] 根目录 `cd app && npx vitest run` 通过（Next 配置不破坏现有测试）。
- [ ] 根目录 `npm run verify:standalone` 在 `next build` 之后通过。
