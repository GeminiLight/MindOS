# Spec: App 端 Skill-Rules 注入

> Status: ✅ Implemented
> Author: geminitwang + claude
> Date: 2026-03-20

## 目标

在 App agent（`POST /api/ask`）的 system prompt 中，注入用户知识库中的 `skill-rules.md` 和 `user-rules.md`，实现渐进式 skill 加载的 App 侧闭环。

## 现状分析

当前 route.ts 只从 `data/skills/mindos/SKILL.md`（静态文件）加载 skill。CLI agent（Claude Code 等）通过 SKILL.md 的 Protocol 指引 agent 读取 `.agents/skills/mindos/skill-rules.md` 和 `user-rules.md`。但 App agent 是服务端注入 system prompt，不走 MCP tool call——所以需要服务端直接读取这两个文件并注入。

```
当前：
  route.ts → readAbsoluteFile('data/skills/mindos/SKILL.md') → system prompt

目标：
  route.ts → readAbsoluteFile('data/skills/mindos/SKILL.md')    → system prompt（SKILL.md）
           → readAbsoluteFile(mindRoot + '/.agents/skills/{name}/skill-rules.md')  → system prompt（skill rules）
           → readAbsoluteFile(mindRoot + '/.agents/skills/{name}/user-rules.md')   → system prompt（user rules）
```

## 数据流 / 状态流

```
POST /api/ask
  │
  ├─ readSettings() → serverSettings
  │   ├─ disabledSkills: string[] → 判断用 mindos 还是 mindos-zh
  │   └─ mindRoot → 知识库根路径
  │
  ├─ 确定 skill 目录名：
  │   isZh = disabledSkills?.includes('mindos') → skillDirName = isZh ? 'mindos-zh' : 'mindos'
  │
  ├─ 读取 3 个文件：
  │   1. SKILL.md（静态，来自 app/data/skills/{skillDirName}/SKILL.md）
  │   2. skill-rules.md（用户知识库，{mindRoot}/.agents/skills/{skillDirName}/skill-rules.md）
  │   3. user-rules.md（用户知识库，{mindRoot}/.agents/skills/{skillDirName}/user-rules.md）
  │
  ├─ 注入 system prompt：
  │   initContextBlocks += skill.content（SKILL.md 始终注入）
  │   initContextBlocks += skillRules.content（如果存在且非空）
  │   initContextBlocks += userRules.content（如果存在且非空）
  │
  └─ 其余不变
```

## 方案

在 `route.ts` 的 skill 加载区域（当前 L178-183），增加对 skill-rules.md 和 user-rules.md 的读取。

**关键设计决策：**

1. **用 `readAbsoluteFile` 而非 `readKnowledgeFile`**：skill-rules 文件是绝对路径（`mindRoot + /.agents/...`），不是相对于 mindRoot 的 knowledge base 文件。
2. **不影响现有 SKILL.md 注入**：skill-rules 是补充，不是替换。SKILL.md 仍然作为 trigger 描述和基本协议存在。
3. **静默降级**：文件不存在时不报错——不是所有用户都有 skill-rules（旧版用户或未 init 的用户）。
4. **language 检测**：通过 `disabledSkills` 判断。`disabledSkills.includes('mindos')` 说明用户用中文版（mindos-zh）。

## 影响范围

- 变更文件列表：
  - `app/app/api/ask/route.ts`：增加 ~15 行读取 + 注入逻辑
- 受影响的其他模块：
  - 无。这是纯粹的 system prompt 内容追加，不影响 SSE 格式、tool 定义、context 管理。
- 是否有破坏性变更：无。

## 边界 case 与风险

1. **mindRoot 未配置 / 不存在**：`getMindRoot()` 有 fallback（`~/MindOS/mind`）。如果目录不存在，`readAbsoluteFile` 返回 `{ ok: false }`，跳过注入。
2. **skill-rules.md 存在但为空**：检查 `content.trim().length > 0`，空文件不注入。
3. **user-rules.md 存在但为空**：同上。
4. **用户同时禁用 mindos 和 mindos-zh**：`disabledSkills` 包含两者时不注入 skill-rules。但 SKILL.md 仍注入。
5. **skill-rules.md 超大（>20k chars）**：通过 `readAbsoluteFile` 的 truncation 处理。
6. **路径注入攻击**：mindRoot 和 skillDirName 来自服务端设置，不受用户请求控制。
7. **并发读取**：所有 file reads 都是同步的 `readFileSync`，无竞态风险。

## 验收标准

- [ ] 知识库 `.agents/skills/mindos/skill-rules.md` 存在时，其内容出现在 system prompt 中
- [ ] 知识库 `.agents/skills/mindos/user-rules.md` 存在时，其内容出现在 system prompt 中
- [ ] skill-rules.md 不存在时，不报错，不影响请求
- [ ] user-rules.md 不存在时，不报错，不影响请求
- [ ] 空文件不注入（无多余空白段落）
- [ ] 中文用户（disabledSkills 包含 'mindos'）从 mindos-zh 目录读取
- [ ] SKILL.md 仍然正常注入（不受 skill-rules 影响）
- [ ] 截断标志正确传播（skill-rules 大文件场景）
