# Config Panel

> 将 CONFIG.json 渲染为可编辑的设置面板。

## 基本信息

| 字段 | 值 |
|------|---|
| ID | `config-panel` |
| 图标 | 🧩 |
| Core | Yes（不可禁用） |
| 入口文件 | `CONFIG.json` |
| 匹配规则 | 扩展名 `.json` 且路径包含 `config.json`（大小写不敏感） |

## 文件格式

JSON 文件，支持 `uiSchema` 和 `keySpecs` 定义表单控件。

```json
{
  "uiSchema": {
    "sections": [
      {
        "id": "general",
        "title": "General Settings",
        "fields": ["app.name", "app.theme"]
      }
    ]
  },
  "keySpecs": {
    "app.name": {
      "control": "text",
      "label": "Application Name"
    },
    "app.theme": {
      "control": "switch",
      "label": "Dark Mode"
    },
    "app.maxItems": {
      "control": "number",
      "label": "Max Items",
      "min": 1,
      "max": 100
    },
    "app.tags": {
      "control": "tag-list",
      "label": "Tags"
    }
  },
  "app": {
    "name": "My Knowledge Base",
    "theme": true,
    "maxItems": 50,
    "tags": ["personal", "work"]
  }
}
```

### 控件类型

| control | 说明 | 参数 |
|---------|------|------|
| `text` | 文本输入 | — |
| `number` | 数字输入 | `min`, `max` |
| `switch` | 开关 | — |
| `tag-list` | 标签列表 | — |

### 结构说明

- **`uiSchema.sections`**：定义面板分组及包含的字段
- **`keySpecs`**：每个字段的控件类型、标签、约束
- **其余 key**：实际配置数据（点号分隔路径如 `app.name` 对应 `{app: {name: ...}}`）

## 交互功能

- 📝 表单控件直接编辑配置值
- 💾 修改自动保存回 JSON 文件
- 📋 分组面板，按 section 组织
- ✅ 实时校验（数值范围等）

## 适用场景

- 知识库级别的配置管理
- 用户自定义 workflow 参数
- 需要非技术用户友好编辑的 JSON 配置
