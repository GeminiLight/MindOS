# Backlog

> 初始化于 2026-04-11，用于补齐 CLAUDE.md 里约定的 backlog 追踪文件。

## Completed

- [x] Obsidian compat Spike 文档链路
  - 总体方案、API shim、兼容矩阵、生态调研、Spike 计划、Spike 实施规约
- [x] Obsidian compat 最小宿主骨架
  - loader、plugin-manager、vault、metadata-cache、plugin、ui、settings、obsidian export surface
- [x] Obsidian compat 测试覆盖
  - manifest、loader、vault、component、plugin、command-registry、integration、plugin-manager、ui
- [x] Obsidian compat 关键健壮性修复
  - 路径逃逸防护
  - async 生命周期等待
  - `.plugins/` 私有目录隔离
  - 损坏 `data.json` 明确报错
- [x] Mobile Quick Capture / Inbox MVP
  - Home 页快速记录卡片
  - 当日 `inbox/YYYY-MM-DD.md` 自动追加
  - 异步保存测试覆盖（正常/边界/错误路径）
  - Quick Capture 读失败明确报错，避免静默覆盖
- [x] Mobile Architecture Foundations
  - 抽取共享 file-tree domain（flattenFiles, findNode, sortFileNodes, formatRelativeTime）
  - 抽取共享 markdown-styles presentation module（document / bubble）
  - 消除 3 处重复 flattenFiles + 3 处重复 markdownStyles
  - 新增 10 条领域层测试覆盖
- [x] Feishu conversation SDK-first ingress refactor
  - 用 `@larksuiteoapi/node-sdk` 接管 challenge / 验签 / decrypt
  - 保留 MindOS 业务层：过滤、标准化、会话历史、Agent 编排
  - 新增 dispatcher 测试，收敛 API route 到 SDK wrapper
- [x] 内置 pi-subagents 扩展
  - 添加 `pi-subagents` 到 dependencies
  - 在 `additionalExtensionPaths` 注册扩展入口
  - 新增 7 条测试覆盖（安装、路径注册、导出结构）

## Next

- [ ] 将 Setting / PluginSettingTab 接入真实宿主设置页面
- [ ] 将 Notice / Modal 接入真实宿主 UI 反馈系统
- [ ] 为真实第三方社区插件构建 smoke suite
- [ ] 补全 `resolvedLinks` / `unresolvedLinks` 全局索引语义
