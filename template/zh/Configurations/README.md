# Configurations

本文件是 Configurations 目录的总览与使用约定，Agent 执行任务前应先读取此文件。

## 💡 核心理念

把个人工作流程、偏好和配置沉淀到 Notion，让 Agent 在执行任务时直接读取这些 SOP 和偏好，做到**一次定义，随处执行**。

- 所有重复性操作 → 写成 SOP，Agent 按步骤执行，无需反复说明
- 所有个人偏好 → 集中记录在此，Agent 自动遵循，无需每次提醒
- 所有常用配置文件 → 存入子目录，Agent 执行时直接引用

## 📁 目录结构

```
Configurations/
├── README.md                   # 本文件，总览与约定
├── 🖥️ Server Setup.md     # 服务器初始化 SOP
├── 💻 MacBook Setup.md    # MacBook 初始化 SOP
├── 🤖 Agent 工具配置.md   # AI Agent CLI 工具安装与配置
├── Apps/
│   ├── 🖥️ Server 常用软件.md # 服务器常用软件清单
│   └── 📦 Mac 常用软件.md     # Mac 常用软件清单
├── Agents/
│   ├── 🤖 Agent 全局协议.md    # 所有 Agent 通用行为规范
│   ├── 🤖 Claude Code 配置.md  # Claude Code 偏好配置
│   ├── 🤖 OpenAI Codex 配置.md  # CodeX 沙箱与自动执行配置
│   ├── 🤖 Agent 常用MCP.md     # Agent 常用 MCP 服务清单与配置
│   └── 🤖 Agent 常用Skill.md   # Agent 常用 Skill 清单与安装方式
├── Tools/
│   ├── 🔑 SSH Hosts.md          # 服务器连接列表
│   ├── 🔑 SSH 密钥.md           # SSH 密钥存档与配置脚本
│   ├── 🐍 Python 环境配置.md    # Miniconda、uv 安装与镜像源配置
│   └── 🤗 HuggingFace 配置.md  # 镜像源、登录配置
└── Orgs/
    └── 🏢 腾讯.md               # 腾讯内部工具、账号、环境配置
└── Credentials/
    └── 🍪 小红书.md             # 小红书登录凭证获取方式
└── Scripts/
    └── restart-claude.sh        # 重启 Claude Code 并继续上一个对话
```

## 📐 格式规范

### 文件命名

- 统一使用中文命名，文件名以 emoji 开头，体现文件类型或内容
- 多个词之间用空格分隔
- SSH、Server、Claude Code、Docker、Git 等通识词汇保留英文原名

### 内容风格

- 面向 Agent 执行，步骤清晰，不需要过多解释
- 人工也会查阅，格式需友好易读
- 内容精炼，不啰嗦
- 命令统一用 code 格式，独立执行的命令用 code block，行内提及用 `行内代码`
- 章节标题和关键条目适当添加 emoji

## 🔗 文件引用规范

- 文件之间可通过相对路径互相引用
- 当某文件的**内容或文件名发生变动**时，应同步更新所有引用该文件的地方
- 本文件（README.md）维护目录结构，是引用关系的总索引，每次新增、删除、重命名文件时必须同步更新

## 📐 更新规则

### 新增

- 新增配置文件时，放入对应子目录（Apps/Agents/Tools/Orgs/Credentials），并在本文件目录结构中同步更新
- 新增子目录时，目录名使用英文，在本文件目录结构中同步更新

### 修改 / 删除

- 修改或删除文件时，同步更新所有引用该文件的地方

### ⚠️ 踩坑记录

- 配置过程中遇到报错、流程不通、步骤有误等问题，解决后须在对应配置文件中补充 `⚠️ 踩坑记录` 表格
- 格式：`| 问题现象 | 原因 | 解决方式 |`
- 位置：紧跟在对应配置步骤或安装命令之后
