# Spec: Desktop Healing 异步化 — 校验与端口清理并行

## 目标

在 dirty start 下，让 Node.js 校验和 build cache 校验与端口检查/清理/等待并行执行，减少 healing 总耗时。

## 现状分析

当前 healing 内部是严格串行的：
```
daemon cleanup → orphan kill → 500ms pause → port check → port kill → port wait → validate node → validate cache
```

其中 validatePrivateNode 和 validateBuildCache 完全不依赖端口清理的结果（它们操作 `~/.mindos/node/` 和 `.next/` 目录，与端口和进程无关）。但因为写在 port wait 后面，它们必须等端口释放完才开始。

在 dirty start 下，port wait 最多等 5 秒。这 5 秒里 Node 校验和 build cache 校验本可以已经完成了。

## 方案

把 healing 的步骤 3-6（端口相关）和步骤 7-8（校验相关）用 `Promise.all` 并行执行：

```
daemon cleanup → orphan kill → 500ms pause →
  Promise.all([
    端口检查 → 端口 kill → 端口等待释放,
    validate node + validate cache
  ])
```

依赖关系分析：
- 端口链路必须串行（先查 → 再 kill → 再等释放）
- 校验链路内部可以串行（node → cache，都很快）
- 两条链路之间无依赖

## 影响范围

- 变更文件：`desktop/src/main.ts`（仅 `healPreviousInstallation` 函数内部）
- 不受影响：所有其他模块
- 破坏性变更：无

## 边界 case 与风险

1. **clean start（快速跳过）**：不受影响，依然在函数开头 return
2. **validate 和 port 操作同一文件系统**：不会——validate 操作 `.mindos/node/` 和 `.next/`，port 操作网络
3. **splash 状态更新顺序**：并行后 "Freeing ports..." 和 "Validating runtime..." 可能交叉——改为在并行开始前统一设置一次状态

## 验收标准

- [ ] desktop typecheck 通过
- [ ] desktop 全量测试通过
- [ ] dirty start 下 healing 的 validate 阶段不再等待 port release
- [ ] clean start 行为不受影响
- [ ] splash 状态文案不出现闪动
