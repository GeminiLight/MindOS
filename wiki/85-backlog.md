# Backlog

> 初始化于 2026-04-11，用于补齐 CLAUDE.md 里约定的 backlog 追踪文件。

## Completed

- [x] Obsidian compat Spike 文档链路
  - 总体方案、API shim、兼容矩阵、生态调研、Spike 计划、Spike 实施规约
- [x] Obsidian compat 最小宿主骨架
  - loader、plugin-manager、compatibility-report、obsidian-import、vault、metadata-cache、plugin、ui、settings、obsidian export surface
- [x] Obsidian compat 迁移前哨能力
  - `/api/obsidian/compat-report` 兼容报告接口
  - `POST /api/obsidian/import` 插件导入接口
  - 社区插件 smoke fixtures（Style Settings / QuickAdd / Tag Wrangler / Homepage）
  - manager 扫描外部 vault 并导入选中插件
- [x] Obsidian compat 测试覆盖
  - manifest、loader、vault、component、plugin、command-registry、integration、plugin-manager、ui、compatibility-report、obsidian-import、community-smoke
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
- [x] Mobile Files Tab Feedback and Rename Reliability
  - Files tab 加载失败时显示可恢复 inline error banner
  - Android TextInputModal defaultValue 同步 fix
  - 新增 8 条 files-tab-state 测试
- [x] Mobile Chat Multi-Session Management
  - 多会话管理：新建/切换/删除/重命名
  - Session list drawer（iOS ActionSheet / Android Alert + TextInputModal rename）
  - 首次使用自动创建 session；旧数据迁移
  - 拆分 ChatHeader/ChatEmptyState/ChatStatusFooter/ScrollToBottomButton 子组件
  - stale closure fix + FlatList key 稳定化
  - 新增 13 条 chat-session-store 测试
- [x] Mobile Build Workflow
  - 新增 `.github/workflows/build-mobile.yml`
  - workflow_dispatch 支持 android / ios / all + development / preview / production
  - 构建前自动执行 mobile typecheck + test
  - 输出 EAS build metadata 到 Step Summary 和 artifact
  - iOS 构建复用现有 Apple secrets（App Store Connect API key / team id）作为 EAS 凭证修复输入
  - `mobile/app.json` 补齐 `expo.extra.eas.projectId`
  - `mobile/package.json` 新增 Android/iOS EAS 构建脚本
- [x] Feishu conversation SDK-first ingress refactor
  - 用 `@larksuiteoapi/node-sdk` 接管 challenge / 验签 / decrypt
  - 保留 MindOS 业务层：过滤、标准化、会话历史、Agent 编排
  - 新增 dispatcher 测试，收敛 API route 到 SDK wrapper
- [x] Feishu dual transport support
  - 支持 `webhook` / `long_connection` 两种 conversation transport
  - 新增长连接管理器与 `mindos feishu-ws` 本地验证入口
  - 渠道详情页支持 transport 切换并按模式展示字段
- [x] 内置 pi-subagents 扩展
  - 添加 `pi-subagents` 到 dependencies
  - 在 `additionalExtensionPaths` 注册扩展入口
  - 新增 7 条测试覆盖（安装、路径注册、导出结构）
- [x] Search 首搜预热与冷启动降迟
  - 新增 `/api/search/prewarm` 非阻塞预热入口
  - Search Panel 打开时后台预热 UI 搜索索引
  - 增加 warming / fallback 轻量状态文案与 i18n 文案
  - 补充 API 与 SearchPanel 纯函数测试覆盖
- [x] Search 预热体验一致性
  - SearchModal 与 SearchPanel 复用同一套预热状态机
  - SearchModal 补齐 warming / fallback 提示与本地化空状态文案
  - 增加 SearchModal prewarm / fallback / files-changed 回归测试

## Next

- [x] 设置页 Obsidian 插件迁移向导（Settings > Plugins > Import from Obsidian）
- [x] 跨模块 Bug 审计：安全漏洞（trash 路径遍历）、数据丢失（stream tool_end 静默丢弃）、竞态（Map 迭代中删除、TOCTOU）、闭包（modelOverride）、错误契约、ACP 诊断增强
- [x] 跨平台路径标准化：tree.ts toPosix 源头统一、split('/') 兼容 Windows、symlink fallback
- [x] 搜索性能优化：正则缓存、Set 比较、CSV 增量更新
- [x] 向量搜索正确性增强
  - 维度校验：query 与 index 维度不匹配时 graceful 降级
  - 语义匹配 snippet：读取文件内容提供有意义的预览（而非 `[semantic match]`）
  - 配置变更检测：model/provider 切换时自动 invalidate 索引
  - 下载按钮即时反馈：点击后 <200ms 显示 "Starting..."，支持错误状态与重试
  - 新增 20 条测试覆盖维度校验、snippet 提取、配置变更检测
- [ ] 将 Setting / PluginSettingTab 接入真实宿主设置页面
- [ ] 将 Notice / Modal 接入真实宿主 UI 反馈系统
- [ ] 为真实第三方社区插件构建 smoke suite
- [ ] 补全 `resolvedLinks` / `unresolvedLinks` 全局索引语义
