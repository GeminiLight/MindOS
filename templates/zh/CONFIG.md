# CONFIG 说明

本文件用于解释模板配置，供人类快速阅读。

## 范围

- 语言范围：`templates/zh/`。
- 对应机器可读文件：`templates/zh/CONFIG.json`。

## 读取规则

- `CONFIG.json` 与 `CONFIG.md` 需要同时读取。
- 二者是互补关系，不设优先级。
- JSON 提供结构化配置值，MD 提供语义说明与使用意图。

## 当前关键配置

### `languagePreference`

- `preferredLanguage`: 总体语言偏好
- `supportedLanguages`: 可选语言列表（中文、英文）
- `folderNamingLanguage`: 目录与文件命名语言
- `contentWritingLanguage`: 内容写作语言
- `enforceLocalizedNaming`: 是否强制本地化命名（中文模板默认中文命名）

### `filename`

- `emojiPrefixDefault`: 新文件名是否默认使用 emoji 前缀
- `allowEmojiPrefix`: 是否允许文件名使用 emoji 前缀
- `exampleSuffixSingle`: 单个示例文件后缀（默认 `_example`）
- `exampleSuffixCollection`: 示例集合目录后缀（默认 `_examples`）

### `structure`

- `requireFirstLevelReadme`: 一级目录是否必须有 `README.md`
- `recommendFirstLevelInstruction`: 是否建议一级目录提供 `INSTRUCTION.md`

### `document.title`

- `emojiEnabled`: 生成标题是否默认允许 emoji
- `defaultHeadingLevel`: 生成标题默认层级（当前为 `2`）

### `protocol`

- `readMode`: 配置读取模式
- `priorityBetweenConfigAndDoc`: 配置值与文档说明关系（当前 `none`，不分优先级）
- `notes`: 配置协议说明

## 目录命名与层级规则（放在 CONFIG.md 的语义层）

以下规则作为目录命名语义协议，由 `CONFIG.md` 负责解释并约束执行：

- 一级目录（项目根目录的子目录）默认使用 `emoji + 名称`。
- 二级及以下目录默认不加 emoji。
- 目录命名语言由 `languagePreference.folderNamingLanguage` 决定。
- 内容文件是否使用 emoji 前缀由 `filename.*` 控制。

当前模板约定（zh）：

- 一级目录示例：`👤 画像/`、`📝 笔记/`、`🔗 关系/`、`🔄 流程/`、`📚 资源/`、`🚀 项目/`
- 二级目录示例：`家人/`、`朋友/`、`同学/`、`同事/`（不加 emoji）

当目录命名策略有调整时：

- 先更新 `CONFIG.md` 的语义规则。
- 再同步更新 `README.md`、`INSTRUCTION.md` 与实际目录结构。
