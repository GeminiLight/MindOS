# Spec: 将第三方 Skill 加载委托给 pi-coding-agent 框架

## 目标

消除 MindOS 自建的第三方 skill 发现/加载/列表轮子，复用 pi-coding-agent 框架原生的 `loadSkills()` 机制做 **发现与解析**。MindOS 核心 skill（`mindos`/`mindos-zh`）保持直接拼入 prompt 不变。同时修复当前框架产生的 **AGENTS.md 重复注入** 和 **日期/cwd 重复** 问题。

## 现状分析

MindOS 基于 `@mariozechner/pi-coding-agent@0.61.1` 框架构建 agent session，但 **绕过了框架的 skill 系统**，自建了一套平行机制。

### 自建部分（要删的）

| 自建模块 | 作用 | 框架替代 |
|---|---|---|
| `lib/pi-integration/skills.ts` | `scanSkillDirs()` 扫描 4 个目录 | 框架 `loadSkills()` 本身支持 `additionalSkillPaths` |
| `lib/pi-integration/skills.ts` | `parseSkillMd()` 解析 YAML frontmatter | 框架 `parseFrontmatter()` |
| `lib/pi-integration/skills.ts` | `readSkillContentByName()` 按名读取 | 框架的 `/skill:name` 展开机制 |
| `lib/agent/skill-resolver.ts` | `resolveSkillFile()` 多路径 fallback | 框架 `loadSkillsFromDir()` 递归发现 |
| `lib/agent/skill-resolver.ts` | `resolveSkillReference()` 引用文件解析 | 框架 skill 的 `baseDir` 字段 |
| `lib/agent/skill-resolver.ts` | `readAbsoluteFile()` + mtime 缓存 | 框架每次 `reload()` 重新扫描 |
| `lib/agent/tools.ts` | `list_skills` 工具 | 自建 `<available_skills>` XML 注入 prompt |
| `lib/agent/tools.ts` | `load_skill` 工具 | **保留**（`read_file` 不支持绝对路径，需要 `load_skill` 的多目录 fallback） |
| `api/skills/route.ts` POST | 自建 create/update/delete/toggle | 保留（UI 管理仍需要） |

### 框架已有但被跳过的

1. **`formatSkillsForPrompt(skills)`**：将所有非 `disable-model-invocation` 的 skill 生成 `<available_skills>` XML。**不能直接使用**：其前导文本硬编码了 "Use the read tool"，而 MindOS 工具名是 `load_skill`。需要只复用框架的 skill **发现**能力，XML 生成自建。

2. **`_expandSkillCommand(text)`**：用户输入 `/skill:name args` 时，读取 SKILL.md 全文并用 `<skill>` XML 包裹注入用户消息。已经生效（`enableSkillCommands: true`），但因为 LLM 看不到可用 skill 列表，所以 LLM 不知道有哪些 skill 可用——只能靠 MindOS 自建的 `list_skills` 工具。

3. **`loadSkills({ skillPaths, includeDefaults })`**：支持从任意目录发现 skill，处理 symlink、`.gitignore`、name collision 检测。当前 MindOS 传了 `additionalSkillPaths` 给 `DefaultResourceLoader`，框架确实执行了 `loadSkills()`，但加载结果未被利用（原因见下）。

### 框架 skill 注入为何未生效（代码级验证）

框架 `buildSystemPrompt()` 在 `customPrompt` 路径中有如下条件：

```javascript
const customPromptHasRead = !selectedTools || selectedTools.includes("read");
if (customPromptHasRead && skills.length > 0) {
    prompt += formatSkillsForPrompt(skills);
}
```

MindOS 传 `tools: [bashTool]` 给 `createAgentSession()`，SDK 将其映射为 `initialActiveToolNames: ['bash']`。`_buildRuntime` 以 `['bash']` 为初始激活集，通过 `includeAllExtensionTools: true` 追加 customTools（`read_file`、`write_file` 等），但 **不追加框架 base tools**（`read`、`edit`、`write`）。最终 `selectedTools = ['bash', 'read_file', 'write_file', ...]`，其中 **没有 `'read'`**。

结论：`selectedTools.includes("read")` 为 `false`，`formatSkillsForPrompt()` **未被调用**，skill 列表未注入 prompt。

### 框架产生的副作用（当前已存在）

MindOS 未设置 `agentsFilesOverride`，框架在 `reload()` 中调用 `loadProjectContextFiles({ cwd: projectRoot })`，找到项目根目录的 `AGENTS.md`（2500+ token），并在 `buildSystemPrompt()` 中追加为 `# Project Context` 段落。MindOS 自己的 `systemPromptOverride` 已经包含了所有必要指令，这个 AGENTS.md 注入是 **纯冗余**。

同理，框架在 `buildSystemPrompt()` 末尾无条件追加 `Current date:` 和 `Current working directory:`，而 MindOS 已在 prompt 中包含 `## Current Time Context`，导致 **日期/时间重复**。

## 数据流 / 状态流

### 改动前（当前）

```
ask/route.ts (Agent mode)
  ├── 自建 resolveSkillFile('mindos') → 读 SKILL.md 全文 → 拼入 promptParts
  ├── 自建 resolveSkillReference('write-supplement.md') → 拼入 promptParts
  ├── systemPromptOverride: () => 上面拼好的完整 prompt（含 base + skills + bootstrap + time）
  ├── appendSystemPromptOverride: () => []
  ├── agentsFilesOverride: 未设置
  │   └── 框架自动加载 AGENTS.md → 追加到 prompt（冗余）
  ├── additionalSkillPaths: [app/data/skills, skills, {mindRoot}/.skills]
  │   └── 框架 loadSkills() 加载了 6 个 skill → 但因 selectedTools 不含 "read"，
  │       formatSkillsForPrompt() 未执行，加载结果被浪费
  ├── 框架追加 "Current date:" / "Current working directory:"（与 MindOS 的 timeContext 重复）
  └── LLM 看到的 skill 信息：
      ├── mindos/mindos-zh: 完整内容在 prompt 里（自建注入）
      ├── AGENTS.md: 完整内容被框架追加（冗余噪音）
      └── 其他 skill: LLM 需调 list_skills 工具 → 自建 scanSkillDirs() → 再调 load_skill 工具
```

### 改动后

```
ask/route.ts (Agent mode)
  ├── 自建 resolveSkillFile('mindos') → 拼入 promptParts（不变）
  ├── 自建 resolveSkillReference('write-supplement.md') → 拼入 promptParts（不变）
  ├── resourceLoader.reload() → 框架 loadSkills() 发现第三方 skill
  ├── resourceLoader.getSkills().skills → 过滤掉 mindos 核心 skill
  ├── 自建 generateSkillsXml(filteredSkills) → 生成 <available_skills> XML（指示用 load_skill）
  ├── 将 <available_skills> XML 拼入 promptParts
  ├── systemPromptOverride: () => 完整 prompt（含 base + mindos skill + skills XML + bootstrap + time）
  ├── agentsFilesOverride: () => ({ agentsFiles: [] })  ← 新增，抑制 AGENTS.md 重复
  └── LLM 看到的 skill 信息：
      ├── mindos/mindos-zh: 完整内容在 prompt 里（自建注入，与现在相同）
      └── 其他 skill: <available_skills> XML 列表（自建注入）→ LLM 用 load_skill 工具读取
```

### 关键变化：prompt 组装

```
改动前：
  systemPromptOverride = () => "完整 prompt"
  agentsFilesOverride: 未设置 → 框架追加 AGENTS.md（冗余）
  框架追加 date/cwd（与 MindOS timeContext 重复）
  formatSkillsForPrompt(): 因 selectedTools 不含 "read" 而跳过

改动后：
  systemPromptOverride = () => "完整 prompt + <available_skills> XML"
  agentsFilesOverride: () => ({ agentsFiles: [] })  ← 抑制 AGENTS.md
  框架追加 date/cwd 仍然存在（可容忍的微量重复，后续可优化）
  第三方 skill XML 由 MindOS 自建生成并拼入 prompt
```

### 为什么不依赖框架自动注入

1. **`selectedTools` 不含 `"read"`**：MindOS 用自己的 `read_file`，框架的 `read` 未被激活。修改 `selectedTools` 会引入框架内置 `read` 工具与 MindOS `read_file` 的冲突。
2. **`formatSkillsForPrompt()` 前导文本硬编码 "Use the read tool"**：与 MindOS 的 `load_skill` 工具名冲突，LLM 可能尝试调用不存在的 `read` 工具。
3. **自建注入更可控**：直接拼入 `systemPromptOverride`，不依赖框架 `buildSystemPrompt()` 的追加逻辑，避免框架升级导致行为变化。

## 方案

### Phase 1: 在 prompt 中注入第三方 skill 列表

#### 1.1 SKILL.md 加 `disable-model-invocation: true`

给 MindOS 核心 skill 的 frontmatter 加上此标记，确保框架不会在任何路径中处理它们：

```yaml
disable-model-invocation: true
```

受影响文件（共 8 个，含 `-max` 变体）：
- `skills/mindos/SKILL.md`、`skills/mindos-zh/SKILL.md`
- `skills/mindos-max/SKILL.md`、`skills/mindos-max-zh/SKILL.md`
- `app/data/skills/mindos/SKILL.md`、`app/data/skills/mindos-zh/SKILL.md`
- `app/data/skills/mindos-max/SKILL.md`、`app/data/skills/mindos-max-zh/SKILL.md`

#### 1.2 `ask/route.ts`：自建 `<available_skills>` XML 生成

在 `resourceLoader.reload()` 之后、`systemPromptOverride` 构建之前，获取框架加载的第三方 skill 并生成 XML：

```typescript
// 从框架获取已发现的第三方 skill（过滤掉 MindOS 核心 skill）
const CORE_SKILL_NAMES = new Set(['mindos', 'mindos-zh', 'mindos-max', 'mindos-max-zh']);
const { skills: allSkills } = resourceLoader.getSkills();
const thirdPartySkills = allSkills.filter(s =>
  !CORE_SKILL_NAMES.has(s.name) && !s.disableModelInvocation
);

// 生成 <available_skills> XML（指示用 load_skill 而非 read）
function generateSkillsXml(skills: Array<{ name: string; description: string; filePath: string }>): string {
  if (skills.length === 0) return '';
  const lines = [
    '\n\n---\n\nThe following skills provide specialized instructions for specific tasks.',
    'Use the load_skill tool to load a skill\'s full content when a task matches its description.',
    '',
    '<available_skills>',
  ];
  for (const skill of skills) {
    lines.push('  <skill>');
    lines.push(`    <name>${escapeXml(skill.name)}</name>`);
    lines.push(`    <description>${escapeXml(skill.description)}</description>`);
    lines.push('  </skill>');
  }
  lines.push('</available_skills>');
  return lines.join('\n');
}

// 拼入 promptParts
if (thirdPartySkills.length > 0) {
  promptParts.push(generateSkillsXml(thirdPartySkills));
}
```

注意：XML 中 **不输出 `<location>`**，因为 LLM 应使用 `load_skill` 按 name 加载，不需要知道文件路径。这避免了绝对路径与 `read_file` 不兼容的问题。

#### 1.3 `DefaultResourceLoader` 加 `agentsFilesOverride` 和 `skillsOverride`

```typescript
const resourceLoader = new DefaultResourceLoader({
  cwd: projectRoot,
  settingsManager,
  systemPromptOverride: () => systemPrompt,
  appendSystemPromptOverride: () => [],
  // 抑制框架自动加载 AGENTS.md，避免与 MindOS 自建 prompt 重复
  agentsFilesOverride: () => ({ agentsFiles: [] }),
  // 双重保险：过滤核心 skill，防止在任何框架路径中被处理
  skillsOverride: (result) => ({
    ...result,
    skills: result.skills.filter(s => !CORE_SKILL_NAMES.has(s.name)),
  }),
  additionalSkillPaths: [
    path.join(projectRoot, 'app', 'data', 'skills'),
    path.join(projectRoot, 'skills'),
    path.join(getMindRoot(), '.skills'),
  ],
  additionalExtensionPaths: scanExtensionPaths(),
});
```

### Phase 2: 删除 `list_skills`，保留 `load_skill`

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

- `__tests__/lib/pi-skills.test.ts` — 对 `parseSkillMd`、`scanSkillDirs`、`readSkillContentByName` 的测试。删除 `scanSkillDirs` 相关测试，保留 `parseSkillMd` 和 `readSkillContentByName` 测试。
- `__tests__/core/skill-install-logic.test.ts` — 检查是否依赖被删函数。
- 新增集成测试：验证 `resourceLoader.getSkills()` 返回正确的第三方 skill 列表，核心 skill 被 `skillsOverride` 过滤。

## 影响范围

### 变更文件

| 文件 | 改动 |
|---|---|
| `skills/mindos/SKILL.md` | frontmatter 加 `disable-model-invocation: true` |
| `skills/mindos-zh/SKILL.md` | 同上 |
| `skills/mindos-max/SKILL.md` | 同上 |
| `skills/mindos-max-zh/SKILL.md` | 同上 |
| `app/data/skills/mindos/SKILL.md` | 同上（与 skills/ 保持一致） |
| `app/data/skills/mindos-zh/SKILL.md` | 同上 |
| `app/data/skills/mindos-max/SKILL.md` | 同上 |
| `app/data/skills/mindos-max-zh/SKILL.md` | 同上 |
| `app/app/api/ask/route.ts` | 加 `agentsFilesOverride`、`skillsOverride`；加 `generateSkillsXml()` 并拼入 prompt |
| `app/lib/agent/tools.ts` | 删除 `list_skills` 工具定义及 `ListSkillsParams` Schema；保留 `load_skill` |
| `app/lib/agent/prompt.ts` | 更新 Skills 段落 |
| `app/lib/pi-integration/skills.ts` | 删除 `scanSkillDirs`、`getPiSkillSearchDirs`；保留 `readSkillContentByName`、`parseSkillMd` |
| `app/app/api/skills/route.ts` | GET handler 改用框架 `loadSkills()` |
| `app/app/api/mcp/agents/route.ts` | 改用框架 `loadSkills()` |
| `app/__tests__/lib/pi-skills.test.ts` | 删除 `scanSkillDirs` 测试，新增 `skillsOverride` 集成测试 |

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

**对 API**：`list_skills` 工具被移除。`load_skill` 保留。如果有外部 MCP client 依赖 `list_skills` 工具名，会受影响。但这是 agent 内部工具（不通过 MCP 暴露），所以不受影响。

## 边界 case 与风险

### 边界 case

| # | 场景 | 处理 |
|---|---|---|
| 1 | 用户的 SKILL.md 没有 frontmatter 或 description 为空 | 框架 `loadSkillFromFile` 会跳过（返回 `skill: null`），和当前行为一致（`parseSkillMd` 也会返回空 name） |
| 2 | 用户的 skill name 不符合规范（含大写/特殊字符） | 框架会生成 warning diagnostic 但仍尝试加载。比当前的 `scanSkillDirs` 更宽松（当前不做 name 校验） |
| 3 | 多个目录有同名 skill（collision） | 框架按加载顺序先到先得，记录 collision diagnostic。当前自建逻辑也是 `seen.has(skillName)` 跳过后来者，行为一致。当前验证显示 `app/data/skills/` 和 `skills/` 各含一份 mindos —— `skillsOverride` 过滤后不影响第三方 skill，但建议去重 `additionalSkillPaths` 以消除 collision diagnostic |
| 4 | mindos/mindos-zh 出现在 `~/.mindos/skills/` | `disable-model-invocation: true` + `skillsOverride` 双重保险，不会出现在 XML 中 |
| 5 | 用户安装了大量第三方 skill（>20 个） | 自建 XML 不含 `<location>` 字段，每个 skill 的 token 开销仅为 name + description ≈ 50 token。20 个 skill ≈ 1000 token。当前 `list_skills` 按需加载不占 prompt token，这是一个 tradeoff。可通过 `skillsOverride` 限制最大数量作为后续优化 |
| 6 | Ollama 小 context 模型 | 当前已有 Ollama context overflow 保护逻辑（按 `---` 分段 strip）。自建 XML 用 `---` 开头，会被正确识别为低优先级 section 可被 strip |
| 7 | `load_skill` 工具的 name 参数与框架 skill name 不一致 | `load_skill` 使用 `readSkillContentByName()` 按 name 搜索多目录，框架 `loadSkills()` 的 `skill.name` 来自 SKILL.md frontmatter。两者解析同一个 `name:` 字段，行为一致 |
| 8 | 框架追加的 date/cwd 与 MindOS timeContext 重复 | 框架在 `buildSystemPrompt()` 末尾无条件追加 `Current date:` 和 `Current working directory:`。MindOS 已有 `## Current Time Context`。两者共存不影响正确性（LLM 能理解），但浪费 ~30 token。后续可通过 patch 框架或 post-process prompt 消除 |

### 风险与 mitigation

| 风险 | 影响 | Mitigation |
|---|---|---|
| 框架 `loadSkills()` 的 API 或返回格式在未来版本变化 | Medium | 写集成测试断言 `getSkills().skills` 返回含 `name`、`description`、`filePath` 字段的数组 |
| `<available_skills>` XML 格式与 LLM 的理解度 | Low | 这是 pi-coding-agent 推荐的标准格式，主流 LLM 均能解析 XML |
| `load_skill` 工具按 name 搜索找不到框架发现的 skill | Medium | `readSkillContentByName()` 和框架 `loadSkills()` 使用相同的 `additionalSkillPaths`，搜索范围一致。写测试验证：对于 `getSkills()` 返回的每个 skill name，`readSkillContentByName(name)` 都能返回内容 |
| 第三方 skill 的 prompt token 开销从 0（按需加载）变为固定 | Low | 20 个 skill ≈ 1000 token，在可接受范围内 |
| `agentsFilesOverride` 抑制了框架对 AGENTS.md 的加载 | None | MindOS 有完整的自建 prompt，不依赖框架注入 AGENTS.md。当前 AGENTS.md 注入是纯冗余。设置后节省 ~2500 token |

## 验收标准

- [ ] `skills/mindos*/SKILL.md` 和 `app/data/skills/mindos*/SKILL.md`（共 8 个文件）含 `disable-model-invocation: true`
- [ ] Agent mode 的 system prompt 包含 `<available_skills>` XML 块（含第三方 skill，不含 mindos/mindos-zh/mindos-max/mindos-max-zh）
- [ ] `<available_skills>` 前导文本指示 "Use the **load_skill** tool"（不是 "read" 工具）
- [ ] MindOS core skill（mindos/mindos-zh）仍然完整注入到 prompt 中（行为不变）
- [ ] 删除 `list_skills` 后，LLM 仍能通过 `<available_skills>` 发现第三方 skill，并通过 `load_skill` 工具读取
- [ ] `/skill:mindos` 手动调用仍然正常工作（框架 `_expandSkillCommand` 未受影响）
- [ ] Settings → Skills 页面正常显示所有 skill（来源、启用状态）
- [ ] Agent Matrix 页面正常显示 skill 列表
- [ ] Chat mode 和 Organize mode 不受影响（不注入 skill 列表）
- [ ] Ollama 小 context 模型下不因 `<available_skills>` 块导致溢出（Ollama compact 能正确 strip 该段）
- [ ] `npx vitest run` 全部通过
- [ ] TypeScript 编译无新增错误
- [ ] `load_skill` 工具能按 name 读取 `<available_skills>` 中列出的第三方 skill
- [ ] System prompt 不含 `# Project Context` 段落（AGENTS.md 重复注入已被抑制）
- [ ] Skill name collision diagnostic 为 0（或仅来自预期的核心 skill 重复目录）
