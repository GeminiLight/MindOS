# CONFIG 说明

本文件用于解释模板配置，供人类快速阅读。

## 范围

- 语言范围：`template/zh/`。
- 对应机器可读文件：`template/zh/CONFIG.json`。

## 读取规则

- `CONFIG.json` 与 `CONFIG.md` 需要同时读取。
- 二者是互补关系，不设优先级。
- JSON 提供结构化配置值，MD 提供语义说明与使用意图。

## 当前关键配置

### `filename`

- `emojiPrefixDefault`: 新文件名是否默认使用 emoji 前缀
- `allowEmojiPrefix`: 是否允许文件名使用 emoji 前缀
- `exampleSuffixSingle`: 单个示例文件后缀（默认 `_example`）
- `exampleSuffixCollection`: 示例集合目录后缀（默认 `_examples`）

### `structure`

- `requireFirstLevelReadme`: 一级目录是否必须有 `README.md`
- `recommendFirstLevelInstruction`: 是否建议一级目录提供 `INSTRUCTION.md`
- `syncEnAndZhStructure`: 是否要求中英文目录结构同构

### `document.title`

- `emojiEnabled`: 生成标题是否默认允许 emoji
- `defaultHeadingLevel`: 生成标题默认层级（当前为 `2`）

### `connections`

- `requireRootCsv`: `Connections/` 是否必须有根 CSV
- `rootCsvName`: 正式索引 CSV 文件名
- `examplesCsvName`: 示例索引 CSV 文件名
- `onePersonOneMarkdown`: 是否要求一人一份 Markdown

### `profile`

- `minimalFiles`: Profile 最小核心文件集

## 修改约定

1. 配置键变更时，同时更新 `template/en/CONFIG.json` 与 `template/zh/CONFIG.json`。
2. 中英文配置语义保持一致。
3. 配置键新增/删除/重命名后，同步更新两侧 `CONFIG.md`。
4. `CONFIG.md` 中的默认值不得与 JSON 冲突。
