# 专业度审计 — 全部结果

> 2026-04-02~04 两轮深度审计。所有可修项已完成，剩余均为长期改善或误报。

## P0 阻塞级 — 已清零

- [x] `_standalone/` prepack 安全性 — prepack 开头加 `rm -rf _standalone`
- [x] `pi-coding-agent` 依赖 — 误报，是核心运行时依赖，已更新 wiki

## P1 — 已清零（经验证全部降级或移除）

- [x] ~~Open Graph 标签~~ — 误报。本地应用不需要
- [x] `createFile()` TOCTOU — 已修复。`flag: 'wx'` 原子创建
- [x] ~~SearchPanel ARIA~~ — 降为 P3，键盘导航已有

## P2 中等 — 已清零

- [x] `createFile()` TOCTOU 竞态 — 已修复。`fs.writeFileSync(path, content, { flag: 'wx' })`
- [x] ~~muted-foreground 对比度~~ — **误报**。实测 5.81:1，已达 WCAG AA 4.5:1
- [x] ~~config.json 损坏静默忽略~~ — **误报**。loadConfig() 已有 `console.error` 警告
- [x] ~~`extend` 包~~ — 不是问题。gaxios/unified 间接依赖的 hoist
- [x] mcp tsx devDependency — 已修复。从 dependencies 移到 devDependencies
- [x] ~~FileTree ARIA~~ — 保留为长期改善项，不阻塞

## P3 低优先 — 长期改善

- [x] ~~robots.txt / sitemap~~ — 不需要，本地应用
- [ ] Settings 多标签页竞态 — 低频，暂不处理
- [ ] MCP 缺分页 — 等大知识库用户反馈
- [ ] appendFileSync 无锁 — 多 Agent 并发极罕见
- [ ] SearchPanel ARIA listbox — 归入无障碍改善批次

## 已修复总计：14 项

| 批次 | 数量 | 内容 |
|------|------|------|
| 第一轮高优 | 4 | debug log、npm 元数据、CHANGELOG、端口文档 |
| 第一轮中优 | 6 | as any(-29)、输入校验、CI lint、CONTRIBUTING.md、JSDoc(26)、i18n 类型 |
| 第二轮 P0 | 2 | prepack 安全、wiki 更新 |
| 第二轮 P2 | 2 | createFile TOCTOU、tsx devDep |
