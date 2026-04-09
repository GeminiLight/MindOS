# Spec: 将第三方 Skill 加载委托给 pi-coding-agent 框架

## 目标

消除 MindOS 自建的第三方 skill 发现/加载/列表轮子，复用 pi-coding-agent 框架原生的 `loadSkills()` + `formatSkillsForPrompt()` 机制。MindOS 核心 skill（`mindos`/`mindos-zh`）保持直接拼入 prompt 不变。

## 现状分析

MindOS 基于 `@mariozechner/pi-coding-agent@0.61.1` 框架构建 agent session，但 **绕过了框架的 skill 系统**，自建了一套平行机制：

### 自建部分（要删的）

| 自建模块 | 作用 | 框架替代 |
|---|---|---|
| `lib/pi-integration/skills.ts` | `scanSkillDirs()` 扫描 4 个目录 | 框架 `loadSkills()` 本身支持 `additionalSkillPaths` |
| `lib/pi-integration/skills.ts` | `parseSkillMd()` 解析 YAML frontmatter | 框架 `parseFrontmatter()` |
| `lib/pi-integration/skills.ts` | `readSkillContentByName()` 按名读取 | 框架的 `/skill:name` 展开机制 |
| `lib/agent/skill-resolver.ts` | `resolveSkillFile()` 多路径 fallback | 框架 `loadSkillsFromDir()` 递归发现 |
| `lib/agent/skill-resolver.ts` | `resolveSkillReference()` 引用文件解析 | 框架 skill 的 `baseDir` 字段 |
| `lib/agent/skill-resolver.ts` | `readAbsoluteFile()` + mtime 缓存 | 框架每次 `reload()` 重新扫描 |
| `lib/agent/tools.ts` | `list_skills` 工具 | 框架注入 `<available_skills>` XML |
| `lib/agent/tools.ts` | `load_skill` 工具 | **保留**（`read_file` 不支持绝对路径，需要 `load_skill` 的多目录 fallback） |
| `api/skills/route.ts` POST | 自建 create/update/delete/toggle | 保留（UI 管理仍需要） |

### 框架已有但被跳过的

1. **`formatSkillsForPrompt(skills)`**：将所有非 `disable-model-invocation` 的 skill 注入 `<available_skills>` XML 到 system prompt。被跳过的原因：`systemPromptOverride` 完全替换了 `buildSystemPrompt()`。

2. **`_expandSkillCommand(text)`**：用户输入 `/skill:name args` 时，读取 SKILL.md 全文并用 `<skill>` XML 包裹注入用户消息。已经生效（`enableSkillCommands: true`），但因为 LLM 看不到 `<available_skills>` 列表，所以 LLM 不知道有哪些 skill 可用——只能靠 MindOS 自建的 `list_skills` 工具。

3. **`loadSkills({ skillPaths, includeDefaults })`**：支持从任意目录发现 skill，处理 symlink、`.gitignore`、name collision 检测。当前 MindOS 传了 `additionalSkillPaths` 但没有使用加载结果。

## 数据流 / 状态流

### 改动前（当前）

```
ask/route.ts (Agent mode)
  ├── 自建 resolveSkillFile('mindos') → 读 SKILL.md 全文 → 拼入 systemPrompt
  ├── 自建 resolveSkillReference('write-supplement.md') → 拼入 systemPrompt
  ├── systemPromptOverride: () => 上面拼好的完整 prompt
  │   └── 框架 buildSystemPrompt() 被完全跳过 → formatSkillsForPrompt() 不执行
  ├── additionalSkillPaths: [app/data/skills, skills, {mindRoot}/.skills]
  │   └── 框架 loadSkills() 加载了这些 → 但结果被 systemPromptOverride 忽略
  └── LLM 看到的 skill 信息：
      ├── mindos/mindos-zh: 完整内容在 prompt 里（自建注入）
      └── 其他 skill: LLM 需调 list_skills 工具 → 自建 scanSkillDirs() → 再调 load_skill 工具
```

### 改动后

```
ask/route.ts (Agent mode)
  ├── 自建读取 SKILL.md + write-supplement.md → 拼入 systemPromptOverride（保持不变）
  ├── skillsOverride: 过滤掉 mindos/mindos-zh（避免重复注入）
  ├── systemPromptOverride: () => 不再返回完整 prompt，改为 base prompt 部分
  ├── appendSystemPromptOverride: () => [bootstrap context, attached files, ...]
  │   └── 框架 buildSystemPrompt() 正常执行：
  │       ├── customPrompt = systemPromptOverride 返回的 base prompt
  │       ├── appendSystemPrompt = 上面返回的 bootstrap context
  │       ├── skills = loadSkills() 结果（已过滤 mindos）
  │       └── 自动调 formatSkillsForPrompt() 注入 <available_skills> XML
  └── LLM 看到的 skill 信息：
      ├── mindos/mindos-zh: 完整内容在 prompt 里（自建注入，与现在相同）
      └── 其他 skill: <available_skills> XML 列表（框架注入）→ LLM 用 load_skill 工具读取
```

### 关键变化：prompt 组装

```
改动前：
  systemPromptOverride = () => "整个 prompt（base + skills + bootstrap + attachments + time）"
  appendSystemPromptOverride = () => []   // 空
  → buildSystemPrompt() 直接返回 customPrompt，skills 被忽略

改动后：
  systemPromptOverride = () => "base prompt + mindos skill + bootstrap context + time + attachments"
  appendSystemPromptOverride = () => []   // 仍为空
  skillsOverride = (result) => 过滤掉 mindos/mindos-zh
  → buildSystemPrompt() 把 customPrompt + <available_skills> 拼在一起
```

补充说明：框架 `buildSystemPrompt()` 在 `customPrompt` 存在时的行为是：
1. 输出 `customPrompt`
2. 追加 `appendSystemPrompt`
3. 追加 project context files（AGENTS.md 等）
4. 追加 `formatSkillsForPrompt(skills)`（如果有 read 工具）
5. 追加日期和 cwd

所以只要 MindOS 通过 `systemPromptOverride` 提供 base prompt，框架会在末尾自动追加第三方 skill 列表。

## 方案

### Phase 1: 让框架注入 `<available_skills>`

#### 1.1 SKILL.md 加 `disable-model-invocation: true`

给 `skills/mindos/SKILL.md` 和 `skills/mindos-zh/SKILL.md` 的 frontmatter 加上：

```yaml
disable-model-invocation: true
```

效果：框架的 `formatSkillsForPrompt()` 会跳过这两个 skill，不会在 `<available_skills>` 里重复出现。MindOS 自己继续在 systemPrompt 里直接注入完整内容。

同步修改 `app/data/skills/mindos/SKILL.md` 和 `app/data/skills/mindos-zh/SKILL.md`（按文档一致性规则）。

#### 1.2 用 `skillsOverride` 双重保险

在 `DefaultResourceLoader` 构造时加 `skillsOverride`，过滤掉 mindos 相关的 skill，防止它们出现在 `<available_skills>` 里：

```typescript
const resourceLoader = new DefaultResourceLoader({
  // ...existing options...
  skillsOverride: (result) => ({
    ...result,
    skills: result.skills.filter(s =>
      s.name !== 'mindos' && s.name !== 'mindos-zh' &&
      s.name !== 'mindos-max' && s.name !== 'mindos-max-zh'
    ),
  }),
});
```

#### 1.3 不再完全覆盖 `systemPromptOverride`

当前 `systemPromptOverride: () => systemPrompt` 返回的是已经拼好的完整 prompt，导致框架无法追加 skill 列表。

改为：`systemPromptOverride` 仍然返回完整 prompt（包含 MindOS 的 base prompt + mindos skill + bootstrap context），但框架会在 `buildSystemPrompt()` 中把 `<available_skills>` 追加到末尾。

**关键发现**：重新审查框架代码后，`buildSystemPrompt()` 在 `customPrompt` 存在时，会在末尾自动追加 `formatSkillsForPrompt(skills)`。也就是说，**当前架构不需要改 `systemPromptOverride` 的方式**——框架本来就会追加 skill 列表，只是因为 `skillsOverride` 没有被使用，所有 skill（包括 mindos）都会被列在 `<available_skills>` 里。

所以实际上 Phase 1 的改动非常小：只需要加 `skillsOverride` 过滤 mindos，框架就会自动把其他 skill 注入 prompt。

### Phase 2: 删除 `list_skills`，保留 `load_skill`

框架注入的 `<available_skills>` XML 告诉 LLM 有哪些 skill 可用，替代了 `list_skills` 的作用。

但 **`load_skill` 需要保留**：框架在 `<available_skills>` 里写的 `<location>` 是绝对路径，而 MindOS 的 `read_file` 工具只接受相对于 mindRoot 的路径，无法读取项目目录下的 SKILL.md。`load_skill` 有自己的多目录 fallback 逻辑，可以按 name 直接读取，不依赖路径格式。

#### 2.1 删除 `tools.ts` 中的 `list_skills`

从 `knowledgeBaseTools` 数组中移除 `list_skills` 工具定义及其 `ListSkillsParams` Schema。保留 `load_skill`。

#### 2.2 更新 system prompt

`prompt.ts` 的 `AGENT_SYSTEM_PROMPT` 中有：
```
- **Skills**: Use the list_skills and load_skill tools to discover available skills on demand.
```
改为：
```
- **Skills**: Available skills are listed at the end of this prompt. Use the load_skill tool to load a skill's full content when a task matches its description.
```

### Phase 3: 删除自建扫描模块

#### 3.1 精简 `lib/pi-integration/skills.ts`

删除：
- `scanSkillDirs()` — 被框架 `loadSkills()` 替代
- `getPiSkillSearchDirs()` — 被框架的 `additionalSkillPaths` 替代

保留：
- `readSkillContentByName()` — 仍被 `load_skill` 工具使用
- `parseSkillMd()` — 仍被 `api/skills/route.ts` POST handler 使用
- 类型定义 `PiSkillInfo`、`ScanSkillOptions` — 保留（被 `api/skills/route.ts` 使用）

#### 3.2 精简 `lib/agent/skill-resolver.ts`

- `resolveSkillFile()` 和 `resolveSkillReference()` 仍然被 `ask/route.ts` 使用（加载 mindos core skill）→ **保留**
- `readAbsoluteFile()` 和 `clearAbsoluteFileCache()` 被 resolveSkillFile 依赖 → **保留**
- `skillDirCandidates()` 被上述函数依赖 → **保留**

结论：`skill-resolver.ts` 暂不删除。它服务于 mindos core skill 的多路径 fallback 加载（Desktop Core Hot Update 场景），和第三方 skill 无关。

#### 3.3 更新 `api/skills/route.ts`

GET handler 当前调用 `scanSkillDirs()` 返回 skill 列表给前端 Settings UI。改为调用框架的 `loadSkills()`:

```typescript
import { loadSkills } from '@mariozechner/pi-coding-agent';

export async function GET() {
  const { skills } = loadSkills({
    cwd: PROJECT_ROOT,
    skillPaths: [
      path.join(PROJECT_ROOT, 'app', 'data', 'skills'),
      path.join(PROJECT_ROOT, 'skills'),
      path.join(getMindRoot(), '.skills'),
      path.join(os.homedir(), '.mindos', 'skills'),
    ],
    includeDefaults: false,
  });
  // ... map to UI format
}
```

POST handler（create/update/delete/toggle/read）操作的是 `{mindRoot}/.skills/` 下的文件，不涉及扫描逻辑，**保持不变**。

#### 3.4 更新 `api/mcp/agents/route.ts`

该文件也调用了 `scanSkillDirs()` 用于 Agent Matrix 页面。同样改为框架的 `loadSkills()`。

### Phase 4: 清理测试

- `__tests__/lib/pi-skills.test.ts` — 对 `parseSkillMd`、`scanSkillDirs`、`readSkillContentByName` 的测试。删除或改为测试框架 `loadSkills()` 的集成行为。
- `__tests__/core/skill-install-logic.test.ts` — 检查是否依赖被删函数。

## 影响范围

### 变更文件

| 文件 | 改动 |
|---|---|
| `skills/mindos/SKILL.md` | frontmatter 加 `disable-model-invocation: true` |
| `skills/mindos-zh/SKILL.md` | 同上 |
| `app/data/skills/mindos/SKILL.md` | 同上（与 skills/ 保持一致） |
| `app/data/skills/mindos-zh/SKILL.md` | 同上 |
| `app/app/api/ask/route.ts` | `DefaultResourceLoader` 加 `skillsOverride` |
| `app/lib/agent/tools.ts` | 删除 `list_skills` 工具定义及 `ListSkillsParams` Schema；保留 `load_skill` |
| `app/lib/agent/prompt.ts` | 更新 Skills 段落 |
| `app/lib/pi-integration/skills.ts` | 删除 `scanSkillDirs`、`getPiSkillSearchDirs`；保留 `readSkillContentByName`、`parseSkillMd` |
| `app/app/api/skills/route.ts` | GET handler 改用框架 `loadSkills()` |
| `app/app/api/mcp/agents/route.ts` | 改用框架 `loadSkills()` |
| `app/__tests__/lib/pi-skills.test.ts` | 重写或删除 |

### 不受影响

- `app/lib/agent/skill-resolver.ts` — mindos core skill 的多路径 fallback 仍需要，**不改**
- `app/app/api/mcp/install-skill/route.ts` — `npx skills add` 安装机制不变
- `app/lib/pi-integration/extensions.ts` — Extension 系统与 Skill 系统独立
- `app/components/settings/McpSkillsSection.tsx` — 前端 UI 通过 `api/skills` 获取数据，接口不变
- `app/hooks/useSlashCommand.ts` — `/skill:name` 命令由框架 `_expandSkillCommand` 处理，不受影响
- `app/app/api/bootstrap/route.ts` — bootstrap 加载与 skill 无关
- Chat mode / Organize mode — 不涉及 skill 注入

### 是否有破坏性变更

**对用户**：无。第三方 skill 仍然从相同目录被发现，只是发现机制换成了框架。`/skill:name` 命令仍然可用。

**对 API**：`list_skills` 和 `load_skill` 工具被移除。如果有外部 MCP client 依赖这两个工具名，会受影响。但这两个是 agent 内部工具（不通过 MCP 暴露），所以不受影响。

## 边界 case 与风险

### 边界 case

| # | 场景 | 处理 |
|---|---|---|
| 1 | 用户的 SKILL.md 没有 frontmatter 或 description 为空 | 框架 `loadSkillFromFile` 会跳过（返回 `skill: null`），和当前行为一致（`parseSkillMd` 也会返回空 name） |
| 2 | 用户的 skill name 不符合规范（含大写/特殊字符） | 框架会生成 warning diagnostic 但仍尝试加载。比当前的 `scanSkillDirs` 更宽松（当前不做 name 校验） |
| 3 | 多个目录有同名 skill（collision） | 框架按加载顺序先到先得，记录 collision diagnostic。当前自建逻辑也是 `seen.has(skillName)` 跳过后来者，行为一致 |
| 4 | mindos/mindos-zh 出现在 `~/.mindos/skills/` | `skillsOverride` 会过滤掉，不会重复注入 |
| 5 | 用户安装了大量第三方 skill（>20 个） | 框架会把所有 skill 的 name+description 注入 prompt，可能占用较多 token。可通过 `skillsOverride` 限制最大数量。当前 `list_skills` 按需加载不占 prompt token，这是一个 tradeoff |
| 6 | Ollama 小 context 模型 | 当前已有 Ollama context overflow 保护逻辑。新增的 `<available_skills>` 块会在 compact 阶段被剥离（作为低优先级 section）。需要确认 compact 逻辑能正确处理框架追加的 skill 块 |
| 7 | `read_file` 工具路径 vs 框架 `read` 工具名 | 框架 prompt 说 "Use the read tool"，但 MindOS 的工具名是 `read_file`。需要在 `systemPromptOverride` 或 `appendSystemPromptOverride` 中补充说明，或直接在 prompt 里修正 |

### 风险与 mitigation

| 风险 | 影响 | Mitigation |
|---|---|---|
| 框架 `buildSystemPrompt()` 在 `customPrompt` 模式下的行为可能在未来版本变化 | Medium | 写集成测试断言 system prompt 包含 `<available_skills>` 块 |
| `<available_skills>` XML 格式与 MindOS LLM 的理解度 | Low | 这是框架推荐的标准格式，主流 LLM（Claude/GPT/Gemini）均能解析 XML |
| 删除 `list_skills`/`load_skill` 后，LLM 依赖 `read_file` 读取 skill 文件需要绝对路径 | **High** | 框架在 `<available_skills>` 里提供了 `<location>` 绝对路径（如 `/data/home/.../SKILL.md`），但 MindOS 的 `read_file` 工具只接受 **相对于 mindRoot 的路径**（`getFileContent()` → `resolveSafe(root, filePath)`）。**解决方案**：保留 `load_skill` 工具（只删 `list_skills`），或者在框架注入前改写 `<location>` 为相对路径，或者给 `read_file` 加绝对路径支持。推荐保留 `load_skill`——它比 `read_file` 更语义化，且已经有 multi-dir fallback 能力 |
| 第三方 skill 的 prompt token 开销从 0（按需加载）变为固定（每个 skill ~50 token 的 name+description） | Low | 20 个 skill ≈ 1000 token，在可接受范围内 |

## 验收标准

- [ ] `skills/mindos/SKILL.md` 和 `skills/mindos-zh/SKILL.md` 含 `disable-model-invocation: true`
- [ ] Agent mode 的 system prompt 末尾包含 `<available_skills>` XML 块（含第三方 skill，不含 mindos）
- [ ] MindOS core skill（mindos/mindos-zh）仍然完整注入到 prompt 中（行为不变）
- [ ] 删除 `list_skills` 后，LLM 仍能通过框架注入的 `<available_skills>` 列表发现第三方 skill，并通过 `load_skill` 工具读取
- [ ] `/skill:mindos` 手动调用仍然正常工作（框架 `_expandSkillCommand` 未受影响）
- [ ] Settings → Skills 页面正常显示所有 skill（来源、启用状态）
- [ ] Agent Matrix 页面正常显示 skill 列表
- [ ] Chat mode 和 Organize mode 不受影响（不注入 skill 列表）
- [ ] Ollama 小 context 模型下不因 `<available_skills>` 块导致溢出
- [ ] `npx vitest run` 全部通过
- [ ] TypeScript 编译无新增错误
- [ ] `load_skill` 工具能按 name 读取 `<available_skills>` 中列出的第三方 skill
