# Workflows

本文件是 Workflows 目录的总览与使用约定，Agent 执行任务前应先读取此文件。

## 📁 目录结构

```
Workflows/
├── README.md                # 本文件，总览与约定
├── Research/            # 科研工作流
│   ├── Survey/
│   ├── Ideation/
│   ├── Experiment/
│   ├── Writing/
│   └── Review/
├── Startup/             # 创业相关
│   ├── Product/
│   ├── Development/
│   └── Marketing/
├── Media/               # 媒体内容创作
└── Information/         # 信息获取与整理
    ├── ai_influencers.csv
    └── 📰 X Influencer 日报抓取 SOP.md
```

## 💡 使用说明

- 每个子目录对应一类工作流场景，进入前先查阅对应目录下的文件
- SOP 文件面向 Agent 执行，步骤清晰，直接按步骤操作

## 📐 更新规则

### 新增

- 新增工作流子目录时，目录名使用英文，并在本文件目录结构和使用说明中同步更新
- 新增 SOP 文件时，文件名以 emoji 开头，放入对应场景子目录，并更新本文件目录结构

### 修改 / 删除

- 修改或删除文件时，同步更新本文件目录结构
