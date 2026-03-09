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

## 同步规则（Projects）

- 新增产品项目：在 `Products/` 下创建项目目录，并维护标准文档。
- 新增科研项目：在 `Research/` 下创建项目目录。
- 重命名/删除/移动项目后：同步更新 `Projects/README.md` 与所有路径引用。
