# Template Generation Skill

用于在 `templates/` 下持续生成与重构中英文模板（`zh/`、`en/`）的执行技能。

## 1. 目标

- 快速搭建可初始化的模板骨架。
- 保持中英文模板语义一致、结构同构。
- 降低规则漂移与文档返工成本。

## 2. 触发条件

- 新增或重构模板目录/文件。
- 处理中英文模板对齐。
- 新增示例数据与示例文件。
- 修复模板规则冲突（`INSTRUCTION.md` vs `README.md`）。
- 更新配置协议（`CONFIG.json` / `CONFIG.md`）。

## 3. 全局约束（必须）

- 规则优先级：`根 INSTRUCTION.md` > `子目录 INSTRUCTION.md` > `README.md` > 内容文件。
- `README.md` 只做导航与使用说明，不定义规则优先级与执行边界。
- 中英文模板保持语义一致，文风可以不同。
- 结构改动必须同步到 `templates/zh` 与 `templates/en`。
- 一级目录结构变更后，必须同步检查根 `README.md`、`SETUP.md` 及相关目录 `README.md` 的路径示例是否有效。
- 一级目录应默认同时提供 `README.md` 与轻量 `INSTRUCTION.md`。
- 二级目录至少提供 `README.md`；仅在出现可复用局部规则时再新增 `INSTRUCTION.md`。

## 4. 命名策略（当前）

- 仅一级目录加 emoji 前缀（如 `👤 Profile/`、`🔗 关系/`）。
- 二级及更深目录不加 emoji（保持路径稳定与可读）。
- 非系统文件默认使用 emoji 前缀命名。
- 命名语言跟随 `languagePreference.folderNamingLanguage`：中文模板默认中文，英文模板默认英文。
- 中文模板中的示例文件名在 `🧪_example_` 前缀之后应使用中文命名。

### 4.1 系统文件白名单（不强制 emoji）

- `README.md`
- `INSTRUCTION.md`
- `TODO.md`
- `CHANGELOG.md`
- `CONFIG.json`
- `CONFIG.md`

## 5. 示例文件规则

- 示例文件命名：`🧪_example_xxx.md`。
- 示例索引命名：`🧪 ..._examples.csv`。
- 示例文件就近放在对应分类目录下，不集中到 `_examples/` 目录。
- 名称包含 `_example` 或 `_examples` 的内容一律视为示例数据。
- 示例 CSV 的 `MdPath` 必须指向真实存在的示例文件。
- 对于关系类目录，采用“根目录总览 CSV + 每人一个独立 MD”的模式。

## 6. CONFIG 协议

- `CONFIG.json` 与 `CONFIG.md` 必须同时读取。
- 两者互补，不分优先级。
- 目录命名与层级命名等语义协议优先沉淀在 `CONFIG.md`；`CONFIG.json` 保持结构化键值表达。

## 7. 配置设计约束

- 配置项尽量通用，不绑定具体业务子目录。
- 避免重复控制项（同一语义仅保留一个主键）。
- 语言配置至少包含：
  - `languagePreference.preferredLanguage`
  - `languagePreference.folderNamingLanguage`
  - `languagePreference.contentWritingLanguage`
  - `languagePreference.enforceLocalizedNaming`

## 8. 交付检查清单

- `templates/zh` 与 `templates/en` 是否同构。
- 一级目录是否带 emoji，二级目录是否不带 emoji。
- 一级目录 `README.md` 是否移除了“更新规则”类内容（已迁移至 `INSTRUCTION.md`）。
- 示例命名是否符合 `_example` / `_examples` 约束。
- 中文模板示例文件名是否满足“前缀后中文命名”约束。
- CSV 的 `MdPath` 是否与真实路径一致。
- 是否已执行一次全量字符串巡检（如 `rg`）清理旧目录名、旧路径与失效引用。
