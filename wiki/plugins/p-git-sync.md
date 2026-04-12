# Git Sync — 自动版本控制与备份插件

> 知识库自动 git commit + push，实现无感版本控制和云端备份。

## 基本信息

| 字段 | 值 |
|------|---|
| ID | `git-sync` |
| 类型 | 集成（Integration） |
| 来源 | 本地 git CLI |
| 依赖 | `git`（用户机器已安装） |
| 状态 | 计划中 |

## 解决什么问题

MindOS 是本地优先的产品，用户最大的焦虑是"万一硬盘坏了/电脑丢了，笔记全没了"。自动 git sync 解决两个问题：
1. **备份**：自动 push 到 GitHub/GitLab 私有仓库
2. **版本历史**：每次变更都有 commit，可以回滚到任意时间点

## 功能

- **自动 commit**：文件变更后延迟 N 秒（可配置，默认 30s）自动 commit
- **自动 push**：commit 后自动 push 到 remote（可配置频率：实时 / 每小时 / 每天）
- **自动 pull**：启动时或定时拉取远端变更（多设备同步）
- **冲突处理**：检测到冲突时通知用户，不自动合并
- **ignore 规则**：自动生成 `.gitignore`（排除 `.mindos/`、`node_modules/` 等）
- **状态指示**：sidebar 底部显示同步状态（synced / pending / conflict）

## 配置

```json
{
  "gitSync": {
    "enabled": true,
    "remote": "origin",
    "branch": "main",
    "commitDelay": 30,
    "pushFrequency": "hourly",
    "autoPull": true,
    "commitMessage": "auto: update notes"
  }
}
```

## 架构

```
文件变更事件
    │
    ▼
Debounce (30s)
    │
    ▼
git add -A → git commit -m "auto: ..." → git push
    │                                        │
    ▼                                        ▼
本地版本历史                            云端备份
```

## 实施要点

- 使用 `child_process` 调用 git CLI，不引入 Node git 库
- 首次启用时引导用户 `git init` + 添加 remote
- commit message 格式可配置（含时间戳和变更文件数）
- 大文件警告：单文件 >10MB 提示用 `.gitignore` 排除
