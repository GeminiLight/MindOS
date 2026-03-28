# TMUX_DOC - tmux 多 Agent 会话管理

## 日常使用流程

### Step 1: 启动 sessions

```bash
./tmux-manage.sh start all
```

脚本读取 `tmux-sessions.conf`，为每个 slot 创建 tmux session，并在每个 window 里自动启动 agent：

```
mos-dev   → [cursor]   agent --resume=<id>      [codebuddy] codebuddy --resume dev
mos-algo  → [cursor]   agent --resume=<id>      [codebuddy] codebuddy --resume algo
mos-utils → [claude]   claude --resume utils     [codebuddy] codebuddy --resume utils
mos-ui    → [cursor]   agent --resume=<id>      [codebuddy] codebuddy --resume ui
mos-doc   → [claude]   claude --resume doc       [codebuddy] codebuddy --resume doc
```

### Step 2: 进入工作

**方式 A — 终端直接 attach：**

```bash
tmux attach -t mos-dev
```

**方式 B — VS Code / Cursor：**

`Cmd+Shift+P` → `Run Task` → `Open All MOS Terminals`，5 个终端并排出现，每个 attach 到一个 session。

### Step 3: 在 session 内操作

```
进入 mos-dev session
  ├─ 当前在 cursor window → 跟 Cursor agent 对话
  ├─ Shift+→ → 切到 codebuddy window → 跟 CodeBuddy 对话
  ├─ Shift+← → 切回 cursor
  └─ 需要分屏？ Ctrl+b | (左右) 或 Ctrl+b - (上下)
```

### Step 4: 离开但不关闭

`Ctrl+b` `d` — detach，agent 继续在后台跑，随时 attach 回来。

### Step 5: 收工关闭

```bash
./tmux-manage.sh stop all
```

**核心逻辑：`tmux-manage.sh` 帮你批量创建 session + 启动 agent，你只管 attach 进去干活，detach 出来休息，agent 一直在后台。**

---

## 概览

本项目使用 tmux 管理多个 AI Agent 的终端会话，按功能模块（slot）隔离工作区，每个 slot 内可运行多个 agent。

### 文件清单

| 文件 | 作用 |
|------|------|
| `tmux-manage.sh` | 主管理脚本，交互菜单 + 命令行模式 |
| `tmux-sessions.conf` | 声明式配置：项目、agent、slot、session id |
| `.tmux.conf` | 项目级 tmux 配置（鼠标、复制、快捷键等） |
| `start-tmux.sh` | 旧版简易启动脚本（已弃用） |
| `.vscode/tasks.json` | VS Code / Cursor 一键打开多终端 |

---

## tmux 核心概念

```
Server
 └─ Session (mos-dev)          ← 按 slot 创建，一个功能一个 session
     ├─ Window 1 (cursor)      ← 每个 agent 一个 window
     │   ├─ Pane A             ← 手动分屏产生
     │   └─ Pane B
     └─ Window 2 (codebuddy)
         └─ Pane A
```

| 概念 | 类比 | 说明 |
|------|------|------|
| **Session** | 浏览器窗口 | 独立工作空间，可 detach/attach |
| **Window** | 浏览器标签页 | 同一 session 内切换，底部状态栏显示 |
| **Pane** | 标签页内分屏 | 同一 window 内左右/上下分割 |

---

## 配置文件 (tmux-sessions.conf)

```ini
[project]
name: mos
work_dir: /data/home/geminitwang/code/sop_note

[settings]
init_cmd: source ~/.bashrc

[agents]
# 格式: agent名: 命令 | resume参数模板
# 占位符: {slot} = slot名(dev), {name} = session全名(mos-dev), {id} = 从[ids]读取或交互输入
cursor:    agent     | --resume={id}
claude:    claude    | --resume {slot}
codebuddy: codebuddy | --resume {slot}

[slots]
# 功能名: agent列表（逗号分隔）
dev:   cursor, codebuddy
algo:  cursor, codebuddy
utils: claude, codebuddy
ui:    cursor, codebuddy
doc:   claude, codebuddy

[ids]
# 预配置 session id，启动时自动使用，无需交互
# dev.cursor:  b2fca424-1bf0-4723-943e-fc7684fb172c
# algo.cursor: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

### Resume 占位符说明

| 占位符 | 替换值 | 示例（dev slot） | 是否需要交互 |
|--------|--------|-----------------|-------------|
| `{slot}` | slot 名 | `dev` | 否，自动 |
| `{name}` | session 全名 | `mos-dev` | 否，自动 |
| `{id}` | UUID session id | `b2fca424-...` | 优先读 [ids]，否则交互输入 |

不配置 `|` 模板时，默认使用 `--resume {slot}`。

### Resume 流程

```
launch_agent(slot=dev, agent=cursor)
  │
  ├─ 模板含 {slot} 或 {name}? → 自动替换 → 执行
  │
  └─ 模板含 {id}?
       ├─ [ids] 有 dev.cursor? → 用配置值 → 执行
       └─ 没有 → 交互输入
                  ├─ 有输入 → 用输入值 → 执行
                  └─ 留空 → 不带 resume，启动新会话
```

---

## 使用方式

### 方式一：tmux-manage.sh（推荐）

**交互菜单**（直接运行）：

```bash
./tmux-manage.sh
```

显示菜单：
```
1) Start / Resume    — 创建或恢复 slot
2) Stop              — 关闭 slot
3) Restart           — 先关再开
4) Attach            — 选择 session 进入
5) Open in Editor    — 用 Cursor / VS Code 打开项目
q) Quit
```

**命令行快捷模式**：

```bash
./tmux-manage.sh start all      # 启动所有 slot
./tmux-manage.sh start dev      # 只启动 dev
./tmux-manage.sh stop algo      # 关闭 algo
./tmux-manage.sh status         # 查看状态
```

### 方式二：VS Code / Cursor 一键打开

1. `Cmd+Shift+P`（macOS）或 `Ctrl+Shift+P`
2. 输入 `Run Task`
3. 选择 **Open All MOS Terminals** — 并排打开所有终端
4. 或选择单个 slot（如 `mos-dev`）

> 先用 `./tmux-manage.sh start all` 创建 session，再在编辑器里 Run Task attach。

---

## 快捷键速查

### 通用（无需 prefix，直接按）

| 操作 | 快捷键 |
|------|--------|
| 上一个 window | `Shift+←` |
| 下一个 window | `Shift+→` |
| 上方 pane | `Shift+↑` |
| 下方 pane | `Shift+↓` |

### 需要 prefix（先按 `Ctrl+b`）

| 操作 | 快捷键 |
|------|--------|
| 水平分屏（左右） | `Ctrl+b` `\|` |
| 垂直分屏（上下） | `Ctrl+b` `-` |
| 切换面板 (vim 风格) | `Ctrl+b` `h/j/k/l` |
| 新建 window | `Ctrl+b` `c` |
| 下一个 window | `Ctrl+b` `n` |
| 上一个 window | `Ctrl+b` `p` |
| 切换 session 列表 | `Ctrl+b` `s` |
| Detach（退出但不关闭） | `Ctrl+b` `d` |

### 复制文字

在 VS Code / Cursor 集成终端中：

**按住 `Shift` + 鼠标选中文字 → `Cmd+C` 复制**

> 这会绕过 tmux 的鼠标捕获，让编辑器终端直接处理选择。

### tmux 内复制（滚动历史）

1. `Ctrl+b` `[` — 进入复制模式
2. 方向键或 `vi` 键移动光标
3. `v` — 开始选择
4. `y` — 复制并退出
5. `Ctrl+b` `]` — 粘贴

---

## 常用 tmux 命令

```bash
tmux ls                          # 列出所有 session
tmux attach -t mos-dev           # 进入指定 session
tmux kill-session -t mos-dev     # 关闭指定 session
tmux kill-server                 # 关闭所有 session
```

---

## .tmux.conf 配置说明

项目级配置文件，`tmux-manage.sh` 创建 session 时自动加载：

```bash
# 鼠标滚动、点击、拖拽选择
set -g mouse on

# 滚动历史 10000 行
set -g history-limit 10000

# vi 风格复制模式
setw -g mode-keys vi

# window 编号从 1 开始
set -g base-index 1

# 快捷分屏: | 左右, - 上下
# 面板切换: prefix + hjkl
# 无 prefix: Shift+方向键切换 window/pane
```
