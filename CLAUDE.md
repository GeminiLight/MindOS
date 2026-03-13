## 项目规则

1. `app/data/skills/mindos/SKILL.md` 必须和 `skills/mindos/SKILL.md` 保持一致。如果不一致，直接 copy `skills/mindos/SKILL.md`。

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