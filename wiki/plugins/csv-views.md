# CSV Views

> 将 CSV 文件渲染为表格、画廊、看板三种视图。

## 基本信息

| 字段 | 值 |
|------|---|
| ID | `csv` |
| 图标 | 📊 |
| Core | Yes（不可禁用） |
| 入口文件 | `Resources/Products.csv` |
| 匹配规则 | 扩展名 `.csv` 且文件名不含 `TODO` |

## 文件格式

标准 CSV，首行为列头，后续为数据行。使用 PapaParse 解析，支持引号、逗号转义等。

```csv
Name,Category,Status,Tags
MindOS,Productivity,Active,"ai,knowledge"
Cursor,IDE,Active,"ai,editor"
```

## 三种视图

### Table（默认）

- 电子表格式表格
- 点击列头排序
- 列可显示/隐藏

### Gallery

- 卡片式布局
- 可配置哪列映射为：标题 / 描述 / 标签
- 适合产品库、联系人等可视化浏览

### Board

- 看板式分组
- 选择一个列作为分组依据（如 Status / Category）
- 卡片可按字段显示摘要

## 交互功能

- 🔄 视图切换（Table / Gallery / Board）
- ⚙️ 每种视图独立配置字段映射
- 🔢 实时显示行数统计
- 🔍 列过滤与排序

## 适用场景

- 产品库（Products.csv）
- 联系人 / 人脉管理
- 竞品分析表
- 任何结构化数据浏览
