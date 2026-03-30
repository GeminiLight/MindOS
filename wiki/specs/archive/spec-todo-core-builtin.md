# Spec: TODO 渲染器内建化（非插件面板）

## 目标
将 `TODO Board` 从“插件面板可管理项”升级为“MindOS 应用内建能力”，继续可用但不再出现在插件管理表层。

## 现状分析
当前 `todo` 渲染器虽已 `builtin + core`，但尚未标记为 `appBuiltinFeature`，因此仍被 `getPluginRenderers()` 视为插件，出现在插件面板与设置插件页。  
这与“CSV / Agent Inspector / Config Panel 已内建化”的产品表层语义不一致，也增加用户对“什么是插件、什么是内建能力”的认知成本。

## 数据流 / 状态流
现有读取链路：

```text
manifest(todo)
  -> registry.registerRenderer(todo)
  -> getPluginRenderers() / getAllRenderers()
     -> PluginsPanel / Settings PluginsTab / HomeContent
```

改造后链路：

```text
manifest(todo.appBuiltinFeature=true)
  -> getPluginRenderers() 自动过滤 todo
     -> 插件面板/设置页不显示 TODO
  -> getAllRenderers() 保留 todo
     -> HomeContent 的 Built-in capabilities 可继续显示/跳转 TODO.md
  -> resolveRenderer() 不变
     -> /view/TODO.md 继续使用 TodoRenderer
```

状态流说明：
- **读取状态**：`existingFiles` 决定 TODO 入口是否可点击（已存在 `TODO.md` 时可点击）
- **启用状态**：`core=true` 使 TODO 始终启用，不走可关闭开关
- **表层状态**：`appBuiltinFeature=true` 决定“隐藏于插件表层，保留在内建能力表层”

## 方案
1. **Manifest 升级**
   - 在 `app/components/renderers/todo/manifest.ts` 增加 `appBuiltinFeature: true`。
   - 保持 `builtin: true`、`core: true`、`entryPath: 'TODO.md'` 不变。

2. **测试先行（红灯）**
   - 更新/补充 renderer surface 分类测试：TODO 应归类为 app builtin feature。
   - 补充 registry 过滤测试：`getPluginRenderers()` 不应返回 TODO。
   - 补充首页行为测试（若现有测试可覆盖）：TODO 应出现在 built-in 区，不在 extensions 区。

3. **实现与一致性迁移**
   - 依赖已有 `getPluginRenderers()` 过滤机制，不新增并行分支逻辑。
   - 扫描并更新文档中“TODO 属于插件”的表述，统一为“应用内建能力”。

4. **文档与 backlog 同步**
   - 更新 `wiki/60-stage-plugins.md`、`wiki/plugins/README.md`（如涉及 TODO 列表）。
   - 在 `wiki/85-backlog.md` 打勾对应条目（若新增任务项则记录完成状态）。

5. **架构评审结论（software-architecture 原则）**
   - **Library-First**：无需新增依赖；复用既有 `registry` 与 `getPluginRenderers()`，避免重复实现过滤器。
   - **Clean Architecture**：仅变更 renderer 元数据与展示层分类，不把业务逻辑耦合进 UI。
   - **命名**：沿用领域命名 `appBuiltinFeature`，不引入 `utils/helpers/common` 类泛化命名。
   - **复杂度预判**：单函数保持短小；新增测试文件可控；不引入 >200 行新文件。

## 影响范围
- 变更文件（预期）
  - `app/components/renderers/todo/manifest.ts`
  - `app/__tests__/renderers/renderer-surface-classification.test.ts`
  - `app/__tests__/renderers/*`（可能新增过滤测试）
  - `wiki/60-stage-plugins.md`
  - `wiki/plugins/README.md`（如 TODO 列表发生变化）
  - `wiki/85-backlog.md`（任务完成打勾）
- 受影响模块
  - 插件表层（PluginsPanel / Settings PluginsTab）展示数量变化
  - 首页 Built-in capabilities 可能新增 TODO chip
  - 文件渲染能力本身不变（`/view/TODO.md`）
- 破坏性变更
  - 无 API 破坏；属于 UI 信息架构调整

## 边界 case 与风险
1. **无 `TODO.md` 文件**
   - 处理：TODO 在 built-in 区显示为 inactive 提示，不应在插件面板出现。
2. **用户误以为 TODO 被移除**
   - 处理：在 built-in 区保持可见（active/inactive），并在文档更新“非插件面板管理”说明。
3. **插件列表数量变为 0**
   - 处理：保持空状态文案，不应出现渲染异常或 hydration 错误。
4. **旧测试断言 TODO 属于插件**
   - 处理：先红灯，再更新断言与覆盖范围，避免伪通过。
5. **后续再迁移类似插件导致语义漂移**
   - 处理：复用 `plugin-core-builtin-migration` skill checklist，统一三元语义：`builtin/core/appBuiltinFeature`。

## 验收标准
- [ ] `todo` manifest 含 `appBuiltinFeature: true`，并保持 `builtin=true/core=true`
- [ ] `getPluginRenderers()` 结果不包含 `todo`
- [ ] `/view/TODO.md` 仍由 TODO renderer 正常渲染（回归通过）
- [ ] PluginsPanel 与 Settings 插件页不再显示 TODO
- [ ] 首页 built-in capabilities 正确反映 TODO（有文件可跳转，无文件为 inactive）
- [ ] 相关测试覆盖正常路径/边界路径/错误路径且通过
- [ ] `wiki/60-stage-plugins.md` 与 `wiki/plugins/README.md` 描述与实现一致

