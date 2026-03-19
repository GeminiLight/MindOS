# Human Insights — Agent 协作经验

> 与 AI Agent 协作中积累的真实经验。每条 insight 来自实际踩坑，不是理论推导。

---

## 指令设计

### 描述终态，不描述步骤
```
❌  "修这个 bug" → "review 下" → "再 review" → "commit" → "push" → "release"
✅  "修这个 bug，自检通过后 commit push release patch"
```
一轮完成 vs 六轮交互。Agent 擅长串联步骤，人擅长定义终态。

### 并行任务在一条消息里给出
```
❌  开 3 个 terminal 分别执行，自己做调度器
✅  一条消息列出 3 个独立任务，说明"并行执行"
```
Agent 会自动派 sub-agent 并行工作，你只看一个窗口。

### 把隐含的质量标准说出来
Agent 不知道你心里的"完成"标准。说清楚：
- "跑完测试" → 不用你说 review
- "更新 wiki" → 不用你事后补
- "release patch" → 不用你追加指令

---

## Review 协作

### "Review 下"是效率杀手
每次人工要求 review 是一轮交互浪费。正确做法：
1. 在 CLAUDE.md 写好自检清单
2. Agent 改完自动执行，不需要你催
3. 你只在 Agent 完成后做最终验收，不做中间 review

### Review 要给方向，不给指令
```
❌  "你 review 下"（没有重点）
✅  "这个改动的缓存失效路径完整吗？Next.js client/server 两层都覆盖了吗？"
```
有方向的 review 一次到位，没方向的 review 往往变成两轮。

---

## 任务拆分

### 依赖关系决定串并行
- 改不同文件的独立 bug → 并行
- 同一文件的多个改动 → 串行
- 调研 + 实现 → 先调研后实现（但调研可以多路并行）

### 一个 fix 包含完整闭环
Bug fix 不只是改代码：
```
修复 → 全局扫描同类问题 → 补测试 → 记录到 known-pitfalls → 更新 backlog
```
在指令里说"完整闭环"，Agent 会自动走完。

---

## 防止返工

### 框架陷阱提前文档化
踩过的坑写入 `wiki/80-known-pitfalls.md`，Agent 每次改动前会查阅。
- `force-dynamic` 只对 page/route 有效，layout 上无效
- `revalidatePath` 在测试环境会抛异常，需要 try-catch
- `--prefer-offline` 没有 fallback 会在新机器崩溃

### 让 Agent 写防护测试
每个 class of bug 都应该有对应的自动化测试，而不是靠人记住。
- 版本范围 vs 实际 import → `dep-safety.test.ts`
- 裸 `--prefer-offline` 使用 → lint test 自动扫描

---

## 沟通模式

### 不确定时一次问清
```
❌  Agent 猜一个方案 → 你说不对 → 再猜 → 又不对
✅  Agent 列出 2-3 个选项 + 推荐 → 你选一个 → 一次到位
```

### Bug 报告附上下文
```
❌  "sidebar 不更新"
✅  "sidebar 不更新。创建文件后文件树没有刷新。在 dev 模式复现。"
```
多一句上下文，少两轮排查。

---

---

## 全自治模式

### 一个 idea 到交付，零中间交互
```
之前：idea → 问方向 → 写 spec → 等 review → 改 spec → 写代码 → 等 review → 改代码 → commit → push → release
之后：idea → Agent 全自驱（spec → self-review ×2 → code → self-review ×2 → test → doc → commit → push）→ 你验收
```
关键配置：在 CLAUDE.md 写明全自治流程 + 自检清单，Agent 就不会每步停下来等你。

### 人的角色从"调度器"变成"验收者"
- 不开多个 terminal 手动调度
- 不在中间步骤介入
- 只在最终结果出来后做一次验收
- 不满意时给方向性反馈（不是"review 下"，而是"缓存路径覆盖了吗"）

### 质量靠系统保证，不靠人盯
- CLAUDE.md 的自检清单 = 编译期检查
- wiki/80-known-pitfalls.md = 已知 bug 数据库
- dep-safety.test.ts 类的防护测试 = 运行时 guard
- 这三层到位后，人工 review 变成抽检而非必检

---

*持续更新。每次踩坑后追加一条。*
