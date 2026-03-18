# Git 双仓同步流程

> mindos-dev (private) ↔ mindos (public) 的同步规则与操作手册。

## 仓库关系

```
mindos-dev (private)                    mindos (public)
GeminiLight/mindos-dev                  GeminiLight/MindOS
        │                                      │
        │── push main ──▶ sync workflow ──▶ rsync 覆盖 main
        │── push main ──▶ subtree split ──▶ landing → gh-pages
        │── push tag ───▶ publish workflow ─▶ npm publish
        │                                      │
        │◀── git fetch public ◀── cherry-pick ─┘  (手动反向)
```

## Remote 配置

```bash
# 本地已配置
git remote -v
# origin   git@github.com:GeminiLight/mindos-dev.git   (private)
# public   git@github.com:GeminiLight/MindOS.git        (public)
```

## 正向同步（mindos-dev → mindos）

**自动触发**：push 到 mindos-dev main 且改动了指定路径时，`sync-to-mindos.yml` 自动执行。

做了 3 件事：
1. `subtree split --prefix landing` → push 到 mindos-dev 的 `gh-pages`
2. `rsync --delete` 同步代码到 mindos main（排除 `my-mind/`、`landing/`、部分 wiki 敏感文件）
3. 同步 landing → mindos 的 `gh-pages`

**手动触发**：GitHub Actions → Sync to MindOS → Run workflow

### 注意事项

- rsync 使用 `--delete`，mindos main 上的独有文件会被删除
- wiki 中 `02-business-model.md` 和 `03-technical-pillars.md` 被排除，不会同步到公开仓
- `landing/` 只存在于 gh-pages，不会出现在 mindos main

## 反向同步（mindos → mindos-dev）

**场景**：有人在 mindos 提了 PR，合并后需要把变更拉回 mindos-dev。

**原则**：mindos-dev 是唯一真实来源（single source of truth），公开仓只读。

### 操作步骤

```bash
# 1. 拉取公开仓最新
git fetch public main

# 2. 查看公开仓新增的提交
git log public/main --oneline -10

# 3. 对比差异
git diff HEAD...public/main --stat

# 4. Cherry-pick 需要的提交
git cherry-pick <commit-sha>

# 5. 如果有冲突，解决后
git cherry-pick --continue

# 6. push 到 mindos-dev（会自动触发正向同步）
git push origin main
```

### 批量合并（多个 PR 已合并）

```bash
# 如果公开仓有多个新提交，可以用 rebase 一次性拉入
git fetch public main
git log origin/main..public/main --oneline   # 查看差异提交

# 逐个 cherry-pick（推荐，保留原始提交信息）
git cherry-pick <sha1> <sha2> <sha3>

# 或创建临时分支合并（如果提交很多）
git checkout -b sync-from-public public/main
git rebase origin/main
# 解决冲突...
git checkout main
git merge sync-from-public
git branch -d sync-from-public
```

### 只同步特定文件（不用 cherry-pick 整个提交）

```bash
git fetch public main
git checkout public/main -- path/to/file.ts
git commit -m "sync: pull file.ts from public repo PR #123"
```

## 发版流程

```bash
# 1. 确保 mindos-dev main 是最新的
git pull origin main

# 2. bump 版本 + 打 tag + push
npm run release patch   # 或 minor / major

# 3. 自动触发：
#    - sync-to-mindos.yml → 同步代码到 mindos
#    - publish-npm.yml    → 发布到 npm（仅 v*.*.* tag）
```

## Workflow 文件

| 文件 | 触发 | 作用 |
|------|------|------|
| `.github/workflows/sync-to-mindos.yml` | push main (指定路径) / 手动 | 正向同步 + landing 部署 |
| `.github/workflows/publish-npm.yml` | push tag `v*.*.*` | npm publish |

## 常见问题

### Q: 公开仓 PR 合并后，下次正向同步会覆盖吗？

会。rsync `--delete` 会把 mindos-dev 没有的文件删掉。所以**必须先反向同步到 mindos-dev，再 push 触发正向同步**。

### Q: 忘了反向同步，PR 变更被覆盖了怎么办？

```bash
# 公开仓的 git 历史还在，从 reflog 或 commit 找回
git fetch public main
git log public/main --all --oneline   # 找到被覆盖前的 commit
git cherry-pick <sha>
git push origin main
```

### Q: 如何防止意外覆盖？

在 mindos 仓库设置 Branch Protection Rules：
- Require PR reviews before merging
- 合并 PR 后立即通知维护者做反向同步

长期可考虑：在 mindos 添加 `reverse-sync.yml`，PR 合并后自动向 mindos-dev 提 PR。
