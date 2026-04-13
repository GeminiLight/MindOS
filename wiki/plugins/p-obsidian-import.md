# Obsidian Import — Obsidian Vault 迁移插件

> 将 Obsidian vault 无缝导入 MindOS，保留插件配置和数据兼容。

## 基本信息

| 字段 | 值 |
|------|---|
| ID | `obsidian-import` |
| 类型 | 转换器（Converter） |
| 来源 | 本地 Obsidian Vault 目录 |
| 依赖 | 无额外依赖 |
| 状态 | 部分完成（compat 层已实现） |

## 解决什么问题

MindOS 的目标用户很多是 Obsidian 迁移过来的。Obsidian vault 有自己的特殊格式：`[[WikiLink]]`、`![[embed]]`、frontmatter YAML、`.obsidian/` 配置目录、社区插件数据。需要平滑迁移而不丢失数据。

## 已完成

- Obsidian compat 最小宿主骨架（loader、plugin-manager、vault、metadata-cache）
- `/api/obsidian/compat-report` 兼容报告接口
- `POST /api/obsidian/import` 插件导入接口
- 社区插件 smoke fixtures（Style Settings / QuickAdd / Tag Wrangler / Homepage）
- 路径逃逸防护、async 生命周期、`.plugins/` 隔离

## 待完成

- [ ] 将 Setting / PluginSettingTab 接入真实宿主设置页面
- [ ] 将 Notice / Modal 接入真实宿主 UI 反馈系统
- [ ] 为真实第三方社区插件构建 smoke suite
- [ ] 补全 `resolvedLinks` / `unresolvedLinks` 全局索引语义

## 导入内容

| Obsidian 特性 | MindOS 处理 |
|--------------|------------|
| `[[WikiLink]]` | 保留，MindOS 原生支持 |
| `![[embed]]` | 转为 MindOS 内嵌引用 |
| frontmatter | 保留 YAML frontmatter |
| `.obsidian/` 配置 | 扫描并生成兼容报告 |
| 社区插件数据 | 通过 compat 层尝试加载 |
| Canvas `.canvas` | 转为 Excalidraw 或保留原始 JSON |
| Dataview 查询 | 标记为不兼容，建议手动迁移 |
