# 🤖 Agent 常用Skill

Skill 是 Claude Code 的可安装扩展，通过 `/install-skill <名称>` 安装，激活后通过 `/<名称>` 触发。

## 🔬 科研

| 名称 | 用途 | 触发场景 |
|------|------|----------|
| arxiv-search | 语义搜索 arXiv 论文 | 查找某方向的相关论文 |
| ml-paper-writing | 撰写 ML/AI 论文（NeurIPS/ICML/ICLR 等） | 从研究仓库起草论文、准备投稿 |
| research-paper-writer | 撰写正式学术论文（IEEE/ACM 格式） | 写研究论文、会议论文 |
| scientific-paper-figure-generator | 生成发表级科学图表 | 为论文生成实验结果图、可视化 |
| ml-position-paper-writer | 撰写 ML 立场论文、视野论文 | 有观点想写成学术文章 |

## 🛍️ 产品

| 名称 | 用途 | 触发场景 |
|------|------|----------|
| product-designer | UI/UX 设计、设计系统、用户研究 | 产品原型设计、交互方案 |
| defining-product-vision | 撰写产品愿景与长期方向 | 写 Vision Statement、对齐团队目标 |
| product-taste-intuition | 培养产品直觉与判断力 | 评估设计质量、做产品决策 |
| business-model-canvas | 商业模式画布分析 | 梳理产品或项目的商业模式 |
| startup-business-analyst-business-case | 创业项目商业案例分析 | 评估商业可行性、撰写商业计划 |

## 💻 开发

| 名称 | 用途 | 触发场景 |
|------|------|----------|
| frontend-design | 生成高质量前端界面（React/HTML/CSS） | 构建网页、组件、落地页、Dashboard |
| vercel-react-best-practices | React/Next.js 性能优化规范 | 编写或 Review React/Next.js 代码 |
| remotion-best-practices | Remotion 视频开发最佳实践 | 用 React 制作视频 |

## 🤖 Agent 工具

| 名称 | 用途 | 触发场景 |
|------|------|----------|
| skill-creator | 创建、修改、测评 Skill | 开发新 Skill 或优化现有 Skill |
| find-skills | 发现并安装新 Skill | 询问"有没有能做 X 的 Skill" |

## 📖 使用方式

```bash
# 安装 Skill
/install-skill <名称>

# 触发 Skill
/<名称>

# 查看已安装列表
claude skills list
```
