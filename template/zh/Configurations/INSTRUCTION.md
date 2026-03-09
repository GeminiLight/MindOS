# 目录 Instruction Set

## 目标

- 定义该一级目录的局部执行规则。

## 局部规则

- 先读取根 `INSTRUCTION.md`。
- 再读取本目录 `README.md` 进行导航。
- 修改保持最小化、结构化、可追踪。

## 执行顺序

1. 根 `INSTRUCTION.md`
2. 本目录 `INSTRUCTION.md`
3. 本目录 `README.md` 与目标文件

## 边界

- 与根规则冲突时，根规则优先。

## 同步规则（Configurations）

- 新增文件时：放入正确子目录（`Apps/`、`Agents/`、`Tools/`、`Orgs/`），并同步更新 `Configurations/README.md` 目录树。
- 重命名/删除时：同步更新所有引用该路径的内容。
- 新增踩坑记录时：紧跟对应步骤补充简要问题表。
