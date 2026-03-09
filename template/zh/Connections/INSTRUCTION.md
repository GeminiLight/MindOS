# Connections 使用说明

本目录用于沉淀可复用的人际关系上下文，供 Agent 在沟通、协作和任务推进时调用。

## 规则优先级

- 本目录内规则优先级：
  `根 INSTRUCTION.md` > `本目录 INSTRUCTION.md` > `README.md` > 内容文件。
- 发生冲突时，一律以根规则为准。

## 执行顺序

1. 先读根 `INSTRUCTION.md`
2. 再读本文件（`Connections/INSTRUCTION.md`）
3. 再读 `Connections/README.md` 与 `Connections.csv`
4. 再读各分类目录下目标人物 `*.md`
5. 开始执行

## 存储结构（强制）

### 1) 根目录总览 CSV（必须）

在 `Connections/` 根目录维护同名总览文件：`Connections.csv`。

用途：
- 提供全量人脉索引（机器可快速检索）
- 记录分类、状态、最后更新时间、详情文档路径

### 2) 人物详情 MD（必须）

每个人必须有一个独立的 `*.md` 文件，存放在对应分类目录下：
- `Family/`
- `Friends/`
- `Classmates/`
- `Colleagues/`
- `Mentors/`

推荐命名：`姓名.md`（例如 `张三.md`）。

## CSV 字段规范

`Connections.csv` 首行表头建议固定为：

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
- `Category` 取值：`Family|Friends|Classmates|Colleagues|Mentors`
- `MdPath` 使用相对路径（例如 `Friends/张三.md`）
- `UpdatedAt` 使用 `YYYY-MM-DD`

## 人物 MD 最小结构

每个人物文件至少包含：

- `Name`
- `Relationship`
- `Current Role`
- `Location`
- `Communication Preference`
- `Last Interaction`
- `Next Action`
- `Notes`

## 一致性规则

- 新增人物时：必须同时新增 `*.md`，并向 `Connections.csv` 追加一行。
- 删除或重命名人物文件时：必须同步更新 `Connections.csv` 的 `MdPath`。
- 人物跨分类迁移时：同步更新目录位置与 `Category`、`MdPath`。

## 隐私规则

- 不记录密码、私钥、证件号、银行卡、敏感医疗信息等。
- 非必要不写高敏个人细节。
- 默认这些信息会被多个 Agent 读取，仅保留任务所需上下文。

## 维护规则

- 目录命名保持稳定，方便 Agent 稳定检索。
- 仅在有持续复用价值时新增分类。
- 文件重命名或移动后，需同步更新所有引用。

## 示例文件约定

- `Connections_examples.csv` 与 `_examples/` 仅用于示例演示。
- 名称包含 `_example` / `_examples` 的文件均不属于用户正式数据。
