# Task Spec: Onboarding Skill 自动安装

**Status**: Draft
**Scope**: SetupWizard Step 5 + Skills API + Settings McpTab + `npx skills add`

---

## 背景

### MindOS 内置 Skill

MindOS 内置两个互斥的操作指南 Skill：

| Skill | 语言 | 路径 |
|-------|------|------|
| `mindos` | 英文 | `skills/mindos/SKILL.md` |
| `mindos-zh` | 中文 | `skills/mindos-zh/SKILL.md` |

两个 Skill 的 runtime 副本在 `app/data/skills/` 下。用户只应启用其中一个。

### `npx skills` 工具链

`npx skills add` 是通用的 Skill 分发工具，支持 **42 个 Agent**：

```
amp, antigravity, augment, claude-code, openclaw, cline, codebuddy,
codex, command-code, continue, cortex, crush, cursor, droid, gemini-cli,
github-copilot, goose, junie, iflow-cli, kilo, kimi-cli, kiro-cli, kode,
mcpjam, mistral-vibe, mux, opencode, openhands, pi, qoder, qwen-code,
replit, roo, trae, trae-cn, warp, windsurf, zencoder, neovate, pochi, adal,
universal
```

安装机制：
- **source**: GitHub repo / local path / npm package
- **安装方式**：
  - **Universal agents**（9 个：Amp, Cline, Codex, Cursor, Gemini CLI, GitHub Copilot, Kimi Code CLI, OpenCode, Warp）：直接读取 `.agents/skills/<name>/`，无需额外目录
  - **Additional agents**（~31 个）：在 `~/.<agent>/skills/<name>/` 下创建 **symlink** → `../../.agents/skills/<name>`
- **lock file**: `skills-lock.json` 记录安装来源和 hash
- **-g (global)**: 安装到 `~/.agents/skills/` 而非项目级 `.agents/skills/`
- **注意**: `npx skills remove --all` 会删除 `skills/` 下的源文件！不在代码中调用 remove
- **不使用 `--all`**：避免为未安装的 agent 创建不必要的目录

### 当前行为

- Skill 在 `app/data/skills/` 和 `skills/` 中静态存在，默认全部 enabled
- 用户通过 Settings → MCP → Skills 手动 toggle enabled/disabled（`disabledSkills` 数组）
- **没有根据语言偏好自动选择对应 Skill 的逻辑**
- Setup 流程完全不涉及 Skill 配置
- `npx skills add` 只做文件分发，不影响 MindOS 的 enabled/disabled 状态

---

## 目标

1. **Setup 完成时自动安装 Skill 到选中的 Agent**：利用 `npx skills add` 将对应语言的 Skill 分发到用户选中的 agent
2. **语言对应关系明确**：en/empty → 安装 `mindos`；zh → 安装 `mindos-zh`
3. **MindOS 侧同步 disable 另一个**：写入 `disabledSkills` 确保 MindOS 自身只加载对应语言版本
4. **Settings 侧可见可改**：用户能在 MCP Settings 中看到当前 Skill 语言选择，并可手动切换

---

## Skill 语言映射

| 模板选择 | 安装 & 启用 | 不安装 & 禁用 |
|---------|-----------|-------------|
| `en` | `mindos` | `mindos-zh` |
| `zh` | `mindos-zh` | `mindos` |
| `empty` | `mindos` | `mindos-zh` |

**判断逻辑**：根据 `template` 值（Step 1 选择）。如果用户跳过模板选择（已有文件），fallback 到 `en`。

---

## 改动

### 1. 新增 Skill 安装 API

**文件**: `app/app/api/mcp/install-skill/route.ts`（新建）

接收请求后在服务端执行 `npx skills add`：

```typescript
interface SkillInstallRequest {
  skill: 'mindos' | 'mindos-zh';
  agents: string[];  // 用户选中的 MCP agent key 列表
}
```

执行策略：**一条命令，按需添加 Additional agents**

```bash
# 情况 1: 用户选了 non-universal agent（如 claude-code, windsurf）
npx skills add <source> -s <skill> -a claude-code,windsurf -g -y
# → 自动复制到 ~/.agents/skills/（Universal 自动覆盖）+ 创建 symlink（Additional 覆盖）

# 情况 2: 用户只选了 Universal agent（cursor, cline, gemini-cli）或无 agent
npx skills add <source> -s <skill> -a universal -g -y
# → 只复制到 ~/.agents/skills/，不创建多余 symlink
```

- 任何 `-a` 命令都会先复制文件到 `~/.agents/skills/`，Universal agents 自动可读
- `-a universal` 仅在没有 non-universal agent 时作为 fallback
- `-g`：全局安装
- `-y`：跳过确认
- `<source>`：本项目 `skills/` 目录

**为什么不用 `--all`**：
- `--all` 会为 ~31 个 additional agent 创建 `~/.<agent>/` 目录，多数用户只用 2-3 个
- Universal 已覆盖 Cursor, Cline, Gemini CLI 等主流 agent
- 只对用户实际选中的 non-universal agent 创建 symlink，保持 HOME 目录整洁

**Agent 分类**（决定是否需要 Step 2）：

| MCP Agent Key | Universal | 需要 `-a` |
|---------------|-----------|----------|
| `claude-code` | ❌ | ✅ |
| `claude-desktop` | — | ❌（不支持 Skill） |
| `cursor` | ✅ | ❌ |
| `windsurf` | ❌ | ✅ |
| `cline` | ✅ | ❌ |
| `trae` | ❌ | ✅ |
| `gemini-cli` | ✅ | ❌ |
| `openclaw` | ❌ | ✅ |
| `codebuddy` | ❌ | ✅ |

API 逻辑：
1. 从 `agents` 列表中过滤出 non-universal 且支持 Skill 的 agent（claude-code, windsurf, trae, openclaw, codebuddy）
2. 若有 → 执行 `npx skills add ... -a <agent1>,<agent2> -g -y`（Universal 自动覆盖）
3. 若无 → 执行 `npx skills add ... -a universal -g -y`（fallback，仅写 `~/.agents/skills/`）
4. 返回执行结果

**详细机制参考**：`wiki/ref-npx-skills-mechanism.md`

### 2. Setup 完成时安装 Skill + 写入偏好

**文件**: `app/components/SetupWizard.tsx` — `handleComplete` 函数

在 agent MCP config 安装完成后，增加一步：

```
// 3. Install skill (universal + selected additional agents)
const skillName = state.template === 'zh' ? 'mindos-zh' : 'mindos';
await fetch('/api/mcp/install-skill', {
  method: 'POST',
  body: JSON.stringify({
    skill: skillName,
    agents: Array.from(selectedAgents),
  }),
});
```

**文件**: `app/app/api/setup/route.ts`（POST handler）

在保存配置的流程末尾，根据 `template` 设置 `disabledSkills`：

```
if template === 'zh':
  settings.disabledSkills = ['mindos']     // MindOS 禁用英文版
else:
  settings.disabledSkills = ['mindos-zh']  // MindOS 禁用中文版
```

**条件**：仅在 `disabledSkills` 为空（首次设置）或 Setup 明确重新配置时写入。

### 3. SetupWizard Step 5 — Skill 安装提示

**文件**: `app/components/SetupWizard.tsx`

在 Step 5 Agent 列表下方，增加信息提示：

```
ℹ️ Based on your template choice ({template}), the "{skillName}" skill
   will be installed to selected agents.
```

- 只读信息，不需要用户操作
- 让用户知道 Skill 会随 Agent 配置一起安装

### 4. Step 6 Review — 展示 Skill 配置

**文件**: `app/components/SetupWizard.tsx`

Review 表格增加一行：

| Skill | mindos (en) | 或 | mindos-zh (zh) |

安装结果在 Review 中展示成功/失败状态。

### 5. Settings McpTab — Skill 语言快捷切换

**文件**: `app/components/settings/McpTab.tsx`

在 SkillsSection 顶部增加语言切换器：

```
Skill Language: [English] [中文]
```

- 点击切换时，toggle 两个 Skill 的 enabled/disabled 状态
- 调用 `/api/skills` POST toggle 接口（两次调用）

### 6. i18n 更新

**文件**: `app/lib/i18n.ts`

新增 keys：

| Key | EN | ZH |
|-----|----|----|
| `setup.skillAutoHint` | `Based on your template, the "{name}" skill will be installed to selected agents.` | `根据您选择的模板，将向选中的 Agent 安装「{name}」Skill。` |
| `setup.skillLabel` | `Skill` | `Skill` |
| `setup.skillInstalling` | `Installing skill…` | `正在安装 Skill…` |
| `setup.skillInstalled` | `Skill installed` | `Skill 已安装` |
| `setup.skillFailed` | `Skill install failed` | `Skill 安装失败` |
| `settings.mcp.skillLanguage` | `Skill Language` | `Skill 语言` |
| `settings.mcp.skillLangEn` | `English` | `English` |
| `settings.mcp.skillLangZh` | `中文` | `中文` |

---

## 文件变更清单

| 操作 | 文件 |
|------|------|
| 新建 | `app/app/api/mcp/install-skill/route.ts` — 调用 npx skills add 的 API |
| 修改 | `app/app/api/setup/route.ts` — 完成时根据 template 写入 disabledSkills |
| 修改 | `app/components/SetupWizard.tsx` — Step 5 提示 + handleComplete 安装 Skill + Step 6 展示 |
| 修改 | `app/components/settings/McpTab.tsx` — Skill 语言快捷切换 |
| 修改 | `app/lib/i18n.ts` — 新增 8 个 i18n key |

---

## 场景示例

### A. 初始化 Setup — 不同 Agent 组合

#### 场景 1: 用户选了 Cursor + Claude Code，模板 `zh`

检测到已安装：Cursor（Universal）、Claude Code（Additional）

```
selected agents = [cursor, claude-code]
skill = mindos-zh
non-universal agents = [claude-code]

→ npx skills add ./skills -s mindos-zh -a claude-code -g -y
```

结果：
- `~/.agents/skills/mindos-zh/` ← Skill 文件（Cursor 直接读取）
- `~/.claude-code/skills/mindos-zh/` → symlink → `../../.agents/skills/mindos-zh`
- MindOS `disabledSkills = ['mindos']`

#### 场景 2: 用户选了 Cursor + Cline + Gemini CLI，模板 `en`

检测到已安装：Cursor、Cline、Gemini CLI（全是 Universal）

```
selected agents = [cursor, cline, gemini-cli]
skill = mindos
non-universal agents = []  (空)

→ npx skills add ./skills -s mindos -a universal -g -y  (fallback)
```

结果：
- `~/.agents/skills/mindos/` ← Skill 文件（三个 agent 都直接读取）
- 无额外 symlink
- MindOS `disabledSkills = ['mindos-zh']`

#### 场景 3: 用户选了 Claude Code + Windsurf + Trae + Claude Desktop，模板 `zh`

检测到已安装：Claude Code、Windsurf、Trae（Additional）、Claude Desktop（不支持 Skill）

```
selected agents = [claude-code, windsurf, trae, claude-desktop]
skill = mindos-zh
non-universal agents = [claude-code, windsurf, trae]  (claude-desktop 跳过)

→ npx skills add ./skills -s mindos-zh -a claude-code,windsurf,trae -g -y
```

结果：
- `~/.agents/skills/mindos-zh/` ← Skill 文件
- `~/.claude-code/skills/mindos-zh/` → symlink
- `~/.windsurf/skills/mindos-zh/` → symlink
- `~/.trae/skills/mindos-zh/` → symlink
- Claude Desktop：跳过（不支持 Skill）
- MindOS `disabledSkills = ['mindos']`

#### 场景 4: 用户只选了 Claude Desktop，模板 `en`

检测到已安装：Claude Desktop（不支持 Skill）

```
selected agents = [claude-desktop]
skill = mindos
non-universal agents = []  (claude-desktop 被排除)

→ npx skills add ./skills -s mindos -a universal -g -y  (fallback)
```

结果：
- `~/.agents/skills/mindos/` ← Skill 文件（即使当前没有 Universal agent，未来装了就可用）
- MindOS `disabledSkills = ['mindos-zh']`

### B. 增量更新 — 用户后续在 Settings 中变更

#### 场景 5: 用户在 Settings 切换 Skill 语言（en → zh）

用户初始选了 `en`，现在想切换到中文。

操作：Settings → MCP → Skills → Skill Language 切换到「中文」

```
# toggle MindOS 侧
disabledSkills: ['mindos-zh'] → ['mindos']

# 重新安装 Skill 到之前的 agent（从 settings 中读取已配置的 agent 列表）
npx skills add ./skills -s mindos-zh -a <已配置的 non-universal agents> -g -y
```

结果：
- `~/.agents/skills/mindos-zh/` 覆盖写入（或新建）
- `~/.agents/skills/mindos/` 保留（不删除，避免调用 remove）
- 各 agent 的 symlink 更新
- MindOS 加载 `mindos-zh`，禁用 `mindos`

**注意**：旧 Skill 文件 (`~/.agents/skills/mindos/`) 不删除，因为不调用 `npx skills remove`。占用空间极小，无副作用。

#### 场景 6: 用户新增一个 Agent（如安装了 Windsurf）

用户初始只选了 Cursor（Universal），后来安装了 Windsurf（Additional）。

操作：Settings → MCP → 勾选 Windsurf → Install

```
# MCP 配置照常安装（已有逻辑）
# Skill 需要追加安装到 Windsurf
npx skills add ./skills -s mindos -a windsurf -g -y
```

结果：
- `~/.windsurf/skills/mindos/` → 新建 symlink
- 其他 agent 不受影响

**实现方式**：MCP install API 完成后，检查新增 agent 是否为 non-universal 且支持 Skill，若是则追加调用 install-skill API。

#### 场景 7: 用户移除一个 Agent

用户取消了 Claude Code 的 MCP 配置。

**不做 Skill 清理**：`~/.claude-code/skills/mindos/` symlink 保留，不调用 remove。
- 如果用户卸载了 Claude Code，整个 `~/.claude-code/` 会被清理
- 如果只是取消 MindOS MCP，symlink 无副作用

---

## 验证

1. `npm run build` — 编译通过
2. 首次 Setup 选 `en` 模板 → 完成后 `mindos` Skill 安装到选中 agent，`mindos-zh` 在 MindOS 侧禁用
3. 首次 Setup 选 `zh` 模板 → 完成后 `mindos-zh` Skill 安装到选中 agent，`mindos` 在 MindOS 侧禁用
4. Step 5 显示 Skill 安装提示
5. Step 6 Review 展示将启用的 Skill 名称 + 安装状态
6. Settings → MCP → Skills 中语言切换器正常工作
7. `claude-desktop` 不参与 Skill 安装（不支持）

---

## 不做的事

- **不在 Setup 中提供 Skill 选择 UI**：自动根据模板语言决定，减少决策负担
- **不用 `--all`**：避免为 ~31 个 additional agent 创建不必要的目录，用 Universal 兜底 + 按需 `-a`
- **不改 CLI 行为**：CLI `mindos mcp install` 不涉及 Skill，保持现状
- **不调用 `npx skills remove`**：remove --all 会删除 `skills/` 源文件，只做 add 操作
