# Spec: 简化 Skill 加载架构

## 目标

将 3 文件 skill 加载（SKILL.md + skill-rules.md + user-rules.md）简化为 2 文件（SKILL.md 内置完整规则 + 可选 user-skill-rules.md 在知识库根目录）。消除 `npx skills install` 依赖，消除 Onboard 的 skill 安装步骤。

## 现状分析

当前每次请求加载 3 个文件：
1. `app/data/skills/mindos/SKILL.md`（26 行，仅 YAML frontmatter + protocol 指引）
2. `{mindRoot}/.agents/skills/mindos/skill-rules.md`（222 行，实际操作规则）
3. `{mindRoot}/.agents/skills/mindos/user-rules.md`（20 行，用户个性化偏好）

问题：
- SKILL.md 只是指向 skill-rules.md 的指针，skill-rules.md 才是真正内容
- skill-rules.md 需要 `npx skills install` 安装到用户 KB → 安装失败用户卡住
- `.agents/skills/mindos/` 路径对用户不直觉，不敢碰
- 三个文件注入 system prompt 浪费 section header token

## 数据流 / 状态流

**改动前：**
```
ask/route.ts
  → readAbsoluteFile(app/data/skills/mindos/SKILL.md)          // 26 行 frontmatter
  → loadSkillRules(mindRoot, 'mindos')
    → read {mindRoot}/.agents/skills/mindos/skill-rules.md      // 222 行规则（需安装）
    → read {mindRoot}/.agents/skills/mindos/user-rules.md       // 20 行偏好
  → 三个 block 分别注入 system prompt
```

**改动后：**
```
ask/route.ts
  → readAbsoluteFile(app/data/skills/mindos/SKILL.md)           // ~250 行（含完整规则）
  → readKnowledgeFile('user-skill-rules.md')                    // 可选，知识库根目录
  → 两个 block 注入 system prompt
```

## 方案

### 1. 合并 SKILL.md

将 `skill-rules.md` 的 222 行内容合并到 `SKILL.md` 的 YAML frontmatter 后面。SKILL.md 变成完整的操作手册，不再需要外部文件。

中英文各一份：`app/data/skills/mindos/SKILL.md` 和 `app/data/skills/mindos-zh/SKILL.md`。

### 2. user-skill-rules.md 移到知识库根目录

从 `{mindRoot}/.agents/skills/mindos/user-rules.md` → `{mindRoot}/user-skill-rules.md`

和 INSTRUCTION.md / README.md 同级，用户一眼能看到。

### 3. 简化 ask/route.ts

- 删除 `loadSkillRules()` 调用
- `user-skill-rules.md` 作为 bootstrap context 的一部分加载（与 INSTRUCTION.md 同一层）
- 删除 `lib/agent/skill-rules.ts`

### 4. 去掉 Onboard 的 skill install 步骤

- `setup/index.tsx`：删除 Phase 3（installSkill）
- `api/mcp/install-skill/route.ts`：保留但非关键路径
- `cli.js`：删除 skill-rules 自动迁移逻辑
- i18n：skillInstalling / skillInstalled / skillFailed 保留但不再在 Onboard 中使用

### 5. 向后兼容迁移

`cli.js` start 时：如果 `{mindRoot}/.agents/skills/mindos/user-rules.md` 存在且 `{mindRoot}/user-skill-rules.md` 不存在，自动复制过来。

## 影响范围

| 文件 | 改动 |
|------|------|
| `app/data/skills/mindos/SKILL.md` | 合并 skill-rules.md 内容 |
| `app/data/skills/mindos-zh/SKILL.md` | 合并 skill-rules.md 内容 |
| `app/app/api/ask/route.ts` | 简化加载：删 loadSkillRules，加 user-skill-rules.md |
| `app/lib/agent/skill-rules.ts` | 删除 |
| `app/components/setup/index.tsx` | 删除 Phase 3 skill install |
| `bin/cli.js` | 迁移逻辑：user-rules.md → user-skill-rules.md |
| `app/__tests__/core/skill-rules.test.ts` | 删除或重写 |

### 不受影响
- `app/api/mcp/install-skill/route.ts`：保留（MCP tab 手动安装仍可用）
- Settings → MCP → Skills：不变
- 前端 UI 组件（除 setup wizard）：不变

## 边界 case 与风险

1. **老用户有 `.agents/skills/mindos/user-rules.md`** — cli.js 启动时自动迁移到根目录
2. **老用户没有 user-rules.md** — 无影响，文件不存在时跳过
3. **用户同时有两处 user rules** — 根目录优先，忽略 .agents 目录
4. **中文用户** — `mindos-zh/SKILL.md` 同步合并
5. **SKILL.md 变大后 context 占用** — 26 行 → ~250 行，增加 ~3000 token。可接受（当前三文件加起来也是这么多）
6. **`npx skills install` 的用户** — 仍可用，但不再是必需步骤

## 验收标准

- [ ] 新装用户 Onboard 不再有 skill install 步骤
- [ ] Ask AI 正常工作（SKILL.md 含完整规则）
- [ ] `user-skill-rules.md` 在知识库根目录可被加载
- [ ] 老用户 user-rules.md 自动迁移
- [ ] `npx vitest run` 全部通过
- [ ] TypeScript 编译无新增错误
