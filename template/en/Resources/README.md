# Resources

本文件是 Resources 目录的总览与使用约定，Agent 执行任务前应先读取此文件。

## 📁 目录结构

```
Resources/
├── README.md                   # 本文件，总览与约定
├── Products.csv            # 产品收藏（Name, URL, Category, Tags, Description, Key Features, Target Users, Pricing）
├── AI Scholars.csv         # AI 学者收藏（Category, Name, Institution, Research Focus, Representative Works, Homepage）
├── 🌟 Github Projects.csv  # GitHub 项目收藏
├── Github Projects/        # GitHub 项目详情
│   └── 🤖 pi coding agent.md
├── Design/                 # 设计资源
└── Tech/                   # 技术资源
    └── tools.csv
```

## 💡 使用说明

- 添加产品时，追加一行到 `Products.csv`，字段：`Name, URL, Category, Tags, Description, Key Features, Target Users, Pricing`
- 添加 GitHub 项目时，追加到 `🌟 Github Projects.csv`
- 添加 AI 学者时，追加一行到 `AI Scholars.csv`，字段：`Category, Name, Institution, Research Focus, Representative Works, Homepage`

## 📐 更新规则

### 新增

- 新增 CSV 收藏文件时，在本文件目录结构中注明字段说明
- 新增资源子目录时，目录名使用英文，在本文件目录结构和使用说明中同步更新
- 添加 CSV 条目后无需更新本文件，CSV 自维护

### 修改 / 删除

- 修改或删除文件时，同步更新本文件目录结构及所有引用处
