# Raycast — 全局快速搜索插件

> Raycast 扩展，在任何应用中快速搜索和打开 MindOS 笔记。

## 基本信息

| 字段 | 值 |
|------|---|
| ID | `raycast` |
| 类型 | 集成（Integration） |
| 来源 | Raycast 扩展市场 |
| 依赖 | Raycast (macOS) + MindOS 本地服务 |
| 状态 | 计划中 |

## 解决什么问题

开发者在编码时想查一条笔记，需要：切换到浏览器 → 打开 MindOS → 搜索 → 找到笔记。Raycast 插件让这变成：`Cmd+Space` → 输入关键词 → 回车打开。省去窗口切换。

## 功能

- **快速搜索**：模糊匹配笔记标题和内容
- **预览**：选中结果后 Raycast 侧边栏显示 Markdown 预览
- **打开**：回车在 MindOS Web UI 中打开笔记
- **快速捕获**：`Cmd+Shift+N` 创建新笔记到暂存台
- **最近笔记**：显示最近编辑的 5 条笔记

## 架构

```
Raycast 扩展
    │
    ▼
GET /api/search?q=keyword
    │
    ▼
MindOS 搜索索引
    │
    ▼
返回结果 → Raycast 列表
    │
    ▼
选中 → 打开浏览器 http://localhost:PORT/view/...
```

## 实施要点

- 使用 Raycast Extensions API (React)
- 搜索调用 MindOS 已有的 `/api/search` 接口
- MindOS 未运行时优雅提示
- 可发布到 Raycast Store（增加曝光）
- 未来可扩展：Alfred workflow 版本（覆盖非 Raycast 用户）
