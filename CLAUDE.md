## 项目规则

### 任务执行流程

1. 从 **roadmap / backlog** 取任务，确认阶段匹配
2. 写 **stage / spec**，明确边界和验收标准
3. **human review + AI review** spec
4. **执行**
5. **code review**
6. **结果验证**

- 不要估算工时

### Bug 处理流程

发现 bug 时按以下步骤处理：

1. **复现** — 确认能稳定复现，记录复现步骤
2. **检查类似 bug** — 搜索 `wiki/80-known-pitfalls.md` 和 `wiki/85-backlog.md`，看是否有同类问题（人工反馈或机器发现）
3. **定位根因** — 不要只修表面现象，找到为什么会发生
4. **评估影响范围** — 同样的根因是否在其他地方也存在
5. **修复** — 修复后补 tests，将坑记入 `wiki/80-known-pitfalls.md`

### 并行任务防重复

执行前先检查任务状态，避免重复执行已完成的任务。并行任务可能导致某些任务已被完成，记得先对比查看。

### 代码更新后置流程

开发中实时做，提交前 checklist 最后确认：

```
改代码 → tests（新功能写上，修 bug 视情况补）→ 更新 wiki
```

### 文档一致性规则

- `README.md` 和 `README-zh.md` 必须保持一致
- `skills/mindos/SKILL.md` 和 `app/data/skills/mindos/SKILL.md` 必须保持一致（不一致时以 `skills/` 为准）

### 对话记录规则

记录每次对话，分类存入 MindOS 笔记，标注期望的 workflow 是否完成。

<!-- TODO: 补充对话分类方式（如：需求讨论 / bug fix / 流程优化 / ...） -->

### Backlog 与 Changelog 维护规则

- **Backlog**（`wiki/85-backlog.md`）：追踪待办 / 进行中 / 已完成任务，完成后打勾
- **Changelog**（`wiki/90-changelog.md`）：发版时从已完成的 backlog 条目批量整理写入，面向用户描述变更

## Git 提交流程

### Commit 前 Checklist

提交前确认以下事项：

- [ ] tests 通过（新功能已写 tests，修 bug 视情况补）
- [ ] code review 完成
- [ ] wiki 已更新（架构变更、API 变更、新坑等）
- [ ] backlog 已打勾（完成的任务标记为完成）
- [ ] changelog 已更新（发版时从 backlog 整理写入 `wiki/90-changelog.md`）
- [ ] 文档一致性检查（README 双语、SKILL.md 副本）
- [ ] 无 debug 代码 / console.log 遗留
- [ ] 无敏感信息混入（API key、密码等）
- [ ] 无不相关的临时文件混入

### 提交步骤

当用户让我 commit 时，按以下流程执行：

1. **检查改动**：`git status` + `git diff` 查看所有变更
2. **确认范围**：向用户确认哪些文件需要提交（排除不相关的临时文件）
3. **写 commit message**：遵循 Conventional Commits（`feat:` / `fix:` / `refactor:` / `docs:` 等）
4. **提交并 push**：`git add <files> && git commit && git push origin main`
5. **确认发版**：提交后主动询问用户：
   - "是否需要发布新版本到 npm？"
   - 如果是，默认使用 `patch`，除非用户指定 `minor`（新功能）或 `major`（破坏性变更）
   - 然后执行 `npm run release [patch|minor|major]`

### 发版说明

- push 到 main 会触发 `sync-to-mindos` workflow（同步到公开仓 + 部署 landing page）
- 只有打 `v*.*.*` tag 才会触发 `publish-npm` workflow（发布到 npm）
- `npm run release` 会自动：检查工作区干净 → 跑测试 → bump 版本 → 打 tag → push → 等待 CI

## Skill 优化流程

1. **收集 Bad Case**：用户描述或提供 `BAD_CASES.md`，记录具体的错误行为
2. **读取 Skill**：读取 `skills/<name>/SKILL.md`，理解当前 description 和执行逻辑
3. **定位根因**：判断问题出在 trigger 描述、执行模式、工具选型，还是边界条件缺失
4. **提出修复方案**：给出具体的改动建议，说明改了什么、为什么
5. **用户确认**：等用户确认方向后再动手
6. **同步更新所有副本**：
   - `skills/<name>/SKILL.md`（中文版同步修改英文版，反之亦然）
   - `app/data/skills/<name>/SKILL.md`（按 CLAUDE.md 规则与 skills/ 保持一致）
   - `.claude-internal/skills/<name>/SKILL.md`（若存在）
7. **验证一致性**：用命令行 diff 确认所有副本内容相同

## Landing Page

content.md <-> landing/index.html