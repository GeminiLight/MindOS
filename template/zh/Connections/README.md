# Connections

用于维护可复用的人际关系信息，帮助 Agent 在沟通与协作中更贴合你的真实语境。

## 目录结构

- `Connections.csv`（正式总览索引）
- `Connections_examples.csv`（示例索引）
- `Family/`
- `Friends/`
- `Classmates/`
- `Colleagues/`
- `Mentors/`
- `_examples/`（示例人物详情）

每个正式子目录中，每个人一份 `*.md` 详情文件。

## 使用说明

- 正式数据：先看 `Connections.csv`，再根据 `MdPath` 读取对应人物 `*.md`。
- 示例数据：参考 `Connections_examples.csv` 与 `_examples/`，不要当作用户真实信息。
- 新增人物时，同时维护：`Connections.csv` + 人物 `*.md`。
- 字段规范与执行细则以 `INSTRUCTION.md` 为准。
