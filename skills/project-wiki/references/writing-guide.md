# 文档维护指南

## 投入信号

不要追求精确的时间比例，用以下信号判断：

**该写文档了（投入不足）：**
- 连续 3 次对话都在重复解释同一个架构决策或技术约束
- Agent 改错文件、用错技术栈的频率上升
- 你开始在对话开头粘贴大段"项目背景"

**该停下了（过度文档化）：**
- 你在文档上花的时间比写 prompt 还多
- 文档之间出现明显的信息重复
- 你在纠结某段文字的措辞而非内容

---

## 什么时候写什么

| 时机 | 写什么 |
|------|--------|
| 项目启动 | `00-product-proposal.md` |
| 第一阶段交付后 | `02-system-architecture.md` + `03-design-principle.md`（如需） |
| 开始新阶段前 | `01-project-roadmap.md` 追加行 + `1X-stage-X.md`（如复杂） |
| 每阶段交付后 | 更新 stage 状态 + roadmap 状态 + `90-CHANGELOG.md` |
| 踩坑时 | `80-known-pitfalls.md` |
| 新增 API 路由后 | `02-system-architecture.md` 路由表追加一行 |
