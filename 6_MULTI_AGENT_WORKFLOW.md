# 多 Agent 工作流编排思想

## 解决的问题

一个人同时操控多个 AI Agent（Cursor、CodeBuddy、Claude），在多个功能方向上并行工作。手动管理窗口、记住 session ID、反复 SSH 连接——这些重复操作吃掉了大量时间。

## 分层架构

```
第 1 层：声明式配置（tmux-sessions.conf）
  "我要什么" — 项目、功能、agent、session ID
       ↓
第 2 层：自动化编排（tmux-manage.sh）
  "怎么实现" — 创建、恢复、销毁、增量更新
       ↓
第 3 层：接入方式（可替换）
  服务器直连：tmux attach
  编辑器集成：VS Code Run Task
  本地远程：Warp 分屏 SSH（mos-connect.sh）
       ↓
第 4 层：辅助工具
  collect-session-ids.py — 自动收集，消除手工
  dashboard — 监控总览
```

## 设计原则

### 1. 配置与执行分离

所有"状态"在配置文件里，所有"动作"在脚本里。换项目只改配置，不改脚本。

### 2. 增量式而非重建式

`start all` 跑 10 遍和跑 1 遍结果一样——已有的跳过，缺的补上。不怕重复执行，不怕中途断掉。

### 3. 功能分 session，agent 分 window

二维组织方式让"切功能"和"切 agent"变成两个独立操作，互不干扰：
- Shift+左右 → 切 agent
- Ctrl+B s → 切功能

### 4. 接入层可替换

底层是 tmux session，上层随便换——VS Code、Warp、iTerm2、直接终端都能接，因为 tmux 是"真正的状态持有者"。

### 5. 消除手工收集

任何需要手动记录的东西（session ID），都写脚本自动收集。人记 ID 必然出错。

## 迁移指南

### 换项目

```ini
# tmux-sessions.conf
[project]
name: new-project
work_dir: /path/to/new-project
```

其他不变，`start all` 即可。

### 换服务器

```bash
# mos-connect.sh
SSH_HOST="new-server"
```

把 `tmux-manage.sh` + `tmux-sessions.conf` 拷过去就行。

### 换 agent

```ini
[agents]
windsurf: windsurf | --resume={id}
gemini:   gemini   | --resume {slot}

[slots]
dev: windsurf, gemini
```

加一行配置，脚本自动适配。

### 多项目并行

每个项目一套 `tmux-sessions.conf`，用不同的 `name` 前缀。session 天然隔离：

```
mos-dev, mos-algo, mos-ui
web3-dev, web3-algo, web3-ui
```

### 团队共享

配置文件提交到 git，新人 clone 后 `./tmux-manage.sh start all`，开发环境一键就绪。`[ids]` 段各自维护（gitignore 或分文件）。

## 一句话总结

把"我要开哪些窗口、跑哪些 agent"变成一个声明式配置，脚本负责实现，接入方式随便换。这个模式适用于任何"多工具、多窗口、多连接"的重复编排场景。
