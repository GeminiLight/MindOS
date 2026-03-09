# template/

MindOS 知识库模板，用于初始化你自己的个人知识库。

## 快速开始

```bash
# 1. 选择一个预设复制到 my-mind/
cp -r template/zh my-mind/
# 或
# cp -r template/en my-mind/

# 2. 配置 MIND_ROOT（让 MCP 和 App 指向你的知识库）
echo "MIND_ROOT=$(pwd)/my-mind" >> app/.env.local

# 3. 开始填写内容，优先从 👤 画像（zh）或 👤 Profile（en）开始
```

## 目录说明

| 目录/文件 | 说明 | 建议第一步 |
|-----------|------|-----------|
| `README.md` | 知识库总索引，Agent 进入时首先读取 | 保留结构，按需修改 |
| `TODO.md` | 待办事项 | 直接开始使用 |
| `CHANGELOG.md` | 完成记录 | 直接开始使用 |
| `👤 画像/` 或 `👤 Profile/` | 个人身份、偏好、目标与当前状态 | **优先填写** |
| `📝 笔记/` 或 `📝 Notes/` | 快速记录与临时笔记，后续归档 | **优先使用** |
| `🔗 关系/` 或 `🔗 Connections/` | 人际关系上下文（家人/朋友/同学/同事/导师） | 按需补充 |
| `🔄 流程/` 或 `🔄 Workflows/` | 工作流 SOP，按需添加 | 从常用场景开始 |
| `📚 资源/` 或 `📚 Resources/` | 资源收藏，CSV 已含表头 | 直接追加 |
| `🚀 项目/` 或 `🚀 Projects/` | 个人项目记录 | 按需使用 |

## Profile/画像 填写顺序（推荐）

1. `👤 Identity.md` — 个人身份、背景与关键成就
2. `⚙️ Preferences.md` — 工具、沟通、写作、AI 交互偏好
3. `🎯 Focus.md` — 目标、当前专注与工作节律（定期更新）
