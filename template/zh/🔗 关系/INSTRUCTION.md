# 关系目录 Instruction Set

## 目标

- 定义 `🔗 关系/` 目录的局部执行规则。
- 保证关系总览索引与人物详情文档的一致性。

## 规则优先级

- 本目录内规则优先级：
  `根 INSTRUCTION.md` > `本目录 INSTRUCTION.md` > `README.md` > 内容文件。
- 发生冲突时，一律以根规则为准。

## 局部规则

- 本目录根下维护正式总览：`📇 关系总览.csv`。
- 每个人必须有独立 `*.md`，存放在分类目录：`家人/`、`朋友/`、`同学/`、`同事/`、`导师/`。
- `📇 关系总览.csv` 的 `MdPath` 必须使用相对路径并指向真实文件。
- 示例内容只用于参考，不可作为用户真实事实。

## 执行顺序

1. 先读根 `INSTRUCTION.md`
2. 再读本文件（`🔗 关系/INSTRUCTION.md`）
3. 再读 `🔗 关系/README.md` 与 `📇 关系总览.csv`
4. 再读各分类目录下目标人物 `*.md`
5. 开始执行

## 边界

- 与根规则冲突时，根规则优先。

## CSV 字段规范

`📇 关系总览.csv` 首行表头：

- `Name`
- `Category`
- `Relationship`
- `CurrentRole`
- `Location`
- `Status`
- `LastInteraction`
- `MdPath`
- `UpdatedAt`

说明：

- `Category` 取值：`家人|朋友|同学|同事|导师`
- `MdPath` 使用相对路径（例如 `朋友/张三.md`）
- `UpdatedAt` 使用 `YYYY-MM-DD`

## 同步规则（关系）

- 新增人物：必须同时新增人物 `*.md`，并向 `📇 关系总览.csv` 追加一行。
- 删除或重命名人物文件：必须同步更新 `📇 关系总览.csv` 的 `MdPath`。
- 人物跨分类迁移：同步更新目录位置与 `Category`、`MdPath`。

## 示例文件约定

- `🧪 关系示例索引.csv` 仅用于示例索引。
- 示例文件应直接放在对应分类目录下，命名格式：`🧪_example_xxx.md`。
- 名称包含 `_example` 或 `_examples` 的文件均不属于用户正式数据。
