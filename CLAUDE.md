## 项目规则

1. `app/data/skills/mindos/SKILL.md` 必须和 `skills/mindos/SKILL.md` 保持一致。如果不一致，直接 copy `skills/mindos/SKILL.md`，直接用命令行的方式对比。

你再review下，找些建议和可提升的地方

有任务，先spec，review spec 再执行，再review code 和结果
REAMDE.md和REAMDE-zh.md必须保持一致

项目写wiki和tests

roadmap 到 spec 到 review （human + ai）

并行任务可能导致有些任务已经被完成了，记得先对比查看下

更新代码需要判断是否增加tests、最后更新wiki

不要
再估算工时

记录我的每一次对话，分类，记录我期望的workflow是否完成

backlog更新下，是需要添加chan  
  gelog还是这里打勾      

## Git 提交流程

当用户让我 commit 时，按以下流程执行：

1. **检查改动**：`git status` + `git diff` 查看所有变更
2. **确认范围**：向用户确认哪些文件需要提交（排除不相关的临时文件）
3. **写 commit message**：遵循 Conventional Commits（`feat:` / `fix:` / `refactor:` / `docs:` 等）
4. **提交并 push**：`git add <files> && git commit && git push origin main`
5. **确认发版**：提交后主动询问用户：
   - "是否需要发布新版本到 npm？"
   - 如果是，确认 bump 级别：`patch`（bug fix）/ `minor`（新功能）/ `major`（破坏性变更）
   - 然后执行 `npm run release [patch|minor|major]`

### 发版说明

- push 到 main 会触发 `sync-to-mindos` workflow（同步到公开仓 + 部署 landing page）
- 只有打 `v*.*.*` tag 才会触发 `publish-npm` workflow（发布到 npm）
- `npm run release` 会自动：检查工作区干净 → 跑测试 → bump 版本 → 打 tag → push → 等待 CI