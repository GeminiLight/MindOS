# Webhook — 文件变更事件推送插件

> 文件变更时触发 webhook，连接外部自动化平台。

## 基本信息

| 字段 | 值 |
|------|---|
| ID | `webhook` |
| 类型 | 集成（Integration） |
| 来源 | 内置 |
| 依赖 | 无额外依赖 |
| 状态 | 计划中 |

## 解决什么问题

用户希望知识库的变更能触发外部工作流：
- 新笔记 → 自动发 Slack 通知
- TODO 完成 → 更新 Jira 状态
- 日记写完 → 触发 AI 生成周报
- 文件变更 → 同步到 Notion/Google Docs

Webhook 是最通用的集成方式，连接 Zapier / n8n / Make 等自动化平台。

## 功能

- 配置 webhook URL + 触发事件类型
- 支持多个 webhook（不同事件发到不同 URL）
- 事件类型：
  - `file.created` — 新文件创建
  - `file.updated` — 文件内容修改
  - `file.deleted` — 文件删除
  - `file.moved` — 文件移动/重命名
  - `organize.completed` — AI 整理完成
  - `inbox.received` — 暂存台收到新文件
- Payload 包含：事件类型、文件路径、时间戳、变更摘要
- 重试机制：失败后 1min / 5min / 30min 重试三次
- 签名验证：HMAC-SHA256 签名防止伪造

## Payload 格式

```json
{
  "event": "file.created",
  "timestamp": "2026-04-12T14:30:00Z",
  "file": {
    "path": "Projects/new-feature.md",
    "name": "new-feature.md",
    "size": 1234
  },
  "signature": "sha256=..."
}
```

## 配置

```json
{
  "webhooks": [
    {
      "url": "https://hooks.zapier.com/xxx",
      "events": ["file.created", "organize.completed"],
      "secret": "your-webhook-secret"
    }
  ]
}
```

## 实施要点

- 在现有的 `mindos:files-changed` 事件基础上扩展
- 异步发送，不阻塞文件操作
- Settings 面板提供 webhook 管理 UI（添加/删除/测试）
- 测试按钮：发送 ping 事件验证 URL 可达
